/**
 * Clean-room binary readers & decoders for Nintendo Switch NintendoWare formats:
 * - BNTX (Binary NX Texture + Tegra X1 Block-Linear GOB deswizzle + RGBA8/BGRA8/R8/RG8/BC1-BC5)
 * - BFLYT (Binary caFe LaYouT: lyt1, txl1, mat1, pan1, pic1, txt1, wnd1, bnd1, usd1, pas1/pae1 hierarchy)
 * - BFLAN (Binary caFe Layout ANimation: pat1, pai1, FLPA/FLVI/FLMC/FLTP step/linear/Hermite curves)
 * - BFRES (NintendoWare 3D: FMDL, FSKL, FMAT, FVTX, FSHP bounded mesh/skeleton/material extraction)
 *
 * Strictly read-only, bounds-checked against integer overflows & memory bombs, and never
 * fabricates pixels/animations for unsupported compressed subformats (e.g. ASTC/BC7).
 */

export const MAX_SWITCH_TEX_DIM = 4096;
export const MAX_SWITCH_TEX_PIXELS = MAX_SWITCH_TEX_DIM * MAX_SWITCH_TEX_DIM;
export const MAX_SWITCH_TEXTURES_PER_BNTX = 64;
export const MAX_BFLYT_PANES = 512;
export const MAX_BFLAN_CURVES = 1024;
export const MAX_BFRES_VERTICES = 65535;
export const MAX_BFRES_INDICES = 196605;

export interface DecodedBntxTexture {
  name: string;
  width: number;
  height: number;
  mipCount: number;
  formatCode: number;
  formatName: string;
  tileMode: number;
  blockHeightLog2: number;
  decoded: boolean;
  unsupportedReason?: string;
  rgba?: Uint8ClampedArray;
  pngDataUrl?: string;
}

export interface BntxArchiveData {
  filename: string;
  target: string;
  textures: DecodedBntxTexture[];
}

export interface BflytPane {
  kind: 'pan1' | 'pic1' | 'txt1' | 'wnd1' | 'bnd1';
  name: string;
  userDataName: string;
  parentName: string | null;
  visible: boolean;
  influenceAlpha: boolean;
  alpha: number;
  originX: number; // 0=left, 1=center, 2=right
  originY: number; // 0=top, 1=center, 2=bottom
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  w: number;
  h: number;
  materialIndex?: number;
  vertexColors?: [
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number]
  ];
  uvQuad?: [[number, number], [number, number], [number, number], [number, number]];
}

export interface BflytMaterial {
  name: string;
  textureIndex: number | null;
  blackColor: [number, number, number, number];
  whiteColor: [number, number, number, number];
}

export interface BflytLayoutData {
  filename: string;
  width: number;
  height: number;
  originType: number;
  textures: string[];
  materials: BflytMaterial[];
  panes: BflytPane[];
  userDataKeys: string[];
}

export interface BflanKeyframe {
  frame: number;
  value: number;
  inSlope?: number;
  outSlope?: number;
}

export interface BflanCurve {
  tag: string; // e.g. 'FLPA', 'FLVI', 'FLMC', 'FLTP'
  targetType: number;
  interp: 'const' | 'step' | 'linear' | 'hermite';
  keys: BflanKeyframe[];
}

export interface BflanEntry {
  targetName: string;
  isMaterial: boolean;
  curves: BflanCurve[];
}

export interface BflanAnimationData {
  filename: string;
  name: string;
  frameSize: number;
  loop: boolean;
  startFrame: number;
  endFrame: number;
  textures: string[];
  entries: BflanEntry[];
}

export interface BfresBone {
  name: string;
  parentIndex: number;
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
}

export interface BfresSubMesh {
  name: string;
  materialName: string;
  textureNames: string[];
  positions: number[]; // flat [x, y, z, ...]
  normals: number[];   // flat [nx, ny, nz, ...]
  uvs: number[];       // flat [u, v, ...]
  indices: number[];   // triangle indices
}

export interface BfresModelSummary {
  name: string;
  bones: BfresBone[];
  materials: Array<{ name: string; textureNames: string[] }>;
  meshes: BfresSubMesh[];
}

export interface BfresModelData {
  filename: string;
  name: string;
  models: BfresModelSummary[];
  warnings: string[];
}

// ---------- Binary Reader Utilities ----------

class BinReader {
  private readonly dv: DataView;
  constructor(
    public readonly bytes: Uint8Array,
    public readonly littleEndian = true
  ) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.bytes.length;
  }

  check(off: number, size: number): boolean {
    return Number.isInteger(off) && off >= 0 && size >= 0 && off + size <= this.bytes.length;
  }

  u8(off: number): number {
    if (!this.check(off, 1)) throw new Error(`Out-of-bounds u8 read at 0x${off.toString(16)}`);
    return this.bytes[off];
  }

  i8(off: number): number {
    if (!this.check(off, 1)) throw new Error(`Out-of-bounds i8 read at 0x${off.toString(16)}`);
    return this.dv.getInt8(off);
  }

  u16(off: number): number {
    if (!this.check(off, 2)) throw new Error(`Out-of-bounds u16 read at 0x${off.toString(16)}`);
    return this.dv.getUint16(off, this.littleEndian);
  }

  i16(off: number): number {
    if (!this.check(off, 2)) throw new Error(`Out-of-bounds i16 read at 0x${off.toString(16)}`);
    return this.dv.getInt16(off, this.littleEndian);
  }

  u32(off: number): number {
    if (!this.check(off, 4)) throw new Error(`Out-of-bounds u32 read at 0x${off.toString(16)}`);
    return this.dv.getUint32(off, this.littleEndian);
  }

  i32(off: number): number {
    if (!this.check(off, 4)) throw new Error(`Out-of-bounds i32 read at 0x${off.toString(16)}`);
    return this.dv.getInt32(off, this.littleEndian);
  }

  u64Num(off: number): number {
    if (!this.check(off, 8)) throw new Error(`Out-of-bounds u64 read at 0x${off.toString(16)}`);
    const lo = this.dv.getUint32(off + (this.littleEndian ? 0 : 4), this.littleEndian);
    const hi = this.dv.getUint32(off + (this.littleEndian ? 4 : 0), this.littleEndian);
    return hi * 4294967296 + lo;
  }

  f32(off: number): number {
    if (!this.check(off, 4)) throw new Error(`Out-of-bounds f32 read at 0x${off.toString(16)}`);
    return this.dv.getFloat32(off, this.littleEndian);
  }

  ascii(off: number, len: number): string {
    if (!this.check(off, len)) return '';
    let s = '';
    for (let i = 0; i < len; i++) {
      s += String.fromCharCode(this.bytes[off + i]);
    }
    return s;
  }

  cstr(off: number, maxLen = 256): string {
    if (off < 0 || off >= this.bytes.length) return '';
    const end = Math.min(this.bytes.length, off + maxLen);
    const slice: number[] = [];
    for (let i = off; i < end; i++) {
      const b = this.bytes[i];
      if (b === 0) break;
      slice.push(b);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(slice));
  }

  lenPrefixedStr(off: number): string {
    if (!this.check(off, 2)) return '';
    const len = this.u16(off);
    if (len === 0 || len > 512 || !this.check(off + 2, len)) return '';
    return new TextDecoder('utf-8', { fatal: false }).decode(
      this.bytes.subarray(off + 2, off + 2 + len)
    );
  }
}

