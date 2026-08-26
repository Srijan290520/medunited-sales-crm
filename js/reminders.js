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

    var VISIBLE_PRODUCTS = 2; // caps the default card height — the rest live behind "+N more"

    function productRowHtml(p) {
        var badge = p.overdue
            ? '<span class="reminder-badge overdue small">Overdue</span>'
            : '<span class="reminder-badge upcoming small">' + p.daysRemaining + 'd left</span>';
        return '<div class="reminder-product-row"><span>' + escapeHtml(p.name) + '</span>' +
            '<span class="reminder-product-meta">x' + p.quantity + ', ' + escapeHtml(p.frequency) + '</span>' + badge + '</div>';
    }

    // Always renders the same element (visible button or invisible placeholder)
    // so every card reserves identical space here, regardless of product count.
    function moreRowHtml(r) {
        var extra = r.Products.length - VISIBLE_PRODUCTS;
        if (extra > 0) {
            return '<button type="button" class="reminder-more-btn" data-id="' + r.ID + '" data-count="' + extra + '">+' + extra + ' more ▾</button>';
        }
        return '<button type="button" class="reminder-more-btn" style="visibility:hidden;" tabindex="-1">placeholder</button>';
    }

    // Same idea — reserves the attempts-note line on every card even when empty.
    // Leads with the urgent part (if any) so it survives single-line truncation;
    // the full text is still available via the title tooltip on hover.
    function attemptsRowHtml(r) {
        if (r.AttemptCount > 0) {
            var text = r.NeedsAttention
                ? 'No contact in 3+ days (' + r.AttemptCount + ' attempt' + (r.AttemptCount === 1 ? '' : 's') + ')'
                : 'Contacted ' + r.AttemptCount + ' time' + (r.AttemptCount === 1 ? '' : 's') + (r.LastAttemptDate ? ', last ' + formatDate(r.LastAttemptDate) : '');
            var cls = 'reminder-attempts-note' + (r.NeedsAttention ? ' attention' : '');
            return '<p class="' + cls + '" title="' + escapeHtml(text) + '">' + escapeHtml(text) + '</p>';
        }
        return '<p class="reminder-attempts-note" style="visibility:hidden;">placeholder</p>';
    }

    function reassignControlHtml(r) {
        var options = agentRoster.map(function (a) {
            var selected = a.Email.toLowerCase() === String(r.AgentEmail).toLowerCase() ? ' selected' : '';
            return '<option value="' + escapeHtml(a.Email) + '"' + selected + '>' + escapeHtml(a.Name) + '</option>';
        }).join('');
        return '<button type="button" class="reminder-reassign-toggle" data-id="' + r.ID + '">Reassign ▾</button>' +
            '<div class="reminder-reassign hidden" id="reassign-' + r.ID + '">' +
            '<select class="reassign-select">' + options + '</select>' +
            '<button type="button" class="secondary reassign-btn" data-id="' + r.ID + '">Reassign</button>' +
            '</div>';
    }

    function cardHtml(r) {
        var cls = ['reminder-card'];
        if (r.Status === 'Active' && r.Overdue) cls.push('overdue');
        if (r.NeedsAttention) cls.push('needs-attention');
        if (r.Status === 'Resolved') cls.push('resolved');

        var visibleProducts = r.Products.slice(0, VISIBLE_PRODUCTS);
        var visibleProductsHtml = visibleProducts.map(productRowHtml).join('');
        // Pad with invisible placeholder rows so the products area is the same
        // height on every card, whether it has 1 product or several.
        for (var i = visibleProducts.length; i < VISIBLE_PRODUCTS; i++) {
            visibleProductsHtml += '<div class="reminder-product-row" style="visibility:hidden;">placeholder</div>';
        }
        var extraProducts = r.Products.slice(VISIBLE_PRODUCTS);
        var extraProductsHtml = extraProducts.length
            ? '<div class="reminder-products-extra hidden" id="extra-' + r.ID + '">' + extraProducts.map(productRowHtml).join('') + '</div>'
            : '';

        var contactedControls = r.Status === 'Active'
            ? '<button type="button" class="secondary contact-btn" data-id="' + r.ID + '">Mark Contacted</button>' +
              '<div class="reminder-contact-choices hidden" id="choices-' + r.ID + '">' +
              '<button type="button" class="secondary not-interested-btn" data-id="' + r.ID + '">Doesn’t want medicines</button>' +
              '<button type="button" class="secondary could-not-connect-btn" data-id="' + r.ID + '">Wants medicines — couldn’t connect</button>' +
              '</div>'
            : '';

        return '<div class="' + cls.join(' ') + '" data-id="' + r.ID + '">' +
            '<div class="reminder-card-top">' +
            '<div class="reminder-card-heading"><div class="reminder-customer">' + escapeHtml(r.CustomerName) + '</div><div class="reminder-contact">' + escapeHtml(r.Contact || '—') + '</div></div>' +
            urgencyBadge(r) +
            '</div>' +
            '<div class="reminder-products">' + visibleProductsHtml + '</div>' +
            extraProductsHtml +
            moreRowHtml(r) +
            attemptsRowHtml(r) +
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
        Array.prototype.forEach.call(document.querySelectorAll('.reminder-reassign-toggle'), function (btn) {
            btn.addEventListener('click', function () {
                document.getElementById('reassign-' + btn.dataset.id).classList.toggle('hidden');
            });
        });
        Array.prototype.forEach.call(document.querySelectorAll('.reminder-more-btn[data-count]'), function (btn) {
            btn.addEventListener('click', function () {
                var extra = document.getElementById('extra-' + btn.dataset.id);
                var wasHidden = extra.classList.contains('hidden');
                extra.classList.toggle('hidden');
                btn.textContent = wasHidden ? 'Show less ▲' : ('+' + btn.dataset.count + ' more ▾');
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
