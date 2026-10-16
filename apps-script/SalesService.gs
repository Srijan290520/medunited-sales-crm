// SalesService.gs — Medpass & Pharmacy records, from first enquiry to sale.
//
// One row per customer enquiry. A row starts life as a Pending lead (with
// temperature, channel, follow-up date…), and becomes a sale when it's marked
// Completed with payment proof — or Cancelled with a lost reason. Both tabs
// share the same columns, so one set of functions serves both, keyed by
// type ('medpass' | 'pharmacy').
//
// Every rule lives here, not just in the browser:
//  - agents only ever see / touch rows where AgentEmail is their own;
//  - a Completed sale is locked for agents except its medicines and notes;
//  - Completed needs payment method, both screenshots, a UTR for UPI and an
//    amount above zero;
//  - one open (Pending) record per patient per module, and every record of a
//    patient goes to the patient's owner agent (see Patients.gs);
//  - only admins delete, and only with a reason.

// The modules themselves (and SALE_TYPES) are defined in Modules.gs.
var SALE_STATUSES = ['Pending', 'Completed', 'Cancelled'];
var PRICE_TYPES = ['Full Price', 'Discounted', 'Converted From OP'];
var PAYMENT_METHODS = ['UPI', 'Cash', 'Card', 'Net Banking'];
var ATTACHED = 'attached'; // what the browser sees instead of a Drive link

var SALE_HEADERS = ['ID', 'Date', 'AgentEmail', 'AgentName', 'CustomerName', 'Contact', 'ContactKey', 'Detail',
  'Products', 'Amount', 'Status', 'PriceType', 'PaymentMethod', 'UTR', 'BillScreenshotUrl', 'PaymentScreenshotUrl',
  'Notes', 'Temperature', 'Direction', 'Channel', 'HeardFrom', 'Consent', 'DoNotCall', 'LostReason', 'NextFollowUp',
  'CreatedAt', 'UpdatedAt', 'PatientID'];

function saleSheetName(type) {
  return getModule(type).label;
}

function getSaleSheet(type) {
  return getOrCreateSheet(saleSheetName(type), SALE_HEADERS);
}

function saleEntity(type) { return getModule(type).label + 'Sale'; }

// Agents can only see/touch their own rows.
function canAccessSale(session, sale) {
  if (session.role !== 'agent') return true;
  return String(sale.AgentEmail).toLowerCase() === String(session.email).toLowerCase();
}

function followUpStatusOf(row) {
  if (row.Status !== 'Pending') return '';
  var key = dateKey(row.NextFollowUp);
  if (!isDateKey(key)) return '';
  var diff = keyToDayNumber(key) - keyToDayNumber(todayKey());
  return diff < 0 ? 'overdue' : diff === 0 ? 'today' : 'upcoming';
}

// A sale row as the browser should see it. Drive links never leave the
// server — the browser gets "attached" and fetches images via getAttachment.
// `extras` (from recordExtras in Patients.gs) adds the patient fields.
function saleForClient(row, activities, extras) {
  if (!row) return row;
  var acts = activities || [];
  var ex = extras || { PatientID: String(row.PatientID || ''), AlsoIn: [], HouseholdSize: 1 };
  return {
    PatientID: ex.PatientID,
    AlsoIn: ex.AlsoIn,
    HouseholdSize: ex.HouseholdSize,
    ID: String(row.ID),
    Date: dateKey(row.Date),
    AgentEmail: String(row.AgentEmail || ''),
    AgentName: String(row.AgentName || ''),
    CustomerName: String(row.CustomerName || ''),
    Contact: String(row.Contact || ''),
    ContactKey: String(row.ContactKey || phoneKey(row.Contact)),
    Detail: String(row.Detail || ''),
    Products: String(row.Products || ''),
    Amount: Number(row.Amount) || 0,
    Status: SALE_STATUSES.indexOf(row.Status) !== -1 ? row.Status : 'Pending',
    PriceType: String(row.PriceType || ''),
    PaymentMethod: String(row.PaymentMethod || ''),
    UTR: String(row.UTR || ''),
    BillScreenshotUrl: row.BillScreenshotUrl ? ATTACHED : '',
    PaymentScreenshotUrl: row.PaymentScreenshotUrl ? ATTACHED : '',
    Notes: String(row.Notes || ''),
    CreatedAt: isoString(row.CreatedAt),
    Temperature: LEAD_TEMPERATURES.indexOf(row.Temperature) !== -1 ? row.Temperature : 'Warm',
    Direction: LEAD_DIRECTIONS.indexOf(row.Direction) !== -1 ? row.Direction : 'Inbound',
    Channel: String(row.Channel || ''),
    HeardFrom: String(row.HeardFrom || ''),
    Consent: row.Consent === '' || row.Consent === undefined ? true : asBool(row.Consent),
    DoNotCall: asBool(row.DoNotCall),
    LostReason: String(row.LostReason || ''),
    NextFollowUp: dateKey(row.NextFollowUp),
    FollowUpStatus: followUpStatusOf(row),
    AttemptCount: acts.filter(function (a) { return a.Direction === 'Outgoing'; }).length
  };
}

