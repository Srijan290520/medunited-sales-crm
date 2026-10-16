// Homekare.gs — home nursing / caretaker / procedure services.
//
// A Homekare record lists one or more services from the catalogue below,
// each with the price agreed for this patient (prices vary per patient, so
// they are typed, not looked up). The amount is the sum of the lines,
// worked out on the server. Service names are kept exactly as MedUnited's
// billing system has them.
//
// Monthly packages: when a record with a monthly service is Completed, a
// renewal reminder is created on the Reminders page, due a few days before
// the month ends (the package runs from the record date for one month).
// A newer completed monthly order for the same patient resolves the old
// reminder as Renewed.
//
// Visit dates, number of days and the staff sent are not tracked yet (to be
// decided); they can be added later as extra columns.

var HOMEKARE_RENEWAL_DAYS_BEFORE = 5;
var MAX_SERVICE_LINES = 30;

// name | how it is usually charged | monthly package?
var HOMEKARE_SERVICES = [
  ['HOMEKARE - BED RETURN TRANSPORT CHARGES', 'Per trip', false],
  ['HOMEKARE - BLOOD TRANSFUSION CHARGES', 'Per visit', false],
  ['HOMEKARE - CARE TAKER SERVICE 1HR', 'Per hour', false],
  ['HOMEKARE - CARE TAKER SERVICE 24HRs', 'Per 24-hour shift', false],
  ['HOMEKARE - CARE TAKER SERVICE WITH TRAVEL CHARGES MONTHLY PACKAGE', 'Per month (package)', true],
  ['HOMEKARE - CARETAKER PER DAY', 'Per day', false],
  ['HOMEKARE - CARETAKER SERVICE MONTHY', 'Per month', true],
  ['HOMEKARE - ECG', 'Per visit', false],
  ['HOMEKARE - INJECTION', 'Per visit', false],
  ['HOMEKARE - MAJOR DRESSING', 'Per visit', false],
  ['HOMEKARE - MAJOR DRESSING MOTHLY', 'Per month (package)', true],
  ['HOMEKARE - MINOR DRESSING', 'Per visit', false],
  ['HOMEKARE - NURSING 12Hrs', 'Per 12-hour shift', false],
  ['HOMEKARE - NURSING 4HRS', 'Per 4-hour shift', false],
  ['HOMEKARE - PATIENT CARE 12 Hrs', 'Per 12-hour shift', false],
  ['HOMEKARE - RYLES TUBE FEEDING', 'Per visit', false],
  ['HOMEKARE - SUCTION OPERATOR PORTABLE (per day)', 'Per day', false],
  ['HOMEKARE - SUCTION OPERATOR PORTABLE (per month)', 'Per month', true],
  ['HOMEKARE 2 FUNCTIONAL BED RENT PER DAY', 'Per day (rental)', false],
  ['HOMEKARE CONSULTATION', 'Per visit', false],
  ['HOMEKARE ELETROTHERAPY SINGLE MODALITY', 'Per session', false],
  ['HOMEKARE EXERCISE THERAPY', 'Per session', false],
  ['HOMEKARE FOLEYS CATHERIZATION', 'Per visit', false],
  ['HOMEKARE FOLEYS REMOVAL', 'Per visit', false],
  ['HOMEKARE GENERAL MEDICINE CONSULTATAION', 'Per visit', false],
  ['HOMEKARE GENERAL PRACTIONER CONSULTATION', 'Per visit', false],
  ['HOMEKARE IM INJECTION', 'Per visit', false],
  ['HOMEKARE IV CANNULATION', 'Per visit', false],
  ['HOMEKARE IV CANNULATION  INJECTIONS', 'Per visit', false],
  ['HOMEKARE IV INJECTION', 'Per visit', false],
  ['HOMEKARE LIMB ELIVATION', 'Per visit', false],
  ['HOMEKARE MAJOR SUTURING', 'Per visit', false],
  ['HOMEKARE MINOR SUTURING', 'Per visit', false],
  ['HOMEKARE NEBULISATION', 'Per visit', false],
  ['HOMEKARE NURSING CHARGES (6Hrs)', 'Per 6-hour shift', false],
  ['HOMEKARE RYLES TUBE INSERTION', 'Per visit', false],
  ['HOMEKARE TRAVEL CHARGES', 'Per visit (add-on)', false],
  ['HOMEKARE VITALS AND GRBS', 'Per visit', false]
];

// The list in use: the built-in services above, plus any added in Settings
// (homekareServicesExtra), with some hidden from the picker
// (homekareServicesHidden). Hidden services stay valid, so older records
// that use them still save. Nothing is ever deleted.
var homekareListCache_ = null; // one read per request; cleared when the list changes

