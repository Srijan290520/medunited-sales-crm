// BulkReassign.gs — moving many patients at once (managers and above).
//
//   bulkReassign          records ticked on a module page → one agent
//   importReassignments   an exported sheet with the Assigned Agent Email
//                         column edited → each row's patient to that agent
//   handoverAgent         everything one agent handles → another agent,
//                         without deactivating anyone
//
// Every tool works on patients, like a single reassign (Patients.gs): the
// patient — by default everyone on their phone number (scope 'household'),
// or only that person (scope 'person') — moves with all their open records in
// every module and their active reminders. Completed and cancelled records
// keep their agent, so incentives stay with whoever closed the sale.
//
// Each tool has a dry run that says what would move and saves nothing. The
// real run checks everything again first.

var BULK_MAX_ROWS = 500;

// One line of the plan, as the browser shows it.
function bulkResult(rowNo, rec, errors, warnings, fromName, toName, openRecords) {
  return {
    row: rowNo, id: rec ? String(rec.row.ID) : '', customerName: rec ? String(rec.row.CustomerName) : '',
    ok: errors.length === 0, errors: errors, warnings: warnings,
    fromAgent: fromName || '', toAgent: toName || '', openRecords: openRecords || 0
  };
}

// Works out who goes where. requests: [{ row, type, id, agentEmail }].
// Returns { results, groups } — groups are the moves that would be made.
function planBulkReassign(world, requests, scope) {
  var groups = {};
  var order = [];
  var results = [];

  requests.forEach(function (q) {
    var errors = [];
    var warnings = [];
    var rec = null;
    var target = null;
    var patient = null;
    if (!MODULES.hasOwnProperty(q.type)) errors.push('Unknown module.');
    else {
      rec = world.records.filter(function (x) { return x.type === q.type && String(x.row.ID) === String(q.id); })[0] || null;
      if (!rec) errors.push('No ' + SALE_TYPES[q.type] + ' record with ID "' + cleanText(q.id, 60) + '".');
    }
    if (!cleanText(q.agentEmail)) errors.push('Agent email is empty.');
    else {
      try { target = requireOwnerCandidate(world, q.agentEmail); } catch (e) { errors.push('"' + cleanText(q.agentEmail, 80) + '" is not an active agent or manager.'); }
    }
    if (rec) {
      ensureHousehold(world, recordContactKey(rec.row));
      patient = recordPatient(world, rec.row);
      if (!patient) errors.push('This record has no valid phone number, so its patient can\'t be found.');
    }
    if (errors.length) { results.push({ q: q, rec: rec, errors: errors, warnings: warnings }); return; }

    var key = scope === 'person' ? 'p:' + patient.ID : 'h:' + patient.ContactKey;
    var g = groups[key];
    if (!g) {
      g = groups[key] = {
        key: key, target: target, rows: [],
        patients: scope === 'person' ? [patient] : householdOf(world, patient.ContactKey).slice()
      };
      order.push(key);
    } else if (lowerEmail(g.target.email) !== lowerEmail(target.email)) {
      g.conflict = true;
    }
    if (rec.row.Status !== 'Pending') warnings.push('This record is ' + rec.row.Status + ' and keeps its agent; the patient and their open records move.');
    var r = { q: q, rec: rec, errors: errors, warnings: warnings, group: g };
    g.rows.push(r);
    results.push(r);
  });

  // Rows that give the same patient (or household) different agents.
  order.forEach(function (key) {
    var g = groups[key];
    if (!g.conflict) return;
    var nums = g.rows.map(function (r) { return r.q.row; }).join(', ');
    g.rows.forEach(function (r) {
      r.errors.push('Rows ' + nums + ' give this ' + (scope === 'person' ? 'patient' : 'household') + ' different agents. Use one agent for all of them.');
    });
  });

  // What each move would do.
  order.forEach(function (key) {
    var g = groups[key];
    var ids = {};
    g.patients.forEach(function (p) { ids[String(p.ID)] = true; });
    var open = 0;
    var already = g.patients.every(function (p) { return p.OwnerStatus === PATIENT_OWNED && lowerEmail(p.OwnerEmail) === lowerEmail(g.target.email); });
    householdRecords(world, g.patients[0].ContactKey).forEach(function (x) {
      var p = recordPatient(world, x.row);
      if (p && ids[String(p.ID)] && x.row.Status === 'Pending' && lowerEmail(x.row.AgentEmail) !== lowerEmail(g.target.email)) open++;
    });
    g.openRecords = open;
    g.noChange = already && open === 0;
    if (g.noChange) g.rows.forEach(function (r) { if (!r.errors.length) r.warnings.push('Already with ' + g.target.name + ' — nothing to move.'); });
  });

  return {
    groups: order.map(function (k) { return groups[k]; }),
    results: results.map(function (r) {
      var from = r.rec ? String(r.rec.row.AgentName) : '';
      return bulkResult(r.q.row, r.rec, r.errors, r.warnings, from, r.group ? r.group.target.name : '', r.group ? r.group.openRecords : 0);
    })
  };
}

// Carries out the moves of a plan that have no errors. Returns totals.
function applyBulkPlan(session, world, plan, why) {
  var totals = { patients: 0, records: 0, reminders: 0 };
  plan.groups.forEach(function (g) {
    if (g.conflict || g.noChange) return;
    if (g.rows.some(function (r) { return r.errors.length; })) return;
    var res = movePatients(session, world, g.patients, g.target, why);
    totals.patients += g.patients.length;
    totals.records += res.records.length;
    totals.reminders += res.reminders;
  });
  savePatientChanges(world);
  return totals;
}

