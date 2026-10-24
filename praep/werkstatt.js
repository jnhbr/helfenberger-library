/* Präp-Werkstatt (Sport) – Reihe aus Bausteinen, Aufbau aus dem Hallenplaner, Druck. Speicher: localStorage praep_reihen_v1. */
(function(){
  var P = Praep, esc = P.esc;
  var SPEICHER = 'praep_reihen_v1';
  var PHASEN = [
    {id:'einstieg', name:'Einstieg', hilfe:['einstieg'], zeit:'Beginn'},
    {id:'einspielen', name:'Einspielen / Aufwärmen', hilfe:['aufwaermen','technik','einstieg'], zeit:''},
    {id:'spiel', name:'Spiel', hilfe:['spiel','komplex','check'], regel:true, zeit:''},
    {id:'intervenieren', name:'Intervenieren', hilfe:['intervention','technik','spiel'], zeit:''},
    {id:'abschluss', name:'Abschluss', hilfe:['abschluss','alt','check'], zeit:''},
    {id:'kreis', name:'Kreis', hilfe:[], zeit:''}
  ];
  var VORLAGEN_HP = [{id:'v:0', n:'Volleyball 3:3 – drei Kleinfelder', sport:'volleyball'}, {id:'v:1', n:'Basketball 3:3 – EasyBasket', sport:'basketball'}, {id:'v:2', n:'Fussball 3:3 – Kleinfelder mit vier Toren', sport:'fussball'}, {id:'v:3', n:'Handball 3:3 – Softhandball quer', sport:'handball'}, {id:'v:4', n:'Unihockey 3:3 – Kleinfelder', sport:'unihockey'}, {id:'v:5', n:'Zirkeltraining – 8 Posten', sport:'geraete'}];
  function vorlageVon(sport){ var v = VORLAGEN_HP.filter(function(x){ return x.sport === sport; })[0]; return v ? v.id : ''; }
  var W = {daten:null, reihen:[], rid:null, di:0, bild:{}, beobachter:null};

  function $(id){ return document.getElementById(id); }
  function uid(){ return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function toast(t){ var el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function(){ el.hidden = true; }, 2600); }
  function lesen(){ try{ var d = JSON.parse(localStorage.getItem(SPEICHER) || '{}'); W.reihen = d.reihen || []; W.rid = d.rid || null; W.di = d.di || 0; }catch(e){ W.reihen = []; } }
  function schreiben(){ try{ localStorage.setItem(SPEICHER, JSON.stringify({reihen:W.reihen, rid:W.rid, di:W.di})); }catch(e){ toast('Speichern im Browser hat nicht geklappt (Speicher voll? Bilder eines Aufbaus entfernen).'); } }
  function reihe(){ return W.reihen.filter(function(r){ return r.id === W.rid; })[0] || null; }
  function dl(){ var r = reihe(); return r ? r.dls[Math.min(W.di, r.dls.length - 1)] : null; }
  function sportInfo(id){ return W.daten.sportarten.filter(function(s){ return s.id === id; })[0] || {name:'', emoji:''}; }
  function item(id){ return W.daten.alle[id]; }
  // LP21-Abdeckung: Bereiche und pädagogische Perspektiven der gewählten Bausteine
  function lpInfo(dls){
    var b = {}, p = {};
    (Array.isArray(dls) ? dls : [dls]).forEach(function(d){ d.phasen.forEach(function(ph){ ph.ids.forEach(function(id){ var it = item(id); if(!it) return; if(it.bereich) b[it.bereich] = 1; (it.perspektiven || []).forEach(function(x){ p[x] = (p[x] || 0) + 1; }); }); }); });
    return {bereiche:Object.keys(b), persp:P.PERSP.filter(function(x){ return p[x]; }).map(function(x){ return {n:x, c:p[x]}; })};
  }
  function lpZeile(info){
    if(!info.bereiche.length) return '';
    return '<div class="lp"><span class="lpb">LP21 · '+info.bereiche.map(esc).join(', ')+'</span>'+info.persp.map(function(x){ return '<span class="lpp" style="--pc:'+(P.PERSPFARBE[x.n] || '#666')+'">'+esc(x.n)+(x.c > 1 ? ' ×'+x.c : '')+'</span>'; }).join('')+'</div>';
  }

  /* ---------- Neue Reihe / DL ---------- */
  function leereDl(){
    return {id:uid(), datum:'', zeit:'13:30–14:50', halle:'E', sus:16, ziel:'', phasen:PHASEN.map(function(p){ return {id:p.id, name:p.name, zeit:p.zeit, ids:[], notiz:''}; }), org:{notiz:''}};
  }
  var VB = [
    {ziel:'Alle kennen die Spielidee und spielen Stufe 1 selbstständig: Service von unten, fangen, vom Fangort zurückservieren, rotieren. Im Dreieck mit Spitze am Netz, vor dem Fangen laut «Ich!».', halle:'E',
     p:{einstieg:['b1'], einspielen:['b2'], spiel:['r1'], intervenieren:['i1','i2','i3'], abschluss:['b7']}},
    {ziel:'Stufe 2: Annahme hoch zur Spitze. Manchette lernen, Service mit Ziel.', halle:'D',
     p:{einstieg:['b8'], einspielen:['b9'], spiel:['r2','b11'], intervenieren:['i3b','i4'], abschluss:['b12','b13']}},
    {ziel:'Stufe 3: Pass und Angriffsball in den freien Raum.', halle:'E',
     p:{einstieg:['b14'], einspielen:['b15'], spiel:['r3','b16'], intervenieren:['i5','i6'], abschluss:['b17']}},
    {ziel:'Stufe 3 festigen, Stufe 4 für die Starken. Probe-Check und Bewertungsblatt.', halle:'E',
     p:{einstieg:['b22'], spiel:['r3','b23','b18'], intervenieren:[], abschluss:['b12']}},
    {ziel:'Prüfung: Technik-Check S/M/P und Spielverhalten. Halbklasse prüft, die andere spielt nebenan Fussball.', halle:'D',
     p:{spiel:['b18b','b19','b24'], abschluss:['b21']}}
  ];
  // Beispiel-Block für eine Sportart: n = Index der DL, T = Anzahl DL. Prüfung nur im 5er-Block (letzte DL).
  var HALLEN = ['E', 'D', 'E', 'E', 'D'];
  function beispielDl(sport, n, T, d){
    var liste = W.daten.daten[sport] || [], alt = W.daten.daten.alternativ || [];
    var nach = function(f){ return liste.filter(f); };
    var einst = nach(function(i){ return i.phase === 'einstieg'; }), aufw = nach(function(i){ return i.phase === 'aufwaermen'; }),
        reg = nach(function(i){ return i.art === 'regelkarte'; }), iv = nach(function(i){ return i.art === 'intervention'; }),
        kx = nach(function(i){ return i.phase === 'komplex'; }), chk = nach(function(i){ return i.art === 'check'; }),
        abs = nach(function(i){ return i.phase === 'abschluss'; }), spf = nach(function(i){ return i.phase === 'spiel' && i.art === 'baustein'; });
    if(!abs.length) abs = alt.filter(function(i){ return i.phase === 'abschluss'; });
    var pruef = T === 5 && n === 4, L = T === 5 ? 4 : T;
    var at = function(a, k){ return a.length ? [a[((k % a.length) + a.length) % a.length].id] : []; };
    d.halle = HALLEN[n % 5];
    d.phasen[0].ids = at(einst, n); d.phasen[1].ids = at(aufw, n);
    var sp = reg.length ? at(reg, 0) : at(spf, n * 2).concat(at(spf, n * 2 + 1)).filter(function(x, k, a){ return a.indexOf(x) === k; });
    if(pruef){
      d.phasen[2].ids = sp.concat(chk.map(function(c){ return c.id; }));
      d.phasen[4].ids = at(abs, n); d.phasen[4].notiz = 'Rückblick: Was kann ich jetzt, was vor 5 Doppellektionen noch nicht ging? Abschluss-Karte ausfüllen.';
      d.ziel = 'Prüfung: Technik-Check (15 Punkte) und Spielverhalten im 3 gegen 3 (5 × 0–3). Doppelhalle: eine Halbklasse wird geprüft, die andere spielt nebenan ein anderes Spiel, dann Wechsel. Geprüft wird nur, was geübt wurde.';
      d.phasen[2].notiz = 'Technik-Check an 3 Posten, danach Spiel-Bewertung in Viererteams (alle 2′ wechselt der Nächste ein).';
      d.phasen[3].ids = []; d.phasen[5].notiz = 'Ergebnis offen lassen, Rückmeldung folgt mit dem Prüfungsblatt.';
      return;
    }
    var von, bis;
    if(L === 1){ von = 0; bis = 2; } else { von = Math.round(n * 5 / L); bis = Math.max(von + 1, Math.round((n + 1) * 5 / L)); }
    var ivs = iv.slice(von, Math.min(bis, von + 2)), ids = [], namen = [];
    ivs.forEach(function(x){
      ids.push(x.id); namen.push(x.titel);
      var weiter = ((x.iv || []).filter(function(r){ return r.k === 'Weiter mit'; })[0] || {t:''}).t.match(/[A-Z]{2}\d+/g) || [];
      weiter.slice(0, 2).forEach(function(c){ var f = liste.filter(function(y){ return y.code === c; })[0]; if(f && ids.indexOf(f.id) < 0) ids.push(f.id); });
    });
    d.phasen[3].ids = ids;
    if(n >= L - 1 && L > 1 && kx.length){ sp = sp.concat(at(kx, 0)); }
    d.phasen[2].ids = sp;
    d.phasen[4].ids = at(abs, n);
    d.phasen[4].notiz = 'Rundenturnier 3 × 4′ auf 2–3 Feldern, die Teams zählen selbst, am Schluss abklatschen.';
    d.phasen[5].notiz = 'Was macht euer Team jetzt besser als am Anfang? Material versorgen.';
    d.ziel = (n === 0 ? 'Alle kennen die Spielidee und spielen das 3 gegen 3 selbstständig nach den Regeln. ' : 'Das Spiel läuft selbstständig und flüssig. ') + 'Schwerpunkt heute (nach Beobachtung): ' + (namen.join(' und ') || 'Spielverständnis') + '.' +
      (T === 5 && n === 3 ? ' Probe-Check für die Prüfung in DL 5.' : '');
    if(T === 5 && n === 3 && chk.length){ d.phasen[2].ids.push(chk[chk.length - 1].id); d.phasen[2].notiz = 'Probe-Check: den Technik-Check einmal als Probe durchspielen, Ergebnis ins Probenfeld des Prüfungsblatts.'; }
  }
  function neueReihe(sport, anzahl, beispiel){
    var info = sportInfo(sport);
    var r = {id:uid(), titel:info.name + '-Block ' + anzahl + ' DL', sport:sport, klasse:'', notizen:'', dls:[]};
    for(var n = 0; n < anzahl; n++){
      var d = leereDl();
      if(beispiel){
        if(sport === 'volleyball'){
          var vi = anzahl === 5 ? n : anzahl === 3 ? [0, 1, 2][n] : 0;
          if(anzahl !== 5 && anzahl !== 3 && n > 0) vi = Math.min(n, 3);
          d.ziel = VB[vi].ziel; d.halle = VB[vi].halle;
          d.phasen.forEach(function(ph){ ph.ids = (VB[vi].p[ph.id] || []).map(function(c){ return 'volleyball-' + c; }); });
          if(anzahl !== 5) d.phasen.forEach(function(ph){ ph.ids = ph.ids.filter(function(id){ return id.indexOf('b18') < 0 && id.indexOf('b19') < 0 && id.indexOf('b24') < 0; }); });
          if(anzahl !== 5 && n === anzahl - 1 && anzahl > 1) d.phasen[4].notiz = 'Rundenturnier mit allen Stufen, Teams zählen selbst.';
        } else beispielDl(sport, n, anzahl, d);
      }
      if(beispiel) d.org.aufbauId = vorlageVon(sport);
      r.dls.push(d);
    }
    W.reihen.push(r); W.rid = r.id; W.di = 0; schreiben(); alles();
  }

  /* ---------- Zeichnen ---------- */
  function alles(){ leiste(); reiheKopf(); dlTabs(); dlPanel(); }
  function leiste(){
    var h = W.reihen.map(function(r){ return '<button class="tab reihenchip'+(r.id === W.rid ? ' an' : '')+'" data-reihe="'+esc(r.id)+'" type="button">'+esc(sportInfo(r.sport).emoji)+' '+esc(r.titel)+'</button>'; }).join('');
    h += '<button class="btn gruen" data-act="neu" type="button">＋ Neue Reihe</button><button class="btn" data-act="import" type="button" title="Reihe aus einer Datei öffnen">⬆️ Datei öffnen</button><input type="file" id="datei" accept=".json" hidden>';
    $('reihenLeiste').innerHTML = h;
  }
  function reiheKopf(){
    var r = reihe();
    if(!r){ $('reiheKopf').innerHTML = '<p class="leer">Noch keine Reihe. Mit «＋ Neue Reihe» startest du – auf Wunsch gleich mit einem Beispiel, das du frei anpassen kannst.</p>'; return; }
    $('reiheKopf').innerHTML = '<div class="zeile">'+
      '<label class="fl">Titel der Reihe<input class="feld" data-f="titel" value="'+esc(r.titel)+'" style="min-width:240px"></label>'+
      '<label class="fl">Klasse<input class="feld" data-f="klasse" value="'+esc(r.klasse)+'" style="width:130px" placeholder="z. B. 1. Sek Knaben"></label>'+
      '<span style="flex:1"></span>'+
      '<button class="btn" data-act="druckReihe" type="button">🖨️ Ganze Reihe drucken</button>'+
      '<button class="btn" data-act="export" type="button">⬇️ Als Datei</button>'+
      '<button class="btn" data-act="reiheKopie" type="button">⧉ Kopie</button>'+
      '<button class="btn gefahr" data-act="reiheWeg" type="button">🗑️</button></div>'+
      '<div class="hilfe">Lehrplan 21 in der ganzen Reihe:</div>'+lpZeile(lpInfo(r.dls))+
      '<label class="fl">Notizen zur Reihe (z. B. Modell, Bewertung, Absenzen)<textarea class="feld" data-f="notizen" rows="2">'+esc(r.notizen)+'</textarea></label>';
  }
  function dlTabs(){
    var r = reihe(); if(!r){ $('dlTabs').innerHTML = ''; return; }
    $('dlTabs').innerHTML = r.dls.map(function(d, i){ return '<button class="tab'+(i === W.di ? ' an' : '')+'" data-di="'+i+'" type="button">DL '+(i + 1)+(d.datum ? ' · '+esc(datumKurz(d.datum)) : '')+'</button>'; }).join('')+
      '<button class="btn" data-act="dlNeu" type="button">＋ DL</button>';
  }
  function datumKurz(iso){ var p = String(iso).split('-'); return p.length === 3 ? (+p[2])+'.'+(+p[1])+'.' : iso; }
  function datumLang(iso){ if(!iso) return ''; var a = new Date(iso+'T12:00:00'), wt = ['So','Mo','Di','Mi','Do','Fr','Sa']; return wt[a.getDay()]+' '+a.getDate()+'.'+(a.getMonth()+1)+'.'+a.getFullYear(); }
  function chipHtml(id, pi, k, ph){
    var it = item(id);
    if(!it) return '<div class="bchip"><span class="tt">(Baustein nicht mehr vorhanden: '+esc(id)+')</span><button class="btn klein" data-act="bweg" data-p="'+pi+'" data-k="'+k+'" type="button">✕</button></div>';
    return '<div class="bchip t-'+esc(it.phase)+'" style="--cd:var(--'+farbe(it.phase)+');--ct:var(--'+farbe(it.phase)+'-t)"><span class="code">'+esc(it.code)+'</span><span class="tt" data-act="bzeige" data-id="'+esc(id)+'">'+esc(it.titel)+'</span>'+
      '<span class="mini">'+esc(P.ARTEN[it.art] || '')+(it.dauer ? ' · '+esc(it.dauer) : '')+'</span>'+
      '<button class="btn klein" data-act="bhoch" data-p="'+pi+'" data-k="'+k+'" type="button" title="nach oben">↑</button><button class="btn klein" data-act="brunter" data-p="'+pi+'" data-k="'+k+'" type="button" title="nach unten">↓</button>'+
      '<button class="btn klein" data-act="bweg" data-p="'+pi+'" data-k="'+k+'" type="button" title="entfernen">✕</button></div>'+
      '<div class="bdetail" data-detail="'+esc(id)+'" hidden>'+P.karteHtml(it)+'</div>';
  }
  function farbe(ph){ return {einstieg:'gelb',aufwaermen:'gelb',spiel:'blau',komplex:'blau',technik:'orange',intervention:'orange',abschluss:'gruen',check:'grau',alt:'grau'}[ph] || 'blau'; }
  function dlPanel(){
    var r = reihe(), d = dl();
    if(!r || !d){ $('dlPanel').innerHTML = ''; return; }
    var h = '<h2 class="abschnitt">Doppellektion '+(W.di + 1)+' von '+r.dls.length+'</h2>';
    h += '<div class="zeile"><label class="fl">Datum<input class="feld" type="date" data-d="datum" value="'+esc(d.datum)+'"></label>'+
      '<label class="fl">Zeit<input class="feld" data-d="zeit" value="'+esc(d.zeit)+'" style="width:130px"></label>'+
      '<label class="fl">Halle<select class="feld" data-d="halle"><option value="E"'+(d.halle === 'E' ? ' selected' : '')+'>Einfachhalle</option><option value="D"'+(d.halle === 'D' ? ' selected' : '')+'>Doppelhalle</option><option value="A"'+(d.halle === 'A' ? ' selected' : '')+'>draussen</option></select></label>'+
      '<label class="fl">SuS<input class="feld" type="number" min="1" max="40" data-d="sus" value="'+esc(d.sus)+'" style="width:70px"></label>'+
      '<span style="flex:1"></span>'+
      '<button class="btn" data-act="druckDl" type="button">🖨️ Diese DL drucken</button>'+
      '<button class="btn" data-act="dlKopie" type="button">⧉ Kopie</button>'+
      '<button class="btn" data-act="dlHoch" type="button" title="nach vorne">←</button><button class="btn" data-act="dlRunter" type="button" title="nach hinten">→</button>'+
      '<button class="btn gefahr" data-act="dlWeg" type="button">🗑️</button></div>';
    h += '<div class="ziel"><label class="fl">Tagesziel (fix, verschiebbar – bis wohin sie kommen sollten)<textarea class="feld" data-d="ziel" rows="2">'+esc(d.ziel)+'</textarea></label></div>';
    h += '<div class="hilfe">Lehrplan 21 in dieser Doppellektion:</div>'+lpZeile(lpInfo(d));
    h += '<h2 class="abschnitt">Ablauf</h2><div class="hilfe">Zeiten sind nur Richtwerte. Wähle Bausteine nach der Beobachtung, schreib dazu, was du tust.</div>';
    d.phasen.forEach(function(ph, pi){
      h += '<div class="phase t-'+esc(ph.id)+'"><div class="ph"><b>'+esc(ph.name)+'</b><input class="feld" data-ph="'+pi+'" data-pf="zeit" value="'+esc(ph.zeit)+'" placeholder="Zeit"><span style="flex:1"></span>'+
        (ph.id === 'kreis' ? '' : '<button class="btn klein" data-act="bwahl" data-p="'+pi+'" type="button">＋ Baustein</button>')+'</div>'+
        '<div class="chips">'+ph.ids.map(function(id, k){ return chipHtml(id, pi, k, ph); }).join('')+'</div>'+
        '<textarea class="feld" rows="1" data-ph="'+pi+'" data-pf="notiz" placeholder="Notizen / was ich hier mache">'+esc(ph.notiz)+'</textarea></div>';
    });
    h += '<h2 class="abschnitt">Organisation und Aufbau</h2>'+orgHtml(d);
    $('dlPanel').innerHTML = h;
  }
  function hpQuery(id){ if(!id) return ''; return id.indexOf('v:') === 0 ? '?vorlage='+id.slice(2) : '?aufbau='+encodeURIComponent(id); }
  function aufbauten(){ try{ return (JSON.parse(localStorage.getItem('hallenplaner_v1') || '{}').gespeichert || []); }catch(e){ return []; } }
  function orgHtml(d){
    var o = d.org, liste = aufbauten();
    var h = '<div class="org"><div class="zeile"><label class="fl">Aufbau aus dem Hallenplaner'+
      '<select class="feld" data-org="aufbauId" style="min-width:240px"><option value="">– keiner –</option><optgroup label="Vorlagen">'+VORLAGEN_HP.map(function(v){ return '<option value="'+v.id+'"'+(o.aufbauId === v.id ? ' selected' : '')+'>'+esc(v.n)+'</option>'; }).join('')+'</optgroup><optgroup label="Meine gespeicherten Aufbauten">'+liste.map(function(a){ return '<option value="'+esc(a.id)+'"'+(o.aufbauId === a.id ? ' selected' : '')+'>'+esc(a.name)+'</option>'; }).join('')+'</optgroup></select></label>'+
      '<button class="btn gruen" data-act="bildHolen" type="button"'+(o.aufbauId ? '' : ' disabled')+'>'+(o.bild3d ? '🔄 Bilder aktualisieren' : '🖼️ Bilder holen')+'</button>'+
      '<a class="btn" style="text-decoration:none" target="_blank" href="../hallenplaner/'+hpQuery(o.aufbauId)+'">🏟️ '+(o.aufbauId ? 'Im Hallenplaner bearbeiten' : 'Neuen Aufbau zeichnen')+'</a></div>'+
      '<div class="hilfe">Die Vorlagen sind fertige Aufbauten pro Sportart. Eigene Aufbauten kommen aus deinem Hallenplaner in diesem Browser (dort unter «💾 Aufbauten» speichern).'+
      ' Nach Änderungen im Hallenplaner unter gleichem Namen speichern und hier «Bilder aktualisieren».</div>';
    if(W.bild[d.id] === 'laedt') h += '<div class="hilfe">⏳ Bilder werden erstellt …</div>';
    if(o.bild3d || o.bild2d){
      h += '<div class="bilder">'+(o.bild3d ? '<div><img src="'+o.bild3d+'" alt="3D-Ansicht"><div class="unter">3D-Ansicht</div></div>' : '')+(o.bild2d ? '<div><img src="'+o.bild2d+'" alt="Grundriss"><div class="unter">Grundriss</div></div>' : '')+'</div>';
      h += '<div class="zeile"><label class="fl" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" data-org="nur3d"'+(o.nur3d ? ' checked' : '')+'> im Druck nur 3D-Ansicht</label>'+
        '<label class="fl" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" data-org="nur2d"'+(o.nur2d ? ' checked' : '')+'> im Druck nur Grundriss</label></div>';
    }
    if(o.material && o.material.length) h += '<div class="hilfe"><b>Material aus dem Aufbau:</b> '+o.material.map(esc).join(', ')+(o.leibchen ? ' · '+esc(o.leibchen) : '')+'</div>';
    h += '<label class="fl">Organisation, Absenzen, Teams, Hinweise<textarea class="feld" rows="2" data-org="notiz">'+esc(o.notiz || '')+'</textarea></label></div>';
    return h;
  }

  /* ---------- Bausteinwahl ---------- */
  var wahl = {p:0, alle:false, q:'', sport:null, persp:null};
  function bwahlOeffnen(pi){
    wahl.p = pi; wahl.alle = false; wahl.q = ''; wahl.persp = null; wahl.sport = reihe().sport; bwahlZeichnen();
  }
  function bwahlZeichnen(){
    var d = dl(), ph = d.phasen[wahl.p], def = PHASEN[wahl.p];
    var liste = (W.daten.daten[wahl.sport] || []).concat(wahl.sport === 'alternativ' ? [] : (W.daten.daten.alternativ || []));
    if(wahl.sport === 'alternativ') liste = W.daten.daten.alternativ || [];
    var q = wahl.q.trim().toLowerCase();
    liste = liste.filter(function(i){
      if(!wahl.alle){ var passt = def.hilfe.indexOf(i.phase) >= 0 || (def.regel && i.art === 'regelkarte'); if(!passt) return false; }
      if(wahl.persp && (i.perspektiven || []).indexOf(wahl.persp) < 0) return false;
      return !q || JSON.stringify(i).toLowerCase().indexOf(q) >= 0;
    });
    var h = '<div class="mbox"><h3>Baustein für «'+esc(ph.name)+'»</h3><div class="zeile">'+
      '<select class="feld" id="wSport">'+W.daten.sportarten.map(function(s){ return '<option value="'+s.id+'"'+(wahl.sport === s.id ? ' selected' : '')+'>'+esc(s.emoji+' '+s.name)+'</option>'; }).join('')+'<option value="alternativ"'+(wahl.sport === 'alternativ' ? ' selected' : '')+'>🔄 Ohne Sportart</option></select>'+
      '<input class="feld suche" id="wQ" type="search" placeholder="Suchen …" value="'+esc(wahl.q)+'" style="flex:1;min-width:140px">'+
      '<label class="fl" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="wAlle"'+(wahl.alle ? ' checked' : '')+'> alle Phasen zeigen</label>'+
      '<button class="btn primaer" id="wZu" type="button">Fertig</button></div><div class="zeile" style="margin:0">'+P.PERSP.map(function(x){ return '<button class="chip'+(wahl.persp === x ? ' an' : '')+'" data-wp="'+x+'" type="button" style="border-color:'+P.PERSPFARBE[x]+'">'+esc(x)+'</button>'; }).join('')+'</div><div class="hilfe">Ein Klick fügt den Baustein hinzu oder nimmt ihn wieder weg. Mehrere pro Phase sind möglich.</div>';
    h += liste.length ? liste.map(function(i){
      var drin = ph.ids.indexOf(i.id) >= 0, kurz = (i.beschreibung && i.beschreibung[0]) || (i.punkte && i.punkte[0]) || (i.iv && i.iv[0] && i.iv[0].t) || '';
      return '<div class="wahl t-'+esc(i.phase)+(drin ? ' drin' : '')+'" style="--cd:var(--'+farbe(i.phase)+')"><span class="code" style="background:var(--cd);border-radius:6px;padding:0 7px;font-weight:800;font-size:13px">'+esc(i.code)+'</span>'+
        '<span class="tt"><b>'+esc(i.titel)+'</b> <span class="mini" style="color:var(--grau);font-size:12px">'+esc(P.ARTEN[i.art] || '')+' · '+esc(P.phaseName(i.phase))+(i.dauer ? ' · '+esc(i.dauer) : '')+'</span><small>'+esc(String(kurz).slice(0, 170))+'</small></span>'+
        '<button class="btn klein'+(drin ? ' an' : '')+'" data-w="'+esc(i.id)+'" type="button">'+(drin ? '✓' : '＋')+'</button></div>';
    }).join('') : '<div class="leer">Nichts gefunden. Probiere «alle Phasen zeigen».</div>';
    h += '</div>';
    var m = $('modal'); m.innerHTML = h; m.hidden = false;
  }

  /* ---------- Bilder vom Hallenplaner ---------- */
  function bilderHolen(){
    var d = dl(); if(!d || !d.org.aufbauId) return;
    var id = d.id; W.bild[id] = 'laedt'; dlPanel();
    var f = document.createElement('iframe');
    f.src = '../hallenplaner/'+hpQuery(d.org.aufbauId)+'&einbett=1';
    f.style.cssText = 'position:fixed;left:-12000px;top:0;width:1100px;height:700px;border:0;';
    var fertig = false;
    function ende(){ window.removeEventListener('message', empf); clearTimeout(zeit); setTimeout(function(){ f.remove(); }, 100); }
    function empf(e){
      if(!e.data || e.data.t !== 'praep-bild' || e.data.id !== id) return;
      fertig = true; ende();
      var dd = findeDl(id); if(!dd) return;
      dd.org.bild3d = e.data.bild3d; dd.org.bild2d = e.data.bild2d; dd.org.material = e.data.material || []; dd.org.leibchen = e.data.leibchen || '';
      dd.org.aufbauName = e.data.titel || ''; delete W.bild[id]; schreiben(); dlPanel(); toast('Bilder übernommen');
    }
    var zeit = setTimeout(function(){ if(!fertig){ ende(); delete W.bild[id]; dlPanel(); toast('Das Erstellen der Bilder hat zu lange gedauert. Nochmals versuchen.'); } }, 30000);
    window.addEventListener('message', empf);
    f.addEventListener('load', function(){ f.contentWindow.postMessage({t:'praep-bild', id:id}, '*'); });
    document.body.appendChild(f);
  }
  function findeDl(id){ var out = null; W.reihen.forEach(function(r){ r.dls.forEach(function(d){ if(d.id === id) out = d; }); }); return out; }

  /* ---------- Druck ---------- */
  function kopfHtml(r, d, n, sub){
    return '<div class="dkopf"><img src="../sva/Logo_Sek_Altnau.png" alt=""><div><div class="reihe">Sport · '+esc(sportInfo(r.sport).name)+(r.klasse ? ' · '+esc(r.klasse) : '')+(n ? ' · DL '+n+' von '+r.dls.length : '')+'</div><h1>'+esc(sub || r.titel)+'</h1></div></div><div class="dstreifen"><span></span><span></span><span></span><span></span></div>';
  }
  function dlSeiten(r, i){
    var d = r.dls[i], n = i + 1, h = '';
    var mat = {};
    d.phasen.forEach(function(ph){ ph.ids.forEach(function(id){ var it = item(id); if(it && it.material) mat[it.material] = 1; }); });
    h += '<section class="seite">'+kopfHtml(r, d, n, r.titel)+'<div class="etiketten">'+
      (d.datum ? '<span class="etikett">'+esc(datumLang(d.datum))+'</span>' : '')+(d.zeit ? '<span class="etikett">'+esc(d.zeit)+'</span>' : '')+'<span class="etikett">'+esc(P.HALLE[d.halle] || '')+'</span>'+(d.sus ? '<span class="etikett">'+esc(d.sus)+' SuS</span>' : '')+'</div>';
    h += lpZeile(lpInfo(d));
    if(d.ziel) h += '<div class="dziel"><b>Tagesziel (fix):</b> '+esc(d.ziel)+'</div>';
    h += '<h2 class="dh">Ablauf</h2><table class="ablauf"><tr><th>Zeit</th><th>Phase</th><th>Vorschlag – Bausteine nach Beobachtung wählen</th><th>Notizen</th></tr>';
    d.phasen.forEach(function(ph){
      if(!ph.ids.length && !ph.notiz && !ph.zeit && ph.id !== 'kreis' && ph.id !== 'abschluss') return;
      var inhalt = ph.ids.map(function(id){ var it = item(id); return it ? '<span class="bz" style="--cd:var(--'+farbe(it.phase)+')"><span class="code">'+esc(it.code)+'</span><b>'+esc(it.titel)+'</b>'+(it.dauer ? ' <span class="grau">('+esc(it.dauer)+')</span>' : '')+'</span>' : ''; }).join('');
      if(ph.notiz) inhalt += '<div>'+esc(ph.notiz).replace(/\n/g, '<br>')+'</div>';
      h += '<tr class="t-'+esc(ph.id)+'"><td class="zeit">'+esc(ph.zeit)+'</td><td class="ph">'+esc(ph.name)+'</td><td>'+inhalt+'</td><td class="notiz"><div class="leer-linien"></div></td></tr>';
    });
    h += '</table>';
    var o = d.org, bilder = [];
    if(o.bild3d && !o.nur2d) bilder.push('<img src="'+o.bild3d+'" alt="">');
    if(o.bild2d && !o.nur3d) bilder.push('<img src="'+o.bild2d+'" alt="">');
    var matListe = (o.material || []).slice();
    if(bilder.length || matListe.length || o.notiz || Object.keys(mat).length){
      h += '<h2 class="dh">Organisation</h2>';
      if(bilder.length) h += '<div class="dbilder'+(bilder.length === 1 ? ' eins' : '')+'">'+bilder.join('')+'</div>';
      h += '<div class="dspalten"><div>'+(matListe.length ? '<b>Material (Aufbau):</b> '+matListe.map(esc).join(', ')+(o.leibchen ? ' · '+esc(o.leibchen) : '') : '')+(Object.keys(mat).length ? '<div><b>Material (Bausteine):</b> '+Object.keys(mat).map(esc).join(' · ')+'</div>' : '')+'</div><div>'+(o.notiz ? esc(o.notiz).replace(/\n/g, '<br>') : '')+'</div></div>';
    }
    h += '<div class="fuss"><span>'+esc(sportInfo(r.sport).name)+' · DL '+n+'</span><span>Sek Altnau</span></div></section>';
    // Bausteinkarten dieser DL (ohne Doppelte, Regelkarte zuerst)
    var ids = [], gesehen = {};
    d.phasen.forEach(function(ph){ ph.ids.forEach(function(id){ if(!gesehen[id] && item(id)){ gesehen[id] = 1; ids.push(id); } }); });
    ids.sort(function(a, b){ return (item(a).art === 'regelkarte' ? 0 : 1) - (item(b).art === 'regelkarte' ? 0 : 1); });
    if(ids.length) h += '<section class="seite">'+kopfHtml(r, d, n, 'Bausteine DL '+n)+'<div class="karten2">'+ids.map(function(id){ return P.karteHtml(item(id)); }).join('')+'</div><div class="fuss"><span>'+esc(sportInfo(r.sport).name)+' · Bausteine DL '+n+'</span><span>Sek Altnau</span></div></section>';
    return h;
  }
  function druckHtml(r, alle){
    var h = '';
    if(alle){
      h += '<section class="seite">'+kopfHtml(r, null, 0, r.titel+' – auf einen Blick')+(r.notizen ? '<p>'+esc(r.notizen).replace(/\n/g, '<br>')+'</p>' : '')+
        ''+lpZeile(lpInfo(r.dls))+'<table class="ablauf"><tr><th>DL</th><th>Datum / Halle</th><th>Tagesziel</th><th>Bausteine</th></tr>'+
        r.dls.map(function(d, i){
          var codes = []; d.phasen.forEach(function(ph){ ph.ids.forEach(function(id){ var it = item(id); if(it) codes.push(it.code); }); });
          return '<tr><td><b>'+(i + 1)+'</b></td><td>'+esc(datumLang(d.datum))+'<br>'+esc(P.HALLE[d.halle] || '')+'</td><td>'+esc(d.ziel)+'</td><td>'+esc(codes.join(', '))+'</td></tr>';
        }).join('')+'</table><div class="fuss"><span>'+esc(sportInfo(r.sport).name)+' · Reihe</span><span>Sek Altnau</span></div></section>';
      r.dls.forEach(function(d, i){ h += dlSeiten(r, i); });
    } else h = dlSeiten(r, Math.min(W.di, r.dls.length - 1));
    return h;
  }
  function drucken(alle){
    var r = reihe(); if(!r) return;
    $('druck').innerHTML = druckHtml(r, alle);
    setTimeout(function(){ window.print(); }, 80);
  }
  window.PraepWerkstatt = {W:W, neueReihe:neueReihe, bilderHolen:bilderHolen, druckHtml:druckHtml, schreiben:schreiben, alles:alles};

  /* ---------- Datei ---------- */
  function exportieren(){
    var r = reihe(); if(!r) return;
    var blob = new Blob([JSON.stringify({art:'praep-reihe', v:1, reihe:r}, null, 1)], {type:'application/json'});
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (r.titel || 'Reihe').replace(/[^\wäöüÄÖÜ\- ]+/g, '').trim().replace(/\s+/g, '_')+'.praep.json';
    document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function importieren(file){
    file.text().then(function(t){
      var j = JSON.parse(t); if(!j.reihe || !Array.isArray(j.reihe.dls)) throw new Error('x');
      j.reihe.id = uid(); j.reihe.dls.forEach(function(d){ d.id = uid(); });
      W.reihen.push(j.reihe); W.rid = j.reihe.id; W.di = 0; schreiben(); alles(); toast('Reihe geöffnet');
    }).catch(function(){ toast('Diese Datei ist keine Präp-Reihe.'); });
  }

  /* ---------- Ereignisse ---------- */
  function neuDialog(){
    var m = $('modal');
    m.innerHTML = '<div class="mbox"><h3>Neue Reihe</h3><div class="zeile"><label class="fl">Sportart<select class="feld" id="nSport">'+W.daten.sportarten.map(function(s){ return '<option value="'+s.id+'">'+esc(s.emoji+' '+s.name)+'</option>'; }).join('')+'</select></label>'+
      '<label class="fl">Block<select class="feld" id="nAnz"><option value="1">1 DL (Einzellektion)</option><option value="3">3 DL (kurzer Block)</option><option value="5" selected>5 DL (mit Prüfung in DL 5)</option></select></label></div>'+
      '<label class="fl" style="flex-direction:row;align-items:center;gap:6px;margin:6px 0"><input type="checkbox" id="nBsp" checked> mit Beispiel füllen (Bausteine und Tagesziele zum Anpassen)</label>'+
      '<div class="zeile"><button class="btn primaer" id="nOk" type="button">Reihe anlegen</button><button class="btn" id="wZu" type="button">Abbrechen</button></div></div>';
    m.hidden = false;
  }
  document.addEventListener('click', function(e){
    var b = e.target.closest('[data-reihe],[data-di],[data-act],[data-w],[data-wp],#wZu,#nOk,#jaOk'); if(!b) return;
    var r = reihe(), d = dl(), act = b.dataset.act;
    if(b.dataset.reihe){ W.rid = b.dataset.reihe; W.di = 0; schreiben(); alles(); return; }
    if(b.dataset.di){ W.di = +b.dataset.di; schreiben(); dlTabs(); dlPanel(); return; }
    if(b.id === 'jaOk'){ $('modal').hidden = true; var f = jaFn; jaFn = null; if(f) f(); return; }
    if(b.id === 'wZu'){ $('modal').hidden = true; dlPanel(); schreiben(); return; }
    if(b.id === 'nOk'){ var s = $('nSport').value, a = +$('nAnz').value || 5, bs = $('nBsp').checked; $('modal').hidden = true; neueReihe(s, a, bs); return; }
    if(b.dataset.wp){ wahl.persp = wahl.persp === b.dataset.wp ? null : b.dataset.wp; bwahlZeichnen(); return; }
    if(b.dataset.w){
      var ph = d.phasen[wahl.p], k = ph.ids.indexOf(b.dataset.w);
      if(k >= 0) ph.ids.splice(k, 1); else ph.ids.push(b.dataset.w);
      schreiben(); bwahlZeichnen(); return;
    }
    if(act === 'neu') return neuDialog();
    if(act === 'import') return $('datei').click();
    if(act === 'export') return exportieren();
    if(act === 'druckDl') return drucken(false);
    if(act === 'druckReihe') return drucken(true);
    if(act === 'reiheWeg'){ fragen('Reihe «'+r.titel+'» löschen?', function(){ W.reihen = W.reihen.filter(function(x){ return x.id !== r.id; }); W.rid = W.reihen[0] ? W.reihen[0].id : null; W.di = 0; schreiben(); alles(); }); return; }
    if(act === 'reiheKopie'){ var c = JSON.parse(JSON.stringify(r)); c.id = uid(); c.titel += ' (Kopie)'; c.dls.forEach(function(x){ x.id = uid(); }); W.reihen.push(c); W.rid = c.id; schreiben(); alles(); return; }
    if(act === 'dlNeu'){ r.dls.push(leereDl()); W.di = r.dls.length - 1; schreiben(); alles(); return; }
    if(act === 'dlKopie'){ var k2 = JSON.parse(JSON.stringify(d)); k2.id = uid(); k2.datum = ''; r.dls.splice(W.di + 1, 0, k2); W.di++; schreiben(); alles(); return; }
    if(act === 'dlWeg'){ if(r.dls.length <= 1){ toast('Eine Reihe braucht mindestens eine DL.'); return; } fragen('DL '+(W.di + 1)+' löschen?', function(){ r.dls.splice(W.di, 1); W.di = Math.max(0, W.di - 1); schreiben(); alles(); }); return; }
    if(act === 'dlHoch' || act === 'dlRunter'){ var t = W.di + (act === 'dlHoch' ? -1 : 1); if(t < 0 || t >= r.dls.length) return; var x = r.dls[W.di]; r.dls[W.di] = r.dls[t]; r.dls[t] = x; W.di = t; schreiben(); alles(); return; }
    if(act === 'bwahl') return bwahlOeffnen(+b.dataset.p);
    if(act === 'bweg'){ d.phasen[+b.dataset.p].ids.splice(+b.dataset.k, 1); schreiben(); dlPanel(); return; }
    if(act === 'bhoch' || act === 'brunter'){ var ids = d.phasen[+b.dataset.p].ids, k3 = +b.dataset.k, t3 = k3 + (act === 'bhoch' ? -1 : 1); if(t3 < 0 || t3 >= ids.length) return; var y = ids[k3]; ids[k3] = ids[t3]; ids[t3] = y; schreiben(); dlPanel(); return; }
    if(act === 'bzeige'){ var el = document.querySelector('[data-detail="'+b.dataset.id+'"]'); if(el) el.hidden = !el.hidden; return; }
    if(act === 'bildHolen') return bilderHolen();
  });
  var jaFn = null;
  function fragen(text, fn){ jaFn = fn; var m = $('modal'); m.innerHTML = '<div class="mbox"><h3>'+esc(text)+'</h3><div class="zeile"><button class="btn gefahr" id="jaOk" type="button">Ja, löschen</button><button class="btn" id="wZu" type="button">Abbrechen</button></div></div>'; m.hidden = false; }
  document.addEventListener('input', function(e){
    var t = e.target, r = reihe(), d = dl();
    if(t.dataset.f && r){ r[t.dataset.f] = t.value; if(t.dataset.f === 'titel') leiste(); schreiben(); }
    else if(t.dataset.d && d){ d[t.dataset.d] = t.type === 'number' ? (+t.value || 0) : t.value; if(t.dataset.d === 'datum') dlTabs(); schreiben(); }
    else if(t.dataset.ph && d){ d.phasen[+t.dataset.ph][t.dataset.pf] = t.value; schreiben(); }
    else if(t.dataset.org === 'notiz' && d){ d.org.notiz = t.value; schreiben(); }
    else if(t.id === 'wQ'){ wahl.q = t.value; var pos = t.selectionStart; bwahlZeichnen(); var n = $('wQ'); n.focus(); n.setSelectionRange(pos, pos); }
  });
  document.addEventListener('change', function(e){
    var t = e.target, d = dl();
    if(t.dataset.org === 'aufbauId' && d){ d.org.aufbauId = t.value; if(!t.value){ delete d.org.bild3d; delete d.org.bild2d; d.org.material = []; } schreiben(); dlPanel(); if(t.value) bilderHolen(); }
    else if((t.dataset.org === 'nur3d' || t.dataset.org === 'nur2d') && d){ d.org[t.dataset.org] = t.checked; if(t.checked) d.org[t.dataset.org === 'nur3d' ? 'nur2d' : 'nur3d'] = false; schreiben(); dlPanel(); }
    else if(t.id === 'wSport'){ wahl.sport = t.value; bwahlZeichnen(); }
    else if(t.id === 'wAlle'){ wahl.alle = t.checked; bwahlZeichnen(); }
    else if(t.id === 'datei' && t.files && t.files[0]){ importieren(t.files[0]); t.value = ''; }
  });

  lesen();
  P.laden().then(function(daten){
    W.daten = daten;
    if(!reihe() && W.reihen.length) W.rid = W.reihen[0].id;
    alles();
  }).catch(function(e){ $('reiheKopf').innerHTML = '<p class="leer">Bausteine konnten nicht geladen werden ('+esc(e.message)+').</p>'; });
})();
