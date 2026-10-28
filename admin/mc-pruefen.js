#!/usr/bin/env node
/**
 * Helfenberger's Library — prüft HTML-Übungen auf Multiple Choice, bei dem die richtige
 * Antwort immer an derselben Stelle steht (28.10.2026: ein Schüler hat gemerkt, dass sie
 * in mehreren Übungsseiten immer zuoberst war — die Seiten zeigten die Optionen ungemischt).
 *
 *   node admin/mc-pruefen.js --datei seite.html      (eine Datei prüfen)
 *   node admin/mc-pruefen.js --alle                  (alle HTML-Übungen in der Library, braucht serviceAccountKey.json)
 *
 * uebung-ersetzen.js ruft mcProbleme() vor jedem Ersetzen auf.
 */
const fs = require('fs');
const path = require('path');

// Liefert eine Liste von Problemen (leer = in Ordnung).
function mcProbleme(html){
  const out = [];
  // Quiz-Engine der RZG/NT/Geschichte/Geografie-Übungsseiten (renderQuestionBody)
  if(/var opts = q\.options\.map\(function\(o,i\)\{ return \{text:o, idx:i\}; \}\);/.test(html))
    out.push('Antworten werden ungemischt angezeigt (renderQuestionBody: q.options.map ohne shuffle).');
  // Mathe-Engine (mathe-uebungswebseite): Text-Antworten und Probetest
  if(/caseObj\.mcOptions\.forEach\(function\(optTxt, oi\)\{/.test(html))
    out.push('Mathe: mcOptions werden ungemischt angezeigt (mcReihenfolge fehlt).');
  if(/q\.optionen\.forEach\(function\(o, oi\)\{/.test(html))
    out.push('Mathe-Probetest: optionen werden ungemischt angezeigt (mcReihenfolge fehlt).');
  // Allgemein: schiefe Verteilung der richtigen Position, ohne erkennbares Mischen der Optionen
  const gemischt = /(shuffle|mischen|mcReihenfolge)\s*\(\s*\w*\.?(options|optionen|mcOptions)\b/i.test(html);
  if(!out.length && !gemischt){
    const pos = {};
    const re = /\[\s*(['"])(?:[^'"\\]|\\.)*\1\s*(?:,\s*(['"])(?:[^'"\\]|\\.)*\2\s*){2,5}\]\s*,?\s*(?:correct|mcCorrect|richtig|korrekt)\s*:\s*(\d)\b/g;
    let m, n = 0;
    while((m = re.exec(html))){ pos[m[3]] = (pos[m[3]] || 0) + 1; n++; }
    const max = Math.max(0, ...Object.values(pos));
    if(n >= 5 && max / n >= 0.7) out.push('Richtige Antwort steht bei ' + max + ' von ' + n + ' Fragen an derselben Stelle, und die Optionen werden nicht sichtbar gemischt.');
  }
  return out;
}

module.exports = { mcProbleme };

if(require.main === module){
  const i = process.argv.indexOf('--datei');
  if(i > 0){
    const datei = path.resolve(process.argv[i + 1].replace(/^~/, process.env.HOME));
    const p = mcProbleme(fs.readFileSync(datei, 'utf8'));
    console.log(p.length ? '❌ ' + path.basename(datei) + '\n   ' + p.join('\n   ') : '✅ ' + path.basename(datei) + ': Multiple Choice in Ordnung');
    process.exit(p.length ? 1 : 0);
  }
  if(!process.argv.includes('--alle')){ console.log('Aufruf: --datei seite.html  oder  --alle'); process.exit(1); }
  (async function(){
    const { db } = require('./_firebase').starten();
    const klassen = (await db.collection('klassen').listDocuments()).map(d => d.id);
    const inhalte = {};
    for(const k of klassen){
      const snap = await db.collection('klassen').doc(k).collection('resources').get();
      snap.docs.forEach(d => { const x = d.data(); if(x.pdf || x.externalUrl) return; const cid = x.contentId || d.id; (inhalte[cid] = inhalte[cid] || { titel:x.title || x.fileName, klassen:[] }).klassen.push(k); });
    }
    let schlecht = 0;
    for(const cid of Object.keys(inhalte)){
      const c = await db.collection('resourceContent').doc(cid).get();
      if(!c.exists) continue;
      let html = '';
      for(let j = 0; j < (c.data().chunkCount || 0); j++) html += ((await c.ref.collection('chunks').doc(String(j)).get()).data() || {}).html || '';
      const p = mcProbleme(html);
      if(p.length){ schlecht++; console.log('❌ ' + inhalte[cid].titel + '  (' + inhalte[cid].klassen[0] + (inhalte[cid].klassen.length > 1 ? ' + ' + (inhalte[cid].klassen.length - 1) : '') + ')\n   ' + p.join('\n   ')); }
    }
    console.log(schlecht ? '\n' + schlecht + ' Übung(en) mit Problemen.' : '✅ Alle ' + Object.keys(inhalte).length + ' HTML-Übungen in Ordnung.');
    process.exit(schlecht ? 1 : 0);
  })().catch(err => { console.error('❌ ' + (err && err.message || err)); process.exit(1); });
}
