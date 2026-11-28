import {
  canonicalGame,
  CUES,
  type CueDef,
  GAME_ALIASES,
  GAME_META,
  type GameId,
  GAMES,
  getCuesForGame,
  TPB,
} from './cues.ts';
import { type TimelineEvent } from './gtfEngine.ts';
import {
  type BflanAnimationData,
  type BflytLayoutData,
  type BfresModelData,
  parseBflanContainer,
  parseBflytContainer,
  parseBfresContainer,
  parseBntxContainer,
} from './switchFormats.ts';
import { parseStrictJson } from './zipSecurity.ts';

export type LocalAssetKind =
  | 'sprite'
  | 'texture_atlas'
  | 'animation_clip'
  | 'native_layout'
  | 'native_model'
  | 'music'
  | 'sfx'
  | 'native_unparsed';

export type LocalStageSlot = 'actor' | 'backdrop' | 'foreground' | 'prologue';

export interface AtlasFrameRect {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LocalAnimationClipConfig {
  id: string;
  label: string;
  triggerType: 'idle' | 'beat' | 'cue' | 'anim';
  /** e.g. 'KAERU:frog3', 'KAERU:0x1B8DB0', or 'Remix8' when triggerType === 'anim' */
  triggerKey: string;
  assetId: string;
  cols: number;
  rows: number;
  startFrame: number;
  endFrame: number;
  fps: number;
  beatSync: boolean;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface LocalAssetRecord {
  id: string;
  name: string;
  relativePath: string;
  kind: LocalAssetKind;
  mimeType: string;
  sizeBytes: number;
  addedAtIso: string;
  /** Detected magic container if file is an unparsed Switch/Nintendo binary */
  nativeContainerFormat?: string;
  needsConversion?: boolean;
  conversionHint?: string;
  /** Parsed sprite-sheet frames if companion JSON or inline JSON atlas was imported */
  atlasFrames?: AtlasFrameRect[];
  cols?: number;
  rows?: number;
  /** Parsed Nintendo Switch container payloads kept locally in IndexedDB */
  bflytData?: BflytLayoutData;
  bflanData?: BflanAnimationData;
  bfresData?: BfresModelData;
  sourceContainerName?: string;
  /** Data URL for browser rendering (images/atlases) or ArrayBuffer kept in IndexedDB for audio */
  imageDataUrl?: string;
  audioBufferData?: ArrayBuffer;
  width?: number;
  height?: number;
  durationSec?: number;
  suggestedGame?: GameId | null;
  suggestedSlot?: LocalStageSlot | 'music' | 'sfx';
  suggestedCueKey?: string | null;
  associationAmbiguous?: boolean;
  matchedGames?: GameId[];
  ambiguityReason?: string;
}

export interface GameAssetBinding {
  game: GameId;
  backdropAssetId?: string;
  actorAssetId?: string;
  foregroundAssetId?: string;
  prologueAssetId?: string;
  layoutAssetId?: string;
  modelAssetId?: string;
  bflanAssetIds?: string[];
  bgmAssetId?: string;
  /** Keyed by `${game}:${cue.name}`, `${game}:0x${fn}`, or `${game}:default` */
  cueSfxMap: Record<string, string>;
  /** Ordered list of frame animation bindings for this minigame */
  animations: LocalAnimationClipConfig[];
}

export interface GlobalAudioBindings {
  switchSoftAssetId?: string;
  switchCutAssetId?: string;
  metronomeDownbeatAssetId?: string;
  metronomeBeatAssetId?: string;
  playalongHitAssetId?: string;
  jingleAssetMap: Record<number, string>;
}

export interface LocalVaultState {
  assets: LocalAssetRecord[];
  bindings: Partial<Record<GameId, GameAssetBinding>>;
  globalAudio: GlobalAudioBindings;
}

export interface FormatResearchEntry {
  extensionOrMagic: string;
  role: string;
  status: 'verified_groove_engine' | 'supported_local_extracted' | 'needs_research';
  notes: string;
}

/**
 * Honest inventory of what Groove Engine / Groove Builder verifies vs what
 * Nintendo Switch / Rhythm Heaven Groove binary formats remain unparsed and must be
 * extracted locally by the user without inventing fake specs.
 */
export const FORMAT_RESEARCH_CATALOG: FormatResearchEntry[] = [
  {
    extensionOrMagic: 'GTF / GTL (GTLM 1)',
    role: 'Timeline sequences & multi-game remix scripts',
    status: 'verified_groove_engine',
    notes: 'Verified against tools/gtf.py, engine/src/gtf.cpp, and pinned engine_contract.json.',
  },
  {
    extensionOrMagic: 'LAYOUT_OFF (0x3B58..0x4778)',
    role: 'Native layout hook offsets for 23 of 24 minigames',
    status: 'verified_groove_engine',
    notes: 'Verified in engine_contract.json (PUMPUP layout still pending verification).',
  },
  {
    extensionOrMagic: 'PNG / JPEG / WebP / GIF',
    role: 'Extracted sprites, stage backdrops, foreground layers & sprite sheets',
    status: 'supported_local_extracted',
    notes: 'Raster formats with verifiable pixel header dimensions; decoded locally within 4096×4096 & 128 MiB RGBA stage budget. SVG is excluded (lacks fixed pixel header bounds).',
  },
  {
    extensionOrMagic: 'BNTX (RGBA8 / BGRA8 / BC1-BC5)',
    role: 'Switch Tegra X1 block-linear GPU textures (extracted locally)',
    status: 'supported_local_extracted',
    notes: 'Tegra X1 GOB deswizzling & pixel decoding supported locally for RGBA8/BGRA8/R8/RG8/BC1-BC5. ASTC & BC7 surfaces still require local PNG conversion (flagged honestly).',
  },
  {
    extensionOrMagic: 'BFLYT / BFLAN (FLYT / FLAN)',
    role: 'NintendoWare layouts (pan1/pic1/mat1/txl1) & keyframe curves (FLPA/FLVI/FLMC)',
    status: 'supported_local_extracted',
    notes: 'Parsed directly into stage compositor with Hermite/linear/step curve evaluation; per-game proprietary state triggers still complement built-in scene timelines.',
  },
  {
    extensionOrMagic: 'BFRES (FRES / FMDL / FSKL / FSHP)',
    role: 'Switch 3D models, bone hierarchies & material texture tables',
    status: 'supported_local_extracted',
    notes: 'Bounded FMDL/FSKL/FMAT/FVTX/FSHP extraction projected in stage preview; compressed/custom shader variants fall back cleanly without inventing data.',
  },
  {
    extensionOrMagic: 'JSON Atlas (TexturePacker / Aseprite)',
    role: 'Frame rectangles & sprite-sheet slicing coordinates',
    status: 'supported_local_extracted',
    notes: 'Associates frame slices to idle, beat, cue, or anim triggers on stage.',
  },
  {
    extensionOrMagic: 'WAV / OGG / MP3 / FLAC / M4A',
    role: 'Extracted BGM tracks, jingles & per-cue sound effects',
    status: 'supported_local_extracted',
    notes: 'Decoded via Web Audio API decodeAudioData and scheduled on AudioContext clock.',
  },
  {
    extensionOrMagic: '.spr / .tex (Custom Game Atlases)',
    role: 'Proprietary Groove/game atlas & texture containers referenced by native scenes',
    status: 'needs_research',
    notes: 'Exact binary packing of romfs .spr/.tex files is not parsed in-browser; unpack locally to PNG + JSON/BFLYT or BNTX before importing.',
  },
  {
    extensionOrMagic: '.bars / .bwav / .bfstm (BARS / BWAV / FSTM)',
    role: 'Switch audio archives, stream tracks & cue SFX banks',
    status: 'needs_research',
    notes: 'Channel mappings and cue-ID hash tables are not yet mapped; decode locally to WAV/OGG.',
  },
  {
    extensionOrMagic: '.sarc / .zs (SARC / Zstandard)',
    role: 'Compressed Nintendo game resource archives',
    status: 'needs_research',
    notes: 'Decompress/unpack locally with Switch extraction tools; direct browser loading flags without fabricating data.',
  },
];

export const MAX_LOCAL_ASSET_BYTES = 48 * 1024 * 1024; // 48 MiB per single local file
export const MAX_VAULT_IMPORT_FILES = 64;
export const MAX_VAULT_IMPORT_BATCH_BYTES = 48 * 1024 * 1024; // 48 MiB cumulative batch cap
export const MAX_VAULT_TOTAL_ASSETS = 128;
export const MAX_VAULT_TOTAL_BYTES = 96 * 1024 * 1024; // 96 MiB cumulative vault cap
export const MAX_VAULT_IMAGE_DIM = 4096;
export const MAX_VAULT_IMAGE_PIXELS = MAX_VAULT_IMAGE_DIM * MAX_VAULT_IMAGE_DIM; // 16,777,216 px
export const MAX_ATLAS_FRAMES = 512;
export const MAX_DECODED_PCM_BYTES = 32 * 1024 * 1024; // 32 MiB decoded Web Audio PCM LRU cap
export const MAX_DECODED_BUFFERS = 48;
export const MAX_AUDIO_DURATION_SEC = 300;
export const MAX_CACHED_IMAGES = 64;
export const MAX_CACHED_IMAGE_RGBA_BYTES = 128 * 1024 * 1024; // 128 MiB global stage RGBA budget (cached + pending)

export function estimateRgbaBytes(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 0;
  }
  return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(width) * Math.ceil(height) * 4);
}

