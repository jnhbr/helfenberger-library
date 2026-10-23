#!/usr/bin/env node
/**
 * Helfenberger's Library — PowerPoints (.pptx) als 🎞️ Folien ins Fach legen, wie «Datei auswählen» in der App
 * (dieselbe Umwandlung: ../folien.js). Die Folien sind normal anschaubar, Lehrpersonen haben zusätzlich
 * Notizen und die 🎤 Referentenansicht.
 *
 *   cd ~/Desktop/Claude/Projekte/helfenberger-library-firebase
 *   node admin/folien-import.js --klasse G3b --fach geografie --ordner "Schweizer Politik" --pfad "<Ordner mit .pptx>"     (Vorschau)
 *   node admin/folien-import.js --klasse G3b --fach geografie --ordner "Schweizer Politik" --pfad "<Ordner oder .pptx>" --ja
 *
 * --ordner  Zielordner im Fach (Name; wird auf der Hauptebene angelegt, wenn es ihn nicht gibt),
 *           --in "Übergeordneter Ordner" legt ihn darunter an/sucht ihn dort.
 * Folien sind immer 🔒 nur für Lehrpersonen (Inhalt geschützt) und erscheinen im Fach unter «PPP Folien».
 * Titel: «01_2026-10-22_Wer_bestimmt» → «Folien 01 · Wer bestimmt», «L02_Berlin_1970er» → «Folien L02 · Berlin 1970er» (--titel-roh lässt den Dateinamen).
 * Vorhandenes (gleicher Titel im Zielordner) wird ersetzt: neuer Inhalt, gleiche ID, alte Fassung wiederherstellbar.
 * Schreibt nur mit --ja.
 */
const fs = require('fs');
const path = require('path');
const { starten } = require('./_firebase');
const { pptxZuHtml } = require('../folien.js');

const MAX_CHUNK_BYTES = 900 * 1024;          // wie index.html
const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;
const JAN_EMAIL = 'helfenberger@helfenberger-library.app';
function arg(name){ const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; }
const JA = process.argv.includes('--ja');

function chunks(str, maxBytes){
  const out = [];
  let start = 0;
  while(start < str.length){
    let lo = start + 1, hi = str.length;
    if(Buffer.byteLength(str.slice(start), 'utf8') <= maxBytes){ out.push(str.slice(start)); break; }
    while(lo < hi){
      const mid = Math.ceil((lo + hi) / 2);
      if(Buffer.byteLength(str.slice(start, mid), 'utf8') <= maxBytes) lo = mid; else hi = mid - 1;
    }
    let end = lo;
    const c = str.charCodeAt(end - 1);
    if(end < str.length && c >= 0xD800 && c <= 0xDBFF) end--;
    if(end <= start) end = start + 1;
    out.push(str.slice(start, end));
    start = end;
  }
  return out;
}
function titelAus(datei){
  const t = path.basename(datei).replace(/\.pptx$/i, '');
  if(process.argv.includes('--titel-roh')) return t;
  const m = /^(L?\d{1,2})[_ -]+(?:\d{4}-\d{2}-\d{2}[_ -]+)?(.+)$/.exec(t);
  const rest = (m ? m[2] : t).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return m ? 'Folien ' + m[1] + ' · ' + rest : rest;
}

