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
test('Alte, klassenlose Collections bleiben gesperrt', async () => {
  await assertFails(getDoc(doc(db.jan(), 'resources/x')));
  await assertFails(setDoc(doc(db.jan(), 'calendarEntries/x'), { a: 1 }));
});
