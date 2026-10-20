#!/usr/bin/env node
/**
 * 🦒 Stille Safari — Szenen aus «Shy Safari» übernehmen.
 *
 *   git clone --depth 1 https://github.com/teacherdotdev/shy-safari.git /tmp/shy-safari
 *   node admin/safari-szenen-bauen.js /tmp/shy-safari
 *
 * Verändert nach teacher.dev/shy-safari (github.com/teacherdotdev/shy-safari),
 * Apache License 2.0 — siehe assets/safari/LICENSE.txt und assets/safari/HINWEIS.md.
 * Die Grafiken (SVG) liegen im Original-Repo unter derselben Lizenz.
 *
 * Schreibt pro Szene assets/safari/<id>.json:
 *   { id, roster:[{slug,tier,width,motion,flips?,parts}], art:{slug:svg},
 *     listen:{slug:svg}, buehne:'<html: Hintergrund + Kulisse>' }
 * Die Kulisse (Gras, Bäume, Wolken …) wird hier fertig als HTML gebaut —
 * Positionen 1:1 aus den AmbientLife.svelte des Originals, Klassen mit ss-.
 * Die Library lädt die Datei erst, wenn die Szene gewählt wird.
 * Liest nur Daten (SVG/Text) aus dem Original-Repo, führt nichts davon aus.
 */
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if(!src){ console.error('Pfad zum shy-safari-Klon fehlt.'); process.exit(1); }
const ziel = path.join(__dirname, '..', 'assets', 'safari');
fs.mkdirSync(ziel, { recursive: true });

// Wie groundLayer() in scenes/motion.ts
const groundLayer = y => Math.round(y * 1000);

function svgKlein(s){
  return s.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
}
function svgOrdner(scene, sub){
  const dir = path.join(src, 'src/lib/scenes', scene, sub);
  const out = {};
  if(!fs.existsSync(dir)) return out;
  fs.readdirSync(dir).filter(f => f.endsWith('.svg')).sort().forEach(f => {
    out[f.slice(0, -4)] = svgKlein(fs.readFileSync(path.join(dir, f), 'utf8'));
  });
  return out;
}
// roster.ts ist ein reines Objekt-Literal: Felder per Regex lesen (kein eval).
function roster(scene){
  const ts = fs.readFileSync(path.join(src, 'src/lib/scenes', scene, 'roster.ts'), 'utf8')
    .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const liste = [];
  const re = /\{([^{}]*slug:[^{}]*)\}/g;
  let m;
  while((m = re.exec(ts))){
    const b = m[1];
    const str = k => { const r = new RegExp(k + ':\\s*"([^"]*)"').exec(b); return r ? r[1] : undefined; };
    const num = k => { const r = new RegExp(k + ':\\s*([0-9.]+)').exec(b); return r ? Number(r[1]) : undefined; };
    const boo = k => { const r = new RegExp(k + ':\\s*(true|false)').exec(b); return r ? r[1] === 'true' : undefined; };
    const parts = (/parts:\s*\[([^\]]*)\]/.exec(b) || [,''])[1].match(/"[^"]*"/g) || [];
    const d = { slug: str('slug'), tier: str('tier'), width: num('width'), motion: str('motion'), parts: parts.map(p => p.slice(1, -1)) };
    if(boo('flips') !== undefined) d.flips = boo('flips');
    liste.push(d);
  }
  return liste;
}

const wl = x => 'left:calc(var(--wu-left) + ' + x + ' * var(--wu));';
function div(cls, style, inner){ return '<div class="' + cls + '" style="' + style + '">' + inner + '</div>'; }

/* ---------- Kulissen (aus den AmbientLife.svelte des Originals) ---------- */

