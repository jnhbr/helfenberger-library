# 🦒 Stille Safari — Herkunft und Lizenz

Die «Stille Safari» in der ⏱ Ruhephase der Library ist **verändert nach
teacher.dev/shy-safari** (Quellcode: https://github.com/teacherdotdev/shy-safari).

Shy Safari steht unter der **Apache License 2.0** (vollständiger Text: `LICENSE.txt`
in diesem Ordner). Die Grafiken (SVG-Dateien) liegen im Original-Repo im selben
Projekt ohne eigene, abweichende Lizenz und fallen damit ebenfalls unter die
Apache License 2.0.

## Was übernommen und was verändert wurde

- **Übernommen:** Idee (Tiere kommen bei Ruhe hervor, statt Lärm zu bestrafen),
  die Grafiken der Szenen Savanne (`savanna`), Korallenriff (`reef`), Wald
  (`forest`), Weltraum (`space`), Urzeit (`prehistoric`), Dschungel (`jungle`),
  Arktis (`arctic`) und Fabelwesen (`mythical`), deren Szenen-CSS (automatisch
  auf die Szene begrenzt), die Kalibrierung (`src/lib/audio/calibration.ts`),
  die Lautstärke- und Tempo-Stufen (`src/lib/settings/settings.svelte.ts`), die Anordnung der Kulisse, das Bewegungsmodell
  (`src/lib/scenes/motion.ts`), der «Zu laut»-Eimer (`src/lib/noise/loudState.ts`),
  die Ankunftsuhr (`src/lib/session/arrivalClock.ts`), der Seltenheits-Wurf
  (`src/lib/session/roll.ts`) und der Wegrenn-Takt (`src/lib/session/scareClock.ts`).
- **Verändert:** neu geschrieben in Vanilla-JavaScript (statt Svelte) direkt in
  `index.html` der Library; deutsche Oberfläche; an den Ruhephase-Timer gekoppelt
  (Tiere kommen nur, solange er läuft; bei Pause/Ende drehen sie sich zur Klasse);
  Ankunftstakt aus der Timer-Dauer; zusätzlicher Modus «Tiere verstecken sich»;
  SVGs verkleinert (Kommentare/Leerraum entfernt) und je Szene in eine JSON-Datei
  gepackt; teacher.dev-Branding, Analytics, die Halloween-Szene (nur im Oktober),
  Notizen auf der Szene und das schwebende Fenster weggelassen. Nachgeführt am
  25.11.2026 (Stand des Originals: 21.11.2026).

Die Dateien `savanne.json`, `riff.json`, `wald.json`, `weltraum.json`, `urzeit.json`,
`dschungel.json`, `arktis.json` und `fabel.json` erzeugt
`admin/safari-szenen-bauen.js` aus einem Klon des Original-Repos.
