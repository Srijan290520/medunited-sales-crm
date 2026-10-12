# MedUnited Sales CRM

Tracks Medpass and Pharmacy (home delivery) sales for the sales team,
replacing the Google Form + manual Excel incentive tracking.

- **Agents** — see and log only their own sales.
- **Managers** — see everyone's sales and set incentive rates per agent.
- **Admins** — everything managers can do, plus creating/editing user accounts.

All of that is enforced on the server (Apps Script), not just hidden in the
browser — an agent's session token literally cannot fetch another agent's
rows.

## Stack

Static HTML/CSS/JS frontend (no build step, no Node needed) talking to a
Google Apps Script Web App backend, which reads/writes a Google Sheet with
four tabs: `Medpass`, `Pharmacy`, `Users`, `Reminders`.

## 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet.
2. Name it something like "MedUnited Sales CRM Data".
3. You don't need to create the tabs yourself — a setup script does that (step 3 below).

## 2. Attach the Apps Script project

1. In the spreadsheet, go to **Extensions → Apps Script**.
2. Delete the default `Code.gs` content.
3. Create these files in the Apps Script editor (use the `+` next to Files) and
   paste in the matching content from this project's `apps-script/` folder:
   - `Code.gs`
   - `Auth.gs`
   - `Utils.gs`
   - `SalesService.gs`
   - `UserService.gs`
   - `Attachments.gs`
   - `Audit.gs`
   - `Reminders.gs`
   - `Setup.gs`
4. Save the project (Ctrl+S). Give it a name like "MedUnited Sales CRM Backend".

## 3. Create the sheet tabs and your admin login

1. In the Apps Script editor, select `setupSpreadsheet` from the function
   dropdown (top toolbar) and click **Run**. First run will ask you to
   authorize the script — approve it (it's your own script, only touching
   your own spreadsheet and, for bill/payment screenshots, your own Drive).
2. Check the spreadsheet — you should now see `Users`, `Medpass`, and
   `Pharmacy` tabs with headers.
3. Open `Setup.gs`, edit the `email` and `password` in `createFirstAdmin()`
   to your real login, then select `createFirstAdmin` from the function
   dropdown and click **Run**.
4. Confirm a row appeared in the `Users` tab with `Role = admin`.

## 4. Deploy as a Web App

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as**: Me
   - **Who has access**: Anyone (the app itself requires login — this setting
     just controls who can reach the URL at all)
4. Click **Deploy**, authorize again if prompted, and copy the **Web app URL**
   (ends in `/exec`).

## 5. Point the frontend at your deployment

Open [js/api.js](js/api.js) and replace this line:

```js
var API_URL = window.API_URL || 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
```

with your actual `/exec` URL.

## 6. Run it

This is a static site — no server needed. Easiest options:

