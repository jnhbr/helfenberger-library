/**
 * Helfenberger's Library — 👥 Gruppen aus Gruppen-Excel + Stundenplan (seit 27.09.2026)
 *
 *   node gruppen-stundenplan.js --ordner "<Stundenpläne/2026:27>" --semester 1        (Vorschau)
 *   node gruppen-stundenplan.js --ordner "<Stundenpläne/2026:27>" --semester 1 --ja   (schreiben)
 *
 * Braucht firebase-admin, xlsx, den Service-Account-Schlüssel (wie _firebase.js)
 * und `pdftotext` (poppler). Im Ordner liegen:
 *   _Gruppen.xlsm         Blätter «1.Klassen» … «3.Klassen»: pro Spalte eine Gruppe
 *                         (Zeile 3 Fach/Gruppe, Zeile 4 Niveau bzw. Tag, Zeile 5 Lehrkraft),
 *                         pro Zeile ein:e Schüler:in, «1» = in der Gruppe.
 *   Lehrerpläne_<n>/      Lehrerplan_<Kürzel>.pdf aus Untis, Semester n. Daraus kommen die
 *                         Fächer, die eine ganze Klasse bei einer anderen Lehrperson hat
 *                         (z. B. Sport G3b bei Herforth).
 * Namen/Noten der Schüler:innen gehören NIE ins Repo — nur den Ordner als Pfad übergeben.
 *
 * Was passiert:
 *  - Jede Excel-Gruppe und jedes «ganze Klasse bei anderer LP»-Fach wird eine 👥 Gruppe
 *    auf der Seite der Lehrperson (gruppen/stp_…, quelle:'stundenplan', planKey).
 *    Schüler:innen sehen dann im Fach deren Übungen; hat die eigene Klassenseite im Fach
 *    keine Gruppe, wird sie im Fach ausgeblendet (index.html, fachQuellen).
 *  - Nochmals laufen lassen (z. B. mit --semester 2) führt Mitglieder, Lehrperson und
 *    Namen nach; Stundenplan-Gruppen, die es nicht mehr gibt, werden gelöscht.
 *    Von Hand erstellte Gruppen bleiben unberührt (ausser den in BESTEHENDE genannten).
 *  - Danach für jede betroffene Seite appMeta/gruppenMitglieder (Leserecht) und die
 *    Kalender-Einträge der Gruppen (mitglieder, gruppeName) nachführen.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { starten } = require('./_firebase');

const args = process.argv.slice(2);
function arg(n) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; }
const ORDNER = arg('--ordner');
const SEMESTER = Number(arg('--semester'));
const JA = args.includes('--ja');
if (!ORDNER || !(SEMESTER === 1 || SEMESTER === 2)) {
  console.log('Aufruf: --ordner "<Stundenpläne/2026:27>" --semester 1|2 [--ja]');
  process.exit(1);
}

// ---------- Schul-Stammdaten (Schuljahr 2026/27) ----------
const { LP } = require('./_untis');   // Untis-Kürzel -> Benutzername
// Klassenlehrpersonen: deren eigene Fächer brauchen keine Ganzklassen-Gruppe.
const KLP = {
  G1a: ['Fi'], G1b: ['Al', 'Bo'], G2a: ['Fe'], G2b: ['Sb'], G3a: ['Sc'], G3b: ['Hr'],
  E1a: ['St'], E1b: ['Se'], E1c: ['Sh'], E2a: ['Sä'], E2b: ['Ri'], E2c: ['Lo'], E3a: ['Ru'], E3b: ['Sz']
};
// Vertretungen/Abweichungen gegenüber der Lehrkraft in der Excel (Schlüssel: Jahrgang|Gruppe|Lehrkraft).
// Semester 1: Schläpfer fehlt (Lehrerpläne_1 vs. _2 verglichen am 27.09.2026).
const ERSATZ = {
  1: {
    '2|En Gma|Sr': ['Ro'], '2|Wt Di Vm|Sc': ['Le'],
    '3|Ma Gma|Sc': ['Bä', 'Hä'], '3|BG2 Mo|Sc': ['Gi'], '3|En Gmb|Sr': ['Ro'], '3|En mEb|Sr': ['Ro']
  },
  2: {}
};
// Zusätzliche Lehrpersonen einer Gruppe (Teamteaching laut Lehrerplan).
const DAZU = { '1|En mEc|Gr': ['Ha'] };
// Kurse, die es nur in einem Semester gibt (sonst am Namen «1.S.»/«2.S.» erkannt).
const NUR_SEMESTER = { '3|Hw2': 2, '3|HW1': 1 };
// Von Hand angelegte Gruppen, die ab jetzt aus dem Plan nachgeführt werden
// (Name und ID bleiben, damit Kalender-Einträge dranhängen bleiben).
const BESTEHENDE = {
  grp_mathe_g3b: '3|Ma Gmb|Hr',
  grp_1789820575150_c63a8d: '1|Tu Kn Do Na|Hr',
  grp_1789820642951_9te87h: '3|GTZ Do|Hr',
  grp_1789820449033_nfken4: 'klasse|E3b|In|Hr',
  grp_1789820479051_z0h7fy: 'klasse|E3a|In|Hr',
  grp_1789820511050_1207ar: 'klasse|G3a|In|Hr'
};
// Excel-Code (klein, ohne Leerzeichen/Punkte) -> App-Fach. Nicht aufgeführt = keine Gruppe.
function fachAusCode(c) {
  c = c.toLowerCase().replace(/[\s.]/g, '');
  const tab = [
    [/^ma(g|m)/, 'mathe'], [/^m\+/, 'mathe'], [/^fr(g|m)/, 'franzoesisch'], [/^en(g|m)/, 'englisch'],
    [/^wn/, 'werken'], [/^wt/, 'textiles-werken'], [/^tu/, 'sport'], [/^t[km]\d/, 'sport'],
    [/^gtz/, 'gtz'], [/^sp(\+|$)/, 'spanisch'], [/^hw/, 'wah'], [/^(band|bw)$/, 'band'], [/^vb$/, 'volleyball'],
    [/^bg/, 'freies-schreiben'], [/^msp$/, 'makerspace'], [/^al$/, 'algebra'], [/^fot/, 'fotokurs'],
    [/^ph$/, 'physik'], [/^fb$/, 'fussball'], [/^sj$/, 'schach-jassen']
  ];
  for (const [re, f] of tab) if (re.test(c)) return f;
  return null;
}
// Lehrerplan-Fach (ganze Klasse) -> App-Fach bzw. Sammelfach (nt/rzg, siehe GRUPPE_FACH_SETS).
// «Ban» = Musik im Bandraum (Untis schreibt «C04 Ban Mu», der zweite Raum landet im Fach-Feld).
const GANZKLASSE = { De: 'deutsch', NT: 'nt', RZG: 'rzg', Tu: 'sport', Mu: 'musik', Ban: 'musik', BG: 'freies-schreiben', In: 'informatik', Ek: 'psychologie', WAH: 'wah' };
const FACHNAME = {
  mathe: 'Mathe', deutsch: 'Deutsch', englisch: 'Englisch', franzoesisch: 'Französisch', werken: 'Werken',
  'textiles-werken': 'TTG', sport: 'Sport', gtz: 'GTZ', spanisch: 'Spanisch', wah: 'WAH', band: 'Band',
  volleyball: 'Volleyball', 'freies-schreiben': 'Zeichnen', makerspace: 'Makerspace', algebra: 'Algebra',
  fotokurs: 'Fotokurs', physik: 'Physik', fussball: 'Fussball', 'schach-jassen': 'Schach & Jassen',
  nt: 'NT', rzg: 'RZG', musik: 'Musik', informatik: 'M&I', psychologie: 'ERG'
};

function clean(v) { return String(v == null ? '' : v).replace(/[\s ]+/g, ' ').trim(); }
function slug(s) {
  return String(s).normalize('NFC').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/é|è|ê/g, 'e').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function datei(name) {   // Umlaute im Dateinamen (macOS: NFD) robust finden
  const hit = fs.readdirSync(ORDNER).find(function (f) { return f.normalize('NFC') === name.normalize('NFC'); });
  if (!hit) throw new Error('Nicht gefunden: ' + name + ' in ' + ORDNER);
  return path.join(ORDNER, hit);
}

// ---------- Excel lesen ----------
function leseExcel() {
  const wb = XLSX.readFile(datei('_Gruppen.xlsm'));
  const gruppen = {};
  ['1.Klassen', '2.Klassen', '3.Klassen'].forEach(function (blatt) {
    const jg = blatt.charAt(0);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[blatt], { header: 1, defval: null, raw: true });
    const zelle = function (r, c) { return (rows[r - 1] || [])[c - 1]; };
    const schueler = [];
    let klasse = null;
    for (let r = 7; r <= 160; r++) {   // ab Zeile 161 folgen die Summen
      const a = clean(zelle(r, 1));
      if (/^[GE][123][a-c]$/.test(a)) klasse = a;
      const nn = clean(zelle(r, 3)), vn = clean(zelle(r, 4));
      if (nn && vn && klasse) schueler.push({ r: r, k: klasse, nn: nn, vn: vn });
    }
    const breite = Math.max.apply(null, rows.slice(0, 5).map(function (x) { return x ? x.length : 0; }));
    for (let c = 12; c <= breite; c++) {
      let code = clean(zelle(3, c)), z4 = clean(zelle(4, c));
      const lk = clean(zelle(5, c));
      // 3. Klassen (Wahlfächer): Zeile 3 = Tag, Zeile 4 = Kurs.
      if (/^(Mo|Di|Mi|Do|Fr)$/.test(code)) { const t = code; code = z4; z4 = t; }
      if (!code || !lk || lk === 'K' || lk === 'x' || /disp/.test(z4)) continue;
      const fach = fachAusCode(code);
      if (!fach) continue;
      const niveau = /^[gme]$/.test(z4);
      let name = code.replace(/\s*[12]\s*\.\s*S\s*\.?/i, '').trim();
      const sem = /1\s*\.\s*S/i.test(code) ? 1 : /2\s*\.\s*S/i.test(code) ? 2 : (NUR_SEMESTER[jg + '|' + name] || 0);
      if (!niveau && z4) name += ' ' + z4;   // Halbklassen/Wahlfächer: Tag dazu (HW Mo, HW Di …)
      const mitglieder = schueler.filter(function (s) { const v = zelle(s.r, c); return v === 1 || v === '1'; });
      lk.split(/\s+/).forEach(function (kz) {
        const key = jg + '|' + name + '|' + kz;
        const g = gruppen[key] || (gruppen[key] = { key: key, jg: jg, code: name, fach: fach, lk: kz, sem: sem, mitglieder: [] });
        mitglieder.forEach(function (m) { if (g.mitglieder.indexOf(m) < 0) g.mitglieder.push(m); });
      });
    }
  });
  return Object.values(gruppen);
}

// ---------- Lehrerpläne: Fächer ganzer Klassen ----------
function leseGanzklassen() {
  const dir = datei('Lehrerpläne_' + SEMESTER);
  const out = {};
  fs.readdirSync(dir).filter(function (f) { return /\.pdf$/i.test(f); }).forEach(function (f) {
    const kz = f.normalize('NFC').replace(/^Lehrerplan_/, '').replace(/\.pdf$/i, '');
    let txt = '';
    try { txt = execFileSync('pdftotext', ['-layout', path.join(dir, f), '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (e) { txt = e.stdout || ''; }   // Untis-PDFs melden harmlose Stream-Fehler
    const re = /\*?\b([GE][123][a-c](?:,[GE][0-9a-c]*)*) ([A-Z][0-9]{2}|S[0-9]{2}|Flab|Band) ([A-Za-zÄÖÜäöü+\/]+)(?: ([GmE][a-zA-Z]{1,3}|[0-9]))?\b/g;
    let m;
    while ((m = re.exec(txt))) {
      if (m[1].indexOf(',') >= 0 || m[4]) continue;   // Kopplung oder Niveaugruppe -> Excel
      const fach = GANZKLASSE[m[3]];
      if (!fach || (KLP[m[1]] || []).indexOf(kz) >= 0) continue;
      const key = 'klasse|' + m[1] + '|' + m[3] + '|' + kz;
      out[key] = { key: key, klasse: m[1], code: m[3], fach: fach, lk: kz };
    }
  });
  return Object.values(out);
}

(async function () {
  // Erst die (langsamen) PDFs und die Excel lesen, dann Firestore: eine lange ruhende
  // REST-Verbindung brach sonst beim Schreiben mit EPIPE ab.
  const excelGruppen = leseExcel(), ganzklassen = leseGanzklassen();
  const { admin, db } = starten();
  const ts = admin.firestore.FieldValue.serverTimestamp();

  const [stSnap, grSnap] = await Promise.all([db.collection('students').get(), db.collection('gruppen').get()]);
  const schueler = [], lehrer = {};
  stSnap.forEach(function (d) {
    const x = d.data();
    if (x.role === 'teacher') lehrer[(x.username || '').toLowerCase()] = { uid: d.id, name: x.displayName || x.username, klasse: x.klasse };
    else if (x.role === 'student' && (x.username || '').toLowerCase() !== 'schueler') {
      schueler.push({ uid: d.id, vn: clean(x.displayName), nn: clean(x.nachname), u: x.username || '', k: x.klasse });
    }
  });
  const alt = {};
  grSnap.forEach(function (d) { alt[d.id] = Object.assign({ id: d.id }, d.data()); });

  // Excel-Name -> Konto: gleiche Klasse, Nachname gleich/enthalten/fast gleich (Tippfehler),
  // Vorname gleich oder gleicher Anfang (Max/Maximilian). Sonst nicht zuordnen, nur melden.
  function abstand(a, b) {
    const d = [];
    for (let i = 0; i <= a.length; i++) { d[i] = [i]; for (let j = 1; j <= b.length; j++) d[i][j] = i ? 0 : j; }
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
  }
  const nichtGefunden = {}, zugeordnet = {};
  function konto(s) {
    const nn = slug(s.nn), vn = slug(s.vn.split(' ')[0]);
    const treffer = schueler.filter(function (x) {
      if (x.k !== s.k) return false;
      const b = slug(x.nn), a = slug(x.vn.split(' ')[0]);
      const nnOk = b === nn || b.indexOf(nn) >= 0 || nn.indexOf(b) >= 0 || abstand(b, nn) <= 2;
      return nnOk && (a === vn || a.indexOf(vn) === 0 || vn.indexOf(a) === 0 || a.slice(0, 3) === vn.slice(0, 3));
    });
    if (treffer.length === 1) { zugeordnet[treffer[0].uid] = true; return treffer[0]; }
    nichtGefunden[s.k + ' ' + s.vn + ' ' + s.nn] = true;
    return null;
  }

  const plan = [];   // {key, fach, name, lk, mitglieder:[konto]}
  const fehlendeLp = {};
  excelGruppen.forEach(function (g) {
    if (g.sem && g.sem !== SEMESTER) return;
    let lks = (ERSATZ[SEMESTER] || {})[g.key] || [g.lk];
    lks = lks.concat(DAZU[g.key] || []);
    const konten = g.mitglieder.map(konto).filter(Boolean);
    if (!konten.length) return;
    const klassen = konten.map(function (k) { return k.k; }).filter(function (k, i, a) { return a.indexOf(k) === i; });
    const name = FACHNAME[g.fach] + ' (' + g.code + ') · ' + (klassen.length === 1 ? klassen[0] : g.jg + '. Kl.');
    lks.forEach(function (lk) { plan.push({ key: g.jg + '|' + g.code + '|' + lk, fach: g.fach, name: name, lk: lk, mitglieder: konten }); });
  });
  ganzklassen.forEach(function (g) {
    const konten = schueler.filter(function (s) { return s.k === g.klasse; });
    if (!konten.length) return;
    plan.push({ key: g.key, fach: g.fach, name: FACHNAME[g.fach] + ' · ' + g.klasse, lk: g.lk, mitglieder: konten });
  });

  // Gleiche Lehrperson-Seite + gleicher Schlüssel nur einmal (Teamteaching auf derselben Seite, z. B. Alder/Bommeli).
  const soll = {};
  const idVon = {};
  Object.keys(BESTEHENDE).forEach(function (id) { if (alt[id]) idVon[BESTEHENDE[id]] = id; });
  plan.forEach(function (p) {
    const lp = lehrer[LP[p.lk]];
    if (!lp) { fehlendeLp[p.lk + ' (' + (LP[p.lk] || '?') + ')'] = true; return; }
    let id = idVon[p.key] || ('stp_' + slug(p.key.replace(/\|[^|]*$/, '')) + '_' + slug(lp.klasse));
    // Zwei Lehrpersonen auf derselben Seite (Alder/Bommeli): gleiche Gruppe nur einmal,
    // verschiedene Gruppen mit gleichem Code (WnT Mo Vm) je mit Kürzel.
    const gleich = function (a) { return a.mitglieder.map(function (m) { return m.uid; }).sort().join() === p.mitglieder.map(function (m) { return m.uid; }).sort().join(); };
    if (soll[id] && !gleich(soll[id])) id += '_' + slug(p.lk);
    if (soll[id]) return;
    soll[id] = { id: id, key: p.key, fach: p.fach, name: p.name, lp: lp, mitglieder: p.mitglieder };
  });

  // ---------- Vergleich ----------
  const neu = [], geaendert = [], weg = [];
  Object.values(soll).forEach(function (s) {
    const a = alt[s.id];
    // Wen die Excel gar nicht kennt (z. B. neu zugezogen), bleibt in bestehenden Gruppen drin.
    if (a) (a.mitglieder || []).forEach(function (u) {
      const k = schueler.find(function (x) { return x.uid === u; });
      if (k && !zugeordnet[u] && !s.mitglieder.some(function (m) { return m.uid === u; })) s.mitglieder.push(k);
    });
    const uids = s.mitglieder.map(function (m) { return m.uid; }).sort();
    if (!a) { neu.push(s); return; }
    const altUids = (a.mitglieder || []).slice().sort();
    const diff = JSON.stringify(uids) !== JSON.stringify(altUids) || a.ownerUid !== s.lp.uid || a.fach !== s.fach || a.planKey !== s.key;
    const wer = function (u) { const m = s.mitglieder.find(function (x) { return x.uid === u; }) || {}; const n = (a.namen || {})[u] || {}; return (m.vn || n.n || '?') + ' ' + (m.nn || n.nn || '') + '/' + (m.k || n.k || ''); };
    if (diff) geaendert.push({ s: s, a: a,
      dazu: uids.filter(function (u) { return altUids.indexOf(u) < 0; }).map(wer),
      raus: altUids.filter(function (u) { return uids.indexOf(u) < 0; }).map(wer) });
  });
  Object.values(alt).forEach(function (a) { if (a.quelle === 'stundenplan' && !soll[a.id]) weg.push(a); });

  console.log((JA ? '' : '[VORSCHAU] ') + 'Semester ' + SEMESTER + ': ' + Object.keys(soll).length + ' Gruppen laut Plan · ' +
    neu.length + ' neu, ' + geaendert.length + ' geändert, ' + weg.length + ' weg');
  const zeile = function (s) { return '  ' + s.lp.name.padEnd(13) + ' ' + s.fach.padEnd(16) + ' ' + String(s.mitglieder.length).padStart(2) + '  ' + s.name; };
  if (neu.length) { console.log('Neu:'); neu.sort(function (a, b) { return a.lp.name.localeCompare(b.lp.name) || a.name.localeCompare(b.name); }).forEach(function (s) { console.log(zeile(s)); }); }
  if (geaendert.length) { console.log('Geändert:'); geaendert.forEach(function (g) { console.log(zeile(g.s) + '   (bisher «' + g.a.name + '»' + (g.dazu.length ? ', + ' + g.dazu.join(', ') : '') + (g.raus.length ? ', − ' + g.raus.join(', ') : '') + ')'); }); }
  if (weg.length) { console.log('Weg:'); weg.forEach(function (a) { console.log('  ' + a.ownerName + ' · ' + a.name); }); }
  if (Object.keys(fehlendeLp).length) console.log('Ohne Konto (übersprungen): ' + Object.keys(fehlendeLp).join(', '));
  if (Object.keys(nichtGefunden).length) console.log('Nicht in der App gefunden (' + Object.keys(nichtGefunden).length + '): ' + Object.keys(nichtGefunden).sort().join(', '));
  const ohne = schueler.filter(function (s) { return !zugeordnet[s.uid]; });
  if (ohne.length) console.log('App-Konto ohne Excel-Zeile (nur in Ganzklassen-Gruppen): ' + ohne.map(function (s) { return s.k + ' ' + s.vn + ' ' + s.nn; }).join(', '));
  if (!JA) { console.log('\nNichts geschrieben. Mit --ja ausführen.'); process.exit(0); }

  // ---------- Schreiben ----------
  const seiten = {};
  // Normale Batches statt bulkWriter: der brach über REST mit EPIPE ab (27.09.2026).
  const ops = [];
  const w = { set: function (ref, d, o) { ops.push(function (b) { b.set(ref, d, o); }); }, delete: function (ref) { ops.push(function (b) { b.delete(ref); }); } };
  neu.concat(geaendert.map(function (g) { return g.s; })).forEach(function (s) {
    const namen = {};
    s.mitglieder.forEach(function (m) { namen[m.uid] = { n: m.vn, nn: m.nn, u: m.u, k: m.k }; });
    const daten = {
      ownerUid: s.lp.uid, ownerName: s.lp.name, ownerKlasse: s.lp.klasse, fach: s.fach,
      mitglieder: s.mitglieder.map(function (m) { return m.uid; }), namen: namen,
      planKey: s.key, quelle: 'stundenplan', semester: SEMESTER, updatedAt: ts
    };
    if (!alt[s.id]) { daten.name = s.name; daten.createdAt = ts; }
    else if (alt[s.id].ownerKlasse && alt[s.id].ownerKlasse !== s.lp.klasse) seiten[alt[s.id].ownerKlasse] = true;
    w.set(db.collection('gruppen').doc(s.id), daten, { merge: true });
    seiten[s.lp.klasse] = true;
  });
  weg.forEach(function (a) { w.delete(db.collection('gruppen').doc(a.id)); if (a.ownerKlasse) seiten[a.ownerKlasse] = true; });
  for (let i = 0; i < ops.length; i += 100) {
    const b = db.batch();
    ops.slice(i, i + 100).forEach(function (op) { op(b); });
    await b.commit();
  }
  console.log(ops.length + ' Gruppen geschrieben/gelöscht');

  // Kalender-Einträge der geänderten Gruppen nachführen.
  for (const g of geaendert) {
    const snap = await db.collection('klassen').doc(g.s.lp.klasse).collection('calendarEntries').where('gruppeId', '==', g.s.id).get();
    const b = db.batch();
    snap.forEach(function (d) { b.update(d.ref, { mitglieder: g.s.mitglieder.map(function (m) { return m.uid; }), gruppeName: g.a.name || g.s.name }); });
    if (!snap.empty) { await b.commit(); console.log('Kalender «' + g.a.name + '»: ' + snap.size + ' Einträge nachgeführt'); }
  }
  // Leserecht: appMeta/gruppenMitglieder = alle Mitglieder aller Gruppen der Seite.
  const nachher = await db.collection('gruppen').get();
  for (const k of Object.keys(seiten)) {
    const uids = {};
    nachher.forEach(function (d) { if (d.data().ownerKlasse === k) (d.data().mitglieder || []).forEach(function (u) { uids[u] = true; }); });
    await db.collection('klassen').doc(k).collection('appMeta').doc('gruppenMitglieder').set({ uids: Object.keys(uids), updatedAt: ts });
  }
  console.log('Fertig. ' + Object.keys(seiten).length + ' Seiten: Leserechte nachgeführt.');
  process.exit(0);
})().catch(function (err) { console.error(err); process.exit(1); });
