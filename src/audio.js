// Tiny synthesized UI/physics sounds. No audio files; everything is generated with WebAudio.
// Off by default; the context is only created once the user turns sound on (a user gesture).

export class Sound {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this._noise = null;
    this._last = 0;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { this.enabled = false; return; }
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        // one second of white noise, reused for every click
        const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this._noise = buf;
      }
      this.ctx.resume();
      this._tick(0.05, 1400);   // confirmation blip
    } catch (e) {
      this.enabled = false;
    }
  }

  /** Soft click as the pads close on a block. */
  grip() { this._tick(0.09, 2200, 240, 120, 0.05); }

  /** Lower, duller tock as a block is set down. */
  place() { this._tick(0.07, 1000, 170, 85, 0.045); }

  /** Two soft rising notes when a challenge is completed. */
  success() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [523.25, 783.99].forEach((hz, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = hz;
      const t0 = t + i * 0.11;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + 0.5);
    });
  }

  _tick(gain, freq, bodyHz = 0, bodyEnd = 0, bodyDur = 0.04) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (t - this._last < 0.04) return;   // never stack clicks (e.g. fast replay)
    this._last = t;

    // filtered noise burst = the "click"
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5, 0.05);

    // short sine thump gives it weight
    if (bodyHz) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.frequency.setValueAtTime(bodyHz, t);
      o.frequency.exponentialRampToValueAtTime(bodyEnd, t + bodyDur);
      og.gain.setValueAtTime(gain * 0.9, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + bodyDur);
      o.connect(og); og.connect(this.master);
      o.start(t); o.stop(t + bodyDur + 0.02);
    }
  }
}
