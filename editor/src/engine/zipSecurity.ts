/**
 * Raw ZIP binary header inspection, bounded streaming decompression,
 * strict duplicate-key UTF-8 JSON parser, and deterministic canonical ZIP writer.
 *
 * Aligned with Draft 0.3 (GROOVE_PROFILE_DRAFT_02 + GROOVE_INTEGRATION_V0_DECISIONS)
 * and GE-155 validator/zipreader.py, jsonstrict.py, safepath.py.
 */

const utf8Fatal = new TextDecoder('utf-8', { fatal: true });
const utf8Enc = new TextEncoder();

const DOS_RESERVED_BASENAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'conin$',
  'conout$',
  'clock$',
  'com0',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt0',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
  'com¹',
  'com²',
  'com³',
  'lpt¹',
  'lpt²',
  'lpt³',
]);

const NESTED_ARCHIVE_EXTS = [
  '.zip',
  '.groove',
  '.rhref',
  '.rhre3',
  '.jar',
  '.tar',
  '.gz',
  '.tgz',
  '.7z',
  '.rar',
  '.bz2',
  '.xz',
];

// Only timestamp/ownership extra fields permitted by Draft 0.3 zipreader.py (reject 0x0001 ZIP64 & unknown extras)
const ALLOWED_EXTRA_IDS = new Set([0x5455, 0x7875, 0x000a, 0x5855]);
const WINDOWS_BAD_PATH_CHARS = /[<>:"|?*\\]/;

// Standard IEEE 802.3 CRC-32 table
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function decodeUtf8Strict(bytes: Uint8Array, label = 'texto'): string {
  try {
    return utf8Fatal.decode(bytes);
  } catch {
    throw new Error(`UTF-8 invalido en ${label}`);
  }
}

export function hasUnpairedSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= text.length) return true;
      const next = text.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function assertSafeArchivePath(
  rawPath: string,
  opts: { allowTrailingSlash?: boolean; rejectNestedArchives?: boolean } = {}
): string {
  if (!rawPath) {
    throw new Error('Ruta vacia en archivo ZIP');
  }
  for (let i = 0; i < rawPath.length; i++) {
    const code = rawPath.charCodeAt(i);
    if (code < 32 || code === 127 || (code >= 0x80 && code <= 0x9f)) {
      throw new Error(`Caracter de control prohibido en ruta ZIP: ${rawPath}`);
    }
  }
  if (rawPath.includes('\\')) {
    throw new Error(`Barra invertida prohibida en ruta ZIP: ${rawPath}`);
  }
  if (rawPath.startsWith('/') || rawPath.startsWith('//') || /^[A-Za-z]:/.test(rawPath)) {
    throw new Error(`Ruta absoluta prohibida en paquete: ${rawPath}`);
  }

  const isDirPath = rawPath.endsWith('/');
  if (isDirPath && !opts.allowTrailingSlash) {
    throw new Error(`Directorio no permitido en paquete: ${rawPath}`);
  }

  const trimmed = isDirPath ? rawPath.slice(0, -1) : rawPath;
  if (!trimmed) {
    throw new Error(`Ruta de directorio vacia prohibida: ${rawPath}`);
  }
  const segments = trimmed.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') {
      throw new Error(`Ruta invalida en paquete: ${rawPath}`);
    }
    if (seg.endsWith('.') || seg.endsWith(' ')) {
      throw new Error(`Segmento con punto o espacio final prohibido: ${rawPath}`);
    }
    if (WINDOWS_BAD_PATH_CHARS.test(seg)) {
      throw new Error(`Caracter reservado prohibido en ruta ZIP: ${rawPath}`);
    }
    const baseNoExt = seg.split('.', 1)[0].replace(/ +$/, '').toLowerCase();
    if (DOS_RESERVED_BASENAMES.has(baseNoExt)) {
      throw new Error(`Nombre de dispositivo DOS reservado prohibido: ${rawPath}`);
    }
  }

  if (opts.rejectNestedArchives !== false && !isDirPath) {
    const lower = rawPath.toLowerCase();
    if (NESTED_ARCHIVE_EXTS.some((ext) => lower.endsWith(ext))) {
      throw new Error(`Archivo comprimido anidado prohibido: ${rawPath}`);
    }
  }

  return rawPath;
}

export interface StrictZipEntry {
  path: string;
  isDir: boolean;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dataOffset: number;
  externalAttrs: number;
}

export interface InspectZipOptions {
  maxCompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxEntries: number;
  allowDirectories: boolean;
  allowDataDescriptor?: boolean;
  strictDraft03?: boolean;
  maxNameBytes?: number;
  maxEntryBytesByPath?: (path: string) => number | undefined;
}

function readU16LE(b: Uint8Array, off: number): number {
  return b[off] | (b[off + 1] << 8);
}

