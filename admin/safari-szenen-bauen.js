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

/* ---------- Neue Szenen (Nov. 2026): Weltraum, Urzeit, Dschungel, Arktis, Fabelwesen ----------
   Kulisse wie oben aus den AmbientLife.svelte des Originals. Eigene Klassen
   des Originals bekommen das Präfix ssx- (damit nichts mit der Library
   kollidiert); die Szenen-CSS wird unten automatisch übernommen und auf
   .ss-stage[data-scene="<id>"] begrenzt. */

const lage = (x, rest) => wl(x) + rest;

function kulisseWeltraum(A){
  let h = '';
  [ { art: 'twinkle-1', duration: 7, delay: 0 }, { art: 'twinkle-2', duration: 11, delay: -4 }, { art: 'twinkle-3', duration: 9, delay: -7 } ]
    .forEach(t => { h += div('ssx-twinkle', 'top:0;bottom:0;animation-duration:' + t.duration + 's;animation-delay:' + t.delay + 's;', A[t.art]); });
  [ { y: 14, width: 34, duration: 520, delay: -130, opacity: 0.9 }, { y: 52, width: 26, duration: 640, delay: -420, opacity: 0.7 } ]
    .forEach(c => { h += div('ssx-dust', 'top:' + c.y + '%;width:calc(' + c.width + ' * var(--wu));opacity:' + c.opacity + ';animation-duration:' + c.duration + 's;animation-delay:' + c.delay + 's;', A.dust); });
  h += div('ssx-far-satellite', '', A['far-satellite']);
  return h;
}

function kulisseUrzeit(A){
  const ground = [
    { x: 6, base: 36, size: 7, art: 'conifer' }, { x: 13, base: 36, size: 5, art: 'fern-short' },
    { x: 30, base: 37, size: 5.5, art: 'cycad' }, { x: 44, base: 36, size: 6, art: 'fern-tall' },
    { x: 58, base: 37, size: 6, art: 'conifer' }, { x: 64, base: 36, size: 4.5, art: 'fern-short' },
    { x: 80, base: 36, size: 8, art: 'log' }, { x: 90, base: 37, size: 8, art: 'conifer' },
    { x: 3, base: 22, size: 9, art: 'fern-tall' }, { x: 20, base: 24, size: 7, art: 'cycad' },
    { x: 35, base: 21, size: 7, art: 'fern-short' }, { x: 52, base: 26, size: 8, art: 'fern-tall' },
    { x: 71, base: 22, size: 7.5, art: 'cycad' }, { x: 84, base: 19, size: 7, art: 'fern-short' },
    { x: -9, base: 0, size: 15, art: 'conifer' }, { x: 14, base: 1, size: 13, art: 'fern-tall' },
    { x: 34, base: 1, size: 18, art: 'log' }, { x: 55, base: 2, size: 8, art: 'fern-short' },
    { x: 66, base: 1, size: 15, art: 'fern-tall' }, { x: 86, base: 0, size: 12, art: 'cycad' },
    { x: 96, base: 1, size: 14, art: 'fern-tall' },
  ].map(p => ({ ...p, fern: p.art.startsWith('fern'), layer: groundLayer(1 - p.base / 100), sway: 6 + ((Math.abs(p.x) * 7) % 30) / 10 }))
   .sort((a, b) => a.layer - b.layer);
  const mists = [
    { top: 44, height: 9, width: 60, duration: 220, delay: -30, opacity: 0.5 },
    { top: 51, height: 7, width: 45, duration: 300, delay: -170, opacity: 0.4 },
    { top: 56, height: 6, width: 70, duration: 260, delay: -95, opacity: 0.35 },
  ];
  const glints = [
    { x: 8, top: 55.2, width: 14, duration: 7, delay: 0 }, { x: 31, top: 57.4, width: 11, duration: 9, delay: -3 },
    { x: 49, top: 55.8, width: 16, duration: 8, delay: -5 }, { x: 74, top: 57, width: 12, duration: 10, delay: -2 },
    { x: 88, top: 55.4, width: 10, duration: 7.5, delay: -6 },
  ];
  let h = div('ssx-far-flyers', 'top:14%;width:calc(8 * var(--wu));animation-duration:260s;animation-delay:-60s;', A.pterosaurs);
  h += div('ssx-far-herd', lage(22, 'top:50.4%;width:calc(11 * var(--wu));'), A.herd);
  mists.forEach(m => { h += div('ssx-mist', 'top:' + m.top + '%;height:' + m.height + '%;width:calc(' + m.width + ' * var(--wu));opacity:' + m.opacity + ';animation-duration:' + m.duration + 's;animation-delay:' + m.delay + 's;', ''); });
  glints.forEach(g => { h += div('ssx-glint', lage(g.x, 'top:' + g.top + '%;width:calc(' + g.width + ' * var(--wu));animation-duration:' + g.duration + 's;animation-delay:' + g.delay + 's;'), A.shimmer); });
  ground.forEach(p => {
    h += p.fern
      ? div('ssx-fern', lage(p.x, 'bottom:' + p.base + '%;height:' + p.size + '%;z-index:' + p.layer + ';animation-duration:' + p.sway + 's;'), A[p.art])
      : div('ss-svgw', lage(p.x, 'bottom:' + p.base + '%;width:calc(' + p.size + ' * var(--wu));z-index:' + p.layer + ';'), A[p.art]);
  });
  return h;
}

