#!/usr/bin/env node
/**
 * Helfenberger's Library — Funktionstest der Funktionen vom 09.10.2026.
 *
 * Wie login-test.js: die echte index.html in Chromium gegen die Firebase-Emulatoren
 * (Anmeldung + Datenbank mit den echten firestore.rules), nie gegen die echte Datenbank.
 *
 *   cd admin/login-test && npm test            (login-test.js)
 *   cd admin/login-test && npm run features    (dieser Test)
 *
 * Geprüft wird:
 *   🎯 Differenzierung   Übung mit nurFuer ist nur für die gewählte Person sichtbar, Niveau-Abzeichen,
 *                         «🎯 Zuweisen» der Lehrperson schreibt nurFuer/niveau
 *   🔁 Heute dran         fällige Karteikarten und eine länger nicht geübte Übung erscheinen auf der Startseite
 *   📝 Kollisionswarnung  zweite Prüfung am selben Tag → Rückfrage im Kalender
 *   ♿ Zeitzuschlag       im Prüfungs-Monitor zeigt die Restzeit den Zuschlag, der Dialog speichert p.zuschlag
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST){
  console.error('❌ Dieser Test läuft nur in den Firebase-Emulatoren (npm run features) – nie gegen die echte Datenbank.');
  process.exit(1);
}
const admin = require('firebase-admin');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const PREFIX = '/helfenberger-library/';
const DOM = '@helfenberger-library.app';
const K = 'G3b';
const TYPEN = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.css':'text/css', '.svg':'image/svg+xml' };
const pw = {};
const neuPw = name => (pw[name] = crypto.randomBytes(9).toString('base64url'));

admin.initializeApp({ projectId: 'demo-library' });
const db = admin.firestore(), auth = admin.auth();
const Timestamp = admin.firestore.Timestamp;
const TS = admin.firestore.FieldValue.serverTimestamp();

const heute = new Date();
const ds = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function kkHash(s){ let h = 5381; for(let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
// Ein Werktag in der kommenden Woche (Mittwoch), damit die Kollisionsprüfung eine feste Woche hat.
function naechsterMittwoch(){ const d = new Date(); d.setHours(12, 0, 0, 0); do { d.setDate(d.getDate() + 1); } while(d.getDay() !== 3 || (d - new Date()) < 2 * 86400000); return d; }
const mittwoch = naechsterMittwoch();

async function seed(){
  const leute = [['testlehrer', 'Test Lehrperson', 'teacher'], ['anna', 'Anna', 'student'], ['ben', 'Ben', 'student']];
  for(const [u, name, role] of leute){
    const uid = 'u_' + u;
    await auth.createUser({ uid, email: u + DOM, password: neuPw(u), displayName: name });
    await auth.setCustomUserClaims(uid, role === 'teacher' ? { teacher: true, klasse: K } : { klasse: K });
    await db.doc('students/' + uid).set({ username: u, displayName: name, role, klasse: K });
  }
  const base = 'klassen/' + K + '/';
  await db.doc(base + 'resources/r_a').set({ subject:'mathe', title:'Übung Alle', fileName:'a.html', order:1, contentId:'c_a', niveau:'B', uploadedAt:TS });
  await db.doc(base + 'resources/r_b').set({ subject:'mathe', title:'Übung nur Anna', fileName:'b.html', order:2, contentId:'c_b', niveau:'C', nurFuer:['u_anna'], uploadedAt:TS });
  // Heute dran: Karteikarten + eine alte Übung mit 50 %
  await db.doc(base + 'klasseninfo/karteikarten').set({ sets:[{ id:'s1', fach:'englisch', titel:'Voci Test', kopf:{ v:'Englisch', r:'Deutsch' }, karten:[{ v:'cat', r:'Katze' }, { v:'dog', r:'Hund' }, { v:'bird', r:'Vogel' }] }] });
  await db.doc('progress/u_anna/resources/kk_s1').set({ kk:{ boxen:{ ['vr_' + kkHash('cat')]:{ b:1, f:'2020-01-01' }, ['vr_' + kkHash('dog')]:{ b:2, f:'2020-01-01' }, ['vr_' + kkHash('bird')]:{ b:3, f:'2999-01-01' } } } });
  await db.doc('progress/u_anna/resources/r_a').set({ stats:{ q1:{ status:'correct' }, q2:{ status:'wrong' } }, total:2, updatedAt:Timestamp.fromMillis(Date.now() - 10 * 86400000) });
  // Kalender: schon eine Prüfung am Mittwoch
  await db.doc(base + 'calendarEntries/c_pruef1').set({ type:'pruefung', subject:'mathe', title:'Mathe-Test Brüche', description:'', dueDate:ds(mittwoch), createdAt:TS, createdBy:'u_testlehrer' });
}

async function seedPruefung(){
  const base = 'klassen/' + K + '/';
  // Prüfung mit Zeitlimit, Anna läuft seit einer Minute
  await db.doc(base + 'pruefungen/p1').set({ titel:'Zeittest', art:'bank', subject:'mathe', status:'offen', zeitMin:10, fragen:[{ typ:'tf', q:'x', punkte:1 }], maxPunkte:1, zuschlag:{ u_anna:50 }, createdAt:TS });
  await db.doc(base + 'pruefungen/p1/teilnahmen/u_anna').set({ uid:'u_anna', name:'Anna', status:'laeuft', aktiv:true, geladen:true, startMs:Date.now() - 60000, lebt:TS, antworten:{}, beantwortet:0, max:1, verstoesse:[] });
  await db.doc(base + 'pruefungen/p1/teilnahmen/u_ben').set({ uid:'u_ben', name:'Ben', status:'laeuft', aktiv:true, geladen:true, startMs:Date.now() - 60000, lebt:TS, antworten:{}, beantwortet:0, max:1, verstoesse:[] });
}

const pruefungen = [], fehler = [];
function ok(bed, text){ pruefungen.push(!!bed); console.log((bed ? '  ✅ ' : '  ❌ ') + text); }
const warte = (p, ms) => p.waitForTimeout(ms);
async function bis(fn, text, ms){
  const ende = Date.now() + (ms || 15000);
  for(;;){
    const v = await fn();
    if(v) return v;
    if(Date.now() > ende) throw new Error('Zeit abgelaufen: ' + text);
    await new Promise(r => setTimeout(r, 200));
  }
}

var seiten;
(async () => {
  await seed();
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if(!p.startsWith(PREFIX)){ res.writeHead(404); return res.end(); }
    p = p.slice(PREFIX.length) || 'index.html';
    const datei = path.join(ROOT, p);
    if(!datei.startsWith(ROOT) || !fs.existsSync(datei) || fs.statSync(datei).isDirectory()){ res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] || 'application/octet-stream' });
    fs.createReadStream(datei).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + PREFIX + '?emu=1';
  const browser = await chromium.launch();

  async function geraet(name, breite){
    const ctx = await browser.newContext({ viewport: { width: breite || 1280, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', e => fehler.push(name + ': ' + e.message));
    page.on('console', m => { if(m.type() === 'error' && /permission|insufficient|FirebaseError/i.test(m.text())) fehler.push(name + ' [Konsole] ' + m.text().slice(0, 300)); });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#loginPass');
    return page;
  }
  async function anmelden(page, name){
    await page.fill('#loginName', name);
    await page.fill('#loginPass', pw[name]);
    await page.press('#loginPass', 'Enter');
    await page.waitForFunction(() => !document.getElementById('loginPass'), null, { timeout: 30000 });
    await warte(page, 800);
  }
  const text = p => p.evaluate(() => document.body.innerText);
  async function fach(p, id){ await p.click('.subject-card[data-subject="' + id + '"]'); await p.waitForSelector('#backBtn'); await warte(p, 600); }
  async function zurueck(p){ await p.click('#backBtn'); await p.waitForSelector('#subjectGrid'); }

  try{
    seiten = {};
    const lp = await geraet('lehrperson'), anna = await geraet('anna', 420), ben = await geraet('ben', 420);
    seiten = { lp, anna, ben };
    await anmelden(lp, 'testlehrer'); await anmelden(anna, 'anna'); await anmelden(ben, 'ben');

    console.log('\n🎯 Differenzierung');
    await fach(anna, 'mathe'); await fach(ben, 'mathe'); await fach(lp, 'mathe');
    ok(!!(await anna.$('#card-r_a')) && !!(await anna.$('#card-r_b')), 'Anna sieht beide Übungen');
    ok(!!(await ben.$('#card-r_a')) && !(await ben.$('#card-r_b')), 'Ben sieht nur die Übung für alle, nicht «nur Anna»');
    ok(!!(await lp.$('#card-r_a')) && !!(await lp.$('#card-r_b')), 'Die Lehrperson sieht beide');
    ok((await anna.$$eval('#card-r_b .chip-niv-C', e => e.length)) === 1, 'Niveau-Abzeichen C bei «nur Anna»');
    ok(/🎯 1 Pers/.test(await lp.$eval('#card-r_b', e => e.innerText)), 'Lehrperson sieht «🎯 1 Pers.» an der eingeschränkten Übung');
    // Lehrperson weist «Übung Alle» nur Ben zu
    await lp.click('#zu-r_a');
    await lp.waitForSelector('#zuOk');
    await lp.selectOption('#zuNiv', 'A');
    await lp.check('[name=zuWer][value=auswahl]');
    await lp.check('[data-zu="u_ben"]');
    await lp.click('#zuOk');
    await bis(async () => { const d = (await db.doc('klassen/' + K + '/resources/r_a').get()).data(); return d.niveau === 'A' && Array.isArray(d.nurFuer) && d.nurFuer.length === 1 && d.nurFuer[0] === 'u_ben'; }, 'nurFuer gespeichert');
    ok(true, '«🎯 Zuweisen»: Niveau A und nurFuer = [Ben] stehen in der Datenbank');
    await bis(async () => !(await anna.$('#card-r_a')), 'Anna sieht die Übung nicht mehr');
    ok(!!(await ben.$('#card-r_a')), 'Anna sieht «Übung Alle» nicht mehr, Ben schon (Live-Update)');
    // zurück auf alle
    await lp.click('#zu-r_a');
    await lp.waitForSelector('#zuOk');
    await lp.check('[name=zuWer][value=alle]');
    await lp.click('#zuOk');
    await bis(async () => { const d = (await db.doc('klassen/' + K + '/resources/r_a').get()).data(); return d.nurFuer === undefined; }, 'nurFuer entfernt');
    await bis(async () => !!(await anna.$('#card-r_a')), 'Anna sieht die Übung wieder');
    ok(true, '«Die ganze Klasse»: nurFuer ist entfernt, Anna sieht die Übung wieder');
    await zurueck(anna); await zurueck(ben); await zurueck(lp);

    console.log('\n🔁 Heute dran');
    await anna.reload(); await anna.waitForSelector('#loginPass', { timeout: 3000 }).then(() => anmelden(anna, 'anna')).catch(() => {});
    await bis(async () => /Heute dran/.test(await anna.$eval('#heuteDran', e => e.innerText).catch(() => '')), 'Heute dran erscheint', 20000);
    const hd = await anna.$eval('#heuteDran', e => e.innerText);
    ok(/Voci Test/.test(hd) && /2 Karten fällig/.test(hd), 'Karteikarten: «Voci Test · 2 Karten fällig» (die in Box 3 mit Datum 2999 nicht)');
    ok(/Übung Alle/.test(hd) && /50 % richtig/.test(hd), 'Übung «Übung Alle» zuletzt vor 10 Tagen mit 50 % wird zum Auffrischen vorgeschlagen');
    ok(!/Übung nur Anna/.test(hd), 'Nicht geübte Übung taucht nicht auf');
    ok(/^\s*$/.test(await ben.$eval('#heuteDran', e => e.innerText).catch(() => '')), 'Ben hat nichts zu wiederholen: kein Kasten');
    ok(/^\s*$/.test(await lp.$eval('#heuteDran', e => e.innerText).catch(() => '')), 'Die Lehrperson sieht den Kasten nicht');

    console.log('\n📝 Prüfungs-Kollision im Kalender');
    await lp.evaluate(() => { const b = [...document.querySelectorAll('button, a')].find(x => x.textContent.trim() === 'Kalender'); b.click(); });
    await lp.waitForSelector('#calNewBtn');
    await lp.click('#calNewBtn');
    await lp.waitForSelector('#calType');
    await lp.selectOption('#calType', 'pruefung');
    await lp.fill('#calTitle', 'Zweite Prüfung');
    await lp.fill('#calDate', ds(mittwoch));
    await lp.click('#modalOk');
    await bis(async () => /Viele Prüfungen/.test(await text(lp)), 'Warnung erscheint');
    const warn = await text(lp);
    ok(/Am selben Tag ist schon eine Prüfung/.test(warn) && /Mathe-Test Brüche/.test(warn), 'Warnung nennt die Prüfung am selben Tag');
    let n = (await db.collection('klassen/' + K + '/calendarEntries').get()).size;
    ok(n === 1, 'Vor der Bestätigung ist noch nichts gespeichert');
    await lp.click('#modalOk');   // «Trotzdem eintragen»
    await bis(async () => (await db.collection('klassen/' + K + '/calendarEntries').get()).size === 2, 'Eintrag gespeichert');
    ok(true, '«Trotzdem eintragen» speichert die zweite Prüfung');
    // Anderer Tag in der Woche, nur 1 Prüfung dort → keine Warnung beim dritten
    await lp.waitForSelector('#calNewBtn');
    await lp.click('#calNewBtn');
    await lp.waitForSelector('#calType');
    await lp.selectOption('#calType', 'pruefung');
    await lp.fill('#calTitle', 'Dritte Prüfung');
    const freitag = new Date(mittwoch); freitag.setDate(freitag.getDate() + 2);
    await lp.fill('#calDate', ds(freitag));
    await lp.click('#modalOk');
    await bis(async () => (await db.collection('klassen/' + K + '/calendarEntries').get()).size === 3, 'dritter Eintrag ohne Warnung gespeichert');
    ok(true, 'Dritte Prüfung an einem anderen Tag: keine Warnung (erst ab drei in der Woche)');
    await lp.waitForSelector('#calNewBtn');
    await lp.click('#calNewBtn');
    await lp.waitForSelector('#calType');
    await lp.selectOption('#calType', 'pruefung');
    await lp.fill('#calTitle', 'Vierte Prüfung');
    const donnerstag = new Date(mittwoch); donnerstag.setDate(donnerstag.getDate() + 1);
    await lp.fill('#calDate', ds(donnerstag));
    await lp.click('#modalOk');
    await bis(async () => /In dieser Woche sind schon 3 Prüfungen/.test(await text(lp)), 'Wochen-Warnung erscheint');
    ok(true, 'Vierte Prüfung in der Woche: Warnung «schon 3 Prüfungen»');
    await lp.click('#modalCancel').catch(() => {});

    console.log('\n♿ Zeitzuschlag im Prüfungs-Monitor');
    await seedPruefung();
    await lp.evaluate(() => { const b = [...document.querySelectorAll('button, a')].find(x => /Klassenzimmer/.test(x.textContent)); if(b) b.click(); });
    await lp.waitForSelector('.kz-tile[data-tool="pruefung"]');
    await lp.click('.kz-tile[data-tool="pruefung"]');
    await lp.waitForSelector('.pr-karte[data-id="p1"]');
    await lp.click('.pr-karte[data-id="p1"]');
    await lp.waitForSelector('#prMon [data-a="zuschlag"]');
    await bis(async () => /Anna/.test(await lp.$eval('#prMon', e => e.innerText)) && /Ben/.test(await lp.$eval('#prMon', e => e.innerText)), 'Monitor zeigt die Klasse');
    const zeilen = await lp.$$eval('#prMon .pr-zeile', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
    const za = zeilen.find(z => /^Anna/.test(z)) || '', zb = zeilen.find(z => /^Ben/.test(z)) || '';
    ok(/♿ \+50 %/.test(za) && /1[34] Min\. übrig/.test(za), 'Anna: 10 Min. + 50 % → ca. 14 Min. übrig mit «♿ +50 %» (' + za.slice(0, 90) + ')');
    ok(!/♿/.test(zb) && /(8|9) Min\. übrig/.test(zb), 'Ben: ohne Zuschlag ca. 9 Min. übrig (' + zb.slice(0, 90) + ')');
    await lp.click('#prMon [data-a="zuschlag"]');
    await lp.waitForSelector('#zuOk');
    ok((await lp.$eval('[data-zu="u_anna"]', e => e.value)) === '50', 'Dialog zeigt Annas bisherigen Zuschlag (+50 %)');
    await lp.selectOption('[data-zu="u_ben"]', '25');
    await lp.click('#zuOk');
    await bis(async () => { const z = (await db.doc('klassen/' + K + '/pruefungen/p1').get()).data().zuschlag || {}; return z.u_ben === 25 && z.u_anna === 50; }, 'Zuschlag gespeichert');
    ok(true, 'Speichern: Ben +25 %, Anna +50 % stehen in der Prüfung');
    await bis(async () => { const zz = await lp.$$eval('#prMon .pr-zeile', els => els.map(e => e.innerText.replace(/\s+/g, ' '))); return /♿ \+25 %/.test(zz.find(z => /^Ben/.test(z)) || ''); }, 'Monitor zeigt Bens Zuschlag');
    ok(true, 'Monitor zeigt sofort «♿ +25 %» bei Ben');
  }catch(e){
    ok(false, 'Abbruch: ' + String(e.message).split('\n')[0]);
    if(process.env.DEBUG_DIR) for(const k of Object.keys(seiten || {})) await seiten[k].screenshot({ path: process.env.DEBUG_DIR + '/' + k + '.png' }).catch(() => {});
  }
  await browser.close();
  server.close();
  const eindeutig = [...new Set(fehler)];
  if(eindeutig.length){ console.log('\nFehler im Browser:'); eindeutig.forEach(f => console.log('  ⚠️ ' + f)); }
  const schlecht = pruefungen.filter(x => !x).length;
  console.log('\n' + (pruefungen.length - schlecht) + ' / ' + pruefungen.length + ' Prüfungen ok' + (eindeutig.length ? ', ' + eindeutig.length + ' Fehler im Browser' : ''));
  if(schlecht || eindeutig.length){ console.error('❌ Funktionstest fehlgeschlagen.'); process.exit(1); }
  console.log('✅ Funktionstest ok.');
  process.exit(0);
})().catch(e => { console.error('❌ Funktionstest abgebrochen:', e); process.exit(1); });
