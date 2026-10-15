# Oversteer

Pixel-art drifting game — Phaser 3 + TypeScript + Vite.

```bash
npm install
npm run dev
```

Controls: arrows/WASD drive · SPACE boost (charged by drifting) · R restart · ENTER respawn · ESC menu.

## Global leaderboard (Firebase)

The game works without Firebase (records stay in your browser). To enable the global leaderboard:

1. Create a project at <https://console.firebase.google.com>.
2. **Build → Authentication → Sign-in method**: enable **Anonymous**.
3. **Build → Firestore Database**: create a database (production mode).
4. **Firestore → Rules**: paste the contents of [`firestore.rules`](firestore.rules) and publish
   (or `firebase deploy --only firestore:rules`).
5. **Project settings → Your apps → Web app**: register one and copy its config.
6. `cp .env.example .env` and fill in the four `VITE_FIREBASE_*` values, then restart `npm run dev`.

Data model: `boards/{trackId | endless}/scores/{uid}` → `{ uid, name, value, updatedAt }`, one doc per player per board
(race = milliseconds, lower wins; endless = metres, higher wins). Players are anonymous Firebase users; the name is
whatever they typed (12 chars). Rules only allow a player to write their own doc, and only to improve it.

**Caveat:** scores are submitted by the client, so a determined player can post a fake time within the allowed range.
The rules bound the values but cannot verify a run; real anti-cheat needs server-side replay validation.

Tools: `npm run check:tracks` validates track layouts; `npm run test:road` stress-tests the endless-road generator (add `--legacy` to see the old, broken one fail).
