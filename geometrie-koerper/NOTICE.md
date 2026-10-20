# Geometrische Körper

Dieser Ordner enthält einen geänderten, statischen Build von **Geometric Solids**
(https://github.com/teacherdotdev/geometric-solids, Stand cae6532 vom 18.09.2026),
lizenziert unter der Apache License 2.0 (siehe `LICENSE`).

## Änderungen für Helfenberger's Library (20.10.2026)

- Deutsche Oberfläche ergänzt (`src/lib/i18n/de.ts`), Sprache fest auf Deutsch, Sprachwahl entfernt.
- Formeln mit O (Oberfläche) und U (Umfang) statt SA/C, Flächen-Kürzel deutsch (D, G, M, Vo, Hi, Li, Re).
- Einheiten nur cm und m (Standard cm).
- teacher.dev-Branding, Umbenennungs-Hinweis, About-/Datenschutz-Seiten und Cloudflare-Analytics entfernt.
- «Schweben» (Picture-in-Picture) ausgeblendet, wenn die Seite eingebettet läuft (geht nur im obersten Fenster).
- Build auf Vite 5 / adapter-static umgestellt (relative Pfade, läuft als Unterordner), Tests entfernt.

Der Code ist nicht von Helfenberger's Library geschrieben, nur angepasst.
