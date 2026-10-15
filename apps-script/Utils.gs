// Utils.gs — generic helpers for reading/writing sheet rows as objects

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheetByName(name) {
  var sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name + '. Run setupSpreadsheet() first.');
  return sheet;
}

// Returns the named tab, creating it (with a frozen header row) if it
// doesn't exist yet, and appending any missing header columns to the end if
// it does. Lets new features add tabs/columns without anyone hand-editing
// the spreadsheet after a deploy.
function getOrCreateSheet(name, headers) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  ensureHeaders(sheet, headers);
  return sheet;
}

function ensureHeaders(sheet, headers) {
  var existing = sheetHeaders(sheet);
  var missing = headers.filter(function (h) { return existing.indexOf(h) === -1; });
  if (missing.length === 0) return;
  sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
}

function sheetHeaders(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
}

function sheetToObjects(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) return [];
  var headers = sheetHeaders(sheet);
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = values[r][c];
    }
    out.push(obj);
  }
  return out;
}

// Sheets treats any text starting with = + - @ as a formula, so a customer
// name like "=IMPORTXML(...)" would run instead of being stored. A leading
// apostrophe forces plain text; Sheets hides it and doesn't return it from
// getValues(), so the value reads back exactly as typed. (This also stops
// phone numbers like "+91 98480 12345" from being parsed as a formula.)
// Digit strings with a leading zero or more than 15 digits (phone numbers,
// UTRs) would be turned into numbers and lose digits, so keep them as text.
function safeCellValue(v) {
  if (typeof v === 'string' && (/^[=+\-@\t\r]/.test(v) || /^0\d+$/.test(v) || /^\d{16,}$/.test(v))) return "'" + v;
  return v;
}

function appendObject(sheet, obj) {
  var headers = sheetHeaders(sheet);
  var row = headers.map(function (h) { return safeCellValue((obj[h] !== undefined) ? obj[h] : ''); });
  sheet.appendRow(row);
  return obj;
}

function findRowIndexById(sheet, id) {
  var headers = sheetHeaders(sheet);
  var idCol = headers.indexOf('ID');
  if (idCol === -1) throw new Error('Sheet has no ID column');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function updateObjectById(sheet, id, patch) {
  var rowIndex = findRowIndexById(sheet, id);
  if (rowIndex === -1) return null;
  var headers = sheetHeaders(sheet);
  var lastCol = sheet.getLastColumn();
  var currentValues = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var current = {};
  headers.forEach(function (h, i) { current[h] = currentValues[i]; });
  var updated = Object.assign({}, current, patch);
  var newRow = headers.map(function (h) { return safeCellValue(updated[h] !== undefined ? updated[h] : ''); });
  sheet.getRange(rowIndex, 1, 1, lastCol).setValues([newRow]);
  return updated;
}

function newId() {
  return Utilities.getUuid();
}

function nowIso() {
  return new Date().toISOString();
}

// ===== Calendar dates =====
// Sale dates are calendar days ("2026-10-12"), not moments in time. They are
// always handled as 'yyyy-MM-dd' strings in India time, so a sale logged at
// 1 AM IST lands on the right day (new Date().toISOString() is UTC and would
// give yesterday's date until 5:30 AM).
var APP_TIMEZONE = 'Asia/Kolkata';
var DAY_MS = 24 * 60 * 60 * 1000;
var spreadsheetTimeZone_ = null;

function todayKey() {
  return Utilities.formatDate(new Date(), APP_TIMEZONE, 'yyyy-MM-dd');
}

// Sheets turns a typed "2026-10-12" into a Date cell (midnight in the
// spreadsheet's time zone). Reading it back gives a Date object, which
// JSON-encodes as UTC — e.g. "2026-10-11T18:30:00.000Z" — and shows up a day
// early in the edit form. This turns either shape back into 'yyyy-MM-dd'.
function dateKey(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    if (!spreadsheetTimeZone_) spreadsheetTimeZone_ = getSpreadsheet().getSpreadsheetTimeZone() || APP_TIMEZONE;
    return Utilities.formatDate(value, spreadsheetTimeZone_, 'yyyy-MM-dd');
  }
  var s = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

// Real calendar days only: "2026-02-31" is rejected (Date.UTC would roll it to March).
function isDateKey(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  var n = keyToDayNumber(s);
  return !isNaN(n) && dayNumberToKey(n) === String(s);
}

// Whole days since 1970-01-01 for a 'yyyy-MM-dd' key — lets us add and
// subtract days without any time-zone or daylight-saving surprises.
function keyToDayNumber(key) {
  var p = String(key).split('-');
  return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) / DAY_MS;
}

function dayNumberToKey(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

// Runs fn while holding the script-wide lock, so read-modify-write sequences
// on the sheet (find row → change → write back, or delete a row) can't
// interleave between two requests and land on the wrong row.
function withScriptLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('The server is busy saving other changes. Please try again in a few seconds.');
  }
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

// ===== Input hygiene =====
// Every free-text value from the browser goes through cleanText: control
// characters are stripped, it's trimmed, and it's cut to a sane length so
// nobody can stuff megabytes into a single cell.
var MAX_TEXT = 200;
var MAX_LONG_TEXT = 2000;

function cleanText(value, maxLen) {
  var s = String(value === undefined || value === null ? '' : value);
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return s.slice(0, maxLen || MAX_TEXT);
}

function cleanEmail(value) {
  return cleanText(value, 254).toLowerCase();
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s));
}

function asBool(value) {
  return value === true || String(value).toUpperCase() === 'TRUE';
}

// Phone numbers are compared on their last 10 digits, so "+91 98480 12345",
// "098480-12345" and "9848012345" are all the same customer.
function phoneKey(value) {
  var digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 6) return '';
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function requireOneOf(value, allowed, label) {
  if (allowed.indexOf(value) === -1) throw new Error(label + ' must be one of: ' + allowed.join(', ') + '.');
}

function optionalDateKey(value, label) {
  var v = dateKey(value);
  if (!v) return '';
  if (!isDateKey(v)) throw new Error(label + ' must be a valid date (YYYY-MM-DD).');
  return v;
}

function isoString(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return isNaN(value.getTime()) ? '' : value.toISOString();
  return String(value || '');
}

// ===== Rate limiting =====
// A fixed one-minute window per key in CacheService. Stops a stolen or buggy
// session from hammering the sheet (Apps Script has daily quotas, and the
// script lock means one runaway client slows everybody down).
var RATE_LIMIT_PER_MINUTE = 120;

function checkRateLimit(key) {
  var cache = CacheService.getScriptCache();
  var bucket = 'rl_' + key + '_' + Math.floor(Date.now() / 60000);
  var n = Number(cache.get(bucket)) || 0;
  if (n >= RATE_LIMIT_PER_MINUTE) {
    throw new Error('Too many requests. Please wait a minute and try again.');
  }
  cache.put(bucket, String(n + 1), 120);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
