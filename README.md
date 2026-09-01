# Helfenberger's Library — Setup-Anleitung

Eine echte, mehrbenutzerfähige Website (GitHub Pages + Firebase) für deine Übungsseiten.
Anders als die frühere Claude-Artifact-Version speichert diese Version den Fortschritt
jedes Schülers/jeder Schülerin in der Cloud (Firestore) und aktualisiert neue Übungen
in Echtzeit auf allen Geräten — genau wie du es dir gewünscht hast.

**Wichtig, bevor du beginnst:** Ich (Claude) kann diese Schritte nicht für dich ausführen —
mir fehlt in dieser Sitzung der Zugriff auf GitHub/Firebase. Alles unten ist aber
vollständig vorbereitet: du musst nur noch Konten anlegen, Werte eintragen und
Dateien hochladen. Rechne mit ca. 20–30 Minuten für die Ersteinrichtung.

**Kein Kreditkarte nötig:** Diese Version verzichtet bewusst auf Firebase Storage (Cloud Storage
verlangt seit 2024 den kostenpflichtigen „Blaze"-Tarif inkl. hinterlegter Zahlungsmethode, auch
wenn die Nutzung selbst meist gratis bleibt). Stattdessen werden hochgeladene Übungsseiten als Text
in Firestore gespeichert — und Firestore läuft im kostenlosen „Spark"-Tarif **ganz ohne Kreditkarte**.

Da ein einzelnes Firestore-Dokument auf ca. 1 MB begrenzt ist, teilt die Seite eine grössere
Übungsdatei beim Hochladen automatisch in mehrere ~900-KB-Teile auf und setzt sie beim Öffnen wieder
zusammen (bis zu 8 MB pro Übung insgesamt) — das passiert automatisch im Hintergrund, du musst dich
darum nicht kümmern. Das reicht auch, falls du später einmal Bilder in eine Übung einbauen willst
(als eingebettetes Base64-Bild; ein „normales" Foto ist damit zwar meist zu gross, ein Icon, ein
Diagramm oder ein leicht komprimiertes Bild aber kein Problem).

---

## Was du bekommst

```
helfenberger-library-firebase/
├── index.html              → die ganze Website (1 Datei, kein Build-Schritt nötig)
├── assets/logo.png         → Sek-Altnau-Logo
├── firestore.rules         → Zugriffsregeln für die Datenbank
├── admin/
│   ├── create-accounts.js  → Skript zum Anlegen der 15 Logins
│   └── package.json
└── README.md                → diese Anleitung
```

## Wie es funktioniert

