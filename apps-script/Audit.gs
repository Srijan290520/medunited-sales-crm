// Audit.gs — append-only change log.
//
// Every write through the app (sales, users, incentive rates, reminders,
// account lockouts) adds one row to the AuditLog tab: who did it, when,
// and which fields changed from what to what. The tab is created on first
// use and protected so only the sheet owner (the account the script runs
// as) can edit it — other people with edit access to the spreadsheet can
// read it but can't quietly rewrite history.

var AUDIT_SHEET_NAME = 'AuditLog';
var AUDIT_HEADERS = ['Timestamp', 'UserEmail', 'UserName', 'Role', 'Action', 'Entity', 'EntityID', 'Changes', 'Summary', 'ID'];

// Never copy these into the log, even as "changed".
var AUDIT_SKIP_FIELDS = ['PasswordHash', 'Salt'];

function getAuditSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(AUDIT_SHEET_NAME);
  if (sheet) { ensureHeaders(sheet, AUDIT_HEADERS); return sheet; }

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
//
// changes: either { Field: { from, to } } (from auditDiff) or an array of
// { field, from, to } (human-readable lines for the sale history panel).
// summary: optional one-line description shown in the app.
function audit(session, action, entity, entityId, changes, summary) {
  try {
    var hasChanges = Array.isArray(changes) ? changes.length > 0 : (changes && Object.keys(changes).length > 0);
    appendObject(getAuditSheet(), {
      ID: newId(),
      Timestamp: nowIso(),
      UserEmail: session ? session.email : '',
      UserName: session ? session.name : '',
      Role: session ? session.role : '',
      Action: action,
      Entity: entity,
      EntityID: entityId || '',
      Changes: hasChanges ? JSON.stringify(changes) : '',
      Summary: summary ? String(summary).slice(0, 500) : ''
    });
  } catch (e) {
    console.error('Audit write failed (' + action + ' ' + entity + ' ' + entityId + '): ' + e.message);
  }
}

// Batch version of audit() for bulk operations (one sheet write).
// entries: [{ action, entity, entityId, changes, summary }]
function auditMany(session, entries) {
  if (!entries.length) return;
  try {
    var sheet = getAuditSheet();
    var headers = sheetHeaders(sheet);
    var now = nowIso();
    var values = entries.map(function (e) {
      var row = {
        ID: newId(), Timestamp: now,
        UserEmail: session.email, UserName: session.name, Role: session.role,
        Action: e.action, Entity: e.entity, EntityID: e.entityId || '',
        Changes: e.changes && (Array.isArray(e.changes) ? e.changes.length : Object.keys(e.changes).length) ? JSON.stringify(e.changes) : '',
        Summary: e.summary ? String(e.summary).slice(0, 500) : ''
      };
      return headers.map(function (h) { return safeCellValue(row[h] !== undefined ? row[h] : ''); });
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
  } catch (err) {
    console.error('Bulk audit write failed: ' + err.message);
  }
}

// Normalizes stored Changes JSON (either shape) to [{ field, from, to }].
function auditChangesForClient(raw) {
  if (!raw) return [];
  var parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return []; }
  if (Array.isArray(parsed)) {
    return parsed.map(function (c) { return { field: String(c.field), from: String(c.from === undefined ? '' : c.from), to: String(c.to === undefined ? '' : c.to) }; });
  }
  return Object.keys(parsed || {}).filter(function (k) {
    return ['Products', 'BillScreenshotUrl', 'PaymentScreenshotUrl', 'ContactKey', 'CreatedAt', 'UpdatedAt'].indexOf(k) === -1;
  }).map(function (k) {
    var v = parsed[k] || {};
    return { field: k, from: String(v.from === undefined || v.from === '' ? '—' : v.from), to: String(v.to === undefined || v.to === '' ? '—' : v.to) };
  });
}

// Actions the sale history panel knows how to label.
var CLIENT_AUDIT_ACTIONS = ['create', 'update', 'reassign', 'reopen', 'status_change', 'complete', 'cancel', 'callback', 'delete'];

function auditRowForClient(row, i) {
  var action = String(row.Action || 'update');
  return {
    ID: String(row.ID || ('audit_row_' + i)),
    SaleID: String(row.EntityID || ''),
    RecordID: String(row.EntityID || ''),
    RecordType: String(row.Entity || ''),
    Date: isoString(row.Timestamp),
    ByEmail: String(row.UserEmail || ''),
    ByName: String(row.UserName || ''),
    ByRole: String(row.Role || ''),
    Action: CLIENT_AUDIT_ACTIONS.indexOf(action) !== -1 ? action : 'update',
    Summary: String(row.Summary || defaultAuditSummary(row)),
    Changes: auditChangesForClient(row.Changes)
  };
}

function defaultAuditSummary(row) {
  var labels = {
    create: 'Created', update: 'Updated', delete: 'Deleted', reassign: 'Reassigned',
    sync_from_lead: 'Updated from lead', create_from_lead: 'Created from lead'
  };
  return (labels[row.Action] || String(row.Action || 'Changed')) + ' ' + String(row.Entity || 'record');
}

// History for a set of record IDs, newest first.
function auditHistoryFor(entityIds, limit) {
  var wanted = {};
  entityIds.forEach(function (id) { wanted[String(id)] = true; });
  var out = [];
  sheetToObjects(getAuditSheet()).forEach(function (row, i) {
    if (wanted[String(row.EntityID)]) out.push(auditRowForClient(row, i));
  });
  out.sort(function (a, b) { return new Date(b.Date) - new Date(a.Date); });
  return limit ? out.slice(0, limit) : out;
}
