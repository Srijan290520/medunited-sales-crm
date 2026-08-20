// Reminders.gs — medicine refill reminders for Pharmacy sales.
//
// Each Pharmacy sale can carry multiple products (name, quantity, dosing
// frequency). From that we compute when each product runs out, and surface
// a reminder to the agent a few days before (or after, if overdue) so they
// can contact the customer about a refill. The reminder's *workflow state*
// (contacted / resolved / reassigned) lives in the Reminders sheet — the
// underlying countdown is always recomputed live from the sale's product
// data, never stored, so it's never stale.

var FREQUENCY_DOSES_PER_DAY = {
  'Once a day': 1,
  'Twice a day': 2,
  'Thrice a day': 3
};

var REMINDER_ATTEMPT_ESCALATE_DAYS = 3; // flag for manager attention after this many days of failed contact attempts

function frequencyOptions() {
  return Object.keys(FREQUENCY_DOSES_PER_DAY);
}

// One product line: { name, quantity, frequency }. Returns the same shape
// plus computed daysSupply / expiryDate / daysRemaining / overdue.
// Sheets silently turns a "YYYY-MM-DD" string into a real Date-typed cell,
// so by the time we read it back it may be a Date object instead of a
// string — normalize either shape to a time-zone-safe, time-of-day-free Date.
function normalizeDateOnly(value) {
  var d = (Object.prototype.toString.call(value) === '[object Date]')
    ? value
    : new Date(String(value).length <= 10 ? value + 'T00:00:00' : value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function computeProductStatus(product, saleDateStr) {
  var dosesPerDay = FREQUENCY_DOSES_PER_DAY[product.frequency] || 1;
  var quantity = Number(product.quantity) || 0;
  var daysSupply = Math.floor(quantity / dosesPerDay);

  var saleDate = normalizeDateOnly(saleDateStr);
  var expiryDate = new Date(saleDate.getTime() + daysSupply * 24 * 60 * 60 * 1000);

  var today = new Date();
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  var daysRemaining = Math.round((expiryDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

  return {
    name: product.name,
    quantity: quantity,
    frequency: product.frequency,
    daysSupply: daysSupply,
    expiryDate: expiryDate.toISOString().slice(0, 10),
    daysRemaining: daysRemaining,
    overdue: daysRemaining < 1
  };
}

// The reminder's headline urgency is driven by whichever product runs out
// soonest — that's the one that actually needs a call.
function computeReminderUrgency(products, saleDateStr) {
  var statuses = products.map(function (p) { return computeProductStatus(p, saleDateStr); });
  var soonest = statuses.reduce(function (min, s) {
    return (min === null || s.daysRemaining < min.daysRemaining) ? s : min;
  }, null);
  return {
    products: statuses,
    daysRemaining: soonest ? soonest.daysRemaining : null,
    overdue: soonest ? soonest.overdue : false
  };
}

function summarizeProducts(products) {
  return products.map(function (p) { return p.name + ' (x' + p.quantity + ', ' + p.frequency + ')'; }).join('; ');
}

function validateProducts(products) {
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('At least one product is required.');
  }
  products.forEach(function (p) {
    if (!p || !String(p.name || '').trim()) throw new Error('Every product needs a name.');
    var qty = Number(p.quantity);
    if (isNaN(qty) || qty <= 0) throw new Error('Every product needs a quantity greater than 0.');
    if (frequencyOptions().indexOf(p.frequency) === -1) throw new Error('Every product needs a valid frequency.');
  });
  return products.map(function (p) {
    return { name: String(p.name).trim(), quantity: Number(p.quantity), frequency: p.frequency };
  });
}

// Called after a Pharmacy sale is saved. Creates or refreshes the reminder
// row for that sale, or removes it if the sale is no longer Completed.
function syncReminderForSale(sale) {
  var reminders = getSheetByName('Reminders');
  var existing = sheetToObjects(reminders).find(function (r) { return String(r.PharmacySaleID) === String(sale.ID); });

  var products = [];
  try { products = JSON.parse(sale.Products || '[]'); } catch (e) { products = []; }

  var shouldExist = sale.Status === 'Completed' && products.length > 0;

  if (!shouldExist) {
    if (existing) {
      var rowIndex = findRowIndexById(reminders, existing.ID);
      if (rowIndex !== -1) reminders.deleteRow(rowIndex);
    }
    return;
  }

  if (existing) {
    // Keep workflow state (Status/AttemptCount/etc) — only refresh the data
    // that mirrors the sale, and only touch the assigned agent if a manager
    // hasn't manually reassigned this reminder.
    var patch = {
      CustomerName: sale.CustomerName,
      Contact: sale.Contact,
      Products: sale.Products,
      SaleDate: sale.Date,
      UpdatedAt: nowIso()
    };
    if (!isActive(existing.Reassigned)) {
      patch.AgentEmail = sale.AgentEmail;
      patch.AgentName = sale.AgentName;
    }
    updateObjectById(reminders, existing.ID, patch);
  } else {
    appendObject(reminders, {
      ID: newId(),
      PharmacySaleID: sale.ID,
      AgentEmail: sale.AgentEmail,
      AgentName: sale.AgentName,
      Reassigned: false,
      CustomerName: sale.CustomerName,
      Contact: sale.Contact,
      Products: sale.Products,
      SaleDate: sale.Date,
      Status: 'Active',
      ResolutionReason: '',
      AttemptCount: 0,
      LastAttemptDate: '',
      CreatedAt: nowIso(),
      UpdatedAt: nowIso()
    });
  }
}

function removeReminderForSale(saleId) {
  var reminders = getSheetByName('Reminders');
  var existing = sheetToObjects(reminders).find(function (r) { return String(r.PharmacySaleID) === String(saleId); });
  if (!existing) return;
  var rowIndex = findRowIndexById(reminders, existing.ID);
  if (rowIndex !== -1) reminders.deleteRow(rowIndex);
}

function sanitizeReminder(r) {
  var products = [];
  try { products = JSON.parse(r.Products || '[]'); } catch (e) { products = []; }
  var urgency = computeReminderUrgency(products, r.SaleDate);

  return {
    ID: r.ID,
    PharmacySaleID: r.PharmacySaleID,
    AgentEmail: r.AgentEmail,
    AgentName: r.AgentName,
    Reassigned: isActive(r.Reassigned),
    CustomerName: r.CustomerName,
    Contact: r.Contact,
    Products: urgency.products,
    DaysRemaining: urgency.daysRemaining,
    Overdue: urgency.overdue,
    Status: r.Status,
    ResolutionReason: r.ResolutionReason,
    AttemptCount: Number(r.AttemptCount) || 0,
    NeedsAttention: r.Status === 'Active' && (Number(r.AttemptCount) || 0) > 0 &&
      r.LastAttemptDate && (Date.now() - new Date(r.LastAttemptDate).getTime()) >= REMINDER_ATTEMPT_ESCALATE_DAYS * 24 * 60 * 60 * 1000,
    LastAttemptDate: r.LastAttemptDate,
    CreatedAt: r.CreatedAt
  };
}

function svc_listReminders(session, includeResolved) {
  var rows = sheetToObjects(getSheetByName('Reminders'));
  if (session.role === 'agent') {
    rows = rows.filter(function (r) { return String(r.AgentEmail).toLowerCase() === String(session.email).toLowerCase(); });
  }
  if (!includeResolved) {
    rows = rows.filter(function (r) { return r.Status === 'Active'; });
  }
  var sanitized = rows.map(sanitizeReminder);
  sanitized.sort(function (a, b) {
    if (a.Overdue !== b.Overdue) return a.Overdue ? -1 : 1;
    return a.DaysRemaining - b.DaysRemaining;
  });
  return sanitized;
}

function svc_markContacted(session, id, outcome) {
  var sheet = getSheetByName('Reminders');
  var rows = sheetToObjects(sheet);
  var existing = rows.find(function (r) { return String(r.ID) === String(id); });
  if (!existing) throw new Error('Reminder not found.');

  var isOwner = String(existing.AgentEmail).toLowerCase() === String(session.email).toLowerCase();
  if (session.role === 'agent' && !isOwner) {
    throw new AuthError('You can only update your own reminders.');
  }

  if (['not_interested', 'could_not_connect'].indexOf(outcome) === -1) {
    throw new Error('Invalid outcome.');
  }

  var patch = {
    AttemptCount: (Number(existing.AttemptCount) || 0) + 1,
    LastAttemptDate: nowIso(),
    UpdatedAt: nowIso()
  };
  if (outcome === 'not_interested') {
    patch.Status = 'Resolved';
    patch.ResolutionReason = 'NotInterested';
  } else {
    patch.ResolutionReason = 'CouldNotConnect';
  }

  var updated = updateObjectById(sheet, id, patch);
  return sanitizeReminder(updated);
}

function svc_reassignReminder(session, id, agentEmail) {
  requireRole(session, ['admin', 'manager']);
  var sheet = getSheetByName('Reminders');

  var agent = sheetToObjects(getSheetByName('Users')).find(function (u) {
    return String(u.Email).toLowerCase() === String(agentEmail).toLowerCase() && u.Role === 'agent';
  });
  if (!agent) throw new Error('Target agent not found.');

  var updated = updateObjectById(sheet, id, {
    AgentEmail: agent.Email,
    AgentName: agent.Name,
    Reassigned: true,
    UpdatedAt: nowIso()
  });
  if (!updated) throw new Error('Reminder not found.');
  return sanitizeReminder(updated);
}
