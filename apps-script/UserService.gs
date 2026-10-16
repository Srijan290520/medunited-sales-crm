// UserService.gs — user management (admin) and incentive rates (manager+)

var USER_HEADERS = ['ID', 'Name', 'Email', 'PasswordHash', 'Salt', 'Role', 'MedpassFullRate', 'MedpassDiscountRate',
  'PharmacyIncentivePercent', 'Active', 'CreatedAt', 'MustChangePassword'];
var ROLES = ['admin', 'manager', 'agent'];

function getUsersSheet() { return getOrCreateSheet('Users', USER_HEADERS); }

// What the browser may see about a user — never the hash or salt.
function sanitizeUser(u) {
  return {
    ID: String(u.ID),
    Name: String(u.Name),
    Email: String(u.Email),
    Role: String(u.Role),
    MedpassFullRate: Number(u.MedpassFullRate) || 0,
    MedpassDiscountRate: Number(u.MedpassDiscountRate) || 0,
    PharmacyIncentivePercent: Number(u.PharmacyIncentivePercent) || 0,
    Active: isActive(u.Active),
    CreatedAt: isoString(u.CreatedAt),
    MustChangePassword: asBool(u.MustChangePassword)
  };
}

function svc_listUsers(session) {
  requireRole(session, ['admin', 'manager']);
  return sheetToObjects(getUsersSheet()).filter(function (u) { return u.ID; }).map(sanitizeUser);
}

function svc_createUser(session, data) {
  requireRole(session, ['admin']);

  var email = cleanEmail(data.email);
  var name = cleanText(data.name, 80);
  var role = String(data.role || '').trim();
  var password = String(data.password || '');

  if (!email || !name || !password) throw new Error('Name, email and password are required.');
  if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
  requireOneOf(role, ROLES, 'Role');
  validatePasswordStrength(password, email);

  var sheet = getUsersSheet();
  if (sheetToObjects(sheet).some(function (u) { return String(u.Email).toLowerCase() === email; })) {
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
    MedpassFullRate: 0,
    MedpassDiscountRate: 0,
    PharmacyIncentivePercent: 0,
    Active: true,
    CreatedAt: nowIso(),
    MustChangePassword: true // the admin knows this password, so the user must pick their own
  };
  appendObject(sheet, user);
  audit(session, 'create', 'User', user.ID, auditDiff(null, user), 'Created ' + role + ' account for ' + email);
  return sanitizeUser(user);
}

function otherActiveAdmins(users, id) {
  return users.filter(function (u) {
    return String(u.ID) !== String(id) && u.Role === 'admin' && isActive(u.Active);
  });
}

function svc_updateUser(session, id, data) {
  requireRole(session, ['admin']);
  var sheet = getUsersSheet();
  var users = sheetToObjects(sheet);
  var existing = users.find(function (u) { return String(u.ID) === String(id); });
  if (!existing) throw new Error('User not found.');
  var patch = {};

  if (data.name !== undefined) {
    patch.Name = cleanText(data.name, 80);
    if (!patch.Name) throw new Error('Name is required.');
  }
  if (data.role !== undefined) {
    requireOneOf(String(data.role), ROLES, 'Role');
    patch.Role = String(data.role);
  }
  if (data.active !== undefined) patch.Active = data.active === true || data.active === 'true';
  if (data.password) {
    validatePasswordStrength(String(data.password), existing.Email);
    var salt = generateSalt();
    patch.Salt = salt; // new salt ends every session this user has open
    patch.PasswordHash = hashPassword(String(data.password), salt);
    patch.MustChangePassword = true;
  }

  // Never leave the CRM without an active admin — nobody could manage users.
  var losingAdmin = existing.Role === 'admin' && isActive(existing.Active) &&
    ((patch.Role !== undefined && patch.Role !== 'admin') || patch.Active === false);
  if (losingAdmin && otherActiveAdmins(users, id).length === 0) {
    throw new Error('This is the only active admin. Make someone else an admin first.');
  }

  // Someone who still handles patients can't simply be switched off: their
  // work goes to a successor first (see Handover.gs).
  if (patch.Active === false && isActive(existing.Active)) {
    var world = loadPatientWorld();
    var work = openWorkOf(world, existing.Email);
    if (hasOpenWork(work)) {
      if (!data.successorEmail) {
        throw new Error(existing.Name + ' still handles ' + work.patients.length + ' patient(s), ' + work.records.length +
          ' open record(s) and ' + work.reminders.length + ' reminder(s). Choose who takes over before deactivating.');
      }
      var successor = requireOwnerCandidate(world, data.successorEmail);
      if (lowerEmail(successor.email) === lowerEmail(existing.Email)) throw new Error('Choose someone else to take over.');
      handOverWork(session, world, existing, successor, 'Account of ' + existing.Name + ' deactivated by an admin.');
    }
  }

  var updated = updateObjectById(sheet, id, patch);
  if (!updated) throw new Error('User not found.');
  var changes = auditDiff(existing, patch);
  delete changes.MustChangePassword;
  if (patch.PasswordHash) changes.Password = { from: '', to: '(reset by admin)' };
  audit(session, 'update', 'User', id, changes, 'Updated account ' + existing.Email);
  return sanitizeUser(updated);
}

