#!/usr/bin/env node
/**
 * Helfenberger's Library — Ablauf-Test: die Wege, auf denen im Betrieb am meisten hängt.
 *
 * Wie login-test.js: die echte index.html in Chromium gegen die Firebase-Emulatoren
 * (Anmeldung + Datenbank mit den echten firestore.rules), nie gegen die echte Datenbank.
 *
 *   cd admin/login-test && npm run ablauf
 *
 * Läuft bei jedem Push als GitHub Action im Test-Repo (.github/workflows/pruefen.yml, Job «ablauf»).
 *
 * Geprüft wird:
 *   🔄 Übungsstand auf zwei Geräten   Laptop → Cloud → Handy → zurück auf den offenen Laptop;
 *                                      ein leeres Gerät überschreibt nichts; Fortschritt in Prozent
 *   📝 Prüfung von Anfang bis Note     freigeben → Warteraum → starten → schreiben → abgeben →
 *                                      Resultate freigeben → Punkte und Note bei der Schülerin;
 *                                      Seite neu laden = gesperrt, Lehrperson entsperrt
 *   📮 Briefkasten                     Lehrperson stellt ihn auf, Schülerin wirft eine Datei ein,
 *                                      Quittung + Übersicht «1 von 2 eingeworfen»
 *                                      (nicht geprüft: «Leeren» in einen Ordner – braucht einen echten Ordner-Dialog)
 *   👀 Schulleitung                    sieht alles, kann nichts anlegen oder einwerfen
 *   🎯 Lernziele                       Ordner mit Lernzielen: Selbsteinschätzung, «Dazu üben» gibt der Übung die
 *                                      Fragen mit, Übungsstand pro Lernziel, Raster der Lehrperson
 */
const B = require('./_basis.js');
const { db, ok, bis, abschnitt } = B;
const K = 'G3b';

// Eine kleine Übung, wie die echten Übungsseiten: Stand in localStorage, Fortschritt per Meldung an die Library.
const UEBUNG = '<!doctype html><html><head><meta charset="utf-8"><title>Sync-Übung</title></head><body>' +
  '<input id="eingabe"><button id="melden" type="button">melden</button><script>' +
  'var K="ablauftest_v1", e=document.getElementById("eingabe");' +
  'e.value=localStorage.getItem(K)||"";' +
  'e.addEventListener("input",function(){localStorage.setItem(K,e.value);});' +
  'document.getElementById("melden").addEventListener("click",function(){parent.postMessage({__libProgress:true,stats:{q1:{status:"correct"},q2:{status:"wrong"}},total:2},"*");});' +
  '<\/script></body></html>';

// Übung, die das Lernziel-Protokoll spricht (wie die echten Übungsseiten ab 11.11.2026).
const LZ_UEBUNG = '<!doctype html><html><head><meta charset="utf-8"><title>Lernziel-Übung</title></head><body>' +
  '<div id="start"></div><div id="ziele"></div><button id="melden" type="button">melden</button><button id="schaetzen" type="button">schätzen</button><script>' +
  'window.addEventListener("message",function(e){var d=e.data||{};' +
  'if(d.__libStart)document.getElementById("start").textContent=d.__libStart.titel+":"+d.__libStart.ids.slice().sort().join(",");' +
  'if(d.__libLernziele)document.getElementById("ziele").textContent=JSON.stringify(d.__libLernziele);});' +
  'document.getElementById("melden").addEventListener("click",function(){parent.postMessage({__libProgress:true,stats:{q1:{status:"correct"},q2:{status:"wrong"}},total:3},"*");});' +
  'document.getElementById("schaetzen").addEventListener("click",function(){parent.postMessage({__libLernziel:true,idx:1,val:"amber"},"*");});' +
  'parent.postMessage({__libBereit:true,ziele:{2:"red"}},"*");' +
  '<\/script></body></html>';
const LZ_SET = { id: 'lz_test', titel: 'Test-Lernziele', ziele: [{ nr: 1, text: 'Erstes Lernziel' }, { nr: 2, text: 'Zweites Lernziel' }, { nr: 3, text: 'Drittes Lernziel' }],
  fragen: { r_lz: { q1: [1], q2: [1], q3: [2] } } };
