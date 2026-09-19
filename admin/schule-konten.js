/**
 * Helfenberger's Library — alle Sek-Klassen, FLP, ISF, Praktikum (seit 19.09.2026)
 *
 *   node schule-konten.js pruefen   <Logins.xlsx>   (nur anzeigen, was passieren würde)
 *   node schule-konten.js konten    <Logins.xlsx>   (Konten + Login-Aliase anlegen/nachführen)
 *   node schule-konten.js verteilen                 (G3b-Übungen + Ordner in leere Seiten kopieren)
 *   node schule-konten.js mathegruppe               (einmalig: Elena/Letizia -> Gruppe «Mathe G3b»)
 *
 * Braucht firebase-admin und xlsx sowie den Service-Account-Schlüssel
 * (GOOGLE_APPLICATION_CREDENTIALS=/pfad/zum/key.json). Die Liste mit
 * Passwörtern gehört NIE ins Repo — nur als Pfad übergeben.
 *
 * Excel (Logins.xlsx): ein Blatt pro Klasse (Blattname = Klasse) mit Kopfzeile
 * "Nachname", "Vorname", "Benutzername (E-Mail)", "Passwort"; ein Blatt
 * "Lehrpersonen" mit "Nachname", "Vorname", "Benutzername", "Klasse", "Passwort".
 *
 * Grundsätze:
 *  - Bestehende Konten behalten IMMER ihr Passwort und ihren Benutzernamen
 *    (erkannt an Vorname + Nachname). Nur Klasse/Kürzel werden nachgeführt.
 *  - Neue Schüler:innen-Konten heissen wie ihr Schul-Kürzel (anhe@sekaltnau.ch
 *    -> anhe); ist das schon vergeben, mit Klassen-Suffix (ella-e2b).
 *  - Login mit Vorname ODER Kürzel: loginAliases/{slug} = {konten:[...]}.
 *  - Lehrpersonen ohne Klasse bekommen eine eigene Seite: flp-<name>,
 *    isf-<name>, praktikum-<n> (muss zu KLASSEN in index.html passen).
 */
const admin = require('firebase-admin');
const path = require('path');

const EMAIL_DOMAIN = 'helfenberger-library.app';   // wie in index.html
const KLASSEN = ['G1a', 'G1b', 'G2a', 'G2b', 'G3a', 'G3b', 'E1a', 'E1b', 'E1c', 'E2a', 'E2b', 'E2c', 'E3a', 'E3b'];
// Stehen in zwei Blättern: hier ist ihre Stammklasse (bei der anderen LP über 👥 Gruppe).
const STAMMKLASSE = { ellu: 'E3b', lece: 'E3b' };
const QUELLE_UEBUNGEN = 'G3b';
// Konten, die nicht in der Liste stehen und nie angefasst werden.
const NICHT_ANFASSEN = ['schueler', 'schulleitung'];

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
const auth = admin.auth();
const db = admin.firestore();
db.settings({ preferRest: true });   // gRPC blieb auf Jans Mac hängen

function slug(s) {
  return String(s).trim().toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/é|è|ê/g, 'e').replace(/[^a-z0-9-]/g, '');
}
function clean(v) { return String(v == null ? '' : v).replace(/[\s ]+/g, ' ').trim(); }
function norm(s) { return slug(clean(s)); }

function seitenId(l) {
  if (KLASSEN.indexOf(l.klasseRoh) >= 0) return { klasse: l.klasseRoh, art: 'klp' };
  const k = l.klasseRoh.toLowerCase();
  if (k.indexOf('isf') >= 0) return { klasse: 'isf-' + l.username, art: 'isf' };
  if (k.indexOf('praktikum') >= 0) return { klasse: 'praktikum-' + l.username.replace(/\D/g, ''), art: 'praktikum' };
  return { klasse: 'flp-' + l.username, art: 'flp' };
}

