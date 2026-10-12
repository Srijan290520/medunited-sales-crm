// leads.js — the Leads page: list, filters, new/edit lead panel, contact
// log, conversion to a sale, and (managers) reassignment.
(function () {
    var user = requireAuth();
    if (!user) return;
    renderLayout('leads');

    var canManageAll = user.role === 'admin' || user.role === 'manager';
    var OPEN_STAGES = ['New', 'Contacted', 'Interested', 'Follow-up'];

    var lists = null;     // dropdown options from the server
    var allLeads = [];
    var agentRoster = []; // managers only: agents a lead can be reassigned to
    var currentLead = null;
    var activeTab = 'due';

    var $ = function (id) { return document.getElementById(id); };
    var overlay = $('overlay'), popup = $('lead-popup'), form = $('lead-form'), errorBox = $('lead-popup-error');

    // ===== Small helpers =====
    function fillSelect(el, values, opts) {
        opts = opts || {};
        var html = opts.blank !== undefined ? '<option value="">' + escapeHtml(opts.blank) + '</option>' : '';
        html += values.map(function (v) { return '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</option>'; }).join('');
        el.innerHTML = html;
    }

    function stageClass(stage) { return 'stage-' + String(stage || '').toLowerCase().replace(/[^a-z]/g, ''); }
    function stagePill(stage) { return '<span class="status-pill ' + stageClass(stage) + '">' + escapeHtml(stage) + '</span>'; }
    function tempBadge(t) { return t ? '<span class="temp-badge ' + String(t).toLowerCase() + '">' + escapeHtml(t) + '</span>' : ''; }

    function followUpCell(l) {
        if (!l.NextFollowUp || OPEN_STAGES.indexOf(l.Stage) === -1) return '<span class="muted">—</span>';
        var label = formatDate(l.NextFollowUp);
        if (l.FollowUpStatus === 'overdue') return '<span class="reminder-badge overdue small">Overdue</span> ' + label;
        if (l.FollowUpStatus === 'today') return '<span class="reminder-badge upcoming small">Today</span>';
        return label;
    }

    function showPopupError(msg) { errorBox.textContent = msg; errorBox.classList.add('show'); errorBox.scrollIntoView({ block: 'nearest' }); }
    function clearPopupError() { errorBox.classList.remove('show'); }

    // ===== Loading =====
    async function loadLists() {
        var res = await apiCall('getLists');
        if (res.error) throw new Error(res.message || 'Could not load options.');
        lists = res.lists;
        fillSelect($('lead-interest'), lists.interests);
        fillSelect($('lead-temperature'), lists.temperatures);
        fillSelect($('lead-direction'), lists.directions);
        fillSelect($('lead-channel'), lists.channels, { blank: 'Choose…' });
        fillSelect($('lead-heard-from'), lists.heardFrom, { blank: 'Not asked / unknown' });
        fillSelect($('lead-lost-reason'), lists.lostReasons, { blank: 'Choose…' });
        fillSelect($('act-type'), lists.activityTypes);
        fillSelect($('act-direction'), lists.activityDirections);
        fillSelect($('act-outcome'), lists.outcomes);
        fillSelect($('filter-temperature'), lists.temperatures, { blank: 'All temperatures' });
        fillSelect($('filter-channel'), lists.channels, { blank: 'All channels' });
    }

    async function loadRoster() {
        if (!canManageAll) return;
        var res = await apiCall('listUsers');
        if (res.error) return;
        agentRoster = res.users.filter(function (u) { return u.Role === 'agent' && u.Active; });
        fillSelect($('reassign-select'), []);
        $('reassign-select').innerHTML = agentRoster.map(function (a) {
            return '<option value="' + escapeHtml(a.Email) + '">' + escapeHtml(a.Name) + '</option>';
        }).join('');
    }

    async function loadLeads() {
        $('leads-error').classList.add('hidden');
        $('leads-table-body').innerHTML = '<tr class="loading-row"><td colspan="8">Loading…</td></tr>';
        var res = await apiCall('listLeads');
        if (res.error) {
            $('leads-table-body').innerHTML = '';
            $('leads-error').querySelector('.inline-error-text').textContent = res.message || 'Could not load leads.';
            $('leads-error').classList.remove('hidden');
            return;
        }
        allLeads = res.leads || [];
        populateOwnerFilter();
        render();
    }

    // ===== List, tabs, filters =====
    function inTab(l, tab) {
        var open = OPEN_STAGES.indexOf(l.Stage) !== -1;
        if (tab === 'due') return open && (l.FollowUpStatus === 'overdue' || l.FollowUpStatus === 'today' || (l.Stage === 'New' && !l.NextFollowUp));
        if (tab === 'open') return open;
        if (tab === 'converted') return l.Stage === 'Converted';
        if (tab === 'lost') return l.Stage === 'Lost';
        return true;
    }

    function populateOwnerFilter() {
        if (!canManageAll) return;
        var sel = $('filter-owner'), current = sel.value, seen = {};
        var opts = ['<option value="">All owners</option>'];
        allLeads.forEach(function (l) {
            var k = String(l.OwnerEmail).toLowerCase();
            if (seen[k]) return;
            seen[k] = true;
            opts.push('<option value="' + escapeHtml(k) + '">' + escapeHtml(l.OwnerName) + '</option>');
        });
        sel.innerHTML = opts.join('');
        sel.classList.remove('hidden');
        if (seen[current]) sel.value = current;
    }

    function filtered() {
        var q = $('filter-search').value.trim().toLowerCase();
        var qDigits = q.replace(/\D/g, '');
        var owner = $('filter-owner').value, temp = $('filter-temperature').value, channel = $('filter-channel').value;
        return allLeads.filter(function (l) {
            if (!inTab(l, activeTab)) return false;
            if (owner && String(l.OwnerEmail).toLowerCase() !== owner) return false;
            if (temp && l.Temperature !== temp) return false;
            if (channel && l.Channel !== channel) return false;
            if (q) {
                var nameHit = String(l.Name).toLowerCase().indexOf(q) !== -1;
                var phoneHit = qDigits.length >= 3 && String(l.Contact).replace(/\D/g, '').indexOf(qDigits) !== -1;
                if (!nameHit && !phoneHit) return false;
            }
            return true;
        });
    }

    function renderCounts() {
        ['due', 'open', 'converted', 'lost', 'all'].forEach(function (t) {
            $('count-' + t).textContent = allLeads.filter(function (l) { return inTab(l, t); }).length;
        });
    }

    function render() {
        renderCounts();
        Array.prototype.forEach.call(document.querySelectorAll('.owner-col'), function (th) { th.classList.toggle('hidden', !canManageAll); });
        var rows = filtered();
        var tbody = $('leads-table-body');
        $('leads-empty').classList.toggle('hidden', rows.length > 0);
        $('leads-empty').textContent = activeTab === 'due' && allLeads.length
            ? 'Nothing due. New leads and follow-ups due today or earlier show up here.'
            : (allLeads.length ? 'No leads match these filters.' : 'No leads yet. Click "New Lead" to add one.');
        tbody.innerHTML = rows.map(function (l) {
            var source = escapeHtml(l.Channel || '') + (l.HeardFrom ? '<br><small class="muted">' + escapeHtml(l.HeardFrom) + '</small>' : '') +
                (l.Direction === 'Outbound' ? '<br><small class="muted">Outbound</small>' : '');
            return '<tr class="lead-row" data-id="' + escapeHtml(l.ID) + '" tabindex="0">' +
                '<td><div class="lead-name">' + escapeHtml(l.Name) + (l.DoNotCall ? ' <span class="dnd-tag" title="Do Not Call">DND</span>' : '') + '</div>' +
                '<small class="muted">' + escapeHtml(l.Contact) + '</small></td>' +
                '<td>' + stagePill(l.Stage) + (l.Stage === 'Lost' && l.LostReason ? '<br><small class="muted">' + escapeHtml(l.LostReason) + '</small>' : '') + '</td>' +
                '<td>' + tempBadge(l.Temperature) + '</td>' +
                '<td>' + escapeHtml(l.Interest) + '</td>' +
                '<td>' + source + '</td>' +
                '<td>' + l.AttemptCount + '</td>' +
                '<td>' + followUpCell(l) + '</td>' +
                (canManageAll ? '<td>' + avatarHtml(l.OwnerName) + '</td>' : '') +
                '</tr>';
        }).join('');
        Array.prototype.forEach.call(tbody.querySelectorAll('.lead-row'), function (row) {
            row.addEventListener('click', function () { openLead(row.dataset.id); });
            row.addEventListener('keydown', function (e) { if (e.key === 'Enter') openLead(row.dataset.id); });
        });
    }

    Array.prototype.forEach.call(document.querySelectorAll('#lead-tabs .segment'), function (btn) {
        btn.addEventListener('click', function () {
            activeTab = btn.dataset.tab;
            Array.prototype.forEach.call(document.querySelectorAll('#lead-tabs .segment'), function (b) { b.classList.toggle('active', b === btn); });
            render();
        });
    });
    ['filter-search', 'filter-owner', 'filter-temperature', 'filter-channel'].forEach(function (id) {
        $(id).addEventListener(id === 'filter-search' ? 'input' : 'change', render);
    });
    $('filter-clear-btn').addEventListener('click', function () {
        ['filter-search', 'filter-owner', 'filter-temperature', 'filter-channel'].forEach(function (id) { $(id).value = ''; });
        render();
    });
    $('leads-retry').addEventListener('click', loadLeads);

    // ===== Panel: shared form behaviour =====
    function toggleConditionalFields() {
        var inbound = $('lead-direction').value === 'Inbound';
        $('heard-from-field').classList.toggle('hidden', !inbound);
        $('lost-reason-field').classList.toggle('hidden', $('lead-stage').value !== 'Lost');
    }
    $('lead-direction').addEventListener('change', toggleConditionalFields);
    $('lead-stage').addEventListener('change', toggleConditionalFields);

    function toggleActivityFields() {
        var isNote = $('act-type').value === 'Note';
        Array.prototype.forEach.call(document.querySelectorAll('.act-contact-only'), function (el) { el.classList.toggle('hidden', isNote); });
        $('log-activity-btn').textContent = isNote ? 'Add note' : 'Log contact';
    }
    $('act-type').addEventListener('change', toggleActivityFields);

    // Duplicate / existing-customer check while typing a phone number.
    var checkTimer = null;
    function scheduleContactCheck() {
        clearTimeout(checkTimer);
        checkTimer = setTimeout(runContactCheck, 450);
    }
    async function runContactCheck() {
        var box = $('contact-check');
        var contact = $('lead-contact').value.trim();
        if (contact.replace(/\D/g, '').length < 6 || (currentLead && contact === currentLead.Contact)) { box.classList.add('hidden'); return; }
        var res = await apiCall('checkContact', { contact: contact, exceptId: currentLead ? currentLead.ID : '' });
        if (res.error) { box.classList.add('hidden'); return; }
        var parts = [];
        res.leads.filter(function (l) { return l.Open; }).forEach(function (l) {
            parts.push(l.Mine
                ? 'Already an open lead: <a href="#" class="open-dup" data-id="' + escapeHtml(l.ID) + '">' + escapeHtml(l.Name) + '</a> (' + escapeHtml(l.Stage) + ', ' + escapeHtml(l.OwnerName) + ').'
                : 'Already an open lead owned by ' + escapeHtml(l.OwnerName) + '. Ask a manager to reassign it if needed.');
        });
        var closed = res.leads.filter(function (l) { return !l.Open; }).length;
        if (closed) parts.push('Had ' + closed + ' earlier lead' + (closed === 1 ? '' : 's') + ' (converted or lost).');
        if (res.salesCount) parts.push('Existing customer: ' + res.salesCount + ' sale' + (res.salesCount === 1 ? '' : 's') + ' on record.');
        box.innerHTML = parts.join('<br>');
        box.classList.toggle('blocking', res.leads.some(function (l) { return l.Open; }));
        box.classList.toggle('hidden', parts.length === 0);
        Array.prototype.forEach.call(box.querySelectorAll('.open-dup'), function (a) {
            a.addEventListener('click', function (e) { e.preventDefault(); openLead(a.dataset.id); });
        });
    }
    $('lead-contact').addEventListener('input', scheduleContactCheck);

    function setFormLocked(locked) {
        Array.prototype.forEach.call(form.querySelectorAll('input, select, textarea'), function (el) { el.disabled = locked; });
        $('lead-save').classList.toggle('hidden', locked);
    }

    function openPanel() { overlay.classList.add('open'); popup.classList.add('open'); }
    function closePanel() {
        overlay.classList.remove('open');
        popup.classList.remove('open');
        currentLead = null;
        var url = new URL(window.location.href);
        if (url.searchParams.has('open')) { url.searchParams.delete('open'); history.replaceState(null, '', url); }
    }
    $('lead-popup-close').addEventListener('click', closePanel);
    $('lead-cancel').addEventListener('click', closePanel);
    overlay.addEventListener('click', closePanel);

    // ===== New lead =====
    function openNew() {
        currentLead = null;
        clearPopupError();
        form.reset();
        setFormLocked(false);
        $('lead-popup-title').textContent = 'New Lead';
        $('lead-popup-badges').innerHTML = '';
        $('lead-existing-sections').classList.add('hidden');
        $('timeline-section').classList.add('hidden');
        $('reassign-section').classList.add('hidden');
        $('stage-section').classList.add('hidden');
        $('contact-check').classList.add('hidden');
        $('lead-interest').value = 'Both';
        $('lead-temperature').value = 'Warm';
        $('lead-direction').value = 'Inbound';
        $('lead-save').textContent = 'Create Lead';
        toggleConditionalFields();
        openPanel();
        $('lead-name').focus();
    }
    $('new-lead-btn').addEventListener('click', openNew);

    // ===== Existing lead =====
    async function openLead(id) {
        clearPopupError();
        var res = await apiCall('getLead', { id: id });
        if (res.error) { showToast(res.message || 'Could not open lead.'); return; }
        showLead(res.lead, res.activities, res.linkedSales);
        openPanel();
    }

    function showLead(lead, activities, linkedSales) {
        linkedSales = linkedSales || [];
        currentLead = lead;
        clearPopupError();
        form.reset();
        $('lead-popup-title').textContent = lead.Name;
        $('lead-popup-badges').innerHTML = stagePill(lead.Stage) + ' ' + tempBadge(lead.Temperature) +
            ' <span class="muted small-text">' + lead.AttemptCount + ' attempt' + (lead.AttemptCount === 1 ? '' : 's') + '</span>' +
            (lead.DoNotCall ? ' <span class="dnd-tag">DND</span>' : '');

        $('lead-name').value = lead.Name;
        $('lead-contact').value = lead.Contact;
        $('lead-interest').value = lead.Interest;
        $('lead-temperature').value = lead.Temperature;
        $('lead-direction').value = lead.Direction;
        $('lead-channel').value = lead.Channel;
        $('lead-heard-from').value = lead.HeardFrom || '';
        var stageOptions = lead.Stage === 'Converted' ? ['Converted'] : OPEN_STAGES.concat(['Lost']);
        fillSelect($('lead-stage'), stageOptions);
        $('lead-stage').value = lead.Stage;
        $('lead-lost-reason').value = lead.LostReason || '';
        $('lead-next').value = lead.NextFollowUp || '';
        $('lead-consent').checked = !!lead.Consent;
        $('lead-dnd').checked = !!lead.DoNotCall;
        $('lead-notes').value = lead.Notes || '';
        $('contact-check').classList.add('hidden');
        $('stage-section').classList.remove('hidden');
        $('lead-save').textContent = 'Save Changes';
        toggleConditionalFields();

        var converted = lead.Stage === 'Converted';
        setFormLocked(converted && !canManageAll);
        $('lead-stage').disabled = $('lead-stage').disabled || converted;

        $('lead-existing-sections').classList.remove('hidden');
        $('convert-section').classList.toggle('hidden', converted);
        if (converted) {
            $('convert-section').classList.remove('hidden');
            $('convert-medpass-btn').classList.add('hidden');
            $('convert-pharmacy-btn').classList.add('hidden');
            $('convert-hint').textContent = 'Converted to a ' + lead.ConvertedSaleType + ' sale.';
        } else {
            $('convert-medpass-btn').classList.toggle('hidden', lead.Interest === 'Pharmacy');
            $('convert-pharmacy-btn').classList.toggle('hidden', lead.Interest === 'Medpass');
            var hasPending = function (t) { return linkedSales.some(function (l) { return l.type === t && l.Status === 'Pending'; }); };
            $('convert-medpass-btn').textContent = hasPending('medpass') ? 'Complete Medpass sale' : 'Medpass sale';
            $('convert-pharmacy-btn').textContent = hasPending('pharmacy') ? 'Complete Pharmacy sale' : 'Pharmacy sale';
            var summary = linkedSales.map(function (l) { return l.Type + ': ' + l.Status; }).join(' · ');
            $('convert-hint').textContent = (summary ? 'Linked sales — ' + summary + '. ' : '') +
                'Opens the sale with this customer filled in. The lead is marked Converted when the sale is Completed.';
        }

        $('act-type').value = 'Call';
        $('act-direction').value = 'Outgoing';
        $('act-outcome').value = 'Connected';
        $('act-notes').value = '';
        $('act-next').value = '';
        toggleActivityFields();
        $('dnd-warning').classList.toggle('hidden', !lead.DoNotCall);
        if (lead.DoNotCall) $('act-direction').value = 'Incoming';

        if (canManageAll) {
            $('reassign-section').classList.remove('hidden');
            $('reassign-select').value = String(lead.OwnerEmail);
        }
        renderTimeline(activities);
        $('timeline-section').classList.remove('hidden');

        var url = new URL(window.location.href);
        url.searchParams.set('open', lead.ID);
        history.replaceState(null, '', url);
    }

    function renderTimeline(activities) {
        var ol = $('lead-timeline');
        if (!activities.length) { ol.innerHTML = '<li class="muted">No contact logged yet.</li>'; return; }
        ol.innerHTML = activities.map(function (a) {
            var when = new Date(a.Date);
            var whenText = isNaN(when) ? '' : when.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
            var head = a.Type === 'Note' || a.Type === 'Sale'
                ? '<strong>' + escapeHtml(a.Type === 'Sale' ? 'Sale' : 'Note') + '</strong>'
                : '<strong>' + escapeHtml(a.Type) + '</strong> · ' + escapeHtml(a.Direction === 'Incoming' ? 'customer reached out' : 'we reached out') +
                  ' · <span class="outcome">' + escapeHtml(a.Outcome) + '</span>';
            return '<li class="timeline-item type-' + escapeHtml(String(a.Type).toLowerCase()) + '">' +
                '<div class="timeline-head">' + head + '</div>' +
                (a.Notes ? '<div class="timeline-notes">' + escapeHtml(a.Notes) + '</div>' : '') +
                '<div class="timeline-meta">' + escapeHtml(whenText) + ' · ' + escapeHtml(a.ByName || '') +
                (a.NextFollowUp ? ' · follow up ' + escapeHtml(formatDate(a.NextFollowUp)) : '') + '</div>' +
                '</li>';
        }).join('');
    }

    // ===== Save (create or update) =====
    function formData() {
        var d = {
            name: $('lead-name').value.trim(),
            contact: $('lead-contact').value.trim(),
            interest: $('lead-interest').value,
            temperature: $('lead-temperature').value,
            direction: $('lead-direction').value,
            channel: $('lead-channel').value,
            heardFrom: $('lead-direction').value === 'Inbound' ? $('lead-heard-from').value : '',
            consent: $('lead-consent').checked,
            doNotCall: $('lead-dnd').checked,
            notes: $('lead-notes').value.trim()
        };
        if (currentLead) {
            if (currentLead.Stage !== 'Converted') d.stage = $('lead-stage').value;
            if ($('lead-stage').value === 'Lost') d.lostReason = $('lead-lost-reason').value;
            d.nextFollowUp = $('lead-next').value;
        }
        return d;
    }

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        clearPopupError();
        var d = formData();
        if (!d.channel) { showPopupError('Choose a channel.'); return; }
        if (currentLead && d.stage === 'Lost' && !d.lostReason) { showPopupError('Choose a lost reason.'); return; }
        var btn = $('lead-save');
        btn.disabled = true;
        var res = currentLead
            ? await apiCall('updateLead', { id: currentLead.ID, data: d })
            : await apiCall('createLead', { data: d });
        btn.disabled = false;
        if (res.error) { showPopupError(res.message || 'Could not save lead.'); return; }
        if (currentLead) {
            showToast('Lead updated.', 'success');
            showLead(res.lead, res.activities, res.linkedSales);
        } else {
            showToast('Lead created.', 'success');
            await openLead(res.lead.ID);
        }
        loadLeads();
    });

    // ===== Log a contact =====
    $('log-activity-btn').addEventListener('click', async function () {
        if (!currentLead) return;
        clearPopupError();
        var d = {
            type: $('act-type').value,
            direction: $('act-direction').value,
            outcome: $('act-outcome').value,
            notes: $('act-notes').value.trim(),
            nextFollowUp: $('act-next').value
        };
        var btn = this;
        btn.disabled = true;
        var res = await apiCall('logActivity', { id: currentLead.ID, data: d });
        btn.disabled = false;
        if (res.error) { showPopupError(res.message || 'Could not log contact.'); return; }
        showToast(d.type === 'Note' ? 'Note added.' : 'Contact logged.', 'success');
        showLead(res.lead, res.activities, res.linkedSales);
        loadLeads();
    });

    // ===== Convert =====
    function convert(type) {
        if (!currentLead) return;
        window.location.href = type + '.html?fromLead=' + encodeURIComponent(currentLead.ID);
    }
    $('convert-medpass-btn').addEventListener('click', function () { convert('medpass'); });
    $('convert-pharmacy-btn').addEventListener('click', function () { convert('pharmacy'); });

    // ===== Reassign (managers) =====
    $('reassign-btn').addEventListener('click', async function () {
        if (!currentLead) return;
        var email = $('reassign-select').value;
        if (!email || email.toLowerCase() === String(currentLead.OwnerEmail).toLowerCase()) return;
        var res = await apiCall('reassignLead', { id: currentLead.ID, data: { agentEmail: email } });
        if (res.error) { showPopupError(res.message || 'Could not reassign.'); return; }
        showToast('Lead reassigned to ' + res.lead.OwnerName + '.', 'success');
        showLead(res.lead, res.activities, res.linkedSales);
        loadLeads();
    });

    // ===== Start =====
    (async function init() {
        try {
            await Promise.all([loadLists(), loadRoster()]);
        } catch (err) {
            $('leads-error').querySelector('.inline-error-text').textContent = err.message;
            $('leads-error').classList.remove('hidden');
            return;
        }
        await loadLeads();
        var openId = new URLSearchParams(window.location.search).get('open');
        if (openId) openLead(openId);
    })();
})();
