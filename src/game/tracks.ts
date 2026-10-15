import type { CtrlPt } from './spline';
import type { SurfaceDef } from './surfaces';

export type Theme = 'grass' | 'desert' | 'snow' | 'night';
export type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Expert';

export interface TrackGroup {
  id: string;
  name: string;
  short: string;
  blurb: string;
}

export interface TrackDef extends SurfaceDef {
  id: string;
  name: string;
  group: string;
  difficulty: Difficulty;
  theme: Theme;
  /**
   * Closed loop of control points in world pixels (smoothed with a closed spline). A point may carry
   * its own road width as a third number, which gives thick and slim sections; otherwise `roadWidth` applies.
   */
  points: ReadonlyArray<CtrlPt>;
  /** Default road width (px). */
  roadWidth: number;
  laps: number;
}

export const THEMES: Theme[] = ['grass', 'desert', 'snow', 'night'];

export const GROUPS: TrackGroup[] = [
  { id: 'rookie', name: 'Rookie Cup', short: 'ROOKIE', blurb: 'Wide roads, gentle bends.' },
  { id: 'desert', name: 'Desert Rally', short: 'DESERT', blurb: 'Hairpins and long straights.' },
  { id: 'alpine', name: 'Alpine Series', short: 'ALPINE', blurb: 'Narrow, twisty, icy.' },
  { id: 'pro', name: 'Pro Circuit', short: 'PRO', blurb: 'Night races. No mercy.' },
  { id: 'special', name: 'Specialist Series', short: 'SPECIAL', blurb: 'Every track here rewards one kind of car.' },
];

export const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  Easy: '#52b788',
  Medium: '#ffd166',
  Hard: '#f4a261',
  Expert: '#e63946',
};