// ---------- Pure-JS Uncompressed PNG Encoder (Works identically in Browser & Node) ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;
  for (let i = 0; i < bytes.length; i++) {
    s1 = (s1 + bytes[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  return ((s2 << 16) | s1) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  dv.setUint32(8 + data.length, crc, false);
  return chunk;
}

export function encodeRgbaToPngBytes(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_SWITCH_TEX_DIM ||
    height > MAX_SWITCH_TEX_DIM ||
    width * height > MAX_SWITCH_TEX_PIXELS
  ) {
    throw new Error(`Invalid PNG dimensions ${width}x${height}`);
  }
  const stride = width * 4;
  const rawLen = height * (1 + stride);
  const raw = new Uint8Array(rawLen);
  for (let y = 0; y < height; y++) {
    const rowOut = y * (1 + stride);
    raw[rowOut] = 0; // filter None
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), rowOut + 1);
  }

  // Zlib stream using uncompressed DEFLATE stored blocks (max 65535 B per block)
  const blockCount = Math.max(1, Math.ceil(raw.length / 65535));
  const zlibOut = new Uint8Array(2 + raw.length + blockCount * 5 + 4);
  zlibOut[0] = 0x78;
  zlibOut[1] = 0x01;
  let zp = 2;
  let rp = 0;
  for (let b = 0; b < blockCount; b++) {
    const take = Math.min(65535, raw.length - rp);
    const isLast = b === blockCount - 1 ? 1 : 0;
    zlibOut[zp++] = isLast;
    zlibOut[zp++] = take & 0xff;
    zlibOut[zp++] = (take >>> 8) & 0xff;
    const nlen = ~take & 0xffff;
    zlibOut[zp++] = nlen & 0xff;
    zlibOut[zp++] = (nlen >>> 8) & 0xff;
    zlibOut.set(raw.subarray(rp, rp + take), zp);
    zp += take;
    rp += take;
  }
  const adler = adler32(raw);
  zlibOut[zp++] = (adler >>> 24) & 0xff;
  zlibOut[zp++] = (adler >>> 16) & 0xff;
  zlibOut[zp++] = (adler >>> 8) & 0xff;
  zlibOut[zp++] = adler & 0xff;

  const ihdr = new Uint8Array(13);
  const ihdrDv = new DataView(ihdr.buffer);
  ihdrDv.setUint32(0, width, false);
  ihdrDv.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const cIhdr = makePngChunk('IHDR', ihdr);
  const cIdat = makePngChunk('IDAT', zlibOut.subarray(0, zp));
  const cIend = makePngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(sig.length + cIhdr.length + cIdat.length + cIend.length);
  let pos = 0;
  out.set(sig, pos);
  pos += sig.length;
  out.set(cIhdr, pos);
  pos += cIhdr.length;
  out.set(cIdat, pos);
  pos += cIdat.length;
  out.set(cIend, pos);
  return out;
}

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function encodeRgbaToPngDataUrl(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): string {
  const png = encodeRgbaToPngBytes(rgba, width, height);
  return `data:image/png;base64,${uint8ToBase64(png)}`;
}

// ---------- Tegra X1 Block-Linear Deswizzling + BNTX Decoder ----------

interface SurfaceFormatMeta {
  name: string;
  bpp: number; // bytes per pixel (uncompressed) or bytes per block (compressed)
  blkW: number;
  blkH: number;
  family:
    | 'rgba8'
    | 'bgra8'
    | 'r8'
    | 'rg8'
    | 'bc1'
    | 'bc2'
    | 'bc3'
    | 'bc4'
    | 'bc5'
    | 'unsupported';
}

const BNTX_FORMAT_TABLE: Record<number, SurfaceFormatMeta> = {
  0x0201: { name: 'R8_UNORM', bpp: 1, blkW: 1, blkH: 1, family: 'r8' },
  0x0901: { name: 'R8G8_UNORM', bpp: 2, blkW: 1, blkH: 1, family: 'rg8' },
  0x0b01: { name: 'R8G8B8A8_UNORM', bpp: 4, blkW: 1, blkH: 1, family: 'rgba8' },
  0x0b06: { name: 'R8G8B8A8_SRGB', bpp: 4, blkW: 1, blkH: 1, family: 'rgba8' },
  0x0c01: { name: 'B8G8R8A8_UNORM', bpp: 4, blkW: 1, blkH: 1, family: 'bgra8' },
  0x0c06: { name: 'B8G8R8A8_SRGB', bpp: 4, blkW: 1, blkH: 1, family: 'bgra8' },
  0x1a01: { name: 'BC1_UNORM', bpp: 8, blkW: 4, blkH: 4, family: 'bc1' },
  0x1a06: { name: 'BC1_SRGB', bpp: 8, blkW: 4, blkH: 4, family: 'bc1' },
  0x1b01: { name: 'BC2_UNORM', bpp: 16, blkW: 4, blkH: 4, family: 'bc2' },
  0x1b06: { name: 'BC2_SRGB', bpp: 16, blkW: 4, blkH: 4, family: 'bc2' },
  0x1c01: { name: 'BC3_UNORM', bpp: 16, blkW: 4, blkH: 4, family: 'bc3' },
  0x1c06: { name: 'BC3_SRGB', bpp: 16, blkW: 4, blkH: 4, family: 'bc3' },
  0x1d01: { name: 'BC4_UNORM', bpp: 8, blkW: 4, blkH: 4, family: 'bc4' },
  0x1d02: { name: 'BC4_SNORM', bpp: 8, blkW: 4, blkH: 4, family: 'bc4' },
  0x1e01: { name: 'BC5_UNORM', bpp: 16, blkW: 4, blkH: 4, family: 'bc5' },
  0x1e02: { name: 'BC5_SNORM', bpp: 16, blkW: 4, blkH: 4, family: 'bc5' },
  0x2001: { name: 'BC7_UNORM', bpp: 16, blkW: 4, blkH: 4, family: 'unsupported' },
  0x2006: { name: 'BC7_SRGB', bpp: 16, blkW: 4, blkH: 4, family: 'unsupported' },
  0x2d01: { name: 'ASTC_4x4_UNORM', bpp: 16, blkW: 4, blkH: 4, family: 'unsupported' },
  0x2d06: { name: 'ASTC_4x4_SRGB', bpp: 16, blkW: 4, blkH: 4, family: 'unsupported' },
  0x2e01: { name: 'ASTC_5x4_UNORM', bpp: 16, blkW: 5, blkH: 4, family: 'unsupported' },
  0x2e06: { name: 'ASTC_5x4_SRGB', bpp: 16, blkW: 5, blkH: 4, family: 'unsupported' },
  0x2f01: { name: 'ASTC_5x5_UNORM', bpp: 16, blkW: 5, blkH: 5, family: 'unsupported' },
  0x2f06: { name: 'ASTC_5x5_SRGB', bpp: 16, blkW: 5, blkH: 5, family: 'unsupported' },
  0x3001: { name: 'ASTC_6x5_UNORM', bpp: 16, blkW: 6, blkH: 5, family: 'unsupported' },
  0x3006: { name: 'ASTC_6x5_SRGB', bpp: 16, blkW: 6, blkH: 5, family: 'unsupported' },
  0x3101: { name: 'ASTC_6x6_UNORM', bpp: 16, blkW: 6, blkH: 6, family: 'unsupported' },
  0x3106: { name: 'ASTC_6x6_SRGB', bpp: 16, blkW: 6, blkH: 6, family: 'unsupported' },
  0x3201: { name: 'ASTC_8x5_UNORM', bpp: 16, blkW: 8, blkH: 5, family: 'unsupported' },
  0x3206: { name: 'ASTC_8x5_SRGB', bpp: 16, blkW: 8, blkH: 5, family: 'unsupported' },
  0x3301: { name: 'ASTC_8x6_UNORM', bpp: 16, blkW: 8, blkH: 6, family: 'unsupported' },
  0x3306: { name: 'ASTC_8x6_SRGB', bpp: 16, blkW: 8, blkH: 6, family: 'unsupported' },
  0x3401: { name: 'ASTC_8x8_UNORM', bpp: 16, blkW: 8, blkH: 8, family: 'unsupported' },
  0x3406: { name: 'ASTC_8x8_SRGB', bpp: 16, blkW: 8, blkH: 8, family: 'unsupported' },
};