function readU32LE(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

function writeU16LE(b: Uint8Array, off: number, val: number): void {
  b[off] = val & 0xff;
  b[off + 1] = (val >>> 8) & 0xff;
}

function writeU32LE(b: Uint8Array, off: number, val: number): void {
  b[off] = val & 0xff;
  b[off + 1] = (val >>> 8) & 0xff;
  b[off + 2] = (val >>> 16) & 0xff;
  b[off + 3] = (val >>> 24) & 0xff;
}

function validateZipExtraFields(buf: Uint8Array, name: string): void {
  let i = 0;
  while (i < buf.length) {
    if (i + 4 > buf.length) {
      throw new Error(`Campo extra ZIP truncado en ${name}`);
    }
    const hid = readU16LE(buf, i);
    const len = readU16LE(buf, i + 2);
    if (hid === 0x0001) {
      throw new Error(`Campo extra ZIP64 (0x0001) no permitido en ${name}`);
    }
    if (!ALLOWED_EXTRA_IDS.has(hid)) {
      throw new Error(`Campo extra ZIP no soportado (0x${hid.toString(16).toUpperCase().padStart(4, '0')}) en ${name}`);
    }
    i += 4 + len;
    if (i > buf.length) {
      throw new Error(`Campo extra ZIP truncado en ${name}`);
    }
  }
}

// ---------- Pure-JS RFC 1951 exact end-of-stream scanner ----------
// Detects truncated blocks or trailing unused bytes ignored by Web DecompressionStream('deflate-raw').

const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const LEN_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4,
  5, 5, 5, 5, 0,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2,
  3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 9, 9, 10, 10,
  11, 11, 12, 12, 13, 13,
];

interface HuffNode {
  maxBits: number;
  minBits: number;
  codes: Map<number, number>; // key = (len << 16) | code
}

function buildHuffmanTable(lengths: number[]): HuffNode {
  let maxBits = 0;
  let minBits = 16;
  const blCount = new Int32Array(17);
  for (const len of lengths) {
    if (len > 0) {
      if (len > maxBits) maxBits = len;
      if (len < minBits) minBits = len;
      blCount[len]++;
    }
  }
  const nextCode = new Int32Array(17);
  let code = 0;
  for (let bits = 1; bits <= maxBits; bits++) {
    code = (code + blCount[bits - 1]) << 1;
    nextCode[bits] = code;
  }
  const codes = new Map<number, number>();
  for (let n = 0; n < lengths.length; n++) {
    const len = lengths[n];
    if (len !== 0) {
      codes.set((len << 16) | nextCode[len], n);
      nextCode[len]++;
    }
  }
  return { maxBits, minBits: maxBits === 0 ? 1 : minBits, codes };
}

const FIXED_LIT_TABLE = (() => {
  const lens = new Array<number>(288);
  for (let i = 0; i <= 143; i++) lens[i] = 8;
  for (let i = 144; i <= 255; i++) lens[i] = 9;
  for (let i = 256; i <= 279; i++) lens[i] = 7;
  for (let i = 280; i <= 287; i++) lens[i] = 8;
  return buildHuffmanTable(lens);
})();

function verifyRawDeflateExactEnd(bytes: Uint8Array, label: string): void {
  let bitPos = 0;
  const totalBits = bytes.length * 8;

  const readBits = (n: number): number => {
    if (bitPos + n > totalBits) {
      throw new Error(`Flujo DEFLATE incompleto en '${label}'`);
    }
    let val = 0;
    for (let i = 0; i < n; i++) {
      const bit = (bytes[bitPos >>> 3] >>> (bitPos & 7)) & 1;
      val |= bit << i;
      bitPos++;
    }
    return val;
  };

  const readSym = (table: HuffNode): number => {
    let code = 0;
    for (let len = 1; len <= table.maxBits; len++) {
      if (bitPos >= totalBits) {
        throw new Error(`Flujo DEFLATE incompleto en '${label}'`);
      }
      const bit = (bytes[bitPos >>> 3] >>> (bitPos & 7)) & 1;
      bitPos++;
      code = (code << 1) | bit;
      if (len >= table.minBits) {
        const sym = table.codes.get((len << 16) | code);
        if (sym !== undefined) return sym;
      }
    }
    throw new Error(`Codigo Huffman DEFLATE invalido en '${label}'`);
  };

  let bfinal = 0;
  do {
    bfinal = readBits(1);
    const btype = readBits(2);
    if (btype === 3) {
      throw new Error(`Tipo de bloque DEFLATE reservado en '${label}'`);
    }
    if (btype === 0) {
      bitPos = (bitPos + 7) & ~7;
      const byteOff = bitPos >>> 3;
      if (byteOff + 4 > bytes.length) {
        throw new Error(`Bloque DEFLATE no comprimido truncado en '${label}'`);
      }
      const len = readU16LE(bytes, byteOff);
      const nlen = readU16LE(bytes, byteOff + 2);
      if ((len ^ 0xffff) !== nlen) {
        throw new Error(`Longitud DEFLATE almacenada corrupta en '${label}'`);
      }
      const nextByte = byteOff + 4 + len;
      if (nextByte > bytes.length) {
        throw new Error(`Datos DEFLATE truncados en '${label}'`);
      }
      bitPos = nextByte * 8;
      continue;
    }

    let litTable: HuffNode;
    let distTable: HuffNode | null = null;
    if (btype === 1) {
      litTable = FIXED_LIT_TABLE;
    } else {
      const hlit = readBits(5) + 257;
      const hdist = readBits(5) + 1;
      const hclen = readBits(4) + 4;
      const clLens = new Array<number>(19).fill(0);
      for (let i = 0; i < hclen; i++) {
        clLens[CL_ORDER[i]] = readBits(3);
      }
      const clTable = buildHuffmanTable(clLens);
      const codeLengths: number[] = [];
      const targetCount = hlit + hdist;
      while (codeLengths.length < targetCount) {
        const s = readSym(clTable);
        if (s < 16) {
          codeLengths.push(s);
        } else if (s === 16) {
          if (codeLengths.length === 0) throw new Error(`Tabla DEFLATE invalida en '${label}'`);
          const rep = 3 + readBits(2);
          const prev = codeLengths[codeLengths.length - 1];
          for (let r = 0; r < rep; r++) codeLengths.push(prev);
        } else if (s === 17) {
          const rep = 3 + readBits(3);
          for (let r = 0; r < rep; r++) codeLengths.push(0);
        } else {
          const rep = 11 + readBits(7);
          for (let r = 0; r < rep; r++) codeLengths.push(0);
        }
      }
      if (codeLengths.length !== targetCount) {
        throw new Error(`Tabla dinamica DEFLATE desalineada en '${label}'`);
      }
      litTable = buildHuffmanTable(codeLengths.slice(0, hlit));
      distTable = buildHuffmanTable(codeLengths.slice(hlit));
    }

    while (true) {
      const sym = readSym(litTable);
      if (sym < 256) continue;
      if (sym === 256) break;
      if (sym > 285) throw new Error(`Simbolo de longitud DEFLATE invalido en '${label}'`);
      const lenExtra = LEN_EXTRA[sym - 257];
      if (lenExtra > 0) readBits(lenExtra);
      const dist = distTable ? readSym(distTable) : readBits(5);
      if (dist > 29) throw new Error(`Simbolo de distancia DEFLATE invalido en '${label}'`);
      const distExtra = DIST_EXTRA[dist];
      if (distExtra > 0) readBits(distExtra);
    }
  } while (bfinal === 0);

  const bytesUsed = Math.ceil(bitPos / 8);
  if (bytesUsed !== bytes.length) {
    throw new Error(
      `Flujo DEFLATE seguido de ${bytes.length - bytesUsed} byte(s) sobrante(s) en '${label}'`
    );
  }
}