function serviceKey(name) { return cleanText(name, 200).toLowerCase().replace(/\s+/g, ' '); }

function readSettingList(key) {
  try {
    var v = JSON.parse(getSetting(key, '[]') || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function homekareServiceList() {
  if (homekareListCache_) return homekareListCache_;
  var hidden = {};
  readSettingList('homekareServicesHidden').forEach(function (n) { hidden[serviceKey(n)] = true; });
  var list = HOMEKARE_SERVICES.map(function (s) { return { name: s[0], unit: s[1], monthly: s[2], builtIn: true }; });
  readSettingList('homekareServicesExtra').forEach(function (x) {
    if (x && x.name) list.push({ name: String(x.name), unit: String(x.unit || ''), monthly: x.monthly === true, builtIn: false });
  });
  list.forEach(function (x) { x.hidden = !!hidden[serviceKey(x.name)]; });
  homekareListCache_ = list;
  return list;
}

function homekareCatalogue() {
  return homekareServiceList().map(function (s) {
    return { name: s.name, unit: s.unit, monthly: s.monthly, hidden: s.hidden, builtIn: s.builtIn };
  });
}

// Matching ignores case and repeated spaces, then returns [name, unit, monthly].
function findHomekareService(name) {
  var key = serviceKey(name);
  var list = homekareServiceList();
  for (var i = 0; i < list.length; i++) {
    if (serviceKey(list[i].name) === key) return [list[i].name, list[i].unit, list[i].monthly];
  }
  return null;
}

// Admin or senior manager: { add: { name, unit, monthly } } | { hide: name } | { show: name }.
function svc_updateHomekareCatalogue(session, data) {
  requireRole(session, SENIOR_ROLES);
  data = data || {};
  var summary;
  if (data.add) {
    var name = cleanText(data.add.name, 120);
    if (name.length < 3) throw new Error('Give the service a name (at least 3 characters).');
    if (findHomekareService(name)) throw new Error('"' + name + '" is already in the list.');
    var extra = readSettingList('homekareServicesExtra');
    extra.push({ name: name, unit: cleanText(data.add.unit, 40), monthly: data.add.monthly === true });
    setSetting(session, 'homekareServicesExtra', JSON.stringify(extra));
    summary = 'Added Homekare service ' + name + (data.add.monthly === true ? ' (monthly package)' : '');
  } else if (data.hide || data.show) {
    var s = findHomekareService(data.hide || data.show);
    if (!s) throw new Error('That service is not in the list.');
    var hidden = readSettingList('homekareServicesHidden').filter(function (n) { return serviceKey(n) !== serviceKey(s[0]); });
    if (data.hide) hidden.push(s[0]);
    setSetting(session, 'homekareServicesHidden', JSON.stringify(hidden));
    summary = (data.hide ? 'Hid' : 'Showed again') + ' Homekare service ' + s[0];
  } else {
    throw new Error('Nothing to change.');
  }
  homekareListCache_ = null;
  audit(session, 'update_settings', 'Settings', 'homekareServices', null, summary);
  return homekareCatalogue();
}

function parseLines(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  try { var v = JSON.parse(value); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

function linePrice(value, label) {
  var n = Number(value);
  if (value === '' || value === undefined || value === null || !isFinite(n) || n < 0 || n > 10000000 || Math.round(n * 100) / 100 !== n) {
    throw new Error('Enter a price between ₹0 and ₹1,00,00,000 for ' + label + '.');
  }
  return n;
}

function validateHomekareServices(raw) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw || '[]'); } catch (e) { throw new Error('The services list is not valid.'); }
  }
  if (raw === undefined || raw === null) raw = [];
  if (!Array.isArray(raw)) throw new Error('The services list is not valid.');
  if (raw.length > MAX_SERVICE_LINES) throw new Error('A record can list at most ' + MAX_SERVICE_LINES + ' services.');
  return raw.map(function (l) {
    l = l && typeof l === 'object' ? l : {};
    var s = findHomekareService(l.service);
    if (!s) throw new Error('"' + cleanText(l.service, 80) + '" is not a Homekare service. Pick one from the list.');
    return { service: s[0], price: linePrice(l.price, s[0]) };
  });
}

function sumLines(lines) {
  return Math.round(lines.reduce(function (t, l) { return t + l.price; }, 0) * 100) / 100;
}

function summarizeServices(lines) {
  return lines.map(function (l) { return l.service.replace(/^HOMEKARE\s*-?\s*/i, '') + ' (₹' + l.price + ')'; }).join(', ');
}

function monthlyServices(lines) {
  return lines.filter(function (l) { var s = findHomekareService(l.service); return s && s[2]; });
}

// Last day of a one-month package that starts on `key`: the day before the
// same date next month (1 Oct → 31 Oct, 15 Oct → 14 Nov). When next month
// has no such date, the package runs to the end of next month (31 Jan → 28 Feb).
function monthEnd(key) {
  var p = String(key).split('-').map(Number);
  var y = p[0] + (p[1] === 12 ? 1 : 0);
  var m = p[1] === 12 ? 1 : p[1] + 1; // 1-based next month
  var lastOfNext = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (p[2] > lastOfNext) return dayNumberToKey(Date.UTC(y, m - 1, lastOfNext) / DAY_MS);
  return dayNumberToKey(Date.UTC(y, m - 1, p[2]) / DAY_MS - 1);
}

// ===== Hooks (see Modules.gs) =====
function homekarePrepareSave(session, ctx) {
  var data = ctx.data || {};
  var lines = validateHomekareServices(data.services !== undefined ? data.services : (ctx.existing ? ctx.existing.Services : []));
  return { fields: { Services: JSON.stringify(lines), Amount: sumLines(lines), Detail: summarizeServices(lines) }, warnings: [] };
}

function homekareValidateCompletion(next) {
  if (!parseLines(next.Services).length) throw new Error('Add the services before marking this Homekare record as Completed.');
}

function homekareClientFields(row) {
  var lines = parseLines(row.Services);
  return { Services: lines, MonthlyPackage: monthlyServices(lines).length > 0 };
}

function homekarePrepareImport(r, errors) {
  return { Amount: 0, Services: '[]' };
}

// Create, refresh or remove the renewal reminder for one Homekare record.
function homekareAfterSave(sale) {
  var sheet = getRemindersSheet();
  var rows = sheetToObjects(sheet);
  var existing = rows.filter(function (r) { return r.SaleType === 'homekare' && String(r.SaleID) === String(sale.ID); })[0];
  var monthly = monthlyServices(parseLines(sale.Services));
  if (sale.Status !== 'Completed' || !monthly.length) {
    if (existing) {
      var idx = findRowIndexById(sheet, existing.ID);
      if (idx !== -1) sheet.deleteRow(idx);
    }
    return;
  }
  var start = dateKey(sale.Date);
  var end = monthEnd(start);
  var mirror = {
    CustomerName: sale.CustomerName, Contact: sale.Contact, SaleDate: start, EndDate: end,
    DueDate: dayNumberToKey(keyToDayNumber(end) - HOMEKARE_RENEWAL_DAYS_BEFORE),
    Detail: monthly.map(function (l) { return l.service; }).join(', '), PatientID: sale.PatientID || '', UpdatedAt: nowIso()
  };
  if (existing) {
    if (!isActive(existing.Reassigned)) { mirror.AgentEmail = sale.AgentEmail; mirror.AgentName = sale.AgentName; }
    updateObjectById(sheet, existing.ID, mirror);
    return;
  }
  // A new monthly package for this patient renews the previous one.
  rows.forEach(function (r) {
    if (r.Kind !== 'renewal' || r.Status !== 'Active' || String(r.SaleID) === String(sale.ID)) return;
    var samePatient = sale.PatientID ? String(r.PatientID) === String(sale.PatientID)
      : recordContactKey(r) === recordContactKey(sale) && nameKey(r.CustomerName) === nameKey(sale.CustomerName);
    if (samePatient) updateObjectById(sheet, r.ID, { Status: 'Resolved', ResolutionReason: 'Renewed', UpdatedAt: nowIso() });
  });
  appendObject(sheet, Object.assign({
    ID: newId(), Kind: 'renewal', SaleType: 'homekare', SaleID: sale.ID, PharmacySaleID: '',
    AgentEmail: sale.AgentEmail, AgentName: sale.AgentName, Reassigned: false, Products: '',
    Status: 'Active', ResolutionReason: '', AttemptCount: 0, LastAttemptDate: '', CreatedAt: nowIso()
  }, mirror));
}

function homekareAfterDelete(saleId) {
  var sheet = getRemindersSheet();
  var existing = sheetToObjects(sheet).filter(function (r) { return r.SaleType === 'homekare' && String(r.SaleID) === String(saleId); })[0];
  if (!existing) return;
  var idx = findRowIndexById(sheet, existing.ID);
  if (idx !== -1) sheet.deleteRow(idx);
}
