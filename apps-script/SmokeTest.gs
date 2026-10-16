// SmokeTest.gs — read-only health check for the v2 backend.
// Run smokeTestV2 from the editor after setup or a deploy and read the log.
// It saves nothing: the import is a dry run and the admin session it opens
// lives only in the cache and is logged out at the end.
function smokeTestV2() {
  var out = [];
  function call(action, token, payload) {
    var e = { parameter: { action: action }, postData: { length: 10 } };
    if (token) e.parameter.token = token;
    if (payload) e.parameter.payload = JSON.stringify(payload);
    return JSON.parse(doPost(e).getContent());
  }
  function check(name, ok, detail) { out.push((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : '')); }
  var r = call('ping');
  check('ping returns v' + API_VERSION, r.version === API_VERSION, JSON.stringify(r));
  r = call('login', null, { email: 'nobody-' + Date.now() + '@example.com', password: 'Wrong-Pass-123' });
  check('login rejects unknown user', r.error === true && r.message === 'Invalid email or password.', r.message);
  r = call('listSales', 'bogus-token', { type: 'medpass' });
  check('bad token rejected', r.authError === true, r.message);
  r = JSON.parse(doGet().getContent());
  check('GET refused', r.error === true);
  moduleIds().forEach(function (t) {
    var n = SALE_TYPES[t];
    var h = sheetHeaders(getSheetByName(n));
    var miss = moduleHeaders(t).filter(function (x) { return h.indexOf(x) === -1; });
    check(n + ' has all its columns', miss.length === 0, miss.join(','));
  });
  ['SaleActivities', 'Settings', 'Lists', 'AuditLog', 'Reminders', 'Users', 'Patients', 'UserRequests', 'UserLayouts', 'Targets'].forEach(function (n) {
    check('tab ' + n + ' exists', !!getSpreadsheet().getSheetByName(n));
  });
  var admin = sheetToObjects(getSheetByName('Users')).filter(function (u) {
    return u.Role === 'admin' && isActive(u.Active) && !asBool(u.MustChangePassword);
  })[0];
  check('usable admin account exists', !!admin, admin ? admin.Email : 'none');
  if (admin) {
    var s = startSession(admin); // temporary session in the cache only; logged out below
    ['medpass', 'pharmacy'].forEach(function (t) {
      r = call('listSales', s.token, { type: t });
      check('listSales ' + t, !r.error, r.error ? r.message : r.sales.length + ' records');
    });
    r = call('dashboardSummary', s.token);
    check('dashboard', !r.error, r.error ? r.message : 'month revenue ' + r.summary.monthlyTarget.currentAmount + ' of ' + r.summary.monthlyTarget.targetAmount);
    r = call('listReminders', s.token, { includeResolved: true });
    check('reminders', !r.error, r.error ? r.message : r.reminders.length + ' reminders');
    r = call('listUsers', s.token);
    check('listUsers hides hashes', !r.error && r.users.every(function (u) { return u.PasswordHash === undefined && u.Salt === undefined; }), r.error ? r.message : r.users.length + ' users');
    r = call('getLists', s.token);
    check('dropdown lists', !r.error, r.error ? r.message : r.lists.channels.length + ' channels');
    r = call('importSales', s.token, { type: 'medpass', dryRun: true, rows: [{ customerName: 'Smoke Test', contact: '9000000000' }] });
    check('import preview (nothing saved)', !r.error && r.imported === 0, r.error ? r.message : r.valid + ' valid row');
    try { DriveApp.getFoldersByName(ATTACHMENTS_FOLDER_NAME).hasNext(); check('Drive access', true); } catch (e) { check('Drive access', false, e.message); }
    call('logout', s.token);
  }
  Logger.log(out.join('\n'));
  return out;
}