export class BoundedZipArchive {
  private readonly bytes: Uint8Array;
  private readonly entries: Map<string, StrictZipEntry>;
  private readonly maxTotalUncompressedBytes: number;
  private readonly strictDraft03: boolean;
  private totalDecompressedSoFar = 0;

  constructor(
    bytes: Uint8Array,
    entries: Map<string, StrictZipEntry>,
    maxTotalUncompressedBytes: number,
    strictDraft03 = false
  ) {
    this.bytes = bytes;
    this.entries = entries;
    this.maxTotalUncompressedBytes = maxTotalUncompressedBytes;
    this.strictDraft03 = strictDraft03;
  }

  public listPaths(): string[] {
    return Array.from(this.entries.keys());
  }

  public getEntry(path: string): StrictZipEntry | undefined {
    return this.entries.get(path);
  }

  public async readBytes(path: string, maxEntryBytes?: number): Promise<Uint8Array> {
    const entry = this.entries.get(path);
    if (!entry) {
      throw new Error(`Falta el archivo esperado en el ZIP: ${path}`);
    }
    if (entry.isDir) {
      throw new Error(`Se esperaba archivo y se encontro directorio: ${path}`);
    }

    if (maxEntryBytes !== undefined && entry.uncompressedSize > maxEntryBytes) {
      throw new Error(`Entrada '${path}' excede el limite de ${maxEntryBytes} bytes`);
    }
    const remainingGlobal = this.maxTotalUncompressedBytes - this.totalDecompressedSoFar;
    const limit =
      maxEntryBytes !== undefined
        ? Math.min(maxEntryBytes, remainingGlobal, entry.uncompressedSize)
        : Math.min(remainingGlobal, entry.uncompressedSize);
    if (limit < 0) {
      throw new Error('Contenido descomprimido supera el limite total permitido');
    }

    const compressedSlice = this.bytes.subarray(
      entry.dataOffset,
      entry.dataOffset + entry.compressedSize
    );
    if (compressedSlice.length !== entry.compressedSize) {
      throw new Error(`Entrada ZIP truncada: ${path}`);
    }

    let out: Uint8Array;
    if (entry.method === 0) {
      if (compressedSlice.length > limit) {
        throw new Error(`Entrada '${path}' excede el limite de ${limit} bytes`);
      }
      out = new Uint8Array(compressedSlice);
    } else if (entry.method === 8) {
      out = await inflateRawBounded(compressedSlice, limit, path, this.strictDraft03);
    } else {
      throw new Error(`Metodo de compresion ZIP no soportado (${entry.method}) en ${path}`);
    }

    this.totalDecompressedSoFar += out.byteLength;
    if (this.totalDecompressedSoFar > this.maxTotalUncompressedBytes) {
      throw new Error('Contenido descomprimido supera el limite total permitido');
    }
    if (out.byteLength !== entry.uncompressedSize) {
      throw new Error(
        `Tamano descomprimido inconsistente en '${path}' (esperado ${entry.uncompressedSize}, real ${out.byteLength})`
      );
    }
    const actualCrc = crc32(out);
    if (actualCrc !== entry.crc32) {
      throw new Error(
        `CRC-32 invalido en '${path}' (esperado 0x${entry.crc32.toString(16)}, real 0x${actualCrc.toString(16)})`
      );
    }

    return out;
  }

