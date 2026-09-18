/**
 * Helfenberger's Library — Konto der Schulleitung anlegen/aktualisieren
 *
 *   node schulleitung-konto.js <passwort>
 *
 * Login in der App: "Schulleitung" + Passwort. Das Konto bekommt den Custom
 * Claim `leitung: true` (plus `klasse`, damit es wie alle Konten eine
 * Startklasse hat) und students/{uid}.role = 'leitung'. Die firestore.rules
 * geben damit Leserechte auf alle Klassen, aber keine Schreibrechte; die App
 * (index.html, isLeitung()) zeigt wahlweise die Lehrer- oder die
 * Schüleransicht und verwirft jede Änderung.
 *
 * Braucht firebase-admin und den Service-Account-Schlüssel
 * (./serviceAccountKey.json oder GOOGLE_APPLICATION_CREDENTIALS). Das Passwort
 * nur als Argument übergeben, nie ins Repo schreiben.
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const EMAIL_DOMAIN = 'helfenberger-library.app';   // wie in index.html
const USERNAME = 'schulleitung';
const STARTKLASSE = 'G3b';

const passwort = process.argv[2];
if (!passwort || passwort.length < 6) {
  console.error('Aufruf: node schulleitung-konto.js <passwort>  (mind. 6 Zeichen)');
  process.exit(1);
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) });
const auth = admin.auth();
const db = admin.firestore();

(async function () {
  const email = USERNAME + '@' + EMAIL_DOMAIN;
  let user;
  try {
    user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, { password: passwort, displayName: 'Schulleitung' });
    console.log('aktualisiert ' + email);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    user = await auth.createUser({ email: email, password: passwort, displayName: 'Schulleitung' });
    console.log('neu          ' + email);
  }
  await auth.setCustomUserClaims(user.uid, { leitung: true, klasse: STARTKLASSE });
  await db.collection('students').doc(user.uid).set({
    username: USERNAME, displayName: 'Schulleitung', role: 'leitung', klasse: STARTKLASSE
  }, { merge: true });
  console.log('fertig: Login "Schulleitung", nur Ansicht, alle Klassen.');
  process.exit(0);
})().catch(function (err) { console.error(err); process.exit(1); });
