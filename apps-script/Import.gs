// Import.gs — bulk-add leads from a spreadsheet (Excel / CSV is parsed in the
// browser; this receives plain rows).
//
// Two steps, same function:
//   dryRun: true   validate every row and report problems, save nothing
//   dryRun: false  validate again (data may have changed since the preview)
//                  and save only the rows that pass, in one batch
//
// Imported rows are always new Pending leads. The same rules as one-by-one
// entry apply: a valid phone number, one open record per patient (phone +
// name) per module (checked against the sheet AND within the file), values
// from the admin's dropdown lists, agents can only import leads for
// themselves, and a row for a patient someone already handles goes to them
// (shown as a warning in the preview).

var IMPORT_MAX_ROWS = 500;

// Lenient matching for values typed by hand in Excel: case/spacing-insensitive.
function matchOption(value, options) {
  var v = cleanText(value, 60).toLowerCase().replace(/\s+/g, ' ');
  if (!v) return '';
  for (var i = 0; i < options.length; i++) {
    if (String(options[i]).toLowerCase() === v) return options[i];
  }
  return null;
}

// Accepts 2026-10-15, 15-10-2026, 15/10/2026, 15.10.2026 (day first, as written in India).
function parseImportDate(value) {
  var s = cleanText(value, 20);
  if (!s) return '';
  var m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) s = m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  else if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s))) s = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return isDateKey(s) ? s : null;
}

function parseYesNo(value, fallback) {
  var v = cleanText(value, 10).toLowerCase();
  if (!v) return fallback;
  if (['yes', 'y', 'true', '1'].indexOf(v) !== -1) return true;
  if (['no', 'n', 'false', '0'].indexOf(v) !== -1) return false;
  return null;
}

