// SalesService.gs — Medpass & Pharmacy sale entries
//
// Both sheets share the same shape, so one set of functions serves both,
// keyed by "type" ('medpass' | 'pharmacy'). Row-level access is enforced
// here, not just hidden in the UI: agents only ever see/edit rows where
// AgentEmail matches their own session.

var SALE_TYPES = { medpass: 'Medpass', pharmacy: 'Pharmacy' };

function saleSheetName(type) {
  var name = SALE_TYPES[type];
  if (!name) throw new Error('Invalid sale type: ' + type);
  return name;
}

function svc_listSales(session, type) {
  var rows = sheetToObjects(getSheetByName(saleSheetName(type)));
  if (session.role === 'agent') {
    rows = rows.filter(function (r) {
      return String(r.AgentEmail).toLowerCase() === String(session.email).toLowerCase();
    });
  }
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

function svc_createSale(session, type, data) {
  var sheet = getSheetByName(saleSheetName(type));
  var customerName = String(data.customerName || '').trim();
  var amount = Number(data.amount);
  var status = data.status || 'Pending';
  var paymentMethod = String(data.paymentMethod || '').trim();
  var utr = String(data.utr || '').trim();

  if (!customerName) throw new Error('Customer name is required.');
  if (isNaN(amount) || amount < 0) throw new Error('Amount must be a non-negative number.');

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
    Detail: String(data.detail || '').trim(),
    Amount: amount,
    Status: status,
    PaymentMethod: paymentMethod,
    UTR: utr,
    BillScreenshotUrl: billUrl,
    PaymentScreenshotUrl: paymentUrl,
    Notes: String(data.notes || '').trim(),
    CreatedAt: nowIso()
  };
  appendObject(sheet, sale);
  return sale;
}

function svc_updateSale(session, type, id, data) {
  var sheet = getSheetByName(saleSheetName(type));
  var rows = sheetToObjects(sheet);
  var existing = rows.find(function (r) { return String(r.ID) === String(id); });
  if (!existing) throw new Error('Sale not found.');

  var isOwner = String(existing.AgentEmail).toLowerCase() === String(session.email).toLowerCase();
  if (session.role === 'agent' && !isOwner) {
    throw new AuthError('You can only edit your own entries.');
  }

  var fieldMap = {
    date: 'Date', customerName: 'CustomerName', contact: 'Contact', detail: 'Detail',
    amount: 'Amount', status: 'Status', notes: 'Notes', paymentMethod: 'PaymentMethod', utr: 'UTR'
  };
  var patch = {};
  Object.keys(fieldMap).forEach(function (key) {
    if (data[key] === undefined) return;
    patch[fieldMap[key]] = key === 'amount' ? Number(data[key]) : String(data[key]).trim();
  });

  if (patch.Amount !== undefined && (isNaN(patch.Amount) || patch.Amount < 0)) {
    throw new Error('Amount must be a non-negative number.');
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

  return updateObjectById(sheet, id, patch);
}

function svc_deleteSale(session, type, id) {
  requireRole(session, ['admin', 'manager']);
  var sheet = getSheetByName(saleSheetName(type));
  var rowIndex = findRowIndexById(sheet, id);
  if (rowIndex === -1) throw new Error('Sale not found.');
  sheet.deleteRow(rowIndex);
  return { deleted: true };
}

// Aggregated per-agent counts, amounts and computed incentive totals.
// Agents only ever see their own row here too, because svc_listSales
// already filtered the underlying rows for them. Cancelled sales are
// excluded — they didn't happen, so they shouldn't count toward sales
// totals, revenue, or incentive payouts.
function svc_dashboardSummary(session) {
  function excludeCancelled(rows) {
    return rows.filter(function (r) { return r.Status !== 'Cancelled'; });
  }
  var medpass = excludeCancelled(svc_listSales(session, 'medpass'));
  var pharmacy = excludeCancelled(svc_listSales(session, 'pharmacy'));

  function groupByAgent(rows) {
    var byAgent = {};
    rows.forEach(function (r) {
      var key = String(r.AgentEmail).toLowerCase();
      if (!byAgent[key]) byAgent[key] = { agentName: r.AgentName, agentEmail: r.AgentEmail, count: 0, amount: 0 };
      byAgent[key].count += 1;
      byAgent[key].amount += Number(r.Amount) || 0;
    });
    return byAgent;
  }

  var medpassByAgent = groupByAgent(medpass);
  var pharmacyByAgent = groupByAgent(pharmacy);

  var rateByEmail = {};
  sheetToObjects(getSheetByName('Users')).forEach(function (u) {
    rateByEmail[String(u.Email).toLowerCase()] = {
      medpassIncentive: Number(u.MedpassIncentive) || 0,
      pharmacyIncentive: Number(u.PharmacyIncentive) || 0
    };
  });

  var agents = {};
  function ensureAgent(key, name) {
    if (!agents[key]) {
      agents[key] = { agentName: name, agentEmail: key, medpassCount: 0, pharmacyCount: 0, medpassAmount: 0, pharmacyAmount: 0, incentive: 0 };
    }
    return agents[key];
  }
  Object.keys(medpassByAgent).forEach(function (key) {
    var a = ensureAgent(key, medpassByAgent[key].agentName);
    a.medpassCount = medpassByAgent[key].count;
    a.medpassAmount = medpassByAgent[key].amount;
  });
  Object.keys(pharmacyByAgent).forEach(function (key) {
    var a = ensureAgent(key, pharmacyByAgent[key].agentName);
    a.pharmacyCount = pharmacyByAgent[key].count;
    a.pharmacyAmount = pharmacyByAgent[key].amount;
  });
  Object.keys(agents).forEach(function (key) {
    var rate = rateByEmail[key] || { medpassIncentive: 0, pharmacyIncentive: 0 };
    var a = agents[key];
    a.incentive = (a.medpassCount * rate.medpassIncentive) + (a.pharmacyCount * rate.pharmacyIncentive);
  });

  return {
    totals: {
      medpassCount: medpass.length,
      pharmacyCount: pharmacy.length,
      medpassAmount: medpass.reduce(function (s, r) { return s + (Number(r.Amount) || 0); }, 0),
      pharmacyAmount: pharmacy.reduce(function (s, r) { return s + (Number(r.Amount) || 0); }, 0)
    },
    agents: Object.keys(agents).map(function (k) { return agents[k]; })
  };
}
