#!/usr/bin/env node
/* 📂 Ordner-Wähler für den Briefkasten-Dialog der Library (nur Jans Mac, läuft als launchd-Dienst).
 *
 * Hört NUR auf 127.0.0.1:47831. Die Library-Seite fragt hier an (POST /waehlen); dann öffnet sich
 * der Finder-Dialog «Ordner wählen», und der gewählte Pfad geht an die Seite zurück.
 * Erlaubt sind nur Anfragen von den Library-Seiten (Origin-Prüfung).
 */
const http = require('http');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const PORT = 47831;
const ERLAUBT = ['https://jnhbr.github.io', 'http://localhost', 'http://127.0.0.1'];
const heim = os.homedir();
let offen = false;

function erlaubt(origin) {
  return !!origin && ERLAUBT.some(o => origin === o || origin.startsWith(o + ':'));
}
function tilde(p) { return p === heim || p.startsWith(heim + '/') ? '~' + p.slice(heim.length) : p; }

function waehlen(start, fertig) {
  const skript = 'tell application "System Events" to activate\n' +
    'POSIX path of (choose folder with prompt "Ordner für die Abgaben wählen"' +
    (start ? ' default location (POSIX file ' + JSON.stringify(start) + ')' : '') + ')';
  execFile('osascript', ['-e', skript], { timeout: 300000 }, (err, out) => {
    if (err) return fertig(null);
    fertig(String(out).trim().replace(/\/+$/, ''));
  });
}

http.createServer((req, res) => {
  const origin = req.headers.origin;
  const kopf = { 'Content-Type': 'application/json; charset=utf-8' };
  if (erlaubt(origin)) {
    kopf['Access-Control-Allow-Origin'] = origin;
    kopf['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS';
    kopf['Access-Control-Allow-Headers'] = 'Content-Type';
    kopf['Access-Control-Allow-Private-Network'] = 'true';
    kopf['Vary'] = 'Origin';
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, kopf); return res.end(); }
  if (!erlaubt(origin)) { res.writeHead(403, kopf); return res.end('{"fehler":"origin"}'); }
  if (req.method === 'GET' && req.url === '/ping') { res.writeHead(200, kopf); return res.end('{"ok":true}'); }
  if (req.method === 'POST' && req.url === '/waehlen') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      if (offen) { res.writeHead(409, kopf); return res.end('{"fehler":"offen"}'); }
      let start = '';
      try { start = String(JSON.parse(body || '{}').start || '').replace(/^~/, heim); } catch (e) { /* ohne Startordner */ }
      // Der Pfad kann noch nicht existieren (neuer Briefkasten): dann nächsten vorhandenen Elternordner nehmen.
      while (start.length > 1 && !fs.existsSync(start)) start = start.replace(/\/[^/]*$/, '');
      if (!start.startsWith('/') || start === '/') start = '';
      offen = true;
      waehlen(start, pfad => {
        offen = false;
        res.writeHead(200, kopf);
        res.end(JSON.stringify(pfad ? { pfad: tilde(pfad) } : { abgebrochen: true }));
      });
    });
    return;
  }
  res.writeHead(404, kopf); res.end('{}');
}).listen(PORT, '127.0.0.1');