function findSaleRow(type, id) {
  return sheetToObjects(getSaleSheet(type)).find(function (r) { return String(r.ID) === String(id); }) || null;
}

function requireSale(session, type, id) {
  var row = findSaleRow(type, id);
  if (!row || !canAccessSale(session, row)) throw new Error('Record not found.');
  return row;
}

// ===== Reads =====
// A record with fresh activities and patient fields (used after every write).
function fullSaleForClient(type, row) {
  return saleForClient(row, activitiesForSale(row.ID), recordExtras(loadPatientWorld())(type, row));
}

function svc_listSales(session, type) {
  getModule(type);
  var world = loadPatientWorld();
  var extras = recordExtras(world);
  var rows = world.records.filter(function (x) { return x.type === type && canAccessSale(session, x.row); });
  var acts = activitiesBySale();
  var list = rows.map(function (x) { return saleForClient(x.row, acts[String(x.row.ID)], extras(type, x.row)); });
  var rank = { overdue: 0, today: 1, upcoming: 2, '': 3 };
  list.sort(function (a, b) {
    if (a.Status === 'Pending' && b.Status === 'Pending' && rank[a.FollowUpStatus] !== rank[b.FollowUpStatus]) {
      return rank[a.FollowUpStatus] - rank[b.FollowUpStatus];
    }
    return new Date(b.CreatedAt) - new Date(a.CreatedAt);
  });
  return list;
}

function saleDetail(session, type, row) {
  var acts = activitiesForSale(row.ID);
  return {
    sale: saleForClient(row, acts, recordExtras(loadPatientWorld())(type, row)),
    activities: acts.map(activityForClient),
    auditHistory: auditHistoryFor([row.ID])
  };
}

function svc_getSale(session, type, id) {
  return saleDetail(session, type, requireSale(session, type, id));
}

function svc_getAuditHistory(session, type, id) {
  var row = requireSale(session, type, id);
  return auditHistoryFor([row.ID]);
}

/// Used by the form as soon as a phone number is typed: who handles this
// number, who is already on it, and which modules have open records.
// Managers/admins and the owner see the people on the number; any other
// agent learns only that it is handled and by whom — never names or records.
function svc_checkContact(session, contact, exceptId) {
  var key = phoneKey(contact);
  if (!key) return { activeSales: [], pastCompletedCount: 0, owner: null, owners: [], people: [], othersCount: 0, conflict: false };
  var world = loadPatientWorld();
  ensureHousehold(world, key); // in memory only: a read never writes
  var except = String(exceptId || '');
  var active = [];
  var completed = 0;
  householdRecords(world, key).forEach(function (x) {
    var s = x.row;
    if (String(s.ID) === except) return;
    if (s.Status === 'Completed') completed++;
    if (s.Status === 'Pending') {
      var mine = canAccessSale(session, s);
      active.push({
        ID: mine ? String(s.ID) : '',
        CustomerName: mine ? String(s.CustomerName) : 'another customer record',
        AgentName: String(s.AgentName),
        Module: SALE_TYPES[x.type],
        Mine: mine
      });
    }
  });

  var me = lowerEmail(session.email);
  var privileged = session.role !== 'agent';
  var people = [];
  var others = 0;
  householdOf(world, key).forEach(function (p) {
    var o = ownerOfPatient(world, p);
    var mine = !!o && lowerEmail(o.email) === me;
    if (!privileged && !mine) { others++; return; }
    var open = {};
    patientRecords(world, p).forEach(function (x) {
      if (x.row.Status === 'Pending' && String(x.row.ID) !== except) open[x.type] = true;
    });
    people.push({
      // People found only from old rows aren't saved yet; the form then sends
      // the name, which matches them just the same.
      ID: world.added.indexOf(p) === -1 ? String(p.ID) : '',
      Name: String(p.Name),
      OwnerName: o ? o.name : '',
      OwnerEmail: o ? o.email : '',
      Mine: mine,
      Conflict: p.OwnerStatus === PATIENT_CONFLICT,
      OpenModules: moduleIds().filter(function (t) { return open[t]; }).map(function (t) { return SALE_TYPES[t]; })
    });
  });
  var owners = householdOwners(world, key);
  return {
    activeSales: active,
    pastCompletedCount: completed,
    owner: owners.length === 1 ? { name: owners[0].name, email: privileged ? owners[0].email : '', isMe: lowerEmail(owners[0].email) === me } : null,
    owners: privileged ? owners : [],
    people: people,
    othersCount: others,
    conflict: householdOf(world, key).some(function (p) { return p.OwnerStatus === PATIENT_CONFLICT; })
  };
}

// ===== Validation helpers =====
function validateCompletion(next, type) {
  if (next.Status !== 'Completed') return;
  var mod = getModule(type);
  if (mod.needsProducts) {
    var lines = [];
    try { lines = JSON.parse(next.Products || '[]'); } catch (e) { lines = []; }
    if (!lines.length) throw new Error('Add the medicines before marking this ' + mod.label + ' sale as Completed.');
  }
  if (!next.PaymentMethod) throw new Error('Payment method is required to mark this sale as Completed.');
  if (!next.hasBill) throw new Error('A bill screenshot is required to mark this sale as Completed.');
  if (!next.hasPayment) throw new Error('A payment screenshot is required to mark this sale as Completed.');
  if (next.PaymentMethod === 'UPI' && !next.UTR) throw new Error('UTR number is required for UPI payments.');
  if (!(Number(next.Amount) > 0)) throw new Error('Enter the sale amount before marking it Completed.');
}

