#!/usr/bin/env node
/**
 * Tägliche Erinnerungen (Helfenberger's Library).
 *
 * Läuft via GitHub Actions (.github/workflows/daily-reminders.yml), pro Tag
 * mehrfach ab dem frühen Nachmittag angestossen. Grund: GitHub startet
 * geplante Läufe teils Stunden zu spät (Sept. 2026: 3-5 h, der 18-Uhr-Lauf
 * kam erst um 21-22 Uhr und wurde vom alten 18/19-Uhr-Fenster verworfen).
 *   - Lauf vor 18 Uhr (ab 13 Uhr) Schweizer Zeit: wartet bis 18:00, dann Versand.
 *   - Lauf zwischen 18 und 24 Uhr: Versand sofort (verspätet, aber nicht verloren).
 *   - sonst: nichts.
 * Keine manuelle Zeitumstellung nötig. Ein Firestore-Log (siehe logRef unten)
 * sorgt dafür, dass pro Tag nur einmal verschickt wird.
 *
 * Braucht als Umgebungsvariablen (GitHub-Actions-Secrets, siehe Workflow-Datei):
 *   FIREBASE_SERVICE_ACCOUNT_KEY  - kompletter Inhalt der serviceAccountKey.json
 *   VAPID_PUBLIC_KEY
 *   VAPID_PRIVATE_KEY
 *   VAPID_SUBJECT                 - z.B. "mailto:helfenberger@beispiel.ch"
 */
const admin = require('firebase-admin');
const webpush = require('web-push');

function nowInZurich(){
  var fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Zurich', hour: 'numeric', hour12: false,
    minute: 'numeric', second: 'numeric',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  var parts = {};
  fmt.formatToParts(new Date()).forEach(function(p){ parts[p.type] = p.value; });
  return { hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second), year: parts.year, month: parts.month, day: parts.day };
}

