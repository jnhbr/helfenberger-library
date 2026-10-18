/**
 * ⏰ Einheitliche Lektionszeiten (Untis-Zeiten der Sek Altnau) in allen gespeicherten Stundenplänen:
 *   klassen/{k}/klasseninfo/stundenplan  und  progress/{uid}/einstellungen/stundenplan
 * Ändert nur das Feld `zeiten`, die Lektionen (zellen) bleiben.
 *
 *   node admin/stundenplan-zeiten.js          nur zeigen
 *   node admin/stundenplan-zeiten.js --ja     schreiben
 */
const { starten } = require('./_firebase.js');
const JA = process.argv.includes('--ja');
const ZEITEN = [
  { von: '07:30', bis: '08:15' }, { von: '08:20', bis: '09:05' }, { von: '09:10', bis: '09:55' },
  { von: '10:15', bis: '11:00' }, { von: '11:05', bis: '11:50' },
  { von: '13:30', bis: '14:15' }, { von: '14:20', bis: '15:05' }, { von: '15:20', bis: '16:05' }, { von: '16:10', bis: '16:55' }
];
const text = (z) => (z || []).map((x) => x.von + '-' + x.bis).join(',');

(async function () {
  const { admin, db } = starten();
  const ts = admin.firestore.FieldValue.serverTimestamp();
  const refs = [];
  const kl = await db.collection('klassen').listDocuments();
  for (const k of kl) refs.push({ name: 'Klasse ' + k.id, ref: k.collection('klasseninfo').doc('stundenplan') });
  const st = await db.collection('students').get();
  st.forEach((d) => refs.push({ name: (d.data().username || d.id) + ' (' + (d.data().role || '?') + ')', ref: db.doc(`progress/${d.id}/einstellungen/stundenplan`) }));
  const snaps = await db.getAll(...refs.map((r) => r.ref));
  const soll = text(ZEITEN), arten = {};
  let n = 0, ohne = 0;
  const batch = [];
  snaps.forEach((s, i) => {
    if (!s.exists || !s.data().zeiten) { if (s.exists) ohne++; return; }
    const ist = text(s.data().zeiten);
    if (ist === soll) return;
    n++;
    arten[ist] = (arten[ist] || 0) + 1;
    const hoch = Object.keys(s.data().zellen || {}).map((k) => k.split('-')[1]).filter((x) => /^\d+$/.test(x)).map(Number);
    if (s.data().zeiten.length !== ZEITEN.length || Math.max(-1, ...hoch) >= ZEITEN.length) console.log('⚠️ andere Anzahl Lektionen:', refs[i].name, s.data().zeiten.length);
    if (process.argv.includes('--liste')) console.log('  ', refs[i].name);
    batch.push(refs[i].ref);
  });
  console.log(`${snaps.filter((s) => s.exists).length} Pläne gespeichert, ${n} mit anderen Zeiten, ${ohne} ohne eigene Zeiten (nehmen den Standard).`);
  for (const [z, c] of Object.entries(arten)) console.log(`  ${c}× ${z}`);
  if (!JA) return;
  for (let i = 0; i < batch.length; i += 400) {
    const b = db.batch();
    batch.slice(i, i + 400).forEach((r) => b.update(r, { zeiten: ZEITEN, updatedAt: ts }));
    await b.commit();
  }
  console.log(`✅ ${batch.length} Pläne auf die einheitlichen Zeiten gesetzt.`);
})().catch((e) => { console.error('❌', e.message || e); process.exit(1); });
