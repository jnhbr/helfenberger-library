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

  // Absicherung gegen Doppelversand: der erste nicht erzwungene Lauf legt
  // das Log-Dokument für dueDate atomar an (create schlägt fehl, wenn es schon
  // existiert) - alle weiteren Läufe desselben Tages tun dann nichts mehr.
  // Bei FORCE_SEND (manueller Testlauf) wird weder geprüft noch markiert,
  // damit Tests den automatischen Versand nicht blockieren.
  var logRef = db.collection('reminderLog').doc(dueDate);
  if(!force){
    try{
      await logRef.create({ hour: z.hour, minute: z.minute, checkedAt: admin.firestore.FieldValue.serverTimestamp() });
    }catch(err){
      if(err.code !== 6) throw err; // 6 = ALREADY_EXISTS
      var logSnap = await logRef.get();
      console.log('Für ' + dueDate + ' wurde bereits verschickt (Lauf um ' + logSnap.data().hour + ' Uhr) - nichts zu tun.');
      return;
    }
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
  // (klassen/{klasse}/calendarEntries). Jedes Gerät bekommt nur die Einträge
  // der Klasse seiner Besitzerin/seines Besitzers (students/{uid}.klasse).
  var KLASSEN = ['G3b', 'G3a', 'E1c'];
  var bodyByKlasse = {}, entriesByKlasse = {}, entryCount = 0;
  for(const klasse of KLASSEN){
    var snap = await db.collection('klassen').doc(klasse).collection('calendarEntries').where('dueDate', '==', dueDate).get();
    entryCount += snap.size;
    if(snap.empty) continue;
    var lines = [];
    entriesByKlasse[klasse] = [];
    snap.forEach(function(doc){
      var e = doc.data();
      entriesByKlasse[klasse].push(e);
      lines.push('• ' + (TYPE_LABELS[e.type] || e.type) + ': ' + e.title);
    });
    bodyByKlasse[klasse] = lines.join('\n');
    console.log('Erinnerung ' + klasse + ' für ' + dueDate + ':\n' + bodyByKlasse[klasse]);
  }
  if(!force){
    await logRef.update({ entryCount: entryCount });
  }
  if(!entryCount){
    console.log('Keine Einträge fällig am ' + dueDate + ' - keine Erinnerungen zu verschicken.');
    return;
  }
  var title = 'Morgen fällig';

  var studentsSnap = await db.collection('students').get();
  var klasseByUid = {}, bodyByUid = {};
  studentsSnap.forEach(function(d){
    var st = d.data();
    klasseByUid[d.id] = st.klasse || 'G3b';
    // Fach-Gäste (students/{uid}.nurFach) bekommen nur Einträge ihres Fachs.
    if(st.nurFach){
      bodyByUid[d.id] = (entriesByKlasse[klasseByUid[d.id]] || [])
        .filter(function(e){ return e.subject === st.nurFach; })
        .map(function(e){ return '• ' + (TYPE_LABELS[e.type] || e.type) + ': ' + e.title; })
        .join('\n');
    }
  });

  var devicesSnap = await db.collectionGroup('devices').get();
  console.log('Registrierte Geräte: ' + devicesSnap.size);

  var sent = 0, removed = 0, failed = 0;
  for(const deviceDoc of devicesSnap.docs){
    var sub = deviceDoc.data();
    if(!sub || !sub.endpoint || !sub.keys){ continue; }
    var ownerUid = deviceDoc.ref.parent.parent ? deviceDoc.ref.parent.parent.id : null;
    var body = (ownerUid in bodyByUid) ? bodyByUid[ownerUid] : bodyByKlasse[klasseByUid[ownerUid]];
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
  console.log('Fertig: ' + sent + ' verschickt, ' + removed + ' veraltete Abos entfernt, ' + failed + ' Fehler.');
}

main().catch(function(err){ console.error(err); process.exit(1); });
