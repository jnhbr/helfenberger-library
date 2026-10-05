#!/usr/bin/env node
/**
 * 📮 Briefkasten abholen — holt die Abgaben aus den Briefkästen EINER Lehrperson
 * aus dem Zwischenlager (Firestore) in einen lokalen Ordner und löscht sie dort.
 *
 *   node briefkasten-abholen.js [--config <config.json>] [--laut]
 *
 * Gedacht als Hintergrunddienst auf Jans Mac (launchd, alle paar Minuten; siehe
 * briefkasten-dienst.sh). Ein Lauf:
 *   1. lehrer/{uid}/briefkaesten lesen (Verzeichnis der eigenen Briefkästen)
 *   2. pro Briefkasten die noch nicht abgeholten Abgaben (abgeholt == false),
 *      älteste zuerst
 *   3. Dateien schreiben nach  <basis>/<Fach>/Abgaben/<ordner>/<Vorname>_<Originalname>
 *      Hat dieselbe Person schon einmal abgegeben, wandern ihre bisherigen
 *      Dateien nach  _Backup/<Name>_<JJJJ-MM-TT_hhmm>.<endung>
 *   4. _Backup/briefkasten-stand.json nachführen (wer hat welche Dateien)
 *   5. erst dann in Firestore die chunks löschen und abgeholt = true setzen;
 *      ist der Briefkasten mit einem Kalendereintrag verknüpft, die Abgabe abhaken
 * Bricht ein Lauf ab, bleibt der Einwurf im Briefkasten und wird beim nächsten
 * Lauf nochmals geholt (die halb geschriebene Fassung landet dann im Backup).
 *
 * Die Ablage-Logik (Namen, Backup, Stand-Datei) ist dieselbe wie beim Knopf
 * «📬 Leeren» in index.html (bkLeerenLauf) — beide gleich halten.
 *
 * config.json:
 *   { "benutzer": "helfenberger",
 *     "schluessel": "~/…/serviceAccountKey.json",
 *     "basis": "~/Desktop/Altnau/Fächer",
 *     "muster": "{fach}/Abgaben/{ordner}",
 *     "faecher": { "mathe": "Mathematik", … },     Fach-ID der Library -> Ordnername
 *     "mitteilung": true }                          macOS-Mitteilung bei neuen Abgaben
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const FAECHER_STANDARD = {
  mathe: 'Mathematik', deutsch: 'Deutsch', geografie: 'Geografie', geschichte: 'Geschichte',
  biologie: 'NT', chemie: 'NT', physik: 'NT', informatik: 'Medien:Informatik', sport: 'Sport',
  werken: 'Werken', wah: 'WAH', berufswahl: 'BO', gtz: 'GTZ', psychologie: 'ERG',
  'freies-schreiben': 'Zeichnen', 'schach-jassen': 'Jassen'
};

function heim(p) { return p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p; }
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function log() { console.log.apply(console, [new Date().toISOString().slice(0, 19).replace('T', ' ')].concat([].slice.call(arguments))); }

// ---------- Ablage (gleich wie in index.html) ----------
function sicher(name) {
  const s = String(name || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
  return s.slice(0, 80);
}
function teilen(name) { const i = name.lastIndexOf('.'); return i > 0 && name.length - i <= 9 ? [name.slice(0, i), name.slice(i)] : [name, '']; }
function lokalName(label, original, spaet) {
  const t = teilen(sicher(original) || 'Datei');
  return label + '_' + t[0] + (spaet ? ' (verspätet)' : '') + t[1];
}
function stempel(ms) {
  const d = new Date(ms || Date.now());
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes());
}
function freierName(dir, name) {
  const t = teilen(name);
  let n = name, i = 2;
  while (fs.existsSync(path.join(dir, n))) n = t[0] + ' (' + (i++) + ')' + t[1];
  return n;
}
function standLesen(backup) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(backup, 'briefkasten-stand.json'), 'utf8'));
    if (j && j.personen) return j;
  } catch (e) { /* noch keiner */ }
  return { version: 1, personen: {} };
}
function schreiben(datei, inhalt) {
  const tmp = datei + '.teil';
  fs.writeFileSync(tmp, inhalt);
  fs.renameSync(tmp, datei);
}
function labelFuer(stand, uid, person) {
  if (stand.personen[uid] && stand.personen[uid].label) return stand.personen[uid].label;
  const basis = sicher((person && (person.displayName || person.username)) || uid.slice(0, 6)) || 'Unbekannt';
  const belegt = {};
  Object.keys(stand.personen).forEach((u) => { belegt[stand.personen[u].label] = true; });
  let label = basis;
  if (belegt[label]) {
    const zus = person && person.nachname ? String(person.nachname).charAt(0).toUpperCase() : (person && person.klasse) || '';
    if (zus) label = basis + ' ' + sicher(zus);
    for (let i = 2; belegt[label]; i++) label = basis + ' ' + i;
  }
  return label;
}
function istSpaet(bk, uid, amMs) {
  if (!bk.frist || amMs <= bk.frist) return false;
  return !(bk.verlaengert && bk.verlaengert[uid] >= amMs);
}
/**
 * Legt EINEN Einwurf im Ordner ab. dateien = [{n: Originalname, inhalt: Buffer}].
 * Gibt {namen, ersetzt} zurück und führt die Stand-Datei nach.
 */