function divRoundUp(n: number, d: number): number {
  return Math.floor((n + d - 1) / d);
}

/**
 * Exact Tegra X1 Block-Linear GOB (64B × 8 rows) swizzle address mapping.
 * Used both by our BNTX decoder and unit round-trip tests.
 */
export function getAddrTegraBlockLinear(
  xBytes: number,
  yRows: number,
  widthInGobs: number,
  blockHeight: number
): number {
  const gobWidthBytes = 64;
  const gobHeightRows = 8;
  const gobSizeBytes = gobWidthBytes * gobHeightRows; // 512

  const imageWidthInBytes = widthInGobs * gobWidthBytes;
  const x = xBytes % imageWidthInBytes;

  const gobX = Math.floor(x / gobWidthBytes);
  const gobY = Math.floor(yRows / (gobHeightRows * blockHeight));
  const yInBlock = Math.floor((yRows % (gobHeightRows * blockHeight)) / gobHeightRows);
  const yInGob = yRows % gobHeightRows;
  const xInGob = x % gobWidthBytes;

  const blockAddr = (gobY * widthInGobs + gobX) * blockHeight * gobSizeBytes + yInBlock * gobSizeBytes;
  // Standard Tegra X1 GOB intra-offset bit layout
  const intraGob =
    ((xInGob & 0x20) << 3) |
    ((yInGob & 0x06) << 6) |
    ((xInGob & 0x10) << 2) |
    ((yInGob & 0x01) << 4) |
    (xInGob & 0x0f);

  return blockAddr + intraGob;
}

export function deswizzleTegraBlockLinear(params: {
  width: number;
  height: number;
  blkW: number;
  blkH: number;
  bpp: number;
  tileMode: number;
  blockHeightLog2: number;
  src: Uint8Array;
}): Uint8Array {
  const { width, height, blkW, blkH, bpp, tileMode, blockHeightLog2, src } = params;
  const bw = Math.max(1, divRoundUp(width, blkW));
  const bh = Math.max(1, divRoundUp(height, blkH));
  const rowBytes = bw * bpp;
  const linear = new Uint8Array(bh * rowBytes);

  if (tileMode === 1) {
    // Pitch-linear layout
    const pitch = divRoundUp(rowBytes, 32) * 32;
    for (let y = 0; y < bh; y++) {
      const srcOff = y * pitch;
      if (srcOff >= src.length) break;
      const copyLen = Math.min(rowBytes, src.length - srcOff);
      linear.set(src.subarray(srcOff, srcOff + copyLen), y * rowBytes);
    }
    return linear;
  }

  const blockHeight = 1 << Math.max(0, Math.min(4, blockHeightLog2));
  const widthInGobs = Math.max(1, divRoundUp(rowBytes, 64));

  for (let y = 0; y < bh; y++) {
    for (let xb = 0; xb < bw; xb++) {
      const xByte = xb * bpp;
      const swizOff = getAddrTegraBlockLinear(xByte, y, widthInGobs, blockHeight);
      if (swizOff + bpp <= src.length) {
        const dstOff = y * rowBytes + xByte;
        for (let i = 0; i < bpp; i++) {
          linear[dstOff + i] = src[swizOff + i];
        }
      }
    }
  }
  return linear;
}

export function swizzleTegraBlockLinear(params: {
  width: number;
  height: number;
  blkW: number;
  blkH: number;
  bpp: number;
  blockHeightLog2: number;
  linear: Uint8Array;
}): Uint8Array {
  const { width, height, blkW, blkH, bpp, blockHeightLog2, linear } = params;
  const bw = Math.max(1, divRoundUp(width, blkW));
  const bh = Math.max(1, divRoundUp(height, blkH));
  const rowBytes = bw * bpp;
  const blockHeight = 1 << Math.max(0, Math.min(4, blockHeightLog2));
  const widthInGobs = Math.max(1, divRoundUp(rowBytes, 64));
  const bhAligned = Math.max(1, divRoundUp(bh, 8 * blockHeight)) * (8 * blockHeight);
  const out = new Uint8Array(widthInGobs * 64 * bhAligned);

  for (let y = 0; y < bh; y++) {
    for (let xb = 0; xb < bw; xb++) {
      const xByte = xb * bpp;
      const swizOff = getAddrTegraBlockLinear(xByte, y, widthInGobs, blockHeight);
      const srcOff = y * rowBytes + xByte;
      if (swizOff + bpp <= out.length && srcOff + bpp <= linear.length) {
        for (let i = 0; i < bpp; i++) {
          out[swizOff + i] = linear[srcOff + i];
        }
      }
    }
  }
  return out;
}

function rgb565(c: number): [number, number, number] {
  const r = ((c >> 11) & 0x1f) * 255 / 31;
  const g = ((c >> 5) & 0x3f) * 255 / 63;
  const b = (c & 0x1f) * 255 / 31;
  return [Math.round(r), Math.round(g), Math.round(b)];
}

function decodeBc1Block(src: Uint8Array, off: number, hasAlpha: boolean): Uint8Array {
  const out = new Uint8Array(16 * 4);
  const c0 = src[off] | (src[off + 1] << 8);
  const c1 = src[off + 2] | (src[off + 3] << 8);
  const [r0, g0, b0] = rgb565(c0);
  const [r1, g1, b1] = rgb565(c1);
  const pal: Array<[number, number, number, number]> = [
    [r0, g0, b0, 255],
    [r1, g1, b1, 255],
    c0 > c1 || !hasAlpha
      ? [Math.round((2 * r0 + r1) / 3), Math.round((2 * g0 + g1) / 3), Math.round((2 * b0 + b1) / 3), 255]
      : [Math.round((r0 + r1) / 2), Math.round((g0 + g1) / 2), Math.round((b0 + b1) / 2), 255],
    c0 > c1 || !hasAlpha
      ? [Math.round((r0 + 2 * r1) / 3), Math.round((g0 + 2 * g1) / 3), Math.round((b0 + 2 * b1) / 3), 255]
      : [0, 0, 0, 0],
  ];
  const bits =
    src[off + 4] | (src[off + 5] << 8) | (src[off + 6] << 16) | (src[off + 7] << 24);
  for (let i = 0; i < 16; i++) {
    const idx = (bits >>> (i * 2)) & 0x3;
    const p = pal[idx];
    out[i * 4] = p[0];
    out[i * 4 + 1] = p[1];
    out[i * 4 + 2] = p[2];
    out[i * 4 + 3] = p[3];
  }
  return out;
}