- Open `index.html` directly in a browser, **or**
- Serve the folder locally (avoids some browser file:// quirks). This machine
  doesn't have Python or Node installed, so a small PowerShell server is
  included — run `powershell -ExecutionPolicy Bypass -File _serve.ps1` from
  this folder, then visit `http://localhost:8080`. (If you do have Python or
  Node available elsewhere, `python -m http.server 8080` or `npx serve` work
  too.)

Log in with the admin account you created in step 3. From there:

- **Users** page (admin only) → create manager and agent accounts.
- **Incentives** page (manager/admin) → set ₹ per sale for each agent.
- **Medpass** / **Pharmacy** pages → log and view sales.
- **Dashboard** → team performance, charts, incentive totals.

## Upgrading an already-deployed sheet

`setupSpreadsheet()` only sets headers on a *brand-new* sheet — it won't add
columns to a sheet that already has data. If you deployed this app before the
Pharmacy refill-reminders feature was added, do this once:

- **Pharmacy** sheet: add a `Products` column (anywhere is fine).
- **Reminders** sheet: create a new tab named exactly `Reminders` with this
  header row: `ID, PharmacySaleID, AgentEmail, AgentName, Reassigned,
  CustomerName, Contact, Products, SaleDate, Status, ResolutionReason,
  AttemptCount, LastAttemptDate, CreatedAt, UpdatedAt`

Existing Pharmacy sales logged before this change won't have structured
product data, so they won't generate a reminder until you edit and re-save
them with at least one product line.

## Upgrading to the security update (Phase 1)

If your sheet was deployed before the security update, do this once:

1. In Apps Script, add a new file `Audit.gs` and paste in its content. Replace
   every other `.gs` file with the new version.
2. **Deploy → Manage deployments → pencil → New version → Deploy.** The
   `/exec` URL stays the same.
3. Select `lockDownExistingAttachments` in the function dropdown and **Run**
   it. This makes the screenshots that were shared by link private. The app
   keeps showing them.
4. Select `timePasswordHash` and **Run** it, then check the log. If one hash
   takes more than about 1 second, lower `PBKDF2_ITERATIONS` in `Auth.gs`.
   If it takes under 200 ms, you can raise it.
5. Push the updated `js/` files to GitHub Pages.

What users will notice:

- **Everyone gets logged out once** after the deploy. Sessions now carry
  extra data, so older ones aren't accepted.
- Old password hashes keep working. Each one is upgraded to the stronger
  hash the next time that person logs in.
- The `AuditLog` tab appears the first time someone saves something.

## Redeploying after code changes

Every time you edit a `.gs` file, go back to **Deploy → Manage deployments**,
click the pencil icon on your deployment, and choose **New version** under
Version, then **Deploy**. Editing the file alone does not update the live
`/exec` URL.

## Notes on security

- **Passwords** are hashed with PBKDF2-HMAC-SHA256: many rounds and a
  per-user salt. They are never stored in plain text.
- **Login lockout:** 5 wrong passwords for an email lock it for 15 minutes.
  The lockout is recorded in `AuditLog`.
- **Sessions** live in Apps Script's `CacheService`, not in the sheet, and
  expire after 6 hours of inactivity. Every request re-checks the user's row
  in `Users`. Deactivating someone, changing their role, or resetting their
  password takes effect on their next request.
- **Simultaneous saves:** every write runs under a script lock, so two people
  saving at once can't overwrite each other's rows.
- **Completed sales are locked for agents.** Once a sale is Completed, only
  a manager or admin can change it, because it counts toward revenue and
  incentives. Status must be Pending, Completed or Cancelled.
- **Audit log:** every create, update and delete of a sale, user, incentive
  rate or reminder is written to the `AuditLog` tab. Each row records who
  made the change, when, and each changed field's old and new value. The
  tab is protected so only the sheet owner can edit it. Password hashes are
  never logged.
- **Formula injection:** text starting with `= + - @` is stored as plain
  text, so a customer name can't run as a spreadsheet formula.
- **Last admin:** the only active admin can't be deactivated or demoted.
- **POST only:** the backend rejects GET requests, so passwords and tokens
  never appear in URLs.
- **Bill/payment screenshots** are stored **privately** in a Drive folder
  named **"MedUnited Sales CRM Attachments"**, owned by the deploying
  account. They are not shared by link. The app fetches each one through
  the backend, which checks that the viewer may see that sale. Agents can
  only see their own sales' screenshots.
- Anyone with edit access to the Google Sheet can still see and edit raw
  rows directly in Sheets. Keep sheet sharing limited to admins.
- A sale can only be marked **Completed** once payment method, a bill
  screenshot, and a payment screenshot are attached, plus a UTR if the
  payment method is UPI. This is enforced in `SalesService.gs`.

## Refill reminders (Pharmacy)

Each product on a Pharmacy sale gets a "runs out on" date computed from
quantity ÷ (doses per day × units per dose), starting from the sale date.
Doses per day comes from the frequency (Once/Twice/Thrice a day). Units per
dose is how many tablets or capsules are taken each time (default 1; half
tablets like 0.5 are allowed). For example, 60 tablets taken 2 at a time,
twice a day, lasts 15 days. Products saved before the "Per dose" field
existed count as 1 per dose. A reminder is created automatically once a Pharmacy sale is saved as
**Completed** with at least one product, and shows up on the **Reminders**
page for the agent who made the sale — overdue reminders sort first, and the
countdown is always computed live (never stored), so it's never stale.

- Marking a reminder **"Doesn't want medicines"** resolves it permanently.
- **"Wants medicines, couldn't connect"** logs the attempt and keeps the
  reminder active; after 3+ days of failed attempts it's flagged
  ("no contact in 3+ days") so a manager knows to step in.
- **Managers/admins** see every agent's reminders and can reassign one to a
  different agent from the card — useful if the original agent is
  unavailable. Reassignment sticks even if the underlying sale is later
  edited.

## Dates and time zone

Sale dates are calendar days in India time (Asia/Kolkata). A sale logged
at 1 AM IST is dated that day, not the previous UTC day. The backend always
sends dates to the browser as plain `YYYY-MM-DD`, so the edit form shows
the same date that was saved.

## Dashboard caching

The dashboard summary is cached for 2 minutes. Any save through the app
(sale, user, incentive rate or reminder) clears the cache immediately, so
new sales show up at once. Edits typed directly into the Google Sheet show
up within 2 minutes.