function leseListe(file) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(file);
  const schueler = [], lehrer = [];
  wb.SheetNames.forEach(function (name) {
    const blatt = name.trim();
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    const hi = rows.findIndex(function (r) { return r.map(clean).indexOf('Nachname') >= 0; });
    if (hi < 0) { console.warn('Blatt ohne Kopfzeile ignoriert: ' + name); return; }
    const h = rows[hi].map(clean);
    const col = function (r, t) { const i = h.findIndex(function (x) { return x.indexOf(t) === 0; }); return i < 0 ? '' : clean(r[i]); };
    if (blatt === 'Lehrpersonen') {
      rows.slice(hi + 1).forEach(function (r) {
        const username = col(r, 'Benutzername');
        if (!username) return;
        const l = { username: slug(username), nachname: col(r, 'Nachname'), vorname: col(r, 'Vorname'),
                    klasseRoh: col(r, 'Klasse'), passwort: col(r, 'Passwort') };
        Object.assign(l, seitenId(l));
        l.displayName = l.nachname;
        lehrer.push(l);
      });
      return;
    }
    if (KLASSEN.indexOf(blatt) < 0) { console.warn('Blatt ignoriert: ' + name); return; }
    rows.slice(hi + 1).forEach(function (r) {
      const vorname = col(r, 'Vorname');
      if (!vorname) return;
      const mail = col(r, 'Benutzername').replace(/\s/g, '').toLowerCase();
      schueler.push({ klasse: blatt, vorname: vorname, nachname: col(r, 'Nachname'),
                      kuerzel: slug(mail.split('@')[0]), passwort: col(r, 'Passwort') });
    });
  });
  // Doppelte (gleiches Kürzel in zwei Blättern) nur in der Stammklasse.
  const out = [], gesehen = {};
  schueler.forEach(function (s) {
    const stamm = STAMMKLASSE[s.kuerzel];
    if (stamm && s.klasse !== stamm) return;
    if (gesehen[s.kuerzel]) throw new Error('Kürzel doppelt: ' + s.kuerzel + ' (' + gesehen[s.kuerzel] + ', ' + s.klasse + ')');
    gesehen[s.kuerzel] = s.klasse;
    out.push(s);
  });
  return { schueler: out, lehrer: lehrer };
}

async function bestehendeProfile() {
  const snap = await db.collection('students').get();
  const list = [];
  snap.forEach(function (d) { list.push(Object.assign({ uid: d.id }, d.data())); });
  return list;
}

// Plan: wer ist schon da (Passwort bleibt), wer wird neu angelegt, welche Aliase.
async function planen(file) {
  const liste = leseListe(file);
  const profile = await bestehendeProfile();
  const vergeben = {};
  profile.forEach(function (p) { if (p.username) vergeben[p.username] = p; });
  liste.lehrer.forEach(function (l) { vergeben[l.username] = vergeben[l.username] || { username: l.username, role: 'teacher' }; });

  const plan = [];
  liste.schueler.forEach(function (s) {
    const alt = profile.find(function (p) {
      return p.role === 'student' && norm(p.displayName) === norm(s.vorname) && norm(p.nachname) === norm(s.nachname);
    });
    if (alt) { plan.push(Object.assign({}, s, { username: alt.username, uid: alt.uid, neu: false, alt: alt })); return; }
    let u = s.kuerzel;
    if (!u) throw new Error('Kein Kürzel: ' + s.klasse + ' ' + s.vorname);
    if (vergeben[u]) u = u + '-' + s.klasse.toLowerCase();
    if (vergeben[u]) throw new Error('Benutzername vergeben: ' + u);
    if (s.passwort.length < 6) throw new Error('Passwort zu kurz: ' + s.klasse + ' ' + s.vorname);
    vergeben[u] = { username: u };
    plan.push(Object.assign({}, s, { username: u, neu: true }));
  });

  // Aliase: Vorname -> alle Konten mit diesem Vornamen, Kürzel -> Konto.
  const aliase = {};
  function add(key, username) {
    if (!key) return;
    (aliase[key] = aliase[key] || []);
    if (aliase[key].indexOf(username) < 0) aliase[key].push(username);
  }
  // Auch Lehrpersonen und Sonderkonten zuerst unter ihrem eigenen Namen.
  liste.lehrer.forEach(function (l) { add(l.username, l.username); });
  NICHT_ANFASSEN.forEach(function (u) { add(u, u); });
  plan.forEach(function (s) { add(s.username, s.username); });
  plan.forEach(function (s) { add(slug(s.vorname), s.username); add(s.kuerzel, s.username); });
  const aliasDocs = {};
  Object.keys(aliase).forEach(function (k) {
    const konten = aliase[k];
    if (konten.length === 1 && konten[0] === k) return;   // eingetippt = Kontoname, nichts nötig
    aliasDocs[k] = konten;
  });
  return { plan: plan, lehrer: liste.lehrer, aliasDocs: aliasDocs };
}

