// End-to-end tests for the Apps Script backend, run under Node with mocked
// Google services:  npm run test:backend
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadBackend } = require('./gas-mock.cjs');

const PNG = 'data:image/png;base64,' + Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1),
]).toString('base64');

function boot() {
  const env = loadBackend(path.join(__dirname, '..', '..', 'apps-script'));
  const { ctx } = env;
  function call(action, token, payload) {
    const params = { action };
    if (token) params.token = token;
    if (payload !== undefined) params.payload = JSON.stringify(payload);
    const out = ctx.doPost({ parameter: params, postData: { length: JSON.stringify(params).length } });
    return JSON.parse(out.getContent());
  }
  env.props.set('ADMIN_EMAIL', 'boss@medunited.in');
  env.props.set('ADMIN_PASSWORD', 'Temp0rary-Pass');
  ctx.setupSpreadsheet();
  ctx.createFirstAdmin();
  return { ...env, call };
}

function ok(res, label) {
  assert.equal(res.error, false, `${label || 'call'} failed: ${res.message}`);
  return res;
}

function loginFresh(call, email, temp, finalPw) {
  let r = ok(call('login', null, { email, password: temp }), 'login ' + email);
  if (r.user.mustChangePassword) {
    r = ok(call('changePassword', r.token, { currentPassword: temp, newPassword: finalPw }), 'changePassword ' + email);
  }
  return r.token;
}

function world() {
  const env = boot();
  const { call } = env;
  const admin = loginFresh(call, 'boss@medunited.in', 'Temp0rary-Pass', 'Adm1n-Secure-2026');
  for (const [name, email, role] of [
    ['Meera Manager', 'meera@medunited.in', 'manager'],
    ['Arjun Agent', 'arjun@medunited.in', 'agent'],
    ['Divya Agent', 'divya@medunited.in', 'agent'],
  ]) {
    ok(call('createUser', admin, { data: { name, email, role, password: 'Joining2Team9' } }), 'createUser ' + email);
  }
  const manager = loginFresh(call, 'meera@medunited.in', 'Joining2Team9', 'Blue-Kite-2026');
  const arjun = loginFresh(call, 'arjun@medunited.in', 'Joining2Team9', 'Green-Lamp-2026');
  const divya = loginFresh(call, 'divya@medunited.in', 'Joining2Team9', 'Red-River-2026');
  return { ...env, admin, manager, arjun, divya };
}

const lead = (over = {}) => ({
  customerName: 'Ravi Kumar', contact: '+91 98480 12345', priceType: 'Full Price', amount: '', status: 'Pending',
  temperature: 'Warm', direction: 'Inbound', channel: 'Phone call', heardFrom: 'Google search', consent: true,
  doNotCall: false, nextFollowUp: '', notes: 'Asked about family plan', ...over,
});

test('first admin must change the setup password, and the password property is removed', () => {
  const { call, props } = boot();
  assert.equal(props.has('ADMIN_PASSWORD'), false);
  const r = ok(call('login', null, { email: 'boss@medunited.in', password: 'Temp0rary-Pass' }));
  assert.equal(r.user.mustChangePassword, true);
  const blocked = call('listSales', r.token, { type: 'medpass' });
  assert.equal(blocked.error, true);
  assert.equal(blocked.mustChangePassword, true);
  const weak = call('changePassword', r.token, { currentPassword: 'Temp0rary-Pass', newPassword: 'short' });
  assert.equal(weak.error, true);
  const changed = ok(call('changePassword', r.token, { currentPassword: 'Temp0rary-Pass', newPassword: 'Brand-New-Pass1' }));
  assert.equal(changed.user.mustChangePassword, false);
  assert.equal(call('me', r.token).authError, true, 'old token must die after password change');
  ok(call('listSales', changed.token, { type: 'medpass' }));
});

