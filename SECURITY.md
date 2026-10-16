# Security model

What protects the CRM's data, and what still depends on how it's run.
Report problems privately to the repository owner, not in public issues.

## Accounts and sessions

| Control | Detail |
|---|---|
| Password storage | PBKDF2-HMAC-SHA256, per-user salt; old SHA-256 hashes upgrade on next login. Hashes and salts never leave the server or appear in the audit log. |
| Password policy | 10–128 characters, letters and numbers, must not contain the email name or start with common words. |
| First login / admin reset | Temporary passwords set by an admin (or the setup script) must be changed before anything else works — enforced on the server. |
| No passwords in code | The first admin is created from Script properties, and the property is deleted afterwards. The demo accounts and "switch user" control from the prototype are gone. |
| Lockout | 5 wrong passwords for an email → locked for 15 minutes; logged. Login responses are identical for unknown emails and wrong passwords. |
| Sessions | Random 244-bit tokens kept server-side (CacheService). Idle timeout 2 hours, hard limit 12 hours. Stored in the browser's `sessionStorage`, so closing the tab/browser ends it on shared computers. |
| Instant revocation | Every request re-reads the user's row: deactivation, role change and password reset take effect on the next click. A password change signs out every other session. |
| Rate limiting | 120 requests per minute per user and per login email. |

## Authorization (server-side)

- Agents only read or change records where they are the assigned agent —
  lists, details, attachments, reminders, dashboard and history are all
  filtered on the server.
- Completed sales are locked for agents except medicines and notes.
- Only managers and above reassign, reopen completed sales (with a reason),
  edit incentives and the monthly target. Admins and senior managers manage
  users (senior managers: non-admin accounts only), edit dropdown lists and
  Medpass prices, approve discounts and deactivations. Only admins create or
  change admin accounts and delete records or users (with a reason). Nobody
  approves a request about their own account. The last active admin
  can't be removed or demoted; accounts with sales can only be deactivated.
- Duplicate checks tell other agents only that an open record exists and who
  owns it — never the customer's details.
- **One agent per patient** is enforced on the server: new records for a
  patient go to their owner whatever the browser sends; an agent can't move a
  record onto another agent's patient by editing its phone number, or reopen a
  record whose patient is now someone else's. The people sharing a phone
  number are shown only to that number's owner and to managers/admins.
- Incentive amounts are for managers and above only: the incentive report,
  the Incentives page and the incentive column of team figures are refused or
  removed for agents on the server. Agents see their own targets, never
  anyone else's.
- The audit log viewer is for admins and senior managers (summaries name
  patients and amounts).
- Dashboard layouts only choose which widgets are drawn. Every widget's data
  comes from the same role-filtered summary; team-only widgets are refused for
  agents when a layout is saved, and their data is never sent to agents.
- Bulk reassign, reassign from file and agent handover are for managers and
  above, run under the script lock, recheck every row on the real run, and
  audit each moved record plus a summary.
- Deactivating someone who still handles patients requires a successor; the
  handover and the deactivation happen in one locked, audited step. Managers
  can only request it; admins approve.
- Medpass prices are computed on the server from the members, price type and
  Settings; Homekare and Lab & Radiology amounts are the server's sum of the
  typed lines (Homekare services must come from the catalogue). An amount sent
  by the browser is ignored for these modules. A discount can't be
  completed until an admin or senior manager approves it, and the decision is
  audited.
- Patient migration never changes a record's agent and never guesses an owner:
  numbers handled by several agents wait for an admin decision.

## Data handling

- **Input validation:** every field is type-checked, length-limited and
  stripped of control characters; dropdown values must come from the lists;
  dates must be real calendar days; amounts and medicine quantities are bounded.
- **Spreadsheet formula injection:** values starting with `= + - @` are
  stored as text in the Sheet and prefixed with `'` in CSV exports.
- **Screenshots:** PNG/JPEG/WEBP/GIF only, checked by file signature (not
  just the name), max 5 MB, stored privately in Drive. Drive links never reach
  the browser; images are streamed through the API after an access check.
- **Audit log:** every create/update/delete/reassign/import/login/password
  change is appended to the protected `AuditLog` tab with who, when and
  field-by-field changes.
- **Errors:** unexpected server errors are logged in Apps Script and the
  browser gets a generic message — no stack traces or internals.
- **Concurrency:** all writes run under a script-wide lock.

## Browser

- Content Security Policy: scripts only from the app itself; network calls
  only to Google Apps Script; no plugins; no framing (header where the host
  supports it, plus a script guard for GitHub Pages).
- `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`,
  `noindex` — see `deploy/nginx.conf` and `public/_headers`.
- API calls are sent without cookies or referrer. React escapes all text, and
  external links open with `noopener`.
- `npm audit` runs in CI.

## What depends on you

- **Who can open the Google Sheet.** Anyone with access to the Sheet can read
  every row directly. Keep it to admins, and use a MedUnited workspace account
  as the owner.
- **HTTPS** on whatever host serves the frontend (GitHub Pages and the
  managed hosts do this automatically).
- **Patient data rules.** Phone numbers and medicines are personal health
  data. Check the setup with MedUnited's IT/compliance team (consent records,
  retention period, who may export CSVs) before go-live.
- **Backups** of the Sheet (see README → Operations).
- Apps Script web apps must be reachable by "Anyone" for the browser to call
  them; the app's own login and these server checks are what protect the data.
