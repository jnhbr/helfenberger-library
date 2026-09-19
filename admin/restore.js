/**
 * Helfenberger's Library — Sicherung (backup.js) zurückspielen.
 *
 *   node restore.js <backup-ordner> <pfad-präfix>          zeigt nur, was zurückkäme
 *   node restore.js <backup-ordner> <pfad-präfix> --ja     schreibt es zurück
 *
 * Beispiele für den Präfix:
 *   klassen/G2a/resources/mathe_1726     eine versehentlich gelöschte Übung
 *   klassen/G2a/calendarEntries          den ganzen Kalender der G2a
 *   resourceContent/mathe_1726           den Inhalt einer Übung (inkl. chunks)
 *
 * Überschreibt Dokumente mit demselben Pfad (set, ohne merge), löscht nichts.
 * Auth-Konten/Passwörter sind NICHT in der Sicherung.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { starten, ausJson } = require('./_firebase');

async function main() {
  const [ordner, praefix, ja] = process.argv.slice(2);
  if (!ordner || !praefix) { console.error('Aufruf: node restore.js <backup-ordner> <pfad-präfix> [--ja]'); process.exit(1); }
  const top = praefix.split('/')[0];
  const datei = path.join(ordner, top + '.jsonl');
  if (!fs.existsSync(datei)) { console.error('Nicht in der Sicherung: ' + datei); process.exit(1); }
  const { db } = starten();
  const treffer = [];
  const rl = readline.createInterface({ input: fs.createReadStream(datei), crlfDelay: Infinity });
  for await (const zeile of rl) {
    if (!zeile) continue;
    const d = JSON.parse(zeile);
    if (d.pfad === praefix || d.pfad.startsWith(praefix + '/')) treffer.push(d);
  }
  console.log(treffer.length + ' Dokumente unter «' + praefix + '»');
  treffer.slice(0, 20).forEach((d) => console.log('  ' + d.pfad));
  if (treffer.length > 20) console.log('  …');
  if (ja !== '--ja') { console.log('Nur angezeigt. Zum Zurückschreiben: --ja anhängen.'); return; }
  const w = db.bulkWriter();
  treffer.forEach((d) => w.set(db.doc(d.pfad), ausJson(d.daten, db)));
  await w.close();
  console.log('Zurückgeschrieben.');
}
main().catch((e) => { console.error(e); process.exit(1); });