function kulisseDschungel(A){
  const ground = [
    { x: 16, base: 36, size: 9, art: 'heliconia' }, { x: 27, base: 37, size: 6, art: 'fern' },
    { x: 41, base: 36, size: 8, art: 'monstera' }, { x: 57, base: 37, size: 7, art: 'fern' },
    { x: 68, base: 36, size: 10, art: 'palm' }, { x: 77, base: 37, size: 4, art: 'rock' },
    { x: 89, base: 36, size: 8, art: 'heliconia' },
    { x: 6, base: 23, size: 10, art: 'fern' }, { x: 24, base: 20, size: 5.5, art: 'rock' },
    { x: 49, base: 25, size: 12, art: 'heliconia' }, { x: 62, base: 19, size: 9, art: 'fern' },
    { x: 84, base: 22, size: 13, art: 'monstera' },
    { x: -4, base: 0, size: 30, art: 'monstera' }, { x: 20, base: 1, size: 14, art: 'fern' },
    { x: 37, base: 1, size: 9, art: 'rock' }, { x: 58, base: 1, size: 16, art: 'fern' },
    { x: 74, base: 2, size: 20, art: 'heliconia' }, { x: 89, base: 0, size: 28, art: 'palm' },
  ].map(p => ({ ...p, plant: p.art !== 'rock', layer: groundLayer(1 - p.base / 100), sway: 6 + ((Math.abs(p.x) * 7) % 30) / 10 }))
   .sort((a, b) => a.layer - b.layer);
  const vines = [
    { x: 9, height: 40, art: 'vine-long', sway: 9 }, { x: 21, height: 24, art: 'vine-short', sway: 7.5 },
    { x: 36, height: 34, art: 'vine-long', sway: 10.5 }, { x: 51, height: 22, art: 'vine-short', sway: 8 },
    { x: 66, height: 30, art: 'vine-long', sway: 11 }, { x: 74, height: 20, art: 'vine-short', sway: 7 },
    { x: 92, height: 38, art: 'vine-long', sway: 9.5 },
  ];
  const shafts = [ { x: 50, width: 9, duration: 30, delay: 0 }, { x: 57, width: 13, duration: 38, delay: -12 }, { x: 66, width: 8, duration: 34, delay: -22 } ];
  const motes = [ { x: 49, duration: 60, delay: 0 }, { x: 58, duration: 74, delay: -30 } ];
  const mists = [ { top: 55, height: 8, width: 55, duration: 240, delay: -40, opacity: 0.4 }, { top: 58, height: 6, width: 40, duration: 310, delay: -180, opacity: 0.3 } ];
  let h = '';
  shafts.forEach(s => { h += div('ssx-jungle-shaft', lage(s.x, 'top:0;height:78%;width:calc(' + s.width + ' * var(--wu));animation-duration:' + s.duration + 's;animation-delay:' + s.delay + 's;'), A['light-shaft']); });
  motes.forEach(m => { h += div('ssx-jungle-motes', lage(m.x, 'top:12%;height:40%;width:calc(14 * var(--wu));animation-duration:' + m.duration + 's;animation-delay:' + m.delay + 's;'), A.motes); });
  h += div('ssx-jungle-falls', lage(79.9, 'top:23.6%;height:24.6%;width:calc(3.8 * var(--wu));'), '');
  h += div('ssx-jungle-flock', 'top:19%;width:calc(7 * var(--wu));animation-duration:200s;animation-delay:-70s;', A.birds);
  mists.forEach(m => { h += div('ssx-jungle-mist', 'top:' + m.top + '%;height:' + m.height + '%;width:calc(' + m.width + ' * var(--wu));opacity:' + m.opacity + ';animation-duration:' + m.duration + 's;animation-delay:' + m.delay + 's;', ''); });
  vines.forEach(v => { h += div('ssx-jungle-vine', lage(v.x, 'top:0;height:' + v.height + '%;animation-duration:' + v.sway + 's;'), A[v.art]); });
  ground.forEach(p => {
    h += p.plant
      ? div('ssx-jungle-plant', lage(p.x, 'bottom:' + p.base + '%;height:' + p.size + '%;z-index:' + p.layer + ';animation-duration:' + p.sway + 's;'), A[p.art])
      : div('ss-svgw', lage(p.x, 'bottom:' + p.base + '%;width:calc(' + p.size + ' * var(--wu));z-index:' + p.layer + ';'), A[p.art]);
  });
  return h;
}

