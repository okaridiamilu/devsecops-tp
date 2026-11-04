const express = require('express');
const { execFile } = require('child_process');
const _ = require('lodash');

const app = express();

// Rate limiting minimal en memoire (100 requetes / 15 min / IP) :
// evite le brute force sur les routes publiques (alerte CodeQL js/missing-rate-limiting)
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 100;
const hits = new Map();
app.use((req, res, next) => {
  const now = Date.now();
  let entry = hits.get(req.ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    entry = { start: now, count: 0 };
    hits.set(req.ip, entry);
  }
  entry.count += 1;
  if (entry.count > RATE_MAX) return res.status(429).send('Trop de requetes, reessayez plus tard');
  next();
});


// Échappe les caractères spéciaux HTML : un nom d'utilisateur est
// affiché comme du TEXTE, jamais interprété comme du code (anti-XSS).
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Message de bienvenue — le nom est échappé avant d'être inséré dans le HTML
app.get('/hello', (req, res) => {
  const name = escapeHtml(req.query.name || 'inconnu');
  res.send(`<h1>Bonjour ${name}</h1>`);
});

// Un hôte valide : hostname (RFC 1123) ou adresse IPv4, max 253 caractères.
// Aucun espace, point-virgule, backtick, $ ou | ne peut passer.
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.?$/;

// Outil réseau : ping un hôte — l'hôte est validé par la regex (400 sinon)
// et execFile appelle ping SANS shell : aucune injection de commande possible.
app.get('/ping', (req, res) => {
  const host = String(req.query.host || '');
  if (!HOSTNAME_RE.test(host)) {
    return res.status(400).send('Hôte invalide');
  }
  execFile('ping', ['-c', '1', host], (err, stdout) => {
    if (err) return res.status(500).send('Erreur');
    res.type('text').send(stdout);
  });
});

// Préférences utilisateur — on ne recopie QUE les clés autorisées.
// _.merge avec req.query brut permettrait la prototype pollution
// (ex. ?__proto__[admin]=true) : la whitelist bloque tout le reste.
const ALLOWED_PREF_KEYS = ['theme', 'lang'];

app.get('/prefs', (req, res) => {
  const defaults = { theme: 'light', lang: 'fr' };
  const userPrefs = _.pick(req.query, ALLOWED_PREF_KEYS);
  res.json(_.merge({}, defaults, userPrefs));
});

module.exports = app;
