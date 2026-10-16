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
| 1. One agent per patient (people + households) + module engine | `phase1-patient-ownership` | **Plan v2 written, waiting for OK** |
| 1b. Medpass rules + family members + senior role | `phase1b-medpass-rules` | Rules mostly given; a few questions open |
| 2. Lab & Radiology, HOMEKARE modules | — | Blocked on user input (service list, tests, incentive rules) |
| 3. Bulk reassign | — | Not started (agent handover partly pulled into Phase 1) |
| 4. Calmer module pages + widget dashboard | — | Not started (mockup first) |
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
2. Module config + engine refactor (no behaviour change)
3. Patients tab, `PatientID`, owner resolution on create/import
4. Per-patient-per-module open rule
5. Patient/household reassign + reminders
6. Migration + conflict resolution
7. Deactivation requests + handover
8. Frontend
9. README + demo rebuild

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