function kulisseArktis(A){
  const ground = [
    { x: 4, base: 37, size: 7, art: 'ice-ridge' }, { x: 19, base: 36.5, size: 5, art: 'grass-tuft' },
    { x: 33, base: 37.5, size: 8, art: 'snow-drift' }, { x: 52, base: 36.5, size: 3.5, art: 'rock' },
    { x: 64, base: 37, size: 5.5, art: 'grass-tuft' }, { x: 76, base: 37, size: 8.5, art: 'ice-ridge' },
    { x: 91, base: 36.5, size: 7, art: 'snow-drift' },
    { x: 8, base: 23, size: 5, art: 'rock' }, { x: 24, base: 21, size: 8, art: 'grass-tuft' },
    { x: 40, base: 25, size: 11, art: 'snow-drift' }, { x: 60, base: 20, size: 8, art: 'ice-ridge' },
    { x: 85, base: 24, size: 7, art: 'grass-tuft' },
    { x: -4, base: 0, size: 14, art: 'ice-ridge' }, { x: 22, base: 1, size: 12, art: 'grass-tuft' },
    { x: 36, base: 0, size: 13, art: 'snow-drift' }, { x: 57, base: 1, size: 8, art: 'rock' },
    { x: 72, base: 1, size: 14, art: 'grass-tuft' }, { x: 84, base: 0, size: 14, art: 'snow-drift' },
    { x: 96, base: 1, size: 11, art: 'grass-tuft' },
  ].map(p => ({ ...p, sedge: p.art === 'grass-tuft', layer: groundLayer(1 - p.base / 100), sway: 5 + ((Math.abs(p.x) * 7) % 25) / 10 }))
   .sort((a, b) => a.layer - b.layer);
  const floes = [
    { x: 7, base: 44.2, size: 8, art: 'floe-wide', bob: 5.5 }, { x: 27, base: 41.6, size: 4, art: 'floe-small', bob: 4.6 },
    { x: 46, base: 43, size: 6, art: 'floe-small', bob: 6.2 }, { x: 66, base: 44.6, size: 10, art: 'floe-wide', bob: 7 },
    { x: 86, base: 42.4, size: 5, art: 'floe-small', bob: 5 },
  ].map(f => ({ ...f, layer: groundLayer(1 - f.base / 100) }));
  const curtains = [ { art: 'aurora-2', top: 1, height: 20, duration: 17, delay: -6 }, { art: 'aurora-1', top: 4, height: 28, duration: 13, delay: 0 } ];
  const snowfalls = [ { art: 'snow-far', layer: 0, duration: 70 }, { art: 'snow-near', layer: 1500, duration: 40 } ];
  let h = '';
  curtains.forEach(c => { h += div('ssx-arctic-aurora', 'top:' + c.top + '%;height:' + c.height + '%;animation-duration:' + c.duration + 's;animation-delay:' + c.delay + 's;', A[c.art]); });
  h += div('ssx-arctic-flock', 'top:24%;width:calc(8 * var(--wu));animation-duration:200s;animation-delay:-70s;', A.birds);
  floes.forEach(f => {
    h += div('ssx-arctic-floe', lage(f.x, 'bottom:' + f.base + '%;width:calc(' + f.size + ' * var(--wu));z-index:' + f.layer + ';'),
      '<div class="ssx-arctic-floe-waterline">' + '<div class="ssx-arctic-floe-ice" style="animation-duration:' + f.bob + 's;">' + A[f.art] + '</div></div>');
  });
  ground.forEach(p => {
    h += p.sedge
      ? div('ssx-arctic-sedge', lage(p.x, 'bottom:' + p.base + '%;height:' + p.size + '%;z-index:' + p.layer + ';animation-duration:' + p.sway + 's;'), A[p.art])
      : div('ss-svgw', lage(p.x, 'bottom:' + p.base + '%;width:calc(' + p.size + ' * var(--wu));z-index:' + p.layer + ';'), A[p.art]);
  });
  snowfalls.forEach(s => { h += div('ssx-arctic-snowfall', 'z-index:' + s.layer + ';animation-duration:' + s.duration + 's;', A[s.art] + A[s.art] + A[s.art]); });
  return h;
}