async function upsert(username, displayName, passwort, claims, profil) {
  const email = username + '@' + EMAIL_DOMAIN;
  let user, neu = false;
  try {
    user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, { displayName: displayName });   // Passwort bleibt!
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    if (!passwort || passwort.length < 6) throw new Error('Neues Konto ohne gültiges Passwort: ' + email);
    user = await auth.createUser({ email: email, password: passwort, displayName: displayName });
    neu = true;
  }
  await auth.setCustomUserClaims(user.uid, claims);
  await db.collection('students').doc(user.uid).set(Object.assign({ username: username }, profil), { merge: true });
  return { uid: user.uid, neu: neu };
}

async function konten(file, trocken) {
  const p = await planen(file);
  const neu = p.plan.filter(function (s) { return s.neu; });
  const umzug = p.plan.filter(function (s) { return !s.neu && s.alt.klasse !== s.klasse; });
  console.log('Schüler:innen: ' + p.plan.length + ' (neu ' + neu.length + ', bestehend ' + (p.plan.length - neu.length) + ')');
  umzug.forEach(function (s) { console.log('  Klassenwechsel ' + s.username + ': ' + s.alt.klasse + ' -> ' + s.klasse); });
  console.log('Lehrpersonen: ' + p.lehrer.length);
  p.lehrer.forEach(function (l) { console.log('  ' + l.username + ' -> ' + l.klasse + ' (' + l.art + ')'); });
  console.log('Login-Aliase: ' + Object.keys(p.aliasDocs).length);
  if (trocken) {
    Object.keys(p.aliasDocs).filter(function (k) { return p.aliasDocs[k].length > 1; }).sort().forEach(function (k) {
      console.log('  ' + k + ' -> ' + p.aliasDocs[k].join(', '));
    });
    return;
  }
  for (const s of p.plan) {
    const profil = { displayName: s.vorname, nachname: s.nachname, role: 'student', klasse: s.klasse,
                     kuerzel: s.kuerzel, nurFach: admin.firestore.FieldValue.delete() };
    const r = await upsert(s.username, s.vorname, s.neu ? s.passwort : null, { klasse: s.klasse }, profil);
    console.log((r.neu ? 'neu      ' : 'ok       ') + s.klasse + ' ' + s.username);
  }
  for (const l of p.lehrer) {
    const r = await upsert(l.username, l.displayName, l.passwort, { teacher: true, klasse: l.klasse },
      { displayName: l.displayName, vorname: l.vorname, role: 'teacher', klasse: l.klasse, art: l.art });
    console.log((r.neu ? 'neu LP   ' : 'ok LP    ') + l.klasse + ' ' + l.username);
  }
  const batch = db.bulkWriter();
  Object.keys(p.aliasDocs).forEach(function (k) { batch.set(db.collection('loginAliases').doc(k), { konten: p.aliasDocs[k] }); });
  await batch.close();
  console.log('Login-Aliase geschrieben: ' + Object.keys(p.aliasDocs).length);
}

