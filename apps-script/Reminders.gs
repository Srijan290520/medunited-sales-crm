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

// One product line: { name, quantity, frequency, unitsPerDose }. Returns
// the same shape plus computed daysSupply / expiryDate / daysRemaining /
// overdue. unitsPerDose is how many tablets/capsules are taken each time
// (e.g. "2 tablets twice a day"); products saved before this field existed
// count as 1 per dose, which is what the old calculation assumed.
//
// All date maths is on whole calendar days in India time (see dateKey /
// todayKey in Utils.gs), so the countdown never shifts by a day because of
// time zones.
function unitsPerDoseOf(product) {
  var n = Number(product.unitsPerDose);
  return n > 0 ? n : 1;
}

var MEDICINE_FORMS = ['tablet', 'syrup', 'inhaler', 'drops', 'cream', 'injection', 'sachet', 'course'];

// How many days one product line lasts. Mirrors getRefillDays() in the
// browser's SalesView so the form preview and the server agree.
function productDaysSupply(product) {
  var dosesPerDay = FREQUENCY_DOSES_PER_DAY[product.frequency] || 1;
  var qty = Number(product.quantity) || 0;
  var custom = Number(product.customDays) || 0;
  if (custom > 0) return Math.round(custom);
  var form = product.formType || 'tablet';
  var days;
  if (form === 'syrup') {
    var vol = (Number(product.bottleVolume) || qty || 100) * (Number(product.bottlesCount) || 1);
    var ml = Number(product.unitsPerDose) || 5;
    days = Math.floor(vol / (ml * dosesPerDay));
  } else if (form === 'inhaler') {
    var puffs = qty || 200;
    days = Math.floor(puffs / ((Number(product.unitsPerDose) || 2) * dosesPerDay));
  } else if (form === 'cream' || form === 'drops') {
    days = (qty || 1) * 15;
  } else if (form === 'injection') {
    days = Math.floor((qty || 300) / (Number(product.unitsPerDose) || 20));
  } else if (form === 'course') {
    days = qty || 7;
  } else {
    days = Math.floor(qty / (dosesPerDay * unitsPerDoseOf(product)));
  }
  return days > 0 ? days : 1;
}

function computeProductStatus(product, saleDateValue) {
  var daysSupply = productDaysSupply(product);

  var saleKey = dateKey(saleDateValue);
  if (!isDateKey(saleKey)) saleKey = todayKey(); // unreadable date: treat as sold today rather than crash
  var expiryDay = keyToDayNumber(saleKey) + daysSupply;
  var daysRemaining = expiryDay - keyToDayNumber(todayKey());

  var out = {};
  Object.keys(product).forEach(function (k) { out[k] = product[k]; });
  out.quantity = Number(product.quantity) || 0;
  out.unitsPerDose = unitsPerDoseOf(product);
  out.daysSupply = daysSupply;
  out.expiryDate = dayNumberToKey(expiryDay);
  out.daysRemaining = daysRemaining;
  out.overdue = daysRemaining < 1;
  return out;
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
  return products.map(function (p) {
    if (p.customDays) return p.name + ' (' + p.customDays + '-day course)';
    if (p.formType === 'syrup') {
      var vol = (p.bottleVolume || p.quantity) * (p.bottlesCount || 1);
      return p.name + ' (' + vol + 'ml total, ' + p.unitsPerDose + 'ml ' + p.frequency + ')';
    }
    if (p.formType === 'inhaler') return p.name + ' (' + p.quantity + ' puffs, ' + p.unitsPerDose + ' puffs ' + p.frequency + ')';
    if (p.formType === 'cream' || p.formType === 'drops') return p.name + ' (' + p.quantity + ' ' + (p.unitName || 'unit') + ', ' + p.frequency + ')';
    var perDose = unitsPerDoseOf(p);
    return p.name + ' (x' + p.quantity + ', ' + (perDose !== 1 ? perDose + ' per dose, ' : '') + p.frequency + ')';
  }).join('; ');
}

function boundedNumber(value, min, max, label) {
  if (value === undefined || value === null || value === '') return undefined;
  var n = Number(value);
  if (isNaN(n) || n < min || n > max) throw new Error(label + ' must be a number between ' + min + ' and ' + max + '.');
  return n;
}

// allowEmpty: a Pending pharmacy lead may not know its medicines yet.
function validateProducts(products, allowEmpty) {
  if (allowEmpty && Array.isArray(products) && products.length === 0) return [];
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('At least one medicine is required.');
  }
  if (products.length > 30) throw new Error('A sale can have at most 30 product lines.');
  return products.map(function (p) {
    if (!p || typeof p !== 'object') throw new Error('Invalid product line.');
    var name = cleanText(p.name, 120);
    if (!name) throw new Error('Every product needs a name.');
    var qty = boundedNumber(p.quantity, 0.01, 100000, 'Quantity');
    if (qty === undefined) throw new Error('Every product needs a quantity greater than 0.');
    var frequency = p.frequency || 'Once a day';
    if (frequencyOptions().indexOf(frequency) === -1) throw new Error('Every product needs a valid frequency.');
    var formType = p.formType || 'tablet';
    requireOneOf(formType, MEDICINE_FORMS, 'Medicine form');
    var per = boundedNumber(p.unitsPerDose, 0.01, 500, 'Units per dose');
    var line = {
      name: name,
      quantity: qty,
      frequency: frequency,
      unitsPerDose: per === undefined ? 1 : per,
      formType: formType,
      unitName: cleanText(p.unitName || (formType === 'syrup' ? 'ml' : formType === 'inhaler' ? 'puffs' : 'tabs'), 20)
    };
    var bottleVolume = boundedNumber(p.bottleVolume, 1, 10000, 'Bottle volume');
    var bottlesCount = boundedNumber(p.bottlesCount, 1, 1000, 'Bottle count');
    var customDays = boundedNumber(p.customDays, 1, 3650, 'Course length (days)');
    if (bottleVolume !== undefined) line.bottleVolume = bottleVolume;
    if (bottlesCount !== undefined) line.bottlesCount = bottlesCount;
    if (customDays !== undefined) line.customDays = customDays;
    return line;
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
      SaleDate: dateKey(sale.Date),
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
      SaleDate: dateKey(sale.Date),
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
    LastAttemptDate: isoString(r.LastAttemptDate),
    CreatedAt: isoString(r.CreatedAt),
    SaleDate: dateKey(r.SaleDate)
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
    throw new ForbiddenError('You can only update your own reminders.');
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
  audit(session, 'mark_contacted', 'Reminder', id, auditDiff(existing, patch));
  return sanitizeReminder(updated);
}

function svc_reassignReminder(session, id, agentEmail) {
  requireRole(session, TEAM_ROLES);
  var sheet = getSheetByName('Reminders');

  var agent = sheetToObjects(getSheetByName('Users')).find(function (u) {
    return String(u.Email).toLowerCase() === cleanEmail(agentEmail) && u.Role === 'agent' && isActive(u.Active);
  });
  if (!agent) throw new Error('Target agent not found.');

  var existing = sheetToObjects(sheet).find(function (r) { return String(r.ID) === String(id); });
  if (!existing) throw new Error('Reminder not found.');
  var patch = {
    AgentEmail: agent.Email,
    AgentName: agent.Name,
    Reassigned: true,
    UpdatedAt: nowIso()
  };
  var updated = updateObjectById(sheet, id, patch);
  audit(session, 'reassign', 'Reminder', id, auditDiff(existing, patch));
  return sanitizeReminder(updated);
}
