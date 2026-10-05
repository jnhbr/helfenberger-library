#!/bin/bash
# 📮 Briefkasten-Dienst für Jans Mac: holt die Abgaben alle 5 Minuten automatisch
# in den Schulordner (siehe briefkasten-abholen.js).
#
#   bash admin/briefkasten-dienst.sh install     einrichten bzw. aktualisieren und starten
#   bash admin/briefkasten-dienst.sh jetzt       sofort einmal abholen (mit Ausgabe)
#   bash admin/briefkasten-dienst.sh status      läuft er? letzte Zeilen des Protokolls
#   bash admin/briefkasten-dienst.sh uninstall   Dienst entfernen (Abgaben und Einstellungen bleiben)
#
# Der Dienst liegt ausserhalb von Schreibtisch/iCloud in
#   ~/Library/Application Support/LibraryBriefkasten/   (Skript, node_modules, config.json)
# Protokoll: ~/Library/Logs/library-briefkasten.log
# Einstellungen (Zielordner, Fach-Ordnernamen): config.json dort; nach einer
# Änderung ist kein Neustart nötig.
set -euo pipefail

LABEL="ch.helfenberger.library-briefkasten"
ZIEL="$HOME/Library/Application Support/LibraryBriefkasten"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/library-briefkasten.log"
HIER="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node || true)"

case "${1:-}" in
  install)
    [ -n "$NODE" ] || { echo "node nicht gefunden"; exit 1; }
    SCHLUESSEL="${BRIEFKASTEN_SCHLUESSEL:-$HOME/Desktop/Claude/Projekte/helfenberger-library-firebase/admin/serviceAccountKey.json}"
    [ -f "$SCHLUESSEL" ] || { echo "Service-Account-Schlüssel fehlt: $SCHLUESSEL"; exit 1; }
    mkdir -p "$ZIEL" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cp "$HIER/briefkasten-abholen.js" "$ZIEL/"
    if [ ! -f "$ZIEL/config.json" ]; then
      cat > "$ZIEL/config.json" <<EOF
{
  "benutzer": "helfenberger",
  "schluessel": "$SCHLUESSEL",
  "basis": "$HOME/Desktop/Altnau/Fächer",
  "muster": "{fach}/Abgaben/{ordner}",
  "faecher": {},
  "mitteilung": true
}
EOF
    fi
    if [ ! -d "$ZIEL/node_modules/firebase-admin" ]; then
      (cd "$ZIEL" && [ -f package.json ] || echo '{"name":"library-briefkasten","private":true}' > "$ZIEL/package.json")
      # Eigener Cache: der normale npm-Cache hatte auf Jans Mac Dateien mit falschen Rechten.
      (cd "$ZIEL" && npm install --no-audit --no-fund --cache "$ZIEL/.npm-cache" firebase-admin@12 >/dev/null)
      rm -rf "$ZIEL/.npm-cache"
    fi
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$ZIEL/briefkasten-abholen.js</string>
  </array>
  <key>WorkingDirectory</key><string>$ZIEL</string>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "📮 Dienst läuft: alle 5 Minuten, Abgaben landen unter dem in config.json eingestellten Ordner."
    echo "   Einstellungen: $ZIEL/config.json"
    echo "   Protokoll:     $LOG"
    ;;
  jetzt)
    "$NODE" "$ZIEL/briefkasten-abholen.js" --laut
    ;;
  status)
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state|last exit code|run interval" || echo "Dienst ist nicht eingerichtet."
    [ -f "$LOG" ] && tail -n 15 "$LOG" || true
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Dienst entfernt. Einstellungen und Protokoll bleiben in $ZIEL bzw. $LOG."
    ;;
  *)
    sed -n '2,9p' "$0"
    ;;
esac