// G3b-Übungen + Ordner als Kopien in jede Seite, die noch keine Übungen hat.
async function verteilen() {
  const seiten = KLASSEN.slice();
  const lp = await db.collection('students').where('role', '==', 'teacher').get();
  lp.forEach(function (d) { const k = d.data().klasse; if (k && seiten.indexOf(k) < 0) seiten.push(k); });
  const src = db.collection('klassen').doc(QUELLE_UEBUNGEN);
  const res = await src.collection('resources').get();
  const fol = await src.collection('folders').get();
  for (const k of seiten) {
    if (k === QUELLE_UEBUNGEN) continue;
    const kref = db.collection('klassen').doc(k);
    const schon = await kref.collection('resources').limit(1).get();
    if (!schon.empty) { console.log('hat schon Übungen, übersprungen: ' + k); continue; }
    const w = db.bulkWriter();
    fol.docs.forEach(function (d) { w.set(kref.collection('folders').doc(d.id), d.data()); });
    res.docs.forEach(function (d) {
      const data = Object.assign({}, d.data());
      if (!data.contentId) data.contentId = d.id;
      data.originKlasse = QUELLE_UEBUNGEN;
      data.originVersion = typeof data.version === 'number' ? data.version : 0;
      ['current', 'prevOrder', 'version', 'empfohlen', 'prevContentId'].forEach(function (f) { delete data[f]; });
      w.set(kref.collection('resources').doc(d.id), data);
      // uebungsIndex/{id}: wo die Übung überall liegt (siehe index.html, uebungKlassen)
      w.set(db.collection('uebungsIndex').doc(d.id), { klassen: admin.firestore.FieldValue.arrayUnion(QUELLE_UEBUNGEN, k) }, { merge: true });
    });
    await w.close();
    console.log('verteilt ' + res.size + ' Übungen, ' + fol.size + ' Ordner -> ' + k);
  }
}

// Einmalig: Elena/Letizia sind jetzt in der E3b; damit sie Mathe bei der G3b
// weiter sehen, gibt es die Gruppe «Mathe G3b» (G3b + beide), und die
// anstehenden Mathe-Einträge der G3b werden dieser Gruppe zugeordnet.
async function mathegruppe() {
  const jan = (await db.collection('students').where('username', '==', 'helfenberger').get()).docs[0];
  if (!jan) throw new Error('helfenberger nicht gefunden');
  const g3b = await db.collection('students').where('klasse', '==', 'G3b').get();
  const gaeste = [];
  for (const u of ['elena', 'letizia']) {
    const s = (await db.collection('students').where('username', '==', u).get()).docs[0];
    if (s) gaeste.push(s);
  }
  const mitglieder = [], namen = {};
  g3b.docs.concat(gaeste).forEach(function (d) {
    const s = d.data();
    if (s.role !== 'student' || s.username === 'schueler' || mitglieder.indexOf(d.id) >= 0) return;
    mitglieder.push(d.id);
    namen[d.id] = { n: s.displayName || s.username, nn: s.nachname || '', u: s.username || '', k: s.klasse || '' };
  });
  const id = 'grp_mathe_g3b';
  const ts = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('gruppen').doc(id).set({
    ownerUid: jan.id, ownerName: jan.data().displayName || 'Helfenberger', ownerKlasse: 'G3b',
    fach: 'mathe', name: 'Mathe G3b', mitglieder: mitglieder, namen: namen, createdAt: ts, updatedAt: ts
  });
  console.log('Gruppe Mathe G3b: ' + mitglieder.length + ' Mitglieder (Gäste: ' + gaeste.map(function (d) { return d.data().username + '/' + d.data().klasse; }).join(', ') + ')');
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
  const eintraege = await db.collection('klassen').doc('G3b').collection('calendarEntries').where('subject', '==', 'mathe').get();
  let n = 0;
  for (const d of eintraege.docs) {
    const e = d.data();
    if ((e.dueDate || '') < heute || e.gruppeId) continue;
    await d.ref.update({ gruppeId: id, gruppeName: 'Mathe G3b', mitglieder: mitglieder });
    n++;
  }
  console.log('Anstehende Mathe-Einträge der Gruppe zugeordnet: ' + n);
}

(async function () {
  const modus = process.argv[2], file = process.argv[3];
  if (modus === 'pruefen') await konten(file, true);
  else if (modus === 'konten') await konten(file, false);
  else if (modus === 'verteilen') await verteilen();
  else if (modus === 'mathegruppe') await mathegruppe();
  else { console.log('Modus: pruefen | konten | verteilen | mathegruppe'); process.exit(1); }
  process.exit(0);
})().catch(function (err) { console.error(err); process.exit(1); });
