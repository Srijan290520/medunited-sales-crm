// Auth.gs — login/logout and session handling
//
// Sessions are opaque tokens kept server-side in CacheService (never in the
// sheet), so a stolen token only works for its 6-hour lifetime. Passwords are
// never stored or returned in plain text — only a salted SHA-256 hash.

var SESSION_TTL_SECONDS = 6 * 60 * 60; // 6 hours — CacheService's own max
var SESSION_CACHE_PREFIX = 'sess_';

function AuthError(message) {
  this.name = 'AuthError';
  this.message = message;
}
AuthError.prototype = Object.create(Error.prototype);

function generateSalt() {
  return Utilities.getUuid();
}

function hashPassword(password, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + ':' + salt);
  return raw.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function isActive(value) {
  return value === true || String(value).toUpperCase() === 'TRUE';
}

function login(email, password) {
  email = String(email || '').trim().toLowerCase();
  if (!email || !password) return { error: true, message: 'Email and password are required.' };

  var users = sheetToObjects(getSheetByName('Users'));
  var user = users.find(function (u) { return String(u.Email).toLowerCase() === email; });

  if (!user) return { error: true, message: 'Invalid email or password.' };
  if (!isActive(user.Active)) return { error: true, message: 'This account has been deactivated. Contact your admin.' };
  if (hashPassword(password, user.Salt) !== user.PasswordHash) {
    return { error: true, message: 'Invalid email or password.' };
  }

  var token = Utilities.getUuid();
  var session = { id: user.ID, email: user.Email, name: user.Name, role: user.Role };
  CacheService.getScriptCache().put(SESSION_CACHE_PREFIX + token, JSON.stringify(session), SESSION_TTL_SECONDS);

  return { error: false, token: token, user: session };
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove(SESSION_CACHE_PREFIX + token);
  return { error: false };
}

function getSession(token) {
  if (!token) return null;
  var raw = CacheService.getScriptCache().get(SESSION_CACHE_PREFIX + token);
  return raw ? JSON.parse(raw) : null;
}

function requireSession(token) {
  var session = getSession(token);
  if (!session) throw new AuthError('Your session has expired. Please log in again.');
  // Sliding expiration: any activity extends the session another 6 hours.
  CacheService.getScriptCache().put(SESSION_CACHE_PREFIX + token, JSON.stringify(session), SESSION_TTL_SECONDS);
  return session;
}

function requireRole(session, allowedRoles) {
  if (allowedRoles.indexOf(session.role) === -1) {
    throw new AuthError('You do not have permission to perform this action.');
  }
}