export function estimateStoredRecordBytes(
  rec: Pick<
    LocalAssetRecord,
    'sizeBytes' | 'imageDataUrl' | 'audioBufferData' | 'atlasFrames' | 'bflytData' | 'bflanData' | 'bfresData'
  >
): number {
  const declared =
    Number.isFinite(rec.sizeBytes) && rec.sizeBytes > 0 ? Math.floor(rec.sizeBytes) : 0;
  const audioBytes = rec.audioBufferData ? rec.audioBufferData.byteLength : 0;
  const imgBytes = rec.imageDataUrl ? rec.imageDataUrl.length : 0;
  const atlasBytes = rec.atlasFrames ? JSON.stringify(rec.atlasFrames).length : 0;
  const nativeBytes =
    (rec.bflytData ? JSON.stringify(rec.bflytData).length : 0) +
    (rec.bflanData ? JSON.stringify(rec.bflanData).length : 0) +
    (rec.bfresData ? JSON.stringify(rec.bfresData).length : 0);
  return Math.max(declared, audioBytes, imgBytes, nativeBytes) + atlasBytes;
}

const DB_NAME = 'groove_builder_local_vault_v1';
const DB_VERSION = 1;
const STORE_ASSETS = 'assets';
const STORE_META = 'meta';
const META_BINDINGS_KEY = 'bindings_v1';

export type LocalVaultErrorCode =
  | 'unavailable'
  | 'quota_exceeded'
  | 'aborted'
  | 'transaction_failed'
  | 'budget_exceeded';

export class LocalVaultStorageError extends Error {
  readonly code: LocalVaultErrorCode;

  constructor(code: LocalVaultErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'LocalVaultStorageError';
    this.code = code;
  }
}

export interface VaultBudgetCheckInput {
  existingAssets: ReadonlyArray<Pick<LocalAssetRecord, 'id' | 'sizeBytes'>>;
  incoming: ReadonlyArray<{ id?: string; name?: string; sizeBytes: number }>;
}

export function validateVaultImportBudget(input: VaultBudgetCheckInput): {
  batchBytes: number;
  projectedCount: number;
  projectedBytes: number;
} {
  if (input.incoming.length > MAX_VAULT_IMPORT_FILES) {
    throw new LocalVaultStorageError(
      'budget_exceeded',
      `Batch import exceeds limit (${input.incoming.length} > ${MAX_VAULT_IMPORT_FILES} files).`
    );
  }
  let batchBytes = 0;
  for (const item of input.incoming) {
    if (item.sizeBytes <= 0 || item.sizeBytes > MAX_LOCAL_ASSET_BYTES) {
      throw new LocalVaultStorageError(
        'budget_exceeded',
        `File '${item.name ?? item.id ?? 'asset'}' size (${item.sizeBytes} B) is outside allowed bounds (1..${MAX_LOCAL_ASSET_BYTES} B).`
      );
    }
    batchBytes += item.sizeBytes;
  }
  if (batchBytes > MAX_VAULT_IMPORT_BATCH_BYTES) {
    throw new LocalVaultStorageError(
      'budget_exceeded',
      `Import batch (${(batchBytes / (1024 * 1024)).toFixed(1)} MiB) exceeds ${MAX_VAULT_IMPORT_BATCH_BYTES / (1024 * 1024)} MiB batch budget.`
    );
  }

  const byId = new Map<string, number>();
  let anonymousCount = 0;
  let anonymousBytes = 0;
  for (const ex of input.existingAssets) {
    byId.set(ex.id, ex.sizeBytes);
  }
  for (const item of input.incoming) {
    if (item.id) {
      byId.set(item.id, item.sizeBytes);
    } else {
      anonymousCount++;
      anonymousBytes += item.sizeBytes;
    }
  }
  const projectedCount = byId.size + anonymousCount;
  let projectedBytes = anonymousBytes;
  for (const b of byId.values()) projectedBytes += b;

  if (projectedCount > MAX_VAULT_TOTAL_ASSETS) {
    throw new LocalVaultStorageError(
      'budget_exceeded',
      `Local vault limit exceeded (${projectedCount} > ${MAX_VAULT_TOTAL_ASSETS} assets). Delete unused assets first.`
    );
  }
  if (projectedBytes > MAX_VAULT_TOTAL_BYTES) {
    throw new LocalVaultStorageError(
      'budget_exceeded',
      `Local vault storage budget exceeded (${(projectedBytes / (1024 * 1024)).toFixed(1)} MiB > ${MAX_VAULT_TOTAL_BYTES / (1024 * 1024)} MiB).`
    );
  }
  return { batchBytes, projectedCount, projectedBytes };
}

/**
 * Pure header dimension sniffer for PNG, GIF, JPEG, and WebP so oversized
 * image bombs are rejected BEFORE DataURL conversion or DOM Image decoding.
 */
export function sniffImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG: signature + IHDR width(16..19 BE), height(20..23 BE)
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) };
  }
  // GIF: "GIF8" + width(6..7 LE), height(8..9 LE)
  if (
    bytes.length >= 10 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    return { width, height };
  }
  // JPEG: scan SOF0..SOF3/SOF5..SOF7/SOF9..SOF11/SOF13..SOF15 markers
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 8 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      while (i < bytes.length && bytes[i] === 0xff) i++;
      if (i >= bytes.length) break;
      const marker = bytes[i++];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        continue;
      }
      if (i + 2 > bytes.length) break;
      const segLen = (bytes[i] << 8) | bytes[i + 1];
      if (segLen < 2 || i + segLen > bytes.length) break;
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && segLen >= 7) {
        const height = (bytes[i + 3] << 8) | bytes[i + 4];
        const width = (bytes[i + 5] << 8) | bytes[i + 6];
        return { width, height };
      }
      i += segLen;
    }
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X
  if (bytes.length >= 30 && readAscii(bytes, 0, 4) === 'RIFF' && readAscii(bytes, 8, 4) === 'WEBP') {
    const chunk = readAscii(bytes, 12, 4);
    if (chunk === 'VP8X') {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width, height };
    }
    if (chunk === 'VP8L') {
      const b0 = bytes[21];
      const b1 = bytes[22];
      const b2 = bytes[23];
      const b3 = bytes[24];
      const width = 1 + (b0 | ((b1 & 0x3f) << 8));
      const height = 1 + (((b1 >> 6) & 0x03) | (b2 << 2) | ((b3 & 0x0f) << 10));
      return { width, height };
    }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
      return { width, height };
    }
  }
  return null;
}

export function assertImageDimensionBounds(width: number, height: number, label: string): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_VAULT_IMAGE_DIM ||
    height > MAX_VAULT_IMAGE_DIM ||
    width * height > MAX_VAULT_IMAGE_PIXELS
  ) {
    throw new LocalVaultStorageError(
      'budget_exceeded',
      `Image '${label}' (${width}x${height}) exceeds ${MAX_VAULT_IMAGE_DIM}px / ${MAX_VAULT_IMAGE_PIXELS} px limit.`
    );
  }
}

/**
 * Verifies raster image dimensions strictly from file header BEFORE DataURL conversion or DOM decode.
 * Rejects any image format (including SVG or corrupted headers) without verifiable pixel bounds.
 */
export function verifyVaultImageHeader(
  bytes: Uint8Array,
  filename: string
): { width: number; height: number } {
  const dims = sniffImageDimensions(bytes);
  if (!dims) {
    throw new LocalVaultStorageError(
      'budget_exceeded',
      `Image '${filename}' lacks verifiable raster header dimensions (PNG, JPEG, WebP, or GIF required).`
    );
  }
  assertImageDimensionBounds(dims.width, dims.height, filename);
  return dims;
}

