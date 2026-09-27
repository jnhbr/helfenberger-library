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
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { starten } = require('./_firebase');
const { LP } = require('./_untis');

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
const ZEILE = { '7:30': 0, '8:20': 1, '9:10': 2, '10:15': 3, '11:05': 4, '11:55': 'm1', '12:45': 'm2',
  '13:30': 5, '14:20': 6, '15:20': 7, '16:10': 8, '16:55': 'a1', '17:45': 'a2' };
const TAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
const TAG_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
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
const RAUM = /^([A-Z][0-9]{2}[A-Z0-9]*|S[0-9]{2}|Flab|Ban|Band|C0[0-9])(,)?$/;

function datei(dir, name) {
  const hit = fs.readdirSync(dir).find(function (f) { return f.normalize('NFC') === name.normalize('NFC'); });
  if (!hit) throw new Error('Nicht gefunden: ' + name + ' in ' + dir);
  return path.join(dir, hit);
}
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

// ---------- Lehrerpläne lesen ----------
function lesePlaene() {
  const dir = datei(ORDNER, 'Lehrerpläne_' + SEMESTER);
  const lektionen = [];
  fs.readdirSync(dir).filter(function (f) { return /\.pdf$/i.test(f); }).forEach(function (f) {
    const lk = f.normalize('NFC').replace(/^Lehrerplan_/, '').replace(/\.pdf$/i, '');
    let xml = '';
    try { xml = execFileSync('pdftotext', ['-bbox-layout', path.join(dir, f), '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); }
    catch (e) { xml = e.stdout || ''; }
    const woerter = [];
    const re = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
    let m;
    while ((m = re.exec(xml))) woerter.push({ x: +m[1], y: +m[2], x2: +m[3], t: m[5].replace(/&amp;/g, '&') });
    // Spalten: Mitte der Tages-Überschriften
    const kopf = TAGE.map(function (t) { const w = woerter.find(function (w) { return w.t === t; }); return w ? (w.x + w.x2) / 2 : null; });
    if (kopf.some(function (x) { return x === null; })) { console.warn('Tage nicht gefunden: ' + f); return; }
    const breite = kopf[1] - kopf[0];
    // Zeilen: Startzeiten in der Zeitspalte (links von Montag)
    const zeitW = woerter.filter(function (w) { return w.x < kopf[0] - breite / 2 && /^\d{1,2}:\d{2}$/.test(w.t); }).sort(function (a, b) { return a.y - b.y; });
    const zeilen = [];
    for (let i = 0; i < zeitW.length; i += 2) zeilen.push({ y: zeitW[i].y - 4, von: zeitW[i].t });
    // Wörter pro Tag + Zeile(nhöhe) zu Zeilen zusammensetzen
    const zeilenText = {};
    woerter.forEach(function (w) {
      const cx = (w.x + w.x2) / 2;
      const tag = kopf.findIndex(function (k) { return Math.abs(cx - k) < breite / 2; });
      if (tag < 0 || w.y < zeilen[0].y) return;
      const key = tag + '|' + Math.round(w.y);
      (zeilenText[key] = zeilenText[key] || []).push(w);
    });
    // Zeilen pro Tag von oben nach unten; eine Zeile ohne Klasse direkt unter einer Lektion
    // ist deren umgebrochener Rest («Wn H» + «1»), «1)» usw. sind Legenden-Verweise.
    const proTag = [[], [], [], [], []];
    Object.keys(zeilenText).forEach(function (key) {
      const t = key.split('|');
      proTag[+t[0]].push({ y: +t[1], tok: zeilenText[key].sort(function (a, b) { return a.x - b.x; }).map(function (w) { return w.t; }) });
    });
    const roh = [];
    proTag.forEach(function (liste, tag) {
      liste.sort(function (a, b) { return a.y - b.y; });
      liste.forEach(function (zl) {
        const vorher = roh[roh.length - 1];
        if (/^\*?[GE][123]/.test(zl.tok[0])) { roh.push({ tag: tag, y: zl.y, tok: zl.tok.slice() }); return; }
        if (vorher && vorher.tag === tag && zl.y - vorher.y < 10 && !/^\d+\)$/.test(zl.tok[0])) vorher.tok = vorher.tok.concat(zl.tok);
      });
    });
    roh.forEach(function (r) {
      const tag = r.tag, tok = r.tok;
      // Lektion = Zeile, in der der Text steht; Doppellektionen stehen mittig über zwei Zeilen.
      let z = -1;
      zeilen.forEach(function (zr, i) { if (r.y >= zr.y) z = i; });
      if (z < 0) return;
      const lang = r.y - zeilen[z].y > 10 && zeilen[z + 1] ? 2 : 1;
      const k0 = /^\*?([GE][123][a-c](?:,[GE0-9a-c.]*)*)$/.exec(tok[0] || '');
      if (!k0) return;
      let i = 1;
      const zi = [];
      while (i < tok.length && RAUM.test(tok[i])) { zi.push(tok[i].replace(/,$/, '')); i++; }
      if (i >= tok.length) return;
      const fach = tok[i], grp = tok.slice(i + 1).join(' ');
      const klassen = k0[1].split(',').filter(Boolean);
      for (let n = 0; n < lang; n++) {
        const von = zeilen[z + n].von;
        if (ZEILE[von] === undefined) continue;
        lektionen.push({ lk: lk, tag: tag, zeit: von, zeile: ZEILE[von], klassen: klassen,
          ganz: klassen.length === 1 && /^[GE][123][a-c]$/.test(klassen[0]),
          zi: zi.filter(function (x) { return x !== 'Ban' && x !== 'Band'; }).join(', '), fach: fach, grp: grp });
      }
    });
  });
  return lektionen;
}

(async function () {
  const lektionen = lesePlaene();
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
