/**
 * Helfenberger's Library — Passwort-Anfragen abarbeiten.
 *
 * Lehrpersonen stellen in der App (⚙️ → «🔑 Passwort zurücksetzen») eine Anfrage
 * für eine Schülerin / einen Schüler: passwortAnfragen/{id} = {uid, name,
 * klasse, vonUid, vonName, status:'offen', am}. Dieses Skript setzt für jede
 * offene Anfrage ein neues, gut lesbares Passwort (z. B. «Sonne47»), trägt es
 * in die Anfrage ein (status 'erledigt') — die anfragende Lehrperson sieht es
 * dann in der App und gibt es weiter; mit «✓ Weitergegeben» wird die Anfrage
 * gelöscht. Jan (helfenberger) sieht in der App alle Anfragen.
 *
 *   node passwort-reset.js            offene Anfragen anzeigen
 *   node passwort-reset.js --ja       Passwörter setzen
 *
 * Läuft auch in GitHub Actions (Secret FIREBASE_SERVICE_ACCOUNT_KEY), siehe
 * admin/workflows-vorlage/passwort-anfragen.yml.
 */
const crypto = require('crypto');
const { starten } = require('./_firebase');

const WOERTER = ['Sonne', 'Wolke', 'Apfel', 'Tiger', 'Blume', 'Vogel', 'Stern', 'Berg', 'Fluss', 'Birne',
  'Adler', 'Kiwi', 'Mond', 'Wald', 'Insel', 'Rakete', 'Pinguin', 'Kaktus', 'Zebra', 'Koala', 'Delfin', 'Palme'];
function neuesPasswort() {
  return WOERTER[crypto.randomInt(WOERTER.length)] + String(crypto.randomInt(10, 100));
}

async function main() {
  const ja = process.argv.includes('--ja');
  const { db, auth, admin } = starten();
  const snap = await db.collection('passwortAnfragen').where('status', '==', 'offen').get();
  if (snap.empty) { console.log('Keine offenen Anfragen.'); return; }
  for (const d of snap.docs) {
    const a = d.data();
    const zeile = (a.name || '?') + ' (' + (a.klasse || '?') + ') – angefragt von ' + (a.vonName || '?');
    if (!ja) { console.log('offen: ' + zeile); continue; }
    try {
      const user = await auth.getUser(a.uid);
      const stud = await db.collection('students').doc(a.uid).get();
      // nur Schüler:innen-Konten zurücksetzen, nie Lehrpersonen/Schulleitung
      if (!stud.exists || stud.data().role !== 'student') throw new Error('kein Schüler:innen-Konto');
      const pw = neuesPasswort();
      await auth.updateUser(user.uid, { password: pw });
      await d.ref.update({ status: 'erledigt', neuesPasswort: pw, erledigtAm: admin.firestore.FieldValue.serverTimestamp() });
      // In GitHub Actions nie ausgeben: die Logs eines öffentlichen Repos sind für alle lesbar.
      console.log('✓ ' + zeile + (process.env.GITHUB_ACTIONS ? '' : ' → ' + pw));
    } catch (e) {
      await d.ref.update({ status: 'fehler', fehler: String(e.message || e).slice(0, 200) });
      console.log('✗ ' + zeile + ': ' + (e.message || e));
    }
  }
  if (!ja) console.log('Nur angezeigt. Zum Zurücksetzen: node passwort-reset.js --ja');
}
main().catch((e) => { console.error(e); process.exit(1); });
