const request = require('supertest');
const app = require('../src/app');

// ============================================================
// Tests de régression sécurité — chacun doit ÉCHOUER sur
// l'ancien code vulnérable et PASSER sur le code corrigé.
// ============================================================

// --- Faille 1 : XSS réfléchi sur /hello ---
// Attaque : /hello?name=<script>alert(1)</script>
test('should escape HTML in /hello name (no XSS)', async () => {
  const res = await request(app)
    .get('/hello?name=' + encodeURIComponent('<script>alert(1)</script>'));
  expect(res.status).toBe(200);
  // Le code corrigé échappe : le navigateur reçoit du texte, pas du HTML
  expect(res.text).not.toContain('<script>');
  expect(res.text).toContain('&lt;script&gt;');
});

// --- Faille 2 : injection de commande sur /ping ---
// Attaque : /ping?host=google.com;cat /etc/passwd
test('should return 400 when host contains a shell command', async () => {
  const res = await request(app)
    .get('/ping?host=' + encodeURIComponent('google.com;cat /etc/passwd'));
  expect(res.status).toBe(400);
});

test('should return 400 when host is a shell metacharacter payload', async () => {
  const res = await request(app)
    .get('/ping?host=' + encodeURIComponent('$(whoami)'));
  expect(res.status).toBe(400);
  const res2 = await request(app)
    .get('/ping?host=' + encodeURIComponent('127.0.0.1 | cat /etc/passwd'));
  expect(res2.status).toBe(400);
});

test('should accept a valid hostname on /ping (jamais 400)', async () => {
  // Sur Linux CI : 200. Sur Windows local (ping sans -c) : 500.
  // Dans tous les cas, un hôte valide ne doit PAS être rejeté à 400.
  const res = await request(app).get('/ping?host=localhost');
  expect(res.status).not.toBe(400);
});

// --- Faille 3 : prototype pollution / fuite de clés sur /prefs ---
// Attaque : /prefs?__proto__[admin]=true  ou  /prefs?admin=true
test('should not leak or merge non-whitelisted keys on /prefs', async () => {
  const res = await request(app)
    .get('/prefs?theme=dark&admin=true&__proto__[admin]=true');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ theme: 'dark', lang: 'fr' });
  expect(res.body).not.toHaveProperty('admin');
  // Object.prototype ne doit pas être pollué
  expect({}.admin).toBeUndefined();
});
