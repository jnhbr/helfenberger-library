#!/usr/bin/env node
/**
 * Tägliche Erinnerungen (Helfenberger's Library).
 *
 * Läuft via GitHub Actions (.github/workflows/daily-reminders.yml), zweimal
 * pro Tag angestossen (ein UTC-Cron für Sommerzeit, einer für Winterzeit) -
 * prüft selbst, ob es gerade wirklich 18 Uhr Schweizer Zeit ist, und tut beim
 * jeweils "falschen" Lauf nichts. So ist keine manuelle Zeitumstellung nötig.
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
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  var parts = {};
  fmt.formatToParts(new Date()).forEach(function(p){ parts[p.type] = p.value; });
  return { hour: Number(parts.hour) % 24, year: parts.year, month: parts.month, day: parts.day };
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
  if(!force && z.hour !== 18){
    console.log('Aktuell ' + z.hour + ' Uhr in Zürich, nicht 18 Uhr - nichts zu tun.');
    return;
  }

  var keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if(!keyJson){ throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY fehlt (GitHub-Actions-Secret nicht gesetzt?).'); }
  var serviceAccount = JSON.parse(keyJson);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  var db = admin.firestore();

  if(!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY){
    throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY fehlen.');
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:example@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  var dueDate = tomorrowDateStrZurich();
  var entriesSnap = await db.collection('calendarEntries').where('dueDate', '==', dueDate).get();
  if(entriesSnap.empty){
    console.log('Keine Einträge fällig am ' + dueDate + ' - keine Erinnerungen zu verschicken.');
    return;
  }

  var lines = [];
  entriesSnap.forEach(function(doc){
    var e = doc.data();
    lines.push('• ' + (TYPE_LABELS[e.type] || e.type) + ': ' + e.title);
  });
  var title = 'Morgen fällig';
  var body = lines.join('\n');
  console.log('Verschicke Erinnerung für ' + dueDate + ':\n' + body);

  var devicesSnap = await db.collectionGroup('devices').get();
  console.log('Registrierte Geräte: ' + devicesSnap.size);

  var sent = 0, removed = 0, failed = 0;
  for(const deviceDoc of devicesSnap.docs){
    var sub = deviceDoc.data();
    if(!sub || !sub.endpoint || !sub.keys){ continue; }
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
