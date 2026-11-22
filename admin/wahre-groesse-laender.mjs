// Baut wahre-groesse/laender.json aus world-atlas (Natural Earth 1:50m, gemeinfrei) + i18n-iso-countries (deutsche Namen).
import fs from 'node:fs';
const [,, dir, out] = process.argv;
const topo = JSON.parse(fs.readFileSync(dir+'/c50.json','utf8'));
const de = JSON.parse(fs.readFileSync(dir+'/de.json','utf8')).countries;
const codes = JSON.parse(fs.readFileSync(dir+'/codes.json','utf8'));
const num2a2 = {}; codes.forEach(c => { num2a2[c[2]] = c[0]; });
const EXTRA = {'Kosovo':['XK','Kosovo'], 'N. Cyprus':['','Nordzypern'], 'Somaliland':['','Somaliland'], 'Siachen Glacier':null, 'Indian Ocean Ter.':null, 'Ashmore and Cartier Is.':null};
const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
const arcs = topo.arcs.map(a => { let x=0,y=0; return a.map(p => { x+=p[0]; y+=p[1]; return [x*sx+tx, y*sy+ty]; }); });
function arc(i){ return i >= 0 ? arcs[i] : arcs[~i].slice().reverse(); }
// Längen stetig machen (Ringe über die Datumsgrenze, z. B. Russland, Fidschi, Alaska): Sprünge > 180° um 360° ausgleichen.
function ring(ids){ const pts=[]; ids.forEach((i,k)=>{ const a=arc(i); (k? a.slice(1):a).forEach(p=>pts.push(p.slice())); }); for(let i=1;i<pts.length;i++){ while(pts[i][0]-pts[i-1][0] > 180) pts[i][0]-=360; while(pts[i][0]-pts[i-1][0] < -180) pts[i][0]+=360; } return pts; }
function dp(pts, tol){ // Douglas-Peucker
  if(pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length); keep[0]=keep[pts.length-1]=1;
  const st=[[0,pts.length-1]];
  while(st.length){ const [a,b]=st.pop(); let md=0, mi=-1; const [x1,y1]=pts[a],[x2,y2]=pts[b]; const dx=x2-x1, dy=y2-y1, L=dx*dx+dy*dy;
    for(let i=a+1;i<b;i++){ const [x,y]=pts[i]; let t=L? ((x-x1)*dx+(y-y1)*dy)/L:0; t=Math.max(0,Math.min(1,t)); const ex=x1+t*dx-x, ey=y1+t*dy-y, d=ex*ex+ey*ey; if(d>md){md=d;mi=i;} }
    if(mi>=0 && md>tol*tol){ keep[mi]=1; st.push([a,mi],[mi,b]); } }
  return pts.filter((p,i)=>keep[i]);
}
const R = 6371.0088, rad = Math.PI/180;
function ringArea(p){ let s=0; for(let i=0;i<p.length;i++){ const a=p[i], b=p[(i+1)%p.length]; s += (b[0]-a[0])*rad*(2+Math.sin(a[1]*rad)+Math.sin(b[1]*rad)); } return s*R*R/2; }
const res = [];
topo.objects.countries.geometries.forEach(g => {
  if(!g.arcs) return;
  let a2 = num2a2[g.id], name = a2 && de[a2];
  if(Array.isArray(name)) name = name[0];
  if(!name){ const e = EXTRA[g.properties.name]; if(e === null) return; if(e){ a2=e[0]; name=e[1]; } else { name = g.properties.name; a2=''; } }
  const KURZ = {RU:'Russland', US:'USA', GB:'Grossbritannien', CZ:'Tschechien', SY:'Syrien', TZ:'Tansania', BN:'Brunei', PS:'Palästina', CD:'Kongo (Dem. Rep.)', MD:'Moldau'};
  if(KURZ[a2]) name = KURZ[a2];
  if(a2 === 'AQ') return; // Antarktis passt nicht in Mercator
  const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
  let area = 0; const rings = [];
  polys.forEach(poly => poly.forEach(r => { const pts = ring(r); area += ringArea(pts); const s = dp(pts, 0.04); if(s.length >= 4) rings.push(s); }));
  if(!rings.length) return;
  res.push({n:name, a:a2, km:Math.round(Math.abs(area)), r:rings.map(r => r.flatMap(p => [Math.round(p[0]*100), Math.round(p[1]*100)]))});
});
res.sort((x,y)=>x.n.localeCompare(y.n,'de'));
fs.writeFileSync(out, JSON.stringify(res));
console.log(res.length, 'Länder', fs.statSync(out).size, 'Bytes');
['Schweiz','Grönland','Russland','Brasilien','Deutschland'].forEach(n=>{ const c=res.find(x=>x.n===n); console.log(n, c && c.km); });
