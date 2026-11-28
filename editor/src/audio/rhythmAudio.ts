import { type GameId, TPB } from '../engine/cues.ts';
import { type TimelineEvent } from '../engine/gtfEngine.ts';
import {
  type GameAssetBinding,
  type GlobalAudioBindings,
  LocalVaultStorageError,
  MAX_AUDIO_DURATION_SEC,
  MAX_DECODED_BUFFERS,
  MAX_DECODED_PCM_BYTES,
  MAX_LOCAL_ASSET_BYTES,
  resolveCueSfxAssetId,
} from '../engine/localAssetVault.ts';

export const MAX_SFX_COMPRESSED_BYTES = 16 * 1024 * 1024; // 16 MiB compressed cap for SFX/audition
export const MAX_BGM_COMPRESSED_BYTES = MAX_LOCAL_ASSET_BYTES; // 48 MiB compressed cap for BGM
export const MAX_BGM_DURATION_SEC = 600; // 10 min BGM cap
export const MAX_BGM_PCM_BYTES = 128 * 1024 * 1024; // 128 MiB decoded float32 PCM cap for BGM
export const MAX_CONCURRENT_AUDIO_DECODES = 2;
export const MAX_AUDIO_DECODE_FAILURES = 5;

export interface AudioPreflightResult {
  format: 'wav' | 'flac' | 'ogg' | 'mp3' | 'aac' | 'mp4';
  compressedBytes: number;
  estimatedDurationSec?: number;
  estimatedPcmBytes?: number;
}

function asciiAt(bytes: Uint8Array, start: number, len: number): string {
  if (start + len > bytes.length) return '';
  let out = '';
  for (let i = 0; i < len; i++) out += String.fromCharCode(bytes[start + i]);
  return out;
}

/**
 * Container preflight run BEFORE invoking Web Audio decodeAudioData.
 * Enforces supported container magic, compressed-byte cap, and exact header-derived
 * duration/PCM bounds for WAV and FLAC containers.
 *
 * Honest caveat: browser decodeAudioData offers no streaming abort API; formats whose
 * outer headers do not expose total sample counts (MP3/OGG/AAC/M4A) rely on this
 * compressed-byte cap pre-decode plus immediate post-decode duration/PCM enforcement.
 */