test('login: wrong password, lockout after 5 failures, no user enumeration', () => {
  const { call } = boot();
  const a = call('login', null, { email: 'nobody@x.com', password: 'whatever123' });
  const b = call('login', null, { email: 'boss@medunited.in', password: 'wrong-pass-1' });
  assert.equal(a.message, b.message);
  for (let i = 0; i < 4; i++) call('login', null, { email: 'boss@medunited.in', password: 'wrong-pass-1' });
  const locked = call('login', null, { email: 'boss@medunited.in', password: 'Temp0rary-Pass' });
  assert.equal(locked.error, true);
  assert.match(locked.message, /Too many failed attempts/);
});

test('agents see only their own records; duplicates are blocked across modules', () => {
  const { call, arjun, divya, manager } = world();
  const created = ok(call('createSale', arjun, { type: 'medpass', data: lead() })).sale;
  assert.equal(created.AgentName, 'Arjun Agent');
  assert.equal(created.Status, 'Pending');
  assert.equal(created.ContactKey, '9848012345');

  assert.equal(ok(call('listSales', divya, { type: 'medpass' })).sales.length, 0);
  assert.equal(ok(call('listSales', manager, { type: 'medpass' })).sales.length, 1);
  assert.equal(call('getSale', divya, { type: 'medpass', id: created.ID }).error, true);

  const dup = call('createSale', divya, { type: 'pharmacy', data: { ...lead({ contact: '098480-12345' }), products: [{ name: 'Metformin', quantity: 60, frequency: 'Twice a day' }] } });
  assert.equal(dup.error, true);
  assert.match(dup.message, /already has an open Medpass record/);
  assert.doesNotMatch(dup.message, /Ravi/, 'another agent must not learn the customer name');

  const check = ok(call('checkContact', divya, { contact: '9848012345' }));
  assert.equal(check.activeSales.length, 1);
  assert.equal(check.activeSales[0].ID, '');
  assert.equal(check.activeSales[0].Mine, false);
});

test('agents cannot assign records to someone else', () => {
  const { call, arjun, manager } = world();
  const s = ok(call('createSale', arjun, { type: 'medpass', data: lead({ agentEmail: 'divya@medunited.in' }) })).sale;
  assert.equal(s.AgentEmail, 'arjun@medunited.in');
  const m = ok(call('createSale', manager, { type: 'medpass', data: lead({ contact: '9000000001', agentEmail: 'divya@medunited.in' }) })).sale;
  assert.equal(m.AgentEmail, 'divya@medunited.in');
});

test('completing a sale needs payment method, both proofs, UTR for UPI and an amount', () => {
  const { call, arjun } = world();
  const s = ok(call('createSale', arjun, { type: 'medpass', data: lead() })).sale;
  const upd = (data) => call('updateSale', arjun, { type: 'medpass', id: s.ID, data });
  assert.match(upd({ status: 'Completed' }).message, /Payment method/);
  assert.match(upd({ status: 'Completed', paymentMethod: 'UPI' }).message, /bill screenshot/);
  assert.match(upd({ status: 'Completed', paymentMethod: 'UPI', billScreenshot: PNG }).message, /payment screenshot/);
  assert.match(upd({ status: 'Completed', paymentMethod: 'UPI', billScreenshot: PNG, paymentScreenshot: PNG }).message, /UTR/);
  assert.match(upd({ status: 'Completed', paymentMethod: 'UPI', utr: 'UTR123', billScreenshot: PNG, paymentScreenshot: PNG }).message, /amount/);
  const done = ok(upd({ status: 'Completed', paymentMethod: 'UPI', utr: 'UTR123', amount: 4999, billScreenshot: PNG, paymentScreenshot: PNG })).sale;
  assert.equal(done.Status, 'Completed');
  assert.equal(done.BillScreenshotUrl, 'attached', 'Drive links must never reach the browser');
});

