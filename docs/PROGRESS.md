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
| 1. One agent per patient + module engine | `phase1-patient-ownership` | **Plan written, waiting for OK** |
| 1b. Medpass pricing, discount approval, 1-year validity | `phase1b-medpass-rules` | Rules given 2026-10-16; open questions below |
| 2. Lab & Radiology, HOMEKARE modules | — | Blocked on user input (service list, tests, incentive rules) |
| 3. Bulk reassign | — | Not started |
| 4. Calmer module pages + widget dashboard | — | Not started (mockup first) |
| 5. Settings page, Incentives page, per-agent targets | — | Blocked on user answers (revenue vs count, agent visibility, target→incentive) |

---

## Phase 1 plan (as proposed 2026-10-16)

### Data model

New tab **`Patients`** (created via `getOrCreateSheet`, nothing renamed):

`ID, ContactKey, Contact, CustomerName, OwnerEmail, OwnerName, OwnerStatus,
ConflictAgents, CreatedAt, UpdatedAt`

- `ContactKey` (last 10 digits, existing `phoneKey`) is unique — the join key
  to Medpass/Pharmacy rows, which already carry `ContactKey`. No new column on
  the sale tabs.
- `OwnerStatus`: `Owned` | `Conflict`. `ConflictAgents` = JSON list of the
  candidate agents found by the migration (only set when `Conflict`).
- Ownership is sticky: it stays after all records close, so a returning
  patient goes back to the same agent.

Module config (new `Modules.gs`): one object per module — sheet name, label,
audit entity, which optional fields it uses (`priceType`, `products`),
completion rules, after-save hook (Pharmacy → refill reminder), incentive rule,
import columns. `SalesService.gs` / `Import.gs` / dashboard read the config
instead of `type === 'pharmacy'` branches. API keeps the `type` param (=
module id), so the frontend doesn't break. New read action `getModules` lets
the frontend build its sidebar/forms from the same config.

### Rules (all server-side)

1. **Create / import**: look up the patient by `ContactKey`.
   - Owned → record goes to the owner regardless of who enters it or which
     agent was chosen. Response carries `assignedNotice: "Already handled by
     <Owner>; assigned to them."` Import dry-run shows it per row.
   - No patient → create the Patient with the record's agent as owner.
   - Conflict → record saved as entered, patient stays in the admin conflict list.
2. **One open (Pending) record per patient per module** (was: across all
   modules). Applies to create, import, update (contact change / status back to
   Pending), reopen, activity log.
3. **Same agent for all open records**: guaranteed by rule 1 + reassignment
   always moving the patient.
4. **Reassign** (`reassignSale` keeps its name but now reassigns the patient):
   moves every open record in every module, updates Patients, moves Active
   refill reminders, adds an activity note + one audit entry per moved record.
   Completed/Cancelled rows keep their `AgentEmail` → incentives stay with the
   closer.
5. **Contact change on a record** to a number owned by someone else:
   agents are blocked ("this patient is handled by X"); managers/admins — the
   record moves to that owner, with a notice.
6. **Reopen** a closed record whose agent is no longer the owner: goes to the
   current owner; an agent who isn't the owner can't reopen it.
7. `checkContact` also returns `owner: { name, isMe }` and open modules, so the
   form warns before saving. Still no patient details leak to non-owners.
8. Records get `AlsoIn: ['Pharmacy', …]` — other modules where this patient
   has records (computed from one pass over all module sheets).

### Migration

`migratePatients(dryRun)` in `Patients.gs` — runnable from the editor and as
admin-only API action (dry-run first, like import):

- Group every Medpass/Pharmacy row by `ContactKey` (backfill blank keys first).
- Exactly one distinct agent across the patient's rows → `Owned` by them.
- More than one distinct agent → `Conflict`, `ConflictAgents` lists each agent
  with their open/closed counts. Nothing is guessed or moved.
- Idempotent: existing Patients rows are left alone; reruns only add new ones.
- Admin resolves via `listPatientConflicts` / `resolvePatientConflict
  {contactKey, agentEmail}` → sets owner and moves open records (same code
  path as reassign). Audited.

### API changes

| Action | Change |
|---|---|
| `createSale`, `importSales` | owner auto-assignment + notice; per-module open check |
| `updateSale`, `reopenSale`, `logSaleActivity` | per-module open check; ownership rules 5–6 |
| `reassignSale` | now patient-level; returns `moved: [{type,id}]` |
| `checkContact` | adds `owner`, per-module open list |
| `listSales` / `getSale` | records include `AlsoIn` |
| new `reassignPatient` | manager/admin, by `contactKey` (used by Phase 3 too) — WRITE |
| new `migratePatients` | admin, `dryRun` — WRITE |
| new `listPatientConflicts` | admin/manager — read |
| new `resolvePatientConflict` | admin — WRITE |
| new `getModules` | any session — read |

