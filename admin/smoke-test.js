#!/usr/bin/env node
/**
 * Helfenberger's Library — Smoke-Test vor der Live-Schaltung.
 *
 *   node admin/smoke-test.js <ordner>     (braucht das npm-Paket «playwright» + Chromium)
 *
 * Liefert <ordner> über einen kleinen lokalen Webserver unter
 * /helfenberger-library/ aus (also wie die Live-Seite, ohne «-test/»), öffnet
 * die Seite in einem Headless-Chromium und verlangt:
 *   - die Login-Maske erscheint (sie wird vom Modul-Skript gezeichnet — also
 *     ist das ganze Skript ohne Laufzeitfehler durchgelaufen),
 *   - kein unbehandelter JavaScript-Fehler (pageerror),
 *   - hilfe.html, manifest.json, sw-push.js und die Fächer-Bilder sind da.
 * Exit-Code 1 bei einem Problem (so bricht die nächtliche Freigabe ab).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const PREFIX = '/helfenberger-library/';
const TYPEN = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.json':'application/json', '.png':'image/png',
  '.webp':'image/webp', '.jpg':'image/jpeg', '.css':'text/css', '.svg':'image/svg+xml' };
const fehlend = [];

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(!p.startsWith(PREFIX)){ res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length) || 'index.html';
  if(p.endsWith('/')) p += 'index.html';
  const datei = path.join(root, p);
  if(!datei.startsWith(root) || !fs.existsSync(datei) || fs.statSync(datei).isDirectory()){
    fehlend.push(p); res.writeHead(404); return res.end();
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] || 'application/octet-stream' });
  fs.createReadStream(datei).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const basis = `http://127.0.0.1:${server.address().port}${PREFIX}`;
  const probleme = [];
  const browser = await chromium.launch();
  try{
    const page = await browser.newPage();
    const jsFehler = [];
    page.on('pageerror', e => jsFehler.push(e.message + (e.stack ? '\n' + e.stack.split('\n').slice(0, 4).join('\n') : '')));
    await page.goto(basis, { waitUntil: 'load', timeout: 60000 });
    try{ await page.waitForSelector('#loginPass', { timeout: 30000 }); }
    catch(e){ probleme.push('Login-Maske erscheint nicht (Modul-Skript bricht vermutlich beim Start ab).'); }
    await page.waitForTimeout(2000);
    jsFehler.forEach(m => probleme.push('JavaScript-Fehler beim Laden: ' + m));

    for(const f of ['hilfe.html', 'manifest.json', 'sw-push.js']){
      const r = await page.request.get(basis + f);
      if(!r.ok()) probleme.push(`${f} fehlt (HTTP ${r.status()})`);
    }
    // Alle im Code referenzierten assets/… müssen existieren.
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const assets = [...new Set([...html.matchAll(/['"(](assets\/[\w.\-\/]+\.(?:webp|png|jpg|json|svg))/g)].map(m => m[1]))];
    assets.filter(a => !fs.existsSync(path.join(root, a))).forEach(a => probleme.push('Datei fehlt: ' + a));
  } finally {
    await browser.close();
    server.close();
  }
  const selbst404 = fehlend.filter(f => !/favicon/.test(f));
  if(selbst404.length) console.log('ℹ️  Beim Laden nicht gefunden (404): ' + [...new Set(selbst404)].join(', '));
  if(probleme.length){
    probleme.forEach(p => console.error('❌ ' + p));
    process.exit(1);
  }
  console.log('✅ Smoke-Test ok: Seite lädt, Login-Maske erscheint, keine JavaScript-Fehler.');
})().catch(e => { console.error('❌ Smoke-Test abgebrochen:', e); process.exit(1); });