test('fake images and oversized uploads are rejected', () => {
  const { call, arjun } = world();
  const fake = 'data:image/png;base64,' + Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
  const r = call('createSale', arjun, { type: 'medpass', data: lead({ billScreenshot: fake }) });
  assert.equal(r.error, true);
  assert.match(r.message, /not a valid image/);
  const pdf = call('createSale', arjun, { type: 'medpass', data: lead({ billScreenshot: 'data:application/pdf;base64,JVBERi0=' }) });
  assert.match(pdf.message, /Only image files/);
  const url = call('createSale', arjun, { type: 'medpass', data: lead({ billScreenshot: 'https://evil.example/x.png' }) });
  assert.match(url.message, /uploaded as image files/);
});

test('completed sales are locked for agents except medicines and notes', () => {
  const { call, arjun, manager } = world();
  const products = [{ name: 'Metformin 500', quantity: 60, frequency: 'Twice a day', unitsPerDose: 1, formType: 'tablet' }];
  const s = ok(call('createSale', arjun, { type: 'pharmacy', data: { ...lead(), products, status: 'Completed', paymentMethod: 'Cash', amount: 1200, billScreenshot: PNG, paymentScreenshot: PNG } })).sale;
  // The form re-sends every field (with 'attached' for screenshots): unchanged values must not trip the lock.
  const resend = { ...lead(), products, status: 'Completed', paymentMethod: 'Cash', amount: 1200, billScreenshot: 'attached', paymentScreenshot: 'attached', notes: 'Delivered' };
  ok(call('updateSale', arjun, { type: 'pharmacy', id: s.ID, data: resend }), 'resend with notes change');
  const amt = call('updateSale', arjun, { type: 'pharmacy', id: s.ID, data: { amount: 1 } });
  assert.equal(amt.forbidden, true);
  const st = call('updateSale', arjun, { type: 'pharmacy', id: s.ID, data: { status: 'Pending' } });
  assert.equal(st.forbidden, true);
  ok(call('updateSale', arjun, { type: 'pharmacy', id: s.ID, data: { products: [{ ...products[0], quantity: 90 }] } }), 'meds edit');
  ok(call('updateSale', manager, { type: 'pharmacy', id: s.ID, data: { amount: 1300 } }), 'manager edit');
});

test('activity log drives the pipeline: lost, reopened, Do Not Call', () => {
  const { call, arjun } = world();
  const s = ok(call('createSale', arjun, { type: 'medpass', data: lead() })).sale;
  const log = (data) => call('logSaleActivity', arjun, { type: 'medpass', id: s.ID, data });

  let r = ok(log({ type: 'Call', direction: 'Outgoing', outcome: 'No answer', nextFollowUp: '2030-01-05' }));
  assert.equal(r.sale.AttemptCount, 1);
  assert.equal(r.sale.NextFollowUp, '2030-01-05');
  r = ok(log({ type: 'Call', direction: 'Outgoing', outcome: 'Interested' }));
  assert.equal(r.sale.Temperature, 'Hot');
  r = ok(log({ type: 'Call', direction: 'Outgoing', outcome: 'Not interested' }));
  assert.equal(r.sale.Status, 'Cancelled');
  assert.equal(r.sale.LostReason, 'Not interested');
  r = ok(log({ type: 'WhatsApp', direction: 'Incoming', outcome: 'Connected', notes: 'Wants to buy now' }));
  assert.equal(r.sale.Status, 'Pending');
  assert.equal(r.sale.Temperature, 'Hot');
  assert.ok(r.auditHistory.some((a) => a.Action === 'reopen'));
  assert.equal(r.activities.length, 4);

  ok(call('updateSale', arjun, { type: 'medpass', id: s.ID, data: { doNotCall: true } }));
  const dnd = log({ type: 'Call', direction: 'Outgoing', outcome: 'Connected' });
  assert.equal(dnd.error, true);
  assert.match(dnd.message, /Do Not Call/);
  ok(log({ type: 'Call', direction: 'Incoming', outcome: 'Connected' }), 'incoming allowed on DND');
  assert.equal(log({ type: 'Note', notes: '' }).error, true);
});