function svc_importSales(session, type, rows, options) {
  var mod = getModule(type);
  options = options || {};
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('The file has no rows to import.');
  if (rows.length > IMPORT_MAX_ROWS) throw new Error('You can import at most ' + IMPORT_MAX_ROWS + ' rows at a time. Split the file and import it in parts.');

  var lists = getLists();
  var users = sheetToObjects(getSheetByName('Users'));
  var activeByEmail = {};
  users.forEach(function (u) { if (isActive(u.Active)) activeByEmail[String(u.Email).toLowerCase()] = u; });

  // Patients and their owners, so each row goes to the agent who already
  // handles that person (or that household).
  var world = loadPatientWorld();
  var seenInFile = {};
  var results = [];
  var toSave = [];
  var defaultOwner = resolveAssignee(session, options.agentEmail);

  rows.forEach(function (raw, i) {
    var r = raw && typeof raw === 'object' ? raw : {};
    var errors = [];
    var warnings = [];
    var rowNo = Number(r._row) || (i + 2); // spreadsheet row number (row 1 = headers)

    var name = cleanText(r.customerName, 120);
    if (!name) errors.push('Customer name is missing.');
    var contact = cleanText(r.contact, 30);
    var key = phoneKey(contact);
    var person = key + '|' + nameKey(name);
    if (!key) errors.push('Phone number is missing or invalid.');
    else if (name && seenInFile[person]) errors.push('Same person (phone number and name) as row ' + seenInFile[person] + ' in this file.');
    else if (name) {
      ensureHousehold(world, key);
      var dup = findOpenRecordForPatient(world, type, findPerson(world, key, name));
      if (dup) errors.push('Already has an open ' + SALE_TYPES[type] + ' record (managed by ' + dup.row.AgentName + ').');
    }
    if (key && name && !seenInFile[person]) seenInFile[person] = rowNo;

    var temperature = 'Warm';
    if (cleanText(r.temperature)) {
      temperature = matchOption(r.temperature, LEAD_TEMPERATURES);
      if (!temperature) errors.push('Temperature must be Hot, Warm or Cold.');
    }
    var direction = 'Inbound';
    if (cleanText(r.direction)) {
      direction = matchOption(r.direction, LEAD_DIRECTIONS);
      if (!direction) errors.push('Direction must be Inbound or Outbound.');
    }
    var channel = lists.channels.indexOf('Other') !== -1 ? 'Other' : lists.channels[0];
    if (cleanText(r.channel)) {
      var ch = matchOption(r.channel, lists.channels);
      if (ch) channel = ch;
      else warnings.push('Unknown channel "' + cleanText(r.channel, 40) + '" — saved as ' + channel + '.');
    }
    var heardFrom = '';
    if (cleanText(r.heardFrom) && direction !== 'Outbound') {
      var hf = matchOption(r.heardFrom, lists.heardFrom);
      if (hf) heardFrom = hf;
      else warnings.push('Unknown "heard from" value "' + cleanText(r.heardFrom, 40) + '" — left blank.');
    }
    var nextFollowUp = parseImportDate(r.nextFollowUp);
    if (nextFollowUp === null) { errors.push('Follow-up date is not a valid date (use YYYY-MM-DD or DD/MM/YYYY).'); nextFollowUp = ''; }
    var date = parseImportDate(r.date);
    if (date === null) { errors.push('Date is not a valid date (use YYYY-MM-DD or DD/MM/YYYY).'); date = ''; }
    var consent = parseYesNo(r.consent, true);
    if (consent === null) { errors.push('Consent must be Yes or No.'); consent = true; }
    var dnd = parseYesNo(r.doNotCall, false);
    if (dnd === null) { errors.push('Do Not Call must be Yes or No.'); dnd = false; }

    var priceType = '';
    if (mod.priceTypes) {
      priceType = 'Full Price';
      if (cleanText(r.priceType)) {
        priceType = matchOption(r.priceType, PRICE_TYPES);
        if (!priceType) errors.push('Price type must be Full Price, Discounted or Converted From OP.');
      }
    }
    var amount = 0;
    if (cleanText(r.amount)) {
      var n = Number(String(r.amount).replace(/[₹,\s]/g, ''));
      if (isNaN(n) || n < 0 || n > 1e8) errors.push('Amount is not a valid number.');
      else amount = Math.round(n * 100) / 100;
    }
    // Module rules for imported leads (e.g. Medpass sets its own price).
    var importHook = moduleHook(type, 'prepareImport');
    var importFields = importHook ? (importHook({ priceType: priceType, amount: amount }, errors) || {}) : {};
    if (importFields.Amount !== undefined) amount = importFields.Amount;

    var owner = defaultOwner;
    if (cleanText(r.agentEmail)) {
      if (session.role === 'agent') {
        if (cleanEmail(r.agentEmail) !== String(session.email).toLowerCase()) warnings.push('Agents can only import their own leads — assigned to you.');
      } else {
        var u = activeByEmail[cleanEmail(r.agentEmail)];
        if (!u) errors.push('Agent "' + cleanText(r.agentEmail, 80) + '" is not an active user.');
        else owner = { email: u.Email, name: u.Name };
      }
    }

    var notes = cleanText(r.notes, MAX_LONG_TEXT);
    var detail = cleanText(r.detail, MAX_LONG_TEXT);
    if ((mod.products || mod.lineItems) && detail) {
      notes = (notes ? notes + '\n' : '') + (mod.products ? 'Medicines mentioned: ' : 'Mentioned: ') + detail;
      detail = '';
    }

    // Only rows that pass get a patient, so a bad row never adds anyone.
    var link = null;
    if (!errors.length) {
      link = resolvePatientOwner(world, { contactKey: key, contact: contact, name: name, requested: owner });
      if (link.notice) warnings.push(link.notice);
      owner = link.owner;
    }

    results.push({
      row: rowNo, customerName: name, contact: contact, ok: errors.length === 0,
      errors: errors, warnings: warnings, agentName: owner.name
    });
    if (errors.length) return;

    var now = nowIso();
    toSave.push(Object.assign({
      ID: newId(),
      Date: date || todayKey(),
      AgentEmail: owner.email,
      AgentName: owner.name,
      CustomerName: name,
      Contact: contact,
      ContactKey: key,
      Detail: detail,
      Products: mod.products ? '[]' : '',
      Amount: amount,
      Status: 'Pending',
      PriceType: priceType,
      PaymentMethod: '',
      UTR: '',
      BillScreenshotUrl: '',
      PaymentScreenshotUrl: '',
      Notes: notes,
      Temperature: temperature,
      Direction: direction,
      Channel: channel,
      HeardFrom: heardFrom,
      Consent: consent,
      DoNotCall: dnd,
      LostReason: '',
      NextFollowUp: nextFollowUp,
      CreatedAt: now,
      UpdatedAt: now,
      PatientID: link.patient.ID
    }, importFields));
  });

  var summary = {
    total: rows.length,
    valid: toSave.length,
    invalid: rows.length - toSave.length,
    imported: 0,
    dryRun: !!options.dryRun,
    results: results
  };
  if (options.dryRun || toSave.length === 0) return summary;

  savePatientChanges(world);
  // One write for all rows instead of hundreds of appendRow calls.
  var sheet = getSaleSheet(type);
  var headers = sheetHeaders(sheet);
  var values = toSave.map(function (obj) {
    return headers.map(function (h) { return safeCellValue(obj[h] !== undefined ? obj[h] : ''); });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);

  auditMany(session, toSave.map(function (s) {
    return {
      action: 'create', entity: saleEntity(type), entityId: s.ID, changes: saleChanges(null, s),
      summary: 'Imported ' + SALE_TYPES[type] + ' lead for ' + s.CustomerName + (options.fileName ? ' from ' + cleanText(options.fileName, 80) : '')
    };
  }));
  audit(session, 'import', saleEntity(type), '', { Rows: { from: '', to: toSave.length } },
    'Imported ' + toSave.length + ' ' + SALE_TYPES[type] + ' leads' + (options.fileName ? ' from ' + cleanText(options.fileName, 80) : '') +
    (summary.invalid ? ' (' + summary.invalid + ' rows skipped)' : ''));
  summary.imported = toSave.length;
  return summary;
}
