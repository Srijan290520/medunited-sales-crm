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

// A family for Medpass tests: both parents and two children under 21.
const FAMILY = [
  { name: 'Ravi Kumar', relation: 'Father', dob: '1985-04-02' },
  { name: 'Lakshmi Kumar', relation: 'Mother', dob: '1988-07-19' },
  { name: 'Anil Kumar', relation: 'Child', dob: '2012-01-05' },
  { name: 'Asha Kumar', relation: 'Child', dob: '2016-11-30' },
];

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

test('agents see only their own records; every record of a patient goes to their owner', () => {
  const { call, arjun, divya, manager } = world();
  const created = ok(call('createSale', arjun, { type: 'medpass', data: lead() })).sale;
  assert.equal(created.AgentName, 'Arjun Agent');
  assert.equal(created.Status, 'Pending');
  assert.equal(created.ContactKey, '9848012345');

  assert.equal(ok(call('listSales', divya, { type: 'medpass' })).sales.length, 0);
  assert.equal(ok(call('listSales', manager, { type: 'medpass' })).sales.length, 1);
  assert.equal(call('getSale', divya, { type: 'medpass', id: created.ID }).error, true);

  // Same patient in another module: allowed, but it goes to Arjun, who handles them.
  const other = ok(call('createSale', divya, { type: 'pharmacy', data: { ...lead({ contact: '098480-12345' }), products: [{ name: 'Metformin', quantity: 60, frequency: 'Twice a day' }] } }));
  assert.equal(other.sale.AgentEmail, 'arjun@medunited.in');
  assert.match(other.notice, /Already handled by Arjun Agent/);
  assert.equal(ok(call('listSales', divya, { type: 'pharmacy' })).sales.length, 0);

  // Same patient, same module: blocked.
  const dup = call('createSale', divya, { type: 'medpass', data: lead({ contact: '098480-12345' }) });
  assert.equal(dup.error, true);
  assert.match(dup.message, /already has an open Medpass record/);
  assert.doesNotMatch(dup.message, /Ravi/, 'another agent must not learn the customer name');

  const check = ok(call('checkContact', divya, { contact: '9848012345' }));
  assert.equal(check.activeSales.length, 2);
  assert.ok(check.activeSales.every((a) => a.ID === '' && a.Mine === false));
  assert.equal(check.people.length, 0, 'a non-owner agent sees no names');
  assert.equal(check.othersCount, 1);
  assert.equal(check.owner.name, 'Arjun Agent');
  assert.equal(check.owner.email, '');
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
  assert.match(upd({ status: 'Completed', paymentMethod: 'UPI', utr: 'UTR123', billScreenshot: PNG, paymentScreenshot: PNG }).message, /family members/);
  const done = ok(upd({ status: 'Completed', paymentMethod: 'UPI', utr: 'UTR123', amount: 4999, billScreenshot: PNG, paymentScreenshot: PNG, members: FAMILY })).sale;
  assert.equal(done.Status, 'Completed');
  assert.equal(done.Amount, 1499, 'the server sets the Medpass price, not the browser');
  // Pharmacy still needs an amount typed in.
  const ph = ok(call('createSale', arjun, { type: 'pharmacy', data: { ...lead({ contact: '9000000077' }), products: [{ name: 'Metformin', quantity: 60, frequency: 'Twice a day' }] } })).sale;
  assert.match(call('updateSale', arjun, { type: 'pharmacy', id: ph.ID, data: { status: 'Completed', paymentMethod: 'Cash', billScreenshot: PNG, paymentScreenshot: PNG } }).message, /amount/);
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

  ok(call('updateSale', manager, { type: 'medpass', id: s.ID, data: { status: 'Completed', paymentMethod: 'Cash', billScreenshot: PNG, paymentScreenshot: PNG, members: FAMILY } }));
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
  ok(call('createSale', arjun, { type: 'medpass', data: lead({ ...done, amount: 10000, date: today, members: FAMILY }) }));
  // An admin's own discount is approved straight away.
  ok(call('createSale', admin, { type: 'medpass', data: lead({ ...done, contact: '9000000002', priceType: 'Discounted', discountAmount: 200, discountReason: 'Camp offer', date: '2020-01-15', members: FAMILY, agentEmail: 'arjun@medunited.in' }) }));
  ok(call('createSale', arjun, { type: 'medpass', data: lead({ contact: '9000000003', nextFollowUp: today }) }));
  ok(call('updateMonthlyTarget', manager, { amount: 2998 }));
  assert.equal(call('updateMonthlyTarget', arjun, { amount: 1 }).forbidden, true);

  const team = ok(call('dashboardSummary', manager)).summary;
  assert.equal(team.agents[0].incentive, 800);
  assert.equal(team.monthlyTarget.currentAmount, 1499);
  assert.equal(team.totals.medpassAmount, 1499 + 1299);
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

  assert.match(call('updateUser', admin, { id: arjunUser.ID, data: { active: false } }).message, /still handles 1 patient/);
  assert.equal(ok(call('me', arjun)).user.email, 'arjun@medunited.in', 'not deactivated without a successor');
  ok(call('updateUser', admin, { id: arjunUser.ID, data: { active: false, successorEmail: 'divya@medunited.in' } }));
  assert.equal(call('listSales', arjun, { type: 'medpass' }).authError, true, 'deactivation ends the session');
  assert.equal(ok(call('listSales', admin, { type: 'medpass' })).sales[0].AgentEmail, 'divya@medunited.in', 'work handed over');

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
    { _row: 5, customerName: 'asha ', contact: '+91 98765 00001' },
    { _row: 6, customerName: 'Ravi Kumar', contact: '9000000099' },
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

test('smokeTestV2 passes on a set-up sheet and saves nothing', () => {
  const { ctx, sheets } = world();
  const before = sheets.get('Medpass').rows.length;
  const out = ctx.smokeTestV2();
  const failed = out.filter((l) => !l.startsWith('PASS '));
  assert.equal(failed.join('\n'), '');
  assert.ok(out.length > 15);
  assert.equal(sheets.get('Medpass').rows.length, before);
});

test('modules come from one config; unknown module ids are rejected', () => {
  const { call, arjun } = world();
  const mods = ok(call('getModules', arjun, {})).modules;
  assert.equal(mods.map((m) => m.id).join(','), 'medpass,pharmacy');
  assert.equal(mods.find((m) => m.id === 'pharmacy').products, true);
  assert.equal(mods.find((m) => m.id === 'medpass').priceTypes, true);
  for (const type of ['constructor', '__proto__', 'toString', 'Medpass', '']) {
    const r = call('listSales', arjun, { type });
    assert.equal(r.error, true, 'type ' + type);
    assert.match(r.message, /Invalid sale type/);
  }
});

// ===== Patients: one agent per patient =====

// A row as saved before the Patients tab existed (no PatientID).
function legacyRow(sheets, tab, fields) {
  const sh = sheets.get(tab);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = { ID: 'legacy-' + Math.random().toString(36).slice(2), Date: '2026-09-01', Status: 'Pending', Temperature: 'Warm',
    Direction: 'Inbound', Channel: 'Phone call', CreatedAt: '2026-09-01T05:00:00.000Z', ...fields };
  row.ContactKey = row.ContactKey || String(row.Contact).replace(/\D/g, '').slice(-10);
  sh.appendRow(headers.map((h) => (row[h] === undefined ? '' : row[h])));
  return row;
}

test('households: relatives on one number each get records, all with the household owner', () => {
  const { call, arjun, divya, manager, sheets } = world();
  const ravi = ok(call('createSale', arjun, { type: 'medpass', data: lead() })).sale;
  assert.ok(ravi.PatientID);
  assert.equal(ravi.HouseholdSize, 1);

  // His mother on the same number, entered by a manager for Divya → goes to Arjun.
  const mom = ok(call('createSale', manager, { type: 'medpass', data: lead({ customerName: 'Lakshmi Kumar', agentEmail: 'divya@medunited.in' }) }));
  assert.equal(mom.sale.AgentEmail, 'arjun@medunited.in');
  assert.match(mom.notice, /Already handled by Arjun Agent/);
  assert.notEqual(mom.sale.PatientID, ravi.PatientID);
  assert.equal(mom.sale.HouseholdSize, 2);

  // Lakshmi in Pharmacy, entered by Divya → Arjun too; "also in" shows up.
  ok(call('createSale', divya, { type: 'pharmacy', data: { ...lead({ customerName: 'lakshmi  kumar' }), products: [] } }));
  const mine = ok(call('listSales', arjun, { type: 'medpass' })).sales;
  assert.deepEqual(mine.find((s) => s.CustomerName === 'Lakshmi Kumar').AlsoIn.slice(), ['Pharmacy']);
  assert.deepEqual(mine.find((s) => s.CustomerName === 'Ravi Kumar').AlsoIn.slice(), []);

  // The owner and managers see the people on the number; Divya doesn't.
  const own = ok(call('checkContact', arjun, { contact: '9848012345' }));
  assert.equal(own.people.map((p) => p.Name).sort().join(','), 'Lakshmi Kumar,Ravi Kumar');
  assert.equal(own.owner.isMe, true);
  const mgr = ok(call('checkContact', manager, { contact: '9848012345' }));
  assert.equal(mgr.owner.email, 'arjun@medunited.in');
  assert.equal(mgr.people.find((p) => p.Name === 'Lakshmi Kumar').OpenModules.join(','), 'Medpass,Pharmacy');
  assert.equal(ok(call('checkContact', divya, { contact: '9848012345' })).people.length, 0);

  // Picking an existing person by ID links to them even if the name is typed differently.
  const viaId = ok(call('createSale', arjun, { type: 'pharmacy', data: { ...lead({ customerName: 'Ravi K' }), patientId: ravi.PatientID, products: [] } })).sale;
  assert.equal(viaId.PatientID, ravi.PatientID);
  assert.match(call('createSale', arjun, { type: 'pharmacy', data: { ...lead(), products: [] } }).message, /already has an open Pharmacy record/);
  assert.match(call('createSale', arjun, { type: 'pharmacy', data: { ...lead({ contact: '9000000001' }), patientId: ravi.PatientID, products: [] } }).message, /not on this phone number/);

  // One Patients row per person, owned by Arjun.
  const pts = sheets.get('Patients');
  assert.equal(pts.getLastRow(), 3);
});

test('editing the phone number or name keeps records with the right owner', () => {
  const { call, arjun, divya, manager, sheets } = world();
  ok(call('createSale', arjun, { type: 'medpass', data: lead() }));
  const sita = ok(call('createSale', divya, { type: 'medpass', data: lead({ customerName: 'Sita', contact: '9111111111' }) })).sale;

  // An agent can't move their record onto another agent's household.
  const blocked = call('updateSale', divya, { type: 'medpass', id: sita.ID, data: { contact: '9848012345' } });
  assert.equal(blocked.forbidden, true);
  assert.match(blocked.message, /handled by Arjun Agent/);

  // A spelling fix on a patient's only record renames the patient.
  const renamed = ok(call('updateSale', divya, { type: 'medpass', id: sita.ID, data: { customerName: 'Seetha' } })).sale;
  assert.equal(renamed.PatientID, sita.PatientID);
  const pts = sheets.get('Patients');
  const nameCol = pts.getRange(1, 1, 1, pts.getLastColumn()).getValues()[0].indexOf('Name');
  assert.ok(pts.rows.some((r) => r[nameCol] === 'Seetha'));

  // A manager correcting the number: the open record moves to the household owner.
  const moved = ok(call('updateSale', manager, { type: 'medpass', id: sita.ID, data: { contact: '+91 98480 12345' } }));
  assert.equal(moved.sale.AgentEmail, 'arjun@medunited.in');
  assert.match(moved.notice, /Moved to Arjun Agent/);
  assert.equal(ok(call('listSales', divya, { type: 'medpass' })).sales.length, 0);
});

test('records saved before Patients existed: one agent is followed, several are a conflict', () => {
  const { call, arjun, divya, manager, sheets } = world();
  // Number A: only Divya ever handled it.
  legacyRow(sheets, 'Medpass', { CustomerName: 'Old Customer', Contact: '9222222222', AgentEmail: 'divya@medunited.in', AgentName: 'Divya Agent', Status: 'Completed', Amount: 1499 });
  const a = ok(call('createSale', arjun, { type: 'pharmacy', data: { ...lead({ customerName: 'Old Customer', contact: '9222222222' }), products: [] } }));
  assert.equal(a.sale.AgentEmail, 'divya@medunited.in');
  assert.match(a.notice, /Already handled by Divya Agent/);

  // Number B: two agents had records → nobody is guessed.
  legacyRow(sheets, 'Medpass', { CustomerName: 'Father', Contact: '9333333333', AgentEmail: 'arjun@medunited.in', AgentName: 'Arjun Agent' });
  legacyRow(sheets, 'Pharmacy', { CustomerName: 'Mother', Contact: '9333333333', AgentEmail: 'divya@medunited.in', AgentName: 'Divya Agent', Products: '[]' });
  const check = ok(call('checkContact', manager, { contact: '9333333333' }));
  assert.equal(check.conflict, true);
  assert.equal(check.owner, null);
  const b = ok(call('createSale', manager, { type: 'pharmacy', data: { ...lead({ customerName: 'Father', contact: '9333333333', agentEmail: 'divya@medunited.in' }), products: [] } }));
  assert.equal(b.sale.AgentEmail, 'divya@medunited.in', 'saved as entered while in conflict');
  assert.match(b.notice, /waiting for an admin/);
  // Father still has his open Medpass record from before.
  assert.match(call('createSale', manager, { type: 'medpass', data: lead({ customerName: 'Father', contact: '9333333333' }) }).message, /already has an open Medpass record/);
});

test('reassigning moves the household: open records and reminders move, closed sales keep their agent', () => {
  const { call, arjun, divya, manager, admin } = world();
  const products = [{ name: 'Amlodipine 5mg', quantity: 30, frequency: 'Once a day', unitsPerDose: 1, formType: 'tablet' }];
  const raviMp = ok(call('createSale', arjun, { type: 'medpass', data: lead() })).sale;
  const done = ok(call('createSale', arjun, { type: 'pharmacy', data: { ...lead(), products, status: 'Completed', paymentMethod: 'Card', amount: 640, billScreenshot: PNG, paymentScreenshot: PNG } })).sale;
  const momPh = ok(call('createSale', arjun, { type: 'pharmacy', data: { ...lead({ customerName: 'Lakshmi Kumar' }), products: [] } })).sale;
  ok(call('updateIncentives', admin, { id: ok(call('listUsers', admin, {})).users.find((u) => u.Email === 'arjun@medunited.in').ID, data: { pharmacyIncentivePercent: 10 } }));

  assert.equal(call('reassignSale', arjun, { type: 'medpass', id: raviMp.ID, agentEmail: 'divya@medunited.in' }).forbidden, true);
  const r = ok(call('reassignSale', manager, { type: 'medpass', id: raviMp.ID, agentEmail: 'divya@medunited.in', reason: 'Arjun on leave' }));
  assert.equal(r.patients, 2);
  assert.equal(r.moved.length, 2, 'both open records');
  assert.equal(r.reminders, 1);
  assert.equal(r.sale.AgentEmail, 'divya@medunited.in');

  assert.equal(ok(call('listSales', divya, { type: 'medpass' })).sales.length, 1);
  const divPh = ok(call('listSales', divya, { type: 'pharmacy' })).sales;
  assert.deepEqual(divPh.map((s) => s.ID), [momPh.ID]);
  const arjPh = ok(call('listSales', arjun, { type: 'pharmacy' })).sales;
  assert.deepEqual(arjPh.map((s) => s.ID), [done.ID], 'the completed sale stays with its closer');
  assert.equal(ok(call('listReminders', divya, {})).reminders.length, 1);
  assert.equal(ok(call('listReminders', arjun, {})).reminders.length, 0);
  const arjunRow = ok(call('dashboardSummary', manager, {})).summary.agents.find((a) => a.agentEmail === 'arjun@medunited.in');
  assert.equal(arjunRow.incentive, 64, 'incentive stays with Arjun');

  // New records for the household now go to Divya.
  const next = ok(call('createSale', arjun, { type: 'medpass', data: lead({ customerName: 'Lakshmi Kumar' }) }));
  assert.equal(next.sale.AgentEmail, 'divya@medunited.in');
  assert.match(next.notice, /Divya Agent/);
});

test('splitting one person out of a household, and reopening follows the owner', () => {
  const { call, arjun, divya, manager } = world();
  const ravi = ok(call('createSale', arjun, { type: 'medpass', data: lead() })).sale;
  const mom = ok(call('createSale', arjun, { type: 'medpass', data: lead({ customerName: 'Lakshmi Kumar' }) })).sale;
  // Ravi's old enquiry in Pharmacy was lost.
  const lost = ok(call('createSale', arjun, { type: 'pharmacy', data: { ...lead(), products: [], status: 'Cancelled', lostReason: 'Price too high' } })).sale;

  const r = ok(call('reassignSale', manager, { type: 'medpass', id: mom.ID, agentEmail: 'divya@medunited.in', scope: 'person' }));
  assert.equal(r.patients, 1);
  assert.deepEqual(ok(call('listSales', divya, { type: 'medpass' })).sales.map((s) => s.ID), [mom.ID]);
  assert.deepEqual(ok(call('listSales', arjun, { type: 'medpass' })).sales.map((s) => s.ID), [ravi.ID]);
  assert.equal(ok(call('checkContact', manager, { contact: '9848012345' })).owners.length, 2);

  // Ravi's household goes to Divya too; Arjun can no longer reopen Ravi's lost record.
  ok(call('reassignSale', manager, { type: 'medpass', id: ravi.ID, agentEmail: 'divya@medunited.in', scope: 'person' }));
  const denied = call('reopenSale', arjun, { type: 'pharmacy', id: lost.ID });
  assert.equal(denied.forbidden, true);
  assert.match(denied.message, /now handled by Divya Agent/);
  const reopened = ok(call('reopenSale', manager, { type: 'pharmacy', id: lost.ID })).sale;
  assert.equal(reopened.AgentEmail, 'divya@medunited.in');
  assert.equal(reopened.Status, 'Pending');

  // reassignPatient by phone number moves everyone on it.
  const all = ok(call('reassignPatient', manager, { contact: '9848012345', agentEmail: 'arjun@medunited.in' }));
  assert.equal(all.patients, 2);
  assert.equal(all.moved.length, 3);
  assert.equal(ok(call('checkContact', manager, { contact: '9848012345' })).owner.email, 'arjun@medunited.in');
  assert.match(call('reassignPatient', manager, { contact: '9848012345', agentEmail: 'boss@medunited.in' }).message, /not found or inactive/, 'admins are not patient owners');
});

test('migration builds Patients from existing rows: dry run first, never guesses, safe to rerun', () => {
  const { call, ctx, arjun, manager, admin, sheets } = world();
  const fresh = ok(call('createSale', arjun, { type: 'medpass', data: lead() })).sale; // already has a PatientID
  legacyRow(sheets, 'Medpass', { CustomerName: 'Old A', Contact: '9222222222', AgentEmail: 'divya@medunited.in', AgentName: 'Divya Agent', Status: 'Completed', Amount: 1499 });
  legacyRow(sheets, 'Pharmacy', { CustomerName: 'old a', Contact: '+91 92222 22222', AgentEmail: 'divya@medunited.in', AgentName: 'Divya Agent', Products: '[]' });
  legacyRow(sheets, 'Medpass', { CustomerName: 'Father', Contact: '9333333333', AgentEmail: 'arjun@medunited.in', AgentName: 'Arjun Agent' });
  legacyRow(sheets, 'Pharmacy', { CustomerName: 'Mother', Contact: '9333333333', AgentEmail: 'divya@medunited.in', AgentName: 'Divya Agent', Products: '[]' });
  const patientRows = () => sheets.get('Patients').getLastRow() - 1;
  const pidCol = (tab) => sheets.get(tab).getRange(1, 1, 1, sheets.get(tab).getLastColumn()).getValues()[0].indexOf('PatientID');
  assert.equal(patientRows(), 1);

  assert.equal(call('migratePatients', manager, { dryRun: true }).forbidden, true);
  const dry = ok(call('migratePatients', admin, { dryRun: true })).migration;
  assert.equal(dry.dryRun, true);
  assert.equal(dry.patientsCreated, 3);
  assert.equal(dry.recordsLinked, 4);
  assert.equal(dry.newConflicts, 1);
  assert.equal(dry.conflicts[0].contactKey, '9333333333');
  assert.equal(dry.conflicts[0].agents.length, 2);
  assert.equal(patientRows(), 1, 'a dry run writes nothing');
  const omitted = ok(call('migratePatients', admin, {})).migration;
  assert.equal(omitted.dryRun, true, 'dry run unless dryRun is explicitly false');

  const real = ok(call('migratePatients', admin, { dryRun: false })).migration;
  assert.equal(real.patientsCreated, 3);
  assert.equal(patientRows(), 4);
  for (const tab of ['Medpass', 'Pharmacy']) {
    const col = pidCol(tab);
    assert.ok(sheets.get(tab).rows.slice(1).every((r) => r[col]), tab + ' rows all linked');
  }
  assert.equal(sheets.get('Medpass').rows.find((r) => r[0] === fresh.ID)[pidCol('Medpass')], fresh.PatientID, 'existing links untouched');
  assert.ok(sheets.get('AuditLog').rows.some((r) => r.some((c) => String(c).includes('Patients migration: 3 patients created'))));
  // Owners: never changed on records.
  assert.equal(ok(call('listSales', manager, { type: 'pharmacy' })).sales.find((s) => s.CustomerName === 'Mother').AgentEmail, 'divya@medunited.in');

  const again = ok(call('migratePatients', admin, { dryRun: false })).migration;
  assert.equal(again.patientsCreated, 0);
  assert.equal(again.recordsLinked, 0);
  assert.equal(ctx.migratePatientsDryRun().patientsCreated, 0, 'editor dry run works too');
});

test('admins resolve owner conflicts: whole household or person by person', () => {
  const { call, arjun, divya, manager, admin, sheets } = world();
  legacyRow(sheets, 'Medpass', { CustomerName: 'Father', Contact: '9333333333', AgentEmail: 'arjun@medunited.in', AgentName: 'Arjun Agent' });
  legacyRow(sheets, 'Pharmacy', { CustomerName: 'Mother', Contact: '9333333333', AgentEmail: 'divya@medunited.in', AgentName: 'Divya Agent', Products: '[]' });
  legacyRow(sheets, 'Medpass', { CustomerName: 'Gopal', Contact: '9444444444', AgentEmail: 'arjun@medunited.in', AgentName: 'Arjun Agent' });
  legacyRow(sheets, 'Medpass', { CustomerName: 'Gopal', Contact: '9444444444', AgentEmail: 'divya@medunited.in', AgentName: 'Divya Agent', Status: 'Cancelled', LostReason: 'Other' });

  // Visible before the migration has run.
  let list = ok(call('listPatientConflicts', manager, {})).conflicts;
  assert.equal(list.length, 2);
  assert.equal(call('listPatientConflicts', arjun, {}).forbidden, true);
  ok(call('migratePatients', admin, { dryRun: false }));
  list = ok(call('listPatientConflicts', manager, {})).conflicts;
  const fam = list.find((c) => c.contactKey === '9333333333');
  assert.equal(fam.people.length, 2);
  assert.equal(fam.people.find((p) => p.Name === 'Mother').records[0].module, 'Pharmacy');

  assert.equal(call('resolvePatientConflict', manager, { contact: '9333333333', agentEmail: 'arjun@medunited.in' }).forbidden, true);
  // Split: each parent keeps their agent.
  const split = ok(call('resolvePatientConflict', admin, { contact: '9333333333', assignments: [
    { name: 'father', agentEmail: 'arjun@medunited.in' }, { name: 'Mother', agentEmail: 'divya@medunited.in' },
  ] }));
  assert.equal(split.remainingConflicts, 0);
  assert.equal(split.moved.length, 0, 'nobody changed hands');
  assert.equal(ok(call('checkContact', manager, { contact: '9333333333' })).owners.length, 2);

  // Whole household to Divya: Gopal's open record moves, the closed one stays.
  const whole = ok(call('resolvePatientConflict', admin, { contact: '9444444444', agentEmail: 'divya@medunited.in' }));
  assert.equal(whole.moved.length, 1);
  assert.equal(ok(call('listSales', divya, { type: 'medpass' })).sales.length, 2);
  assert.equal(ok(call('listSales', arjun, { type: 'medpass' })).sales.filter((s) => s.CustomerName === 'Gopal').length, 0);

  assert.equal(ok(call('listPatientConflicts', manager, {})).conflicts.length, 0);
  assert.match(call('resolvePatientConflict', admin, { contact: '9444444444', agentEmail: 'arjun@medunited.in' }).message, /no owner conflict/);
  assert.match(call('resolvePatientConflict', admin, { contact: '9555555555', assignments: [{ name: 'x', agentEmail: 'arjun@medunited.in' }] }).message, /no owner conflict/);
});

test('deactivating an agent: manager requests with a successor, admin approves, all open work moves', () => {
  const { call, arjun, divya, manager, admin, sheets } = world();
  const products = [{ name: 'Amlodipine 5mg', quantity: 30, frequency: 'Once a day', unitsPerDose: 1, formType: 'tablet' }];
  ok(call('createSale', arjun, { type: 'medpass', data: lead() }));
  const closed = ok(call('createSale', arjun, { type: 'pharmacy', data: { ...lead(), products, status: 'Completed', paymentMethod: 'Card', amount: 640, billScreenshot: PNG, paymentScreenshot: PNG } })).sale;
  ok(call('createSale', arjun, { type: 'pharmacy', data: { ...lead({ customerName: 'Other Person', contact: '9666666666' }), products: [] } }));
  // An open record on a conflict number (two agents before Patients existed).
  legacyRow(sheets, 'Medpass', { CustomerName: 'Father', Contact: '9333333333', AgentEmail: 'arjun@medunited.in', AgentName: 'Arjun Agent' });
  legacyRow(sheets, 'Pharmacy', { CustomerName: 'Mother', Contact: '9333333333', AgentEmail: 'divya@medunited.in', AgentName: 'Divya Agent', Products: '[]' });

  const users = ok(call('listUsers', admin)).users;
  const arjunUser = users.find((u) => u.Email === 'arjun@medunited.in');
  const bossUser = users.find((u) => u.Email === 'boss@medunited.in');
  assert.equal(call('requestDeactivation', arjun, { userId: arjunUser.ID, successorEmail: 'divya@medunited.in', reason: 'Left' }).forbidden, true);
  assert.match(call('requestDeactivation', manager, { userId: arjunUser.ID, reason: 'Left the company' }).message, /not found or inactive/);
  assert.match(call('requestDeactivation', manager, { userId: arjunUser.ID, successorEmail: 'arjun@medunited.in', reason: 'Left the company' }).message, /someone else/);
  assert.equal(call('requestDeactivation', manager, { userId: bossUser.ID, successorEmail: 'divya@medunited.in', reason: 'x y z' }).forbidden, true);

  const req = ok(call('requestDeactivation', manager, { userId: arjunUser.ID, successorEmail: 'divya@medunited.in', reason: 'Left the company' })).request;
  assert.equal(req.Status, 'Pending');
  assert.match(call('requestDeactivation', manager, { userId: arjunUser.ID, successorEmail: 'divya@medunited.in', reason: 'Again' }).message, /already a pending/);
  assert.equal(ok(call('listUserRequests', manager, {})).requests.length, 1);
  assert.equal(ok(call('me', arjun)).user.email, 'arjun@medunited.in', 'a request alone changes nothing');

  assert.equal(call('decideUserRequest', manager, { id: req.ID, approve: true }).forbidden, true, 'only admins decide');
  const res = ok(call('decideUserRequest', admin, { id: req.ID, approve: true, note: 'Handover agreed' }));
  assert.equal(res.request.Status, 'Approved');
  assert.equal(res.handover.records, 3, 'Ravi medpass, Other Person pharmacy, Father medpass');
  assert.equal(res.handover.reminders, 1);
  assert.equal(call('me', arjun).authError, true, 'account deactivated');

  const div = (type) => ok(call('listSales', divya, { type })).sales;
  assert.equal(div('medpass').length, 2);
  assert.equal(div('pharmacy').map((s) => s.CustomerName).sort().join(','), 'Mother,Other Person');
  assert.equal(ok(call('listSales', admin, { type: 'pharmacy' })).sales.find((s) => s.ID === closed.ID).AgentEmail, 'arjun@medunited.in', 'closed sale keeps its agent');
  assert.equal(ok(call('listReminders', divya, {})).reminders.length, 1);
  // Ravi's household now belongs to Divya; the conflict number is still for an admin to decide.
  assert.equal(ok(call('checkContact', manager, { contact: '9848012345' })).owner.email, 'divya@medunited.in');
  assert.equal(ok(call('checkContact', manager, { contact: '9333333333' })).conflict, true);
  assert.match(call('decideUserRequest', admin, { id: req.ID, approve: true }).message, /already decided/);

  // Rejecting leaves everything as it was.
  const divUser = users.find((u) => u.Email === 'divya@medunited.in');
  const r2 = ok(call('requestDeactivation', manager, { userId: divUser.ID, successorEmail: 'meera@medunited.in', reason: 'Testing' })).request;
  assert.equal(ok(call('decideUserRequest', admin, { id: r2.ID, approve: false, note: 'Not now' })).request.Status, 'Rejected');
  assert.equal(div('medpass').length, 2);
});

// ===== Phase 1b =====

test('senior manager: admin powers except admin accounts and hard deletes', () => {
  const { call, admin, manager, arjun, divya } = world();
  ok(call('createUser', admin, { data: { name: 'Sana Senior', email: 'sana@medunited.in', role: 'senior_manager', password: 'Joining2Team9' } }));
  const senior = loginFresh(call, 'sana@medunited.in', 'Joining2Team9', 'Senior-Pass-2026');
  assert.equal(call('createUser', manager, { data: { name: 'X', email: 'x@y.in', role: 'senior_manager', password: 'Joining2Team9' } }).forbidden, true);

  // Users: yes for non-admins, no for admins.
  ok(call('createUser', senior, { data: { name: 'New Agent', email: 'new@medunited.in', role: 'agent', password: 'Joining2Team9' } }));
  assert.equal(call('createUser', senior, { data: { name: 'Sneaky', email: 'sneaky@medunited.in', role: 'admin', password: 'Joining2Team9' } }).forbidden, true);
  const users = ok(call('listUsers', senior)).users;
  const boss = users.find((u) => u.Email === 'boss@medunited.in');
  const newbie = users.find((u) => u.Email === 'new@medunited.in');
  assert.equal(call('updateUser', senior, { id: boss.ID, data: { name: 'Hacked' } }).forbidden, true);
  assert.equal(call('updateUser', senior, { id: newbie.ID, data: { role: 'admin' } }).forbidden, true);
  ok(call('updateUser', senior, { id: newbie.ID, data: { role: 'manager' } }));
  assert.equal(call('deleteUser', senior, { id: newbie.ID, reason: 'test account' }).forbidden, true, 'hard delete is admin-only');

  // Records: team-wide like a manager; no hard delete.
  const s = ok(call('createSale', arjun, { type: 'medpass', data: lead() })).sale;
  assert.equal(ok(call('listSales', senior, { type: 'medpass' })).sales.length, 1);
  ok(call('reassignSale', senior, { type: 'medpass', id: s.ID, agentEmail: 'divya@medunited.in' }));
  assert.equal(call('deleteSale', senior, { type: 'medpass', id: s.ID, reason: 'duplicate' }).forbidden, true);
  ok(call('updateLists', senior, { data: { channels: ['Phone call', 'Walk-in'] } }));
  ok(call('listPatientConflicts', senior, {}));
  ok(call('migratePatients', senior, { dryRun: true }));

  // Approves deactivations (but not about themselves).
  const div = users.find((u) => u.Email === 'divya@medunited.in');
  const req = ok(call('requestDeactivation', manager, { userId: div.ID, successorEmail: 'arjun@medunited.in', reason: 'Left the company' })).request;
  ok(call('decideUserRequest', senior, { id: req.ID, approve: true }));
  assert.equal(call('me', divya).authError, true);
  const sana = users.find((u) => u.Email === 'sana@medunited.in');
  const self = ok(call('requestDeactivation', admin, { userId: sana.ID, successorEmail: 'arjun@medunited.in', reason: 'Testing self' })).request;
  assert.equal(call('decideUserRequest', senior, { id: self.ID, approve: true }).forbidden, true);
});

// ----- Medpass rules -----
const DONE = { status: 'Completed', paymentMethod: 'Cash', billScreenshot: PNG, paymentScreenshot: PNG };
const kid = (name, dob) => ({ name, relation: 'Child', dob });

test('medpass price: ₹1499 for the family, ₹375 for a third child, server-side', () => {
  const { call, arjun } = world();
  const mp = (contact, members, over = {}) => call('createSale', arjun, { type: 'medpass', data: lead({ contact, members, amount: 1, ...over }) });
  const four = ok(mp('9100000001', FAMILY)).sale;
  assert.equal(four.Amount, 1499);
  assert.equal(four.ListPrice, 1499);
  assert.equal(four.PayableNow, 1499);
  assert.equal(four.Members.length, 4);
  const five = ok(mp('9100000002', [...FAMILY, kid('Arun Kumar', '2019-06-01')])).sale;
  assert.equal(five.ExtraChildFee, 375);
  assert.equal(five.Amount, 1874);

  assert.match(mp('9100000003', [...FAMILY, kid('Arun Kumar', '2019-06-01'), kid('Ajay Kumar', '2021-02-02')]).message, /up to 3 children/);
  assert.match(mp('9100000004', [FAMILY[0], kid('Big Kid', '2004-01-01')], { date: '2026-10-16' }).message, /is 22\. Children must be under 21.*own Medpass/);
  assert.match(mp('9100000005', [FAMILY[0], { name: 'No Dob', relation: 'Child' }]).message, /date of birth of No Dob/);
  assert.match(mp('9100000006', [FAMILY[0], { name: 'Other Dad', relation: 'Father' }]).message, /one father and one mother/);
  assert.match(mp('9100000007', [kid('Only Kid', '2015-01-01')]).message, /at least one parent/);
  assert.match(mp('9100000008', [FAMILY[0], { name: 'Grandma', relation: 'Grandmother' }]).message, /Relation of Grandma/);
  assert.match(mp('9100000009', [FAMILY[0], { ...FAMILY[0] }]).message, /listed twice/);
  // A child turning 21 later in the year is fine: age counts on the sale date.
  ok(mp('9100000010', [FAMILY[1], kid('Nearly 21', '2005-12-01')], { date: '2026-10-16' }));
  // Single parent is allowed by default; a lead can start without members.
  assert.equal(ok(mp('9100000011', [FAMILY[1], FAMILY[2]])).sale.Amount, 1499);
  assert.equal(ok(mp('9100000012', [])).sale.Members.length, 0);
});

test('medpass discount: up to ₹200, needs a reason and approval by an admin or senior manager', () => {
  const { call, admin, arjun, manager } = world();
  ok(call('createUser', admin, { data: { name: 'Sana Senior', email: 'sana@medunited.in', role: 'senior_manager', password: 'Joining2Team9' } }));
  const senior = loginFresh(call, 'sana@medunited.in', 'Joining2Team9', 'Senior-Pass-2026');
  const base = lead({ priceType: 'Discounted', members: FAMILY });
  assert.match(call('createSale', arjun, { type: 'medpass', data: { ...base, discountAmount: 250, discountReason: 'Camp' } }).message, /between ₹1 and ₹200/);
  assert.match(call('createSale', arjun, { type: 'medpass', data: { ...base, discountAmount: 200 } }).message, /reason for the discount/);
  const created = ok(call('createSale', arjun, { type: 'medpass', data: { ...base, discountAmount: 200, discountReason: 'Health camp offer' } }));
  const s = created.sale;
  assert.equal(s.Amount, 1299);
  assert.equal(s.DiscountStatus, 'Requested');
  assert.match(created.notice, /waiting for approval/);
  assert.equal(ok(call('listPendingDiscounts', manager, {})).discounts.length, 1);

  const complete = () => call('updateSale', arjun, { type: 'medpass', id: s.ID, data: DONE });
  assert.match(complete().message, /waiting for approval/);
  assert.equal(call('decideMedpassDiscount', arjun, { id: s.ID, approve: true }).forbidden, true);
  assert.equal(call('decideMedpassDiscount', manager, { id: s.ID, approve: true }).forbidden, true);
  assert.match(call('decideMedpassDiscount', senior, { id: s.ID, approve: false }).message, /why/);
  ok(call('decideMedpassDiscount', senior, { id: s.ID, approve: false, note: 'Not a camp lead' }));
  assert.match(complete().message, /rejected/);
  // Asking for a different discount starts a new request.
  const again = ok(call('updateSale', arjun, { type: 'medpass', id: s.ID, data: { discountAmount: 100, discountReason: 'Senior citizen' } })).sale;
  assert.equal(again.DiscountStatus, 'Requested');
  assert.equal(again.Amount, 1399);
  const approved = ok(call('decideMedpassDiscount', senior, { id: s.ID, approve: true })).sale;
  assert.equal(approved.DiscountStatus, 'Approved');
  assert.equal(approved.DiscountDecidedBy, 'Sana Senior');
  const done = ok(complete()).sale;
  assert.equal(done.Status, 'Completed');
  assert.equal(done.Amount, 1399);
  assert.match(call('decideMedpassDiscount', senior, { id: s.ID, approve: true }).message, /no discount waiting/);
  assert.equal(ok(call('listPendingDiscounts', manager, {})).discounts.length, 0);
});

test('medpass converted from OP: full price counts, the OP fee is credited, no discount', () => {
  const { call, arjun, manager, admin } = world();
  ok(call('updateIncentives', manager, { id: findUser(call, admin, 'arjun@medunited.in').ID, data: { medpassFullRate: 500, medpassDiscountRate: 300 } }));
  const s = ok(call('createSale', arjun, { type: 'medpass', data: lead({ priceType: 'Converted From OP', members: FAMILY, discountAmount: 200 }) })).sale;
  assert.equal(s.Amount, 1499);
  assert.equal(s.DiscountAmount, 0, 'OP conversions get no discount');
  assert.match(call('updateSale', arjun, { type: 'medpass', id: s.ID, data: DONE }).message, /OP consultation fee/);
  assert.match(call('updateSale', arjun, { type: 'medpass', id: s.ID, data: { opCredit: 2000 } }).message, /between ₹0 and ₹1499/);
  const done = ok(call('updateSale', arjun, { type: 'medpass', id: s.ID, data: { ...DONE, opCredit: 500 } })).sale;
  assert.equal(done.Amount, 1499);
  assert.equal(done.OPCredit, 500);
  assert.equal(done.PayableNow, 999);
  const dash = ok(call('dashboardSummary', manager)).summary;
  assert.equal(dash.totals.medpassAmount, 1499, 'revenue is the full price');
  assert.equal(dash.agents[0].incentive, 500, 'full-price incentive');
});

test('medpass validity: one year from the sale date; covered members get a warning', () => {
  const { call, arjun, manager } = world();
  const s = ok(call('createSale', arjun, { type: 'medpass', data: lead({ ...DONE, members: FAMILY, date: '2026-03-10' }) })).sale;
  assert.equal(s.ValidFrom, '2026-03-10');
  assert.equal(s.ValidUntil, '2027-03-09');
  assert.equal(s.PassStatus, 'active');
  const leap = ok(call('createSale', arjun, { type: 'medpass', data: lead({ ...DONE, contact: '9200000001', members: FAMILY, date: '2024-02-29' }) })).sale;
  assert.equal(leap.ValidUntil, '2025-02-28');
  assert.equal(leap.PassStatus, 'expired');

  // Grandma on the same number takes her own pass; the covered parent gets a warning, not a block.
  const g = ok(call('createSale', arjun, { type: 'medpass', data: lead({ customerName: 'Kamala Kumar', members: [{ name: 'Kamala Kumar', relation: 'Mother' }, FAMILY[0]] }) }));
  assert.match(g.notice, /Ravi Kumar is already covered by a Medpass valid until 2027-03-09/);
  // Reopening (undoing) the sale clears its validity.
  const re = ok(call('reopenSale', manager, { type: 'medpass', id: s.ID, reason: 'Payment bounced' })).sale;
  assert.equal(re.Status, 'Pending');
  assert.equal(re.ValidUntil, '');
  assert.equal(re.PassStatus, '');
});

test('medpass settings, completed passes keep their price, older rows and import', () => {
  const { call, admin, arjun, manager, sheets } = world();
  assert.equal(ok(call('getMedpassSettings', arjun, {})).settings.price, 1499);
  const done = ok(call('createSale', arjun, { type: 'medpass', data: lead({ ...DONE, members: FAMILY }) })).sale;

  assert.equal(call('updateMedpassSettings', manager, { data: { price: 1599 } }).forbidden, true);
  assert.match(call('updateMedpassSettings', admin, { data: { maxDiscount: 1600, price: 1599 } }).message, /less than the price/);
  const st = ok(call('updateMedpassSettings', admin, { data: { price: 1599, singleParent: false } })).settings;
  assert.equal(st.price, 1599);
  assert.equal(ok(call('createSale', arjun, { type: 'medpass', data: lead({ contact: '9300000001', members: FAMILY }) })).sale.Amount, 1599);
  assert.match(call('createSale', arjun, { type: 'medpass', data: lead({ contact: '9300000002', members: [FAMILY[0]] }) }).message, /both parents/);

  // A completed pass keeps its price when someone edits its notes.
  const after = ok(call('updateSale', manager, { type: 'medpass', id: done.ID, data: { notes: 'Called to welcome them' } })).sale;
  assert.equal(after.Amount, 1499);
  // Agents can't change who a completed pass covers.
  assert.equal(call('updateSale', arjun, { type: 'medpass', id: done.ID, data: { members: FAMILY.slice(0, 2) } }).forbidden, true);

  // Rows from before these rules: completed ones keep their amount; open ones follow the rules.
  const oldDone = legacyRow(sheets, 'Medpass', { CustomerName: 'Old Sale', Contact: '9400000001', AgentEmail: 'arjun@medunited.in', AgentName: 'Arjun Agent', Status: 'Completed', Amount: 8999, PriceType: 'Full Price', PaymentMethod: 'Cash', BillScreenshotUrl: 'drive-file-1', PaymentScreenshotUrl: 'drive-file-2' });
  assert.equal(ok(call('updateSale', manager, { type: 'medpass', id: oldDone.ID, data: { notes: 'Old customer' } })).sale.Amount, 8999);
  const oldOpen = legacyRow(sheets, 'Medpass', { CustomerName: 'Old Lead', Contact: '9400000002', AgentEmail: 'arjun@medunited.in', AgentName: 'Arjun Agent', Amount: 5000, PriceType: 'Full Price' });
  assert.equal(ok(call('updateSale', arjun, { type: 'medpass', id: oldOpen.ID, data: { notes: 'Called' } })).sale.Amount, 1599);

  // Import: standard price; discounts must be added in the app.
  const imp = ok(call('importSales', arjun, { type: 'medpass', rows: [
    { customerName: 'Imported One', contact: '9500000001', amount: '9999' },
    { customerName: 'Imported Two', contact: '9500000002', priceType: 'Discounted' },
  ] }));
  assert.equal(imp.imported, 1);
  assert.match(imp.results[1].errors.join(' '), /Discounts can't be imported/);
  assert.equal(ok(call('listSales', arjun, { type: 'medpass' })).sales.find((s) => s.CustomerName === 'Imported One').Amount, 1599);
});