const lzDoc = uid => db.doc('progress/' + uid + '/erledigt/lernziele').get().then(s => (s.data() || {}).lz_test || {});

async function seed(){
  await db.doc('klassen/' + K + '/folders/f_lz').set({ subject: 'mathe', parentId: null, name: 'Lernziel-Ordner', order: 1, lernziele: [LZ_SET] });
  await B.uebung(K, 'r_lz', { subject: 'mathe', title: 'Lernziel-Übung', folderId: 'f_lz' }, LZ_UEBUNG);
  await B.konto('testlehrer', 'Test Lehrperson', 'teacher', K);
  await B.konto('anna', 'Anna', 'student', K);
  await B.konto('ben', 'Ben', 'student', K);
  await B.konto('schulleitung', 'Schulleitung', 'leitung', K);
  // Ämtliplan erst ab 2099: sonst verdeckt «Heute bist du mit dem Ämtli dran» an manchen Tagen die Klicks.
  await db.doc('klassen/' + K + '/klasseninfo/aemtli').set({ startDate: '2099-01-06' });
  await B.uebung(K, 'r_sync', { subject: 'mathe', title: 'Sync-Übung' }, UEBUNG);
  // Eine Prüfung als Entwurf, so wie der Editor sie ablegt: Fragen ohne Lösungen, Lösungen nur für die Lehrperson.
  await db.doc('klassen/' + K + '/pruefungen/' + PID).set({ titel: 'Ablauf-Prüfung', skala: { typ: 'dbk' }, punkteFuer6: null, fehlerAbzug: null, rundung: 0.1,
    fach: 'mathe', gewicht: 1, zeitMin: null, art: 'bank', diktat: false, subject: 'mathe', seed: 1, bilder: [], maxPunkte: 4,
    // 🎯 Lernziele: q0/q1 über die Frage-ID der Übung (qid → Lernziel 1 bzw. 2), q2 direkt (lz).
    resourceId: 'r_lz', resourceTitel: 'Lernziel-Übung',
    fragen: [
      { id: 'q0', typ: 'tf', frage: 'Die Erde ist rund.', kat: 'Test', punkte: 1, qid: 'q1' },
      { id: 'q1', typ: 'mc', frage: 'Wie viel gibt 2 + 2?', kat: 'Test', punkte: 2, optionen: ['3', '4', '5'], qid: 'q3' },
      { id: 'q2', typ: 'text', frage: 'Wie heisst die Bundesstadt der Schweiz?', kat: 'Test', punkte: 1, lz: [3] }
    ],
    cfg: { optionen: {}, optNamen: {}, anzahl: 3, mischen: false }, status: 'entwurf', resultateFrei: false, createdAt: B.TS, createdBy: 'u_testlehrer' });
  await db.doc('klassen/' + K + '/pruefungen/' + PID + '/intern/loesung').set({ loesungen: {
    q0: { loesung: true, anzeige: 'Wahr', punkte: 1 }, q1: { loesung: 1, anzeige: '4', punkte: 2 }, q2: { loesung: ['Bern'], anzeige: 'Bern', punkte: 1 } } });
}
const PID = 'p_ablauf';
const pruefDoc = () => db.doc('klassen/' + K + '/pruefungen/' + PID).get().then(s => s.data() || {});
const teilnahme = uid => db.doc('klassen/' + K + '/pruefungen/' + PID + '/teilnahmen/' + uid).get().then(s => s.data() || null);

const standDoc = () => db.doc('progress/u_anna/resources/r_sync').get().then(s => s.data() || {});
const standWert = async () => { try{ return JSON.parse((await standDoc()).storeJson || '{}').ablauftest_v1 || ''; }catch(e){ return ''; } };
const feld = p => p.frameLocator('#resourceFrame').locator('#eingabe');
async function oeffnen(p){ await p.click('#open-r_sync'); await p.waitForSelector('#resourceFrame'); await feld(p).waitFor(); }
async function verlassen(p){ await p.click('#backBtn'); await p.waitForSelector('#open-r_sync'); }
const feldWert = p => feld(p).inputValue().catch(() => null);

