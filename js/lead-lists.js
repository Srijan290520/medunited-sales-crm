// lead-lists.js — admin-only editor for the Leads page dropdowns
// (channels, how they heard about us, lost reasons). Lives on settings.html.
(function () {
    var user = getCurrentUser();
    if (!user || user.role !== 'admin') return;

    var card = document.getElementById('lead-lists-card');
    var fields = { channels: 'list-channels', heardFrom: 'list-heard-from', lostReasons: 'list-lost-reasons' };

    function toLines(arr) { return (arr || []).join('\n'); }
    function fromLines(text) { return text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); }

    async function load() {
        var res = await apiCall('getLists');
        if (res.error) { showToast(res.message || 'Could not load lead options.'); return; }
        Object.keys(fields).forEach(function (k) { document.getElementById(fields[k]).value = toLines(res.lists[k]); });
        card.classList.remove('hidden');
    }

    document.getElementById('save-lists-btn').addEventListener('click', async function () {
        var data = {};
        Object.keys(fields).forEach(function (k) { data[k] = fromLines(document.getElementById(fields[k]).value); });
        var btn = this;
        btn.disabled = true;
        var res = await apiCall('updateLists', { data: data });
        btn.disabled = false;
        if (res.error) { showToast(res.message || 'Could not save options.'); return; }
        Object.keys(fields).forEach(function (k) { document.getElementById(fields[k]).value = toLines(res.lists[k]); });
        showToast('Lead options saved.', 'success');
    });

    load();
})();
