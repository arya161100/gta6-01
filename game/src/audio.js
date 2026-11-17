// Procedural sound for SOLARA HEAT: every sound is synthesized with WebAudio
// oscillators and filtered noise — no audio files, no network. Engine hum,
// police sirens, gunshots, pickups, mission jingles and a low-key bass groove.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = 0;
    this.sirenHigh = false;
    this.musicTimer = 0;
    this.musicStep = 0;
    this.enabled = true;
    this.started = false;
  }

  // Must be called from a user gesture (the Start button) in a real browser.
  start() {
    if (this.started) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // Engine: two detuned saws through a lowpass, gain follows speed.
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'square';
      this.engineOsc2.frequency.value = 28;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 2;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(lp); this.engineOsc2.connect(lp);
      lp.connect(this.engineGain); this.engineGain.connect(this.master);
      this.engineOsc.start(); this.engineOsc2.start();
      // Siren: a square wave that alternates 700 / 950 Hz.
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'square';
      this.sirenOsc.frequency.value = 700;
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
      this.sirenOsc.start();
      this.started = true;
    } catch (e) {
      this.ctx = null; // headless / blocked: game stays silent, never crashes.
    }
  }

  setEngine(speedKmh, driving) {
    if (!this.ctx || !this.engineGain) return;
    const t = this.ctx.currentTime;
    const target = driving ? 0.05 + Math.min(0.12, speedKmh / 1400) : 0.015;
    this.engineGain.gain.setTargetAtTime(target, t, 0.08);
    this.engineOsc.frequency.setTargetAtTime(48 + speedKmh * 1.15, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(24 + speedKmh * 0.55, t, 0.08);
  }

  setSiren(on, dt) {
    if (!this.ctx || !this.sirenGain) return;
    const t = this.ctx.currentTime;
    if (on) {
      this.sirenTimer += dt;
      if (this.sirenTimer > 0.42) {
        this.sirenTimer = 0;
        this.sirenHigh = !this.sirenHigh;
        this.sirenOsc.frequency.setTargetAtTime(this.sirenHigh ? 950 : 660, t, 0.02);
      }
      this.sirenGain.gain.setTargetAtTime(0.045, t, 0.1);
    } else {
      this.sirenGain.gain.setTargetAtTime(0, t, 0.1);
    }
  }

  _noiseBurst(dur, filterFreq, gain, type = 'lowpass') {
    if (!this.ctx) return;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
  }

  _tone(freq, dur, type, gain, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  gunshot() { this._noiseBurst(0.16, 900, 0.5); this._tone(160, 0.1, 'sine', 0.35, 60); }
  punch() { this._noiseBurst(0.09, 500, 0.35); }
  crash() { this._noiseBurst(0.3, 350, 0.5); this._tone(90, 0.25, 'sine', 0.4, 40); }
  pickup() { this._tone(880, 0.09, 'sine', 0.25); setTimeout(() => this._tone(1320, 0.12, 'sine', 0.25), 90); }
  horn() { this._tone(370, 0.35, 'square', 0.12); this._tone(466, 0.35, 'square', 0.1); }
  click() { this._tone(1200, 0.05, 'square', 0.08); }
  missionStart() { [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, 0.22, 'triangle', 0.28), i * 120)); }
  missionDone() { [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => this._tone(f, 0.3, 'triangle', 0.3), i * 110)); }
  busted() { [392, 370, 349, 311].forEach((f, i) => setTimeout(() => this._tone(f, 0.4, 'sawtooth', 0.2), i * 220)); }

  // A simple sunset-drive groove: bass line + kick + hat, scheduled in 8th notes.
  updateMusic(dt, wanted) {
    if (!this.ctx) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 0.21; // ~143 BPM 8th notes
    const bass = [55, 0, 55, 0, 65.4, 0, 55, 0, 49, 0, 49, 0, 58.3, 0, 73.4, 0];
    const step = this.musicStep % 16;
    const b = bass[step];
    if (b) this._tone(b, 0.2, 'triangle', wanted > 0 ? 0.16 : 0.11);
    if (step % 4 === 0) this._tone(120, 0.12, 'sine', 0.22, 45); // kick
    if (step % 2 === 1) this._noiseBurst(0.03, 6000, 0.035, 'highpass'); // hat
    if (wanted >= 3 && step % 8 === 4) this._tone(220, 0.18, 'sawtooth', 0.05, 330);
    this.musicStep++;
  }
}