  public async readText(path: string, maxEntryBytes?: number): Promise<string> {
    const raw = await this.readBytes(path, maxEntryBytes);
    return decodeUtf8Strict(raw, path);
  }
}

async function inflateRawBounded(
  compressed: Uint8Array,
  maxBytes: number,
  label: string,
  strictTrailingCheck: boolean
): Promise<Uint8Array> {
  if (strictTrailingCheck) {
    verifyRawDeflateExactEnd(compressed, label);
  }
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    const copy = new Uint8Array(compressed);
    const writePromise = writer.write(copy).then(() => writer.close());
    // Observe early writer failure even when reader.read rejects first.
    void writePromise.catch(() => {});

    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            await writePromise.catch(() => {});
            throw new Error(
              `Descompresion de '${label}' excede el limite permitido (${total} > ${maxBytes} bytes)`
            );
          }
          chunks.push(value);
        }
      }
      await writePromise;
    } catch (err) {
      await Promise.allSettled([reader.cancel(), writer.abort(), writePromise]);
      throw err instanceof Error ? err : new Error(String(err));
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }

  throw new Error('DecompressionStream no disponible en este entorno');
}

async function deflateRawDeterministic(raw: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();
    const copy = new Uint8Array(raw);
    const writePromise = writer.write(copy).then(() => writer.close());
    // Observe early writer failure even when reader.read rejects first.
    void writePromise.catch(() => {});
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        chunks.push(value);
      }
    }
    await writePromise;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }
  return raw;
}

/**
 * Inspects raw EOCD, Central Directory, and Local File Headers BEFORE any path normalization
 * and before any entry is decompressed.
 */