function kulisseFabel(A){
  const glints = [
    { x: 9.5, top: 56.6, width: 5.6, duration: 9, delay: 0 }, { x: 27, top: 55.1, width: 3.6, duration: 11, delay: -4 },
    { x: 42.5, top: 59.2, width: 6.8, duration: 10, delay: -7 }, { x: 52.5, top: 55, width: 3.2, duration: 12, delay: -2 },
    { x: 61.5, top: 56.3, width: 4.7, duration: 9.5, delay: -5 }, { x: 83.3, top: 59.6, width: 6.2, duration: 10.5, delay: -8 },
  ];
  const sparkles = [
    { x: 6, top: 70, size: 0.5, duration: 7, delay: 0 }, { x: 14, top: 62, size: 0.4, duration: 9, delay: -3 },
    { x: 22, top: 78, size: 0.6, duration: 8, delay: -6 }, { x: 31, top: 66, size: 0.4, duration: 10, delay: -2 },
    { x: 38, top: 84, size: 0.5, duration: 7.5, delay: -5 }, { x: 47, top: 71, size: 0.45, duration: 9.5, delay: -8 },
    { x: 55, top: 63, size: 0.4, duration: 8.5, delay: -1 }, { x: 63, top: 80, size: 0.6, duration: 11, delay: -7 },
    { x: 71, top: 68, size: 0.4, duration: 8, delay: -4 }, { x: 79, top: 88, size: 0.55, duration: 9, delay: -6 },
    { x: 86, top: 73, size: 0.45, duration: 10, delay: -9 }, { x: 92, top: 64, size: 0.4, duration: 7, delay: -2 },
  ];
  let h = div('ssx-mythical-falls', lage(15.9, 'top:44.4%;width:calc(2.2 * var(--wu));height:9.7%;'), '');
  glints.forEach(g => { h += div('ssx-mythical-glint', lage(g.x, 'top:' + g.top + '%;width:calc(' + g.width + ' * var(--wu));animation-duration:' + g.duration + 's;animation-delay:' + g.delay + 's;'), ''); });
  sparkles.forEach(s => { h += div('ssx-mythical-sparkle', lage(s.x, 'top:' + s.top + '%;width:calc(' + s.size + ' * var(--wu));animation-duration:' + s.duration + 's;animation-delay:' + s.delay + 's;'), ''); });
  // Die beiden Rahmen-Bäume stehen vor allem (z-index 1001), wie im Original.
  h += div('ss-backdrop ss-svgf', 'z-index:1001;', A.trees);
  return h;
}

/* Weltraum: die Stellen aus routes/layout.css des Originals, die nur deep
   space betreffen (Hintergrund, Störungs-Schleier, Sterne, Staub, Satellit,
   Funkeln als Sternglanz). Wird wie die scene.css unten umgeschrieben. */