export interface StageWantedImage {
  id: string;
  src: string;
  rgbaBytes: number;
  priority: number;
}

interface StageCachedEntry<TImg> {
  id: string;
  src: string;
  rgbaBytes: number;
  priority: number;
  status: 'pending' | 'loaded';
  img: TImg;
}

/**
 * Bounded scene-scoped stage image cache tracking BOTH count and cumulative RGBA bytes
 * across loaded and in-flight pending decodes, disposing evicted/removed Image objects.
 */
export class StageImageCacheManager<TImg> {
  private entries = new Map<string, StageCachedEntry<TImg>>();
  private _loadedRgbaBytes = 0;
  private _pendingRgbaBytes = 0;

  constructor(
    private readonly opts: {
      maxImages?: number;
      maxRgbaBytes?: number;
      createImage: (
        src: string,
        handlers: { onLoad: () => void; onError: () => void }
      ) => TImg;
      disposeImage: (img: TImg) => void;
      onUpdate?: () => void;
    }
  ) {}

  private get maxImages(): number {
    return this.opts.maxImages ?? MAX_CACHED_IMAGES;
  }

  private get maxRgbaBytes(): number {
    return this.opts.maxRgbaBytes ?? MAX_CACHED_IMAGE_RGBA_BYTES;
  }

  public get size(): number {
    return this.entries.size;
  }

  public get loadedRgbaBytes(): number {
    return this._loadedRgbaBytes;
  }

  public get pendingRgbaBytes(): number {
    return this._pendingRgbaBytes;
  }

  public get totalRgbaBytes(): number {
    return this._loadedRgbaBytes + this._pendingRgbaBytes;
  }

  public getImage(id: string): TImg | undefined {
    return this.entries.get(id)?.img;
  }

  public getReadonlyImageMap(): Map<string, TImg> {
    const out = new Map<string, TImg>();
    for (const [id, entry] of this.entries) {
      out.set(id, entry.img);
    }
    return out;
  }

  private removeEntry(id: string): void {
    const existing = this.entries.get(id);
    if (!existing) return;
    if (existing.status === 'loaded') {
      this._loadedRgbaBytes = Math.max(0, this._loadedRgbaBytes - existing.rgbaBytes);
    } else {
      this._pendingRgbaBytes = Math.max(0, this._pendingRgbaBytes - existing.rgbaBytes);
    }
    this.entries.delete(id);
    this.opts.disposeImage(existing.img);
  }

  public syncActiveScenes(wantedList: ReadonlyArray<StageWantedImage>): void {
    const wantedById = new Map<string, StageWantedImage>();
    for (const w of wantedList) {
      if (!w.src || w.rgbaBytes <= 0 || w.rgbaBytes > this.maxRgbaBytes) continue;
      const prev = wantedById.get(w.id);
      if (!prev || w.priority > prev.priority) {
        wantedById.set(w.id, w);
      }
    }

    // Dispose entries no longer referenced by any bound scene or whose data URL changed
    for (const [id, existing] of [...this.entries.entries()]) {
      const next = wantedById.get(id);
      if (!next || next.src !== existing.src) {
        this.removeEntry(id);
      } else {
        existing.priority = next.priority;
      }
    }

    // Prioritize active stage scene -> transition scene -> remaining bound scenes
    const sorted = [...wantedById.values()].sort((a, b) => b.priority - a.priority);

    for (const item of sorted) {
      const existing = this.entries.get(item.id);
      if (existing) {
        // Refresh LRU recency
        this.entries.delete(item.id);
        this.entries.set(item.id, existing);
        continue;
      }

      // Evict strictly lower-priority entries first; if none remain and still over budget, skip lower-priority item
      while (
        this.entries.size >= this.maxImages ||
        this.totalRgbaBytes + item.rgbaBytes > this.maxRgbaBytes
      ) {
        let evictKey: string | undefined;
        let lowestPriority = Infinity;
        for (const [k, entry] of this.entries.entries()) {
          if (entry.priority < lowestPriority) {
            lowestPriority = entry.priority;
            evictKey = k;
          }
        }
        if (!evictKey) break;
        const victim = this.entries.get(evictKey)!;
        // Never evict an equally/more-important active scene entry for a lower/equal priority background item
        if (victim.priority > item.priority || (victim.priority === item.priority && victim.priority <= 1)) {
          evictKey = undefined;
          break;
        }
        this.removeEntry(evictKey);
      }

      if (
        this.entries.size >= this.maxImages ||
        this.totalRgbaBytes + item.rgbaBytes > this.maxRgbaBytes
      ) {
        continue;
      }

      // Reserve pending RGBA budget BEFORE creating/decoding DOM Image
      this._pendingRgbaBytes += item.rgbaBytes;
      const placeholder = {
        id: item.id,
        src: item.src,
        rgbaBytes: item.rgbaBytes,
        priority: item.priority,
        status: 'pending' as const,
        img: undefined as unknown as TImg,
      };
      this.entries.set(item.id, placeholder);

      const img = this.opts.createImage(item.src, {
        onLoad: () => {
          const cur = this.entries.get(item.id);
          if (cur !== placeholder || cur.status !== 'pending') return;
          this._pendingRgbaBytes = Math.max(0, this._pendingRgbaBytes - cur.rgbaBytes);
          this._loadedRgbaBytes += cur.rgbaBytes;
          cur.status = 'loaded';
          this.opts.onUpdate?.();
        },
        onError: () => {
          const cur = this.entries.get(item.id);
          if (cur !== placeholder) return;
          this.removeEntry(item.id);
          this.opts.onUpdate?.();
        },
      });
      placeholder.img = img;
    }
  }

  public disposeAll(): void {
    for (const id of [...this.entries.keys()]) {
      this.removeEntry(id);
    }
    this._loadedRgbaBytes = 0;
    this._pendingRgbaBytes = 0;
  }
}

export function collectStageBoundImages(params: {
  currentGame: GameId;
  prevGame?: GameId | null;
  vaultBindings?: Partial<Record<GameId, GameAssetBinding>>;
  vaultAssetsById: Map<string, LocalAssetRecord>;
}): StageWantedImage[] {
  const { currentGame, prevGame, vaultBindings, vaultAssetsById } = params;
  if (!vaultBindings) return [];
  const wanted: StageWantedImage[] = [];
  const seenIds = new Set<string>();
  const pushAsset = (assetId: string | undefined, priority: number) => {
    if (!assetId || seenIds.has(assetId)) return;
    const asset = vaultAssetsById.get(assetId);
    if (!asset || !asset.imageDataUrl) return;
    seenIds.add(assetId);
    const w = asset.width ?? MAX_VAULT_IMAGE_DIM;
    const h = asset.height ?? MAX_VAULT_IMAGE_DIM;
    wanted.push({
      id: asset.id,
      src: asset.imageDataUrl,
      rgbaBytes: estimateRgbaBytes(w, h),
      priority,
    });
  };

  for (const [gameKey, b] of Object.entries(vaultBindings) as Array<[GameId, GameAssetBinding | undefined]>) {
    if (!b) continue;
    const priority = gameKey === currentGame ? 3 : prevGame && gameKey === prevGame ? 2 : 1;
    pushAsset(b.backdropAssetId, priority);
    pushAsset(b.actorAssetId, priority);
    pushAsset(b.foregroundAssetId, priority);
    pushAsset(b.prologueAssetId, priority);
    for (const clip of b.animations) {
      pushAsset(clip.assetId, priority);
    }

    // Also stage textures referenced by bound BFLYT layouts or BFRES models so the compositor can draw them.
    const referencedNames = new Set<string>();
    const layoutRec = b.layoutAssetId ? vaultAssetsById.get(b.layoutAssetId) : undefined;
    if (layoutRec?.bflytData) {
      for (const tex of layoutRec.bflytData.textures) {
        referencedNames.add(stemOfFilename(tex.split('/').pop() ?? tex));
      }
    }
    const modelRec = b.modelAssetId ? vaultAssetsById.get(b.modelAssetId) : undefined;
    if (modelRec?.bfresData) {
      for (const mdl of modelRec.bfresData.models) {
        for (const mat of mdl.materials) {
          for (const tex of mat.textureNames) {
            referencedNames.add(stemOfFilename(tex.split('/').pop() ?? tex));
          }
        }
      }
    }
    if (referencedNames.size > 0) {
      for (const asset of vaultAssetsById.values()) {
        if ((asset.kind === 'sprite' || asset.kind === 'texture_atlas') && asset.imageDataUrl) {
          if (referencedNames.has(stemOfFilename(asset.name))) {
            pushAsset(asset.id, priority);
          }
        }
      }
    }
  }
  return wanted;
}

