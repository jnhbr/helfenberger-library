/**
 * Untis-Kürzel der Lehrpersonen (Schuljahr 2026/27) -> Benutzername in der App.
 * Gebraucht von gruppen-stundenplan.js, stundenplan-untis.js und raum-belegung.js.
 *
 * lesePlaene(ordner, semester): alle Lektionen aus Lehrerpläne_<n>/*.pdf
 * ({lk, tag, zeit, zeile, klassen, ganz, zi, raeume, fach, grp}).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LP = {
  Al: 'alder', Bo: 'bommeli', 'Bä': 'baechi', Fe: 'frey', Fi: 'fischer', Fr: 'froehlich', Gi: 'gierszewski',
  Gr: 'giger', Ha: 'hauser', He: 'herforth', Hr: 'helfenberger', Hu: 'hugentobler', 'Hä': 'haeberli',
  Le: 'ledergerber', Lo: 'lopez', Ri: 'rhiner', Ro: 'rolfsmeyer', Rs: 'rechsteiner', Ru: 'rutishauser',
  Sb: 'straub', Sc: 'schlaepfer', Se: 'steinbruechel', Sh: 'schoch', Sr: 'strebel', St: 'stoller',
  Sz: 'stolz', 'Sä': 'staedler', Wr: 'weber', Zw: 'zweifel'
};

// Lektionszeiten laut Untis -> Zeile im App-Stundenplan (Index bzw. Zusatzlektion, vgl. STP_EXTRA).
const ZEILE = { '7:30': 0, '8:20': 1, '9:10': 2, '10:15': 3, '11:05': 4, '11:55': 'm1', '12:45': 'm2',
  '13:30': 5, '14:20': 6, '15:20': 7, '16:10': 8, '16:55': 'a1', '17:45': 'a2' };
const TAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
const TAG_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
const RAUM = /^([A-Z][0-9]{2}[A-Z0-9]*|S[0-9]{2}|Flab|Ban|Band|C0[0-9])(,)?$/;
// Einzelne Raumcodes einer Lektion: Untis klebt Räume zusammen («S02S03», «A18B22»),
// «Ban» ist der Bandraum neben dem Singsaal.
function raeumeVon(zi) {
  const r = [];
  zi.forEach(function (x) {
    (x.match(/[A-Z][0-9]{2}|Flab|Band?/g) || []).forEach(function (c) { c = c === 'Ban' ? 'Band' : c; if (r.indexOf(c) < 0) r.push(c); });
  });
  return r;
}

function datei(dir, name) {
  const hit = fs.readdirSync(dir).find(function (f) { return f.normalize('NFC') === name.normalize('NFC'); });
  if (!hit) throw new Error('Nicht gefunden: ' + name + ' in ' + dir);
  return path.join(dir, hit);
}

// ---------- Lehrerpläne lesen ----------
function lesePlaene(ordner, semester) {
  const dir = datei(ordner, 'Lehrerpläne_' + semester);
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
          zi: zi.filter(function (x) { return x !== 'Ban' && x !== 'Band'; }).join(', '),
          raeume: raeumeVon(zi), fach: fach, grp: grp });
      }
    });
  });
  return lektionen;
}

module.exports = { LP, ZEILE, TAGE, TAG_KURZ, lesePlaene };
