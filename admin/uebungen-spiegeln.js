/**
 * Helfenberger's Library — Jans Übungen in alle Seiten spiegeln (Vorbereitung bis zum Launch)
 *
 *   node uebungen-spiegeln.js           (spiegeln)
 *   node uebungen-spiegeln.js --probe   (nur anzeigen, was passieren würde)
 *
 * Läuft jede Nacht als GitHub Action (.github/workflows/uebungen-spiegeln.yml im
 * Live-Repo) und kann dort auch von Hand gestartet werden. Nach dem Launch den
 * Workflow abschalten: gh workflow disable uebungen-spiegeln.yml -R jnhbr/helfenberger-library
 *
 * Quelle ist Jans Seite (G3b). Pro Zielseite (alle Dokumente unter klassen/ —
 * Klassen, FLP-, ISF- und Praktikums-Seiten):
 *  - Ordner: fehlende anlegen, geänderte (Name, Ort, Reihenfolge) nachführen.
 *  - Übungen (gleiche ID = Kopie): fehlende anlegen, geänderte nachführen
 *    (Inhalt, Titel, Fach, Ordner, Reihenfolge). «current» (rot markiert) bleibt
 *    Sache der jeweiligen Lehrperson. Eigene Übungen der Lehrpersonen werden nie
 *    angefasst; bei Jan gelöschte Übungen bleiben in den anderen Seiten stehen
 *    (werden nur im Log genannt), damit keine Verknüpfung ins Leere zeigt.
 *  - 🗂️ Karteikarten-Sets (klasseninfo/karteikarten): Jans Sets per ID ergänzt/ersetzt.
 * Lehrerbereich wird nicht gespiegelt (Jans persönliche Unterlagen).
 * Inhalte (resourceContent) sind global und werden nur verlinkt, nicht kopiert.
 */
const { starten } = require('./_firebase');
const { admin, db } = starten();

const QUELLE = 'G3b';
const PROBE = process.argv.includes('--probe');
const NICHT_SPIEGELN = ['lehrerbereich'];
// Felder, die pro Seite der Lehrperson gehören und nie überschrieben werden.
const LOKAL = ['current', 'prevOrder', 'version', 'empfohlen', 'prevContentId'];

function gleich(a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
function ohneLokal(d) { const x = Object.assign({}, d); LOKAL.forEach(function (f) { delete x[f]; }); return x; }

(async function () {
  const src = db.collection('klassen').doc(QUELLE);
  const [resSnap, folSnap, kkSnap] = await Promise.all([
    src.collection('resources').get(), src.collection('folders').get(), src.collection('klasseninfo').doc('karteikarten').get()
  ]);
  const res = resSnap.docs.filter(function (d) { return NICHT_SPIEGELN.indexOf(d.data().subject) < 0; });
  const fol = folSnap.docs.filter(function (d) { return NICHT_SPIEGELN.indexOf(d.data().subject) < 0; });
  const kkSets = kkSnap.exists ? (kkSnap.data().sets || []) : [];
  const quellIds = {}; res.forEach(function (d) { quellIds[d.id] = true; });

  const seiten = (await db.collection('klassen').listDocuments()).map(function (r) { return r.id; })
    .filter(function (k) { return k !== QUELLE; }).sort();
  console.log((PROBE ? '[PROBE] ' : '') + 'Quelle ' + QUELLE + ': ' + res.length + ' Übungen, ' + fol.length + ' Ordner, ' + kkSets.length + ' Karteikarten-Sets → ' + seiten.length + ' Seiten');

  let total = { neu: 0, akt: 0, ordner: 0, kk: 0 };
  for (const k of seiten) {
    const kref = db.collection('klassen').doc(k);
    const [zr, zf, zk] = await Promise.all([kref.collection('resources').get(), kref.collection('folders').get(), kref.collection('klasseninfo').doc('karteikarten').get()]);
    const hatR = {}; zr.forEach(function (d) { hatR[d.id] = d.data(); });
    const hatF = {}; zf.forEach(function (d) { hatF[d.id] = d.data(); });
    const w = PROBE ? null : db.bulkWriter();
    let n = { neu: 0, akt: 0, ordner: 0, kk: 0 };

    fol.forEach(function (d) {
      const q = d.data(), z = hatF[d.id];
      if (!z) { n.ordner++; if (w) w.set(kref.collection('folders').doc(d.id), q); return; }
      const upd = {};
      ['name', 'parentId', 'order', 'subject'].forEach(function (f) { if (!gleich(q[f], z[f])) upd[f] = q[f] === undefined ? null : q[f]; });
      if (Object.keys(upd).length) { n.ordner++; if (w) w.update(kref.collection('folders').doc(d.id), upd); }
    });

    res.forEach(function (d) {
      const q = ohneLokal(d.data()), z = hatR[d.id];
      if (!q.contentId) q.contentId = d.id;
      q.originKlasse = QUELLE;
      q.originVersion = typeof d.data().version === 'number' ? d.data().version : 0;
      if (!z) {
        n.neu++;
        if (w) {
          w.set(kref.collection('resources').doc(d.id), q);
          w.set(db.collection('uebungsIndex').doc(d.id), { klassen: admin.firestore.FieldValue.arrayUnion(QUELLE, k) }, { merge: true });
        }
        return;
      }
      const upd = {};
      Object.keys(q).forEach(function (f) { if (!gleich(q[f], z[f])) upd[f] = q[f]; });
      // Inhalt ersetzt: bisherigen wie in der App als prevContentId behalten.
      if (upd.contentId && z.contentId) upd.prevContentId = z.contentId;
      if (Object.keys(upd).length) { n.akt++; if (w) w.update(kref.collection('resources').doc(d.id), upd); }
    });

    if (kkSets.length) {
      const alt = zk.exists ? (zk.data().sets || []) : [];
      const neu = alt.slice();
      kkSets.forEach(function (s) {
        const i = neu.findIndex(function (x) { return x.id === s.id; });
        if (i < 0) { neu.push(s); n.kk++; } else if (!gleich(neu[i], s)) { neu[i] = s; n.kk++; }
      });
      if (n.kk && w) w.set(kref.collection('klasseninfo').doc('karteikarten'), { sets: neu }, { merge: true });
    }

    const weg = Object.keys(hatR).filter(function (id) { return hatR[id].originKlasse === QUELLE && !quellIds[id] && NICHT_SPIEGELN.indexOf(hatR[id].subject) < 0; });
    if (w) await w.close();
    if (n.neu || n.akt || n.ordner || n.kk || weg.length) {
      console.log(k + ': ' + n.neu + ' neu, ' + n.akt + ' aktualisiert, ' + n.ordner + ' Ordner, ' + n.kk + ' Karteikarten-Sets' +
        (weg.length ? ' · bei Jan gelöscht (bleiben stehen): ' + weg.map(function (id) { return hatR[id].title || id; }).join(', ') : ''));
    }
    Object.keys(total).forEach(function (f) { total[f] += n[f]; });
  }
  console.log('Fertig: ' + total.neu + ' neu, ' + total.akt + ' aktualisiert, ' + total.ordner + ' Ordner, ' + total.kk + ' Karteikarten-Sets.');
  process.exit(0);
})().catch(function (err) { console.error(err); process.exit(1); });
