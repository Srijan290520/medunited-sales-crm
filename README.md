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
three tabs: `Medpass`, `Pharmacy`, `Users`.

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

## Redeploying after code changes

Every time you edit a `.gs` file, go back to **Deploy → Manage deployments**,
click the pencil icon on your deployment, and choose **New version** under
Version, then **Deploy**. Editing the file alone does not update the live
`/exec` URL.

## Notes on security

- Passwords are never stored in plain text — only a salted SHA-256 hash.
- Session tokens live in Apps Script's `CacheService` (server memory), not in
  the sheet, and expire after 6 hours of inactivity.
- Anyone with edit access to the underlying Google Sheet can still see/edit
  raw rows directly in Sheets — keep sheet sharing limited to admins who
  understand not to hand-edit `PasswordHash`/`Salt`. The app itself is the
  intended way for everyone else to interact with the data.
- Bill/payment screenshots are stored in a Drive folder named
  **"MedUnited Sales CRM Attachments"** (created automatically, owned by
  whichever Google account you deployed as). Each uploaded file is shared as
  **"anyone with the link can view"** — so the app can display it without a
  separate sign-in, but also so anyone who gets hold of a link could view that
  one screenshot. If your MedUnited account is on Google Workspace and you'd
  rather restrict this to people in your organization, open
  `apps-script/Attachments.gs` and change `DriveApp.Access.ANYONE_WITH_LINK`
  to `DriveApp.Access.DOMAIN_WITH_LINK`, then redeploy.
- A sale can only be marked **Completed** once payment method, a bill
  screenshot, and a payment screenshot are attached (and a UTR, if the
  payment method is UPI) — enforced in `SalesService.gs`, not just the form,
  so it can't be bypassed by calling the API directly.
