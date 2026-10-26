import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, SceneKey } from '../game/config';
import { getName } from '../game/player';
import { TRACKS, type TrackDef } from '../game/tracks';
import { pvpAvailable } from '../net/pvp';
import { challengePlayer } from '../net/social';

const ROWS = 8;
const ROW_H = 12;
const TOP = 56;

/**
 * A scrolling list of things you can pick, with ENTER for the main action and C to challenge the player on the row.
 * OPEN MATCHES and WHO IS ONLINE are both this with different rows.
 */
export abstract class PvpListScene<T> extends Phaser.Scene {
  protected track!: TrackDef;
  protected items: T[] = [];
  protected sel = 0;
  protected busy = false;
  private rows: Phaser.GameObjects.Text[] = [];
  private status!: Phaser.GameObjects.Text;
  private header!: Phaser.GameObjects.Text;
  protected stops: Array<() => void> = [];

  protected abstract heading(): string;
  protected abstract emptyText(): string;
  protected abstract hintText(): string;
  /** One line of text for a row. */
  protected abstract line(item: T): string;
  /** The column titles shown above the rows. */
  protected abstract columns(): string;
  /** The main action: ENTER or a click. */
  protected abstract activate(item: T): void;
  /** The player behind a row (uid and name) for challenging them, or null if the row has none. */
  protected abstract opponent(item: T): { uid: string; name: string } | null;
  /** Starts watching or polling; call `setItems` whenever the list changes. */
  protected abstract watch(): Array<() => void>;

  constructor(key: string) {
    super(key);
  }

  init(data: { trackId?: string }): void {
    this.track = TRACKS.find((t) => t.id === data.trackId) ?? TRACKS[0];
  }

  create(): void {
    this.items = [];
    this.sel = 0;
    this.busy = false;
    this.rows = [];
    this.stops = [];
    const mono = { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff' };
    this.add.text(GAME_WIDTH / 2, 12, this.heading(), { ...mono, fontSize: '16px', color: '#ffd166' }).setOrigin(0.5);
    this.status = this.add.text(GAME_WIDTH / 2, 30, '', { ...mono, fontSize: '8px', color: '#9ad1ff' }).setOrigin(0.5);
    this.header = this.add.text(20, TOP - 13, this.columns(), { ...mono, color: '#5d6580' });
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 8, this.hintText(), { ...mono, fontSize: '8px', color: '#8d99ae' }).setOrigin(0.5);
    for (let i = 0; i < ROWS; i++) {
      this.rows.push(this.add.text(20, TOP + i * ROW_H, '', mono)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => { if (this.items[this.scrollBase() + i] !== undefined) { this.sel = this.scrollBase() + i; this.paint(); } })
        .on('pointerdown', () => { this.sel = this.scrollBase() + i; this.paint(); this.enter(); }));
    }

    const kb = this.input.keyboard!;
    kb.on('keydown-UP', () => this.move(-1));
    kb.on('keydown-DOWN', () => this.move(1));
    kb.on('keydown-W', () => this.move(-1));
    kb.on('keydown-S', () => this.move(1));
    kb.on('keydown-ENTER', () => this.enter());
    kb.on('keydown-C', () => this.challenge());
    kb.on('keydown-ESC', () => this.back());
    this.events.once('shutdown', () => {
      kb.removeAllListeners();
      this.stops.forEach((s) => s());
    });

    if (!pvpAvailable()) {
      this.status.setText('Online racing is not available here.').setColor('#e63946');
      return;
    }
    this.stops = this.watch();
    this.paint();
  }

  protected setItems(items: T[]): void {
    if (!this.scene.isActive()) return;
    this.items = items;
    this.sel = Math.min(this.sel, Math.max(0, items.length - 1));
    this.paint();
  }

  protected say(text: string, color = '#ffd166'): void {
    this.status.setText(text).setColor(color);
  }

  private scrollBase(): number {
    return Math.max(0, Math.min(this.sel - ROWS + 1, this.items.length - ROWS));
  }

  protected paint(): void {
    const base = this.scrollBase();
    this.rows.forEach((r, i) => {
      const item = this.items[base + i];
      if (item === undefined) { r.setText(''); return; }
      const on = base + i === this.sel;
      r.setText(`${on ? '>' : ' '} ${this.line(item)}`).setColor(on ? '#ffd166' : '#ffffff');
    });
    if (!this.items.length) {
      this.rows[0].setText(this.emptyText()).setColor('#8d99ae');
    }
    this.header.setText(this.columns());
  }

  private move(d: number): void {
    if (!this.items.length || this.busy) return;
    this.sel = (this.sel + d + this.items.length) % this.items.length;
    this.paint();
  }

  private enter(): void {
    const item = this.items[this.sel];
    if (item === undefined || this.busy) return;
    this.activate(item);
  }

  /** Opens a private room on the chosen track, invites the player on this row, and waits for them in the lobby. */
  protected challenge(trackId = this.track.id): void {
    const item = this.items[this.sel];
    const who = item === undefined ? null : this.opponent(item);
    if (!who || this.busy) return;
    if (!getName()) { this.say('Pick a driver name first (PLAY menu)', '#e63946'); return; }
    this.busy = true;
    this.say(`Challenging ${who.name.toUpperCase()}...`);
    challengePlayer(who.uid, trackId)
      .then((room) => {
        if (this.scene.isActive()) this.scene.start(SceneKey.PvpLobby, { trackId, joinCode: room, waitFor: who.name });
      })
      .catch((e: unknown) => {
        this.busy = false;
        this.say((e as Error).message === 'cooldown' ? 'You just challenged them. Give it a moment.' : 'Could not send the challenge.', '#e63946');
      });
  }

  protected back(): void {
    this.scene.start(SceneKey.PvpLobby, { trackId: this.track.id });
  }
}
