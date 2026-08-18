(function () {
    var user = requireAuth(['admin', 'manager']);
    if (!user) return;
    renderLayout('settings');

    var errorBox = document.getElementById('settings-error');

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
        if (agents.length === 0) {
            tbody.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        tbody.innerHTML = agents.map(function (a) {
            return '<tr data-id="' + a.ID + '">' +
                '<td>' + avatarHtml(a.Name) + '</td>' +
                '<td>' + escapeHtml(a.Email) + '</td>' +
                '<td><input type="number" min="0" step="0.01" class="medpass-rate" value="' + a.MedpassIncentive + '"></td>' +
                '<td><input type="number" min="0" step="0.01" class="pharmacy-rate" value="' + a.PharmacyIncentive + '"></td>' +
                '<td><button type="button" class="save-rate-btn">Save</button></td>' +
                '</tr>';
        }).join('');

        Array.prototype.forEach.call(tbody.querySelectorAll('.save-rate-btn'), function (btn) {
            btn.addEventListener('click', async function () {
                var row = btn.closest('tr');
                var id = row.dataset.id;
                var medpassIncentive = row.querySelector('.medpass-rate').value;
                var pharmacyIncentive = row.querySelector('.pharmacy-rate').value;

                btn.disabled = true;
                btn.textContent = 'Saving…';
                var res = await apiCall('updateIncentives', { id: id, data: { medpassIncentive: medpassIncentive, pharmacyIncentive: pharmacyIncentive } });
                btn.disabled = false;
                btn.textContent = 'Save';

                if (res.error) {
                    alert(res.message || 'Could not update incentive.');
                    return;
                }
                btn.textContent = 'Saved ✓';
                setTimeout(function () { btn.textContent = 'Save'; }, 1500);
            });
        });
    }

    load();
})();