export const TRACKS: TrackDef[] = [
  // ---- Rookie Cup ----
  {
    id: 'sunset-oval', name: 'Sunset Oval', group: 'rookie', difficulty: 'Easy', theme: 'grass',
    points: [[390,130],[910,130],[1174,343],[1105,650],[650,780],[260,676],[146,393]],
    roadWidth: 84, laps: 3,
  },
  {
    id: 'meadow-loop', name: 'Meadow Loop', group: 'rookie', difficulty: 'Easy', theme: 'grass',
    points: [[390,156],[845,104],[1170,260],[1248,585],[936,806],[546,728],[309,705],[153,517],[208,299]],
    roadWidth: 84, laps: 3,
  },
  {
    id: 'lakeside', name: 'Lakeside', group: 'rookie', difficulty: 'Easy', theme: 'grass',
    points: [[278,216],[676,130],[1035,183],[1110,346],[1058,469],[936,546],[750,660],[651,819],[393,901],[156,676],[195,429]],
    roadWidth: 84, laps: 3,
  },
  {
    id: 'hilltop-cruise', name: 'Hilltop Cruise', group: 'rookie', difficulty: 'Easy', theme: 'grass',
    points: [[1346,627],[1352,839],[1092,1101],[608,1057],[329,913],[185,611],[287,391],[658,172],[1130,156],[1353,423]],
    roadWidth: 84, laps: 3,
  },
  {
    id: 'harbor-run', name: 'Harbor Run', group: 'rookie', difficulty: 'Easy', theme: 'grass',
    points: [[1468,610],[1336,816],[1070,910],[688,1015],[320,959],[212,785],[228,595],[221,417],[355,200],[715,156],[1082,265],[1355,380]],
    roadWidth: 84, laps: 3,
  },
  // ---- Desert Rally ----
  {
    id: 'dune-run', name: 'Dune Run', group: 'desert', difficulty: 'Medium', theme: 'desert',
    points: [[195,260,66],[624,130,58],[1040,286,63],[1242,325,72],[1320,489,70],[1170,676,60],[832,559,59],[585,780,68],[260,676,73]],
    roadWidth: 73, laps: 3,
  },
  {
    id: 'canyon-hairpin', name: 'Canyon Hairpin', group: 'desert', difficulty: 'Medium', theme: 'desert',
    points: [[195,195,58],[780,130,58],[1071,215,58],[1083,320,70],[962,416,73],[520,429,72],[425,558,58],[520,676,58],[1040,702,58],[1230,820,58],[1170,988,58],[520,1014,58],[156,845,58],[130,520,58]],
    roadWidth: 73, laps: 2,
  },
  {
    id: 'mesa-sprint', name: 'Mesa Sprint', group: 'desert', difficulty: 'Medium', theme: 'desert',
    points: [[164,148,72],[780,104,58],[1300,156,72],[1360,426,58],[1040,546,72],[845,780,72],[390,806,58],[156,520,72]],
    roadWidth: 72, laps: 3,
  },
  {
    id: 'oasis-loop', name: 'Oasis Loop', group: 'desert', difficulty: 'Medium', theme: 'desert',
    points: [[1349,748,58],[1404,909,58],[1342,1208,91],[884,1316,91],[577,1213,58],[255,980,58],[156,779,91],[282,485,91],[524,296,58],[927,156,58],[1366,281,91],[1421,594,91]],
    roadWidth: 91, laps: 3,
  },
  {
    id: 'dust-bowl', name: 'Dust Bowl', group: 'desert', difficulty: 'Medium', theme: 'desert',
    points: [[1528,789,88],[1388,948,96],[1359,1158,88],[1184,1416,71],[766,1463,58],[498,1101,58],[480,917,71],[342,775,88],[191,530,96],[339,237,88],[771,156,71],[1106,169,58],[1463,241,58],[1697,553,71]],
    roadWidth: 96, laps: 2,
  },
  // ---- Alpine Series ----
  {
    id: 'mountain-pass', name: 'Mountain Pass', group: 'alpine', difficulty: 'Hard', theme: 'snow',
    points: [[369,187,55],[650,104,55],[1014,234,62],[1170,494,69],[910,624,66],[954,831,58],[585,936,54],[260,832,58],[156,585,66],[411,489,69],[390,325,62]],
    roadWidth: 69, laps: 3,
  },
  {
    id: 'switchbacks', name: 'Switchbacks', group: 'alpine', difficulty: 'Hard', theme: 'snow',
    points: [[260,130],[780,117],[1170,130],[1281,234],[1170,338],[780,351],[455,332],[332,371],[291,429],[332,488],[455,527],[845,533],[1170,520],[1281,624],[1170,728],[780,741],[455,754],[260,832],[104,676],[78,390],[104,208]],
    roadWidth: 68, laps: 2,
  },
  {
    id: 'glacier-descent', name: 'Glacier Descent', group: 'alpine', difficulty: 'Hard', theme: 'snow',
    points: [[260,130,54],[780,208,54],[1170,130,54],[1365,390,54],[1105,546,54],[1200,774,54],[780,910,64],[390,780,68],[447,595,64],[195,455,54]],
    roadWidth: 68, laps: 3,
  },
  {
    id: 'ice-tunnel', name: 'Ice Tunnel', group: 'alpine', difficulty: 'Hard', theme: 'snow',
    points: [[1494,657,54],[1330,792,55],[1314,1017,79],[909,1214,79],[516,1031,79],[425,813,79],[218,640,79],[156,395,79],[477,215,79],[914,156,79],[1443,192,79],[1682,441,79]],
    roadWidth: 79, laps: 2,
  },
  {
    id: 'summit', name: 'Summit', group: 'alpine', difficulty: 'Hard', theme: 'snow',
    points: [[1541,845,86],[1390,1000,86],[1387,1231,86],[1212,1507,54],[776,1557,54],[508,1167,54],[525,965,54],[364,832,86],[156,584,86],[325,256,86],[776,156,54],[1136,170,54],[1508,260,54],[1728,601,54]],
    roadWidth: 86, laps: 2,
  },
  // ---- Pro Circuit ----
  {
    id: 'serpent', name: 'Serpent', group: 'pro', difficulty: 'Expert', theme: 'night',
    points: [[125,250,55],[500,125,50],[875,313,57],[1250,150,63],[1563,375,50],[1250,600,50],[875,500,62],[563,700,59],[583,821,50],[375,900,52],[100,625,64]],
    roadWidth: 64, laps: 3,
  },
  {
    id: 'gauntlet', name: 'The Gauntlet', group: 'pro', difficulty: 'Expert', theme: 'night',
    points: [[125,125,50],[625,175,50],[813,75,64],[1125,250,50],[1033,410,50],[1200,565,64],[1000,750,50],[625,650,50],[438,813,64],[201,690,50],[313,500,50],[125,350,64]],
    roadWidth: 64, laps: 3,
  },
  {
    id: 'spaghetti', name: 'Spaghetti', group: 'pro', difficulty: 'Expert', theme: 'night',
    points: [[264,206,50],[688,125,51],[750,375,64],[1188,225,58],[1438,500,50],[1063,650,50],[1063,833,61],[688,813,61],[665,680,50],[438,675,50],[206,813,57],[100,525,64],[350,418,53]],
    roadWidth: 64, laps: 2,
  },
  {
    id: 'neon-loop', name: 'Neon Loop', group: 'pro', difficulty: 'Expert', theme: 'night',
    points: [[1494,779,81],[1351,915,81],[1374,1140,50],[1205,1416,64],[753,1466,89],[491,1078,64],[534,881,50],[376,766,81],[150,540,81],[310,236,50],[761,150,64],[1116,165,89],[1485,244,64],[1695,558,50]],
    roadWidth: 89, laps: 2,
  },
  {
    id: 'razor', name: 'Razor', group: 'pro', difficulty: 'Expert', theme: 'night',
    points: [[1633,1016,50],[1864,1268,50],[1741,1521,89],[1446,1621,50],[1029,1644,50],[558,1640,89],[211,1503,50],[150,1245,50],[395,1010,89],[604,893,89],[533,655,50],[569,370,89],[1010,150,89],[1374,338,50],[1433,681,50],[1375,890,89]],
    roadWidth: 89, laps: 2,
  },
  // ---- Specialist Series: each track rewards one kind of car ----
  {
    id: 'hairpin-alley', name: 'Hairpin Alley', group: 'special', difficulty: 'Hard', theme: 'night',
    points: [[500,300],[760,300],[794,314],[808,348],[794,382],[760,396],[500,396],[466,410],[452,444],[466,478],[500,492],[760,492],[794,506],[808,540],[794,574],[760,588],[500,588],[466,602],[452,636],[466,670],[500,684],[760,684],[794,698],[808,732],[794,766],[760,780],[500,780],[466,794],[452,828],[466,862],[500,876],[760,876],[794,890],[808,924],[794,958],[760,972],[500,972],[422,972],[380,954],[362,912],[362,360],[380,318],[422,300]],
    roadWidth: 46, laps: 3,
  },
  {
    id: 'gravel-rally', name: 'Gravel Rally', group: 'special', difficulty: 'Medium', theme: 'desert',
    points: [[1430,779],[1547,1030],[1396,1343],[901,1359],[576,1183],[362,1054],[150,825],[292,490],[594,285],[1036,150],[1384,230],[1507,604]],
    roadWidth: 70, laps: 3,
    rough: [[0.519,0.832],[0.174,0.311]],
  },
  {
    id: 'boost-highway', name: 'Boost Highway', group: 'special', difficulty: 'Medium', theme: 'night',
    points: [[1962,501],[1760,714],[1422,887],[633,1034],[150,788],[199,554],[408,324],[809,150],[1388,174],[1790,301]],
    roadWidth: 66, laps: 3,
    pads: [0.041,0.125,0.208,0.291,0.375,0.519,0.612,0.705,0.798],
  },
  {
    id: 'drift-ring', name: 'Drift Ring', group: 'special', difficulty: 'Hard', theme: 'snow',
    points: [[1309,901],[1473,1116],[1404,1320],[1161,1439],[804,1483],[486,1480],[225,1376],[150,1085],[332,886],[472,765],[451,633],[487,338],[789,150],[1144,334],[1189,599],[1164,805]],
    roadWidth: 60, laps: 3,
    zones: [[0.044,0.129],[0.377,0.411],[0.453,0.489],[0.557,0.606],[0.658,0.682],[0.742,0.77],[0.84,0.87],[0.942,0.977]],
  },
  {
    id: 'grand-tour', name: 'Grand Tour', group: 'special', difficulty: 'Expert', theme: 'grass',
    points: [[1352,749],[1215,879],[1224,1084],[1078,1338],[693,1385],[468,1027],[496,848],[347,737],[150,518],[299,229],[697,150],[1008,163],[1335,234],[1530,533]],
    roadWidth: 58, laps: 3,
    rough: [[0.619,0.739]],
    pads: [0.107,0.191,0.297],
    zones: [[0.028,0.064],[0.081,0.098],[0.148,0.174],[0.241,0.277]],
  },
];
