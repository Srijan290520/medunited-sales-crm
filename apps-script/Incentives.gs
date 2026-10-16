// Incentives.gs — monthly targets per agent and module, and the incentive
// report behind payouts.
//
// Targets (Targets tab): one row per month + agent + module. Each module's
// target is measured either as revenue (₹ of completed sales, the default)
// or as a number of completed sales — a setting per module
// (Settings: targetMeasure_<module>). Managers and above set targets and can
// copy last month's; agents only ever see their own targets and progress.
// Hitting a target does not change incentives (to be decided later).
//
// Incentive report: completed sales in a month, per agent and module, with
// the incentive each earned under the agent's rates (Users tab) and the
// module's rule (Modules.gs). Managers and above only — agents never see
// incentive amounts. Rates are the current ones: a rate change also changes
// what earlier months show.

var TARGET_HEADERS = ['ID', 'Month', 'AgentEmail', 'Module', 'Target', 'UpdatedAt', 'UpdatedBy'];
var TARGET_MEASURES = ['revenue', 'count'];

function getTargetsSheet() { return getOrCreateSheet('Targets', TARGET_HEADERS); }

// 'yyyy-MM'; blank means this month (India time).
function cleanMonth(value) {
  var m = cleanText(value, 7);
  if (!m) return todayKey().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new Error('Month must look like 2026-10.');
  return m;
}

// A Month cell back as 'yyyy-MM' (even if Sheets turned it into a date).
function monthOf(value) {
  return Object.prototype.toString.call(value) === '[object Date]' ? dateKey(value).slice(0, 7) : String(value || '').slice(0, 7);
}

function previousMonth(month) {
  var p = month.split('-').map(Number);
  return p[1] === 1 ? (p[0] - 1) + '-12' : p[0] + '-' + ('0' + (p[1] - 1)).slice(-2);
}

function targetMeasure(type) {
  var v = String(getSetting('targetMeasure_' + type, 'revenue'));
  return TARGET_MEASURES.indexOf(v) !== -1 ? v : 'revenue';
}

function targetMeasures() {
  var out = {};
  moduleIds().forEach(function (t) { out[t] = targetMeasure(t); });
  return out;
}

// Completed sales of a month: { agentEmail: { module: { count, amount, sales: [...] } } }.
function completedInMonth(month, onlyEmail) {
  var out = {};
  moduleIds().forEach(function (type) {
    sheetToObjects(getSaleSheet(type)).forEach(function (r) {
      if (!r.ID || r.Status !== 'Completed' || dateKey(r.Date).slice(0, 7) !== month) return;
      var e = lowerEmail(r.AgentEmail);
      if (onlyEmail && e !== lowerEmail(onlyEmail)) return;
      var a = out[e] = out[e] || { name: String(r.AgentName) };
      var m = a[type] = a[type] || { count: 0, amount: 0, rows: [] };
      m.count++;
      m.amount += Number(r.Amount) || 0;
      m.rows.push(r);
    });
  });
  return out;
}

// People who can have targets: active agents and managers.
function targetPeople() {
  return sheetToObjects(getUsersSheet()).filter(function (u) {
    return u.ID && isActive(u.Active) && (u.Role === 'agent' || u.Role === 'manager');
  });
}

function svc_getTargets(session, month) {
  month = cleanMonth(month);
  var isAgent = session.role === 'agent';
  var measures = targetMeasures();
  var stored = {};
  sheetToObjects(getTargetsSheet()).forEach(function (t) {
    if (monthOf(t.Month) !== month || t.Target === '' || t.Target === null) return;
    stored[lowerEmail(t.AgentEmail) + '|' + t.Module] = Number(t.Target) || 0;
  });
  var done = completedInMonth(month, isAgent ? session.email : null);
  var people = isAgent ? [{ Email: session.email, Name: session.name }] : targetPeople();
  var rows = [];
  people.forEach(function (u) {
    var e = lowerEmail(u.Email);
    moduleIds().forEach(function (type) {
      var target = stored.hasOwnProperty(e + '|' + type) ? stored[e + '|' + type] : null;
      var got = (done[e] && done[e][type]) || { count: 0, amount: 0 };
      var achieved = measures[type] === 'count' ? got.count : Math.round(got.amount * 100) / 100;
      rows.push({
        agentEmail: String(u.Email), agentName: String(u.Name), module: type, moduleLabel: SALE_TYPES[type],
        measure: measures[type], target: target, achieved: achieved,
        percent: target ? Math.round((achieved / target) * 100) : null
      });
    });
  });
  return { month: month, measures: measures, rows: rows, canEdit: !isAgent };
}

