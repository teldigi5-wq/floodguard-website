# FloodGuard Firebase security

The website now listens only to the public monitoring fields it displays. It does not request the ESP8266 IP address or Wi-Fi name, and all incoming values are validated before entering UI state.

## Before publishing the draft rules

1. Confirm the Arduino or ESP8266 writer authenticates with Firebase.
2. In Firebase Console, open Realtime Database and then Rules.
3. Copy firebase.rules.secure-draft.json into the Rules editor.
4. Use the Rules Playground to confirm:
   - unauthenticated reads of monitoring fields succeed;
   - unauthenticated reads of esp8266/ip and esp8266/wifi fail;
   - unauthenticated writes fail;
   - authenticated controller writes succeed.
5. Publish only after those four tests pass.

Do not publish these rules if the controller currently writes without authentication. Configure controller authentication first, otherwise live uploads will stop.
