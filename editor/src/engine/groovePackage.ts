import JSZip from 'jszip';
import { GameId } from './cues.ts';
import { compileGtf, decompileToGtf, emitGtl, parseGtl, Timeline } from './gtfEngine.ts';

// Limits aligned with docs/GROOVE_SPEC.md (draft 0.1)
export const MAX_PACKAGE_COMPRESSED_BYTES = 32 * 1024 * 1024; // 32 MiB
export const MAX_PACKAGE_DECOMPRESSED_BYTES = 64 * 1024 * 1024; // 64 MiB
export const MAX_PACKAGE_FILES = 256;
export const MAX_MANIFEST_BYTES = 16 * 1024; // 16 KiB
export const MAX_TIMELINE_BYTES = 60 * 1024; // 60 KiB

export interface CustomSpriteConfig {
  game: GameId;
  imageDataUrl?: string;
  imageName?: string;
  scale: number; // 0.5 .. 2.0
  offsetX: number; // -100 .. 100
  offsetY: number; // -100 .. 100
  tint: string; // hex color or ''
  bounceAmount: number; // 0 .. 2
  defaultAnim: string;
}

export interface GroovePackageManifest {
  format: 'groove-package/1';
  id: string;
  version: string;
  title: string;
  engine_min: '0.6.0';
  adapter: 'multi' | 'hoop';
  timeline: {
    format: 'gtf' | 'gtl';
    path: string;
  };
  required_capabilities: string[];
  results: 'custom';
  editor?: {
    createdAt: string;
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

export interface GrooveProjectPackage {
  packageId?: string;
  packageVersion?: string;
  timeline: Timeline;
  bpm: number;
  musicOffsetSec: number;
  musicFile?: { name: string; buffer: ArrayBuffer; mime: string } | null;
  prologueImage?: { name: string; dataUrl: string } | null;
  sprites: Partial<Record<GameId, CustomSpriteConfig>>;
}

export function sanitizePackageId(rawTitle: string): string {
  const slug = rawTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `org.groovebuilder.${slug || 'remix21'}`;
}

export function isValidPackageId(id: string): boolean {
  return (
    id.length >= 3 &&
    id.length <= 96 &&
    /^[a-z0-9._-]+$/.test(id) &&
    !id.includes('..') &&
    !id.startsWith('.') &&
    !id.endsWith('.')
  );
}

export function isValidSemver(ver: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(ver);
}

function assertSafeArchivePath(p: string): void {
  if (!p || p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p)) {
    throw new Error(`Ruta absoluta prohibida en paquete .groove: ${p}`);
  }
  const parts = p.split(/[\\/]/);
  if (parts.some((seg) => seg === '..' || seg === '')) {
    if (!(p.endsWith('/') && parts[parts.length - 1] === '')) {
      throw new Error(`Ruta invalida en paquete .groove: ${p}`);
    }
  }
}

function dataUrlToUint8Array(dataUrl: string): { bytes: Uint8Array; ext: string } {
  const [header, b64] = dataUrl.split(',', 2);
  const mimeMatch = header.match(/data:image\/([a-zA-Z0-9+]+);/);
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
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function exportGroovePackage(pkg: GrooveProjectPackage): Promise<Blob> {
  const zip = new JSZip();
  const gtfText = decompileToGtf(pkg.timeline, pkg.timeline.title || 'Groove Builder');
  const gtlText = emitGtl(pkg.timeline, pkg.timeline.title || 'Groove Builder');

  if (new TextEncoder().encode(gtfText).length > MAX_TIMELINE_BYTES) {
    throw new Error(`timeline.gtf excede el limite de ${MAX_TIMELINE_BYTES} bytes`);
  }

  zip.file('timeline.gtf', gtfText);
  zip.file('timeline.gtl', gtlText);

  const spriteManifest: NonNullable<GroovePackageManifest['editor']>['sprites'] = {};
  for (const [gameKey, cfg] of Object.entries(pkg.sprites) as Array<[GameId, CustomSpriteConfig]>) {
    if (!cfg) continue;
    let spritePath: string | undefined;
    if (cfg.imageDataUrl) {
      const { bytes, ext } = dataUrlToUint8Array(cfg.imageDataUrl);
      spritePath = `sprites/${gameKey}.${ext}`;
      zip.file(spritePath, bytes);
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
    zip.file(prologueImagePath, bytes);
  }

  let musicPath: string | undefined;
  if (pkg.musicFile) {
    const safeName = pkg.musicFile.name.replace(/[^A-Za-z0-9._-]/g, '_');
    musicPath = `audio/${safeName}`;
    zip.file(musicPath, pkg.musicFile.buffer);
  }

  const pkgId = pkg.packageId && isValidPackageId(pkg.packageId)
    ? pkg.packageId
    : sanitizePackageId(pkg.timeline.title || 'remix21');
  const pkgVer = pkg.packageVersion && isValidSemver(pkg.packageVersion) ? pkg.packageVersion : '1.0.0';

  const manifest: GroovePackageManifest = {
    format: 'groove-package/1',
    id: pkgId,
    version: pkgVer,
    title: pkg.timeline.title || 'Remix 21',
    engine_min: '0.6.0',
    adapter: 'multi',
    timeline: { format: 'gtf', path: 'timeline.gtf' },
    required_capabilities: ['timeline.gtf'],
    results: 'custom',
    editor: {
      createdAt: new Date().toISOString(),
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

  const manifestJson = JSON.stringify(manifest, null, 2);
  if (new TextEncoder().encode(manifestJson).length > MAX_MANIFEST_BYTES) {
    throw new Error(`manifest.json excede el limite de ${MAX_MANIFEST_BYTES} bytes`);
  }
  zip.file('manifest.json', manifestJson);

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  if (blob.size > MAX_PACKAGE_COMPRESSED_BYTES) {
    throw new Error(`El paquete comprimido supera los 32 MiB permitidos (${(blob.size / (1024 * 1024)).toFixed(1)} MiB)`);
  }
  return blob;
}

export async function importGroovePackage(input: File | ArrayBuffer): Promise<GrooveProjectPackage> {
  const buf = input instanceof File ? await input.arrayBuffer() : input;
  if (buf.byteLength > MAX_PACKAGE_COMPRESSED_BYTES) {
    throw new Error('Paquete .groove demasiado grande (max 32 MiB)');
  }

  const zip = await JSZip.loadAsync(buf);
  const paths = Object.keys(zip.files);
  if (paths.length > MAX_PACKAGE_FILES) {
    throw new Error(`Paquete .groove excede el limite de ${MAX_PACKAGE_FILES} archivos`);
  }

  const seenLower = new Set<string>();
  let totalUncompressed = 0;
  for (const p of paths) {
    assertSafeArchivePath(p);
    const low = p.toLowerCase();
    if (seenLower.has(low)) {
      throw new Error(`Rutas duplicadas o colision de mayusculas: ${p}`);
    }
    seenLower.add(low);
    const entry = zip.files[p];
    if (!entry.dir) {
      const data = await entry.async('uint8array');
      totalUncompressed += data.byteLength;
      if (totalUncompressed > MAX_PACKAGE_DECOMPRESSED_BYTES) {
        throw new Error('Contenido descomprimido supera el limite de 64 MiB');
      }
    }
  }

  const manifestEntry = zip.file('manifest.json');
  let manifest: GroovePackageManifest | null = null;
  if (manifestEntry) {
    const manifestBytes = await manifestEntry.async('uint8array');
    if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
      throw new Error('manifest.json supera el limite de 16 KiB');
    }
    const parsed = JSON.parse(new TextDecoder().decode(manifestBytes));
    if (parsed.format && parsed.format !== 'groove-package/1' && parsed.format !== 'groove-package') {
      throw new Error(`Formato no soportado: ${parsed.format}`);
    }
    if (parsed.id && !isValidPackageId(parsed.id)) {
      throw new Error(`ID de paquete invalido: ${parsed.id}`);
    }
    if (parsed.version && !isValidSemver(parsed.version)) {
      throw new Error(`Version semver invalida: ${parsed.version}`);
    }
    manifest = parsed;
  }

  const timelinePath = manifest?.timeline?.path ?? 'timeline.gtf';
  assertSafeArchivePath(timelinePath);
  const primaryEntry = zip.file(timelinePath) ?? zip.file('timeline.gtf');
  const gtlEntry = zip.file('timeline.gtl');

  let timeline: Timeline;
  if (primaryEntry) {
    const bytes = await primaryEntry.async('uint8array');
    if (bytes.byteLength > MAX_TIMELINE_BYTES) {
      throw new Error('timeline supera el limite de 60 KiB');
    }
    const text = new TextDecoder().decode(bytes);
    timeline = timelinePath.endsWith('.gtl')
      ? parseGtl(text, timelinePath)
      : compileGtf(text, timelinePath);
  } else if (gtlEntry) {
    const bytes = await gtlEntry.async('uint8array');
    if (bytes.byteLength > MAX_TIMELINE_BYTES) {
      throw new Error('timeline.gtl supera el limite de 60 KiB');
    }
    timeline = parseGtl(new TextDecoder().decode(bytes), 'timeline.gtl');
  } else {
    throw new Error('El paquete .groove no contiene timeline.gtf ni timeline.gtl');
  }

  const editorMeta = manifest?.editor ?? (manifest as unknown as GroovePackageManifest['editor']);
  let musicFile: GrooveProjectPackage['musicFile'] = null;
  if (editorMeta?.musicFilename && zip.file(editorMeta.musicFilename)) {
    const entry = zip.file(editorMeta.musicFilename)!;
    const arr = await entry.async('arraybuffer');
    const name = editorMeta.musicFilename.split('/').pop() ?? 'music.mp3';
    musicFile = { name, buffer: arr, mime: 'audio/*' };
  }

  let prologueImage: GrooveProjectPackage['prologueImage'] = null;
  if (editorMeta?.prologueImageName && zip.file(editorMeta.prologueImageName)) {
    const bytes = await zip.file(editorMeta.prologueImageName)!.async('uint8array');
    const name = editorMeta.prologueImageName.split('/').pop() ?? 'prologue.png';
    prologueImage = { name, dataUrl: uint8ArrayToDataUrl(bytes, name) };
  }

  const sprites: Partial<Record<GameId, CustomSpriteConfig>> = {};
  if (editorMeta?.sprites) {
    for (const [gKey, entry] of Object.entries(editorMeta.sprites)) {
      if (!entry) continue;
      let imageDataUrl: string | undefined;
      if (entry.file && zip.file(entry.file)) {
        const bytes = await zip.file(entry.file)!.async('uint8array');
        imageDataUrl = uint8ArrayToDataUrl(bytes, entry.file);
      }
      sprites[gKey as GameId] = {
        game: gKey as GameId,
        imageDataUrl,
        imageName: entry.imageName,
        scale: entry.scale ?? 1,
        offsetX: entry.offsetX ?? 0,
        offsetY: entry.offsetY ?? 0,
        tint: entry.tint ?? '',
        bounceAmount: entry.bounceAmount ?? 1,
        defaultAnim: entry.defaultAnim ?? 'Remix8',
      };
    }
  }

  return {
    packageId: manifest?.id,
    packageVersion: manifest?.version,
    timeline,
    bpm: editorMeta?.bpm ?? 120,
    musicOffsetSec: editorMeta?.musicOffsetSec ?? 0,
    musicFile,
    prologueImage,
    sprites,
  };
}
