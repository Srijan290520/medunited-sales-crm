// PatientProfiles.gs — the Patients page: one place per patient for the
// whole call, across every module.
//
//   listPatients        every patient, with what they have in each module
//   getPatient          one patient: details, household, every record in
//                       every module, every contact and active reminders
//   createPatient       a patient on their own, before any service exists
//   updatePatient       address, alternate phone, notes, name, date of birth
//   logPatientActivity  a call / WhatsApp / note on the patient itself (an
//                       enquiry that isn't about one record yet)
//
// Who sees what: everyone can look up any patient, so whoever takes a call
// has the full picture. Only the patient's owner, managers and admins can
// change the patient or log contact on them; module records keep their own
// rules (an agent can open and edit only their own records).
//
// Patient-level contact is stored in SaleActivities with SaleType 'patient'
// and SaleID = the patient's ID. Logging one replaces the patient's own
// follow-up date with the one given (or clears it).
//
// The phone number can't be changed here: it is what ties the patient to
// their household and their records.

var PATIENT_ACTIVITY_TYPE = 'patient';

function patientField(p, k) { return String(p[k] === undefined || p[k] === null ? '' : p[k]); }

function isTeamSession(session) { return TEAM_ROLES.indexOf(session.role) !== -1; }

// The owner, managers and admins. Nobody edits a patient waiting for an admin
// to choose an owner, except the team.
function canEditPatient(session, world, p) {
  if (isTeamSession(session)) return true;
  if (p.OwnerStatus === PATIENT_CONFLICT) return false;
  var o = ownerOfPatient(world, p);
  return !!o && lowerEmail(o.email) === lowerEmail(session.email);
}

function requirePatient(world, id) {
  var p = world.byId[String(id || '')];
  if (!p || world.added.indexOf(p) !== -1) throw new Error('Patient not found.');
  return p;
}

function patientActivityMap() {
  var map = {};
  sheetToObjects(getActivitiesSheet()).forEach(function (a) {
    var k = String(a.SaleID);
    (map[k] = map[k] || []).push(a);
  });
  return map;
}

function followUpStatusOfKey(key) {
  if (!isDateKey(key)) return '';
  var diff = keyToDayNumber(key) - keyToDayNumber(todayKey());
  return diff < 0 ? 'overdue' : diff === 0 ? 'today' : 'upcoming';
}

// The list row: who, where, and what they have in each module.
function patientSummary(session, world, p, records, acts) {
  var me = lowerEmail(session.email);
  var o = ownerOfPatient(world, p);
  var byModule = {};
  var followUps = [];
  var dnc = false;
  var last = '';
  function seen(list) {
    (list || []).forEach(function (a) { var d = isoString(a.Date); if (d > last) last = d; });
  }
  records.forEach(function (x) {
    var m = byModule[x.type] || (byModule[x.type] = { open: 0, completed: 0, lost: 0 });
    if (x.row.Status === 'Pending') {
      m.open++;
      var f = dateKey(x.row.NextFollowUp);
      if (isDateKey(f)) followUps.push(f);
    } else if (x.row.Status === 'Completed') m.completed++;
    else m.lost++;
    if (asBool(x.row.DoNotCall)) dnc = true;
    seen(acts[String(x.row.ID)]);
  });
  seen(acts[String(p.ID)]);
  var own = dateKey(p.NextFollowUp);
  if (isDateKey(own)) followUps.push(own);
  followUps.sort();
  var next = followUps[0] || '';

  return {
    ID: String(p.ID),
    Name: patientField(p, 'Name'),
    Contact: patientField(p, 'Contact'),
    ContactKey: patientField(p, 'ContactKey'),
    DOB: dateKey(p.DOB),
    AltContact: patientField(p, 'AltContact'),
    Address: patientField(p, 'Address'),
    Area: patientField(p, 'Area'),
    Pincode: patientField(p, 'Pincode'),
    Notes: patientField(p, 'Notes'),
    OwnerName: o ? o.name : '',
    OwnerEmail: o ? o.email : '',
    Conflict: p.OwnerStatus === PATIENT_CONFLICT,
    Mine: !!o && lowerEmail(o.email) === me,
    CanEdit: canEditPatient(session, world, p),
    DoNotCall: dnc,
    HouseholdSize: householdOf(world, p.ContactKey).filter(function (x) { return world.added.indexOf(x) === -1; }).length || 1,
    Modules: moduleIds().filter(function (t) { return byModule[t]; }).map(function (t) {
      return { type: t, label: SALE_TYPES[t], open: byModule[t].open, completed: byModule[t].completed, lost: byModule[t].lost };
    }),
    OpenCount: records.filter(function (x) { return x.row.Status === 'Pending'; }).length,
    NextFollowUp: next,
    FollowUpStatus: followUpStatusOfKey(next),
    OwnFollowUp: isDateKey(own) ? own : '',
    LastContact: last,
    CreatedAt: isoString(p.CreatedAt)
  };
}

// Records per patient ID, in one pass.
function recordsByPatient(world) {
  var map = {};
  world.records.forEach(function (x) {
    var p = recordPatient(world, x.row);
    if (p) (map[String(p.ID)] = map[String(p.ID)] || []).push(x);
  });
  return map;
}

