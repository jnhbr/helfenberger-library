#!/usr/bin/env node
/**
 * Helfenberger's Library — Methodenmaterial (Schilder, Rollenkarten, Raster, Karten …) als einzelne
 * 🧰 Lehrer-PDFs ins Fach legen. Erscheint im Fach-Ordner unter «Zusatzmaterial › Methodenmaterial», mit Lektion
 * und Menge pro Schüler:in/Paar/Gruppe. Immer 🔒 nur für Lehrpersonen.
 *
 * Eingabe: ein Ordner mit den Einzel-PDFs und einer methode.json (macht unterrichtseinheit/scripts/methode_zerlegen.py):
 *   [{ "datei": "01_Bildkarten.pdf", "titel": "Bildkarten «Wer bestimmt das?»", "lektion": "Do 22.10.",
 *      "menge": "1 Satz pro Gruppe (4 Gruppen)", "sort": 1 }, …]
 *
 *   cd ~/Desktop/Claude/Projekte/helfenberger-library-firebase
 *   node admin/methode-import.js --klasse G3b --fach geografie --ordner "Schweizer Politik" --pfad <Ordner>     (Vorschau)
 *   node admin/methode-import.js --klasse G3b --fach geografie --ordner "Schweizer Politik" --pfad <Ordner> --ja
 *
 * --ordner / --in  wie bei folien-import.js (Zielordner im Fach, wird bei Bedarf angelegt).
 * Vorhandenes (gleicher Titel im Zielordner) wird ersetzt: neuer Inhalt, gleiche ID. Schreibt nur mit --ja.
 */
const fs = require('fs');
const path = require('path');
const { starten } = require('./_firebase');

const MAX_CHUNK_BYTES = 900 * 1024;          // wie index.html
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const JAN_EMAIL = 'helfenberger@helfenberger-library.app';
function arg(name){ const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; }
const JA = process.argv.includes('--ja');

(async function(){
  const klasse = arg('klasse'), fach = arg('fach'), pfad = arg('pfad'), ordnerName = arg('ordner');
  if(!klasse || !fach || !pfad){ console.log('Aufruf: --klasse G3b --fach geografie [--ordner "Name"] [--in "Übergeordneter Ordner"] --pfad <Ordner mit methode.json> [--ja]'); process.exit(1); }
  const dir = path.resolve(pfad.replace(/^~/, process.env.HOME));
  const liste = JSON.parse(fs.readFileSync(path.join(dir, 'methode.json'), 'utf8'));
  if(!liste.length) throw new Error('methode.json ist leer.');

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
  for(const m of liste){
    const bytes = fs.readFileSync(path.join(dir, m.datei));
    if(bytes.length > MAX_PDF_BYTES) throw new Error(m.datei + ': ' + Math.round(bytes.length / 1024) + ' KB – zu gross (max. 4 MB).');
    const titel = '🧰 ' + [m.lektion, m.titel].filter(Boolean).join(' · ');
    const alt = vorhanden.find(r => r.methode && String(r.title).trim().toLowerCase() === titel.toLowerCase());
    plan.push({ m, titel, bytes, alt });
    console.log('  ' + (alt ? '↻ ersetzt  ' : '＋ neu      ') + titel + '  (' + (m.menge || 'keine Mengenangabe') + ', ' + Math.round(bytes.length / 1024) + ' KB)');
  }
  if(!JA){ console.log('\nNur Vorschau – zum Ablegen denselben Befehl mit --ja.'); return; }

  if(neuerOrdner) await kref.collection('folders').doc(neuerOrdner.id).set({ subject:neuerOrdner.subject, parentId:neuerOrdner.parentId, name:neuerOrdner.name, order:neuerOrdner.order, createdAt:TS, createdBy:jan.uid });
  const neueIds = [];
  let reihe = vorhanden.length;
  for(const p of plan){
    const teile = [];
    for(let i = 0; i < p.bytes.length; i += MAX_CHUNK_BYTES) teile.push(p.bytes.subarray(i, i + MAX_CHUNK_BYTES));
    if(!teile.length) teile.push(Buffer.alloc(0));
    const methode = { lektion:p.m.lektion || '', menge:p.m.menge || '', sort:p.m.sort || 0 };
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
    const batch = db.batch();
    const schreibeInhalt = (cid) => {
      batch.set(db.collection('resourceContent').doc(cid), { chunkCount:teile.length, bytes:p.bytes.length, ownerUid:jan.uid, nurLehrer:true });
      teile.forEach((t, i) => batch.set(db.collection('resourceContent').doc(cid).collection('chunks').doc(String(i)), { bin:t, nurLehrer:true }));
    };
    if(p.alt){
      const neu = p.alt.id + '_' + stamp, cid = p.alt.contentId || p.alt.id;
      schreibeInhalt(neu);
      batch.set(kref.collection('resources').doc(p.alt.id), { contentId:neu, prevContentId:cid, replacedAt:TS, fileName:p.m.datei, pdf:true, methode, nurLehrer:true }, { merge:true });
    } else {
      const id = fach + '_' + Date.now() + '_' + (reihe++);
      schreibeInhalt(id);
      batch.set(kref.collection('resources').doc(id), { subject:fach, folderId:zielId, title:p.titel, fileName:p.m.datei, uploadedAt:TS, uploadedBy:jan.uid, contentId:id, version:0, pdf:true, methode, nurLehrer:true });
      neueIds.push(id);
    }
    await batch.commit();
    console.log('  ✓ ' + p.titel);
  }
  for(const id of neueIds) await db.collection('uebungsIndex').doc(id).set({ klassen: admin.firestore.FieldValue.arrayUnion(klasse) }, { merge:true });
  console.log('✅ ' + plan.length + ' Stück(e) abgelegt – in der Library neu laden. Die nächtliche Spiegelung gibt sie an die anderen Lehrpersonen weiter.');
})().catch(err => { console.error('❌ ' + (err && err.message || err)); process.exit(1); });