test('cancel needs a lost reason from the list; reopen rules', () => {
  const { call, arjun, manager } = world();
  const s = ok(call('createSale', arjun, { type: 'medpass', data: lead() })).sale;
  assert.match(call('updateSale', arjun, { type: 'medpass', id: s.ID, data: { status: 'Cancelled', lostReason: 'made up' } }).message, /Lost reason/);
  ok(call('updateSale', arjun, { type: 'medpass', id: s.ID, data: { status: 'Cancelled', lostReason: 'Price too high' } }));
  const re = ok(call('reopenSale', arjun, { type: 'medpass', id: s.ID })).sale;
  assert.equal(re.Status, 'Pending');
  assert.equal(re.Temperature, 'Hot');
  assert.equal(re.LostReason, '');

  ok(call('updateSale', manager, { type: 'medpass', id: s.ID, data: { status: 'Completed', paymentMethod: 'Cash', amount: 999, billScreenshot: PNG, paymentScreenshot: PNG } }));
  assert.equal(call('reopenSale', arjun, { type: 'medpass', id: s.ID, reason: 'oops' }).forbidden, true);
  assert.match(call('reopenSale', manager, { type: 'medpass', id: s.ID }).message, /reason/);
  ok(call('reopenSale', manager, { type: 'medpass', id: s.ID, reason: 'Payment bounced' }));
});

test('pharmacy refill reminders follow completed sales, including syrups', () => {
  const { call, arjun, divya, manager } = world();
  const products = [
    { name: 'Amlodipine 5mg', quantity: 30, frequency: 'Once a day', unitsPerDose: 1, formType: 'tablet' },
    { name: 'Cough Syrup', quantity: 100, frequency: 'Thrice a day', unitsPerDose: 5, formType: 'syrup', bottleVolume: 100, bottlesCount: 1 },
  ];
  const s = ok(call('createSale', arjun, { type: 'pharmacy', data: { ...lead(), products, status: 'Completed', paymentMethod: 'Card', amount: 640, billScreenshot: PNG, paymentScreenshot: PNG } })).sale;
  assert.match(s.Detail, /100ml total/);
  const rems = ok(call('listReminders', arjun, { includeResolved: false })).reminders;
  assert.equal(rems.length, 1);
  const syrup = rems[0].Products.find((p) => p.formType === 'syrup');
  assert.equal(syrup.daysSupply, 6); // 100ml / (5ml x 3)
  assert.equal(rems[0].DaysRemaining, 6);
  assert.equal(ok(call('listReminders', divya, { includeResolved: false })).reminders.length, 0);
  assert.equal(call('markContacted', divya, { id: rems[0].ID, outcome: 'could_not_connect' }).forbidden, true);
  ok(call('markContacted', arjun, { id: rems[0].ID, outcome: 'could_not_connect' }));
  ok(call('reassignReminder', manager, { id: rems[0].ID, agentEmail: 'divya@medunited.in' }));
  assert.equal(ok(call('listReminders', divya, { includeResolved: false })).reminders.length, 1);
  const bad = call('createSale', arjun, { type: 'pharmacy', data: { ...lead({ contact: '9111111111' }), products: [{ name: 'X', quantity: -1, frequency: 'Once a day' }] } });
  assert.equal(bad.error, true);
});

