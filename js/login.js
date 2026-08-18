(function () {
    var params = new URLSearchParams(window.location.search);
    var infoBox = document.getElementById('login-info');
    if (params.get('expired') === '1') {
        infoBox.textContent = 'Your session expired. Please log in again.';
        infoBox.classList.add('show');
    }

    // Already logged in? Skip straight to the dashboard.
    if (getToken() && getCurrentUser()) {
        window.location.href = 'dashboard.html';
        return;
    }

    var form = document.getElementById('login-form');
    var errorBox = document.getElementById('login-error');
    var loginBtn = document.getElementById('login-btn');

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        errorBox.classList.remove('show');
        loginBtn.disabled = true;
        loginBtn.textContent = 'Logging in…';

        var email = document.getElementById('email').value.trim();
        var password = document.getElementById('password').value;

        var res = await apiCall('login', { email: email, password: password });

        loginBtn.disabled = false;
        loginBtn.textContent = 'Log in';

        if (res.error) {
            errorBox.textContent = res.message || 'Login failed.';
            errorBox.classList.add('show');
            return;
        }

        setSession(res.token, res.user);
        window.location.href = 'dashboard.html';
    });
})();
