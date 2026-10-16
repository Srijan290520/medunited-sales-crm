# Roadmap progress (v2 → Phases 1–5)

Breadcrumb file so work can resume in a fresh session. Update it at the end
of every working session: what's done, what's next, open questions.

Base branch: `v2-react-app` (not merged to `master`). One feature branch and
one PR per phase, PRs target `v2-react-app`.

Known blocker: GitHub Actions is locked by a billing issue on the account —
CI and Pages deploy don't run. Verify locally (`npm run test:backend`,
`npm run build`). Don't work around it.

Live state: the Sheet's Apps Script project has v2 code saved and
`setupSpreadsheet` was run, but **no new web-app version is deployed** —
`/exec` still serves v1.

| Phase | Branch | Status |
|---|---|---|
| 1. One agent per patient (people + households) + module engine | `phase1-patient-ownership` | **Done on branch, PR open — not deployed** |
| 1b. Medpass rules + family members + senior role | `phase1b-medpass-rules` (stacked on phase 1) | **Done on branch, PR open (base: Phase 1 branch) — not deployed** |
| 2. Lab & Radiology, HOMEKARE modules | `phase2-new-modules` (stacked on 1b) | **Done on branch, PR open — not deployed** |
| 3. Bulk reassign | `phase3-bulk-reassign` (stacked on 2) | **Done on branch, PR open — not deployed** |
| 4. Calmer module pages + widget dashboard | `phase4-calm-ui` (from 3) | Mockup published, waiting for feedback |
| 5. Settings page, Incentives page, per-agent targets | — | Blocked on user answers (revenue vs count, agent visibility, target→incentive) |

---

## Key decision (2026-10-16): a phone number is not a patient

Relatives share one number (a Medpass holder's parents, children, others).
So:

- **Patient = a person**: phone number **+ name** (+ age when known).
- **Household = all patients on one phone number.** By default the whole
  household has one owner agent.
- A manager can **split** a person out of the household to a different owner.
- Matching is not automatic beyond the phone number: when a number is known,
  the form shows the people already on it and the person entering picks
  "this is <name>" or "someone new on this number". Names are compared
  loosely (case/spacing) to suggest the match.

---

## Phase 1 plan (v2)

### Data model

New tab **`Patients`** — one row per person (created via `getOrCreateSheet`):

`ID, ContactKey, Contact, Name, NameKey, Age, OwnerEmail, OwnerName,
OwnerStatus, ConflictAgents, SplitFromHousehold, CreatedAt, UpdatedAt`

- `NameKey` = lower-case, single-spaced name; (`ContactKey`, `NameKey`) is unique.
- `OwnerStatus`: `Owned` | `Conflict`. `ConflictAgents` = JSON list of the
  candidate agents (set by the migration only).
- `SplitFromHousehold` = TRUE when a manager gave this person a different
  owner from the rest of the number.
- Ownership is sticky after records close, so returning patients go back to
  the same agent.

Medpass and Pharmacy tabs get one new column, **`PatientID`** (appended by
`ensureHeaders`; nothing renamed). Rows without it are linked by the migration.

Module config in new `Modules.gs`: sheet, label, audit entity, optional fields
(`priceType`, `products`), completion rules, after-save hook (Pharmacy →
refill reminder), incentive rule, import columns. Sales/import/dashboard code
reads the config instead of `type === 'pharmacy'` branches. API keeps the
`type` param (= module id). New read action `getModules`.

### Ownership rules (server-side)

1. **Create / import**
   - Known person → record goes to that person's owner.
   - New person on a known number → household owner (if the household has
     one owner). If the household was split between owners, managers pick in
     the form; for agents it goes to the owner of the person they matched,
     else the household's first owner.
   - New number → new patient, owned by the record's agent.
   - The person entering is told: "Already handled by <Owner>; assigned to them."
     Import dry-run shows this per row.
2. **One open (Pending) record per patient per module** — so the father and
   the mother on one number can each have an open Medpass/Pharmacy record.
3. **All of a patient's open records stay with one agent** (rule 1 +
   reassignment always moving the patient).
4. **Reassign** (`reassignSale` keeps its name, now works on the patient):
   - Default scope = **the whole household**; manager can choose "only this
     person" (= split).
   - Moves every open record in every module + Active refill reminders,
     activity note + audit entry per moved record.
   - Completed/Cancelled rows keep their agent → incentives stay with the closer.
5. **Contact change** on a record re-resolves the patient. Agents are blocked
   if the number belongs to another agent's household; managers/admins — the
   record moves to that owner, with a notice.
