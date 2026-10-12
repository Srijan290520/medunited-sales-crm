// Utils.gs — generic helpers for reading/writing sheet rows as objects

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheetByName(name) {
  var sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name + '. Run setupSpreadsheet() first.');
  return sheet;
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
function safeCellValue(v) {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return "'" + v;
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

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