export function upsertAssetsById(
  existing: ReadonlyArray<LocalAssetRecord>,
  incoming: ReadonlyArray<LocalAssetRecord>
): LocalAssetRecord[] {
  const byId = new Map<string, LocalAssetRecord>();
  const order: string[] = [];
  // Newest / incoming items appear cleanly deduplicated
  for (const item of incoming) {
    if (!byId.has(item.id)) order.push(item.id);
    byId.set(item.id, item);
  }
  for (const item of existing) {
    if (!byId.has(item.id)) {
      order.push(item.id);
      byId.set(item.id, item);
    }
  }
  return order.map((id) => byId.get(id)!);
}

export function normalizeVaultPath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function dirOfNormalizedPath(normPath: string): string {
  const idx = normPath.lastIndexOf('/');
  return idx >= 0 ? normPath.slice(0, idx) : '';
}

function stemOfFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').toLowerCase();
}

export function resolveAtlasTargetAsset(
  atlasRelativePath: string,
  metaImage: string | undefined,
  candidates: ReadonlyArray<LocalAssetRecord>
): {
  target: LocalAssetRecord | null;
  ambiguous: boolean;
  matches: LocalAssetRecord[];
} {
  const imgCandidates = candidates.filter(
    (a) => a.kind === 'sprite' || a.kind === 'texture_atlas'
  );
  const normAtlasPath = normalizeVaultPath(atlasRelativePath);
  const atlasDir = dirOfNormalizedPath(normAtlasPath);
  const atlasFile = normAtlasPath.slice(normAtlasPath.lastIndexOf('/') + 1);
  const atlasStem = stemOfFilename(atlasFile);
  const metaNorm = metaImage ? normalizeVaultPath(metaImage) : undefined;
  const metaBase = metaNorm ? metaNorm.slice(metaNorm.lastIndexOf('/') + 1) : undefined;

  // 1) Exact path relative to atlas directory when metaImage is supplied
  if (metaNorm) {
    const expectedPath = atlasDir ? `${atlasDir}/${metaNorm}` : metaNorm;
    const exactPathMatches = imgCandidates.filter(
      (a) => normalizeVaultPath(a.relativePath || a.name) === expectedPath
    );
    if (exactPathMatches.length === 1) {
      return { target: exactPathMatches[0], ambiguous: false, matches: exactPathMatches };
    }
    if (exactPathMatches.length > 1) {
      return { target: null, ambiguous: true, matches: exactPathMatches };
    }
  }

  // 2) Same-directory filename/stem match
  const sameDirMatches = imgCandidates.filter((a) => {
    const cNorm = normalizeVaultPath(a.relativePath || a.name);
    if (dirOfNormalizedPath(cNorm) !== atlasDir) return false;
    const cName = a.name.toLowerCase();
    return (metaBase && cName === metaBase) || stemOfFilename(a.name) === atlasStem;
  });
  if (sameDirMatches.length === 1) {
    return { target: sameDirMatches[0], ambiguous: false, matches: sameDirMatches };
  }
  if (sameDirMatches.length > 1) {
    return { target: null, ambiguous: true, matches: sameDirMatches };
  }

  // 3) Global filename/stem match ONLY when unique (flag ambiguity if >1!)
  const globalMatches = imgCandidates.filter((a) => {
    const cName = a.name.toLowerCase();
    return (metaBase && cName === metaBase) || stemOfFilename(a.name) === atlasStem;
  });
  if (globalMatches.length === 1) {
    return { target: globalMatches[0], ambiguous: false, matches: globalMatches };
  }
  if (globalMatches.length > 1) {
    return { target: null, ambiguous: true, matches: globalMatches };
  }
  return { target: null, ambiguous: false, matches: [] };
}

/**
 * Returns ONLY audio asset IDs actively referenced by SFX cue bindings or global SFX/jingle slots.
 * Unreferenced music tracks and unbound SFX are not decoded eagerly into Web Audio PCM buffers.
 */
export function getReferencedAudioAssetIds(
  bindings: Partial<Record<GameId, GameAssetBinding>>,
  globalAudio: GlobalAudioBindings
): Set<string> {
  const ids = new Set<string>();
  for (const b of Object.values(bindings)) {
    if (!b) continue;
    for (const aid of Object.values(b.cueSfxMap)) {
      if (aid) ids.add(aid);
    }
  }
  if (globalAudio.switchSoftAssetId) ids.add(globalAudio.switchSoftAssetId);
  if (globalAudio.switchCutAssetId) ids.add(globalAudio.switchCutAssetId);
  if (globalAudio.metronomeDownbeatAssetId) ids.add(globalAudio.metronomeDownbeatAssetId);
  if (globalAudio.metronomeBeatAssetId) ids.add(globalAudio.metronomeBeatAssetId);
  if (globalAudio.playalongHitAssetId) ids.add(globalAudio.playalongHitAssetId);
  for (const aid of Object.values(globalAudio.jingleAssetMap)) {
    if (aid) ids.add(aid);
  }
  return ids;
}

export function createEmptyVaultState(): LocalVaultState {
  return {
    assets: [],
    bindings: {},
    globalAudio: { jingleAssetMap: {} },
  };
}

export function createDefaultGameBinding(game: GameId): GameAssetBinding {
  return {
    game,
    cueSfxMap: {},
    animations: [],
  };
}

function readAscii(bytes: Uint8Array, start: number, len: number): string {
  if (bytes.length < start + len) return '';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += String.fromCharCode(bytes[start + i]);
  }
  return out;
}

export interface HeaderInspectionResult {
  kind: LocalAssetKind;
  nativeContainerFormat?: string;
  needsConversion: boolean;
  conversionHint?: string;
}

/**
 * Inspects file extension and leading magic bytes to classify user-extracted files cleanly,
 * flagging unparsed Switch/Rhythm Heaven Groove binary containers honestly without inventing parsers.
 */
