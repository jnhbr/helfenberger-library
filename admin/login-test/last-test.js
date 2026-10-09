#!/usr/bin/env node
/**
 * Helfenberger's Library — Lasttest.
 *
 * Viele Schülergeräte gleichzeitig, wie bei der Vorstellung oder am Schulmorgen: die echte
 * index.html in Chromium, mit echtem Firebase-SDK und echter Anmeldung, aber gegen die
 * Firebase-Emulatoren (Anmeldung + Datenbank mit den echten firestore.rules) — NIE gegen die echte
 * Datenbank. Gemessen werden die App und die Regeln unter Gleichzeitigkeit; die Antwortzeiten der
 * echten Google-Server messen sie nicht (die sind in der Regel schneller als der Emulator).
 *
 *   cd admin/login-test && npm run last            (LAST_N=48 ist der Standard; LAST_N=24 für einen schwächeren Rechner)
 *
 * Ablauf: 1 Lehrperson + LAST_N Schüler:innen melden sich in Wellen an → alle sehen die Startseite →
 * die Lehrperson startet ein Klassen-Quiz in Teams → alle treten bei → alle antworten innerhalb
 * weniger Sekunden gleichzeitig → Auflösung. Geprüft wird: keine JavaScript-Fehler, kein
 * «permission-denied», alle Antworten kommen an, Zeiten bleiben unter den Grenzen unten.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST){
  console.error('❌ Dieser Test läuft nur in den Firebase-Emulatoren (npm run last) – nie gegen die echte Datenbank.');
  process.exit(1);
}
const admin = require('firebase-admin');
const { chromium } = require('playwright');

const N = Math.max(3, +process.env.LAST_N || 48);
const WELLE = Math.max(2, +process.env.LAST_WELLE || 8);
const GRENZE_LOGIN_MS = 25000, GRENZE_ANTWORT_MS = 20000;
const ROOT = path.resolve(__dirname, '..', '..');
const PREFIX = '/helfenberger-library/';
const DOM = '@helfenberger-library.app';
const K = 'G3b';
const TYPEN = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.css':'text/css', '.svg':'image/svg+xml' };
const pw = {};
const neuPw = name => (pw[name] = crypto.randomBytes(9).toString('base64url'));

admin.initializeApp({ projectId: 'demo-library' });
const db = admin.firestore(), auth = admin.auth();
const TS = admin.firestore.FieldValue.serverTimestamp();
const namen = Array.from({ length: N }, (_, i) => 's' + String(i + 1).padStart(2, '0'));

async function seed(){
  await auth.createUser({ uid:'u_lehrer', email:'testlehrer' + DOM, password:neuPw('testlehrer'), displayName:'Test Lehrperson' });
  await auth.setCustomUserClaims('u_lehrer', { teacher:true, klasse:K });
  await db.doc('students/u_lehrer').set({ username:'testlehrer', displayName:'Test Lehrperson', role:'teacher', klasse:K });
  for(const n of namen){
    const uid = 'u_' + n;
    await auth.createUser({ uid, email:n + DOM, password:neuPw(n), displayName:'Kind ' + n });
    await auth.setCustomUserClaims(uid, { klasse:K });
    await db.doc('students/' + uid).set({ username:n, displayName:'Kind ' + n, role:'student', klasse:K });
  }
  const frag = i => ({ q:'Frage ' + i + '?', a:['Richtig' + i, 'FalschA' + i, 'FalschB' + i, 'FalschC' + i], c:0, sec:30 });
  await db.doc('klassen/' + K + '/quizzes/quiz1').set({ title:'Lasttest-Quiz', subject:'', questions:[frag(1), frag(2)], createdAt:TS });
  for(let i = 0; i < 6; i++) await db.doc('klassen/' + K + '/resources/r' + i).set({ subject:'mathe', title:'Übung ' + (i + 1), fileName:'u' + i + '.html', order:i, contentId:'c' + i, uploadedAt:TS });
  await db.doc('klassen/' + K + '/calendarEntries/c1').set({ type:'hausaufgabe', subject:'mathe', title:'Seite 42', description:'', dueDate:new Date(Date.now() + 86400000).toISOString().slice(0, 10), createdAt:TS });
}

const pruefungen = [], fehler = [];
function ok(bed, text){ pruefungen.push(!!bed); console.log((bed ? '  ✅ ' : '  ❌ ') + text); }
const pr = (arr, q) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const sek = ms => (ms / 1000).toFixed(1) + ' s';
async function bis(fn, text, ms){
  const ende = Date.now() + (ms || 30000);
  for(;;){
    const v = await fn();
    if(v) return v;
    if(Date.now() > ende) throw new Error('Zeit abgelaufen: ' + text);
    await new Promise(r => setTimeout(r, 250));
  }
}

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
  const browser = await chromium.launch({ args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const seiten = {};

  async function geraet(name, breite){
    const ctx = await browser.newContext({ viewport: { width: breite || 420, height: 800 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', e => fehler.push(name + ': ' + e.message));
    page.on('console', m => { if(m.type() === 'error' && /permission|insufficient|FirebaseError|quota/i.test(m.text())) fehler.push(name + ' [Konsole] ' + m.text().slice(0, 200)); });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#loginPass');
    seiten[name] = page;
    return page;
  }
  async function anmelden(page, name){
    const t0 = Date.now();
    await page.fill('#loginName', name);
    await page.fill('#loginPass', pw[name]);
    await page.press('#loginPass', 'Enter');
    await page.waitForFunction(() => !document.getElementById('loginPass') && document.getElementById('subjectGrid'), null, { timeout: 60000 });
    return Date.now() - t0;
  }

  try{
    console.log('\n👥 ' + N + ' Schüler:innen + 1 Lehrperson, Anmeldung in Wellen zu ' + WELLE);
    const lp = await geraet('testlehrer', 1280);
    await anmelden(lp, 'testlehrer');
    const loginMs = [];
    const tAlle0 = Date.now();
    for(let i = 0; i < namen.length; i += WELLE){
      const welle = namen.slice(i, i + WELLE);
      const res = await Promise.all(welle.map(async n => { await geraet(n); return anmelden(seiten[n], n); }));
      loginMs.push(...res);
    }
    console.log('  ⏱ Anmeldung: Median ' + sek(pr(loginMs, 0.5)) + ' · 95 % ' + sek(pr(loginMs, 0.95)) + ' · langsamste ' + sek(Math.max(...loginMs)) + ' · alle drin nach ' + sek(Date.now() - tAlle0));
    ok(loginMs.length === N, 'Alle ' + N + ' Schüler:innen sind angemeldet');
    ok(Math.max(...loginMs) < GRENZE_LOGIN_MS, 'Keine Anmeldung dauert länger als ' + sek(GRENZE_LOGIN_MS));
    const homeOk = (await Promise.all(namen.map(n => seiten[n].evaluate(() => /Willkommen/.test(document.body.innerText))))).filter(Boolean).length;
    ok(homeOk === N, 'Alle sehen die Startseite («Willkommen») — ' + homeOk + ' von ' + N);

    console.log('\n📚 Alle öffnen gleichzeitig das Fach Mathematik');
    const t1 = Date.now();
    await Promise.all(namen.map(n => seiten[n].click('.subject-card[data-subject="mathe"]')));
    const faecher = await Promise.all(namen.map(n => seiten[n].waitForSelector('#card-r5', { timeout: 60000 }).then(() => Date.now() - t1).catch(() => -1)));
    const fach_ok = faecher.filter(x => x >= 0);
    console.log('  ⏱ Fach geöffnet: Median ' + sek(pr(fach_ok, 0.5)) + ' · 95 % ' + sek(pr(fach_ok, 0.95)));
    ok(fach_ok.length === N, 'Alle sehen die sechs Übungen im Fach — ' + fach_ok.length + ' von ' + N);
    await Promise.all(namen.map(n => seiten[n].click('#backBtn').catch(() => {})));

    console.log('\n🎮 Klassen-Quiz in Teams, alle antworten gleichzeitig');
    await lp.evaluate(() => { const b = [...document.querySelectorAll('button, a')].find(x => /Klassenzimmer/.test(x.textContent)); b.click(); });
    await lp.waitForSelector('.kz-tile[data-tool="quiz"]');
    await lp.click('.kz-tile[data-tool="quiz"]');
    await lp.waitForSelector('[data-start]');
    await lp.click('[data-start]');
    await lp.waitForSelector('#qzTeams');
    await lp.selectOption('#qzTeams', '6');
    await lp.click('#qzGo');
    await lp.waitForSelector('#qhStage');
    const tJoin0 = Date.now();
    const join = await Promise.all(namen.map(async n => {
      const p = seiten[n];
      await p.waitForSelector('#quizJoinBtn:not([hidden])', { timeout: 60000 });
      await p.click('#quizJoinBtn');
      return Date.now() - tJoin0;
    }).map(pm => pm.catch(() => -1)));
    const joinOk = join.filter(x => x >= 0);
    await bis(async () => Object.keys(((await db.doc('klassen/' + K + '/quizSessions/aktiv').get()).data() || {}).teams || {}).length === N, 'alle in einem Team', 60000).catch(() => {});
    const teams = Object.keys(((await db.doc('klassen/' + K + '/quizSessions/aktiv').get()).data() || {}).teams || {}).length;
    console.log('  ⏱ Beitreten: Median ' + sek(pr(joinOk, 0.5)) + ' · langsamste ' + sek(Math.max(0, ...joinOk)));
    ok(teams === N, 'Alle ' + N + ' sind einem Team zugeteilt — ' + teams + ' von ' + N);

    await lp.click('#qhNext');
    const tFrage = Date.now();
    const antw = await Promise.all(namen.map(async n => {
      const p = seiten[n];
      await p.waitForSelector('[data-choice]:not(:disabled)', { timeout: 60000 });
      const i = await p.$$eval('[data-choice]', e => +e.find(x => /Richtig/.test(x.textContent)).getAttribute('data-choice'));
      await p.click('[data-choice="' + i + '"]');
      return Date.now() - tFrage;
    }).map(pm => pm.catch(() => -1)));
    const antwOk = antw.filter(x => x >= 0);
    console.log('  ⏱ Antworten: Median ' + sek(pr(antwOk, 0.5)) + ' · 95 % ' + sek(pr(antwOk, 0.95)) + ' · langsamste ' + sek(Math.max(0, ...antwOk)));
    ok(antwOk.length === N, 'Alle ' + N + ' haben geantwortet — ' + antwOk.length + ' von ' + N);
    await bis(async () => ((await db.doc('klassen/' + K + '/quizSessions/aktiv').get()).data() || {}).state === 'aufloesung', 'Quiz löst auf', 40000);
    ok(true, 'Das Quiz löst von selbst auf, nachdem alle geantwortet haben (' + sek(Date.now() - tFrage) + ' nach dem Start der Frage)');
    ok(Math.max(0, ...antwOk) < GRENZE_ANTWORT_MS, 'Alle Antworten sind innerhalb von ' + sek(GRENZE_ANTWORT_MS) + ' angekommen');
    await bis(async () => { const q = await db.collection('klassen/' + K + '/quizSessions/aktiv/spieler').get(); return q.size === N && q.docs.every(d => d.data().score > 0); }, 'alle Spieler mit Punkten gespeichert', 40000).catch(() => {});
    const spieler = await db.collection('klassen/' + K + '/quizSessions/aktiv/spieler').get();
    ok(spieler.size === N && spieler.docs.every(d => d.data().score > 0), 'Das Lehrergerät hat für alle ' + N + ' Punkte geschrieben — ' + spieler.size + ' Spieler, alle > 0');
    const mb = Math.round(process.memoryUsage().rss / 1048576);
    console.log('  ℹ️ Testprozess belegt ' + mb + ' MB (die ' + (N + 1) + ' Browserfenster zusätzlich)');
  }catch(e){
    ok(false, 'Abbruch: ' + String(e.message).split('\n')[0]);
  }
  await browser.close().catch(() => {});
  server.close();
  const eindeutig = [...new Set(fehler)];
  if(eindeutig.length){ console.log('\nFehler im Browser:'); eindeutig.slice(0, 15).forEach(f => console.log('  ⚠️ ' + f)); if(eindeutig.length > 15) console.log('  … und ' + (eindeutig.length - 15) + ' weitere'); }
  const schlecht = pruefungen.filter(x => !x).length;
  console.log('\n' + (pruefungen.length - schlecht) + ' / ' + pruefungen.length + ' Prüfungen ok' + (eindeutig.length ? ', ' + eindeutig.length + ' Fehler im Browser' : ''));
  if(schlecht || eindeutig.length){ console.error('❌ Lasttest fehlgeschlagen.'); process.exit(1); }
  console.log('✅ Lasttest ok: ' + N + ' Geräte gleichzeitig ohne Fehler.');
  process.exit(0);
})().catch(e => { console.error('❌ Lasttest abgebrochen:', e); process.exit(1); });
