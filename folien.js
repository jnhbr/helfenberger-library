/* Helfenberger's Library — 🎞️ Folien: PowerPoint (.pptx) → eigenständige HTML-Präsentation.
 *
 * Läuft im Browser (Upload in der Library) und in Node (admin/folien-import.js) mit demselben Code.
 *   FolienKonverter.pptxZuHtml(bytes:Uint8Array, {titel, inflate?}) → Promise<{html, folien, notizen}>
 *
 * Die Folien werden aus dem PPTX nachgezeichnet (Texte, Formen, Bilder, Links, Hintergrund,
 * Sprechernotizen) und als absolut positionierte Elemente auf einer 1280×720-Bühne ausgegeben —
 * keine Abhängigkeiten, keine Server. Die erzeugte HTML-Datei bringt ihre Ansicht mit:
 *   - Normalansicht für alle (Pfeile, Übersicht, Vollbild)
 *   - nur für Lehrpersonen (window.__libLehrer): 📝 Notizen neben der Folie und 🎤 Referentenansicht
 *     (zweites Fenster mit Notizen, nächster Folie, Uhr — die Klasse sieht im Vollbild nur die Folien)
 */
(function(root){
'use strict';

/* ---------- ZIP ---------- */
function u16(b, o){ return b[o] | (b[o+1] << 8); }
function u32(b, o){ return (b[o] | (b[o+1] << 8) | (b[o+2] << 16) | (b[o+3] << 24)) >>> 0; }
function zipEintraege(b){
  var eocd = -1;
  for(var i = b.length - 22; i >= Math.max(0, b.length - 65600); i--){ if(u32(b, i) === 0x06054b50){ eocd = i; break; } }
  if(eocd < 0) throw new Error('Keine gültige PowerPoint-Datei (ZIP nicht lesbar).');
  var n = u16(b, eocd + 10), p = u32(b, eocd + 16), out = {};
  for(var k = 0; k < n; k++){
    if(u32(b, p) !== 0x02014b50) break;
    var len = u16(b, p + 28), ex = u16(b, p + 30), cm = u16(b, p + 32);
    var name = new TextDecoder('utf-8').decode(b.subarray(p + 46, p + 46 + len));
    out[name] = { methode: u16(b, p + 10), csize: u32(b, p + 20), off: u32(b, p + 42) };
    p += 46 + len + ex + cm;
  }
  return out;
}
async function zipLesen(b, e, inflate){
  var o = e.off, nl = u16(b, o + 26), el = u16(b, o + 28), start = o + 30 + nl + el;
  var roh = b.subarray(start, start + e.csize);
  if(e.methode === 0) return roh;
  if(e.methode === 8) return inflate(roh);
  throw new Error('ZIP-Komprimierung ' + e.methode + ' wird nicht unterstützt.');
}
function standardInflate(roh){
  if(typeof require === 'function'){ try{ var z = require('zlib'); return Promise.resolve(new Uint8Array(z.inflateRawSync(roh))); }catch(e){} }
  if(typeof DecompressionStream === 'function'){
    var ds = new DecompressionStream('deflate-raw');
    var w = ds.writable.getWriter(); w.write(roh); w.close();
    return new Response(ds.readable).arrayBuffer().then(function(ab){ return new Uint8Array(ab); });
  }
  if(typeof require === 'function'){ var z = require('zlib'); return Promise.resolve(new Uint8Array(z.inflateRawSync(roh))); }
  throw new Error('Dieser Browser kann ZIP nicht entpacken.');
}

/* ---------- Mini-XML ---------- */
function entit(s){
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, function(m, e){
    if(e === 'lt') return '<'; if(e === 'gt') return '>'; if(e === 'amp') return '&';
    if(e === 'quot') return '"'; if(e === 'apos') return "'";
    return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}
function xml(s){
  var root = { n: '#', a: {}, c: [] }, st = [root], re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g, m;
  while((m = re.exec(s))){
    var cur = st[st.length - 1];
    if(m[6] != null){ cur.c.push({ t: entit(m[6]) }); }
    else if(m[1] != null && m[0].indexOf('<![CDATA[') === 0){ cur.c.push({ t: m[1] }); }
    else if(m[3]){
      if(m[2]){ if(st.length > 1) st.pop(); continue; }
      var a = {}, ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, am;
      while((am = ar.exec(m[4]))) a[am[1]] = entit(am[2] != null ? am[2] : am[3]);
      var node = { n: m[3], a: a, c: [] };
      cur.c.push(node);
      if(!m[5]) st.push(node);
    }
  }
  return root;
}
function kind(n, name){ return n.c.filter(function(x){ return x.n === name; }); }
function eins(n, name){ if(!n) return null; for(var i = 0; i < n.c.length; i++) if(n.c[i].n === name) return n.c[i]; return null; }
function pfad(n, names){ for(var i = 0; i < names.length && n; i++) n = eins(n, names[i]); return n; }
function text(n){ var s = ''; (n.c || []).forEach(function(x){ s += x.t != null ? x.t : text(x); }); return s; }
function esc(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* ---------- Hilfen ---------- */
var PX = 9525;                                   // EMU → px bei 96 dpi (1280 px = 13,333 in)
function px(v){ return Math.round(v / PX * 100) / 100; }
function farbe(fill){
  var c = fill && eins(fill, 'a:srgbClr');
  if(!c) return null;
  var al = eins(c, 'a:alpha');
  var hex = c.a.val, r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return al ? 'rgba(' + r + ',' + g + ',' + b + ',' + (parseInt(al.a.val, 10) / 100000) + ')' : '#' + hex;
}
function fuellung(spPr){
  if(!spPr) return null;
  if(eins(spPr, 'a:noFill')) return null;
  return farbe(eins(spPr, 'a:solidFill'));
}
function base64(b){
  var s = '';
  for(var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(b).toString('base64');
}
function mime(name){
  var e = (name.split('.').pop() || '').toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' }[e] || null;
}
function relPfad(basis, ziel){
  if(ziel.charAt(0) === '/') return ziel.slice(1);
  var teile = basis.split('/'); teile.pop();
  ziel.split('/').forEach(function(t){ if(t === '..') teile.pop(); else if(t !== '.') teile.push(t); });
  return teile.join('/');
}
function relsLesen(dateien, pfadXml){
  var rp = pfadXml.replace(/([^\/]+)$/, '_rels/$1.rels'), out = {};
  if(!dateien[rp]) return out;
  kind(xml(dateien[rp]), 'Relationships').forEach(function(rs){
    kind(rs, 'Relationship').forEach(function(r){ out[r.a.Id] = { typ: r.a.Type, ziel: r.a.Target, extern: r.a.TargetMode === 'External' }; });
  });
  return out;
}

/* ---------- Folie zeichnen ---------- */
function pfeilPunkte(w, h, adj1, adj2){
  var ss = Math.min(w, h), dx = ss * adj2 / 100000, x1 = w - dx, dy = h * adj1 / 200000, y1 = h / 2 - dy, y2 = h / 2 + dy;
  return 'polygon(0 ' + px2(y1) + 'px,' + px2(x1) + 'px ' + px2(y1) + 'px,' + px2(x1) + 'px 0,100% 50%,' + px2(x1) + 'px 100%,' + px2(x1) + 'px ' + px2(y2) + 'px,0 ' + px2(y2) + 'px)';
}
function px2(v){ return Math.round(v * 100) / 100; }

function absatz(p, rels){
  var pPr = eins(p, 'a:pPr') || { a: {}, c: [] }, st = [];
  var marL = parseInt(pPr.a.marL || 0, 10), ind = parseInt(pPr.a.indent || 0, 10);
  if(pPr.a.algn){ st.push('text-align:' + ({ ctr: 'center', r: 'right', l: 'left', just: 'justify' }[pPr.a.algn] || 'left')); }
  var ls = pfad(pPr, ['a:lnSpc', 'a:spcPct']);
  st.push('line-height:' + (ls ? parseInt(ls.a.val, 10) / 100000 * 1.2 : 1.2));
  var sb = pfad(pPr, ['a:spcBef', 'a:spcPts']), sa = pfad(pPr, ['a:spcAft', 'a:spcPts']);
  if(sb) st.push('margin-top:' + px2(parseInt(sb.a.val, 10) / 100 * 4 / 3) + 'px');
  if(sa) st.push('margin-bottom:' + px2(parseInt(sa.a.val, 10) / 100 * 4 / 3) + 'px');
  if(marL) st.push('padding-left:' + px(marL) + 'px');
  var bu = eins(pPr, 'a:buChar');
  if(bu && ind) st.push('text-indent:' + px(ind) + 'px');
  var html = '', letzteGroesse = 18, ersteGroesse = 0;
  p.c.forEach(function(x){
    if(x.n === 'a:br'){ html += '<br>'; return; }
    if(x.n !== 'a:r' && x.n !== 'a:fld') return;
    var rPr = eins(x, 'a:rPr') || { a: {}, c: [] }, tn = eins(x, 'a:t'), t = tn ? text(tn) : '';
    var s = [];
    if(rPr.a.sz){ letzteGroesse = parseInt(rPr.a.sz, 10) / 100; if(!ersteGroesse) ersteGroesse = letzteGroesse; s.push('font-size:' + px2(letzteGroesse * 4 / 3) + 'px'); }
    if(rPr.a.b === '1') s.push('font-weight:700');
    if(rPr.a.i === '1') s.push('font-style:italic');
    var fc = farbe(eins(rPr, 'a:solidFill')); if(fc) s.push('color:' + fc);
    var lat = pfad(rPr, ['a:latin']); if(lat && lat.a.typeface) s.push('font-family:"' + lat.a.typeface.replace(/"/g, '') + '",Arial,Helvetica,sans-serif');
    var link = pfad(rPr, ['a:hlinkClick']), href = link && link.a['r:id'] && rels[link.a['r:id']] && rels[link.a['r:id']].extern ? rels[link.a['r:id']].ziel : null;
    var u = rPr.a.u && rPr.a.u !== 'none';
    var inner = esc(t);
    if(href){ html += '<a href="' + esc(href) + '" target="_blank" rel="noopener" style="' + s.join(';') + (u === false ? '' : ';text-decoration:underline') + '">' + inner + '</a>'; }
    else html += '<span style="' + s.join(';') + (u ? ';text-decoration:underline' : '') + '">' + inner + '</span>';
  });
  if(!html){
    var ep = eins(p, 'a:endParaRPr');
    var sz = ep && ep.a.sz ? parseInt(ep.a.sz, 10) / 100 : letzteGroesse;
    html = '<span style="font-size:' + px2(sz * 4 / 3) + 'px">&#8203;</span>';
  }
  if(bu){
    var w = ind < 0 ? px(-ind) : 20;
    html = '<span style="display:inline-block;width:' + w + 'px;text-indent:0;font-size:' + px2((ersteGroesse || letzteGroesse) * 4 / 3) + 'px">' + esc(bu.a.char || '•') + '</span>' + html;
  }
  return '<p style="' + st.join(';') + '">' + html + '</p>';
}

function formElement(sp, rels, medien, nr){
  var spPr = eins(sp, 'p:spPr'), xf = eins(spPr, 'a:xfrm');
  if(!xf) return '';
  var off = eins(xf, 'a:off'), ext = eins(xf, 'a:ext');
  var x = parseInt(off.a.x, 10), y = parseInt(off.a.y, 10), w = parseInt(ext.a.cx, 10), h = parseInt(ext.a.cy, 10);
  var st = ['left:' + px(x) + 'px', 'top:' + px(y) + 'px', 'width:' + px(w) + 'px', 'height:' + px(h) + 'px'];
  var tf = [];
  if(xf.a.rot) tf.push('rotate(' + (parseInt(xf.a.rot, 10) / 60000) + 'deg)');
  if(xf.a.flipH === '1') tf.push('scaleX(-1)');
  if(xf.a.flipV === '1') tf.push('scaleY(-1)');
  if(tf.length) st.push('transform:' + tf.join(' '));
  var geo = pfad(spPr, ['a:prstGeom']), prst = geo ? geo.a.prst : 'rect';
  var gds = {}; if(geo && eins(geo, 'a:avLst')) kind(eins(geo, 'a:avLst'), 'a:gd').forEach(function(g){ gds[g.a.name] = parseInt((g.a.fmla || '').replace(/[^\d-]/g, ''), 10); });
  var pfeil = prst === 'rightArrow';
  if(prst === 'ellipse') st.push('border-radius:50%');
  else if(prst === 'roundRect') st.push('border-radius:' + px2(Math.min(w, h) / PX * (gds.adj != null ? gds.adj : 16667) / 100000) + 'px');
  else if(pfeil) st.push('clip-path:' + pfeilPunkte(w / PX, h / PX, gds.adj1 != null ? gds.adj1 : 50000, gds.adj2 != null ? gds.adj2 : 50000));
  var fc = fuellung(spPr); if(fc) st.push('background:' + fc);
  var ln = eins(spPr, 'a:ln');
  if(ln && ln.a.w && eins(ln, 'a:solidFill') && !pfeil) st.push('border:' + px2(parseInt(ln.a.w, 10) / PX) + 'px solid ' + farbe(eins(ln, 'a:solidFill')) + ';box-sizing:border-box');
  var inhalt = '', tx = eins(sp, 'p:txBody');
  if(tx){
    var bp = eins(tx, 'a:bodyPr') || { a: {}, c: [] };
    var ins = ['lIns', 'tIns', 'rIns', 'bIns'].map(function(k){ return px(parseInt(bp.a[k] != null ? bp.a[k] : (k === 'lIns' || k === 'rIns' ? 91440 : 45720), 10)) + 'px'; });
    var jc = { t: 'flex-start', ctr: 'center', b: 'flex-end' }[bp.a.anchor || 't'] || 'flex-start';
    st.push('display:flex;flex-direction:column;justify-content:' + jc + ';padding:' + ins[1] + ' ' + ins[2] + ' ' + ins[3] + ' ' + ins[0] + ';box-sizing:border-box');
    if(bp.a.wrap === 'none') st.push('white-space:nowrap');
    inhalt = kind(tx, 'a:p').map(function(p){ return absatz(p, rels); }).join('');
  }
  var cnv = pfad(sp, ['p:nvSpPr', 'p:cNvPr']), hl = cnv && eins(cnv, 'a:hlinkClick');
  var link = hl && hl.a['r:id'] && rels[hl.a['r:id']] && rels[hl.a['r:id']].extern ? rels[hl.a['r:id']].ziel : null;
  if(link) inhalt += '<a class="fl-vollink" href="' + esc(link) + '" target="_blank" rel="noopener"></a>';
  return '<div class="fl-el" style="' + st.join(';') + '">' + inhalt + '</div>';
}

function bildElement(pic, rels, medien){
  var spPr = eins(pic, 'p:spPr'), xf = eins(spPr, 'a:xfrm');
  if(!xf) return '';
  var off = eins(xf, 'a:off'), ext = eins(xf, 'a:ext');
  var x = parseInt(off.a.x, 10), y = parseInt(off.a.y, 10), w = parseInt(ext.a.cx, 10), h = parseInt(ext.a.cy, 10);
  var bf = eins(pic, 'p:blipFill'), blip = bf && eins(bf, 'a:blip'), rid = blip && blip.a['r:embed'];
  var quelle = rid && rels[rid] && medien[relPfad('ppt/slides/x', rels[rid].ziel)];
  if(!quelle) return '';
  var sr = eins(bf, 'a:srcRect'), l = 0, r = 0, t = 0, b = 0;
  if(sr){ l = parseInt(sr.a.l || 0, 10) / 100000; r = parseInt(sr.a.r || 0, 10) / 100000; t = parseInt(sr.a.t || 0, 10) / 100000; b = parseInt(sr.a.b || 0, 10) / 100000; }
  var iw = (w / PX) / (1 - l - r), ih = (h / PX) / (1 - t - b);
  var geo = pfad(spPr, ['a:prstGeom']), prst = geo ? geo.a.prst : 'rect', rad = '';
  if(prst === 'ellipse') rad = ';border-radius:50%';
  else if(prst === 'roundRect') rad = ';border-radius:' + px2(Math.min(w, h) / PX * 0.16667) + 'px';
  var descr = pfad(pic, ['p:nvPicPr', 'p:cNvPr']);
  var alt = descr && descr.a.descr && !/^\//.test(descr.a.descr) ? descr.a.descr : '';
  return '<div class="fl-el" style="left:' + px(x) + 'px;top:' + px(y) + 'px;width:' + px(w) + 'px;height:' + px(h) + 'px;overflow:hidden' + rad + '">' +
    '<img alt="' + esc(alt) + '" src="' + quelle + '" style="position:absolute;max-width:none;width:' + px2(iw) + 'px;height:' + px2(ih) + 'px;left:' + px2(-l * iw) + 'px;top:' + px2(-t * ih) + 'px"></div>';
}

function baum(n, rels, medien){
  var out = '';
  n.c.forEach(function(k){
    if(k.n === 'p:sp') out += formElement(k, rels, medien);
    else if(k.n === 'p:pic') out += bildElement(k, rels, medien);
    else if(k.n === 'p:grpSp') out += baum(k, rels, medien);
  });
  return out;
}

function notizText(nx){
  var tree = pfad(nx, ['p:notes', 'p:cSld', 'p:spTree']), out = [];
  if(!tree) return '';
  kind(tree, 'p:sp').forEach(function(sp){
    var ph = pfad(sp, ['p:nvSpPr', 'p:nvPr', 'p:ph']);
    if(!ph || (ph.a.type !== 'body' && ph.a.idx !== '1')) return;
    var tx = eins(sp, 'p:txBody'); if(!tx) return;
    kind(tx, 'a:p').forEach(function(p){ out.push(text(p)); });
  });
  return out.join('\n').replace(/^\s+|\s+$/g, '');
}

/* ---------- Konvertierung ---------- */
async function pptxZuHtml(bytes, opt){
  opt = opt || {};
  var inflate = opt.inflate || standardInflate;
  var eintraege = zipEintraege(bytes), dateien = {}, medien = {};
  async function lies(name){ var e = eintraege[name]; return e ? zipLesen(bytes, e, inflate) : null; }
  var dec = new TextDecoder('utf-8');
  async function holeXml(name){ var d = await lies(name); return d ? dec.decode(d) : null; }
  // Nur XML-Teile und Medien laden
  var namen = Object.keys(eintraege);
  for(var i = 0; i < namen.length; i++){
    var nm = namen[i];
    if(/^ppt\/(slides|notesSlides)\/(_rels\/)?[^\/]+\.xml(\.rels)?$/.test(nm) || nm === 'ppt/presentation.xml' || nm === 'ppt/_rels/presentation.xml.rels' || nm === 'docProps/core.xml'){
      dateien[nm] = dec.decode(await lies(nm));
    } else if(/^ppt\/media\//.test(nm) && mime(nm)){
      var d = await lies(nm);
      medien[nm] = 'data:' + mime(nm) + ';base64,' + base64(opt.bildFilter ? await opt.bildFilter(d, mime(nm)) : d);
    }
  }
  if(!dateien['ppt/presentation.xml']) throw new Error('Keine PowerPoint-Datei (presentation.xml fehlt).');
  var pres = xml(dateien['ppt/presentation.xml']), prels = relsLesen(dateien, 'ppt/presentation.xml');
  var sz = pfad(pres, ['p:presentation', 'p:sldSz']);
  var B = sz ? parseInt(sz.a.cx, 10) / PX : 1280, H = sz ? parseInt(sz.a.cy, 10) / PX : 720;
  var folien = [], notizen = [];
  var ids = pfad(pres, ['p:presentation', 'p:sldIdLst']);
  kind(ids || { c: [] }, 'p:sldId').forEach(function(s){
    var rel = prels[s.a['r:id']]; if(!rel) return;
    var sp = relPfad('ppt/presentation.xml', rel.ziel), dx = dateien[sp];
    if(!dx) return;
    var tree = xml(dx), srels = relsLesen(dateien, sp);
    var cs = pfad(tree, ['p:sld', 'p:cSld']);
    var bg = pfad(cs, ['p:bg', 'p:bgPr']), bgf = bg ? fuellung(bg) : null;
    var inhalt = baum(eins(cs, 'p:spTree'), srels, medien);
    folien.push({ bg: bgf || '#ffffff', html: inhalt });
    var nrel = Object.keys(srels).filter(function(k){ return /notesSlide$/.test(srels[k].typ); })[0];
    var nx = nrel && dateien[relPfad(sp, srels[nrel].ziel)];
    notizen.push(nx ? notizText(xml(nx)) : '');
  });
  if(!folien.length) throw new Error('Die Präsentation enthält keine Folien.');
  var titel = opt.titel;
  if(!titel && dateien['docProps/core.xml']){ var tm = /<dc:title>([^<]+)<\/dc:title>/.exec(dateien['docProps/core.xml']); if(tm) titel = entit(tm[1]); }
  titel = titel || 'Präsentation';
  return { html: deckHtml(titel, B, H, folien, notizen), folien: folien.length, notizen: notizen.filter(Boolean).length, titel: titel };
}

/* ---------- Die HTML-Präsentation ---------- */
function jsonEin(o){ return JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }

var DECK_CSS = [
  ':root{--fl-bg:#1b1d22;--fl-bar:#252830;--fl-ink:#f1f2f4;--fl-dim:#9aa0ab;--fl-acc:#e8b84a;color-scheme:dark}',
  '*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--fl-bg);color:var(--fl-ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}',
  '#fl-app{display:flex;flex-direction:column;height:100%}',
  '#fl-bar{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--fl-bar);flex:none;flex-wrap:wrap}',
  '#fl-bar .t{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1 1 120px}',
  '.fl-b{font:inherit;font-size:13px;color:var(--fl-ink);background:#3a3e49;border:0;border-radius:7px;padding:6px 11px;cursor:pointer;white-space:nowrap}',
  '.fl-b:hover{background:#4a4f5c}.fl-b.on{background:var(--fl-acc);color:#1b1d22}.fl-b:disabled{opacity:.4;cursor:default}',
  '#fl-nr{font-variant-numeric:tabular-nums;font-size:13px;color:var(--fl-dim);min-width:56px;text-align:center}',
  '#fl-main{flex:1;display:flex;min-height:0}',
  '#fl-stage{flex:1;position:relative;min-width:0;min-height:0}',
  '.fl-fit{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:10px}',
  '.fl-box{position:relative;overflow:hidden;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.45);flex:none}',
  '.fl-box>.fl-sl{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden}',
  '.fl-el{position:absolute;margin:0;font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.2}',
  '.fl-el p{margin:0;min-height:1px}.fl-el a{color:inherit}',
  '.fl-vollink{position:absolute;inset:0}',
  '#fl-notes{width:min(34%,420px);background:#f6f4ee;color:#1d1d1d;overflow:auto;padding:14px 16px;font-size:16px;line-height:1.5;flex:none;border-left:1px solid #000;display:none;white-space:pre-wrap}',
  '#fl-notes h4{margin:0 0 8px;font:600 12px system-ui;color:#777;text-transform:uppercase;letter-spacing:.06em}',
  '.fl-leer{color:#888;font-style:italic}',
  '#fl-grid{position:absolute;inset:0;background:var(--fl-bg);overflow:auto;padding:14px;display:none;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;align-content:start}',
  '#fl-grid .z{cursor:pointer;border-radius:6px;padding:4px;background:#2c303a;border:2px solid transparent}#fl-grid .z.akt{border-color:var(--fl-acc)}',
  '#fl-grid .z .fl-box{box-shadow:none;width:100%}#fl-grid .z span{display:block;font-size:12px;color:var(--fl-dim);padding:3px 2px 0}',
  'body.fl-voll #fl-bar{display:none}body.fl-voll .fl-fit{padding:0}body.fl-voll .fl-box{box-shadow:none}',
  '#fl-schwarz{position:fixed;inset:0;background:#000;z-index:9;display:none}',
  '@media (max-width:760px){#fl-notes{position:absolute;right:0;top:0;bottom:0;width:86%;z-index:3}}'
].join('');

function deckHtml(titel, B, H, folien, notizen){
  var daten = { b: B, h: H, folien: folien, notizen: notizen };
  return '<!doctype html>\n<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(titel) + '</title><style>' + DECK_CSS + '</style></head><body>' +
    '<div id="fl-app"><div id="fl-bar"><span class="t" id="fl-titel"></span>' +
    '<button class="fl-b" id="fl-zurueck" title="Vorherige Folie (←)">‹</button><span id="fl-nr"></span><button class="fl-b" id="fl-weiter" title="Nächste Folie (→)">›</button>' +
    '<button class="fl-b" id="fl-uebersicht" title="Alle Folien (G)">▦ Übersicht</button>' +
    '<button class="fl-b" id="fl-notizen" title="Notizen neben der Folie (N)" style="display:none">📝 Notizen</button>' +
    '<button class="fl-b" id="fl-referent" title="Zweites Fenster mit Notizen für den Laptop — die Klasse sieht nur die Folien (P)" style="display:none">🎤 Referentenansicht</button>' +
    '<button class="fl-b" id="fl-voll" title="Vollbild (F)">⛶ Vollbild</button></div>' +
    '<div id="fl-main"><div id="fl-stage"><div class="fl-fit" id="fl-fit"></div><div id="fl-grid"></div></div><div id="fl-notes"></div></div></div><div id="fl-schwarz"></div>' +
    '<script>var FL=' + jsonEin(daten) + ';var FL_TITEL=' + jsonEin(titel) + ';var FL_CSS=' + jsonEin(DECK_CSS) + ';\n' + DECK_JS + '<\/script></body></html>';
}

/* Laufzeit der Präsentation (steht als Text in jeder erzeugten Datei). */
var DECK_JS = '(' + function(){
  var N = FL.folien.length, i = 0, lehrer = false, pw = null, pwTimer = null, t0 = 0, schwarz = false;
  try{ lehrer = !!window.__libLehrer || (window.parent === window && !window.opener); }catch(e){}
  function $(id){ return document.getElementById(id); }
  function boxHtml(k){ return '<div class="fl-box"><div class="fl-sl" style="width:' + FL.b + 'px;height:' + FL.h + 'px;background:' + FL.folien[k].bg + '">' + FL.folien[k].html + '</div></div>'; }
  // Bühne in den verfügbaren Platz einpassen (feste Proportion)
  function pass(box, w, h){
    var s = Math.min(w / FL.b, h / FL.h);
    if(!(s > 0)) return;
    box.style.width = FL.b * s + 'px'; box.style.height = FL.h * s + 'px';
    var sl = box.firstChild; sl.style.transform = 'scale(' + s + ')';
  }
  function fitIn(host, pad){
    var box = host.querySelector('.fl-box'); if(!box) return;
    var cs = host.getBoundingClientRect(); pass(box, cs.width - pad * 2, cs.height - pad * 2);
  }
  var fit = $('fl-fit');
  function zeige(k){
    i = Math.max(0, Math.min(N - 1, k));
    fit.innerHTML = boxHtml(i);
    fitIn(fit, document.body.classList.contains('fl-voll') ? 0 : 10);
    $('fl-nr').textContent = (i + 1) + ' / ' + N;
    $('fl-zurueck').disabled = i === 0; $('fl-weiter').disabled = i === N - 1;
    if(lehrer) notiz();
    if(pw && !pw.closed) refPaint();
    var g = $('fl-grid'); if(g.style.display === 'grid') [].forEach.call(g.children, function(c, n){ c.classList.toggle('akt', n === i); });
  }
  window.__folie = { go: function(k){ zeige(k); }, next: function(){ zeige(i + 1); }, prev: function(){ zeige(i - 1); } };
  function notiz(){
    var n = FL.notizen[i];
    $('fl-notes').innerHTML = '<h4>Notizen · Folie ' + (i + 1) + '</h4>' + (n ? '' : '<span class="fl-leer">Keine Notizen zu dieser Folie.</span>');
    if(n) $('fl-notes').appendChild(document.createTextNode(n));
  }
  // Übersicht
  function uebersicht(){
    var g = $('fl-grid');
    if(g.style.display === 'grid'){ g.style.display = 'none'; $('fl-uebersicht').classList.remove('on'); return; }
    if(!g.children.length){
      FL.folien.forEach(function(f, k){
        var d = document.createElement('div'); d.className = 'z'; d.innerHTML = boxHtml(k) + '<span>' + (k + 1) + '</span>';
        d.onclick = function(){ g.style.display = 'none'; $('fl-uebersicht').classList.remove('on'); zeige(k); };
        g.appendChild(d);
      });
    }
    g.style.display = 'grid'; $('fl-uebersicht').classList.add('on');
    [].forEach.call(g.children, function(c, n){ c.classList.toggle('akt', n === i); var b = c.querySelector('.fl-box'); pass(b, c.clientWidth - 8, 9999); });
    var a = g.children[i]; if(a && a.scrollIntoView) a.scrollIntoView({ block: 'center' });
  }
  // Vollbild: in der Library über deren Vollbild-Knopf (zeigt auch den Ausstieg), sonst direkt
  function istVoll(){
    try{ if(window.parent !== window && window.parent.document.fullscreenElement) return true; }catch(e){}
    return !!document.fullscreenElement || document.body.classList.contains('fl-voll');
  }
  function voll(){
    var P = null; try{ P = window.parent !== window ? window.parent : null; }catch(e){}
    var fs = P && P.document.getElementById('fsBtn');
    if(fs){ if(!P.document.fullscreenElement) fs.click(); else if(P.document.exitFullscreen) P.document.exitFullscreen(); return; }
    if(document.fullscreenElement){ document.exitFullscreen(); return; }
    var el = document.documentElement;
    (el.requestFullscreen ? el.requestFullscreen() : Promise.reject()).catch(function(){ document.body.classList.toggle('fl-voll'); relayout(); });
  }
  function vollStand(){
    var v = false;
    try{ v = !!document.fullscreenElement || (window.parent !== window && !!window.parent.document.fullscreenElement); }catch(e){}
    document.body.classList.toggle('fl-voll', v);
    $('fl-voll').classList.toggle('on', v);
    relayout();
  }
  function relayout(){ fitIn(fit, document.body.classList.contains('fl-voll') ? 0 : 10); }
  document.addEventListener('fullscreenchange', vollStand);
  try{ if(window.parent !== window) window.parent.document.addEventListener('fullscreenchange', vollStand); }catch(e){}
  window.addEventListener('resize', function(){ relayout(); var g = $('fl-grid'); if(g.style.display === 'grid') [].forEach.call(g.children, function(c){ pass(c.querySelector('.fl-box'), c.clientWidth - 8, 9999); }); });
  // 🎤 Referentenansicht: zweites Fenster für den Laptop, dieses Fenster zeigt der Klasse nur die Folie
  function refPaint(){
    var d = pw.document, cur = d.getElementById('r-cur'), nxt = d.getElementById('r-next');
    cur.innerHTML = boxHtml(i); fitIn(cur, 0);
    if(i + 1 < N){ nxt.innerHTML = boxHtml(i + 1); fitIn(nxt, 0); } else nxt.innerHTML = '<div class="r-ende">Ende der Präsentation</div>';
    d.getElementById('r-nr').textContent = 'Folie ' + (i + 1) + ' von ' + N;
    var n = d.getElementById('r-notes'), t = FL.notizen[i];
    n.textContent = t || ''; n.className = t ? '' : 'leer'; if(!t) n.textContent = 'Keine Notizen zu dieser Folie.';
    n.scrollTop = 0;
  }
  function refZeit(){
    if(!pw || pw.closed){ clearInterval(pwTimer); pw = null; $('fl-referent').classList.remove('on'); return; }
    var d = pw.document, s = Math.floor((Date.now() - t0) / 1000), z = function(x){ return (x < 10 ? '0' : '') + x; };
    d.getElementById('r-timer').textContent = z(Math.floor(s / 60)) + ':' + z(s % 60);
    var n = new Date(); d.getElementById('r-uhr').textContent = z(n.getHours()) + ':' + z(n.getMinutes());
  }
  var REF_CSS = FL_CSS + 'body{overflow:hidden}#r{display:grid;grid-template-columns:1.55fr 1fr;grid-template-rows:auto 1fr;height:100vh;gap:10px;padding:10px}' +
    '#r-top{grid-column:1/3;display:flex;align-items:center;gap:10px;flex-wrap:wrap}#r-top .sp{flex:1}#r-timer{font:600 26px ui-monospace,Menlo,monospace;color:#e8b84a}#r-uhr{color:#9aa0ab;font-size:15px}' +
    '#r-links{display:flex;flex-direction:column;gap:8px;min-height:0}#r-cur{flex:1;position:relative;min-height:0}#r-rechts{display:flex;flex-direction:column;gap:8px;min-height:0}' +
    '#r-next{height:30%;position:relative;opacity:.85;min-height:90px}.r-ende{display:flex;align-items:center;justify-content:center;height:100%;color:#9aa0ab;border:1px dashed #555;border-radius:6px}' +
    '.r-cap{font:600 11px system-ui;color:#9aa0ab;text-transform:uppercase;letter-spacing:.07em}' +
    '#r-notes{flex:1;overflow:auto;background:#f6f4ee;color:#1d1d1d;border-radius:8px;padding:14px 16px;line-height:1.5;white-space:pre-wrap;font-size:22px}#r-notes.leer{color:#888;font-style:italic}' +
    '#r-cur,#r-next{display:flex;align-items:flex-start;justify-content:flex-start}#r-links,#r-rechts{min-width:0}';
  function referent(){
    if(pw && !pw.closed){ pw.focus(); return; }
    pw = window.open('', 'folienReferent', 'width=1280,height=800');
    if(!pw){ notizenSeite(true); alert('Das Zusatzfenster wurde vom Browser blockiert. Bitte Pop-ups für diese Seite erlauben — bis dahin stehen die Notizen neben der Folie.'); return; }
    var d = pw.document;
    d.open();
    d.write('<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Referentenansicht · ' + FL_TITEL.replace(/</g, '&lt;') + '</title><style>' + REF_CSS + '</style></head><body>' +
      '<div id="r"><div id="r-top"><button class="fl-b" id="r-z">‹ Zurück</button><button class="fl-b" id="r-w">Weiter ›</button><span id="r-nr"></span><span class="sp"></span>' +
      '<button class="fl-b" id="r-a">A−</button><button class="fl-b" id="r-b">A+</button><button class="fl-b" id="r-s" title="Klasse sieht schwarz (B)">⬛ Schwarz</button><button class="fl-b" id="r-reset" title="Stoppuhr auf null">⟲</button>' +
      '<span id="r-timer">00:00</span><span id="r-uhr"></span></div>' +
      '<div id="r-links"><div class="r-cap">Jetzt</div><div id="r-cur"></div></div>' +
      '<div id="r-rechts"><div class="r-cap">Als Nächstes</div><div id="r-next"></div><div class="r-cap">Notizen</div><div id="r-notes"></div></div></div></body></html>');
    d.close();
    t0 = Date.now();
    d.getElementById('r-z').onclick = function(){ zeige(i - 1); };
    d.getElementById('r-w').onclick = function(){ zeige(i + 1); };
    var fs = 22, nn = d.getElementById('r-notes');
    d.getElementById('r-a').onclick = function(){ fs = Math.max(12, fs - 2); nn.style.fontSize = fs + 'px'; };
    d.getElementById('r-b').onclick = function(){ fs = Math.min(60, fs + 2); nn.style.fontSize = fs + 'px'; };
    d.getElementById('r-s').onclick = blackout;
    d.getElementById('r-reset').onclick = function(){ t0 = Date.now(); };
    d.addEventListener('keydown', taste);
    pw.addEventListener('resize', function(){ if(pw && !pw.closed) refPaint(); });
    pw.addEventListener('beforeunload', function(){ $('fl-referent').classList.remove('on'); });
    $('fl-referent').classList.add('on');
    pwTimer = setInterval(refZeit, 500);
    refPaint(); refZeit();
    // Dieses Fenster zeigt der Klasse nur die Folie: Notizen zu, Vollbild an
    $('fl-notes').style.display = 'none'; $('fl-notizen').classList.remove('on');
    zweiBildschirme();
  }
  // Wie PowerPoint: Referentenansicht automatisch auf den Laptop-Bildschirm, Folien im Vollbild auf den Beamer.
  // Braucht Chrome/Edge (Fensterverwaltung, beim ersten Mal einmal «Zulassen») und erweiterten Desktop (nicht gespiegelt).
  function zweiBildschirme(){
    var P = null; try{ P = window.parent !== window ? window.parent : null; }catch(e){}
    var W = P || window;
    if(!W.getScreenDetails){ if(!istVoll()) voll(); return; }
    W.getScreenDetails().then(function(det){
      var sc = det.screens;
      if(sc.length < 2){ if(!istVoll()) voll(); return; }
      var laptop = sc.filter(function(x){ return x.isInternal; })[0] || det.primaryScreen || sc[0];
      var beamer = sc.filter(function(x){ return x !== laptop; })[0];
      if(pw && !pw.closed){
        try{ pw.moveTo(laptop.availLeft, laptop.availTop); pw.resizeTo(laptop.availWidth, laptop.availHeight); }catch(e){}
      }
      var el = null;
      try{ el = P ? P.document.getElementById('frameWrap') : null; }catch(e){}
      el = el || document.documentElement;
      var pr = el.requestFullscreen ? el.requestFullscreen({ screen: beamer }) : Promise.reject();
      pr.catch(function(){ if(!istVoll()) voll(); });
    }).catch(function(){ if(!istVoll()) voll(); });
  }
  function blackout(){ schwarz = !schwarz; $('fl-schwarz').style.display = schwarz ? 'block' : 'none'; if(pw && !pw.closed) pw.document.getElementById('r-s').classList.toggle('on', schwarz); }
  function notizenSeite(an){
    var n = $('fl-notes'); var zeigen = an == null ? n.style.display !== 'block' : an;
    n.style.display = zeigen ? 'block' : 'none'; $('fl-notizen').classList.toggle('on', zeigen); relayout();
  }
  function taste(e){
    if(e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;
    if(k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Enter' || k === 'ArrowDown'){ e.preventDefault(); zeige(i + 1); }
    else if(k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace' || k === 'ArrowUp'){ e.preventDefault(); zeige(i - 1); }
    else if(k === 'Home'){ zeige(0); } else if(k === 'End'){ zeige(N - 1); }
    else if(k === 'f' || k === 'F'){ voll(); }
    else if(k === 'g' || k === 'G'){ uebersicht(); }
    else if((k === 'n' || k === 'N') && lehrer){ notizenSeite(); }
    else if((k === 'p' || k === 'P') && lehrer){ referent(); }
    else if(k === 'b' || k === 'B' || k === '.'){ if(lehrer) blackout(); }
    else if(k === 'Escape' && schwarz){ blackout(); }
  }
  document.addEventListener('keydown', taste);
  // Wischen
  var tx = null;
  fit.addEventListener('touchstart', function(e){ tx = e.touches[0].clientX; }, { passive: true });
  fit.addEventListener('touchend', function(e){ if(tx == null) return; var dx = e.changedTouches[0].clientX - tx; tx = null; if(Math.abs(dx) > 50) zeige(i + (dx < 0 ? 1 : -1)); });
  $('fl-titel').textContent = FL_TITEL;
  $('fl-zurueck').onclick = function(){ zeige(i - 1); };
  $('fl-weiter').onclick = function(){ zeige(i + 1); };
  $('fl-uebersicht').onclick = uebersicht;
  $('fl-voll').onclick = voll;
  if(lehrer){
    $('fl-notizen').style.display = ''; $('fl-referent').style.display = '';
    $('fl-notizen').onclick = function(){ notizenSeite(); };
    $('fl-referent').onclick = referent;
  }
  window.addEventListener('beforeunload', function(){ try{ if(pw && !pw.closed) pw.close(); }catch(e){} });
  zeige(0);
} + ')();';

var api = { pptxZuHtml: pptxZuHtml, deckHtml: deckHtml };
if(typeof module !== 'undefined' && module.exports) module.exports = api;
root.FolienKonverter = api;
})(typeof window !== 'undefined' ? window : globalThis);
