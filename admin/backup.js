/**
 * Helfenberger's Library — Sicherung der ganzen Firestore-Datenbank.
 *
 *   node backup.js                      -> ~/Desktop/Claude/Library-Unterlagen/Backups/<Datum>/
 *   node backup.js <ordner>             -> in diesen Ordner
 *   node backup.js --ohne-inhalte       -> ohne resourceContent (Übungs-/PDF-Inhalte, der grösste Teil)
 *
 * Pro Top-Level-Collection eine Datei <name>.jsonl: eine Zeile pro Dokument
 * {"pfad": "klassen/G3b/resources/abc", "daten": {...}} — Unter-Collections
 * sind mit drin (voller Pfad). Zeitstempel/Bytes bleiben erkennbar (siehe
 * _firebase.js). Zurückspielen: restore.js. Nur Lesen, ändert nichts.
 *
 * Braucht admin/serviceAccountKey.json (bzw. GOOGLE_APPLICATION_CREDENTIALS
 * oder FIREBASE_SERVICE_ACCOUNT_KEY). Wöchentlich laufen lassen genügt.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { starten, zuJson } = require('./_firebase');

async function sichern(ziel, ohneInhalte) {
  const { db } = starten();
  fs.mkdirSync(ziel, { recursive: true });
  const statistik = {};
  const cols = await db.listCollections();
  for (const col of cols) {
    if (ohneInhalte && col.id === 'resourceContent') { console.log('übersprungen: resourceContent'); continue; }
    const datei = fs.createWriteStream(path.join(ziel, col.id + '.jsonl'));
    let n = 0;
    // Tiefensuche: Dokumente (auch solche, die nur Unter-Collections haben) + Unter-Collections
    async function sammlung(ref) {
      const refs = await ref.listDocuments();
      for (let i = 0; i < refs.length; i += 300) {
        const teil = refs.slice(i, i + 300);
        const snaps = await db.getAll(...teil);
        for (const s of snaps) {
          if (s.exists) { datei.write(JSON.stringify({ pfad: s.ref.path, daten: zuJson(s.data()) }) + '\n'); n++; }
        }
        for (const d of teil) for (const sub of await d.listCollections()) await sammlung(sub);
      }
    }
    await sammlung(col);
    await new Promise((r) => datei.end(r));
    statistik[col.id] = n;
    console.log(col.id.padEnd(28) + n + ' Dokumente');
  }
  fs.writeFileSync(path.join(ziel, '_info.json'), JSON.stringify({ am: new Date().toISOString(), ohneInhalte: !!ohneInhalte, dokumente: statistik }, null, 2));
  console.log('Fertig: ' + ziel);
  return ziel;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const ohne = args.includes('--ohne-inhalte');
  const ordner = args.find((a) => !a.startsWith('--')) ||
    path.join(os.homedir(), 'Desktop/Claude/Library-Unterlagen/Backups', new Date().toISOString().slice(0, 10));
  sichern(ordner, ohne).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { sichern };
