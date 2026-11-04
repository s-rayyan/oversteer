import * as THREE from 'three';
import type Phaser from 'phaser';
import { CARS } from '../game/cars';
import { trackLayout } from '../game/Track';
import { TRACKS } from '../game/tracks';
import { buildCar } from './carModel';
import { Particles, SkidMarks, Weather } from './fx';
import { getStage } from './stage';
import { worldFor } from './world';

const warmed = new Set<string>();

/**
 * Builds a track's 3D world and has the graphics card compile every shader it will need, while the menu still
 * shows "LOADING TRACK". Without this the first frame of a race stalls for a moment the first time each kind of
 * object is drawn. The world is then kept (worldFor), so the race scene finds it ready.
 */
export async function prepareTrack(game: Phaser.Game, trackId: string): Promise<void> {
  const def = TRACKS.find((t) => t.id === trackId);
  if (!def) return;
  const stage = getStage(game);
  const world = worldFor(def, trackLayout(def).samples);
  if (warmed.has(def.id)) return;
  // one of everything a race adds: a car and a ghost car, smoke, flames, skid marks, weather
  const car = buildCar(CARS[0], CARS[0].color, { beams: world.night });
  const ghost = buildCar(CARS[0], 0xffffff, { ghost: true, beams: world.night });
  const smoke = new Particles(4, false);
  const flame = new Particles(4, true);
  const skids = new SkidMarks(4);
  skids.add(0, 0, 2, 0, 1);
  const p = world.samples[0];
  const weather = world.weather ? new Weather(world.weather, 8, p.x, 0, p.y) : null;
  const g = world.runGroup;
  g.add(car.root, ghost.root, smoke.points, flame.points, skids.mesh);
  if (weather) g.add(weather.obj);
  const cam = new THREE.PerspectiveCamera(64, stage.aspect, 1, 6000);
  cam.position.set(p.x, 20, p.y);
  try {
    await stage.renderer.compileAsync(world.scene, cam);
    warmed.add(def.id);
  } finally {
    g.clear();
    car.dispose();
    ghost.dispose();
    smoke.dispose();
    flame.dispose();
    skids.dispose();
    weather?.dispose();
  }
}