function decodeInterpolatedAlphaBlock(src: Uint8Array, off: number): Uint8Array {
  const alphas = new Uint8Array(16);
  const a0 = src[off];
  const a1 = src[off + 1];
  const table = new Uint8Array(8);
  table[0] = a0;
  table[1] = a1;
  if (a0 > a1) {
    for (let i = 1; i <= 6; i++) {
      table[1 + i] = Math.round(((7 - i) * a0 + i * a1) / 7);
    }
  } else {
    for (let i = 1; i <= 4; i++) {
      table[1 + i] = Math.round(((5 - i) * a0 + i * a1) / 5);
    }
    table[6] = 0;
    table[7] = 255;
  }
  // 48 bits across src[off+2..off+7]
  let lo = src[off + 2] | (src[off + 3] << 8) | (src[off + 4] << 16);
  let hi = src[off + 5] | (src[off + 6] << 8) | (src[off + 7] << 16);
  for (let i = 0; i < 8; i++) {
    alphas[i] = table[(lo >>> (i * 3)) & 0x7];
    alphas[8 + i] = table[(hi >>> (i * 3)) & 0x7];
  }
  return alphas;
}

function applyComponentSelector(
  rgba: Uint8ClampedArray,
  compSel: number
): void {
  // compSel packed 4 channels: 0=0, 1=1, 2=R, 3=G, 4=B, 5=A
  const s = [
    compSel & 0xff,
    (compSel >>> 8) & 0xff,
    (compSel >>> 16) & 0xff,
    (compSel >>> 24) & 0xff,
  ];
  // Default Switch RGBA mapping is [2, 3, 4, 5] (0x05040302)
  if (s[0] === 2 && s[1] === 3 && s[2] === 4 && s[3] === 5) return;
  if (s.every((v) => v === 0)) return; // uninitialized selector -> keep decoded channels
  const pick = (sel: number, r: number, g: number, b: number, a: number): number => {
    switch (sel) {
      case 0: return 0;
      case 1: return 255;
      case 2: return r;
      case 3: return g;
      case 4: return b;
      case 5: return a;
      default: return a;
    }
  };
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const a = rgba[i + 3];
    rgba[i] = pick(s[0], r, g, b, a);
    rgba[i + 1] = pick(s[1], r, g, b, a);
    rgba[i + 2] = pick(s[2], r, g, b, a);
    rgba[i + 3] = pick(s[3], r, g, b, a);
  }
}

function decodeLinearPixelsToRgba(
  linear: Uint8Array,
  width: number,
  height: number,
  meta: SurfaceFormatMeta,
  compSel: number
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (meta.family === 'rgba8' || meta.family === 'bgra8' || meta.family === 'r8' || meta.family === 'rg8') {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const s = (y * width + x) * meta.bpp;
        const d = (y * width + x) * 4;
        if (s + meta.bpp > linear.length) continue;
        if (meta.family === 'rgba8') {
          rgba[d] = linear[s];
          rgba[d + 1] = linear[s + 1];
          rgba[d + 2] = linear[s + 2];
          rgba[d + 3] = linear[s + 3];
        } else if (meta.family === 'bgra8') {
          rgba[d] = linear[s + 2];
          rgba[d + 1] = linear[s + 1];
          rgba[d + 2] = linear[s];
          rgba[d + 3] = linear[s + 3];
        } else if (meta.family === 'r8') {
          rgba[d] = linear[s];
          rgba[d + 1] = linear[s];
          rgba[d + 2] = linear[s];
          rgba[d + 3] = 255;
        } else {
          rgba[d] = linear[s];
          rgba[d + 1] = linear[s + 1];
          rgba[d + 2] = 0;
          rgba[d + 3] = 255;
        }
      }
    }
    applyComponentSelector(rgba, compSel);
    return rgba;
  }

  const bw = Math.max(1, divRoundUp(width, 4));
  const bh = Math.max(1, divRoundUp(height, 4));
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const bOff = (by * bw + bx) * meta.bpp;
      if (bOff + meta.bpp > linear.length) continue;
      let blockRgba: Uint8Array;
      if (meta.family === 'bc1') {
        blockRgba = decodeBc1Block(linear, bOff, true);
      } else if (meta.family === 'bc2') {
        blockRgba = decodeBc1Block(linear, bOff + 8, false);
        for (let py = 0; py < 4; py++) {
          const rowByte = linear[bOff + py * 2] | (linear[bOff + py * 2 + 1] << 8);
          for (let px = 0; px < 4; px++) {
            const nib = (rowByte >>> (px * 4)) & 0xf;
            blockRgba[(py * 4 + px) * 4 + 3] = nib * 17;
          }
        }
      } else if (meta.family === 'bc3') {
        const alphas = decodeInterpolatedAlphaBlock(linear, bOff);
        blockRgba = decodeBc1Block(linear, bOff + 8, false);
        for (let i = 0; i < 16; i++) blockRgba[i * 4 + 3] = alphas[i];
      } else if (meta.family === 'bc4') {
        const reds = decodeInterpolatedAlphaBlock(linear, bOff);
        blockRgba = new Uint8Array(16 * 4);
        for (let i = 0; i < 16; i++) {
          blockRgba[i * 4] = reds[i];
          blockRgba[i * 4 + 1] = reds[i];
          blockRgba[i * 4 + 2] = reds[i];
          blockRgba[i * 4 + 3] = 255;
        }
      } else if (meta.family === 'bc5') {
        const reds = decodeInterpolatedAlphaBlock(linear, bOff);
        const greens = decodeInterpolatedAlphaBlock(linear, bOff + 8);
        blockRgba = new Uint8Array(16 * 4);
        for (let i = 0; i < 16; i++) {
          blockRgba[i * 4] = reds[i];
          blockRgba[i * 4 + 1] = greens[i];
          blockRgba[i * 4 + 2] = 128;
          blockRgba[i * 4 + 3] = 255;
        }
      } else {
        continue;
      }

      for (let py = 0; py < 4; py++) {
        const y = by * 4 + py;
        if (y >= height) break;
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          if (x >= width) break;
          const s = (py * 4 + px) * 4;
          const d = (y * width + x) * 4;
          rgba[d] = blockRgba[s];
          rgba[d + 1] = blockRgba[s + 1];
          rgba[d + 2] = blockRgba[s + 2];
          rgba[d + 3] = blockRgba[s + 3];
        }
      }
    }
  }
  applyComponentSelector(rgba, compSel);
  return rgba;
}