export function preflightAudioContainer(
  bytes: Uint8Array,
  opts: {
    maxCompressedBytes: number;
    maxDurationSec: number;
    maxPcmBytes: number;
    label?: string;
  }
): AudioPreflightResult {
  const name = opts.label ?? 'audio';
  if (bytes.byteLength <= 0 || bytes.byteLength > opts.maxCompressedBytes) {
    throw new LocalVaultStorageError(
      'budget_exceeded',
      `Audio '${name}' (${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MiB) exceeds ${(opts.maxCompressedBytes / (1024 * 1024)).toFixed(1)} MiB compressed limit.`
    );
  }

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic4 = asciiAt(bytes, 0, 4);

  // WAV (RIFF....WAVE) with fmt + data chunk estimation
  if (bytes.length >= 12 && magic4 === 'RIFF' && asciiAt(bytes, 8, 4) === 'WAVE') {
    let offset = 12;
    let channels = 0;
    let sampleRate = 0;
    let bitsPerSample = 0;
    let audioFormat = 0;
    let dataSize = 0;
    let hasFmt = false;

    while (offset + 8 <= bytes.length) {
      const chunkId = asciiAt(bytes, offset, 4);
      const chunkSize = dv.getUint32(offset + 4, true);
      const payloadStart = offset + 8;
      if (chunkId === 'data') {
        dataSize += chunkSize;
      }
      if (payloadStart + chunkSize > bytes.length) {
        break;
      }
      if (chunkId === 'fmt ' && chunkSize >= 16) {
        hasFmt = true;
        audioFormat = dv.getUint16(payloadStart, true);
        channels = dv.getUint16(payloadStart + 2, true);
        sampleRate = dv.getUint32(payloadStart + 4, true);
        bitsPerSample = dv.getUint16(payloadStart + 14, true);
      }
      offset = payloadStart + chunkSize + (chunkSize & 1);
    }

    if (!hasFmt || channels === 0 || channels > 16 || sampleRate < 1000 || sampleRate > 384000) {
      throw new LocalVaultStorageError(
        'aborted',
        `Malformed WAV header in '${name}'.`
      );
    }

    if ((audioFormat === 1 || audioFormat === 3 || audioFormat === 0xfffe) && bitsPerSample >= 8 && dataSize > 0) {
      const bytesPerFrame = channels * Math.ceil(bitsPerSample / 8);
      if (bytesPerFrame > 0) {
        const totalFrames = Math.floor(dataSize / bytesPerFrame);
        const estimatedDurationSec = totalFrames / sampleRate;
        const estimatedPcmBytes = totalFrames * channels * 4;
        if (estimatedDurationSec > opts.maxDurationSec) {
          throw new LocalVaultStorageError(
            'budget_exceeded',
            `WAV audio '${name}' header duration (${estimatedDurationSec.toFixed(1)}s) exceeds ${opts.maxDurationSec}s limit.`
          );
        }
        if (estimatedPcmBytes > opts.maxPcmBytes) {
          throw new LocalVaultStorageError(
            'budget_exceeded',
            `WAV audio '${name}' estimated PCM (${(estimatedPcmBytes / (1024 * 1024)).toFixed(1)} MiB) exceeds ${(opts.maxPcmBytes / (1024 * 1024)).toFixed(1)} MiB limit.`
          );
        }
        return {
          format: 'wav',
          compressedBytes: bytes.byteLength,
          estimatedDurationSec,
          estimatedPcmBytes,
        };
      }
    }
    return { format: 'wav', compressedBytes: bytes.byteLength };
  }

  // FLAC (fLaC + STREAMINFO total_samples)
  if (bytes.length >= 42 && magic4 === 'fLaC') {
    const blockType = bytes[4] & 0x7f;
    const blockLen = (bytes[5] << 16) | (bytes[6] << 8) | bytes[7];
    if (blockType === 0 && blockLen >= 34) {
      const sampleRate = (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4);
      const channels = ((bytes[20] >> 1) & 0x07) + 1;
      const hi = bytes[21] & 0x0f;
      const lo =
        ((bytes[22] << 24) | (bytes[23] << 16) | (bytes[24] << 8) | bytes[25]) >>> 0;
      const totalSamples = hi * 0x100000000 + lo;
      if (sampleRate === 0) {
        throw new LocalVaultStorageError('aborted', `Malformed FLAC STREAMINFO in '${name}'.`);
      }
      if (totalSamples > 0) {
        const estimatedDurationSec = totalSamples / sampleRate;
        const estimatedPcmBytes = totalSamples * channels * 4;
        if (estimatedDurationSec > opts.maxDurationSec) {
          throw new LocalVaultStorageError(
            'budget_exceeded',
            `FLAC audio '${name}' duration (${estimatedDurationSec.toFixed(1)}s) exceeds ${opts.maxDurationSec}s limit.`
          );
        }
        if (estimatedPcmBytes > opts.maxPcmBytes) {
          throw new LocalVaultStorageError(
            'budget_exceeded',
            `FLAC audio '${name}' estimated PCM (${(estimatedPcmBytes / (1024 * 1024)).toFixed(1)} MiB) exceeds ${(opts.maxPcmBytes / (1024 * 1024)).toFixed(1)} MiB limit.`
          );
        }
        return {
          format: 'flac',
          compressedBytes: bytes.byteLength,
          estimatedDurationSec,
          estimatedPcmBytes,
        };
      }
    }
    return { format: 'flac', compressedBytes: bytes.byteLength };
  }

  // OGG (OggS)
  if (bytes.length >= 28 && magic4 === 'OggS') {
    return { format: 'ogg', compressedBytes: bytes.byteLength };
  }

  // MP3 (ID3 tag or MPEG audio frame sync)
  if (
    (bytes.length >= 10 && asciiAt(bytes, 0, 3) === 'ID3') ||
    (bytes.length >= 4 &&
      bytes[0] === 0xff &&
      (bytes[1] & 0xe0) === 0xe0 &&
      (bytes[1] & 0x18) !== 0x08 &&
      (bytes[1] & 0x06) !== 0x00)
  ) {
    return { format: 'mp3', compressedBytes: bytes.byteLength };
  }

  // ADTS AAC frame sync
  if (bytes.length >= 7 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) {
    return { format: 'aac', compressedBytes: bytes.byteLength };
  }

  // ISO BMFF / M4A / MP4 (ftyp at offset 4)
  if (bytes.length >= 12 && asciiAt(bytes, 4, 4) === 'ftyp') {
    return { format: 'mp4', compressedBytes: bytes.byteLength };
  }

  throw new LocalVaultStorageError(
    'aborted',
    `Unsupported or corrupt audio container in '${name}' (expected WAV, OGG, FLAC, MP3, AAC, or M4A).`
  );
}

