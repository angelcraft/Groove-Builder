/**
 * Raw ZIP binary header inspection, bounded streaming decompression,
 * strict duplicate-key UTF-8 JSON parser, and deterministic canonical ZIP writer.
 *
 * Aligned with docs/GROOVE_PROFILE_DRAFT_02.md & COORDINATION_REVIEW.md.
 */

const utf8Fatal = new TextDecoder('utf-8', { fatal: true });
const utf8Enc = new TextEncoder();

const DOS_RESERVED_BASENAMES = new Set([
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

export function assertSafeArchivePath(
  rawPath: string,
  opts: { allowTrailingSlash?: boolean; rejectNestedArchives?: boolean } = {}
): string {
  if (!rawPath) {
    throw new Error('Ruta vacia en archivo ZIP');
  }
  for (let i = 0; i < rawPath.length; i++) {
    const code = rawPath.charCodeAt(i);
    if (code < 32 || code === 127) {
      throw new Error(`Caracter de control prohibido en ruta ZIP: ${rawPath}`);
    }
  }
  if (rawPath.includes('\\')) {
    throw new Error(`Barra invertida prohibida en ruta ZIP: ${rawPath}`);
  }
  if (rawPath.startsWith('/') || /^[A-Za-z]:/.test(rawPath)) {
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
    const baseNoExt = seg.split('.', 1)[0].toLowerCase();
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

export class BoundedZipArchive {
  private readonly bytes: Uint8Array;
  private readonly entries: Map<string, StrictZipEntry>;
  private readonly maxTotalUncompressedBytes: number;
  private totalDecompressedSoFar = 0;

  constructor(
    bytes: Uint8Array,
    entries: Map<string, StrictZipEntry>,
    maxTotalUncompressedBytes: number
  ) {
    this.bytes = bytes;
    this.entries = entries;
    this.maxTotalUncompressedBytes = maxTotalUncompressedBytes;
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

    const remainingGlobal = this.maxTotalUncompressedBytes - this.totalDecompressedSoFar;
    const limit =
      maxEntryBytes !== undefined ? Math.min(maxEntryBytes, remainingGlobal) : remainingGlobal;
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
      out = await inflateRawBounded(compressedSlice, limit, path);
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
  label: string
): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    const copy = new Uint8Array(compressed);
    const writePromise = writer.write(copy).then(() => writer.close());

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
      await reader.cancel().catch(() => {});
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
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 22) {
    throw new Error('Archivo ZIP truncado o demasiado pequeno');
  }
  if (bytes.byteLength > opts.maxCompressedBytes) {
    throw new Error(`Archivo ZIP supera el limite de ${opts.maxCompressedBytes} bytes`);
  }

  // Locate End of Central Directory (0x06054b50) within last 65557 bytes
  const minEocdOff = Math.max(0, bytes.byteLength - 65557);
  let eocdOff = -1;
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
    diskNum !== 0 ||
    cdDisk !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  ) {
    throw new Error('Archivos ZIP multidisco o ZIP64 no soportados');
  }
  if (totalEntries > opts.maxEntries) {
    throw new Error(`Demasiadas entradas ZIP (${totalEntries} > max ${opts.maxEntries})`);
  }
  if (cdOffset + cdSize > eocdOff) {
    throw new Error('Directorio central ZIP truncado o fuera de limites');
  }

  const entries = new Map<string, StrictZipEntry>();
  const seenLower = new Set<string>();
  let claimedTotalUncompressed = 0;
  let pos = cdOffset;
  const cdEnd = cdOffset + cdSize;

  for (let idx = 0; idx < totalEntries; idx++) {
    if (pos + 46 > cdEnd) {
      throw new Error('Entrada de directorio central ZIP truncada');
    }
    const sig = readU32LE(bytes, pos);
    if (sig !== 0x02014b50) {
      throw new Error('Firma de directorio central ZIP invalida');
    }

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

    // Reject encryption (bit 0 or bit 6) or unsupported methods
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0 || method === 99) {
      throw new Error('Entradas ZIP cifradas no permitidas');
    }
    if ((flags & 0x0008) !== 0 && !opts.allowDataDescriptor) {
      throw new Error('Data descriptor ZIP (bit 3) no permitido en modo estricto');
    }
    // Reject unsupported flags outside {bit 1/2 deflate opts, bit 3 optional, bit 11 UTF-8}
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

    // Reject symlinks and non-regular POSIX file types (except dir when allowed)
    const unixMode = (externalAttrs >>> 16) & 0o170000;
    if (unixMode === 0o120000) {
      throw new Error('Enlaces simbolicos (symlinks) prohibidos en archivo ZIP');
    }
    if (
      unixMode !== 0 &&
      unixMode !== 0o100000 &&
      unixMode !== 0o040000
    ) {
      throw new Error(`Tipo de archivo POSIX especial prohibido en ZIP (0o${unixMode.toString(8)})`);
    }

    const nameBytes = bytes.subarray(pos + 46, pos + 46 + nameLen);
    const rawName = decodeUtf8Strict(nameBytes, `nombre de entrada #${idx}`);
    const isDir = rawName.endsWith('/') || (externalAttrs & 0x10) !== 0 || unixMode === 0o040000;
    if (isDir && !opts.allowDirectories) {
      throw new Error(`Directorios no permitidos en paquete: ${rawName}`);
    }
    if (isDir && (compSize !== 0 || uncompSize !== 0)) {
      throw new Error(`Entrada de directorio con carga no vacia: ${rawName}`);
    }

    assertSafeArchivePath(rawName, {
      allowTrailingSlash: opts.allowDirectories,
      rejectNestedArchives: true,
    });

    const lower = rawName.toLowerCase();
    if (seenLower.has(lower)) {
      throw new Error(`Rutas duplicadas o colision de mayusculas: ${rawName}`);
    }
    seenLower.add(lower);

    // Inspect matching Local File Header BEFORE decompression
    if (localHeaderOff + 30 > cdOffset) {
      throw new Error(`Local File Header fuera de rango para ${rawName}`);
    }
    if (readU32LE(bytes, localHeaderOff) !== 0x04034b50) {
      throw new Error(`Firma Local File Header invalida para ${rawName}`);
    }

    const lfhFlags = readU16LE(bytes, localHeaderOff + 6);
    const lfhMethod = readU16LE(bytes, localHeaderOff + 8);
    const lfhCrc = readU32LE(bytes, localHeaderOff + 14);
    const lfhCompSize = readU32LE(bytes, localHeaderOff + 18);
    const lfhUncompSize = readU32LE(bytes, localHeaderOff + 22);
    const lfhNameLen = readU16LE(bytes, localHeaderOff + 26);
    const lfhExtraLen = readU16LE(bytes, localHeaderOff + 28);

    if (lfhNameLen !== nameLen) {
      throw new Error(`Inconsistencia de longitud de ruta entre CD y LFH: ${rawName}`);
    }
    const dataOffset = localHeaderOff + 30 + lfhNameLen + lfhExtraLen;
    if (dataOffset > cdOffset || dataOffset + compSize > cdOffset) {
      throw new Error(`Datos comprimidos truncados o fuera de limites: ${rawName}`);
    }
    const lfhNameBytes = bytes.subarray(localHeaderOff + 30, localHeaderOff + 30 + lfhNameLen);
    for (let k = 0; k < nameLen; k++) {
      if (lfhNameBytes[k] !== nameBytes[k]) {
        throw new Error(`Inconsistencia de ruta entre CD y LFH en ${rawName}`);
      }
    }
    if (lfhFlags !== flags || lfhMethod !== method) {
      throw new Error(`Inconsistencia de flags/metodo entre CD y LFH en ${rawName}`);
    }
    if ((flags & 0x0008) === 0) {
      if (lfhCrc !== crc || lfhCompSize !== compSize || lfhUncompSize !== uncompSize) {
        throw new Error(`Inconsistencia de tamano/CRC entre CD y LFH en ${rawName}`);
      }
    }

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

    entries.set(rawName, {
      path: rawName,
      isDir,
      method,
      flags,
      crc32: crc,
      compressedSize: compSize,
      uncompressedSize: uncompSize,
      localHeaderOffset: localHeaderOff,
      dataOffset,
      externalAttrs,
    });

    pos += 46 + nameLen + extraLen + commentLen;
  }

  if (pos !== cdEnd) {
    throw new Error('Longitud de directorio central ZIP inconsistente');
  }

  return new BoundedZipArchive(bytes, entries, opts.maxTotalUncompressedBytes);
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
 * - Zero dynamic timestamps or environment-dependent headers
 */
export async function buildCanonicalZip(
  inputs: CanonicalZipInputEntry[],
  opts: { sortEntries?: boolean; compress?: boolean } = {}
): Promise<Uint8Array> {
  const seen = new Set<string>();
  const prepared: Array<{ path: string; nameBytes: Uint8Array; raw: Uint8Array }> = [];

  for (const item of inputs) {
    assertSafeArchivePath(item.path, { allowTrailingSlash: false, rejectNestedArchives: true });
    const low = item.path.toLowerCase();
    if (seen.has(low)) {
      throw new Error(`Ruta duplicada al construir ZIP canonico: ${item.path}`);
    }
    seen.add(low);
    const raw = typeof item.data === 'string' ? utf8Enc.encode(item.data) : new Uint8Array(item.data);
    prepared.push({
      path: item.path,
      nameBytes: utf8Enc.encode(item.path),
      raw,
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

    const lfh = new Uint8Array(30 + entry.nameBytes.length);
    writeU32LE(lfh, 0, 0x04034b50);
    writeU16LE(lfh, 4, 20);
    writeU16LE(lfh, 6, UTF8_FLAG);
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
    writeU16LE(cdh, 8, UTF8_FLAG);
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
 * - Decodes Uint8Array using fatal UTF-8
 * - Rejects duplicate object keys at every depth
 * - Enforces maximum nesting depth
 */
export function parseStrictJson(input: string | Uint8Array, maxDepth = 32): unknown {
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
        return JSON.parse(text.slice(start, i)) as string;
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
    if (depth > maxDepth) {
      throw new Error(`Profundidad JSON excede el limite de ${maxDepth}`);
    }
    skipWs();
    if (i >= len) throw new Error('Fin inesperado de JSON');
    const ch = text[i];
    if (ch === '{') {
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
