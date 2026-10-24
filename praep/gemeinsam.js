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
    var V = 'v=3', out = {sportarten:[], daten:{}, alle:{}};
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
  var PERSP = ['Leistung','Miteinander','Gesundheit','Ausdruck','Eindruck','Wagnis'];
  var PERSPFARBE = {Leistung:'#C0392B',Miteinander:'#2E86C1',Gesundheit:'#27AE60',Ausdruck:'#8E44AD',Eindruck:'#16A085',Wagnis:'#D35400'};
  function lpHtml(i){
    if(!i.bereich) return '';
    return '<div class="lp"><span class="lpb" title="Kompetenzbereich Lehrplan 21: Bewegung und Sport">LP21 · '+esc(i.bereich)+'</span>'+(i.perspektiven || []).map(function(p){ return '<span class="lpp" style="--pc:'+(PERSPFARBE[p] || '#666')+'" title="Pädagogische Perspektive">'+esc(p)+'</span>'; }).join('')+'</div>';
  }
  function phaseName(id){ return (PHASEN.filter(function(p){ return p.id === id; })[0] || {}).name || ''; }
  // opts.klasse: zusätzliche CSS-Klasse, opts.aktion: HTML am Ende (Knöpfe), opts.kurz: nur Kopf + Meta (ohne Beschreibung)
  function karteHtml(i, opts){
    opts = opts || {};
    var ph = i.phase || 'spiel';
    var h = '<div class="karte t-'+esc(ph)+(opts.klasse ? ' '+opts.klasse : '')+'" data-id="'+esc(i.id)+'"><div class="kh"><span class="code">'+esc(i.code)+'</span><h3>'+esc(i.titel)+'</h3>'+
      '<span class="typ">'+esc(ARTEN[i.art] || '')+' · '+esc(phaseName(ph))+'</span></div>';
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
      if(i.punkte && i.punkte.length) h += '<ul>'+i.punkte.map(function(p){ return '<li>'+esc(p)+'</li>'; }).join('')+'</ul>';
      if(i.iv) h += '<div class="iv">'+i.iv.map(function(r){ return '<span class="l">'+esc(r.k)+'</span><span>'+esc(r.t)+'</span>'; }).join('')+'</div>';
      if(i.tabelle) h += '<table>'+i.tabelle.map(function(r, k){ return '<tr>'+r.map(function(c){ return (k === 0 ? '<th>' : '<td>')+esc(c)+(k === 0 ? '</th>' : '</td>'); }).join('')+'</tr>'; }).join('')+'</table>';
      if(i.zusatz){ h += '<div class="zusatz">'+Object.keys(i.zusatz).map(function(k){ return '<b>'+esc(k)+':</b> '+esc(i.zusatz[k]); }).join(' · ')+'</div>'; }
    }
    return h+(opts.aktion ? '<div class="aktion">'+opts.aktion+'</div>' : '')+'</div>';
  }
  window.Praep = {PERSP:PERSP, PERSPFARBE:PERSPFARBE, PHASEN:PHASEN, ARTEN:ARTEN, HALLE:HALLE, esc:esc, holen:holen, laden:laden, karteHtml:karteHtml, phaseName:phaseName};
})();
