import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './game/config';
import { addFpsMeter } from './game/fpsMeter';
import { initAccountSync } from './net/account';
import { syncLocalBests } from './net/leaderboard';
import { isEmbedded, moveToHome, onFirebaseHost, onOldAddress, receiveSave, showLauncher } from './game/saveTransfer';
import { BootScene } from './scenes/BootScene';
import { ChallengesScene } from './scenes/ChallengesScene';
import { StyleScene } from './scenes/StyleScene';
import { audio } from './game/audio';
import { GarageScene } from './scenes/GarageScene';
import { LeaderboardScene } from './scenes/LeaderboardScene';
import { MenuScene } from './scenes/MenuScene';
import { EndlessScene } from './scenes/EndlessScene';
import { OversteerScene } from './scenes/OversteerScene';
import { PvpLobbyScene } from './scenes/PvpLobbyScene';
import { PvpScene } from './scenes/PvpScene';
import { RaceScene } from './scenes/RaceScene';
import { TitleScene } from './scenes/TitleScene';
import { TutorialScene } from './scenes/TutorialScene';


function start(): void {
  const game = new Phaser.Game({
    // ?renderer=canvas forces the plain 2D renderer, worth a try on a computer where WebGL is slow (no graphics card).
    type: new URLSearchParams(location.search).get('renderer') === 'canvas' ? Phaser.CANVAS : Phaser.AUTO,
    render: { powerPreference: 'high-performance' },
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
    scene: [BootScene, TitleScene, MenuScene, RaceScene, EndlessScene, OversteerScene, LeaderboardScene, GarageScene, TutorialScene, ChallengesScene, StyleScene, PvpLobbyScene, PvpScene],
  });

  // Catch up any scores earned while offline, now and whenever the connection returns.
  // F toggles fullscreen (not while typing in a text box).
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && !(t && /^(INPUT|TEXTAREA)$/.test(t.tagName))) game.scale.toggleFullscreen();
    // M mutes or unmutes the sound (the driving scenes show a note).
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey && !(t && /^(INPUT|TEXTAREA)$/.test(t.tagName))) {
      game.events.emit('mute-changed', audio.toggleMute());
    }
  });
  audio.unlock();

  addFpsMeter(game);
  initAccountSync(); // keep a signed-in player's save in step with their online account
  void syncLocalBests();
  window.addEventListener('online', () => void syncLocalBests());

  if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
}

// Inside the game hub's iframe, show a launcher that moves the player's save into its own tab. (A copy uploaded to a
// portal such as itch.io is embedded too, but it keeps its own save and just plays.)
// Opened directly, first take in any save being handed over, then start the game.
if (isEmbedded() && onFirebaseHost()) showLauncher(start);
else if (onOldAddress()) void moveToHome(start); // old web address: silently carry the save to the home one
else void receiveSave().then(start);
