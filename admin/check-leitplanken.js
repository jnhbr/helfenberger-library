#!/usr/bin/env node
/**
 * Helfenberger's Library — Leitplanken-Check (ohne Abhängigkeiten, nur Node).
 *
 *   node admin/check-leitplanken.js            (aus dem Repo-Ordner)
 *
 * Prüft die Regeln, die im Betrieb schon einmal etwas kaputt gemacht haben:
 *  1. JavaScript-Syntax jedes <script type="module"> in index.html (node --check)
 *  2. keine nativen Dialoge confirm()/alert()/prompt() (verlassen den Vollbildmodus)
 *  3. kein localStorage.clear() (löscht die Übungsstände der eingebetteten Seiten)
 *  4. kein orderBy() in Firestore-Abfragen (braucht Composite Index -> Ausfall)
 *  5. firestore.rules: keine allow-Regel, die delete mit request.resource kombiniert
 *     (bei delete ist request.resource null -> Löschen scheitert immer)
 *  6. index.html / hilfe.html beginnen mit <!doctype html> und haben <meta charset="utf-8">
 * Warnung (kein Abbruch): query() mit mehreren where() — braucht evtl. einen Index.
 *
 * Eine bewusste Ausnahme in einer Zeile markieren mit dem Kommentar  leitplanken-ok
 * Exit-Code 1 bei einem Verstoss (so bricht die nächtliche Freigabe ab).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = process.argv[2] || path.join(__dirname, '..');
const fehler = [], warnungen = [];

function zeileVon(text, idx){ return text.slice(0, idx).split('\n').length; }
function ausnahme(text, idx){
  const a = text.lastIndexOf('\n', idx) + 1, e = text.indexOf('\n', idx);
  return /leitplanken-ok/.test(text.slice(a, e < 0 ? undefined : e));
}

// Kommentare und String-/Template-Inhalte grob ausblenden (durch Leerzeichen
// ersetzen, Zeilenumbrüche bleiben), damit Treffer in Texten nicht zählen.
// Code innerhalb von Template-Strings (z.B. in Übungsseiten eingespielte
// Skripte) wird dabei ebenfalls ausgeblendet — die laufen im iframe.
function nurCode(js){
  let out = '', i = 0, n = js.length;
  const leer = s => s.replace(/[^\n]/g, ' ');
  let vorher = '';
  while(i < n){
    const c = js[i], d = js[i + 1];
    if(c === '/' && d === '/'){ const e = js.indexOf('\n', i); const j = e < 0 ? n : e; out += leer(js.slice(i, j)); i = j; continue; }
    if(c === '/' && d === '*'){ const e = js.indexOf('*/', i + 2); const j = e < 0 ? n : e + 2; out += leer(js.slice(i, j)); i = j; continue; }
    if(c === '"' || c === "'" || c === '`'){
      let j = i + 1;
      while(j < n && js[j] !== c){ if(js[j] === '\\') j++; j++; }
      out += c + leer(js.slice(i + 1, j)) + (j < n ? c : ''); i = j + 1; vorher = c; continue;
    }
    // Regex-Literal: nach Operator/Klammer/Komma/Schlüsselwort
    if(c === '/' && /[(,=:[!&|?{};+\-*%<>~^]$|^$|\breturn$|\btypeof$/.test(vorher.trimEnd() ? out.trimEnd().slice(-6) : '')){
      let j = i + 1, klasse = false;
      while(j < n && (js[j] !== '/' || klasse) && js[j] !== '\n'){
        if(js[j] === '\\') j++; else if(js[j] === '[') klasse = true; else if(js[j] === ']') klasse = false;
        j++;
      }
      if(js[j] === '/'){ out += '/' + leer(js.slice(i + 1, j)) + '/'; i = j + 1; vorher = '/'; continue; }
    }
    out += c; if(!/\s/.test(c)) vorher = c; i++;
  }
  return out;
}

// ---------- index.html ----------
const htmlPfad = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPfad, 'utf8');
const module_ = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
if(!module_.length) fehler.push('index.html: kein <script type="module"> gefunden');