// entries: [{ agentEmail, module, target }] — a blank target clears it.
function svc_saveTargets(session, data) {
  requireRole(session, TEAM_ROLES);
  data = data || {};
  var month = cleanMonth(data.month);
  var entries = Array.isArray(data.entries) ? data.entries : [];
  if (!entries.length) throw new Error('Nothing to save.');
  if (entries.length > 2000) throw new Error('Too many targets at once.');
  var people = {};
  targetPeople().forEach(function (u) { people[lowerEmail(u.Email)] = u; });

  var clean = entries.map(function (x) {
    x = x && typeof x === 'object' ? x : {};
    var u = people[cleanEmail(x.agentEmail)];
    if (!u) throw new Error('"' + cleanText(x.agentEmail, 80) + '" is not an active agent or manager.');
    getModule(x.module);
    var raw = x.target;
    var value = '';
    if (raw !== '' && raw !== null && raw !== undefined) {
      value = Number(raw);
      if (!isFinite(value) || value < 0 || value > 1e9) throw new Error('Targets must be numbers between 0 and 1,00,00,00,000.');
      if (targetMeasure(x.module) === 'count' && Math.round(value) !== value) throw new Error(SALE_TYPES[x.module] + ' targets are a number of sales — use whole numbers.');
      value = Math.round(value * 100) / 100;
    }
    return { email: u.Email, module: x.module, target: value };
  });

  var sheet = getTargetsSheet();
  var rows = sheetToObjects(sheet);
  var index = {};
  rows.forEach(function (r, i) { if (monthOf(r.Month) === month) index[lowerEmail(r.AgentEmail) + '|' + r.Module] = { at: i + 2, row: r }; });
  var changed = 0;
  clean.forEach(function (c) {
    var key = lowerEmail(c.email) + '|' + c.module;
    var hit = index[key];
    if (hit) {
      var before = hit.row.Target === '' ? '' : Number(hit.row.Target);
      if (before === c.target) return;
      updateObjectById(sheet, hit.row.ID, { Target: c.target, UpdatedAt: nowIso(), UpdatedBy: session.email });
      changed++;
    } else if (c.target !== '') {
      appendObject(sheet, { ID: newId(), Month: month, AgentEmail: c.email, Module: c.module, Target: c.target, UpdatedAt: nowIso(), UpdatedBy: session.email });
      changed++;
    }
  });
  if (changed) audit(session, 'update_targets', 'Targets', month, { Changed: { from: '', to: changed } }, 'Updated ' + changed + ' monthly target(s) for ' + month);
  var out = svc_getTargets(session, month);
  out.changed = changed;
  return out;
}

// Copies one month's targets into another; existing ones are kept unless overwrite.
function svc_copyTargets(session, data) {
  requireRole(session, TEAM_ROLES);
  data = data || {};
  var to = cleanMonth(data.toMonth);
  var from = data.fromMonth ? cleanMonth(data.fromMonth) : previousMonth(to);
  if (from === to) throw new Error('Choose a different month to copy from.');
  var people = {};
  targetPeople().forEach(function (u) { people[lowerEmail(u.Email)] = true; });
  var entries = [];
  var existing = {};
  sheetToObjects(getTargetsSheet()).forEach(function (t) {
    if (monthOf(t.Month) === to && t.Target !== '') existing[lowerEmail(t.AgentEmail) + '|' + t.Module] = true;
  });
  var skipped = 0;
  sheetToObjects(getTargetsSheet()).forEach(function (t) {
    if (monthOf(t.Month) !== from || t.Target === '' || !people[lowerEmail(t.AgentEmail)] || !MODULES.hasOwnProperty(t.Module)) return;
    if (existing[lowerEmail(t.AgentEmail) + '|' + t.Module] && data.overwrite !== true) { skipped++; return; }
    entries.push({ agentEmail: t.AgentEmail, module: t.Module, target: t.Target });
  });
  if (!entries.length) {
    var none = svc_getTargets(session, to);
    none.copied = 0;
    none.skipped = skipped;
    return none;
  }
  var out = svc_saveTargets(session, { month: to, entries: entries });
  out.copied = entries.length;
  out.skipped = skipped;
  return out;
}

