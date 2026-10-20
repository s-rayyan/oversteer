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

## Moving players off the game hub's iframe

Browsers give a game inside another site's iframe its own separate storage, so saves made in the hub's embedded copy
aren't visible when the game is opened directly. When the game detects it is embedded, it packs its save into a link's
`#fragment` (it never leaves the browser) and sends the whole tab to the standalone game. Browsers usually require one
click before an embedded page may do that, so if the automatic redirect is blocked a single PLAY button does it.
The standalone game merges the save with anything already there: best times, faster ghosts, all owned cars, higher
upgrade levels, and coins from both (each source save's coins are only counted once, however often it's sent).
See `src/game/saveTransfer.ts` and `src/game/saveMerge.ts`; `npm run test:merge` tests the merge rules.

## Cars, tracks and balance

- **Car classes** (All-Rounder, Speedster, Grip Racer, Drifter, Off-Roader, Booster, Agile, Hypercar) are defined by rules on
  their stats (`src/game/cars.ts`). `npm run check:cars` fails if a car matches no class or more than one.
- **Track features:** gravel sections (cars keep `offRoadCap` of their speed: off-roaders win), boost pads (refill `padGain` of
  the boost meter: boosters win), drift zones (low-grip cars charge boost fast in them) and hairpins/technical corners.
  See `src/game/surfaces.ts`; tracks list them as fractions of the lap.
- **Balance:** `npm run benchmark` laps every track with every car in a headless simulator (`scripts/sim.ts`, the game's own
  physics) and checks that every car class wins at least one track. `npm run benchmark -- --write` regenerates
  `src/game/trackBest.ts`, which the menu reads. Paste `scripts/benchmarkLaps.js` into the browser console to confirm the
  real game still matches the simulator.
- Cars are driven by a simple line-following bot, so the benchmark measures clean-racing pace, not skilled play.

Tools: `npm run check:tracks` validates track layouts; `npm run check:cars` verifies car classes; `npm run check:trackclasses` checks each track's recommended car class against the lap benchmark (`scripts/benchmarkLaps.js` regenerates it); `npm run test:road` stress-tests the endless-road generator (add `--legacy` to see the old, broken one fail).

## Performance

- The corner readout shows the frame rate and the renderer (`WebGL`, or `Canvas` when the browser has no graphics card). **P** hides or shows it.
- If the frame rate stays under 40 for a few seconds, the game turns on **low effects** by itself (no particles, skid marks, screen shake, speed zoom or vignette). **Q** flips it by hand. Every visit starts with full effects (low effects is not remembered, since a computer's speed changes with battery saver and the like); hiding the readout is remembered.
- `?renderer=canvas` on the address forces the plain 2D renderer, worth trying on a computer where WebGL is slow.
- Roads are painted once into textures instead of being redrawn every frame (`bakeGraphics` in `Track.ts`).

## Online accounts (optional Google sign-in)

Players can sign in with Google from the title screen to keep their coins, cars, upgrades and records online and
use them on any device. Signing in links their existing anonymous account, so leaderboard scores and replays stay
theirs. The online save is one document per player (`users/{uid}`), merged with the device's save by
`src/game/cloudMerge.ts` (tested by `npm run test:cloud`; coins use a three-way rule so devices never double-count).

One-time setup: Firebase console > Authentication > Sign-in method > enable **Google**; make sure your hosting
address is under Authentication > Settings > Authorized domains; then `firebase deploy --only firestore:rules`.
