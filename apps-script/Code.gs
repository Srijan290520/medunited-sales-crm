// Code.gs — HTTP entry point / action router.
//
// Every request is a POST (form-encoded, so browsers send it without a CORS
// preflight) carrying:
//   action   which handler to run
//   token    the session token (all actions except login)
//   payload  a JSON object with that action's arguments
//
// Authorization happens inside the svc_* functions; this router only checks
// that a session exists, applies rate limits, refuses everything except a
// password change while a password change is required, and serializes every
// write behind the script lock so two people saving at once can't overwrite
// each other's rows.

var API_VERSION = '2.0.0';
var MAX_REQUEST_BYTES = 12 * 1024 * 1024; // two 5MB screenshots as base64 + form data

// GET is not used by the app. Rejecting it keeps passwords and tokens out of
// URLs (and therefore out of browser history and server logs).
function doGet() {
  return jsonResponse({ error: true, message: 'This endpoint only accepts POST requests from the CRM app.' });
}

function doPost(e) { return handleRequest(e); }

// Actions that change data. Each runs entirely inside the script lock.
var WRITE_ACTIONS = [
  'changePassword',
  'createSale', 'importSales', 'updateSale', 'deleteSale', 'reopenSale', 'reassignSale', 'logSaleActivity',
  'saveDashboardLayout', 'resetDashboardLayout', 'saveRoleDefaultLayout',
  'saveTargets', 'copyTargets', 'setTargetMeasure', 'updateHomekareCatalogue',
  'reassignPatient', 'bulkReassign', 'importReassignments', 'handoverAgent', 'migratePatients', 'resolvePatientConflict', 'decideMedpassDiscount', 'updateMedpassSettings',
  'createUser', 'updateUser', 'deleteUser', 'updateIncentives', 'requestDeactivation', 'decideUserRequest',
  'markContacted', 'reassignReminder',
  'updateLists', 'updateMonthlyTarget'
];

// Allowed while the user still has to replace an admin-set password.
var PASSWORD_CHANGE_ALLOWED = ['me', 'logout', 'changePassword'];