function ablegen(dir, bk, einwurf, dateien, person) {
  const backup = path.join(dir, '_Backup');
  fs.mkdirSync(backup, { recursive: true });
  const stand = standLesen(backup);
  const label = labelFuer(stand, einwurf.uid, person);
  const spaet = istSpaet(bk, einwurf.uid, einwurf.am);
  const alt = stand.personen[einwurf.uid];
  let ersetzt = false;
  if (alt && (alt.dateien || []).length) {
    const st = stempel(alt.am);
    alt.dateien.forEach((altName) => {
      const von = path.join(dir, altName);
      if (!fs.existsSync(von)) return;
      const t = teilen(altName);
      fs.renameSync(von, path.join(backup, freierName(backup, t[0] + '_' + st + t[1])));
      ersetzt = true;
    });
  }
  const namen = [];
  dateien.forEach((d) => {
    const name = freierName(dir, lokalName(label, d.n, spaet));
    schreiben(path.join(dir, name), d.inhalt);
    namen.push(name);
  });
  stand.personen[einwurf.uid] = { label: label, aid: einwurf.id, am: einwurf.am, dateien: namen, spaet: spaet };
  stand.briefkasten = bk.id; stand.titel = bk.titel;
  schreiben(path.join(backup, 'briefkasten-stand.json'), JSON.stringify(stand, null, 2));
  return { namen: namen, ersetzt: ersetzt, spaet: spaet };
}
function zielOrdner(cfg, bk) {
  const faecher = Object.assign({}, FAECHER_STANDARD, cfg.faecher || {});
  const fach = faecher[bk.subject] || sicher(bk.fachName || bk.subject) || 'Fach';
  const rel = (cfg.muster || '{fach}/Abgaben/{ordner}')
    .replace('{fach}', fach).replace('{ordner}', sicher(bk.ordner || bk.titel) || 'Briefkasten');
  return path.join(heim(cfg.basis), rel);
}

// ---------- Firestore ----------
function ms(t) { return !t ? 0 : typeof t === 'number' ? t : t.toMillis ? t.toMillis() : 0; }