function kulisseSavanne(A){
  const ground = [
    { x: 29, base: 37, size: 9, art: 'acacia' }, { x: 17, base: 36, size: 5, art: 'grass-short' },
    { x: 24, base: 37, size: 3, art: 'termite-mound' }, { x: 40, base: 36, size: 7, art: 'grass-tall' },
    { x: 47, base: 37, size: 5, art: 'bush' }, { x: 63, base: 36, size: 6, art: 'grass-short' },
    { x: 79, base: 37, size: 11, art: 'acacia' }, { x: 70, base: 36, size: 4.5, art: 'rock' },
    { x: 9, base: 23, size: 6, art: 'bush' }, { x: 22, base: 20, size: 10, art: 'grass-tall' },
    { x: 34, base: 23, size: 5.5, art: 'rock' }, { x: 58, base: 26, size: 9, art: 'grass-tall' },
    { x: 66, base: 20, size: 7, art: 'grass-short' }, { x: 90, base: 17, size: 4, art: 'termite-mound' },
    { x: -8, base: 1, size: 30, art: 'acacia' }, { x: 26, base: 2, size: 9, art: 'grass-short' },
    { x: 36, base: 1, size: 16, art: 'grass-tall' }, { x: 50, base: 1, size: 8, art: 'rock' },
    { x: 60, base: 2, size: 9, art: 'bush' }, { x: 76, base: 2, size: 15, art: 'grass-tall' },
    { x: 93, base: 1, size: 18, art: 'grass-tall' },
  ].map(p => ({ ...p, grass: p.art.startsWith('grass'), layer: groundLayer(1 - p.base / 100), sway: 4.5 + ((Math.abs(p.x) * 7) % 25) / 10 }))
   .sort((a, b) => a.layer - b.layer);
  const clouds = [
    { y: 6, width: 17, duration: 240, delay: -40, opacity: 0.9 },
    { y: 17, width: 11, duration: 300, delay: -190, opacity: 0.75 },
    { y: 28, width: 14, duration: 270, delay: -120, opacity: 0.6 },
  ];
  const flocks = [ { y: 20, width: 9, duration: 140, delay: -20 }, { y: 36, width: 6, duration: 190, delay: -110 } ];
  let h = div('ss-sun', 'left:max(calc(var(--wu-left) + 12 * var(--wu)), 5cqw);top:9%;width:calc(10 * var(--wu));', A.sun);
  clouds.forEach(c => { h += div('ss-drift ss-svgw', 'top:' + c.y + '%;width:calc(' + c.width + ' * var(--wu));opacity:' + c.opacity + ';animation-duration:' + c.duration + 's;animation-delay:' + c.delay + 's;', A.cloud); });
  flocks.forEach(f => { h += div('ss-drift ss-svgw', 'top:' + f.y + '%;width:calc(' + f.width + ' * var(--wu));opacity:.8;animation-duration:' + f.duration + 's;animation-delay:' + f.delay + 's;', A.birds); });
  ground.forEach(p => {
    h += p.grass
      ? div('ss-sway ss-svgh', wl(p.x) + 'bottom:' + p.base + '%;height:' + p.size + '%;z-index:' + p.layer + ';animation-duration:' + p.sway + 's;', A[p.art])
      : div('ss-svgw', wl(p.x) + 'bottom:' + p.base + '%;width:calc(' + p.size + ' * var(--wu));z-index:' + p.layer + ';', A[p.art]);
  });
  return h;
}

