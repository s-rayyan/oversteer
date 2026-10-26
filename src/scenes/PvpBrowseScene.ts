import { SceneKey } from '../game/config';
import { TRACKS } from '../game/tracks';
import { livePlayers, pvp, type Room } from '../net/pvp';
import { PvpListScene } from './PvpListScene';

const REFRESH_MS = 4000;

const hostOf = (r: Room): { uid: string; name: string } => {
  const live = livePlayers(r);
  const found = live.find(([u]) => u === r.host) ?? live[0];
  return { uid: found?.[0] ?? r.host, name: found?.[1].name ?? '???' };
};

/** Every public lobby that is waiting for drivers, on any track. ENTER joins one; C challenges its host instead. */
export class PvpBrowseScene extends PvpListScene<Room> {
  constructor() {
    super(SceneKey.PvpBrowse);
  }

  protected heading(): string { return 'OPEN MATCHES'; }
  protected columns(): string { return '  HOST        TRACK            SEATS'; }
  protected hintText(): string { return 'ARROWS select   ENTER join   C challenge host   ESC back'; }
  protected emptyText(): string { return 'No open matches right now. Make one!'; }

  protected line(r: Room): string {
    const track = TRACKS.find((t) => t.id === r.track)?.name ?? r.track;
    return `${hostOf(r).name.toUpperCase().slice(0, 10).padEnd(11)} ${track.toUpperCase().slice(0, 15).padEnd(16)} ${livePlayers(r).length}/4`;
  }

  protected opponent(r: Room): { uid: string; name: string } | null {
    return hostOf(r);
  }

  protected activate(r: Room): void {
    this.scene.start(SceneKey.PvpLobby, { trackId: r.track, joinCode: r.id });
  }

  protected watch(): Array<() => void> {
    let stopped = false;
    const load = () => {
      pvp().listOpen()
        .then((rooms) => { if (!stopped) { this.say(rooms.length ? `${rooms.length} open` : ''); this.setItems(rooms); } })
        .catch(() => { if (!stopped) this.say('Could not reach the online service.', '#e63946'); });
    };
    load();
    const timer = this.time.addEvent({ delay: REFRESH_MS, loop: true, callback: load });
    return [() => { stopped = true; timer.remove(); }];
  }

  /** Challenging a host from here races on their track, not the one you came from. */
  protected challenge(): void {
    const r = this.items[this.sel];
    super.challenge(r ? r.track : this.track.id);
  }
}
