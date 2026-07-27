#!/bin/bash
# Doppelklick auf dem Mac startet mpScroll.
# Einmalig nötig: Rechtsklick -> Öffnen (Gatekeeper), oder im Terminal:
#   chmod +x STARTEN-MAC.command
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js wurde nicht gefunden."
  echo "Bitte zuerst Node.js 22 oder neuer installieren: https://nodejs.org"
  read -r -p "Zum Schließen Enter drücken …"
  exit 1
fi

node server.mjs
read -r -p "Server beendet. Zum Schließen Enter drücken …"
