import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './game/config';
import { syncLocalBests } from './net/leaderboard';
import { isEmbedded, receiveSave, showLauncher } from './game/saveTransfer';
import { BootScene } from './scenes/BootScene';
import { GarageScene } from './scenes/GarageScene';
import { LeaderboardScene } from './scenes/LeaderboardScene';
import { MenuScene } from './scenes/MenuScene';
import { EndlessScene } from './scenes/EndlessScene';
import { OversteerScene } from './scenes/OversteerScene';
import { RaceScene } from './scenes/RaceScene';


function start(): void {
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

  // Catch up any scores earned while offline, now and whenever the connection returns.
  void syncLocalBests();
  window.addEventListener('online', () => void syncLocalBests());

  if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
}

// Inside the game hub's iframe, show a launcher that moves the player's save into its own tab.
// Opened directly, first take in any save being handed over, then start the game.
if (isEmbedded()) showLauncher(start);
else void receiveSave().then(start);