6. **Reopen**: a closed record whose agent is no longer the owner goes to the
   current owner; a non-owner agent can't reopen it.
7. **Privacy**: other agents only ever learn "handled by <Owner>". The list of
   people on a number is shown only to its owner and to managers/admins.
8. Records carry `AlsoIn: [modules]` for that patient, plus a household hint
   ("2 others on this number") for owner/managers.

### Assign-to picker in the form

Managers/admins get an "Assign to" picker on new records (today the create
form always sends the logged-in user). Agents don't see it (server already
forces their own email). If the patient/household has an owner, the picker
locks to that owner with "Already handled by X".

### Deactivating an agent (user decision 2026-10-16)

- A manager **requests** deactivation of an agent and must pick **who gets
  their records** (successor).
- An admin (or the new senior role, Phase 1b) approves → the agent is
  deactivated and all their open patients/records/reminders move to the
  successor in one locked, audited operation (= agent handover from Phase 3,
  built now).
- Server rule: an agent who still owns open patients can't be deactivated
  without a successor.
- New tab `UserRequests`: `ID, Type, UserEmail, SuccessorEmail, Reason,
  RequestedBy, Status (Pending/Approved/Rejected), DecidedBy, CreatedAt, DecidedAt`.

### Migration

`migratePatients(dryRun)` in `Patients.gs`, runnable from the editor and as
admin-only action (dry-run first):

- Backfill blank `ContactKey`; group rows by (`ContactKey`, `NameKey`) →
  one Patient each; write `PatientID` onto the rows.
- Household (same `ContactKey`) with exactly one distinct agent → all its
  patients `Owned` by that agent.
- More than one distinct agent on a household → `Conflict`; `ConflictAgents`
  lists each agent with open/closed counts per person. Nothing guessed or moved.
- Idempotent; reruns only add/link new rows.
- Admin resolves in the app: keep the household together under one agent,
  or split it person by person. Same code path as reassign; audited.

### API changes

| Action | Change |
|---|---|
| `createSale`, `importSales` | resolve patient (+ `patientId` / "new person" choice), owner auto-assignment + notice; per-patient-per-module open check |
| `updateSale`, `reopenSale`, `logSaleActivity` | per-patient-per-module open check; ownership rules 5–6 |
| `reassignSale` | patient-level, `scope: 'household' | 'person'`; returns moved records |
| `checkContact` | adds owner, people on the number (owner/managers only), open modules per person |
| `listSales` / `getSale` | `PatientID`, `AlsoIn`, household hint |
| new `reassignPatient` | manager/admin, by patient or household — WRITE |
| new `migratePatients` | admin, `dryRun` — WRITE |
| new `listPatientConflicts` | admin/manager — read |
| new `resolvePatientConflict` | admin — WRITE |
| new `requestDeactivation` | manager — WRITE |
| new `listUserRequests` | admin/manager — read |
| new `decideUserRequest` | admin — WRITE (does the handover) |
| new `getModules` | any session — read |

All new writes in `WRITE_ACTIONS`, under the lock, `audit(...)`.

### Frontend (Phase 1 scope)

- "Also in" chip; "people on this number" picker in the form; owner notice.
- Assign-to picker for managers/admins.
- Reassign dialog: household vs this person only.
- Admin: "Patient conflicts" panel; Users page: "Request deactivation"
  (manager) with successor, approve/reject (admin).

### Also in this phase

- `apps-script/SmokeTest.gs` (copied from the live project).
- Tests for every rule above + migration + deactivation handover.
- Regenerate demo backend; README updates.

### Commit order

1. ~~`SmokeTest.gs` into repo~~ ✅ (38661b7)
2. ~~Module config + engine refactor~~ ✅ (5c21ef2)
3. ~~Patients tab, `PatientID`, owner resolution on create/import~~ ✅ (bdce456)
4. ~~Per-patient-per-module open rule~~ ✅ (bdce456, same commit)
5. ~~Patient/household reassign + reminders~~ ✅ (7b448f5)
6. ~~Migration + conflict resolution~~ ✅ (7e2e29a)
7. ~~Deactivation requests + handover~~ ✅ (f90ce2d)
8. ~~Frontend~~ ✅ (704d210)
9. ~~README + demo rebuild~~ ✅

Deferred (on purpose): sidebar built from `getModules` — do it in Phase 2
when the new modules arrive (the API is ready; the sidebar still lists the
two modules by hand).

---

## Phase 1b: Medpass rules (from user, 2026-10-16)

Given:

- 1-year family pass: **father, mother and children under 21**. A child 21+
  takes a separate pass. Grandparents/other relatives on the same number take
  their own pass.