export function parseBntxContainer(
  bytes: Uint8Array,
  filename: string,
  options?: { generatePngDataUrl?: boolean }
): BntxArchiveData {
  const r = new BinReader(bytes, true);
  if (r.length < 0x58 || r.ascii(0, 4) !== 'BNTX') {
    throw new Error(`${filename}: Not a valid BNTX header.`);
  }
  const target = r.ascii(0x20, 4).trim() || 'NX';
  const texCount = r.check(0x24, 4) ? r.u32(0x24) : 0;
  const infoPtrsAddr = r.check(0x28, 8) ? r.u64Num(0x28) : 0;
  const dataBlkAddr = r.check(0x30, 8) ? r.u64Num(0x30) : 0;

  const brtiOffsets: number[] = [];
  if (
    texCount > 0 &&
    texCount <= MAX_SWITCH_TEXTURES_PER_BNTX &&
    infoPtrsAddr > 0 &&
    r.check(infoPtrsAddr, texCount * 8)
  ) {
    for (let i = 0; i < texCount; i++) {
      const ptr = r.u64Num(infoPtrsAddr + i * 8);
      if (ptr > 0 && r.check(ptr, 0x70) && r.ascii(ptr, 4) === 'BRTI') {
        brtiOffsets.push(ptr);
      }
    }
  }

  // Fallback bounded scan for 'BRTI' headers if pointer table wasn't relocated
  if (brtiOffsets.length === 0) {
    for (let off = 0x40; off + 0x70 <= r.length; off += 4) {
      if (
        bytes[off] === 0x42 &&
        bytes[off + 1] === 0x52 &&
        bytes[off + 2] === 0x54 &&
        bytes[off + 3] === 0x49
      ) {
        brtiOffsets.push(off);
        if (brtiOffsets.length >= MAX_SWITCH_TEXTURES_PER_BNTX) break;
      }
    }
  }

  if (brtiOffsets.length === 0) {
    throw new Error(`${filename}: No BRTI texture info blocks found in BNTX container.`);
  }

  const textures: DecodedBntxTexture[] = [];
  const encodePng = options?.generatePngDataUrl ?? true;

  for (let i = 0; i < brtiOffsets.length; i++) {
    const b = brtiOffsets[i];
    if (!r.check(b, 0x78)) continue;

    const tileMode = r.u16(b + 0x12);
    const mipCount = Math.max(1, r.u16(b + 0x16));
    const formatRaw = r.u32(b + 0x1c);
    // Low 16 bits match BNTX surface format code (e.g. 0x0b01, 0x1a01, 0x1c01)
    const formatCode = formatRaw & 0xffff;
    const width = r.u32(b + 0x24);
    const height = r.u32(b + 0x28);
    const blockHeightLog2 = r.u32(b + 0x34) & 0x7;
    const imageSize = r.u32(b + 0x50);
    const compSel = r.u32(b + 0x58);
    const nameOff = r.u64Num(b + 0x60);
    const ptrsOff = r.u64Num(b + 0x70);

    let texName = '';
    if (nameOff > 0 && r.check(nameOff, 4)) {
      texName = r.lenPrefixedStr(nameOff) || r.cstr(nameOff, 96);
    }
    if (!texName) {
      texName = brtiOffsets.length === 1 ? filename.replace(/\.bntx$/i, '') : `tex_${i}`;
    }

    if (
      width === 0 ||
      height === 0 ||
      width > MAX_SWITCH_TEX_DIM ||
      height > MAX_SWITCH_TEX_DIM ||
      width * height > MAX_SWITCH_TEX_PIXELS
    ) {
      throw new Error(
        `${filename} (${texName}): texture dimensions ${width}×${height} exceed ${MAX_SWITCH_TEX_DIM}×${MAX_SWITCH_TEX_DIM} limit.`
      );
    }

    const meta = BNTX_FORMAT_TABLE[formatCode] ?? {
      name: `0x${formatRaw.toString(16).toUpperCase()}`,
      bpp: 0,
      blkW: 1,
      blkH: 1,
      family: 'unsupported' as const,
    };

    if (meta.family === 'unsupported') {
      textures.push({
        name: texName,
        width,
        height,
        mipCount,
        formatCode: formatRaw,
        formatName: meta.name,
        tileMode,
        blockHeightLog2,
        decoded: false,
        unsupportedReason: `BNTX texture '${texName}' uses ${meta.name}; extract locally to PNG/WebP or BC1/BC3/RGBA8 BNTX.`,
      });
      continue;
    }

    let mip0Offset = 0;
    if (ptrsOff > 0 && r.check(ptrsOff, 8)) {
      mip0Offset = r.u64Num(ptrsOff);
    } else if (dataBlkAddr > 0 && r.check(dataBlkAddr, 0x10) && r.ascii(dataBlkAddr, 4) === 'BRTD') {
      mip0Offset = dataBlkAddr + 0x10;
    }

    if (mip0Offset <= 0 || mip0Offset >= r.length) {
      textures.push({
        name: texName,
        width,
        height,
        mipCount,
        formatCode: formatRaw,
        formatName: meta.name,
        tileMode,
        blockHeightLog2,
        decoded: false,
        unsupportedReason: `BNTX texture '${texName}' has unmapped mip0 offset 0x${mip0Offset.toString(16)}.`,
      });
      continue;
    }

    const avail = r.length - mip0Offset;
    const takeLen = imageSize > 0 ? Math.min(avail, imageSize) : avail;
    const srcSlice = bytes.subarray(mip0Offset, mip0Offset + takeLen);

    const linear = deswizzleTegraBlockLinear({
      width,
      height,
      blkW: meta.blkW,
      blkH: meta.blkH,
      bpp: meta.bpp,
      tileMode,
      blockHeightLog2,
      src: srcSlice,
    });
    const rgba = decodeLinearPixelsToRgba(linear, width, height, meta, compSel);
    const pngDataUrl = encodePng ? encodeRgbaToPngDataUrl(rgba, width, height) : undefined;

    textures.push({
      name: texName,
      width,
      height,
      mipCount,
      formatCode: formatRaw,
      formatName: meta.name,
      tileMode,
      blockHeightLog2,
      decoded: true,
      rgba,
      pngDataUrl,
    });
  }

  return {
    filename,
    target,
    textures,
  };
}

// ---------- BFLYT (Binary caFe LaYouT) Parser ----------

function readSwitchSectionTableStrings(r: BinReader, secStart: number, secSize: number): string[] {
  // Common table layout: +0x08 count (u16/u32), +0x0C offset table from (+0x08 or +0x0C)
  if (!r.check(secStart, Math.min(secSize, 12))) return [];
  const count = r.u16(secStart + 8);
  if (count === 0 || count > 256) return [];
  const base = secStart + 12;
  if (!r.check(base, count * 4)) return [];
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const rel = r.u32(base + i * 4);
    const strOff = secStart + 12 + rel;
    const altOff = secStart + 8 + rel;
    const s =
      (r.check(strOff, 1) ? r.cstr(strOff, 128) : '') ||
      (r.check(altOff, 1) ? r.cstr(altOff, 128) : '');
    if (s) names.push(s);
  }
  return names;
}

