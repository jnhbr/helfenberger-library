/**
 * Tests für firestore.rules im Firebase-Emulator (nie gegen die echte Datenbank).
 *
 *   cd admin/rules-test && npm install
 *   npx firebase-tools emulators:exec --only firestore --project demo-library "node --test"
 *   (braucht Java 11+; läuft automatisch als GitHub Action im Test-Repo, siehe
 *    .github/workflows/pruefen.yml)
 *
 * Schwerpunkt: die Fehler, die schon einmal passiert sind — Löschen muss für
 * Lehrpersonen überall gehen (delete-Regel separat), Schüler:innen sehen nur die
 * eigene Klasse — plus die neuen Collections rueckmeldungen und fehlerLog.
 */
const { test, before, after, beforeEach } = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where } = require('firebase/firestore');

let env;
const JAN = { teacher: true, klasse: 'G3b', email: 'helfenberger@helfenberger-library.app' };
const LP = { teacher: true, klasse: 'G3a', email: 'schoch@helfenberger-library.app' };

const db = {
  jan: () => env.authenticatedContext('jan', JAN).firestore(),
  lp: () => env.authenticatedContext('lp', LP).firestore(),
  sus: () => env.authenticatedContext('sus', { klasse: 'G3b', email: 'sus@helfenberger-library.app' }).firestore(),
  susA: () => env.authenticatedContext('susA', { klasse: 'G3a', email: 'susa@helfenberger-library.app' }).firestore(),
  leitung: () => env.authenticatedContext('leitung', { leitung: true, klasse: 'G3b', email: 'schulleitung@helfenberger-library.app' }).firestore(),
  praktikum: () => env.authenticatedContext('prak', { teacher: true, klasse: 'praktikum-zivi', email: 'zivi@helfenberger-library.app' }).firestore(),
  gast: () => env.unauthenticatedContext().firestore()
};

