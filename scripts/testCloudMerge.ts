// Tests how a device's save and an account's online save combine. Run: npm run test:cloud
import { coinsOf, mergeCloud } from '../src/game/cloudMerge.ts';
import type { SaveData } from '../src/game/saveMerge.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  ' + detail}`); };
const j = JSON.stringify;
const save = (coins: number, owned: string[], extra: object = {}): SaveData => ({
  'oversteer.player': 'RAY',
  'oversteer.profile.v1': j({ coins, owned, selected: owned[owned.length - 1], levels: {}, ...extra }),
  'oversteer.records.v1': j({ tracks: {}, endless: 100 }),
});

// 1. first sign-in, nothing online yet: the account takes this device's save as it is
const first = mergeCloud(save(250, ['hatch', 'kart']), null, 0);
check('first sign-in keeps the local coins', first.coins === 250 && coinsOf(first.merged) === 250);

// 2. syncing again without playing changes nothing (this is what stops coins doubling)
const again = mergeCloud(first.merged, first.merged, first.coins);
check('re-sync with no changes keeps coins the same', again.coins === 250, String(again.coins));
const again2 = mergeCloud(again.merged, again.merged, again.coins);
check('and again', again2.coins === 250);

// 3. earn 40 on this device, then sync: cloud 250 + 40
const earned = mergeCloud(save(290, ['hatch', 'kart']), first.merged, 250);
check('coins earned since the last sync are added', earned.coins === 290, String(earned.coins));

// 4. two devices: A earns 100, B spends 200 (both started from 250 synced)
const cloudAfterA = save(350, ['hatch', 'kart']);
const b = mergeCloud(save(50, ['hatch', 'kart', 'coupe']), cloudAfterA, 250);
check('A earned 100 and B spent 200: 250 + 100 - 200 = 150', b.coins === 150, String(b.coins));
check('B keeps the car it bought', (JSON.parse(b.merged['oversteer.profile.v1']).owned as string[]).includes('coupe'));

// 5. a brand-new device pulls the account
const fresh = mergeCloud({}, save(900, ['hatch', 'rocket']), 0);
check('a fresh device gets the online coins and cars', fresh.coins === 900 && JSON.parse(fresh.merged['oversteer.profile.v1']).owned.includes('rocket'));
check('and the name', fresh.merged['oversteer.player'] === 'RAY');

// 6. a device with its own progress joins an account that already has some: both playthroughs count once
const join = mergeCloud(save(100, ['hatch', 'kart']), save(300, ['hatch', 'sedan']), 0);
check('separate playthroughs add up: 100 + 300', join.coins === 400, String(join.coins));
check('owned cars are the union', JSON.parse(join.merged['oversteer.profile.v1']).owned.length === 3);

// 7. records keep the best of both
const rA = save(0, ['hatch']); rA['oversteer.records.v1'] = j({ tracks: { x: { best: 60 } }, endless: 500 });
const rB = save(0, ['hatch']); rB['oversteer.records.v1'] = j({ tracks: { x: { best: 55 }, y: { best: 70 } }, endless: 300 });
const rec = JSON.parse(mergeCloud(rA, rB, 0).merged['oversteer.records.v1']);
check('records: faster time, extra track and longer distance win', rec.tracks.x.best === 55 && rec.tracks.y.best === 70 && rec.endless === 500, j(rec));

// 8. coins never go negative
check('coins never go negative', mergeCloud(save(0, ['hatch']), save(10, ['hatch']), 500).coins === 0);

// 9. only the three save keys go online
const noisy = { ...save(5, ['hatch']), 'oversteer.ghost.v2.x': 'big', 'oversteer.transferId': 'secret' };
check('ghosts and bookkeeping are not uploaded', Object.keys(mergeCloud(noisy, null, 0).merged).every((k) => ['oversteer.player', 'oversteer.profile.v1', 'oversteer.records.v1'].includes(k)));

// 10. the online write fails after the device already took the merged save (account.ts then keeps the online
// balance as the base): the next sync must neither drop this device's coins nor count the online ones twice
const cloud10 = save(100, ['hatch']);
const m10 = mergeCloud(save(50, ['hatch']), cloud10, 0); // device now holds 150, the online save still 100
const retrySame = mergeCloud(m10.merged, cloud10, coinsOf(cloud10));
check('failed write, retry: 100 online + 50 from this device = 150', retrySame.coins === 150, String(retrySame.coins));
const retryMoved = mergeCloud(m10.merged, save(130, ['hatch']), coinsOf(cloud10));
check('failed write, another device added 30 meanwhile: 180', retryMoved.coins === 180, String(retryMoved.coins));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
