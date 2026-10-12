// Code.gs — HTTP entry point / action router.
//
// Every request is a POST carrying an `action` and, except for `login`, a
// session `token`. All authorization checks happen inside the svc_*
// functions in SalesService.gs / UserService.gs — this router just
// dispatches, and serializes every write behind a script lock so two people
// saving at the same moment can't overwrite each other's rows.

// GET is not used by the app. Rejecting it keeps passwords and tokens out of
// URLs (and therefore out of browser history and server logs).
function doGet() {
  return jsonResponse({ error: true, message: 'This endpoint only accepts POST requests from the CRM app.' });
}

function doPost(e) { return handleRequest(e); }

// Actions that change data. Each one runs entirely inside the script lock,
// so its read-modify-write of the sheet can't interleave with another.
var WRITE_ACTIONS = [
  'createSale', 'updateSale', 'deleteSale',
  'createUser', 'updateUser', 'updateIncentives',
  'markContacted', 'reassignReminder',
  'createLead', 'updateLead', 'logActivity', 'reassignLead', 'updateLists'
];

function handleRequest(e) {
  var params = (e && e.parameter) || {};
  var action = params.action;
  var result;

  try {
    if (WRITE_ACTIONS.indexOf(action) !== -1) {
      result = withScriptLock(function () { return dispatch(action, params); });
      // Data changed — invalidate cached dashboard summaries.
      if (result && !result.error) bumpDataVersion();
    } else {
      result = dispatch(action, params);
    }
  } catch (err) {
    result = { error: true, message: err.message || String(err), authError: err.name === 'AuthError' };
  }

  return jsonResponse(result);
}

function dispatch(action, params) {
  var token = params.token;
  var data = params.data ? JSON.parse(params.data) : {};

  switch (action) {
    case 'login':
      return login(params.email || data.email, params.password || data.password);

    case 'logout':
      return logout(token);

    case 'me':
      return { error: false, user: publicSession(requireSession(token)) };

    case 'listSales':
      return { error: false, sales: svc_listSales(requireSession(token), params.type) };

    case 'createSale':
      return { error: false, sale: svc_createSale(requireSession(token), params.type, data) };

    case 'updateSale':
      return { error: false, sale: svc_updateSale(requireSession(token), params.type, params.id, data) };

    case 'deleteSale':
      var deleted = svc_deleteSale(requireSession(token), params.type, params.id);
      deleted.error = false;
      return deleted;

    case 'getAttachment':
      return { error: false, attachment: svc_getAttachment(requireSession(token), params.type, params.id, params.kind) };

    case 'dashboardSummary':
      return { error: false, summary: svc_dashboardSummary(requireSession(token)) };

    case 'listUsers':
      return { error: false, users: svc_listUsers(requireSession(token)) };

    case 'createUser':
      return { error: false, user: svc_createUser(requireSession(token), data) };

    case 'updateUser':
      return { error: false, user: svc_updateUser(requireSession(token), params.id, data) };

    case 'updateIncentives':
      return { error: false, user: svc_updateIncentives(requireSession(token), params.id, data) };

    case 'listReminders':
      return { error: false, reminders: svc_listReminders(requireSession(token), params.includeResolved === 'true') };

    case 'markContacted':
      return { error: false, reminder: svc_markContacted(requireSession(token), params.id, data.outcome) };

    case 'reassignReminder':
      return { error: false, reminder: svc_reassignReminder(requireSession(token), params.id, data.agentEmail) };

    case 'listLeads':
      return { error: false, leads: svc_listLeads(requireSession(token)) };

    case 'getLead':
      return Object.assign({ error: false }, svc_getLead(requireSession(token), params.id));

    case 'checkContact':
      return Object.assign({ error: false }, svc_checkContact(requireSession(token), params.contact, params.exceptId));

    case 'createLead':
      return { error: false, lead: svc_createLead(requireSession(token), data) };

    case 'updateLead':
      return Object.assign({ error: false }, svc_updateLead(requireSession(token), params.id, data));

    case 'logActivity':
      return Object.assign({ error: false }, svc_logActivity(requireSession(token), params.id, data));

    case 'reassignLead':
      return Object.assign({ error: false }, svc_reassignLead(requireSession(token), params.id, data.agentEmail));

    case 'getLists':
      return { error: false, lists: svc_getLists(requireSession(token)) };

    case 'updateLists':
      return { error: false, lists: svc_updateLists(requireSession(token), data) };

    default:
      return { error: true, message: 'Unknown action: ' + action };
  }
}