test('reassign and delete permissions; deletions are audited with a reason', () => {
  const { call, arjun, divya, manager, admin, sheets } = world();
  const s = ok(call('createSale', arjun, { type: 'medpass', data: lead() })).sale;
  assert.equal(call('reassignSale', arjun, { type: 'medpass', id: s.ID, agentEmail: 'divya@medunited.in' }).forbidden, true);
  ok(call('reassignSale', manager, { type: 'medpass', id: s.ID, agentEmail: 'divya@medunited.in' }));
  assert.equal(ok(call('listSales', divya, { type: 'medpass' })).sales.length, 1);
  assert.equal(ok(call('listSales', arjun, { type: 'medpass' })).sales.length, 0);

  assert.equal(call('deleteSale', manager, { type: 'medpass', id: s.ID, reason: 'dup' }).forbidden, true);
  assert.match(call('deleteSale', admin, { type: 'medpass', id: s.ID, reason: '' }).message, /reason/);
  ok(call('deleteSale', admin, { type: 'medpass', id: s.ID, reason: 'Duplicate entry' }));
  assert.equal(ok(call('listSales', admin, { type: 'medpass' })).sales.length, 0);
  const log = sheets.get('AuditLog');
  assert.ok(log.protected, 'audit log tab is protected');
  const lastSummary = log.getRange(log.getLastRow(), 9).getValues()[0][0];
  assert.match(lastSummary, /Reason: Duplicate entry/);
});

test('spreadsheet formula injection is neutralised and dates read back as plain days', () => {
  const { call, arjun, sheets } = world();
  const s = ok(call('createSale', arjun, { type: 'medpass', data: lead({ customerName: '=IMPORTXML("http://x","//a")', notes: '+cmd|calc', date: '2026-10-12' }) })).sale;
  const row = sheets.get('Medpass').rows[1];
  assert.equal(row[4], '=IMPORTXML("http://x","//a")'); // stored as text, not a formula
  const back = ok(call('getSale', arjun, { type: 'medpass', id: s.ID })).sale;
  assert.equal(back.CustomerName, '=IMPORTXML("http://x","//a")');
  assert.equal(back.Date, '2026-10-12');
});

test('dashboard: incentives hidden from agents, monthly target uses this month only', () => {
  const { call, arjun, manager, admin } = world();
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  ok(call('updateIncentives', manager, { id: findUser(call, admin, 'arjun@medunited.in').ID, data: { medpassFullRate: 500, medpassDiscountRate: 300, pharmacyIncentivePercent: 5 } }));
  const done = { status: 'Completed', paymentMethod: 'Cash', billScreenshot: PNG, paymentScreenshot: PNG };
  ok(call('createSale', arjun, { type: 'medpass', data: lead({ ...done, amount: 10000, date: today }) }));
  ok(call('createSale', arjun, { type: 'medpass', data: lead({ ...done, contact: '9000000002', amount: 7000, priceType: 'Discounted', date: '2020-01-15' }) }));
  ok(call('createSale', arjun, { type: 'medpass', data: lead({ contact: '9000000003', nextFollowUp: today }) }));
  ok(call('updateMonthlyTarget', manager, { amount: 20000 }));
  assert.equal(call('updateMonthlyTarget', arjun, { amount: 1 }).forbidden, true);

  const team = ok(call('dashboardSummary', manager)).summary;
  assert.equal(team.agents[0].incentive, 800);
  assert.equal(team.monthlyTarget.currentAmount, 10000);
  assert.equal(team.monthlyTarget.percentage, 50);
  assert.equal(team.pipeline.totalLeads, 3);
  assert.equal(team.urgentFollowUps.length, 1);
  assert.equal(team.urgentFollowUps[0].followUpStatus, 'today');

  const mine = ok(call('dashboardSummary', arjun)).summary;
  assert.equal(mine.agents[0].incentive, undefined);
});

function findUser(call, admin, email) {
  return ok(call('listUsers', admin)).users.find((u) => u.Email === email);
}