function tomorrowDateStrZurich(){
  // "Morgen" bezogen auf Schweizer Ortszeit, unabhängig davon, in welcher
  // UTC-Zeitzone der GitHub-Actions-Runner tatsächlich läuft.
  var z = nowInZurich();
  var d = new Date(Date.UTC(Number(z.year), Number(z.month) - 1, Number(z.day)));
  d.setUTCDate(d.getUTCDate() + 1);
  var pad = function(n){ return n < 10 ? '0' + n : '' + n; };
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

var TYPE_LABELS = { hausaufgabe: 'Hausaufgabe', abgabe: 'Abgabe', pruefung: 'Prüfung', erinnerung: 'Erinnerung' };

async function main(){
  var z = nowInZurich();
  var force = process.env.FORCE_SEND === 'true'; // für manuellen Testlauf via workflow_dispatch
  if(!force && z.hour < 13){
    console.log('Aktuell ' + z.hour + ' Uhr in Zürich - Erinnerungen laufen erst ab 18 Uhr, nichts zu tun.');
    return;
  }
  if(!force && z.hour < 18){
    var waitMs = ((18 - z.hour) * 3600 - z.minute * 60 - z.second) * 1000;
    console.log('Aktuell ' + z.hour + ':' + String(z.minute).padStart(2, '0') + ' Uhr in Zürich - warte ' + Math.round(waitMs / 60000) + ' Min. bis 18:00.');
    await new Promise(function(r){ setTimeout(r, waitMs + 5000); });
    z = nowInZurich();
  }

  var keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if(!keyJson){ throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY fehlt (GitHub-Actions-Secret nicht gesetzt?).'); }
  var serviceAccount = JSON.parse(keyJson);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  var db = admin.firestore();

  var dueDate = tomorrowDateStrZurich();

  // Absicherung gegen Doppelversand: pro dueDate ein Log-Dokument. Erst ein
  // Lauf, der bis zum Schluss kommt, setzt fertig:true — alle weiteren Läufe
  // desselben Tages tun dann nichts mehr. Bricht ein Lauf ab (z. B. am
  // 23.09.2026: Firestore-Tageskontingent «Quota exceeded»), versucht es der
  // nächste Lauf nochmals, statt den Tag als erledigt anzusehen. Die Läufe
  // laufen nie gleichzeitig (concurrency im Workflow).
  // Bei FORCE_SEND (manueller Testlauf) wird weder geprüft noch markiert,
  // damit Tests den automatischen Versand nicht blockieren.
  var logRef = db.collection('reminderLog').doc(dueDate);
  if(!force){
    var logSnap = await logRef.get();
    var log = logSnap.exists ? logSnap.data() : null;
    // ältere Einträge (vor fertig) gelten als erledigt, sobald entryCount steht
    if(log && (log.fertig === true || (log.fertig === undefined && log.entryCount !== undefined))){
      console.log('Für ' + dueDate + ' wurde bereits verschickt (Lauf um ' + log.hour + ' Uhr) - nichts zu tun.');
      return;
    }
    if(log) console.log('Ein früherer Lauf für ' + dueDate + ' (' + log.hour + ' Uhr) ist nicht fertig geworden - neuer Versuch.');
    await logRef.set({ hour: z.hour, minute: z.minute, checkedAt: admin.firestore.FieldValue.serverTimestamp(), fertig: false }, { merge: true });
  }

  if(!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY){
    throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY fehlen.');
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:example@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  // Seit Herbst 2026 hat jede Klasse ihren eigenen Kalender
  // (klassen/{klasse}/calendarEntries), seit 19.09.2026 auch jede FLP/ISF/
  // Praktikums-Seite. Klassen-Einträge gehen an die Schüler:innen dieser
  // Klasse, Gruppen-Einträge (gruppeId + mitglieder) nur an die Mitglieder —
  // egal in welcher Klasse sie sind.
  var seiten = await db.collection('klassen').listDocuments();
  var entriesByKlasse = {}, gruppenEintraege = [], entryCount = 0;
  for(const ref of seiten){
    var snap = await ref.collection('calendarEntries').where('dueDate', '==', dueDate).get();
    entryCount += snap.size;
    snap.forEach(function(doc){
      var e = doc.data();
      e.seite = ref.id;
      if(e.gruppeId && Array.isArray(e.mitglieder)) gruppenEintraege.push(e);
      else (entriesByKlasse[ref.id] = entriesByKlasse[ref.id] || []).push(e);
    });
  }
  if(!force){
    await logRef.update({ entryCount: entryCount });
  }
  if(!entryCount){
    if(!force) await logRef.update({ fertig: true });
    console.log('Keine Einträge fällig am ' + dueDate + ' - keine Erinnerungen zu verschicken.');
    return;
  }
  var title = 'Morgen fällig';
  function zeile(e){ return '• ' + (TYPE_LABELS[e.type] || e.type) + ': ' + e.title; }

  var studentsSnap = await db.collection('students').get();
  var bodyByUid = {};
  studentsSnap.forEach(function(d){
    var st = d.data();
    var liste = (entriesByKlasse[st.klasse || 'G3b'] || []).slice();
    // Fach-Gäste (students/{uid}.nurFach) bekommen nur Einträge ihres Fachs.
    if(st.nurFach) liste = liste.filter(function(e){ return e.subject === st.nurFach; });
    // Gruppen-Einträge: Mitglieder + die Lehrperson(en) der Seite.
    gruppenEintraege.forEach(function(e){
      var dabei = e.mitglieder.indexOf(d.id) >= 0 || (st.role === 'teacher' && st.klasse === e.seite);
      if(dabei && liste.indexOf(e) < 0) liste.push(e);
    });
    if(liste.length) bodyByUid[d.id] = liste.map(zeile).join('\n');
  });
  console.log('Erinnerung für ' + dueDate + ': ' + entryCount + ' Einträge, ' + Object.keys(bodyByUid).length + ' Personen');

  var devicesSnap = await db.collectionGroup('devices').get();
  console.log('Registrierte Geräte: ' + devicesSnap.size);

  var sent = 0, removed = 0, failed = 0;
  for(const deviceDoc of devicesSnap.docs){
    var sub = deviceDoc.data();
    if(!sub || !sub.endpoint || !sub.keys){ continue; }
    var ownerUid = deviceDoc.ref.parent.parent ? deviceDoc.ref.parent.parent.id : null;
    var body = bodyByUid[ownerUid];
    if(!body){ continue; }
    try{
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify({ title: title, body: body, url: './' })
      );
      sent++;
    }catch(err){
      if(err.statusCode === 404 || err.statusCode === 410){
        // Abo ist nicht mehr gültig (z.B. App deinstalliert / abgemeldet) - aufräumen.
        await deviceDoc.ref.delete();
        removed++;
      } else {
        console.error('Push fehlgeschlagen für ein Gerät:', err.statusCode || err.message);
        failed++;
      }
    }
  }
  if(!force) await logRef.update({ fertig: true, sent: sent, removed: removed, failed: failed });
  console.log('Fertig: ' + sent + ' verschickt, ' + removed + ' veraltete Abos entfernt, ' + failed + ' Fehler.');
}

main().catch(function(err){
  if(err && (err.code === 8 || /RESOURCE_EXHAUSTED|Quota exceeded/i.test(String(err.message)))){
    console.error('Firestore-Tageskontingent aufgebraucht (Gratis-Tarif «Spark»): heute sind keine Schreib-/Lesezugriffe mehr möglich. ' +
      'Der nächste Lauf versucht es nochmals. Dauerhafte Lösung: Firebase-Projekt auf den Tarif «Blaze» umstellen.');
  }
  console.error(err);
  process.exit(1);
});