// Saved patients only: people the server would only infer from old rows have
// no ID yet (any save on their number links them).
function savedPatients(world) {
  return world.patients.filter(function (p) { return world.added.indexOf(p) === -1; });
}

function svc_listPatients(session) {
  var world = loadPatientWorld();
  var recs = recordsByPatient(world);
  var acts = patientActivityMap();
  var rank = { overdue: 0, today: 1, upcoming: 2, '': 3 };
  var list = savedPatients(world).map(function (p) {
    return patientSummary(session, world, p, recs[String(p.ID)] || [], acts);
  });
  list.sort(function (a, b) {
    if (rank[a.FollowUpStatus] !== rank[b.FollowUpStatus]) return rank[a.FollowUpStatus] - rank[b.FollowUpStatus];
    if (a.FollowUpStatus && a.NextFollowUp !== b.NextFollowUp) return a.NextFollowUp < b.NextFollowUp ? -1 : 1;
    var la = a.LastContact || a.CreatedAt;
    var lb = b.LastContact || b.CreatedAt;
    return la < lb ? 1 : la > lb ? -1 : 0;
  });
  return list;
}

function patientDetail(session, world, p) {
  var recs = recordsByPatient(world)[String(p.ID)] || [];
  var acts = patientActivityMap();
  var extras = recordExtras(world);
  var summary = patientSummary(session, world, p, recs, acts);

  var records = recs.map(function (x) {
    var s = saleForClient(x.row, acts[String(x.row.ID)], extras(x.type, x.row), x.type);
    s.Type = x.type;
    s.ModuleLabel = SALE_TYPES[x.type];
    s.CanOpen = canAccessSale(session, x.row);
    return s;
  });
  var rank = { Pending: 0, Completed: 1, Cancelled: 2 };
  records.sort(function (a, b) {
    if (rank[a.Status] !== rank[b.Status]) return rank[a.Status] - rank[b.Status];
    return a.CreatedAt < b.CreatedAt ? 1 : a.CreatedAt > b.CreatedAt ? -1 : 0;
  });

  // Every contact: on the patient and on each of their records.
  var labelOf = {};
  records.forEach(function (r) { labelOf[r.ID] = { type: r.Type, label: r.ModuleLabel + (r.Detail ? ' — ' + r.Detail : '') }; });
  var timeline = [];
  (acts[String(p.ID)] || []).forEach(function (a) {
    timeline.push(Object.assign(activityForClient(a), { SaleType: PATIENT_ACTIVITY_TYPE, About: 'General' }));
  });
  records.forEach(function (r) {
    (acts[r.ID] || []).forEach(function (a) {
      timeline.push(Object.assign(activityForClient(a), { SaleType: r.Type, About: labelOf[r.ID].label.slice(0, 80) }));
    });
  });
  timeline.sort(function (a, b) { return a.Date < b.Date ? 1 : a.Date > b.Date ? -1 : 0; });

  var ids = {};
  records.forEach(function (r) { ids[r.ID] = true; });
  var reminders = sheetToObjects(getRemindersSheet())
    .filter(function (r) { return r.Status === 'Active' && (String(r.PatientID) === String(p.ID) || ids[reminderSaleId(r)]); })
    .map(sanitizeReminder);

  var household = householdOf(world, p.ContactKey)
    .filter(function (x) { return String(x.ID) !== String(p.ID) && world.added.indexOf(x) === -1; })
    .map(function (x) {
      var o = ownerOfPatient(world, x);
      return { ID: String(x.ID), Name: String(x.Name), OwnerName: o ? o.name : '', Conflict: x.OwnerStatus === PATIENT_CONFLICT };
    });

  return { patient: summary, records: records, activities: timeline.slice(0, 100), reminders: reminders, household: household };
}

function svc_getPatient(session, id) {
  var world = loadPatientWorld();
  return patientDetail(session, world, requirePatient(world, id));
}

// ===== Writes =====
var PATIENT_EDITABLE = {
  // payload key → [column, max length, label]
  name: ['Name', 120, 'Name'],
  dob: ['DOB', 10, 'Date of birth'],
  altContact: ['AltContact', 30, 'Alternate phone'],
  address: ['Address', 300, 'Address'],
  area: ['Area', 80, 'Area'],
  pincode: ['Pincode', 6, 'Pincode'],
  notes: ['Notes', 2000, 'Notes'] // MAX_LONG_TEXT (Utils.gs may load after this file)
};

// The cleaned columns for the keys present in `data`.
function cleanPatientFields(data) {
  var out = {};
  Object.keys(PATIENT_EDITABLE).forEach(function (k) {
    if (data[k] === undefined) return;
    var spec = PATIENT_EDITABLE[k];
    var v = k === 'dob' ? optionalDateKey(data[k], spec[2]) : cleanText(data[k], spec[1]);
    if (k === 'pincode' && v && !/^\d{6}$/.test(v)) throw new Error('Pincode must be 6 digits.');
    if (k === 'altContact' && v && !phoneKey(v)) throw new Error('Alternate phone must be a valid phone number.');
    if (k === 'dob' && v && v > todayKey()) throw new Error('Date of birth can\'t be in the future.');
    out[spec[0]] = v;
  });
  if (out.Name !== undefined && !out.Name) throw new Error('Name is required.');
  return out;
}

