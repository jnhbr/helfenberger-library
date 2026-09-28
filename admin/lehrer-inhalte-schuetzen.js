/**
 * Helfenberger's Library — 🔒 Inhalte der Lehrer-HTMLs schützen
 *
 *   node lehrer-inhalte-schuetzen.js          (nur anzeigen, was sich ändern würde)
 *   node lehrer-inhalte-schuetzen.js --ja     (ausführen)
 *
 * Seit 28.09.2026 lässt firestore.rules einen Inhalt (resourceContent/{id} und
 * seine Chunks) mit nurLehrer:true nur Lehrpersonen/Schulleitung lesen. Neue
 * Lehrer-HTMLs markiert die App selbst; dieses Skript führt die bestehenden nach.
 * uebungen-spiegeln.js ruft es jede Nacht am Schluss auf (Kopien ziehen ein
 * 🔒 erst mit der Spiegelung nach).
 *
 * Regel (wie inhaltGeschuetzt() in index.html): ein Inhalt ist geschützt, wenn
 * ALLE Übungen in allen Klassen, die ihn als aktuelle oder vorherige Fassung
 * zeigen, Lehrer-HTMLs (nurLehrer:true) sind. Zeigt ihn irgendwo eine normal
 * sichtbare Übung, wird ein allfälliger Schutz wieder entfernt — das Skript
 * darf also jederzeit nochmals laufen und korrigiert dabei auch Fehlstände.
 */
// uebungen: optional [{id, data}] aller Übungen aller Seiten (die Spiegelung hat
// sie schon geladen) — sonst werden sie hier gelesen.
async function inhalteSchuetzen(db, ja, uebungen) {
  if (!uebungen) {
    uebungen = [];
    const seiten = (await db.collection('klassen').listDocuments()).map(d => d.id);
    for (const k of seiten) {
      const snap = await db.collection('klassen').doc(k).collection('resources').get();
      snap.forEach(d => uebungen.push({ id: d.id, data: d.data() }));
    }
  }
  const inhalte = {};   // contentId -> { lehrer: n, sichtbar: n, titel }
  uebungen.forEach(u => {
    const r = u.data;
    if (r.externalUrl || r.linkUrl) return;
    [r.contentId || u.id, r.prevContentId].forEach(cid => {
      if (!cid) return;
      const x = inhalte[cid] = inhalte[cid] || { lehrer: 0, sichtbar: 0, titel: r.title || r.fileName || u.id };
      if (r.nurLehrer === true) x.lehrer++; else x.sichtbar++;
    });
  });
  // Nur die bereits geschützten Inhalte lesen (wenige), nicht alle Köpfe.
  const geschuetzt = {};
  (await db.collection('resourceContent').where('nurLehrer', '==', true).get()).forEach(d => { geschuetzt[d.id] = true; });
  const soll = cid => !!inhalte[cid] && inhalte[cid].sichtbar === 0 && inhalte[cid].lehrer > 0;
  const aendern = Object.keys(inhalte).filter(cid => soll(cid) && !geschuetzt[cid])
    .concat(Object.keys(geschuetzt).filter(cid => !soll(cid)));
  let an = 0, aus = 0;
  for (const cid of aendern) {
    const ziel = soll(cid);
    const ref = db.collection('resourceContent').doc(cid);
    if (ziel && !(await ref.get()).exists) continue;   // Inhalt gibt es nicht (mehr): nichts anlegen
    console.log((ziel ? '🔒 schützen   ' : '🔓 freigeben  ') + cid + '  «' + (inhalte[cid] ? inhalte[cid].titel : 'von keiner Übung genutzt') + '»');
    ziel ? an++ : aus++;
    if (!ja) continue;
    // set+merge statt update: ein fehlender Chunk soll nicht den ganzen Lauf abbrechen
    const batch = db.batch();
    batch.set(ref, { nurLehrer: ziel }, { merge: true });
    const chunks = await ref.collection('chunks').listDocuments();
    chunks.forEach(c => batch.set(c, { nurLehrer: ziel }, { merge: true }));
    await batch.commit();
  }
  console.log('🔒 Lehrer-Inhalte: ' + an + ' schützen, ' + aus + ' freigeben' + (ja ? ' – erledigt.' : ' – nur Vorschau, zum Ausführen mit --ja.'));
}
module.exports = { inhalteSchuetzen };

if (require.main === module) {
  const { starten } = require('./_firebase');
  const { db } = starten();
  inhalteSchuetzen(db, process.argv.includes('--ja'))
    .then(() => process.exit(0))
    .catch(err => { console.error('❌ ' + (err && err.message || err)); process.exit(1); });
}