- **Login:** Jede Person tippt nur ihren Namen ein (z. B. „jan"). Im Hintergrund wird daraus
  automatisch ein Firebase-Account (`jan@helfenberger-library.app`, Passwort `jan2024`) erstellt
  bzw. beim Einloggen benutzt — die Schüler:innen sehen davon nichts.
- **9 Fächer:** Mathe, Deutsch, Geschichte, Geografie, Biologie, Physik, Chemie, Informatik, Berufswahl.
- **Übungen hochladen (nur du, `helfenberger`):** Auf einer Fach-Seite ziehst du eine HTML-Datei
  (z. B. wie `industrialisierung_training.html`) in die Dropzone. Der Inhalt landet direkt als Text
  in Firestore (`resourceContent/{id}`), eine schlanke Metadaten-Zeile in `resources/{id}` — und alle
  Schüler:innen sehen die neue Übung sofort, ganz ohne Neu-Deployment der Seite.
- **Fortschritt:** Übungsseiten, die den `postMessage`-Mechanismus nutzen (die beiden mitgelieferten
  Beispiele „Industrialisierung" und „Nährstoffe" tun das bereits), melden ihren Fortschritt automatisch
  an die Library, die ihn in Firestore speichert — geräteübergreifend abrufbar.

---

## Schritt 1 — Firebase-Projekt einrichten

1. Gehe zu [console.firebase.google.com](https://console.firebase.google.com) und erstelle ein neues Projekt
   (oder nutze ein bestehendes, das du schon einmal für GitHub+Firebase verwendet hast).
2. **Authentication** aktivieren: im Menü (bei dir evtl. unter der Kategorie „Security") →
   **Authentication** → **Get started** → Tab *Sign-in method* → **E-Mail/Passwort** aktivieren.
3. **Firestore Database** aktivieren: im Menü unter „Databases and storage" → **Firestore Database**
   → **Create database** → Produktionsmodus (die Regeln aus `firestore.rules` überschreiben das
   gleich). Region z. B. `eur3` für Europa.
4. **Web-App registrieren:** Projektübersicht → Button *„+ Add app"* → `</>`-Symbol (Web) → App
   registrieren (kein Firebase Hosting nötig, das machen wir über GitHub Pages). Du bekommst ein
   Konfigurationsobjekt (`firebaseConfig`) — das brauchst du in Schritt 3.

   **Firebase Storage brauchst du für diese Version nicht** — überspring den entsprechenden Menüpunkt
   einfach (er würde einen kostenpflichtigen Tarif mit hinterlegter Kreditkarte voraussetzen).

## Schritt 2 — Sicherheitsregeln einspielen

Am einfachsten über die Konsole (kein CLI nötig): *Firestore Database → Rules* → Inhalt von
`firestore.rules` einfügen und **Publish**.

(Alternativ mit der Firebase CLI: `firebase deploy --only firestore:rules`, falls du bereits ein
Firebase-CLI-Setup hast.)

## Schritt 3 — `firebaseConfig` in `index.html` eintragen

Öffne `index.html`, suche den Abschnitt `const firebaseConfig = { ... }` (ganz am Anfang des
`<script type="module">`-Blocks) und ersetze die `REPLACE_ME`-Platzhalter mit den Werten aus
Schritt 1.5:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "dein-projekt.firebaseapp.com",
  projectId: "dein-projekt",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

(Ein `storageBucket`-Wert kann im kopierten Snippet auftauchen — den brauchst du hier nicht, einfach
weglassen.)

> Dieses Objekt ist **kein Geheimnis** — bei Firebase-Webapps ist es normal, dass es im
> öffentlichen Quellcode steht. Die eigentliche Absicherung passiert über die
> Firestore-Regeln (Schritt 2) und über Firebase Authentication, nicht durch Geheimhaltung
> dieses Objekts.

## Schritt 4 — Die 15 Logins anlegen

1. Firebase Console → *Project settings → Service accounts → Generate new private key*.
   Die heruntergeladene JSON-Datei speicherst du als `admin/serviceAccountKey.json`.
   **Diese Datei niemals in ein öffentliches Repo committen** (sie ist bereits in `.gitignore`
   eingetragen).
2. Im Terminal:
   ```bash
   cd admin
   npm install
   node create-accounts.js
   ```
3. Das Skript legt alle 14 Schüler-Logins plus `helfenberger` (Lehrperson) an und gibt am Ende
   eine Übersicht mit allen Namen/Passwörtern aus. Es ist **sicher mehrfach ausführbar** — z. B.
   wenn nächstes Jahr neue Namen dazukommen (einfach in `admin/create-accounts.js` in der
   `STUDENTS`-Liste ergänzen und erneut ausführen).

**Login-Konvention:** Benutzername = Vorname, Passwort = Vorname + `2024` (z. B. `jan` / `jan2024`).
Das war deine Wahl, um auch bei kurzen Namen die von Firebase geforderte Mindestlänge von 6 Zeichen
zu erreichen.

## Schritt 5 — Auf GitHub Pages veröffentlichen

1. Erstelle ein neues GitHub-Repository (z. B. `helfenberger-library`).
2. Lade den Ordnerinhalt hoch (`index.html`, `assets/`, `firestore.rules` — der `admin/`-Ordner
   **ohne** `serviceAccountKey.json` kann mit hochgeladen werden, muss aber nicht; die `.gitignore`
   schützt dich, falls du versehentlich `git add .` machst).
3. Repository-Einstellungen → *Pages* → *Source*: „Deploy from a branch" → Branch `main`, Ordner `/root`.
4. Nach ein bis zwei Minuten ist die Seite unter `https://<dein-benutzername>.github.io/helfenberger-library/`
   erreichbar.

## Schritt 6 — Erste Übung hochladen & testen

1. Öffne die Seite, logge dich als `helfenberger` ein (Passwort `helfenberger2024`).
2. Wähle ein Fach (z. B. Biologie), ziehe eine der beiden mitgelieferten Beispiel-HTML-Dateien
   (`industrialisierung_training.html` oder `naehrstoffe_training.html`, die du bereits als
   Claude-Artefakte hast) in die Dropzone.
3. Logge dich in einem privaten/anderen Browserfenster als z. B. `jan` ein (Passwort `jan2024`) —
   die Übung sollte sofort im entsprechenden Fach erscheinen.

## Kosten

Mit diesem Aufbau (Firestore statt Storage) läuft alles auf dem kostenlosen Firebase-Spark-Tarif:
kein Kreditkarten-Erfordernis, kein Risiko unerwarteter Kosten. Die Spark-Gratisgrenzen (1 GiB
gespeicherte Daten, 50'000 Lesevorgänge und 20'000 Schreibvorgänge pro Tag) sind für eine einzelne
Klasse mit 14 Schüler:innen nicht annähernd erreichbar.

---

## Neue Übungen hinzufügen (laufender Betrieb)

Als `helfenberger` eingeloggt: auf die passende Fach-Seite gehen, HTML-Datei per Drag-and-Drop
in die Dropzone ziehen, Titel bestätigen — fertig. Erscheint sofort bei allen.

**Damit die Fortschrittsanzeige funktioniert**, sollte eine neue Übungsseite beim Beantworten
einer Aufgabe folgende Nachricht an die übergeordnete Seite senden (siehe die beiden Beispiel-Dateien
für die vollständige Umsetzung):

```js
if (window.parent && window.parent !== window) {
  window.parent.postMessage({ __libProgress: true, statsKey: 'irgendein_key', stats: stats, total: Q.length }, '*');
}
```

- `stats` ist ein Objekt `{ [aufgabenId]: { status: 'correct' | 'wrong', ... } }`.
- `total` (optional) ist die Gesamtzahl der Aufgaben, damit ein Fortschrittsbalken „x von y" angezeigt
  werden kann. Fehlt es, zeigt die Library nur „x bearbeitet" plus Trefferquote an.

Übungsseiten ohne diesen Mechanismus funktionieren trotzdem ganz normal — es wird dann einfach kein
Fortschritt in der Library angezeigt.

---

## Sicherheitshinweis (bitte lesen)

Damit Schüler:innen sich nur mit ihrem Namen einloggen können, ist das Passwort nach einer festen,
vorhersehbaren Regel aus dem Namen abgeleitet (`name` + `2024`) — und diese Regel steht zwangsläufig
im öffentlich einsehbaren Quellcode von `index.html` (jede Schülerin kann sie im Browser nachlesen).

Das bedeutet: **Ein technisch interessierter Schüler könnte theoretisch das Passwort einer
Mitschülerin oder sogar des Lehrer-Logins erraten und sich damit einloggen.** Die Firestore-Regeln
verhindern zwar, dass Schüler-Accounts fremde Übungen löschen oder hochladen können — aber wer das
`helfenberger`-Passwort errät, bekommt echte Admin-Rechte (Uploads, Löschen).

Das ist der bewusste Kompromiss deiner ursprünglichen Anforderung „Benutzername und Passwort sollen
der Name sein" — einfach für 14-/15-Jährige, aber nicht wasserdicht. Falls dir das zu heikel ist,
sind die gängigsten Verbesserungen:

- Für den `helfenberger`-Login ein separates, nicht erratbares Passwort setzen (im Firebase-Konsole
  einfach manuell ändern — das Skript-Passwort ist nur der Startwert).
- Den Jahres-Suffix nicht öffentlich dokumentieren bzw. jährlich ändern.

## Verhältnis zur bisherigen Claude-Artifact-Version

Die vorher gebaute Version (Claude-Artefakt, `localStorage`-basiert) bleibt bestehen und funktioniert
weiterhin pro Gerät, synchronisiert aber nicht zwischen Geräten und aktualisiert neue Übungen nicht
automatisch. Diese neue Firebase-Version ersetzt sie für den produktiven Einsatz; die alte kann als
Fallback dienen, falls du z. B. offline testen willst.
