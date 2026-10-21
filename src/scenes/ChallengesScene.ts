import Phaser from 'phaser';
import { CHALLENGES } from '../game/challenges';
import { GAME_HEIGHT, GAME_WIDTH, SceneKey } from '../game/config';
import { challengeDone, challengesDoneCount, getCoins } from '../game/profile';
import { CoinBadge } from '../game/ui';

const VISIBLE = 11;
const ROW_H = 12;
const TOP = 30;

/** Every challenge, which ones are done, and what the rest pay. They are checked (and paid) automatically while you drive. */
export class ChallengesScene extends Phaser.Scene {
  private first = 0;
  private rows: Array<{ mark: Phaser.GameObjects.Text; title: Phaser.GameObjects.Text; reward: Phaser.GameObjects.Text }> = [];
  private heading!: Phaser.GameObjects.Text;
  private more!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKey.Challenges);
  }

  create(): void {
    this.first = 0;
    this.rows = [];
    const mono = { fontFamily: 'monospace', fontSize: '8px', color: '#ffffff' };
    this.heading = this.add.text(8, 6, '', { ...mono, fontSize: '12px', color: '#ffd166' });
    new CoinBadge(this, GAME_WIDTH - 8, 8, true).set(getCoins());
    this.add.text(8, 20, 'Complete them while you drive. Each pays coins once.', { ...mono, color: '#8d99ae' });

    for (let i = 0; i < VISIBLE; i++) {
      const y = TOP + i * ROW_H;
      this.rows.push({
        mark: this.add.text(10, y, '', mono),
        title: this.add.text(30, y, '', mono),
        reward: this.add.text(GAME_WIDTH - 10, y, '', mono).setOrigin(1, 0),
      });
    }
    this.more = this.add.text(GAME_WIDTH / 2, TOP + VISIBLE * ROW_H + 2, '', { ...mono, color: '#8d99ae' }).setOrigin(0.5, 0);
    this.add.text(4, GAME_HEIGHT - 8, '< BACK', { ...mono, color: '#ffd166' }).setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true }).on('pointerdown', () => this.back());
    this.add.text(GAME_WIDTH - 4, GAME_HEIGHT - 8, 'UP/DOWN scroll   ESC back', { ...mono, color: '#8d99ae' }).setOrigin(1, 0.5);

    const kb = this.input.keyboard!;
    kb.on('keydown-UP', () => this.scroll(-1));
    kb.on('keydown-DOWN', () => this.scroll(1));
    kb.on('keydown-W', () => this.scroll(-1));
    kb.on('keydown-S', () => this.scroll(1));
    kb.on('keydown-ESC', () => this.back());
    kb.on('keydown-BACKSPACE', () => this.back());
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.scroll(Math.sign(dy)));
    this.events.once('shutdown', () => {
      kb.removeAllListeners();
      this.input.off('wheel');
    });
    this.refresh();
  }

  private back(): void {
    this.scene.start(SceneKey.Menu);
  }

  private scroll(d: number): void {
    this.first = Phaser.Math.Clamp(this.first + d, 0, Math.max(0, CHALLENGES.length - VISIBLE));
    this.refresh();
  }

  private refresh(): void {
    this.heading.setText(`GOALS  ${challengesDoneCount()}/${CHALLENGES.length}`);
    this.rows.forEach((r, i) => {
      const c = CHALLENGES[this.first + i];
      if (!c) {
        r.mark.setText('');
        r.title.setText('');
        r.reward.setText('');
        return;
      }
      const done = challengeDone(c.id);
      r.mark.setText(done ? '[x]' : '[ ]').setColor(done ? '#52b788' : '#8d99ae');
      r.title.setText(c.title).setColor(done ? '#52b788' : '#ffffff');
      r.reward.setText(done ? 'DONE' : `+${c.reward}`).setColor(done ? '#52b788' : '#ffd166');
    });
    const below = CHALLENGES.length - (this.first + VISIBLE);
    this.more.setText(`${this.first > 0 ? '^ ' : ''}${below > 0 ? `${below} more v` : ''}`);
  }
}
