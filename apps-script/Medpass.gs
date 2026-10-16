// Medpass.gs — the Medpass family pass: price, members, discounts, validity.
//
// A Medpass is a one-year pass for a family: father, mother and their
// children under 21 (on the sale date). Two children are included; a third
// and a fourth can be added for an extra fee each (also for a single parent).
// Older children and other relatives (e.g.
// grandparents on the same phone number) take their own pass.
//
// Prices and limits live in the Settings tab (admins / senior managers):
//   medpassPrice 1499 · medpassMaxDiscount 200 · medpassExtraChildFee 375 ·
//   medpassIncludedChildren 2 · medpassMaxExtraChildren 2 ·
//   medpassChildMaxAge 21 · medpassSingleParent TRUE
//
// The server works out the amount; the browser can't type one in:
//   Full Price         price (+ extra-child fees)
//   Discounted         price − discount (₹1…max) (+ fees). Needs approval by
//                      an admin or senior manager before it can be Completed.
//   Converted From OP  the total stays the full price — that is the revenue,
//                      and what incentives use. The OP consultation fee the
//                      patient already paid is credited (shown on the bill as
//                      a discount), so they pay the rest now. No discount.
// PayableNow is what the customer pays today.
//
// Completing a pass sets ValidFrom (sale date) and ValidUntil (one year,
// inclusive). Someone already covered by an active pass gets a warning, not a
// block — renewal rules are still to be decided.
//
// Rows saved before these rules (no ListPrice) keep the amount they had once
// Completed; open ones follow the rules on their next save.

var MEDPASS_RELATIONS = ['Father', 'Mother', 'Child'];
var DISCOUNT_STATUSES = ['Requested', 'Approved', 'Rejected'];
var MEDPASS_SETTING_KEYS = {
  price: { key: 'medpassPrice', def: 1499, min: 1, max: 1000000, label: 'Medpass price' },
  maxDiscount: { key: 'medpassMaxDiscount', def: 200, min: 0, max: 1000000, label: 'Maximum discount' },
  extraChildFee: { key: 'medpassExtraChildFee', def: 375, min: 0, max: 1000000, label: 'Extra child fee' },
  includedChildren: { key: 'medpassIncludedChildren', def: 2, min: 0, max: 10, label: 'Children included' },
  maxExtraChildren: { key: 'medpassMaxExtraChildren', def: 2, min: 0, max: 10, label: 'Extra children allowed' },
  childMaxAge: { key: 'medpassChildMaxAge', def: 21, min: 1, max: 100, label: 'Children must be younger than' }
};

function getMedpassSettings() {
  var stored = {};
  sheetToObjects(getSettingsSheet()).forEach(function (r) { stored[String(r.Key)] = r.Value; });
  var out = {};
  Object.keys(MEDPASS_SETTING_KEYS).forEach(function (k) {
    var d = MEDPASS_SETTING_KEYS[k];
    var v = stored[d.key];
    var n = v === undefined || v === '' ? d.def : Number(v);
    out[k] = isFinite(n) && n >= d.min && n <= d.max ? n : d.def;
  });
  var sp = stored.medpassSingleParent;
  out.singleParent = sp === undefined || sp === '' ? true : asBool(sp);
  return out;
}

function svc_getMedpassSettings(session) { return getMedpassSettings(); }

function svc_updateMedpassSettings(session, data) {
  requireRole(session, SENIOR_ROLES);
  data = data || {};
  var before = getMedpassSettings();
  var next = JSON.parse(JSON.stringify(before));
  Object.keys(MEDPASS_SETTING_KEYS).forEach(function (k) {
    if (data[k] === undefined || data[k] === '') return;
    var d = MEDPASS_SETTING_KEYS[k];
    var n = Number(data[k]);
    if (!isFinite(n) || n < d.min || n > d.max || Math.round(n * 100) / 100 !== n) {
      throw new Error(d.label + ' must be a number between ' + d.min + ' and ' + d.max + '.');
    }
    next[k] = n;
  });
  if (data.singleParent !== undefined) next.singleParent = data.singleParent === true || data.singleParent === 'true';
  if (next.maxDiscount >= next.price) throw new Error('The maximum discount must be less than the price.');
  ['includedChildren', 'maxExtraChildren', 'childMaxAge'].forEach(function (k) {
    if (Math.round(next[k]) !== next[k]) throw new Error(MEDPASS_SETTING_KEYS[k].label + ' must be a whole number.');
  });

  var changes = {};
  Object.keys(MEDPASS_SETTING_KEYS).forEach(function (k) {
    if (next[k] !== before[k]) { setSetting(session, MEDPASS_SETTING_KEYS[k].key, next[k]); changes[MEDPASS_SETTING_KEYS[k].label] = { from: before[k], to: next[k] }; }
  });
  if (next.singleParent !== before.singleParent) {
    setSetting(session, 'medpassSingleParent', next.singleParent);
    changes['Single parent allowed'] = { from: before.singleParent, to: next.singleParent };
  }
  if (Object.keys(changes).length) audit(session, 'update_settings', 'Settings', 'medpass', changes, 'Updated Medpass prices and family rules');
  return next;
}