function handleRequest(e) {
  var params = (e && e.parameter) || {};
  var action = String(params.action || '');
  var result;

  try {
    var size = e && e.postData && e.postData.length;
    if (size && size > MAX_REQUEST_BYTES) throw new Error('Request is too large. Attach smaller screenshots (max 5MB each).');

    var payload = {};
    if (params.payload) {
      try { payload = JSON.parse(params.payload); } catch (err) { throw new Error('Malformed request.'); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Malformed request.');
    }

    if (WRITE_ACTIONS.indexOf(action) !== -1) {
      result = withScriptLock(function () { return dispatch(action, params.token, payload); });
      if (result && !result.error) bumpDataVersion(); // invalidate cached dashboards
    } else {
      result = dispatch(action, params.token, payload);
    }
  } catch (err) {
    result = errorResult(err, action);
  }

  return jsonResponse(result);
}

// Messages we throw ourselves are written for the user. Anything else
// (an Apps Script "Exception: …", a bug) is logged and replaced with a
// generic message, so internals never reach the browser.
function errorResult(err, action) {
  var name = err && err.name;
  var msg = String((err && err.message) || err || '');
  var internal = !msg || /^Exception:|is not defined|Cannot read prop|undefined|null is not|TypeError|ReferenceError|Service invoked too many times|Sheet not found/i.test(msg);
  if (internal) {
    console.error('Action ' + action + ' failed: ' + msg + (err && err.stack ? '\n' + err.stack : ''));
    msg = 'Something went wrong on the server. Please try again; if it keeps happening, tell your admin.';
  }
  return { error: true, message: msg, authError: name === 'AuthError', forbidden: name === 'ForbiddenError' };
}

function dispatch(action, token, p) {
  if (action === 'login') {
    checkRateLimit('login_' + cleanEmail(p.email));
    return login(p.email, p.password);
  }
  if (action === 'ping') return { error: false, version: API_VERSION };

  var session = requireSession(token);
  checkRateLimit('u_' + session.id);
  if (session.mustChangePassword && PASSWORD_CHANGE_ALLOWED.indexOf(action) === -1) {
    return { error: true, mustChangePassword: true, message: 'Please set a new password before continuing.' };
  }

  switch (action) {
    // ----- Session -----
    case 'logout':
      return logout(token);
    case 'me':
      return { error: false, user: publicSession(session) };
    case 'changePassword':
      return Object.assign({ error: false }, svc_changePassword(session, p.currentPassword, p.newPassword));

    // ----- Module records (Medpass, Pharmacy, …) -----
    case 'getModules':
      return { error: false, modules: svc_getModules(session) };
    case 'listSales':
      return { error: false, sales: svc_listSales(session, p.type) };
    case 'getSale':
      return Object.assign({ error: false }, svc_getSale(session, p.type, p.id));
    case 'createSale':
      return Object.assign({ error: false }, svc_createSale(session, p.type, p.data || {}));
    case 'importSales':
      return Object.assign({ error: false }, svc_importSales(session, p.type, p.rows, { dryRun: p.dryRun === true, agentEmail: p.agentEmail, fileName: p.fileName }));
    case 'updateSale':
      return Object.assign({ error: false }, svc_updateSale(session, p.type, p.id, p.data || {}));
    case 'deleteSale':
      return Object.assign({ error: false }, svc_deleteSale(session, p.type, p.id, p.reason));
    case 'reopenSale':
      return { error: false, sale: svc_reopenSale(session, p.type, p.id, p.reason) };
    case 'reassignSale':
      return Object.assign({ error: false }, svc_reassignSale(session, p.type, p.id, p.agentEmail, p.scope, p.reason));
    case 'reassignPatient':
      return Object.assign({ error: false }, svc_reassignPatient(session, p));
    case 'bulkReassign':
      return Object.assign({ error: false }, svc_bulkReassign(session, p));
    case 'importReassignments':
      return Object.assign({ error: false }, svc_importReassignments(session, p));
    case 'handoverAgent':
      return Object.assign({ error: false }, svc_handoverAgent(session, p));

    // ----- Medpass (price, discounts) -----
    case 'getMedpassSettings':
      return { error: false, settings: svc_getMedpassSettings(session) };
    case 'updateMedpassSettings':
      return { error: false, settings: svc_updateMedpassSettings(session, p.data || {}) };
    case 'listPendingDiscounts':
      return { error: false, discounts: svc_listPendingDiscounts(session) };
    case 'decideMedpassDiscount':
      return { error: false, sale: svc_decideMedpassDiscount(session, p) };

    // ----- Patients (owners, migration, conflicts) -----
    case 'migratePatients':
      return { error: false, migration: svc_migratePatients(session, p.dryRun) };
    case 'listPatientConflicts':
      return { error: false, conflicts: svc_listPatientConflicts(session) };
    case 'resolvePatientConflict':
      return Object.assign({ error: false }, svc_resolvePatientConflict(session, p));
    case 'logSaleActivity':
      return Object.assign({ error: false }, svc_logSaleActivity(session, p.type, p.id, p.data || {}));
    case 'getAuditHistory':
      return { error: false, auditHistory: svc_getAuditHistory(session, p.type, p.id) };
    case 'checkContact':
      return Object.assign({ error: false }, svc_checkContact(session, p.contact, p.exceptId));
    case 'getAttachment':
      return { error: false, attachment: svc_getAttachment(session, p.type, p.id, p.kind) };

    // ----- Targets, incentives, audit log -----
    case 'getTargets':
      return Object.assign({ error: false }, svc_getTargets(session, p.month));
    case 'saveTargets':
      return Object.assign({ error: false }, svc_saveTargets(session, p));
    case 'copyTargets':
      return Object.assign({ error: false }, svc_copyTargets(session, p));
    case 'setTargetMeasure':
      return { error: false, measures: svc_setTargetMeasure(session, p) };
    case 'performance':
      return { error: false, performance: svc_performance(session, p) };
    case 'incentiveReport':
      return { error: false, report: svc_incentiveReport(session, p.month) };
    case 'listAuditLog':
      return Object.assign({ error: false }, svc_listAuditLog(session, p));
    case 'updateHomekareCatalogue':
      return { error: false, services: svc_updateHomekareCatalogue(session, p) };

    // ----- Dashboard -----
    case 'getDashboardLayout':
      return Object.assign({ error: false }, svc_getDashboardLayout(session));
    case 'saveDashboardLayout':
      return Object.assign({ error: false }, svc_saveDashboardLayout(session, p.layout));
    case 'resetDashboardLayout':
      return Object.assign({ error: false }, svc_resetDashboardLayout(session));
    case 'saveRoleDefaultLayout':
      return { error: false, layout: svc_saveRoleDefaultLayout(session, p.group, p.layout) };
    case 'dashboardSummary':
      return { error: false, summary: svc_dashboardSummary(session) };

    // ----- Users & incentives -----
    case 'listUsers':
      return { error: false, users: svc_listUsers(session) };
    case 'createUser':
      return { error: false, user: svc_createUser(session, p.data || {}) };
    case 'updateUser':
      return { error: false, user: svc_updateUser(session, p.id, p.data || {}) };
    case 'deleteUser':
      return Object.assign({ error: false }, svc_deleteUser(session, p.id, p.reason));
    case 'requestDeactivation':
      return { error: false, request: svc_requestDeactivation(session, p) };
    case 'listUserRequests':
      return { error: false, requests: svc_listUserRequests(session, p.includeDecided === true) };
    case 'decideUserRequest':
      return Object.assign({ error: false }, svc_decideUserRequest(session, p));
    case 'updateIncentives':
      return { error: false, user: svc_updateIncentives(session, p.id, p.data || {}) };

    // ----- Refill reminders -----
    case 'listReminders':
      return { error: false, reminders: svc_listReminders(session, p.includeResolved === true) };
    case 'markContacted':
      return { error: false, reminder: svc_markContacted(session, p.id, p.outcome) };
    case 'reassignReminder':
      return { error: false, reminder: svc_reassignReminder(session, p.id, p.agentEmail) };

    // ----- Settings -----
    case 'getLists':
      return { error: false, lists: svc_getLists(session) };
    case 'updateLists':
      return { error: false, lists: svc_updateLists(session, p.data || {}) };
    case 'getMonthlyTarget':
      return { error: false, target: svc_getMonthlyTarget(session) };
    case 'updateMonthlyTarget':
      return { error: false, target: svc_updateMonthlyTarget(session, p.amount) };

    default:
      return { error: true, message: 'Unknown action.' };
  }
}
