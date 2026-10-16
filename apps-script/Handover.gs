// Handover.gs — deactivating an agent without leaving patients behind.
//
// A manager asks for an agent to be deactivated and says who takes over
// their patients (the successor). An admin approves or rejects. Approving
// moves everything the agent still handles to the successor in one locked,
// audited step, then deactivates the account:
//   - every patient they own (with all of those patients' open records in
//     every module and their active refill reminders);
//   - any other open record or active reminder still in their name.
// Completed and cancelled records stay in their name, so their incentives
// and history are kept.
//
// The server never deactivates someone who still handles patients without a
// successor (see svc_updateUser).

var USER_REQUEST_HEADERS = ['ID', 'Type', 'UserEmail', 'UserName', 'SuccessorEmail', 'SuccessorName', 'Reason',
  'RequestedByEmail', 'RequestedByName', 'Status', 'DecidedByEmail', 'DecidedByName', 'DecisionNote', 'CreatedAt', 'DecidedAt'];

function getUserRequestsSheet() { return getOrCreateSheet('UserRequests', USER_REQUEST_HEADERS); }

function userRequestForClient(r) {
  return {
    ID: String(r.ID), Type: String(r.Type), UserEmail: String(r.UserEmail), UserName: String(r.UserName),
    SuccessorEmail: String(r.SuccessorEmail), SuccessorName: String(r.SuccessorName), Reason: String(r.Reason || ''),
    RequestedByName: String(r.RequestedByName), Status: String(r.Status), DecidedByName: String(r.DecidedByName || ''),
    DecisionNote: String(r.DecisionNote || ''), CreatedAt: isoString(r.CreatedAt), DecidedAt: isoString(r.DecidedAt)
  };
}

// What this person still handles: patients they own, open records and
// active reminders in their name.
function openWorkOf(world, email) {
  var e = lowerEmail(email);
  world.records.forEach(function (x) { if (lowerEmail(x.row.AgentEmail) === e) ensureHousehold(world, recordContactKey(x.row)); });
  var patients = world.patients.filter(function (p) { return p.OwnerStatus === PATIENT_OWNED && lowerEmail(p.OwnerEmail) === e; });
  var records = world.records.filter(function (x) { return x.row.Status === 'Pending' && lowerEmail(x.row.AgentEmail) === e; });
  var reminders = sheetToObjects(getSheetByName('Reminders')).filter(function (r) {
    return r.Status === 'Active' && lowerEmail(r.AgentEmail) === e;
  });
  return { patients: patients, records: records, reminders: reminders };
}

function hasOpenWork(work) { return work.patients.length > 0 || work.records.length > 0 || work.reminders.length > 0; }

// Moves all of `user`'s work to `successor`. Call inside the script lock.
function handOverWork(session, world, user, successor, why) {
  var work = openWorkOf(world, user.Email);
  var res = movePatients(session, world, work.patients, successor, why);
  var records = res.records.length;
  var e = lowerEmail(user.Email);

  // Open records whose patient isn't owned by them (e.g. an owner conflict
  // still waiting for an admin): move the records, leave the patient as is.
  world.records.forEach(function (x) {
    if (x.row.Status !== 'Pending' || lowerEmail(x.row.AgentEmail) !== e) return;
    var before = x.row;
    var patch = { AgentEmail: successor.email, AgentName: successor.name, UpdatedAt: nowIso() };
    x.row = updateObjectById(getSaleSheet(x.type), before.ID, patch);
    addActivity(session, x.type, before.ID, { Type: 'Note', Notes: 'Reassigned from ' + before.AgentName + ' to ' + successor.name + '. Reason: ' + why });
    audit(session, 'reassign', saleEntity(x.type), before.ID, saleChanges(before, patch), 'Reassigned from ' + before.AgentName + ' to ' + successor.name + '. Reason: ' + why);
    records++;
  });

  var reminders = res.reminders;
  var remSheet = getSheetByName('Reminders');
  sheetToObjects(remSheet).forEach(function (r) {
    if (r.Status !== 'Active' || lowerEmail(r.AgentEmail) !== e) return;
    var patch = { AgentEmail: successor.email, AgentName: successor.name, Reassigned: true, UpdatedAt: nowIso() };
    updateObjectById(remSheet, r.ID, patch);
    audit(session, 'reassign', 'Reminder', r.ID, auditDiff(r, patch), 'Refill reminder handed over to ' + successor.name + '. Reason: ' + why);
    reminders++;
  });
  savePatientChanges(world);
  return { patients: work.patients.length, records: records, reminders: reminders };
}

