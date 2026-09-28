/**
 * Helfenberger's Library — 🚪 Raumbelegung aus Untis für «Räume» (Klassenzimmer, seit 28.09.2026)
 *
 *   node raum-belegung.js --ordner "<Stundenpläne/2026:27>" --semester 1              (Vorschau)
 *   node raum-belegung.js --ordner "<Stundenpläne/2026:27>" --semester 1 --zeige B22  (Woche eines Raums)
 *   node raum-belegung.js --ordner "<Stundenpläne/2026:27>" --semester 1 --json x.json (Ergebnis als Datei)
 *   node raum-belegung.js --ordner "<Stundenpläne/2026:27>" --semester 1 --ja         (schreiben)
 *
 * Beim Semesterwechsel zusammen mit stundenplan-untis.js laufen lassen.
 *
 * Quellen:
 *  - Lehrerpläne_<n>/*.pdf (wie stundenplan-untis.js): wer wann in welchem Raum ist — aktuell pro Semester.
 *  - «Belegungsplan <Jahr>.pdf» (Untis-Raumplan, eine Spalte pro Raum): liefert die Raumliste und
 *    zusätzlich Belegungen von Personen OHNE Lehrerplan (Bibliothek, Muki, Primarschule, Religion …).
 *    Lehrpersonen mit Lehrerplan werden aus dem Belegungsplan NICHT übernommen — der ist vom Juni
 *    und bei einzelnen Lektionen schon überholt. Mit --ohne-belegungsplan nur die Lehrerpläne.
 *
 * Schreibt raumBelegung/plan = {semester, zeiten:[{s, von, bis}], raeume:[{id, name, art}],
 *   zellen:{<Raum>:{'tag-zeile':{lp, kl, f}}}, updatedAt}. Die Zellen-Keys sind dieselben wie im
 * 🗓️ Stundenplan (tag 0–4, zeile 0–8 bzw. m1/m2/a1/a2). Lesen dürfen Lehrpersonen/Schulleitung,
 * schreiben nur dieses Skript (Admin-SDK). Reservationen liegen separat in raumReservationen.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { starten } = require('./_firebase');
const { LP, ZEILE, TAG_KURZ, lesePlaene } = require('./_untis');

const args = process.argv.slice(2);
function arg(n) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; }
const ORDNER = arg('--ordner');
const SEMESTER = Number(arg('--semester'));
const JA = args.includes('--ja');
const ZEIGE = arg('--zeige');
const OHNE_BP = args.includes('--ohne-belegungsplan');
const JSON_DATEI = arg('--json');
if (!ORDNER || !(SEMESTER === 1 || SEMESTER === 2)) {
  console.log('Aufruf: --ordner "<Stundenpläne/2026:27>" --semester 1|2 [--zeige <Raum>] [--ohne-belegungsplan] [--ja]');
  process.exit(1);
}

// Alle Zeilen des Raumplans, in Untis-Zeiten (Mittag und Abend inklusive).
const ZEITEN = [
  { s: 0, von: '07:30', bis: '08:15' }, { s: 1, von: '08:20', bis: '09:05' }, { s: 2, von: '09:10', bis: '09:55' },
  { s: 3, von: '10:15', bis: '11:00' }, { s: 4, von: '11:05', bis: '11:50' }, { s: 'm1', von: '11:55', bis: '12:40' },
  { s: 'm2', von: '12:45', bis: '13:30' }, { s: 5, von: '13:30', bis: '14:15' }, { s: 6, von: '14:20', bis: '15:05' },
  { s: 7, von: '15:20', bis: '16:05' }, { s: 8, von: '16:10', bis: '16:55' }, { s: 'a1', von: '16:55', bis: '17:40' },
  { s: 'a2', von: '17:45', bis: '18:30' }
];
// Anzeigenamen (die Kopfzeile im Belegungsplan ist abgeschnitten) und Art: spezial | zimmer | sport.
const RAEUME = {
  A02: ['Bibliothek', 'spezial'], A03: ['Zimmer Steinbrüchel', 'zimmer'], A04: ['Zimmer Rutishauser', 'zimmer'],
  A05: ['Mehrzweckraum', 'spezial'], A12: ['Bio/Chemie', 'spezial'], A13: ['Religion', 'spezial'],
  A14: ['Zimmer Hugentobler', 'zimmer'], A15: ['Zimmer Frey', 'zimmer'], A16: ['Zimmer Rhiner', 'zimmer'],
  A17: ['Zimmer Schoch', 'zimmer'], A18: ['Zimmer Städler', 'zimmer'], A21: ['Zimmer Stoller', 'zimmer'],
  A22: ['Zimmer Lopez', 'zimmer'], B03: ['Zimmer Straub', 'zimmer'], B13: ['Zimmer Bommeli', 'zimmer'],
  B14: ['Zimmer Giger/Strebel/Rechsteiner', 'zimmer'], B15: ['Zimmer Fischer', 'zimmer'],
  B16: ['Textiles Gestalten (Ledergerber)', 'spezial'], B17: ['Textiles Gestalten 2', 'spezial'],
  B18: ['Bildnerisches Gestalten', 'spezial'], B21: ['Zimmer Gierszewski', 'zimmer'], B22: ['Zimmer Helfenberger', 'zimmer'],
  B23: ['Zimmer Zweifel', 'zimmer'], B24: ['Zimmer Stolz', 'zimmer'], B25: ['Physik', 'spezial'],
  B26: ['Zimmer Schläpfer', 'zimmer'], C01: ['Schulküche C01', 'spezial'], C04: ['Singsaal', 'spezial'],
  U04: ['Makerspace', 'spezial'], Band: ['Bandraum', 'spezial'], Flab: ['Fotolabor', 'spezial'],
  S01: ['Schulküche S01', 'spezial'], S02: ['Werkraum S02', 'spezial'], S03: ['Werkraum S03', 'spezial'],
  S04: ['Turnhalle S04', 'sport'], S05: ['Turnhalle S05', 'sport'], S06: ['Turnhalle S06', 'sport']
};

function datei(dir, re) {
  const hit = fs.readdirSync(dir).find(function (f) { return re.test(f.normalize('NFC')); });
  return hit ? path.join(dir, hit) : null;
}

// ---------- Belegungsplan (Raumplan) lesen ----------
// Eine Spalte pro Raum, eine Zeile pro Lektion («Mo-7:30-8:15»). Einzellektionen stehen mittig in
// der Zeile, Doppellektionen (Kürzel + Fach übereinander) mittig auf der Grenze zweier Zeilen.
function leseBelegungsplan(file) {
  const xml = execFileSync('pdftotext', ['-bbox-layout', file, '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  const W = [];
  const re = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
  let m;
  while ((m = re.exec(xml))) W.push({ x: +m[1], y: +m[2], x2: +m[3], y2: +m[4], t: m[5].replace(/&amp;/g, '&') });
  const zeilen = W.filter(function (w) { return /^(Mo|Di|Mi|Do|Fr)-\d{1,2}:\d{2}-/.test(w.t); })
    .map(function (w) { const t = w.t.split('-'); return { tag: TAG_KURZ.indexOf(t[0]), von: t[1], cy: (w.y + w.y2) / 2, x2: w.x2 }; })
    .sort(function (a, b) { return a.cy - b.cy; });
  if (!zeilen.length) throw new Error('Keine Zeilen im Belegungsplan gefunden');
  const oben = zeilen[0].cy - 6, links = Math.max.apply(null, zeilen.map(function (z) { return z.x2; }));
  const kopf = W.filter(function (w) { return w.y2 < oben && /^([A-Z][0-9]{2}|Band|Flab)$/.test(w.t); })
    .map(function (w) { return { id: w.t, cx: (w.x + w.x2) / 2 }; }).sort(function (a, b) { return a.cx - b.cx; });
  const breite = kopf.length > 1 ? kopf[1].cx - kopf[0].cx : 28;
  const eintraege = [];   // {raum, tag, zeile, tok}
  kopf.forEach(function (r) {
    const ws = W.filter(function (w) { return w.y > oben && w.x > links && Math.abs((w.x + w.x2) / 2 - r.cx) < breite / 2; })
      .sort(function (a, b) { return a.y - b.y; });
    const bloecke = [];   // übereinanderliegende Wörter (überlappend) = ein Eintrag
    ws.forEach(function (w) {
      const b = bloecke[bloecke.length - 1];
      if (b && w.y < b.y2 - 0.5) { b.w.push(w); b.y2 = Math.max(b.y2, w.y2); } else bloecke.push({ y: w.y, y2: w.y2, w: [w] });
    });
    bloecke.forEach(function (b) {
      const cy = (b.y + b.y2) / 2;
      let treffer = zeilen.filter(function (z) { return Math.abs(cy - z.cy) < 3; });
      if (!treffer.length) {
        for (let i = 0; i + 1 < zeilen.length; i++) {
          if (zeilen[i].tag === zeilen[i + 1].tag && Math.abs(cy - (zeilen[i].cy + zeilen[i + 1].cy) / 2) < 3) treffer = [zeilen[i], zeilen[i + 1]];
        }
      }
      const tok = b.w.sort(function (a, c) { return a.y - c.y || a.x - c.x; }).map(function (w) { return w.t; });
      if (!treffer.length) { console.warn('Belegungsplan: nicht zuordenbar ' + r.id + ' ' + tok.join(' ')); return; }
      treffer.forEach(function (z) {
        if (ZEILE[z.von] !== undefined) eintraege.push({ raum: r.id, tag: z.tag, zeile: ZEILE[z.von], tok: tok });
      });
    });
  });
  return { raeume: kopf.map(function (r) { return r.id; }), eintraege: eintraege };
}

(async function () {
  const lektionen = lesePlaene(ORDNER, SEMESTER);
  const bpDatei = OHNE_BP ? null : datei(ORDNER, /^Belegungsplan.*\.pdf$/i);
  const bp = bpDatei ? leseBelegungsplan(bpDatei) : { raeume: [], eintraege: [] };
  if (!OHNE_BP && !bpDatei) console.warn('Kein «Belegungsplan*.pdf» im Ordner — nur Lehrerpläne.');

  // Namen der Lehrpersonen aus den Konten (Nachname bzw. Anzeigename), sonst das Kürzel.
  const { admin, db } = starten();
  const stSnap = await db.collection('students').where('role', '==', 'teacher').get();
  const lehrer = {};
  stSnap.forEach(function (d) { const x = d.data(); lehrer[(x.username || '').toLowerCase()] = x.nachname || x.displayName || x.username; });
  function lpName(kz) { return (LP[kz] && lehrer[LP[kz]]) || kz; }

  const zellen = {};
  function setze(raum, key, e) {
    const r = (zellen[raum] = zellen[raum] || {});
    const alt = r[key];
    if (!alt) { r[key] = e; return; }
    ['lp', 'kl', 'f'].forEach(function (k) {
      if (!e[k]) return;
      const teile = alt[k] ? alt[k].split(', ') : [];
      e[k].split(', ').forEach(function (x) { if (teile.indexOf(x) < 0) teile.push(x); });
      alt[k] = teile.join(', ');
    });
  }
  const mitPlan = {};
  const unbekannt = {};
  lektionen.forEach(function (l) {
    mitPlan[l.lk] = true;
    l.raeume.forEach(function (raum) {
      if (!RAEUME[raum]) unbekannt[raum] = true;
      setze(raum, l.tag + '-' + l.zeile, { lp: lpName(l.lk), kl: l.klassen.filter(Boolean).join(', '), f: l.fach + (l.grp ? ' ' + l.grp : '') });
    });
  });
  // Aus dem Belegungsplan nur Personen ohne Lehrerplan, und nur in sonst freien Lektionen.
  const extern = {};
  bp.eintraege.forEach(function (e) {
    const kz = e.tok[0];
    if (mitPlan[kz] || LP[kz] || !/^[A-ZÄÖÜ][a-zäöüA-Z]+$/.test(kz)) return;
    const key = e.tag + '-' + e.zeile;
    if (zellen[e.raum] && zellen[e.raum][key]) return;
    const rest = e.tok.slice(1).filter(function (t) { return t !== kz; }).join(' ');
    setze(e.raum, key, rest ? { lp: kz, f: rest } : { lp: kz });
    extern[kz] = (extern[kz] || 0) + 1;
  });

  const ids = Object.keys(RAEUME);
  bp.raeume.forEach(function (r) { if (ids.indexOf(r) < 0) { ids.push(r); unbekannt[r] = true; } });
  Object.keys(zellen).forEach(function (r) { if (ids.indexOf(r) < 0) ids.push(r); });
  const raeume = ids.map(function (id) { const r = RAEUME[id] || [id, 'spezial']; return { id: id, name: r[0], art: r[1] }; });

  const n = function (r) { return Object.keys(zellen[r] || {}).length; };
  console.log((JA ? '' : '[VORSCHAU] ') + 'Semester ' + SEMESTER + ': ' + lektionen.length + ' Lektionen aus den Lehrerplänen' +
    (bpDatei ? ', Belegungsplan ' + path.basename(bpDatei) : '') + ' · ' + raeume.length + ' Räume');
  console.log('Belegte Lektionen pro Raum (von 45 am Tag 1–9):\n  ' + raeume.map(function (r) { return r.id + ' ' + n(r.id); }).join(' · '));
  if (Object.keys(extern).length) console.log('Aus dem Belegungsplan (ohne Lehrerplan): ' + Object.keys(extern).map(function (k) { return k + ' ' + extern[k] + '×'; }).join(', '));
  if (Object.keys(unbekannt).length) console.log('Räume ohne Namen in RAEUME (bitte ergänzen): ' + Object.keys(unbekannt).join(', '));
  if (ZEIGE) {
    const z = zellen[ZEIGE] || {};
    console.log('\n' + ZEIGE + ' ' + ((RAEUME[ZEIGE] || [''])[0]));
    ZEITEN.forEach(function (zt) {
      console.log('  ' + zt.von + '  ' + [0, 1, 2, 3, 4].map(function (t) {
        const c = z[t + '-' + zt.s];
        return (c ? (c.lp + ' ' + (c.kl || '') + ' ' + (c.f || '')).trim() : '·').slice(0, 22).padEnd(22);
      }).join(' '));
    });
  }
  if (JSON_DATEI) {
    fs.writeFileSync(JSON_DATEI, JSON.stringify({ semester: SEMESTER, zeiten: ZEITEN, raeume: raeume, zellen: zellen }, null, 1));
    console.log('Gespeichert: ' + JSON_DATEI);
  }
  if (!JA) { console.log('\nNichts geschrieben. Mit --ja ausführen.'); process.exit(0); }

  await db.collection('raumBelegung').doc('plan').set({
    semester: SEMESTER, zeiten: ZEITEN, raeume: raeume, zellen: zellen, quelle: 'untis',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log('Fertig: raumBelegung/plan geschrieben (' + raeume.length + ' Räume).');
  process.exit(0);
})().catch(function (err) { console.error(err); process.exit(1); });
