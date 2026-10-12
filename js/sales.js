(function () {
    var user = requireAuth();
    if (!user) return;
    renderLayout(SALE_TYPE);

    document.getElementById('page-title').textContent =
        SALE_LABEL + (SALE_TYPE === 'pharmacy' ? ' (Home Delivery) Sales' : ' Sales');
    document.getElementById('detail-header').textContent = DETAIL_LABEL;
    var detailLabelEl = document.getElementById('detail-label'); // not present on pharmacy.html (uses product lines instead)
    if (detailLabelEl) detailLabelEl.textContent = DETAIL_LABEL;
    document.getElementById('popup-title').textContent = 'New ' + SALE_LABEL + ' Sale';

    var overlay = document.getElementById('overlay');
    var popup = document.getElementById('sale-popup');
    var form = document.getElementById('sale-form');
    var errorBox = document.getElementById('popup-error');
    var canManageAll = user.role === 'admin' || user.role === 'manager';

    var today = localDateKey(); // browser's own date, not UTC
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

    // ===== Status segmented control =====
    var statusHiddenInput = document.getElementById('sale-status');
    var statusSegments = document.querySelectorAll('#status-segmented .segment');

    function setStatusValue(value) {
        statusHiddenInput.value = value;
        Array.prototype.forEach.call(statusSegments, function (btn) {
            btn.classList.toggle('active', btn.dataset.value === value);
        });
    }
    Array.prototype.forEach.call(statusSegments, function (btn) {
        btn.addEventListener('click', function () { setStatusValue(btn.dataset.value); });
    });

    // ===== Viewing screenshots =====
    // Screenshots are private in Drive, so they're fetched through the
    // backend (which checks this user may see the sale) and shown in a new
    // tab. The tab is opened synchronously on click so popup blockers allow it.
    async function viewAttachment(saleId, kind) {
        var win = window.open('', '_blank');
        if (win) win.document.write('<p style="font-family:sans-serif;padding:24px;">Loading screenshot…</p>');

        var res = await apiCall('getAttachment', { type: SALE_TYPE, id: saleId, kind: kind });
        if (res.error) {
            if (win) win.close();
            showToast(res.message || 'Could not load the screenshot.');
            return;
        }
        if (!win) { showToast('Please allow pop-ups for this site to view screenshots.'); return; }

        var doc = win.document;
        doc.open();
        doc.write('<!DOCTYPE html><title></title><body style="margin:0;background:#111;display:flex;justify-content:center;"></body>');
        doc.close();
        doc.title = res.attachment.name;
        var img = doc.createElement('img');
        img.src = res.attachment.dataUrl;
        img.alt = res.attachment.name;
        img.style.maxWidth = '100%';
        doc.body.appendChild(img);
    }

    // ===== Drag-and-drop upload cards (bill / payment screenshots) =====
    function setUploadState(prefix, opts) {
        opts = opts || {};
        var card = document.getElementById(prefix + '-upload-card');
        var labelEl = document.getElementById(prefix + '-upload-label');
        var hintEl = document.getElementById(prefix + '-upload-hint');
        var linkEl = document.getElementById(prefix + '-upload-link');
        var defaultLabel = prefix === 'bill' ? 'Bill Screenshot' : 'Payment Screenshot';

        if (opts.fileName) {
            card.classList.add('has-file');
            labelEl.textContent = opts.fileName;
            hintEl.textContent = 'New file selected — will replace on save';
            linkEl.classList.add('hidden');
        } else if (opts.existingUrl) {
            card.classList.add('has-file');
            labelEl.textContent = defaultLabel + ' attached';
            hintEl.textContent = 'Click or drag to replace';
            linkEl.href = '#';
            linkEl.classList.remove('hidden');
        } else {
            card.classList.remove('has-file');
            labelEl.textContent = defaultLabel;
            hintEl.textContent = 'Click or drag image (max 5MB)';
            linkEl.classList.add('hidden');
        }
    }

    function initUploadCard(prefix) {
        var card = document.getElementById(prefix + '-upload-card');
        var dropzone = card.querySelector('.upload-dropzone');
        var input = document.getElementById('sale-' + prefix + '-screenshot');
        var linkEl = document.getElementById(prefix + '-upload-link');

        linkEl.removeAttribute('target');
        linkEl.addEventListener('click', function (e) {
            e.preventDefault();
            var saleId = document.getElementById('sale-id').value;
            if (saleId) viewAttachment(saleId, prefix);
        });

        input.addEventListener('change', function () {
            var file = input.files[0];
            setUploadState(prefix, file ? { fileName: file.name } : { existingUrl: prefix === 'bill' ? currentBillUrl : currentPaymentUrl });
        });

        ['dragenter', 'dragover'].forEach(function (evt) {
            dropzone.addEventListener(evt, function (e) { e.preventDefault(); card.classList.add('drag-over'); });
        });
        ['dragleave', 'drop'].forEach(function (evt) {
            dropzone.addEventListener(evt, function (e) { e.preventDefault(); card.classList.remove('drag-over'); });
        });
        dropzone.addEventListener('drop', function (e) {
            if (e.dataTransfer.files && e.dataTransfer.files.length) {
                input.files = e.dataTransfer.files;
                input.dispatchEvent(new Event('change'));
            }
        });
    }
    initUploadCard('bill');
    initUploadCard('payment');

    // ===== Pharmacy product line-items (name / quantity / per dose / frequency) =====
    var productLinesContainer = document.getElementById('product-lines'); // only present on pharmacy.html
    var FREQUENCY_OPTIONS = ['Once a day', 'Twice a day', 'Thrice a day'];

    function productLineRowHtml(product) {
        product = product || {};
        var freqOptions = FREQUENCY_OPTIONS.map(function (f) {
            return '<option value="' + f + '"' + (product.frequency === f ? ' selected' : '') + '>' + f + '</option>';
        }).join('');
        return '<div class="product-line">' +
            '<input type="text" class="product-name" placeholder="e.g. Paracetamol" value="' + escapeHtml(product.name || '') + '">' +
            '<input type="number" class="product-qty" placeholder="Qty" min="1" step="1" value="' + (product.quantity || '') + '">' +
            '<input type="number" class="product-per-dose" placeholder="1" min="0.5" step="0.5" title="Units taken each time (e.g. 2 tablets)" value="' + (product.unitsPerDose || 1) + '">' +
            '<select class="product-frequency">' + freqOptions + '</select>' +
            '<button type="button" class="product-remove-btn" aria-label="Remove product">&times;</button>' +
            '</div>';
    }

    function wireProductLineButtons() {
        Array.prototype.forEach.call(productLinesContainer.querySelectorAll('.product-line'), function (row) {
            row.querySelector('.product-remove-btn').onclick = function () {
                if (productLinesContainer.querySelectorAll('.product-line').length <= 1) {
                    row.querySelector('.product-name').value = '';
                    row.querySelector('.product-qty').value = '';
                    row.querySelector('.product-per-dose').value = 1;
                    return;
                }
                row.remove();
            };
        });
    }

    function renderProductLines(products) {
        if (!productLinesContainer) return;
        if (!products || products.length === 0) products = [{}];
        productLinesContainer.innerHTML = products.map(productLineRowHtml).join('');
        wireProductLineButtons();
    }

    function parseProducts(json) {
        try { return JSON.parse(json || '[]'); } catch (e) { return []; }
    }

    function getProductsFromForm() {
        if (!productLinesContainer) return [];
        var products = [];
        Array.prototype.forEach.call(productLinesContainer.querySelectorAll('.product-line'), function (row) {
            var name = row.querySelector('.product-name').value.trim();
            var qty = row.querySelector('.product-qty').value;
            var frequency = row.querySelector('.product-frequency').value;
            var perDose = row.querySelector('.product-per-dose').value || 1;
            if (name || qty) products.push({ name: name, quantity: qty, frequency: frequency, unitsPerDose: perDose });
        });
        return products;
    }

    if (productLinesContainer) {
        document.getElementById('add-product-btn').addEventListener('click', function () {
            productLinesContainer.insertAdjacentHTML('beforeend', productLineRowHtml());
            wireProductLineButtons();
        });
    }

    // Shown above the form when the sale can't be edited (e.g. an agent
    // opening a Completed sale, which only managers can change).
    var lockNote = document.createElement('div');
    lockNote.className = 'form-error';
    lockNote.style.cssText = 'background:#eff6ff;color:#1e40af;margin-bottom:16px;';
    form.insertBefore(lockNote, form.firstChild);

    function setPopupLocked(locked) {
        lockNote.textContent = locked ? 'This sale is Completed and locked. Ask a manager if something needs to change.' : '';
        lockNote.classList.toggle('show', locked);
        document.getElementById('popup-save').classList.toggle('hidden', locked);
        Array.prototype.forEach.call(form.querySelectorAll('input, select, textarea, button'), function (el) {
            el.disabled = locked;
        });
    }

    function openPopup(sale, presetStatus) {
        errorBox.classList.remove('show');
        setPopupLocked(false);
        form.reset();
        document.getElementById('sale-id').value = sale ? sale.ID : '';
        document.getElementById('popup-title').textContent = sale ? ('Edit ' + SALE_LABEL + ' Sale') : ('New ' + SALE_LABEL + ' Sale');
        document.getElementById('sale-date').value = sale ? String(sale.Date).slice(0, 10) : today;
        document.getElementById('sale-customer').value = sale ? sale.CustomerName : '';
        document.getElementById('sale-contact').value = sale ? sale.Contact : '';
        var detailField = document.getElementById('sale-detail'); // not present on pharmacy.html
        if (detailField) detailField.value = sale ? sale.Detail : '';
        if (productLinesContainer) renderProductLines(sale ? parseProducts(sale.Products) : null);
        document.getElementById('sale-amount').value = sale ? sale.Amount : '';
        if (priceTypeField) priceTypeField.value = sale ? (sale.PriceType || '') : '';
        setStatusValue(presetStatus || (sale ? sale.Status : 'Pending'));
        document.getElementById('sale-payment-method').value = sale ? (sale.PaymentMethod || '') : '';
        document.getElementById('sale-utr').value = sale ? (sale.UTR || '') : '';
        document.getElementById('sale-notes').value = sale ? sale.Notes : '';

        currentBillUrl = sale ? (sale.BillScreenshotUrl || '') : '';
        currentPaymentUrl = sale ? (sale.PaymentScreenshotUrl || '') : '';
        setUploadState('bill', currentBillUrl ? { existingUrl: currentBillUrl } : {});
        setUploadState('payment', currentPaymentUrl ? { existingUrl: currentPaymentUrl } : {});
        toggleUtrField();
        setPopupLocked(!!sale && !canEditSale(sale));

        overlay.classList.add('open');
        popup.classList.add('open');
    }

    function closePopup() {
        overlay.classList.remove('open');
        popup.classList.remove('open');
        if (convertLeadId) {
            convertLeadId = null;
            convertNote.classList.remove('show');
            var url = new URL(window.location.href);
            url.searchParams.delete('fromLead');
            history.replaceState(null, '', url);
        }
    }

    // ===== Converting a lead into a sale (leads.html → "Convert to sale") =====
    var convertLeadId = null;
    var convertNote = document.createElement('div');
    convertNote.className = 'form-error';
    convertNote.style.cssText = 'background:var(--accent-light);color:var(--accent-dark);margin-bottom:16px;';
    form.insertBefore(convertNote, form.firstChild);

    var returnToLeadId = null; // after saving, go back to this lead

    async function startConversionFromUrl() {
        var leadId = new URLSearchParams(window.location.search).get('fromLead');
        if (!leadId) return;
        var res = await apiCall('getLead', { id: leadId });
        if (res.error) { showToast(res.message || 'Could not load that lead.'); return; }
        if (res.lead.Stage === 'Converted') { showToast('That lead has already been converted to a sale.'); return; }
        returnToLeadId = res.lead.ID;

        // Leads get a Pending sale automatically — open that one rather than
        // creating a second sale for the same customer.
        var linked = (res.linkedSales || []).find(function (l) { return l.type === SALE_TYPE && l.Status === 'Pending'; });
        var existingSale = linked && allSales.find(function (s) { return s.ID === linked.ID; });
        if (existingSale) {
            openPopup(existingSale);
            convertNote.textContent = 'Lead: ' + res.lead.Name + '. Fill in the sale details and mark it Completed (with payment proof) to convert the lead.';
            convertNote.classList.add('show');
            return;
        }

        openPopup(null);
        convertLeadId = res.lead.ID;
        document.getElementById('sale-customer').value = res.lead.Name;
        document.getElementById('sale-contact').value = res.lead.Contact;
        convertNote.textContent = 'Converting lead: ' + res.lead.Name + '. Saving this sale marks the lead as Converted' +
            (res.lead.OwnerName && res.lead.OwnerEmail.toLowerCase() !== String(user.email).toLowerCase() ? ' and credits the sale to ' + res.lead.OwnerName : '') + '.';
        convertNote.classList.add('show');
    }

    document.getElementById('new-sale-btn').addEventListener('click', function () { openPopup(null); });
    document.getElementById('popup-cancel').addEventListener('click', closePopup);
    document.getElementById('popup-close-x').addEventListener('click', closePopup);
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
        if (priceTypeField && !priceType) { showFormError('Price type is required.'); return; }

        var products = productLinesContainer ? getProductsFromForm() : null;
        if (productLinesContainer) {
            if (products.length === 0) { showFormError('Add at least one product.'); return; }
            for (var pi = 0; pi < products.length; pi++) {
                if (!products[pi].name) { showFormError('Every product needs a name.'); return; }
                if (!products[pi].quantity || Number(products[pi].quantity) <= 0) { showFormError('Every product needs a quantity greater than 0.'); return; }
            }
        }

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
            amount: document.getElementById('sale-amount').value,
            priceType: priceType,
            status: status,
            paymentMethod: paymentMethod,
            utr: utr,
            notes: document.getElementById('sale-notes').value.trim()
        };
        if (convertLeadId && !id) payload.leadId = convertLeadId;
        if (productLinesContainer) {
            payload.products = products;
        } else {
            payload.detail = document.getElementById('sale-detail').value.trim();
        }

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

        if (payload.leadId || returnToLeadId) {
            // Back to the lead (Converted once its sale is Completed).
            window.location.href = 'leads.html?open=' + encodeURIComponent(payload.leadId || returnToLeadId);
            return;
        }
        closePopup();
        load();
    });

    async function deleteSale(id) {
        if (!confirm('Delete this sale entry? This cannot be undone.')) return;
        var res = await apiCall('deleteSale', { type: SALE_TYPE, id: id });
        if (res.error) { showToast(res.message || 'Could not delete sale.'); return; }
        showToast('Sale deleted.', 'success');
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
            ? '<a class="proof-link proof-view" href="#" data-id="' + escapeHtml(s.ID) + '" data-kind="bill">Bill</a>'
            : '<span class="proof-link disabled">Bill</span>';
        var payment = s.PaymentScreenshotUrl
            ? '<a class="proof-link proof-view" href="#" data-id="' + escapeHtml(s.ID) + '" data-kind="payment">Payment</a>'
            : '<span class="proof-link disabled">Payment</span>';
        return '<div class="row-actions">' + bill + payment + '</div>';
    }

    function canEditSale(s) {
        if (canManageAll) return true;
        var isOwner = String(s.AgentEmail).toLowerCase() === String(user.email).toLowerCase();
        return isOwner && s.Status !== 'Completed'; // Completed sales are locked for agents
    }

    function canViewSale(s) {
        return canManageAll || String(s.AgentEmail).toLowerCase() === String(user.email).toLowerCase();
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
            else if (canViewSale(s)) actions += '<button type="button" class="secondary edit-btn" data-id="' + s.ID + '">View</button>';
            if (canManageAll) actions += '<button type="button" class="danger delete-btn" data-id="' + s.ID + '">Delete</button>';

            return '<tr>' +
                '<td>' + formatDate(s.Date) + '</td>' +
                '<td>' + avatarHtml(s.AgentName) + '</td>' +
                '<td>' + escapeHtml(s.CustomerName) + leadTag(s) + '</td>' +
                '<td>' + escapeHtml(s.Contact) + '</td>' +
                '<td>' + escapeHtml(s.Detail) + '</td>' +
                '<td>' + amountText(s) + '</td>' +
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
        Array.prototype.forEach.call(tbody.querySelectorAll('.proof-view'), function (link) {
            link.addEventListener('click', function (e) {
                e.preventDefault();
                viewAttachment(link.dataset.id, link.dataset.kind);
            });
        });
    }

    // Sales created automatically from a lead have no amount until someone fills it in.
    function amountText(s) { return s.Amount === '' || s.Amount === null || s.Amount === undefined ? '—' : formatMoney(s.Amount); }
    function leadTag(s) { return s.LeadID ? ' <span class="lead-tag" title="Linked to a lead">Lead</span>' : ''; }

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
            '<div class="kanban-card-top"><span class="kanban-amount">' + amountText(sale) + '</span>' + proofDots + '</div>' +
            '<div class="kanban-customer">' + escapeHtml(sale.CustomerName) + leadTag(sale) + '</div>' +
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
        if (res.error) showToast(res.message || 'Could not update status.');
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

    load().then(startConversionFromUrl); // needs the sales list to find a lead's existing sale
})();
