import { GameId, GAMES } from './cues.ts';
import { CONTRACT_VERSION } from './engineContract.ts';
import {
  compileGtf,
  decompileToGtf,
  emitGtl,
  parseGtl,
  Timeline,
} from './gtfEngine.ts';
import {
  assertSafeArchivePath,
  buildCanonicalZip,
  CanonicalZipInputEntry,
  decodeUtf8Strict,
  inspectAndOpenZip,
  parseStrictJson,
} from './zipSecurity.ts';

// Limits aligned with docs/GROOVE_SPEC.md (draft 0.1) & docs/GROOVE_PROFILE_DRAFT_02.md (draft 0.2)
export const MAX_PACKAGE_COMPRESSED_BYTES = 32 * 1024 * 1024; // 32 MiB
export const MAX_PACKAGE_DECOMPRESSED_BYTES = 64 * 1024 * 1024; // 64 MiB
export const MAX_PACKAGE_FILES = 256;
export const MAX_RUNTIME_FILES = 2;
export const MAX_MANIFEST_BYTES = 16 * 1024; // 16 KiB
export const MAX_TIMELINE_BYTES = 60 * 1024; // 60 KiB
export const MAX_ASSET_BYTES = 32 * 1024 * 1024; // 32 MiB per editor asset

export const SUPPORTED_ENGINE_VERSION = '0.6.0';
export const SUPPORTED_ENGINE_CONTRACT = CONTRACT_VERSION;

export type GrooveProfile = 'editor' | 'runtime';
export type RuntimeTimelineFormat = 'gtf' | 'gtl';

export interface CustomSpriteConfig {
  game: GameId;
  imageDataUrl?: string;
  imageName?: string;
  scale: number; // 0.4 .. 2.0
  offsetX: number; // -100 .. 100
  offsetY: number; // -100 .. 100
  tint: string; // hex color or ''
  bounceAmount: number; // 0 .. 2
  defaultAnim: string;
}

export interface GrooveRuntimeManifest {
  format: 'groove-package/1';
  profile: 'runtime';
  id: string;
  version: string;
  title: string;
  engine_min: string;
  engine_contract: 1;
  adapter: 'multi';
  timeline:
    | { format: 'gtf'; path: 'timeline.gtf' }
    | { format: 'gtl'; path: 'timeline.gtl' };
  required_capabilities: ['timeline.gtf'] | ['timeline.gtl'];
  results: 'custom';
}

export interface GrooveEditorManifest {
  format: 'groove-package/1';
  profile: 'editor';
  id: string;
  version: string;
  title: string;
  engine_min: string;
  engine_contract: 1;
  adapter: 'multi';
  timeline: {
    format: 'gtf' | 'gtl';
    path: string;
  };
  required_capabilities: string[];
  results: 'custom';
  editor: {
    bpm: number;
    musicOffsetSec: number;
    musicFilename?: string;
    prologue: string;
    prologueImageName?: string;
    jingle: number;
    bgm: number;
    sprites: Partial<Record<GameId, Omit<CustomSpriteConfig, 'imageDataUrl'> & { file?: string }>>;
  };
}

export type GroovePackageManifest = GrooveRuntimeManifest | GrooveEditorManifest;

export interface GrooveProjectPackage {
  profile?: GrooveProfile;
  runtimeFormat?: RuntimeTimelineFormat;
  packageId: string;
  packageVersion: string;
  timeline: Timeline;
  bpm: number;
  musicOffsetSec: number;
  musicFile?: { name: string; buffer: ArrayBuffer; mime: string } | null;
  prologueImage?: { name: string; dataUrl: string } | null;
  sprites: Partial<Record<GameId, CustomSpriteConfig>>;
  sha256?: string;
}

export interface RuntimeConversionImpact {
  omittedAssets: string[];
  adjustments: string[];
  hasChanges: boolean;
}

const PACKAGE_ID_REGEX =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const SEMVER_REGEX = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const DOS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

const utf8Enc = new TextEncoder();

/**
 * Generates a cryptographic persistent reverse-DNS project ID once per new project/fork.
 */
