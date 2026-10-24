#!/usr/bin/env node
/**
 * Helfenberger's Library — Ordner im Fach anlegen (oberste Ebene), wie in der App «Neuer Ordner».
 *
 *   node admin/ordner-anlegen.js --klasse G3b --fach sport --namen "Eins|Zwei|Drei"          (Vorschau)
 *   node admin/ordner-anlegen.js --klasse G3b --fach sport --namen "Eins|Zwei|Drei" --ja
 *
 * Vorhandene Ordner (gleicher Name, gleiche Ebene) werden übersprungen; die Reihenfolge
 * (order) folgt der Angabe. Schreibt nur mit --ja.
 */
const { starten } = require('./_firebase');
function arg(n){ const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; }
const JA = process.argv.includes('--ja');
(async function(){
  const klasse = arg('klasse'), fach = arg('fach'), namen = (arg('namen') || '').split('|').map(s => s.trim()).filter(Boolean);
  if(!klasse || !fach || !namen.length){ console.log('Aufruf: --klasse G3b --fach sport --namen "A|B|C" [--ja]'); process.exit(1); }
  const { admin, db, auth } = starten();
  const TS = admin.firestore.FieldValue.serverTimestamp();
  const kref = db.collection('klassen').doc(klasse);
  let uid = 'admin';
  try{ uid = (await auth.getUserByEmail('helfenberger@helfenberger-library.app')).uid; }catch(e){}
  const vorh = (await kref.collection('folders').where('subject', '==', fach).get()).docs.map(d => Object.assign({ id:d.id }, d.data()));
  console.log('Klasse ' + klasse + ' · Fach ' + fach + ' · vorhandene Ordner: ' + (vorh.map(f => f.name + (f.parentId ? ' (unter ' + f.parentId + ')' : '')).join(', ') || 'keine'));
  const batch = db.batch(); let n = 0;
  namen.forEach((name, i) => {
    if(vorh.some(f => !f.parentId && String(f.name).trim().toLowerCase() === name.toLowerCase())){ console.log('  ↷ schon da  ' + name); return; }
    const id = fach + '_f_' + Date.now() + Math.random().toString(36).slice(2, 5);
    console.log('  ＋ neu      ' + name);
    batch.set(kref.collection('folders').doc(id), { subject:fach, parentId:null, name:name.slice(0, 60), order:vorh.filter(f => !f.parentId).length + i, createdAt:TS, createdBy:uid });
    n++;
  });
  if(!JA){ console.log('\nNur Vorschau – mit --ja anlegen.'); return; }
  if(n) await batch.commit();
  console.log('\n' + n + ' Ordner angelegt.');
})().catch(e => { console.error(e.message); process.exit(1); });
