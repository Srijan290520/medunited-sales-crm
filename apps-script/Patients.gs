// Patients.gs — one agent per patient, across every module.
//
// A patient is a person: a phone number + a name. Relatives often share one
// number (a Medpass holder's parents, children…), so everyone on a number is
// a "household". By default a household has one owner agent; a manager can
// split a person out to another agent.
//
//   Patients  ID | ContactKey | Contact | Name | NameKey | DOB | OwnerEmail |
//             OwnerName | OwnerStatus | ConflictAgents | SplitFromHousehold |
//             CreatedAt | UpdatedAt
//
// Module records point at their patient through the PatientID column. Rows
// saved before Patients existed have no PatientID; they are matched by phone
// number + name until migratePatients() (or any save touching that number)
// links them.
//
// OwnerStatus is 'Owned' or 'Conflict'. A household whose existing records
// were handled by more than one agent is never guessed: its people are marked
// Conflict, with the candidate agents in ConflictAgents, until an admin
// decides (keep together under one agent, or split).
//
// Rules enforced here and in SalesService.gs:
//  - a new record for a known patient goes to that patient's owner, whoever
//    enters it; a new person on a known number goes to the household owner;
//  - one open (Pending) record per patient per module;
//  - reassigning moves every open record of the patient (or household) in
//    every module, plus active refill reminders; closed records keep their
//    agent, so incentives stay with whoever closed the sale.

var PATIENT_HEADERS = ['ID', 'ContactKey', 'Contact', 'Name', 'NameKey', 'DOB', 'OwnerEmail', 'OwnerName', 'OwnerStatus',
  'ConflictAgents', 'SplitFromHousehold', 'CreatedAt', 'UpdatedAt'];
var PATIENT_OWNED = 'Owned';
var PATIENT_CONFLICT = 'Conflict';

function getPatientsSheet() { return getOrCreateSheet('Patients', PATIENT_HEADERS); }