export function parseBflytContainer(bytes: Uint8Array, filename: string): BflytLayoutData {
  if (bytes.length < 0x14) throw new Error(`${filename}: File too small for BFLYT.`);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'FLYT') throw new Error(`${filename}: Expected FLYT magic, got '${magic}'.`);

  const bom = (bytes[4] << 8) | bytes[5];
  const littleEndian = bom !== 0xfeff; // 0xFFFE on little-endian => bytes [0xFE, 0xFF] or [0xFF, 0xFE]
  const r = new BinReader(bytes, bytes[4] === 0xff && bytes[5] === 0xfe ? true : littleEndian);
  const headerLen = r.u16(0x06);
  const sectionCount = r.u16(0x10);
  if (headerLen < 0x14 || sectionCount === 0 || sectionCount > 2048) {
    throw new Error(`${filename}: Invalid BFLYT header.`);
  }

  let width = 1280;
  let height = 720;
  let originType = 0;
  let textures: string[] = [];
  const materials: BflytMaterial[] = [];
  const panes: BflytPane[] = [];
  const userDataKeys: string[] = [];

  const parentStack: string[] = [];
  let lastPaneName: string | null = null;
  let offset = headerLen;

  for (let s = 0; s < sectionCount && offset + 8 <= r.length; s++) {
    const secMagic = r.ascii(offset, 4);
    const secSize = r.u32(offset + 4);
    if (secSize < 8 || !r.check(offset, secSize)) break;

    if (secMagic === 'lyt1' && secSize >= 0x14) {
      originType = r.u8(offset + 8);
      const w = r.f32(offset + 12);
      const h = r.f32(offset + 16);
      if (Number.isFinite(w) && w > 0 && w <= 8192) width = w;
      if (Number.isFinite(h) && h > 0 && h <= 8192) height = h;
    } else if (secMagic === 'txl1') {
      textures = readSwitchSectionTableStrings(r, offset, secSize);
    } else if (secMagic === 'mat1' && secSize >= 12) {
      const matCount = r.u16(offset + 8);
      const tableBase = offset + 12;
      if (matCount <= 512 && r.check(tableBase, matCount * 4)) {
        for (let m = 0; m < matCount; m++) {
          const relOff = r.u32(tableBase + m * 4);
          const mOff = offset + relOff;
          if (!r.check(mOff, 0x34)) continue;
          const mName = r.cstr(mOff, 28) || `mat_${m}`;
          // NintendoWare mat1 black/white colors + tex map count flags
          const blackColor: [number, number, number, number] = [
            r.u8(mOff + 0x1c),
            r.u8(mOff + 0x1d),
            r.u8(mOff + 0x1e),
            r.u8(mOff + 0x1f),
          ];
          const whiteColor: [number, number, number, number] = [
            r.u8(mOff + 0x20),
            r.u8(mOff + 0x21),
            r.u8(mOff + 0x22),
            r.u8(mOff + 0x23),
          ];
          const flags = r.u32(mOff + 0x24);
          const texMapCount = flags & 0x3;
          let textureIndex: number | null = null;
          if (texMapCount > 0 && r.check(mOff + 0x28, 2)) {
            const idx = r.u16(mOff + 0x28);
            if (idx < Math.max(1, textures.length)) textureIndex = idx;
          }
          materials.push({ name: mName, textureIndex, blackColor, whiteColor });
        }
      }
    } else if (secMagic === 'pas1') {
      if (lastPaneName) parentStack.push(lastPaneName);
    } else if (secMagic === 'pae1') {
      parentStack.pop();
    } else if (
      (secMagic === 'pan1' ||
        secMagic === 'pic1' ||
        secMagic === 'txt1' ||
        secMagic === 'wnd1' ||
        secMagic === 'bnd1') &&
      secSize >= 0x54 &&
      panes.length < MAX_BFLYT_PANES
    ) {
      const flags = r.u8(offset + 8);
      const originFlags = r.u8(offset + 9);
      const alpha = r.u8(offset + 10);
      const name = r.cstr(offset + 0x0c, 24) || `${secMagic}_${panes.length}`;
      const userDataName = r.cstr(offset + 0x24, 8);
      const tx = r.f32(offset + 0x2c);
      const ty = r.f32(offset + 0x30);
      const tz = r.f32(offset + 0x34);
      const rx = r.f32(offset + 0x38);
      const ry = r.f32(offset + 0x3c);
      const rz = r.f32(offset + 0x40);
      const sx = r.f32(offset + 0x44);
      const sy = r.f32(offset + 0x48);
      const w = r.f32(offset + 0x4c);
      const h = r.f32(offset + 0x50);

      const pane: BflytPane = {
        kind: secMagic,
        name,
        userDataName,
        parentName: parentStack.length ? parentStack[parentStack.length - 1] : null,
        visible: (flags & 0x01) !== 0,
        influenceAlpha: (flags & 0x02) !== 0,
        alpha,
        originX: originFlags % 3,
        originY: Math.floor(originFlags / 3) % 3,
        tx: Number.isFinite(tx) ? tx : 0,
        ty: Number.isFinite(ty) ? ty : 0,
        tz: Number.isFinite(tz) ? tz : 0,
        rx: Number.isFinite(rx) ? rx : 0,
        ry: Number.isFinite(ry) ? ry : 0,
        rz: Number.isFinite(rz) ? rz : 0,
        sx: Number.isFinite(sx) ? sx : 1,
        sy: Number.isFinite(sy) ? sy : 1,
        w: Number.isFinite(w) ? w : 64,
        h: Number.isFinite(h) ? h : 64,
      };

      if (secMagic === 'pic1' && secSize >= 0x68) {
        const readRgba = (o: number): [number, number, number, number] => [
          r.u8(o),
          r.u8(o + 1),
          r.u8(o + 2),
          r.u8(o + 3),
        ];
        pane.vertexColors = [
          readRgba(offset + 0x54),
          readRgba(offset + 0x58),
          readRgba(offset + 0x5c),
          readRgba(offset + 0x60),
        ];
        pane.materialIndex = r.u16(offset + 0x64);
        const uvCount = r.u8(offset + 0x66);
        if (uvCount > 0 && secSize >= 0x88) {
          pane.uvQuad = [
            [r.f32(offset + 0x68), r.f32(offset + 0x6c)],
            [r.f32(offset + 0x70), r.f32(offset + 0x74)],
            [r.f32(offset + 0x78), r.f32(offset + 0x7c)],
            [r.f32(offset + 0x80), r.f32(offset + 0x84)],
          ];
        }
      }

      panes.push(pane);
      lastPaneName = name;
    } else if (secMagic === 'usd1' && secSize >= 12) {
      const uCount = r.u16(offset + 8);
      for (let ui = 0; ui < Math.min(uCount, 32); ui++) {
        const uOff = offset + 12 + ui * 12;
        if (!r.check(uOff, 12)) break;
        const nameRel = r.u32(uOff);
        const k = r.cstr(uOff + nameRel, 64);
        if (k) userDataKeys.push(k);
      }
    }

    offset += secSize;
  }

  return {
    filename,
    width,
    height,
    originType,
    textures,
    materials,
    panes,
    userDataKeys,
  };
}

// ---------- BFLAN (Binary caFe Layout ANimation) Parser & Evaluator ----------

