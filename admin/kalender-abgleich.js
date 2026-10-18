/**
 * 🗓️ Kalender-Abgleich: Apple-Kalender «Arbeit» → «Mein Stundenplan» in der Library.
 * Läuft stündlich auf Jans Mac (kalender-dienst.sh). Liest den Kalender nur (osascript),
 * schreibt nur in den eigenen Plan der Lehrperson:
 *   progress/{uid}/einstellungen/stundenplan        zeiten + einzelne zellen (Wochenraster)
 *   progress/{uid}/einstellungen/stundenplanTermine 📌 Termine an einzelnen Daten (q:'kal')
 * Nichts geht an die Klasse (kein kl im Termin, nichts in klassen/…).
 *
 * Regeln:
 * - Wochenraster: pro Wochentag/Lektion zählt, was im Kalender in den restlichen Schulwochen
 *   meistens steht. Passt die Library-Zelle dazu (RZG = Geschichte/Geografie, NT = Biologie …),
 *   bleibt sie unverändert; sonst wird sie ersetzt bzw. 🌴 frei.
 * - Jeder Schultag ab heute bis zu den nächsten Sommerferien, der vom Raster abweicht, bekommt
 *   📌 Termine (Ausfall, anderer Anlass, Sitzung in einer leeren/Zusatz-Zeile).
 * - Termine ohne q:'kal' hat jemand in der Library eingetragen: die bleiben und gehen vor.
 * - Ferien (FERIEN unten, wie FERIEN_TG in index.html) kennt die Library selbst.
 *
 *   node kalender-abgleich.js [--probe] [--laut]     --probe = nur zeigen, nichts schreiben
 * Einstellungen: config.json daneben {benutzer, schluessel, kalender}.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROBE = process.argv.includes('--probe');
const LAUT = PROBE || process.argv.includes('--laut');
const CFG_DATEI = path.join(__dirname, 'config.json');
const CFG = Object.assign({ benutzer: 'helfenberger', kalender: 'Arbeit',
  schluessel: path.join(process.env.HOME, 'Desktop/Claude/Projekte/helfenberger-library-firebase/admin/serviceAccountKey.json') },
  fs.existsSync(CFG_DATEI) ? JSON.parse(fs.readFileSync(CFG_DATEI, 'utf8')) : {});

// Lektionszeiten der Sek Altnau (wie Untis / admin/stundenplan-untis.js) und Zusatzzeilen (STP_EXTRA).
const ZEITEN = [
  { von: '07:30', bis: '08:15' }, { von: '08:20', bis: '09:05' }, { von: '09:10', bis: '09:55' },
  { von: '10:15', bis: '11:00' }, { von: '11:05', bis: '11:50' },
  { von: '13:30', bis: '14:15' }, { von: '14:20', bis: '15:05' }, { von: '15:20', bis: '16:05' }, { von: '16:10', bis: '16:55' }
];
const EXTRA = [
  { s: 'm1', von: '11:50', bis: '12:35' }, { s: 'm2', von: '12:40', bis: '13:25' },
  { s: 'a1', von: '17:00', bis: '17:45' }, { s: 'a2', von: '17:50', bis: '18:35' }
];
// Wie FERIEN_TG in index.html (bei neuen Schuljahren dort und hier nachführen).
const FERIEN = [
  ['2026-10-03', '2026-10-18'], ['2026-12-19', '2027-01-03'], ['2027-01-30', '2027-02-07'], ['2027-03-26', '2027-04-11'],
  ['2027-05-06', '2027-05-17'], ['2027-07-10', '2027-08-15'], ['2027-10-09', '2027-10-24'], ['2027-12-18', '2028-01-02'],
  ['2028-01-29', '2028-02-06'], ['2028-04-01', '2028-04-17'], ['2028-05-25', '2028-06-05'], ['2028-07-08', '2028-08-13']
];
// Kalendertitel -> passende Library-Fächer (erstes = was neu eingetragen wird; t: = Text ohne Kachel).
const FAECHER = [
  [/^mathe/i, ['mathe']], [/^deutsch/i, ['deutsch']], [/^englisch/i, ['englisch']], [/^franz/i, ['franzoesisch']],
  [/^rzg/i, ['t:RZG', 'geschichte', 'geografie']], [/^nt\b/i, ['t:NT', 'biologie', 'chemie', 'physik']],
  [/^erg/i, ['psychologie']], [/^informatik|^m(edien)? ?(und|&) ?i/i, ['informatik']], [/^(turnen|sport(?!tag))/i, ['sport']],
  [/^gtz/i, ['gtz']], [/jass|schach/i, ['schach-jassen']], [/^wah/i, ['wah']], [/^musik/i, ['musik']],
  [/^isf|lernatelier/i, ['isf']], [/^sva$/i, ['sva']], [/^berufswahl/i, ['berufswahl']]
];
const KLASSE_RE = /\b([EG][1-3][a-c])\b/;

const min = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusTage = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const wochentag = (s) => (new Date(s + 'T12:00:00').getDay() + 6) % 7;   // Mo = 0
const ferien = (s) => FERIEN.some(([a, b]) => a <= s && s <= b);
const log = (...a) => console.log(new Date().toLocaleString('de-CH'), ...a);

// ---------- Kalender lesen (nur lesen) ----------
function kalenderLesen(von, bis) {
  const jxa = `
const C = Application('Calendar');
const k = C.calendars.whose({name: ${JSON.stringify(CFG.kalender)}})();
if (!k.length) throw new Error('Kalender nicht gefunden');
const p2 = (n) => String(n).padStart(2, '0');
const lok = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
const out = [];
for (const e of k[0].events.whose({_and: [{startDate: {'>=': new Date(${von.getTime()})}}, {startDate: {'<': new Date(${bis.getTime()})}}]})()) {
  let ex = []; try { ex = (e.excludedDates() || []).map(lok); } catch (err) {}
  out.push({uid: e.uid(), t: e.summary(), s: lok(e.startDate()), e: lok(e.endDate()), g: e.alldayEvent(), r: e.recurrence() || '', ex});
}
JSON.stringify(out);`;
  return JSON.parse(execFileSync('osascript', ['-l', 'JavaScript', '-e', jxa], { encoding: 'utf8', timeout: 1800000, maxBuffer: 64 << 20 }));
}

// Serien auflösen -> [{datum, von, bis, t}] (Zeiten), ganztags -> {datum: [Titel]}
function vorkommen(events, ab, bis) {
  const lekt = [], ganz = {}, gesehen = new Set();
  const dazu = (datum, e, von, bisZ) => { if (datum >= ab && datum <= bis) lekt.push({ datum, von, bis: bisZ, t: e.t.trim() }); };
  for (const e of events) {
    const key = e.uid + e.s;
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    const d0 = e.s.slice(0, 10), von = e.s.slice(11), bisZ = e.e.slice(11);
    if (e.g) {
      for (let d = d0; d < e.e.slice(0, 10) || d === d0; d = plusTage(d, 1)) (ganz[d] = ganz[d] || []).push(e.t.trim());
      continue;
    }
    if (!e.r) { dazu(d0, e, von, bisZ); continue; }
    const r = Object.fromEntries(e.r.split(';').map((x) => x.split('=')));
    const schritt = r.FREQ === 'DAILY' ? 1 : r.FREQ === 'WEEKLY' ? 7 : 0;
    if (!schritt) { log('⚠️ Wiederholung nicht unterstützt, nur erster Termin:', e.t, e.r); dazu(d0, e, von, bisZ); continue; }
    const iv = Number(r.INTERVAL || 1) * schritt;
    let ende = bis;
    if (r.UNTIL) {   // UTC 20270621T053000Z bzw. Datum 20270621
      const u = r.UNTIL;
      const dt = u.length > 8 ? new Date(Date.UTC(+u.slice(0, 4), +u.slice(4, 6) - 1, +u.slice(6, 8), +u.slice(9, 11), +u.slice(11, 13))) : new Date(u.slice(0, 4) + '-' + u.slice(4, 6) + '-' + u.slice(6, 8) + 'T23:59:00');
      ende = iso(dt) < ende ? iso(dt) : ende;
    }
    const aus = new Set(e.ex.map((x) => x.slice(0, 10)));
    let n = 0;
    for (let d = d0; d <= ende; d = plusTage(d, iv)) {
      if (r.COUNT && ++n > Number(r.COUNT)) break;
      if (!aus.has(d)) dazu(d, e, von, bisZ);
    }
  }
  return { lekt, ganz };
}

// ---------- Fächer ----------
function fachVon(titel) {
  for (const [re, liste] of FAECHER) if (re.test(titel)) return liste;
  return null;
}
function passt(titel, zelle) {
  if (!zelle || zelle.frei) return false;
  const liste = fachVon(titel);
  if (!liste) return !!zelle.t && zelle.t.toLowerCase() === titel.toLowerCase();
  return liste.some((x) => (x.startsWith('t:') ? zelle.t === x.slice(2) : zelle.f === x));
}
function zelleFuer(titel) {
  const liste = fachVon(titel), z = {};
  if (!liste) z.t = titel;
  else if (liste[0].startsWith('t:')) z.t = liste[0].slice(2);
  else z.f = liste[0];
  const kl = titel.match(KLASSE_RE);
  if (kl) z.kl = kl[1];
  return z;
}
// Vergleich unabhängig von der Reihenfolge der Felder (Firestore liefert sie sortiert zurück).
const gleich = (o) => (o ? JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]])) : '');
const lektion = (z) => !!z && !z.frei && !!(z.f || z.t);

// Zeilen, die ein Termin von..bis überdeckt (mind. 10 Minuten)
const ZEILEN = ZEITEN.map((z, i) => ({ s: String(i), von: min(z.von), bis: min(z.bis) }))
  .concat(EXTRA.map((x) => ({ s: x.s, von: min(x.von), bis: min(x.bis) })));
function zeilenVon(von, bis) {
  const a = min(von), b = min(bis);
  const r = ZEILEN.filter((z) => Math.min(b, z.bis) - Math.max(a, z.von) >= 10);
  // Mittagszeilen nur für Termine über Mittag (Sitzung, Essen), nicht für ganze Tage wie den Teamtag.
  const lekt = r.some((z) => /^\d$/.test(z.s));
  return r.filter((z) => !(lekt && z.s[0] === 'm')).map((z) => z.s);
}

// ---------- Abgleich ----------
(async function () {
  const heute = iso(new Date());
  // Bis zum Beginn der nächsten Sommerferien (Juli), Serien ab Schuljahresbeginn (1. August).
  const sommer = FERIEN.find(([a]) => a.slice(5, 7) === '07' && a > heute);
  const bis = plusTage(sommer ? sommer[0] : plusTage(heute, 300), -1);
  const jahr = new Date().getMonth() >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const t0 = Date.now();
  const events = kalenderLesen(new Date(jahr, 7, 1), new Date(bis + 'T23:59:00'));
  const { lekt, ganz } = vorkommen(events, heute, bis);
  if (LAUT) log(`Kalender «${CFG.kalender}»: ${events.length} Einträge, ${lekt.length} Termine bis ${bis} (${Math.round((Date.now() - t0) / 1000)} s)`);

  process.env.GOOGLE_APPLICATION_CREDENTIALS = CFG.schluessel;
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(require(CFG.schluessel)) });
  const db = admin.firestore();
  db.settings({ preferRest: true });
  const FV = admin.firestore.FieldValue;
  const q = await db.collection('students').where('username', '==', CFG.benutzer).get();
  if (q.empty) throw new Error('Konto nicht gefunden: ' + CFG.benutzer);
  const uid = q.docs[0].id;
  const refPlan = db.doc(`progress/${uid}/einstellungen/stundenplan`);
  const refSchule = db.doc(`progress/${uid}/einstellungen/stundenplanSchule`);
  const refTermine = db.doc(`progress/${uid}/einstellungen/stundenplanTermine`);
  const [sPlan, sSchule, sTermine] = await Promise.all([refPlan.get(), refSchule.get(), refTermine.get()]);
  const plan = sPlan.exists ? sPlan.data() : {};
  const zellen = Object.assign({}, plan.zellen || {});
  const schule = (sSchule.exists && sSchule.data().zellen) || {};
  const termine = (sTermine.exists && sTermine.data().termine) || {};
  const wirksam = (k) => (k in zellen ? zellen[k] : schule[k]);

  // Schultage ab heute und was der Kalender pro Tag/Zeile hat
  const tage = [];
  for (let d = heute; d <= bis; d = plusTage(d, 1)) if (wochentag(d) < 5 && !ferien(d)) tage.push(d);
  const proTag = {};
  for (const l of lekt) {
    if (wochentag(l.datum) > 4 || ferien(l.datum)) continue;
    for (const s of zeilenVon(l.von, l.bis)) ((proTag[l.datum] = proTag[l.datum] || {})[s] = proTag[l.datum][s] || []).push(l.t);
  }

  // 1) Wochenraster: Mehrheit der restlichen Schulwochen pro Wochentag/Zeile
  const neuZellen = {};
  for (let w = 0; w < 5; w++) {
    const daten = tage.filter((d) => wochentag(d) === w);
    if (daten.length < 3) continue;
    for (const z of ZEILEN) {
      const k = `${w}-${z.s}`, zaehl = {};
      let leer = 0;
      for (const d of daten) {
        const ts = ((proTag[d] || {})[z.s] || []).filter((t) => fachVon(t));   // nur Unterricht, keine Sitzungen
        if (!ts.length) { leer++; continue; }
        const t = ts[0]; zaehl[t] = (zaehl[t] || 0) + 1;
      }
      const top = Object.keys(zaehl).sort((a, b) => zaehl[b] - zaehl[a])[0];
      const jetzt = wirksam(k);
      if (top && zaehl[top] * 2 > daten.length) {
        if (!passt(top, jetzt) && !Object.keys(zaehl).some((t) => zaehl[t] * 2 > daten.length && passt(t, jetzt))) neuZellen[k] = zelleFuer(top);
      } else if (leer * 2 > daten.length && lektion(jetzt) && z.s.length === 1) {
        neuZellen[k] = { frei: true };
      }
    }
  }
  Object.assign(zellen, neuZellen);
  const zeitenAnders = JSON.stringify((plan.zeiten || []).map((z) => z.von + '-' + z.bis)) !== JSON.stringify(ZEITEN.map((z) => z.von + '-' + z.bis));

  // 2) Termine pro Schultag
  const soll = {};
  for (const d of tage) {
    const w = wochentag(d), kal = proTag[d] || {}, grund = (ganz[d] || [])[0] || '';
    for (const z of ZEILEN) {
      const k = `${w}-${z.s}`, c = wirksam(k), ts = kal[z.s] || [];
      let tm = null;
      if (lektion(c)) {
        const da = ts.some((t) => passt(t, c));
        const andere = ts.filter((t) => !passt(t, c));
        if (da && andere.length) tm = { t: andere[0], par: true };
        else if (!da && andere.length) tm = fachVon(andere[0]) ? zelleFuer(andere[0]) : { t: andere[0] };
        else if (!da) tm = grund ? { frei: true, t: grund } : { frei: true };
      } else if (ts.length) {
        tm = fachVon(ts[0]) ? zelleFuer(ts[0]) : { t: ts[0] };
      }
      if (tm) { tm.q = 'kal'; (soll[d] = soll[d] || {})[z.s] = tm; }
    }
  }

  // 3) Unterschiede zu den bisherigen Kalender-Terminen (eigene Termine bleiben)
  const feld = {}, notiz = { neu: 0, geaendert: 0, weg: 0, eigeneVor: 0 };
  const alleDaten = new Set(Object.keys(soll).concat(Object.keys(termine).filter((d) => d >= heute)));
  for (const d of alleDaten) {
    const ist = termine[d] || {}, sol = soll[d] || {}, tag = {};
    for (const s of new Set(Object.keys(ist).concat(Object.keys(sol)))) {
      const a = ist[s], b = sol[s];
      if (a && a.q !== 'kal') { if (b) notiz.eigeneVor++; continue; }   // in der Library eingetragen
      if (b && gleich(a) !== gleich(b)) { tag[s] = b; a ? notiz.geaendert++ : notiz.neu++; }
      else if (a && !b) { tag[s] = FV.delete(); notiz.weg++; }
    }
    if (Object.keys(tag).length) feld[d] = tag;
  }

  const zusammen = `Raster: ${Object.keys(neuZellen).length} Zellen${zeitenAnders ? ' + Zeiten' : ''} · Termine: ${notiz.neu} neu, ${notiz.geaendert} geändert, ${notiz.weg} entfernt` +
    (notiz.eigeneVor ? ` · ${notiz.eigeneVor} eigene Library-Termine gehen vor` : '');
  if (LAUT || Object.keys(feld).length || Object.keys(neuZellen).length || zeitenAnders) log(zusammen);
  if (PROBE) {
    for (const [k, v] of Object.entries(neuZellen)) console.log('  Raster', k, JSON.stringify(wirksam(k)), '→', JSON.stringify(v));
    for (const d of Object.keys(feld).sort()) console.log('  ' + d, Object.entries(feld[d]).map(([s, v]) => s + ':' + (!v.q ? '✗' : v.frei ? '🌴' + (v.t || '') : (v.par ? '↔️' : '📌') + (v.t || v.f) + (v.kl ? ' ' + v.kl : ''))).join('  '));
    return;
  }
  if (zeitenAnders || Object.keys(neuZellen).length) {
    const upd = { updatedAt: FV.serverTimestamp() };
    if (zeitenAnders) upd.zeiten = ZEITEN;
    for (const [k, v] of Object.entries(neuZellen)) upd['zellen.' + k] = v;
    await (sPlan.exists ? refPlan.update(upd) : refPlan.set({ zeiten: ZEITEN, zellen: neuZellen, updatedAt: FV.serverTimestamp() }));
  }
  if (Object.keys(feld).length) await refTermine.set({ termine: feld, updatedAt: FV.serverTimestamp() }, { merge: true });
})().catch((e) => { log('❌', e.message || e); process.exit(1); });
