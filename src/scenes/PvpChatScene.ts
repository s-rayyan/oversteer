import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, SceneKey } from '../game/config';
import { getName } from '../game/player';
import { CHAT_MAX, chatAvailable, sendChat, watchChat, type ChatMessage } from '../net/chat';
import { pvp } from '../net/pvp';

const LINES = 11;
const TOP = 30;
const LINE_H = 12;
const MAX_CHARS = 52; // characters of 8px monospace that fit the width

/** Global chat: the last messages above, a text box below (a real HTML input, so typing and pasting just work). */
export class PvpChatScene extends Phaser.Scene {
  private msgs: ChatMessage[] = [];
  private lines: Phaser.GameObjects.Text[] = [];
  private status!: Phaser.GameObjects.Text;
  private stop: (() => void) | null = null;
  private box: HTMLInputElement | null = null;
  private me = '';
  private trackId = '';

  constructor() {
    super(SceneKey.PvpChat);
  }

  init(data: { trackId?: string }): void {
    this.trackId = data.trackId ?? '';
  }

  create(): void {
    this.msgs = [];
    const mono = { fontFamily: 'monospace', fontSize: '8px', color: '#ffffff' };
    this.add.text(GAME_WIDTH / 2, 12, 'CHAT', { ...mono, fontSize: '16px', color: '#ffd166' }).setOrigin(0.5);
    this.status = this.add.text(GAME_WIDTH / 2, 24, '', { ...mono, color: '#9ad1ff' }).setOrigin(0.5);
    this.lines = Array.from({ length: LINES }, (_, i) => this.add.text(8, TOP + i * LINE_H, '', mono));
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 6, 'ENTER send   ESC back', { ...mono, color: '#8d99ae' }).setOrigin(0.5);

    this.events.once('shutdown', () => this.close());
    if (!chatAvailable()) {
      this.status.setText('Chat is not available here.').setColor('#e63946');
      this.add.text(4, GAME_HEIGHT - 6, '< BACK', { ...mono, color: '#ffd166' }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.back());
      this.box = null;
      return;
    }
    void pvp().uid().then((u) => { this.me = u; this.paint(); }).catch(() => undefined);
    this.stop = watchChat((m) => {
      this.msgs.push(m);
      if (this.msgs.length > LINES) this.msgs.shift();
      this.paint();
    });
    this.mountInput();
  }

  private paint(): void {
    if (!this.scene.isActive()) return;
    this.lines.forEach((t, i) => {
      const m = this.msgs[this.msgs.length - LINES + i];
      if (!m) { t.setText(''); return; }
      t.setText(`${m.name.toUpperCase()}: ${m.text}`.slice(0, MAX_CHARS * 2)).setColor(m.uid === this.me ? '#ffd166' : '#ffffff');
    });
    this.msgs.length || this.status.setText('No messages yet. Say hi!');
    if (this.msgs.length) this.status.setText('');
  }

  private mountInput(): void {
    const el = document.createElement('input');
    el.maxLength = CHAT_MAX;
    el.placeholder = getName() ? 'Type a message and press ENTER' : 'Pick a driver name first (PLAY menu)';
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.disabled = !getName();
    el.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:20;width:min(560px,calc(100vw - 24px));box-sizing:border-box;background:#14121f;border:2px solid #ffd166;color:#fff;font:16px monospace;padding:8px 10px;outline:none';
    // Keys typed here must not drive the game (or leave the scene by accident).
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.back();
      else if (e.key === 'Enter') this.send();
    });
    el.addEventListener('keyup', (e) => e.stopPropagation());
    document.body.append(el);
    this.box = el;
    el.focus();
  }

  private send(): void {
    const el = this.box;
    if (!el || !el.value.trim()) return;
    const text = el.value;
    sendChat(text)
      .then(() => { el.value = ''; })
      .catch((e: unknown) => {
        const why = (e as Error).message;
        this.status.setText(why === 'cooldown' ? 'Slow down a little.' : 'Could not send.').setColor('#e63946');
      });
  }

  private back(): void {
    this.scene.start(SceneKey.PvpLobby, { trackId: this.trackId });
  }

  private close(): void {
    this.stop?.();
    this.stop = null;
    this.box?.remove();
    this.box = null;
  }
}
