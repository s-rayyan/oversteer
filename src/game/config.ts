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
  Challenges: 'ChallengesScene',
  Style: 'StyleScene',
  Pvp: 'PvpScene',
  PvpLobby: 'PvpLobbyScene',
  PvpBrowse: 'PvpBrowseScene',
  PvpOnline: 'PvpOnlineScene',
} as const;

/**
 * The game's home address. Browsers keep a separate save (localStorage) for each address, so a copy of the game
 * served from any other *.web.app / *.firebaseapp.com address quietly sends its players here with their save
 * (see moveToHome in saveTransfer.ts). To move the game again: change this, build, deploy to every site (README).
 */
export const HOME_HOST = 'playoversteer.web.app';

/**
 * Every address the game itself is served from (Firebase Hosting gives each site a .web.app and a .firebaseapp.com
 * name). Only pages on these may hand a save over in a #save= link (see receiveSave in saveTransfer.ts).
 */
export const SAVE_SENDER_HOSTS: readonly string[] = [
  HOME_HOST, 'playoversteer.firebaseapp.com', 'overs-16336.web.app', 'overs-16336.firebaseapp.com',
];
