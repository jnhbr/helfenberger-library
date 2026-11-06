#!/usr/bin/env node
/**
 * Helfenberger's Library — «📌 Individuelle Übungen» per Skript zuweisen (wie die Sammelzuweisung in der Kachel
 * «Individuelle Übungen» im Klassenzimmer): Jede .html «Vorname – Titel.html» wird hochgeladen und genau dieser Person zugewiesen.
 *
 *   cd ~/Desktop/Claude/Projekte/helfenberger-library-firebase
 *   node admin/indiv-import.js --klasse G3b --fach deutsch --pfad "<Ordner mit .html>"          (Vorschau)
 *   node admin/indiv-import.js --klasse G3b --fach deutsch --pfad "<Ordner mit .html>" --ja
 *
 * Person = erster Vorname der Datei (ohne «(G3a)»-Zusatz), verglichen mit dem Vornamen in students/{uid}.displayName der Klasse.
 * Gibt es für Person + Titel + Fach schon eine Zuweisung, wird sie übersprungen (nichts doppelt). Schreibt nur mit --ja.
 */
const fs = require('fs');
const path = require('path');
const { starten } = require('./_firebase');
const MAX_CHUNK_BYTES = 900 * 1024, MAX_RESOURCE_BYTES = 8 * 1024 * 1024;
function arg(n){ const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; }
const JA = process.argv.includes('--ja');
const norm = s => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/[^a-z0-9]+/g, ' ').trim();
function chunks(str, maxBytes){
  const out = []; let start = 0;
  while(start < str.length){
    if(Buffer.byteLength(str.slice(start), 'utf8') <= maxBytes){ out.push(str.slice(start)); break; }
    let lo = start + 1, hi = str.length;
    while(lo < hi){ const mid = Math.ceil((lo + hi) / 2); if(Buffer.byteLength(str.slice(start, mid), 'utf8') <= maxBytes) lo = mid; else hi = mid - 1; }
    let end = lo; const c = str.charCodeAt(end - 1);
    if(end < str.length && c >= 0xD800 && c <= 0xDBFF) end--;
    out.push(str.slice(start, end)); start = end;
  }
  return out;
}
(async function(){
  const klasse = arg('klasse'), fach = arg('fach'), pfad = arg('pfad');
  if(!klasse || !fach || !pfad){ console.log('Aufruf: --klasse G3b --fach deutsch --pfad <Ordner mit .html> [--ja]'); process.exit(1); }
  const p = path.resolve(pfad.replace(/^~/, process.env.HOME));
  const dateien = fs.readdirSync(p).filter(f => /\.html?$/i.test(f)).sort();
  const { admin, db, auth } = starten();
  const TS = admin.firestore.FieldValue.serverTimestamp();
  const kref = db.collection('klassen').doc(klasse);
  let jan = { uid: 'admin' };
  try{ jan = { uid: (await auth.getUserByEmail('helfenberger@helfenberger-library.app')).uid }; }catch(e){}
  const stu = (await db.collection('students').where('klasse', '==', klasse).get()).docs.map(d => Object.assign({ uid: d.id }, d.data())).filter(s => s.role === 'student' && String(s.username || '').toLowerCase() !== 'schueler');
  const vorh = (await kref.collection('resources').where('subject', '==', fach).get()).docs.map(d => d.data()).filter(r => r.indiv && r.indiv.uid);
  console.log('Klasse ' + klasse + ' · Fach ' + fach + ' · ' + stu.length + ' Schüler:innen\n');
  const plan = [];
  for(const f of dateien){
    const stamm = f.replace(/\.html?$/i, ''), teile = stamm.split(/\s+[–-]\s+/), vor = norm(teile[0]).split(' ')[0];
    const titel = (teile.length > 1 ? teile.slice(1).join(' – ') : stamm).slice(0, 120);
    let tr = stu.filter(s => norm(s.displayName || s.username).split(' ')[0] === vor);
    if(tr.length > 1){ const g = tr.filter(s => norm(s.displayName || s.username) === norm(teile[0])); if(g.length === 1) tr = g; }
    if(tr.length !== 1){ console.log('  ⚠️  ' + f + ' → ' + (tr.length ? 'mehrere Treffer' : 'keine Person gefunden') + ' (übersprungen)'); continue; }
    const person = tr[0], schon = vorh.find(r => r.indiv.uid === person.uid && r.title === titel);
    const html = fs.readFileSync(path.join(p, f), 'utf8'), bytes = Buffer.byteLength(html, 'utf8');
    if(bytes > MAX_RESOURCE_BYTES) throw new Error(f + ': zu gross');
    console.log('  ' + (schon ? '= schon zugewiesen ' : '＋ ') + (person.displayName || person.username) + ' ← ' + f + ' (' + Math.round(bytes / 1024) + ' KB)');
    if(!schon) plan.push({ f, titel, person, html, bytes });
  }
  if(!JA){ console.log('\nNur Vorschau – zum Ablegen denselben Befehl mit --ja.'); return; }
  let i = 0;
  for(const x of plan){
    const id = fach + '_iu_' + Date.now() + '_' + (i++), teile = chunks(x.html, MAX_CHUNK_BYTES), batch = db.batch();
    batch.set(db.collection('resourceContent').doc(id), { chunkCount: teile.length, bytes: x.bytes, ownerUid: jan.uid });
    teile.forEach((t, k) => batch.set(db.collection('resourceContent').doc(id).collection('chunks').doc(String(k)), { html: t }));
    batch.set(kref.collection('resources').doc(id), { subject: fach, folderId: null, title: x.titel, fileName: x.f, uploadedAt: TS, uploadedBy: jan.uid, contentId: id, version: 0,
      nurFuer: [x.person.uid], indiv: { uid: x.person.uid, name: x.person.displayName || x.person.username, am: new Date().toISOString(), von: '' } });
    await batch.commit();
    await db.collection('uebungsIndex').doc(id).set({ klassen: admin.firestore.FieldValue.arrayUnion(klasse) }, { merge: true });
    console.log('  ✓ ' + (x.person.displayName || x.person.username));
  }
  console.log('✅ ' + plan.length + ' Übung(en) zugewiesen.');
})().catch(err => { console.error('❌ ' + (err && err.message || err)); process.exit(1); });