function cleanAmount(value) {
  if (value === undefined || value === null || value === '') return 0;
  var n = Number(value);
  if (isNaN(n) || n < 0 || n > 1e8) throw new Error('Amount must be a number between 0 and 10,00,00,000.');
  return Math.round(n * 100) / 100;
}

function isDataUrl(v) { return typeof v === 'string' && v.indexOf('data:') === 0; }

// What the incoming screenshot field means for this save:
//   data:…            → a new upload
//   'attached' / same → keep what's there
//   ''                → remove it
function attachmentIntent(incoming, existingUrl) {
  if (incoming === undefined || incoming === null) return { kind: 'keep', present: !!existingUrl };
  if (isDataUrl(incoming)) return { kind: 'upload', present: true };
  if (incoming === ATTACHED || (existingUrl && incoming === existingUrl)) return { kind: 'keep', present: !!existingUrl };
  if (incoming === '') return { kind: existingUrl ? 'clear' : 'keep', present: false };
  throw new Error('Screenshots must be uploaded as image files.');
}

// Lead fields shared by create and update. Only keys present in `data` are
// returned (all of them on create).
function cleanLeadFields(data, isCreate) {
  var lists = getLists();
  var out = {};
  if (isCreate || data.temperature !== undefined) {
    out.Temperature = String(data.temperature || 'Warm');
    requireOneOf(out.Temperature, LEAD_TEMPERATURES, 'Temperature');
  }
  if (isCreate || data.direction !== undefined) {
    out.Direction = String(data.direction || 'Inbound');
    requireOneOf(out.Direction, LEAD_DIRECTIONS, 'Direction');
  }
  if (isCreate || data.channel !== undefined) {
    out.Channel = cleanText(data.channel || lists.channels[0], 50);
    requireOneOf(out.Channel, lists.channels, 'Channel');
  }
  if (isCreate || data.heardFrom !== undefined) {
    out.HeardFrom = cleanText(data.heardFrom, 50);
    if (out.HeardFrom) requireOneOf(out.HeardFrom, lists.heardFrom, 'How they heard about us');
  }
  if (isCreate || data.consent !== undefined) out.Consent = data.consent === undefined ? true : (data.consent === true || data.consent === 'true');
  if (isCreate || data.doNotCall !== undefined) out.DoNotCall = data.doNotCall === true || data.doNotCall === 'true';
  if (isCreate || data.nextFollowUp !== undefined) out.NextFollowUp = optionalDateKey(data.nextFollowUp, 'Next follow-up');
  return out;
}

var SALE_FIELD_LABELS = {
  Date: 'Date', CustomerName: 'Customer Name', Contact: 'Contact', Detail: 'Details', Amount: 'Amount',
  Status: 'Status', PriceType: 'Price Type', PaymentMethod: 'Payment Method', UTR: 'UTR', Notes: 'Notes',
  Temperature: 'Temperature', Direction: 'Direction', Channel: 'Channel', HeardFrom: 'Heard From',
  Consent: 'Consent', DoNotCall: 'Do Not Call', LostReason: 'Lost Reason', NextFollowUp: 'Next Follow-up',
  AgentName: 'Assigned Agent'
};

function displayValue(field, v) {
  if (v === undefined || v === null || v === '') return '—';
  if (field === 'Amount') return '₹' + Number(v).toLocaleString('en-IN');
  if (field === 'Consent' || field === 'DoNotCall') return asBool(v) ? 'Yes' : 'No';
  if (field === 'Date' || field === 'NextFollowUp') return dateKey(v) || '—';
  return String(v);
}

// Readable [{ field, from, to }] for the history panel.
function saleChanges(before, patch) {
  var out = [];
  Object.keys(SALE_FIELD_LABELS).forEach(function (k) {
    if (patch[k] === undefined) return;
    if (k === 'Detail' && patch.Products !== undefined) return; // shown as medications below
    var from = displayValue(k, before ? before[k] : '');
    var to = displayValue(k, patch[k]);
    if (from !== to) out.push({ field: SALE_FIELD_LABELS[k], from: from, to: to });
  });
  if (patch.Products !== undefined && (!before || String(before.Products || '') !== String(patch.Products))) {
    out.push({ field: 'Prescribed Medications', from: (before && before.Detail) || '—', to: patch.Detail || '—' });
  }
  if (patch.BillScreenshotUrl !== undefined && (!before || before.BillScreenshotUrl !== patch.BillScreenshotUrl)) {
    out.push({ field: 'Bill Proof', from: before && before.BillScreenshotUrl ? 'Attached' : 'None', to: patch.BillScreenshotUrl ? 'Updated' : 'Removed' });
  }
  if (patch.PaymentScreenshotUrl !== undefined && (!before || before.PaymentScreenshotUrl !== patch.PaymentScreenshotUrl)) {
    out.push({ field: 'Payment Proof', from: before && before.PaymentScreenshotUrl ? 'Attached' : 'None', to: patch.PaymentScreenshotUrl ? 'Updated' : 'Removed' });
  }
  return out;
}