export function inspectAssetFileHeader(
  filename: string,
  bytes: Uint8Array,
  mimeType = ''
): HeaderInspectionResult {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const magic4 = readAscii(bytes, 0, 4);

  // Nintendo Switch / NintendoWare parsed containers vs truncated/unsupported native binaries
  if (magic4 === 'BNTX' || ext === 'bntx') {
    if (magic4 === 'BNTX' && bytes.length >= 0x58) {
      return {
        kind: 'sprite',
        nativeContainerFormat: 'BNTX',
        needsConversion: false,
      };
    }
    return {
      kind: 'native_unparsed',
      nativeContainerFormat: 'BNTX',
      needsConversion: true,
      conversionHint: 'BNTX file is truncated or missing valid Switch BRTI texture headers; extract locally to PNG/WebP.',
    };
  }

  if (magic4 === 'FLYT' || ext === 'bflyt') {
    if (magic4 === 'FLYT' && bytes.length >= 0x14) {
      return {
        kind: 'native_layout',
        nativeContainerFormat: 'BFLYT',
        needsConversion: false,
      };
    }
    return {
      kind: 'native_unparsed',
      nativeContainerFormat: 'FLYT',
      needsConversion: true,
      conversionHint: 'FLYT layout header is incomplete or truncated; re-export BFLYT cleanly.',
    };
  }

  if (magic4 === 'FLAN' || ext === 'bflan') {
    if (magic4 === 'FLAN' && bytes.length >= 0x14) {
      return {
        kind: 'animation_clip',
        nativeContainerFormat: 'BFLAN',
        needsConversion: false,
      };
    }
    return {
      kind: 'native_unparsed',
      nativeContainerFormat: 'FLAN',
      needsConversion: true,
      conversionHint: 'FLAN animation header is incomplete or truncated; re-export BFLAN cleanly.',
    };
  }

  if (magic4 === 'FRES' || ext === 'bfres') {
    if (magic4 === 'FRES' && bytes.length >= 0x40) {
      return {
        kind: 'native_model',
        nativeContainerFormat: 'BFRES',
        needsConversion: false,
      };
    }
    return {
      kind: 'native_unparsed',
      nativeContainerFormat: 'FRES',
      needsConversion: true,
      conversionHint: 'FRES model header is incomplete or truncated; pair extracted textures/models locally.',
    };
  }

  if (
    magic4 === 'BARS' ||
    magic4 === 'BWAV' ||
    magic4 === 'FSTM' ||
    magic4 === 'SARC' ||
    (bytes.length >= 4 && bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) ||
    ['bars', 'bwav', 'bfstm', 'sarc', 'zs', 'szs', 'spr', 'tex'].includes(ext)
  ) {
    const label =
      magic4 && /^[A-Z0-9]{4}$/.test(magic4)
        ? magic4
        : ext
        ? `.${ext.toUpperCase()}`
        : 'SWITCH_BIN';
    const isAudio = ['bars', 'bwav', 'bfstm'].includes(ext) || ['BARS', 'BWAV', 'FSTM'].includes(magic4);
    const isSpr = ['spr', 'tex'].includes(ext);
    return {
      kind: 'native_unparsed',
      nativeContainerFormat: label,
      needsConversion: true,
      conversionHint: isAudio
        ? `${label} audio container still needs reverse-engineered cue mapping. Export locally to WAV/OGG/FLAC to audition in Groove Builder.`
        : isSpr
        ? `${label} proprietary sprite/texture sheet archive is not directly decoded. Unpack locally to PNG + JSON atlas or BNTX + BFLYT.`
        : `${label} Switch container cannot be parsed safely in browser without game-specific schemas. Unpack locally to BNTX/BFLYT/BFRES or PNG/WAV.`,
    };
  }

  // Image assets (only PNG, JPEG, WebP, GIF with verifiable raster headers)
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isGif = magic4 === 'GIF8';
  const isWebp = magic4 === 'RIFF' && readAscii(bytes, 8, 4) === 'WEBP';
  const isSvg =
    ext === 'svg' ||
    mimeType === 'image/svg+xml' ||
    readAscii(bytes, 0, 128).toLowerCase().includes('<svg');

  if (isSvg) {
    return {
      kind: 'native_unparsed',
      nativeContainerFormat: 'SVG',
      needsConversion: true,
      conversionHint:
        'SVG lacks verifiable raster pixel header bounds; export locally to PNG, JPEG, WebP, or GIF before importing.',
    };
  }

  if (isPng || isJpeg || isGif || isWebp || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
    const looksLikeSheet = /(sheet|atlas|frames|anim|strip|_x\d+|_\d+x\d+)/i.test(filename);
    return {
      kind: looksLikeSheet ? 'texture_atlas' : 'sprite',
      needsConversion: false,
    };
  }

  // Audio assets (WAV, OGG, FLAC, MP3/ID3, MP4/M4A)
  const isWav = magic4 === 'RIFF' && readAscii(bytes, 8, 4) === 'WAVE';
  const isOgg = magic4 === 'OggS';
  const isFlac = magic4 === 'fLaC';
  const isMp3 =
    readAscii(bytes, 0, 3) === 'ID3' ||
    (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  const isM4a = readAscii(bytes, 4, 4) === 'ftyp';

  if (
    isWav ||
    isOgg ||
    isFlac ||
    isMp3 ||
    isM4a ||
    ['wav', 'ogg', 'mp3', 'flac', 'm4a', 'aac', 'opus', 'webm'].includes(ext) ||
    mimeType.startsWith('audio/')
  ) {
    const isBgm = /(bgm|music|song|track|loop|remix|stage_music|jingle)/i.test(filename);
    return {
      kind: isBgm ? 'music' : 'sfx',
      needsConversion: false,
    };
  }

  if (ext === 'json' || mimeType === 'application/json') {
    return {
      kind: 'animation_clip',
      needsConversion: false,
    };
  }

  return {
    kind: 'native_unparsed',
    nativeContainerFormat: ext ? `.${ext.toUpperCase()}` : 'UNKNOWN',
    needsConversion: true,
    conversionHint: 'Unrecognized local file format. Use PNG/JPEG/WebP/GIF, JSON atlas metadata, or WAV/OGG/MP3/FLAC/M4A.',
  };
}

/**
 * Parses standard TexturePacker / Aseprite JSON frame lists into AtlasFrameRect[].
 */
export function parseAtlasJson(jsonText: string): {
  frames: AtlasFrameRect[];
  metaImage?: string;
} {
  const parsed = parseStrictJson(jsonText);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON atlas must be an object.');
  }
  const obj = parsed as Record<string, unknown>;
  const frames: AtlasFrameRect[] = [];

  if (Array.isArray(obj.frames)) {
    for (let i = 0; i < obj.frames.length; i++) {
      const f = obj.frames[i] as Record<string, unknown> | undefined;
      const rect = (f?.frame ?? f) as Record<string, unknown> | undefined;
      if (!rect) continue;
      const x = Number(rect.x);
      const y = Number(rect.y);
      const w = Number(rect.w ?? rect.width);
      const h = Number(rect.h ?? rect.height);
      if ([x, y, w, h].every((n) => Number.isFinite(n) && n >= 0) && w > 0 && h > 0) {
        frames.push({
          name: typeof f?.filename === 'string' ? f.filename : typeof f?.name === 'string' ? f.name : `frame_${i}`,
          x,
          y,
          w,
          h,
        });
      }
    }
  } else if (obj.frames && typeof obj.frames === 'object') {
    for (const [name, entry] of Object.entries(obj.frames as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const rect = (e.frame ?? e) as Record<string, unknown>;
      const x = Number(rect.x);
      const y = Number(rect.y);
      const w = Number(rect.w ?? rect.width);
      const h = Number(rect.h ?? rect.height);
      if ([x, y, w, h].every((n) => Number.isFinite(n) && n >= 0) && w > 0 && h > 0) {
        frames.push({ name, x, y, w, h });
      }
    }
  }

  if (frames.length === 0) {
    throw new Error('No valid frame rectangles found in atlas JSON.');
  }
  if (frames.length > MAX_ATLAS_FRAMES) {
    throw new Error(
      `Atlas JSON defines ${frames.length} frames, exceeding MAX_ATLAS_FRAMES (${MAX_ATLAS_FRAMES}).`
    );
  }
  const meta = obj.meta as Record<string, unknown> | undefined;
  return {
    frames,
    metaImage: typeof meta?.image === 'string' ? meta.image : undefined,
  };
}

export interface AssetSuggestion {
  game: GameId | null;
  slot: LocalStageSlot | 'music' | 'sfx';
  cueKey: string | null;
  cols?: number;
  rows?: number;
  ambiguous?: boolean;
  matchedGames?: GameId[];
  ambiguityReason?: string;
}

/**
 * Matches user-extracted filenames and folder paths against Groove Engine's
 * 24-minigame IDs, RHREfresh aliases, and verified cue catalog (`CUES`).
 * Rejects ambiguous multi-game matches instead of silently choosing the first hit.
 */
export function suggestAssetAssociation(
  filename: string,
  relativePath = '',
  kind: LocalAssetKind
): AssetSuggestion {
  const combined = `${relativePath} ${filename}`.toLowerCase();
  const idTokens = combined.replace(/[^a-z0-9_]/g, ' ').split(/\s+/).filter(Boolean);
  const wordTokens = combined.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
  const compact = combined.replace(/[^a-z0-9]/g, '');

  const explicitGames = new Set<GameId>();

  // 1) Collect ALL direct GameId token matches (e.g. KAERU, PUTILABO, THE_A, CARS)
  for (const g of GAMES) {
    const gLow = g.toLowerCase();
    if (
      idTokens.includes(gLow) ||
      wordTokens.includes(gLow) ||
      combined.includes(`/${gLow}/`) ||
      combined.includes(`${gLow}_`) ||
      combined.includes(`_${gLow}`)
    ) {
      explicitGames.add(g);
    }
  }

  // 2) Collect ALL alias matches (e.g. ribbitRocket, hoopTrundling, hopStopNRoll)
  for (const [alias, g] of Object.entries(GAME_ALIASES)) {
    if (compact.includes(alias)) {
      explicitGames.add(g);
    }
  }

  let matchedGame: GameId | null = null;
  let ambiguous = false;
  let matchedGamesList: GameId[] | undefined;
  let ambiguityReason: string | undefined;

  if (explicitGames.size === 1) {
    matchedGame = [...explicitGames][0];
  } else if (explicitGames.size > 1) {
    ambiguous = true;
    matchedGamesList = [...explicitGames];
    ambiguityReason = `Path matches multiple minigames: ${matchedGamesList.join(', ')}`;
  }

  // 3) Cue name matching (strictly scoped when game is unique; ambiguity-checked across CUES otherwise)
  let matchedCue: CueDef | null = null;
  if (!ambiguous) {
    const candidateCues = matchedGame ? getCuesForGame(matchedGame) : CUES;
    const cueHits: CueDef[] = [];
    for (const cue of candidateCues) {
      const names = [cue.name, ...cue.aliases].map((s) => s.toLowerCase());
      if (names.some((n) => n.length >= 3 && (wordTokens.includes(n) || idTokens.includes(n)))) {
        cueHits.push(cue);
      }
    }
    if (matchedGame) {
      const uniqueFnKeys = new Set(cueHits.map((c) => c.fn));
      if (uniqueFnKeys.size === 1) {
        matchedCue = cueHits[0];
      }
    } else if (cueHits.length > 0) {
      const cueGames = new Set<GameId>(cueHits.map((c) => c.game));
      if (cueGames.size === 1) {
        matchedGame = [...cueGames][0];
        const uniqueFnKeys = new Set(cueHits.map((c) => c.fn));
        if (uniqueFnKeys.size === 1) {
          matchedCue = cueHits[0];
        }
      } else {
        ambiguous = true;
        matchedGamesList = [...cueGames];
        ambiguityReason = `Cue token matches multiple minigames: ${matchedGamesList.join(', ')}`;
      }
    }
  }

  // Grid hint such as "_4x2" or "8x1" in sprite sheet filename
  let cols: number | undefined;
  let rows: number | undefined;
  const gridMatch = filename.match(/(?:^|[_\-\s])(\d{1,2})x(\d{1,2})(?:[_\-.\s]|$)/i);
  if (gridMatch) {
    const c = parseInt(gridMatch[1], 10);
    const r = parseInt(gridMatch[2], 10);
    if (c >= 1 && c <= 32 && r >= 1 && r <= 32) {
      cols = c;
      rows = r;
    }
  }

  let slot: AssetSuggestion['slot'] = 'actor';
  if (kind === 'music') {
    slot = 'music';
  } else if (kind === 'sfx') {
    slot = 'sfx';
  } else if (/(prologue|titlecard|intro_bg|logo)/i.test(combined)) {
    slot = 'prologue';
  } else if (/(backdrop|background|\bbg\b|stage_bg|sky|horizon)/i.test(combined)) {
    slot = 'backdrop';
  } else if (/(foreground|\bfg\b|overlay|curtain)/i.test(combined)) {
    slot = 'foreground';
  } else {
    slot = 'actor';
  }

  const cueKey = matchedCue
    ? `${matchedCue.game}:0x${matchedCue.fn.toString(16).toUpperCase()}`
    : matchedGame && slot === 'sfx'
    ? `${matchedGame}:default`
    : null;

  return {
    game: ambiguous ? null : matchedGame,
    slot,
    cueKey: ambiguous ? null : cueKey,
    cols,
    rows,
    ambiguous,
    matchedGames: matchedGamesList,
    ambiguityReason,
  };
}

export interface ActiveSpriteFrameDraw {
  assetId: string;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Resolves which frame rectangle on an actor sprite or texture atlas should be rendered
 * at the current timeline tick, matching active Groove Engine cues, `anim` events, or beat pulse.
 */
export function resolveActiveAnimationFrame(params: {
  game: GameId;
  binding: GameAssetBinding | undefined;
  assetsById: Map<string, LocalAssetRecord>;
  currentTick: number;
  bpm: number;
  activeCue: TimelineEvent | null;
  cueAgeBeats: number;
  activeAnim: TimelineEvent | null;
}): ActiveSpriteFrameDraw | null {
  const { game, binding, assetsById, currentTick, bpm, activeCue, cueAgeBeats, activeAnim } = params;
  if (!binding) return null;

  const beat = currentTick / TPB;
  const secPerBeat = 60 / Math.max(20, bpm);

  // Priority: 1) matching `anim` event -> 2) recent `cue` clip -> 3) `beat` -> 4) `idle`
  let clip: LocalAnimationClipConfig | undefined;
  if (activeAnim?.animName) {
    clip = binding.animations.find(
      (a) => a.triggerType === 'anim' && a.triggerKey.toLowerCase() === activeAnim.animName!.toLowerCase()
    );
  }
  if (!clip && activeCue && cueAgeBeats < 4) {
    const fnHex = `0x${(activeCue.fn ?? 0).toString(16).toUpperCase()}`;
    clip = binding.animations.find(
      (a) =>
        a.triggerType === 'cue' &&
        (a.triggerKey === `${game}:${fnHex}` ||
          a.triggerKey === fnHex ||
          (activeCue.word && a.triggerKey.toUpperCase() === `${game}:${activeCue.word}`) ||
          a.triggerKey.toLowerCase() === `${game}:default`)
    );
  }
  if (!clip) {
    clip =
      binding.animations.find((a) => a.triggerType === 'beat') ??
      binding.animations.find((a) => a.triggerType === 'idle');
  }

  const assetId = clip?.assetId ?? binding.actorAssetId;
  if (!assetId) return null;
  const asset = assetsById.get(assetId);
  if (!asset || !asset.imageDataUrl) return null;

  const imgW = Math.max(1, asset.width ?? 128);
  const imgH = Math.max(1, asset.height ?? 128);

  if (clip) {
    const safeStart = Math.max(0, clip.startFrame);
    const totalAtlasFrames = asset.atlasFrames?.length ?? 0;

    let frameOffset = 0;
    if (clip.beatSync) {
      const localBeat =
        clip.triggerType === 'cue' && cueAgeBeats < 8
          ? Math.max(0, cueAgeBeats)
          : Math.max(0, beat % 1);
      const count = Math.max(1, clip.endFrame - safeStart + 1);
      frameOffset = Math.min(count - 1, Math.floor(localBeat * count) % count);
    } else {
      const count = Math.max(1, clip.endFrame - safeStart + 1);
      const elapsedSec =
        clip.triggerType === 'cue' && cueAgeBeats < 8
          ? Math.max(0, cueAgeBeats) * secPerBeat
          : Math.max(0, beat) * secPerBeat;
      frameOffset = Math.floor(elapsedSec * Math.max(1, clip.fps)) % count;
    }

    const frameIdx = safeStart + frameOffset;

    if (totalAtlasFrames > 0 && asset.atlasFrames) {
      const rect = asset.atlasFrames[frameIdx % totalAtlasFrames];
      return {
        assetId,
        sx: rect.x,
        sy: rect.y,
        sw: rect.w,
        sh: rect.h,
        scale: clip.scale,
        offsetX: clip.offsetX,
        offsetY: clip.offsetY,
      };
    }

    const cols = Math.max(1, clip.cols || asset.cols || 1);
    const rows = Math.max(1, clip.rows || asset.rows || 1);
    const totalCells = cols * rows;
    const cell = frameIdx % totalCells;
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    const cellW = imgW / cols;
    const cellH = imgH / rows;
    return {
      assetId,
      sx: col * cellW,
      sy: row * cellH,
      sw: cellW,
      sh: cellH,
      scale: clip.scale,
      offsetX: clip.offsetX,
      offsetY: clip.offsetY,
    };
  }

  // Fallback: single static actor sprite or first frame of sheet
  if (asset.atlasFrames && asset.atlasFrames.length > 0) {
    const r = asset.atlasFrames[0];
    return { assetId, sx: r.x, sy: r.y, sw: r.w, sh: r.h, scale: 1, offsetX: 0, offsetY: 0 };
  }
  const cols = Math.max(1, asset.cols ?? 1);
  const rows = Math.max(1, asset.rows ?? 1);
  return {
    assetId,
    sx: 0,
    sy: 0,
    sw: imgW / cols,
    sh: imgH / rows,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
}

/**
 * Resolves exact local SFX Asset ID for a cue call, checking cue-specific override first,
 * then game-wide default override.
 */
export function resolveCueSfxAssetId(
  ev: TimelineEvent,
  bindings: Partial<Record<GameId, GameAssetBinding>>
): string | null {
  if (ev.op !== 'call' || !ev.game) return null;
  const b = bindings[ev.game];
  if (!b) return null;

  if (ev.word) {
    const wordKey = `${ev.game}:${ev.word}`;
    if (b.cueSfxMap[wordKey]) return b.cueSfxMap[wordKey];
  }
  if (ev.fn !== undefined) {
    const fnKey = `${ev.game}:0x${ev.fn.toString(16).toUpperCase()}`;
    if (b.cueSfxMap[fnKey]) return b.cueSfxMap[fnKey];
  }
  return b.cueSfxMap[`${ev.game}:default`] ?? null;
}

/**
 * Imports and decodes valid Nintendo Switch binary containers (BNTX, BFLYT, BFLAN, BFRES)
 * into clean browser-local Vault records, preserving multi-texture extraction and honest
 * fallback diagnostics for ASTC/BC7 or incomplete binary blocks.
 */
export function importSwitchContainerAsset(
  filename: string,
  relativePath: string,
  bytes: Uint8Array,
  mimeType = 'application/octet-stream'
): LocalAssetRecord[] {
  const magic4 = readAscii(bytes, 0, 4);
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const nowIso = new Date().toISOString();
  const makeId = (suffix = '') =>
    `loc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}${suffix}`;

  if (magic4 === 'BNTX' || ext === 'bntx') {
    const archive = parseBntxContainer(bytes, filename, { generatePngDataUrl: true });
    const out: LocalAssetRecord[] = [];
    for (let i = 0; i < archive.textures.length; i++) {
      const tex = archive.textures[i];
      assertImageDimensionBounds(tex.width, tex.height, `${filename}:${tex.name}`);
      const outName = tex.name.includes('.') ? tex.name : `${tex.name}.png`;
      const outRel =
        relativePath !== filename
          ? `${relativePath}/${outName}`
          : archive.textures.length === 1
          ? outName
          : `${filename}/${outName}`;
      if (tex.decoded && tex.pngDataUrl) {
        const suggestion = suggestAssetAssociation(outName, outRel, 'sprite');
        out.push({
          id: makeId(`_t${i}`),
          name: outName,
          relativePath: outRel,
          kind: suggestion.cols && suggestion.rows ? 'texture_atlas' : 'sprite',
          mimeType: 'image/png',
          sizeBytes: tex.pngDataUrl.length,
          addedAtIso: nowIso,
          nativeContainerFormat: `BNTX (${tex.formatName})`,
          sourceContainerName: filename,
          needsConversion: false,
          imageDataUrl: tex.pngDataUrl,
          width: tex.width,
          height: tex.height,
          cols: suggestion.cols,
          rows: suggestion.rows,
          suggestedGame: suggestion.game,
          suggestedSlot: suggestion.slot,
          suggestedCueKey: suggestion.cueKey,
          associationAmbiguous: suggestion.ambiguous,
          matchedGames: suggestion.matchedGames,
          ambiguityReason: suggestion.ambiguityReason,
        });
      } else {
        const suggestion = suggestAssetAssociation(outName, outRel, 'native_unparsed');
        out.push({
          id: makeId(`_u${i}`),
          name: `${outName} (${tex.formatName})`,
          relativePath: outRel,
          kind: 'native_unparsed',
          mimeType,
          sizeBytes: bytes.length,
          addedAtIso: nowIso,
          nativeContainerFormat: `BNTX (${tex.formatName})`,
          sourceContainerName: filename,
          needsConversion: true,
          conversionHint:
            tex.unsupportedReason ??
            `BNTX texture '${tex.name}' (${tex.formatName}) could not be decoded in-browser; convert locally to PNG.`,
          width: tex.width,
          height: tex.height,
          suggestedGame: suggestion.game,
          suggestedSlot: suggestion.slot,
          suggestedCueKey: suggestion.cueKey,
        });
      }
    }
    return out;
  }

  if (magic4 === 'FLYT' || ext === 'bflyt') {
    const layout = parseBflytContainer(bytes, filename);
    const suggestion = suggestAssetAssociation(filename, relativePath, 'native_layout');
    return [
      {
        id: makeId('_lyt'),
        name: filename,
        relativePath,
        kind: 'native_layout',
        mimeType,
        sizeBytes: bytes.length,
        addedAtIso: nowIso,
        nativeContainerFormat: 'BFLYT',
        needsConversion: false,
        bflytData: layout,
        width: Math.round(layout.width),
        height: Math.round(layout.height),
        suggestedGame: suggestion.game,
        suggestedSlot: suggestion.slot,
        suggestedCueKey: suggestion.cueKey,
        associationAmbiguous: suggestion.ambiguous,
        matchedGames: suggestion.matchedGames,
        ambiguityReason: suggestion.ambiguityReason,
      },
    ];
  }

  if (magic4 === 'FLAN' || ext === 'bflan') {
    const anim = parseBflanContainer(bytes, filename);
    const suggestion = suggestAssetAssociation(filename, relativePath, 'animation_clip');
    return [
      {
        id: makeId('_anm'),
        name: filename,
        relativePath,
        kind: 'animation_clip',
        mimeType,
        sizeBytes: bytes.length,
        addedAtIso: nowIso,
        nativeContainerFormat: 'BFLAN',
        needsConversion: false,
        bflanData: anim,
        suggestedGame: suggestion.game,
        suggestedSlot: suggestion.slot,
        suggestedCueKey: suggestion.cueKey,
        associationAmbiguous: suggestion.ambiguous,
        matchedGames: suggestion.matchedGames,
        ambiguityReason: suggestion.ambiguityReason,
      },
    ];
  }

  if (magic4 === 'FRES' || ext === 'bfres') {
    const model = parseBfresContainer(bytes, filename);
    const suggestion = suggestAssetAssociation(filename, relativePath, 'native_model');
    return [
      {
        id: makeId('_mdl'),
        name: filename,
        relativePath,
        kind: 'native_model',
        mimeType,
        sizeBytes: bytes.length,
        addedAtIso: nowIso,
        nativeContainerFormat: 'BFRES',
        needsConversion: false,
        conversionHint: model.warnings.length ? model.warnings.join(' ') : undefined,
        bfresData: model,
        suggestedGame: suggestion.game,
        suggestedSlot: suggestion.slot,
        suggestedCueKey: suggestion.cueKey,
        associationAmbiguous: suggestion.ambiguous,
        matchedGames: suggestion.matchedGames,
        ambiguityReason: suggestion.ambiguityReason,
      },
    ];
  }

  return [];
}

/**
 * Exports ONLY safe association metadata (zero binary image/audio blobs and zero copyrighted files).
 */
export function exportVaultBindingsManifestOnly(state: LocalVaultState): string {
  const payload = {
    format: 'groove-builder-local-bindings/1',
    note: 'Metadata-only mapping; extracted user assets stay strictly local in browser IndexedDB.',
    assetsSummary: state.assets.map((a) => ({
      id: a.id,
      name: a.name,
      relativePath: a.relativePath,
      kind: a.kind,
      nativeContainerFormat: a.nativeContainerFormat,
      sizeBytes: a.sizeBytes,
      cols: a.cols,
      rows: a.rows,
      atlasFrameCount: a.atlasFrames?.length ?? 0,
      layoutPaneCount: a.bflytData?.panes.length ?? 0,
      animEntryCount: a.bflanData?.entries.length ?? 0,
      modelCount: a.bfresData?.models.length ?? 0,
    })),
    bindings: state.bindings,
    globalAudio: state.globalAudio,
  };
  return JSON.stringify(payload, null, 2);
}

// ---------- Browser-Local IndexedDB Persistence ----------

function getIdbFactory(override?: IDBFactory): IDBFactory {
  const idb = override ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
  if (!idb) {
    throw new LocalVaultStorageError(
      'unavailable',
      'IndexedDB is unavailable in this environment; local vault changes cannot be persisted.'
    );
  }
  return idb;
}

function classifyIdbError(err: unknown, fallbackCode: LocalVaultErrorCode, fallbackMsg: string): LocalVaultStorageError {
  if (err instanceof LocalVaultStorageError) return err;
  const name = (err as { name?: string } | null | undefined)?.name ?? '';
  const msg = (err as { message?: string } | null | undefined)?.message ?? fallbackMsg;
  if (name === 'QuotaExceededError' || /quota/i.test(msg)) {
    return new LocalVaultStorageError('quota_exceeded', `Local vault storage quota exceeded: ${msg}`, err);
  }
  if (name === 'AbortError') {
    return new LocalVaultStorageError('aborted', `IndexedDB transaction aborted: ${msg}`, err);
  }
  return new LocalVaultStorageError(fallbackCode, msg, err);
}

function openVaultDb(idbFactory?: IDBFactory): Promise<IDBDatabase> {
  const idb = getIdbFactory(idbFactory);
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(classifyIdbError(err, 'unavailable', 'Failed to open IndexedDB local vault'));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(classifyIdbError(req.error, 'unavailable', 'Failed to open local vault DB'));
    req.onblocked = () =>
      reject(new LocalVaultStorageError('aborted', 'Local vault IndexedDB open blocked by another tab.'));
  });
}

export async function loadLocalVault(idbFactory?: IDBFactory): Promise<LocalVaultState> {
  const db = await openVaultDb(idbFactory);
  try {
    const assets = await new Promise<LocalAssetRecord[]>((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown, fallback: LocalVaultErrorCode) => {
        if (settled) return;
        settled = true;
        reject(classifyIdbError(err, fallback, 'Failed reading local vault assets'));
      };
      const tx = db.transaction(STORE_ASSETS, 'readonly');
      tx.onabort = () => fail(tx.error, 'aborted');
      tx.onerror = () => fail(tx.error, 'transaction_failed');

      const loaded: LocalAssetRecord[] = [];
      let totalBytes = 0;
      const req = tx.objectStore(STORE_ASSETS).openCursor();
      req.onsuccess = () => {
        if (settled) return;
        const cursor = req.result;
        if (!cursor) {
          settled = true;
          resolve(loaded);
          return;
        }
        const rec = cursor.value as LocalAssetRecord;
        totalBytes += estimateStoredRecordBytes(rec);
        if (loaded.length >= MAX_VAULT_TOTAL_ASSETS || totalBytes > MAX_VAULT_TOTAL_BYTES) {
          fail(
            new LocalVaultStorageError(
              'budget_exceeded',
              `Stored local vault exceeds safe memory budget (${MAX_VAULT_TOTAL_ASSETS} items / ${MAX_VAULT_TOTAL_BYTES / (1024 * 1024)} MiB).`
            ),
            'budget_exceeded'
          );
          try {
            tx.abort();
          } catch {
            // ignore abort rethrow
          }
          return;
        }
        loaded.push(rec);
        cursor.continue();
      };
      req.onerror = () => fail(req.error, 'transaction_failed');
    });

    const meta = await new Promise<{
      bindings?: Partial<Record<GameId, GameAssetBinding>>;
      globalAudio?: GlobalAudioBindings;
    } | null>((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown, fallback: LocalVaultErrorCode) => {
        if (settled) return;
        settled = true;
        reject(classifyIdbError(err, fallback, 'Failed reading local vault bindings'));
      };
      const tx = db.transaction(STORE_META, 'readonly');
      tx.onabort = () => fail(tx.error, 'aborted');
      tx.onerror = () => fail(tx.error, 'transaction_failed');
      const req = tx.objectStore(STORE_META).get(META_BINDINGS_KEY);
      req.onsuccess = () => {
        if (settled) return;
        settled = true;
        resolve((req.result as never) ?? null);
      };
      req.onerror = () => fail(req.error, 'transaction_failed');
    });

    return {
      assets,
      bindings: meta?.bindings ?? {},
      globalAudio: meta?.globalAudio ?? { jingleAssetMap: {} },
    };
  } finally {
    db.close();
  }
}

