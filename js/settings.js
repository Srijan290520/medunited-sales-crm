(function () {
    var user = requireAuth(['admin', 'manager']);
    if (!user) return;
    renderLayout('settings');

    var errorBox = document.getElementById('settings-error');
    var agentIds = [];

    async function saveRates(id, medpassFullRate, medpassDiscountRate, pharmacyIncentivePercent) {
        return apiCall('updateIncentives', {
            id: id,
            data: {
                medpassFullRate: medpassFullRate,
                medpassDiscountRate: medpassDiscountRate,
                pharmacyIncentivePercent: pharmacyIncentivePercent
            }
        });
    }

    document.getElementById('bulk-apply-btn').addEventListener('click', async function () {
        if (agentIds.length === 0) return;
        var medpassFullRate = document.getElementById('bulk-medpass-full').value;
        var medpassDiscountRate = document.getElementById('bulk-medpass-discount').value;
        var pharmacyIncentivePercent = document.getElementById('bulk-pharmacy-percent').value;

        if (medpassFullRate === '' && medpassDiscountRate === '' && pharmacyIncentivePercent === '') {
            showToast('Enter at least one rate to apply.');
            return;
        }
        if (!confirm('Apply these rates to all ' + agentIds.length + ' agent(s)? This overwrites their current rates.')) return;

        var btn = document.getElementById('bulk-apply-btn');
        btn.disabled = true;
        btn.textContent = 'Applying…';

        var data = {};
        if (medpassFullRate !== '') data.medpassFullRate = medpassFullRate;
        if (medpassDiscountRate !== '') data.medpassDiscountRate = medpassDiscountRate;
        if (pharmacyIncentivePercent !== '') data.pharmacyIncentivePercent = pharmacyIncentivePercent;

        var failed = 0;
        for (var i = 0; i < agentIds.length; i++) {
            var res = await apiCall('updateIncentives', { id: agentIds[i], data: data });
            if (res.error) failed++;
        }

        btn.disabled = false;
        btn.textContent = 'Apply to All Agents';

        if (failed > 0) {
            showToast('Applied, but ' + failed + ' agent(s) failed to update.');
        }
        load();
    });

    async function load() {
        var res = await apiCall('listUsers');
        var tbody = document.getElementById('rates-table-body');
        var empty = document.getElementById('rates-empty');

        if (res.error) {
            errorBox.textContent = res.message || 'Could not load users.';
            errorBox.classList.add('show');
            return;
        }

        var agents = res.users.filter(function (u) { return u.Role === 'agent'; });
        agentIds = agents.map(function (a) { return a.ID; });

        if (agents.length === 0) {
            tbody.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        tbody.innerHTML = agents.map(function (a) {
            return '<tr data-id="' + a.ID + '">' +
                '<td>' + avatarHtml(a.Name) + '</td>' +
                '<td><input type="number" min="0" step="0.01" class="medpass-full-rate" value="' + a.MedpassFullRate + '"></td>' +
                '<td><input type="number" min="0" step="0.01" class="medpass-discount-rate" value="' + a.MedpassDiscountRate + '"></td>' +
                '<td><input type="number" min="0" max="100" step="0.1" class="pharmacy-percent" value="' + a.PharmacyIncentivePercent + '"></td>' +
                '<td><button type="button" class="save-rate-btn">Save</button></td>' +
                '</tr>';
        }).join('');

        Array.prototype.forEach.call(tbody.querySelectorAll('.save-rate-btn'), function (btn) {
            btn.addEventListener('click', async function () {
                var row = btn.closest('tr');
                var id = row.dataset.id;
                var medpassFullRate = row.querySelector('.medpass-full-rate').value;
                var medpassDiscountRate = row.querySelector('.medpass-discount-rate').value;
                var pharmacyIncentivePercent = row.querySelector('.pharmacy-percent').value;

                btn.disabled = true;
                btn.textContent = 'Saving…';
                var res = await saveRates(id, medpassFullRate, medpassDiscountRate, pharmacyIncentivePercent);
                btn.disabled = false;
                btn.textContent = 'Save';

                if (res.error) {
                    showToast(res.message || 'Could not update incentive.');
                    return;
                }
                btn.textContent = 'Saved ✓';
                setTimeout(function () { btn.textContent = 'Save'; }, 1500);
            });
        });
    }

    load();
})();
