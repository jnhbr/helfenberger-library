#!/usr/bin/env node
/**
 * Helfenberger's Library — Konfigurationsdateien für den Safe Exam Browser (SEB).
 *
 *   node admin/seb-config.js            (aus dem Repo-Ordner, keine Abhängigkeiten)
 *
 * Schreibt seb/library.seb (Live-Seite) und seb/library-test.seb (Testseite).
 * Beide liegen in jedem Repo (die nächtliche Freigabe kopiert sie mit); die App
 * nimmt je nach Seite die passende (sebDateiPfad in index.html). Geöffnet wird
 * eine Datei per sebs://-Link oder Doppelklick — SEB startet dann direkt in der
 * Library. Unverschlüsseltes XML (SEB liest das ohne Passwort).
 *
 * Wichtigste Einstellungen:
 *  - startURL = Library, quitURL = seb/beenden.html (die App springt nach der
 *    Abgabe dorthin, SEB beendet sich ohne Rückfrage)
 *  - Beenden ohne Passwort erlaubt: wer SEB mitten in der Prüfung verlässt,
 *    wird von der Library gesperrt (wie beim Tab-Wechsel)
 *  - URL-Filter nur für die Hauptseite (jnhbr.github.io + Firebase-Anmeldung);
 *    eingebettete Inhalte (Firestore, CDNs, Übungs-iframes) bleiben erlaubt
 *  - kein Neuladen (würde in der Library als «verlassen» zählen), keine neuen
 *    Fenster, keine Rechtschreibhilfe; Ton, WLAN und Uhr in der Taskleiste an
 *  - Zusatz «HelfLibSEB» im User-Agent (zusätzlich zu SEBs eigenem «SEB/…»)
 * Nach einer Änderung hier: Skript laufen lassen und beide .seb-Dateien committen.
 */
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.join(__dirname, '..');
const SEITEN = [
  {datei:'library.seb',      basis:'https://jnhbr.github.io/helfenberger-library/'},
  {datei:'library-test.seb', basis:'https://jnhbr.github.io/helfenberger-library-test/'}
];

function xmlEsc(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function wert(v, ein){
  if(typeof v === 'boolean') return ein + (v ? '<true/>' : '<false/>');
  if(typeof v === 'number') return ein + '<integer>' + v + '</integer>';
  if(Array.isArray(v)) return ein + '<array>\n' + v.map(function(x){ return wert(x, ein + '  '); }).join('\n') + '\n' + ein + '</array>';
  if(v && typeof v === 'object') return ein + '<dict>\n' + Object.keys(v).sort().map(function(k){
    return ein + '  <key>' + xmlEsc(k) + '</key>\n' + wert(v[k], ein + '  ');
  }).join('\n') + '\n' + ein + '</dict>';
  return ein + '<string>' + xmlEsc(v) + '</string>';
}
function regel(ausdruck){ return {active:true, regex:false, expression:ausdruck, action:1}; }

function config(basis){
  return {
    sebConfigPurpose: 0,                 // 0 = startet eine Prüfung
    startURL: basis,
    quitURL: basis + 'seb/beenden.html',
    quitURLConfirm: false,
    allowQuit: true,
    hashedQuitPassword: '',
    sendBrowserExamKey: false,
    browserViewMode: 1,                  // Vollbild
    enableBrowserWindowToolbar: false,
    browserWindowAllowReload: false,
    showReloadButton: false,
    newBrowserWindowByLinkPolicy: 0,     // neue Fenster blockieren
    newBrowserWindowByScriptPolicy: 0,
    allowSpellCheck: false,
    allowDictionaryLookup: false,
    enableZoomPage: true,
    enableZoomText: true,
    allowPreferencesWindow: false,
    showTaskBar: true,
    showTime: true,
    showInputLanguage: true,
    allowWlan: true,
    audioControlEnabled: true,
    audioMute: false,
    browserUserAgent: 'HelfLibSEB',
    URLFilterEnable: true,
    URLFilterEnableContentFilter: false,
    URLFilterRules: [regel('jnhbr.github.io'), regel('helfenberger-s-library.firebaseapp.com')]
  };
}

fs.mkdirSync(path.join(root, 'seb'), {recursive:true});
SEITEN.forEach(function(s){
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n' + wert(config(s.basis), '') + '\n</plist>\n';
  fs.writeFileSync(path.join(root, 'seb', s.datei), xml);
  console.log('geschrieben: seb/' + s.datei);
});