// Permanent removal is only allowed for accounts that never owned a record —
// otherwise their sales would lose their owner and incentive rates. Those
// accounts should be deactivated instead (they keep their history).
function svc_deleteUser(session, id, reason) {
  requireRole(session, ['admin']);
  var why = cleanText(reason, 300);
  if (why.length < 3) throw new Error('A reason is required to delete a user account.');
  if (String(id) === String(session.id)) throw new Error('You cannot delete your own account.');
  var sheet = getUsersSheet();
  var users = sheetToObjects(sheet);
  var existing = users.find(function (u) { return String(u.ID) === String(id); });
  if (!existing) throw new Error('User not found.');
  if (existing.Role === 'admin' && isActive(existing.Active) && otherActiveAdmins(users, id).length === 0) {
    throw new Error('Cannot delete the last active admin.');
  }
  var email = String(existing.Email).toLowerCase();
  var owns = Object.keys(SALE_TYPES).some(function (type) {
    return sheetToObjects(getSaleSheet(type)).some(function (s) { return String(s.AgentEmail).toLowerCase() === email; });
  });
  if (owns) throw new Error('This user has sales records. Deactivate the account instead so their history and incentives are kept.');

  var rowIndex = findRowIndexById(sheet, existing.ID);
  sheet.deleteRow(rowIndex);
  var snapshot = auditDiff(existing, null);
  audit(session, 'delete', 'User', existing.ID, snapshot, 'Deleted account ' + existing.Email + '. Reason: ' + why);
  return { deleted: true };
}

// Incentive rates are the one thing a manager (not just admin) may edit.
// Medpass pays a flat ₹ rate per sale (Full Price vs Discounted); Pharmacy
// pays a percentage of the sale amount.
function svc_updateIncentives(session, id, data) {
  requireRole(session, ['admin', 'manager']);
  var sheet = getUsersSheet();
  var patch = {};

  function rate(value, max, label) {
    var n = Number(value);
    if (value === '' || isNaN(n) || n < 0 || n > max) throw new Error(label + ' must be a number between 0 and ' + max + '.');
    return n;
  }
  if (data.medpassFullRate !== undefined && data.medpassFullRate !== '') patch.MedpassFullRate = rate(data.medpassFullRate, 1e6, 'Medpass Full Price rate');
  if (data.medpassDiscountRate !== undefined && data.medpassDiscountRate !== '') patch.MedpassDiscountRate = rate(data.medpassDiscountRate, 1e6, 'Medpass Discounted rate');
  if (data.pharmacyIncentivePercent !== undefined && data.pharmacyIncentivePercent !== '') patch.PharmacyIncentivePercent = rate(data.pharmacyIncentivePercent, 100, 'Pharmacy incentive percent');

  var existing = sheetToObjects(sheet).find(function (u) { return String(u.ID) === String(id); });
  if (!existing) throw new Error('User not found.');
  var updated = updateObjectById(sheet, id, patch);
  audit(session, 'update_incentives', 'User', id, auditDiff(existing, patch), 'Updated incentive rates for ' + existing.Email);
  return sanitizeUser(updated);
}
