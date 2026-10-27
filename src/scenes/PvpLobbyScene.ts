import Phaser from 'phaser';
import { getCar } from '../game/cars';
import { askCode } from '../game/codeDialog';
import { GAME_HEIGHT, GAME_WIDTH, SceneKey } from '../game/config';
import { askName } from '../game/nameDialog';
import { getName, setName } from '../game/player';
import { selectedCar } from '../game/profile';
import { DIFFICULTY_COLOR, TRACKS, type TrackDef } from '../game/tracks';
import { lobbyAlertsOn, setLobbyAlerts } from '../game/lobbyAlert';
import { HEARTBEAT_MS, PvpError, ROOM_MAX, livePlayers, pvp, pvpAvailable, type Member, type Room } from '../net/pvp';

const AUTO_START_MS = 8000; // after the second driver arrives, wait this long for more before a public room starts
const FULL_START_MS = 2000;
const HOP_CHECK_MS = 5000;

type Mode = 'menu' | 'busy' | 'room';

const OPTIONS = ['QUICK MATCH', 'OPEN MATCHES', 'WHO IS ONLINE', 'CHAT', 'PRIVATE ROOM', 'JOIN WITH CODE', 'ALERTS'] as const;
const OPTION_HINT = [
  'Race whoever is looking for this track.',
  'See every room waiting for drivers, on any track.',
  'See who is playing and challenge them.',
  'Talk to everyone who is online.',
  'Make a room and share its code with friends.',
  'Type a friend\'s room code.',
  'Get a note when someone opens a public room.',
];

