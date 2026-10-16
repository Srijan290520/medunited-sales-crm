// Modules.gs — the sales modules (Medpass, Pharmacy, …) as configuration.
//
// Every module is a tab with the same columns (SALE_HEADERS) and runs on
// the same engine (SalesService.gs, Import.gs, the dashboard). What differs
// between modules is described here, so adding a module means adding an
// entry, not copying code:
//
//   id            value of the `type` parameter in the API
//   label         shown to people, also the tab name
//   priceTypes    true → PriceType is required (Full Price / Discounted / …)
//   products      true → medicines list (Products JSON); Detail is a summary of it
//   needsProducts true → can't be Completed without at least one product
//   reminders     true → completed sales get refill reminders
//   incentive     { kind: 'perSale' } flat ₹ per sale by price type, or
//                 { kind: 'percent' } % of the amount — rates live on the Users tab
//   extraHeaders  columns only this module's tab has (added after SALE_HEADERS)
//   hooks         optional module rules, called by the engine:
//     prepareSave(session, ctx)   → { fields, warnings } computed fields for a
//                                   create/update (ctx: isCreate, data, existing, next)
//     validateCompletion(next)    throws if the record can't be Completed yet
//     clientFields(row)           extra fields the browser gets
//     prepareImport(r, errors)    computed fields for an imported lead
// Hooks are written as function(…) { return name(…); } so they can live in
// another file (Apps Script doesn't guarantee the order files load in).

var MODULES = {
  medpass: {
    id: 'medpass', label: 'Medpass',
    priceTypes: true, products: false, needsProducts: false, reminders: false,
    incentive: { kind: 'perSale', fullRateField: 'MedpassFullRate', discountRateField: 'MedpassDiscountRate' },
    // See Medpass.gs.
    extraHeaders: ['Members', 'ListPrice', 'ExtraChildFee', 'DiscountAmount', 'DiscountReason', 'DiscountStatus',
      'DiscountRequestedBy', 'DiscountDecidedBy', 'OPCredit', 'PayableNow', 'ValidFrom', 'ValidUntil'],
    hooks: {
      prepareSave: function (session, ctx) { return medpassPrepareSave(session, ctx); },
      validateCompletion: function (next) { return medpassValidateCompletion(next); },
      clientFields: function (row) { return medpassClientFields(row); },
      prepareImport: function (r, errors) { return medpassPrepareImport(r, errors); }
    }
  },
  pharmacy: {
    id: 'pharmacy', label: 'Pharmacy',
    priceTypes: false, products: true, needsProducts: true, reminders: true,
    incentive: { kind: 'percent', percentField: 'PharmacyIncentivePercent' }
  }
};

// Module id → label. Kept under its old name because it is used everywhere.
var SALE_TYPES = {};
Object.keys(MODULES).forEach(function (id) { SALE_TYPES[id] = MODULES[id].label; });

function moduleIds() { return Object.keys(MODULES); }

// Every column of a module's tab: the shared ones, then its own.
function moduleHeaders(type) { return SALE_HEADERS.concat(getModule(type).extraHeaders || []); }

function moduleHook(type, name) {
  var hooks = getModule(type).hooks || {};
  return typeof hooks[name] === 'function' ? hooks[name] : null;
}

function getModule(type) {
  var mod = MODULES.hasOwnProperty(type) ? MODULES[type] : null;
  if (!mod) throw new Error('Invalid sale type.');
  return mod;
}

// Incentive earned on one Completed sale, given the agent's rates row.
function incentiveForSale(mod, row, rates) {
  if (!rates) return 0;
  var inc = mod.incentive || {};
  if (inc.kind === 'perSale') {
    var field = row.PriceType === 'Discounted' ? inc.discountRateField : inc.fullRateField;
    return Number(rates[field]) || 0;
  }
  if (inc.kind === 'percent') {
    return (Number(row.Amount) || 0) * ((Number(rates[inc.percentField]) || 0) / 100);
  }
  return 0;
}

// Module side effects after a record is saved or deleted.
function afterSaleSaved(type, sale) {
  if (getModule(type).reminders) syncReminderForSale(sale);
}

function afterSaleDeleted(type, saleId) {
  if (getModule(type).reminders) removeReminderForSale(saleId);
}

// What the browser needs to build its menus and forms.
function svc_getModules(session) {
  return moduleIds().map(function (id) {
    var m = MODULES[id];
    return { id: m.id, label: m.label, priceTypes: m.priceTypes, products: m.products, reminders: m.reminders };
  });
}
