# Oversteer

Pixel-art drifting game — Phaser 3 + TypeScript + Vite.

```bash
npm install
npm run dev
```

Controls: arrows/WASD drive · SPACE boost (charged by drifting) · X handbrake · R restart · ENTER respawn · ESC menu · M mute · F fullscreen.
A gamepad works too: left stick or d-pad steers, triggers drive, A/RB boost, X/B/LB handbrake, Start pauses, Y respawns,
Back restarts (and it rumbles when you drift, boost or crash).

## What makes it fun

- **Sound** (`src/game/audio.ts`): all synthesised with Web Audio, so there are still no asset files. Engine pitch follows speed,
  tyres screech with slip, gravel rumbles, a siren swells as a cruiser closes in, and there are call-out jingles. **M** mutes
  (remembered on this device).
- **Drift combos:** the live chain shows its multiplier (`DRIFT +42 x2.3`), swells and warms up as it grows, and a banked
  chain is called out (NICE / GREAT / HUGE / INSANE DRIFT). A chain lost on the grass buzzes and says so.
- **Endless and OVERSTEER** (`src/game/RoadEvents.ts`): oil slicks (no grip, no drift coins for a moment), traffic cones,
  roadblocks with a gap, and drift gates that pay more if you slide through them. Police get one **wanted star** per 35 s
  (faster cruisers in Endless, a fourth cruiser from level 4). A long drift chain **spins the nearest cruiser out**, and a
  near miss with a cruiser pays a **close call** bonus. Getting busted plays out in slow motion.
- **Daily road:** the second row of the Endless and OVERSTEER tabs is a road everybody shares today (seed from the UTC date).
  Its best is kept on this device only, and daily runs never touch the online Endless boards.
- **Medals:** every circuit has bronze, silver and gold times, shown in the menu and while you race (`src/game/medals.ts`).
  They are multiples of what the starter Hatchback's benchmark bot drives, generated into `src/game/medalTimes.ts`:
  after `npm run benchmark -- --write` run `npm run medals -- --write` (`npm run medals` checks it is current). The first
  time you reach a medal on a track it pays a bonus. Laps show a split against your best lap.
- **Goals** (`src/game/challenges.ts`, menu key **C**): one-off challenges that pay coins, checked automatically as you drive.
  Not paid in the tutorial.
- **Paint shop** (`src/game/cosmetics.ts`, Garage key **P**): paint jobs and tyre-smoke colours for coins. Looks only.
- Confetti and a banner for new records and new bests; the profile save gained `paints`, `smokes` and `done` lists, merged
  as unions (`saveMerge.ts`, tested by `npm run test:merge`).

## PvP races (online)

Pick a circuit in the menu and press **V** (or click **PVP RACE**). **Quick match** drops you into a room for that track with
whoever else is looking (a public room starts 8 s after a second driver arrives, or at once with **ENTER**; four drivers
max). **Private room** makes a 5-character code for friends, and **Join with code** takes one; the host starts it.

Everyone drives their own car and sees the others as live cars (no collisions) with a running order, minimap dots and a
results panel. Pays coins by place (1st 1.5x, 2nd 1x, 3rd/4th 0.5x of the track's race pay); it never touches records,
medals, ghosts or the leaderboards. There are no pauses or restarts mid-race.

How it works (`src/net/pvp.ts`, `src/scenes/PvpLobbyScene.ts`, `src/scenes/PvpScene.ts`): a room is one Firestore document
(`rooms/{code}`: roster, status) plus a `rooms/{code}/live/{uid}` document per driver that is rewritten ~7 times a second with
the car's position and progress. Finish times are reported by the drivers, so, as with the leaderboard, the rules only bound
them. **Deploy the updated `firestore.rules` before this works online.** Old rooms are never deleted; add a Firestore TTL
policy on a field if the collection grows.

To try it without Firebase, open two tabs of a dev build at `/?pvp=local`: the same code runs over localStorage.

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

Race times faster than a believable minimum for each track are rejected by the rules, and so are boards that
aren't real tracks. The minimums are generated: after changing tracks or cars run `npm run check:rules -- --write`,
then `firebase deploy --only firestore:rules` (`npm run check:rules` fails while they're out of date).

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
A `#save=` link is only accepted when the browser says it came from one of the game's own addresses
(`SAVE_SENDER_HOSTS` in `src/game/config.ts`), and only carries the name, profile, records, ghosts and settings, so a
made-up link can't hand out coins or cars.

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

## Online accounts (Google sign-in required)

Players must sign in with Google on the title screen before they can play (local `npm run dev` builds skip this). It keeps their coins, cars, upgrades and records online and
use them on any device. Signing in links their existing anonymous account, so leaderboard scores and replays stay
theirs. The online save is one document per player (`users/{uid}`), merged with the device's save by
`src/game/cloudMerge.ts` (tested by `npm run test:cloud`; coins use a three-way rule so devices never double-count).

One-time setup: Firebase console > Authentication > Sign-in method > enable **Google**; make sure your hosting
address is under Authentication > Settings > Authorized domains; then `firebase deploy --only firestore:rules`.