/**
 * Concurrency semaphore + repeated-error circuit breaker for Web Audio decodeAudioData.
 */
export class AudioDecodeLimiter {
  private activeCount = 0;
  private waitQueue: Array<() => void> = [];
  private _failureCount = 0;
  private _failedAssetIds = new Set<string>();

  constructor(
    private readonly maxConcurrent = MAX_CONCURRENT_AUDIO_DECODES,
    private readonly maxFailures = MAX_AUDIO_DECODE_FAILURES
  ) {}

  public get inFlight(): number {
    return this.activeCount;
  }

  public get failureCount(): number {
    return this._failureCount;
  }

  public hasFailedAsset(assetId: string): boolean {
    return this._failedAssetIds.has(assetId);
  }

  public clearAssetFailure(assetId: string): void {
    this._failedAssetIds.delete(assetId);
  }

  public resetFailures(): void {
    this._failureCount = 0;
    this._failedAssetIds.clear();
  }

  private async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
    this.activeCount++;
  }

  private release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    const next = this.waitQueue.shift();
    if (next) next();
  }

  public async run<T>(
    assetId: string | undefined,
    fn: () => Promise<T>,
    opts?: { enforceFailureCap?: boolean }
  ): Promise<T> {
    const enforceCap = opts?.enforceFailureCap ?? true;
    if (assetId && this._failedAssetIds.has(assetId)) {
      throw new LocalVaultStorageError(
        'aborted',
        `Skipping audio decode for '${assetId}' after prior failure.`
      );
    }
    if (enforceCap && this._failureCount >= this.maxFailures) {
      throw new LocalVaultStorageError(
        'aborted',
        `Audio decode halted after ${this._failureCount} repeated failures.`
      );
    }

    await this.acquire();
    try {
      return await fn();
    } catch (err) {
      if (assetId) this._failedAssetIds.add(assetId);
      if (enforceCap) this._failureCount++;
      throw err;
    } finally {
      this.release();
    }
  }
}

export interface CachedAudioEntry<T = AudioBuffer> {
  buffer: T;
  pcmBytes: number;
  durationSec: number;
}

export function estimateAudioBufferPcmBytes(buf: {
  numberOfChannels: number;
  length: number;
}): number {
  return Math.max(0, buf.numberOfChannels * buf.length * 4);
}

/**
 * Bounded LRU cache for decoded local SFX / jingle AudioBuffers.
 * Prevents unbounded Web Audio decoded PCM heap growth.
 */
export class BoundedAudioBufferCache<T = AudioBuffer> {
  private entries = new Map<string, CachedAudioEntry<T>>();
  private totalPcmBytes = 0;

  constructor(
    private readonly maxBytes = MAX_DECODED_PCM_BYTES,
    private readonly maxBuffers = MAX_DECODED_BUFFERS,
    private readonly maxDurationSec = MAX_AUDIO_DURATION_SEC
  ) {}

  public get totalBytes(): number {
    return this.totalPcmBytes;
  }

  public get size(): number {
    return this.entries.size;
  }

  public has(id: string): boolean {
    return this.entries.has(id);
  }

