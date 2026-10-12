// SalesService.gs — Medpass & Pharmacy sale entries
//
// Both sheets share the same shape, so one set of functions serves both,
// keyed by "type" ('medpass' | 'pharmacy'). Row-level access is enforced
// here, not just hidden in the UI: agents only ever see/edit rows where
// AgentEmail matches their own session.

var SALE_TYPES = { medpass: 'Medpass', pharmacy: 'Pharmacy' };
var SALE_STATUSES = ['Pending', 'Completed', 'Cancelled'];

function validateStatus(status) {
  if (SALE_STATUSES.indexOf(status) === -1) {
    throw new Error('Status must be one of: ' + SALE_STATUSES.join(', ') + '.');
  }
}

// Agents can only see/touch their own rows.
function canAccessSale(session, sale) {
  if (session.role !== 'agent') return true;
  return String(sale.AgentEmail).toLowerCase() === String(session.email).toLowerCase();
}

function saleSheetName(type) {
  var name = SALE_TYPES[type];
  if (!name) throw new Error('Invalid sale type: ' + type);
  return name;
}

function svc_listSales(session, type) {
  var rows = sheetToObjects(getSheetByName(saleSheetName(type)));
  rows = rows.filter(function (r) { return canAccessSale(session, r); });
  return rows.sort(function (a, b) { return new Date(b.CreatedAt) - new Date(a.CreatedAt); });
}

// A sale can only be marked Completed once there's proof: payment method,
// a bill screenshot, and a payment screenshot — plus a UTR if paid by UPI.
// Enforced here (not just in the form) so the rule can't be bypassed by
// calling the API directly.
function validateCompletionRequirements(status, paymentMethod, utr, billUrl, paymentUrl) {
  if (status !== 'Completed') return;
  if (!paymentMethod) throw new Error('Payment method is required to mark this sale as Completed.');
  if (!billUrl) throw new Error('A bill screenshot is required to mark this sale as Completed.');
  if (!paymentUrl) throw new Error('A payment screenshot is required to mark this sale as Completed.');
  if (paymentMethod === 'UPI' && !utr) throw new Error('UTR number is required for UPI payments.');
}

// "Converted From OP" counts as Full Price for incentive purposes — the
// incentive calc below only special-cases 'Discounted', so anything else
// (including this) already falls through to the full rate automatically.
var PRICE_TYPES = ['Full Price', 'Discounted', 'Converted From OP'];

function svc_createSale(session, type, data) {
  var sheet = getSheetByName(saleSheetName(type));
  var customerName = String(data.customerName || '').trim();
  var amount = Number(data.amount);
  var status = data.status || 'Pending';
  var paymentMethod = String(data.paymentMethod || '').trim();
  var utr = String(data.utr || '').trim();
  var priceType = String(data.priceType || '').trim();

  if (!customerName) throw new Error('Customer name is required.');
  validateStatus(status);
  if (isNaN(amount) || amount < 0) throw new Error('Amount must be a non-negative number.');
  // Medpass incentive rates depend on this, so it's required at creation —
  // unlike payment proof, which is only required once a sale is Completed.
  if (type === 'medpass' && PRICE_TYPES.indexOf(priceType) === -1) {
    throw new Error('Price type (Full Price or Discounted) is required for Medpass sales.');
  }

  // Pharmacy sales carry structured product lines (name/quantity/frequency)
  // instead of free-text detail — Detail becomes an auto-generated summary,
  // and the structured data drives refill reminders.
  var detail = String(data.detail || '').trim();
  var products = [];
  if (type === 'pharmacy') {
    products = validateProducts(data.products);
    detail = summarizeProducts(products);
  }

  var id = newId();
  var billUrl = data.billScreenshot ? saveAttachmentFromDataUrl(data.billScreenshot, type + '_' + id + '_bill') : '';
  var paymentUrl = data.paymentScreenshot ? saveAttachmentFromDataUrl(data.paymentScreenshot, type + '_' + id + '_payment') : '';

  validateCompletionRequirements(status, paymentMethod, utr, billUrl, paymentUrl);

  var sale = {
    ID: id,
    Date: data.date || nowIso().slice(0, 10),
    AgentEmail: session.email,
    AgentName: session.name,
    CustomerName: customerName,
    Contact: String(data.contact || '').trim(),
    Detail: detail,
    Products: type === 'pharmacy' ? JSON.stringify(products) : '',
    Amount: amount,
    Status: status,
    PriceType: priceType,
    PaymentMethod: paymentMethod,
    UTR: utr,
    BillScreenshotUrl: billUrl,
    PaymentScreenshotUrl: paymentUrl,
    Notes: String(data.notes || '').trim(),
    CreatedAt: nowIso()
  };
  appendObject(sheet, sale);
  if (type === 'pharmacy') syncReminderForSale(sale);
  audit(session, 'create', SALE_TYPES[type] + 'Sale', id, auditDiff(null, sale));
  return sale;
}

