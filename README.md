# Helfenberger's Library

Lernplattform der Sekundarschule Altnau: Übungen, Trainer, Kalender, Stundenplan, Online-Prüfungen,
Datei-Abgabe und Werkzeuge für den Unterricht. Läuft im Browser auf Laptop, iPad und Handy.

- **Live:** https://jnhbr.github.io/helfenberger-library/
- **Anleitung für Lehrpersonen:** [`hilfe.html`](hilfe.html) (in der App unter ⚙️ Einstellungen → ❓ Hilfe)
- **Stand:** alle 14 Klassen der Schule, dazu eigene Seiten für Fachlehrpersonen, ISF, Praktikum und Zivi

Diese Datei beschreibt Aufbau und Betrieb. Sie ersetzt die Einrichtungs-Anleitung aus der Anfangszeit
(eine Klasse, Gratis-Tarif, Passwort aus dem Namen abgeleitet) – davon gilt nichts mehr.

## Aufbau

| Teil | Lösung |
|---|---|
| Seite | Eine Datei `index.html` ohne Build-Schritt, ausgeliefert über GitHub Pages |
| Anmeldung | Firebase Authentication (E-Mail/Passwort, interne Adressen) |
| Daten | Cloud Firestore, Region `eur3`, Tarif Blaze (bezahlt pro Zugriff, kein Tageslimit) |
| Dateien | Kein Cloud Storage: Übungsseiten, PDFs und Briefkasten-Abgaben liegen gestückelt in Firestore (rund 900 KB pro Dokument, höchstens 8 MB pro Übung, 4 MB pro PDF) |
| Erinnerungen | Web Push mit eigenem Schlüssel, verschickt von einer GitHub Action (`admin/send-reminders.js`) |
| Schriften, Bibliotheken | Selbst gehostet in `assets/vendor/` (Liste und Lizenzen in `assets/vendor/LIZENZEN.txt`). Von fremden Servern kommt nur das Firebase-SDK; Google Translate wird nur angefragt, wenn jemand den Fremdsprachen-Modus einschaltet |
| Offline | Service Worker `sw-push.js` (App-Hülle aus dem Cache) und der Offline-Cache von Firestore |

```
index.html          die ganze App
hilfe.html          Anleitung für Lehrpersonen (statisch)
sva/                statische Seiten zur Abschlussarbeit (Dossier-Werkstatt, Mein Projekt)
seb/                Konfiguration für den Safe Exam Browser
assets/             Bilder, Logo, assets/vendor/ (Bibliotheken und Schriften)
firestore.rules     Zugriffsregeln der Datenbank
sw-push.js          Service Worker (Offline-Start, Push)
admin/              Skripte für den Betrieb und die Tests (laufen lokal oder als GitHub Action)
```

## Konten und Rollen

- **Schüler:innen** melden sich mit Vorname oder Schul-Kürzel und ihrem persönlichen Passwort an. Sie sehen nur
  ihre Klasse und die Gruppen, in denen sie Mitglied sind.
- **Lehrpersonen** melden sich mit dem Nachnamen an. Sie haben eine eigene Seite (Klasse, FLP oder ISF) und
  können in alle Seiten wechseln; vor Änderungen in einer fremden Seite fragt die App nach.
- **Schulleitung** liest alles, was Lehrpersonen lesen, schreibt aber nirgends.
- **Praktikum und Zivi** sind Konten für den Unterricht: Übungen, Material, Kalender, Stundenplan und
  Klassenzimmer-Werkzeuge. Die Auswertung ist gesperrt (Lernstand, Online-Prüfungen und Noten, Earlybird,
  Vergessen-Zähler, Schulden, Prüfungskorrekturen, Passwörter zurücksetzen).