export async function inspectAndOpenZip(
  input: ArrayBuffer | Uint8Array,
  opts: InspectZipOptions
): Promise<BoundedZipArchive> {
  const strictDraft03 = Boolean(opts.strictDraft03);
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 22) {
    throw new Error('Archivo ZIP truncado o demasiado pequeno');
  }
  if (bytes.byteLength > opts.maxCompressedBytes) {
    throw new Error(`Archivo ZIP supera el limite de ${opts.maxCompressedBytes} bytes`);
  }

  let eocdOff = -1;
  if (strictDraft03) {
    const cand = bytes.byteLength - 22;
    if (readU32LE(bytes, cand) === 0x06054b50) {
      const commentLen = readU16LE(bytes, cand + 20);
      if (commentLen !== 0) {
        throw new Error('Comentarios de archivo ZIP o datos sobrantes no permitidos');
      }
      eocdOff = cand;
    } else {
      // Check if an EOCD appeared earlier (trailing data or archive comment)
      let foundEarlier = false;
      const minOff = Math.max(0, bytes.byteLength - 65557);
      for (let i = bytes.byteLength - 23; i >= minOff; i--) {
        if (readU32LE(bytes, i) === 0x06054b50) {
          foundEarlier = true;
          break;
        }
      }
      if (foundEarlier) {
        throw new Error('Comentarios de archivo ZIP o datos sobrantes tras el directorio central');
      }
      throw new Error('Cabecera EOCD ZIP ausente o archivo truncado');
    }
  } else {
    const minEocdOff = Math.max(0, bytes.byteLength - 65557);
    for (let i = bytes.byteLength - 22; i >= minEocdOff; i--) {
      if (
        bytes[i] === 0x50 &&
        bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x05 &&
        bytes[i + 3] === 0x06
      ) {
        const commentLen = readU16LE(bytes, i + 20);
        if (i + 22 + commentLen === bytes.byteLength) {
          eocdOff = i;
          break;
        }
      }
    }
    if (eocdOff < 0) {
      throw new Error('Cabecera EOCD ZIP ausente o corrupta (datos sobrantes o archivo truncado)');
    }
  }

  // Reject ZIP64 EOCD locator right before EOCD
  if (eocdOff >= 20 && readU32LE(bytes, eocdOff - 20) === 0x07064b50) {
    throw new Error('Archivos ZIP64 no permitidos');
  }

  const diskNum = readU16LE(bytes, eocdOff + 4);
  const cdDisk = readU16LE(bytes, eocdOff + 6);
  const entriesOnDisk = readU16LE(bytes, eocdOff + 8);
  const totalEntries = readU16LE(bytes, eocdOff + 10);
  const cdSize = readU32LE(bytes, eocdOff + 12);
  const cdOffset = readU32LE(bytes, eocdOff + 16);

  if (
    totalEntries === 0xffff ||
    entriesOnDisk === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  ) {
    throw new Error('Archivos ZIP64 no soportados');
  }
  if (diskNum !== 0 || cdDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new Error('Archivos ZIP multidisco no soportados');
  }
  if (strictDraft03 && totalEntries === 0) {
    throw new Error('Archivo ZIP vacio sin entradas');
  }
  if (totalEntries > opts.maxEntries) {
    throw new Error(`Demasiadas entradas ZIP (${totalEntries} > max ${opts.maxEntries})`);
  }
  if (strictDraft03) {
    if (cdOffset + cdSize !== eocdOff) {
      throw new Error('Directorio central ZIP desalineado con EOCD (hueco, solape o truncado)');
    }
  } else if (cdOffset + cdSize > eocdOff) {
    throw new Error('Directorio central ZIP truncado o fuera de limites');
  }

  const entries = new Map<string, StrictZipEntry>();
  const seenLower = new Set<string>();
  const occupied: Array<[number, number]> = [];
  const cdRows: Array<{ entry: StrictZipEntry; nameBytes: Uint8Array; versionNeeded: number }> = [];
  let claimedTotalUncompressed = 0;
  let pos = cdOffset;
  const cdEnd = cdOffset + cdSize;
  const maxNameLen = opts.maxNameBytes ?? 255;

  for (let idx = 0; idx < totalEntries; idx++) {
    if (pos + 46 > cdEnd) {
      throw new Error('Entrada de directorio central ZIP truncada');
    }
    const sig = readU32LE(bytes, pos);
    if (sig !== 0x02014b50) {
      throw new Error('Firma de directorio central ZIP invalida');
    }

    const madeBy = readU16LE(bytes, pos + 4);
    const versionNeeded = readU16LE(bytes, pos + 6);
    const flags = readU16LE(bytes, pos + 8);
    const method = readU16LE(bytes, pos + 10);
    const crc = readU32LE(bytes, pos + 16);
    const compSize = readU32LE(bytes, pos + 20);
    const uncompSize = readU32LE(bytes, pos + 24);
    const nameLen = readU16LE(bytes, pos + 28);
    const extraLen = readU16LE(bytes, pos + 30);
    const commentLen = readU16LE(bytes, pos + 32);
    const diskStart = readU16LE(bytes, pos + 34);
    const externalAttrs = readU32LE(bytes, pos + 38);
    const localHeaderOff = readU32LE(bytes, pos + 42);

    if (pos + 46 + nameLen + extraLen + commentLen > cdEnd) {
      throw new Error('Metadatos de entrada ZIP truncados');
    }
    if (diskStart !== 0) {
      throw new Error('Entrada ZIP multidisco no permitida');
    }
    if (strictDraft03 && commentLen !== 0) {
      throw new Error('Comentarios por entrada ZIP no permitidos');
    }
    if (strictDraft03 && (nameLen === 0 || nameLen > maxNameLen)) {
      throw new Error(`Longitud de nombre ZIP fuera de rango (1..${maxNameLen})`);
    }
    if (strictDraft03 && versionNeeded > 20) {
      throw new Error(`Version ZIP requerida no soportada (${versionNeeded / 10})`);
    }

    // Reject encryption (bit 0, bit 6, bit 13) or unsupported methods
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0 || (flags & 0x2000) !== 0 || method === 99) {
      throw new Error('Entradas ZIP cifradas no permitidas');
    }
    if ((flags & 0x0008) !== 0 && !opts.allowDataDescriptor) {
      throw new Error('Data descriptor ZIP (bit 3) no permitido en modo estricto');
    }
    const allowedFlagMask = (opts.allowDataDescriptor ? 0x0008 : 0) | 0x0806;
    if ((flags & ~allowedFlagMask) !== 0) {
      throw new Error(`Flags ZIP no soportados (0x${flags.toString(16)})`);
    }
    if (method !== 0 && method !== 8) {
      throw new Error(`Metodo de compresion ZIP no soportado (${method})`);
    }
    if (
      compSize === 0xffffffff ||
      uncompSize === 0xffffffff ||
      localHeaderOff === 0xffffffff
    ) {
      throw new Error('Campos ZIP64 no permitidos');
    }

    const extraBytes = bytes.subarray(pos + 46 + nameLen, pos + 46 + nameLen + extraLen);
    if (strictDraft03 && extraLen > 0) {
      validateZipExtraFields(extraBytes, `entrada #${idx}`);
    }

    const nameBytes = bytes.subarray(pos + 46, pos + 46 + nameLen);
    if (strictDraft03) {
      for (let k = 0; k < nameBytes.length; k++) {
        if (nameBytes[k] >= 0x80) {
          throw new Error('Los nombres de entrada en paquetes Draft 0.3 deben ser ASCII exactos');
        }
      }
    }
    const rawName = decodeUtf8Strict(nameBytes, `nombre de entrada #${idx}`);

    // Reject symlinks and non-regular POSIX/DOS attributes
    const host = madeBy >>> 8;
    const unixMode = (externalAttrs >>> 16) & 0o170000;
    if (unixMode === 0o120000) {
      throw new Error(`Enlaces simbolicos (symlinks) prohibidos en archivo ZIP: ${rawName}`);
    }
    if (host === 3 || unixMode !== 0) {
      if (unixMode !== 0 && unixMode !== 0o100000 && !(unixMode === 0o040000 && opts.allowDirectories)) {
        throw new Error(`Tipo de archivo POSIX especial prohibido en ZIP (0o${unixMode.toString(8)}): ${rawName}`);
      }
    }

    const isDir = rawName.endsWith('/') || (externalAttrs & 0x10) !== 0 || unixMode === 0o040000;
    if (isDir && !opts.allowDirectories) {
      throw new Error(`Directorios o atributo de directorio no permitido en paquete: ${rawName}`);
    }
    if (isDir && (compSize !== 0 || uncompSize !== 0)) {
      throw new Error(`Entrada de directorio con carga no vacia: ${rawName}`);
    }

    assertSafeArchivePath(rawName, {
      allowTrailingSlash: opts.allowDirectories,
      rejectNestedArchives: true,
    });

    const folded = rawName.normalize('NFC').toLowerCase();
    if (entries.has(rawName)) {
      throw new Error(`Ruta duplicada en ZIP: ${rawName}`);
    }
    if (seenLower.has(folded)) {
      throw new Error(`Rutas duplicadas o colision de mayusculas: ${rawName}`);
    }
    seenLower.add(folded);

    if (method === 0 && compSize !== uncompSize) {
      throw new Error(`Entrada STORED con tamanos desiguales en ${rawName}`);
    }

    const maxEntry = opts.maxEntryBytesByPath?.(rawName);
    if (maxEntry !== undefined && uncompSize > maxEntry) {
      throw new Error(`Entrada '${rawName}' excede el limite declarado de ${maxEntry} bytes`);
    }

    claimedTotalUncompressed += uncompSize;
    if (claimedTotalUncompressed > opts.maxTotalUncompressedBytes) {
      throw new Error('Tamano descomprimido declarado supera el limite permitido');
    }

    const entryObj: StrictZipEntry = {
      path: rawName,
      isDir,
      method,
      flags,
      crc32: crc,
      compressedSize: compSize,
      uncompressedSize: uncompSize,
      localHeaderOffset: localHeaderOff,
      dataOffset: 0,
      externalAttrs,
    };
    entries.set(rawName, entryObj);
    cdRows.push({ entry: entryObj, nameBytes, versionNeeded });

    pos += 46 + nameLen + extraLen + commentLen;
  }

  if (pos !== cdEnd) {
    throw new Error('Longitud de directorio central ZIP inconsistente');
  }

  // Validate Local File Headers in file-offset order
  cdRows.sort((a, b) => a.entry.localHeaderOffset - b.entry.localHeaderOffset);
  let expectOffset = 0;

  for (const row of cdRows) {
    const m = row.entry;
    if (strictDraft03 && m.localHeaderOffset !== expectOffset) {
      throw new Error(
        `Hueco, solape o bytes previos no referenciados antes de '${m.path}' (offset ${m.localHeaderOffset} != ${expectOffset})`
      );
    }
    if (m.localHeaderOffset + 30 > cdOffset) {
      throw new Error(`Local File Header fuera de rango para ${m.path}`);
    }
    if (readU32LE(bytes, m.localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Firma Local File Header invalida para ${m.path}`);
    }

    const lfhFlags = readU16LE(bytes, m.localHeaderOffset + 6);
    const lfhMethod = readU16LE(bytes, m.localHeaderOffset + 8);
    const lfhCrc = readU32LE(bytes, m.localHeaderOffset + 14);
    const lfhCompSize = readU32LE(bytes, m.localHeaderOffset + 18);
    const lfhUncompSize = readU32LE(bytes, m.localHeaderOffset + 22);
    const lfhNameLen = readU16LE(bytes, m.localHeaderOffset + 26);
    const lfhExtraLen = readU16LE(bytes, m.localHeaderOffset + 28);

    if (lfhNameLen !== row.nameBytes.length) {
      throw new Error(`Inconsistencia de longitud de ruta entre CD y LFH: ${m.path}`);
    }
    const dataOffset = m.localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
    if (dataOffset > cdOffset || dataOffset + m.compressedSize > cdOffset) {
      throw new Error(`Datos comprimidos truncados o fuera de limites: ${m.path}`);
    }
    if (strictDraft03 && lfhExtraLen > 0) {
      validateZipExtraFields(
        bytes.subarray(m.localHeaderOffset + 30 + lfhNameLen, dataOffset),
        m.path
      );
    }

    const lfhNameBytes = bytes.subarray(
      m.localHeaderOffset + 30,
      m.localHeaderOffset + 30 + lfhNameLen
    );
    for (let k = 0; k < row.nameBytes.length; k++) {
      if (lfhNameBytes[k] !== row.nameBytes[k]) {
        throw new Error(`Inconsistencia de ruta entre CD y LFH en ${m.path}`);
      }
    }
    if (lfhFlags !== m.flags || lfhMethod !== m.method) {
      throw new Error(`Inconsistencia de flags/metodo entre CD y LFH en ${m.path}`);
    }
    if ((m.flags & 0x0008) !== 0) {
      const zeroOrMatch =
        (lfhCrc === 0 && lfhCompSize === 0 && lfhUncompSize === 0) ||
        (lfhCrc === m.crc32 &&
          lfhCompSize === m.compressedSize &&
          lfhUncompSize === m.uncompressedSize);
      if (strictDraft03 && !zeroOrMatch) {
        throw new Error(`Inconsistencia de tamano/CRC en LFH con data descriptor en ${m.path}`);
      }
    } else if (
      lfhCrc !== m.crc32 ||
      lfhCompSize !== m.compressedSize ||
      lfhUncompSize !== m.uncompressedSize
    ) {
      throw new Error(`Inconsistencia de tamano/CRC entre CD y LFH en ${m.path}`);
    }

    let rangeEnd = dataOffset + m.compressedSize;
    if (strictDraft03 && (m.flags & 0x0008) !== 0) {
      if (rangeEnd + 4 <= cdOffset && readU32LE(bytes, rangeEnd) === 0x08074b50) {
        rangeEnd += 4;
      }
      if (rangeEnd + 12 > cdOffset) {
        throw new Error(`Data descriptor truncado para ${m.path}`);
      }
      if (
        readU32LE(bytes, rangeEnd) !== m.crc32 ||
        readU32LE(bytes, rangeEnd + 4) !== m.compressedSize ||
        readU32LE(bytes, rangeEnd + 8) !== m.uncompressedSize
      ) {
        throw new Error(`Data descriptor inconsistente con CD en ${m.path}`);
      }
      rangeEnd += 12;
    }

    if (occupied.some(([start, end]) => m.localHeaderOffset < end && rangeEnd > start)) {
      throw new Error(`Entradas ZIP solapadas: ${m.path}`);
    }
    occupied.push([m.localHeaderOffset, rangeEnd]);
    m.dataOffset = dataOffset;
    expectOffset = rangeEnd;
  }

  if (strictDraft03 && expectOffset !== cdOffset) {
    throw new Error('Bytes no referenciados antes del directorio central ZIP');
  }

  return new BoundedZipArchive(bytes, entries, opts.maxTotalUncompressedBytes, strictDraft03);
}

export interface CanonicalZipInputEntry {
  path: string;
  data: Uint8Array | string;
}

/**
 * Deterministic canonical ZIP builder:
 * - Fixed member order (caller order or sorted)
 * - Fixed DOS epoch timestamp (1980-01-01 00:00:00)
 * - Fixed POSIX regular file mode 0644
 * - Flags = 0 for ASCII paths (per Draft 0.3 write_canonical), UTF-8 bit 11 only when needed
 */
export async function buildCanonicalZip(
  inputs: CanonicalZipInputEntry[],
  opts: { sortEntries?: boolean; compress?: boolean } = {}
): Promise<Uint8Array> {
  const seen = new Set<string>();
  const prepared: Array<{ path: string; nameBytes: Uint8Array; raw: Uint8Array; isAscii: boolean }> = [];

  for (const item of inputs) {
    assertSafeArchivePath(item.path, { allowTrailingSlash: false, rejectNestedArchives: true });
    const low = item.path.toLowerCase();
    if (seen.has(low)) {
      throw new Error(`Ruta duplicada al construir ZIP canonico: ${item.path}`);
    }
    seen.add(low);
    const raw = typeof item.data === 'string' ? utf8Enc.encode(item.data) : new Uint8Array(item.data);
    const nameBytes = utf8Enc.encode(item.path);
    const isAscii = nameBytes.every((b) => b < 0x80);
    prepared.push({
      path: item.path,
      nameBytes,
      raw,
      isAscii,
    });
  }

  if (opts.sortEntries) {
    prepared.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  const useDeflate = opts.compress !== false && typeof CompressionStream !== 'undefined';
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  // Fixed DOS date: 1980-01-01 (0x0021), time: 00:00:00 (0x0000)
  const DOS_TIME = 0x0000;
  const DOS_DATE = 0x0021;
  const UTF8_FLAG = 0x0800;
  const UNIX_FILE_ATTRS = (0o100644 << 16) >>> 0;

  for (const entry of prepared) {
    const crc = crc32(entry.raw);
    let comp = entry.raw;
    let method = 0;
    if (useDeflate && entry.raw.length > 32) {
      const deflated = await deflateRawDeterministic(entry.raw);
      if (deflated.length < entry.raw.length) {
        comp = deflated;
        method = 8;
      }
    }
    const flags = entry.isAscii ? 0 : UTF8_FLAG;

    const lfh = new Uint8Array(30 + entry.nameBytes.length);
    writeU32LE(lfh, 0, 0x04034b50);
    writeU16LE(lfh, 4, 20);
    writeU16LE(lfh, 6, flags);
    writeU16LE(lfh, 8, method);
    writeU16LE(lfh, 10, DOS_TIME);
    writeU16LE(lfh, 12, DOS_DATE);
    writeU32LE(lfh, 14, crc);
    writeU32LE(lfh, 18, comp.length);
    writeU32LE(lfh, 22, entry.raw.length);
    writeU16LE(lfh, 26, entry.nameBytes.length);
    writeU16LE(lfh, 28, 0);
    lfh.set(entry.nameBytes, 30);

    const cdh = new Uint8Array(46 + entry.nameBytes.length);
    writeU32LE(cdh, 0, 0x02014b50);
    writeU16LE(cdh, 4, 0x031e); // Unix + PKZIP 3.0
    writeU16LE(cdh, 6, 20);
    writeU16LE(cdh, 8, flags);
    writeU16LE(cdh, 10, method);
    writeU16LE(cdh, 12, DOS_TIME);
    writeU16LE(cdh, 14, DOS_DATE);
    writeU32LE(cdh, 16, crc);
    writeU32LE(cdh, 20, comp.length);
    writeU32LE(cdh, 24, entry.raw.length);
    writeU16LE(cdh, 28, entry.nameBytes.length);
    writeU16LE(cdh, 30, 0);
    writeU16LE(cdh, 32, 0);
    writeU16LE(cdh, 34, 0);
    writeU16LE(cdh, 36, 0);
    writeU32LE(cdh, 38, UNIX_FILE_ATTRS);
    writeU32LE(cdh, 42, offset);
    cdh.set(entry.nameBytes, 46);

    localParts.push(lfh, comp);
    cdParts.push(cdh);
    offset += lfh.length + comp.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const p of cdParts) cdSize += p.length;

  const eocd = new Uint8Array(22);
  writeU32LE(eocd, 0, 0x06054b50);
  writeU16LE(eocd, 4, 0);
  writeU16LE(eocd, 6, 0);
  writeU16LE(eocd, 8, prepared.length);
  writeU16LE(eocd, 10, prepared.length);
  writeU32LE(eocd, 12, cdSize);
  writeU32LE(eocd, 16, cdOffset);
  writeU16LE(eocd, 20, 0);

  const totalLen = offset + cdSize + eocd.length;
  const out = new Uint8Array(totalLen);
  let cursor = 0;
  for (const p of localParts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  for (const p of cdParts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  out.set(eocd, cursor);
  return out;
}

/**
 * Strict JSON parser:
 * - Rejects UTF-8 BOM
 * - Decodes Uint8Array using fatal UTF-8
 * - Rejects duplicate object keys at every depth
 * - Rejects unpaired UTF-16 surrogates
 * - Enforces maximum nesting depth
 */
export function parseStrictJson(input: string | Uint8Array, maxDepth = 32): unknown {
  if (input instanceof Uint8Array) {
    if (input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
      throw new Error('UTF-8 BOM prohibido en JSON');
    }
  } else if (input.startsWith('\uFEFF')) {
    throw new Error('UTF-8 BOM prohibido en JSON');
  }
  const text = typeof input === 'string' ? input : decodeUtf8Strict(input, 'JSON');
  let i = 0;
  const len = text.length;

  function skipWs() {
    while (i < len) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) i++;
      else break;
    }
  }

  function parseString(): string {
    if (text[i] !== '"') throw new Error(`JSON invalido en posicion ${i}`);
    const start = i;
    i++;
    while (i < len) {
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        i++;
        const decoded = JSON.parse(text.slice(start, i)) as string;
        if (hasUnpairedSurrogate(decoded)) {
          throw new Error('Surrogate UTF-16 sin pareja prohibido en JSON');
        }
        return decoded;
      }
      if (c === 0x5c) {
        i += 2;
        continue;
      }
      if (c < 0x20) {
        throw new Error('Caracter de control no escapado en cadena JSON');
      }
      i++;
    }
    throw new Error('Cadena JSON sin cerrar');
  }

  function parseValue(depth: number): unknown {
    skipWs();
    if (i >= len) throw new Error('Fin inesperado de JSON');
    const ch = text[i];
    if (ch === '{') {
      if (depth + 1 > maxDepth) {
        throw new Error(`Profundidad JSON excede el limite de ${maxDepth}`);
      }
      i++;
      const obj: Record<string, unknown> = {};
      const seenKeys = new Set<string>();
      skipWs();
      if (text[i] === '}') {
        i++;
        return obj;
      }
      while (true) {
        skipWs();
        const key = parseString();
        if (seenKeys.has(key)) {
          throw new Error(`Clave JSON duplicada prohibida: "${key}"`);
        }
        seenKeys.add(key);
        skipWs();
        if (text[i] !== ':') throw new Error(`Se esperaba ':' tras clave "${key}"`);
        i++;
        obj[key] = parseValue(depth + 1);
        skipWs();
        if (text[i] === '}') {
          i++;
          return obj;
        }
        if (text[i] !== ',') throw new Error(`Se esperaba ',' o '}' en objeto JSON`);
        i++;
      }
    }
    if (ch === '[') {
      if (depth + 1 > maxDepth) {
        throw new Error(`Profundidad JSON excede el limite de ${maxDepth}`);
      }
      i++;
      const arr: unknown[] = [];
      skipWs();
      if (text[i] === ']') {
        i++;
        return arr;
      }
      while (true) {
        arr.push(parseValue(depth + 1));
        skipWs();
        if (text[i] === ']') {
          i++;
          return arr;
        }
        if (text[i] !== ',') throw new Error(`Se esperaba ',' o ']' en arreglo JSON`);
        i++;
      }
    }
    if (depth > maxDepth) {
      throw new Error(`Profundidad JSON excede el limite de ${maxDepth}`);
    }
    if (ch === '"') {
      return parseString();
    }
    if (text.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return null;
    }
    const numMatch = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (numMatch) {
      i += numMatch[0].length;
      const n = Number(numMatch[0]);
      if (!Number.isFinite(n)) throw new Error('Numero JSON fuera de rango');
      return n;
    }
    throw new Error(`Token JSON inesperado en posicion ${i}`);
  }

  const result = parseValue(0);
  skipWs();
  if (i !== len) {
    throw new Error(`Contenido sobrante tras JSON en posicion ${i}`);
  }
  return result;
}
