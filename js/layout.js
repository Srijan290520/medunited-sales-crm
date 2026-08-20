// layout.js — renders the sidebar nav (gated by role) into #app-sidebar.
// Call renderLayout('dashboard') etc. right after requireAuth().

var ICONS = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg>',
    medpass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
    pharmacy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="7" width="15" height="11" rx="1.5"></rect><path d="M16 10h3.5L22 13.5V18h-6"></path><circle cx="6" cy="19.5" r="1.7"></circle><circle cx="17.5" cy="19.5" r="1.7"></circle></svg>',
    incentives: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="5" y2="19"></line><circle cx="6.5" cy="6.5" r="2.5"></circle><circle cx="17.5" cy="17.5" r="2.5"></circle></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    reminders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>'
};

var NAV_ITEMS = [
    { page: 'dashboard', href: 'dashboard.html', label: 'Dashboard', icon: 'dashboard', roles: null },
    { page: 'medpass', href: 'medpass.html', label: 'Medpass', icon: 'medpass', roles: null },
    { page: 'pharmacy', href: 'pharmacy.html', label: 'Pharmacy', icon: 'pharmacy', roles: null },
    { page: 'reminders', href: 'reminders.html', label: 'Reminders', icon: 'reminders', roles: null },
    { page: 'settings', href: 'settings.html', label: 'Incentives', icon: 'incentives', roles: ['admin', 'manager'] },
    { page: 'users', href: 'users.html', label: 'Users', icon: 'users', roles: ['admin'] }
];

function renderLayout(activePage) {
    var user = getCurrentUser();
    if (!user) return;

    var sidebar = document.getElementById('app-sidebar');
    if (!sidebar) return;

    var navHtml = NAV_ITEMS
        .filter(function (item) { return !item.roles || item.roles.indexOf(user.role) !== -1; })
        .map(function (item) {
            var cls = item.page === activePage ? 'active' : '';
            return '<a href="' + item.href + '" class="' + cls + '">' + ICONS[item.icon] + '<span>' + item.label + '</span></a>';
        })
        .join('');

    sidebar.innerHTML =
        '<div class="sidebar-brand"><span class="logo-mark">M</span><span>MedUnited CRM</span></div>' +
        '<nav class="sidebar-nav">' + navHtml + '</nav>' +
        '<div class="sidebar-footer">' +
        '  <div class="sidebar-user">' +
        '    <div class="avatar">' + initials(user.name) + '</div>' +
        '    <div class="info">' +
        '      <div class="name">' + escapeHtml(user.name) + '</div>' +
        '      <div class="role">' + escapeHtml(user.role) + '</div>' +
        '    </div>' +
        '    <button id="logout-btn" type="button" title="Log out">' + ICONS.logout + '</button>' +
        '  </div>' +
        '</div>';

    document.getElementById('logout-btn').addEventListener('click', async function () {
        await apiCall('logout');
        clearSession();
        window.location.href = 'index.html';
    });
}

function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str === undefined || str === null ? '' : String(str);
    return div.innerHTML;
}

function initials(name) {
    if (!name) return '?';
    var parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    var i = parts[0].charAt(0);
    if (parts.length > 1) i += parts[parts.length - 1].charAt(0);
    return i.toUpperCase();
}

function avatarHtml(name) {
    return '<div class="table-person"><span class="avatar-sm">' + initials(name) + '</span>' + escapeHtml(name) + '</div>';
}

function formatMoney(n) {
    n = Number(n) || 0;
    return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}