function resolveAssignee(session, agentEmail) {
  if (!agentEmail || session.role === 'agent') return { email: session.email, name: session.name };
  var email = cleanEmail(agentEmail);
  if (email === String(session.email).toLowerCase()) return { email: session.email, name: session.name };
  var user = sheetToObjects(getSheetByName('Users')).find(function (u) {
    return String(u.Email).toLowerCase() === email && isActive(u.Active);
  });
  if (!user) throw new Error('Assigned agent not found or inactive.');
  return { email: user.Email, name: user.Name };
}

// ===== Create =====
function svc_createSale(session, type, data) {
  var mod = getModule(type);
  var sheet = getSaleSheet(type);
  var customerName = cleanText(data.customerName, 120);
  if (!customerName) throw new Error('Customer name is required.');
  var contact = cleanText(data.contact, 30);
  var contactKey = phoneKey(contact);
  if (!contactKey) throw new Error('A valid phone number is required.');

  var status = String(data.status || 'Pending');
  requireOneOf(status, SALE_STATUSES, 'Status');

  // Whose patient is this? A known patient (or a new person on a known
  // number) goes to the agent who already handles them.
  var world = loadPatientWorld();
  var link = resolvePatientOwner(world, {
    contactKey: contactKey, contact: contact, name: customerName,
    patientId: cleanText(data.patientId, 60), requested: resolveAssignee(session, data.agentEmail)
  });
  if (status === 'Pending') {
    var dup = findOpenRecordForPatient(world, type, link.patient);
    if (dup) throw new Error(openRecordMessage(session, type, dup, 'Open that record instead of creating a new one.'));
  }
  var date = data.date ? optionalDateKey(data.date, 'Date') : todayKey();
  var amount = cleanAmount(data.amount);
  var paymentMethod = cleanText(data.paymentMethod, 30);
  if (paymentMethod) requireOneOf(paymentMethod, PAYMENT_METHODS, 'Payment method');
  var utr = cleanText(data.utr, 40);
  var priceType = cleanText(data.priceType, 30);
  if (mod.priceTypes) requireOneOf(priceType, PRICE_TYPES, 'Price type');
  else priceType = '';

  var detail = cleanText(data.detail, MAX_LONG_TEXT);
  var products = [];
  if (mod.products) {
    products = validateProducts(data.products === undefined ? [] : data.products, status !== 'Completed');
    detail = summarizeProducts(products);
  }

  var lead = cleanLeadFields(data, true);
  if (lead.Direction === 'Outbound') lead.HeardFrom = '';
  var lostReason = '';
  if (status === 'Cancelled') {
    lostReason = cleanText(data.lostReason, 50);
    requireOneOf(lostReason, getLists().lostReasons, 'Lost reason');
    lead.NextFollowUp = '';
  }

  var bill = attachmentIntent(data.billScreenshot, '');
  var pay = attachmentIntent(data.paymentScreenshot, '');
  validateCompletion({ Status: status, PaymentMethod: paymentMethod, UTR: utr, Amount: amount, hasBill: bill.present, hasPayment: pay.present,
    Products: JSON.stringify(products) }, type);

  var owner = link.owner;
  var id = newId();
  var now = nowIso();
  var sale = {
    ID: id,
    Date: date,
    AgentEmail: owner.email,
    AgentName: owner.name,
    CustomerName: customerName,
    Contact: contact,
    ContactKey: contactKey,
    Detail: detail,
    Products: mod.products ? JSON.stringify(products) : '',
    Amount: amount,
    Status: status,
    PriceType: priceType,
    PaymentMethod: paymentMethod,
    UTR: utr,
    BillScreenshotUrl: bill.kind === 'upload' ? saveAttachmentFromDataUrl(data.billScreenshot, type + '_' + id + '_bill') : '',
    PaymentScreenshotUrl: pay.kind === 'upload' ? saveAttachmentFromDataUrl(data.paymentScreenshot, type + '_' + id + '_payment') : '',
    Notes: cleanText(data.notes, MAX_LONG_TEXT),
    Temperature: lead.Temperature,
    Direction: lead.Direction,
    Channel: lead.Channel,
    HeardFrom: lead.HeardFrom,
    Consent: lead.Consent,
    DoNotCall: lead.DoNotCall,
    LostReason: lostReason,
    NextFollowUp: lead.NextFollowUp,
    CreatedAt: now,
    UpdatedAt: now,
    PatientID: link.patient.ID
  };
  savePatientChanges(world);
  appendObject(sheet, sale);
  afterSaleSaved(type, sale);
  audit(session, status === 'Completed' ? 'complete' : 'create', saleEntity(type), id, saleChanges(null, sale),
    'Created ' + SALE_TYPES[type] + ' record for ' + customerName + ' (' + status + ')' +
    (link.notice && !link.conflict ? '; assigned to ' + owner.name + ', who handles this patient' : ''));
  return { sale: fullSaleForClient(type, sale), notice: link.notice };
}

