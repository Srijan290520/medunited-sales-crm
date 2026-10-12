// Setup.gs — one-time setup helpers. Run these from the Apps Script editor
// (select the function in the dropdown next to Run, then click Run), not
// from the web app.

function setupSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var usersHeaders = ['ID', 'Name', 'Email', 'PasswordHash', 'Salt', 'Role', 'MedpassFullRate', 'MedpassDiscountRate', 'PharmacyIncentivePercent', 'Active', 'CreatedAt'];
  var saleHeaders = ['ID', 'Date', 'AgentEmail', 'AgentName', 'CustomerName', 'Contact', 'Detail', 'Products', 'Amount', 'Status', 'PriceType', 'PaymentMethod', 'UTR', 'BillScreenshotUrl', 'PaymentScreenshotUrl', 'Notes', 'CreatedAt'];
  var reminderHeaders = ['ID', 'PharmacySaleID', 'AgentEmail', 'AgentName', 'Reassigned', 'CustomerName', 'Contact', 'Products', 'SaleDate', 'Status', 'ResolutionReason', 'AttemptCount', 'LastAttemptDate', 'CreatedAt', 'UpdatedAt'];

  ensureSheet(ss, 'Users', usersHeaders);
  ensureSheet(ss, 'Medpass', saleHeaders);
  ensureSheet(ss, 'Pharmacy', saleHeaders);
  ensureSheet(ss, 'Reminders', reminderHeaders);
  getAuditSheet(); // creates + protects the AuditLog tab if it's missing

  Logger.log('Sheets are ready. Now edit and run createFirstAdmin() to create your admin login.');
}

function ensureSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

// EDIT the email/password below, then select this function and click Run.
// Change the password again after your first login.
function createFirstAdmin() {
  var email = 'you@medunited.example';   // <-- change this
  var password = 'ChangeMe123!';         // <-- change this
  var name = 'Admin';

  var sheet = getSheetByName('Users');
  var existing = sheetToObjects(sheet);
  if (existing.some(function (u) { return String(u.Email).toLowerCase() === email.toLowerCase(); })) {
    Logger.log('A user with that email already exists — nothing to do.');
    return;
  }

  var salt = generateSalt();
  appendObject(sheet, {
    ID: newId(),
    Name: name,
    Email: email.toLowerCase(),
    PasswordHash: hashPassword(password, salt),
    Salt: salt,
    Role: 'admin',
    MedpassFullRate: 0,
    MedpassDiscountRate: 0,
    PharmacyIncentivePercent: 0,
    Active: true,
    CreatedAt: nowIso()
  });
  Logger.log('Admin user created: ' + email);
}

// ONE-TIME, after upgrading to the private-attachments version: makes every
// screenshot already in the attachments folder private (they used to be
// shared "anyone with the link"). The app keeps showing them — it now reads
// them through the backend. Safe to run more than once.
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
  hashPassword('timing-test-password', generateSalt());
  Logger.log('One password hash took ' + (Date.now() - start) + ' ms at ' + PBKDF2_ITERATIONS + ' iterations.');
}