export async function saveVaultAssetsBatch(
  assets: ReadonlyArray<LocalAssetRecord>,
  idbFactory?: IDBFactory
): Promise<LocalAssetRecord[]> {
  if (assets.length === 0) return [];
  const deduped = upsertAssetsById([], assets);
  const db = await openVaultDb(idbFactory);
  try {
    return await new Promise<LocalAssetRecord[]>((resolve, reject) => {
      let settled = false;
      let mergedResult: LocalAssetRecord[] = [];
      const fail = (err: unknown, fallback: LocalVaultErrorCode) => {
        if (settled) return;
        settled = true;
        reject(classifyIdbError(err, fallback, 'Failed persisting local vault assets batch'));
      };
      const tx = db.transaction(STORE_ASSETS, 'readwrite');
      tx.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve(mergedResult);
        }
      };
      tx.onabort = () => fail(tx.error, 'aborted');
      tx.onerror = () => fail(tx.error, 'transaction_failed');

      const store = tx.objectStore(STORE_ASSETS);
      const existing: LocalAssetRecord[] = [];
      const cursorReq = store.openCursor();
      cursorReq.onerror = () => fail(cursorReq.error, 'transaction_failed');
      cursorReq.onsuccess = () => {
        if (settled) return;
        const cursor = cursorReq.result;
        if (cursor) {
          existing.push(cursor.value as LocalAssetRecord);
          cursor.continue();
          return;
        }
        // Validate authoritative DB state + incoming batch inside this SAME readwrite transaction before writing
        try {
          validateVaultImportBudget({
            existingAssets: existing.map((a) => ({
              id: a.id,
              sizeBytes: estimateStoredRecordBytes(a),
            })),
            incoming: deduped.map((a) => ({
              id: a.id,
              name: a.name,
              sizeBytes: estimateStoredRecordBytes(a),
            })),
          });
          mergedResult = upsertAssetsById(existing, deduped);
          for (const asset of deduped) {
            const req = store.put(asset);
            req.onerror = () => fail(req.error, 'transaction_failed');
          }
        } catch (err) {
          fail(err, 'budget_exceeded');
          try {
            tx.abort();
          } catch {
            // ignore abort rethrow
          }
        }
      };
    });
  } finally {
    db.close();
  }
}

