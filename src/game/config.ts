// Low internal resolution; Phaser scales it up crisply for the pixel-art look.
export const GAME_WIDTH = 320;
export const GAME_HEIGHT = 180;

export const SceneKey = {
  Boot: 'BootScene',
  Title: 'TitleScene',
  Menu: 'MenuScene',
  Race: 'RaceScene',
  Endless: 'EndlessScene',
  Oversteer: 'OversteerScene',
  Leaderboard: 'LeaderboardScene',
  Garage: 'GarageScene',
  Tutorial: 'TutorialScene',
} as const;

/**
 * The game's home address. Browsers keep a separate save (localStorage) for each address, so a copy of the game
 * served from any other *.web.app / *.firebaseapp.com address quietly sends its players here with their save
 * (see moveToHome in saveTransfer.ts). To move the game again: change this, build, deploy to every site (README).
 */
export const HOME_HOST = 'playoversteer.web.app';
