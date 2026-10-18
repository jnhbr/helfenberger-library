#!/bin/bash
# 🗓️ Kalender-Dienst für Jans Mac: gleicht jede Stunde den Apple-Kalender «Arbeit» mit
# «Mein Stundenplan» in der Library ab (siehe kalender-abgleich.js). Kalender nur lesen.
#
#   bash admin/kalender-dienst.sh install     einrichten bzw. aktualisieren und starten
#   bash admin/kalender-dienst.sh jetzt       sofort einmal abgleichen (mit Ausgabe)
#   bash admin/kalender-dienst.sh probe       nur zeigen, was sich ändern würde
#   bash admin/kalender-dienst.sh status      läuft er? letzte Zeilen des Protokolls
#   bash admin/kalender-dienst.sh uninstall   Dienst entfernen (Library-Daten bleiben)
#
# Der Dienst liegt ausserhalb von Schreibtisch/iCloud in
#   ~/Library/Application Support/LibraryKalender/   (Skript, node_modules, config.json)
# Protokoll: ~/Library/Logs/library-kalender.log
# Beim ersten Lauf fragt macOS, ob «node» den Kalender steuern darf → Erlauben
# (sonst: Systemeinstellungen › Datenschutz & Sicherheit › Automation).
set -euo pipefail

LABEL="ch.helfenberger.library-kalender"
ZIEL="$HOME/Library/Application Support/LibraryKalender"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/library-kalender.log"
HIER="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node || true)"

case "${1:-}" in
  install)
    [ -n "$NODE" ] || { echo "node nicht gefunden"; exit 1; }
    SCHLUESSEL="${KALENDER_SCHLUESSEL:-$HOME/Desktop/Claude/Projekte/helfenberger-library-firebase/admin/serviceAccountKey.json}"
    [ -f "$SCHLUESSEL" ] || { echo "Service-Account-Schlüssel fehlt: $SCHLUESSEL"; exit 1; }
    mkdir -p "$ZIEL" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cp "$HIER/kalender-abgleich.js" "$ZIEL/"
    if [ ! -f "$ZIEL/config.json" ]; then
      cat > "$ZIEL/config.json" <<EOF
{
  "benutzer": "helfenberger",
  "kalender": "Arbeit",
  "schluessel": "$SCHLUESSEL"
}
EOF
    fi
    if [ ! -d "$ZIEL/node_modules/firebase-admin" ]; then
      [ -f "$ZIEL/package.json" ] || echo '{"name":"library-kalender","private":true}' > "$ZIEL/package.json"
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
    <string>$ZIEL/kalender-abgleich.js</string>
  </array>
  <key>WorkingDirectory</key><string>$ZIEL</string>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "🗓️ Dienst läuft: jede Stunde Kalender «Arbeit» → Library-Stundenplan."
    echo "   Einstellungen: $ZIEL/config.json"
    echo "   Protokoll:     $LOG"
    ;;
  jetzt)
    "$NODE" "$ZIEL/kalender-abgleich.js" --laut
    ;;
  probe)
    "$NODE" "$ZIEL/kalender-abgleich.js" --probe
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
    sed -n '2,10p' "$0"
    ;;
esac