export async function saveVaultAsset(asset: LocalAssetRecord, idbFactory?: IDBFactory): Promise<void> {
  await saveVaultAssetsBatch([asset], idbFactory);
}

export async function deleteVaultAsset(assetId: string, idbFactory?: IDBFactory): Promise<void> {
  const db = await openVaultDb(idbFactory);
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown, fallback: LocalVaultErrorCode) => {
        if (settled) return;
        settled = true;
        reject(classifyIdbError(err, fallback, 'Failed deleting local vault asset'));
      };
      const tx = db.transaction(STORE_ASSETS, 'readwrite');
      tx.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      tx.onabort = () => fail(tx.error, 'aborted');
      tx.onerror = () => fail(tx.error, 'transaction_failed');
      const req = tx.objectStore(STORE_ASSETS).delete(assetId);
      req.onerror = () => fail(req.error, 'transaction_failed');
    });
  } finally {
    db.close();
  }
}

export async function saveVaultBindings(
  bindings: Partial<Record<GameId, GameAssetBinding>>,
  globalAudio: GlobalAudioBindings,
  idbFactory?: IDBFactory
): Promise<void> {
  const db = await openVaultDb(idbFactory);
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown, fallback: LocalVaultErrorCode) => {
        if (settled) return;
        settled = true;
        reject(classifyIdbError(err, fallback, 'Failed saving local vault bindings'));
      };
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      tx.onabort = () => fail(tx.error, 'aborted');
      tx.onerror = () => fail(tx.error, 'transaction_failed');
      try {
        const req = tx.objectStore(STORE_META).put({ bindings, globalAudio }, META_BINDINGS_KEY);
        req.onerror = () => fail(req.error, 'transaction_failed');
      } catch (syncErr) {
        fail(syncErr, 'transaction_failed');
      }
    });
  } finally {
    db.close();
  }
}

