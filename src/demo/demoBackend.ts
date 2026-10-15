// Preview build only: runs the real Apps Script backend (apps-script/*.gs,
// wrapped by scripts/build-demo-backend.mjs) inside the browser on in-memory
// mock services, seeded with sample data. Nothing leaves the browser and
// everything resets on reload.
import { createGasMocks } from './gasMocks';
// @ts-ignore generated file
import { createGasBackend } from './gasBackend.generated.js';

export const DEMO_PASSWORD = 'Preview-2026';
export const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'admin@medunited.demo', note: 'everything, incl. users & settings' },
  { label: 'Manager', email: 'pooja@medunited.demo', note: 'whole team, incentives, reassign' },
  { label: 'Agent', email: 'rahul@medunited.demo', note: 'own records only' },
  { label: 'New agent', email: 'kiran@medunited.demo', note: 'first login: must set a password', password: 'Start-Now-2026' },
];

type Backend = { doPost: (e: any) => any; setupSpreadsheet: () => void; createFirstAdmin: () => void };

let backend: Backend | null = null;

function raw(action: string, token?: string | null, payload?: unknown): any {
  const parameter: Record<string, string> = { action };
  if (token) parameter.token = token;
  if (payload !== undefined) parameter.payload = JSON.stringify(payload);
  const out = JSON.parse(backend!.doPost({ parameter, postData: { length: (parameter.payload || '').length } }).getContent());
  if (out.error && seeding) console.warn('[preview seed]', action, out.message);
  return out;
}

let seeding = false;