test('user management: roles, weak passwords, last admin, delete rules, session revocation', () => {
  const { call, admin, arjun, manager } = world();
  assert.equal(call('listUsers', arjun).forbidden, true);
  assert.equal(call('createUser', manager, { data: { name: 'X', email: 'x@y.in', role: 'agent', password: 'Joining2Team9' } }).forbidden, true);
  assert.match(call('createUser', admin, { data: { name: 'X', email: 'x@y.in', role: 'agent', password: 'password' } }).message, /at least 10/);
  assert.match(call('createUser', admin, { data: { name: 'X', email: 'x@y.in', role: 'superuser', password: 'Joining2Team9' } }).message, /Role/);
  const users = ok(call('listUsers', admin)).users;
  assert.ok(users.every((u) => u.PasswordHash === undefined && u.Salt === undefined));

  const boss = users.find((u) => u.Email === 'boss@medunited.in');
  assert.match(call('updateUser', admin, { id: boss.ID, data: { role: 'agent' } }).message, /only active admin/);
  assert.match(call('deleteUser', admin, { id: boss.ID, reason: 'test' }).message, /own account/);

  const arjunUser = users.find((u) => u.Email === 'arjun@medunited.in');
  ok(call('createSale', arjun, { type: 'medpass', data: lead() }));
  assert.match(call('deleteUser', admin, { id: arjunUser.ID, reason: 'left' }).message, /Deactivate/);

  ok(call('updateUser', admin, { id: arjunUser.ID, data: { active: false } }));
  assert.equal(call('listSales', arjun, { type: 'medpass' }).authError, true, 'deactivation ends the session');

  const meera = users.find((u) => u.Email === 'meera@medunited.in');
  ok(call('updateUser', admin, { id: meera.ID, data: { password: 'Reset-Pass-99' } }));
  assert.equal(call('me', manager).authError, true, 'admin password reset ends the session');
  const again = ok(call('login', null, { email: 'meera@medunited.in', password: 'Reset-Pass-99' }));
  assert.equal(again.user.mustChangePassword, true);
});

test('attachments are only served to people who can see the record', () => {
  const { call, arjun, divya, manager } = world();
  const s = ok(call('createSale', arjun, { type: 'medpass', data: lead({ billScreenshot: PNG }) })).sale;
  const mine = ok(call('getAttachment', arjun, { type: 'medpass', id: s.ID, kind: 'bill' }));
  assert.match(mine.attachment.dataUrl, /^data:image\/png;base64,/);
  ok(call('getAttachment', manager, { type: 'medpass', id: s.ID, kind: 'bill' }));
  assert.equal(call('getAttachment', divya, { type: 'medpass', id: s.ID, kind: 'bill' }).error, true);
  assert.equal(call('getAttachment', arjun, { type: 'medpass', id: s.ID, kind: 'payment' }).error, true);
});

test('logout, bad tokens, unknown actions, malformed payloads, GET', () => {
  const { call, ctx, arjun } = world();
  assert.equal(call('listSales', 'not-a-token', { type: 'medpass' }).authError, true);
  assert.equal(call('nope', arjun).message, 'Unknown action.');
  const malformed = JSON.parse(ctx.doPost({ parameter: { action: 'listSales', token: arjun, payload: '{oops' } }).getContent());
  assert.equal(malformed.message, 'Malformed request.');
  assert.equal(call('listSales', arjun, { type: 'evil' }).error, true);
  assert.match(JSON.parse(ctx.doGet().getContent()).message, /only accepts POST/);
  ok(call('logout', arjun));
  assert.equal(call('me', arjun).authError, true);
});

test('rate limit stops a runaway client', () => {
  const { call, arjun } = world();
  let limited = null;
  for (let i = 0; i < 130 && !limited; i++) {
    const r = call('getLists', arjun);
    if (r.error) limited = r;
  }
  assert.ok(limited, 'expected to be rate limited');
  assert.match(limited.message, /Too many requests/);
});

test('admin-editable lists and settings', () => {
  const { call, admin, manager, arjun } = world();
  assert.equal(call('updateLists', manager, { data: { channels: ['A'] } }).forbidden, true);
  const lists = ok(call('updateLists', admin, { data: { channels: ['Phone call', 'Referral', 'phone call', ''] } })).lists;
  assert.deepEqual(lists.channels, ['Phone call', 'Referral']);
  assert.match(call('createSale', arjun, { type: 'medpass', data: lead({ channel: 'Walk-in' }) }).message, /Channel/);
  ok(call('createSale', arjun, { type: 'medpass', data: lead({ channel: 'Referral' }) }));
  assert.equal(ok(call('getMonthlyTarget', arjun)).target, 500000);
});