// ===== Update =====
// Fields an agent may still change once their sale is Completed.
var AGENT_COMPLETED_EDITABLE = ['Products', 'Detail', 'Notes'];

function svc_updateSale(session, type, id, data) {
  var mod = getModule(type);
  var sheet = getSaleSheet(type);
  var existing = requireSale(session, type, id);
  var patch = {};

  if (data.customerName !== undefined) {
    patch.CustomerName = cleanText(data.customerName, 120);
    if (!patch.CustomerName) throw new Error('Customer name is required.');
  }
  if (data.contact !== undefined) {
    patch.Contact = cleanText(data.contact, 30);
    patch.ContactKey = phoneKey(patch.Contact);
    if (!patch.ContactKey) throw new Error('A valid phone number is required.');
  }
  if (data.date !== undefined) {
    patch.Date = optionalDateKey(data.date, 'Date');
    if (!patch.Date) throw new Error('Date is required.');
  }
  if (data.amount !== undefined) patch.Amount = cleanAmount(data.amount);
  if (data.status !== undefined) { patch.Status = String(data.status); requireOneOf(patch.Status, SALE_STATUSES, 'Status'); }
  if (data.paymentMethod !== undefined) {
    patch.PaymentMethod = cleanText(data.paymentMethod, 30);
    if (patch.PaymentMethod) requireOneOf(patch.PaymentMethod, PAYMENT_METHODS, 'Payment method');
  }
  if (data.utr !== undefined) patch.UTR = cleanText(data.utr, 40);
  if (data.notes !== undefined) patch.Notes = cleanText(data.notes, MAX_LONG_TEXT);
  if (mod.priceTypes && data.priceType !== undefined) {
    patch.PriceType = cleanText(data.priceType, 30);
    requireOneOf(patch.PriceType, PRICE_TYPES, 'Price type');
  }
  if (!mod.products && data.detail !== undefined) patch.Detail = cleanText(data.detail, MAX_LONG_TEXT);
  if (mod.products && data.products !== undefined) {
    var products = validateProducts(data.products, String(data.status || existing.Status) !== 'Completed');
    patch.Products = JSON.stringify(products);
    patch.Detail = summarizeProducts(products);
  }
  var lead = cleanLeadFields(data, false);
  Object.keys(lead).forEach(function (k) { patch[k] = lead[k]; });

  // Drop fields that aren't actually changing, so the agent lock and the
  // audit log only see real edits (the form sends every field on save).
  Object.keys(patch).forEach(function (k) {
    var before = existing[k];
    var same;
    if (k === 'Date' || k === 'NextFollowUp') same = dateKey(before) === patch[k];
    else if (k === 'Amount') same = Number(before || 0) === Number(patch[k]);
    else if (k === 'Consent') same = (before === '' || before === undefined ? true : asBool(before)) === patch[k];
    else if (k === 'DoNotCall') same = asBool(before) === patch[k];
    else same = String(before === undefined || before === null ? '' : before) === String(patch[k]);
    if (same) delete patch[k];
  });

  var bill = attachmentIntent(data.billScreenshot, existing.BillScreenshotUrl);
  var pay = attachmentIntent(data.paymentScreenshot, existing.PaymentScreenshotUrl);

  if (existing.Status === 'Completed' && session.role === 'agent') {
    var blocked = Object.keys(patch).filter(function (k) { return AGENT_COMPLETED_EDITABLE.indexOf(k) === -1; });
    if (blocked.length || bill.kind !== 'keep' || pay.kind !== 'keep') {
      throw new ForbiddenError('This sale is Completed and locked. You can still update its medicines and notes; ask a manager for anything else.');
    }
  }

  var next = {};
  SALE_HEADERS.forEach(function (h) { next[h] = patch[h] !== undefined ? patch[h] : existing[h]; });
  if (next.Direction === 'Outbound' && next.HeardFrom) { patch.HeardFrom = ''; next.HeardFrom = ''; }

  // Status transitions.
  var action = 'update';
  var summary = '';
  if (patch.Status !== undefined) {
    if (existing.Status === 'Cancelled' && next.Status === 'Pending') {
      action = 'reopen';
      if (data.temperature === undefined || patch.Temperature === undefined) { patch.Temperature = 'Hot'; next.Temperature = 'Hot'; }
      summary = cleanText(data.reopenReason, 300) || 'Record reopened to Pending.';
    } else if (next.Status === 'Cancelled') {
      action = 'cancel';
      var reason = cleanText(data.lostReason !== undefined ? data.lostReason : existing.LostReason, 50);
      requireOneOf(reason, getLists().lostReasons, 'Lost reason');
      patch.LostReason = reason; next.LostReason = reason;
      patch.NextFollowUp = ''; next.NextFollowUp = '';
      summary = 'Marked Cancelled / Lost (reason: ' + reason + ')';
    } else if (next.Status === 'Completed') {
      action = 'complete';
      summary = 'Sale completed (' + next.PaymentMethod + ', ' + displayValue('Amount', next.Amount) + ')';
    } else {
      action = 'status_change';
      summary = 'Status changed to ' + next.Status;
    }
    if (next.Status !== 'Cancelled' && existing.LostReason) { patch.LostReason = ''; next.LostReason = ''; }
  } else if (next.Status === 'Cancelled' && data.lostReason !== undefined && cleanText(data.lostReason, 50) !== String(existing.LostReason || '')) {
    patch.LostReason = cleanText(data.lostReason, 50);
    requireOneOf(patch.LostReason, getLists().lostReasons, 'Lost reason');
    next.LostReason = patch.LostReason;
  }

  // Patient and owner. A new phone number or name may make this someone
  // else's patient; going back to Pending must follow the current owner; and
  // a patient has at most one open record per module.
  var world = null;
  var notice = '';
  var relink = patch.ContactKey !== undefined || patch.CustomerName !== undefined;
  var reopening = next.Status === 'Pending' && patch.Status !== undefined && existing.Status !== 'Pending';
  if (relink || reopening) {
    world = loadPatientWorld();
    var key = String(next.ContactKey || phoneKey(next.Contact));
    var patient = null;
    if (relink) {
      ensureHousehold(world, recordContactKey(existing));
      var current = recordPatient(world, existing);
      var shared = current && patientRecords(world, current).some(function (x) { return String(x.row.ID) !== String(existing.ID); });
      if (current && String(current.ContactKey) === key && !shared && !findPerson(world, key, next.CustomerName)) {
        // Only this record uses the patient: a spelling fix, not a new person.
        changePatient(world, current, { Name: cleanText(next.CustomerName, 120), NameKey: nameKey(next.CustomerName) });
        patient = current;
      } else {
        var link = resolvePatientOwner(world, {
          contactKey: key, contact: next.Contact, name: next.CustomerName,
          requested: { email: existing.AgentEmail, name: existing.AgentName }
        });
        patient = link.patient;
        if (!link.conflict && lowerEmail(link.owner.email) !== lowerEmail(existing.AgentEmail)) {
          if (session.role === 'agent') {
            throw new ForbiddenError('This number belongs to a patient handled by ' + link.owner.name + '. Ask a manager to move the record.');
          }
          if (next.Status === 'Pending') {
            patch.AgentEmail = link.owner.email; patch.AgentName = link.owner.name;
            next.AgentEmail = link.owner.email; next.AgentName = link.owner.name;
            notice = 'Moved to ' + link.owner.name + ', who handles this patient.';
          }
        }
      }
      if (String(existing.PatientID || '') !== String(patient.ID)) { patch.PatientID = patient.ID; next.PatientID = patient.ID; }
    } else {
      var own = reopenOwnership(session, world, type, existing);
      Object.keys(own).forEach(function (k) { patch[k] = own[k]; next[k] = own[k]; });
      if (own.AgentName) notice = 'Moved to ' + own.AgentName + ', who handles this patient now.';
    }
    if (relink && next.Status === 'Pending') {
      var dup = findOpenRecordForPatient(world, type, patient, existing.ID);
      if (dup) throw new Error(openRecordMessage(session, type, dup, 'Close that one first.'));
    }
  }

  next.hasBill = bill.present;
  next.hasPayment = pay.present;
  validateCompletion(next, type);

  // Validation passed — only now touch Drive.
  if (bill.kind === 'upload') patch.BillScreenshotUrl = saveAttachmentFromDataUrl(data.billScreenshot, type + '_' + existing.ID + '_bill');
  if (bill.kind === 'clear') patch.BillScreenshotUrl = '';
  if (pay.kind === 'upload') patch.PaymentScreenshotUrl = saveAttachmentFromDataUrl(data.paymentScreenshot, type + '_' + existing.ID + '_payment');
  if (pay.kind === 'clear') patch.PaymentScreenshotUrl = '';

  if (Object.keys(patch).length === 0) return { sale: fullSaleForClient(type, existing), notice: '' };

  if (world) savePatientChanges(world);
  patch.UpdatedAt = nowIso();
  var updated = updateObjectById(sheet, existing.ID, patch);
  afterSaleSaved(type, updated);
  var changes = saleChanges(existing, patch);
  if (!summary) summary = 'Updated ' + (changes.map(function (c) { return c.field; }).join(', ') || 'details');
  if (notice) summary += ' ' + notice;
  audit(session, action, saleEntity(type), existing.ID, changes, summary);
  return { sale: fullSaleForClient(type, updated), notice: notice };
}

