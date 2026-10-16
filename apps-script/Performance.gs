// Performance.gs — monthly performance and comparisons (no incentives).
//
// For a chosen month: this month vs last month, vs the same month last year,
// and year-to-date vs the same span last year; a 24-month series for the
// trend chart; a per-module breakdown; and, for managers and above, every
// agent side by side with their change and rank.
//
// Who sees what (server-side): agents only ever get their own figures;
// managers and above get the team or any one agent. Incentive amounts are
// never part of this — they stay on the Incentives page.
//
// Measures: completed sales and revenue by the record's sale date (the same
// rule as the dashboard and targets), new enquiries by the day the record
// was created (India time), average sale value = revenue ÷ sales.

function monthAdd(month, delta) {
  var p = month.split('-').map(Number);
  var n = p[0] * 12 + (p[1] - 1) + delta;
  return Math.floor(n / 12) + '-' + ('0' + ((n % 12) + 1)).slice(-2);
}

function emptyStats() { return { count: 0, amount: 0, leads: 0 }; }

function addStats(into, s) {
  into.count += s.count;
  into.amount += s.amount;
  into.leads += s.leads;
}

function finishStats(s) {
  var amount = Math.round(s.amount * 100) / 100;
  return { count: s.count, amount: amount, leads: s.leads, avg: s.count ? Math.round(amount / s.count) : 0 };
}

function createdMonthOf(row) {
  var c = row.CreatedAt;
  if (!c) return dateKey(row.Date).slice(0, 7);
  var d = Object.prototype.toString.call(c) === '[object Date]' ? c : new Date(c);
  if (isNaN(d.getTime())) return dateKey(row.Date).slice(0, 7);
  return Utilities.formatDate(d, APP_TIMEZONE, 'yyyy-MM-dd').slice(0, 7);
}

function svc_performance(session, data) {
  data = data || {};
  var month = cleanMonth(data.month);
  var isAgent = session.role === 'agent';
  var users = {};
  sheetToObjects(getUsersSheet()).forEach(function (u) { users[lowerEmail(u.Email)] = u; });
  var who = isAgent ? lowerEmail(session.email) : cleanEmail(data.agentEmail || '');
  if (who && !users[who]) throw new Error('That person is not a user of the CRM.');

  // byMonth[month] for the chosen scope; perAgent[email][month] for the team table;
  // perModule[month][type] for the module breakdown.
  var byMonth = {};
  var perAgent = {};
  var perModule = {};
  var bucket = function (map, key) { return map[key] = map[key] || emptyStats(); };

  moduleIds().forEach(function (type) {
    sheetToObjects(getSaleSheet(type)).forEach(function (r) {
      if (!r.ID) return;
      var agent = lowerEmail(r.AgentEmail);
      var inScope = !who || agent === who;
      var lead = createdMonthOf(r);
      var sale = r.Status === 'Completed' ? dateKey(r.Date).slice(0, 7) : null;
      var amount = Number(r.Amount) || 0;
      if (inScope) {
        bucket(byMonth, lead).leads++;
        var pm = perModule[lead] = perModule[lead] || {};
        bucket(pm, type).leads++;
        if (sale) {
          var b = bucket(byMonth, sale);
          b.count++;
          b.amount += amount;
          var pms = perModule[sale] = perModule[sale] || {};
          var m = bucket(pms, type);
          m.count++;
          m.amount += amount;
        }
      }
      if (!isAgent && !who) {
        var pa = perAgent[agent] = perAgent[agent] || { name: String(r.AgentName || agent), months: {} };
        bucket(pa.months, lead).leads++;
        if (sale) {
          var ab = bucket(pa.months, sale);
          ab.count++;
          ab.amount += amount;
        }
      }
    });
  });

  var get = function (map, key) { return map[key] || emptyStats(); };
  var span = function (map, fromMonth, toMonth) {
    var s = emptyStats();
    for (var m = fromMonth; m <= toMonth; m = monthAdd(m, 1)) addStats(s, get(map, m));
    return s;
  };
  var lastMonth = monthAdd(month, -1);
  var sameLastYear = monthAdd(month, -12);
  var yearStart = month.slice(0, 4) + '-01';
  var lastYearStart = monthAdd(yearStart, -12);

  var series = [];
  for (var i = -23; i <= 0; i++) {
    var mk = monthAdd(month, i);
    series.push(Object.assign({ month: mk }, finishStats(get(byMonth, mk))));
  }

  var agents = null;
  if (!isAgent && !who) {
    agents = Object.keys(perAgent).map(function (e) {
      var a = perAgent[e];
      var u = users[e];
      return {
        email: u ? String(u.Email) : e, name: u ? String(u.Name) : a.name, active: u ? isActive(u.Active) : false,
        thisMonth: finishStats(get(a.months, month)), lastMonth: finishStats(get(a.months, lastMonth)),
        ytd: finishStats(span(a.months, yearStart, month)), ytdLastYear: finishStats(span(a.months, lastYearStart, sameLastYear))
      };
    }).filter(function (a) { return a.thisMonth.count || a.lastMonth.count || a.ytd.count || a.thisMonth.leads; });
    agents.sort(function (x, y) { return y.thisMonth.amount - x.thisMonth.amount || y.thisMonth.count - x.thisMonth.count; });
    agents.forEach(function (a, idx) { a.rank = idx + 1; });
  }

  var scopeUser = who ? users[who] : null;
  return {
    month: month,
    scope: who ? { type: 'agent', email: scopeUser ? String(scopeUser.Email) : who, name: scopeUser ? String(scopeUser.Name) : who } : { type: 'team' },
    canPickAgent: !isAgent,
    compare: {
      thisMonth: finishStats(get(byMonth, month)),
      lastMonth: finishStats(get(byMonth, lastMonth)),
      sameMonthLastYear: finishStats(get(byMonth, sameLastYear)),
      ytd: finishStats(span(byMonth, yearStart, month)),
      ytdLastYear: finishStats(span(byMonth, lastYearStart, sameLastYear))
    },
    series: series,
    modules: moduleIds().map(function (t) {
      return {
        id: t, label: SALE_TYPES[t],
        thisMonth: finishStats(get(perModule[month] || {}, t)),
        lastMonth: finishStats(get(perModule[lastMonth] || {}, t))
      };
    }),
    agents: agents
  };
}