function findUserById(id) {
  return sheetToObjects(getUsersSheet()).find(function (u) { return String(u.ID) === String(id); }) || null;
}

// Manager (or admin): ask for an agent to be deactivated, naming who takes over.
function svc_requestDeactivation(session, data) {
  requireRole(session, ['admin', 'manager']);
  data = data || {};
  var user = findUserById(data.userId);
  if (!user || !isActive(user.Active)) throw new Error('User not found or already inactive.');
  if (String(user.ID) === String(session.id)) throw new Error('You cannot request your own deactivation.');
  if (user.Role === 'admin') throw new ForbiddenError('Admin accounts can only be deactivated by an admin on the Users page.');
  var why = cleanText(data.reason, 300);
  if (why.length < 3) throw new Error('Give a reason (at least 3 characters).');
  var world = loadPatientWorld();
  var successor = requireOwnerCandidate(world, data.successorEmail);
  if (lowerEmail(successor.email) === lowerEmail(user.Email)) throw new Error('Choose someone else to take over.');

  var sheet = getUserRequestsSheet();
  var pending = sheetToObjects(sheet).some(function (r) {
    return r.Status === 'Pending' && lowerEmail(r.UserEmail) === lowerEmail(user.Email);
  });
  if (pending) throw new Error('There is already a pending deactivation request for ' + user.Name + '.');

  var row = {
    ID: newId(), Type: 'deactivate', UserEmail: user.Email, UserName: user.Name,
    SuccessorEmail: successor.email, SuccessorName: successor.name, Reason: why,
    RequestedByEmail: session.email, RequestedByName: session.name, Status: 'Pending',
    DecidedByEmail: '', DecidedByName: '', DecisionNote: '', CreatedAt: nowIso(), DecidedAt: ''
  };
  appendObject(sheet, row);
  var work = openWorkOf(world, user.Email);
  audit(session, 'request_deactivation', 'User', user.ID, { Successor: { from: '', to: successor.email } },
    'Asked to deactivate ' + user.Email + ' (' + work.patients.length + ' patients, ' + work.records.length +
    ' open records) and hand over to ' + successor.name + '. Reason: ' + why);
  return userRequestForClient(row);
}

function svc_listUserRequests(session, includeDecided) {
  requireRole(session, ['admin', 'manager']);
  return sheetToObjects(getUserRequestsSheet())
    .filter(function (r) { return r.ID && (includeDecided || r.Status === 'Pending'); })
    .map(userRequestForClient)
    .sort(function (a, b) { return new Date(b.CreatedAt) - new Date(a.CreatedAt); });
}

// Admin: approve (hand over, then deactivate) or reject.
function svc_decideUserRequest(session, data) {
  requireRole(session, ['admin']);
  data = data || {};
  var sheet = getUserRequestsSheet();
  var req = sheetToObjects(sheet).find(function (r) { return String(r.ID) === String(data.id); });
  if (!req) throw new Error('Request not found.');
  if (req.Status !== 'Pending') throw new Error('This request was already decided.');
  var note = cleanText(data.note, 300);
  var approve = data.approve === true;
  var handover = null;

  if (approve) {
    var user = sheetToObjects(getUsersSheet()).find(function (u) { return lowerEmail(u.Email) === lowerEmail(req.UserEmail); });
    if (!user || !isActive(user.Active)) throw new Error('This account is already inactive. Reject the request instead.');
    var world = loadPatientWorld();
    var successor = requireOwnerCandidate(world, req.SuccessorEmail);
    handover = handOverWork(session, world, user, successor, 'Deactivation of ' + user.Name + ' approved.' + (note ? ' ' + note : ''));
    updateObjectById(getUsersSheet(), user.ID, { Active: false });
    audit(session, 'update', 'User', user.ID, { Active: { from: true, to: false } },
      'Deactivated ' + user.Email + '; ' + handover.patients + ' patients, ' + handover.records + ' open records and ' +
      handover.reminders + ' reminders handed to ' + successor.name);
  }
  var patch = {
    Status: approve ? 'Approved' : 'Rejected', DecidedByEmail: session.email, DecidedByName: session.name,
    DecisionNote: note, DecidedAt: nowIso()
  };
  var updated = updateObjectById(sheet, req.ID, patch);
  audit(session, approve ? 'approve_request' : 'reject_request', 'UserRequest', req.ID, auditDiff(req, patch),
    (approve ? 'Approved' : 'Rejected') + ' deactivation of ' + req.UserEmail + (note ? '. Note: ' + note : ''));
  return { request: userRequestForClient(updated), handover: handover };
}