All new writes go into `WRITE_ACTIONS`, run under the lock, call `audit(...)`.

### Frontend (Phase 1 scope only)

- "Also in: Pharmacy" chip on cards/rows and in the record panel.
- Owner notice in the form (from `checkContact`) and toast after save.
- Reassign dialog text: "moves all of this patient's open records".
- Admin "Patient conflicts" list (small panel in Settings) with Resolve.
- Sidebar/modules read from `getModules` (fallback to the built-in two).
- **Assign-to picker in the New record form for managers/admins** (user
  request 2026-10-16). Today the create form always sends the logged-in user's
  email; only the edit panel has a reassign dropdown. Agents don't see the
  picker (server already forces their own email). If `checkContact` finds an
  owner, the picker is locked to that owner with "Already handled by X".

### Also in this phase

- Add `apps-script/SmokeTest.gs` (copy of `smokeTestV2` from the live project).
- Tests in `tests/backend/backend.test.cjs` for every rule above + migration.
- Regenerate demo backend (`node scripts/build-demo-backend.mjs`).
- README: Patients tab, migration steps, ownership rules.

### Commit order

1. `SmokeTest.gs` into repo
2. Module config + engine refactor (no behaviour change, tests stay green)
3. Patients tab + ownership on create/import
4. Per-module open rule
5. Patient-level reassign + reminders
6. Migration + conflict resolution
7. Frontend: also-in, notices, conflicts panel
8. README + demo rebuild

### Open questions for Phase 1

1. Owner deactivated → new records go to the entering/chosen agent and
   ownership moves to them? (proposed: yes)
2. Active refill reminders move with the patient on reassign? (proposed: yes)
3. `SmokeTest.gs`: copy from the live editor via Claude in Chrome, or user pastes it?

---

## Phase 1b: Medpass business rules (from user, 2026-10-16)

- Medpass is a **1-year family pass**: mother, father, 2 children. A **3rd
  child** can be added for an extra charge.
- **Fixed price ₹1499.**
- **Discount up to ₹200**, only with approval.
- **Converted from OP**: the doctor-consultation (OP) fee already paid is
  credited against the pass, but the total stays ₹1499. OP conversions are
  **not eligible** for the ₹200 discount.
- A patient with an active Medpass doesn't need another for a year.

Proposed implementation (separate PR after Phase 1, built on the module config):

- New columns on Medpass (appended via `ensureHeaders`): `ListPrice`,
  `DiscountAmount`, `DiscountStatus` (Requested/Approved/Rejected),
  `DiscountApprovedBy`, `OPCredit`, `ExtraChild`, `ExtraChildFee`,
  `ValidFrom`, `ValidUntil`.
- Server computes the amounts; the browser can't set them freely:
  - Full Price → 1499 (+ 3rd-child fee)
  - Discounted → 1499 − discount (1–200), completion blocked until a
    manager/admin approves the discount
  - Converted From OP → total 1499, collected now = 1499 − OP fee, no discount
- Price, max discount and 3rd-child fee kept in `Settings` (editable later in Phase 5).
- Validity: completing a Medpass sets ValidFrom = sale date, ValidUntil = +1 year.
  New Medpass records for a patient with an active pass are blocked (message
  shows the expiry date).
- Existing rows are not rewritten; the rules apply to new completions.

Open questions for 1b:

1. 3rd-child extra charge amount? Any other add-ons?
2. Who approves the discount (manager, admin, both)? Approve in the app
   before completion, or can a manager just enter it?
3. OP fee: fixed or varies? Max? Record OP bill/visit date? Revenue counts
   1499 or only the cash collected now?
4. Validity from the sale date (365 days)? Renewal reminder before expiry
   (e.g. 30 days, like refill reminders)? Allow early renewal?
5. Record family member names/relations/ages on the pass?

---

## Session log

- **2026-10-16** — Cloned repo, read README/SECURITY/backend, created branch
  `phase1-patient-ownership`, wrote this plan. Waiting for user OK.
- **2026-10-16** — User added Medpass business rules (→ Phase 1b) and asked
  for an assign-to picker for managers/admins in the form (→ Phase 1).
  Still waiting for OK + answers to the open questions.
