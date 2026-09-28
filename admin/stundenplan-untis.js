/**
 * Helfenberger's Library — 🗓️ persönlicher Stundenplan aus Untis für alle Schüler:innen
 * und Lehrpersonen (seit 27.09.2026)
 *
 *   node stundenplan-untis.js --ordner "<Stundenpläne/2026:27>" --semester 1              (Vorschau)
 *   node stundenplan-untis.js --ordner "<Stundenpläne/2026:27>" --semester 1 --zeige jan  (Plan einer Person, Benutzername)
 *   node stundenplan-untis.js --ordner "<Stundenpläne/2026:27>" --semester 1 --ja         (schreiben)
 *
 * Zuerst gruppen-stundenplan.js laufen lassen (gleiches Semester) — die Zuteilung in
 * Gruppen kommt aus den 👥 Gruppen mit planKey, nicht nochmals aus der Excel.
 * Liest Lehrerpläne_<n>/*.pdf per `pdftotext -bbox-layout` (Tag/Lektion aus der Lage der
 * Wörter) und schreibt pro Schüler:in und Lehrperson progress/{uid}/einstellungen/stundenplanSchule
 * = {zeiten, zellen:{'tag-lektion':{f|t, zi, lp (SuS) bzw. kl (LP)}}, semester, updatedAt}.
 * Die App legt das unter die eigenen Änderungen der Schüler:in (einstellungen/stundenplan)
 * und über den Klassenplan (index.html, stpBasis).
 *
 * Zuordnung einer Lektion (Lehrkraft, Tag, Zeit, Klassen, Zimmer, Fach [Gruppe]):
 *  - passt sie zu einer Stundenplan-Gruppe derselben Lehrkraft (Jahrgang, Fach/Gruppe,
 *    bei Halbklassen/Wahlfächern auch Tag und Vor-/Nachmittag) -> nur deren Mitglieder;
 *    (steht genau eine Klasse da, nur die Mitglieder aus dieser Klasse);
 *  - sonst, wenn sie genau eine Klasse hat -> die ganze Klasse;
 *  - ISF («InS») ist Teamteaching in einer Klassenlektion und wird ausgelassen;
 *  - sonst wird sie gemeldet (keine Gruppe gefunden).
 */
const { starten } = require('./_firebase');
const { LP, TAG_KURZ, lesePlaene } = require('./_untis');

const args = process.argv.slice(2);
function arg(n) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; }
const ORDNER = arg('--ordner');
const SEMESTER = Number(arg('--semester'));
const JA = args.includes('--ja');
const ZEIGE = arg('--zeige');
if (!ORDNER || !(SEMESTER === 1 || SEMESTER === 2)) {
  console.log('Aufruf: --ordner "<Stundenpläne/2026:27>" --semester 1|2 [--zeige <benutzername>] [--ja]');
  process.exit(1);
}

// Lektionszeiten laut Untis -> Zeile im App-Stundenplan (Index bzw. Zusatzlektion, vgl. STP_EXTRA).
const ZEITEN = [
  { von: '07:30', bis: '08:15' }, { von: '08:20', bis: '09:05' }, { von: '09:10', bis: '09:55' },
  { von: '10:15', bis: '11:00' }, { von: '11:05', bis: '11:50' },
  { von: '13:30', bis: '14:15' }, { von: '14:20', bis: '15:05' }, { von: '15:20', bis: '16:05' }, { von: '16:10', bis: '16:55' }
];
// Untis-Fach -> App-Fach (f) bzw. Anzeigename (t) für Fächer ohne Kachel.
const FACH = {
  de: 'deutsch', en: 'englisch', fr: 'franzoesisch', frgm: 'franzoesisch', ma: 'mathe', 'm+': 'mathe',
  tu: 'sport', tk: 'sport', tm: 'sport', mu: 'musik', ban: 'musik', bg: 'freies-schreiben', in: 'informatik',
  ek: 'psychologie', wah: 'wah', hw: 'wah', wn: 'werken', wt: 'textiles-werken', gtz: 'gtz', sp: 'spanisch',
  'sp+': 'spanisch', al: 'algebra', foto: 'fotokurs', bw: 'band', vb: 'volleyball', msp: 'makerspace',
  ph: 'physik', fb: 'fussball', sj: 'schach-jassen'
};
const TEXT = { nt: 'NT', rzg: 'RZG', kl: 'Klassenstunde', sol: 'SoL', 'd/m': 'Deutsch/Mathe', ins: 'ISF' };
const AUSLASSEN = ['ins'];

