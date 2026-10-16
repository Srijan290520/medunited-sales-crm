// DashboardLayouts.gs — which widgets each person's dashboard shows, where,
// and how big.
//
// A layout is a list of { id, span }: a widget from the catalogue below and
// its width on a 12-column grid (4, 6, 8 or 12). Each person can save their
// own layout (UserLayouts tab); without one they get their role's default.
// Admins and senior managers can change the role defaults (Settings tab:
// dashboardDefault_agent, dashboardDefault_team).
//
// A layout only decides what is drawn. The numbers in every widget come from
// dashboardSummary, which the server always filters by role — moving or
// adding a widget never changes what someone can see. Team-only widgets
// (discount approvals, team performance) can't be added by agents at all.

var LAYOUT_SPANS = [4, 6, 8, 12];
var MAX_WIDGETS = 20;
var USER_LAYOUT_HEADERS = ['Email', 'Layout', 'UpdatedAt'];

function getUserLayoutsSheet() { return getOrCreateSheet('UserLayouts', USER_LAYOUT_HEADERS); }

// Built when called (not at load), so it can use the role lists from Auth.gs.
function dashboardWidgets() {
  var all = ['admin', 'senior_manager', 'manager', 'agent'];
  return {
    target: { title: 'This month vs target', roles: all },
    comparison: { title: 'This month vs last month', roles: all },
    followups: { title: 'Follow-ups due', roles: all },
    reminders: { title: 'Reminders due', roles: all },
    temperature: { title: 'Open leads by temperature', roles: all },
    modules: { title: 'Completed sales by module', roles: all },
    pipeline: { title: 'Pipeline', roles: all },
    activity: { title: 'Recent activity', roles: all },
    discounts: { title: 'Discounts waiting for approval', roles: TEAM_ROLES },
    team: { title: 'Team performance', roles: TEAM_ROLES }
  };
}

// 'agent' for agents; 'team' for everyone who sees the whole team.
function layoutGroup(role) { return role === 'agent' ? 'agent' : 'team'; }

var BUILT_IN_LAYOUTS = {
  agent: [{ id: 'target', span: 4 }, { id: 'comparison', span: 4 }, { id: 'temperature', span: 4 }, { id: 'followups', span: 8 }, { id: 'reminders', span: 4 },
    { id: 'modules', span: 4 }],
  team: [{ id: 'target', span: 4 }, { id: 'comparison', span: 4 }, { id: 'discounts', span: 4 }, { id: 'team', span: 8 }, { id: 'temperature', span: 4 },
    { id: 'followups', span: 8 }, { id: 'reminders', span: 4 }, { id: 'modules', span: 4 }]
};

// Checks a layout for a role; drops nothing silently on save (throws), but
// `lenient` drops widgets the role can't have (a stored layout after a role change).
function cleanLayout(raw, role, lenient) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw || '[]'); } catch (e) { if (lenient) return null; throw new Error('The layout is not valid.'); }
  }
  if (!Array.isArray(raw)) { if (lenient) return null; throw new Error('The layout is not valid.'); }
  if (raw.length > MAX_WIDGETS) { if (lenient) raw = raw.slice(0, MAX_WIDGETS); else throw new Error('A dashboard can have at most ' + MAX_WIDGETS + ' widgets.'); }
  var widgets = dashboardWidgets();
  var seen = {};
  var out = [];
  raw.forEach(function (w) {
    w = w && typeof w === 'object' ? w : {};
    var id = String(w.id || '');
    var def = widgets.hasOwnProperty(id) ? widgets[id] : null;
    var span = Number(w.span);
    var problem = !def ? 'Unknown widget "' + cleanText(id, 40) + '".'
      : def.roles.indexOf(role) === -1 ? '"' + def.title + '" is not available for your role.'
      : seen[id] ? '"' + def.title + '" is on the dashboard twice.'
      : LAYOUT_SPANS.indexOf(span) === -1 ? 'Widget sizes are 4, 6, 8 or 12 columns.' : '';
    if (problem) { if (lenient) return; throw new Error(problem); }
    seen[id] = true;
    out.push({ id: id, span: span });
  });
  return out;
}

function roleDefaultLayout(role) {
  var group = layoutGroup(role);
  var stored = getSetting('dashboardDefault_' + group, '');
  var layout = stored ? cleanLayout(stored, role, true) : null;
  return layout && layout.length ? layout : cleanLayout(BUILT_IN_LAYOUTS[group], role, true);
}

function findUserLayoutRow(sheet, email) {
  var rows = sheetToObjects(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (lowerEmail(rows[i].Email) === lowerEmail(email)) return { index: i + 2, row: rows[i] };
  }
  return null;
}

function widgetChoices(role) {
  var widgets = dashboardWidgets();
  return Object.keys(widgets).filter(function (id) { return widgets[id].roles.indexOf(role) !== -1; })
    .map(function (id) { return { id: id, title: widgets[id].title }; });
}

function svc_getDashboardLayout(session) {
  var hit = findUserLayoutRow(getUserLayoutsSheet(), session.email);
  var mine = hit && hit.row.Layout ? cleanLayout(hit.row.Layout, session.role, true) : null;
  return {
    layout: mine && mine.length ? mine : roleDefaultLayout(session.role),
    source: mine && mine.length ? 'user' : 'role',
    widgets: widgetChoices(session.role),
    spans: LAYOUT_SPANS
  };
}

function svc_saveDashboardLayout(session, layout) {
  var clean = cleanLayout(layout, session.role, false);
  if (!clean.length) throw new Error('Keep at least one widget on the dashboard.');
  var sheet = getUserLayoutsSheet();
  var hit = findUserLayoutRow(sheet, session.email);
  var value = JSON.stringify(clean);
  if (hit) sheet.getRange(hit.index, 1, 1, 3).setValues([[safeCellValue(String(session.email)), value, nowIso()]]);
  else appendObject(sheet, { Email: session.email, Layout: value, UpdatedAt: nowIso() });
  audit(session, 'update_layout', 'DashboardLayout', session.email, { Widgets: { from: '', to: clean.length } }, 'Saved own dashboard layout');
  return svc_getDashboardLayout(session);
}

// Back to the role's default (the saved layout is cleared, not deleted).
function svc_resetDashboardLayout(session) {
  var sheet = getUserLayoutsSheet();
  var hit = findUserLayoutRow(sheet, session.email);
  if (hit && hit.row.Layout) {
    sheet.getRange(hit.index, 1, 1, 3).setValues([[safeCellValue(String(session.email)), '', nowIso()]]);
    audit(session, 'update_layout', 'DashboardLayout', session.email, null, 'Reset own dashboard layout to the role default');
  }
  return svc_getDashboardLayout(session);
}

// Admin or senior manager: the default for agents ('agent') or for everyone
// who sees the team ('team').
function svc_saveRoleDefaultLayout(session, group, layout) {
  requireRole(session, SENIOR_ROLES);
  if (group !== 'agent' && group !== 'team') throw new Error('Choose the agent or the team default.');
  var clean = cleanLayout(layout, group === 'agent' ? 'agent' : 'manager', false);
  if (!clean.length) throw new Error('Keep at least one widget on the dashboard.');
  setSetting(session, 'dashboardDefault_' + group, JSON.stringify(clean));
  audit(session, 'update_settings', 'Settings', 'dashboardDefault_' + group, { Widgets: { from: '', to: clean.length } },
    'Changed the default dashboard for ' + (group === 'agent' ? 'agents' : 'managers and admins'));
  return clean;
}