// Customer came back: Cancelled → Pending (Hot, follow up today). Reopening a
// Completed sale undoes revenue and incentives, so only a manager or admin
// may do that, and they must say why. The record follows the patient's
// current owner.
function svc_reopenSale(session, type, id, reason) {
  var sheet = getSaleSheet(type);
  var existing = requireSale(session, type, id);
  var why = cleanText(reason, 300);
  if (existing.Status === 'Pending') throw new Error('This record is already open.');
  if (existing.Status === 'Completed') {
    requireRole(session, ['admin', 'manager']);
    if (why.length < 3) throw new Error('Give a reason for reopening a completed sale.');
  }
  var world = loadPatientWorld();
  var own = reopenOwnership(session, world, type, existing);

  var patch = { Status: 'Pending', LostReason: '', Temperature: 'Hot', NextFollowUp: todayKey(), UpdatedAt: nowIso() };
  Object.keys(own).forEach(function (k) { patch[k] = own[k]; });
  savePatientChanges(world);
  var updated = updateObjectById(sheet, existing.ID, patch);
  var summary = why || 'Customer came back and is interested. Reopened as a Hot lead.';
  if (own.AgentName) summary += ' Moved to ' + own.AgentName + ', who handles this patient now.';
  addActivity(session, type, existing.ID, { Type: 'Note', Notes: 'Reopened: ' + summary, NextFollowUp: todayKey() });
  afterSaleSaved(type, updated);
  audit(session, 'reopen', saleEntity(type), existing.ID, saleChanges(existing, patch), summary);
  return fullSaleForClient(type, updated);
}