// ===== Members =====
// Whole years between two 'yyyy-MM-dd' days.
function ageOn(dobKey, onKey) {
  var b = String(dobKey).split('-').map(Number);
  var o = String(onKey).split('-').map(Number);
  var age = o[0] - b[0];
  if (o[1] < b[1] || (o[1] === b[1] && o[2] < b[2])) age--;
  return age;
}

function parseMembers(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  try { var v = JSON.parse(value); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

// The people a pass covers, checked against the family rules for the sale date.
function validateMembers(raw, saleDate, settings) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw || '[]'); } catch (e) { throw new Error('The family members list is not valid.'); }
  }
  if (raw === undefined || raw === null) raw = [];
  if (!Array.isArray(raw)) throw new Error('The family members list is not valid.');
  if (raw.length > 10) throw new Error('A Medpass covers at most 10 people.');
  var on = isDateKey(saleDate) ? saleDate : todayKey();
  var seen = {};
  var members = raw.map(function (m) {
    m = m && typeof m === 'object' ? m : {};
    var name = cleanText(m.name, 120);
    if (!name) throw new Error('Every family member needs a name.');
    if (seen[nameKey(name)]) throw new Error(name + ' is listed twice.');
    seen[nameKey(name)] = true;
    var relation = cleanText(m.relation, 20);
    requireOneOf(relation, MEDPASS_RELATIONS, 'Relation of ' + name);
    var dob = optionalDateKey(m.dob, 'Date of birth of ' + name);
    if (dob && dob > on) throw new Error('The date of birth of ' + name + ' is after the sale date.');
    if (relation === 'Child') {
      if (!dob) throw new Error('Enter the date of birth of ' + name + ' (children must be under ' + settings.childMaxAge + ').');
      var age = ageOn(dob, on);
      if (age >= settings.childMaxAge) {
        throw new Error(name + ' is ' + age + '. Children must be under ' + settings.childMaxAge + ' to be on the family pass; they need their own Medpass.');
      }
    }
    return { name: name, relation: relation, dob: dob };
  });
  var count = function (r) { return members.filter(function (m) { return m.relation === r; }).length; };
  if (count('Father') > 1 || count('Mother') > 1) throw new Error('A family pass covers one father and one mother. Other relatives need their own Medpass.');
  var maxChildren = settings.includedChildren + settings.maxExtraChildren;
  if (count('Child') > maxChildren) {
    throw new Error('A family pass covers up to ' + maxChildren + ' children (' + settings.includedChildren + ' included' +
      (settings.maxExtraChildren ? ', ' + settings.maxExtraChildren + ' extra for a fee' : '') + ').');
  }
  var parents = count('Father') + count('Mother');
  if (members.length && parents === 0) throw new Error('Add at least one parent to the family pass.');
  if (members.length && !settings.singleParent && parents < 2) throw new Error('A family pass needs both parents.');
  return members;
}

// ===== Price =====
function round2(n) { return Math.round(n * 100) / 100; }

// The price fields for a pass. Pending records may leave the discount reason
// and the OP fee for later; completing needs them (medpassValidateCompletion).
function medpassPricing(priceType, members, discountAmount, opCredit, settings) {
  var children = members.filter(function (m) { return m.relation === 'Child'; }).length;
  var extraFee = Math.max(0, children - settings.includedChildren) * settings.extraChildFee;
  var total = settings.price + extraFee;
  var out = { ListPrice: settings.price, ExtraChildFee: extraFee, DiscountAmount: 0, OPCredit: 0, Amount: total, PayableNow: total };
  if (priceType === 'Discounted') {
    var d = Number(discountAmount);
    if (discountAmount === '' || discountAmount === undefined || discountAmount === null || !(d > 0) || d > settings.maxDiscount || round2(d) !== d) {
      throw new Error('Enter a discount between ₹1 and ₹' + settings.maxDiscount + '.');
    }
    out.DiscountAmount = d;
    out.Amount = round2(total - d);
    out.PayableNow = out.Amount;
  } else if (priceType === 'Converted From OP') {
    var op = opCredit === '' || opCredit === undefined || opCredit === null ? 0 : Number(opCredit);
    if (!isFinite(op) || op < 0 || op > total || round2(op) !== op) throw new Error('The OP consultation fee must be between ₹0 and ₹' + total + '.');
    out.OPCredit = op;
    out.PayableNow = round2(total - op);
  }
  return out;
}