export function generateProjectId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `org.groovebuilder.${globalThis.crypto.randomUUID().toLowerCase()}`;
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `org.groovebuilder.${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isValidPackageId(id: string): boolean {
  if (typeof id !== 'string' || id.length < 3 || id.length > 96) return false;
  if (!PACKAGE_ID_REGEX.test(id)) return false;
  for (const seg of id.split('.')) {
    if (DOS_RESERVED.has(seg.toLowerCase())) return false;
  }
  return true;
}

export function isValidSemver(ver: string): boolean {
  return typeof ver === 'string' && SEMVER_REGEX.test(ver);
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export function isValidPackageTitle(title: string): boolean {
  if (typeof title !== 'string') return false;
  if (!title.trim()) return false;
  const bytes = utf8Enc.encode(title);
  if (bytes.length < 1 || bytes.length > 95) return false;
  for (let i = 0; i < title.length; i++) {
    const code = title.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

export function analyzeRuntimeExportImpact(pkg: GrooveProjectPackage): RuntimeConversionImpact {
  const omittedAssets: string[] = [];
  const adjustments: string[] = [];

  if (pkg.musicFile) {
    omittedAssets.push(`Imported audio track (${pkg.musicFile.name})`);
  }
  const customSprites = Object.values(pkg.sprites).filter(
    (s) => s && (s.imageDataUrl || s.tint || s.scale !== 1 || s.offsetX !== 0 || s.offsetY !== 0)
  );
  if (customSprites.length > 0) {
    omittedAssets.push(`${customSprites.length} custom sprite override(s)`);
  }
  if (pkg.prologueImage) {
    omittedAssets.push(`Custom intro art (${pkg.prologueImage.name})`);
  }
  if (pkg.bpm !== 120 || pkg.musicOffsetSec !== 0) {
    adjustments.push(
      `Editor BPM/audio offset metadata (${pkg.bpm} BPM, ${pkg.musicOffsetSec}s) is omitted from runtime profile (Switch uses BGM ${pkg.timeline.bgm})`
    );
  }
  if (pkg.timeline.results === 1) {
    adjustments.push('Results mode converted from "native" to "exit" / manifest "custom" (isolated stats)');
  }
  const [mw, mc, mr] = pkg.timeline.match;
  if (mw !== -1 || mc !== 9 || mr !== 4) {
    adjustments.push(`Explicit map match (${mw} ${mc} ${mr}) omitted (registry assigns slot)`);
  }

  return {
    omittedAssets,
    adjustments,
    hasChanges: omittedAssets.length > 0 || adjustments.length > 0,
  };
}

function dataUrlToUint8Array(dataUrl: string): { bytes: Uint8Array; ext: string } {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Data URL de imagen invalida');
  const header = dataUrl.slice(0, comma);
  const b64 = dataUrl.slice(comma + 1);
  const mimeMatch = header.match(/data:image\/([a-zA-Z0-9+.-]+);/);
  const ext = mimeMatch ? mimeMatch[1].replace('svg+xml', 'svg') : 'png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return { bytes, ext };
}

function uint8ArrayToDataUrl(bytes: Uint8Array, filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'png';
  const mime =
    ext === 'svg'
      ? 'image/svg+xml'
      : ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'webp'
      ? 'image/webp'
      : 'image/png';
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

export async function sha256Hex(input: Blob | Uint8Array | ArrayBuffer): Promise<string> {
  const buf =
    input instanceof Uint8Array
      ? new Uint8Array(input).buffer
      : input instanceof ArrayBuffer
      ? input
      : await input.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function assertCleanProjectMeta(pkg: GrooveProjectPackage): {
  id: string;
  version: string;
  title: string;
} {
  if (!isValidPackageId(pkg.packageId)) {
    throw new Error(
      `ID de paquete invalido: '${pkg.packageId}'. Debe seguir reverse-DNS (p. ej. org.groovebuilder.<uuid>).`
    );
  }
  if (!isValidSemver(pkg.packageVersion)) {
    throw new Error(`Version semver invalida: '${pkg.packageVersion}'`);
  }
  const title = (pkg.timeline.title || 'Remix 21').trim();
  if (!isValidPackageTitle(title)) {
    throw new Error('Titulo invalido para paquete .groove (1..95 bytes UTF-8 sin caracteres de control)');
  }
  return { id: pkg.packageId, version: pkg.packageVersion, title };
}

/**
 * Exports either an explicit `editor` authoring bundle or a strict `runtime` bundle (draft 0.2).
 * Deterministic member order and timestamps produce identical bytes across exports of identical state.
 */
export async function exportGroovePackage(
  pkg: GrooveProjectPackage
): Promise<{ blob: Blob; sha256: string; profile: GrooveProfile; manifest: GroovePackageManifest }> {
  const profile: GrooveProfile = pkg.profile ?? 'editor';
  const { id, version, title } = assertCleanProjectMeta(pkg);

  if (profile === 'runtime') {
    const rtFormat: RuntimeTimelineFormat = pkg.runtimeFormat ?? 'gtf';
    const timelinePath = rtFormat === 'gtl' ? 'timeline.gtl' : 'timeline.gtf';
    const timelineText =
      rtFormat === 'gtl'
        ? emitGtl(pkg.timeline, title, { runtimeMode: true })
        : decompileToGtf(pkg.timeline, title, { runtimeMode: true });

    const timelineBytes = utf8Enc.encode(timelineText);
    if (timelineBytes.length < 1 || timelineBytes.length > MAX_TIMELINE_BYTES) {
      throw new Error(`${timelinePath} excede el limite de 1..${MAX_TIMELINE_BYTES} bytes`);
    }

    // Verify exported runtime timeline passes strict runtime parser parity
    if (rtFormat === 'gtl') {
      parseGtl(timelineText, timelinePath, { runtimeMode: true });
    } else {
      compileGtf(timelineText, timelinePath, { runtimeMode: true });
    }

    const manifest: GrooveRuntimeManifest = {
      format: 'groove-package/1',
      profile: 'runtime',
      id,
      version,
      title,
      engine_min: SUPPORTED_ENGINE_VERSION,
      engine_contract: 1,
      adapter: 'multi',
      timeline:
        rtFormat === 'gtl'
          ? { format: 'gtl', path: 'timeline.gtl' }
          : { format: 'gtf', path: 'timeline.gtf' },
      required_capabilities:
        rtFormat === 'gtl' ? ['timeline.gtl'] : ['timeline.gtf'],
      results: 'custom',
    };

    const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
    if (utf8Enc.encode(manifestJson).length > MAX_MANIFEST_BYTES) {
      throw new Error(`manifest.json excede el limite de ${MAX_MANIFEST_BYTES} bytes`);
    }

    // Exact 2 files in canonical deterministic order
    const zipBytes = await buildCanonicalZip([
      { path: 'manifest.json', data: manifestJson },
      { path: timelinePath, data: timelineBytes },
    ]);
    if (zipBytes.byteLength > MAX_PACKAGE_COMPRESSED_BYTES) {
      throw new Error('Paquete .groove comprimido excede 32 MiB');
    }
    const sha256 = await sha256Hex(zipBytes);
    const blob = new Blob([zipBytes.slice()], { type: 'application/zip' });
    return { blob, sha256, profile, manifest };
  }

  // Authoring ('editor') profile: preserves editor metadata & custom preview assets deterministically
  const gtfText = decompileToGtf(pkg.timeline, title);
  const gtlText = emitGtl(pkg.timeline, title);
  if (utf8Enc.encode(gtfText).length > MAX_TIMELINE_BYTES || utf8Enc.encode(gtlText).length > MAX_TIMELINE_BYTES) {
    throw new Error(`timeline supera el limite de ${MAX_TIMELINE_BYTES} bytes`);
  }

  const assetEntries: CanonicalZipInputEntry[] = [];
  const spriteManifest: GrooveEditorManifest['editor']['sprites'] = {};
  const sortedGames = Object.keys(pkg.sprites).sort() as GameId[];

  for (const gameKey of sortedGames) {
    const cfg = pkg.sprites[gameKey];
    if (!cfg) continue;
    let spritePath: string | undefined;
    if (cfg.imageDataUrl) {
      const { bytes, ext } = dataUrlToUint8Array(cfg.imageDataUrl);
      spritePath = `sprites/${gameKey}.${ext}`;
      assetEntries.push({ path: spritePath, data: bytes });
    }
    spriteManifest[gameKey] = {
      game: gameKey,
      imageName: cfg.imageName,
      scale: cfg.scale,
      offsetX: cfg.offsetX,
      offsetY: cfg.offsetY,
      tint: cfg.tint,
      bounceAmount: cfg.bounceAmount,
      defaultAnim: cfg.defaultAnim,
      file: spritePath,
    };
  }

  let prologueImagePath: string | undefined;
  if (pkg.prologueImage?.dataUrl) {
    const { bytes, ext } = dataUrlToUint8Array(pkg.prologueImage.dataUrl);
    prologueImagePath = `intro/prologue.${ext}`;
    assetEntries.push({ path: prologueImagePath, data: bytes });
  }

  let musicPath: string | undefined;
  if (pkg.musicFile) {
    const cleanBase = pkg.musicFile.name
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .replace(/^\.+/, 'audio')
      .replace(/[. ]+$/, '');
    const safeName = cleanBase || 'music.bin';
    musicPath = `audio/${safeName}`;
    assetEntries.push({ path: musicPath, data: new Uint8Array(pkg.musicFile.buffer) });
  }

  const manifest: GrooveEditorManifest = {
    format: 'groove-package/1',
    profile: 'editor',
    id,
    version,
    title,
    engine_min: SUPPORTED_ENGINE_VERSION,
    engine_contract: 1,
    adapter: 'multi',
    timeline: { format: 'gtf', path: 'timeline.gtf' },
    required_capabilities: ['timeline.gtf'],
    results: 'custom',
    editor: {
      bpm: pkg.bpm,
      musicOffsetSec: pkg.musicOffsetSec,
      musicFilename: musicPath,
      prologue: pkg.timeline.prologue || 'type_19',
      prologueImageName: prologueImagePath,
      jingle: pkg.timeline.jingle,
      bgm: pkg.timeline.bgm,
      sprites: spriteManifest,
    },
  };

  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  if (utf8Enc.encode(manifestJson).length > MAX_MANIFEST_BYTES) {
    throw new Error(`manifest.json excede el limite de ${MAX_MANIFEST_BYTES} bytes`);
  }

  assetEntries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const entries: CanonicalZipInputEntry[] = [
    { path: 'manifest.json', data: manifestJson },
    { path: 'timeline.gtf', data: gtfText },
    { path: 'timeline.gtl', data: gtlText },
    ...assetEntries,
  ];

  if (entries.length > MAX_PACKAGE_FILES) {
    throw new Error(`El paquete supera el limite de ${MAX_PACKAGE_FILES} archivos`);
  }

  const zipBytes = await buildCanonicalZip(entries);
  if (zipBytes.byteLength > MAX_PACKAGE_COMPRESSED_BYTES) {
    throw new Error(
      `El paquete comprimido supera los 32 MiB permitidos (${(zipBytes.byteLength / (1024 * 1024)).toFixed(1)} MiB)`
    );
  }
  const sha256 = await sha256Hex(zipBytes);
  const blob = new Blob([zipBytes.slice()], { type: 'application/zip' });
  return { blob, sha256, profile, manifest };
}

function assertExactKeys(obj: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = Object.keys(obj);
  for (const req of allowed) {
    if (!(req in obj)) {
      throw new Error(`Falta campo obligatorio '${req}' en ${label}`);
    }
  }
  for (const k of keys) {
    if (!allowed.includes(k)) {
      throw new Error(`Propiedad desconocida '${k}' prohibida en ${label}`);
    }
  }
}

export function validateStrictManifest(raw: unknown): GroovePackageManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('manifest.json debe ser un objeto JSON');
  }
  const m = raw as Record<string, unknown>;

  if (m.format !== 'groove-package/1') {
    throw new Error(`Formato de paquete no soportado: ${String(m.format ?? '(ausente)')}`);
  }
  if (m.profile !== 'runtime' && m.profile !== 'editor') {
    throw new Error(`Perfil de paquete no soportado o ausente: ${String(m.profile ?? '(ausente)')} (esperado runtime|editor)`);
  }
  if (typeof m.id !== 'string' || !isValidPackageId(m.id)) {
    throw new Error(`ID de paquete invalido: ${String(m.id ?? '(ausente)')}`);
  }
  if (typeof m.version !== 'string' || !isValidSemver(m.version)) {
    throw new Error(`Version semver invalida: ${String(m.version ?? '(ausente)')}`);
  }
  if (typeof m.title !== 'string' || !isValidPackageTitle(m.title)) {
    throw new Error(`Titulo de manifiesto invalido: ${String(m.title ?? '(ausente)')}`);
  }
  if (typeof m.engine_min !== 'string' || !isValidSemver(m.engine_min)) {
    throw new Error(`engine_min invalido: ${String(m.engine_min ?? '(ausente)')}`);
  }
  if (compareSemver(m.engine_min, SUPPORTED_ENGINE_VERSION) > 0) {
    throw new Error(
      `El paquete requiere Groove Engine >= ${m.engine_min} (soportado hasta ${SUPPORTED_ENGINE_VERSION})`
    );
  }
  if (m.engine_contract !== SUPPORTED_ENGINE_CONTRACT) {
    throw new Error(
      `engine_contract no soportado: ${String(m.engine_contract ?? '(ausente)')} (esperado ${SUPPORTED_ENGINE_CONTRACT})`
    );
  }
  if (m.adapter !== 'multi') {
    throw new Error(`Adaptador no soportado en este hito: ${String(m.adapter ?? '(ausente)')} (solo 'multi')`);
  }
  if (m.results !== 'custom') {
    throw new Error(`results debe ser 'custom' en paquetes .groove (recibido: ${String(m.results ?? '(ausente)')})`);
  }

  if (!m.timeline || typeof m.timeline !== 'object' || Array.isArray(m.timeline)) {
    throw new Error('Campo timeline invalido en manifest.json');
  }
  const tlObj = m.timeline as Record<string, unknown>;
  assertExactKeys(tlObj, ['format', 'path'], 'manifest.timeline');
  if (tlObj.format !== 'gtf' && tlObj.format !== 'gtl') {
    throw new Error(`timeline.format no soportado: ${String(tlObj.format)}`);
  }
  const expectedPath = tlObj.format === 'gtf' ? 'timeline.gtf' : 'timeline.gtl';
  if (tlObj.path !== expectedPath) {
    throw new Error(`timeline.path debe ser '${expectedPath}' para format '${tlObj.format}'`);
  }

  if (!Array.isArray(m.required_capabilities) || m.required_capabilities.length !== 1) {
    throw new Error('required_capabilities debe contener exactamente una capacidad primaria');
  }
  if (m.required_capabilities[0] !== expectedPath) {
    throw new Error(
      `required_capabilities incompatible con timeline (${String(m.required_capabilities[0])} != ${expectedPath})`
    );
  }

  if (m.profile === 'runtime') {
    assertExactKeys(
      m,
      [
        'format',
        'profile',
        'id',
        'version',
        'title',
        'engine_min',
        'engine_contract',
        'adapter',
        'timeline',
        'required_capabilities',
        'results',
      ],
      'manifest.json (runtime)'
    );
    return m as unknown as GrooveRuntimeManifest;
  }

  // Authoring ('editor') profile validation
  assertExactKeys(
    m,
    [
      'format',
      'profile',
      'id',
      'version',
      'title',
      'engine_min',
      'engine_contract',
      'adapter',
      'timeline',
      'required_capabilities',
      'results',
      'editor',
    ],
    'manifest.json (editor)'
  );
  if (!m.editor || typeof m.editor !== 'object' || Array.isArray(m.editor)) {
    throw new Error('Campo editor invalido en manifest.json (profile=editor)');
  }
  return m as unknown as GrooveEditorManifest;
}

/**
 * Strictly inspects raw ZIP headers before path normalization, validates manifest.json
 * without fallback, enforces bounded streaming decompression, and validates the timeline.
 */
export async function importGroovePackage(input: File | ArrayBuffer | Uint8Array): Promise<GrooveProjectPackage> {
  const rawBytes =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(await input.arrayBuffer());

  if (rawBytes.byteLength > MAX_PACKAGE_COMPRESSED_BYTES) {
    throw new Error('Paquete .groove demasiado grande (max 32 MiB)');
  }

  // First pass raw ZIP inspection (before normalization or decompression)
  const zip = await inspectAndOpenZip(rawBytes, {
    maxCompressedBytes: MAX_PACKAGE_COMPRESSED_BYTES,
    maxTotalUncompressedBytes: MAX_PACKAGE_DECOMPRESSED_BYTES,
    maxEntries: MAX_PACKAGE_FILES,
    allowDirectories: false,
    allowDataDescriptor: false,
    maxEntryBytesByPath: (p) => {
      if (p === 'manifest.json') return MAX_MANIFEST_BYTES;
      if (p === 'timeline.gtf' || p === 'timeline.gtl') return MAX_TIMELINE_BYTES;
      return MAX_ASSET_BYTES;
    },
  });

  if (!zip.getEntry('manifest.json')) {
    throw new Error('Falta manifest.json obligatorio en paquete .groove (sin fallback implícito)');
  }

  const manifestBytes = await zip.readBytes('manifest.json', MAX_MANIFEST_BYTES);
  const parsedManifestRaw = parseStrictJson(manifestBytes, 16);
  const manifest = validateStrictManifest(parsedManifestRaw);

  const allPaths = zip.listPaths();
  if (manifest.profile === 'runtime') {
    if (allPaths.length !== MAX_RUNTIME_FILES) {
      throw new Error(
        `Paquete runtime .groove debe contener exactamente ${MAX_RUNTIME_FILES} archivos (manifest.json y ${manifest.timeline.path}); encontrados ${allPaths.length}`
      );
    }
    const expectedSet = new Set(['manifest.json', manifest.timeline.path]);
    for (const p of allPaths) {
      if (!expectedSet.has(p)) {
        throw new Error(`Archivo inesperado en paquete runtime .groove: ${p}`);
      }
    }
  } else {
    // Editor profile only permits manifest.json, timeline.gtf, timeline.gtl, audio/*, sprites/*, intro/*
    for (const p of allPaths) {
      const ok =
        p === 'manifest.json' ||
        p === 'timeline.gtf' ||
        p === 'timeline.gtl' ||
        p.startsWith('audio/') ||
        p.startsWith('sprites/') ||
        p.startsWith('intro/');
      if (!ok) {
        throw new Error(`Ruta no permitida en paquete .groove: ${p}`);
      }
    }
  }

  const primaryPath = manifest.timeline.path;
  if (!zip.getEntry(primaryPath)) {
    throw new Error(`Falta el timeline primario declarado en manifest: ${primaryPath}`);
  }
  const tlBytes = await zip.readBytes(primaryPath, MAX_TIMELINE_BYTES);
  if (tlBytes.byteLength < 1) {
    throw new Error(`${primaryPath} esta vacio`);
  }
  const tlText = decodeUtf8Strict(tlBytes, primaryPath);
  const runtimeMode = manifest.profile === 'runtime';
  const timeline =
    manifest.timeline.format === 'gtl'
      ? parseGtl(tlText, primaryPath, { runtimeMode })
      : compileGtf(tlText, primaryPath, { runtimeMode });

  const sha256 = await sha256Hex(rawBytes);

  if (manifest.profile === 'runtime') {
    return {
      profile: 'runtime',
      runtimeFormat: manifest.timeline.format,
      packageId: manifest.id,
      packageVersion: manifest.version,
      timeline,
      bpm: 120,
      musicOffsetSec: 0,
      musicFile: null,
      prologueImage: null,
      sprites: {},
      sha256,
    };
  }

  const editorMeta = manifest.editor;
  let musicFile: GrooveProjectPackage['musicFile'] = null;
  if (editorMeta.musicFilename) {
    assertSafeArchivePath(editorMeta.musicFilename, { allowTrailingSlash: false });
    if (!editorMeta.musicFilename.startsWith('audio/')) {
      throw new Error(`Ruta de audio invalida en manifest: ${editorMeta.musicFilename}`);
    }
    const audioBytes = await zip.readBytes(editorMeta.musicFilename, MAX_ASSET_BYTES);
    const name = editorMeta.musicFilename.split('/').pop() ?? 'music.mp3';
    musicFile = { name, buffer: audioBytes.slice().buffer, mime: 'audio/*' };
  }

  let prologueImage: GrooveProjectPackage['prologueImage'] = null;
  if (editorMeta.prologueImageName) {
    assertSafeArchivePath(editorMeta.prologueImageName, { allowTrailingSlash: false });
    if (!editorMeta.prologueImageName.startsWith('intro/')) {
      throw new Error(`Ruta de intro invalida en manifest: ${editorMeta.prologueImageName}`);
    }
    const imgBytes = await zip.readBytes(editorMeta.prologueImageName, MAX_ASSET_BYTES);
    const name = editorMeta.prologueImageName.split('/').pop() ?? 'prologue.png';
    prologueImage = { name, dataUrl: uint8ArrayToDataUrl(imgBytes, name) };
  }

  const sprites: Partial<Record<GameId, CustomSpriteConfig>> = {};
  if (editorMeta.sprites && typeof editorMeta.sprites === 'object') {
    for (const [gKey, entry] of Object.entries(editorMeta.sprites)) {
      if (!entry || !(GAMES as readonly string[]).includes(gKey)) continue;
      let imageDataUrl: string | undefined;
      if (entry.file) {
        assertSafeArchivePath(entry.file, { allowTrailingSlash: false });
        if (!entry.file.startsWith('sprites/')) {
          throw new Error(`Ruta de sprite invalida en manifest: ${entry.file}`);
        }
        const imgBytes = await zip.readBytes(entry.file, MAX_ASSET_BYTES);
        imageDataUrl = uint8ArrayToDataUrl(imgBytes, entry.file);
      }
      sprites[gKey as GameId] = {
        game: gKey as GameId,
        imageDataUrl,
        imageName: entry.imageName,
        scale: typeof entry.scale === 'number' ? Math.max(0.4, Math.min(2, entry.scale)) : 1,
        offsetX: typeof entry.offsetX === 'number' ? entry.offsetX : 0,
        offsetY: typeof entry.offsetY === 'number' ? entry.offsetY : 0,
        tint: typeof entry.tint === 'string' ? entry.tint : '',
        bounceAmount: typeof entry.bounceAmount === 'number' ? Math.max(0, Math.min(2, entry.bounceAmount)) : 1,
        defaultAnim: typeof entry.defaultAnim === 'string' ? entry.defaultAnim.replace(/[^A-Za-z0-9_]/g, '').slice(0, 47) || 'Remix8' : 'Remix8',
      };
    }
  }

  return {
    profile: 'editor',
    packageId: manifest.id,
    packageVersion: manifest.version,
    timeline,
    bpm: typeof editorMeta.bpm === 'number' && editorMeta.bpm > 0 ? editorMeta.bpm : 120,
    musicOffsetSec: typeof editorMeta.musicOffsetSec === 'number' ? editorMeta.musicOffsetSec : 0,
    musicFile,
    prologueImage,
    sprites,
    sha256,
  };
}

export interface PackageRegistryEntry {
  id: string;
  version: string;
  sha256: string;
}

export type RegistryConflictCheck =
  | { status: 'ok' }
  | { status: 'identical_duplicate' }
  | { status: 'version_conflict'; reason: string }
  | { status: 'downgrade'; reason: string };

export function checkPackageRegistryConflict(
  existing: PackageRegistryEntry | undefined,
  incoming: PackageRegistryEntry
): RegistryConflictCheck {
  if (!existing) return { status: 'ok' };
  const cmp = compareSemver(incoming.version, existing.version);
  if (cmp === 0) {
    if (incoming.sha256 === existing.sha256) return { status: 'identical_duplicate' };
    return {
      status: 'version_conflict',
      reason: `Conflicto de paquete: ${incoming.id} v${incoming.version} ya existe con distinto SHA-256`,
    };
  }
  if (cmp < 0) {
    return {
      status: 'downgrade',
      reason: `Downgrade rechazado: ${incoming.id} v${incoming.version} < v${existing.version} instalada`,
    };
  }
  return { status: 'ok' };
}