export async function purgeLocalVault(idbFactory?: IDBFactory): Promise<void> {
  const db = await openVaultDb(idbFactory);
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown, fallback: LocalVaultErrorCode) => {
        if (settled) return;
        settled = true;
        reject(classifyIdbError(err, fallback, 'Failed purging local vault'));
      };
      const tx = db.transaction([STORE_ASSETS, STORE_META], 'readwrite');
      tx.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      tx.onabort = () => fail(tx.error, 'aborted');
      tx.onerror = () => fail(tx.error, 'transaction_failed');
      tx.objectStore(STORE_ASSETS).clear();
      tx.objectStore(STORE_META).clear();
    });
  } finally {
    db.close();
  }
}

export function buildLocalAssetCueList(game: GameId): Array<{ key: string; label: string }> {
  const list: Array<{ key: string; label: string }> = [
    { key: `${game}:default`, label: `${GAME_META[game].title} (Default Cue SFX)` },
  ];
  const seen = new Set<string>();
  for (const cue of getCuesForGame(game)) {
    const key = cue.word
      ? `${game}:${cue.word}`
      : `${game}:0x${cue.fn.toString(16).toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({
      key,
      label: cue.word
        ? `${cue.word} (0x${cue.fn.toString(16).toUpperCase()})`
        : `${cue.name} (0x${cue.fn.toString(16).toUpperCase()})`,
    });
  }
  return list;
}

export function normalizeGameKey(input: string): GameId | null {
  return canonicalGame(input);
}