const WELTRAUM_CSS = `
html:has(.scene-stage[data-scene="space"]) body { background: #04060d; }
.scene-stage[data-scene="space"][data-murky="true"] { filter: saturate(0.5) brightness(0.82) contrast(0.9); }
.scene-stage[data-scene="space"] .too-loud-veil {
  background:
    repeating-linear-gradient(to bottom, color-mix(in srgb, #a9c4f5 55%, transparent) 0 max(1px, calc(0.08 * var(--wu))), transparent max(1px, calc(0.08 * var(--wu))) max(3px, calc(0.3 * var(--wu)))),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.66 0 0 0 0 0.77 0 0 0 0 0.96 0 0 0 1.6 -0.55'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23g)'/%3E%3C/svg%3E"),
    color-mix(in srgb, #101c3d 60%, transparent);
}
.scene-stage[data-scene="space"][data-murky="true"] .too-loud-veil { opacity: 0.34; }
.scene-stage[data-scene="space"][data-scares="true"][data-murky="true"] { filter: saturate(0.8) brightness(0.94); }
.twinkle > svg { display: block; width: 100%; height: 100%; }
.dust > svg, .far-satellite > svg { display: block; width: 100%; height: auto; }
@keyframes star-twinkle { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
@keyframes sky-drift { from { transform: translateX(min(-20cqw, -100%)); } to { transform: translateX(110cqw); } }
@keyframes far-satellite-pass { 0% { transform: translate(-2cqw, 0); } 32% { transform: translate(102cqw, -9cqh); } 32.01%, 100% { transform: translate(-2cqw, 0); visibility: hidden; } }
.twinkle { left: var(--world-left); width: calc(100 * var(--wu)); will-change: opacity; animation: star-twinkle ease-in-out infinite; }
.dust { left: 0; animation: sky-drift linear infinite; }
.far-satellite { left: 0; top: 22%; width: max(10px, calc(0.9 * var(--wu))); opacity: 0.85; animation: far-satellite-pass 210s linear -40s infinite; }
@keyframes glint-twinkle { 0%, 100% { opacity: 0; transform: translate(-50%, -50%) scale(0.3); } 20%, 30% { opacity: 0.95; transform: translate(-50%, -50%) scale(0.85); } 50% { opacity: 0; transform: translate(-50%, -50%) scale(0.3); } }
.scene-stage[data-scene="space"] .sparkle { fill: #eef4ff; filter: drop-shadow(0 0 calc(0.35 * var(--wu)) #a9c4f5); animation-name: glint-twinkle; }
@media (prefers-reduced-motion: reduce) { .twinkle, .dust, .scene-stage[data-scene="space"] .sparkle { animation: none; } .far-satellite { display: none; } }
`;

/* Szenen-CSS des Originals übernehmen: Kommentare raus, jede Regel auf
   .ss-stage[data-scene="<id>"] begrenzen, Klassen des Originals auf die der
   Library umschreiben, Keyframes mit ssx- versehen. Reines Text-Umschreiben. */