export function parseBflanContainer(bytes: Uint8Array, filename: string): BflanAnimationData {
  if (bytes.length < 0x14) throw new Error(`${filename}: File too small for BFLAN.`);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'FLAN') throw new Error(`${filename}: Expected FLAN magic, got '${magic}'.`);

  const littleEndian = !(bytes[4] === 0xfe && bytes[5] === 0xff);
  const r = new BinReader(bytes, littleEndian);
  const headerLen = r.u16(0x06);
  const sectionCount = r.u16(0x10);
  if (headerLen < 0x14 || sectionCount === 0 || sectionCount > 512) {
    throw new Error(`${filename}: Invalid BFLAN header.`);
  }

  let animName = filename.replace(/\.bflan$/i, '');
  let frameSize = 60;
  let loop = false;
  let startFrame = 0;
  let endFrame = 60;
  let textures: string[] = [];
  const entries: BflanEntry[] = [];
  let curveTotal = 0;

  let offset = headerLen;
  for (let s = 0; s < sectionCount && offset + 8 <= r.length; s++) {
    const secMagic = r.ascii(offset, 4);
    const secSize = r.u32(offset + 4);
    if (secSize < 8 || !r.check(offset, secSize)) break;

    if (secMagic === 'pat1' && secSize >= 0x1c) {
      const nameRel = r.u32(offset + 0x0c);
      if (nameRel > 0 && r.check(offset + nameRel, 1)) {
        const parsedName = r.cstr(offset + nameRel, 64);
        if (parsedName) animName = parsedName;
      }
      const sf = r.i16(offset + 0x14);
      const ef = r.i16(offset + 0x16);
      if (sf >= 0) startFrame = sf;
      if (ef > startFrame) endFrame = ef;
    } else if (secMagic === 'pai1' && secSize >= 0x18) {
      frameSize = Math.max(1, r.u16(offset + 8));
      loop = (r.u8(offset + 10) & 0x01) !== 0;
      const texCount = r.u16(offset + 12);
      const entryCount = r.u16(offset + 14);
      const entryTableRel = r.u32(offset + 16);

      // Optional texture names list directly at +0x14
      if (texCount > 0 && texCount <= 128 && r.check(offset + 20, texCount * 4)) {
        const texOut: string[] = [];
        for (let t = 0; t < texCount; t++) {
          const tRel = r.u32(offset + 20 + t * 4);
          if (r.check(offset + tRel, 1)) {
            const tn = r.cstr(offset + tRel, 96);
            if (tn) texOut.push(tn);
          }
        }
        if (texOut.length) textures = texOut;
      }

      const tableStart = offset + entryTableRel;
      if (entryCount > 0 && entryCount <= 256 && r.check(tableStart, entryCount * 4)) {
        for (let ei = 0; ei < entryCount; ei++) {
          const eRel = r.u32(tableStart + ei * 4);
          const eOff = offset + eRel;
          if (!r.check(eOff, 0x20)) continue;
          const targetName = r.cstr(eOff, 28) || `target_${ei}`;
          const tagCount = r.u8(eOff + 0x1c);
          const isMaterial = r.u8(eOff + 0x1d) !== 0;
          const curves: BflanCurve[] = [];

          for (let ti = 0; ti < Math.min(tagCount, 16); ti++) {
            const tagPtrOff = eOff + 0x20 + ti * 4;
            if (!r.check(tagPtrOff, 4)) break;
            const tagRel = r.u32(tagPtrOff);
            const tagOff = eOff + tagRel;
            if (!r.check(tagOff, 8)) continue;
            const tag = r.ascii(tagOff, 4);
            const curveCount = r.u8(tagOff + 4);
            for (let ci = 0; ci < Math.min(curveCount, 32) && curveTotal < MAX_BFLAN_CURVES; ci++) {
              const cPtrOff = tagOff + 8 + ci * 4;
              if (!r.check(cPtrOff, 4)) break;
              const cRel = r.u32(cPtrOff);
              const cOff = tagOff + cRel;
              if (!r.check(cOff, 0x10)) continue;

              const targetType = r.u8(cOff + 0x01);
              const interpRaw = r.u8(cOff + 0x02);
              const keyCount = r.u16(cOff + 0x04);
              const keysRel = r.u32(cOff + 0x0c);
              const keysOff = cOff + keysRel;
              const interp: BflanCurve['interp'] =
                interpRaw === 2
                  ? 'hermite'
                  : interpRaw === 1
                  ? 'step'
                  : interpRaw === 3
                  ? 'linear'
                  : 'const';

              const keys: BflanKeyframe[] = [];
              if (keyCount > 0 && keyCount <= 256) {
                const stride = interp === 'hermite' ? 12 : 8;
                if (r.check(keysOff, keyCount * stride)) {
                  for (let ki = 0; ki < keyCount; ki++) {
                    const ko = keysOff + ki * stride;
                    const frame = r.f32(ko);
                    const value = r.f32(ko + 4);
                    const slope = interp === 'hermite' ? r.f32(ko + 8) : undefined;
                    if (Number.isFinite(frame) && Number.isFinite(value)) {
                      keys.push({
                        frame,
                        value,
                        inSlope: slope,
                        outSlope: slope,
                      });
                    }
                  }
                }
              }
              curves.push({ tag, targetType, interp, keys });
              curveTotal++;
            }
          }
          entries.push({ targetName, isMaterial, curves });
        }
      }
    }

    offset += secSize;
  }

  return {
    filename,
    name: animName,
    frameSize,
    loop,
    startFrame,
    endFrame,
    textures,
    entries,
  };
}

export interface EvaluatedPaneAnim {
  tx?: number;
  ty?: number;
  tz?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  alpha?: number;
  visible?: boolean;
}

function sampleCurve(curve: BflanCurve, frame: number): number | undefined {
  const keys = curve.keys;
  if (keys.length === 0) return undefined;
  if (keys.length === 1 || frame <= keys[0].frame) return keys[0].value;
  if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1].value;

  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      if (curve.interp === 'step' || curve.interp === 'const' || b.frame === a.frame) {
        return a.value;
      }
      const span = b.frame - a.frame;
      const t = (frame - a.frame) / span;
      if (curve.interp === 'hermite') {
        const t2 = t * t;
        const t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;
        const m0 = (a.outSlope ?? 0) * span;
        const m1 = (b.inSlope ?? 0) * span;
        return h00 * a.value + h10 * m0 + h01 * b.value + h11 * m1;
      }
      return a.value + (b.value - a.value) * t;
    }
  }
  return keys[keys.length - 1].value;
}

