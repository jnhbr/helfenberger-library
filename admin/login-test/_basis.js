/**
 * Helfenberger's Library — gemeinsame Bausteine der Ablauf-Tests (ablauf-test.js).
 *
 * Wie login-test.js: die echte index.html in Chromium gegen die Firebase-Emulatoren
 * (Anmeldung + Datenbank mit den echten firestore.rules), nie gegen die echte Datenbank.
 * Hier steht nur, was jeder Ablauf braucht: Webserver, Konten, Geräte, Anmelden, Abhaken.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST){
  console.error('❌ Dieser Test läuft nur in den Firebase-Emulatoren (npm run ablauf) – nie gegen die echte Datenbank.');
  process.exit(1);
}
const admin = require('firebase-admin');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const PREFIX = '/helfenberger-library/';
const DOM = '@helfenberger-library.app';
const TYPEN = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.css':'text/css', '.svg':'image/svg+xml' };

admin.initializeApp({ projectId: 'demo-library' });
const db = admin.firestore(), auth = admin.auth();
const TS = admin.firestore.FieldValue.serverTimestamp();

const pw = {};
const pruefungen = [], fehler = [];
// Meldungen im Browser, die in einem Ablauf erwartet sind (z. B. ein absichtlich verbotener Zugriff).
const erlaubt = [];

function ok(bed, text){ pruefungen.push(!!bed); console.log((bed ? '  ✅ ' : '  ❌ ') + text); return !!bed; }
async function bis(fn, text, ms){
  const ende = Date.now() + (ms || 15000);
  for(;;){
    const v = await fn();
    if(v) return v;
    if(Date.now() > ende) throw new Error('Zeit abgelaufen: ' + text);
    await new Promise(r => setTimeout(r, 200));
  }
}

/** Konto anlegen. rolle: 'student' | 'teacher' | 'leitung'. */
async function konto(u, name, rolle, klasse){
  const uid = 'u_' + u;
  pw[u] = crypto.randomBytes(9).toString('base64url');
  await auth.createUser({ uid, email: u + DOM, password: pw[u], displayName: name });
  const claims = { klasse };
  if(rolle === 'teacher') claims.teacher = true;
  if(rolle === 'leitung') claims.leitung = true;
  await auth.setCustomUserClaims(uid, claims);
  await db.doc('students/' + uid).set({ username: u, displayName: name, role: rolle, klasse });
  return uid;
}

/** Eine hochgeladene Übung: Metadaten in der Klasse + Inhalt in Stücken (wie die Library sie ablegt). */
async function uebung(klasse, id, felder, html){
  const cid = 'c_' + id;
  await db.doc('klassen/' + klasse + '/resources/' + id).set(Object.assign({ fileName: id + '.html', order: 1, contentId: cid, uploadedAt: TS }, felder));
  await db.doc('resourceContent/' + cid).set({ chunkCount: 1 });
  await db.doc('resourceContent/' + cid + '/chunks/0').set({ html });
}

let server, browser, url;
async function start(){
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if(!p.startsWith(PREFIX)){ res.writeHead(404); return res.end(); }
    p = p.slice(PREFIX.length) || 'index.html';
    const datei = path.join(ROOT, p);
    if(!datei.startsWith(ROOT) || !fs.existsSync(datei) || fs.statSync(datei).isDirectory()){ res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] || 'application/octet-stream' });
    fs.createReadStream(datei).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = 'http://127.0.0.1:' + server.address().port + PREFIX + '?emu=1';
  browser = await chromium.launch();
}

const seiten = {};
/** Ein eigenes Gerät (eigener Browser-Speicher). name erscheint in Fehlermeldungen. */
async function geraet(name, breite){
  const ctx = await browser.newContext({ viewport: { width: breite || 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const merken = t => { if(!erlaubt.some(re => re.test(t))) fehler.push(t); };
  page.on('pageerror', e => merken(name + ': ' + e.message));
  page.on('console', m => { if(m.type() === 'error' && /permission|insufficient|FirebaseError/i.test(m.text())) merken(name + ' [Konsole] ' + m.text().slice(0, 300)); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#loginPass');
  seiten[name] = page;
  return page;
}
async function anmelden(page, name){
  await page.fill('#loginName', name);
  await page.fill('#loginPass', pw[name]);
  await page.press('#loginPass', 'Enter');
  await page.waitForFunction(() => !document.getElementById('loginPass'), null, { timeout: 30000 });
  await page.waitForTimeout(800);
}
const text = p => p.evaluate(() => document.body.innerText);
async function fach(p, id){ await p.click('.subject-card[data-subject="' + id + '"]'); await p.waitForSelector('#backBtn'); await p.waitForTimeout(600); }
async function klassenzimmer(p){
  await p.evaluate(() => { const b = [...document.querySelectorAll('button, a')].find(x => /Klassenzimmer/.test(x.textContent)); if(b) b.click(); });
  await p.waitForSelector('.kz-tile');
}
// Listen stehen nach Fach/Ordner eingeklappt: die Abschnitte über dem gesuchten Element aufklappen.
// Der Klick passiert in der Seite selbst (die Liste wird bei jedem Live-Update neu gezeichnet).
async function aufklappen(p, sel){
  await p.waitForSelector(sel, { state: 'attached' });
  for(let i = 0; i < 8; i++){
    const offen = await p.evaluate(q => {
      const e = document.querySelector(q);
      if(!e) return false;
      let d = e.closest('details:not([open])'), aussen = d;
      while(aussen && aussen.parentElement && (aussen = aussen.parentElement.closest('details:not([open])'))) d = aussen;
      const s = d ? d.querySelector(':scope > summary') : null;
      if(!s) return true;
      s.click(); return false;
    }, sel);
    if(offen) break;
    await p.waitForTimeout(150);
  }
  await p.waitForSelector(sel);
}

/** Einen Abschnitt ausführen; ein Abbruch darin zählt als Fehler, die übrigen Abschnitte laufen weiter. */
async function abschnitt(titel, fn){
  // NUR=<Stichwort> lässt beim Entwickeln nur die passenden Abschnitte laufen.
  if(process.env.NUR && titel.toLowerCase().indexOf(process.env.NUR.toLowerCase()) < 0) return;
  console.log('\n' + titel);
  try{ await fn(); }
  catch(e){
    ok(false, 'Abbruch: ' + String(e.message).split('\n')[0]);
    if(process.env.DEBUG_DIR) for(const k of Object.keys(seiten)) await seiten[k].screenshot({ path: process.env.DEBUG_DIR + '/' + titel.replace(/[^a-z]/gi, '').slice(0, 12) + '-' + k + '.png' }).catch(() => {});
  }
}

async function ende(name){
  await browser.close();
  server.close();
  const eindeutig = [...new Set(fehler)];
  if(eindeutig.length){ console.log('\nFehler im Browser:'); eindeutig.forEach(f => console.log('  ⚠️ ' + f)); }
  const schlecht = pruefungen.filter(x => !x).length;
  console.log('\n' + (pruefungen.length - schlecht) + ' / ' + pruefungen.length + ' Prüfungen ok' + (eindeutig.length ? ', ' + eindeutig.length + ' Fehler im Browser' : ''));
  if(schlecht || eindeutig.length){ console.error('❌ ' + name + ' fehlgeschlagen.'); process.exit(1); }
  console.log('✅ ' + name + ' ok.');
  process.exit(0);
}

module.exports = { admin, db, auth, TS, pw, ok, bis, konto, uebung, start, geraet, anmelden, text, fach, klassenzimmer, aufklappen, abschnitt, ende, erlaubt, seiten };