Die Rechte hängen an Custom Claims (`klasse`, `teacher`, `leitung`), die nur die Admin-Skripte setzen können, und
werden in `firestore.rules` durchgesetzt – nicht im Browser. Konten und Passwörter legt `admin/schule-konten.js` aus
einer Excel-Liste an; **Passwortlisten und der Service-Account-Schlüssel gehören nie ins Repo** (`.gitignore`).
Passwörter ändert jede Person selbst unter ⚙️ Einstellungen; vergessene Passwörter von Schüler:innen setzt eine
Lehrperson über eine Anfrage zurück (`admin/passwort-reset.js`).

`firebaseConfig` in `index.html` ist kein Geheimnis. Die Absicherung läuft über die Anmeldung und die Regeln.

## Datenschutz und Sicherheit

- Klassen sind getrennt, private Noten liest nur die Person selbst, den Inhalt eines Briefkastens nur die
  Lehrperson, die ihn aufgestellt hat. Die Regeln haben Emulator-Tests (`admin/rules-test/`).
- Tägliche Sicherung der Datenbank (7 Tage), minutengenaue Wiederherstellung (7 Tage), Löschschutz und ein
  wöchentliches verschlüsseltes Backup als GitHub-Artefakt (90 Tage).
- Abgeholte Briefkasten-Dateien werden nach 30 Tagen gelöscht.
- Offen ist die formelle Seite nach den Vorgaben des Kantons Thurgau (Trägerschaft durch die Schulgemeinde,
  Vereinbarung mit dem Anbieter, Löschfristen pro Schuljahr). Das wird mit Schulleitung und Datenschutzbeauftragtem geklärt.

## Kosten

Firebase-Tarif Blaze: abgerechnet wird pro Lese- und Schreibzugriff und pro gespeichertem Gigabyte. Für die ganze
Schule sind das einige Franken pro Monat. GitHub Pages und die GitHub Actions kosten nichts.

## Testseite & nächtliche Freigabe

- **Live (Schüler:innen):** https://jnhbr.github.io/helfenberger-library/ — Repo `jnhbr/helfenberger-library`
- **Test:** https://jnhbr.github.io/helfenberger-library-test/ — Repo `jnhbr/helfenberger-library-test`

Änderungen immer nur ins **Test-Repo** pushen. Der Workflow `.github/workflows/nightly-release.yml`
im Live-Repo kopiert den Stand der Testseite jede Nacht um 00:00 (Schweizer Zeit) auf die Live-Seite —
nur wenn sich etwas geändert hat und die Syntaxprüfung besteht. Läuft komplett bei GitHub.

- **Sofort live:** Live-Repo → *Actions* → „Testseite live schalten" → *Run workflow*.
- **Heute Nacht nicht:** im Test-Repo eine Datei `PAUSE` anlegen (wieder löschen, um fortzufahren).
- Beide Seiten nutzen **dieselbe Firebase-Datenbank** — Daten, die du auf der Testseite anlegst/löschst, sind echt.
  `firestore.rules` gelten sofort für beide; Regeländerungen, die neuen Code voraussetzen, erst nach der Freigabe publizieren.
