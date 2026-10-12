// Audit.gs — append-only change log.
//
// Every write through the app (sales, users, incentive rates, reminders,
// account lockouts) adds one row to the AuditLog tab: who did it, when,
// and which fields changed from what to what. The tab is created on first
// use and protected so only the sheet owner (the account the script runs
// as) can edit it — other people with edit access to the spreadsheet can
// read it but can't quietly rewrite history.

var AUDIT_SHEET_NAME = 'AuditLog';
var AUDIT_HEADERS = ['Timestamp', 'UserEmail', 'UserName', 'Role', 'Action', 'Entity', 'EntityID', 'Changes'];

// Never copy these into the log, even as "changed".
var AUDIT_SKIP_FIELDS = ['PasswordHash', 'Salt'];

function getAuditSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(AUDIT_SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(AUDIT_SHEET_NAME);
  sheet.getRange(1, 1, 1, AUDIT_HEADERS.length).setValues([AUDIT_HEADERS]);
  sheet.setFrozenRows(1);
  protectAuditSheet(sheet);
  return sheet;
}

function protectAuditSheet(sheet) {
  try {
    var protection = sheet.protect().setDescription('Audit log — written by the CRM only');
    protection.removeEditors(protection.getEditors());
    if (protection.canDomainEdit()) protection.setDomainEdit(false);
  } catch (e) {
    console.warn('Could not protect AuditLog sheet: ' + e.message);
  }
}

function auditValue(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
  return v === undefined || v === null ? '' : v;
}

// Returns { Field: { from, to } } for every field in `after` whose value
// differs from `before`. Pass before = null for a create, after = null for
// a delete (the whole record is logged either way).
function auditDiff(before, after) {
  var out = {};
  var keys = {};
  Object.keys(before || {}).forEach(function (k) { keys[k] = true; });
  Object.keys(after || {}).forEach(function (k) { keys[k] = true; });

  Object.keys(keys).forEach(function (k) {
    if (AUDIT_SKIP_FIELDS.indexOf(k) !== -1) return;
    var from = before ? auditValue(before[k]) : '';
    var to = after ? auditValue(after[k]) : '';
    if (before && after && after[k] === undefined) return; // field not part of this change
    if (String(from) !== String(to)) out[k] = { from: from, to: to };
  });
  return out;
}

// Never throws: a failed audit write is logged to the Apps Script console
// rather than failing a save the user already made.
function audit(session, action, entity, entityId, changes) {
  try {
    appendObject(getAuditSheet(), {
      Timestamp: nowIso(),
      UserEmail: session ? session.email : '',
      UserName: session ? session.name : '',
      Role: session ? session.role : '',
      Action: action,
      Entity: entity,
      EntityID: entityId || '',
      Changes: changes && Object.keys(changes).length ? JSON.stringify(changes) : ''
    });
  } catch (e) {
    console.error('Audit write failed (' + action + ' ' + entity + ' ' + entityId + '): ' + e.message);
  }
}