/** Waiting room for a head-to-head race: find or make a room, see who has joined, then hand over to PvpScene. */
export class PvpLobbyScene extends Phaser.Scene {
  private track!: TrackDef;
  private auto: 'quick' | null = null;
  private joinCode: string | null = null;
  /** Set when we came here by challenging someone: the name we are waiting to accept. */
  private waitFor: string | null = null;
  private mode: Mode = 'menu';
  private sel = 0;
  private roomId: string | null = null;
  private room: Room | null = null;
  private myUid = '';
  private unwatch: (() => void) | null = null;
  private timers: Phaser.Time.TimerEvent[] = [];
  private autoAt = 0;
  private liveCount = 0;
  private starting = false;
  private leaving = false;
  private ui: Phaser.GameObjects.Text[] = [];
  private status!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKey.PvpLobby);
  }

  init(data: { trackId?: string; auto?: 'quick'; joinCode?: string; waitFor?: string }): void {
    this.track = TRACKS.find((t) => t.id === data.trackId) ?? TRACKS[0];
    this.auto = data.auto ?? null;
    this.joinCode = data.joinCode ?? null;
    this.waitFor = data.waitFor ?? null;
  }

  create(): void {
    this.mode = 'menu';
    this.sel = 0;
    this.roomId = null;
    this.room = null;
    this.unwatch = null;
    this.timers = [];
    this.starting = false;
    this.leaving = false;
    this.ui = [];
    const mono = { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff' };
    this.add.text(GAME_WIDTH / 2, 12, 'ONLINE RACE', { ...mono, fontSize: '16px', color: '#ffd166' }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, 30, this.track.name.toUpperCase(), { ...mono, color: DIFFICULTY_COLOR[this.track.difficulty] }).setOrigin(0.5);
    this.status = this.add.text(GAME_WIDTH / 2, 44, '', { ...mono, fontSize: '8px', color: '#ffd166' }).setOrigin(0.5);
    this.sub = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 22, '', { ...mono, fontSize: '8px', color: '#8d99ae' }).setOrigin(0.5);
    this.hint = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 8, '', { ...mono, fontSize: '8px', color: '#8d99ae' }).setOrigin(0.5);

    const kb = this.input.keyboard!;
    kb.on('keydown-UP', () => this.move(-1));
    kb.on('keydown-DOWN', () => this.move(1));
    kb.on('keydown-W', () => this.move(-1));
    kb.on('keydown-S', () => this.move(1));
    kb.on('keydown-ENTER', () => this.confirm());
    kb.on('keydown-ESC', () => this.back());
    this.events.once('shutdown', () => {
      kb.removeAllListeners();
      this.stopRoom();
    });

    if (!pvpAvailable()) {
      this.status.setText('Online racing is not available here.').setColor('#e63946');
      this.hint.setText('ESC back');
      this.mode = 'busy';
      return;
    }
    void this.begin();
  }

  private async begin(): Promise<void> {
    if (!getName()) {
      const name = await askName('', true);
      if (!name) {
        this.scene.start(SceneKey.Menu);
        return;
      }
      setName(name);
    }
    try {
      this.myUid = await pvp().uid();
    } catch {
      this.fail('Could not reach the online service.');
      return;
    }
    if (this.joinCode) void this.joinWithCode(this.joinCode);
    else if (this.auto === 'quick') void this.quickMatch();
    else this.showMenu();
  }

  // ---- menu ----

  private clearUi(): void {
    this.ui.forEach((t) => t.destroy());
    this.ui = [];
  }

  private showMenu(): void {
    this.clearUi();
    this.mode = 'menu';
    this.status.setText('Pick how to race').setColor('#ffd166');
    OPTIONS.forEach((label, i) => {
      const t = this.add.text(GAME_WIDTH / 2, 60 + i * 14, label, { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff' })
        .setOrigin(0.5).setInteractive({ useHandCursor: true })
        .on('pointerover', () => { this.sel = i; this.paintMenu(); })
        .on('pointerdown', () => { this.sel = i; this.confirm(); });
      this.ui.push(t);
    });
    this.hint.setText('ARROWS select    ENTER go    ESC back');
    this.paintMenu();
  }

  private paintMenu(): void {
    this.ui.forEach((t, i) => {
      const label = i === OPTIONS.length - 1 ? `${OPTIONS[i]}: ${lobbyAlertsOn() ? 'ON' : 'OFF'}` : OPTIONS[i];
      t.setColor(i === this.sel ? '#ffd166' : '#ffffff').setText(`${i === this.sel ? '> ' : '  '}${label}${i === this.sel ? ' <' : '  '}`);
    });
    this.sub.setText(OPTION_HINT[this.sel]);
  }

  private move(d: number): void {
    if (this.mode !== 'menu') return;
    this.sel = (this.sel + d + OPTIONS.length) % OPTIONS.length;
    this.paintMenu();
  }

  private confirm(): void {
    if (this.mode === 'menu') {
      if (this.sel === 0) void this.quickMatch();
      else if (this.sel === 1) this.scene.start(SceneKey.PvpBrowse, { trackId: this.track.id });
      else if (this.sel === 2) this.scene.start(SceneKey.PvpOnline, { trackId: this.track.id });
      else if (this.sel === 3) this.scene.start(SceneKey.PvpChat, { trackId: this.track.id });
      else if (this.sel === 4) void this.createRoom(false);
      else if (this.sel === 5) void this.joinWithCode();
      else { setLobbyAlerts(!lobbyAlertsOn()); this.paintMenu(); }
    } else if (this.mode === 'room') {
      this.startNow();
    }
  }

  private back(): void {
    if (this.mode === 'room') {
      void this.leaveRoom();
    } else if (this.mode === 'menu' || !pvpAvailable()) {
      this.scene.start(SceneKey.Menu);
    }
  }

  private fail(message: string): void {
    this.status.setText(message).setColor('#e63946');
    this.time.delayedCall(2200, () => { if (this.scene.isActive() && this.mode === 'busy') this.showMenu(); });
  }

  // ---- joining ----

  private me(): Member {
    return { name: getName(), carId: selectedCar().id, at: Date.now() };
  }

  private async quickMatch(): Promise<void> {
    this.busy('Looking for a race...');
    try {
      const open = await pvp().findOpen(this.track.id);
      if (open) {
        try {
          await pvp().join(open.id, this.me());
          return this.enterRoom(open.id);
        } catch (e) {
          if (!(e instanceof PvpError)) throw e; // it filled up or started under us: make our own
        }
      }
      await this.createRoom(true);
    } catch {
      this.fail('Could not reach the online service.');
    }
  }

  private async createRoom(isPublic: boolean): Promise<void> {
    this.busy(isPublic ? 'Opening a room...' : 'Making a private room...');
    try {
      this.enterRoom(await pvp().create(this.track.id, isPublic, this.me()));
    } catch {
      this.fail('Could not make a room.');
    }
  }

  private async joinWithCode(known?: string): Promise<void> {
    const code = known ?? await askCode();
    if (!code) return;
    this.busy(`Joining ${code}...`);
    try {
      await pvp().join(code, this.me());
      this.enterRoom(code);
    } catch (e) {
      const why = e instanceof PvpError ? { missing: 'No room with that code.', full: 'That room is full.', started: 'That race has already started.' }[e.code] : 'Could not reach the online service.';
      this.fail(why);
    }
  }

  private busy(text: string): void {
    this.clearUi();
    this.mode = 'busy';
    this.status.setText(text).setColor('#ffd166');
    this.sub.setText('');
    this.hint.setText('');
  }

  // ---- the room ----

  private enterRoom(id: string): void {
    if (!this.scene.isActive()) {
      void pvp().leave(id).catch(() => undefined);
      return;
    }
    this.clearUi();
    this.stopRoom();
    this.mode = 'room';
    this.roomId = id;
    this.room = null;
    this.liveCount = 0;
    this.autoAt = 0;
    this.unwatch = pvp().watch(id, (r) => this.onRoom(r));
    this.timers.push(
      this.time.addEvent({ delay: HEARTBEAT_MS, loop: true, callback: () => void pvp().beat(id).catch(() => undefined) }),
      this.time.addEvent({ delay: 500, loop: true, callback: () => this.tick() }),
      this.time.addEvent({ delay: HOP_CHECK_MS, loop: true, callback: () => void this.maybeHop() }),
    );
    for (let i = 0; i < ROOM_MAX; i++) {
      this.ui.push(this.add.text(70, 66 + i * 14, '', { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff' }));
    }
    this.ui.push(this.add.text(GAME_WIDTH / 2, 56, '', { fontFamily: 'monospace', fontSize: '8px', color: '#9ad1ff' }).setOrigin(0.5));
    this.hint.setText('ESC leave');
    this.paintRoom();
  }

  private stopRoom(): void {
    this.unwatch?.();
    this.unwatch = null;
    this.timers.forEach((t) => t.remove());
    this.timers = [];
  }

  private async leaveRoom(): Promise<void> {
    const id = this.roomId;
    if (this.leaving || !id) return;
    this.leaving = true;
    this.stopRoom();
    this.roomId = null;
    this.room = null;
    this.busy('Leaving...');
    try { await pvp().leave(id); } catch { /* the room times out on its own */ }
    this.leaving = false;
    if (this.scene.isActive()) this.showMenu();
  }

  private onRoom(r: Room | null): void {
    if (this.mode !== 'room' || this.starting) return;
    if (!r || !r.players[this.myUid]) {
      // closed, or we were dropped (our entry timed out): back to the menu
      void this.leaveRoom();
      return;
    }
    this.room = r;
    if (r.status === 'racing') {
      this.starting = true;
      this.stopRoom();
      const roster = Object.fromEntries(livePlayers(r));
      this.scene.start(SceneKey.Pvp, { trackId: r.track, roomId: r.id, roster, me: this.myUid });
      return;
    }
    const live = livePlayers(r).length;
    if (live !== this.liveCount) {
      this.liveCount = live;
      this.autoAt = live >= 2 ? Date.now() + (Object.keys(r.players).length >= ROOM_MAX ? FULL_START_MS : AUTO_START_MS) : 0;
    }
    this.paintRoom();
  }

  /** The driver who starts the race: the host of a private room, else the lowest id still here. */
  private starter(r: Room): string {
    const live = livePlayers(r);
    if (!r.public && live.some(([u]) => u === r.host)) return r.host;
    return live[0]?.[0] ?? r.host;
  }

  private tick(): void {
    const r = this.room;
    if (!r || this.mode !== 'room' || this.starting) return;
    const live = livePlayers(r).length;
    if (r.public && live >= 2 && this.starter(r) === this.myUid && this.autoAt && Date.now() >= this.autoAt) this.startNow();
    this.paintRoom();
  }

  private startNow(): void {
    const r = this.room;
    if (!r || !this.roomId || this.starting || livePlayers(r).length < 2) return;
    if (!r.public && this.starter(r) !== this.myUid) return;
    this.autoAt = 0;
    void pvp().start(this.roomId).catch(() => this.status.setText('Could not start the race.').setColor('#e63946'));
  }

  /** Two drivers who each opened their own room at the same moment: the younger one moves into the older one. */
  private async maybeHop(): Promise<void> {
    const r = this.room;
    const id = this.roomId;
    if (!r || !id || !r.public || r.status !== 'lobby' || Object.keys(r.players).length > 1 || this.starting) return;
    try {
      const other = await pvp().findOpen(this.track.id, id);
      if (!other || this.roomId !== id || this.starting) return;
      if (other.createdAt > r.createdAt || (other.createdAt === r.createdAt && other.id > r.id)) return;
      await pvp().join(other.id, this.me());
      void pvp().leave(id).catch(() => undefined);
      this.enterRoom(other.id);
    } catch {
      /* it filled up first; stay where we are */
    }
  }

  private paintRoom(): void {
    const r = this.room;
    if (!r) {
      this.status.setText('Joining...').setColor('#ffd166');
      return;
    }
    const live = livePlayers(r);
    const rows = this.ui.slice(0, ROOM_MAX);
    for (let i = 0; i < ROOM_MAX; i++) {
      const p = live[i];
      if (!p) {
        rows[i].setText(`${i + 1}  -`).setColor('#3d405b');
        continue;
      }
      const [uid, m] = p;
      const tag = uid === this.myUid ? '  YOU' : r.public || uid !== r.host ? '' : '  HOST';
      rows[i].setText(`${i + 1}  ${m.name.toUpperCase().padEnd(12)} ${getCar(m.carId).name}${tag}`).setColor(uid === this.myUid ? '#ffd166' : '#ffffff');
    }
    (this.ui[ROOM_MAX] as Phaser.GameObjects.Text).setText(r.public ? `ROOM ${r.id}` : `PRIVATE ROOM  CODE  ${r.id}`);
    const starter = this.starter(r) === this.myUid;
    if (live.length < 2) {
      this.status.setText(this.waitFor ? `Waiting for ${this.waitFor.toUpperCase()} to accept...` : r.public ? 'Waiting for opponents...' : 'Share the code and wait for friends').setColor('#ffd166');
      this.sub.setText('');
    } else if (r.public) {
      const left = this.autoAt ? Math.max(0, Math.ceil((this.autoAt - Date.now()) / 1000)) : 0;
      this.status.setText(starter && left ? `Race starts in ${left}` : 'Opponents found - starting soon').setColor('#52b788');
      this.sub.setText('ENTER start now');
    } else {
      this.status.setText(starter ? 'Ready when you are' : 'Waiting for the host to start').setColor('#52b788');
      this.sub.setText(starter ? 'ENTER start race' : '');
    }
  }
}