// "Ravi  Kumar", "ravi kumar." and "RAVI KUMAR" are the same name. Letters in
// any script are kept, so Telugu / Hindi names compare too.
function nameKey(value) {
  return cleanText(value, 120).toLowerCase().replace(/[.,'"`_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function recordContactKey(row) { return String(row.ContactKey || phoneKey(row.Contact)); }

function lowerEmail(v) { return String(v || '').toLowerCase(); }

// ===== The in-memory picture of patients and records =====
// Loaded once per request. Changes are collected here and written by
// savePatientChanges(), so a request that fails validation writes nothing.
function loadPatientWorld() {
  var world = {
    patients: [], byId: {}, byPerson: {}, byHousehold: {},
    records: [], users: {}, added: [], changed: {}
  };
  sheetToObjects(getPatientsSheet()).forEach(function (p) { if (p.ID) indexPatient(world, p); });
  moduleIds().forEach(function (type) {
    sheetToObjects(getSaleSheet(type)).forEach(function (r) { if (r.ID) world.records.push({ type: type, row: r }); });
  });
  sheetToObjects(getSheetByName('Users')).forEach(function (u) { world.users[lowerEmail(u.Email)] = u; });
  return world;
}

function indexPatient(world, p) {
  world.patients.push(p);
  world.byId[String(p.ID)] = p;
  world.byPerson[String(p.ContactKey) + '|' + String(p.NameKey)] = p;
  (world.byHousehold[String(p.ContactKey)] = world.byHousehold[String(p.ContactKey)] || []).push(p);
}

function householdOf(world, key) { return world.byHousehold[String(key)] || []; }

function findPerson(world, key, name) { return world.byPerson[String(key) + '|' + nameKey(name)] || null; }

// The patient a record belongs to (null if that number was never linked).
function recordPatient(world, row) {
  if (row.PatientID && world.byId[String(row.PatientID)]) return world.byId[String(row.PatientID)];
  return findPerson(world, recordContactKey(row), row.CustomerName);
}

function householdRecords(world, key) {
  return world.records.filter(function (x) { return recordContactKey(x.row) === String(key); });
}

function patientRecords(world, patient) {
  return householdRecords(world, patient.ContactKey).filter(function (x) {
    var p = recordPatient(world, x.row);
    return p && String(p.ID) === String(patient.ID);
  });
}

function activeUser(world, email) {
  var u = world.users[lowerEmail(email)];
  return u && isActive(u.Active) ? u : null;
}

// Who handles this patient now, or null (no owner yet, owner inactive, or
// waiting for an admin to resolve a conflict).
function ownerOfPatient(world, p) {
  if (!p || p.OwnerStatus === PATIENT_CONFLICT || !p.OwnerEmail) return null;
  var u = activeUser(world, p.OwnerEmail);
  return u ? { email: u.Email, name: u.Name } : null;
}

// Distinct active owners of a household's people.
function householdOwners(world, key) {
  var seen = {};
  var out = [];
  householdOf(world, key).forEach(function (p) {
    var o = ownerOfPatient(world, p);
    if (o && !seen[lowerEmail(o.email)]) { seen[lowerEmail(o.email)] = true; out.push(o); }
  });
  return out;
}

function newPatientRow(world, key, contact, name, owner) {
  var now = nowIso();
  var p = {
    ID: newId(), ContactKey: String(key), Contact: contact, Name: cleanText(name, 120), NameKey: nameKey(name), DOB: '',
    OwnerEmail: owner ? owner.email : '', OwnerName: owner ? owner.name : '', OwnerStatus: PATIENT_OWNED,
    ConflictAgents: '', SplitFromHousehold: false, CreatedAt: now, UpdatedAt: now
  };
  indexPatient(world, p);
  world.added.push(p);
  return p;
}

function changePatient(world, p, patch) {
  Object.keys(patch).forEach(function (k) { p[k] = patch[k]; });
  p.UpdatedAt = nowIso();
  if (world.added.indexOf(p) !== -1) return; // not saved yet — it'll be written whole
  var c = world.changed[String(p.ID)] || (world.changed[String(p.ID)] = {});
  Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
  c.UpdatedAt = p.UpdatedAt;
}

// Creates Patients for any records on this number that don't have one yet
// (rows from before Patients existed). Owner: the one agent who handled the
// household's records; more than one → Conflict for an admin to resolve.
function ensureHousehold(world, key) {
  var rows = householdRecords(world, key);
  var groups = {};
  var order = [];
  rows.forEach(function (x) {
    if (recordPatient(world, x.row)) return;
    var nk = nameKey(x.row.CustomerName);
    if (!groups[nk]) { groups[nk] = []; order.push(nk); }
    groups[nk].push(x);
  });
  if (!order.length) return;

  var stats = {};
  var statOrder = [];
  function stat(email, name) {
    var k = lowerEmail(email);
    if (!stats[k]) { stats[k] = { email: String(email), name: String(name || email), open: 0, closed: 0 }; statOrder.push(k); }
    return stats[k];
  }
  rows.forEach(function (x) {
    if (!x.row.AgentEmail) return;
    var s = stat(x.row.AgentEmail, x.row.AgentName);
    if (x.row.Status === 'Pending') s.open++; else s.closed++;
  });
  householdOf(world, key).forEach(function (p) { if (p.OwnerEmail && p.OwnerStatus === PATIENT_OWNED) stat(p.OwnerEmail, p.OwnerName); });

  order.forEach(function (nk) {
    var first = groups[nk][0].row;
    var p;
    if (statOrder.length === 1) {
      var only = stats[statOrder[0]];
      var u = activeUser(world, only.email);
      p = newPatientRow(world, key, String(first.Contact || ''), first.CustomerName, { email: u ? u.Email : only.email, name: u ? u.Name : only.name });
    } else {
      p = newPatientRow(world, key, String(first.Contact || ''), first.CustomerName, null);
      p.OwnerStatus = PATIENT_CONFLICT;
      p.ConflictAgents = JSON.stringify(statOrder.map(function (k) { return stats[k]; }));
    }
  });
}

// Decides which patient a new or edited record belongs to and who must handle
// it. `requested` is the agent the person entering chose (or themselves).
// Returns { patient, owner, notice, conflict }.
function resolvePatientOwner(world, opts) {
  var key = String(opts.contactKey);
  var requested = opts.requested;
  ensureHousehold(world, key);

  var patient = null;
  if (opts.patientId) {
    patient = world.byId[String(opts.patientId)] || null;
    if (!patient || String(patient.ContactKey) !== key) throw new Error('That person is not on this phone number. Pick them again or add them as someone new.');
  }
  if (!patient) patient = findPerson(world, key, opts.name);

  var owner;
  if (patient) {
    owner = ownerOfPatient(world, patient);
    if (!owner) {
      owner = requested;
      // No conflict, just no usable owner (e.g. deactivated before handovers
      // existed): the person entering takes the patient over.
      if (patient.OwnerStatus !== PATIENT_CONFLICT) changePatient(world, patient, { OwnerEmail: owner.email, OwnerName: owner.name });
    }
  } else {
    var owners = householdOwners(world, key);
    if (owners.length === 1) owner = owners[0];
    else if (owners.length > 1) {
      owner = owners.filter(function (o) { return lowerEmail(o.email) === lowerEmail(requested.email); })[0] || owners[0];
    } else owner = requested;
    patient = newPatientRow(world, key, opts.contact, opts.name, owner);
  }

  var conflict = patient.OwnerStatus === PATIENT_CONFLICT;
  var notice = '';
  if (conflict) notice = 'This patient is waiting for an admin to choose who handles them; the record was saved as entered.';
  else if (lowerEmail(owner.email) !== lowerEmail(requested.email)) notice = 'Already handled by ' + owner.name + ' — assigned to them.';
  return { patient: patient, owner: owner, notice: notice, conflict: conflict };
}

// The open record this patient already has in this module, if any.
function findOpenRecordForPatient(world, type, patient, exceptId) {
  if (!patient) return null;
  var hit = null;
  householdRecords(world, patient.ContactKey).forEach(function (x) {
    if (hit || x.type !== type || x.row.Status !== 'Pending' || String(x.row.ID) === String(exceptId || '')) return;
    var p = recordPatient(world, x.row);
    if (p && String(p.ID) === String(patient.ID)) hit = x;
  });
  return hit;
}

function openRecordMessage(session, type, dup, tail) {
  return 'This patient already has an open ' + SALE_TYPES[type] + ' record' +
    (canAccessSale(session, dup.row) ? ' (' + dup.row.CustomerName + ')' : '') +
    ', managed by ' + dup.row.AgentName + '. ' + tail;
}

// Before a closed record goes back to Pending: it must follow the patient's
// current owner, and the patient can't already have an open one in this module.
// Returns the AgentEmail/AgentName patch to apply (may be empty).
function reopenOwnership(session, world, type, row) {
  ensureHousehold(world, recordContactKey(row));
  var patient = recordPatient(world, row);
  var dup = findOpenRecordForPatient(world, type, patient, row.ID);
  if (dup) throw new Error(openRecordMessage(session, type, dup, 'Close that one first.'));
  var patch = {};
  if (patient && !row.PatientID) patch.PatientID = patient.ID;
  var owner = ownerOfPatient(world, patient);
  if (owner && lowerEmail(owner.email) !== lowerEmail(row.AgentEmail)) {
    if (session.role === 'agent') {
      throw new ForbiddenError('This patient is now handled by ' + owner.name + '. Ask them or a manager to reopen it.');
    }
    patch.AgentEmail = owner.email;
    patch.AgentName = owner.name;
  }
  return patch;
}

// Writes new and changed Patients rows (call inside the script lock, after
// validation has passed).
function savePatientChanges(world) {
  var sheet = getPatientsSheet();
  if (world.added.length) {
    var headers = sheetHeaders(sheet);
    var values = world.added.map(function (p) {
      return headers.map(function (h) { return safeCellValue(p[h] !== undefined ? p[h] : ''); });
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
    world.added = [];
  }
  Object.keys(world.changed).forEach(function (id) { updateObjectById(sheet, id, world.changed[id]); });
  world.changed = {};
}

// ===== Per-record extras for the browser =====
// AlsoIn: the other modules where this patient has records.
// HouseholdSize: how many people share the number.
function recordExtras(world) {
  var modulesByPerson = {};
  var peopleByKey = {};
  world.records.forEach(function (x) {
    var p = recordPatient(world, x.row);
    var key = recordContactKey(x.row);
    var person = p ? 'p:' + p.ID : 'n:' + key + '|' + nameKey(x.row.CustomerName);
    (modulesByPerson[person] = modulesByPerson[person] || {})[x.type] = true;
    (peopleByKey[key] = peopleByKey[key] || {})[person] = true;
  });
  return function (type, row) {
    var p = recordPatient(world, row);
    var key = recordContactKey(row);
    var person = p ? 'p:' + p.ID : 'n:' + key + '|' + nameKey(row.CustomerName);
    var mods = modulesByPerson[person] || {};
    return {
      PatientID: p ? String(p.ID) : '',
      AlsoIn: moduleIds().filter(function (t) { return t !== type && mods[t]; }).map(function (t) { return SALE_TYPES[t]; }),
      HouseholdSize: Object.keys(peopleByKey[key] || {}).length || 1
    };
  };
}

// ===== Reassigning =====
// A patient can be handled by an active agent or manager.
function requireOwnerCandidate(world, email) {
  var u = activeUser(world, cleanEmail(email));
  if (!u || ['agent', 'manager'].indexOf(String(u.Role)) === -1) throw new Error('Target agent not found or inactive.');
  return { email: u.Email, name: u.Name };
}

// Gives `patients` to `target`: every open record of theirs in every module
// and their active refill reminders move too. Completed/Cancelled records
// keep their agent, so incentives stay with whoever closed the sale.
// Writes as it goes — call inside the script lock, after all checks.
function movePatients(session, world, patients, target, why) {
  var ids = {};
  var keys = {};
  patients.forEach(function (p) { ids[String(p.ID)] = true; keys[String(p.ContactKey)] = true; });
  var note = why ? ' Reason: ' + why : '';
  var moved = [];
  var reminderSales = {};

  world.records.forEach(function (x) {
    if (!keys[recordContactKey(x.row)]) return;
    var p = recordPatient(world, x.row);
    if (!p || !ids[String(p.ID)]) return;
    if (getModule(x.type).reminders) reminderSales[String(x.row.ID)] = true;
    var patch = {};
    if (!x.row.PatientID) patch.PatientID = p.ID;
    var moving = x.row.Status === 'Pending' && lowerEmail(x.row.AgentEmail) !== lowerEmail(target.email);
    if (moving) { patch.AgentEmail = target.email; patch.AgentName = target.name; }
    if (!Object.keys(patch).length) return;
    patch.UpdatedAt = nowIso();
    var before = x.row;
    x.row = updateObjectById(getSaleSheet(x.type), before.ID, patch);
    if (!moving) return;
    addActivity(session, x.type, before.ID, { Type: 'Note', Notes: 'Reassigned from ' + before.AgentName + ' to ' + target.name + '.' + note });
    audit(session, 'reassign', saleEntity(x.type), before.ID, saleChanges(before, patch),
      'Reassigned from ' + before.AgentName + ' to ' + target.name + note);
    moved.push({ type: x.type, id: String(before.ID) });
  });

  var reminders = 0;
  var remSheet = getSheetByName('Reminders');
  sheetToObjects(remSheet).forEach(function (r) {
    if (r.Status !== 'Active' || !reminderSales[String(r.PharmacySaleID)] || lowerEmail(r.AgentEmail) === lowerEmail(target.email)) return;
    var patch = { AgentEmail: target.email, AgentName: target.name, Reassigned: true, UpdatedAt: nowIso() };
    updateObjectById(remSheet, r.ID, patch);
    audit(session, 'reassign', 'Reminder', r.ID, auditDiff(r, patch), 'Refill reminder moved with the patient to ' + target.name);
    reminders++;
  });

  patients.forEach(function (p) {
    var before = { OwnerEmail: p.OwnerEmail, OwnerName: p.OwnerName, OwnerStatus: p.OwnerStatus };
    var patch = { OwnerEmail: target.email, OwnerName: target.name, OwnerStatus: PATIENT_OWNED, ConflictAgents: '' };
    if (before.OwnerEmail === patch.OwnerEmail && before.OwnerStatus === PATIENT_OWNED) return;
    changePatient(world, p, patch);
    audit(session, 'reassign', 'Patient', p.ID, auditDiff(before, { OwnerEmail: patch.OwnerEmail, OwnerName: patch.OwnerName, OwnerStatus: patch.OwnerStatus }),
      p.Name + ' is now handled by ' + target.name + note);
  });

  // A household with more than one owner has been split on purpose.
  Object.keys(keys).forEach(function (key) {
    var split = householdOwners(world, key).length > 1;
    householdOf(world, key).forEach(function (p) {
      if (asBool(p.SplitFromHousehold) !== split) changePatient(world, p, { SplitFromHousehold: split });
    });
  });
  return { records: moved, reminders: reminders };
}

// Manager/admin: hand a patient — or by default their whole household — to
// another agent. Identify the patient by a record (type + id), a PatientID,
// or a phone number (always the whole household).
function svc_reassignPatient(session, data) {
  requireRole(session, ['admin', 'manager']);
  data = data || {};
  var world = loadPatientWorld();
  var target = requireOwnerCandidate(world, data.agentEmail);
  var scope = data.scope === 'person' ? 'person' : 'household';
  var patient = null;
  if (data.type !== undefined && data.id !== undefined) {
    getModule(data.type);
    var rec = world.records.filter(function (x) { return x.type === data.type && String(x.row.ID) === String(data.id); })[0];
    if (!rec) throw new Error('Record not found.');
    ensureHousehold(world, recordContactKey(rec.row));
    patient = recordPatient(world, rec.row);
  } else if (data.patientId) {
    patient = world.byId[String(data.patientId)] || null;
  } else if (data.contact) {
    var key = phoneKey(data.contact);
    if (key) { ensureHousehold(world, key); patient = householdOf(world, key)[0] || null; }
    scope = 'household';
  }
  if (!patient) throw new Error('Patient not found.');
  var group = scope === 'person' ? [patient] : householdOf(world, patient.ContactKey).slice();
  var result = movePatients(session, world, group, target, cleanText(data.reason, 300));
  savePatientChanges(world);
  return { moved: result.records, reminders: result.reminders, patients: group.length, agentName: target.name };
}