function kulisseRiff(A){
  const floor = [
    { x: 10, base: 14, size: 13, art: 'seaweed-short' }, { x: 14, base: 15, size: 4.5, art: 'coral-brain' },
    { x: 27, base: 14, size: 18, art: 'seaweed-tall' }, { x: 42, base: 15, size: 4, art: 'coral-branch' },
    { x: 46, base: 13, size: 13, art: 'seaweed-short' }, { x: 66, base: 14, size: 19, art: 'seaweed-tall' },
    { x: 78, base: 15, size: 5, art: 'coral-fan' }, { x: 85, base: 13, size: 21, art: 'seaweed-tall' },
    { x: 6, base: 9, size: 6, art: 'coral-branch' }, { x: 18, base: 8, size: 22, art: 'seaweed-tall' },
    { x: 37, base: 9, size: 6, art: 'coral-fan' }, { x: 60, base: 10, size: 5.5, art: 'coral-branch' },
    { x: 73, base: 8, size: 15, art: 'seaweed-short' }, { x: 88, base: 7, size: 6, art: 'coral-brain' },
    { x: 1, base: 2, size: 32, art: 'seaweed-tall' }, { x: 23, base: 2, size: 8, art: 'coral-fan' },
    { x: 33, base: 1, size: 17, art: 'seaweed-short' }, { x: 50, base: 1, size: 7, art: 'coral-brain' },
    { x: 55, base: 3, size: 25, art: 'seaweed-tall' }, { x: 70, base: 2, size: 8.5, art: 'coral-branch' },
    { x: 94, base: 2, size: 30, art: 'seaweed-tall' },
  ].map(p => ({ ...p, weed: p.art.startsWith('seaweed'), layer: groundLayer(1 - p.base / 100), sway: 5.5 + ((p.x * 7) % 25) / 10 }))
   .sort((a, b) => a.layer - b.layer);
  const plankton = [ { duration: 54, delay: 0, opacity: 0.55 }, { duration: 68, delay: -24, opacity: 0.4 }, { duration: 46, delay: -40, opacity: 0.45 } ];
  const shafts = [ { x: 8, width: 14, duration: 26, delay: 0 }, { x: 34, width: 18, duration: 34, delay: -8 }, { x: 62, width: 12, duration: 30, delay: -16 }, { x: 82, width: 16, duration: 38, delay: -4 } ];
  const shoals = [ { y: 24, width: 16, duration: 150, delay: 0 }, { y: 40, width: 11, duration: 205, delay: -90 } ];
  let h = '';
  shafts.forEach(s => { h += div('ss-shaft ss-svgf', wl(s.x) + 'top:0;bottom:0;width:calc(' + s.width + ' * var(--wu));animation-duration:' + s.duration + 's;animation-delay:' + s.delay + 's;', A['light-shaft']); });
  shoals.forEach(s => { h += div('ss-drift ss-svgw', 'top:' + s.y + '%;width:calc(' + s.width + ' * var(--wu));opacity:.8;animation-duration:' + s.duration + 's;animation-delay:' + s.delay + 's;', A['distant-shoal']); });
  plankton.forEach(p => { h += div('ss-plankton ss-svgf', 'left:0;right:0;top:0;bottom:0;animation-duration:' + p.duration + 's;animation-delay:' + p.delay + 's;--ss-peak:' + p.opacity + ';', A.plankton); });
  floor.forEach(p => {
    h += p.weed
      ? div('ss-sway ss-svgh', wl(p.x) + 'bottom:' + p.base + '%;height:' + p.size + '%;z-index:' + p.layer + ';animation-duration:' + p.sway + 's;', A[p.art])
      : div('ss-svgw', wl(p.x) + 'bottom:' + p.base + '%;width:calc(' + p.size + ' * var(--wu));z-index:' + p.layer + ';', A[p.art]);
  });
  return h;
}