  public get(id: string): T | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    // Refresh LRU recency
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry.buffer;
  }

  public set(id: string, buffer: T, pcmBytes: number, durationSec: number): string[] {
    if (durationSec > this.maxDurationSec) {
      throw new LocalVaultStorageError(
        'budget_exceeded',
        `Local audio duration (${durationSec.toFixed(1)}s) exceeds ${this.maxDurationSec}s cache limit.`
      );
    }
    if (pcmBytes > this.maxBytes) {
      throw new LocalVaultStorageError(
        'budget_exceeded',
        `Decoded audio PCM size (${(pcmBytes / (1024 * 1024)).toFixed(1)} MiB) exceeds ${this.maxBytes / (1024 * 1024)} MiB budget.`
      );
    }
    const existing = this.entries.get(id);
    if (existing) {
      this.totalPcmBytes -= existing.pcmBytes;
      this.entries.delete(id);
    }
    this.entries.set(id, { buffer, pcmBytes, durationSec });
    this.totalPcmBytes += pcmBytes;

    const evicted: string[] = [];
    while (this.entries.size > this.maxBuffers || this.totalPcmBytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey || oldestKey === id) break;
      const old = this.entries.get(oldestKey)!;
      this.totalPcmBytes -= old.pcmBytes;
      this.entries.delete(oldestKey);
      evicted.push(oldestKey);
    }
    return evicted;
  }

  public delete(id: string): boolean {
    const existing = this.entries.get(id);
    if (!existing) return false;
    this.totalPcmBytes -= existing.pcmBytes;
    this.entries.delete(id);
    return true;
  }

  public clear(): void {
    this.entries.clear();
    this.totalPcmBytes = 0;
  }
}

export const LOOKAHEAD_SEC = 0.14;
export const SCHEDULER_INTERVAL_MS = 25;
export const STALE_CATCHUP_TOLERANCE_SEC = 0.025;

export interface ScheduledBeatItem {
  beat: number;
  when: number;
}

export interface ScheduledEventItem {
  ev: TimelineEvent;
  when: number;
}

export interface LookaheadPlanParams {
  anchorAudioTime: number;
  anchorTick: number;
  nowAudioTime: number;
  bpm: number;
  lookaheadSec?: number;
  maxTick: number;
  events: TimelineEvent[];
  nextBeatToSchedule: number;
  scheduledKeys: Set<string>;
}

export interface LookaheadPlanResult {
  currentTick: number;
  horizonTick: number;
  beatsToSchedule: ScheduledBeatItem[];
  eventsToSchedule: ScheduledEventItem[];
  nextBeatToSchedule: number;
  reachedEnd: boolean;
}

/**
 * Pure AudioContext-clock lookahead planner.
 * Separates sample-accurate Web Audio scheduling from visual rAF polling,
 * guards against stale catchup bursts after tab suspension/backgrounding,
 * and deduplicates via scheduledKeys across lookahead ticks.
 */
export function planLookaheadWindow(params: LookaheadPlanParams): LookaheadPlanResult {
  const safeBpm = Math.max(20, params.bpm);
  const secPerBeat = 60 / safeBpm;
  const secPerTick = secPerBeat / TPB;
  const lookahead = params.lookaheadSec ?? LOOKAHEAD_SEC;

  const elapsedSec = Math.max(0, params.nowAudioTime - params.anchorAudioTime);
  const currentTick = params.anchorTick + elapsedSec / secPerTick;
  const rawHorizonTick = params.anchorTick + (elapsedSec + lookahead) / secPerTick;
  const horizonTick = Math.min(params.maxTick, rawHorizonTick);

  const minAllowedWhen = params.nowAudioTime - STALE_CATCHUP_TOLERANCE_SEC;

  const beatsToSchedule: ScheduledBeatItem[] = [];
  let nextBeat = Math.max(0, params.nextBeatToSchedule);
  const maxBeatInWindow = Math.floor(horizonTick / TPB);
  for (let b = nextBeat; b <= maxBeatInWindow; b++) {
    const beatTick = b * TPB;
    if (beatTick < params.anchorTick) {
      nextBeat = b + 1;
      continue;
    }
    const when = params.anchorAudioTime + (beatTick - params.anchorTick) * secPerTick;
    if (when >= minAllowedWhen) {
      beatsToSchedule.push({ beat: b, when: Math.max(params.nowAudioTime, when) });
    }
    nextBeat = b + 1;
  }

  const eventsToSchedule: ScheduledEventItem[] = [];
  for (const ev of params.events) {
    if (ev.tick < params.anchorTick) continue;
    if (ev.tick > horizonTick) break;
    const key = `${ev.id}:${ev.tick}`;
    if (params.scheduledKeys.has(key)) continue;
    params.scheduledKeys.add(key);

    const when = params.anchorAudioTime + (ev.tick - params.anchorTick) * secPerTick;
    if (when >= minAllowedWhen) {
      eventsToSchedule.push({ ev, when: Math.max(params.nowAudioTime, when) });
    }
  }

  return {
    currentTick,
    horizonTick,
    beatsToSchedule,
    eventsToSchedule,
    nextBeatToSchedule: nextBeat,
    reachedEnd: currentTick >= params.maxTick,
  };
}

