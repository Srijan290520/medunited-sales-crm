// Lists.gs — admin-editable dropdown options and app settings.
//
//   Lists     Key | Values (JSON array)   — channels, heard-from, lost reasons
//   Settings  Key | Value                 — monthly revenue target, etc.
//
// Both tabs are created automatically on first use.

var LEAD_TEMPERATURES = ['Hot', 'Warm', 'Cold'];
var LEAD_DIRECTIONS = ['Inbound', 'Outbound'];
var ACTIVITY_TYPES = ['Call', 'WhatsApp', 'Visit', 'SMS', 'Email', 'Note'];
var ACTIVITY_DIRECTIONS = ['Outgoing', 'Incoming'];
var ACTIVITY_OUTCOMES = ['Connected', 'No answer', 'Call back later', 'Interested', 'Not interested', 'Wrong number'];

var DEFAULT_LISTS = {
  channels: ['Phone call', 'Walk-in', 'WhatsApp', 'Website form', 'Health camp', 'OPD/IPD referral', 'Other'],
  heardFrom: ['Google search', 'Facebook / Instagram', 'Newspaper', 'Hoarding / banner', 'Existing patient',
    'Doctor referral', 'Health camp', 'Friend or family', 'Other'],
  lostReasons: ['Price too high', 'Already has a provider', 'Not reachable', 'Wrong number', 'Not interested', 'Other'],
  // Family links between patients (Relations.gs). "Under their care" is the
  // other side of "Caregiver / attendant".
  relations: ['Father', 'Mother', 'Husband', 'Wife', 'Son', 'Daughter', 'Brother', 'Sister', 'Grandfather', 'Grandmother',
    'Grandson', 'Granddaughter', 'Other relative', 'Caregiver / attendant', 'Under their care']
};

function getListsSheet() { return getOrCreateSheet('Lists', ['Key', 'Values']); }
function getSettingsSheet() { return getOrCreateSheet('Settings', ['Key', 'Value', 'UpdatedAt', 'UpdatedBy']); }

function getLists() {
  var lists = JSON.parse(JSON.stringify(DEFAULT_LISTS));
  sheetToObjects(getListsSheet()).forEach(function (row) {
    if (!lists.hasOwnProperty(row.Key)) return;
    try {
      var v = JSON.parse(row.Values);
      if (Array.isArray(v) && v.length) lists[row.Key] = v.map(String);
    } catch (e) { /* keep default */ }
  });
  return lists;
}

function svc_getLists(session) {
  var lists = getLists();
  // Fixed options are sent too, so the browser never hard-codes them.
  lists.temperatures = LEAD_TEMPERATURES;
  lists.directions = LEAD_DIRECTIONS;
  lists.activityTypes = ACTIVITY_TYPES;
  lists.activityDirections = ACTIVITY_DIRECTIONS;
  lists.outcomes = ACTIVITY_OUTCOMES;
  return lists;
}

function svc_updateLists(session, data) {
  requireRole(session, SENIOR_ROLES);
  var sheet = getListsSheet();
  var before = getLists();
  Object.keys(DEFAULT_LISTS).forEach(function (key) {
    if (data[key] === undefined) return;
    if (!Array.isArray(data[key])) throw new Error('List "' + key + '" must be a list of options.');
    var seen = {};
    var clean = data[key].map(function (v) { return cleanText(v, 50); }).filter(function (v) {
      if (!v || seen[v.toLowerCase()]) return false;
      seen[v.toLowerCase()] = true;
      return true;
    });
    if (clean.length === 0) throw new Error('List "' + key + '" needs at least one option.');
    if (clean.length > 40) throw new Error('List "' + key + '" can have at most 40 options.');

    var rows = sheetToObjects(sheet);
    var at = rows.findIndex(function (r) { return r.Key === key; });
    if (at !== -1) {
      sheet.getRange(at + 2, 1, 1, 2).setValues([[key, JSON.stringify(clean)]]);
    } else {
      appendObject(sheet, { Key: key, Values: JSON.stringify(clean) });
    }
  });
  var after = getLists();
  audit(session, 'update_lists', 'Lists', '', auditDiff(
    { channels: before.channels.join(', '), heardFrom: before.heardFrom.join(', '), lostReasons: before.lostReasons.join(', '), relations: before.relations.join(', ') },
    { channels: after.channels.join(', '), heardFrom: after.heardFrom.join(', '), lostReasons: after.lostReasons.join(', '), relations: after.relations.join(', ') }));
  return svc_getLists(session);
}

// ===== Settings =====
var DEFAULT_MONTHLY_TARGET = 500000;

function getSetting(key, fallback) {
  var row = sheetToObjects(getSettingsSheet()).find(function (r) { return r.Key === key; });
  return row && row.Value !== '' ? row.Value : fallback;
}

function setSetting(session, key, value) {
  var sheet = getSettingsSheet();
  var rows = sheetToObjects(sheet);
  var at = rows.findIndex(function (r) { return r.Key === key; });
  var record = [key, value, nowIso(), session.email];
  if (at !== -1) sheet.getRange(at + 2, 1, 1, 4).setValues([record.map(safeCellValue)]);
  else appendObject(sheet, { Key: key, Value: value, UpdatedAt: record[2], UpdatedBy: record[3] });
}

function getMonthlyTarget() {
  var v = Number(getSetting('monthlyTarget', DEFAULT_MONTHLY_TARGET));
  return v > 0 ? v : DEFAULT_MONTHLY_TARGET;
}

function svc_getMonthlyTarget(session) {
  return getMonthlyTarget();
}

function svc_updateMonthlyTarget(session, amount) {
  requireRole(session, TEAM_ROLES);
  var value = Math.round(Number(amount));
  if (!isFinite(value) || value <= 0 || value > 1e10) throw new Error('Target must be a number greater than 0.');
  var before = getMonthlyTarget();
  setSetting(session, 'monthlyTarget', value);
  audit(session, 'update_target', 'Settings', 'monthlyTarget', { MonthlyTarget: { from: before, to: value } });
  return value;
}
