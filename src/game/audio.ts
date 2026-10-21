// Synthesised sound (Web Audio), so the game still ships zero asset files.
//
// Browsers only let a page make sound after a click or key press, so nothing is created until `unlock()` has
// seen one. Every call is a safe no-op before that (and in browsers without Web Audio).
const MUTE_KEY = 'oversteer.muted';

export type Sfx =
  | 'tick' | 'go' | 'bank' | 'bankBig' | 'lost' | 'pad' | 'hit' | 'crash' | 'oil' | 'gate'
  | 'spin' | 'medal' | 'goal' | 'close' | 'bust' | 'wanted' | 'best' | 'boost';

/** What the car is doing this frame; all values are 0..1 (speed may overshoot a little when boosting). */
export interface DriveSound {
  speed: number;
  throttle: number;
  boosting: boolean;
  slip: number;
  /** Grass or gravel under the wheels. */
  rough: boolean;
  /** Nearest police cruiser: 0 = none or far away, 1 = right behind you. */
  siren: number;
}

interface RunNodes {
  engine: OscillatorNode[];
  engineGain: GainNode;
  engineFilter: BiquadFilterNode;
  screechGain: GainNode;
  screechFilter: BiquadFilterNode;
  roughGain: GainNode;
  sirenOsc: OscillatorNode;
  sirenLfo: OscillatorNode;
  sirenGain: GainNode;
  stoppers: Array<AudioScheduledSourceNode>;
}

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private paused = false;
  private wantRun = false;
  private run: RunNodes | null = null;
  private lastSfx = new Map<Sfx, number>();

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* storage unavailable: sound stays on */
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Call once at start-up: creates the audio context on the first key press or click. */
  unlock(): void {
    const go = () => {
      this.ensure();
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('keydown', go, { passive: true });
    window.addEventListener('pointerdown', go, { passive: true });
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    this.applyMaster();
    return this.muted;
  }

  /** Silences everything while the game is paused. */
  setPaused(p: boolean): void {
    this.paused = p;
    this.applyMaster();
  }

  private ensure(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    // One second of white noise, looped for tyre screech, gravel rumble and crashes.
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.applyMaster();
  }

  private applyMaster(): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.muted || this.paused ? 0 : 0.5, this.ctx.currentTime, 0.03);
  }

  // ---------- the continuous sounds of a run ----------

  startRun(): void {
    this.wantRun = true;
    this.build();
  }

  stopRun(): void {
    this.wantRun = false;
    const r = this.run;
    this.run = null;
    if (!r || !this.ctx) return;
    const t = this.ctx.currentTime;
    for (const g of [r.engineGain, r.screechGain, r.roughGain, r.sirenGain]) g.gain.setTargetAtTime(0, t, 0.05);
    for (const s of r.stoppers) {
      try {
        s.stop(t + 0.4);
      } catch {
        /* already stopped */
      }
    }
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  private build(): void {
    if (this.run || !this.ctx || !this.master || !this.noise) return;
    const c = this.ctx;
    const out = this.master;
    const stoppers: AudioScheduledSourceNode[] = [];

    // Engine: two slightly detuned saw waves through a low-pass filter; the pitch follows the speed.
    const engineGain = c.createGain();
    engineGain.gain.value = 0;
    const engineFilter = c.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 500;
    engineFilter.connect(engineGain).connect(out);
    const engine = [0, 7].map((detune) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = detune;
      o.frequency.value = 50;
      o.connect(engineFilter);
      o.start();
      stoppers.push(o);
      return o;
    });

    // Tyre screech: band-passed noise whose loudness follows the slip.
    const screechGain = c.createGain();
    screechGain.gain.value = 0;
    const screechFilter = c.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.Q.value = 4;
    screechFilter.frequency.value = 1600;
    const screech = this.noiseSource();
    screech.connect(screechFilter).connect(screechGain).connect(out);
    screech.start();
    stoppers.push(screech);

    // Gravel and grass: a low rumble.
    const roughGain = c.createGain();
    roughGain.gain.value = 0;
    const roughFilter = c.createBiquadFilter();
    roughFilter.type = 'lowpass';
    roughFilter.frequency.value = 380;
    const rough = this.noiseSource();
    rough.connect(roughFilter).connect(roughGain).connect(out);
    rough.start();
    stoppers.push(rough);

    // Police siren: a triangle wave swept up and down by a slow oscillator.
    const sirenGain = c.createGain();
    sirenGain.gain.value = 0;
    const sirenOsc = c.createOscillator();
    sirenOsc.type = 'triangle';
    sirenOsc.frequency.value = 760;
    const sirenLfo = c.createOscillator();
    sirenLfo.frequency.value = 1.3;
    const depth = c.createGain();
    depth.gain.value = 170;
    sirenLfo.connect(depth).connect(sirenOsc.frequency);
    sirenOsc.connect(sirenGain).connect(out);
    sirenOsc.start();
    sirenLfo.start();
    stoppers.push(sirenOsc, sirenLfo);

    this.run = { engine, engineGain, engineFilter, screechGain, screechFilter, roughGain, sirenOsc, sirenLfo, sirenGain, stoppers };
  }

  /** Call every frame while driving. */
  drive(d: DriveSound): void {
    if (this.wantRun && !this.run) this.build();
    const r = this.run;
    if (!r || !this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = clamp(d.speed, 0, 1.25);
    const pitch = 46 + sp * 100 + (d.boosting ? 22 : 0);
    r.engine[0].frequency.setTargetAtTime(pitch, t, 0.07);
    r.engine[1].frequency.setTargetAtTime(pitch * 1.5, t, 0.07);
    r.engineFilter.frequency.setTargetAtTime(320 + sp * 900 + d.throttle * 350 + (d.boosting ? 500 : 0), t, 0.08);
    r.engineGain.gain.setTargetAtTime(0.07 + 0.07 * d.throttle + (d.boosting ? 0.04 : 0), t, 0.08);

    const screech = d.slip > 0.14 ? clamp((d.slip - 0.08) * 0.4, 0, 0.16) : 0;
    r.screechGain.gain.setTargetAtTime(screech, t, 0.04);
    r.screechFilter.frequency.setTargetAtTime(1300 + d.slip * 1800, t, 0.05);

    r.roughGain.gain.setTargetAtTime(d.rough ? 0.16 * clamp(sp * 2, 0, 1) : 0, t, 0.06);
    r.sirenGain.gain.setTargetAtTime(clamp(d.siren, 0, 1) * 0.05, t, 0.1);
  }

  // ---------- one-shot effects ----------

  private tone(from: number, to: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, vol: number, freq: number, delay = 0): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private arpeggio(notes: number[], step: number, type: OscillatorType, vol: number): void {
    notes.forEach((n, i) => this.tone(n, n, step * 1.6, type, vol, i * step));
  }

  sfx(name: Sfx): void {
    if (!this.ctx || this.muted || this.paused) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastSfx.get(name) ?? -1) < 0.06) return;
    this.lastSfx.set(name, now);
    switch (name) {
      case 'tick': this.tone(660, 660, 0.09, 'square', 0.12); break;
      case 'go': this.tone(990, 990, 0.4, 'square', 0.14); break;
      case 'bank': this.arpeggio([520, 780], 0.07, 'triangle', 0.16); break;
      case 'bankBig': this.arpeggio([520, 660, 880, 1040], 0.07, 'triangle', 0.18); break;
      case 'lost': this.tone(320, 100, 0.35, 'sawtooth', 0.13); break;
      case 'pad': this.tone(300, 900, 0.25, 'square', 0.11); break;
      case 'boost': this.burst(0.3, 0.12, 2400); this.tone(200, 520, 0.25, 'sawtooth', 0.07); break;
      case 'hit': this.burst(0.1, 0.22, 1400); this.tone(180, 80, 0.1, 'square', 0.1); break;
      case 'crash': this.burst(0.3, 0.4, 600); this.tone(120, 40, 0.35, 'sawtooth', 0.2); break;
      case 'oil': this.tone(520, 140, 0.5, 'sine', 0.16); this.burst(0.35, 0.1, 3200); break;
      case 'gate': this.tone(880, 1320, 0.14, 'triangle', 0.15); break;
      case 'spin': this.tone(950, 180, 0.55, 'sawtooth', 0.09); this.burst(0.3, 0.12, 1800); break;
      case 'medal': this.arpeggio([523, 659, 784, 1047], 0.1, 'square', 0.1); break;
      case 'goal': this.arpeggio([659, 784, 988, 1319], 0.08, 'triangle', 0.17); break;
      case 'close': this.tone(1300, 800, 0.09, 'square', 0.08); break;
      case 'bust': this.burst(0.6, 0.4, 700); this.tone(240, 38, 0.9, 'sawtooth', 0.2); break;
      case 'wanted': this.tone(700, 1050, 0.18, 'square', 0.1); this.tone(700, 1050, 0.18, 'square', 0.1, 0.22); break;
      case 'best': this.arpeggio([392, 523, 659, 784, 1047], 0.09, 'square', 0.1); break;
    }
  }
}

export const audio = new GameAudio();