function patientChanges(before, patch) {
  var out = [];
  Object.keys(PATIENT_EDITABLE).forEach(function (k) {
    var col = PATIENT_EDITABLE[k][0];
    if (patch[col] === undefined) return;
    var from = before ? patientField(before, col) : '';
    if (col === 'DOB') from = before ? dateKey(before.DOB) : '';
    if (from !== String(patch[col])) out.push({ field: PATIENT_EDITABLE[k][2], from: from || '—', to: String(patch[col]) || '—' });
  });
  return out;
}

function svc_createPatient(session, data) {
  var name = cleanText(data.name, 120);
  if (!name) throw new Error('Name is required.');
  var contact = cleanText(data.contact, 30);
  var key = phoneKey(contact);
  if (!key) throw new Error('A valid phone number is required.');
  var fields = cleanPatientFields(data);

  var world = loadPatientWorld();
  ensureHousehold(world, key);
  var existing = findPerson(world, key, name);
  if (existing) throw new Error(name + ' is already registered on this number. Search for them instead.');

  var link = resolvePatientOwner(world, {
    contactKey: key, contact: contact, name: name, requested: resolveAssignee(session, data.agentEmail)
  });
  var p = link.patient;
  Object.keys(fields).forEach(function (k) { if (k !== 'Name') p[k] = fields[k]; });
  savePatientChanges(world);
  audit(session, 'create', 'Patient', p.ID, patientChanges(null, fields),
    'Registered patient ' + name + (link.notice && !link.conflict ? '; ' + link.notice : ''));
  return Object.assign({ notice: link.notice }, freshPatientDetail(session, p.ID));
}

// After a write: the patient as saved.
function freshPatientDetail(session, id) {
  var world = loadPatientWorld();
  return patientDetail(session, world, requirePatient(world, id));
}

function svc_updatePatient(session, id, data) {
  var world = loadPatientWorld();
  var p = requirePatient(world, id);
  if (!canEditPatient(session, world, p)) throw new ForbiddenError('Only ' + (p.OwnerName || 'the patient\'s agent') + ', a manager or an admin can change this patient.');
  var patch = cleanPatientFields(data);
  if (patch.Name !== undefined) {
    var nk = nameKey(patch.Name);
    var clash = householdOf(world, p.ContactKey).some(function (x) { return x !== p && String(x.NameKey) === nk; });
    if (clash) throw new Error('Someone called ' + patch.Name + ' is already registered on this number.');
    if (nk === String(p.NameKey) && patch.Name === String(p.Name)) delete patch.Name;
    else patch.NameKey = nk;
  }
  var changes = patientChanges(p, patch);
  if (!changes.length) return patientDetail(session, world, p);
  var before = Object.assign({}, p);
  changePatient(world, p, patch);
  savePatientChanges(world);
  audit(session, 'update', 'Patient', p.ID, patientChanges(before, patch), 'Updated patient ' + p.Name);
  return freshPatientDetail(session, p.ID);
}

function svc_logPatientActivity(session, id, data) {
  var world = loadPatientWorld();
  var p = requirePatient(world, id);
  if (!canEditPatient(session, world, p)) throw new ForbiddenError('Only ' + (p.OwnerName || 'the patient\'s agent') + ', a manager or an admin can log contact on this patient.');

  var actType = String(data.type || '');
  requireOneOf(actType, ACTIVITY_TYPES, 'Type');
  var direction = '';
  var outcome = '';
  if (actType !== 'Note') {
    direction = String(data.direction || 'Outgoing');
    outcome = String(data.outcome || 'Connected');
    requireOneOf(direction, ACTIVITY_DIRECTIONS, 'Direction');
    requireOneOf(outcome, ACTIVITY_OUTCOMES, 'Outcome');
  }
  var notes = cleanText(data.notes, MAX_LONG_TEXT);
  if (actType === 'Note' && !notes) throw new Error('A note needs some text.');
  var dnc = patientRecords(world, p).some(function (x) { return asBool(x.row.DoNotCall); });
  if (dnc && direction === 'Outgoing' && DND_BLOCKED_TYPES.indexOf(actType) !== -1) {
    throw new ForbiddenError('This patient is marked Do Not Call. Only record contact they started (Incoming).');
  }
  var nextFollowUp = optionalDateKey(data.nextFollowUp, 'Next follow-up');

  addActivity(session, PATIENT_ACTIVITY_TYPE, p.ID, {
    Type: actType, Direction: direction, Outcome: outcome, Notes: notes, NextFollowUp: nextFollowUp
  });
  if (dateKey(p.NextFollowUp) !== nextFollowUp) {
    changePatient(world, p, { NextFollowUp: nextFollowUp });
    savePatientChanges(world);
  }
  return freshPatientDetail(session, p.ID);
}
