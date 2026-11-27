import { GameId, TPB } from '../engine/cues.ts';
import { TimelineEvent } from '../engine/gtfEngine.ts';

export class RhythmAudioEngine {
  private ctx: AudioContext | null = null;
  private musicBuffer: AudioBuffer | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicVolume = 0.8;
  private sfxVolume = 0.85;
  public waveformPeaks: Float32Array = new Float32Array(0);
  public musicDurationSec = 0;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicVolume;
      this.musicGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public get currentTime(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  public setMusicVolume(v: number) {
    this.musicVolume = Math.max(0, Math.min(1, v));
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setValueAtTime(this.musicVolume, this.ctx.currentTime);
    }
  }

  public setSfxVolume(v: number) {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
    }
  }

  public async loadAudioBuffer(arrayBuffer: ArrayBuffer): Promise<{ duration: number; peaks: Float32Array }> {
    const ctx = this.ensureContext();
    const copy = arrayBuffer.slice(0);
    const decoded = await ctx.decodeAudioData(copy);
    this.musicBuffer = decoded;
    this.musicDurationSec = decoded.duration;
    this.waveformPeaks = this.computePeaks(decoded, 2400);
    return { duration: decoded.duration, peaks: this.waveformPeaks };
  }

  public clearMusic() {
    this.stopMusic();
    this.musicBuffer = null;
    this.musicDurationSec = 0;
    this.waveformPeaks = new Float32Array(0);
  }

  private computePeaks(buffer: AudioBuffer, targetBuckets: number): Float32Array {
    const ch0 = buffer.getChannelData(0);
    const len = ch0.length;
    const buckets = Math.min(targetBuckets, Math.max(100, Math.floor(len / 256)));
    const out = new Float32Array(buckets);
    const step = len / buckets;
    for (let i = 0; i < buckets; i++) {
      const start = Math.floor(i * step);
      const end = Math.min(len, Math.floor((i + 1) * step));
      let peak = 0;
      const stride = Math.max(1, Math.floor((end - start) / 32));
      for (let j = start; j < end; j += stride) {
        const a = Math.abs(ch0[j]);
        if (a > peak) peak = a;
      }
      out[i] = peak;
    }
    return out;
  }

  public startMusic(songTimeSec: number) {
    this.stopMusic();
    if (!this.musicBuffer) return;
    const ctx = this.ensureContext();
    if (songTimeSec >= this.musicBuffer.duration) return;

    const src = ctx.createBufferSource();
    src.buffer = this.musicBuffer;
    src.connect(this.musicGain!);

    if (songTimeSec < 0) {
      src.start(ctx.currentTime + Math.abs(songTimeSec), 0);
    } else {
      src.start(ctx.currentTime, songTimeSec);
    }
    this.musicSource = src;
  }

  public stopMusic() {
    if (this.musicSource) {
      try {
        this.musicSource.stop();
        this.musicSource.disconnect();
      } catch {
        // already stopped
      }
      this.musicSource = null;
    }
  }

  public playMetronome(isDownbeat: boolean, when?: number) {
    const ctx = this.ensureContext();
    const t = when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isDownbeat ? 1120 : 740, t);
    gain.gain.setValueAtTime(isDownbeat ? 0.22 : 0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    osc.connect(gain);
    gain.connect(this.sfxGain!);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  public playCueSfx(ev: TimelineEvent, when?: number) {
    const ctx = this.ensureContext();
    const t = when ?? ctx.currentTime;
    if (ev.op === 'switch') {
      this.playSwitchSfx(ev.style === -1, t);
      return;
    }
    if (ev.op === 'anim') {
      this.tone(t, 880, 1180, 0.09, 'sine', 0.14);
      return;
    }
    if (ev.op !== 'call' || !ev.game) return;
    this.playGameCueSound(ev.game, ev, t);
  }

  public playSwitchSfx(isCut: boolean, when?: number) {
    const ctx = this.ensureContext();
    const t = when ?? ctx.currentTime;
    if (isCut) {
      this.noiseBurst(t, 0.06, 2200, 0.18);
      this.tone(t, 640, 260, 0.07, 'square', 0.12);
    } else {
      this.tone(t, 320, 760, 0.18, 'sine', 0.16);
    }
  }

  public playJinglePreview(jingleCode: number) {
    const ctx = this.ensureContext();
    const base = ctx.currentTime + 0.02;
    const idx = Math.max(0, jingleCode - 0x158);
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
    const root = scale[idx % scale.length];
    [0, 0.11, 0.22, 0.34].forEach((off, i) => {
      const freq = i === 3 ? root * 1.5 : root * (1 + i * 0.125);
      this.tone(base + off, freq, freq * 1.01, i === 3 ? 0.35 : 0.12, 'triangle', 0.2);
    });
  }

  private playGameCueSound(game: GameId, ev: TimelineEvent, t: number) {
    switch (game) {
      case 'KAERU':
        this.tone(t, 280, 520, 0.12, 'sawtooth', 0.15);
        this.tone(t + 0.08, 420, 620, 0.1, 'triangle', 0.15);
        break;
      case 'PUTILABO':
        this.tone(t, 340, 920, 0.14, 'sine', 0.2);
        break;
      case 'CARS':
        if (ev.fn === 0x1608F0) {
          this.tone(t, 900, 220, 0.18, 'sawtooth', 0.15);
        } else {
          this.tone(t, 160, 420, 0.18, 'sawtooth', 0.16);
        }
        break;
      case 'CRAB':
        this.noiseBurst(t, 0.045, 3400, 0.22);
        this.tone(t, 840, 580, 0.06, 'square', 0.12);
        break;
      case 'RING':
        this.tone(t, 784, 1046, 0.14, 'sine', 0.22);
        break;
      case 'SAMURAI':
        this.noiseBurst(t, 0.08, 4200, 0.25);
        this.tone(t, 1200, 240, 0.11, 'sawtooth', 0.18);
        break;
      case 'HAMMER':
        this.tone(t, 220, 110, 0.14, 'square', 0.18);
        this.tone(t + 0.02, 520, 480, 0.1, 'triangle', 0.14);
        break;
      case 'HUNGRY':
        this.tone(t, 520, 780, 0.12, 'triangle', 0.2);
        break;
      case 'PARASOL':
        this.tone(t, ev.args?.[1] === 1 ? 880 : 660, 740, 0.11, 'sine', 0.2);
        break;
      case 'DANCER':
        this.noiseBurst(t, 0.03, 5000, 0.18);
        this.tone(t, 587, 880, 0.09, 'triangle', 0.16);
        break;
      case 'THUNDER':
        this.noiseBurst(t, 0.16, 950, 0.24);
        this.tone(t, 180, 90, 0.16, 'sawtooth', 0.16);
        break;
      case 'THE_A':
        this.tone(t, 659, 987, 0.13, 'triangle', 0.19);
        break;
      default:
        this.tone(t, 620, 540, 0.09, 'triangle', 0.18);
        break;
    }
  }

  private tone(t: number, f0: number, f1: number, dur: number, type: OscillatorType, vol: number) {
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(40, f0), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  private noiseBurst(t: number, dur: number, filterHz: number, vol: number) {
    if (!this.ctx || !this.sfxGain) return;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(filterHz, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.01);
  }
}

export function beatToSec(beat: number, bpm: number, musicOffsetSec: number): number {
  return musicOffsetSec + (beat * 60) / Math.max(20, bpm);
}

export function secToBeat(sec: number, bpm: number, musicOffsetSec: number): number {
  return ((sec - musicOffsetSec) * Math.max(20, bpm)) / 60;
}

export function ticksToBeat(ticks: number): number {
  return ticks / TPB;
}
