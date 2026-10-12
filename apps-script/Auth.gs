// Auth.gs — login/logout and session handling
//
// Sessions are opaque tokens kept server-side in CacheService (never in the
// sheet). Every request re-checks the user's row in the Users sheet, so
// deactivating someone, changing their role, or resetting their password
// takes effect on their very next request — not when the session expires.
//
// Passwords are hashed with PBKDF2-HMAC-SHA256 (many rounds, per-user salt).
// Accounts created before this change have a single-round SHA-256 hash; those
// still work and are upgraded to PBKDF2 automatically the next time that
// person logs in successfully.

var SESSION_TTL_SECONDS = 6 * 60 * 60; // 6 hours — CacheService's own max
var SESSION_CACHE_PREFIX = 'sess_';

var PBKDF2_ITERATIONS = 5000; // raise if logins stay fast; each login costs this many HMACs
var HASH_PREFIX = 'pbkdf2$';  // stored as pbkdf2$<iterations>$<hex>

var LOGIN_MAX_FAILURES = 5;
var LOGIN_LOCKOUT_SECONDS = 15 * 60;
var LOGIN_FAIL_PREFIX = 'loginfail_';

// Session is missing/expired/revoked — the frontend logs the user out.
function AuthError(message) {
  this.name = 'AuthError';
  this.message = message;
}
AuthError.prototype = Object.create(Error.prototype);

// Logged in, but not allowed to do this — the frontend just shows the message.
function ForbiddenError(message) {
  this.name = 'ForbiddenError';
  this.message = message;
}
ForbiddenError.prototype = Object.create(Error.prototype);

function generateSalt() {
  return Utilities.getUuid();
}

function bytesToHex(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function stringToBytes(str) {
  return Utilities.newBlob(String(str)).getBytes();
}

// PBKDF2-HMAC-SHA256, one 32-byte output block.
function pbkdf2Hex(password, salt, iterations) {
  var key = stringToBytes(password);
  var u = Utilities.computeHmacSha256Signature(stringToBytes(salt).concat([0, 0, 0, 1]), key);
  var out = u.slice();
  for (var i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, key);
    for (var j = 0; j < out.length; j++) out[j] ^= u[j];
  }
  return bytesToHex(out);
}

function hashPassword(password, salt) {
  return HASH_PREFIX + PBKDF2_ITERATIONS + '$' + pbkdf2Hex(password, salt, PBKDF2_ITERATIONS);
}

// The original scheme: single SHA-256 over "password:salt". Only used to
// verify (and then upgrade) accounts created before PBKDF2.
function legacyHashPassword(password, salt) {
  return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + ':' + salt));
}

function isLegacyHash(stored) {
  return String(stored).indexOf(HASH_PREFIX) !== 0;
}

// Compares every character regardless of where the first mismatch is, so
// response time doesn't leak how much of a hash was right.
function constantTimeEquals(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  var len = Math.max(a.length, b.length);
  for (var i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function verifyPassword(password, user) {
  var stored = String(user.PasswordHash || '');
  if (isLegacyHash(stored)) {
    return constantTimeEquals(legacyHashPassword(password, user.Salt), stored);
  }
  var parts = stored.split('$'); // ['pbkdf2', iterations, hex]
  var iterations = Number(parts[1]) || PBKDF2_ITERATIONS;
  return constantTimeEquals(pbkdf2Hex(password, user.Salt, iterations), parts[2]);
}

function isActive(value) {
  return value === true || String(value).toUpperCase() === 'TRUE';
}

function loginFailureCount(email) {
  return Number(CacheService.getScriptCache().get(LOGIN_FAIL_PREFIX + email)) || 0;
}

function recordLoginFailure(email) {
  var count = loginFailureCount(email) + 1;
  CacheService.getScriptCache().put(LOGIN_FAIL_PREFIX + email, String(count), LOGIN_LOCKOUT_SECONDS);
  if (count === LOGIN_MAX_FAILURES) {
    audit({ email: email, name: '', role: '' }, 'login_locked', 'User', email,
      { failedAttempts: { from: '', to: count } });
  }
}

function login(email, password) {
  email = String(email || '').trim().toLowerCase();
  if (!email || !password) return { error: true, message: 'Email and password are required.' };

  if (loginFailureCount(email) >= LOGIN_MAX_FAILURES) {
    return { error: true, message: 'Too many failed attempts. Try again in 15 minutes, or ask an admin to reset your password.' };
  }

  var users = sheetToObjects(getSheetByName('Users'));
  var user = users.find(function (u) { return String(u.Email).toLowerCase() === email; });

  // Hash even when the email doesn't exist, so response time doesn't reveal
  // which emails have accounts.
  if (!user) pbkdf2Hex(password, 'no-such-user', PBKDF2_ITERATIONS);

  if (!user || !verifyPassword(password, user)) {
    recordLoginFailure(email);
    return { error: true, message: 'Invalid email or password.' };
  }
  if (!isActive(user.Active)) return { error: true, message: 'This account has been deactivated. Contact your admin.' };

  CacheService.getScriptCache().remove(LOGIN_FAIL_PREFIX + email);

  // Upgrade an old single-round hash now that we know the password. The salt
  // stays the same, so this doesn't invalidate the person's other sessions.
  if (isLegacyHash(user.PasswordHash)) {
    withScriptLock(function () {
      updateObjectById(getSheetByName('Users'), user.ID, { PasswordHash: hashPassword(password, user.Salt) });
    });
  }

  var token = Utilities.getUuid();
  var session = { id: user.ID, email: user.Email, name: user.Name, role: user.Role, salt: user.Salt };
  CacheService.getScriptCache().put(SESSION_CACHE_PREFIX + token, JSON.stringify(session), SESSION_TTL_SECONDS);

  return { error: false, token: token, user: publicSession(session) };
}

// What the browser gets to see (no salt).
function publicSession(session) {
  return { id: session.id, email: session.email, name: session.name, role: session.role };
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

  // Re-check the live user row: deactivated, deleted, or password reset
  // (new salt) all end the session immediately.
  var user = sheetToObjects(getSheetByName('Users')).find(function (u) { return String(u.ID) === String(session.id); });
  if (!user || !isActive(user.Active) || String(user.Salt) !== String(session.salt)) {
    CacheService.getScriptCache().remove(SESSION_CACHE_PREFIX + token);
    throw new AuthError('Your session has ended. Please log in again.');
  }

  // Role/name changes apply right away.
  session.role = user.Role;
  session.name = user.Name;
  session.email = user.Email;

  // Sliding expiration: any activity extends the session another 6 hours.
  CacheService.getScriptCache().put(SESSION_CACHE_PREFIX + token, JSON.stringify(session), SESSION_TTL_SECONDS);
  return session;
}

function requireRole(session, allowedRoles) {
  if (allowedRoles.indexOf(session.role) === -1) {
    throw new ForbiddenError('You do not have permission to perform this action.');
  }
}