(async function(){
  const klasse = arg('klasse'), fach = arg('fach'), pfad = arg('pfad'), ordnerName = arg('ordner');
  if(!klasse || !fach || !pfad){ console.log('Aufruf: --klasse G3b --fach geografie [--ordner "Name"] [--in "Übergeordneter Ordner"] --pfad <Ordner oder .pptx> [--ja]'); process.exit(1); }
  const p = path.resolve(pfad.replace(/^~/, process.env.HOME));
  const dateien = fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).filter(f => /\.pptx$/i.test(f) && !f.startsWith('~$')).sort().map(f => path.join(p, f))
    : [p];
  if(!dateien.length) throw new Error('Keine .pptx gefunden.');

  const { admin, db, auth } = starten();
  const TS = admin.firestore.FieldValue.serverTimestamp();
  const kref = db.collection('klassen').doc(klasse);
  if(!(await kref.collection('resources').limit(1).get()).size) console.log('⚠️  In ' + klasse + ' gibt es keine Übungen – Klassenname richtig?');
  let jan = { uid:'admin' };
  try{ const u = await auth.getUserByEmail(JAN_EMAIL); jan = { uid:u.uid }; }catch(e){}

  const fsnap = await kref.collection('folders').where('subject', '==', fach).get();
  const ordner = fsnap.docs.map(d => Object.assign({ id:d.id }, d.data()));
  const finde = (name, parent) => ordner.find(f => String(f.name).trim().toLowerCase() === name.trim().toLowerCase() && (parent === undefined || (f.parentId || null) === (parent || null)));
  let parentId = null;
  if(arg('in')){ const q = finde(arg('in')); if(!q) throw new Error('Ordner «' + arg('in') + '» gibt es in ' + fach + ' nicht.'); parentId = q.id; }
  let ziel = ordnerName ? (finde(ordnerName, arg('in') ? parentId : undefined) || null) : null;
  let neuerOrdner = null;
  if(ordnerName && !ziel){
    neuerOrdner = { id: fach + '_f_' + Date.now() + Math.random().toString(36).slice(2, 5), subject:fach, parentId:parentId, name:ordnerName.slice(0, 60),
      order: ordner.filter(x => (x.parentId || null) === (parentId || null)).length };
    ziel = neuerOrdner;
  }
  const zielId = ziel ? ziel.id : null;
  const rsnap = await kref.collection('resources').where('subject', '==', fach).get();
  const vorhanden = rsnap.docs.map(d => Object.assign({ id:d.id }, d.data())).filter(r => (r.folderId || null) === (zielId || null));

  console.log('Klasse ' + klasse + ' · Fach ' + fach + ' · Ordner: ' + (ziel ? ziel.name + (neuerOrdner ? ' (wird neu angelegt)' : '') : '(Fach-Hauptebene)'));
  const plan = [];
  for(const d of dateien){
    const titel = titelAus(d);
    const res = await pptxZuHtml(new Uint8Array(fs.readFileSync(d)), { titel });
    const bytes = Buffer.byteLength(res.html, 'utf8');
    if(bytes > MAX_RESOURCE_BYTES) throw new Error(path.basename(d) + ': ' + Math.round(bytes / 1024 / 1024) + ' MB nach der Umwandlung – zu gross (max. 8 MB).');
    const alt = vorhanden.find(r => r.folien && String(r.title).trim().toLowerCase() === titel.toLowerCase());
    plan.push({ datei:d, titel, res, bytes, alt });
    console.log('  ' + (alt ? '↻ ersetzt  ' : '＋ neu      ') + '🎞️ ' + titel + '  (' + res.folien + ' Folien, ' + res.notizen + ' Notizen, ' + Math.round(bytes / 1024) + ' KB)');
  }
  if(!JA){ console.log('\nNur Vorschau – zum Ablegen denselben Befehl mit --ja.'); return; }

  // Pro Präsentation ein eigener Stapel (Firestore nimmt pro Schreibvorgang höchstens ~10 MB).
  if(neuerOrdner) await kref.collection('folders').doc(neuerOrdner.id).set({ subject:neuerOrdner.subject, parentId:neuerOrdner.parentId, name:neuerOrdner.name, order:neuerOrdner.order, createdAt:TS, createdBy:jan.uid });
  const neueIds = [];
  let reihe = vorhanden.length;
  for(const p of plan){
    const teile = chunks(p.res.html, MAX_CHUNK_BYTES);
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
    const batch = db.batch();
    if(p.alt){
      const neu = p.alt.id + '_' + stamp, cid = p.alt.contentId || p.alt.id;
      batch.set(db.collection('resourceContent').doc(neu), { chunkCount:teile.length, bytes:p.bytes, ownerUid:jan.uid, nurLehrer:true });
      teile.forEach((t, i) => batch.set(db.collection('resourceContent').doc(neu).collection('chunks').doc(String(i)), { html:t, nurLehrer:true }));
      batch.set(kref.collection('resources').doc(p.alt.id), { contentId:neu, prevContentId:cid, replacedAt:TS, fileName:path.basename(p.datei), folien:true, nurLehrer:true }, { merge:true });
    } else {
      const id = fach + '_' + Date.now() + '_' + (reihe++);
      batch.set(db.collection('resourceContent').doc(id), { chunkCount:teile.length, bytes:p.bytes, ownerUid:jan.uid, nurLehrer:true });
      teile.forEach((t, i) => batch.set(db.collection('resourceContent').doc(id).collection('chunks').doc(String(i)), { html:t, nurLehrer:true }));
      batch.set(kref.collection('resources').doc(id), { subject:fach, folderId:zielId, title:p.titel, fileName:path.basename(p.datei), uploadedAt:TS, uploadedBy:jan.uid, contentId:id, version:0, folien:true, nurLehrer:true });
      neueIds.push(id);
    }
    await batch.commit();
    console.log('  ✓ ' + p.titel);
  }
  // Index «wo liegt die Übung» (wie indexDazu in index.html)
  for(const id of neueIds) await db.collection('uebungsIndex').doc(id).set({ klassen: admin.firestore.FieldValue.arrayUnion(klasse) }, { merge:true });
  console.log('✅ ' + plan.length + ' Präsentation(en) abgelegt – in der Library neu laden. Die nächtliche Spiegelung gibt sie an die anderen Lehrpersonen weiter.');
})().catch(err => { console.error('❌ ' + (err && err.message || err)); process.exit(1); });
