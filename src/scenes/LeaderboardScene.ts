import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, SceneKey } from '../game/config';
import { TRACKS } from '../game/tracks';
import { firebaseConfigured } from '../net/firebase';
import { getLocalBests } from '../game/records';
import { BOARD_ENDLESS, BOARD_OVERSTEER, fetchTop, formatScore, lapBoard } from '../net/leaderboard';

const BOARDS = [...TRACKS.map((t) => ({ id: t.id, name: t.name })), { id: BOARD_ENDLESS, name: 'Endless' }, { id: BOARD_OVERSTEER, name: 'OVERSTEER' }];

export class LeaderboardScene extends Phaser.Scene {
  private idx = 0;
  /** Best single lap instead of total race time (tracks only). */
  private lap = false;
  private token = 0;
  private title!: Phaser.GameObjects.Text;
  private rows: Phaser.GameObjects.Text[] = [];
  private status!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKey.Leaderboard);
  }

  init(data: { board?: string }): void {
    const lap = !!data.board?.startsWith('lap:');
    this.lap = lap;
    this.idx = Math.max(0, BOARDS.findIndex((b) => b.id === (lap ? data.board!.slice(4) : data.board)));
  }

  create(): void {
    const mono = { fontFamily: 'monospace', fontSize: '8px', color: '#ffffff' };
    this.add.text(GAME_WIDTH / 2, 12, 'GLOBAL LEADERBOARD', { ...mono, fontSize: '12px', color: '#ffd166' }).setOrigin(0.5);

    this.title = this.add.text(GAME_WIDTH / 2, 30, '', { ...mono, fontSize: '10px' }).setOrigin(0.5);
    const arrow = (x: number, label: string, d: number) =>
      this.add.text(x, 30, label, { ...mono, fontSize: '10px', color: '#ffd166' }).setOrigin(0.5)
        .setInteractive({ useHandCursor: true }).on('pointerdown', () => this.step(d));
    arrow(24, '<', -1);
    arrow(GAME_WIDTH - 24, '>', 1);

    this.rows = Array.from({ length: 10 }, (_, i) => this.add.text(GAME_WIDTH / 2, 46 + i * 11.5, '', mono).setOrigin(0.5, 0));
    this.status = this.add.text(GAME_WIDTH / 2, 92, '', { ...mono, color: '#c9d1e3', align: 'center' }).setOrigin(0.5);

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 8, 'LEFT/RIGHT track   UP/DOWN total/lap   ESC back', { ...mono, color: '#8d99ae' }).setOrigin(0.5);
    this.add.text(4, GAME_HEIGHT - 8, '< BACK', { ...mono, color: '#ffd166' }).setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true }).on('pointerdown', () => this.back());

    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => this.step(-1));
    kb.on('keydown-RIGHT', () => this.step(1));
    kb.on('keydown-A', () => this.step(-1));
    kb.on('keydown-D', () => this.step(1));
    kb.on('keydown-UP', () => this.toggleLap());
    kb.on('keydown-DOWN', () => this.toggleLap());
    kb.on('keydown-W', () => this.toggleLap());
    kb.on('keydown-S', () => this.toggleLap());
    kb.on('keydown-TAB', () => this.toggleLap());
    kb.on('keydown-ESC', () => this.back());
    kb.on('keydown-BACKSPACE', () => this.back());
    this.events.once('shutdown', () => kb.removeAllListeners());

    this.loadBoard();
  }

  private back(): void {
    this.scene.start(SceneKey.Menu);
  }

  private get boards(): typeof BOARDS {
    return this.lap ? BOARDS.filter((b) => b.id !== BOARD_ENDLESS && b.id !== BOARD_OVERSTEER) : BOARDS;
  }

  private step(d: number): void {
    const n = this.boards.length;
    this.idx = (this.idx + d + n) % n;
    this.loadBoard();
  }

  private toggleLap(): void {
    this.lap = !this.lap;
    if (this.idx >= this.boards.length) this.idx = 0; // endless and OVERSTEER have no laps
    this.loadBoard();
  }

  /** Shown when there's no connection: your own saved best, and a note that it will upload later. */
  private offlineText(boardId: string): string {
    const mine = getLocalBests().find((b) => b.board === boardId);
    return `You're offline.\n${mine ? `Your best here: ${formatScore(boardId, mine.value)}\n` : ''}Scores upload when you're back online.`;
  }

  private loadBoard(): void {
    const picked = this.boards[this.idx];
    const board = this.lap ? { id: lapBoard(picked.id), name: picked.name } : picked;
    this.title.setText(this.lap ? `${picked.name}  -  BEST LAP` : `${picked.name}  -  ${board.id === BOARD_ENDLESS || board.id === BOARD_OVERSTEER ? 'DISTANCE' : 'RACE TIME'}`);
    this.rows.forEach((r) => r.setText(''));

    if (!firebaseConfigured) {
      this.status.setText('Leaderboard not set up.\nAdd your Firebase keys to .env\n(see README.md).');
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.status.setText(this.offlineText(board.id));
      return;
    }
    this.status.setText('Loading...');
    const token = ++this.token;
    fetchTop(board.id)
      .then(({ rows, myUid }) => {
        if (token !== this.token || !this.scene.isActive()) return;
        this.status.setText(rows.length ? '' : 'No scores yet. Be the first!');
        rows.forEach((r, i) => {
          const line = `${String(i + 1).padStart(2)}  ${r.name.padEnd(12)} ${formatScore(board.id, r.value).padStart(10)}`;
          this.rows[i].setText(line).setColor(r.uid === myUid ? '#ffd166' : '#ffffff');
        });
      })
      .catch((e: unknown) => {
        console.error('[leaderboard]', e);
        if (token !== this.token || !this.scene.isActive()) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          this.status.setText(this.offlineText(board.id));
          return;
        }
        const code = (e as { code?: string }).code ?? (e as Error).message ?? 'unknown';
        this.status.setText(`Couldn't reach the leaderboard.\n${String(code).replace('auth/', '').replace('permission-denied', 'permission denied (check rules)').slice(0, 60)}`);
      });
  }
}
