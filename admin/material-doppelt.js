#!/usr/bin/env node
/**
 * Helfenberger's Library — doppeltes Zusatzmaterial aufräumen (Klassen-Quizze, Blitzumfragen,
 * Wortwolken, Karteikarten-Sets).
 *
 * «Doppelt» heisst: gleicher Typ, gleiches Fach, gleicher Titel UND gleicher Inhalt. Behalten
 * wird die Kopie, die in einem bestehenden Ordner liegt. Entfernt werden nur Kopien, die
 * «lose» sind – ohne Ordner oder mit einem Ordner, den es nicht mehr gibt (solche fallen in der
 * App auf die Fach-Hauptebene). Kopien in zwei verschiedenen bestehenden Ordnern bleiben beide.
 * Gibt es keine Kopie in einem Ordner, bleibt die erste lose stehen.
 *
 *   cd ~/Desktop/Claude/Projekte/helfenberger-library-firebase
 *   node admin/material-doppelt.js --klasse G3b            (nur anzeigen)
 *   node admin/material-doppelt.js --klasse G3b --ja       (entfernen)
 *
 * Vor dem Entfernen wird alles, was wegfällt, nach admin/sicherung-material-doppelt-<Klasse>-<Zeit>.json
 * geschrieben (Quiz-Dokumente, Vorlagen und Kartensets im Original).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { starten, zuJson } = require('./_firebase');

function arg(name){ const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; }
const JA = process.argv.includes('--ja');

function appFunktionen(){
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const fn = name => {
    const i = html.indexOf('function ' + name + '(');
    if(i < 0) throw new Error('index.html: function ' + name + ' fehlt');
    let d = 0;
    for(let k = html.indexOf('{', i); k < html.length; k++){
      if(html[k] === '{') d++;
      else if(html[k] === '}' && !--d) return html.slice(i, k + 1);
    }
  };
  const vari = name => { const m = new RegExp('var ' + name + ' = [\\s\\S]*?;\\n').exec(html); if(!m) throw new Error('index.html: var ' + name + ' fehlt'); return m[0]; };
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext([vari('LMVZ_SUBJECT'), fn('umfrageFragen'), fn('kzmInhaltSig'), fn('lmvzBuild'), fn('kzmLmvzAblage')].join('\n'), ctx);
  return ctx;
}

(async function(){
  const klasse = arg('klasse');
  if(!klasse){ console.log('Aufruf: --klasse G3b [--ja]'); process.exit(1); }
  const APP = appFunktionen();
  const { admin, db } = starten();
  const kref = db.collection('klassen').doc(klasse);
  const [fsnap, qsnap, kksnap, vsnap] = await Promise.all([kref.collection('folders').get(), kref.collection('quizzes').get(),
    kref.collection('klasseninfo').doc('karteikarten').get(), kref.collection('klassenzimmer').doc('vorlagen').get()]);

  // Bestehende Ordner: echte + Lehrmittel-Ordner in Mathematik
  const ordner = {};
  fsnap.forEach(d => { ordner[d.id] = d.data(); });
  try{
    const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'lmvz-mathe.json'), 'utf8'));
    APP.lmvzBuild(cat, true).folders.filter(APP.kzmLmvzAblage).forEach(f => { ordner[f.id] = { subject:APP.LMVZ_SUBJECT, name:f.name, parentId:f.parentId }; });
  }catch(e){ console.log('⚠️  Lehrmittel-Ordner nicht gelesen (' + e.message + ') – Mathematik-Material in Lehrmittel-Ordnern gälte als lose. Abbruch.'); process.exit(1); }
  const imOrdner = (fach, id) => !!(id && ordner[id] && ordner[id].subject === fach);
  const ortName = (fach, id) => { const t = []; let f = imOrdner(fach, id) ? ordner[id] : null, g = 0; while(f && g++ < 10){ t.unshift(f.name); f = ordner[f.parentId]; } return t.length ? t.join(' › ') : id ? '(Ordner gibt es nicht mehr → Fach-Hauptebene)' : '(Fach-Hauptebene)'; };

  const sets = kksnap.exists && Array.isArray(kksnap.data().sets) ? kksnap.data().sets : [];
  const vorl = vsnap.exists ? vsnap.data() : {};
  const wolken = Array.isArray(vorl.wolken) ? vorl.wolken : [], umfragen = Array.isArray(vorl.umfragen) ? vorl.umfragen : [];
  const sig = APP.kzmInhaltSig, norm = s => String(s || '').trim().toLowerCase();
  const alle = [];
  qsnap.forEach(d => { const x = d.data(); alle.push({ typ:'quiz', id:d.id, titel:x.title, fach:x.subject || '', ordner:x.folderId || null, sig:sig('quiz', x.questions), roh:x }); });
  sets.forEach(x => alle.push({ typ:'kk', id:x.id, titel:x.titel, fach:x.fach || '', ordner:x.ordner || null, sig:sig('kk', x.karten), roh:x }));
  wolken.forEach(x => alle.push({ typ:'wolke', id:x.id, titel:x.frage, fach:x.fach || '', ordner:x.ordner || null, sig:sig('wolke', x.frage), roh:x }));
  umfragen.forEach(x => alle.push({ typ:'umfrage', id:x.id, titel:x.titel || APP.umfrageFragen(x)[0].frage, fach:x.fach || '', ordner:x.ordner || null, sig:sig('umfrage', APP.umfrageFragen(x)), roh:x }));

  const gruppen = {};
  alle.forEach(it => { if(!it.fach) return; const k = [it.typ, it.fach, norm(it.titel), it.sig].join('\u0001'); (gruppen[k] = gruppen[k] || []).push(it); });
  const ICON = { quiz:'🎮', kk:'🗂️', wolke:'☁️', umfrage:'⚡' };
  const weg = [];
  Object.keys(gruppen).forEach(k => {
    const g = gruppen[k]; if(g.length < 2) return;
    const fest = g.filter(it => imOrdner(it.fach, it.ordner)), lose = g.filter(it => !imOrdner(it.fach, it.ordner));
    const bleibt = fest.length ? fest[0] : lose[0];
    const raus = lose.filter(it => it !== bleibt);
    if(!raus.length) return;
    console.log(ICON[g[0].typ] + ' ' + g[0].fach + ' · ' + g[0].titel);
    console.log('    bleibt:  ' + ortName(bleibt.fach, bleibt.ordner));
    raus.forEach(it => { console.log('    weg:     ' + ortName(it.fach, it.ordner)); weg.push(it); });
  });
  if(!weg.length){ console.log('Nichts doppelt in ' + klasse + '.'); return; }
  console.log('\n' + weg.length + ' doppelte Stücke in ' + klasse + '.');
  if(!JA){ console.log('Nur Vorschau – zum Entfernen denselben Befehl mit --ja.'); return; }

  const datei = path.join(__dirname, 'sicherung-material-doppelt-' + klasse + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(datei, JSON.stringify({ klasse, am:new Date().toISOString(), stuecke:weg.map(it => ({ typ:it.typ, id:it.id, daten:zuJson(it.roh) })) }, null, 2));
  console.log('Sicherung: ' + datei);

  const TS = admin.firestore.FieldValue.serverTimestamp();
  const ids = typ => weg.filter(it => it.typ === typ).map(it => it.id);
  const batch = db.batch();
  ids('quiz').forEach(id => batch.delete(kref.collection('quizzes').doc(id)));
  if(ids('kk').length) batch.set(kref.collection('klasseninfo').doc('karteikarten'), { sets:sets.filter(x => ids('kk').indexOf(x.id) < 0), updatedAt:TS });
  if(ids('wolke').length || ids('umfrage').length) batch.set(kref.collection('klassenzimmer').doc('vorlagen'),
    { wolken:wolken.filter(x => ids('wolke').indexOf(x.id) < 0), umfragen:umfragen.filter(x => ids('umfrage').indexOf(x.id) < 0), updatedAt:TS });
  await batch.commit();
  console.log('✅ ' + weg.length + ' doppelte Stücke entfernt.');
})().catch(err => { console.error('❌ ' + (err && err.message || err)); process.exit(1); });