function svc_updateSale(session, type, id, data) {
  var sheet = getSheetByName(saleSheetName(type));
  var rows = sheetToObjects(sheet);
  var existing = rows.find(function (r) { return String(r.ID) === String(id); });
  if (!existing) throw new Error('Sale not found.');

  if (!canAccessSale(session, existing)) {
    throw new ForbiddenError('You can only edit your own entries.');
  }
  // Once a sale is Completed it drives revenue and incentive payouts, so
  // agents can't change it any more — a manager or admin has to.
  if (session.role === 'agent' && existing.Status === 'Completed') {
    throw new ForbiddenError('This sale is Completed and locked. Ask a manager to make changes.');
  }

  var fieldMap = {
    date: 'Date', customerName: 'CustomerName', contact: 'Contact', detail: 'Detail',
    amount: 'Amount', status: 'Status', notes: 'Notes', paymentMethod: 'PaymentMethod', utr: 'UTR',
    priceType: 'PriceType'
  };
  var patch = {};
  Object.keys(fieldMap).forEach(function (key) {
    if (data[key] === undefined) return;
    patch[fieldMap[key]] = key === 'amount' ? Number(data[key]) : String(data[key]).trim();
  });

  if (patch.Status !== undefined) validateStatus(patch.Status);
  if (patch.Amount !== undefined && (isNaN(patch.Amount) || patch.Amount < 0)) {
    throw new Error('Amount must be a non-negative number.');
  }
  if (type === 'medpass' && patch.PriceType !== undefined && PRICE_TYPES.indexOf(patch.PriceType) === -1) {
    throw new Error('Price type (Full Price or Discounted) is required for Medpass sales.');
  }

  if (type === 'pharmacy' && data.products !== undefined) {
    var products = validateProducts(data.products);
    patch.Products = JSON.stringify(products);
    patch.Detail = summarizeProducts(products);
  }

  if (data.billScreenshot) {
    patch.BillScreenshotUrl = saveAttachmentFromDataUrl(data.billScreenshot, type + '_' + id + '_bill');
  }
  if (data.paymentScreenshot) {
    patch.PaymentScreenshotUrl = saveAttachmentFromDataUrl(data.paymentScreenshot, type + '_' + id + '_payment');
  }

  // Validate against the *resulting* state (existing + this patch combined),
  // since marking Completed might rely on screenshots uploaded in an earlier edit.
  validateCompletionRequirements(
    patch.Status !== undefined ? patch.Status : existing.Status,
    patch.PaymentMethod !== undefined ? patch.PaymentMethod : existing.PaymentMethod,
    patch.UTR !== undefined ? patch.UTR : existing.UTR,
    patch.BillScreenshotUrl !== undefined ? patch.BillScreenshotUrl : existing.BillScreenshotUrl,
    patch.PaymentScreenshotUrl !== undefined ? patch.PaymentScreenshotUrl : existing.PaymentScreenshotUrl
  );

  var updated = updateObjectById(sheet, id, patch);
  if (type === 'pharmacy') syncReminderForSale(updated);
  audit(session, 'update', SALE_TYPES[type] + 'Sale', id, auditDiff(existing, patch));
  return updated;
}

function svc_deleteSale(session, type, id) {
  requireRole(session, ['admin', 'manager']);
  var sheet = getSheetByName(saleSheetName(type));
  var existing = sheetToObjects(sheet).find(function (r) { return String(r.ID) === String(id); });
  var rowIndex = findRowIndexById(sheet, id);
  if (rowIndex === -1) throw new Error('Sale not found.');
  sheet.deleteRow(rowIndex);
  if (type === 'pharmacy') removeReminderForSale(id);
  audit(session, 'delete', SALE_TYPES[type] + 'Sale', id, auditDiff(existing, null));
  return { deleted: true };
}

