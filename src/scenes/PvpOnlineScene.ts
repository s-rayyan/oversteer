import { getCar } from '../game/cars';
import { SceneKey } from '../game/config';
import { TRACKS } from '../game/tracks';
import { announce, socialAvailable, watchOnline, type Presence } from '../net/social';
import { PvpListScene } from './PvpListScene';

const STATUS_LABEL: Record<Presence['st'], string> = { menu: 'MENU', lobby: 'LOBBY', racing: 'RACING' };

/** Everyone who has the game open. ENTER or C challenges the player on the row to a private race on the chosen track. */
export class PvpOnlineScene extends PvpListScene<Presence> {
  constructor() {
    super(SceneKey.PvpOnline);
  }

  protected heading(): string { return 'WHO IS ONLINE'; }
  protected columns(): string { return '  PLAYER      CAR          STATUS'; }
  protected hintText(): string { return 'ARROWS select   ENTER challenge   LEFT/RIGHT track   ESC back'; }
  protected emptyText(): string { return 'Nobody else is online right now.'; }

  create(): void {
    super.create();
    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => this.cycleTrack(-1));
    kb.on('keydown-RIGHT', () => this.cycleTrack(1));
    this.showTrack();
  }

  private cycleTrack(d: number): void {
    if (this.busy) return;
    const i = TRACKS.findIndex((t) => t.id === this.track.id);
    this.track = TRACKS[(i + d + TRACKS.length) % TRACKS.length];
    this.showTrack();
  }

  private showTrack(): void {
    this.say(`Challenge track: ${this.track.name.toUpperCase()}`, '#9ad1ff');
  }

  protected line(p: Presence): string {
    return `${p.name.toUpperCase().slice(0, 10).padEnd(11)} ${getCar(p.carId).name.slice(0, 11).padEnd(12)} ${STATUS_LABEL[p.st]}`;
  }

  protected opponent(p: Presence): { uid: string; name: string } | null {
    return { uid: p.uid, name: p.name };
  }

  protected activate(): void {
    this.challenge();
  }

  protected watch(): Array<() => void> {
    if (!socialAvailable()) {
      this.say('The online list is not available here.', '#e63946');
      return [];
    }
    void announce().catch(() => undefined); // appear on everyone else's list straight away
    return [watchOnline((players) => this.setItems(players))];
  }
}
