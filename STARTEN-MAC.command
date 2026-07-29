#!/bin/bash
# Doppelklick auf dem Mac startet mpScroll.
# Einmalig noetig: Rechtsklick -> Oeffnen (Gatekeeper), oder im Terminal:
#   chmod +x STARTEN-MAC.command
cd "$(dirname "$0")" || exit 1

echo ""
echo "  mpScroll startet ..."
echo "  Suche Node.js ..."

# Sucht node im PATH und an den ueblichen Installationsorten (auch ohne Neustart).
find_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  local c
  for c in \
    "/usr/local/bin/node" \
    "/opt/homebrew/bin/node" \
    "/usr/bin/node" \
    "$HOME/.volta/bin/node" \
    "$HOME/n/bin/node"; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  # nvm: neueste installierte Version
  if [ -d "$HOME/.nvm/versions/node" ]; then
    local v
    v="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)"
    [ -n "$v" ] && [ -x "$HOME/.nvm/versions/node/$v/bin/node" ] && { echo "$HOME/.nvm/versions/node/$v/bin/node"; return 0; }
  fi
  return 1
}

NODE_BIN="$(find_node)"

# Optional automatisch per Homebrew installieren, falls vorhanden
if [ -z "$NODE_BIN" ] && command -v brew >/dev/null 2>&1; then
  echo ""
  echo "  Node.js ist noch nicht installiert."
  read -r -p "  Jetzt automatisch per Homebrew installieren? (j = ja): " ANTWORT
  if [ "$ANTWORT" = "j" ] || [ "$ANTWORT" = "J" ]; then
    brew install node
    NODE_BIN="$(find_node)"
  fi
fi

if [ -z "$NODE_BIN" ]; then
  echo ""
  echo "  Node.js konnte nicht gefunden werden."
  echo "  Bitte einmal installieren von: https://nodejs.org  (gruener LTS-Knopf)"
  echo "  Danach dieses Fenster schliessen und STARTEN-MAC erneut oeffnen."
  read -r -p "  Zum Schliessen Enter druecken ..."
  exit 1
fi

echo "  Node gefunden: $NODE_BIN"
echo ""
"$NODE_BIN" server.mjs
read -r -p "  Server beendet. Zum Schliessen Enter druecken ..."