// Reassigning a record reassigns its patient: by default the whole household
// (scope 'household'), or only this person (scope 'person', a split). All of
// their open records in every module move; closed ones keep their agent.
function svc_reassignSale(session, type, id, agentEmail, scope, reason) {
  var result = svc_reassignPatient(session, { type: type, id: id, agentEmail: agentEmail, scope: scope, reason: reason });
  var row = findSaleRow(type, id);
  return { sale: fullSaleForClient(type, row), moved: result.moved, reminders: result.reminders, patients: result.patients };
}

function svc_deleteSale(session, type, id, reason) {
  requireRole(session, ['admin']);
  var why = cleanText(reason, 300);
  if (why.length < 3) throw new Error('A reason (at least 3 characters) is required to delete a record.');
  var sheet = getSaleSheet(type);
  var existing = findSaleRow(type, id);
  if (!existing) throw new Error('Record not found.');
  var rowIndex = findRowIndexById(sheet, existing.ID);
  if (rowIndex === -1) throw new Error('Record not found.');
  sheet.deleteRow(rowIndex);
  afterSaleDeleted(type, existing.ID);
  var snapshot = auditDiff(existing, null);
  delete snapshot.BillScreenshotUrl;
  delete snapshot.PaymentScreenshotUrl;
  audit(session, 'delete', saleEntity(type), existing.ID, snapshot,
    'Deleted record for ' + existing.CustomerName + ' (' + existing.Status + '). Reason: ' + why);
  return { deleted: true };
}

// Streams a bill/payment screenshot back through the app after checking
// that the viewer may see this record (agents: only their own).
function svc_getAttachment(session, type, id, kind) {
  var sale = requireSale(session, type, id);
  var url = kind === 'bill' ? sale.BillScreenshotUrl : kind === 'payment' ? sale.PaymentScreenshotUrl : null;
  if (!url) throw new Error('No screenshot attached.');
  return readAttachmentAsDataUrl(url);
}

// ===== Dashboard =====
// Building the summary reads every sheet, so it's cached for two minutes.
// Every successful write through the app changes the "data version" (see
// Code.gs), which changes the cache key — so new sales show up immediately.
var DASHBOARD_CACHE_SECONDS = 120;
var DATA_VERSION_KEY = 'data_version';

function getDataVersion() {
  var cache = CacheService.getScriptCache();
  var v = cache.get(DATA_VERSION_KEY);
  if (!v) {
    v = Utilities.getUuid();
    cache.put(DATA_VERSION_KEY, v, 6 * 60 * 60);
  }
  return v;
}

function bumpDataVersion() {
  CacheService.getScriptCache().put(DATA_VERSION_KEY, Utilities.getUuid(), 6 * 60 * 60);
}

function svc_dashboardSummary(session) {
  var scope = session.role === 'agent' ? 'agent_' + String(session.email).toLowerCase() : 'team';
  var key = 'dash_' + getDataVersion() + '_' + todayKey() + '_' + scope;
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var summary = computeDashboardSummary(session);
  try { cache.put(key, JSON.stringify(summary), DASHBOARD_CACHE_SECONDS); } catch (e) { /* >100KB: serve uncached */ }
  return summary;
}