function norm(c) { return String(c).normalize('NFC').toLowerCase().replace(/[\s.]/g, ''); }
// Gruppen-Code aus planKey vergleichbar machen (Excel «WnT», «Fot», «Tu Kn» -> Untis «Wn», «Foto», «Tu»).
function codeNorm(c) {
  c = norm(c).replace(/^tu(kn|mä)$/, 'tu').replace(/^wnt/, 'wn').replace(/^fot$/, 'foto').replace(/^band$/, 'bw');
  return c;
}
function fachBasis(fach) {   // «Sp+2» -> «sp+», «TK1» -> «tk», «Hw 1» -> «hw»
  const f = norm(fach);
  if (/^(sp|m)\+/.test(f)) return f.replace(/\+.*/, '+');
  return f.replace(/[0-9]+$/, '');
}

(async function () {
  const lektionen = lesePlaene(ORDNER, SEMESTER);
  const { admin, db } = starten();
  const ts = admin.firestore.FieldValue.serverTimestamp();
  const [stSnap, grSnap] = await Promise.all([db.collection('students').get(), db.collection('gruppen').get()]);
  const schueler = [], lpName = {}, lehrer = {}, klasseVon = {};
  stSnap.forEach(function (d) {
    const x = d.data();
    if (x.role === 'student' && (x.username || '').toLowerCase() !== 'schueler') { schueler.push({ uid: d.id, u: x.username, vn: x.displayName, nn: x.nachname, k: x.klasse }); klasseVon[d.id] = x.klasse; }
    if (x.role === 'teacher') lehrer[(x.username || '').toLowerCase()] = { uid: d.id, u: x.username, vn: x.displayName, nn: '', k: x.klasse };
  });
  Object.keys(LP).forEach(function (kz) { if (lehrer[LP[kz]]) lpName[kz] = lehrer[LP[kz]].vn; });
  // Lehrkraft-Kürzel -> Name für die Anzeige (aus den Gruppen der Seite; sonst Kürzel)
  const gruppen = [];
  grSnap.forEach(function (d) {
    const g = d.data();
    if (!g.planKey || /^klasse\|/.test(g.planKey)) return;
    const t = g.planKey.split('|');   // Jahrgang|Code [Tag [Vm/Na]]|Kürzel
    const w = t[1].split(' ');
    // Tag/Tageszeit stehen hinter dem Fach («Tu Kn Mo Vm»); das erste Wort ist immer das Fach («Fr Gmab»!).
    const slot = w.slice(1).filter(function (x) { return /^(Mo|Di|Mi|Do|Fr|Vm|Na)$/.test(x); });
    const code = codeNorm([w[0]].concat(w.slice(1).filter(function (x) { return slot.indexOf(x) < 0; })).join(''));
    gruppen.push({ id: d.id, jg: t[0], code: code, name: t[1].split(' ').filter(function (x, i) { return i === 0 || slot.indexOf(x) < 0; }).join(' '),
      lk: t[2], tag: slot[0] ? TAG_KURZ.indexOf(slot[0]) : -1, teil: slot[1] || '', mitglieder: g.mitglieder || [] });
  });

  // Lektion -> passende Gruppen
  const plaene = {};   // uid -> {zellen}
  const offen = {}, konflikte = [];
  function zelleVon(l) {
    const b = fachBasis(l.fach), zelle = {};
    if (FACH[b]) zelle.f = FACH[b]; else zelle.t = TEXT[b] || l.fach;
    if (l.zi) zelle.zi = l.zi;
    return zelle;
  }
  function setze(uid, l, quelle) {
    const p = plaene[uid] || (plaene[uid] = { zellen: {}, quelle: {} });
    const key = l.tag + '-' + l.zeile;
    const zelle = zelleVon(l);
    zelle.lp = lpName[l.lk] || l.lk;
    const alt = p.zellen[key];
    if (alt && p.quelle[key] === 'gruppe' && quelle === 'klasse') return;   // Gruppe schlägt Ganzklasse
    if (alt && p.quelle[key] === quelle && (alt.f || alt.t) === (zelle.f || zelle.t)) {
      // Teamteaching (z. B. Schach & Jassen bei Städler und Helfenberger): beide Namen
      if (alt.lp.split(', ').indexOf(zelle.lp) < 0) alt.lp += ', ' + zelle.lp;
      return;
    }
    if (alt && p.quelle[key] === quelle) konflikte.push(uid + ' ' + key + ': ' + (alt.f || alt.t) + ' ' + alt.lp + ' / ' + (zelle.f || zelle.t) + ' ' + zelle.lp);
    p.zellen[key] = zelle; p.quelle[key] = quelle;
  }
  const lpPlaene = {};   // Kürzel -> {zellen}
  lektionen.forEach(function (l) {
    const code = codeNorm(l.fach + l.grp);
    const jgs = l.klassen.map(function (k) { return k.charAt(1); });
    // Untis schneidet lange Namen ab («Wn H» statt «Wn H1»): ohne genauen Treffer gilt ein
    // eindeutiger Präfix-Treffer bei derselben Lehrkraft.
    const exakt = gruppen.some(function (g) { return g.lk === l.lk && jgs.indexOf(g.jg) >= 0 && g.code === code; });
    const passend = gruppen.filter(function (g) {
      if (g.lk !== l.lk || jgs.indexOf(g.jg) < 0) return false;
      if (g.code !== code && (exakt || g.code.indexOf(code) !== 0 || code.length < 3)) return false;
      if (g.tag >= 0 && g.tag !== l.tag) return false;
      if (g.teil === 'Vm' && typeof l.zeile === 'number' && l.zeile > 4) return false;
      if (g.teil === 'Na' && (l.zeile === 'm1' || (typeof l.zeile === 'number' && l.zeile <= 4))) return false;
      // Steht genau eine Klasse da, muss die Gruppe Mitglieder aus dieser Klasse haben
      // (Sport der ganzen E1c ist nicht die Knaben-Turngruppe G1a/E1a).
      if (l.ganz && !g.mitglieder.some(function (u) { return klasseVon[u] === l.klassen[0]; })) return false;
      return true;
    });
    // Plan der Lehrperson: jede eigene Lektion, mit Klasse bzw. Gruppe
    const lpz = (lpPlaene[l.lk] = lpPlaene[l.lk] || { zellen: {} }).zellen;
    const lz = zelleVon(l);
    lz.kl = passend.length ? passend[0].name + (l.ganz ? ' ' + l.klassen[0] : ' (' + passend[0].jg + '.)') : l.klassen.join(', ').replace(/,$/, '');
    lpz[l.tag + '-' + l.zeile] = lz;
    if (AUSLASSEN.indexOf(fachBasis(l.fach)) >= 0) return;   // nur im Plan der Lehrperson
    if (passend.length) {
      passend.forEach(function (g) {
        g.mitglieder.forEach(function (uid) { if (!l.ganz || klasseVon[uid] === l.klassen[0]) setze(uid, l, 'gruppe'); });
      });
    } else if (l.ganz) {
      schueler.forEach(function (s) { if (s.k === l.klassen[0]) setze(s.uid, l, 'klasse'); });
    } else {
      offen[l.lk + ' ' + TAG_KURZ[l.tag] + ' ' + l.zeit + ' ' + l.klassen.join(',') + ' ' + l.fach + ' ' + l.grp] = true;
    }
  });

  const mit = schueler.filter(function (s) { return plaene[s.uid]; });
  const n = mit.map(function (s) { return Object.keys(plaene[s.uid].zellen).length; });
  console.log((JA ? '' : '[VORSCHAU] ') + 'Semester ' + SEMESTER + ': ' + lektionen.length + ' Lektionen aus den Lehrerplänen · ' +
    mit.length + '/' + schueler.length + ' Schüler:innen mit Plan · Lektionen pro Woche: ' + Math.min.apply(null, n) + '–' + Math.max.apply(null, n));
  const wenig = mit.filter(function (s) { return Object.keys(plaene[s.uid].zellen).length < 26; });
  if (wenig.length) console.log('Weniger als 26 Lektionen: ' + wenig.map(function (s) { return s.k + ' ' + s.u + ' (' + Object.keys(plaene[s.uid].zellen).length + ')'; }).join(', '));
  const ohne = schueler.filter(function (s) { return !plaene[s.uid]; });
  if (ohne.length) console.log('Ohne Plan: ' + ohne.map(function (s) { return s.k + ' ' + s.u; }).join(', '));
  if (Object.keys(offen).length) console.log('Keiner Gruppe zugeordnet (' + Object.keys(offen).length + '):\n  ' + Object.keys(offen).sort().join('\n  '));
  if (konflikte.length) {
    const art = {};
    konflikte.forEach(function (k) { const t = k.replace(/^\S+ /, ''); art[t] = (art[t] || 0) + 1; });
    console.log('Doppelt belegt (' + konflikte.length + ' Schüler:innen-Lektionen, die zweite gilt):\n  ' +
      Object.keys(art).sort().map(function (t) { return art[t] + '× ' + t; }).join('\n  '));
  }
  // Lehrpersonen mit Konto
  const lpMit = Object.keys(lpPlaene).filter(function (kz) { return lehrer[LP[kz]]; });
  lpMit.forEach(function (kz) { plaene[lehrer[LP[kz]].uid] = lpPlaene[kz]; });
  console.log('Lehrpersonen mit Plan: ' + lpMit.length + ' (ohne Konto: ' + Object.keys(lpPlaene).filter(function (kz) { return !lehrer[LP[kz]]; }).join(', ') + ')');
  if (ZEIGE) {
    const s = schueler.find(function (x) { return x.u === ZEIGE; }) || lehrer[ZEIGE];
    if (!s) console.log('Unbekannt: ' + ZEIGE);
    else {
      const z = (plaene[s.uid] || { zellen: {} }).zellen;
      console.log('\n' + s.vn + ' ' + s.nn + ' (' + s.k + ')');
      Object.keys(z).sort(function (a, b) {
        const ord = function (k) { const t = k.split('-'); const r = t[1]; const v = { m1: 4.5, m2: 4.7, a1: 8.5, a2: 8.7 }[r]; return +t[0] * 100 + (v !== undefined ? v : +r); };
        return ord(a) - ord(b);
      }).forEach(function (k) { const t = k.split('-'), c = z[k]; console.log('  ' + TAG_KURZ[+t[0]] + ' ' + t[1].padEnd(3) + ' ' + (c.f || c.t).padEnd(16) + ' ' + (c.lp || c.kl || '').padEnd(16) + ' ' + (c.zi || '')); });
    }
  }
  if (!JA) { console.log('\nNichts geschrieben. Mit --ja ausführen.'); process.exit(0); }

  const ids = Object.keys(plaene);
  for (let i = 0; i < ids.length; i += 100) {
    const b = db.batch();
    ids.slice(i, i + 100).forEach(function (uid) {
      b.set(db.collection('progress').doc(uid).collection('einstellungen').doc('stundenplanSchule'),
        { zeiten: ZEITEN, zellen: plaene[uid].zellen, semester: SEMESTER, quelle: 'untis', updatedAt: ts });
    });
    await b.commit();
  }
  console.log('Fertig: ' + ids.length + ' Stundenpläne geschrieben (' + lpMit.length + ' Lehrpersonen).');
  process.exit(0);
})().catch(function (err) { console.error(err); process.exit(1); });
