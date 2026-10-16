// Local test server: serves the built app (dist/) and answers API calls with
// the real Apps Script code running on the in-memory Google mocks.
//   node tests/e2e/server.cjs [port]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadBackend } = require('../backend/gas-mock.cjs');

const port = Number(process.argv[2] || 4173);
const root = path.join(__dirname, '..', '..');
const dist = path.join(root, 'dist');
const env = loadBackend(path.join(root, 'apps-script'));
const { ctx } = env;

function api(params) {
  return JSON.parse(ctx.doPost({ parameter: params, postData: { length: JSON.stringify(params).length } }).getContent());
}

// Seed: admin (password already changed) plus a manager and two agents with
// temporary passwords, so the first-login flow can be tested too.
env.props.set('ADMIN_EMAIL', 'admin@medunited.test');
env.props.set('ADMIN_PASSWORD', 'Setup-Temp-123');
ctx.setupSpreadsheet();
ctx.createFirstAdmin();
let t = api({ action: 'login', payload: JSON.stringify({ email: 'admin@medunited.test', password: 'Setup-Temp-123' }) }).token;
t = api({ action: 'changePassword', token: t, payload: JSON.stringify({ currentPassword: 'Setup-Temp-123', newPassword: 'Blue-Harbor-2026' }) }).token;
for (const [name, email, role] of [['Meera Manager', 'manager@medunited.test', 'manager'], ['Arjun Agent', 'arjun@medunited.test', 'agent'], ['Divya Agent', 'divya@medunited.test', 'agent']]) {
  api({ action: 'createUser', token: t, payload: JSON.stringify({ data: { name, email, role, password: 'Temp-Start-2026' } }) });
}
api({ action: 'logout', token: t });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === 'POST' && url.pathname === '/exec') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const params = Object.fromEntries(new URLSearchParams(body));
      let out;
      try { out = api(params); } catch (e) { out = { error: true, message: 'mock crash: ' + e.message }; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(`window.__CRM_CONFIG__ = { apiUrl: 'http://127.0.0.1:${port}/exec' };`);
    return;
  }
  let file = path.join(dist, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(dist) || !fs.existsSync(file)) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`E2E server on http://127.0.0.1:${port}`));
