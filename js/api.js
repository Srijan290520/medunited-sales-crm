// api.js — talks to the Apps Script backend.
// Set your deployed Web App URL here after you deploy the apps-script/ project.
var API_URL = window.API_URL || 'https://script.google.com/macros/s/AKfycbzp2gta5Olosue5cZzTVWg3J5W2-sN4MGx8Ah9UWbwP7E5VqiVEle5o0DsvO8gmd0OH/exec';

var TOKEN_KEY = 'medunited_crm_token';
var USER_KEY = 'medunited_crm_user';

function getToken() { return localStorage.getItem(TOKEN_KEY); }

function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

function getCurrentUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); }
    catch (e) { return null; }
}

// Every call is a form-urlencoded POST (Apps Script + browsers avoid CORS
// preflight issues that way). `action` selects the server-side handler.
async function apiCall(action, extra) {
    extra = extra || {};
    var params = new URLSearchParams();
    params.append('action', action);
    var token = getToken();
    if (token) params.append('token', token);
    Object.keys(extra).forEach(function (k) {
        var v = extra[k];
        if (v === undefined || v === null) return;
        params.append(k, (typeof v === 'object') ? JSON.stringify(v) : v);
    });

    var res;
    try {
        res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: params.toString()
        });
    } catch (err) {
        return { error: true, message: 'Network error — check your connection and the API URL in js/api.js.' };
    }

    var text = await res.text();
    var json;
    try { json = JSON.parse(text); }
    catch (e) { return { error: true, message: 'Unexpected response from server: ' + text.slice(0, 200) }; }

    if (json.authError) {
        clearSession();
        window.location.href = 'index.html?expired=1';
    }
    return json;
}

// Call at the top of every page except index.html (login).
// allowedRoles: optional array, e.g. ['admin'] or ['admin', 'manager'].
function requireAuth(allowedRoles) {
    var user = getCurrentUser();
    var token = getToken();
    if (!token || !user) {
        window.location.href = 'index.html';
        return null;
    }
    if (allowedRoles && allowedRoles.indexOf(user.role) === -1) {
        window.location.href = 'dashboard.html?denied=1';
        return null;
    }
    return user;
}
