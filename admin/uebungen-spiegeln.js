/**
 * Helfenberger's Library — Jans Übungen in alle Seiten spiegeln (dauerhaft)
 *
 *   node uebungen-spiegeln.js           (spiegeln)
 *   node uebungen-spiegeln.js --probe   (nur anzeigen, was passieren würde)
 *
 * SEIT 27.10.2026: legt NICHTS Neues mehr an. Neues Material kommt nur noch über «Empfehlen an …»
 * (Einstellungen › Empfohlen); gespiegelt werden nur noch bereits vorhandene Kopien bei Änderungen.
 *
 * Läuft jede Nacht als GitHub Action (.github/workflows/uebungen-spiegeln.yml im
 * Live-Repo) und kann dort auch von Hand gestartet werden. Bleibt dauerhaft an:
 * Jan will, dass seine Inhalte immer zu allen Lehrpersonen gelangen.
 *
 * Quelle ist Jans Seite (G3b). Pro Zielseite (alle Dokumente unter klassen/ —
 * Klassen, FLP-, ISF- und Praktikums-Seiten):
 *  - Ordner: fehlende anlegen, geänderte (Name, Ort, Reihenfolge) nachführen; gespiegelte Ordner, die
 *    bei der Lehrperson leer und bei Jan nicht mehr da sind, werden entfernt.
 *  - Übungen (gleiche ID = Kopie): fehlende anlegen, geänderte nachführen
 *    (Inhalt, Titel, Fach, Ordner, Reihenfolge). «current» (rot markiert) bleibt
 *    Sache der jeweiligen Lehrperson. Eigene Übungen der Lehrpersonen werden nie
 *    angefasst; bei Jan gelöschte Übungen bleiben in den anderen Seiten stehen
 *    (werden nur im Log genannt), damit keine Verknüpfung ins Leere zeigt.
 *  - 🗂️ Karteikarten-Sets (klasseninfo/karteikarten): Jans Sets per ID ergänzt/ersetzt.
 *  - 🎮 Klassen-Quizze, 💰 Spiel- und 🎯 Schätz-Sets (quizzes, alle Fächer inkl. 🎲 Trivia): gleiche ID =
 *    Kopie, fehlende anlegen, geänderte nachführen.
 *  - ☁️ Wortwolken und ⚡ Blitzumfragen (klassenzimmer/vorlagen): Jans Vorlagen per ID ergänzt/ersetzt.
 * Klassenbezogenes (Prüfungen mit Resultaten, Briefkästen, Kalender, Sitzplan, Ämtli …) bleibt auf jeder Seite.
 *
 * Änderungen der Lehrpersonen bleiben bei ihnen (21.10.2026): klassen/{k}/appMeta/spiegelStand
 * merkt pro Stück (und bei Übungen/Ordnern/Quizzen pro Feld) einen Fingerabdruck dessen, was
 * zuletzt gespiegelt wurde. Weicht die Kopie davon ab, hat die Lehrperson sie geändert → dieses
 * Feld bzw. Stück wird nicht mehr überschrieben. Hat sie eine Kopie gelöscht, kommt sie nicht
 * wieder. Stücke ohne Fingerabdruck, die von Jans Stand abweichen, gelten ebenfalls als geändert.
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

// Nur beim Anlegen übernommen, bei bestehenden Kopien nicht nachgeführt.
const NUR_NEU = ['uploadedAt', 'uploadedBy', 'createdAt'];

const crypto = require('crypto');
function sortiert(v) {
  if (Array.isArray(v)) return v.map(sortiert);
  if (v && typeof v === 'object' && v.constructor === Object) { const o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = sortiert(v[k]); }); return o; }
  return v;
}
function fp(v) { return crypto.createHash('sha1').update(JSON.stringify(sortiert(v === undefined ? null : v))).digest('base64').slice(0, 12); }
// Feldweise abgleichen: schreibt nur Felder, die die Lehrperson seit der letzten Spiegelung nicht verändert hat.
function felderAbgleichen(q, z, stand, upd) {
  const neuStand = {};
  Object.keys(q).forEach(function (f) {
    if (NUR_NEU.indexOf(f) >= 0) return;
    if (gleich(q[f], z[f])) { neuStand[f] = fp(q[f]); return; }
    const basis = stand ? (stand[f] !== undefined ? stand[f] : fp(null)) : null;
    if (basis !== null && basis === fp(z[f])) { upd[f] = q[f]; neuStand[f] = fp(q[f]); }
    else if (basis !== null) neuStand[f] = basis;   // lokal geändert: Fingerabdruck bleibt, Feld bleibt
  });
  return neuStand;
}
function gleich(a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
function ohneLokal(d) { const x = Object.assign({}, d); LOKAL.forEach(function (f) { delete x[f]; }); return x; }

(async function () {
  const src = db.collection('klassen').doc(QUELLE);
  const [resSnap, folSnap, kkSnap, qzSnap, vlSnap] = await Promise.all([
    src.collection('resources').get(), src.collection('folders').get(), src.collection('klasseninfo').doc('karteikarten').get(),
    src.collection('quizzes').get(), src.collection('klassenzimmer').doc('vorlagen').get()
  ]);
  const quizze = qzSnap.docs.filter(function (d) { return NICHT_SPIEGELN.indexOf(d.data().subject) < 0; });
  const vorlagen = {};
  ['wolken', 'umfragen'].forEach(function (t) {
    vorlagen[t] = (vlSnap.exists ? (vlSnap.data()[t] || []) : []).filter(function (x) { return x && x.id && NICHT_SPIEGELN.indexOf(x.fach) < 0; });
  });
  const res = resSnap.docs.filter(function (d) { return NICHT_SPIEGELN.indexOf(d.data().subject) < 0; });
  const fol = folSnap.docs.filter(function (d) { return NICHT_SPIEGELN.indexOf(d.data().subject) < 0; });
  const kkSets = kkSnap.exists ? (kkSnap.data().sets || []) : [];
  const quellIds = {}; res.forEach(function (d) { quellIds[d.id] = true; });

  const seiten = (await db.collection('klassen').listDocuments()).map(function (r) { return r.id; })
    .filter(function (k) { return k !== QUELLE; }).sort();
  console.log((PROBE ? '[PROBE] ' : '') + 'Quelle ' + QUELLE + ': ' + res.length + ' Übungen, ' + fol.length + ' Ordner, ' + kkSets.length + ' Karteikarten-Sets, ' + quizze.length + ' Quizze/Spiel-Sets, ' + vorlagen.wolken.length + ' Wortwolken, ' + vorlagen.umfragen.length + ' Umfragen → ' + seiten.length + ' Seiten');

  let total = { neu: 0, akt: 0, ordner: 0, kk: 0, quiz: 0, vorl: 0 };
  // Stand nach der Spiegelung für den 🔒-Abgleich (lehrer-inhalte-schuetzen.js), ohne neu zu lesen.
  const nachher = resSnap.docs.map(function (d) { return { id: d.id, data: d.data() }; });
  for (const k of seiten) {
    const kref = db.collection('klassen').doc(k);
    const [zr, zf, zk, zq, zv, zs] = await Promise.all([kref.collection('resources').get(), kref.collection('folders').get(), kref.collection('klasseninfo').doc('karteikarten').get(),
      kref.collection('quizzes').get(), kref.collection('klassenzimmer').doc('vorlagen').get(), kref.collection('appMeta').doc('spiegelStand').get()]);
    const altStand = zs.exists ? zs.data() : {};
    const stand = { res: {}, fol: {}, quiz: {}, kk: {}, wolken: {}, umfragen: {} };
    Object.keys(stand).forEach(function (t) { stand[t] = Object.assign({}, altStand[t] || {}); });
    let lokal = 0;
    const hatR = {}; zr.forEach(function (d) { hatR[d.id] = d.data(); });
    const nachherK = {}; zr.forEach(function (d) { nachherK[d.id] = d.data(); });
    const hatF = {}; zf.forEach(function (d) { hatF[d.id] = d.data(); });
    const w = PROBE ? null : db.bulkWriter();
    let n = { neu: 0, akt: 0, ordner: 0, kk: 0, quiz: 0, vorl: 0 };

    fol.forEach(function (d) {
      const q = d.data(), z = hatF[d.id];
      if (!z) return;   // seit 27.10.2026: nichts Neues anlegen (nur Empfehlungen), nur Vorhandenes nachführen
      const upd = {}, qf = {};
      ['name', 'parentId', 'order', 'subject'].forEach(function (f) { qf[f] = q[f] === undefined ? null : q[f]; });
      stand.fol[d.id] = felderAbgleichen(qf, z, stand.fol[d.id] || null, upd);
      if (Object.keys(upd).length) { n.ordner++; if (w) w.update(kref.collection('folders').doc(d.id), upd); }
      Object.keys(qf).forEach(function (f) { if (!gleich(qf[f], z[f]) && !(f in upd)) lokal++; });
    });

    res.forEach(function (d) {
      const q = ohneLokal(d.data()), z = hatR[d.id];
      if (!q.contentId) q.contentId = d.id;
      q.originKlasse = QUELLE;
      q.originVersion = typeof d.data().version === 'number' ? d.data().version : 0;
      if (!z) {
        return;   // nichts Neues anlegen (nur Empfehlungen)
      }
      const upd = {};
      stand.res[d.id] = felderAbgleichen(q, z, stand.res[d.id] || null, upd);
      Object.keys(q).forEach(function (f) { if (NUR_NEU.indexOf(f) < 0 && !gleich(q[f], z[f]) && !(f in upd)) lokal++; });
      // Inhalt ersetzt: bisherigen wie in der App als prevContentId behalten.
      if (upd.contentId && z.contentId) upd.prevContentId = z.contentId;
      if (Object.keys(upd).length) {
        nachherK[d.id] = Object.assign({}, z, upd);
        n.akt++;
        if (w) w.update(kref.collection('resources').doc(d.id), upd);
        else console.log('   ' + k + ' · ' + (q.title || d.id) + ': ' + Object.keys(upd).join(', '));
      }
    });

    // Leere Ordner aufräumen: gespiegelte Ordner (von Jan angelegt oder früher gespiegelt), die bei der Lehrperson
    // leer sind und bei Jan nicht mehr vorkommen, werden entfernt. Der Fingerabdruck in
    // stand.fol bleibt, so kommt der Ordner nicht wieder. Eigene Ordner der Lehrperson bleiben unberührt.
    {
      const quellOrdner = {}, janUid = {}; fol.forEach(function (d) { quellOrdner[d.id] = true; if (d.data().createdBy) janUid[d.data().createdBy] = true; });
      let weiter = true;
      while (weiter) {
        weiter = false;
        const belegt = {};
        Object.keys(nachherK).forEach(function (id) { const f = nachherK[id].folderId; if (f) belegt[f] = true; });
        Object.keys(hatF).forEach(function (id) { const p = hatF[id].parentId; if (p) belegt[p] = true; });
        Object.keys(hatF).forEach(function (id) {
          const gespiegelt = quellOrdner[id] || (altStand.fol && altStand.fol[id]) || (hatF[id].createdBy && janUid[hatF[id].createdBy]);
          if (!gespiegelt || belegt[id] || quellOrdner[id]) return;
          console.log('   ' + k + ' · leerer Ordner entfernt: ' + (hatF[id].name || id) + ' (' + (hatF[id].subject || '?') + ')');
          n.ordner++; if (w) w.delete(kref.collection('folders').doc(id));
          if (!stand.fol[id]) stand.fol[id] = { name: fp(hatF[id].name) };
          delete hatF[id]; weiter = true;
        });
      }
    }

    if (kkSets.length) {
      const alt = zk.exists ? (zk.data().sets || []) : [];
      const neu = alt.slice();
      kkSets.forEach(function (s) {
        const i = neu.findIndex(function (x) { return x.id === s.id; });
        if (i < 0) return;
        else if (gleich(neu[i], s)) stand.kk[s.id] = fp(s);
        else if (stand.kk[s.id] && stand.kk[s.id] === fp(neu[i])) { neu[i] = s; n.kk++; stand.kk[s.id] = fp(s); }
        else lokal++;
      });
      if (n.kk && w) w.set(kref.collection('klasseninfo').doc('karteikarten'), { sets: neu }, { merge: true });
    }

    {
      const hatQ = {}; zq.forEach(function (d) { hatQ[d.id] = d.data(); });
      quizze.forEach(function (d) {
        const q = Object.assign({}, d.data(), { originKlasse: QUELLE }), z = hatQ[d.id];
        if (!z) return;   // nichts Neues anlegen (nur Empfehlungen)
        const upd = {};
        stand.quiz[d.id] = felderAbgleichen(q, z, stand.quiz[d.id] || null, upd);
        Object.keys(q).forEach(function (f) { if (NUR_NEU.indexOf(f) < 0 && !gleich(q[f], z[f]) && !(f in upd)) lokal++; });
        if (Object.keys(upd).length) { n.quiz++; if (w) w.update(kref.collection('quizzes').doc(d.id), upd); }
      });
    }

    if (vorlagen.wolken.length || vorlagen.umfragen.length) {
      const set = {};
      ['wolken', 'umfragen'].forEach(function (t) {
        const neu = zv.exists ? (zv.data()[t] || []).slice() : [];
        let geaendert = false;
        vorlagen[t].forEach(function (x) {
          const i = neu.findIndex(function (y) { return y && y.id === x.id; });
          if (i < 0) return;
          else if (gleich(neu[i], x)) stand[t][x.id] = fp(x);
          else if (stand[t][x.id] && stand[t][x.id] === fp(neu[i])) { neu[i] = x; n.vorl++; geaendert = true; stand[t][x.id] = fp(x); }
          else lokal++;
        });
        if (geaendert) set[t] = neu;
      });
      if (Object.keys(set).length && w) w.set(kref.collection('klassenzimmer').doc('vorlagen'), set, { merge: true });
    }

    Object.keys(nachherK).forEach(function (id) { nachher.push({ id: id, data: nachherK[id] }); });
    const weg = Object.keys(hatR).filter(function (id) { return hatR[id].originKlasse === QUELLE && !quellIds[id] && NICHT_SPIEGELN.indexOf(hatR[id].subject) < 0; });
    if (w && !gleich(sortiert(stand), sortiert(Object.assign({ res: {}, fol: {}, quiz: {}, kk: {}, wolken: {}, umfragen: {} }, altStand)))) w.set(kref.collection('appMeta').doc('spiegelStand'), stand);
    if (w) await w.close();
    if (n.neu || n.akt || n.ordner || n.kk || n.quiz || n.vorl || lokal || weg.length) {
      console.log(k + ': ' + n.neu + ' neu, ' + n.akt + ' aktualisiert, ' + n.ordner + ' Ordner, ' + n.kk + ' Karteikarten-Sets, ' + n.quiz + ' Quizze/Spiel-Sets, ' + n.vorl + ' Wolken/Umfragen' + (lokal ? ', ' + lokal + '× eigene Änderung behalten' : '') +
        (weg.length ? ' · bei Jan gelöscht (bleiben stehen): ' + weg.map(function (id) { return hatR[id].title || id; }).join(', ') : ''));
    }
    Object.keys(total).forEach(function (f) { total[f] += n[f]; });
  }
  console.log('Fertig: ' + total.neu + ' neu, ' + total.akt + ' aktualisiert, ' + total.ordner + ' Ordner, ' + total.kk + ' Karteikarten-Sets, ' + total.quiz + ' Quizze/Spiel-Sets, ' + total.vorl + ' Wolken/Umfragen.');
  // 🔒 Kopien haben ein nurLehrer eben erst übernommen: Schutz der Inhalte nachführen.
  // Ein Fehler hier soll die Spiegelung nicht als gescheitert melden.
  try { await require('./lehrer-inhalte-schuetzen').inhalteSchuetzen(db, !PROBE, nachher); }
  catch (err) { console.error('🔒 Lehrer-Inhalte:', err && err.message || err); }
  process.exit(0);
})().catch(function (err) { console.error(err); process.exit(1); });