function addOneYear(key) {
  var p = String(key).split('-').map(Number);
  var next = Date.UTC(p[0] + 1, p[1] - 1, p[2]) / DAY_MS; // 29 Feb → 1 Mar
  return dayNumberToKey(next - 1);
}

function isApprover(session) { return SENIOR_ROLES.indexOf(session.role) !== -1; }

// Members of this pass already covered by another active pass on this number.
function coverageWarnings(contactKey, members, exceptId) {
  if (!members.length) return [];
  var today = todayKey();
  var covered = {};
  sheetToObjects(getSaleSheet('medpass')).forEach(function (r) {
    if (r.Status !== 'Completed' || String(r.ID) === String(exceptId || '')) return;
    if (recordContactKey(r) !== String(contactKey)) return;
    var until = dateKey(r.ValidUntil);
    if (!until || until < today) return;
    parseMembers(r.Members).forEach(function (m) { covered[nameKey(m.name)] = until; });
  });
  return members.filter(function (m) { return covered[nameKey(m.name)]; }).map(function (m) {
    return m.name + ' is already covered by a Medpass valid until ' + covered[nameKey(m.name)] + '.';
  });
}

// ===== Hooks (see Modules.gs) =====
function medpassPrepareSave(session, ctx) {
  var data = ctx.data || {};
  var existing = ctx.existing;
  var next = ctx.next;
  var settings = getMedpassSettings();

  var membersIn = data.members !== undefined ? data.members : (existing ? existing.Members : []);
  var discountIn = data.discountAmount !== undefined ? data.discountAmount : (existing ? existing.DiscountAmount : '');
  var opIn = data.opCredit !== undefined ? data.opCredit : (existing ? existing.OPCredit : '');
  var reasonIn = data.discountReason !== undefined ? cleanText(data.discountReason, 300) : String((existing && existing.DiscountReason) || '');

  // A Completed pass keeps its price unless what it is priced on changes
  // (and passes from before these rules keep theirs entirely).
  if (existing && existing.Status === 'Completed') {
    if (existing.ListPrice === '' || existing.ListPrice === undefined) return { fields: {}, warnings: [] };
    var membersNow = JSON.stringify(validateMembers(membersIn, dateKey(next.Date), settings));
    var unchanged = membersNow === JSON.stringify(parseMembers(existing.Members)) &&
      String(next.PriceType) === String(existing.PriceType) &&
      Number(discountIn || 0) === Number(existing.DiscountAmount || 0) &&
      Number(opIn || 0) === Number(existing.OPCredit || 0) &&
      dateKey(next.Date) === dateKey(existing.Date);
    if (unchanged) return { fields: {}, warnings: [] };
  }

  var members = validateMembers(membersIn, dateKey(next.Date), settings);
  var priceType = String(next.PriceType || 'Full Price');
  var fields = medpassPricing(priceType, members, discountIn, opIn, settings);
  fields.Members = JSON.stringify(members);

  if (priceType === 'Discounted') {
    var changed = !existing || existing.PriceType !== 'Discounted' || Number(existing.DiscountAmount || 0) !== fields.DiscountAmount;
    fields.DiscountReason = reasonIn;
    if (changed) {
      if (reasonIn.length < 3) throw new Error('Give a reason for the discount (at least 3 characters).');
      // An approver's own discount needs no second approval.
      fields.DiscountStatus = isApprover(session) ? 'Approved' : 'Requested';
      fields.DiscountRequestedBy = session.name;
      fields.DiscountDecidedBy = isApprover(session) ? session.name : '';
    } else {
      fields.DiscountStatus = String(existing.DiscountStatus || 'Requested');
      fields.DiscountRequestedBy = String(existing.DiscountRequestedBy || '');
      fields.DiscountDecidedBy = String(existing.DiscountDecidedBy || '');
    }
  } else {
    fields.DiscountReason = '';
    fields.DiscountStatus = '';
    fields.DiscountRequestedBy = '';
    fields.DiscountDecidedBy = '';
  }

  if (next.Status === 'Completed') {
    fields.ValidFrom = dateKey(next.Date);
    fields.ValidUntil = addOneYear(fields.ValidFrom);
  } else {
    fields.ValidFrom = '';
    fields.ValidUntil = '';
  }

  var warnings = coverageWarnings(next.ContactKey || (existing && recordContactKey(existing)), members, existing && existing.ID);
  if (fields.DiscountStatus === 'Requested' && (!existing || existing.DiscountStatus !== 'Requested' || data.discountAmount !== undefined && Number(existing.DiscountAmount || 0) !== fields.DiscountAmount)) {
    warnings.push('The ₹' + fields.DiscountAmount + ' discount is waiting for approval by an admin or senior manager.');
  }
  return { fields: fields, warnings: warnings };
}