test('bulk import: preview flags bad rows, commit saves only valid ones', () => {
  const { call, arjun, manager, sheets } = world();
  ok(call('createSale', arjun, { type: 'medpass', data: lead({ contact: '9000000099' }) }));
  const rows = [
    { _row: 2, customerName: 'Asha', contact: '9876500001', temperature: 'hot', channel: 'whatsapp', nextFollowUp: '20/10/2026' },
    { _row: 3, customerName: '', contact: '9876500002' },
    { _row: 4, customerName: 'Bala', contact: '12' },
    { _row: 5, customerName: 'Chitra', contact: '+91 98765 00001' },
    { _row: 6, customerName: 'Dev', contact: '9000000099' },
    { _row: 7, customerName: 'Esha', contact: '9876500007', channel: 'Pigeon', temperature: 'lukewarm' },
    { _row: 8, customerName: '=HYPERLINK("http://x")', contact: '9876500008', agentEmail: 'divya@medunited.in', priceType: 'discounted', nextFollowUp: '31/02/2026' },
    { _row: 9, customerName: 'Farah', contact: '9876500009', channel: 'Unknown thing', notes: 'Met at camp' },
  ];
  const preview = ok(call('importSales', arjun, { type: 'medpass', rows, dryRun: true }));
  assert.equal(preview.imported, 0);
  assert.equal(ok(call('listSales', arjun, { type: 'medpass' })).sales.length, 1, 'dry run saves nothing');
  const byRow = Object.fromEntries(preview.results.map((r) => [r.row, r]));
  assert.equal(byRow[2].ok, true);
  assert.match(byRow[3].errors[0], /name/);
  assert.match(byRow[4].errors[0], /Phone/);
  assert.match(byRow[5].errors[0], /row 2/);
  assert.match(byRow[6].errors[0], /open Medpass record/);
  assert.match(byRow[7].errors.join(' '), /Temperature/);
  assert.match(byRow[8].errors.join(' '), /Follow-up date/);
  assert.match(byRow[8].warnings.join(' '), /only import their own/);
  assert.equal(byRow[9].ok, true);
  assert.match(byRow[9].warnings[0], /Unknown channel/);

  const done = ok(call('importSales', arjun, { type: 'medpass', rows, fileName: 'camp-leads.xlsx' }));
  assert.equal(done.imported, 2);
  const sales = ok(call('listSales', arjun, { type: 'medpass' })).sales;
  assert.equal(sales.length, 3);
  const asha = sales.find((s) => s.CustomerName === 'Asha');
  assert.equal(asha.Temperature, 'Hot');
  assert.equal(asha.Channel, 'WhatsApp');
  assert.equal(asha.NextFollowUp, '2026-10-20');
  assert.equal(asha.Status, 'Pending');
  const again = ok(call('importSales', arjun, { type: 'medpass', rows: rows.slice(0, 1) }));
  assert.equal(again.imported, 0, 're-importing the same file does not duplicate');

  const mgr = ok(call('importSales', manager, { type: 'pharmacy', rows: [
    { customerName: 'Gita', contact: '9876511111', agentEmail: 'divya@medunited.in', detail: 'Metformin' },
    { customerName: 'Hari', contact: '9876522222', agentEmail: 'ghost@x.in' },
  ] }));
  assert.equal(mgr.imported, 1);
  assert.match(mgr.results[1].errors[0], /not an active user/);
  const gita = ok(call('listSales', manager, { type: 'pharmacy' })).sales[0];
  assert.equal(gita.AgentName, 'Divya Agent');
  assert.match(gita.Notes, /Medicines mentioned: Metformin/);
  assert.ok(sheets.get('AuditLog').rows.some((r) => String(r[8]).includes('Imported 2 Medpass leads from camp-leads.xlsx')));

  assert.match(call('importSales', arjun, { type: 'medpass', rows: Array(501).fill({ customerName: 'x', contact: '9999999999' }) }).message, /at most 500/);
});

