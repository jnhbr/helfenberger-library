/**
 * Helfenberger's Library — Umstellung auf mehrere Klassen (Herbst 2026)
 *
 *   node klassen-accounts.js vorbereiten <Schuelerliste.xlsx>
 *   node klassen-accounts.js umstellen   <Schuelerliste.xlsx>
 *   node klassen-accounts.js konten      <Schuelerliste.xlsx>   (nur Konten nachführen, z.B. neue Schüler:in)
 *
 * Braucht firebase-admin und xlsx (npm install firebase-admin xlsx) sowie den
 * Service-Account-Schlüssel: ./serviceAccountKey.json oder per
 * GOOGLE_APPLICATION_CREDENTIALS=/pfad/zum/key.json. Die Schülerliste (mit
 * Passwörtern) gehört NIE ins Repo — nur als Pfad übergeben.
 *
 * Excel: ein Blatt pro Klasse (Blattname = Klasse), Kopfzeile mit
 * "Nachname", "Vorname", "Passwort".
 *
 * vorbereiten (Live-Seite läuft noch mit dem alten Code weiter):
 *   - Konten G3a/E1c + Lehrpersonen anlegen/aktualisieren (mit Passwort)
 *   - G3b-Konten bekommen nur den Claim klasse:'G3b' (Passwort bleibt!)
 *   - alte, klassenlose Daten nach klassen/G3b kopieren
 *   - Übungen + Ordner der G3b als Kopien nach G3a/E1c (nur fehlende)
 *   - teacherTodos -> lehrer/{uid}/todos (Helfenberger)
 *   - firestore.rules (Übergangsfassung, im selben Repo) veröffentlichen
 * umstellen (zusammen mit der Freigabe des neuen Codes):
 *   - klassen/G3b nochmals mit dem aktuellen Live-Stand überschreiben
 *     (Test-Änderungen an der G3b gehen dabei verloren)
 *   - seither neu hochgeladene G3b-Übungen/Ordner nach G3a/E1c kopieren
 *   - G3b-Passwörter aus der Liste setzen
 *   - firestore.rules.nach-umstellung veröffentlichen
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const EMAIL_DOMAIN = 'helfenberger-library.app';   // wie in index.html
const HAUPTKLASSE = 'G3b';                          // behält bei doppelten Vornamen den nackten Namen
const KLASSEN = ['G3b', 'G3a', 'E1c'];
const LEHRPERSONEN = [
  // passwort: null = unverändert lassen
  { username: 'helfenberger', displayName: 'Helfenberger', klasse: 'G3b', passwort: null },
  { username: 'schlaepfer',   displayName: 'Schläpfer',    klasse: 'G3a', passwort: 'Schläpfer123' },
  { username: 'schoch',       displayName: 'Schoch',       klasse: 'E1c', passwort: 'Schoch123' }
];
// Konten, die in keiner Liste stehen, aber zu einer Klasse gehören.
const ZUSATZKONTEN = [{ username: 'schueler', klasse: 'G3b' }];
// Klassenbezogene Collections (alt: klassenlos auf oberster Ebene).
const KLASSEN_COLLECTIONS = ['resources', 'folders', 'calendarEntries', 'debts', 'appMeta',
  'klassenzimmer', 'klasseninfo', 'fragen', 'quizzes', 'quizSessions'];

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
const auth = admin.auth();
const db = admin.firestore();

function slug(s) {
  return String(s).trim().toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9-]/g, '');
}

function leseListe(file) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(file);
  const out = [];
  wb.SheetNames.forEach(function (name) {
    const klasse = name.trim();
    if (KLASSEN.indexOf(klasse) < 0) { console.warn('Blatt ignoriert: ' + name); return; }
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    const hi = rows.findIndex(function (r) { return r.indexOf('Vorname') >= 0; });
    if (hi < 0) throw new Error('Keine Kopfzeile in ' + name);
    const h = rows[hi];
    rows.slice(hi + 1).forEach(function (r) {
      const vorname = String(r[h.indexOf('Vorname')] || '').trim();
      if (!vorname) return;
      out.push({
        klasse: klasse,
        vorname: vorname,
        nachname: String(r[h.indexOf('Nachname')] || '').trim(),
        passwort: String(r[h.indexOf('Passwort')] || '').trim()
      });
    });
  });
  // Benutzernamen: doppelte Vornamen bekommen ausserhalb der Hauptklasse ein Suffix.
  const count = {};
  out.forEach(function (s) { count[slug(s.vorname)] = (count[slug(s.vorname)] || 0) + 1; });
  const aliases = {};
  out.forEach(function (s) {
    const base = slug(s.vorname);
    s.username = (count[base] > 1 && s.klasse !== HAUPTKLASSE) ? base + '-' + s.klasse.toLowerCase() : base;
    if (count[base] > 1) (aliases[base] = aliases[base] || []).push(s.username);
    if (s.passwort.length < 6) throw new Error('Passwort zu kurz: ' + s.klasse + ' ' + s.vorname);
  });
  const lehrer = LEHRPERSONEN.map(function (l) { return l.username; });
  out.forEach(function (s) {
    if (lehrer.indexOf(s.username) >= 0) throw new Error('Vorname kollidiert mit Lehrperson: ' + s.vorname);
  });
  console.log('LOGIN_ALIASES (muss so in index.html stehen): ' + JSON.stringify(aliases));
  return out;
}

async function upsert(username, props, claims, profil) {
  const email = username + '@' + EMAIL_DOMAIN;
  let user;
  try {
    user = await auth.getUserByEmail(email);
    const upd = { displayName: props.displayName };
    if (props.password) upd.password = props.password;
    await auth.updateUser(user.uid, upd);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    if (!props.password) throw new Error('Neues Konto ohne Passwort: ' + email);
    user = await auth.createUser({ email: email, password: props.password, displayName: props.displayName });
    console.log('neu      ' + email);
  }
  await auth.setCustomUserClaims(user.uid, claims);
  await db.collection('students').doc(user.uid).set(Object.assign({ username: username }, profil), { merge: true });
  return user.uid;
}

async function konten(liste, mitHauptklassePasswort) {
  for (const s of liste) {
    const pw = (s.klasse === HAUPTKLASSE && !mitHauptklassePasswort) ? null : s.passwort;
    await upsert(s.username, { displayName: s.vorname, password: pw }, { klasse: s.klasse },
      { displayName: s.vorname, nachname: s.nachname, role: 'student', klasse: s.klasse });
    console.log('Konto    ' + s.klasse + ' ' + s.username + (pw ? ' (Passwort gesetzt)' : ''));
  }
  for (const z of ZUSATZKONTEN) {
    try {
      const u = await auth.getUserByEmail(z.username + '@' + EMAIL_DOMAIN);
      await auth.setCustomUserClaims(u.uid, { klasse: z.klasse });
      await db.collection('students').doc(u.uid).set({ klasse: z.klasse }, { merge: true });
    } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
  }
  const uids = {};
  for (const l of LEHRPERSONEN) {
    uids[l.username] = await upsert(l.username, { displayName: l.displayName, password: l.passwort },
      { teacher: true, klasse: l.klasse },
      { displayName: l.displayName, role: 'teacher', klasse: l.klasse });
    console.log('Lehrer   ' + l.klasse + ' ' + l.username);
  }
  return uids;
}

// Kopiert eine Collection samt Unter-Collections. spiegeln=true löscht im Ziel,
// was es in der Quelle nicht (mehr) gibt.
async function kopiere(src, dst, opts) {
  opts = opts || {};
  const snap = await src.get();
  const ids = {};
  let writer = db.bulkWriter();
  for (const d of snap.docs) {
    ids[d.id] = true;
    const data = opts.transform ? opts.transform(d.id, d.data()) : d.data();
    writer.set(dst.doc(d.id), data);
  }
  if (opts.spiegeln) {
    const alt = await dst.get();
    for (const d of alt.docs) if (!ids[d.id]) await db.recursiveDelete(d.ref);
  }
  await writer.close();
  for (const d of snap.docs) {
    const subs = await d.ref.listCollections();
    for (const sub of subs) await kopiere(sub, dst.doc(d.id).collection(sub.id), { spiegeln: opts.spiegeln });
  }
  return snap.size;
}

function mitContentId(id, data) {
  const out = Object.assign({}, data);
  if (!out.contentId) out.contentId = id;
  if (typeof out.version !== 'number') out.version = 0;
  return out;
}

async function altNachHauptklasse() {
  for (const c of KLASSEN_COLLECTIONS) {
    const n = await kopiere(db.collection(c), db.collection('klassen').doc(HAUPTKLASSE).collection(c), {
      spiegeln: true,
      transform: c === 'resources' ? mitContentId : null
    });
    console.log('kopiert  ' + c + ' -> klassen/' + HAUPTKLASSE + ' (' + n + ')');
  }
}

async function uebungenVerteilen() {
  const res = await db.collection('resources').get();
  const fol = await db.collection('folders').get();
  for (const k of KLASSEN) {
    if (k === HAUPTKLASSE) continue;
    const kref = db.collection('klassen').doc(k);
    const metaRef = kref.collection('appMeta').doc('migration');
    const meta = (await metaRef.get()).data() || {};
    const schon = Object.assign({}, meta.kopiert || {});
    const batch = db.bulkWriter();
    let n = 0;
    fol.docs.forEach(function (d) {
      if (schon['f:' + d.id]) return;
      batch.create(kref.collection('folders').doc(d.id), d.data()).catch(function () {});
      schon['f:' + d.id] = true;
    });
    res.docs.forEach(function (d) {
      if (schon['r:' + d.id]) return;
      const data = mitContentId(d.id, d.data());
      delete data.current; delete data.prevOrder; delete data.version;
      data.originKlasse = HAUPTKLASSE;
      data.originVersion = 0;
      batch.create(kref.collection('resources').doc(d.id), data).catch(function () {});
      schon['r:' + d.id] = true;
      n++;
    });
    await batch.close();
    await metaRef.set({ kopiert: schon, at: admin.firestore.FieldValue.serverTimestamp() });
    console.log('verteilt ' + n + ' Übungen -> ' + k);
  }
}

async function todos(uid) {
  const n = await kopiere(db.collection('teacherTodos'), db.collection('lehrer').doc(uid).collection('todos'), { spiegeln: true });
  console.log('To-dos   ' + n + ' -> lehrer/helfenberger');
}

async function regeln(file) {
  const src = fs.readFileSync(file, 'utf8');
  await admin.securityRules().releaseFirestoreRulesetFromSource(src);
  console.log('Regeln veröffentlicht: ' + path.basename(file));
}

async function main() {
  const [modus, liste] = process.argv.slice(2);
  if (!modus || !liste) { console.log('Aufruf: node klassen-accounts.js vorbereiten|umstellen|konten <Schuelerliste.xlsx>'); process.exit(1); }
  const schueler = leseListe(liste);
  if (modus === 'konten') { await konten(schueler, true); return; }
  if (modus === 'vorbereiten') {
    const uids = await konten(schueler, false);
    await altNachHauptklasse();
    await uebungenVerteilen();
    await todos(uids.helfenberger);
    await regeln(path.join(__dirname, '..', 'firestore.rules'));
    return;
  }
  if (modus === 'umstellen') {
    const uids = await konten(schueler, true);
    await altNachHauptklasse();
    await uebungenVerteilen();
    await todos(uids.helfenberger);
    await regeln(path.join(__dirname, 'firestore.rules.nach-umstellung'));
    console.log('\nJetzt: PAUSE im Test-Repo löschen und die Freigabe starten (gh workflow run nightly-release.yml -R jnhbr/helfenberger-library).');
    return;
  }
  throw new Error('Unbekannter Modus: ' + modus);
}

main().then(function () { process.exit(0); }, function (err) { console.error(err); process.exit(1); });
