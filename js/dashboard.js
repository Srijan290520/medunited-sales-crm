(function () {
    var user = requireAuth();
    if (!user) return;
    renderLayout('dashboard');

    var params = new URLSearchParams(window.location.search);
    if (params.get('denied') === '1') document.getElementById('denied-banner').classList.remove('hidden');

    if (user.role === 'agent') {
        document.getElementById('team-title').textContent = 'My Performance';
        document.getElementById('topbar-subtitle').textContent = 'Your sales performance';
    }

    var salesChart, incentiveChart;

    async function load() {
        var res = await apiCall('dashboardSummary');
        if (res.error) {
            alert(res.message || 'Could not load dashboard.');
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
                '<td><strong>' + formatMoney(a.incentive) + '</strong></td>' +
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

    document.getElementById('refresh-btn').addEventListener('click', load);
    load();
})();