- Base pass covers 4 people (2 parents + 2 children). **3rd child: +₹375**
  (1500 / 4). User example total: ₹1874.
- **Fixed price ₹1499** (user said "1499 or 1500, round it up" — confirm).
- **Discount up to ₹200, needs approval** by a new role above manager.
- **Converted from OP**: OP fee (varies) is credited; total stays the pass
  price; **no discount** on OP conversions.
- **Record family members** on the pass: name, relation, age.
- Validity / renewal reminders / early renewal: **to discuss later.** For now
  store ValidFrom/ValidUntil (+1 year) and warn (don't block) when a member
  already has an active pass.

Plan:

- New tab `MedpassMembers`: `ID, SaleID, PatientID, Name, Relation
  (Father/Mother/Child), Age, CreatedAt` — each member becomes/links a Patient
  in the household.
- Server checks: max 2 adults (Father, Mother), children < 21, 2 children
  included, 3rd child adds the fee; prices from `Settings`.
- Server computes amounts:
  - Full Price → base (+ 3rd child)
  - Discounted → base − discount (1–200, + 3rd child); can't complete until approved
  - Converted From OP → total = base, OP credit recorded, collected = base − OP credit
- New columns on Medpass: `ListPrice, DiscountAmount, DiscountStatus,
  DiscountRequestedBy, DiscountApprovedBy, OPCredit, ExtraChildFee,
  ValidFrom, ValidUntil`.
- **New role** above manager (name TBD) — ~95% of admin access; approves
  discounts. Role hierarchy in `Auth.gs` (`requireRole` → rank-based).

Answers (2026-10-16):

- Price **₹1499**; with a 3rd child **₹1874**.
- Members are recorded with **date of birth** (under-21 checked on the sale date).
- New role ≈ 95% of admin: everything except **managing admin accounts and
  hard deletes**. It **approves discounts and deactivation requests**.
  Working name `senior_manager` / "Senior Manager" until the user names it.
- OP conversion: **revenue and incentive count the full pass price**; the OP
  fee shows as a discount on the bill. OP credit is capped at the pass price.

Still open for 1b: role name; 4th child allowed (+₹375 each?) or separate
pass; single parent allowed on a family pass.

---

## Session log

- **2026-10-16** — Cloned repo, read README/SECURITY/backend, created branch
  `phase1-patient-ownership`, wrote plan v1.
- **2026-10-16** — User added Medpass rules (→ 1b) and assign-to picker (→ 1).
- **2026-10-16** — User: relatives share phone numbers → plan v2 (patient =
  phone + name, household ownership, manager split). Deactivation needs a
  manager request with successor. Reminders move with the patient. Copy
  `SmokeTest.gs` via Chrome. Waiting for OK on plan v2.
- **2026-10-16** — Live Apps Script project found (Oct 15 "Untitled
  project", id `1Lt-SEfpiNC8n5BCDQMXZ-ePiC3f4ZC9AKEHDzuz4JbY8oshDvr5GwB7Y`).
  It also still has a 123-char `Leads.gs` stub that the repo deleted. Copying
  `SmokeTest.gs` via Chrome failed: the extension redacts lines mentioning
  session tokens. Need the user to paste it (or rewrite it from scratch).
- **2026-10-16** — User pasted SmokeTest.gs → committed to `apps-script/`
  (ping now checks `API_VERSION`), plus a backend test running it (23 tests
  green, build green). Fixed `scripts/build-demo-backend.mjs` on Windows.
  1b answers recorded above. **Next:** wait for explicit OK on plan v2, then
  commit 2 of Phase 1 (module config + engine refactor).
- **2026-10-16** — Plan v2 approved. User: the CRM **may go live** — treat as
  production (additive Sheet changes, dry-run migrations, no deletes, tests).
  Backend for Phase 1 done: Modules.gs, Patients.gs, Handover.gs; 32 backend
  tests green. Design notes worth knowing:
  - `loadPatientWorld()` loads Patients + all module rows + Users once per
    request; changes are written by `savePatientChanges()` only after
    validation. Rows without PatientID match by phone + `nameKey(name)`.
  - `ensureHousehold()` lazily creates patients for old rows (in memory on
    reads; persisted on writes). Several agents on one number → Conflict.
  - Patient IDs from unsaved (virtual) patients are returned as '' to the
    browser; it sends the name instead.
  - Patient owners must be active agents or managers (`requireOwnerCandidate`).
  **Next:** frontend (step 8), then README + demo rebuild, push, PR.
- **2026-10-16** — Phase 1 frontend done and checked in the demo build
  (household chips, person picker, locked Assign to, reassign household vs
  person, manager deactivation request → admin approval with handover).
  README "Patients and owners" + go-live steps; SECURITY updated. 32 backend
  tests + build green. Branch pushed, PR opened against `v2-react-app`.
  To preview locally: `npm run build:demo`, then `.claude/launch.json`
  "demo-preview" serves it at http://localhost:4174/index.demo.html.
  **Waiting on the user:** review/merge the PR; do the go-live steps in the
  README on the real Sheet (backup → paste files → setupSpreadsheet →
  migratePatientsDryRun → migratePatients → smokeTestV2 → new deployment);
  Phase 1b answers (new role name, 4th child, single parent); Phase 2 inputs.
- **2026-10-16** — Phase 1b started on `phase1b-medpass-rules` (branched from
  the Phase 1 branch; its PR will be stacked on PR #5). Defaults chosen for
  the two open questions (configurable in Settings): single parent allowed;
  at most 1 extra child — **corrected by the user the same day: a 4th child
  is allowed too (+₹375 each beyond 2, so 1,874 / 2,249); single parents pay
  the same extra-child fees.** Backend done:
  role `senior_manager` (TEAM_ROLES / SENIOR_ROLES / ADMIN_ROLES in Auth.gs),
  module extraHeaders + hooks, Medpass.gs (members with DOB, server-side
  price, discount request/approval, OP credit, validity + coverage warning).
  Members are a JSON column on the Medpass row (like Products), not a
  separate tab. **Next:** frontend (role, Medpass form, approvals, Medpass
  settings card), demo, README, PR.
- **2026-10-16** — Phase 1b frontend done and checked in the demo build
  (senior manager approves a discount from the Medpass page; prices: 1,874
  with a third child, OP conversion payable 999, approved discount 1,399;
  child aged 25 flagged; + Child disabled after 3). 38 backend tests + build
  green. README "Medpass (family pass)", SECURITY updated. Pushed; PR opened
  with base `phase1-patient-ownership` (merge Phase 1 first, then retarget
  this PR to `v2-react-app`).
  **Still open:** renewal rules / early renewal / renewal reminders (user:
  "discuss later"); confirm the defaults single parent = yes, max 1 extra
  child; Phase 2 inputs (Homekare services, Lab/Radiology tests, incentives).
- **2026-10-16** — Phase 2 inputs: user sent the 38 Homekare services (names
  only). Saved as `docs/catalogues/homekare-services.csv` with a proposed charge
  unit and recurring flag per service, for the user to add prices and
  corrections. Names kept exactly as given (some look misspelt: MONTHY, MOTHLY,
  CATHERIZATION, ELETROTHERAPY, CONSULTATAION, PRACTIONER, ELIVATION) — asked
  whether they must match the billing system. Branch `phase2-new-modules`
  created from `phase1b-medpass-rules`; no code yet.
  **Asked the user:** prices (fixed or quoted?), units/recurring OK?, monthly
  renewal reminders?, what to track per order (dates, visits, staff), one
  order = one service or several?, Homekare incentive rule; and still the
  Lab & Radiology list + home collection / appointment / report questions.
- **2026-10-16** — User decision: **Lab & Radiology tests/packages are typed
  by hand for now** (no catalogue). Plan: each record has lines of
  { name, Lab or Radiology, price } typed by the agent; the amount is the sum
  (server-side). A catalogue can be added later without changing records.
  Still to ask for Lab: home sample collection / appointment date / report
  delivery tracking, and the incentive rule.
- **2026-10-16** — User decision: **Homekare prices vary per patient → typed
  by hand.** Plan: agents pick the service from the 38-name list (consistent
  names for reports) and type the price; units/recurring flags from the CSV
  are kept as hints. Amount = sum of lines, computed on the server.
- **2026-10-16** — User decision: **no incentives for Homekare or Lab &
  Radiology yet — add later** (Phase 5). Build both modules with incentive
  `{ kind: 'none' }` so they show revenue but pay 0 until a rule is set.
  Proposed defaults sent to the user for the rest (several services per
  Homekare order; keep service names exactly as given; Lab: optional home
  collection date, appointment date, report delivered date + how; Homekare:
  start/end date + staff name typed; renewal reminder for monthly packages
  left for later).
- **2026-10-16** — User decision: **renewal reminders for monthly Homekare
  packages: yes.** Plan: a completed Homekare order with a monthly service
  (Recurring = monthly in the catalogue) creates a reminder due 5 days before
  the package end date (start + 1 month if no end date is typed); shown on
  the Reminders page next to refill reminders, same "contacted / not
  interested" flow, owned by the patient's agent and moving with them on
  reassign. Days-before setting editable later.
- **2026-10-16** — User: **Homekare tracking (visit dates, days/visits,
  staff) → discuss later.** So Phase 2 Homekare has no extra tracking fields;
  the monthly-package reminder uses the record Date as the start (end = Date
  + 1 month, reminder 5 days before). Fields can be added later via the
  module config (extraHeaders) without touching existing rows.
- **2026-10-16** — **Phase 2 approved** with the defaults; user paused the
  work until their credits reset. **Start here next session:**
  1. `git checkout phase2-new-modules` (branched from `phase1b-medpass-rules`;
     PRs #5 and #6 are still open — check if they were merged, and if so
     rebase/retarget onto `v2-react-app`).
  2. Backend: add `homekare` and `lab` modules in `Modules.gs` (incentive
     `{ kind: 'none' }` → 0 in `incentiveForSale`), a lines JSON column
     like Products: Homekare lines = { service (from the 38 in
     docs/catalogues/homekare-services.csv), price }, Lab lines = { name,
     kind Lab|Radiology, price }; amount = sum on the server via
     prepareSave hooks. Lab extra columns: HomeCollection, CollectionDate,
     AppointmentDate, ReportDeliveredOn, ReportDeliveredVia. Homekare
     catalogue (names + unit + monthly flag) in a new `Homekare.gs`.
  3. Reminders: generalise `Reminders.gs` (it is Pharmacy-only via
     `PharmacySaleID`; add SaleType/SaleID columns, keep the old ones) and
     create a Homekare renewal reminder for completed orders with a monthly
     service: due Date + 1 month − 5 days.
  4. Import/export for both modules; tests for every rule; then the
     frontend (sidebar from `getModules`, which was deferred to now; line
     editors), README, demo, PR.
- **2026-10-16** — **Phase 2 built.** Backend: `Homekare.gs` (38-service
  catalogue, typed prices, monthly renewal reminders), `Lab.gs` (typed tests,
  collection/appointment/report fields), Reminders generalised (Kind,
  SaleType, SaleID…; old rows still refills), Modules.gs hooks afterSave /
  afterDelete / clientConfig, incentive kind none. Frontend: sidebar + pages
  from getModules (deferred item done), line editors, renewal cards on the
  Reminders page. 42 backend tests + build green; checked in the demo build
  (form save → ₹2,050 total; lab report editable after completion; renewal
  card). Pushed; PR opened with base `phase1b-medpass-rules`.
  **Open for later:** Homekare tracking (visit dates, days, staff);
  incentives for Homekare and Lab (Phase 5); Lab test catalogue; renewal
  days-before (5) as a setting; dashboard per-module KPIs (Phase 4).
  **Next phase:** 3 (bulk reassign).
- **2026-10-16** — **Phase 3 built** on `phase3-bulk-reassign`:
  `BulkReassign.gs` (bulkReassign, importReassignments, handoverAgent — all
  patient-level, dry run by default, audited) + UI (table checkboxes →
  Reassign to…, Reassign from file, Users → Hand over). Shared file reader
  `src/utils/readTable.ts`. 45 backend tests + build green; all three checked
  in the demo build. **Bug found and fixed while testing:** blank page after a
  refresh with a saved session (React #310 — the Phase 2 module-list effect
  sat after an early return in App.tsx). Fix committed on both
  `phase2-new-modules` (PR #7) and this branch.
  **Next phase:** 4 (calmer module pages + widget dashboard) — needs a mockup
  or preview build for the user before the full rewrite.
- **2026-10-16** — User checked the live Google Sheet: as expected nothing
  from Phases 1–3 is there (tabs: Users, SaleActivities, Settings,
  LeadActivities, Leads, Lists, AuditLog, Medpass, Pharmacy, Reminders; no
  PatientID/Members/Kind columns; /exec still v1). **Decision: deploy at the
  end of the roadmap** ("lets work it out in the end").
- **2026-10-16** — Phase 4 mockup published (Design canvas, private):
  https://claude.ai/artifact/HTD6GrBKW8payhWUVgHvXR — two clickable
  artboards: module page (one search, Filters button, ⋯ More for
  import/export/reassign-from-file/board view, one "New record" button,
  quiet status tabs, list by default, side panel with quick actions) and
  dashboard (widgets; Customize → add / move / resize / remove; agent vs
  manager defaults; "layout never changes what you can see"). Mockup source
  is in the session scratchpad, not the repo. **Waiting for user feedback**
  before the rewrite.