module_.forEach((m, k) => {
  const js = m[1];
  const offset = zeileVon(html, m.index) - 1;
  const tmp = path.join(os.tmpdir(), `leitplanken-${process.pid}-${k}.mjs`);
  fs.writeFileSync(tmp, js);
  try{ execFileSync(process.execPath, ['--check', tmp], { stdio:'pipe' }); }
  catch(e){ fehler.push('Syntaxfehler im Modul-Skript:\n' + String(e.stderr || e.message).replace(/\S*leitplanken-\d+-\d+\.mjs/g, 'Modul-Skript (Zeile + ' + offset + ' = Zeile in index.html)')); }
  finally{ try{ fs.unlinkSync(tmp); }catch(e){} }

  const code = nurCode(js);
  const pruefe = (re, text) => {
    for(const t of code.matchAll(re)){
      if(ausnahme(js, t.index)) continue;
      fehler.push(`index.html:${offset + zeileVon(js, t.index)}: ${text}`);
    }
  };
  pruefe(/(?<![\w$.])(?:window\.)?(confirm|alert|prompt)\s*\(/g, 'nativer Dialog (confirm/alert/prompt) — stattdessen uiConfirm/uiInfo/uiPrompt');
  pruefe(/localStorage\s*\.\s*clear\s*\(/g, 'localStorage.clear() — nur einzelne, bekannte Keys entfernen');
  pruefe(/(?<![\w$])orderBy\s*\(/g, 'orderBy() in einer Abfrage — braucht einen Composite Index; clientseitig sortieren');
  for(const q of code.matchAll(/(?<![\w$])query\s*\(/g)){
    // bis zur passenden schliessenden Klammer
    let tiefe = 0, j = q.index + q[0].length - 1;
    for(; j < code.length; j++){ if(code[j] === '(') tiefe++; else if(code[j] === ')' && --tiefe === 0) break; }
    const inhalt = code.slice(q.index, j);
    const anzahl = (inhalt.match(/(?<![\w$])where\s*\(/g) || []).length;
    if(anzahl > 1 && !ausnahme(js, q.index)) warnungen.push(`index.html:${offset + zeileVon(js, q.index)}: query() mit ${anzahl} where() — braucht evtl. einen Composite Index`);
  }
});

// ---------- HTML-Grundgerüst ----------
['index.html', 'hilfe.html'].forEach(f => {
  const p = path.join(root, f);
  if(!fs.existsSync(p)) return;
  const kopf = fs.readFileSync(p, 'utf8').slice(0, 2000);
  if(!/^\s*<!doctype html>/i.test(kopf)) fehler.push(`${f}: beginnt nicht mit <!doctype html>`);
  if(!/<meta\s+charset=["']?utf-8/i.test(kopf)) fehler.push(`${f}: <meta charset="utf-8"> fehlt im Kopf`);
});

// ---------- firestore.rules ----------
const rulesPfad = path.join(root, 'firestore.rules');
if(fs.existsSync(rulesPfad)){
  const rules = fs.readFileSync(rulesPfad, 'utf8');
  const ohneKommentare = rules.replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));
  for(const a of ohneKommentare.matchAll(/\ballow\s+([a-z,\s]+?)\s*:\s*if\b([\s\S]*?);/g)){
    const ops = a[1].split(/[\s,]+/).filter(Boolean);
    const loeschtMit = ops.includes('delete') || ops.includes('write');
    if(loeschtMit && /request\.resource/.test(a[2]) && !ausnahme(rules, a.index)){
      fehler.push(`firestore.rules:${zeileVon(rules, a.index)}: «allow ${ops.join(', ')}» prüft request.resource — bei delete ist das null. delete als eigene Regel ohne Datenprüfung schreiben.`);
    }
  }
  let klammern = 0;
  for(const ch of ohneKommentare){ if(ch === '{') klammern++; else if(ch === '}') klammern--; }
  if(klammern !== 0) fehler.push(`firestore.rules: geschweifte Klammern gehen nicht auf (${klammern > 0 ? '+' : ''}${klammern})`);
}

warnungen.forEach(w => console.log('⚠️  ' + w));
if(fehler.length){
  fehler.forEach(f => console.error('❌ ' + f));
  console.error(`\n${fehler.length} Leitplanken-Verstoss/Verstösse.`);
  process.exit(1);
}
console.log('✅ Leitplanken ok' + (warnungen.length ? ` (${warnungen.length} Warnung${warnungen.length === 1 ? '' : 'en'})` : ''));
