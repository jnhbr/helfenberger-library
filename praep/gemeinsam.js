/* Gemeinsame Teile von Sport-Bausteinen (index.html) und Präp-Werkstatt (werkstatt.html): Daten laden, Karten zeichnen. */
(function(){
  var PHASEN = [
    {id:'einstieg',name:'Einstieg'},{id:'aufwaermen',name:'Aufwärmen'},{id:'spiel',name:'Spiel / Spielform'},{id:'technik',name:'Technik'},
    {id:'intervention',name:'Intervention'},{id:'komplex',name:'Komplexeres Spiel'},{id:'abschluss',name:'Abschluss'},{id:'check',name:'Check / Beurteilung'},{id:'alt',name:'Alternative'}];
  var ARTEN = {baustein:'Baustein', intervention:'Intervention', regelkarte:'Regelkarte', check:'Beurteilung', alternativ:'Alternativspiel'};
  var HALLE = {E:'Einfachhalle', D:'Doppelhalle', A:'draussen'};
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function holen(u){ return fetch(u).then(function(r){ if(!r.ok) throw new Error(u); return r.json(); }); }
  // Lädt alle Sportarten + Alternativspiele: {sportarten:[...], daten:{id:[items]}, alle:{itemId:item}}
  function laden(){
    var V = 'v=6', out = {sportarten:[], daten:{}, alle:{}};
    return holen('daten/index.json?'+V).then(function(ix){
      var jobs = ix.sportarten.map(function(s){ return holen('daten/'+s.datei+'?'+V).then(function(d){ out.sportarten.push(d.sportart); out.daten[d.sportart.id] = d.items; }); });
      jobs.push(holen('daten/'+ix.alternativ+'?'+V).then(function(d){ out.daten.alternativ = d.items; }));
      return Promise.all(jobs).then(function(){
        var reihenfolge = ix.sportarten.map(function(s){ return s.id; });
        out.sportarten.sort(function(a, b){ return reihenfolge.indexOf(a.id) - reihenfolge.indexOf(b.id); });
        Object.keys(out.daten).forEach(function(k){ out.daten[k].forEach(function(i){ out.alle[i.id] = i; }); });
        return out;
      });
    });
  }
  /* ---------- Skizzen (SVG aus einer kleinen Beschreibung) ----------
     d = {w,h,e:[...]} in Metern; Elemente:
     z Zone {x,y,w,h,c,d,s} · l Linie {x1,y1,x2,y2,d} · k Kreis {x,y,r,c} · p Person {x,y,t,n} (t: r rot, b blau, g grün, y gelb, k Fänger/Lehrperson, w weiss)
     b Ball {x,y} · c Hütchen {x,y} · m Matte {x,y,w,h} · t Tor {x,y,w,o: n s e w} · o Reifen {x,y} · a Pfeil {x1,y1,x2,y2,k: lauf|pass|dribbel|wurf} · x Text {x,y,s,f} */
  var PF = {r:'#E03131', b:'#1971C2', g:'#2F9E44', y:'#F2C200', k:'#212529', w:'#F8F9FA', o:'#F08316'};
  var AF = {lauf:['#212529', ''], pass:['#1971C2', '0.35 0.25'], dribbel:['#7048E8', '0.12 0.22'], wurf:['#E03131', '0.35 0.25']};
  var dgN = 0;
  function dg(d){
    if(!d || !d.e) return '';
    var id = 'dg' + (++dgN), W = d.w, H = d.h, s = '<svg class="dg" viewBox="-0.8 -0.8 ' + (W + 1.6) + ' ' + (H + 1.6) + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + esc(d.alt || 'Skizze') + '"><defs>';
    Object.keys(AF).forEach(function(k){ s += '<marker id="' + id + k + '" markerWidth="3" markerHeight="3" refX="2.6" refY="1.5" orient="auto" markerUnits="strokeWidth" viewBox="0 0 3 3"><path d="M0,0 L3,1.5 L0,3 z" fill="' + AF[k][0] + '"/></marker>'; });
    s += '</defs><rect x="0" y="0" width="' + W + '" height="' + H + '" rx="0.4" fill="' + (d.bg || '#F4EFE0') + '" stroke="#9C9580" stroke-width="0.12"/>';
    d.e.forEach(function(e){
      var t = e.t;
      if(t === 'z') s += '<rect x="' + e.x + '" y="' + e.y + '" width="' + e.w + '" height="' + e.h + '" fill="' + (e.c || '#74C0FC') + '" fill-opacity="0.35" stroke="' + (e.c || '#1971C2') + '" stroke-width="0.1"' + (e.d ? ' stroke-dasharray="0.4 0.3"' : '') + '/>' + (e.s ? '<text x="' + (e.x + e.w / 2) + '" y="' + (e.y + e.h / 2 + 0.3) + '" text-anchor="middle" font-size="' + (e.f || 0.9) + '" fill="#333" font-family="Calibri,Arial,sans-serif" font-weight="700">' + esc(e.s) + '</text>' : '');
      else if(t === 'l') s += '<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '" stroke="' + (e.c || '#6B6B66') + '" stroke-width="0.12"' + (e.d ? ' stroke-dasharray="0.4 0.3"' : '') + '/>';
      else if(t === 'k') s += '<circle cx="' + e.x + '" cy="' + e.y + '" r="' + e.r + '" fill="' + (e.c || '#74C0FC') + '" fill-opacity="0.3" stroke="' + (e.c || '#1971C2') + '" stroke-width="0.1"' + (e.d ? ' stroke-dasharray="0.4 0.3"' : '') + '/>' + (e.s ? '<text x="' + e.x + '" y="' + (e.y + 0.3) + '" text-anchor="middle" font-size="0.9" fill="#333" font-family="Calibri,Arial,sans-serif" font-weight="700">' + esc(e.s) + '</text>' : '');
      else if(t === 'p') s += '<circle cx="' + e.x + '" cy="' + e.y + '" r="0.5" fill="' + (PF[e.t2 || e.c] || PF.w) + '" stroke="#fff" stroke-width="0.12"/>' + (e.n != null ? '<text x="' + e.x + '" y="' + (e.y + 0.28) + '" text-anchor="middle" font-size="0.75" fill="' + ((e.t2 || e.c) === 'w' || (e.t2 || e.c) === 'y' ? '#222' : '#fff') + '" font-family="Calibri,Arial,sans-serif" font-weight="700">' + esc(e.n) + '</text>' : '');
      else if(t === 'b') s += '<circle cx="' + e.x + '" cy="' + e.y + '" r="0.28" fill="#F08316" stroke="#7A3A00" stroke-width="0.07"/>';
      else if(t === 'c') s += '<path d="M' + e.x + ' ' + (e.y - 0.38) + ' L' + (e.x + 0.34) + ' ' + (e.y + 0.3) + ' L' + (e.x - 0.34) + ' ' + (e.y + 0.3) + ' Z" fill="#E8590C" stroke="#fff" stroke-width="0.05"/>';
      else if(t === 'm') s += '<rect x="' + e.x + '" y="' + e.y + '" width="' + e.w + '" height="' + e.h + '" rx="0.15" fill="#2C3E8C" stroke="#8EA2E0" stroke-width="0.08"/>' + (e.s ? '<text x="' + (e.x + e.w / 2) + '" y="' + (e.y + e.h / 2 + 0.25) + '" text-anchor="middle" font-size="0.7" fill="#fff" font-family="Calibri,Arial,sans-serif">' + esc(e.s) + '</text>' : '');
      else if(t === 't'){ var w = e.w || 3, o = e.o || 'n', r = {n:0, e:90, s:180, w:270}[o]; s += '<g transform="translate(' + e.x + ' ' + e.y + ') rotate(' + r + ')"><rect x="' + (-w / 2) + '" y="-0.25" width="' + w + '" height="0.5" fill="#fff" stroke="#E03131" stroke-width="0.12"/></g>'; }
      else if(t === 'o') s += '<circle cx="' + e.x + '" cy="' + e.y + '" r="' + (e.r || 0.55) + '" fill="none" stroke="' + (e.c || '#E03131') + '" stroke-width="0.14"/>';
      else if(t === 'a'){ var k = AF[e.k || 'lauf']; s += '<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '" stroke="' + k[0] + '" stroke-width="0.14"' + (k[1] ? ' stroke-dasharray="' + k[1] + '"' : '') + ' marker-end="url(#' + id + (e.k || 'lauf') + ')"' + (e.k === 'dribbel' ? ' stroke-linecap="round"' : '') + '/>'; }
      else if(t === 'x') s += '<text x="' + e.x + '" y="' + e.y + '" text-anchor="' + (e.a || 'middle') + '" font-size="' + (e.f || 0.9) + '" fill="#333" font-family="Calibri,Arial,sans-serif" font-weight="' + (e.b ? 700 : 400) + '">' + esc(e.s) + '</text>';
    });
    return s + '</svg>';
  }
  var PERSP = ['Leistung','Miteinander','Gesundheit','Ausdruck','Eindruck','Wagnis'];
  var PERSPFARBE = {Leistung:'#C0392B',Miteinander:'#2E86C1',Gesundheit:'#27AE60',Ausdruck:'#8E44AD',Eindruck:'#16A085',Wagnis:'#D35400'};
  function lpHtml(i){
    if(!i.bereich) return '';
    return '<div class="lp"><span class="lpb" title="Kompetenzbereich Lehrplan 21: Bewegung und Sport">LP21 · '+esc(i.bereich)+'</span>'+(i.perspektiven || []).map(function(p){ return '<span class="lpp" style="--pc:'+(PERSPFARBE[p] || '#666')+'" title="Pädagogische Perspektive">'+esc(p)+'</span>'; }).join('')+'</div>';
  }

  /* ---------- Favoriten (nur im Browser) + Navigation ---------- */
  var FAVK = 'praep_fav_v1';
  function favGet(){ try{ return JSON.parse(localStorage.getItem(FAVK) || '[]'); }catch(e){ return []; } }
  function favIs(id){ return favGet().indexOf(id) >= 0; }
  function favToggle(id){ var f = favGet(), k = f.indexOf(id); if(k >= 0) f.splice(k, 1); else f.push(id); try{ localStorage.setItem(FAVK, JSON.stringify(f)); }catch(e){} return k < 0; }
  document.addEventListener('click', function(e){
    var b = e.target.closest ? e.target.closest('[data-fav]') : null; if(!b) return;
    var an = favToggle(b.dataset.fav);
    document.querySelectorAll('[data-fav="'+b.dataset.fav+'"]').forEach(function(x){ x.textContent = an ? '★' : '☆'; x.classList.toggle('an', an); });
    if(window.Praep && Praep.onFav) Praep.onFav(b.dataset.fav, an);
  });
  var NAV = [['index.html','🧱 Bausteine'], ['werkstatt.html','🛠️ Präp-Werkstatt'], ['jahresplan.html','🗓️ Jahresplanung'], ['noten.html','🧮 Notenrechner'], ['turnier.html','🏆 Turnierplan']];
  function nav(aktiv){
    return '<nav class="pnav">'+NAV.map(function(n){ return '<a class="pn'+(n[0] === aktiv ? ' an' : '')+'" href="'+n[0]+'">'+n[1]+'</a>'; }).join('')+'</nav>';
  }
  function phaseName(id){ return (PHASEN.filter(function(p){ return p.id === id; })[0] || {}).name || ''; }
  // opts.klasse: zusätzliche CSS-Klasse, opts.aktion: HTML am Ende (Knöpfe), opts.kurz: nur Kopf + Meta (ohne Beschreibung)
  function karteHtml(i, opts){
    opts = opts || {};
    var ph = i.phase || 'spiel';
    var h = '<div class="karte t-'+esc(ph)+(opts.klasse ? ' '+opts.klasse : '')+'" data-id="'+esc(i.id)+'"><div class="kh"><span class="code">'+esc(i.code)+'</span><h3>'+esc(i.titel)+'</h3>'+
      '<span class="typ">'+esc(ARTEN[i.art] || '')+' · '+esc(phaseName(ph))+'</span>'+(opts.fav === false ? '' : '<button class="fav'+(favIs(i.id) ? ' an' : '')+'" data-fav="'+esc(i.id)+'" type="button" title="Favorit">'+(favIs(i.id) ? '★' : '☆')+'</button>')+'</div>';
    var m = [];
    h += lpHtml(i);
    if(i.halle && i.halle.length) m.push('<span><b>Ort:</b> '+i.halle.map(function(x){ return HALLE[x] || x; }).join(' / ')+'</span>');
    if(i.gruppe) m.push('<span><b>Gruppe:</b> '+esc(i.gruppe)+'</span>');
    if(i.dauer) m.push('<span><b>Dauer:</b> '+esc(i.dauer)+'</span>');
    if(i.material) m.push('<span><b>Material:</b> '+esc(i.material)+'</span>');
    if(i.felder) m.push('<span><b>Felder:</b> '+esc(i.felder)+'</span>');
    if(i.wann) m.push('<span><b>Wann:</b> '+esc(i.wann)+'</span>');
    if(i.fokus) m.push('<span><b>Fokus:</b> '+esc(i.fokus)+'</span>');
    if(m.length) h += '<div class="meta">'+m.join('')+'</div>';
    if(!opts.kurz){
      (i.beschreibung || []).forEach(function(p){ h += '<p>'+esc(p)+'</p>'; });
      if(i.diagramm) h += '<div class="dgw">'+dg(i.diagramm)+(i.diagramm.legende ? '<div class="dgl">'+esc(i.diagramm.legende)+'</div>' : '')+'</div>';
      if(i.punkte && i.punkte.length) h += '<ul>'+i.punkte.map(function(p){ return '<li>'+esc(p)+'</li>'; }).join('')+'</ul>';
      if(i.iv) h += '<div class="iv">'+i.iv.map(function(r){ return '<span class="l">'+esc(r.k)+'</span><span>'+esc(r.t)+'</span>'; }).join('')+'</div>';
      if(i.tabelle) h += '<table>'+i.tabelle.map(function(r, k){ return '<tr>'+r.map(function(c){ return (k === 0 ? '<th>' : '<td>')+esc(c)+(k === 0 ? '</th>' : '</td>'); }).join('')+'</tr>'; }).join('')+'</table>';
      if(i.zusatz){ h += '<div class="zusatz">'+Object.keys(i.zusatz).map(function(k){ return '<b>'+esc(k)+':</b> '+esc(i.zusatz[k]); }).join(' · ')+'</div>'; }
    }
    return h+(opts.aktion ? '<div class="aktion">'+opts.aktion+'</div>' : '')+'</div>';
  }
  window.Praep = {nav:nav, favIs:favIs, favGet:favGet, favToggle:favToggle, dg:dg, PERSP:PERSP, PERSPFARBE:PERSPFARBE, PHASEN:PHASEN, ARTEN:ARTEN, HALLE:HALLE, esc:esc, holen:holen, laden:laden, karteHtml:karteHtml, phaseName:phaseName};
})();
