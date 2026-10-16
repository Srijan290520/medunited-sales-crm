# MedUnited Sales CRM

Tracks Medpass and Pharmacy (home delivery) enquiries from first contact to
completed sale, with refill reminders, incentives and a full audit trail.

- **Agents** see and work only their own leads and sales.
- **Managers** see the whole team, reassign work, set incentive rates and the monthly target.
- **Admins** do everything managers can, plus user accounts, dropdown lists and deletions.

Every rule is enforced on the server (Apps Script), not just hidden in the
browser — an agent's session cannot fetch another agent's records.

## What's in v2

- New React + TypeScript frontend (Kanban board and table, 3-step record form,
  activity log, history panel, dashboard charts, CSV export).
- Leads and sales are one record: a lead is a **Pending** record with
  temperature, channel, follow-up date and contact log; it becomes a sale when
  marked **Completed** (with payment proof) or **Cancelled** with a lost reason.
- **Bulk import** of leads from Excel (.xlsx) or CSV, with a row-by-row preview.
- Medicine forms (tablet, syrup, inhaler, drops, cream, injection, sachet,
  course) with correct refill-day calculations.
- Monthly revenue target (this month's completed sales), top medicines,
  payment-method breakdown, urgent follow-ups.
- Admin-only deletion with a mandatory reason; reopen for cancelled and
  (manager-only, with reason) completed sales.
- Security hardening — see [SECURITY.md](SECURITY.md).

## How it fits together

```
Browser (static React app, any host)
   │  HTTPS POST  action + token + JSON payload
   ▼
Google Apps Script Web App  (apps-script/*.gs)
   │
   ├── Google Sheet: Users, Medpass, Pharmacy, Reminders, SaleActivities,
   │                 Lists, Settings, AuditLog (protected)
   └── Google Drive: "MedUnited Sales CRM Attachments" (private screenshots)
```

The frontend is plain static files, so it can be hosted anywhere. It reads the
backend URL at runtime from `config.js`, so the same build works with any
Apps Script deployment without rebuilding.

---

## 1. Set up the backend (Google Sheet + Apps Script)

1. Create a new Google Sheet (e.g. "MedUnited Sales CRM Data"), using the
   Google account that should **own** the data (ideally a MedUnited
   workspace account, not a personal one).
2. **Extensions → Apps Script.** Delete the default `Code.gs`, then create one
   file per `.gs` file in `apps-script/` and paste each in:
   `Activities, Attachments, Audit, Auth, Code, Import, Lists, Reminders,
   SalesService, Setup, SmokeTest, UserService, Utils`.
3. **Project Settings (gear) → "Show appsscript.json manifest file"** → open
   `appsscript.json` and replace it with `apps-script/appsscript.json`.
   *(Or use [clasp](https://github.com/google/clasp): `clasp push` from the
   `apps-script/` folder.)*
4. Select **`setupSpreadsheet`** in the function dropdown → **Run** →
   authorize. All tabs are created; the AuditLog tab is protected.
5. Create the first admin **without putting a password in code**:
   **Project Settings → Script properties → Add**:
   - `ADMIN_EMAIL` = your work email
   - `ADMIN_PASSWORD` = a temporary password (10+ chars, letters and numbers)
   - `ADMIN_NAME` (optional)

   Then run **`createFirstAdmin`**. The password property is deleted
   automatically, and you'll be asked to choose a new password at first login.
6. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (the app has its own login; this only lets the
     browser reach the URL)

   Copy the **Web app URL** (ends in `/exec`).

> **After any `.gs` change:** Deploy → Manage deployments → ✏️ → Version:
> **New version** → Deploy. The `/exec` URL stays the same.

## 2. Point the frontend at the backend

Edit `public/config.js` (or `config.js` next to `index.html` on the server):

```js
window.__CRM_CONFIG__ = {
  apiUrl: 'https://script.google.com/macros/s/XXXXXXXX/exec',
  appName: 'MedUnited CRM'
};
```

## 3. Build and host the frontend

```bash
npm ci
npm run test:backend   # backend tests against mocked Google services
npm run build          # → dist/
```

`dist/` is the whole app. Hosting options:

| Option | How |
|---|---|
| **GitHub Pages** (current) | Repo Settings → Pages → Source: **GitHub Actions**. Every push to `master` runs `.github/workflows/deploy-pages.yml` (tests → build → publish). |
| **Any web server / intranet** | Copy `dist/` to the server. Use `deploy/nginx.conf` for nginx (security headers, caching). |
| **Docker** | `docker build -f deploy/Dockerfile -t medunited-crm .` then `docker run -p 8080:8080 -e CRM_API_URL="https://script.google.com/macros/s/XXXX/exec" medunited-crm` behind your HTTPS proxy. |
| **Netlify / Cloudflare Pages** | Build command `npm run build`, output `dist`. Security headers come from `public/_headers`. |
| **S3 / Azure Static Web Apps / Firebase Hosting** | Upload `dist/`; add the headers from `deploy/nginx.conf` in that host's config. |

The build uses relative paths, so it works from a sub-folder (e.g. `/crm/`).
Always serve it over **HTTPS**.

## 4. First login

Log in with the admin email and temporary password → choose your own
password → **Users** page → create managers and agents (each gets a temporary
password and must change it at first login) → **Incentives** page → set rates
and the monthly target.

---

## Bulk import (Medpass / Pharmacy page → **Import**)

- Excel **.xlsx** or **.csv**, up to **500 rows** and 5 MB per file
  (old `.xls`: save as `.xlsx` first). Use **Download the template** in the dialog.
- Required columns: **Customer Name**, **Phone**. Optional: Temperature,
  Direction, Channel, Heard From, Next Follow-up, Notes, Details, Price Type
  (Medpass), Amount, Agent Email, Date, Consent, Do Not Call. Common header
  names are recognised ("Mobile Number", "Lead Source", "Remarks", …).
- Dates: `YYYY-MM-DD` or `DD/MM/YYYY`.
- Nothing is saved until you've seen the preview. Rows with problems (missing
  name, bad phone, duplicate in the file, number that already has an open
  record, unknown agent, bad date) are listed and skipped; you can download
  them as a CSV, fix, and import again. Re-importing the same file never
  creates duplicates.
- Every imported row is a **Pending** lead. Managers/admins choose who gets
  rows without an Agent Email; agents always import for themselves.

## Refill reminders (Pharmacy)

A reminder is created when a Pharmacy sale is **Completed** with at least one
medicine. Days of supply by form:

| Form | Days |
|---|---|
| tablet / sachet | quantity ÷ (doses per day × units per dose) |
| syrup | (bottle ml × bottles) ÷ (ml per dose × doses per day) |
| inhaler | puffs ÷ (puffs per dose × doses per day) |
| injection | units ÷ units per dose |
| cream / drops | 15 days per unit |
| course / custom days | the number of days given |

Countdowns are computed live in India time. "Couldn't connect" attempts are
logged; after 3+ days without contact the reminder is flagged for a manager.

## Upgrading from v1 (the static HTML version)

The data so far is test data, so the simplest path is a fresh Sheet (section 1).
To keep the existing Sheet instead:

1. Replace every `.gs` file with the v2 versions, add the new files
   (`Activities`, `Import`, `Lists`), delete `Leads.gs`, update the manifest.
2. Run `setupSpreadsheet` — it adds the new columns and tabs and never deletes data.
3. Deploy a **new version** of the existing deployment (URL stays the same).
4. Deploy the new frontend at the same time — the v1 pages can't talk to the
   v2 backend.

Old `Leads` / `LeadActivities` tabs are no longer used and can be deleted once
you no longer need them. Existing users keep their passwords.

## Development

```bash
npm run dev            # http://127.0.0.1:3000 (set VITE_API_URL or public/config.js)
npm run test:backend   # node --test, no Google account needed
node tests/e2e/server.cjs 4173   # serves dist/ + a mocked backend for browser testing
```

`tests/backend/gas-mock.cjs` runs the real `.gs` files under Node with
in-memory Sheets, Drive, Cache and Lock services.

## Operations checklist

- **Health check:** after setup or a new deployment, run **`smokeTestV2`**
  in the Apps Script editor and read the log — every line should start with
  `PASS`. It is read-only (the import step is a dry run).

- **Backups:** File → Version history in the Sheet, plus a scheduled copy
  (e.g. a time-driven trigger that `makeCopy`s the file weekly).
- **Sheet sharing:** only admins should have edit access to the Sheet itself;
  anyone with Sheet access can read every row.
- **Owner leaving:** the script runs as the deploying account. Transfer the
  Sheet, the attachments folder and the deployment before that account is removed.
- **Limits:** Apps Script handles roughly 30 requests at the same time and
  every save waits for a script-wide lock, and Sheets slows down past tens
  of thousands of rows. That's fine for a sales team of a few dozen people;
  beyond that, plan a move to a dedicated server and database.
