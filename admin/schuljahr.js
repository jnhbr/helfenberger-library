/**
 * Helfenberger's Library — Schuljahreswechsel (einmal im Sommer).
 *
 *   node schuljahr.js vorlage [datei.json]    Vorschlag schreiben (G1a→G2a, G2a→G3a, 3. Klassen → Abschluss …)
 *   node schuljahr.js plan <datei.json>       zeigen, was passieren würde (ändert nichts)
 *   node schuljahr.js ausfuehren <datei.json> --ja
 *
 * Idee: Eine Klasse zieht als Ganzes weiter — Seite (Übungen, Ordner, Kalender,
 * Sitzplan, Ämtli …), Schüler:innen und Klassenlehrperson bekommen nur eine neue
 * Klassen-ID. Die 3. Klassen schliessen ab: ihre Schüler:innen-Konten werden
 * deaktiviert (role 'ehemalig', Daten bleiben), klassenbezogene Daten ihrer Seite
 * werden geleert (Übungen, Ordner, Quizze und Einstellungen der Lehrperson
 * bleiben), und die Seite zieht zur neuen 1. Klasse der Lehrperson um.
 * Neue 1.-Klässler:innen danach wie gewohnt mit schule-konten.js konten <Excel>.
 *
 * Datei (von «vorlage» erzeugt, von Hand prüfen/anpassen):
 *   { "umzug": {"G1a":"G2a", …, "G3a":"G1a"}, "abschluss": ["G3a", …] }
 *   umzug: alte ID → neue ID (Zyklen wie G1a→G2a→G3a→G1a sind erlaubt).
 *   abschluss: Klassen, deren Schüler:innen die Schule verlassen.
 *
 * Vor «ausfuehren» wird automatisch eine Sicherung angelegt (backup.js, ohne
 * Übungsinhalte — die ändern sich nicht). Danach: die ausgegebenen KLASSEN-
 * Zeilen in index.html übernehmen (Testseite), Firestore-Regeln unverändert.
 * Angemeldete Personen sehen die neue Klasse spätestens nach einer Stunde
 * bzw. nach neuem Anmelden (Custom Claims).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { starten } = require('./_firebase');
const { sichern } = require('./backup');

const KLASSEN_RE = /^([GE])([123])([a-z])$/;
// Klassenbezogene Daten einer abschliessenden Klasse (werden geleert).
const KLASSEN_DATEN = ['calendarEntries', 'debts', 'klassenzimmer', 'klasseninfo', 'fragen', 'quizSessions', 'pruefungen'];
const APPMETA_KLASSE = ['neuigkeiten', 'gruppenMitglieder'];

async function allePersonen(db) {
  const snap = await db.collection('students').get();
  return snap.docs.map((d) => Object.assign({ uid: d.id }, d.data()));
}

async function vorlage(datei) {
  const { db } = starten();
  const personen = await allePersonen(db);
  const ids = [...new Set(personen.map((p) => p.klasse).filter((k) => KLASSEN_RE.test(k || '')))].sort();
  const umzug = {}, abschluss = [];
  ids.forEach((k) => {
    const [, niv, jahr, bst] = KLASSEN_RE.exec(k);
    if (jahr === '3') abschluss.push(k);
    const ziel = jahr === '3' ? niv + '1' + bst : niv + (+jahr + 1) + bst;
    umzug[k] = ziel;
  });
  // 3. Klasse → 1. Klasse nur, wenn diese ID frei wird; sonst von Hand festlegen.
  Object.keys(umzug).forEach((k) => {
    const z = umzug[k];
    if (/3/.test(k[1]) && ids.includes(z) && !umzug[z]) umzug[k] = '??';
  });
  const out = { hinweis: 'Prüfen und anpassen, dann: node schuljahr.js plan ' + datei, umzug, abschluss };
  fs.writeFileSync(datei, JSON.stringify(out, null, 2));
  console.log('Vorlage geschrieben: ' + datei);
  console.log(JSON.stringify(out, null, 2));
}

function pruefeDatei(cfg) {
  const fehler = [], neu = {};
  Object.keys(cfg.umzug || {}).forEach((alt) => {
    const z = cfg.umzug[alt];
    if (!z || z === '??') fehler.push('Ziel fehlt für ' + alt);
    else if (neu[z]) fehler.push(z + ' ist Ziel von ' + neu[z] + ' und ' + alt);
    else neu[z] = alt;
  });
  // Ein Ziel, das es schon gibt, muss selbst wegziehen (sonst würden zwei Klassen verschmelzen).
  Object.keys(neu).forEach((z) => {
    if (cfg.alleIds && cfg.alleIds.includes(z) && !cfg.umzug[z]) fehler.push(z + ' existiert schon und zieht nicht weg');
  });
  return fehler;
}

async function planen(cfg, db) {
  const personen = await allePersonen(db);
  cfg.alleIds = [...new Set(personen.map((p) => p.klasse).filter(Boolean))];
  const fehler = pruefeDatei(cfg);
  const abschluss = new Set(cfg.abschluss || []);
  // Das Demo-Konto «schueler» schliesst nie ab, sondern zieht mit seiner Seite um.
  const demo = (p) => (p.username || '').toLowerCase() === 'schueler';
  const gehen = personen.filter((p) => p.role === 'student' && abschluss.has(p.klasse) && !demo(p));
  const wechseln = personen.filter((p) => cfg.umzug[p.klasse] && p.role !== 'leitung' && !gehen.includes(p));
  return { personen, fehler, gehen, wechseln, abschluss };
}

function zeigePlan(cfg, pl) {
  console.log('\n=== Seiten ===');
  Object.keys(cfg.umzug).sort().forEach((alt) => console.log('  ' + alt.padEnd(6) + ' → ' + cfg.umzug[alt] + (pl.abschluss.has(alt) ? '   (Abschluss: Schüler:innen gehen, Klassendaten werden geleert)' : '')));
  console.log('\n=== Personen ===');
  console.log('  ' + pl.gehen.length + ' Schüler:innen schliessen ab (Konto deaktiviert, role «ehemalig»)');
  const proKlasse = {};
  pl.wechseln.forEach((p) => { const k = p.klasse + ' → ' + cfg.umzug[p.klasse]; proKlasse[k] = proKlasse[k] || { s: 0, l: [] }; if (p.role === 'teacher') proKlasse[k].l.push(p.displayName || p.username); else proKlasse[k].s++; });
  Object.keys(proKlasse).sort().forEach((k) => console.log('  ' + k.padEnd(14) + proKlasse[k].s + ' Schüler:innen' + (proKlasse[k].l.length ? ', LP ' + proKlasse[k].l.join(' / ') : '')));
  if (pl.fehler.length) { console.log('\n✗ Fehler in der Datei:'); pl.fehler.forEach((f) => console.log('  - ' + f)); }
}

// Neue KLASSEN-Zeilen für index.html (Lehrperson = wer nach dem Wechsel die Klasse hat).
function klassenZeilen(cfg, personen) {
  const lp = {};
  personen.filter((p) => p.role === 'teacher').forEach((p) => {
    const k = cfg.umzug[p.klasse] || p.klasse;
    if (!KLASSEN_RE.test(k)) return;
    (lp[k] = lp[k] || []).push(p.displayName || p.username);
  });
  const ids = Object.keys(lp).sort((a, b) => a[0].localeCompare(b[0]) * -1 || a.localeCompare(b));
  return ids.map((k) => "  kl('" + k + "', '" + lp[k].join(' / ') + "'),").join('\n');
}

async function kopiereBaum(db, von, nach, w) {
  const snap = await von.get();
  if (snap.exists) w.set(nach, snap.data());
  for (const col of await von.listCollections()) {
    for (const d of await col.listDocuments()) await kopiereBaum(db, d, nach.collection(col.id).doc(d.id), w);
  }
}

async function ausfuehren(cfg) {
  const { db, auth, admin } = starten();
  const pl = await planen(cfg, db);
  zeigePlan(cfg, pl);
  if (pl.fehler.length) { console.log('\nAbgebrochen – erst die Datei korrigieren.'); process.exit(1); }
  const map = (k) => cfg.umzug[k] || k;
  const jahr = new Date().getFullYear();

  console.log('\n1/6 Sicherung …');
  await sichern(path.join(os.homedir(), 'Desktop/Claude/Library-Unterlagen/Backups', 'vor-schuljahreswechsel-' + new Date().toISOString().slice(0, 10)), true);

  console.log('2/6 Abschluss: Konten deaktivieren, aus Gruppen nehmen …');
  const weg = new Set(pl.gehen.map((p) => p.uid));
  for (const p of pl.gehen) {
    try { await auth.updateUser(p.uid, { disabled: true }); } catch (e) { console.log('  Auth ' + p.uid + ': ' + e.message); }
    await auth.setCustomUserClaims(p.uid, { klasse: 'ehemalig' }).catch(() => {});
    await db.collection('students').doc(p.uid).update({ role: 'ehemalig', klasse: 'ehemalig-' + jahr, frueherKlasse: p.klasse });
  }
  const gruppen = await db.collection('gruppen').get();
  for (const g of gruppen.docs) {
    const d = g.data(), mitglieder = (d.mitglieder || []).filter((u) => !weg.has(u)), namen = {};
    Object.keys(d.namen || {}).forEach((u) => { if (!weg.has(u)) namen[u] = Object.assign({}, d.namen[u], { k: map(d.namen[u].k) }); });
    await g.ref.update({ mitglieder, namen, ownerKlasse: map(d.ownerKlasse) });
  }

  console.log('3/6 Klassendaten der abschliessenden Klassen leeren …');
  for (const k of pl.abschluss) {
    const ref = db.collection('klassen').doc(k);
    for (const c of KLASSEN_DATEN) await db.recursiveDelete(ref.collection(c));
    for (const a of APPMETA_KLASSE) await ref.collection('appMeta').doc(a).delete().catch(() => {});
  }

  console.log('4/6 Seiten umziehen …');
  const tmp = db.collection('_schuljahrTmp');
  let w = db.bulkWriter();
  for (const alt of Object.keys(cfg.umzug)) await kopiereBaum(db, db.collection('klassen').doc(alt), tmp.doc(cfg.umzug[alt]), w);
  await w.close();
  for (const alt of Object.keys(cfg.umzug)) await db.recursiveDelete(db.collection('klassen').doc(alt));
  w = db.bulkWriter();
  for (const alt of Object.keys(cfg.umzug)) await kopiereBaum(db, tmp.doc(cfg.umzug[alt]), db.collection('klassen').doc(cfg.umzug[alt]), w);
  await w.close();
  await db.recursiveDelete(tmp);

  console.log('5/6 Personen und Verweise nachführen …');
  for (const p of pl.wechseln) {
    const neu = map(p.klasse);
    const user = await auth.getUser(p.uid).catch(() => null);
    if (user) await auth.setCustomUserClaims(p.uid, Object.assign({}, user.customClaims || {}, { klasse: neu }));
    await db.collection('students').doc(p.uid).update({ klasse: neu });
    if (p.role === 'teacher') {
      const sp = db.collection('progress').doc(p.uid).collection('einstellungen').doc('stundenplan');
      const s = await sp.get();
      if (s.exists && s.data().zellen) {
        const z = s.data().zellen, upd = {};
        Object.keys(z).forEach((k) => { if (z[k] && z[k].kl && cfg.umzug[z[k].kl]) upd['zellen.' + k + '.kl'] = cfg.umzug[z[k].kl]; });
        if (Object.keys(upd).length) await sp.update(upd);
      }
    }
  }
  // Schulleitung: Klasse im Claim mitziehen
  for (const p of pl.personen.filter((x) => x.role === 'leitung' && cfg.umzug[x.klasse])) {
    const user = await auth.getUser(p.uid);
    await auth.setCustomUserClaims(p.uid, Object.assign({}, user.customClaims || {}, { klasse: map(p.klasse) }));
    await db.collection('students').doc(p.uid).update({ klasse: map(p.klasse) });
  }
  const idx = await db.collection('uebungsIndex').get();
  w = db.bulkWriter();
  idx.forEach((d) => w.update(d.ref, { klassen: [...new Set((d.data().klassen || []).map(map))] }));
  for (const k of Object.values(cfg.umzug)) {
    const res = await db.collection('klassen').doc(k).collection('resources').get();
    res.forEach((d) => { if (d.data().originKlasse && cfg.umzug[d.data().originKlasse]) w.update(d.ref, { originKlasse: map(d.data().originKlasse) }); });
  }
  await w.close();

  console.log('6/6 Gruppen-Mitglieder pro Seite neu berechnen …');
  const proSeite = {};
  (await db.collection('gruppen').get()).forEach((g) => { const d = g.data(); (proSeite[d.ownerKlasse] = proSeite[d.ownerKlasse] || new Set()); (d.mitglieder || []).forEach((u) => proSeite[d.ownerKlasse].add(u)); });
  for (const k of Object.keys(proSeite)) {
    await db.collection('klassen').doc(k).collection('appMeta').doc('gruppenMitglieder').set({ uids: [...proSeite[k]], updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  }

  console.log('\n✓ Fertig. Neue KLASSEN-Zeilen für index.html (nur die Klassen, FLP/ISF/Praktikum bleiben):\n');
  console.log(klassenZeilen(cfg, pl.personen));
  console.log('\nNeue Klassen-IDs (z. B. E3c) zusätzlich in STP_KLASSEN (index.html) und KLASSEN (admin/schule-konten.js) ergänzen.');
  console.log('Danach neue 1.-Klässler:innen: node schule-konten.js konten <Logins.xlsx>');
}

async function main() {
  const [cmd, datei, ja] = process.argv.slice(2);
  if (cmd === 'vorlage') return vorlage(datei || 'schuljahr-' + (new Date().getFullYear()) + '.json');
  if (!datei || !['plan', 'ausfuehren'].includes(cmd)) { console.error('Aufruf: node schuljahr.js vorlage|plan|ausfuehren <datei.json> [--ja]'); process.exit(1); }
  const cfg = JSON.parse(fs.readFileSync(datei, 'utf-8'));
  if (cmd === 'plan') {
    const { db } = starten();
    const pl = await planen(cfg, db);
    zeigePlan(cfg, pl);
    console.log('\nNeue KLASSEN-Zeilen für index.html:\n' + klassenZeilen(cfg, pl.personen));
    console.log('\nNur angezeigt. Ausführen: node schuljahr.js ausfuehren ' + datei + ' --ja');
    return;
  }
  if (ja !== '--ja') { console.error('Zum Ausführen --ja anhängen (vorher «plan» anschauen).'); process.exit(1); }
  await ausfuehren(cfg);
}
main().catch((e) => { console.error(e); process.exit(1); });