function medpassValidateCompletion(next) {
  if (next.ListPrice === '' || next.ListPrice === undefined) return; // from before these rules
  var members = parseMembers(next.Members);
  if (!members.length) throw new Error('Add the family members this Medpass covers before marking it Completed.');
  if (next.PriceType === 'Discounted' && next.DiscountStatus !== 'Approved') {
    throw new Error(next.DiscountStatus === 'Rejected'
      ? 'The discount was rejected. Change the price type or ask for a different discount.'
      : 'The discount is waiting for approval by an admin or senior manager.');
  }
  if (next.PriceType === 'Converted From OP' && !(Number(next.OPCredit) > 0)) {
    throw new Error('Enter the OP consultation fee the patient already paid.');
  }
}

function medpassClientFields(row) {
  var until = dateKey(row.ValidUntil);
  return {
    Members: parseMembers(row.Members),
    ListPrice: row.ListPrice === '' || row.ListPrice === undefined ? null : Number(row.ListPrice),
    ExtraChildFee: Number(row.ExtraChildFee) || 0,
    DiscountAmount: Number(row.DiscountAmount) || 0,
    DiscountReason: String(row.DiscountReason || ''),
    DiscountStatus: DISCOUNT_STATUSES.indexOf(row.DiscountStatus) !== -1 ? row.DiscountStatus : '',
    DiscountRequestedBy: String(row.DiscountRequestedBy || ''),
    DiscountDecidedBy: String(row.DiscountDecidedBy || ''),
    OPCredit: Number(row.OPCredit) || 0,
    PayableNow: row.PayableNow === '' || row.PayableNow === undefined ? Number(row.Amount) || 0 : Number(row.PayableNow),
    ValidFrom: dateKey(row.ValidFrom),
    ValidUntil: until,
    PassStatus: row.Status !== 'Completed' || !until ? '' : until >= todayKey() ? 'active' : 'expired'
  };
}

// Imported leads get the standard price. Discounts need a reason and an
// approval, so they're set in the app, not from a spreadsheet.
function medpassPrepareImport(r, errors) {
  if (r.priceType === 'Discounted') {
    errors.push('Discounts can\'t be imported — import as Full Price and add the discount in the app.');
    return {};
  }
  var s = getMedpassSettings();
  return { Amount: s.price, ListPrice: s.price, ExtraChildFee: 0, DiscountAmount: 0, OPCredit: 0, PayableNow: s.price, Members: '[]' };
}

// ===== Discount approval =====
function svc_listPendingDiscounts(session) {
  requireRole(session, TEAM_ROLES);
  return sheetToObjects(getSaleSheet('medpass'))
    .filter(function (r) { return r.ID && r.Status === 'Pending' && r.PriceType === 'Discounted' && r.DiscountStatus === 'Requested'; })
    .map(function (r) {
      return {
        ID: String(r.ID), CustomerName: String(r.CustomerName), AgentName: String(r.AgentName),
        DiscountAmount: Number(r.DiscountAmount) || 0, DiscountReason: String(r.DiscountReason || ''),
        DiscountRequestedBy: String(r.DiscountRequestedBy || ''), Amount: Number(r.Amount) || 0, UpdatedAt: isoString(r.UpdatedAt)
      };
    });
}

// Admin or senior manager approves or rejects a requested discount.
function svc_decideMedpassDiscount(session, data) {
  requireRole(session, SENIOR_ROLES);
  data = data || {};
  var sheet = getSaleSheet('medpass');
  var existing = findSaleRow('medpass', data.id);
  if (!existing) throw new Error('Record not found.');
  if (existing.PriceType !== 'Discounted' || existing.DiscountStatus !== 'Requested') throw new Error('This record has no discount waiting for approval.');
  var approve = data.approve === true;
  var note = cleanText(data.note, 300);
  if (!approve && note.length < 3) throw new Error('Say why the discount is rejected (at least 3 characters).');
  var patch = { DiscountStatus: approve ? 'Approved' : 'Rejected', DiscountDecidedBy: session.name, UpdatedAt: nowIso() };
  var updated = updateObjectById(sheet, existing.ID, patch);
  var summary = (approve ? 'Approved' : 'Rejected') + ' the ₹' + existing.DiscountAmount + ' discount' + (note ? '. Note: ' + note : '');
  addActivity(session, 'medpass', existing.ID, { Type: 'Note', Notes: summary });
  audit(session, approve ? 'approve_discount' : 'reject_discount', saleEntity('medpass'), existing.ID,
    { DiscountStatus: { from: 'Requested', to: patch.DiscountStatus } }, summary + ' for ' + existing.CustomerName);
  return fullSaleForClient('medpass', updated);
}