function istDate(offsetDays: number): string {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

function receiptImage(title: string, amount: string): string {
  try {
    const c = document.createElement('canvas');
    c.width = 360;
    c.height = 220;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f8fafc';
    g.fillRect(0, 0, 360, 220);
    g.strokeStyle = '#cbd5e1';
    g.lineWidth = 2;
    g.strokeRect(10, 10, 340, 200);
    g.fillStyle = '#334155';
    g.font = 'bold 18px sans-serif';
    g.fillText(title, 28, 52);
    g.font = '14px sans-serif';
    g.fillStyle = '#64748b';
    g.fillText('Sample screenshot for the preview', 28, 82);
    g.font = 'bold 28px sans-serif';
    g.fillStyle = '#15803d';
    g.fillText(amount, 28, 140);
    g.font = '12px monospace';
    g.fillStyle = '#94a3b8';
    g.fillText('Ref: DEMO-' + Math.random().toString(36).slice(2, 10).toUpperCase(), 28, 185);
    return c.toDataURL('image/png');
  } catch {
    // 1x1 PNG fallback
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  }
}

function login(email: string, password: string, newPassword?: string): string {
  let r = raw('login', null, { email, password });
  if (r.user?.mustChangePassword && newPassword) {
    r = raw('changePassword', r.token, { currentPassword: password, newPassword });
  }
  return r.token;
}

function seed() {
  seeding = true;
  const { mocks, props } = createGasMocks();
  const m: any = mocks;
  backend = createGasBackend(m.SpreadsheetApp, m.CacheService, m.LockService, m.PropertiesService, m.ContentService, m.DriveApp, m.Utilities, m.Logger, m.console);
  props.set('ADMIN_EMAIL', 'admin@medunited.demo');
  props.set('ADMIN_PASSWORD', 'Setup-Temp-2026');
  props.set('ADMIN_NAME', 'Srijan (Admin)');
  backend!.setupSpreadsheet();
  backend!.createFirstAdmin();
  const admin = login('admin@medunited.demo', 'Setup-Temp-2026', DEMO_PASSWORD);

  const people = [
    ['Pooja Varma', 'pooja@medunited.demo', 'manager'],
    ['Rahul Sharma', 'rahul@medunited.demo', 'agent'],
    ['Priya Reddy', 'priya@medunited.demo', 'agent'],
    ['Kiran Rao', 'kiran@medunited.demo', 'agent'],
  ];
  const ids: Record<string, string> = {};
  for (const [name, email, role] of people) {
    const pw = email.startsWith('kiran') ? 'Start-Now-2026' : 'Temp-Start-2026';
    ids[email] = raw('createUser', admin, { data: { name, email, role, password: pw } }).user.ID;
  }
  const manager = login('pooja@medunited.demo', 'Temp-Start-2026', DEMO_PASSWORD);
  const rahul = login('rahul@medunited.demo', 'Temp-Start-2026', DEMO_PASSWORD);
  const priya = login('priya@medunited.demo', 'Temp-Start-2026', DEMO_PASSWORD);

  raw('updateIncentives', manager, { id: ids['rahul@medunited.demo'], data: { medpassFullRate: 500, medpassDiscountRate: 300, pharmacyIncentivePercent: 5 } });
  raw('updateIncentives', manager, { id: ids['priya@medunited.demo'], data: { medpassFullRate: 450, medpassDiscountRate: 250, pharmacyIncentivePercent: 4 } });
  raw('updateMonthlyTarget', manager, { amount: 150000 });

  const proof = (amt: string) => ({ billScreenshot: receiptImage('MedUnited bill', amt), paymentScreenshot: receiptImage('UPI payment', amt) });
  const base = { direction: 'Inbound', consent: true, doNotCall: false };

  const medpass: [string, any][] = [
    [rahul, { customerName: 'Ramesh Kumar', contact: '9848012345', priceType: 'Full Price', detail: 'Family Annual plan (4 members)', temperature: 'Hot', channel: 'Phone call', heardFrom: 'Doctor referral', nextFollowUp: istDate(0), notes: 'Wants to start before his mother\'s surgery next week.' }],
    [rahul, { customerName: 'Sunita Devi', contact: '9701122334', priceType: 'Discounted', detail: 'Senior Citizen plan', temperature: 'Warm', channel: 'Health camp', heardFrom: 'Health camp', nextFollowUp: istDate(-2), notes: 'Met at Kukatpally camp. Asked for brochure on WhatsApp.' }],
    [rahul, { customerName: 'Abdul Rahman', contact: '9866554433', priceType: 'Full Price', detail: 'Individual Annual', temperature: 'Cold', channel: 'Website form', heardFrom: 'Google search', nextFollowUp: istDate(4) }],
    [rahul, { customerName: 'Lakshmi Narayana', contact: '9912345678', priceType: 'Full Price', detail: 'Family Annual plan', status: 'Completed', amount: 8999, paymentMethod: 'UPI', utr: '428812345671', date: istDate(-6), channel: 'Walk-in', heardFrom: 'Existing patient', ...proof('₹8,999') }],
    [rahul, { customerName: 'Venkat Rao', contact: '9440011223', priceType: 'Converted From OP', detail: 'Individual Annual', status: 'Completed', amount: 4999, paymentMethod: 'Card', date: istDate(-12), channel: 'OPD/IPD referral', ...proof('₹4,999') }],
    [priya, { customerName: 'Fatima Begum', contact: '9393939393', priceType: 'Discounted', detail: 'Senior Citizen plan', status: 'Completed', amount: 3499, paymentMethod: 'Cash', date: istDate(-3), channel: 'Phone call', heardFrom: 'Friend or family', ...proof('₹3,499') }],
    [priya, { customerName: 'Mohan Krishna', contact: '9000123456', priceType: 'Full Price', detail: 'Family Annual plan', temperature: 'Hot', channel: 'WhatsApp', heardFrom: 'Facebook / Instagram', nextFollowUp: istDate(1) }],
    [priya, { customerName: 'Gita Sharma', contact: '9123456780', priceType: 'Full Price', detail: 'Individual Annual', status: 'Cancelled', lostReason: 'Price too high', channel: 'Phone call', heardFrom: 'Newspaper' }],
  ];
  const pharmacy: [string, any][] = [
    [rahul, { customerName: 'Kamala Bai', contact: '9848098480', status: 'Completed', amount: 1840, paymentMethod: 'UPI', utr: '512398761234', date: istDate(-27), channel: 'Phone call', products: [
      { name: 'Metformin 500mg', quantity: 60, frequency: 'Twice a day', unitsPerDose: 1, formType: 'tablet' },
      { name: 'Amlodipine 5mg', quantity: 30, frequency: 'Once a day', unitsPerDose: 1, formType: 'tablet' },
    ], ...proof('₹1,840') }],
    [rahul, { customerName: 'Prakash Reddy', contact: '9700070000', status: 'Completed', amount: 960, paymentMethod: 'Cash', date: istDate(-4), channel: 'Walk-in', products: [
      { name: 'Ascoril LS Syrup', quantity: 100, frequency: 'Thrice a day', unitsPerDose: 5, formType: 'syrup', bottleVolume: 100, bottlesCount: 1 },
      { name: 'Budecort Inhaler', quantity: 200, frequency: 'Twice a day', unitsPerDose: 2, formType: 'inhaler' },
    ], ...proof('₹960') }],
    [rahul, { customerName: 'Anjali Mehta', contact: '9811122233', temperature: 'Warm', channel: 'WhatsApp', nextFollowUp: istDate(0), notes: 'Sent prescription photo, waiting for price quote.', products: [
      { name: 'Thyronorm 50mcg', quantity: 100, frequency: 'Once a day', unitsPerDose: 1, formType: 'tablet' },
    ] }],
    [priya, { customerName: 'Srinivas Goud', contact: '9666655555', status: 'Completed', amount: 3250, paymentMethod: 'UPI', utr: '611122334455', date: istDate(-33), channel: 'OPD/IPD referral', products: [
      { name: 'Insulin Glargine', quantity: 300, frequency: 'Once a day', unitsPerDose: 20, formType: 'injection' },
    ], ...proof('₹3,250') }],
    [priya, { customerName: 'Revathi K', contact: '9555544444', temperature: 'Hot', channel: 'Phone call', nextFollowUp: istDate(-1), products: [] }],
  ];

  const created: { token: string; type: 'medpass' | 'pharmacy'; sale: any }[] = [];
  for (const [token, data] of medpass) {
    const r = raw('createSale', token, { type: 'medpass', data: { ...base, ...data } });
    if (!r.error) created.push({ token, type: 'medpass', sale: r.sale });
  }
  for (const [token, data] of pharmacy) {
    const r = raw('createSale', token, { type: 'pharmacy', data: { ...base, ...data } });
    if (!r.error) created.push({ token, type: 'pharmacy', sale: r.sale });
  }

  const find = (name: string) => created.find((c) => c.sale.CustomerName === name)!;
  const log = (name: string, data: any) => { const c = find(name); if (c) raw('logSaleActivity', c.token, { type: c.type, id: c.sale.ID, data }); };
  log('Ramesh Kumar', { type: 'Call', direction: 'Outgoing', outcome: 'No answer' });
  log('Ramesh Kumar', { type: 'Call', direction: 'Outgoing', outcome: 'Interested', notes: 'Asked about covering his parents too.', nextFollowUp: istDate(0) });
  log('Sunita Devi', { type: 'WhatsApp', direction: 'Outgoing', outcome: 'Call back later', notes: 'Sent brochure. Will discuss with her son.', nextFollowUp: istDate(-2) });
  log('Mohan Krishna', { type: 'Call', direction: 'Incoming', outcome: 'Interested', notes: 'Called back after seeing the Instagram ad.' });
  log('Anjali Mehta', { type: 'WhatsApp', direction: 'Incoming', outcome: 'Connected', notes: 'Shared prescription.' });
  log('Gita Sharma', { type: 'Note', notes: 'Said she may reconsider after Diwali.' });

  const rem = raw('listReminders', rahul, { includeResolved: false }).reminders || [];
  if (rem[0]) raw('markContacted', rahul, { id: rem[0].ID, outcome: 'could_not_connect' });
  // Sign the seeding sessions out so they can't be reused.
  [admin, manager, rahul, priya].forEach((t) => raw('logout', t));
  seeding = false;
}

export function demoCall(action: string, token: string | null, payload?: Record<string, unknown>): Promise<any> {
  if (!backend) seed();
  const result = raw(action, token, payload);
  // A short pause so loading states look like the real thing.
  return new Promise((resolve) => setTimeout(() => resolve(result), 120));
}