(async () => {
  await seed();
  await B.start();

  await abschnitt('🔄 Übungsstand auf zwei Geräten', async () => {
    const laptop = await B.geraet('anna-laptop'), handy = await B.geraet('anna-handy', 420);
    await B.anmelden(laptop, 'anna'); await B.anmelden(handy, 'anna');
    await B.fach(laptop, 'mathe'); await B.fach(handy, 'mathe');

    await oeffnen(laptop);
    await feld(laptop).fill('eins');
    await bis(async () => (await standWert()) === 'eins', 'Stand «eins» in der Cloud', 30000);
    ok(true, 'Laptop: Eingabe landet ohne Verlassen der Übung in der Cloud');

    await oeffnen(handy);
    ok((await feldWert(handy)) === 'eins', 'Handy öffnet die Übung mit dem Stand vom Laptop');

    await feld(handy).fill('zwei');
    await verlassen(handy);
    await bis(async () => (await standWert()) === 'zwei', 'Stand «zwei» in der Cloud');
    ok(true, 'Handy: beim Verlassen wird sofort gespeichert');

    await bis(async () => (await feldWert(laptop)) === 'zwei', 'offener Laptop zeigt «zwei»', 40000);
    ok(true, 'Der offen gebliebene Laptop holt den neueren Stand vom Handy von selbst');

    // Ein Gerät ohne eigenen Stand (neuer Browser) darf den Cloud-Stand nie mit «leer» überschreiben.
    const neu = await B.geraet('anna-neu', 420);
    await B.anmelden(neu, 'anna'); await B.fach(neu, 'mathe');
    await oeffnen(neu);
    const gesehen = await feldWert(neu);
    await verlassen(neu);
    await neu.waitForTimeout(1500);
    ok(gesehen === 'zwei' && (await standWert()) === 'zwei', 'Neues, leeres Gerät sieht «zwei» und überschreibt nichts');

    // Hin und her bei beidseits offener Übung: jeder Stand kommt beim anderen Gerät an, der spätere gilt.
    await oeffnen(handy);
    await feld(laptop).fill('drei');
    await verlassen(laptop);
    await bis(async () => (await standWert()) === 'drei', 'Stand «drei» in der Cloud');
    await bis(async () => (await feldWert(handy)) === 'drei', 'Handy zeigt «drei»', 40000);
    await feld(handy).fill('vier');
    await verlassen(handy);
    await bis(async () => (await standWert()) === 'vier', 'Stand «vier» in der Cloud');
    await oeffnen(laptop);
    ok((await feldWert(laptop)) === 'vier', 'Laptop öffnet danach mit «vier» – beide Geräte sind gleich');

    // Fortschritt: die Übung meldet 1 von 2 richtig → steht in der Datenbank und auf der Karte.
    await laptop.frameLocator('#resourceFrame').locator('#melden').click();
    await verlassen(laptop);
    await bis(async () => { const s = (await standDoc()).stats || {}; return s.q1 && s.q1.status === 'correct' && s.q2 && s.q2.status === 'wrong'; }, 'Fortschritt gespeichert');
    ok(true, 'Fortschrittsmeldung der Übung steht in der Datenbank');
    await bis(async () => /50\s*%/.test(await laptop.$eval('#card-r_sync', e => e.innerText)), 'Karte zeigt 50 %');
    ok(true, 'Die Übungskarte zeigt «50 %»');
    for(const p of [laptop, handy, neu]) await p.context().close();
  });

  await abschnitt('📝 Prüfung von Anfang bis Note', async () => {
    const lp = await B.geraet('lehrperson'), anna = await B.geraet('anna', 1100), ben = await B.geraet('ben', 1100);
    await B.anmelden(lp, 'testlehrer'); await B.anmelden(anna, 'anna'); await B.anmelden(ben, 'ben');
    await B.klassenzimmer(lp);
    await lp.click('.kz-tile[data-tool="pruefung"]');
    await B.aufklappen(lp, '.pr-karte[data-id="' + PID + '"]');
    await lp.click('.pr-karte[data-id="' + PID + '"]');
    await lp.waitForSelector('#prMon [data-a="freigeben"]');
    ok(!(await anna.isVisible('#pruefungBtn')), 'Entwurf: bei der Schülerin steht noch nichts von einer Prüfung');

    await lp.click('#prMon [data-a="freigeben"]');
    await lp.click('.modal button:has-text("Normaler Browser")');
    await bis(async () => (await pruefDoc()).status === 'offen', 'Prüfung ist offen');
    for(const p of [anna, ben]){
      await p.waitForSelector('#pruefLock', { state: 'visible' });
      await bis(async () => /Warteraum/.test(await p.$eval('#pruefLock', e => e.innerText)), 'Warteraum sichtbar');
      // Vollbild braucht einen Klick der Person (wie im Schulzimmer).
      if(await p.isVisible('#pruefWarteFsBtn')) await p.click('#pruefWarteFsBtn');
    }
    ok(true, 'Freigeben: beide Kinder landen von selbst im ⏳ Warteraum');
    await bis(async () => /2 da/.test(await lp.$eval('#prMon', e => e.innerText).catch(() => '') + ' ' + await lp.$eval('#pruefungBtn', e => e.innerText).catch(() => '')), 'Lehrperson sieht 2 im Warteraum', 30000);
    ok(true, 'Die Lehrperson sieht, dass 2 im Warteraum sind');

    await lp.click('#prMon [data-a="los"]');
    for(const p of [anna, ben]){
      // Ohne Vollbild bietet die Library einen Start-Knopf an; mit Vollbild startet sie von selbst.
      await bis(async () => {
        if(await p.isVisible('#prBank')) return true;
        const k = await p.$('#pruefLock button.btn-primary'); if(k) await k.click().catch(() => {});
        return false;
      }, 'Prüfung gestartet', 30000);
    }
    ok(/Frage 1 von 3/.test(await anna.$eval('#prBank', e => e.innerText)), '«Test starten»: bei beiden erscheint Frage 1 von 3');
    await bis(async () => { const t = await teilnahme('u_anna'); return t && t.status === 'laeuft'; }, 'Teilnahme läuft');

    // Anna löst alles richtig.
    await anna.click('#prBank [data-v="true"]');
    await anna.click('#prBank [data-nav="1"]');
    await anna.click('#prBank [data-v="1"]');
    await anna.click('#prBank [data-nav="1"]');
    await anna.fill('#prBankIn', 'Bern');
    await anna.click('#prBank [data-abgeben="1"]');
    ok(/jetzt abgeben/.test(await anna.$eval('#prBankConfirm', e => e.innerText)), 'Anna: alles beantwortet → Rückfrage «Prüfung jetzt abgeben?»');
    await anna.click('#prBankConfirm [data-ok="1"]');
    await bis(async () => { const t = await teilnahme('u_anna'); return t && t.status === 'abgegeben'; }, 'Anna hat abgegeben');
    await anna.waitForSelector('.modal button:has-text("Verstanden")');
    ok(/Abgegeben/.test(await anna.$eval('.modal', e => e.innerText)) && !(await anna.isVisible('#prBank')), 'Anna bekommt die Bestätigung «Abgegeben», die Prüfung ist zu');
    await anna.click('.modal button:has-text("Verstanden")');
    const ta = await teilnahme('u_anna');
    ok(ta.antworten.q0 === true && ta.antworten.q1 === 1 && ta.antworten.q2 === 'Bern', 'Annas drei Antworten stehen in der Datenbank');
    ok(ta.punkte == null, 'Vor der Freigabe stehen bei Anna noch keine Punkte');

    // Ben lädt die Seite neu (= Prüfung verlassen): gesperrt, bis die Lehrperson entsperrt. Seine Antwort bleibt.
    await ben.click('#prBank [data-v="true"]');
    await bis(async () => { const t = await teilnahme('u_ben'); return t && t.antworten && t.antworten.q0 === true; }, 'Bens erste Antwort gespeichert', 30000);
    await ben.reload({ waitUntil: 'load' });
    await bis(async () => { const t = await teilnahme('u_ben'); return t && t.status === 'gesperrt'; }, 'Ben ist gesperrt', 30000);
    await bis(async () => /gesperrt/i.test(await ben.$eval('#pruefLock', e => e.innerText).catch(() => '')), 'Ben sieht die Sperre');
    ok(!(await ben.isVisible('#prBank')), 'Ben lädt neu → gesperrt, die Aufgaben sind weg');
    await lp.click('#prMon .pr-zeile:has-text("Ben") button:has-text("Entsperren")');
    await bis(async () => {
      if(await ben.isVisible('#prBank')) return true;
      const k = await ben.$('#pruefLock button.btn-primary'); if(k) await k.click().catch(() => {});
      return false;
    }, 'Ben schreibt weiter', 30000);
    ok(/1 beantwortet/.test(await ben.$eval('#prBank', e => e.innerText)), 'Lehrperson entsperrt → Ben schreibt weiter, seine erste Antwort ist noch da');
    // Ben: eine richtig, eine falsch, eine leer.
    await ben.click('#prBank [data-go="0"]');
    await ben.click('#prBank [data-v="true"]');
    await ben.click('#prBank [data-nav="1"]');
    await ben.click('#prBank [data-v="0"]');
    await ben.click('#prBank [data-nav="1"]');
    await ben.click('#prBank [data-abgeben="1"]');
    ok(/Noch 1 Frage ohne Antwort/.test(await ben.$eval('#prBankConfirm', e => e.innerText)), 'Ben: Hinweis «Noch 1 Frage ohne Antwort»');
    await ben.click('#prBankConfirm [data-ok="1"]');
    await bis(async () => { const t = await teilnahme('u_ben'); return t && t.status === 'abgegeben'; }, 'Ben hat abgegeben');

    await bis(async () => { const z = await lp.$$eval('#prMon .pr-zeile', els => els.map(e => e.innerText.replace(/\s+/g, ' '))); return z.filter(x => /abgegeben/i.test(x)).length === 2 ? z : null; }, 'Monitor zeigt 2 Abgaben');
    ok(true, 'Monitor der Lehrperson: beide «abgegeben»');
    const zeilen = await lp.$$eval('#prMon .pr-zeile', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
    ok(/4 \/ 4 Pkt/.test(zeilen.find(z => /^Anna/.test(z)) || '') && /1 \/ 4 Pkt/.test(zeilen.find(z => /^Ben/.test(z)) || ''), 'Monitor korrigiert sofort: Anna 4 / 4, Ben 1 / 4 Punkte');

    // 🎯 Punkte pro Lernziel im Monitor (Anna alles richtig; Ben: Lernziel 1 richtig, 2 falsch, 3 leer).
    await lp.click('#prMon [data-a="lernziele"]');
    await lp.waitForSelector('.lz-raster tbody tr.lz-schnitt');
    const lzr = await lp.$$eval('.lz-raster tbody tr', l => l.map(e => e.innerText.replace(/\s+/g, ' ')));
    ok(/^Anna 1\/1 2\/2 1\/1/.test(lzr.find(z => /^Anna/.test(z)) || '') && /^Ben 1\/1 0\/2 0\/1/.test(lzr.find(z => /^Ben/.test(z)) || ''), 'Monitor › «🎯 Lernziele»: Anna 1/1 2/2 1/1, Ben 1/1 0/2 0/1');
    ok(/^Klasse 100 % 50 % 50 %/.test(lzr.find(z => /^Klasse/.test(z)) || ''), 'Zeile «Klasse»: 100 %, 50 %, 50 %');
    await lp.click('#lzZu');

    // Erst beenden, dann lassen sich die Resultate freigeben.
    await lp.click('#prMon [data-a="beenden"]');
    await lp.click('.modal button:has-text("Beenden")');
    await bis(async () => (await pruefDoc()).status === 'beendet', 'Prüfung ist beendet');
    await lp.click('#prMon [data-a="resultate"]');
    await bis(async () => (await pruefDoc()).resultateFrei === true, 'Resultate frei');
    const ra = await teilnahme('u_anna'), rb = await teilnahme('u_ben');
    ok(ra.punkte === 4 && ra.max === 4, 'Resultate freigeben: Anna 4 von 4 Punkten (ist ' + ra.punkte + ' / ' + ra.max + ')');
    ok(rb.punkte === 1 && rb.max === 4, 'Ben 1 von 4 Punkten (ist ' + rb.punkte + ' / ' + rb.max + ')');

    await bis(async () => /Prüfungsresultat/.test(await anna.$eval('#pruefungBtn', e => e.hidden ? '' : e.innerText).catch(() => '')), 'Anna sieht «Prüfungsresultat»', 30000);
    await anna.click('#pruefungBtn');
    await anna.waitForSelector('.pr-resultat');
    const res = (await anna.$eval('.pr-resultat', e => e.innerText)).replace(/\s+/g, ' ');
    ok(/Note 6/.test(res) && /4/.test(res), 'Anna öffnet ihr Resultat: Note 6 mit 4 Punkten (' + res + ')');
    await anna.waitForSelector('#prLz .lz-pr-zeile');
    const lza = (await anna.$eval('#prLz', e => e.innerText)).replace(/\s+/g, ' ');
    ok(/So steht es bei deinen Lernzielen/.test(lza) && /2 \/ 2 P\./.test(lza) && (await anna.$$('#prLz [data-lzpr]')).length === 0, 'Annas Resultat zeigt die Punkte pro Lernziel, ohne «Dazu üben» (alles erreicht)');
    await bis(async () => /Prüfungsresultat/.test(await ben.$eval('#pruefungBtn', e => e.hidden ? '' : e.innerText).catch(() => '')), 'Ben sieht «Prüfungsresultat»', 30000);
    if(await ben.isVisible('.modal button:has-text("Verstanden")')) await ben.click('.modal button:has-text("Verstanden")');
    await ben.click('#pruefungBtn');
    await ben.waitForSelector('#prLz [data-lzpr="2"]');
    ok((await ben.$$('#prLz [data-lzpr]')).length === 1 && /0 \/ 2 P\./.test(await ben.$eval('#prLz', e => e.innerText)), 'Bens Resultat: Lernziel 2 mit 0 / 2 P. und «Dazu üben» (Lernziel 3 hat keine Übungsfragen)');
    await ben.click('#prLz [data-lzpr="2"]');
    await bis(async () => (await ben.frameLocator('#resourceFrame').locator('#start').textContent().catch(() => '')) === 'Lernziel 2:q3', 'Übung startet mit Lernziel 2');
    ok(true, '«Dazu üben» im Resultat öffnet die Übung mit der Frage von Lernziel 2');
    for(const p of [lp, anna, ben]) await p.context().close();
  });

  await abschnitt('📮 Briefkasten', async () => {
    const lp = await B.geraet('lehrperson'), anna = await B.geraet('anna', 1100);
    await B.anmelden(lp, 'testlehrer'); await B.anmelden(anna, 'anna');
    await B.fach(lp, 'mathe');
    await lp.click('#bkNeuBtn');
    await lp.fill('#bkTitel', 'Ablauf-Abgabe');
    if(!(await lp.inputValue('#bkOrdner'))) await lp.fill('#bkOrdner', 'Ablauf-Abgabe');
    await lp.click('#modalOk');
    const bk = await bis(async () => { const s = await db.collection('klassen/' + K + '/briefkaesten').get(); return s.empty ? null : Object.assign({ id: s.docs[0].id }, s.docs[0].data()); }, 'Briefkasten angelegt');
    ok(bk.titel === 'Ablauf-Abgabe' && bk.ownerUid === 'u_testlehrer' && bk.subject === 'mathe', 'Lehrperson stellt im Fach einen Briefkasten auf');

    await B.fach(anna, 'mathe');
    await anna.click('#bkopen-' + bk.id);
    await anna.waitForSelector('#bkEinwerfen');
    ok(await anna.isDisabled('#bkEinwerfen'), 'Schülerin: «Einwerfen» ist ohne Datei gesperrt');
    const inhalt = Buffer.from('Ablauf-Test: Inhalt der abgegebenen Datei. äöü €');
    // Neu aufgestellte Briefkästen nehmen nur PDF: eine Textdatei wird rot markiert und blockiert den Einwurf.
    await anna.setInputFiles('#bkDatei', { name: 'notizen.txt', mimeType: 'text/plain', buffer: inhalt });
    await bis(async () => /nicht erlaubt/.test(await anna.$eval('#bkWahl', e => e.innerText)), 'falscher Dateityp markiert');
    ok(await anna.isDisabled('#bkEinwerfen'), 'Falscher Dateityp (.txt statt PDF): rot markiert, «Einwerfen» bleibt gesperrt');
    await anna.click('#bkWahl button');
    await anna.setInputFiles('#bkDatei', { name: 'aufsatz.pdf', mimeType: 'application/pdf', buffer: inhalt });
    await bis(async () => !(await anna.isDisabled('#bkEinwerfen')), 'Datei gewählt');
    await anna.click('#bkEinwerfen');
    const abgabe = await bis(async () => { const s = await db.collection('klassen/' + K + '/briefkaesten/' + bk.id + '/abgaben').get(); return s.empty ? null : Object.assign({ id: s.docs[0].id, ref: s.docs[0].ref }, s.docs[0].data()); }, 'Abgabe gespeichert', 30000);
    ok(abgabe.uid === 'u_anna' && abgabe.dateien.length === 1 && abgabe.dateien[0].n === 'aufsatz.pdf' && abgabe.abgeholt !== true, 'Einwurf: Quittung mit Dateiname steht in der Datenbank, noch nicht abgeholt');
    const chunks = await abgabe.ref.collection('chunks').get();
    ok(chunks.size === abgabe.chunkCount && chunks.size >= 1 && abgabe.groesse === inhalt.length, 'Die Datei liegt vollständig im Zwischenlager (' + chunks.size + ' Stück, ' + abgabe.groesse + ' Bytes)');
    await bis(async () => /aufsatz\.pdf/.test(await anna.$eval('#bkQuittung', e => e.innerText).catch(() => '')), 'Quittung sichtbar');
    ok(true, 'Die Schülerin sieht ihre Quittung mit «aufsatz.pdf»');

    await lp.click('#bkopen-' + bk.id);
    await bis(async () => /1 von 2 eingeworfen/.test(await lp.$eval('#bkAbgBox', e => e.innerText).catch(() => '')), 'Übersicht zeigt 1 von 2');
    const tab = (await lp.$eval('#bkAbgBox', e => e.innerText)).replace(/\s+/g, ' ');
    ok(/Anna ✓.*aufsatz\.pdf/.test(tab) && /Ben/.test(tab) && !/Ben ✓/.test(tab) && /noch nicht abgeholt/.test(tab), 'Lehrperson: «1 von 2 eingeworfen», Annas Datei steht da, Ben fehlt');
    for(const p of [lp, anna]) await p.context().close();
  });

  await abschnitt('👀 Schulleitung', async () => {
    const sl = await B.geraet('schulleitung');
    await B.anmelden(sl, 'schulleitung');
    ok(/Schulleitung/.test(await B.text(sl)), 'Schulleitung meldet sich an');
    await B.fach(sl, 'mathe');
    await sl.waitForSelector('#card-r_sync, #open-r_sync');
    ok(true, 'Sie sieht die Übungen der Klasse');
    ok(!(await sl.$('#bkNeuBtn')), 'Kein Knopf «Briefkasten aufstellen»');
    const karte = await sl.$('[id^="bkopen-"]');
    if(karte){
      await karte.click();
      await sl.waitForSelector('.bk-buehne');
      ok(!(await sl.$('#bkEinwerfen')) && /Vorschau/.test(await sl.$eval('.modal', e => e.innerText)), 'Briefkasten nur als Vorschau, ohne «Einwerfen»');
      await sl.click('#modalCancel');
    }
    const vorher = (await db.collection('klassen/' + K + '/resources').get()).size;
    await sl.waitForTimeout(500);
    ok((await db.collection('klassen/' + K + '/resources').get()).size === vorher, 'In der Klasse hat sich durch den Besuch nichts verändert');
    await sl.context().close();
  });

  await abschnitt('🎯 Lernziele', async () => {
    const anna = await B.geraet('anna-lz'), lp = await B.geraet('lehrer-lz');
    await B.anmelden(anna, 'anna'); await B.fach(anna, 'mathe');
    ok(!(await anna.$('.lz-karte')), 'Auf der Fach-Hauptebene (ohne Lernziele) steht keine Lernziel-Karte');
    await anna.click('#fopen-f_lz');
    await anna.waitForSelector('.lz-karte [data-lz]');
    ok(/Test-Lernziele/.test(await anna.$eval('.lz-karte', e => e.innerText)), 'Im Ordner erscheint die Karte «Lernziele: Test-Lernziele»');
    ok(await anna.$eval('.lz-karte', e => !!e.previousElementSibling && e.previousElementSibling.id === 'card-r_lz') && (await anna.$$('.lz-karte')).length === 1, 'Die Karte steht direkt unter ihrer Übung (einmal)');
    await anna.click('.lz-karte [data-lz]');
    await anna.waitForSelector('.lz-zeile');
    const zeilen = await anna.$$eval('.lz-zeile', l => l.map(e => e.innerText.replace(/\s+/g, ' ')));
    ok(zeilen.length === 3 && /0 von 2 Fragen richtig/.test(zeilen[0]) && /0 von 1 Fragen/.test(zeilen[1]) && /keine Fragen/.test(zeilen[2]), 'Drei Lernziele mit Übungsstand (0 von 2, 0 von 1, ohne Fragen)');
    ok((await anna.$$('.lz-zeile:nth-child(3) [data-ueben]')).length === 0, 'Lernziel ohne Fragen hat kein «Dazu üben»');
    await anna.click('.lz-wahl[data-nr="1"][data-w="g"]');
    await bis(async () => (await lzDoc('u_anna'))['1'] === 'g', 'Selbsteinschätzung gespeichert');
    ok(true, 'Selbsteinschätzung «erreicht» für Lernziel 1 ist gespeichert');
    await anna.click('[data-ueben="1"]');
    const f = anna.frameLocator('#resourceFrame');
    await bis(async () => (await f.locator('#start').textContent().catch(() => '')) === 'Lernziel 1:q1,q2', '«Dazu üben» gibt die Fragen mit');
    ok(true, '«Dazu üben» öffnet die Übung mit genau den Fragen des Lernziels (q1, q2)');
    ok(/"0":"green"/.test(await f.locator('#ziele').textContent()), 'Die Übung bekommt die Einschätzung aus der Library');
    await bis(async () => (await lzDoc('u_anna'))['3'] === 'r', 'Einschätzung aus der Übung übernommen');
    ok(true, 'Eine Einschätzung, die es nur in der Übung gab, wird übernommen (Lernziel 3)');
    await f.locator('#schaetzen').click();
    await bis(async () => (await lzDoc('u_anna'))['2'] === 'a', 'Klick in der Übung gespeichert');
    ok(true, 'Einschätzen in der Übung landet in der Library (Lernziel 2 «teilweise»)');
    await f.locator('#melden').click();
    await anna.click('#backBtn');
    await bis(async () => ((await db.doc('progress/u_anna/resources/r_lz').get()).data() || {}).stats, 'Übungsstand gespeichert');
    await anna.waitForSelector('.lz-karte [data-lz]');
    await anna.click('.lz-karte [data-lz]');
    await bis(async () => /1 von 2 Fragen richtig/.test(await anna.$eval('.modal', e => e.innerText).catch(() => '')), 'Balken zeigt 1 von 2');
    ok(true, 'Nach dem Üben zeigt Lernziel 1 «1 von 2 Fragen richtig»');

    await B.anmelden(lp, 'testlehrer'); await B.fach(lp, 'mathe');
    await lp.click('#fopen-f_lz');
    await lp.waitForSelector('.lz-karte [data-lzk]');
    await lp.click('.lz-karte [data-lzk]');
    await lp.waitForSelector('.lz-raster tbody tr');
    const raster = await lp.$$eval('.lz-raster tbody tr', l => l.map(e => e.innerText.replace(/\s+/g, ' ')));
    const za = raster.find(z => /^Anna/.test(z)) || '', zb = raster.find(z => /^Ben/.test(z)) || '';
    ok(/1\/2 ?🟢/.test(za) && /0\/1 ?🟡/.test(za) && /– ?🔴/.test(za), 'Lehrperson: Annas Zeile zeigt 1/2 🟢, 0/1 🟡, – 🔴');
    // Ben hat die Übung nur aus dem Prüfungsresultat geöffnet (dort meldete sie 🔴 für Lernziel 3), selbst nichts eingeschätzt.
    ok(/0\/2/.test(zb) && !/🟢|🟡/.test(zb), 'Ben: nichts geübt, keine eigene Einschätzung in der Library');
    if(process.env.DEBUG_DIR) await lp.screenshot({ path: process.env.DEBUG_DIR + '/lz-raster.png' });
    for(const p of [anna, lp]) await p.context().close();
  });

  await B.ende('Ablauf-Test');
})().catch(e => { console.error('❌ Ablauf-Test abgebrochen:', e); process.exit(1); });
