#!/usr/bin/env node
/**
 * Helfenberger's Library — echter Login-Test.
 *
 * Die echte index.html läuft in Chromium, mit dem echten Firebase-SDK, und
 * meldet sich über die Login-Maske an — aber gegen die lokalen Firebase-
 * Emulatoren (Anmeldung + Datenbank mit den echten firestore.rules), NIE gegen
 * die echte Datenbank. Dafür hat index.html die Weiche ?emu=1 (nur auf
 * localhost / 127.0.0.1, eigener Projektname «demo-library»).
 *
 *   cd admin/login-test && npm install && npx playwright install chromium
 *   npm test          (braucht Java 21 für die Emulatoren)
 *
 * Läuft bei jedem Push als GitHub Action im Test-Repo (.github/workflows/pruefen.yml, Job «login»).
 *
 * Was geprüft wird (ein Lehrergerät + drei Schülergeräte, jedes ein eigener Browser):
 *   - Anmelden: falsches Passwort wird abgelehnt, richtiges führt zur Startseite
 *   - Klassenzimmer mit der Rubrik «Spiele»
 *   - 🎯 Schätzmeister, 🔔 Buzzer, 🎱 Bingo, 💰 Millionär und 🎮 Klassen-Quiz in Teams:
 *     je eine Runde von der Wartelobby bis zur Auflösung, mit den echten Regeln
 *   - eine Klasse sieht das Spiel einer anderen Klasse nicht
 *   - kein JavaScript-Fehler und kein «permission-denied» während der Spiele
 * Die Konten entstehen bei jedem Lauf neu im Emulator, mit zufälligen Passwörtern.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST){
  console.error('❌ Dieser Test läuft nur in den Firebase-Emulatoren (npm test) – nie gegen die echte Datenbank.');
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

function fragen(){
  const kats = ['Schweiz', 'Europa', 'Welt', 'Natur'], out = [];
  for(let i = 0; i < 24; i++) out.push({ q:'Frage ' + (i + 1) + ' (' + kats[i % 4] + ')?', a:['Richtig' + (i + 1), 'FalschA' + (i + 1), 'FalschB' + (i + 1), 'FalschC' + (i + 1)], c:0, st:1 + (i % 3), kat:kats[i % 4] });
  return out;
}
async function seed(){
  const leute = [['testlehrer', 'Test Lehrperson', 'teacher', K], ['anna', 'Anna', 'student', K], ['ben', 'Ben', 'student', K], ['cem', 'Cem', 'student', K], ['zoe', 'Zoe', 'student', 'G3a']];
  for(const [u, name, role, klasse] of leute){
    const uid = 'u_' + u;
    await auth.createUser({ uid, email: u + DOM, password: neuPw(u), displayName: name });
    await auth.setCustomUserClaims(uid, role === 'teacher' ? { teacher: true, klasse } : { klasse });
    await db.doc('students/' + uid).set({ username: u, displayName: name, role, klasse });
  }
  const TS = admin.firestore.FieldValue.serverTimestamp();
  await db.doc('klassen/' + K + '/quizzes/set1').set({ art:'million', title:'Geografie-Mix', subject:'geografie', folderId:null, questions:fragen(), createdAt:TS });
  await db.doc('klassen/' + K + '/quizzes/quiz1').set({ title:'Kurzquiz', subject:'', questions:fragen().slice(0, 3).map(f => ({ q:f.q, a:f.a, c:f.c, sec:20 })), createdAt:TS });
  await db.doc('klassen/' + K + '/quizzes/sch1').set({ art:'schaetz', title:'Schätzen Schweiz', subject:'', questions:[{ q:'Wie hoch ist das Matterhorn?', w:4478, e:'m' }] });
}

const pruefungen = [], fehler = [];
function ok(bed, text){ pruefungen.push(!!bed); console.log((bed ? '  ✅ ' : '  ❌ ') + text); }
const warte = (p, ms) => p.waitForTimeout(ms);
const sess = async id => { const s = await db.doc('klassen/' + K + '/quizSessions/' + id).get(); return s.exists ? s.data() : {}; };
async function bis(fn, text, ms){
  const ende = Date.now() + (ms || 15000);
  for(;;){
    const v = await fn();
    if(v) return v;
    if(Date.now() > ende) throw new Error('Zeit abgelaufen: ' + text);
    await new Promise(r => setTimeout(r, 200));
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

  async function geraet(name, breite){
    const ctx = await browser.newContext({ viewport: { width: breite || 1280, height: 800 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', e => fehler.push(name + ': ' + e.message));
    page.on('console', m => { if(m.type() === 'error' && /permission|insufficient|FirebaseError/i.test(m.text())) fehler.push(name + ' [Konsole] ' + m.text().slice(0, 300)); });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#loginPass');
    return page;
  }
  async function anmelden(page, name, passwort){
    await page.fill('#loginName', name);
    await page.fill('#loginPass', passwort);
    await page.press('#loginPass', 'Enter');
  }
  async function drin(page){ await page.waitForFunction(() => !document.getElementById('loginPass'), null, { timeout: 30000 }); await warte(page, 800); }
  async function kz(lp){
    await lp.evaluate(() => { const b = [...document.querySelectorAll('button, a')].find(x => /Klassenzimmer/.test(x.textContent)); b.click(); });
    await lp.waitForSelector('.kz-tile[data-tool="schaetz"]');
  }
  const sText = p => p.$eval('.lsp-s', e => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');

  try{
    console.log('\n🔑 Anmelden');
    const lp = await geraet('lehrperson');
    await anmelden(lp, 'testlehrer', 'ganz-falsch-' + Date.now());
    await warte(lp, 2500);
    ok(!!(await lp.$('#loginPass')), 'Falsches Passwort: bleibt bei der Anmeldung');
    await anmelden(lp, 'testlehrer', pw.testlehrer);
    await drin(lp);
    ok(/Klassenzimmer/.test(await lp.evaluate(() => document.body.innerText)), 'Lehrperson ist angemeldet und sieht «Klassenzimmer»');
    const sus = {};
    for(const n of ['anna', 'ben', 'cem']){ sus[n] = await geraet(n, 420); await anmelden(sus[n], n, pw[n]); await drin(sus[n]); }
    const zoe = await geraet('zoe', 420); await anmelden(zoe, 'zoe', pw.zoe); await drin(zoe);
    ok(!/Klassenzimmer/.test(await sus.anna.evaluate(() => document.body.innerText)), 'Schülerin ist angemeldet und sieht kein «Klassenzimmer»');
    const alle = [sus.anna, sus.ben, sus.cem];

    await kz(lp);
    const spiele = await lp.evaluate(() => { const h = [...document.querySelectorAll('.kz-bereich')].find(x => /Spiele/.test(x.textContent)); return h ? [...h.nextElementSibling.querySelectorAll('.kz-tile')].map(t => t.getAttribute('data-tool')) : []; });
    ok(['quiz', 'million', 'schaetz', 'bingo', 'buzzer', 'preis', 'drei', 'schiffe'].every(x => spiele.includes(x)), 'Klassenzimmer: Rubrik «Spiele» mit allen Spielen');

    console.log('\n🎯 Schätzmeister');
    await lp.click('.kz-tile[data-tool="schaetz"]');
    await lp.waitForSelector('[data-schs]');
    await lp.click('[data-schs]');
    await lp.waitForSelector('#lspStage');
    await bis(async () => (await lp.$$eval('#lspStage .lsp-kind.on', e => e.length)) === 3, 'drei Geräte in der Wartelobby');
    ok(true, 'Wartelobby: alle drei Geräte haben sich von selbst gemeldet');
    ok(/Du bist dabei/.test(await sText(sus.anna)), 'Das Spiel öffnet sich auf dem Schülergerät von selbst');
    ok(!(await zoe.$('.lsp-s')) && (await zoe.$eval('#lspJoinBtn', e => e.hidden)), 'Die andere Klasse (G3a) sieht das Spiel nicht');
    await lp.click('[data-lh="los"]');
    const tipps = ['4478', "4'000", '6000'];
    for(let i = 0; i < 3; i++){ await alle[i].waitForSelector('#schaetzFeld'); await alle[i].fill('#schaetzFeld', tipps[i]); await alle[i].click('[data-ls="tipp"]'); }
    await lp.waitForSelector('[data-lh="auf"]');
    ok((await lp.$$eval('.sch-punkt', e => e.length)) === 3, 'Alle haben getippt: die Runde schliesst von selbst, drei Punkte auf dem Zahlenstrahl');
    await lp.click('[data-lh="auf"]');
    await lp.waitForSelector('.sch-loesung');
    let s = await sess('spiel');
    ok(s.phase === 'aufgeloest' && s.loesung === 4478 && s.tipps.length === 3 && s.rang[0].n === 'Anna' && s.rang[0].p === 4, 'Auflösung in der Datenbank: Anna liegt mit 4 Punkten vorn');
    await bis(async () => /Volltreffer/.test(await sText(sus.anna)), 'Schülergerät zeigt den Volltreffer');
    ok(true, 'Schülergerät zeigt Rang und Volltreffer');
    await lp.click('[data-lh="ende"]');
    await lp.waitForSelector('[data-lh="schluss"]');
    await lp.click('[data-lh="schluss"]');
    await bis(async () => (await sess('spiel')).aktiv === false, 'Spiel beendet');

    console.log('\n🔔 Buzzer');
    await kz(lp);
    await lp.click('.kz-tile[data-tool="buzzer"]');
    await lp.waitForSelector('[data-spq]');
    await lp.click('[data-spq="1"]');
    await lp.click('#spqOk');
    await lp.waitForSelector('#bzGo');
    await lp.selectOption('#bzTeams', '2');
    await lp.click('#bzGo');
    await lp.waitForSelector('#lspStage');
    await bis(async () => (await lp.$$eval('#lspStage .lsp-kind.on', e => e.length)) === 3, 'drei Geräte in der Buzzer-Lobby');
    await lp.click('[data-lh="los"]');
    for(const p of alle) await p.waitForSelector('.bz-knopf.frei');
    s = await sess('spiel');
    ok(Object.keys(s.teams || {}).length === 3, 'Drei Kinder auf zwei Teams verteilt');
    await sus.ben.click('.bz-knopf');
    await lp.waitForSelector('.bz-wer:not(.frei)');
    ok(/Ben/.test(await lp.$eval('.bz-wer', e => e.textContent)), 'Wer drückt, ist dran (Reihenfolge nach Server-Zeit)');
    await bis(async () => /Du bist dran/.test(await sText(sus.ben)), 'Ben sieht «Du bist dran»');
    const richtig = await lp.$$eval('.lsp-opt', e => e.findIndex(x => /Richtig/.test(x.textContent)));
    await lp.click('.lsp-opt[data-i="' + richtig + '"]');
    await bis(async () => (await sess('spiel')).phase === 'aufgeloest', 'Buzzer aufgelöst');
    s = await sess('spiel');
    ok(s.ok === true && s.rang[0].n === 'Ben' && s.rang[0].p === 1 && (s.teamP[0] + s.teamP[1]) === 1, 'Richtige Antwort: Punkt für Ben und sein Team');
    await lp.click('[data-lh="ende"]');
    await lp.waitForSelector('[data-lh="schluss"]');
    await lp.click('[data-lh="schluss"]');
    await bis(async () => (await sess('spiel')).aktiv === false, 'Spiel beendet');

    console.log('\n🎱 Bingo');
    await kz(lp);
    await lp.click('.kz-tile[data-tool="bingo"]');
    await lp.waitForSelector('[data-spq]');
    await lp.click('[data-spq="0"]');
    await lp.click('#spqOk');
    await lp.waitForSelector('#bgGo');
    await lp.click('#bgGo');
    await lp.waitForSelector('#lspStage');
    await bis(async () => (await lp.$$eval('#lspStage .lsp-kind.on', e => e.length)) === 3, 'drei Geräte in der Bingo-Lobby');
    await lp.click('[data-lh="los"]');
    // So viele Fragen, bis mindestens ein Kind die Antwort auf der Karte hat (höchstens acht).
    let getippt = 0, gruen = 0, antwort = '', runden = 0;
    while(!getippt && runden < 8){
      runden++;
      for(const p of alle) await p.waitForSelector('.bg-feld[data-zeit]');
      await lp.waitForSelector('#lspTimer');
      antwort = 'Richtig' + (/Frage (\d+)/.exec(await lp.$eval('.lsp-frage', e => e.innerText)) || [])[1];
      for(const p of alle){
        const i = await p.$$eval('.bg-feld', (e, r) => e.findIndex(x => x.textContent === r), antwort);
        if(i >= 0){ await p.click('.bg-feld[data-i="' + i + '"]'); getippt++; }
      }
      await warte(lp, 600);
      await lp.click('[data-lh="auf"]');
      await lp.waitForSelector('.lsp-loesung');
      if(!getippt){ await lp.click('[data-lh="weiter"]'); }
    }
    ok((await lp.$eval('.lsp-loesung', e => e.textContent)) === antwort, 'Lösung am Beamer: ' + antwort);
    await warte(lp, 800);
    for(const p of alle) gruen += await p.$$eval('.bg-feld.ok', e => e.length);
    ok(getippt > 0 && gruen === getippt, 'Jedes richtig getippte Feld ist grün (' + gruen + ' von ' + getippt + ', nach ' + runden + ' Frage' + (runden === 1 ? '' : 'n') + ')');
    await lp.click('[data-lh="ende"]');
    await lp.waitForSelector('[data-lh="schluss"]');
    await lp.click('[data-lh="schluss"]');
    await bis(async () => (await sess('spiel')).aktiv === false, 'Spiel beendet');

    console.log('\n💰 Wer wird Millionär');
    await kz(lp);
    await lp.click('.kz-tile[data-tool="million"]');
    await lp.waitForSelector('[data-mspiel]');
    await lp.click('[data-mspiel]');
    await lp.waitForSelector('#mioGo');
    await lp.click('#mioGo');
    await lp.waitForSelector('#mioStage');
    await bis(async () => (await lp.$$eval('#mioStage .mio-kind.on', e => e.length)) === 3, 'drei Geräte in der Millionär-Lobby');
    await lp.click('[data-mio="weiter"]');
    for(const p of alle){
      await p.waitForSelector('.mio-s-opts .mio-opt:not(:disabled)');
      const i = await p.$$eval('.mio-s-opts .mio-opt', e => e.findIndex(x => /Richtig/.test(x.textContent)));
      await p.click('.mio-s-opts .mio-opt[data-mv="' + i + '"]');
    }
    await lp.waitForSelector('[data-mio="auf"]');
    await lp.click('[data-mio="auf"]');
    await bis(async () => (await sess('million')).phase === 'aufgeloest', 'Millionär aufgelöst');
    s = await sess('million');
    ok(s.ok === true && s.pos === 1, 'Die Mehrheit stimmt richtig: erste Stufe erreicht');
    await lp.click('#mioClose');
    await lp.click('#modalOk');
    await bis(async () => (await sess('million')).aktiv === false, 'Millionär beendet');

    console.log('\n🎮 Klassen-Quiz in Teams');
    await kz(lp);
    await lp.click('.kz-tile[data-tool="quiz"]');
    await lp.waitForSelector('[data-start]');
    await lp.click('[data-start]');
    await lp.waitForSelector('#qzTeams');
    await lp.selectOption('#qzTeams', '2');
    await lp.click('#qzGo');
    await lp.waitForSelector('#qhStage');
    for(const p of alle){ await p.waitForSelector('#quizJoinBtn:not([hidden])'); await p.click('#quizJoinBtn'); }
    await bis(async () => Object.keys((await sess('aktiv')).teams || {}).length === 3, 'alle drei haben ein Team');
    ok(true, 'Alle drei sind einem Team zugeteilt');
    await bis(async () => /Du bist im Team/.test(await sus.anna.$eval('.qp-wrap', e => e.innerText)), 'Team steht auf dem Schülergerät');
    ok(true, 'Schülergerät zeigt das eigene Team');
    await lp.click('#qhNext');
    for(const p of alle){
      await p.waitForSelector('[data-choice]:not(:disabled)');
      const i = await p.$$eval('[data-choice]', e => +e.find(x => /Richtig/.test(x.textContent)).getAttribute('data-choice'));
      await p.click('[data-choice="' + i + '"]');
    }
    await bis(async () => (await sess('aktiv')).state === 'aufloesung', 'Quiz löst von selbst auf');
    await lp.waitForFunction(() => { const b = document.querySelector('.qh-team b'); return b && +b.textContent > 0; });
    ok(!(await lp.$('.qh-lead')), 'Am Beamer steht der Team-Stand, keine Einzel-Rangliste');
    const spieler = await db.collection('klassen/' + K + '/quizSessions/aktiv/spieler').get();
    ok(spieler.size === 3 && spieler.docs.every(d => d.data().score > 0), 'Punkte hat das Lehrergerät geschrieben (alle drei > 0)');
    await lp.click('#qhClose');
    await lp.click('#modalOk');
  }catch(e){
    ok(false, 'Abbruch: ' + String(e.message).split('\n')[0]);
  }
  await browser.close();
  server.close();
  const eindeutig = [...new Set(fehler)];
  if(eindeutig.length){ console.log('\nFehler im Browser:'); eindeutig.forEach(f => console.log('  ⚠️ ' + f)); }
  const schlecht = pruefungen.filter(x => !x).length;
  console.log('\n' + (pruefungen.length - schlecht) + ' / ' + pruefungen.length + ' Prüfungen ok' + (eindeutig.length ? ', ' + eindeutig.length + ' Fehler im Browser' : ''));
  if(schlecht || eindeutig.length){ console.error('❌ Login-Test fehlgeschlagen.'); process.exit(1); }
  console.log('✅ Login-Test ok: Anmeldung, Regeln und alle Live-Spiele funktionieren mit echten Konten im Emulator.');
  process.exit(0);
})().catch(e => { console.error('❌ Login-Test abgebrochen:', e); process.exit(1); });
