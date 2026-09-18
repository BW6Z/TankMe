/**
 * Procedural audio via WebAudio — synthesized cannon fire, explosions,
 * impacts, pickups, UI and a looping engine. No audio files needed.
 */
import * as THREE from 'three';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private engineNodes: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private volume = 0.8;
  private listenerPos = new THREE.Vector3();
  private listenerRight = new THREE.Vector3(1, 0, 0);

  /** must be called from a user gesture */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      // shared noise buffer
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02; // brown-ish
        data[i] = white * 0.6 + last * 3.5;
      }
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setListener(pos: THREE.Vector3, right: THREE.Vector3): void {
    this.listenerPos.copy(pos);
    this.listenerRight.copy(right);
  }

  private spatial(pos?: THREE.Vector3): { gain: number; pan: number } {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - this.listenerPos.x;
    const dy = pos.y - this.listenerPos.y;
    const dz = pos.z - this.listenerPos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const gain = Math.min(1, Math.max(0.03, 9 / (d + 3)));
    const pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * this.listenerRight.x + dz * this.listenerRight.z) / d)) * 0.7 : 0;
    return { gain, pan };
  }

  private route(node: AudioNode, gain: number, pan: number): GainNode | null {
    if (!this.ctx || !this.master) return null;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let tail: AudioNode = g;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      tail = p;
    }
    node.connect(g);
    tail.connect(this.master);
    return g;
  }

  private noise(dur: number, freq: number, gain: number, pos?: THREE.Vector3, type: BiquadFilterType = 'lowpass', q = 0.8): void {
    if (!this.ctx || !this.noiseBuf) return;
    const { gain: sg, pan } = this.spatial(pos);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    src.connect(filter);
    const g = this.route(filter, gain * sg, pan);
    if (!g) return;
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType, pos?: THREE.Vector3, slideTo?: number, delay = 0): void {
    if (!this.ctx) return;
    const { gain: sg, pan } = this.spatial(pos);
    const osc = this.ctx.createOscillator();
    osc.type = type;
    const t = this.ctx.currentTime + delay;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = this.route(osc, 0.0001, pan);
    if (!g) return;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * sg), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // ---------------- sounds ----------------

  fire(pos: THREE.Vector3, big: boolean): void {
    if (!this.ctx) return;
    const g = big ? 0.85 : 0.6;
    this.noise(big ? 0.5 : 0.32, big ? 520 : 750, g, pos, 'lowpass');
    this.tone(big ? 52 : 68, big ? 0.4 : 0.26, g * 0.9, 'sine', pos, 30);
    this.noise(0.06, 2600, 0.3, pos, 'highpass');
  }

  explosion(pos: THREE.Vector3, big: boolean): void {
    if (!this.ctx) return;
    this.noise(big ? 1.5 : 1.1, 300, 1.0, pos, 'lowpass');
    this.tone(44, big ? 1.1 : 0.8, 0.9, 'sine', pos, 24);
    this.noise(0.4, 1400, 0.3, pos, 'bandpass');
  }

  hit(pos: THREE.Vector3): void {
    this.noise(0.16, 1900, 0.5, pos, 'bandpass', 1.4);
    this.tone(1300 + Math.random() * 500, 0.14, 0.22, 'triangle', pos, 700);
  }

  armorBounce(pos: THREE.Vector3): void {
    this.tone(2100 + Math.random() * 800, 0.2, 0.18, 'triangle', pos, 900);
  }

  reloadDone(): void {
    this.noise(0.05, 2200, 0.25, undefined, 'bandpass', 2);
    setTimeout(() => this.noise(0.05, 1600, 0.25, undefined, 'bandpass', 2), 90);
  }

  powerup(): void {
    this.tone(660, 0.12, 0.25, 'triangle', undefined, undefined, 0);
    this.tone(830, 0.12, 0.25, 'triangle', undefined, undefined, 0.09);
    this.tone(990, 0.2, 0.28, 'triangle', undefined, undefined, 0.18);
  }

  uiClick(): void {
    this.tone(640, 0.05, 0.18, 'square', undefined, 500);
  }

  battleStart(): void {
    this.tone(174, 0.5, 0.3, 'sawtooth', undefined, undefined, 0);
    this.tone(220, 0.5, 0.24, 'sawtooth', undefined, undefined, 0.05);
    this.tone(174 * 1.5, 0.6, 0.26, 'sawtooth', undefined, undefined, 0.45);
  }

  victory(): void {
    this.tone(523, 0.18, 0.3, 'triangle');
    this.tone(659, 0.18, 0.3, 'triangle', undefined, undefined, 0.16);
    this.tone(784, 0.3, 0.32, 'triangle', undefined, undefined, 0.32);
  }

  defeat(): void {
    this.tone(392, 0.25, 0.3, 'triangle');
    this.tone(330, 0.25, 0.3, 'triangle', undefined, undefined, 0.2);
    this.tone(262, 0.4, 0.3, 'triangle', undefined, undefined, 0.4);
  }

  engine(speed01: number, active: boolean): void {
    if (!this.ctx || !this.noiseBuf || !this.master) return;
    if (!active) {
      if (this.engineNodes) {
        try { this.engineNodes.src.stop(); } catch { /* already stopped */ }
        this.engineNodes.gain.disconnect();
        this.engineNodes = null;
      }
      return;
    }
    if (!this.engineNodes) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 240;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.05;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start();
      this.engineNodes = { src, gain, filter };
    }
    const e = this.engineNodes;
    const t = this.ctx.currentTime;
    e.src.playbackRate.setTargetAtTime(0.55 + speed01 * 0.65, t, 0.12);
    e.gain.gain.setTargetAtTime(0.045 + speed01 * 0.075, t, 0.15);
    e.filter.frequency.setTargetAtTime(200 + speed01 * 260, t, 0.2);
  }
}
