// Code.gs — HTTP entry point / action router.
//
// Every request carries an `action` and, except for `login`, a session
// `token`. All authorization checks happen inside the svc_* functions in
// SalesService.gs / UserService.gs — this router just dispatches.

function doGet(e) { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  var params = (e && e.parameter) || {};
  var callback = params.callback || null;
  var action = params.action;
  var token = params.token;
  var result;

  try {
    var data = params.data ? JSON.parse(params.data) : {};

    switch (action) {
      case 'login':
        result = login(params.email || data.email, params.password || data.password);
        break;

      case 'logout':
        result = logout(token);
        break;

      case 'me':
        result = { error: false, user: requireSession(token) };
        break;

      case 'listSales':
        result = { error: false, sales: svc_listSales(requireSession(token), params.type) };
        break;

      case 'createSale':
        result = { error: false, sale: svc_createSale(requireSession(token), params.type, data) };
        break;

      case 'updateSale':
        result = { error: false, sale: svc_updateSale(requireSession(token), params.type, params.id, data) };
        break;

      case 'deleteSale':
        result = svc_deleteSale(requireSession(token), params.type, params.id);
        result.error = false;
        break;

      case 'dashboardSummary':
        result = { error: false, summary: svc_dashboardSummary(requireSession(token)) };
        break;

      case 'listUsers':
        result = { error: false, users: svc_listUsers(requireSession(token)) };
        break;

      case 'createUser':
        result = { error: false, user: svc_createUser(requireSession(token), data) };
        break;

      case 'updateUser':
        result = { error: false, user: svc_updateUser(requireSession(token), params.id, data) };
        break;

      case 'updateIncentives':
        result = { error: false, user: svc_updateIncentives(requireSession(token), params.id, data) };
        break;

      case 'listReminders':
        result = { error: false, reminders: svc_listReminders(requireSession(token), params.includeResolved === 'true') };
        break;

      case 'markContacted':
        result = { error: false, reminder: svc_markContacted(requireSession(token), params.id, data.outcome) };
        break;

      case 'reassignReminder':
        result = { error: false, reminder: svc_reassignReminder(requireSession(token), params.id, data.agentEmail) };
        break;

      default:
        result = { error: true, message: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: true, message: err.message || String(err), authError: err.name === 'AuthError' };
  }

  return jsonResponse(result, callback);
}
