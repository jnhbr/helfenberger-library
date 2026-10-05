#!/usr/bin/env node
/**
 * Helfenberger's Library — Material-Paket (.json, Format library-material-1) aus dem
 * Terminal importieren, wie Klassenzimmer › 🗃️ Unterrichtsmaterial › «📥 Paket importieren».
 * Die Aufbereitung (kzmPaketNorm, quizAusText, kkParse, UMFRAGE_MODI) wird direkt aus
 * ../index.html gelesen – Terminal und App verarbeiten ein Paket also identisch.
 *
 *   cd ~/Desktop/Claude/Projekte/helfenberger-library-firebase
 *   node admin/material-import.js --klasse G3b --datei paket.json            (Vorschau)
 *   node admin/material-import.js --klasse G3b --datei paket.json --ja
 *
 * Ziel: Fach aus dem Paket (oder --fach), Ordner = Ordner mit dem Namen aus dem Paket
 * (oder --ordner "Name"); gibt es ihn nicht, wird er auf der Fach-Hauptebene angelegt
 * (oder unter --in "Name des übergeordneten Ordners"). In Mathematik zählen auch die
 * Lehrmittel-Ordner (Mathematik 1–3 › Kapitel › Unterkapitel) – sie werden nie neu angelegt.
 * Vorhandenes wird übersprungen: gleicher Typ + Titel am selben Ort, oder dasselbe Stück
 * (Titel + Inhalt) irgendwo im Fach (z. B. nach dem Verschieben in einen Unterordner).
 * Schreibt nur mit --ja.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { starten } = require('./_firebase');

function arg(name){ const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; }
const JA = process.argv.includes('--ja');
const JAN_EMAIL = 'helfenberger@helfenberger-library.app';

// Funktionen der App aus index.html holen
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
  vm.runInContext([vari('UMFRAGE_MODI'), vari('UMFRAGE_MAX_FRAGEN'), vari('KK_MAX_KARTEN'), vari('KK_MAX_SETS'),
    vari('LMVZ_SUBJECT'), fn('quizAusText'), fn('kkParse'), fn('kzmPaketNorm'), fn('umfrageFragen'), fn('kzmInhaltSig'), fn('lmvzBuild'), fn('kzmLmvzAblage')].join('\n'), ctx);
  return ctx;
}

(async function(){
  const klasse = arg('klasse'), datei = arg('datei');
  if(!klasse || !datei){ console.log('Aufruf: --klasse G3b --datei paket.json [--fach deutsch] [--ordner "Name"] [--in "Übergeordneter Ordner"] [--ja]'); process.exit(1); }
  const APP = appFunktionen();
  const pk = APP.kzmPaketNorm(JSON.parse(fs.readFileSync(path.resolve(datei.replace(/^~/, process.env.HOME)), 'utf8')));
  const fach = arg('fach') || pk.fach;
  const ordnerName = arg('ordner') || pk.ordner;
  if(!fach) throw new Error('Kein Fach – im Paket «fach» setzen oder --fach angeben.');
  if(!pk.stuecke.length) throw new Error('Im Paket ist nichts Importierbares.');

  const { admin, db, auth } = starten();
  const TS = admin.firestore.FieldValue.serverTimestamp();
  const kref = db.collection('klassen').doc(klasse);
  if(!(await kref.collection('resources').limit(1).get()).size && !(await kref.collection('folders').limit(1).get()).size) console.log('⚠️  In ' + klasse + ' gibt es weder Übungen noch Ordner – Klassenname richtig?');
  let jan = { uid:'admin', name:'Helfenberger' };
  try{ const u = await auth.getUserByEmail(JAN_EMAIL); jan = { uid:u.uid, name:u.displayName || 'Helfenberger' }; }catch(e){}

  // Ordner des Fachs
  const fsnap = await kref.collection('folders').where('subject', '==', fach).get();
  const ordner = fsnap.docs.map(d => Object.assign({ id:d.id }, d.data()));
  // Mathematik: die Lehrmittel-Ordner gibt es nur in der App (aus assets/lmvz-mathe.json) – als Ziel
  // erkennen, statt einen gleichnamigen echten Ordner daneben anzulegen. Echte Ordner haben Vorrang.
  if(fach === APP.LMVZ_SUBJECT){
    try{
      const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'lmvz-mathe.json'), 'utf8'));
      APP.lmvzBuild(cat, true).folders.filter(APP.kzmLmvzAblage).forEach(f => ordner.push({ id:f.id, subject:fach, parentId:f.parentId || null, name:f.name, virtuell:true }));
    }catch(e){ console.log('⚠️  Lehrmittel-Ordner nicht gelesen (' + e.message + ')'); }
  }
  const finde = (name, parent) => ordner.find(f => String(f.name).trim().toLowerCase() === name.trim().toLowerCase() && (parent === undefined || (f.parentId || null) === (parent || null)));
  let parentId = null;
  if(arg('in')){ const p = finde(arg('in')); if(!p) throw new Error('Ordner «' + arg('in') + '» gibt es in ' + fach + ' nicht.'); parentId = p.id; }
  let ziel = ordnerName ? (finde(ordnerName, arg('in') ? parentId : undefined) || null) : null;
  const neueOrdner = [];
  const ordnerAnlegen = (name, parent) => {
    const id = fach + '_f_' + Date.now() + Math.random().toString(36).slice(2, 5);
    const f = { id, subject:fach, parentId:parent || null, name:name.slice(0, 60), order:ordner.filter(x => (x.parentId || null) === (parent || null)).length };
    ordner.push(f); neueOrdner.push(f);
    return f;
  };
  if(ordnerName && !ziel) ziel = ordnerAnlegen(ordnerName, parentId);
  const zielId = ziel ? ziel.id : null;

  // Vorhandenes am Zielort (Titel je Typ)
  const [qsnap, kksnap, vsnap] = await Promise.all([kref.collection('quizzes').get(), kref.collection('klasseninfo').doc('karteikarten').get(), kref.collection('klassenzimmer').doc('vorlagen').get()]);
  const sets = kksnap.exists && Array.isArray(kksnap.data().sets) ? kksnap.data().sets.slice() : [];
  const vorl = vsnap.exists ? vsnap.data() : {};
  const wolken = Array.isArray(vorl.wolken) ? vorl.wolken.slice() : [], umfragen = Array.isArray(vorl.umfragen) ? vorl.umfragen.slice() : [];
  const norm = s => String(s || '').trim().toLowerCase();
  const da = [];
  const sig = APP.kzmInhaltSig;
  qsnap.forEach(d => { const x = d.data(); da.push({ typ:'quiz', titel:x.title, fach:x.subject || '', ordner:x.folderId || null, sig:sig('quiz', x.questions) }); });
  sets.forEach(x => da.push({ typ:'kk', titel:x.titel, fach:x.fach || '', ordner:x.ordner || null, sig:sig('kk', x.karten) }));
  wolken.forEach(x => da.push({ typ:'wolke', titel:x.frage, fach:x.fach || '', ordner:x.ordner || null, sig:sig('wolke', x.frage) }));
  umfragen.forEach(x => da.push({ typ:'umfrage', titel:x.titel || APP.umfrageFragen(x)[0].frage, fach:x.fach || '', ordner:x.ordner || null, sig:sig('umfrage', APP.umfrageFragen(x)) }));

  const plan = [];
  for(const st of pk.stuecke){
    let ort = zielId;
    if(st.unter){ const u = finde(st.unter, zielId) || ordnerAnlegen(st.unter, zielId); ort = u.id; }
    const stSig = sig(st.typ, st.typ === 'quiz' ? st.daten : st.typ === 'umfrage' ? st.daten.fragen : st.typ === 'kk' ? st.daten.karten : st.daten.frage);
    const doppelt = da.some(x => x.typ === st.typ && x.fach === fach && norm(x.titel) === norm(st.titel) && ((x.ordner || null) === (ort || null) || x.sig === stSig));
    plan.push(Object.assign({ ort, doppelt }, st));
  }
  const ICON = { quiz:'🎮', kk:'🗂️', wolke:'☁️', umfrage:'⚡' };
  const ortName = id => { const f = ordner.find(x => x.id === id); return f ? f.name : '(Fach-Hauptebene)'; };
  console.log('Klasse ' + klasse + ' · Fach ' + fach + ' · Ordner: ' + (ziel ? ziel.name + (neueOrdner.includes(ziel) ? ' (wird neu angelegt)' : ziel.virtuell ? ' (Lehrmittel-Ordner)' : '') : '(Fach-Hauptebene)'));
  plan.forEach(p => console.log('  ' + (p.doppelt ? '↷ schon da  ' : '＋ neu      ') + ICON[p.typ] + ' ' + p.titel + (p.unter ? '   → ' + ortName(p.ort) : '')));
  const neu = plan.filter(p => !p.doppelt);
  if(sets.length + neu.filter(p => p.typ === 'kk').length > APP.KK_MAX_SETS) throw new Error('Mehr als ' + APP.KK_MAX_SETS + ' Karteikarten-Sets in der Klasse – zuerst alte löschen.');
  if(!JA){ console.log('\n' + neu.length + ' neu, ' + (plan.length - neu.length) + ' übersprungen. Nur Vorschau – zum Importieren denselben Befehl mit --ja.'); return; }

  const batch = db.batch();
  neueOrdner.forEach(f => batch.set(kref.collection('folders').doc(f.id), { subject:f.subject, parentId:f.parentId, name:f.name, order:f.order, createdAt:TS, createdBy:jan.uid }));
  let kkNeu = false, vorlNeu = false;
  neu.forEach(p => {
    const nid = p.typ[0] + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    if(p.typ === 'quiz') batch.set(kref.collection('quizzes').doc(), { title:p.titel, subject:fach, folderId:p.ort || null, questions:p.daten, createdBy:jan.name, createdAt:TS });
    else if(p.typ === 'kk'){ sets.push({ id:'kk' + nid, fach, titel:p.titel, kopf:p.daten.kopf, karten:p.daten.karten, ordner:p.ort || '', von:jan.name, vonUid:jan.uid, geaendert:Date.now() }); kkNeu = true; }
    else { (p.typ === 'wolke' ? wolken : umfragen).push(Object.assign({ id:nid, fach, ordner:p.ort || null }, p.daten)); vorlNeu = true; }
  });
  if(kkNeu) batch.set(kref.collection('klasseninfo').doc('karteikarten'), { sets, updatedAt:TS });
  if(vorlNeu) batch.set(kref.collection('klassenzimmer').doc('vorlagen'), { wolken, umfragen, updatedAt:TS });
  await batch.commit();
  console.log('✅ ' + neu.length + ' importiert – in der Library unter Klassenzimmer › 🗃️ Unterrichtsmaterial bzw. im Fach-Ordner.');
})().catch(err => { console.error('❌ ' + (err && err.message || err)); process.exit(1); });
