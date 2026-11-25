#!/usr/bin/env node
/**
 * Helfenberger's Library — Versions-Stempel der ausgelagerten Dateien (seit 25.11.2026).
 *
 *   node admin/versionen.js            setzt in index.html bei jedem «app/<datei>?v=…» den Stempel neu
 *   node admin/versionen.js --pruefen  meldet nur, ob alle Stempel stimmen (Exit-Code 1 sonst)
 *
 * Warum: Der Service Worker (sw-push.js) liefert eigene Dateien zuerst aus dem Cache.
 * Ohne neuen Stempel bekäme ein Gerät neues index.html mit altem app/stil.css.
 * Der Stempel = die ersten 10 Zeichen des SHA-256 der Datei, ändert sich also nur,
 * wenn sich die Datei ändert. Nach jeder Änderung an app/* einmal laufen lassen
 * (check-leitplanken.js prüft es vor dem Push).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REF = /(["'])(app\/[\w.\-\/]+)\?v=([\w]*)\1/g;

function stempel(root, datei){
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, datei))).digest('hex').slice(0, 10);
}

/** Liefert [{datei, ist, soll}] für alle Verweise in index.html (soll = null, wenn die Datei fehlt). */
function pruefen(root){
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  return [...html.matchAll(REF)].map(m => ({
    datei: m[2], ist: m[3], soll: fs.existsSync(path.join(root, m[2])) ? stempel(root, m[2]) : null
  }));
}

function setzen(root){
  const p = path.join(root, 'index.html');
  const html = fs.readFileSync(p, 'utf8');
  const neu = html.replace(REF, (all, q, datei) => {
    if(!fs.existsSync(path.join(root, datei))) throw new Error('index.html verweist auf ' + datei + ', die Datei fehlt');
    return q + datei + '?v=' + stempel(root, datei) + q;
  });
  if(neu !== html) fs.writeFileSync(p, neu);
  return neu !== html;
}

module.exports = { pruefen, setzen };

if(require.main === module){
  const root = path.join(__dirname, '..');
  if(process.argv.includes('--pruefen')){
    const falsch = pruefen(root).filter(r => r.ist !== r.soll);
    falsch.forEach(r => console.error('❌ ' + r.datei + (r.soll ? ': Stempel ' + r.ist + ' statt ' + r.soll : ': Datei fehlt')));
    if(falsch.length) process.exit(1);
    console.log('✅ Stempel stimmen');
  } else {
    const geaendert = setzen(root);
    pruefen(root).forEach(r => console.log('  ' + r.datei + '?v=' + r.soll));
    console.log(geaendert ? '✅ Stempel in index.html neu gesetzt' : '✅ Stempel waren schon aktuell');
  }
}