export function evaluateBflanAtFrame(
  anim: BflanAnimationData,
  rawFrame: number
): Map<string, EvaluatedPaneAnim> {
  const out = new Map<string, EvaluatedPaneAnim>();
  const len = Math.max(1, anim.frameSize);
  const frame = anim.loop
    ? ((rawFrame % len) + len) % len
    : Math.max(0, Math.min(len, rawFrame));

  for (const entry of anim.entries) {
    const patch: EvaluatedPaneAnim = {};
    for (const c of entry.curves) {
      const v = sampleCurve(c, frame);
      if (v === undefined || !Number.isFinite(v)) continue;
      if (c.tag === 'FLPA') {
        switch (c.targetType) {
          case 0: patch.tx = v; break;
          case 1: patch.ty = v; break;
          case 2: patch.tz = v; break;
          case 3: patch.rx = v; break;
          case 4: patch.ry = v; break;
          case 5: patch.rz = v; break;
          case 6: patch.sx = v; break;
          case 7: patch.sy = v; break;
          default: break;
        }
      } else if (c.tag === 'FLVI') {
        patch.visible = v >= 0.5;
      } else if (c.tag === 'FLMC' && c.targetType === 3) {
        patch.alpha = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
    out.set(entry.targetName, patch);
  }
  return out;
}

// ---------- BFRES (NintendoWare 3D Model Container) Parser ----------

export function parseBfresContainer(bytes: Uint8Array, filename: string): BfresModelData {
  const r = new BinReader(bytes, true);
  if (r.length < 0x80 || r.ascii(0, 4) !== 'FRES') {
    throw new Error(`${filename}: Not a valid Switch FRES/BFRES header.`);
  }
  const nameOff = r.check(0x20, 8) ? r.u64Num(0x20) : 0;
  const modelName =
    (nameOff > 0 && r.check(nameOff, 4) ? r.lenPrefixedStr(nameOff) || r.cstr(nameOff, 96) : '') ||
    filename.replace(/\.bfres$/i, '');

  const models: BfresModelSummary[] = [];
  const warnings: string[] = [];

  // Switch FRES header stores FMDL array pointer at 0x28 and count at 0x8C (v8/v9/v10)
  const fmdlOffsets: number[] = [];
  if (r.check(0x28, 8) && r.check(0x8c, 2)) {
    const arrPtr = r.u64Num(0x28);
    const fmdlCount = r.u16(0x8c);
    if (fmdlCount > 0 && fmdlCount <= 32 && arrPtr > 0 && r.check(arrPtr, fmdlCount * 8)) {
      for (let i = 0; i < fmdlCount; i++) {
        const ptr = r.u64Num(arrPtr + i * 8);
        if (ptr > 0 && r.check(ptr, 0x70) && r.ascii(ptr, 4) === 'FMDL') {
          fmdlOffsets.push(ptr);
        }
      }
    }
  }

  // Fallback bounded scan for FMDL magic
  if (fmdlOffsets.length === 0) {
    for (let off = 0x40; off + 0x70 <= r.length; off += 4) {
      if (
        bytes[off] === 0x46 &&
        bytes[off + 1] === 0x4d &&
        bytes[off + 2] === 0x44 &&
        bytes[off + 3] === 0x4c
      ) {
        fmdlOffsets.push(off);
        if (fmdlOffsets.length >= 16) break;
      }
    }
  }

  // Scan FMAT material texture names and FVTX/FSHP geometry blocks cleanly within bounds
  for (let mi = 0; mi < fmdlOffsets.length; mi++) {
    const fOff = fmdlOffsets[mi];
    const fNameOff = r.check(fOff + 0x10, 8) ? r.u64Num(fOff + 0x10) : 0;
    const fName =
      (fNameOff > 0 && r.check(fNameOff, 4) ? r.lenPrefixedStr(fNameOff) || r.cstr(fNameOff, 96) : '') ||
      `model_${mi}`;

    const bones: BfresBone[] = [];
    const materials: Array<{ name: string; textureNames: string[] }> = [];
    const meshes: BfresSubMesh[] = [];

    const fsklPtr = r.check(fOff + 0x20, 8) ? r.u64Num(fOff + 0x20) : 0;
    if (fsklPtr > 0 && r.check(fsklPtr, 0x40) && r.ascii(fsklPtr, 4) === 'FSKL') {
      const boneArrPtr = r.u64Num(fsklPtr + 0x18);
      const boneCount = r.u16(fsklPtr + 0x38);
      if (boneCount > 0 && boneCount <= 256 && boneArrPtr > 0 && r.check(boneArrPtr, boneCount * 0x58)) {
        for (let bi = 0; bi < boneCount; bi++) {
          const bo = boneArrPtr + bi * 0x58;
          const bNameOff = r.u64Num(bo);
          const bName =
            (bNameOff > 0 && r.check(bNameOff, 4) ? r.lenPrefixedStr(bNameOff) || r.cstr(bNameOff, 64) : '') ||
            `bone_${bi}`;
          const parentIndex = r.i16(bo + 0x22);
          bones.push({
            name: bName,
            parentIndex,
            tx: r.f32(bo + 0x44),
            ty: r.f32(bo + 0x48),
            tz: r.f32(bo + 0x4c),
            rx: r.f32(bo + 0x34),
            ry: r.f32(bo + 0x38),
            rz: r.f32(bo + 0x3c),
            sx: r.f32(bo + 0x28),
            sy: r.f32(bo + 0x2c),
            sz: r.f32(bo + 0x30),
          });
        }
      }
    }

    const fmatArrPtr = r.check(fOff + 0x38, 8) ? r.u64Num(fOff + 0x38) : 0;
    const fmatCount = r.check(fOff + 0x6c, 2) ? r.u16(fOff + 0x6c) : 0;
    if (fmatCount > 0 && fmatCount <= 64 && fmatArrPtr > 0 && r.check(fmatArrPtr, fmatCount * 8)) {
      for (let ti = 0; ti < fmatCount; ti++) {
        const mPtr = r.u64Num(fmatArrPtr + ti * 8);
        if (mPtr > 0 && r.check(mPtr, 0x50) && r.ascii(mPtr, 4) === 'FMAT') {
          const mnOff = r.u64Num(mPtr + 0x10);
          const mName =
            (mnOff > 0 && r.check(mnOff, 4) ? r.lenPrefixedStr(mnOff) || r.cstr(mnOff, 64) : '') ||
            `mat_${ti}`;
          const texArrPtr = r.u64Num(mPtr + 0x38);
          const texCount = r.u8(mPtr + 0x66);
          const textureNames: string[] = [];
          if (texCount > 0 && texCount <= 16 && texArrPtr > 0 && r.check(texArrPtr, texCount * 8)) {
            for (let k = 0; k < texCount; k++) {
              const tnOff = r.u64Num(texArrPtr + k * 8);
              if (tnOff > 0 && r.check(tnOff, 4)) {
                const tn = r.lenPrefixedStr(tnOff) || r.cstr(tnOff, 64);
                if (tn) textureNames.push(tn);
              }
            }
          }
          materials.push({ name: mName, textureNames });
        }
      }
    }

    // Parse simple embedded JSON/mesh fallback payload if present in custom/test BFRES or FVTX float3 positions
    const fvtxArrPtr = r.check(fOff + 0x28, 8) ? r.u64Num(fOff + 0x28) : 0;
    const fshpArrPtr = r.check(fOff + 0x30, 8) ? r.u64Num(fOff + 0x30) : 0;
    const fshpCount = r.check(fOff + 0x6a, 2) ? r.u16(fOff + 0x6a) : 0;
    const fvtxCount = r.check(fOff + 0x68, 2) ? r.u16(fOff + 0x68) : 0;

    if (
      fshpCount > 0 &&
      fshpCount <= 64 &&
      fvtxCount > 0 &&
      fshpArrPtr > 0 &&
      fvtxArrPtr > 0 &&
      r.check(fshpArrPtr, fshpCount * 8) &&
      r.check(fvtxArrPtr, fvtxCount * 8)
    ) {
      for (let si = 0; si < fshpCount; si++) {
        const sPtr = r.u64Num(fshpArrPtr + si * 8);
        if (sPtr <= 0 || !r.check(sPtr, 0x70) || r.ascii(sPtr, 4) !== 'FSHP') continue;
        const snOff = r.u64Num(sPtr + 0x10);
        const sName =
          (snOff > 0 && r.check(snOff, 4) ? r.lenPrefixedStr(snOff) || r.cstr(snOff, 64) : '') ||
          `mesh_${si}`;
        const matIdx = r.u16(sPtr + 0x68);
        const vtxIdx = r.u16(sPtr + 0x6a);
        const mat = materials[matIdx];

        const vPtr = vtxIdx < fvtxCount ? r.u64Num(fvtxArrPtr + vtxIdx * 8) : 0;
        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];

        // Extract Switch FVTX float3 positions & u16/u32 triangle indices when inline buffer offset is valid
        if (vPtr > 0 && r.check(vPtr, 0x58) && r.ascii(vPtr, 4) === 'FVTX') {
          const vCount = Math.min(MAX_BFRES_VERTICES, r.u32(vPtr + 0x48));
          const bufPtr = r.u64Num(vPtr + 0x38);
          const stride = Math.max(12, r.u16(vPtr + 0x4c));
          if (vCount > 0 && bufPtr > 0 && r.check(bufPtr, vCount * stride)) {
            for (let vi = 0; vi < vCount; vi++) {
              const vo = bufPtr + vi * stride;
              const px = r.f32(vo);
              const py = r.f32(vo + 4);
              const pz = r.f32(vo + 8);
              positions.push(
                Number.isFinite(px) ? px : 0,
                Number.isFinite(py) ? py : 0,
                Number.isFinite(pz) ? pz : 0
              );
              normals.push(0, 1, 0);
              uvs.push(0, 0);
            }
          }
        }

        const idxPtr = r.u64Num(sPtr + 0x40);
        const idxCount = Math.min(MAX_BFRES_INDICES, r.u32(sPtr + 0x50));
        if (idxCount >= 3 && idxPtr > 0 && r.check(idxPtr, idxCount * 2)) {
          for (let ii = 0; ii < idxCount; ii++) {
            const idxVal = r.u16(idxPtr + ii * 2);
            if (idxVal * 3 < positions.length) indices.push(idxVal);
          }
        }

        meshes.push({
          name: sName,
          materialName: mat?.name ?? 'default',
          textureNames: mat?.textureNames ?? [],
          positions,
          normals,
          uvs,
          indices,
        });
      }
    }

    models.push({
      name: fName,
      bones,
      materials,
      meshes,
    });
  }

  if (models.length === 0) {
    warnings.push(
      'FRES header verified, but no readable FMDL geometry tables matched; pair extracted textures or OBJ/PNG sheets if this game uses custom FRES packing.'
    );
  }

  return {
    filename,
    name: modelName,
    models,
    warnings,
  };
}
