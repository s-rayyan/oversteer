import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './game/config';
import { BootScene } from './scenes/BootScene';
import { GarageScene } from './scenes/GarageScene';
import { LeaderboardScene } from './scenes/LeaderboardScene';
import { MenuScene } from './scenes/MenuScene';
import { EndlessScene } from './scenes/EndlessScene';
import { OversteerScene } from './scenes/OversteerScene';
import { RaceScene } from './scenes/RaceScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#14121f',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, RaceScene, EndlessScene, OversteerScene, LeaderboardScene, GarageScene],
});

if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