function svc_setTargetMeasure(session, data) {
  requireRole(session, SENIOR_ROLES);
  data = data || {};
  getModule(data.module);
  requireOneOf(String(data.measure), TARGET_MEASURES, 'Target measure');
  var before = targetMeasure(data.module);
  if (before !== data.measure) {
    setSetting(session, 'targetMeasure_' + data.module, data.measure);
    audit(session, 'update_settings', 'Settings', 'targetMeasure_' + data.module, { Measure: { from: before, to: data.measure } },
      SALE_TYPES[data.module] + ' targets are now measured as ' + (data.measure === 'count' ? 'number of sales' : 'revenue'));
  }
  return targetMeasures();
}

// ===== Incentive report =====
function svc_incentiveReport(session, month) {
  requireRole(session, TEAM_ROLES);
  month = cleanMonth(month);
  var rates = {};
  sheetToObjects(getUsersSheet()).forEach(function (u) { rates[lowerEmail(u.Email)] = u; });
  var done = completedInMonth(month, null);
  var round = function (n) { return Math.round(n * 100) / 100; };
  var totals = { count: 0, amount: 0, incentive: 0, modules: {} };
  moduleIds().forEach(function (t) { totals.modules[t] = { count: 0, amount: 0, incentive: 0 }; });

  var agents = Object.keys(done).map(function (e) {
    var a = { agentEmail: e, agentName: done[e].name, modules: {}, count: 0, amount: 0, incentive: 0, sales: [] };
    moduleIds().forEach(function (type) {
      var m = done[e][type];
      var slot = a.modules[type] = { count: 0, amount: 0, incentive: 0 };
      if (!m) return;
      var mod = getModule(type);
      m.rows.forEach(function (r) {
        var inc = round(incentiveForSale(mod, r, rates[e]));
        slot.count++;
        slot.amount += Number(r.Amount) || 0;
        slot.incentive += inc;
        a.sales.push({
          id: String(r.ID), module: type, moduleLabel: SALE_TYPES[type], date: dateKey(r.Date), customerName: String(r.CustomerName),
          amount: Number(r.Amount) || 0, priceType: String(r.PriceType || ''), detail: String(r.Detail || '').slice(0, 200), incentive: inc
        });
      });
      slot.amount = round(slot.amount);
      slot.incentive = round(slot.incentive);
      a.count += slot.count;
      a.amount += slot.amount;
      a.incentive += slot.incentive;
      totals.modules[type].count += slot.count;
      totals.modules[type].amount += slot.amount;
      totals.modules[type].incentive += slot.incentive;
    });
    a.amount = round(a.amount);
    a.incentive = round(a.incentive);
    a.sales.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; });
    totals.count += a.count;
    totals.amount += a.amount;
    totals.incentive += a.incentive;
    return a;
  }).sort(function (x, y) { return y.incentive - x.incentive || y.amount - x.amount; });
  totals.amount = round(totals.amount);
  totals.incentive = round(totals.incentive);
  moduleIds().forEach(function (t) { totals.modules[t].amount = round(totals.modules[t].amount); totals.modules[t].incentive = round(totals.modules[t].incentive); });

  return {
    month: month,
    modules: moduleIds().map(function (t) { return { id: t, label: SALE_TYPES[t], incentive: (MODULES[t].incentive || {}).kind || 'none' }; }),
    agents: agents,
    totals: totals
  };
}