test('pharmacy enquiries can start without medicines, but completing needs them', () => {
  const { call, arjun } = world();
  const s = ok(call('createSale', arjun, { type: 'pharmacy', data: { ...lead(), products: [] } })).sale;
  assert.equal(s.Products, '[]');
  const done = { status: 'Completed', paymentMethod: 'Cash', amount: 500, billScreenshot: PNG, paymentScreenshot: PNG };
  assert.match(call('updateSale', arjun, { type: 'pharmacy', id: s.ID, data: { ...done, products: [] } }).message, /medicine/i);
  ok(call('updateSale', arjun, { type: 'pharmacy', id: s.ID, data: { ...done, products: [{ name: 'Insulin', quantity: 300, unitsPerDose: 20, frequency: 'Once a day', formType: 'injection' }] } }));
  const rem = ok(call('listReminders', arjun, { includeResolved: false })).reminders[0];
  assert.equal(rem.Products[0].daysSupply, 15);
});

test('phone numbers and UTRs keep leading zeros', () => {
  const { call, arjun, sheets } = world();
  const s = ok(call('createSale', arjun, { type: 'medpass', data: lead({ contact: '09848012345', utr: '000123456789012345' }) })).sale;
  const back = ok(call('getSale', arjun, { type: 'medpass', id: s.ID })).sale;
  assert.equal(back.Contact, '09848012345');
  assert.equal(back.UTR, '000123456789012345');
  assert.equal(typeof sheets.get('Medpass').rows[1][5], 'string');
});

test('upgrading a v1 sheet: setup adds columns, keeps rows, old records still load', () => {
  const env = loadBackend(path.join(__dirname, '..', '..', 'apps-script'));
  const ss = env.ctx.SpreadsheetApp.getActiveSpreadsheet();
  const old = ss.insertSheet('Medpass');
  old.getRange(1, 1, 1, 18).setValues([['ID', 'Date', 'AgentEmail', 'AgentName', 'CustomerName', 'Contact', 'Detail', 'Products', 'Amount', 'Status', 'PriceType', 'PaymentMethod', 'UTR', 'BillScreenshotUrl', 'PaymentScreenshotUrl', 'Notes', 'LeadID', 'CreatedAt']]);
  old.appendRow(['old-1', '2026-10-01', 'boss@medunited.in', 'Boss', 'Legacy Customer', "'+91 90000 11111", '', '', 2500, 'Completed', 'Full Price', 'Cash', '', '', '', '', '', '2026-10-01T05:00:00.000Z']);
  env.props.set('ADMIN_EMAIL', 'boss@medunited.in');
  env.props.set('ADMIN_PASSWORD', 'Temp0rary-Pass');
  env.ctx.setupSpreadsheet();
  env.ctx.createFirstAdmin();
  const headers = old.getRange(1, 1, 1, old.getLastColumn()).getValues()[0];
  assert.ok(headers.includes('Temperature') && headers.includes('ContactKey') && headers.includes('LeadID'));
  assert.equal(old.getLastRow(), 2);
  const call = (action, token, payload) => JSON.parse(env.ctx.doPost({ parameter: { action, token, payload: JSON.stringify(payload || {}) }, postData: { length: 10 } }).getContent());
  let t = call('login', null, { email: 'boss@medunited.in', password: 'Temp0rary-Pass' }).token;
  t = call('changePassword', t, { currentPassword: 'Temp0rary-Pass', newPassword: 'Fresh-Start-77' }).token;
  const sales = call('listSales', t, { type: 'medpass' }).sales;
  assert.equal(sales.length, 1);
  assert.equal(sales[0].ContactKey, '9000011111');
  assert.equal(sales[0].Date, '2026-10-01');
  assert.equal(sales[0].Temperature, 'Warm');
});
