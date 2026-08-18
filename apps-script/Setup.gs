// Setup.gs — one-time setup helpers. Run these from the Apps Script editor
// (select the function in the dropdown next to Run, then click Run), not
// from the web app.

function setupSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var usersHeaders = ['ID', 'Name', 'Email', 'PasswordHash', 'Salt', 'Role', 'MedpassIncentive', 'PharmacyIncentive', 'Active', 'CreatedAt'];
  var saleHeaders = ['ID', 'Date', 'AgentEmail', 'AgentName', 'CustomerName', 'Contact', 'Detail', 'Amount', 'Status', 'PaymentMethod', 'UTR', 'BillScreenshotUrl', 'PaymentScreenshotUrl', 'Notes', 'CreatedAt'];

  ensureSheet(ss, 'Users', usersHeaders);
  ensureSheet(ss, 'Medpass', saleHeaders);
  ensureSheet(ss, 'Pharmacy', saleHeaders);

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
    MedpassIncentive: 0,
    PharmacyIncentive: 0,
    Active: true,
    CreatedAt: nowIso()
  });
  Logger.log('Admin user created: ' + email);
}
