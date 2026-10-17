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
} as const;
