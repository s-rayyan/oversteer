// Tests the save-merge rules used when moving a save out of the old embedded copy. Run: npm run test:merge
import { IMPORTED_KEY, MIGRATED_KEY, describeSave, hasProgress, mergeSaves, type SaveData } from '../src/game/saveMerge.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  ' + detail}`); };
const j = JSON.stringify;

// The embedded copy (old) and the new tab (which may have been played a bit already).
const old: SaveData = {
  'oversteer.player': 'Rayyan',
  'oversteer.profile.v1': j({ coins: 300, owned: ['hatch', 'kart'], selected: 'kart', levels: { kart: { engine: 2, tires: 0, turbo: 1 } } }),
  'oversteer.records.v1': j({ tracks: { 'sunset-oval': { best: 61.2, bestLap: 20.1 }, razor: { best: 99.9, bestLap: 33 } }, endless: 2400 }),
  'oversteer.ghost.v2.sunset-oval': j({ time: 61.2, carId: 'kart', frames: [1, 2, 3, 4] }),
  'oversteer.ghost.v2.razor': j({ time: 99.9, carId: 'kart', frames: [9] }),
  [MIGRATED_KEY]: '123',
};
const fresh: SaveData = {
  'oversteer.player': 'R2',
  'oversteer.profile.v1': j({ coins: 50, owned: ['hatch', 'sedan'], selected: 'sedan', levels: { kart: { engine: 1, tires: 3, turbo: 0 } } }),
  'oversteer.records.v1': j({ tracks: { 'sunset-oval': { best: 64, bestLap: 19.5 } }, endless: 3100 }),
  'oversteer.ghost.v2.sunset-oval': j({ time: 64, carId: 'sedan', frames: [7] }),
};

// 1. moving into an empty new tab copies everything (except the migrated marker)
const intoEmpty = mergeSaves({}, old, 't1');
check('empty target gets every save key', ['oversteer.player', 'oversteer.records.v1', 'oversteer.ghost.v2.sunset-oval', 'oversteer.ghost.v2.razor'].every((k) => intoEmpty[k] === old[k]));
const ep = JSON.parse(intoEmpty['oversteer.profile.v1']);
check('empty target gets the whole profile', ep.coins === 300 && j(ep.owned) === j(['hatch', 'kart']) && ep.selected === 'kart' && j(ep.levels) === j({ kart: { engine: 2, tires: 0, turbo: 1 } }), j(ep));
check('migrated marker is not copied', intoEmpty[MIGRATED_KEY] === undefined);

// 2. merging into a tab that already has progress keeps the best of both
const m = mergeSaves(fresh, old, 't2');
const p = JSON.parse(m['oversteer.profile.v1']);
const r = JSON.parse(m['oversteer.records.v1']);
check('coins from both are kept', p.coins === 350, String(p.coins));
check('owned cars are combined', ['hatch', 'kart', 'sedan'].every((c) => p.owned.includes(c)) && p.owned.length === 3, j(p.owned));
check('upgrade levels take the higher one', j(p.levels.kart) === j({ engine: 2, tires: 3, turbo: 1 }), j(p.levels.kart));
check('selected car stays the current one', p.selected === 'sedan');
check('player name stays the current one', m['oversteer.player'] === 'R2');
check('best race time kept (61.2 beats 64)', r.tracks['sunset-oval'].best === 61.2);
check('best lap kept (19.5 beats 20.1)', r.tracks['sunset-oval'].bestLap === 19.5);
check('record only in the old save is added', r.tracks.razor.best === 99.9);
check('endless keeps the longer distance', r.endless === 3100);
check('faster ghost kept', JSON.parse(m['oversteer.ghost.v2.sunset-oval']).time === 61.2);
check('ghost only in the old save is added', m['oversteer.ghost.v2.razor'] === old['oversteer.ghost.v2.razor']);

// 3. the same save moved twice must not double the coins...
const twice = mergeSaves(m, old, 't2');
check('repeat transfer adds no coins', JSON.parse(twice['oversteer.profile.v1']).coins === 350, JSON.parse(twice['oversteer.profile.v1']).coins);
check('repeat transfer changes nothing else', twice['oversteer.records.v1'] === m['oversteer.records.v1'] && twice['oversteer.ghost.v2.razor'] === m['oversteer.ghost.v2.razor']);
// ...but coins earned in the old copy since the last move do come across
const later = { ...old, 'oversteer.profile.v1': j({ ...JSON.parse(old['oversteer.profile.v1']), coins: 320 }) };
const again = mergeSaves(twice, later, 't2');
check('only the 20 new coins are added on a later move', JSON.parse(again['oversteer.profile.v1']).coins === 370, JSON.parse(again['oversteer.profile.v1']).coins);
check('a different source save counts in full', JSON.parse(mergeSaves(m, old, 'other')['oversteer.profile.v1']).coins === 650);

// 4. a corrupt value never wipes good data
const corrupt = mergeSaves(fresh, { 'oversteer.profile.v1': '{not json' }, 't3');
check('corrupt incoming profile leaves current untouched', corrupt['oversteer.profile.v1'] === fresh['oversteer.profile.v1']);

// 5. helpers
check('hasProgress ignores bookkeeping keys', !hasProgress({ [MIGRATED_KEY]: '1', [IMPORTED_KEY]: '{}', 'oversteer.transferId': 'x' }) && hasProgress(old));
check('describeSave summarises', describeSave(old) === '300 coins, 2 cars, 2 track records, 2 ghosts', describeSave(old));

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
