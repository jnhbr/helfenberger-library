# Algebra-Kacheln

Dieser Ordner enthält einen geänderten, statischen Build von **Algebra Tiles**
(https://github.com/teacherdotdev/algebra-tiles, Stand 9ebef6f vom 13.10.2026),
lizenziert unter der Apache License 2.0 (siehe `LICENSE`). Enthält die mitgelieferten
Pakete `@caret-js/*` (Matheeingabe) und `qrcode-generator` (MIT).

## Änderungen für Helfenberger's Library (20.10.2026)

- Alle Texte auf Deutsch übersetzt (Lehrpersonen-Seite, Aktivität, Rückmeldungen, Fehlermeldungen).
- Schüler-Link wird relativ zum Unterordner gebaut (`./play?…`).
- teacher.dev-Branding, Fusszeile, Hilfe-/Vorschlags-E-Mail, About-/Datenschutz-Seiten und Cloudflare-Analytics entfernt.
- Build von Vercel auf adapter-static und Vite 5 umgestellt (relative Pfade, läuft als Unterordner), Tests entfernt.

Der Code ist nicht von Helfenberger's Library geschrieben, nur angepasst.