async function lauf(cfg, laut) {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(require(heim(cfg.schluessel))) });
    admin.firestore().settings({ preferRest: true });   // gRPC blieb auf Jans Mac hängen
  }
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue, FieldPath = admin.firestore.FieldPath;

  let uid = cfg.uid;
  if (!uid) uid = (await admin.auth().getUserByEmail(cfg.benutzer + '@helfenberger-library.app')).uid;

  const verzeichnis = await db.collection('lehrer').doc(uid).collection('briefkaesten').get();
  const personen = {};
  let geholt = 0;
  const meldungen = [];
  for (const eintrag of verzeichnis.docs) {
    const klasse = eintrag.data().klasse;
    if (!klasse) continue;
    const bkRef = db.doc('klassen/' + klasse + '/briefkaesten/' + eintrag.id);
    const bkSnap = await bkRef.get();
    if (!bkSnap.exists) { await eintrag.ref.delete(); continue; }   // Briefkasten wurde abgebaut
    const bk = Object.assign({ id: eintrag.id }, bkSnap.data());
    if (bk.ownerUid !== uid) continue;
    const neuSnap = await bkRef.collection('abgaben').where('abgeholt', '==', false).get();
    if (neuSnap.empty) { if (laut) log('leer:', bk.titel); continue; }
    const neu = neuSnap.docs.map((d) => Object.assign({ id: d.id, ref: d.ref }, d.data())).sort((a, b) => ms(a.am) - ms(b.am));
    const dir = zielOrdner(cfg, bk);
    let n = 0;
    for (const a of neu) {
      // Inhalt zusammensetzen (chunks 0..n-1, jede Datei beginnt in einem neuen chunk)
      const teile = [];
      let ganz = true;
      for (let i = 0; i < a.chunkCount; i++) {
        const c = await a.ref.collection('chunks').doc(String(i)).get();
        if (!c.exists) { ganz = false; break; }
        teile.push(Buffer.from(c.data().bin));
      }
      if (!ganz) { log('unvollständig, bleibt liegen:', bk.titel, a.id); continue; }
      let pos = 0;
      const dateien = (a.dateien || []).map((f) => {
        const inhalt = Buffer.concat(teile.slice(pos, pos + f.c));
        pos += f.c;
        return { n: f.n, inhalt: inhalt };
      });
      if (!(a.uid in personen)) {
        const p = await db.collection('students').doc(a.uid).get();
        personen[a.uid] = p.exists ? p.data() : null;
      }
      const r = ablegen(dir, bk, { id: a.id, uid: a.uid, am: ms(a.am) }, dateien, personen[a.uid]);
      // Erst jetzt in der Cloud aufräumen.
      const batch = db.batch();
      for (let i = 0; i < a.chunkCount; i++) batch.delete(a.ref.collection('chunks').doc(String(i)));
      batch.update(a.ref, { abgeholt: true, abgeholtAm: FieldValue.serverTimestamp(), spaet: r.spaet });
      await batch.commit();
      if (bk.kalenderId) {
        await db.doc('klassen/' + klasse + '/calendarEntries/' + bk.kalenderId)
          .update(new FieldPath('submitted', a.uid), true).catch(() => {});
      }
      log('abgeholt:', bk.titel, '→', r.namen.join(', '), r.ersetzt ? '(frühere Fassung im _Backup)' : '');
      n++;
    }
    if (n) { geholt += n; meldungen.push(n + ' × ' + bk.titel); }
  }
  if (geholt && cfg.mitteilung !== false) {
    execFile('/usr/bin/osascript', ['-e',
      'display notification ' + JSON.stringify(meldungen.join(', ')) + ' with title "📮 Briefkasten" subtitle ' +
      JSON.stringify(geholt + (geholt === 1 ? ' neue Abgabe' : ' neue Abgaben'))], () => {});
  }
  return geholt;
}

module.exports = { sicher, teilen, lokalName, stempel, ablegen, zielOrdner, istSpaet, labelFuer };

if (require.main === module) {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--config');
  const cfgPfad = ci >= 0 ? args[ci + 1] : path.join(os.homedir(), 'Library', 'Application Support', 'LibraryBriefkasten', 'config.json');
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(cfgPfad, 'utf8')); }
  catch (e) { log('Konfiguration nicht lesbar:', cfgPfad, e.message); process.exit(1); }
  lauf(cfg, args.indexOf('--laut') >= 0).then((n) => {
    if (args.indexOf('--laut') >= 0) log('fertig,', n, 'abgeholt');
    process.exit(0);
  }).catch((err) => {
    // Ohne Netz o. Ä.: beim nächsten Lauf nochmals. EPERM = macOS verweigert den Ordner.
    log('Fehler:', err && err.code === 'EPERM'
      ? 'macOS verweigert den Zugriff auf den Ordner. Systemeinstellungen › Datenschutz & Sicherheit › Dateien und Ordner › «node» den Schreibtisch erlauben.'
      : (err && err.message) || err);
    process.exit(1);
  });
}
