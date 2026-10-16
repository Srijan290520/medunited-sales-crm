// Lab.gs — Lab & Radiology tests and packages.
//
// There is no test catalogue yet: the agent types each test or package with
// whether it is Lab or Radiology and its price. The amount is the sum of the
// lines, worked out on the server. A catalogue can be added later without
// changing existing records.
//
// Optional tracking on each record:
//   HomeCollection (yes/no) + CollectionDate    home sample collection
//   AppointmentDate                             visit / scan appointment
//   ReportDeliveredOn + ReportDeliveredVia      when and how the report went out
// Agents can still update these after the sale is Completed (reports come
// later), but not the tests or prices.

var LAB_TEST_KINDS = ['Lab', 'Radiology'];
var LAB_REPORT_VIA = ['WhatsApp', 'Email', 'Collected', 'Other'];
var LAB_TRACKING_FIELDS = ['HomeCollection', 'CollectionDate', 'AppointmentDate', 'ReportDeliveredOn', 'ReportDeliveredVia'];

function validateLabTests(raw) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw || '[]'); } catch (e) { throw new Error('The tests list is not valid.'); }
  }
  if (raw === undefined || raw === null) raw = [];
  if (!Array.isArray(raw)) throw new Error('The tests list is not valid.');
  if (raw.length > MAX_SERVICE_LINES) throw new Error('A record can list at most ' + MAX_SERVICE_LINES + ' tests.');
  return raw.map(function (l) {
    l = l && typeof l === 'object' ? l : {};
    var name = cleanText(l.name, 120);
    if (!name) throw new Error('Every test needs a name.');
    var kind = cleanText(l.kind, 20) || 'Lab';
    requireOneOf(kind, LAB_TEST_KINDS, 'Type of ' + name);
    return { name: name, kind: kind, price: linePrice(l.price, name) };
  });
}

function summarizeTests(lines) {
  return lines.map(function (l) { return l.name + ' (₹' + l.price + ')'; }).join(', ');
}

// The tracking fields as they should be after this save.
function labTracking(data, existing) {
  var pick = function (key, field) { return data[key] !== undefined ? data[key] : (existing ? existing[field] : ''); };
  var home = asBool(pick('homeCollection', 'HomeCollection'));
  var collection = optionalDateKey(pick('collectionDate', 'CollectionDate'), 'Collection date');
  var appointment = optionalDateKey(pick('appointmentDate', 'AppointmentDate'), 'Appointment date');
  var delivered = optionalDateKey(pick('reportDeliveredOn', 'ReportDeliveredOn'), 'Report delivered on');
  var via = cleanText(pick('reportDeliveredVia', 'ReportDeliveredVia'), 20);
  if (via) requireOneOf(via, LAB_REPORT_VIA, 'Report delivered by');
  if (via && !delivered) throw new Error('Enter the date the report was delivered.');
  if (delivered && !via) throw new Error('Say how the report was delivered (WhatsApp, Email, Collected or Other).');
  return {
    HomeCollection: home,
    CollectionDate: home ? collection : '',
    AppointmentDate: appointment,
    ReportDeliveredOn: delivered,
    ReportDeliveredVia: via
  };
}

// ===== Hooks (see Modules.gs) =====
function labPrepareSave(session, ctx) {
  var data = ctx.data || {};
  var lines = validateLabTests(data.tests !== undefined ? data.tests : (ctx.existing ? ctx.existing.Tests : []));
  var fields = labTracking(data, ctx.existing);
  fields.Tests = JSON.stringify(lines);
  fields.Amount = sumLines(lines);
  fields.Detail = summarizeTests(lines);
  return { fields: fields, warnings: [] };
}

function labValidateCompletion(next) {
  if (!parseLines(next.Tests).length) throw new Error('Add the tests before marking this Lab & Radiology record as Completed.');
}

function labClientFields(row) {
  return {
    Tests: parseLines(row.Tests),
    HomeCollection: asBool(row.HomeCollection),
    CollectionDate: dateKey(row.CollectionDate),
    AppointmentDate: dateKey(row.AppointmentDate),
    ReportDeliveredOn: dateKey(row.ReportDeliveredOn),
    ReportDeliveredVia: String(row.ReportDeliveredVia || '')
  };
}

function labPrepareImport(r, errors) {
  return { Amount: 0, Tests: '[]', HomeCollection: false };
}