function kulisseWald(A){
  const ground = [
    { x: 2, base: 38, size: 13, art: 'oak' }, { x: 13, base: 37.5, size: 6, art: 'pine' },
    { x: 21, base: 37, size: 6, art: 'bush' }, { x: 30, base: 37.5, size: 4.5, art: 'birch' },
    { x: 41, base: 37, size: 4.5, art: 'fern' }, { x: 57, base: 37, size: 4, art: 'flowers' },
    { x: 66, base: 37.5, size: 5, art: 'birch' }, { x: 74, base: 38, size: 11, art: 'maple-autumn' },
    { x: 86, base: 37.5, size: 6.5, art: 'pine' },
    { x: 6, base: 25, size: 9, art: 'fern' }, { x: 19, base: 27, size: 5, art: 'mushrooms' },
    { x: 33, base: 22, size: 6, art: 'rock' }, { x: 50, base: 28, size: 5, art: 'flowers' },
    { x: 62, base: 24, size: 5.5, art: 'stump' }, { x: 79, base: 26, size: 8, art: 'fern' },
    { x: 90, base: 20, size: 5, art: 'mushrooms' },
    { x: -7, base: 0, size: 24, art: 'pine' }, { x: 12, base: 1, size: 16, art: 'fern' },
    { x: 27, base: 1, size: 17, art: 'log' }, { x: 47, base: 2, size: 7, art: 'flowers' },
    { x: 58, base: 1, size: 10, art: 'bush' }, { x: 74, base: 2, size: 7, art: 'mushrooms' },
    { x: 84, base: 0, size: 20, art: 'oak' },
  ].map(p => ({ ...p, fern: p.art === 'fern', layer: groundLayer(1 - p.base / 100), sway: 5 + ((Math.abs(p.x) * 7) % 30) / 10 }))
   .sort((a, b) => a.layer - b.layer);
  const motes = [ { x: 24, top: 18, width: 16, duration: 38, delay: -6 }, { x: 50, top: 8, width: 20, duration: 46, delay: -27 }, { x: 69, top: 22, width: 14, duration: 41, delay: -16 } ];
  const leaves = [
    { x: 8, size: 1.5, art: 'leaf-1', duration: 23, delay: -3 }, { x: 22, size: 1.2, art: 'leaf-2', duration: 27, delay: -17 },
    { x: 37, size: 1.4, art: 'leaf-3', duration: 25, delay: -9 }, { x: 55, size: 1.3, art: 'leaf-1', duration: 29, delay: -22 },
    { x: 68, size: 1.6, art: 'leaf-2', duration: 24, delay: -12 }, { x: 81, size: 1.2, art: 'leaf-3', duration: 28, delay: -1 },
    { x: 93, size: 1.4, art: 'leaf-2', duration: 26, delay: -19 },
  ].map(l => ({ ...l, swing: 3.2 + ((l.x * 7) % 18) / 10 }));
  const flocks = [ { y: 13, width: 7, duration: 160, delay: -30 }, { y: 27, width: 5, duration: 210, delay: -130 } ];
  const LEAF_LAYER = groundLayer(0.8);
  let h = '';
  flocks.forEach(f => { h += div('ss-drift ss-svgw', 'top:' + f.y + '%;width:calc(' + f.width + ' * var(--wu));opacity:.75;animation-duration:' + f.duration + 's;animation-delay:' + f.delay + 's;', A.birds); });
  motes.forEach(m => { h += div('ss-motes ss-svgw', wl(m.x) + 'top:' + m.top + '%;width:calc(' + m.width + ' * var(--wu));animation-duration:' + m.duration + 's;animation-delay:' + m.delay + 's;', A.motes); });
  ground.forEach(p => {
    h += p.fern
      ? div('ss-fern ss-svgh', wl(p.x) + 'bottom:' + p.base + '%;height:' + p.size + '%;z-index:' + p.layer + ';animation-duration:' + p.sway + 's;', A.fern)
      : div('ss-svgw', wl(p.x) + 'bottom:' + p.base + '%;width:calc(' + p.size + ' * var(--wu));z-index:' + p.layer + ';', A[p.art]);
  });
  leaves.forEach(l => {
    h += div('ss-leaf-fall', wl(l.x) + 'top:0;width:calc(' + l.size + ' * var(--wu));z-index:' + LEAF_LAYER + ';animation-duration:' + l.duration + 's;animation-delay:' + l.delay + 's;',
      div('ss-leaf ss-svgw', 'position:static;animation-duration:' + l.swing + 's;animation-delay:' + l.delay + 's;', A[l.art]));
  });
  return h;
}

const SZENEN = [
  { id: 'savanne', scene: 'savanna', kulisse: kulisseSavanne },
  { id: 'riff', scene: 'reef', kulisse: kulisseRiff },
  { id: 'wald', scene: 'forest', kulisse: kulisseWald },
];

SZENEN.forEach(s => {
  const A = svgOrdner(s.scene, 'ambient');
  const art = svgOrdner(s.scene, 'creatures');
  const listen = svgOrdner(s.scene, 'listening');
  const r = roster(s.scene).filter(d => art[d.slug]);
  const buehne = '<div class="ss-backdrop ss-svgf">' + A.backdrop + '</div>' + s.kulisse(A);
  const json = JSON.stringify({ id: s.id, quelle: 'teacher.dev/shy-safari (Apache-2.0), verändert', roster: r, art, listen, buehne });
  fs.writeFileSync(path.join(ziel, s.id + '.json'), json);
  console.log(s.id + '.json', r.length + ' Tiere,', Math.round(json.length / 1024) + ' KB');
});
fs.copyFileSync(path.join(src, 'LICENSE.txt'), path.join(ziel, 'LICENSE.txt'));
