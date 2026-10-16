// Activities.gs — every call / WhatsApp / visit / note on a Medpass or
// Pharmacy record, in the SaleActivities tab (created on first use).
//
// Contact attempts are never typed in — they're counted from this log.
// Logging an outcome also moves the record along:
//   Interested                         → temperature Hot
//   Not interested / Wrong number      → Cancelled with that lost reason
//   customer got back (Incoming, or a
//   reopen request) on a Cancelled one → reopened as a Hot lead

var ACTIVITY_HEADERS = ['ID', 'SaleID', 'SaleType', 'Date', 'ByEmail', 'ByName', 'Type', 'Direction', 'Outcome', 'Notes', 'NextFollowUp'];
// Contact types that count as "reaching out" — blocked when a customer is marked Do Not Call.
var DND_BLOCKED_TYPES = ['Call', 'WhatsApp', 'SMS'];

function getActivitiesSheet() { return getOrCreateSheet('SaleActivities', ACTIVITY_HEADERS); }

function activityForClient(a) {
  return {
    ID: String(a.ID),
    SaleID: String(a.SaleID),
    Date: isoString(a.Date),
    ByEmail: String(a.ByEmail || ''),
    ByName: String(a.ByName || ''),
    Type: String(a.Type || 'Note'),
    Direction: String(a.Direction || ''),
    Outcome: String(a.Outcome || ''),
    Notes: String(a.Notes || ''),
    NextFollowUp: dateKey(a.NextFollowUp)
  };
}

function activitiesBySale() {
  var map = {};
  sheetToObjects(getActivitiesSheet()).forEach(function (a) {
    var k = String(a.SaleID);
    (map[k] = map[k] || []).push(a);
  });
  return map;
}

// Newest first; rows logged in the same millisecond keep sheet order.
function activitiesForSale(saleId) {
  var acts = sheetToObjects(getActivitiesSheet())
    .map(function (a, i) { a._row = i; return a; })
    .filter(function (a) { return String(a.SaleID) === String(saleId); });
  acts.sort(function (a, b) { return (new Date(b.Date) - new Date(a.Date)) || (b._row - a._row); });
  return acts;
}

function addActivity(session, type, saleId, fields) {
  var row = {
    ID: newId(), SaleID: saleId, SaleType: type, Date: nowIso(),
    ByEmail: session.email, ByName: session.name,
    Type: 'Note', Direction: '', Outcome: '', Notes: '', NextFollowUp: ''
  };
  Object.keys(fields || {}).forEach(function (k) { row[k] = fields[k]; });
  appendObject(getActivitiesSheet(), row);
  return row;
}

function svc_logSaleActivity(session, type, saleId, data) {
  var sheet = getSaleSheet(type);
  var sale = requireSale(session, type, saleId);

  var actType = String(data.type || '');
  requireOneOf(actType, ACTIVITY_TYPES, 'Type');
  var direction = '';
  var outcome = '';
  if (actType !== 'Note') {
    direction = String(data.direction || 'Outgoing');
    outcome = String(data.outcome || 'Connected');
    requireOneOf(direction, ACTIVITY_DIRECTIONS, 'Direction');
    requireOneOf(outcome, ACTIVITY_OUTCOMES, 'Outcome');
  }
  var notes = cleanText(data.notes, MAX_LONG_TEXT);
  if (actType === 'Note' && !notes) throw new Error('A note needs some text.');
  if (asBool(sale.DoNotCall) && direction === 'Outgoing' && DND_BLOCKED_TYPES.indexOf(actType) !== -1) {
    throw new ForbiddenError('This customer is marked Do Not Call. Only record contact they started (Incoming), or remove the flag if they have agreed to be contacted.');
  }
  var nextFollowUp = optionalDateKey(data.nextFollowUp, 'Next follow-up');
  var statusUpdate = String(data.statusUpdate || '');

  // Agents can log calls on their Completed sales (after-sales follow-up),
  // but those never change the sale itself.
  var patch = {};
  var auditAction = null;
  var auditSummary = '';
  var label = (direction ? direction + ' ' : '') + actType + (outcome ? ' — ' + outcome : '');

  if (sale.Status === 'Cancelled' && (direction === 'Incoming' || outcome === 'Interested' || statusUpdate === 'reopen_pending')) {
    var world = loadPatientWorld();
    var own = reopenOwnership(session, world, type, sale);
    patch = { Status: 'Pending', LostReason: '', Temperature: 'Hot' };
    Object.keys(own).forEach(function (k) { patch[k] = own[k]; });
    savePatientChanges(world);
    auditAction = 'reopen';
    auditSummary = 'Customer got back in touch (' + label + '). Reopened as a Hot lead.' +
      (own.AgentName ? ' Moved to ' + own.AgentName + ', who handles this patient now.' : '');
  } else if (sale.Status === 'Pending') {
    if (outcome === 'Not interested' || outcome === 'Wrong number' || statusUpdate === 'cancel') {
      var lists = getLists();
      var reason = lists.lostReasons.indexOf(outcome) !== -1 ? outcome :
        (lists.lostReasons.indexOf('Other') !== -1 ? 'Other' : lists.lostReasons[0]);
      patch = { Status: 'Cancelled', LostReason: reason, NextFollowUp: '' };
      auditAction = 'cancel';
      auditSummary = 'Lost during ' + label + '. Moved to Cancelled.';
    } else if (outcome === 'Interested' && sale.Temperature !== 'Hot') {
      patch = { Temperature: 'Hot' };
      auditAction = 'update';
      auditSummary = 'Customer showed strong interest (' + label + '). Temperature set to Hot.';
    }
  }
  var finalStatus = patch.Status || sale.Status;
  if (nextFollowUp && finalStatus === 'Pending') patch.NextFollowUp = nextFollowUp;

  addActivity(session, type, sale.ID, {
    Type: actType, Direction: direction, Outcome: outcome, Notes: notes, NextFollowUp: nextFollowUp
  });

  if (Object.keys(patch).length) {
    patch.UpdatedAt = nowIso();
    var updated = updateObjectById(sheet, sale.ID, patch);
    afterSaleSaved(type, updated);
    if (auditAction) audit(session, auditAction, saleEntity(type), sale.ID, saleChanges(sale, patch), auditSummary);
    sale = updated;
  }
  return saleDetail(session, type, sale);
}
