#!/usr/bin/env node
/**
 * 📮 Briefkasten-Reserve aufräumen.
 *
 *   node briefkasten-aufraeumen.js [--probe] [--tage 30]
 *
 * Abgeholte Abgaben bleiben als Reserve in der Datenbank (falls der Computer der
 * Lehrperson kaputtgeht oder sie eine Datei nochmals braucht). Dieses Skript löscht
 * den INHALT (chunks) aller Abgaben, die vor mehr als 30 Tagen abgeholt wurden, und
 * setzt inhaltWeg:true – die Quittung (wer, wann, welche Dateien) bleibt stehen.
 * Noch nicht abgeholte Abgaben werden nie angerührt.
 * Läuft wöchentlich nach dem Backup (Live-Repo: .github/workflows/backup.yml), die
 * gelöschten Dateien stecken also noch in den Backups der letzten 90 Tage.
 * --probe zeigt nur an, was gelöscht würde.
 */
const { starten } = require('./_firebase');

async function aufraeumen(tage, probe) {
  const { db } = starten();
  const grenze = Date.now() - tage * 24 * 3600 * 1000;
  let abgaben = 0, chunks = 0, kaesten = 0;
  for (const klasse of await db.collection('klassen').listDocuments()) {
    for (const bk of await klasse.collection('briefkaesten').listDocuments()) {
      kaesten++;
      // Eine Bedingung, kein orderBy: braucht keinen zusammengesetzten Index.
      const snap = await bk.collection('abgaben').where('abgeholt', '==', true).get();
      for (const a of snap.docs) {
        const d = a.data(), am = d.abgeholtAm && d.abgeholtAm.toMillis ? d.abgeholtAm.toMillis() : 0;
        if (d.inhaltWeg || !am || am > grenze) continue;
        const refs = await a.ref.collection('chunks').listDocuments();
        abgaben++; chunks += refs.length;
        if (probe) continue;
        for (let i = 0; i < refs.length; i += 400) {
          const batch = db.batch();
          refs.slice(i, i + 400).forEach((r) => batch.delete(r));
          await batch.commit();
        }
        await a.ref.update({ inhaltWeg: true });
      }
    }
  }
  console.log(kaesten + ' Briefkästen geprüft, ' + abgaben + ' Abgaben älter als ' + tage + ' Tage' +
    (probe ? ' (Probe: ' + chunks + ' Teile würden gelöscht)' : ', ' + chunks + ' Teile gelöscht'));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const ti = args.indexOf('--tage');
  const tage = ti >= 0 ? Number(args[ti + 1]) : 30;
  if (!(tage >= 7)) { console.error('--tage muss mindestens 7 sein'); process.exit(1); }
  aufraeumen(tage, args.includes('--probe')).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { aufraeumen };
