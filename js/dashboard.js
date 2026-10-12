(function () {
    var user = requireAuth();
    if (!user) return;
    renderLayout('dashboard');

    var params = new URLSearchParams(window.location.search);
    if (params.get('denied') === '1') document.getElementById('denied-banner').classList.remove('hidden');

    var canSeeIncentives = user.role === 'admin' || user.role === 'manager';

    if (user.role === 'agent') {
        document.getElementById('team-title').textContent = 'My Performance';
        document.getElementById('topbar-subtitle').textContent = 'Your sales performance';
    }
    if (!canSeeIncentives) {
        document.getElementById('incentive-chart-card').classList.add('hidden');
        document.getElementById('incentive-column-header').classList.add('hidden');
    }

    var salesChart, incentiveChart;
    var refreshBtn = document.getElementById('refresh-btn');
    var mainEl = document.querySelector('main');

    // Inline error with a Retry button, shown above the KPIs when loading fails.
    var errorBox = document.createElement('div');
    errorBox.className = 'inline-error hidden';
    errorBox.innerHTML = '<span class="inline-error-text"></span><button type="button" class="secondary">Retry</button>';
    errorBox.querySelector('button').addEventListener('click', load);
    mainEl.insertBefore(errorBox, mainEl.querySelector('.kpi-grid'));

    var colCount = canSeeIncentives ? 6 : 5;

    // While loading, show placeholders instead of ₹0 / 0 so nobody mistakes
    // "not loaded yet" for "no sales".
    function setLoading(on) {
        mainEl.classList.toggle('is-loading', on);
        refreshBtn.disabled = on;
        refreshBtn.textContent = on ? 'Refreshing…' : 'Refresh';
        if (!on) return;
        ['total-medpass', 'total-pharmacy', 'total-medpass-amount', 'total-pharmacy-amount'].forEach(function (id) {
            document.getElementById(id).textContent = '…';
        });
        document.getElementById('team-empty').classList.add('hidden');
        document.getElementById('team-table-body').innerHTML =
            '<tr class="loading-row"><td colspan="' + colCount + '">Loading…</td></tr>';
    }

    function showError(message) {
        errorBox.querySelector('.inline-error-text').textContent = message;
        errorBox.classList.remove('hidden');
        ['total-medpass', 'total-pharmacy', 'total-medpass-amount', 'total-pharmacy-amount'].forEach(function (id) {
            document.getElementById(id).textContent = '—';
        });
        document.getElementById('team-table-body').innerHTML =
            '<tr class="loading-row"><td colspan="' + colCount + '">Couldn\'t load data.</td></tr>';
    }

    async function load() {
        errorBox.classList.add('hidden');
        setLoading(true);
        var res = await apiCall('dashboardSummary');
        setLoading(false);
        if (res.error) {
            showError(res.message || 'Could not load the dashboard.');
            return;
        }
        var summary = res.summary;

        document.getElementById('total-medpass').textContent = summary.totals.medpassCount;
        document.getElementById('total-pharmacy').textContent = summary.totals.pharmacyCount;
        document.getElementById('total-medpass-amount').textContent = formatMoney(summary.totals.medpassAmount);
        document.getElementById('total-pharmacy-amount').textContent = formatMoney(summary.totals.pharmacyAmount);

        renderTable(summary.agents);
        renderCharts(summary.agents);
    }

    function renderTable(agents) {
        var tbody = document.getElementById('team-table-body');
        var empty = document.getElementById('team-empty');
        agents = agents.slice().sort(function (a, b) { return (b.medpassCount + b.pharmacyCount) - (a.medpassCount + a.pharmacyCount); });

        if (agents.length === 0) {
            tbody.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        tbody.innerHTML = agents.map(function (a) {
            return '<tr>' +
                '<td>' + avatarHtml(a.agentName) + '</td>' +
                '<td>' + a.medpassCount + '</td>' +
                '<td>' + a.pharmacyCount + '</td>' +
                '<td>' + formatMoney(a.medpassAmount) + '</td>' +
                '<td>' + formatMoney(a.pharmacyAmount) + '</td>' +
                (canSeeIncentives ? '<td><strong>' + formatMoney(a.incentive) + '</strong></td>' : '') +
                '</tr>';
        }).join('');
    }

    function renderCharts(agents) {
        var labels = agents.map(function (a) { return a.agentName; });

        var salesCtx = document.getElementById('salesChart');
        if (salesChart) salesChart.destroy();
        salesChart = new Chart(salesCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    { label: 'Medpass', data: agents.map(function (a) { return a.medpassCount; }), backgroundColor: '#2563eb' },
                    { label: 'Pharmacy', data: agents.map(function (a) { return a.pharmacyCount; }), backgroundColor: '#10b981' }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
        });

        if (canSeeIncentives) {
            var incCtx = document.getElementById('incentiveChart');
            if (incentiveChart) incentiveChart.destroy();
            incentiveChart = new Chart(incCtx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{ label: 'Incentive', data: agents.map(function (a) { return a.incentive; }), backgroundColor: '#f59e0b' }]
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
            });
        }
    }

    refreshBtn.addEventListener('click', load);
    load();
})();
