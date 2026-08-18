// UserService.gs — user management (admin) and incentive rates (manager+)

function sanitizeUser(u) {
  return {
    ID: u.ID,
    Name: u.Name,
    Email: u.Email,
    Role: u.Role,
    MedpassIncentive: Number(u.MedpassIncentive) || 0,
    PharmacyIncentive: Number(u.PharmacyIncentive) || 0,
    Active: isActive(u.Active),
    CreatedAt: u.CreatedAt
  };
}

function svc_listUsers(session) {
  requireRole(session, ['admin', 'manager']);
  return sheetToObjects(getSheetByName('Users')).map(sanitizeUser);
}

function svc_createUser(session, data) {
  requireRole(session, ['admin']);

  var email = String(data.email || '').trim().toLowerCase();
  var name = String(data.name || '').trim();
  var role = String(data.role || '').trim();
  var password = String(data.password || '');

  if (!email || !name || !password) throw new Error('Name, email and password are required.');
  if (['admin', 'manager', 'agent'].indexOf(role) === -1) throw new Error('Role must be admin, manager or agent.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');

  var sheet = getSheetByName('Users');
  var existing = sheetToObjects(sheet);
  if (existing.some(function (u) { return String(u.Email).toLowerCase() === email; })) {
    throw new Error('A user with this email already exists.');
  }

  var salt = generateSalt();
  var user = {
    ID: newId(),
    Name: name,
    Email: email,
    PasswordHash: hashPassword(password, salt),
    Salt: salt,
    Role: role,
    MedpassIncentive: Number(data.medpassIncentive) || 0,
    PharmacyIncentive: Number(data.pharmacyIncentive) || 0,
    Active: true,
    CreatedAt: nowIso()
  };
  appendObject(sheet, user);
  return sanitizeUser(user);
}

function svc_updateUser(session, id, data) {
  requireRole(session, ['admin']);
  var sheet = getSheetByName('Users');
  var patch = {};

  if (data.name !== undefined) patch.Name = String(data.name).trim();
  if (data.role !== undefined) {
    if (['admin', 'manager', 'agent'].indexOf(data.role) === -1) throw new Error('Invalid role.');
    patch.Role = data.role;
  }
  if (data.active !== undefined) patch.Active = !!data.active;
  if (data.password) {
    if (String(data.password).length < 8) throw new Error('Password must be at least 8 characters.');
    var salt = generateSalt();
    patch.Salt = salt;
    patch.PasswordHash = hashPassword(String(data.password), salt);
  }

  var updated = updateObjectById(sheet, id, patch);
  if (!updated) throw new Error('User not found.');
  return sanitizeUser(updated);
}

// Incentive rates are the one thing a manager (not just admin) is allowed to edit.
function svc_updateIncentives(session, id, data) {
  requireRole(session, ['admin', 'manager']);
  var sheet = getSheetByName('Users');
  var patch = {};

  if (data.medpassIncentive !== undefined) {
    var m = Number(data.medpassIncentive);
    if (isNaN(m) || m < 0) throw new Error('Medpass incentive must be a non-negative number.');
    patch.MedpassIncentive = m;
  }
  if (data.pharmacyIncentive !== undefined) {
    var p = Number(data.pharmacyIncentive);
    if (isNaN(p) || p < 0) throw new Error('Pharmacy incentive must be a non-negative number.');
    patch.PharmacyIncentive = p;
  }

  var updated = updateObjectById(sheet, id, patch);
  if (!updated) throw new Error('User not found.');
  return sanitizeUser(updated);
}