// Only Completed sales count toward revenue and incentives; how each module
// pays is in its config (Modules.gs → incentiveForSale). Per-module figures
// are named <module>Count / <module>Amount (e.g. medpassCount).
function computeDashboardSummary(session) {
  var isAgent = session.role === 'agent';
  var all = [];
  moduleIds().forEach(function (type) {
    sheetToObjects(getSaleSheet(type)).forEach(function (r) {
      if (r.ID && canAccessSale(session, r)) all.push({ type: type, row: r });
    });
  });

  var ratesByEmail = {};
  sheetToObjects(getSheetByName('Users')).forEach(function (u) { ratesByEmail[String(u.Email).toLowerCase()] = u; });

  var totals = {};
  moduleIds().forEach(function (type) { totals[type + 'Count'] = 0; totals[type + 'Amount'] = 0; });
  var agents = {};
  function ensureAgent(key, name) {
    if (!agents[key]) {
      agents[key] = { agentName: String(name), agentEmail: key, incentive: 0 };
      moduleIds().forEach(function (type) { agents[key][type + 'Count'] = 0; agents[key][type + 'Amount'] = 0; });
    }
    return agents[key];
  }
  all.forEach(function (x) {
    if (x.row.Status !== 'Completed') return;
    var key = String(x.row.AgentEmail).toLowerCase();
    var amount = Number(x.row.Amount) || 0;
    var a = ensureAgent(key, x.row.AgentName);
    a[x.type + 'Count'] += 1;
    a[x.type + 'Amount'] += amount;
    a.incentive += incentiveForSale(getModule(x.type), x.row, ratesByEmail[key]);
    totals[x.type + 'Count'] += 1;
    totals[x.type + 'Amount'] += amount;
  });
  var agentsArray = Object.keys(agents).map(function (k) {
    var a = agents[k];
    a.incentive = Math.round(a.incentive * 100) / 100;
    if (isAgent) delete a.incentive; // incentive figures are manager/admin-only
    return a;
  });

  var counts = { Completed: 0, Pending: 0, Cancelled: 0 };
  all.forEach(function (x) { if (counts[x.row.Status] !== undefined) counts[x.row.Status]++; });
  var total = all.length;

  var medMap = {};
  all.forEach(function (x) {
    if (!getModule(x.type).products) return;
    var s = x.row;
    var prods = [];
    try { prods = JSON.parse(s.Products || '[]'); } catch (e) { prods = []; }
    prods.forEach(function (p) {
      var name = String(p.name || '').trim();
      if (!name) return;
      var k = name.toLowerCase();
      if (!medMap[k]) medMap[k] = { name: name, prescriptions: 0, totalUnits: 0 };
      medMap[k].prescriptions += 1;
      medMap[k].totalUnits += Number(p.quantity) || 0;
    });
  });
  var topMedications = Object.keys(medMap).map(function (k) { return medMap[k]; })
    .sort(function (a, b) { return b.prescriptions - a.prescriptions || b.totalUnits - a.totalUnits; }).slice(0, 6);

  var payMap = {};
  all.forEach(function (x) {
    if (x.row.Status !== 'Completed') return;
    var m = String(x.row.PaymentMethod || 'Other');
    if (!payMap[m]) payMap[m] = { method: m, count: 0, amount: 0 };
    payMap[m].count += 1;
    payMap[m].amount += Number(x.row.Amount) || 0;
  });
  var paymentBreakdown = Object.keys(payMap).map(function (k) { return payMap[k]; }).sort(function (a, b) { return b.count - a.count; });

  var urgentFollowUps = all.filter(function (x) { return x.row.Status === 'Pending' && isDateKey(dateKey(x.row.NextFollowUp)); })
    .map(function (x) {
      var s = x.row;
      return {
        id: String(s.ID), type: x.type, customerName: String(s.CustomerName), contact: String(s.Contact),
        detail: String(s.Detail || ''), temperature: String(s.Temperature || 'Warm'), amount: Number(s.Amount) || 0,
        agentName: String(s.AgentName), nextFollowUp: dateKey(s.NextFollowUp), followUpStatus: followUpStatusOf(s),
        notes: String(s.Notes || '').slice(0, 200)
      };
    })
    .sort(function (a, b) { return a.nextFollowUp < b.nextFollowUp ? -1 : a.nextFollowUp > b.nextFollowUp ? 1 : 0; })
    .slice(0, 5);

  // Recent activity and history: only for records this person can see.
  var visibleIds = {};
  all.forEach(function (x) { visibleIds[String(x.row.ID)] = true; });
  var recentActivities = sheetToObjects(getActivitiesSheet())
    .filter(function (a) { return visibleIds[String(a.SaleID)]; })
    .map(activityForClient)
    .sort(function (a, b) { return new Date(b.Date) - new Date(a.Date); })
    .slice(0, 8);
  var recentAudits = auditHistoryFor(Object.keys(visibleIds), 8);

  // Monthly target: this calendar month's completed revenue (India time).
  var monthPrefix = todayKey().slice(0, 7);
  var monthRevenue = 0;
  all.forEach(function (x) {
    if (x.row.Status === 'Completed' && dateKey(x.row.Date).slice(0, 7) === monthPrefix) monthRevenue += Number(x.row.Amount) || 0;
  });
  var target = getMonthlyTarget();

  return {
    totals: totals,
    agents: agentsArray,
    pipeline: {
      completed: counts.Completed, pending: counts.Pending, cancelled: counts.Cancelled, totalLeads: total,
      conversionRate: total > 0 ? Math.round((counts.Completed / total) * 100) : 0
    },
    topMedications: topMedications,
    paymentBreakdown: paymentBreakdown,
    recentAudits: recentAudits,
    recentActivities: recentActivities,
    urgentFollowUps: urgentFollowUps,
    monthlyTarget: {
      targetAmount: target,
      currentAmount: monthRevenue,
      percentage: Math.min(100, Math.round((monthRevenue / target) * 100)),
      month: monthPrefix
    }
  };
}
