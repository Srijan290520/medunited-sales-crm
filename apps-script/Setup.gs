// Setup.gs — one-time setup helpers. Run these from the Apps Script editor
// (select the function in the dropdown next to Run, then click Run), not
// from the web app.

// Creates every tab the CRM uses, or adds any missing columns to tabs that
// already exist. Safe to run any number of times; it never deletes data.
function setupSpreadsheet() {
  getUsersSheet();
  moduleIds().forEach(function (type) { getSaleSheet(type); });
  getPatientsSheet();
  getUserRequestsSheet();
  getUserLayoutsSheet();
  getTargetsSheet();
  getRemindersSheet();
  getActivitiesSheet();
  getListsSheet();
  getSettingsSheet();
  getAuditSheet(); // created protected so only the owner can edit it
  backfillContactKeys_();
  Logger.log('Sheets are ready. Next: set ADMIN_EMAIL / ADMIN_PASSWORD in Project Settings → Script properties, then run createFirstAdmin().');
}

// Rows saved before v2 have no ContactKey; fill it so duplicate-phone checks see them.
function backfillContactKeys_() {
  moduleIds().forEach(function (type) {
    var sheet = getSaleSheet(type);
    var headers = sheetHeaders(sheet);
    var keyCol = headers.indexOf('ContactKey');
    var contactCol = headers.indexOf('Contact');
    var lastRow = sheet.getLastRow();
    if (keyCol === -1 || contactCol === -1 || lastRow < 2) return;
    var contacts = sheet.getRange(2, contactCol + 1, lastRow - 1, 1).getValues();
    var keys = sheet.getRange(2, keyCol + 1, lastRow - 1, 1).getValues();
    var changed = false;
    for (var i = 0; i < contacts.length; i++) {
      if (!keys[i][0]) { keys[i][0] = phoneKey(contacts[i][0]); changed = true; }
    }
    if (changed) sheet.getRange(2, keyCol + 1, lastRow - 1, 1).setValues(keys);
  });
}

// Creates the first admin account WITHOUT putting a password in the code:
//  1. Project Settings (gear icon) → Script properties → add
//       ADMIN_EMAIL     your work email
//       ADMIN_PASSWORD  a temporary password (10+ chars, letters and numbers)
//  2. Run createFirstAdmin.
// The password property is deleted straight after, and the app makes you
// choose a new password on first login.
function createFirstAdmin() {
  var props = PropertiesService.getScriptProperties();
  var email = cleanEmail(props.getProperty('ADMIN_EMAIL'));
  var password = String(props.getProperty('ADMIN_PASSWORD') || '');
  var name = cleanText(props.getProperty('ADMIN_NAME') || 'Admin', 80);
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in Project Settings → Script properties first.');
  if (!isValidEmail(email)) throw new Error('ADMIN_EMAIL is not a valid email address.');
  validatePasswordStrength(password, email);

  var sheet = getUsersSheet();
  if (sheetToObjects(sheet).some(function (u) { return String(u.Email).toLowerCase() === email; })) {
    props.deleteProperty('ADMIN_PASSWORD');
    Logger.log('A user with that email already exists — nothing to do. (ADMIN_PASSWORD property removed.)');
    return;
  }

  var salt = generateSalt();
  var user = {
    ID: newId(),
    Name: name,
    Email: email,
    PasswordHash: hashPassword(password, salt),
    Salt: salt,
    Role: 'admin',
    MedpassFullRate: 0,
    MedpassDiscountRate: 0,
    PharmacyIncentivePercent: 0,
    Active: true,
    CreatedAt: nowIso(),
    MustChangePassword: true
  };
  appendObject(sheet, user);
  props.deleteProperty('ADMIN_PASSWORD');
  audit({ email: 'setup', name: 'Setup script', role: 'system' }, 'create', 'User', user.ID, null, 'First admin created: ' + email);
  Logger.log('Admin user created: ' + email + '. The temporary password was removed from Script properties.');
}

// ONE-TIME, after upgrading from a version that shared screenshots by link:
// makes every file in the attachments folder private. The app keeps showing
// them — it reads them through the backend. Safe to run more than once.
function lockDownExistingAttachments() {
  var files = getAttachmentsFolder().getFiles();
  var count = 0;
  while (files.hasNext()) {
    var file = files.next();
    if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) {
      file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      count++;
    }
  }
  Logger.log('Made ' + count + ' attachment(s) private.');
}

// Rough timing check for PBKDF2_ITERATIONS. Run from the editor and look at
// the log: aim for well under 1 second per hash.
function timePasswordHash() {
  var start = Date.now();
  hashPassword('timing-test-password1', generateSalt());
  Logger.log('One password hash took ' + (Date.now() - start) + ' ms at ' + PBKDF2_ITERATIONS + ' iterations.');
}
