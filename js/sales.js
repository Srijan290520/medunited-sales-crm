(function () {
    var user = requireAuth();
    if (!user) return;
    renderLayout(SALE_TYPE);

    document.getElementById('page-title').textContent =
        SALE_LABEL + (SALE_TYPE === 'pharmacy' ? ' (Home Delivery) Sales' : ' Sales');
    document.getElementById('detail-header').textContent = DETAIL_LABEL;
    document.getElementById('detail-label').textContent = DETAIL_LABEL;
    document.getElementById('popup-title').textContent = 'New ' + SALE_LABEL + ' Sale';

    var overlay = document.getElementById('overlay');
    var popup = document.getElementById('sale-popup');
    var form = document.getElementById('sale-form');
    var errorBox = document.getElementById('popup-error');
    var canManageAll = user.role === 'admin' || user.role === 'manager';

    var today = new Date().toISOString().slice(0, 10);
    var MAX_FILE_BYTES = 5 * 1024 * 1024;
    var STATUS_COLUMNS = ['Pending', 'Completed', 'Cancelled'];

    // Tracks screenshots already on file for the sale being edited, so a
    // user isn't forced to re-upload an image just to change the status.
    var currentBillUrl = '';
    var currentPaymentUrl = '';

    var allSales = [];  // raw, unfiltered, straight from the server
    var lastSales = []; // currently filtered + rendered set (what click/drag handlers look up)

    // ===== View toggle (Board / Table) =====
    var VIEW_KEY = 'medunited_view_' + SALE_TYPE;
    var viewMode = localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'board';

    function applyView() {
        document.getElementById('kanban-board').classList.toggle('hidden', viewMode !== 'board');
        document.getElementById('table-view').classList.toggle('hidden', viewMode !== 'table');
        document.getElementById('view-board-btn').classList.toggle('active', viewMode === 'board');
        document.getElementById('view-table-btn').classList.toggle('active', viewMode === 'table');
    }

    document.getElementById('view-board-btn').addEventListener('click', function () {
        viewMode = 'board';
        localStorage.setItem(VIEW_KEY, viewMode);
        applyView();
    });
    document.getElementById('view-table-btn').addEventListener('click', function () {
        viewMode = 'table';
        localStorage.setItem(VIEW_KEY, viewMode);
        applyView();
    });
    applyView();

    var priceTypeField = document.getElementById('sale-price-type'); // only present on medpass.html

    // ===== Search + filters =====
    var searchInput = document.getElementById('filter-search');
    var agentFilter = document.getElementById('filter-agent');
    var statusFilter = document.getElementById('filter-status');
    var paymentFilter = document.getElementById('filter-payment');
    var priceTypeFilter = document.getElementById('filter-price-type'); // only present on medpass.html

    function populateAgentFilter(sales) {
        if (!canManageAll) return; // agents only ever see their own sales — filtering by agent is pointless
        var current = agentFilter.value;
        var seen = {};
        var options = ['<option value="">All Agents</option>'];
        sales.forEach(function (s) {
            var key = String(s.AgentEmail).toLowerCase();
            if (seen[key]) return;
            seen[key] = true;
            options.push('<option value="' + escapeHtml(key) + '">' + escapeHtml(s.AgentName) + '</option>');
        });
        agentFilter.innerHTML = options.join('');
        agentFilter.classList.remove('hidden');
        if (seen[current]) agentFilter.value = current;
    }

    function applyFilters(sales) {
        var q = searchInput.value.trim().toLowerCase();
        var agent = agentFilter.value;
        var status = statusFilter.value;
        var payment = paymentFilter.value;
        var priceType = priceTypeFilter ? priceTypeFilter.value : '';

        return sales.filter(function (s) {
            if (q) {
                var haystack = (String(s.CustomerName || '') + ' ' + String(s.Contact || '') + ' ' + String(s.Detail || '')).toLowerCase();
                if (haystack.indexOf(q) === -1) return false;
            }
            if (agent && String(s.AgentEmail).toLowerCase() !== agent) return false;
            if (status && s.Status !== status) return false;
            if (payment) {
                if (payment === '__none__') { if (s.PaymentMethod) return false; }
                else if (s.PaymentMethod !== payment) return false;
            }
            if (priceType && s.PriceType !== priceType) return false;
            return true;
        });
    }

    function hasActiveFilters() {
        return !!(searchInput.value.trim() || agentFilter.value || statusFilter.value || paymentFilter.value || (priceTypeFilter && priceTypeFilter.value));
    }

    function renderAll() {
        lastSales = applyFilters(allSales);
        renderTable(lastSales);
        renderBoard(lastSales);
    }

    searchInput.addEventListener('input', renderAll);
    agentFilter.addEventListener('change', renderAll);
    statusFilter.addEventListener('change', renderAll);
    paymentFilter.addEventListener('change', renderAll);
    if (priceTypeFilter) priceTypeFilter.addEventListener('change', renderAll);

    document.getElementById('filter-clear-btn').addEventListener('click', function () {
        searchInput.value = '';
        agentFilter.value = '';
        statusFilter.value = '';
        paymentFilter.value = '';
        if (priceTypeFilter) priceTypeFilter.value = '';
        renderAll();
    });

    function toggleUtrField() {
        var isUpi = document.getElementById('sale-payment-method').value === 'UPI';
        document.getElementById('utr-field').classList.toggle('hidden', !isUpi);
    }
    document.getElementById('sale-payment-method').addEventListener('change', toggleUtrField);

    function renderAttachmentPreview(elId, url) {
        var el = document.getElementById(elId);
        if (url) {
            el.innerHTML = '<a href="' + url + '" target="_blank" rel="noopener">View current file</a> (choose a new file below to replace it)';
            el.classList.remove('hidden');
        } else {
            el.innerHTML = '';
            el.classList.add('hidden');
        }
    }

    function openPopup(sale, presetStatus) {
        errorBox.classList.remove('show');
        form.reset();
        document.getElementById('sale-id').value = sale ? sale.ID : '';
        document.getElementById('popup-title').textContent = sale ? ('Edit ' + SALE_LABEL + ' Sale') : ('New ' + SALE_LABEL + ' Sale');
        document.getElementById('sale-date').value = sale ? String(sale.Date).slice(0, 10) : today;
        document.getElementById('sale-customer').value = sale ? sale.CustomerName : '';
        document.getElementById('sale-contact').value = sale ? sale.Contact : '';
        document.getElementById('sale-detail').value = sale ? sale.Detail : '';
        document.getElementById('sale-amount').value = sale ? sale.Amount : '';
        if (priceTypeField) priceTypeField.value = sale ? (sale.PriceType || '') : '';
        document.getElementById('sale-status').value = presetStatus || (sale ? sale.Status : 'Pending');
        document.getElementById('sale-payment-method').value = sale ? (sale.PaymentMethod || '') : '';
        document.getElementById('sale-utr').value = sale ? (sale.UTR || '') : '';
        document.getElementById('sale-notes').value = sale ? sale.Notes : '';

        currentBillUrl = sale ? (sale.BillScreenshotUrl || '') : '';
        currentPaymentUrl = sale ? (sale.PaymentScreenshotUrl || '') : '';
        renderAttachmentPreview('bill-current', currentBillUrl);
        renderAttachmentPreview('payment-current', currentPaymentUrl);
        toggleUtrField();

        overlay.classList.add('open');
        popup.classList.add('open');
    }

    function closePopup() {
        overlay.classList.remove('open');
        popup.classList.remove('open');
    }

    document.getElementById('new-sale-btn').addEventListener('click', function () { openPopup(null); });
    document.getElementById('popup-cancel').addEventListener('click', closePopup);
    overlay.addEventListener('click', closePopup);

    function fileToDataUrl(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = function () { reject(new Error('Could not read file.')); };
            reader.readAsDataURL(file);
        });
    }

    function showFormError(message) {
        errorBox.textContent = message;
        errorBox.classList.add('show');
    }

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        errorBox.classList.remove('show');

        var id = document.getElementById('sale-id').value;
        var status = document.getElementById('sale-status').value;
        var paymentMethod = document.getElementById('sale-payment-method').value;
        var utr = document.getElementById('sale-utr').value.trim();
        var billFile = document.getElementById('sale-bill-screenshot').files[0];
        var paymentFile = document.getElementById('sale-payment-screenshot').files[0];

        if (billFile && billFile.size > MAX_FILE_BYTES) { showFormError('Bill screenshot is too large (max 5MB).'); return; }
        if (paymentFile && paymentFile.size > MAX_FILE_BYTES) { showFormError('Payment screenshot is too large (max 5MB).'); return; }

        var priceType = priceTypeField ? priceTypeField.value : '';
        if (priceTypeField && !priceType) { showFormError('Price type (Full Price or Discounted) is required.'); return; }

        // Client-side pre-check, mirroring the server rule, for a fast error
        // message — the server enforces this for real regardless.
        if (status === 'Completed') {
            var hasBill = !!billFile || !!currentBillUrl;
            var hasPayment = !!paymentFile || !!currentPaymentUrl;
            if (!paymentMethod) { showFormError('Payment method is required to mark this sale as Completed.'); return; }
            if (!hasBill) { showFormError('A bill screenshot is required to mark this sale as Completed.'); return; }
            if (!hasPayment) { showFormError('A payment screenshot is required to mark this sale as Completed.'); return; }
            if (paymentMethod === 'UPI' && !utr) { showFormError('UTR number is required for UPI payments.'); return; }
        }

        var saveBtn = document.getElementById('popup-save');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';

        var payload = {
            date: document.getElementById('sale-date').value,
            customerName: document.getElementById('sale-customer').value.trim(),
            contact: document.getElementById('sale-contact').value.trim(),
            detail: document.getElementById('sale-detail').value.trim(),
            amount: document.getElementById('sale-amount').value,
            priceType: priceType,
            status: status,
            paymentMethod: paymentMethod,
            utr: utr,
            notes: document.getElementById('sale-notes').value.trim()
        };

        try {
            if (billFile) payload.billScreenshot = await fileToDataUrl(billFile);
            if (paymentFile) payload.paymentScreenshot = await fileToDataUrl(paymentFile);
        } catch (err) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Sale';
            showFormError('Could not read the selected file(s). Please try again.');
            return;
        }

        var res = id
            ? await apiCall('updateSale', { type: SALE_TYPE, id: id, data: payload })
            : await apiCall('createSale', { type: SALE_TYPE, data: payload });

        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Sale';

        if (res.error) {
            showFormError(res.message || 'Could not save sale.');
            return;
        }

        closePopup();
        load();
    });

    async function deleteSale(id) {
        if (!confirm('Delete this sale entry? This cannot be undone.')) return;
        var res = await apiCall('deleteSale', { type: SALE_TYPE, id: id });
        if (res.error) { alert(res.message || 'Could not delete sale.'); return; }
        load();
    }

    function statusClass(status) {
        return String(status || '').toLowerCase();
    }

    function paymentCell(s) {
        if (!s.PaymentMethod) return '<span style="color:var(--text-muted);">—</span>';
        var html = escapeHtml(s.PaymentMethod);
        if (s.PaymentMethod === 'UPI' && s.UTR) {
            html += '<br><small style="color:var(--text-muted);">UTR: ' + escapeHtml(s.UTR) + '</small>';
        }
        return html;
    }

    function priceTypeCell(s) {
        if (!s.PriceType) return '<span style="color:var(--text-muted);">—</span>';
        return escapeHtml(s.PriceType);
    }

    function proofCell(s) {
        var bill = s.BillScreenshotUrl
            ? '<a class="proof-link" href="' + s.BillScreenshotUrl + '" target="_blank" rel="noopener">Bill</a>'
            : '<span class="proof-link disabled">Bill</span>';
        var payment = s.PaymentScreenshotUrl
            ? '<a class="proof-link" href="' + s.PaymentScreenshotUrl + '" target="_blank" rel="noopener">Payment</a>'
            : '<span class="proof-link disabled">Payment</span>';
        return '<div class="row-actions">' + bill + payment + '</div>';
    }

    function canEditSale(s) {
        var isOwner = String(s.AgentEmail).toLowerCase() === String(user.email).toLowerCase();
        return canManageAll || isOwner;
    }

    function renderTable(sales) {
        var tbody = document.getElementById('sales-table-body');
        var empty = document.getElementById('sales-empty');

        if (sales.length === 0) {
            tbody.innerHTML = '';
            empty.textContent = hasActiveFilters()
                ? 'No sales match your search/filters.'
                : 'No sales recorded yet. Click "New Sale" to add one.';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        tbody.innerHTML = sales.map(function (s) {
            var actions = '';
            if (canEditSale(s)) actions += '<button type="button" class="secondary edit-btn" data-id="' + s.ID + '">Edit</button>';
            if (canManageAll) actions += '<button type="button" class="danger delete-btn" data-id="' + s.ID + '">Delete</button>';

            return '<tr>' +
                '<td>' + formatDate(s.Date) + '</td>' +
                '<td>' + avatarHtml(s.AgentName) + '</td>' +
                '<td>' + escapeHtml(s.CustomerName) + '</td>' +
                '<td>' + escapeHtml(s.Contact) + '</td>' +
                '<td>' + escapeHtml(s.Detail) + '</td>' +
                '<td>' + formatMoney(s.Amount) + '</td>' +
                (priceTypeField ? '<td>' + priceTypeCell(s) + '</td>' : '') +
                '<td><span class="status-pill ' + statusClass(s.Status) + '">' + escapeHtml(s.Status) + '</span></td>' +
                '<td>' + paymentCell(s) + '</td>' +
                '<td>' + proofCell(s) + '</td>' +
                '<td class="row-actions">' + actions + '</td>' +
                '</tr>';
        }).join('');

        Array.prototype.forEach.call(tbody.querySelectorAll('.edit-btn'), function (btn) {
            btn.addEventListener('click', function () {
                var sale = lastSales.find(function (s) { return s.ID === btn.dataset.id; });
                if (sale) openPopup(sale);
            });
        });
        Array.prototype.forEach.call(tbody.querySelectorAll('.delete-btn'), function (btn) {
            btn.addEventListener('click', function () { deleteSale(btn.dataset.id); });
        });
    }

    function isReadyToComplete(sale) {
        return !!sale.PaymentMethod && !!sale.BillScreenshotUrl && !!sale.PaymentScreenshotUrl &&
            (sale.PaymentMethod !== 'UPI' || !!sale.UTR);
    }

    function cardHtml(sale) {
        var proofDots = '<div class="kanban-proof-dots">' +
            '<span class="proof-dot' + (sale.BillScreenshotUrl ? ' attached' : '') + '" title="Bill screenshot"></span>' +
            '<span class="proof-dot' + (sale.PaymentScreenshotUrl ? ' attached' : '') + '" title="Payment screenshot"></span>' +
            '</div>';

        var priceTag = (priceTypeField && sale.PriceType)
            ? ' <span class="kanban-payment-tag" style="margin-left:4px;">' + escapeHtml(sale.PriceType) + '</span>'
            : '';

        return '<div class="kanban-card" draggable="' + (canEditSale(sale) ? 'true' : 'false') + '" data-id="' + sale.ID + '">' +
            '<div class="kanban-card-top"><span class="kanban-amount">' + formatMoney(sale.Amount) + '</span>' + proofDots + '</div>' +
            '<div class="kanban-customer">' + escapeHtml(sale.CustomerName) + '</div>' +
            '<div class="kanban-detail">' + escapeHtml(sale.Detail || '—') + priceTag + '</div>' +
            '<div class="kanban-card-footer">' + avatarHtml(sale.AgentName) +
            '<span class="kanban-payment-tag">' + (sale.PaymentMethod ? escapeHtml(sale.PaymentMethod) : '') + '</span>' +
            '</div></div>';
    }

    function renderBoard(sales) {
        var board = document.getElementById('kanban-board');

        board.innerHTML = STATUS_COLUMNS.map(function (status) {
            var items = sales.filter(function (s) { return s.Status === status; });
            var emptyMsg = hasActiveFilters() ? 'No matches' : 'No sales here';
            var cardsHtml = items.length ? items.map(cardHtml).join('') : '<div class="kanban-empty-col">' + emptyMsg + '</div>';
            return '<div class="kanban-column">' +
                '<div class="kanban-column-header"><span class="dot ' + status.toLowerCase() + '"></span>' + status +
                '<span class="count">' + items.length + '</span></div>' +
                '<div class="kanban-column-body" data-status="' + status + '">' + cardsHtml + '</div>' +
                '</div>';
        }).join('');

        Array.prototype.forEach.call(board.querySelectorAll('.kanban-card'), function (card) {
            card.addEventListener('click', function () {
                var sale = lastSales.find(function (s) { return s.ID === card.dataset.id; });
                if (sale) openPopup(sale);
            });
            card.addEventListener('dragstart', function (e) {
                e.dataTransfer.setData('text/plain', card.dataset.id);
                e.dataTransfer.effectAllowed = 'move';
                card.classList.add('dragging');
            });
            card.addEventListener('dragend', function () {
                card.classList.remove('dragging');
            });
        });

        Array.prototype.forEach.call(board.querySelectorAll('.kanban-column-body'), function (col) {
            col.addEventListener('dragover', function (e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                col.classList.add('drag-over');
            });
            col.addEventListener('dragleave', function () {
                col.classList.remove('drag-over');
            });
            col.addEventListener('drop', function (e) {
                e.preventDefault();
                col.classList.remove('drag-over');
                var id = e.dataTransfer.getData('text/plain');
                handleDrop(id, col.dataset.status);
            });
        });
    }

    async function handleDrop(id, newStatus) {
        var sale = lastSales.find(function (s) { return s.ID === id; });
        if (!sale || sale.Status === newStatus || !canEditSale(sale)) return;

        if (newStatus === 'Completed' && !isReadyToComplete(sale)) {
            // Missing payment proof — open the edit panel pre-set to Completed
            // instead of silently rejecting the drop.
            openPopup(sale, 'Completed');
            showFormError('Add the missing payment details below, then save to mark this sale Completed.');
            return;
        }

        var res = await apiCall('updateSale', { type: SALE_TYPE, id: id, data: { status: newStatus } });
        if (res.error) alert(res.message || 'Could not update status.');
        load();
    }

    async function load() {
        var res = await apiCall('listSales', { type: SALE_TYPE });

        if (res.error) {
            allSales = [];
            lastSales = [];
            document.getElementById('sales-table-body').innerHTML = '';
            var errEmpty = document.getElementById('sales-empty');
            errEmpty.textContent = res.message || 'Could not load sales.';
            errEmpty.classList.remove('hidden');
            document.getElementById('kanban-board').innerHTML = '<p class="empty-state">' + escapeHtml(res.message || 'Could not load sales.') + '</p>';
            return;
        }

        allSales = res.sales || [];
        populateAgentFilter(allSales);
        renderAll();
    }

    load();
})();