// Streams a bill/payment screenshot back through the app after checking
// that the viewer may see this sale (agents: only their own).
function svc_getAttachment(session, type, id, kind) {
  var rows = sheetToObjects(getSheetByName(saleSheetName(type)));
  var sale = rows.find(function (r) { return String(r.ID) === String(id); });
  if (!sale || !canAccessSale(session, sale)) throw new Error('Sale not found.');

  var url = kind === 'bill' ? sale.BillScreenshotUrl : kind === 'payment' ? sale.PaymentScreenshotUrl : null;
  if (!url) throw new Error('No screenshot attached.');
  return readAttachmentAsDataUrl(url);
}

// Aggregated per-agent counts, amounts and computed incentive totals.
// Agents only ever see their own row here too, because svc_listSales
// already filtered the underlying rows for them. Only Completed sales
// count — Cancelled ones didn't happen, and Pending ones aren't confirmed
// yet (no payment proof), so neither should count toward sales totals,
// revenue, or incentive payouts.
//
// Incentive math differs by type: Medpass pays a flat rate per sale that
// depends on whether it was Full Price or Discounted; Pharmacy pays a
// percentage of the sale amount. Both are per-agent rates set on the
// Incentives page.
function svc_dashboardSummary(session) {
  function onlyCompleted(rows) {
    return rows.filter(function (r) { return r.Status === 'Completed'; });
  }
  var medpass = onlyCompleted(svc_listSales(session, 'medpass'));
  var pharmacy = onlyCompleted(svc_listSales(session, 'pharmacy'));

  var rateByEmail = {};
  sheetToObjects(getSheetByName('Users')).forEach(function (u) {
    rateByEmail[String(u.Email).toLowerCase()] = {
      medpassFullRate: Number(u.MedpassFullRate) || 0,
      medpassDiscountRate: Number(u.MedpassDiscountRate) || 0,
      pharmacyIncentivePercent: Number(u.PharmacyIncentivePercent) || 0
    };
  });

  var agents = {};
  function ensureAgent(key, name) {
    if (!agents[key]) {
      agents[key] = { agentName: name, agentEmail: key, medpassCount: 0, pharmacyCount: 0, medpassAmount: 0, pharmacyAmount: 0, incentive: 0 };
    }
    return agents[key];
  }

  medpass.forEach(function (r) {
    var key = String(r.AgentEmail).toLowerCase();
    var a = ensureAgent(key, r.AgentName);
    a.medpassCount += 1;
    a.medpassAmount += Number(r.Amount) || 0;
    var rate = rateByEmail[key] || { medpassFullRate: 0, medpassDiscountRate: 0 };
    a.incentive += r.PriceType === 'Discounted' ? rate.medpassDiscountRate : rate.medpassFullRate;
  });

  pharmacy.forEach(function (r) {
    var key = String(r.AgentEmail).toLowerCase();
    var a = ensureAgent(key, r.AgentName);
    a.pharmacyCount += 1;
    var amount = Number(r.Amount) || 0;
    a.pharmacyAmount += amount;
    var rate = rateByEmail[key] || { pharmacyIncentivePercent: 0 };
    a.incentive += amount * (rate.pharmacyIncentivePercent / 100);
  });

  var agentsArray = Object.keys(agents).map(function (k) { return agents[k]; });

  // Incentive figures are manager/admin-only — stripped here, not just
  // hidden in the UI, so an agent's session can't fetch them either way.
  if (session.role === 'agent') {
    agentsArray.forEach(function (a) { delete a.incentive; });
  }

  return {
    totals: {
      medpassCount: medpass.length,
      pharmacyCount: pharmacy.length,
      medpassAmount: medpass.reduce(function (s, r) { return s + (Number(r.Amount) || 0); }, 0),
      pharmacyAmount: pharmacy.reduce(function (s, r) { return s + (Number(r.Amount) || 0); }, 0)
    },
    agents: agentsArray
  };
}