function bulkSummary(plan, dryRun, totals) {
  var ok = plan.results.filter(function (r) { return r.ok; }).length;
  return {
    dryRun: dryRun,
    total: plan.results.length,
    valid: ok,
    invalid: plan.results.length - ok,
    results: plan.results,
    moved: totals || null,
    toMove: plan.groups.filter(function (g) { return !g.conflict && !g.noChange; }).reduce(function (t, g) { return t + g.openRecords; }, 0)
  };
}

// Records ticked on a module page → one agent.
function svc_bulkReassign(session, data) {
  requireRole(session, TEAM_ROLES);
  data = data || {};
  getModule(data.type);
  var ids = Array.isArray(data.ids) ? data.ids : [];
  if (!ids.length) throw new Error('Select at least one record.');
  if (ids.length > BULK_MAX_ROWS) throw new Error('You can reassign at most ' + BULK_MAX_ROWS + ' records at a time.');
  var scope = data.scope === 'person' ? 'person' : 'household';
  var world = loadPatientWorld();
  var plan = planBulkReassign(world, ids.map(function (id, i) {
    return { row: i + 1, type: data.type, id: id, agentEmail: data.agentEmail };
  }), scope);
  var dryRun = data.dryRun !== false;
  if (dryRun) return bulkSummary(plan, true);
  var why = cleanText(data.reason, 300) || 'Bulk reassign';
  var totals = applyBulkPlan(session, world, plan, why);
  audit(session, 'bulk_reassign', saleEntity(data.type), '', { Patients: { from: '', to: totals.patients }, Records: { from: '', to: totals.records } },
    'Bulk reassigned ' + totals.patients + ' patient(s) (' + totals.records + ' open records) to ' + (plan.groups[0] ? plan.groups[0].target.name : '—') + '. ' + why);
  return bulkSummary(plan, false, totals);
}

// An exported sheet with the Assigned Agent Email column edited.
// rows: [{ _row, id, agentEmail }] for one module.
function svc_importReassignments(session, data) {
  requireRole(session, TEAM_ROLES);
  data = data || {};
  getModule(data.type);
  var rows = Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) throw new Error('The file has no rows.');
  if (rows.length > BULK_MAX_ROWS) throw new Error('You can import at most ' + BULK_MAX_ROWS + ' rows at a time. Split the file and import it in parts.');
  var scope = data.scope === 'person' ? 'person' : 'household';
  var world = loadPatientWorld();

  // Rows whose agent didn't change are left out of the plan (most of an export).
  var requests = [];
  var unchanged = [];
  rows.forEach(function (raw, i) {
    var r = raw && typeof raw === 'object' ? raw : {};
    var rowNo = Number(r._row) || (i + 2);
    var id = cleanText(r.id, 60);
    var email = cleanEmail(r.agentEmail);
    var rec = world.records.filter(function (x) { return x.type === data.type && String(x.row.ID) === id; })[0];
    if (rec && email && lowerEmail(rec.row.AgentEmail) === email) {
      var p = recordPatient(world, rec.row);
      if (!p || lowerEmail(p.OwnerEmail) === email) { unchanged.push(rowNo); return; }
    }
    requests.push({ row: rowNo, type: data.type, id: id, agentEmail: email });
  });
  var plan = planBulkReassign(world, requests, scope);
  var summary;
  var dryRun = data.dryRun !== false;
  var file = cleanText(data.fileName, 80);
  if (dryRun) summary = bulkSummary(plan, true);
  else {
    var why = 'Reassigned from file' + (file ? ' ' + file : '');
    var totals = applyBulkPlan(session, world, plan, why);
    audit(session, 'import_reassign', saleEntity(data.type), '', { Patients: { from: '', to: totals.patients }, Records: { from: '', to: totals.records } },
      why + ': ' + totals.patients + ' patient(s), ' + totals.records + ' open record(s) moved; ' + countSkipped(plan) + ' row(s) skipped.');
    summary = bulkSummary(plan, false, totals);
  }
  summary.unchanged = unchanged.length;
  return summary;
}

function countSkipped(plan) { return plan.results.filter(function (r) { return !r.ok; }).length; }

// Everything one agent handles → another agent (no deactivation).
function svc_handoverAgent(session, data) {
  requireRole(session, TEAM_ROLES);
  data = data || {};
  var fromEmail = cleanEmail(data.fromEmail);
  var user = sheetToObjects(getUsersSheet()).filter(function (u) { return lowerEmail(u.Email) === fromEmail; })[0];
  if (!user) throw new Error('Choose whose patients to hand over.');
  var world = loadPatientWorld();
  var successor = requireOwnerCandidate(world, data.toEmail);
  if (lowerEmail(successor.email) === fromEmail) throw new Error('Choose someone else to take over.');
  var work = openWorkOf(world, user.Email);
  var preview = { from: user.Name, to: successor.name, patients: work.patients.length, records: work.records.length, reminders: work.reminders.length };
  if (data.dryRun !== false) return { dryRun: true, preview: preview };
  var why = cleanText(data.reason, 300);
  if (why.length < 3) throw new Error('Give a reason (at least 3 characters), e.g. "On leave until 30 Nov".');
  if (!hasOpenWork(work)) throw new Error(user.Name + ' has nothing to hand over.');
  var moved = handOverWork(session, world, user, successor, why);
  audit(session, 'handover', 'User', user.ID, { Successor: { from: '', to: successor.email } },
    'Handed ' + moved.patients + ' patient(s), ' + moved.records + ' open record(s) and ' + moved.reminders + ' reminder(s) from ' +
    user.Name + ' to ' + successor.name + '. Reason: ' + why);
  return { dryRun: false, preview: preview, moved: moved };
}
