(function () {
    var user = requireAuth();
    if (!user) return;
    renderLayout('reminders');

    var canManageAll = user.role === 'admin' || user.role === 'manager';
    var allReminders = [];
    var agentRoster = []; // {Email, Name} — manager/admin only, used for filter + reassignment
    var showResolved = false;

    var searchInput = document.getElementById('filter-search');
    var agentFilter = document.getElementById('filter-agent');
    var showResolvedBtn = document.getElementById('show-resolved-btn');

    async function loadAgentRoster() {
        if (!canManageAll) return;
        var res = await apiCall('listUsers');
        if (res.error) return;
        agentRoster = res.users.filter(function (u) { return u.Role === 'agent'; });
        var options = ['<option value="">All Agents</option>'].concat(agentRoster.map(function (a) {
            return '<option value="' + escapeHtml(a.Email.toLowerCase()) + '">' + escapeHtml(a.Name) + '</option>';
        }));
        agentFilter.innerHTML = options.join('');
        agentFilter.classList.remove('hidden');
    }

    function applyFilters(reminders) {
        var q = searchInput.value.trim().toLowerCase();
        var agent = agentFilter.value;
        return reminders.filter(function (r) {
            if (q) {
                var haystack = (String(r.CustomerName || '') + ' ' + String(r.Contact || '')).toLowerCase();
                if (haystack.indexOf(q) === -1) return false;
            }
            if (agent && String(r.AgentEmail).toLowerCase() !== agent) return false;
            return true;
        });
    }

    function urgencyBadge(r) {
        if (r.Status === 'Resolved') {
            var resolvedIsNotInterested = r.ResolutionReason === 'NotInterested';
            return '<span class="status-pill ' + (resolvedIsNotInterested ? 'cancelled' : 'completed') + '">' +
                (resolvedIsNotInterested ? 'Not interested' : 'Resolved') + '</span>';
        }
        if (r.Overdue) {
            var od = Math.abs(r.DaysRemaining);
            return '<span class="reminder-badge overdue">' + (od === 0 ? 'Due today' : 'Overdue ' + od + ' day' + (od === 1 ? '' : 's')) + '</span>';
        }
        return '<span class="reminder-badge upcoming">Ending in ' + r.DaysRemaining + ' day' + (r.DaysRemaining === 1 ? '' : 's') + '</span>';
    }

    function productRowHtml(p) {
        var badge = p.overdue
            ? '<span class="reminder-badge overdue small">Overdue</span>'
            : '<span class="reminder-badge upcoming small">' + p.daysRemaining + 'd left</span>';
        return '<div class="reminder-product-row"><span>' + escapeHtml(p.name) + '</span>' +
            '<span class="reminder-product-meta">x' + p.quantity + ', ' + escapeHtml(p.frequency) + '</span>' + badge + '</div>';
    }

    function reassignControlHtml(r) {
        var options = agentRoster.map(function (a) {
            var selected = a.Email.toLowerCase() === String(r.AgentEmail).toLowerCase() ? ' selected' : '';
            return '<option value="' + escapeHtml(a.Email) + '"' + selected + '>' + escapeHtml(a.Name) + '</option>';
        }).join('');
        return '<div class="reminder-reassign">' +
            '<select class="reassign-select">' + options + '</select>' +
            '<button type="button" class="secondary reassign-btn" data-id="' + r.ID + '">Reassign</button>' +
            '</div>';
    }

    function cardHtml(r) {
        var cls = ['reminder-card'];
        if (r.Status === 'Active' && r.Overdue) cls.push('overdue');
        if (r.NeedsAttention) cls.push('needs-attention');
        if (r.Status === 'Resolved') cls.push('resolved');

        var productsHtml = r.Products.map(productRowHtml).join('');

        var contactedControls = r.Status === 'Active'
            ? '<button type="button" class="secondary contact-btn" data-id="' + r.ID + '">Mark Contacted</button>' +
              '<div class="reminder-contact-choices hidden" id="choices-' + r.ID + '">' +
              '<button type="button" class="secondary not-interested-btn" data-id="' + r.ID + '">Doesn’t want medicines</button>' +
              '<button type="button" class="secondary could-not-connect-btn" data-id="' + r.ID + '">Wants medicines — couldn’t connect</button>' +
              '</div>'
            : '';

        var attemptsNote = r.AttemptCount > 0
            ? '<p class="field-hint" style="margin:8px 0 0;">Contacted ' + r.AttemptCount + ' time' + (r.AttemptCount === 1 ? '' : 's') +
              (r.LastAttemptDate ? ', last on ' + formatDate(r.LastAttemptDate) : '') +
              (r.NeedsAttention ? ' — <strong style="color:var(--danger-text);">no contact in 3+ days</strong>' : '') + '</p>'
            : '';

        return '<div class="' + cls.join(' ') + '" data-id="' + r.ID + '">' +
            '<div class="reminder-card-top">' +
            '<div><div class="reminder-customer">' + escapeHtml(r.CustomerName) + '</div><div class="reminder-contact">' + escapeHtml(r.Contact || '—') + '</div></div>' +
            urgencyBadge(r) +
            '</div>' +
            '<div class="reminder-products">' + productsHtml + '</div>' +
            attemptsNote +
            '<div class="reminder-footer">' +
            avatarHtml(r.AgentName) +
            '<div class="reminder-actions">' + contactedControls + '</div>' +
            '</div>' +
            (canManageAll ? reassignControlHtml(r) : '') +
            '</div>';
    }

    function render() {
        var filtered = applyFilters(allReminders);
        var list = document.getElementById('reminders-list');
        var empty = document.getElementById('reminders-empty');

        if (filtered.length === 0) {
            list.innerHTML = '';
            empty.textContent = (searchInput.value.trim() || agentFilter.value)
                ? 'No reminders match your search/filters.'
                : (showResolved ? 'No reminders yet.' : 'No active reminders right now.');
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');
        list.innerHTML = filtered.map(cardHtml).join('');
        wireCardEvents();
    }

    function wireCardEvents() {
        Array.prototype.forEach.call(document.querySelectorAll('.contact-btn'), function (btn) {
            btn.addEventListener('click', function () {
                document.getElementById('choices-' + btn.dataset.id).classList.toggle('hidden');
            });
        });
        Array.prototype.forEach.call(document.querySelectorAll('.not-interested-btn'), function (btn) {
            btn.addEventListener('click', function () { markContacted(btn.dataset.id, 'not_interested'); });
        });
        Array.prototype.forEach.call(document.querySelectorAll('.could-not-connect-btn'), function (btn) {
            btn.addEventListener('click', function () { markContacted(btn.dataset.id, 'could_not_connect'); });
        });
        Array.prototype.forEach.call(document.querySelectorAll('.reassign-btn'), function (btn) {
            btn.addEventListener('click', function () {
                var card = btn.closest('.reminder-card');
                var select = card.querySelector('.reassign-select');
                reassign(btn.dataset.id, select.value);
            });
        });
    }

    async function markContacted(id, outcome) {
        var res = await apiCall('markContacted', { id: id, data: { outcome: outcome } });
        if (res.error) { alert(res.message || 'Could not update reminder.'); return; }
        load();
    }

    async function reassign(id, agentEmail) {
        if (!agentEmail) return;
        var res = await apiCall('reassignReminder', { id: id, data: { agentEmail: agentEmail } });
        if (res.error) { alert(res.message || 'Could not reassign.'); return; }
        load();
    }

    searchInput.addEventListener('input', render);
    agentFilter.addEventListener('change', render);
    document.getElementById('filter-clear-btn').addEventListener('click', function () {
        searchInput.value = '';
        agentFilter.value = '';
        render();
    });
    showResolvedBtn.addEventListener('click', function () {
        showResolved = !showResolved;
        showResolvedBtn.textContent = showResolved ? 'Show Active Only' : 'Show Resolved';
        load();
    });

    async function load() {
        var res = await apiCall('listReminders', { includeResolved: showResolved ? 'true' : 'false' });
        if (res.error) {
            allReminders = [];
            document.getElementById('reminders-list').innerHTML = '';
            var empty = document.getElementById('reminders-empty');
            empty.textContent = res.message || 'Could not load reminders.';
            empty.classList.remove('hidden');
            return;
        }
        allReminders = res.reminders || [];
        render();
    }

    loadAgentRoster().then(load);
})();
