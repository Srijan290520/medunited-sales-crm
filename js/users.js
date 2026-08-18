(function () {
    var user = requireAuth(['admin']);
    if (!user) return;
    renderLayout('users');

    var overlay = document.getElementById('overlay');
    var popup = document.getElementById('user-popup');
    var form = document.getElementById('user-form');
    var errorBox = document.getElementById('popup-error');

    function openPopup(existing) {
        errorBox.classList.remove('show');
        form.reset();
        document.getElementById('user-id').value = existing ? existing.ID : '';
        document.getElementById('popup-title').textContent = existing ? 'Edit User' : 'New User';
        document.getElementById('user-name').value = existing ? existing.Name : '';
        document.getElementById('user-email').value = existing ? existing.Email : '';
        document.getElementById('user-email').disabled = !!existing;
        document.getElementById('user-role').value = existing ? existing.Role : 'agent';
        document.getElementById('user-password').required = !existing;
        document.getElementById('password-label').textContent = existing ? 'New Password' : 'Temporary Password';
        document.getElementById('password-hint').style.display = existing ? 'block' : 'none';
        overlay.classList.add('open');
        popup.classList.add('open');
    }

    function closePopup() {
        overlay.classList.remove('open');
        popup.classList.remove('open');
    }

    document.getElementById('new-user-btn').addEventListener('click', function () { openPopup(null); });
    document.getElementById('popup-cancel').addEventListener('click', closePopup);
    overlay.addEventListener('click', closePopup);

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        errorBox.classList.remove('show');

        var id = document.getElementById('user-id').value;
        var password = document.getElementById('user-password').value;
        var saveBtn = document.getElementById('popup-save');
        saveBtn.disabled = true;

        var res;
        if (id) {
            var patch = {
                name: document.getElementById('user-name').value.trim(),
                role: document.getElementById('user-role').value
            };
            if (password) patch.password = password;
            res = await apiCall('updateUser', { id: id, data: patch });
        } else {
            res = await apiCall('createUser', {
                data: {
                    name: document.getElementById('user-name').value.trim(),
                    email: document.getElementById('user-email').value.trim(),
                    role: document.getElementById('user-role').value,
                    password: password
                }
            });
        }

        saveBtn.disabled = false;

        if (res.error) {
            errorBox.textContent = res.message || 'Could not save user.';
            errorBox.classList.add('show');
            return;
        }

        closePopup();
        load();
    });

    async function toggleActive(id, active) {
        var res = await apiCall('updateUser', { id: id, data: { active: active } });
        if (res.error) { alert(res.message || 'Could not update user.'); load(); return; }
        load();
    }

    async function load() {
        var res = await apiCall('listUsers');
        var tbody = document.getElementById('users-table-body');
        var empty = document.getElementById('users-empty');

        if (res.error) {
            tbody.innerHTML = '';
            empty.textContent = res.message || 'Could not load users.';
            empty.classList.remove('hidden');
            return;
        }

        var users = res.users || [];
        if (users.length === 0) {
            tbody.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        tbody.innerHTML = users.map(function (u) {
            return '<tr>' +
                '<td>' + avatarHtml(u.Name) + '</td>' +
                '<td>' + escapeHtml(u.Email) + '</td>' +
                '<td><span class="role-badge ' + u.Role + '">' + escapeHtml(u.Role) + '</span></td>' +
                '<td><label class="switch"><input type="checkbox" class="active-toggle" data-id="' + u.ID + '" ' + (u.Active ? 'checked' : '') + '><span class="slider"></span></label></td>' +
                '<td>' + formatDate(u.CreatedAt) + '</td>' +
                '<td class="row-actions"><button type="button" class="secondary edit-btn" data-id="' + u.ID + '">Edit</button></td>' +
                '</tr>';
        }).join('');

        Array.prototype.forEach.call(tbody.querySelectorAll('.edit-btn'), function (btn) {
            btn.addEventListener('click', function () {
                var u = users.find(function (u) { return u.ID === btn.dataset.id; });
                if (u) openPopup(u);
            });
        });
        Array.prototype.forEach.call(tbody.querySelectorAll('.active-toggle'), function (chk) {
            chk.addEventListener('change', function () { toggleActive(chk.dataset.id, chk.checked); });
        });
    }

    load();
})();
