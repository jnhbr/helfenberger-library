#!/usr/bin/env node
/**
 * Helfenberger's Library — Übung (oder Lehrer-HTML) aus dem Terminal ersetzen,
 * genau wie «Datei ersetzen» in der App: neuer Inhalt unter resourceContent/<id>_<zeit>
 * (gechunkt wie in der App), alle Kopien mit demselben Inhalt in anderen Klassen
 * werden mit umgehängt, die bisherige Fassung bleibt als prevContentId
 * («Vorherige Version wiederherstellen»). Titel, Ort und Übungsstände bleiben.
 *
 *   cd ~/Desktop/Claude/Projekte/helfenberger-library-firebase
 *   node admin/uebung-ersetzen.js --klasse G3b --suche "Lesereise"                  (nur auflisten)
 *   node admin/uebung-ersetzen.js --klasse G3b --id <übungs-id> --datei neu.html     (Vorschau)
 *   node admin/uebung-ersetzen.js --klasse G3b --id <übungs-id> --datei neu.html --ja
 *
 * --suche findet Übungen, deren Titel oder Dateiname den Text enthält (Gross/klein egal).
 * Schreibt nur mit --ja. Braucht admin/serviceAccountKey.json (siehe _firebase.js).
 */
const fs = require('fs');
const path = require('path');
const { starten } = require('./_firebase');

const MAX_CHUNK_BYTES = 900 * 1024;          // wie index.html
const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;

function arg(name){ const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; }
const JA = process.argv.includes('--ja');

// UTF-8-sicher in Stücke ≤ maxBytes teilen (wie chunkStringByBytes in index.html, nur mit Buffer).
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

(async function(){
  const klasse = arg('klasse'), suche = arg('suche'), id = arg('id'), datei = arg('datei');
  if(!klasse || (!suche && !id)){ console.log('Aufruf: --klasse G3b --suche "Text"  oder  --klasse G3b --id <id> --datei neu.html [--ja]'); process.exit(1); }
  const { admin, db } = starten();
  const kref = db.collection('klassen').doc(klasse);

  if(suche && !id){
    const snap = await kref.collection('resources').get();
    const s = suche.toLowerCase();
    const treffer = snap.docs.filter(d => ((d.data().title || '') + ' ' + (d.data().fileName || '')).toLowerCase().includes(s));
    if(!treffer.length){ console.log('Keine Übung in ' + klasse + ' enthält «' + suche + '».'); return; }
    treffer.forEach(d => { const x = d.data(); console.log(d.id + '\t' + (x.subject || '') + '\t' + (x.nurLehrer ? '🔒 ' : '') + (x.title || x.fileName) + '\t(' + (x.fileName || '') + ')'); });
    return;
  }

  if(!datei){ console.log('Bitte --datei angeben.'); process.exit(1); }
  const html = fs.readFileSync(path.resolve(datei.replace(/^~/, process.env.HOME)), 'utf8');
  const bytes = Buffer.byteLength(html, 'utf8');
  if(bytes > MAX_RESOURCE_BYTES) throw new Error('Datei zu gross (max. 8 MB).');
  if(!/^\s*<!doctype html/i.test(html)) console.log('⚠️  Die Datei beginnt nicht mit <!doctype html> – trotzdem weiter.');

  const eigen = await kref.collection('resources').doc(id).get();
  if(!eigen.exists) throw new Error('Übung ' + id + ' gibt es in ' + klasse + ' nicht.');
  const r = eigen.data();
  if(r.pdf || r.externalUrl) throw new Error('Das ist ein PDF/Link – dieses Skript ersetzt nur HTML-Übungen.');
  const cid = r.contentId || id;

  // Alle Klassen, in denen die Übung liegt (uebungsIndex, sonst alle Klassen durchsuchen)
  const idx = await db.collection('uebungsIndex').doc(id).get();
  let klassen = idx.exists && Array.isArray(idx.data().klassen) ? idx.data().klassen.slice() : (await db.collection('klassen').listDocuments()).map(d => d.id);
  if(!klassen.includes(klasse)) klassen.push(klasse);
  const alle = [];
  for(const k of klassen){
    const s = await db.collection('klassen').doc(k).collection('resources').doc(id).get();
    if(s.exists) alle.push({ klasse:k, ref:s.ref, data:s.data() });
  }
  const sync = alle.filter(e => (e.data.contentId || id) === cid);
  const origin = alle.find(e => !e.data.originKlasse) || null;
  const originIn = origin && sync.some(e => e.klasse === origin.klasse);
  const version = origin ? (origin.data.version || 0) + (originIn ? 1 : 0) : 0;

  const teile = chunks(html, MAX_CHUNK_BYTES);
  const alt = await db.collection('resourceContent').doc(cid).get();
  const ownerUid = alt.exists ? alt.data().ownerUid : null;
  const neu = id + '_' + Date.now().toString(36);

  console.log('Übung:     ' + (r.title || r.fileName) + '  (' + id + ')');
  console.log('Datei:     ' + path.basename(datei) + ' · ' + Math.round(bytes / 1024) + ' KB · ' + teile.length + ' Stück(e)');
  console.log('Klassen:   ' + sync.map(e => e.klasse).join(', ') + (alle.length > sync.length ? '   (nicht mitgezogen, andere Fassung: ' + alle.filter(e => !sync.includes(e)).map(e => e.klasse).join(', ') + ')' : ''));
  console.log('Inhalt:    ' + cid + ' → ' + neu + ' (bisherige Fassung bleibt wiederherstellbar)');
  if(!JA){ console.log('\nNur Vorschau – zum Ersetzen denselben Befehl mit --ja.'); return; }

  const batch = db.batch();
  const cref = db.collection('resourceContent').doc(neu);
  // 🔒 Lehrer-HTML (alle Kopien nurLehrer): Inhalt nur für Lehrpersonen lesbar, siehe index.html inhaltSchutzSetzen
  const schutz = sync.length > 0 && sync.every(e => e.data.nurLehrer === true) ? { nurLehrer:true } : {};
  batch.set(cref, Object.assign({ chunkCount:teile.length, bytes:bytes }, ownerUid ? { ownerUid } : {}, schutz));
  teile.forEach((t, i) => batch.set(cref.collection('chunks').doc(String(i)), Object.assign({ html:t }, schutz)));
  sync.forEach(e => {
    const patch = { contentId:neu, prevContentId:cid, replacedAt:admin.firestore.FieldValue.serverTimestamp(), fileName:path.basename(datei) };
    if(!e.data.originKlasse) patch.version = version; else if(originIn) patch.originVersion = version;
    batch.set(e.ref, patch, { merge:true });
  });
  await batch.commit();
  console.log('✅ Ersetzt – in der Library neu laden.');
})().catch(err => { console.error('❌ ' + (err && err.message || err)); process.exit(1); });