function cssUebernehmen(css, scene, id){
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const S = '.ss-stage[data-scene="' + id + '"]';
  const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]);
  const klasse = {
    'scene-stage': 'ss-stage', 'creature': 'ss-creature', 'swimmer': 'ss-swimmer', 'too-loud-veil': 'ss-veil',
    'fleeing': 'ss-fleeing', 'sparkle': 'ss-sparkle', 'settled': 'ss-settled',
  };
  const eigene = new Set();
  css.replace(/\.([a-z][\w-]*)/g, (m, k) => { if(!klasse[k] && !k.startsWith('part-') && !/^\d/.test(k)) eigene.add(k); return m; });
  function selektor(sel){
    sel = sel.trim();
    const html = /^html:has\(\.scene-stage\[data-scene="[\w-]+"\]\)(\s+body)?$/.exec(sel);
    if(html) return S;
    if(/^html/.test(sel)) return null;   // Startseite des Originals: gibt es hier nicht
    sel = sel.replace(/\[data-scares="true"\]/g, '[data-modus="weg"]');
    sel = sel.replace(/\.scene-stage\[data-scene="[\w-]+"\]/g, S);
    sel = sel.replace(/\.([a-z][\w-]*)/g, (m, k) => klasse[k] ? '.' + klasse[k] : (eigene.has(k) && !k.startsWith('mythical-tail') && !k.startsWith('mythical-rock') ? '.ssx-' + k : m));
    if(sel.indexOf(S) !== 0) sel = S + ' ' + sel;
    return sel;
  }
  function koerper(b){
    b = b.replace(/var\(--world-left\)/g, 'var(--wu-left)');
    keyframes.forEach(k => { b = b.replace(new RegExp('(^|[\\s:,])' + k + '(?=[\\s;,]|$)', 'g'), '$1ssx-' + k); });
    return b;
  }
  function bloecke(text){
    let out = '', i = 0;
    while(i < text.length){
      const auf = text.indexOf('{', i);
      if(auf < 0) break;
      const kopf = text.slice(i, auf).trim();
      let tiefe = 1, j = auf + 1;
      while(j < text.length && tiefe){ if(text[j] === '{') tiefe++; else if(text[j] === '}') tiefe--; j++; }
      const innen = text.slice(auf + 1, j - 1);
      i = j;
      if(/^@keyframes/.test(kopf)){
        out += '@keyframes ssx-' + kopf.split(/\s+/)[1] + '{' + innen.replace(/\s+/g, ' ').trim() + '}';
      } else if(/^@media/.test(kopf)){
        out += kopf + '{' + bloecke(innen) + '}';
      } else {
        const sels = kopf.split(',').map(selektor).filter(Boolean);
        if(sels.length) out += [...new Set(sels)].join(',') + '{' + koerper(innen.replace(/\s+/g, ' ').trim()) + '}';
      }
    }
    return out;
  }
  return bloecke(css);
}
// Die Schwanz-/Schaukel-Klassen der Fabelwesen stecken in den SVGs selbst: dort heissen sie gleich.

const SZENEN = [
  { id: 'savanne', scene: 'savanna', kulisse: kulisseSavanne },
  { id: 'riff', scene: 'reef', kulisse: kulisseRiff },
  { id: 'wald', scene: 'forest', kulisse: kulisseWald },
  { id: 'weltraum', scene: 'space', kulisse: kulisseWeltraum, css: WELTRAUM_CSS },
  { id: 'urzeit', scene: 'prehistoric', kulisse: kulisseUrzeit },
  { id: 'dschungel', scene: 'jungle', kulisse: kulisseDschungel },
  { id: 'arktis', scene: 'arctic', kulisse: kulisseArktis },
  { id: 'fabel', scene: 'mythical', kulisse: kulisseFabel },
];

SZENEN.forEach(s => {
  const A = svgOrdner(s.scene, 'ambient');
  const art = svgOrdner(s.scene, 'creatures');
  const listen = svgOrdner(s.scene, 'listening');
  const r = roster(s.scene).filter(d => art[d.slug]);
  const buehne = '<div class="ss-backdrop ss-svgf">' + A.backdrop + '</div>' + s.kulisse(A);
  const cssDatei = path.join(src, 'src/lib/scenes', s.scene, 'scene.css');
  let css = s.css || (fs.existsSync(cssDatei) && !['savanna', 'reef'].includes(s.scene) ? fs.readFileSync(cssDatei, 'utf8') : '');
  // Wald: die alte Übernahme steckt schon in index.html (Nebel, Kulisse) — dort bleibt sie.
  if(s.scene === 'forest') css = '';
  const daten = { id: s.id, quelle: 'teacher.dev/shy-safari (Apache-2.0), verändert', roster: r, art, listen, buehne };
  if(css) daten.css = cssUebernehmen(css, s.scene, s.id);
  const json = JSON.stringify(daten);
  fs.writeFileSync(path.join(ziel, s.id + '.json'), json);
  console.log(s.id + '.json', r.length + ' Tiere,', Math.round(json.length / 1024) + ' KB' + (daten.css ? ', CSS ' + Math.round(daten.css.length / 1024) + ' KB' : ''));
});
fs.copyFileSync(path.join(src, 'LICENSE.txt'), path.join(ziel, 'LICENSE.txt'));