async function seed(pfad, daten){
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), pfad), daten); });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-library',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8') }
  });
});
after(async () => { if(env) await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

// ---------- 💬 Rückmeldungen ----------
const rm = (von, extra) => Object.assign({ art: 'fehler', fach: 'mathe', text: 'Knopf geht nicht', vonUid: von, vonName: 'X', klasse: 'G3a', status: 'offen' }, extra || {});

test('Rückmeldung: Lehrperson legt eigene an', async () => {
  await assertSucceeds(setDoc(doc(db.lp(), 'rueckmeldungen/a'), rm('lp')));
});
test('Rückmeldung: nicht im Namen einer anderen Person, nicht als Schüler:in, nicht erledigt', async () => {
  await assertFails(setDoc(doc(db.lp(), 'rueckmeldungen/a'), rm('jan')));
  await assertFails(setDoc(doc(db.sus(), 'rueckmeldungen/a'), rm('sus')));
  await assertFails(setDoc(doc(db.lp(), 'rueckmeldungen/a'), rm('lp', { status: 'erledigt' })));
  await assertFails(setDoc(doc(db.lp(), 'rueckmeldungen/a'), rm('lp', { art: 'quatsch' })));
  await assertFails(setDoc(doc(db.lp(), 'rueckmeldungen/a'), rm('lp', { text: '' })));
});
test('Rückmeldung: Lehrperson liest nur eigene, Jan alle', async () => {
  await seed('rueckmeldungen/a', rm('lp'));
  await seed('rueckmeldungen/b', rm('andere'));
  await assertSucceeds(getDocs(query(collection(db.lp(), 'rueckmeldungen'), where('vonUid', '==', 'lp'))));
  await assertFails(getDocs(collection(db.lp(), 'rueckmeldungen')));
  await assertFails(getDoc(doc(db.lp(), 'rueckmeldungen/b')));
  await assertSucceeds(getDocs(collection(db.jan(), 'rueckmeldungen')));
  await assertFails(getDocs(collection(db.sus(), 'rueckmeldungen')));
  await assertFails(getDocs(collection(db.leitung(), 'rueckmeldungen')));
});
test('Rückmeldung: nur Jan setzt Status + Begründung, Text bleibt', async () => {
  await seed('rueckmeldungen/a', rm('lp'));
  await assertSucceeds(updateDoc(doc(db.jan(), 'rueckmeldungen/a'), { status: 'nicht', begruendung: 'Geht technisch nicht' }));
  await assertSucceeds(updateDoc(doc(db.jan(), 'rueckmeldungen/a'), { status: 'erledigt', begruendung: '' }));
  await assertFails(updateDoc(doc(db.jan(), 'rueckmeldungen/a'), { text: 'geändert' }));
  await assertFails(updateDoc(doc(db.jan(), 'rueckmeldungen/a'), { status: 'kaputt' }));
  await assertFails(updateDoc(doc(db.lp(), 'rueckmeldungen/a'), { status: 'erledigt' }));
});
test('Rückmeldung: Lehrperson zieht offene zurück, beantwortete löscht nur Jan', async () => {
  await seed('rueckmeldungen/a', rm('lp'));
  await assertSucceeds(deleteDoc(doc(db.lp(), 'rueckmeldungen/a')));
  await seed('rueckmeldungen/b', rm('lp', { status: 'erledigt' }));
  await assertFails(deleteDoc(doc(db.lp(), 'rueckmeldungen/b')));
  await assertSucceeds(deleteDoc(doc(db.jan(), 'rueckmeldungen/b')));
});

// ---------- 🐞 Fehlerprotokoll ----------
const fl = (uid, extra) => Object.assign({ msg: 'TypeError: x is undefined', stack: 'at y', quelle: 'error', uid: uid, name: 'N', klasse: 'G3b', rolle: 'student', ua: 'UA', seite: 'home', test: false }, extra || {});

test('Fehlerlog: jede:r schreibt eigene Einträge, nur Jan liest und löscht', async () => {
  await assertSucceeds(setDoc(doc(db.sus(), 'fehlerLog/a'), fl('sus')));
  await assertFails(setDoc(doc(db.sus(), 'fehlerLog/b'), fl('andere')));
  await assertFails(setDoc(doc(db.gast(), 'fehlerLog/c'), fl('sus')));
  await assertFails(setDoc(doc(db.sus(), 'fehlerLog/d'), fl('sus', { msg: 'x'.repeat(1001) })));
  await assertFails(getDoc(doc(db.sus(), 'fehlerLog/a')));
  await assertFails(getDocs(collection(db.lp(), 'fehlerLog')));
  await assertSucceeds(getDocs(collection(db.jan(), 'fehlerLog')));
  await assertFails(updateDoc(doc(db.sus(), 'fehlerLog/a'), { msg: 'y' }));
  await assertFails(deleteDoc(doc(db.lp(), 'fehlerLog/a')));
  await assertSucceeds(deleteDoc(doc(db.jan(), 'fehlerLog/a')));
});

// ---------- 🐦 Earlybird ----------
const ebd = (uid, extra) => Object.assign({ datum: '2026-09-23', uid: uid, name: 'N', nachname: 'X', klasse: 'G3b', vonUid: 'lp', vonName: 'Schoch', anwesend: false }, extra || {});

test('Earlybird: Lehrperson trägt ein, hakt ab und trägt aus', async () => {
  await assertSucceeds(setDoc(doc(db.lp(), 'earlybird/2026-09-23_sus'), ebd('sus')));
  await assertFails(setDoc(doc(db.lp(), 'earlybird/2026-09-23_falsch'), ebd('sus')));
  await assertSucceeds(updateDoc(doc(db.jan(), 'earlybird/2026-09-23_sus'), { anwesend: true }));
  await assertSucceeds(getDocs(query(collection(db.jan(), 'earlybird'), where('datum', '==', '2026-09-23'))));
  await assertSucceeds(deleteDoc(doc(db.jan(), 'earlybird/2026-09-23_sus')));
});
test('Earlybird: Schüler:in liest nur den eigenen Eintrag, schreibt nichts', async () => {
  await seed('earlybird/2026-09-23_sus', ebd('sus'));
  await seed('earlybird/2026-09-23_susA', ebd('susA', { klasse: 'G3a' }));
  await assertSucceeds(getDocs(query(collection(db.sus(), 'earlybird'), where('uid', '==', 'sus'))));
  await assertFails(getDocs(query(collection(db.sus(), 'earlybird'), where('datum', '==', '2026-09-23'))));
  await assertFails(getDoc(doc(db.sus(), 'earlybird/2026-09-23_susA')));
  await assertFails(updateDoc(doc(db.sus(), 'earlybird/2026-09-23_sus'), { anwesend: true }));
  await assertFails(deleteDoc(doc(db.sus(), 'earlybird/2026-09-23_sus')));
  await assertFails(deleteDoc(doc(db.leitung(), 'earlybird/2026-09-23_sus')));
  await assertSucceeds(getDocs(query(collection(db.leitung(), 'earlybird'), where('datum', '==', '2026-09-23'))));
});

// ---------- 🚪 Räume ----------
const rres = (von, extra) => Object.assign({ datum: '2026-09-30', woche: '2026-09-28', raum: 'A12', slot: '3', vonUid: von, vonName: 'X', zweck: 'G3b Gruppenarbeit', serie: '' }, extra || {});

test('Räume: Lehrperson reserviert eine freie Lektion, niemand bucht doppelt', async () => {
  await assertSucceeds(setDoc(doc(db.lp(), 'raumReservationen/2026-09-30_A12_3'), rres('lp')));
  await assertFails(setDoc(doc(db.jan(), 'raumReservationen/2026-09-30_A12_3'), rres('jan')));
  await assertFails(setDoc(doc(db.lp(), 'raumReservationen/2026-09-30_A12_3'), rres('lp', { zweck: 'anders' })));
  await assertFails(setDoc(doc(db.lp(), 'raumReservationen/falsch'), rres('lp')));
  await assertFails(setDoc(doc(db.lp(), 'raumReservationen/2026-09-30_A12_4'), rres('jan', { slot: '4' })));
  await assertFails(setDoc(doc(db.sus(), 'raumReservationen/2026-09-30_A12_5'), rres('sus', { slot: '5' })));
  await assertFails(setDoc(doc(db.leitung(), 'raumReservationen/2026-09-30_A12_6'), rres('leitung', { slot: '6' })));
});
test('Räume: lesen nur Lehrpersonen/Schulleitung, löschen nur wer reserviert hat (und Jan)', async () => {
  await seed('raumReservationen/2026-09-30_A12_3', rres('lp'));
  await seed('raumReservationen/2026-09-30_A12_4', rres('lp', { slot: '4' }));
  await seed('raumBelegung/plan', { zellen: {} });
  await assertSucceeds(getDocs(query(collection(db.jan(), 'raumReservationen'), where('woche', '==', '2026-09-28'))));
  await assertSucceeds(getDocs(query(collection(db.leitung(), 'raumReservationen'), where('woche', '==', '2026-09-28'))));
  await assertFails(getDocs(query(collection(db.sus(), 'raumReservationen'), where('woche', '==', '2026-09-28'))));
  await assertSucceeds(getDoc(doc(db.lp(), 'raumBelegung/plan')));
  await assertFails(getDoc(doc(db.sus(), 'raumBelegung/plan')));
  await assertFails(setDoc(doc(db.jan(), 'raumBelegung/plan'), { zellen: {} }));
  await assertFails(deleteDoc(doc(db.sus(), 'raumReservationen/2026-09-30_A12_3')));
  await assertSucceeds(deleteDoc(doc(db.lp(), 'raumReservationen/2026-09-30_A12_3')));
  await assertSucceeds(deleteDoc(doc(db.jan(), 'raumReservationen/2026-09-30_A12_4')));
});

// ---------- 🔒 Lehrer-HTMLs, Prüfungsnoten, Rotstift (28.09.2026) ----------
test('Inhalt mit nurLehrer: nur Lehrpersonen/Schulleitung lesen, normale Inhalte alle', async () => {
  await seed('resourceContent/lp1', { chunkCount: 1, nurLehrer: true });
  await seed('resourceContent/lp1/chunks/0', { html: '<p>Planung</p>', nurLehrer: true });
  await seed('resourceContent/ueb1', { chunkCount: 1 });
  await seed('resourceContent/ueb1/chunks/0', { html: '<p>Übung</p>' });
  await seed('resourceContent/aus1', { chunkCount: 1, nurLehrer: false });
  await assertFails(getDoc(doc(db.sus(), 'resourceContent/lp1')));
  await assertFails(getDoc(doc(db.sus(), 'resourceContent/lp1/chunks/0')));
  await assertSucceeds(getDoc(doc(db.lp(), 'resourceContent/lp1/chunks/0')));
  await assertSucceeds(getDoc(doc(db.leitung(), 'resourceContent/lp1/chunks/0')));
  await assertSucceeds(getDoc(doc(db.sus(), 'resourceContent/ueb1')));
  await assertSucceeds(getDoc(doc(db.sus(), 'resourceContent/ueb1/chunks/0')));
  await assertSucceeds(getDoc(doc(db.sus(), 'resourceContent/aus1')));
  await assertSucceeds(getDoc(doc(db.sus(), 'resourceContent/fehlt')));
  await assertFails(getDoc(doc(db.gast(), 'resourceContent/ueb1')));
});
test('Inhalt: Lehrperson setzt/entfernt den Schutz auf Kopf und Chunks', async () => {
  await seed('resourceContent/ueb1', { chunkCount: 1 });
  await seed('resourceContent/ueb1/chunks/0', { html: '<p>x</p>' });
  await assertSucceeds(updateDoc(doc(db.lp(), 'resourceContent/ueb1'), { nurLehrer: true }));
  await assertSucceeds(updateDoc(doc(db.lp(), 'resourceContent/ueb1/chunks/0'), { nurLehrer: true }));
  await assertSucceeds(updateDoc(doc(db.lp(), 'resourceContent/ueb1/chunks/0'), { nurLehrer: false }));
  await assertFails(updateDoc(doc(db.sus(), 'resourceContent/ueb1'), { nurLehrer: false }));
});
test('Prüfungsnoten: nur die Person selbst liest, Lehrperson schreibt und löscht', async () => {
  await seed('progress/sus/pruefungsnoten/G3b_p1', { note: 5, gewicht: 1 });
  await assertSucceeds(getDocs(collection(db.sus(), 'progress/sus/pruefungsnoten')));
  await assertFails(getDoc(doc(db.lp(), 'progress/sus/pruefungsnoten/G3b_p1')));
  await assertFails(getDoc(doc(db.leitung(), 'progress/sus/pruefungsnoten/G3b_p1')));
  await assertFails(getDoc(doc(db.susA(), 'progress/sus/pruefungsnoten/G3b_p1')));
  await assertSucceeds(setDoc(doc(db.lp(), 'progress/sus/pruefungsnoten/G3a_p2'), { note: 4.5, gewicht: 1 }));
  await assertSucceeds(deleteDoc(doc(db.lp(), 'progress/sus/pruefungsnoten/G3a_p2')));
});
test('Notenrechner in der Schüleransicht: Jan liest (auch Prüfungsnoten), schreibt aber nicht; andere nicht', async () => {
  await seed('progress/sus/noten/liste', { faecher: { mathe: [{ id: 'a', name: 'Test', note: 5, gewicht: 1 }] } });
  await seed('progress/sus/pruefungsnoten/G3b_p1', { note: 5, gewicht: 1 });
  await assertSucceeds(getDoc(doc(db.jan(), 'progress/sus/noten/liste')));
  await assertSucceeds(getDocs(collection(db.jan(), 'progress/sus/pruefungsnoten')));
  await assertFails(setDoc(doc(db.jan(), 'progress/sus/noten/liste'), { faecher: {} }));
  await assertFails(deleteDoc(doc(db.jan(), 'progress/sus/noten/liste')));
  await assertSucceeds(getDoc(doc(db.sus(), 'progress/sus/noten/liste')));
  await assertSucceeds(setDoc(doc(db.sus(), 'progress/sus/noten/liste'), { faecher: {} }));
  await assertFails(getDoc(doc(db.lp(), 'progress/sus/noten/liste')));
  await assertFails(getDoc(doc(db.leitung(), 'progress/sus/noten/liste')));
  await assertFails(getDoc(doc(db.susA(), 'progress/sus/noten/liste')));
});
test('Rotstift: Lehrpersonen ja, Praktikum/Zivi und Schüler:innen nicht', async () => {
  await seed('pruefungKorrektur/k1', { titel: 'T', klasse: 'G3b' });
  await seed('pruefungKorrektur/k1/schueler/s1', { name: 'N' });
  await seed('pruefungKorrekturScans/s1/pages/0', { b64: 'x' });
  await assertSucceeds(getDoc(doc(db.lp(), 'pruefungKorrektur/k1/schueler/s1')));
  await assertSucceeds(getDoc(doc(db.lp(), 'pruefungKorrekturScans/s1/pages/0')));
  await assertFails(getDoc(doc(db.praktikum(), 'pruefungKorrektur/k1')));
  await assertFails(getDoc(doc(db.praktikum(), 'pruefungKorrektur/k1/schueler/s1')));
  await assertFails(getDoc(doc(db.praktikum(), 'pruefungKorrekturScans/s1/pages/0')));
  await assertFails(setDoc(doc(db.praktikum(), 'pruefungKorrektur/k2'), { titel: 'T' }));
  await assertFails(getDoc(doc(db.sus(), 'pruefungKorrektur/k1')));
  await assertSucceeds(getDoc(doc(db.praktikum(), 'klassen/G3b/resources/fehlt')));
});

// ---------- ⚡ Energizer: eigene Spiele ----------
const en = (von, extra) => Object.assign({ titel: 'Spiel', kat: 'bewegung', kurz: 'k', schritte: 'a\nb', tipp: '', vonUid: von, vonName: 'X' }, extra || {});
test('Energizer: Lehrperson legt eigenes Spiel an, alle Lehrpersonen lesen, Schüler:innen nicht', async () => {
  await assertSucceeds(setDoc(doc(db.lp(), 'energizer/e1'), en('lp')));
  await assertFails(setDoc(doc(db.lp(), 'energizer/e2'), en('jan')));
  await assertFails(setDoc(doc(db.lp(), 'energizer/e3'), en('lp', { kat: 'falsch' })));
  await assertFails(setDoc(doc(db.lp(), 'energizer/e4'), en('lp', { titel: '' })));
  await assertFails(setDoc(doc(db.sus(), 'energizer/e5'), en('sus')));
  await assertSucceeds(getDoc(doc(db.jan(), 'energizer/e1')));
  await assertFails(getDoc(doc(db.sus(), 'energizer/e1')));
});
test('Energizer: nur wer es angelegt hat (und Jan) ändert und löscht', async () => {
  await seed('energizer/e1', en('lp'));
  await assertSucceeds(updateDoc(doc(db.lp(), 'energizer/e1'), { titel: 'Neu' }));
  await assertFails(updateDoc(doc(db.lp(), 'energizer/e1'), { vonUid: 'jan' }));
  await assertSucceeds(updateDoc(doc(db.jan(), 'energizer/e1'), { titel: 'Von Jan' }));
  await seed('energizer/e2', en('jan'));
  await assertFails(deleteDoc(doc(db.lp(), 'energizer/e2')));
  await assertSucceeds(deleteDoc(doc(db.lp(), 'energizer/e1')));
  await assertSucceeds(deleteDoc(doc(db.jan(), 'energizer/e2')));
});

// ---------- Löschen muss für Lehrpersonen gehen (der wiederkehrende Fehler) ----------
const LOESCHBAR = [
  ['klassen/G3b/resources/r1', { subject: 'mathe', title: 'T' }],
  ['klassen/G3b/folders/f1', { subject: 'mathe', name: 'O' }],
  ['klassen/G3b/calendarEntries/c1', { title: 'HA' }],
  ['klassen/G3b/debts/sus', { entries: [] }],
  ['klassen/G3b/fragen/q1', { text: 'Frage', published: false, answer: '' }],
  ['klassen/G3b/quizSessions/aktiv', { status: 'x' }],
  ['klassen/G3b/pruefungen/p1', { status: 'offen' }],
  ['klassen/G3b/pruefungen/p1/teilnahmen/sus', { status: 'laeuft' }],
  ['resourceContent/rc1', { chunkCount: 1 }],
  ['resourceContent/rc1/chunks/0', { html: '<p>x</p>' }],
  ['progress/sus/pruefungsnoten/n1', { note: 5, gewicht: 1 }],
  ['uebungsIndex/r1', { klassen: ['G3b'] }],
  ['schulLinks/l1', { name: 'L', url: 'https://x', fuer: 'lehrer' }],
  ['streaks/sus', { days: {} }]
];
for(const [pfad, daten] of LOESCHBAR){
  test('Lehrperson darf löschen: ' + pfad, async () => {
    await seed(pfad, daten);
    await assertSucceeds(deleteDoc(doc(db.jan(), pfad)));
  });
}
test('Löschen eigener Dinge: Gruppe, Lernphase, Abstimmung, Passwort-Anfrage', async () => {
  await seed('gruppen/g1', { ownerUid: 'lp', mitglieder: [] });
  await assertFails(deleteDoc(doc(db.jan(), 'gruppen/g1')));
  await assertSucceeds(deleteDoc(doc(db.lp(), 'gruppen/g1')));
  await seed('lernphasen/lp', { mitglieder: [] });
  await assertSucceeds(deleteDoc(doc(db.lp(), 'lernphasen/lp')));
  await seed('abstimmungen/a1', { erstelltVonUid: 'lp', klassen: ['G3a'], fragen: [] });
  await assertSucceeds(deleteDoc(doc(db.jan(), 'abstimmungen/a1')));
  await seed('passwortAnfragen/p1', { vonUid: 'lp', uid: 'susA', status: 'offen' });
  await assertSucceeds(deleteDoc(doc(db.lp(), 'passwortAnfragen/p1')));
});
test('Schüler:innen und Schulleitung dürfen Übungen nicht löschen', async () => {
  await seed('klassen/G3b/resources/r1', { subject: 'mathe' });
  await assertFails(deleteDoc(doc(db.sus(), 'klassen/G3b/resources/r1')));
  await assertFails(deleteDoc(doc(db.leitung(), 'klassen/G3b/resources/r1')));
});

// ---------- Klassen sauber getrennt ----------
test('Schüler:in liest nur die eigene Klasse', async () => {
  await seed('klassen/G3b/resources/r1', { subject: 'mathe' });
  await assertSucceeds(getDoc(doc(db.sus(), 'klassen/G3b/resources/r1')));
  await assertFails(getDoc(doc(db.susA(), 'klassen/G3b/resources/r1')));
  await assertSucceeds(getDoc(doc(db.lp(), 'klassen/G3b/resources/r1')));
  await assertSucceeds(getDoc(doc(db.leitung(), 'klassen/G3b/resources/r1')));
  await assertFails(getDoc(doc(db.gast(), 'klassen/G3b/resources/r1')));
});
test('Quiz-Lösungen und Prüfungslösungen nie für Schüler:innen', async () => {
  await seed('klassen/G3b/quizzes/q1', { title: 'Q' });
  await seed('klassen/G3b/pruefungen/p1/intern/loesung', { loesungen: {} });
  await assertFails(getDoc(doc(db.sus(), 'klassen/G3b/quizzes/q1')));
  await assertFails(getDoc(doc(db.sus(), 'klassen/G3b/pruefungen/p1/intern/loesung')));
  await assertSucceeds(getDoc(doc(db.jan(), 'klassen/G3b/pruefungen/p1/intern/loesung')));
});
test('Übungsstand: nur der eigene ist schreibbar', async () => {
  await assertSucceeds(setDoc(doc(db.sus(), 'progress/sus/resources/r1'), { stats: {} }));
  await assertFails(setDoc(doc(db.sus(), 'progress/susA/resources/r1'), { stats: {} }));
  await assertFails(setDoc(doc(db.jan(), 'progress/sus/resources/r1'), { stats: {} }));
});
test('Stundenplan aus Untis: Person selbst und Lehrpersonen lesen, andere SuS nicht', async () => {
  await seed('progress/sus/einstellungen/stundenplanSchule', { zellen: {} });
  await seed('progress/sus/einstellungen/layout', { aus: [] });
  await assertSucceeds(getDoc(doc(db.sus(), 'progress/sus/einstellungen/stundenplanSchule')));
  await assertSucceeds(getDoc(doc(db.lp(), 'progress/sus/einstellungen/stundenplanSchule')));
  await assertFails(getDoc(doc(db.susA(), 'progress/sus/einstellungen/stundenplanSchule')));
  await assertFails(getDoc(doc(db.lp(), 'progress/sus/einstellungen/layout')));
});
test('Sprache am Konto: Person selbst schreibt, Lehrpersonen lesen, andere SuS nicht', async () => {
  await assertSucceeds(setDoc(doc(db.sus(), 'progress/sus/einstellungen/sprache'), { code: 'tr', vorlesen: true }));
  await assertSucceeds(getDoc(doc(db.sus(), 'progress/sus/einstellungen/sprache')));
  await assertSucceeds(getDoc(doc(db.lp(), 'progress/sus/einstellungen/sprache')));
  await assertFails(getDoc(doc(db.susA(), 'progress/sus/einstellungen/sprache')));
  await assertFails(setDoc(doc(db.lp(), 'progress/sus/einstellungen/sprache'), { code: 'de' }));
});
test('Alte, klassenlose Collections bleiben gesperrt', async () => {
  await assertFails(getDoc(doc(db.jan(), 'resources/x')));
  await assertFails(setDoc(doc(db.jan(), 'calendarEntries/x'), { a: 1 }));
});

// ---------- 👥 Gruppen-Prüfung über Klassen hinweg ----------
test('Gruppen-Prüfung: Mitglied aus anderer Klasse liest und schreibt die eigene Teilnahme', async () => {
  await seed('klassen/G3b/appMeta/gruppenMitglieder', { uids: ['susA'] });
  await seed('klassen/G3b/pruefungen/p1', { titel: 'X', status: 'offen', mitglieder: ['susA'] });
  await assertSucceeds(getDoc(doc(db.susA(), 'klassen/G3b/pruefungen/p1')));
  await assertSucceeds(setDoc(doc(db.susA(), 'klassen/G3b/pruefungen/p1/teilnahmen/susA'), { status: 'laeuft' }));
  await assertSucceeds(updateDoc(doc(db.susA(), 'klassen/G3b/pruefungen/p1/teilnahmen/susA'), { status: 'abgegeben' }));
  await assertSucceeds(setDoc(doc(db.susA(), 'klassen/G3b/quizSessions/warte_p1/antworten/susA'), { ts: 1 }));
  await assertFails(setDoc(doc(db.susA(), 'klassen/G3b/quizSessions/aktiv/antworten/susA'), { a: 1 }));
  await assertFails(setDoc(doc(db.susA(), 'klassen/G3b/pruefungen/p1/teilnahmen/sus'), { status: 'laeuft' }));
});
test('Gruppen-Prüfung: wer in keiner Gruppe der Seite ist, liest nichts', async () => {
  await seed('klassen/G3b/appMeta/gruppenMitglieder', { uids: ['andere'] });
  await seed('klassen/G3b/pruefungen/p1', { titel: 'X', status: 'offen' });
  await assertFails(getDoc(doc(db.susA(), 'klassen/G3b/pruefungen/p1')));
  await assertFails(setDoc(doc(db.susA(), 'klassen/G3b/pruefungen/p1/teilnahmen/susA'), { status: 'laeuft' }));
});
