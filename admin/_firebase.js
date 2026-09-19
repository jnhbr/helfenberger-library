/**
 * Gemeinsamer Start für die Admin-Skripte: Firebase Admin mit dem
 * Service-Account-Schlüssel — in GitHub Actions aus dem Secret
 * FIREBASE_SERVICE_ACCOUNT_KEY, lokal aus GOOGLE_APPLICATION_CREDENTIALS bzw.
 * admin/serviceAccountKey.json (liegt nie im Repo).
 */
const admin = require('firebase-admin');
const path = require('path');

function starten() {
  if (!admin.apps.length) {
    let cert;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) cert = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    else cert = require(process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'serviceAccountKey.json'));
    admin.initializeApp({ credential: admin.credential.cert(cert) });
    admin.firestore().settings({ preferRest: true });   // gRPC blieb auf Jans Mac hängen
  }
  return { admin, db: admin.firestore(), auth: admin.auth() };
}

// Firestore-Werte <-> JSON (Zeitstempel, Bytes, Referenzen bleiben erkennbar).
function zuJson(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof admin.firestore.Timestamp) return { __ts: v.toDate().toISOString() };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { __bytes: Buffer.from(v).toString('base64') };
  if (v instanceof admin.firestore.DocumentReference) return { __ref: v.path };
  if (v instanceof admin.firestore.GeoPoint) return { __geo: [v.latitude, v.longitude] };
  if (Array.isArray(v)) return v.map(zuJson);
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = zuJson(v[k]); return o; }
  return v;
}
function ausJson(v, db) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map((x) => ausJson(x, db));
  if (typeof v === 'object') {
    if (v.__ts) return admin.firestore.Timestamp.fromDate(new Date(v.__ts));
    if (v.__bytes) return Buffer.from(v.__bytes, 'base64');
    if (v.__ref) return db.doc(v.__ref);
    if (v.__geo) return new admin.firestore.GeoPoint(v.__geo[0], v.__geo[1]);
    const o = {}; for (const k of Object.keys(v)) o[k] = ausJson(v[k], db); return o;
  }
  return v;
}

module.exports = { starten, zuJson, ausJson };