- Auf der Testseite steht oben „🧪 Testseite"; Push-Erinnerungen sind dort ausgeschaltet.
- `manifest.json` und `assets/icon-*.png` sind im Test-Repo absichtlich anders (Name „Library Test", Icon mit ⚙️) und werden nie live kopiert. Icon-/Manifest-Änderungen für die Live-Seite also direkt im Live-Repo machen.
- Direkte Pushes aufs Live-Repo werden in der nächsten Nacht vom Stand der Testseite überschrieben (ausser `.github/`).

## Regeln der Datenbank publizieren

```bash
firebase deploy --only firestore:rules --dry-run   # prüft nur, ob sie kompilieren
firebase deploy --only firestore:rules
```

Vorher prüfen, dass die lokale `firestore.rules` dem Stand im Repo entspricht. Regeln gelten sofort für Test- und
Live-Seite.

## Grundsätze im Code

1. Kein Cloud Storage – grosse Inhalte werden byte-sicher gestückelt in Firestore abgelegt.
2. Möglichst keine zusammengesetzten Indizes: Abfragen mit einer `where()`-Bedingung, sortiert wird im Browser.
3. `delete`-Regeln immer separat und ohne Datenprüfung (`request.resource` ist beim Löschen `null`).
4. Keine nativen Dialoge (`alert`, `confirm`, `prompt`) – sie werfen Chrome aus dem Vollbild. Dafür gibt es
   `uiConfirm`, `uiPrompt` und `uiInfo`.
5. Übungsseiten laufen als `iframe srcdoc` im selben Ursprung und teilen sich `localStorage` mit der App: eigener
   Schlüssel-Präfix pro Übung, nie `hl_` (gehört der App), nie `localStorage.clear()`.
6. Neue Funktion → `hilfe.html`, die Library-Hilfe (`KIB_WISSEN`) und die Neuigkeiten (`NEUIGKEITEN`) nachführen.

`admin/check-leitplanken.js` prüft die Punkte 2 bis 4 bei jedem Push.

## Übungsseiten und Fortschritt

Lehrpersonen ziehen eine HTML-Datei oder ein PDF ins Fach; die Klasse sieht sie sofort. Damit die Library den
Fortschritt anzeigen kann, meldet eine Übungsseite ihren Stand an die übergeordnete Seite:

```js
if (window.parent && window.parent !== window) {
  window.parent.postMessage({ __libProgress: true, statsKey: 'irgendein_key', stats: stats, total: Q.length }, '*');
}
```

- `stats` ist ein Objekt `{ [aufgabenId]: { status: 'correct' | 'wrong', ... } }`.
- `total` (freiwillig) ist die Gesamtzahl der Aufgaben für den Balken «x von y».

Seiten ohne diese Meldung funktionieren auch, zeigen aber keinen Fortschritt.

## Safe Exam Browser (Prüfungen)

Pro Prüfung lässt sich «🛡️ Safe Exam Browser» einschalten. Dann startet die Prüfung nur im
[Safe Exam Browser](https://safeexambrowser.org) (SEB, gratis für Windows, macOS und iPad). Die
Konfiguration liegt in `seb/library.seb` (Live) bzw. `seb/library-test.seb` (Testseite) und öffnet
direkt die Library; erzeugt werden beide mit `node admin/seb-config.js` (Einstellungen dort
kommentiert). Schüler:innen im normalen Browser bekommen den Knopf «Im Safe Exam Browser öffnen»
(`sebs://…`-Link). Nach der Abgabe beendet die App SEB über `seb/beenden.html` (quitURL).
Erkannt wird SEB am User-Agent bzw. an `window.SafeExamBrowser` — kein Server-Check.

## 📮 Briefkasten (Datei-Abgabe)

Lehrpersonen stellen im Fach einen Briefkasten auf, Schüler:innen werfen Dateien ein. Die Dateien liegen als
Zwischenlager in Firestore (`klassen/{k}/briefkaesten/{id}/abgaben/{aid}/chunks`), bis die Lehrperson sie abholt, und
danach noch 30 Tage als Reserve (Einzel-Download unter «👥 Abgaben», aufgeräumt von `admin/briefkasten-aufraeumen.js`):

- **Alle Lehrpersonen:** Knopf «📬 Leeren» in Chrome/Edge (schreibt in einen einmal gewählten Ordner).
- **Jans Mac, automatisch alle 5 Minuten:** `bash admin/briefkasten-dienst.sh install` (launchd-Dienst mit
  `admin/briefkasten-abholen.js`; Ziel `~/Desktop/Altnau/Fächer/<Fach>/Abgaben/<Ordner>/`, Einstellungen in
  `~/Library/Application Support/LibraryBriefkasten/config.json`). `status`, `jetzt`, `uninstall` siehe Skript.

Optionen pro Briefkasten: «📁 Eigener Ordner pro Schüler:in» (`proPerson`: `<Ordner>/<Vorname>/<Originalname>`, Dateien sammeln
sich, nur gleiche Dateinamen werden ersetzt) und – wo der Dienst läuft – ein frei wählbarer Zielpfad
(`lehrer/{uid}/briefkaesten/{bid}.pfad`; ändert er sich, zieht der Dienst den Ordner um).

Ablage: `<Vorname>_<Originalname>`, frühere Fassungen derselben Person in `_Backup/` mit Zeitstempel,
`_Backup/briefkasten-stand.json` merkt sich, wer welche Dateien hat. Beide Wege teilen diese Logik – bei Änderungen
`bkLeerenLauf` (index.html) und `ablegen` (briefkasten-abholen.js) gleich halten.

## Admin-Skripte (Ordner `admin/`, lokal mit `serviceAccountKey.json`)

- `node backup.js [--ohne-inhalte]` — ganze Datenbank als JSONL nach `~/Desktop/Claude/Library-Unterlagen/Backups/<Datum>/`. Automatisch jeden Sonntag: Workflow «Wöchentliches Backup» im Live-Repo (`.github/workflows/backup.yml`, verschlüsseltes Artefakt, 90 Tage; öffnen mit `bash admin/backup-entschluesseln.sh <artefakt.zip>`).
- `node briefkasten-aufraeumen.js [--probe]` — löscht den Inhalt von Briefkasten-Abgaben, die vor über 30 Tagen abgeholt wurden (läuft im selben Workflow nach dem Backup).
- `node restore.js <backup-ordner> <pfad-präfix> [--ja]` — einzelne Dokumente/Sammlungen aus einer Sicherung zurückspielen (ohne `--ja` nur anzeigen).
- `node passwort-reset.js [--ja]` — Passwort-Anfragen der Lehrpersonen (⚙️ in der App) abarbeiten. Automatisch: `admin/workflows-vorlage/passwort-anfragen.yml` ins Live-Repo nach `.github/workflows/` legen.
- `node admin/uebung-ersetzen.js --klasse G3b --suche "Text"` bzw. `--id <id> --datei neu.html [--ja]` — Übung/Lehrer-HTML ersetzen wie «Datei ersetzen» in der App (Kopien in allen Klassen mit, vorherige Fassung wiederherstellbar; ohne `--ja` nur Vorschau).
- `node admin/material-import.js --klasse G3b --datei paket.json [--ordner "Name"] [--ja]` — Material-Paket (Quizze, Blitzumfragen, Wortwolken, Karteikarten) importieren wie «📥 Paket importieren»; nutzt dieselbe Aufbereitung wie die App (aus `index.html`).
- `node schuljahr.js vorlage|plan|ausfuehren <datei.json> [--ja]` — Schuljahreswechsel (Klassen ziehen weiter, 3. Klassen schliessen ab; macht vorher eine Sicherung).

## Prüfungen vor dem Live-Schalten

Bei jedem Push auf die Testseite läuft `.github/workflows/pruefen.yml` mit vier Prüfungen:

- **Leitplanken** – `node admin/check-leitplanken.js .` (Syntax, keine nativen Dialoge, delete-Regeln separat …)
- **Smoke-Test** – `admin/smoke-test.js`: die Seite lädt in Chromium, die Login-Maske erscheint.
- **Regeln** – `admin/rules-test/`: `firestore.rules` im Emulator.
- **Login-Test** – `admin/login-test/`: die echte Seite mit dem echten Firebase-SDK und echter Anmeldung gegen die
  Emulatoren (Weiche `?emu=1`, nur auf localhost, Projekt `demo-library`). Ein Lehrergerät und drei Schülergeräte
  spielen Schätzmeister, Buzzer, Bingo, Millionär und das Klassen-Quiz in Teams je einmal durch. Braucht Java 21;
  lokal: `cd admin/login-test && npm install && npx playwright install chromium && npm test`.

Keine dieser Prüfungen berührt die echte Datenbank.
