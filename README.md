# MedUnited Sales CRM

Tracks Medpass, Pharmacy (home delivery), Homekare and Lab & Radiology
enquiries from first contact to completed sale, with refill and renewal
reminders, incentives and a full audit trail.

- **Agents** see and work only their own leads and sales.
- **Managers** see the whole team, reassign work, set incentive rates and the monthly target,
  and ask for agents to be deactivated (naming who takes over).
- **Senior managers** do everything admins can except manage admin accounts and
  delete records or users: they approve Medpass discounts and deactivations,
  manage non-admin accounts, dropdown lists and Medpass prices.
- **Admins** do everything, including admin accounts and deletions (always with a reason).
- **One agent per patient**: every record of a patient, in every module, goes to
  the agent who handles that patient (see [Patients and owners](#patients-and-owners)).

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
- **Patients and owners** (one agent per patient and household), patient-level
  reassign, deactivation with handover. Modules are configuration (`Modules.gs`).
- **Calmer module pages** (one search, Filters, a list with a side panel) and a
  **customizable dashboard** (see [Pages and dashboard](#pages-and-dashboard)).
- **Medpass family pass** rules: members, server-side price, discount approval,
  OP conversions, one-year validity (see [Medpass](#medpass-family-pass)).

## How it fits together

```
Browser (static React app, any host)
   │  HTTPS POST  action + token + JSON payload
   ▼
Google Apps Script Web App  (apps-script/*.gs)
   │
   ├── Google Sheet: Users, Medpass, Pharmacy, Homekare, Lab & Radiology, Patients,
   │                 Reminders, SaleActivities, UserRequests, UserLayouts, Targets,
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
   `Activities, Attachments, Audit, Auth, BulkReassign, Code, DashboardLayouts,
   Handover, Homekare, Import, Incentives, Lab, Lists, Medpass, Modules, Patients,
   Reminders, SalesService, Setup, SmokeTest, UserService, Utils`.
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

## Bulk import (any module page → **Import**)

- Excel **.xlsx** or **.csv**, up to **500 rows** and 5 MB per file
  (old `.xls`: save as `.xlsx` first). Use **Download the template** in the dialog.
- Required columns: **Customer Name**, **Phone**. Optional: Temperature,
  Direction, Channel, Heard From, Next Follow-up, Notes, Details, Price Type
  (Medpass), Amount, Agent Email, Date, Consent, Do Not Call. Common header
  names are recognised ("Mobile Number", "Lead Source", "Remarks", …).
- Dates: `YYYY-MM-DD` or `DD/MM/YYYY`.
- Nothing is saved until you've seen the preview. Rows with problems (missing
  name, bad phone, the same person twice in the file, a person who already has
  an open record in this module, unknown agent, bad date) are listed and skipped; you can download
  them as a CSV, fix, and import again. Re-importing the same file never
  creates duplicates.
- Every imported row is a **Pending** lead. Managers/admins choose who gets
  rows without an Agent Email; agents always import for themselves.
- A row for a patient (or household) someone already handles goes to that
  agent; the preview shows "Already handled by …" on those rows.

## Settings, incentives and targets

- **Settings** (managers and above) has a menu on the left: incentive rates,
  monthly targets, dropdown lists, service catalogues (Medpass prices, Homekare
  services — add or hide, never delete), patient owners, users, and for admins
  and senior managers the **audit log** (search, action, dates).
- **Monthly targets** per agent and module. Each module is measured as
  **revenue** (default) or **number of sales** (admins / senior managers
  choose). **Copy last month** fills a new month without overwriting what is
  already set. Agents see their own targets and progress on their dashboard.
  Hitting a target does not change incentives (for later).
- **Incentives** page (managers and above): pick a month; totals per module,
  each agent's incentive with the sales behind it, and **Export payout sheet**
  / **Export sales** (CSV). Incentives use each agent's *current* rates, so a
  rate change also changes earlier months. **Agents never see incentive
  amounts.** Homekare and Lab & Radiology have no incentive rule yet.

## Pages and dashboard

- **Module pages** (Medpass, Pharmacy, Homekare, Lab & Radiology) share one
  layout: a search box, **Filters** (agent, channel, payment, price type),
  **⋯ More** (import, export, reassign from file, board view) and **New record**.
  Status tabs and **lead temperature** chips (Hot / Warm / Cold) sit above a
  list; clicking a record opens its details beside the list, with Log a call,
  WhatsApp and Edit.
- **Dashboard**: widgets you can **Customize** — add, move, resize, remove —
  and **Save** for yourself (saved on the server, `UserLayouts` tab). Without
  your own layout you get your role's default; admins and senior managers can
  make a layout the default for agents or for the team. Team-only widgets
  (discount approvals, team performance) can't be added by agents, and **the
  layout never changes what you can see**: the server filters every widget's
  data by role.

## Homekare

- A record lists one or more services picked from MedUnited's 38 Homekare
  services (names exactly as in the billing system, see
  `apps-script/Homekare.gs` and `docs/catalogues/homekare-services.csv`).
- **Prices vary per patient**, so the agent types each service's price; the
  server adds them up for the amount.
- **Monthly packages** (caretaker monthly, caretaker with travel package, major
  dressing monthly, suction operator per month): when the sale is Completed, a
  **renewal reminder** appears on the Reminders page. The package runs one
  month from the record date (1 Oct → 31 Oct; 31 Jan → 28 Feb); the reminder is
  due 5 days before it ends. Next month's completed package marks the old
  reminder **Renewed**. Reminders follow the patient when reassigned.
- Not tracked yet (to be decided): visit dates, number of days/visits, staff sent.
- No incentive yet (to be added with the Incentives page).

## Lab & Radiology

- Tests and packages are **typed by hand** for now: name, Lab or Radiology,
  price. The amount is their sum (server-side).
- Optional: home sample collection (+ date), appointment date, report
  delivered on + by (WhatsApp, Email, Collected, Other). Agents can update
  these after the sale is Completed (reports come later), but not the tests
  or prices.
- No incentive yet (to be added with the Incentives page).

## Medpass (family pass)

A Medpass is a **one-year pass for a family**: father, mother and their
children **under 21** on the sale date. Older children and other relatives
(e.g. grandparents on the same phone number) take their own pass.

| | Default (Settings → Medpass prices) |
|---|---|
| Price (family of four) | ₹1,499 |
| Children included | 2 |
| Extra child | +₹375 each, up to 2 more (₹1,874 with a third child, ₹2,249 with a fourth) — the same for a single parent |
| Maximum discount | ₹200 |
| Single parent may buy a family pass | Yes |

- The **server works out the price** from the members and the price type;
  nobody types an amount for Medpass.
  - **Full Price**: price + extra-child fee.
  - **Discounted**: up to ₹200 off, with a reason. An **admin or senior
    manager approves** it (Medpass page → *Discounts waiting for approval*, or
    the record header) before the sale can be completed. Their own discounts
    are approved straight away.
  - **Converted From OP**: the OP consultation fee the patient already paid is
    credited (shown on the bill as a discount). Revenue and incentives count the
    **full price**; the customer pays the rest now. No other discount applies.
- Completing needs at least one parent on the members list (children need a
  date of birth).
- Completing sets **valid from** (sale date) and **valid until** (one year).
  If someone on the list already has an active pass on that number, a warning
  is shown (renewal rules are still to be decided, so it doesn't block).
- A completed pass keeps the price it was sold at, even if prices change
  later. Passes completed before these rules keep their recorded amount; open
  leads follow the rules on their next save.
- Imported leads get the standard price; discounts must be added in the app.

## Patients and owners

A **patient** is a person: a phone number **plus a name**. Relatives often
share one number, so everyone on a number is a **household**.

- Each patient has one **owner** agent. By default the whole household has the
  same owner.
- A new record for a known patient — in any module, entered by anyone — goes
  to the owner. A new person on a known number goes to the household's owner.
  Whoever entered it is told ("Already handled by …").
- One open (Pending) record per patient **per module**: a father and a mother on
  the same number can each have an open Medpass record.
- The form shows who handles a number as soon as it is typed. The owner and
  managers also see the people on it and can pick one; other agents only see
  who handles it.
- **Reassign** (manager/admin) moves the patient: everyone on the number, or
  only this person (a split). All their open records in every module and their
  active refill reminders move. Completed and cancelled records keep their
  agent, so incentives stay with whoever closed the sale.
- Reopening an old record puts it with the patient's current owner.
- Records show **Also in: <modules>** when the patient has records elsewhere.
- **Deactivating an agent** always names who takes over. Managers ask (Users
  page → switch off → choose successor and reason); an admin approves on the
  same page, which moves all their patients, open records and reminders, then
  deactivates the account. The server refuses to deactivate someone who still
  handles patients without a successor.

### Moving many patients at once (managers and above)

All three work like a single reassign: each patient moves — everyone on the
phone number by default, or only that person — with all their open records
in every module and their active reminders. Completed and cancelled sales
keep their agent. Each shows a preview first and is recorded in the history.

- **Tick and reassign:** on a module page switch to **Table**, tick records
  (or the header box for everything shown) → **Reassign to…**.
- **From a spreadsheet:** **Export CSV** → change the **Assigned Agent Email**
  column → **Reassign from file**. Rows you didn't change are ignored; unknown
  IDs or agents, and rows that give one patient/household two different
  agents, are listed and skipped. Up to 500 rows per file.
- **Agent handover:** Users page → **Hand over** next to an agent → choose who
  takes over and a reason (e.g. leave). Nobody is deactivated.

### Owner conflicts

Records saved before Patients existed are matched by phone + name. If a
number's records were handled by more than one agent, nobody is guessed: the
number shows under **Incentives & Settings → Patient owners**, where an admin
keeps everyone with one agent or chooses an agent per person. Until then, new
records for that number are saved as entered.

### Going live with Patients (one-time, on the existing Sheet)

1. **Back up**: File → Make a copy of the Sheet.
2. Paste the new/changed `.gs` files (new: `BulkReassign`, `DashboardLayouts`,
   `Handover`, `Homekare`, `Incentives`, `Lab`, `Medpass`, `Modules`, `Patients`).
3. Run **`setupSpreadsheet`** — adds the `Homekare`, `Lab & Radiology`, `Patients`,
   `UserRequests`, `UserLayouts` and `Targets` tabs, the `PatientID` column, the Medpass columns (members,
   price, discount, validity) and the new Reminders columns. It never deletes or
   renames anything; existing refill reminders keep working.
4. Run **`migratePatientsDryRun`** and read the log (patients to create,
   records to link, numbers with more than one agent). Nothing is saved.
5. Run **`migratePatients`**. It only adds Patients rows and fills empty
   `PatientID` cells; it never changes who a record belongs to. Safe to rerun.
   (Admins can also do steps 4–5 from the Patient owners card.)
6. Run **`smokeTestV2`** — every line should say PASS.
7. Deploy a **new version** of the web app and the new frontend together.
8. Resolve any owner conflicts on the Patient owners card.

## Refill reminders (Pharmacy)

(Homekare monthly packages get renewal reminders on the same page — see
[Homekare](#homekare).)

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