export interface PlaybackSchedulerCallbacks {
  getEvents: () => TimelineEvent[];
  getMaxTick: () => number;
  getBpm: () => number;
  getMusicOffsetSec: () => number;
  getMetronomeOn: () => boolean;
  getCueSfxOn: () => boolean;
  onReachedEnd: () => void;
}

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

  private activeSfxNodes = new Set<AudioScheduledSourceNode>();
  private localAudioBuffers = new BoundedAudioBufferCache<AudioBuffer>();
  private decodeLimiter = new AudioDecodeLimiter(MAX_CONCURRENT_AUDIO_DECODES, MAX_AUDIO_DECODE_FAILURES);
  private gameBindings: Partial<Record<GameId, GameAssetBinding>> = {};
  private globalAudioBindings: GlobalAudioBindings = { jingleAssetMap: {} };
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private isScheduledPlaying = false;
  private anchorAudioTime = 0;
  private anchorTick = 0;
  private nextBeatToSchedule = 0;
  private scheduledKeys = new Set<string>();
  private activeCallbacks: PlaybackSchedulerCallbacks | null = null;
  private visibilityListenerAttached = false;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
    const rawBytes = new Uint8Array(arrayBuffer);
    preflightAudioContainer(rawBytes, {
      maxCompressedBytes: MAX_BGM_COMPRESSED_BYTES,
      maxDurationSec: MAX_BGM_DURATION_SEC,
      maxPcmBytes: MAX_BGM_PCM_BYTES,
      label: 'BGM',
    });

    const ctx = this.ensureContext();
    const decoded = await this.decodeLimiter.run(
      undefined,
      async () => ctx.decodeAudioData(arrayBuffer.slice(0)),
      { enforceFailureCap: false }
    );
    const pcmBytes = estimateAudioBufferPcmBytes(decoded);
    if (decoded.duration > MAX_BGM_DURATION_SEC || pcmBytes > MAX_BGM_PCM_BYTES) {
      throw new LocalVaultStorageError(
        'budget_exceeded',
        `BGM (${decoded.duration.toFixed(1)}s / ${(pcmBytes / (1024 * 1024)).toFixed(1)} MiB PCM) exceeds ${MAX_BGM_DURATION_SEC}s / ${MAX_BGM_PCM_BYTES / (1024 * 1024)} MiB limit.`
      );
    }
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

  public setLocalBindings(
    bindings: Partial<Record<GameId, GameAssetBinding>>,
    globalAudio: GlobalAudioBindings
  ) {
    this.gameBindings = bindings;
    this.globalAudioBindings = globalAudio;
  }

  public async decodeAndRegisterLocalAudio(assetId: string, buffer: ArrayBuffer): Promise<number> {
    if (this.decodeLimiter.hasFailedAsset(assetId)) {
      throw new LocalVaultStorageError(
        'aborted',
        `Skipping audio decode for '${assetId}' after prior failure.`
      );
    }
    return this.decodeLimiter.run(assetId, async () => {
      preflightAudioContainer(new Uint8Array(buffer), {
        maxCompressedBytes: MAX_SFX_COMPRESSED_BYTES,
        maxDurationSec: MAX_AUDIO_DURATION_SEC,
        maxPcmBytes: MAX_DECODED_PCM_BYTES,
        label: assetId,
      });
      const ctx = this.ensureContext();
      const decoded = await ctx.decodeAudioData(buffer.slice(0));
      const pcmBytes = estimateAudioBufferPcmBytes(decoded);
      this.localAudioBuffers.set(assetId, decoded, pcmBytes, decoded.duration);
      return decoded.duration;
    });
  }

  public unregisterLocalAudio(assetId: string) {
    this.localAudioBuffers.delete(assetId);
    this.decodeLimiter.clearAssetFailure(assetId);
  }

  public clearAllLocalAudio() {
    this.localAudioBuffers.clear();
    this.decodeLimiter.resetFailures();
  }

  public hasLocalAudioBuffer(assetId: string): boolean {
    return this.localAudioBuffers.has(assetId);
  }

  public playLocalAssetBuffer(assetId: string | null | undefined, when?: number, gainScale = 1): boolean {
    if (!assetId) return false;
    const buf = this.localAudioBuffers.get(assetId);
    if (!buf) return false;
    const ctx = this.ensureContext();
    if (!this.sfxGain) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0, Math.min(2, gainScale)), when ?? ctx.currentTime);
    src.connect(g);
    g.connect(this.sfxGain);
    this.trackSfxNode(src);
    src.start(when ?? ctx.currentTime);
    return true;
  }

  public async auditionBufferOnce(buffer: ArrayBuffer, assetId?: string): Promise<void> {
    const decoded = await this.decodeLimiter.run(assetId, async () => {
      preflightAudioContainer(new Uint8Array(buffer), {
        maxCompressedBytes: MAX_SFX_COMPRESSED_BYTES,
        maxDurationSec: MAX_AUDIO_DURATION_SEC,
        maxPcmBytes: MAX_DECODED_PCM_BYTES,
        label: assetId ?? 'audition',
      });
      const ctx = this.ensureContext();
      const dec = await ctx.decodeAudioData(buffer.slice(0));
      const pcmBytes = estimateAudioBufferPcmBytes(dec);
      if (dec.duration > MAX_AUDIO_DURATION_SEC || pcmBytes > MAX_DECODED_PCM_BYTES) {
        throw new LocalVaultStorageError(
          'budget_exceeded',
          `Audition audio (${dec.duration.toFixed(1)}s / ${(pcmBytes / (1024 * 1024)).toFixed(1)} MiB PCM) exceeds safe PCM decode budget.`
        );
      }
      return dec;
    });
    const ctx = this.ensureContext();
    if (!this.sfxGain) return;
    this.cancelPendingSfx();
    const src = ctx.createBufferSource();
    src.buffer = decoded;
    src.connect(this.sfxGain);
    this.trackSfxNode(src);
    src.start(ctx.currentTime + 0.01);
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

  public startMusic(songTimeSec: number, atAudioTime?: number) {
    this.stopMusic();
    if (!this.musicBuffer) return;
    const ctx = this.ensureContext();
    if (songTimeSec >= this.musicBuffer.duration) return;

    const src = ctx.createBufferSource();
    src.buffer = this.musicBuffer;
    src.connect(this.musicGain!);

    const baseWhen = atAudioTime ?? ctx.currentTime;
    if (songTimeSec < 0) {
      src.start(baseWhen + Math.abs(songTimeSec), 0);
    } else {
      src.start(baseWhen, songTimeSec);
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

  private cancelPendingSfx() {
    for (const node of this.activeSfxNodes) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // already stopped
      }
    }
    this.activeSfxNodes.clear();
  }

  private attachVisibilityHandler() {
    if (this.visibilityListenerAttached || typeof document === 'undefined') return;
    this.visibilityListenerAttached = true;
    document.addEventListener('visibilitychange', () => {
      if (!this.isScheduledPlaying || !this.ctx || !this.activeCallbacks) return;
      if (document.visibilityState === 'visible') {
        void this.ctx.resume().then(() => {
          if (!this.isScheduledPlaying || !this.activeCallbacks) return;
          // Flush any stale queued SFX and re-run lookahead cleanly at current tick
          this.cancelPendingSfx();
          const currentTick = Math.max(0, Math.round(this.getPlaybackTick(this.activeCallbacks.getBpm())));
          this.nextBeatToSchedule = Math.ceil(currentTick / TPB);
          this.runLookaheadPass();
        });
      }
    });
  }

  public startPlayback(startTick: number, callbacks: PlaybackSchedulerCallbacks) {
    this.stopPlayback();
    this.attachVisibilityHandler();

    const ctx = this.ensureContext();
    const startAtAudioTime = ctx.currentTime + 0.02;
    this.isScheduledPlaying = true;
    this.activeCallbacks = callbacks;
    this.anchorAudioTime = startAtAudioTime;
    this.anchorTick = Math.max(0, startTick);
    this.nextBeatToSchedule = Math.ceil(this.anchorTick / TPB);
    this.scheduledKeys.clear();

    const songSec = beatToSec(
      this.anchorTick / TPB,
      callbacks.getBpm(),
      callbacks.getMusicOffsetSec()
    );
    this.startMusic(songSec, startAtAudioTime);

    this.runLookaheadPass();
    this.schedulerTimer = setInterval(() => this.runLookaheadPass(), SCHEDULER_INTERVAL_MS);
  }

  public seekPlayback(targetTick: number) {
    if (!this.isScheduledPlaying || !this.activeCallbacks) return;
    const cb = this.activeCallbacks;
    this.startPlayback(targetTick, cb);
  }

  public stopPlayback() {
    this.isScheduledPlaying = false;
    this.activeCallbacks = null;
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.stopMusic();
    this.cancelPendingSfx();
    this.scheduledKeys.clear();
  }

  public getPlaybackTick(bpm: number): number {
    if (!this.isScheduledPlaying || !this.ctx) return this.anchorTick;
    const elapsedSec = Math.max(0, this.ctx.currentTime - this.anchorAudioTime);
    return Math.round(this.anchorTick + secToBeat(elapsedSec, bpm, 0) * TPB);
  }

  private runLookaheadPass() {
    if (!this.isScheduledPlaying || !this.ctx || !this.activeCallbacks) return;
    const cb = this.activeCallbacks;
    const maxTick = cb.getMaxTick();
    const bpm = cb.getBpm();
    const events = [...cb.getEvents()].sort((a, b) => a.tick - b.tick);

    const plan = planLookaheadWindow({
      anchorAudioTime: this.anchorAudioTime,
      anchorTick: this.anchorTick,
      nowAudioTime: this.ctx.currentTime,
      bpm,
      lookaheadSec: LOOKAHEAD_SEC,
      maxTick,
      events,
      nextBeatToSchedule: this.nextBeatToSchedule,
      scheduledKeys: this.scheduledKeys,
    });

    this.nextBeatToSchedule = plan.nextBeatToSchedule;

    if (cb.getMetronomeOn()) {
      for (const b of plan.beatsToSchedule) {
        this.playMetronome(b.beat % 4 === 0, b.when);
      }
    }
    if (cb.getCueSfxOn()) {
      for (const item of plan.eventsToSchedule) {
        this.playCueSfx(item.ev, item.when);
      }
    }
    if (plan.reachedEnd) {
      this.stopPlayback();
      cb.onReachedEnd();
    }
  }

  private trackSfxNode(node: AudioScheduledSourceNode) {
    this.activeSfxNodes.add(node);
    node.onended = () => {
      this.activeSfxNodes.delete(node);
    };
  }

  public playMetronome(isDownbeat: boolean, when?: number) {
    const ctx = this.ensureContext();
    const t = when ?? ctx.currentTime;
    const customId = isDownbeat
      ? this.globalAudioBindings.metronomeDownbeatAssetId
      : this.globalAudioBindings.metronomeBeatAssetId;
    if (this.playLocalAssetBuffer(customId, t, isDownbeat ? 0.9 : 0.7)) {
      return;
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isDownbeat ? 1120 : 740, t);
    gain.gain.setValueAtTime(isDownbeat ? 0.22 : 0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    osc.connect(gain);
    gain.connect(this.sfxGain!);
    this.trackSfxNode(osc);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  public playPlayalongTapSound() {
    const ctx = this.ensureContext();
    if (this.playLocalAssetBuffer(this.globalAudioBindings.playalongHitAssetId, ctx.currentTime, 0.95)) {
      return;
    }
    this.playMetronome(true, ctx.currentTime);
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
    const localSfxId = resolveCueSfxAssetId(ev, this.gameBindings);
    if (this.playLocalAssetBuffer(localSfxId, t, 1.0)) {
      return;
    }
    this.playGameCueSound(ev.game, ev, t);
  }

  public playSwitchSfx(isCut: boolean, when?: number) {
    const ctx = this.ensureContext();
    const t = when ?? ctx.currentTime;
    const customId = isCut
      ? this.globalAudioBindings.switchCutAssetId
      : this.globalAudioBindings.switchSoftAssetId;
    if (this.playLocalAssetBuffer(customId, t, 0.95)) {
      return;
    }
    if (isCut) {
      this.noiseBurst(t, 0.06, 2200, 0.18);
      this.tone(t, 640, 260, 0.07, 'square', 0.12);
    } else {
      this.tone(t, 320, 760, 0.18, 'sine', 0.16);
    }
  }

  public playJinglePreview(jingleCode: number) {
    const ctx = this.ensureContext();
    const customId = this.globalAudioBindings.jingleAssetMap[jingleCode];
    if (this.playLocalAssetBuffer(customId, ctx.currentTime + 0.02, 1.0)) {
      return;
    }
    const base = ctx.currentTime + 0.02;
    const idx = Math.max(0, jingleCode - 0x158);
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
    const root = scale[idx % scale.length];
    [0, 0.11, 0.22, 0.34].forEach((off, i) => {
      const freq = i === 3 ? root * 1.5 : root * (1 + i * 0.125);
      this.tone(base + off, freq, freq * 1.01, i === 3 ? 0.35 : 0.12, 'triangle', 0.2);
    });
  }

  public auditionPattern(
    events: Array<{
      relTick: number;
      op: 'call' | 'switch' | 'fade' | 'anim';
      game?: GameId;
      fn?: number;
      args?: [number, number, number, number];
      word?: TimelineEvent['word'];
      style?: number;
    }>,
    bpm: number
  ) {
    const ctx = this.ensureContext();
    this.cancelPendingSfx();
    const base = ctx.currentTime + 0.03;
    const secPerTick = 60 / Math.max(20, bpm) / TPB;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const when = base + Math.max(0, ev.relTick) * secPerTick;
      this.playCueSfx(
        {
          id: `pat_aud_${i}`,
          tick: ev.relTick,
          op: ev.op,
          game: ev.game,
          fn: ev.fn,
          args: ev.args,
          word: ev.word,
          style: ev.style,
        },
        when
      );
    }
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
        if (ev.fn === 0x1608f0) {
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
      case 'PUMPUP':
        this.tone(t, 320, 480, 0.09, 'square', 0.14);
        this.tone(t + 0.07, 480, 720, 0.1, 'triangle', 0.16);
        break;
      case 'FLYDISC':
        this.tone(t, 880, 520, 0.14, 'sine', 0.18);
        break;
      case 'ROLLING':
        this.tone(t, 440, 660, 0.08, 'triangle', 0.16);
        this.noiseBurst(t + 0.04, 0.04, 1800, 0.14);
        break;
      case 'INSECT':
        this.tone(t, 940, 1280, 0.11, 'sine', 0.16);
        break;
      case 'SOFTCATCH':
        this.tone(t, 520, 390, 0.1, 'sine', 0.18);
        break;
      case 'MOON':
        this.noiseBurst(t, 0.1, 1400, 0.16);
        this.tone(t, 440, 620, 0.14, 'sine', 0.15);
        break;
      case 'WIPER':
        this.tone(t, 360, 720, 0.08, 'triangle', 0.15);
        this.tone(t + 0.09, 720, 360, 0.08, 'triangle', 0.15);
        break;
      case 'SOCCER':
        this.tone(t, 190, 85, 0.1, 'sine', 0.24);
        break;
      case 'HURDLE':
        this.tone(t, 420, 840, 0.09, 'triangle', 0.18);
        break;
      case 'TALK':
        this.tone(t, 490, 610, 0.07, 'square', 0.1);
        this.tone(t + 0.08, 610, 520, 0.07, 'square', 0.1);
        break;
      case 'COOKING':
        this.noiseBurst(t, 0.05, 3800, 0.19);
        this.tone(t, 760, 920, 0.06, 'triangle', 0.14);
        break;
      case 'BRUSH':
        this.noiseBurst(t, 0.09, 2600, 0.16);
        this.tone(t, 560, 680, 0.07, 'sine', 0.14);
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
    this.trackSfxNode(osc);
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
    this.trackSfxNode(src);
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
