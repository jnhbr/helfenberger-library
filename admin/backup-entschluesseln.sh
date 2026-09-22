#!/bin/bash
# Helfenberger's Library — wöchentliches Backup (GitHub Action «Wöchentliches
# Backup» im Live-Repo) entschlüsseln und auspacken.
#
#   admin/backup-entschluesseln.sh <library-backup-DATUM.zip | Ordner> [Zielordner]
#
# Braucht den privaten Schlüssel (nur auf Jans Mac):
#   ~/Desktop/Claude/Library-Unterlagen/Backups/Schluessel/backup-privat.pem
# oder BACKUP_KEY=<pfad> setzen. Ergebnis: ein Ordner mit <collection>.jsonl
# pro Collection — zurückspielen mit  node admin/restore.js <ordner>.
set -euo pipefail

quelle="${1:?Pfad zum heruntergeladenen Artefakt (.zip oder entpackter Ordner) angeben}"
key="${BACKUP_KEY:-$HOME/Desktop/Claude/Library-Unterlagen/Backups/Schluessel/backup-privat.pem}"
[ -f "$key" ] || { echo "Privater Schlüssel nicht gefunden: $key" >&2; exit 1; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
if [ -d "$quelle" ]; then cp "$quelle"/* "$tmp"/; else unzip -q "$quelle" -d "$tmp"; fi
enc=$(ls "$tmp"/*.tar.gz.enc | head -1)
kenc=$(ls "$tmp"/*.key.enc | head -1)
name=$(basename "$enc" .tar.gz.enc)
ziel="${2:-$HOME/Desktop/Claude/Library-Unterlagen/Backups/$name}"

openssl pkeyutl -decrypt -inkey "$key" -pkeyopt rsa_padding_mode:oaep -in "$kenc" -out "$tmp/key.bin"
openssl enc -d -aes-256-cbc -pbkdf2 -md sha256 -iter 100000 -in "$enc" -out "$tmp/backup.tar.gz" -pass "file:$tmp/key.bin"
mkdir -p "$ziel"
tar xzf "$tmp/backup.tar.gz" -C "$ziel"
echo "Entschlüsselt nach: $ziel"
cat "$ziel/_info.json" 2>/dev/null || true
