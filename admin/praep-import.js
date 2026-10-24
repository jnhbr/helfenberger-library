#!/usr/bin/env node
/**
 * Helfenberger's Library — Vorlage-Präps (fertige .html, nur für Lehrpersonen) in die Sport-Ordner legen,
 * wie «Lehrer-HTML hinzufügen» in der App.
 *
 *   node admin/praep-import.js --klasse G3b --fach sport --in "4 Spielen" --pfad <Ordner mit Sportart_nDL.html>          (Vorschau)
 *   node admin/praep-import.js --klasse G3b --fach sport --in "4 Spielen" --pfad <Ordner> --ja
 *
 * Dateiname «Basketball_5DL.html» → Unterordner «Basketball» im Ordner --in, Titel aus <title>.
 * Gleicher Titel im Zielordner wird ersetzt (neuer Inhalt, alte Fassung wiederherstellbar). Schreibt nur mit --ja.
 */
const fs = require('fs');
const path = require('path');
const { starten } = require('./_firebase');
const MAX_CHUNK_BYTES = 900 * 1024, MAX_RESOURCE_BYTES = 8 * 1024 * 1024, JAN_EMAIL = 'helfenberger@helfenberger-library.app';
function arg(n){ const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; }
const JA = process.argv.includes('--ja');
function chunks(str, maxBytes){
  const out = []; let start = 0;
  while(start < str.length){
    let lo = start + 1, hi = str.length;
    if(Buffer.byteLength(str.slice(start), 'utf8') <= maxBytes){ out.push(str.slice(start)); break; }
    while(lo < hi){ const mid = Math.ceil((lo + hi) / 2); if(Buffer.byteLength(str.slice(start, mid), 'utf8') <= maxBytes) lo = mid; else hi = mid - 1; }
    let end = lo; const c = str.charCodeAt(end - 1);
    if(end < str.length && c >= 0xD800 && c <= 0xDBFF) end--;
    if(end <= start) end = start + 1;
    out.push(str.slice(start, end)); start = end;
  }
  return out;
}
(async function(){
  const klasse = arg('klasse'), fach = arg('fach'), pfad = arg('pfad'), inName = arg('in');
  if(!klasse || !fach || !pfad || !inName){ console.log('Aufruf: --klasse G3b --fach sport --in "4 Spielen" --pfad <Ordner> [--ja]'); process.exit(1); }
  const dateien = fs.readdirSync(pfad).filter(f => /^[A-Za-zÄÖÜäöü]+_\d+DL\.html$/.test(f)).sort((a, b) => {
    const [sa, na] = a.split('_'), [sb, nb] = b.split('_'); return sa === sb ? parseInt(nb) - parseInt(na) : 0; });
  if(!dateien.length) throw new Error('Keine passenden .html in ' + pfad);
  const { admin, db, auth } = starten();
  const TS = admin.firestore.FieldValue.serverTimestamp();
  const kref = db.collection('klassen').doc(klasse);
  let jan = { uid:'admin' };
  try{ const u = await auth.getUserByEmail(JAN_EMAIL); jan = { uid:u.uid }; }catch(e){}
  const ordner = (await kref.collection('folders').where('subject', '==', fach).get()).docs.map(d => Object.assign({ id:d.id }, d.data()));
  const finde = (name, parent) => ordner.find(f => String(f.name).trim().toLowerCase() === name.toLowerCase() && (f.parentId || null) === (parent || null));
  const eltern = finde(inName, null); if(!eltern) throw new Error('Ordner «' + inName + '» fehlt im Fach ' + fach);
  const neu = [];
  const unter = n => { let f = finde(n, eltern.id); if(!f){ f = { id: fach + '_f_' + Date.now() + Math.random().toString(36).slice(2, 5), subject:fach, parentId:eltern.id, name:n, order:ordner.filter(x => x.parentId === eltern.id).length }; ordner.push(f); neu.push(f); } return f; };
  const rs = (await kref.collection('resources').where('subject', '==', fach).get()).docs.map(d => Object.assign({ id:d.id }, d.data()));
  const plan = [];
  for(const f of dateien){
    const html = fs.readFileSync(path.join(pfad, f), 'utf8');
    const bytes = Buffer.byteLength(html, 'utf8'); if(bytes > MAX_RESOURCE_BYTES) throw new Error(f + ' zu gross');
    const titel = (/<title>([^<]+)<\/title>/.exec(html) || [0, f])[1];
    const sp = arg('unter') || f.split('_')[0], ziel = unter(sp);
    const alt = rs.find(r => r.folderId === ziel.id && String(r.title).trim() === titel);
    plan.push({ f, html, bytes, titel, ziel, alt });
    console.log('  ' + (alt ? '↻ ersetzt ' : '＋ neu     ') + sp + ' › ' + titel + '  (' + Math.round(bytes / 1024) + ' KB)');
  }
  if(!JA){ console.log('\nNur Vorschau – mit --ja ablegen.'); return; }
  for(const f of neu) await kref.collection('folders').doc(f.id).set({ subject:f.subject, parentId:f.parentId, name:f.name, order:f.order, createdAt:TS, createdBy:jan.uid });
  const ids = []; let k = rs.length;
  for(const p of plan){
    const teile = chunks(p.html, MAX_CHUNK_BYTES), stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 4), b = db.batch();
    if(p.alt){
      const nid = p.alt.id + '_' + stamp, cid = p.alt.contentId || p.alt.id;
      b.set(db.collection('resourceContent').doc(nid), { chunkCount:teile.length, bytes:p.bytes, ownerUid:jan.uid, nurLehrer:true });
      teile.forEach((t, i) => b.set(db.collection('resourceContent').doc(nid).collection('chunks').doc(String(i)), { html:t, nurLehrer:true }));
      b.set(kref.collection('resources').doc(p.alt.id), { contentId:nid, prevContentId:cid, replacedAt:TS, fileName:p.f, nurLehrer:true }, { merge:true });
    } else {
      const id = fach + '_' + Date.now() + '_' + (k++);
      b.set(db.collection('resourceContent').doc(id), { chunkCount:teile.length, bytes:p.bytes, ownerUid:jan.uid, nurLehrer:true });
      teile.forEach((t, i) => b.set(db.collection('resourceContent').doc(id).collection('chunks').doc(String(i)), { html:t, nurLehrer:true }));
      b.set(kref.collection('resources').doc(id), { subject:fach, folderId:p.ziel.id, title:p.titel, fileName:p.f, uploadedAt:TS, uploadedBy:jan.uid, contentId:id, version:0, nurLehrer:true, order:k });
      ids.push(id);
    }
    await b.commit(); console.log('  ✓ ' + p.titel);
  }
  for(const id of ids) await db.collection('uebungsIndex').doc(id).set({ klassen: admin.firestore.FieldValue.arrayUnion(klasse) }, { merge:true });
  console.log('✅ ' + plan.length + ' Vorlage-Präps abgelegt.');
})().catch(e => { console.error('❌ ' + (e && e.message || e)); process.exit(1); });
