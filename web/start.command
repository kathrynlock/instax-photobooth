#!/bin/bash
# Double-click to start the booth: serves this folder on localhost and opens
# it in Chrome (Web Bluetooth printing needs Chrome or Edge, not Safari).
cd "$(dirname "$0")"
PORT=8642
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
open -a "Google Chrome" "http://localhost:$PORT/" 2>/dev/null || open "http://localhost:$PORT/"
echo "Instax booth running at http://localhost:$PORT"
echo "Add ?demo to the address to try it without the printer."
echo "Close this window (or press Ctrl-C) to stop."
wait $SERVER
