// UserService.gs — user management (admin) and incentive rates (manager+)

function sanitizeUser(u) {
  return {
    ID: u.ID,
    Name: u.Name,
    Email: u.Email,
    Role: u.Role,
    MedpassFullRate: Number(u.MedpassFullRate) || 0,
    MedpassDiscountRate: Number(u.MedpassDiscountRate) || 0,
    PharmacyIncentivePercent: Number(u.PharmacyIncentivePercent) || 0,
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
    MedpassFullRate: Number(data.medpassFullRate) || 0,
    MedpassDiscountRate: Number(data.medpassDiscountRate) || 0,
    PharmacyIncentivePercent: Number(data.pharmacyIncentivePercent) || 0,
    Active: true,
    CreatedAt: nowIso()
  };
  appendObject(sheet, user);
  audit(session, 'create', 'User', user.ID, auditDiff(null, user));
  return sanitizeUser(user);
}

function svc_updateUser(session, id, data) {
  requireRole(session, ['admin']);
  var sheet = getSheetByName('Users');
  var users = sheetToObjects(sheet);
  var existing = users.find(function (u) { return String(u.ID) === String(id); });
  if (!existing) throw new Error('User not found.');
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

  // Never leave the CRM without an active admin — nobody could manage users.
  var losingAdmin = existing.Role === 'admin' && isActive(existing.Active) &&
    ((patch.Role !== undefined && patch.Role !== 'admin') || patch.Active === false);
  if (losingAdmin) {
    var otherActiveAdmins = users.filter(function (u) {
      return String(u.ID) !== String(id) && u.Role === 'admin' && isActive(u.Active);
    });
    if (otherActiveAdmins.length === 0) {
      throw new Error('This is the only active admin. Make someone else an admin first.');
    }
  }

  var updated = updateObjectById(sheet, id, patch);
  if (!updated) throw new Error('User not found.');
  var changes = auditDiff(existing, patch);
  if (patch.PasswordHash) changes.Password = { from: '', to: '(reset)' };
  audit(session, 'update', 'User', id, changes);
  return sanitizeUser(updated);
}

// Incentive rates are the one thing a manager (not just admin) is allowed to edit.
// Medpass pays a flat ₹ rate per sale (different rate depending on whether it
// was sold at Full Price or Discounted); Pharmacy pays a percentage of the
// sale amount.
function svc_updateIncentives(session, id, data) {
  requireRole(session, ['admin', 'manager']);
  var sheet = getSheetByName('Users');
  var patch = {};

  if (data.medpassFullRate !== undefined) {
    var mf = Number(data.medpassFullRate);
    if (isNaN(mf) || mf < 0) throw new Error('Medpass Full Price rate must be a non-negative number.');
    patch.MedpassFullRate = mf;
  }
  if (data.medpassDiscountRate !== undefined) {
    var md = Number(data.medpassDiscountRate);
    if (isNaN(md) || md < 0) throw new Error('Medpass Discounted rate must be a non-negative number.');
    patch.MedpassDiscountRate = md;
  }
  if (data.pharmacyIncentivePercent !== undefined) {
    var p = Number(data.pharmacyIncentivePercent);
    if (isNaN(p) || p < 0 || p > 100) throw new Error('Pharmacy incentive percent must be between 0 and 100.');
    patch.PharmacyIncentivePercent = p;
  }

  var existing = sheetToObjects(sheet).find(function (u) { return String(u.ID) === String(id); });
  if (!existing) throw new Error('User not found.');
  var updated = updateObjectById(sheet, id, patch);
  audit(session, 'update_incentives', 'User', id, auditDiff(existing, patch));
  return sanitizeUser(updated);
}
