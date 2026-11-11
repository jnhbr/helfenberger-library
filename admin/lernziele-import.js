#!/usr/bin/env node
/**
 * Helfenberger's Library — 🎯 Lernziele an einen Ordner hängen (Pilot seit 11.11.2026).
 *
 * Ein Lernziel-Set ist eine JSON-Datei:
 *   { "id": "bio-koerper-2", "titel": "Funktionen des Körpers – Teil 2 (Prüfung 2)",
 *     "ziele":  [ { "nr": 1, "text": "…" }, … ],
 *     "fragen": { "<übungs-id>": { "<frage-id>": [nr, …], … } } }
 * Die Frage-IDs sind die der Übungsseite (Q.push({id:'vd1', …})), so wie sie die Übung
 * per __libProgress meldet. Die Reihenfolge von «ziele» muss der Liste GOALS in der
 * Übungsseite entsprechen (die Selbsteinschätzung wird über die Stelle abgeglichen).
 *
 *   cd ~/Desktop/Claude/Projekte/helfenberger-library-firebase
 *   node admin/lernziele-import.js --klasse G3b --ordner <ordner-id> --datei set.json          (Vorschau)
 *   node admin/lernziele-import.js --klasse G3b --ordner <ordner-id> --datei set.json --ja
 *   node admin/lernziele-import.js --klasse G3b --ordner <ordner-id> --entfernen <set-id> --ja
 *   node admin/lernziele-import.js --klasse G3b --liste                                         (Ordner mit Lernzielen)
 *
 * Ein Set mit derselben id im Ordner wird ersetzt, andere Sets bleiben. Schreibt nur mit --ja.
 * Braucht admin/serviceAccountKey.json (siehe _firebase.js).
 */
const fs = require('fs');
const { starten } = require('./_firebase');

function arg(name){ const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; }
const JA = process.argv.includes('--ja');

function pruefen(set, uebungen){
  const fehler = [];
  if(!set || typeof set.id !== 'string' || !set.id) fehler.push('«id» fehlt');
  if(!Array.isArray(set.ziele) || !set.ziele.length) fehler.push('«ziele» fehlt oder ist leer');
  const nrn = (set.ziele || []).map(z => z.nr);
  if(new Set(nrn).size !== nrn.length) fehler.push('Lernziel-Nummern sind nicht eindeutig');
  (set.ziele || []).forEach(z => { if(z.nr == null || !z.text) fehler.push('Lernziel ohne Nummer oder Text: ' + JSON.stringify(z)); });
  Object.keys(set.fragen || {}).forEach(rid => {
    if(!uebungen[rid]) fehler.push('Übung ' + rid + ' gibt es in dieser Klasse nicht');
    Object.keys(set.fragen[rid]).forEach(q => {
      const l = set.fragen[rid][q];
      if(!Array.isArray(l) || !l.length) fehler.push('Frage ' + q + ': keine Lernziele');
      else l.forEach(n => { if(nrn.indexOf(n) < 0) fehler.push('Frage ' + q + ': Lernziel ' + n + ' gibt es nicht'); });
    });
  });
  return fehler;
}

(async () => {
  const klasse = arg('klasse');
  if(!klasse){ console.error('--klasse fehlt'); process.exit(1); }
  const { db } = starten();
  const fcol = db.collection('klassen/' + klasse + '/folders');

  if(process.argv.includes('--liste')){
    (await fcol.get()).forEach(d => { const l = d.data().lernziele; if(Array.isArray(l) && l.length) console.log(d.id, '|', d.data().name, '|', l.map(s => s.id + ' (' + s.ziele.length + ' Lernziele)').join(', ')); });
    return;
  }

  const ordner = arg('ordner');
  if(!ordner){ console.error('--ordner fehlt'); process.exit(1); }
  const ref = fcol.doc(ordner), snap = await ref.get();
  if(!snap.exists){ console.error('Ordner ' + ordner + ' gibt es in ' + klasse + ' nicht.'); process.exit(1); }
  const bisher = Array.isArray(snap.data().lernziele) ? snap.data().lernziele : [];

  const weg = arg('entfernen');
  if(weg){
    const neu = bisher.filter(s => s.id !== weg);
    console.log('Ordner «' + snap.data().name + '»: Set ' + weg + (neu.length === bisher.length ? ' ist nicht vorhanden.' : ' wird entfernt.'));
    if(JA && neu.length !== bisher.length){ await ref.update({ lernziele: neu }); console.log('✅ Entfernt.'); }
    else if(!JA) console.log('Vorschau – mit --ja ausführen.');
    return;
  }

  const datei = arg('datei');
  if(!datei){ console.error('--datei fehlt'); process.exit(1); }
  const set = JSON.parse(fs.readFileSync(datei, 'utf8'));
  const uebungen = {};
  (await db.collection('klassen/' + klasse + '/resources').get()).forEach(d => { uebungen[d.id] = d.data(); });
  const fehler = pruefen(set, uebungen);
  if(fehler.length){ console.error('❌ Set ist nicht in Ordnung:\n  ' + fehler.join('\n  ')); process.exit(1); }

  console.log('Ordner «' + snap.data().name + '» (' + klasse + '): Set «' + set.titel + '» [' + set.id + '] ' + (bisher.some(s => s.id === set.id) ? 'wird ersetzt' : 'kommt neu dazu'));
  Object.keys(set.fragen || {}).forEach(rid => console.log('  Übung: ' + (uebungen[rid].title || rid) + ' – ' + Object.keys(set.fragen[rid]).length + ' Fragen zugeordnet'));
  set.ziele.forEach(z => {
    let n = 0;
    Object.keys(set.fragen || {}).forEach(rid => Object.keys(set.fragen[rid]).forEach(q => { if(set.fragen[rid][q].indexOf(z.nr) >= 0) n++; }));
    console.log('  ' + String(z.nr).padStart(2) + '. ' + String(n).padStart(2) + ' Fragen · ' + z.text.slice(0, 80));
  });
  if(!JA){ console.log('Vorschau – mit --ja ausführen.'); return; }
  await ref.update({ lernziele: bisher.filter(s => s.id !== set.id).concat([set]) });
  console.log('✅ Gespeichert.');
})().catch(e => { console.error(e); process.exit(1); });
