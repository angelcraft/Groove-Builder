import {
  canonicalGame,
  CUE_BY_NAME,
  CUE_FNS,
  CUE_SHORT,
  findCueDef,
  type GameId,
  JINGLE_MAX,
  JINGLE_MIN,
  LAYOUT_OFF,
  MAX_EVENTS,
  MAX_GAMES,
  PROLOGUE_MAX,
  THE_A_WORDS,
  type TheAWord,
  TITLE_MAX,
  TPB,
} from './cues.ts';
import {
  isValidAnimNameContract,
  isValidLayoutContract,
  isValidMatchContract,
  isValidPrologueContract,
  MAX_DEFS,
  MAX_EXPANSION_WORK,
  MAX_FILE_BYTES,
  MAX_LINE_BYTES,
  MAX_LOOP_CALL_DEPTH,
  MAX_SOURCE_LINES,
  MAX_TICK,
  MAX_TOKENS,
  STRING_POOL_MAX,
  validateCueArgsContract,
} from './engineContract.ts';

export type EventOp = 'call' | 'switch' | 'fade' | 'anim';

export interface TimelineEvent {
  id: string;
  tick: number;
  op: EventOp;
  game?: GameId;
  fn?: number;
  args?: [number, number, number, number];
  word?: TheAWord | null;
  tag?: string | null;
  style?: number; // -1 = cut/hard, 0..2 = transition style
  sub?: number; // 1 | 2
  fadeLen?: number;
  alpha?: number;
  layout?: number;
  animName?: string;
}

export interface Timeline {
  bgm: number;
  start: number;
  translen: number;
  swing: number;
  results: 0 | 1; // 1 = native, 0 = exit/custom
  match: [number, number, number];
  end: number;
  endFade: number;
  finish: number;
  first: GameId | null;
  title: string;
  prologue: string;
  jingle: number; // -1 if unset, else 0x158..0x16C
  events: TimelineEvent[];
}

export class GtfError extends Error {
  line?: number;
  path?: string;
  constructor(message: string, line?: number, path?: string) {
    const loc = path && line ? `${path}:${line}: ` : line ? `linea ${line}: ` : path ? `${path}: ` : '';
    super(loc + message);
    this.name = 'GtfError';
    this.line = line;
    this.path = path;
  }
}

export interface ParseAndEmitOptions {
  runtimeMode?: boolean;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
  tick?: number;
  eventId?: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
  gamesUsed: GameId[];
  callCount: number;
  switchCount: number;
  fadeCount: number;
  animCount: number;
}

let eventCounter = 1;
export function nextEventId(prefix = 'ev'): string {
  eventCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${eventCounter}`;
}

export function createDefaultTimeline(): Timeline {
  return {
    bgm: 139,
    start: 0,
    translen: 960,
    swing: 120,
    results: 0,
    match: [-1, 9, 4],
    end: 32 * TPB,
    endFade: 960,
    finish: 36 * TPB,
    first: 'CARS',
    title: 'Remix 21',
    prologue: 'type_19',
    jingle: 0x163,
    events: [],
  };
}

export function cloneTimeline(tl: Timeline): Timeline {
  return {
    ...tl,
    match: [...tl.match] as [number, number, number],
    events: tl.events.map((e) => ({
      ...e,
      args: e.args ? ([...e.args] as [number, number, number, number]) : undefined,
    })),
  };
}

export function gamesUsedInTimeline(tl: Timeline): GameId[] {
  const out: GameId[] = [];
  const add = (g?: GameId | null) => {
    if (g && !out.includes(g)) out.push(g);
  };
  add(tl.first);
  for (const ev of tl.events) {
    if (ev.op === 'call' || ev.op === 'switch' || ev.op === 'anim') {
      add(ev.game);
    }
  }
  return out;
}

const RESERVED = new Set([
  'title',
  'prologue',
  'jingle',
  'start',
  'match',
  'end',
  'finish',
  'results',
  'rest',
  'at',
  'switch',
  'loop',
  'def',
  'call',
  'fade',
  'anim',
  'first',
  'bgm',
  'translen',
  'swing',
  'ticks_per_beat',
  'cue',
  'hard',
  'cut',
  'tempo',
  'gtlm',
]);

export function parseIntStrict(s: string): number {
  let t = s.trim();
  if (!t) throw new Error('numero vacio');
  let neg = false;
  if (t[0] === '+' || t[0] === '-') {
    neg = t[0] === '-';
    t = t.slice(1);
    if (!t) throw new Error(s);
  }
  let v: number;
  if (t.toLowerCase().startsWith('0x')) {
    if (t.length === 2 || !/^[0-9a-fA-F]+$/.test(t.slice(2))) throw new Error(s);
    v = parseInt(t.slice(2), 16);
  } else {
    if (!/^[0-9]+$/.test(t)) throw new Error(s);
    v = parseInt(t, 10);
  }
  if (neg) v = -v;
  if (v < -0x80000000 || v > 0x7fffffff) throw new Error('fuera de rango');
  return v;
}

export function isIntToken(s: string): boolean {
  try {
    parseIntStrict(s);
    return true;
  } catch {
    return false;
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

export function parseDuration(s: string, what = 'duracion'): number {
  const t = s;
  if (!t) throw new Error(`${what} vacia`);
  let ticks: bigint;
  if (/[tT]$/.test(t)) {
    ticks = BigInt(parseIntStrict(t.slice(0,-1)));
  } else if (/^(?:0x|\+0x)/i.test(t)) {
    throw new Error(`${what} invalida`);
  } else if (t.includes('/')) {
    const [a,b,...extra] = t.split('/');
    if (extra.length) throw new Error(`${what} invalida`);
    const n=BigInt(parseIntStrict(a)), d=BigInt(parseIntStrict(b));
    if (n<0n || d<=0n || (n*480n)%d) throw new Error(`${what} invalida`);
    ticks=n*480n/d;
  } else if (t.includes('.')) {
    if (!/^\+?(?:[0-9]+)?\.[0-9]+$/.test(t)) throw new Error(`${what} invalida`);
    const [whole,raw]=t.split('.'); const frac=raw.replace(/0+$/,'');
    if (frac.length>9) throw new Error(`${what} invalida`);
    const n=BigInt(parseIntStrict(whole || '0'));
    const scale=10n**BigInt(frac.length);
    const numerator=n*480n*scale+BigInt(frac || '0')*480n;
    if (numerator%scale) throw new Error(`${what} no cae en un tick entero`);
    ticks=numerator/scale;
  } else {
    if (!/^[+-]?[0-9]+$/.test(t)) throw new Error(`${what} invalida`);
    ticks=BigInt(parseIntStrict(t))*480n;
  }
  if (ticks<0n) throw new Error(`${what} no puede ser negativa`);
  if (ticks>BigInt(MAX_TICK)) throw new Error(`${what} fuera de rango`);
  return Number(ticks);
}

export function formatBeats(ticks: number): string {
  if (ticks === 0) return '0';
  const g = gcd(ticks, TPB);
  const num = ticks / g;
  const den = TPB / g;
  if (den === 1) return String(num);
  if (den === 2 || den === 4 || den === 8 || den === 5 || den === 10) {
    const val = ticks / TPB;
    return Number(val.toFixed(6)).toString();
  }
  if (den === 3 || den === 6 || den === 12) {
    return `${num}/${den}`;
  }
  return `${ticks}t`;
}

export function validName(s: string): boolean {
  return isValidAnimNameContract(s);
}

const textEncoder = new TextEncoder();

function utf8ByteLength(s: string): number {
  return textEncoder.encode(s).length;
}

function validateSourceBounds(source: string, path?: string, runtimeMode = false): string[] {
  if (runtimeMode && source.startsWith('\uFEFF')) {
    throw new GtfError('UTF-8 BOM no permitido en timeline runtime', 1, path);
  }
  const maxBytes = runtimeMode ? 60 * 1024 : MAX_FILE_BYTES;
  const bytes = utf8ByteLength(source);
  if (bytes === 0 || bytes > maxBytes) {
    throw new GtfError(`tamano de fuente invalido (1..${maxBytes} bytes)`, undefined, path);
  }
  const lines = source.split(/\r?\n/);
  if (source.endsWith('\n') && lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length > MAX_SOURCE_LINES) {
    throw new GtfError(`demasiadas lineas (max ${MAX_SOURCE_LINES})`, undefined, path);
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (utf8ByteLength(line) > MAX_LINE_BYTES) {
      throw new GtfError(`linea excede ${MAX_LINE_BYTES} bytes`, i + 1, path);
    }
    for (let j = 0; j < line.length; j++) {
      const code = line.charCodeAt(j);
      if ((code < 32 && code !== 9 && code !== 13) || code === 127) {
        throw new GtfError('byte de control invalido en linea', i + 1, path);
      }
    }
  }
  return lines;
}

function stripComment(raw: string): string {
  let inStr = false;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      out += ch;
      if (ch === '\\' && i + 1 < raw.length) {
        i += 1;
        out += raw[i];
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === '#' || (ch === '/' && i + 1 < raw.length && raw[i + 1] === '/')) {
      break;
    }
    out += ch;
  }
  if (inStr) throw new GtfError('comillas sin cerrar');
  return out.trim();
}

function tokenizeGtf(line: string, lineNo: number, path?: string): string[] {
  const toks: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && (line[i] === ' ' || line[i] === '\t' || line[i] === '\r')) i++;
    if (i >= line.length) break;
    if (line[i] === '"') {
      i++;
      let buf = '';
      let closed = false;
      while (i < line.length) {
        if (line[i] === '\\' && i + 1 < line.length) {
          i++;
          buf += line[i];
          i++;
          continue;
        }
        if (line[i] === '"') {
          i++;
          closed = true;
          break;
        }
        buf += line[i];
        i++;
      }
      if (!closed) throw new GtfError('comillas sin cerrar', lineNo, path);
      toks.push(buf);
    } else {
      const start = i;
      while (i < line.length && line[i] !== ' ' && line[i] !== '\t' && line[i] !== '\r') i++;
      toks.push(line.slice(start, i));
    }
  }
  return toks;
}

function pad4(a: number[]): [number, number, number, number] {
  return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 0];
}

function finalizeTimeline(
  tl: Timeline,
  path: string | undefined,
  autoEnd: boolean,
  runtimeMode = false
): void {
  if (runtimeMode && tl.results !== 0) {
    throw new GtfError('results native no permitido en paquete runtime', undefined, path);
  }
  if (!isValidMatchContract(tl.match)) {
    throw new GtfError('match fuera de rango (mundo -1..2, col 0..11, fila 0..4)', undefined, path);
  }
  if (!isValidPrologueContract(tl.prologue)) {
    throw new GtfError('prologue invalido (caracteres o ruta prohibida)', undefined, path);
  }
  const poolStrings = new Set<string>();
  for (const ev of tl.events) {
    if (ev.tag) poolStrings.add(ev.tag);
    if (ev.animName) poolStrings.add(ev.animName);
    if (ev.op === 'call' && ev.game && ev.fn !== undefined) {
      const args = ev.args ?? [0, 0, 0, 0];
      const check = validateCueArgsContract(ev.game, ev.fn, args);
      if (!check.ok) {
        throw new GtfError(check.reason ?? 'argumentos fuera del dominio verificado', undefined, path);
      }
    }
    if (ev.op === 'anim') {
      if (!ev.game || ev.layout === undefined || !isValidLayoutContract(ev.game, ev.layout)) {
        throw new GtfError(`layout no verificado para ${ev.game ?? '?'}`, undefined, path);
      }
      if (!ev.animName || !isValidAnimNameContract(ev.animName)) {
        throw new GtfError(`nombre de animacion invalido: ${ev.animName ?? ''}`, undefined, path);
      }
    }
    if (ev.op === 'fade' && ((ev.fadeLen ?? 0) < 0 || (ev.alpha ?? 0) < 0 || (ev.alpha ?? 0) > 1)) {
      throw new GtfError('fade invalido', undefined, path);
    }
  }
  let poolBytes = 0;
  for (const s of poolStrings) poolBytes += utf8ByteLength(s) + 1;
  if (poolBytes > STRING_POOL_MAX) {
    throw new GtfError(`pool de cadenas lleno (${poolBytes} > ${STRING_POOL_MAX})`, undefined, path);
  }
  if (tl.events.length === 0) {
    throw new GtfError('no hay eventos (hace falta al menos un cue)', undefined, path);
  }
  if (!tl.events.some((e) => e.op === 'call')) {
    throw new GtfError('no hay llamadas de cue', undefined, path);
  }
  const games = gamesUsedInTimeline(tl);
  if (games.length === 0) {
    throw new GtfError('no se usa ningun juego', undefined, path);
  }
  if (games.length > MAX_GAMES) {
    throw new GtfError(`mas de ${MAX_GAMES} juegos`, undefined, path);
  }
  if (!tl.first) {
    tl.first = games[0];
  }
  const last = tl.events[tl.events.length - 1].tick;
  if (autoEnd) {
    if (tl.end <= 0) tl.end = last + 4 * TPB;
    if (tl.finish < tl.end) tl.finish = tl.end + 4 * TPB;
  }
  if (
    tl.start < 0 ||
    tl.start > MAX_TICK ||
    tl.end <= 0 ||
    tl.end > MAX_TICK ||
    tl.finish < tl.end ||
    tl.finish > MAX_TICK ||
    tl.endFade < 0 ||
    tl.endFade > MAX_TICK
  ) {
    if (tl.end <= 0) throw new GtfError('falta end', undefined, path);
    if (tl.finish < tl.end) throw new GtfError('falta finish o es anterior a end', undefined, path);
    throw new GtfError('tick fuera de rango', undefined, path);
  }
  if (tl.start > tl.end) throw new GtfError('start es posterior a end', undefined, path);
  if (last > tl.end) {
    throw new GtfError(`hay eventos despues de end (${last} > ${tl.end})`, undefined, path);
  }
}

interface SrcLine {
  no: number;
  toks: string[];
}

function collectBlock(
  lines: SrcLine[],
  start: number,
  openNo: number,
  path: string | undefined,
  kind: string
): [SrcLine[], number] {
  const inner: SrcLine[] = [];
  let depth = 1;
  let i = start;
  while (i < lines.length) {
    const k = lines[i].toks[0].toLowerCase();
    if (k === 'loop' || k === 'def') {
      depth++;
      inner.push(lines[i]);
    } else if (k === 'end' && lines[i].toks.length === 1) {
      depth--;
      if (depth === 0) return [inner, i];
      inner.push(lines[i]);
    } else {
      inner.push(lines[i]);
    }
    i++;
  }
  throw new GtfError(`falta 'end' para cerrar ${kind} (abierto en linea ${openNo})`, openNo, path);
}

function parseCueLine(
  toks: string[],
  currentGame: GameId | null,
  lineNo: number,
  path?: string
): TimelineEvent {
  let gExplicit: GameId | null = null;
  let cueName = toks[0];
  const rest = toks.slice(1);
  for (const arg of rest) {
    if (/^[+-]?(?:0[xX][0-9a-fA-F]+|[0-9]+)$/.test(arg) && !isIntToken(arg)) {
      throw new GtfError('entero fuera de rango', lineNo, path);
    }
  }

  if (cueName.includes('.')) {
    const [gPart, cPart] = cueName.split('.', 2);
    gExplicit = canonicalGame(gPart);
    if (!gExplicit) throw new GtfError(`juego desconocido '${gPart}'`, lineNo, path);
    cueName = cPart;
  }

  // Raw hex address: 0x...
  if (cueName.toLowerCase().startsWith('0x') || (gExplicit && isIntToken(cueName))) {
    const g = gExplicit ?? currentGame;
    if (!g) throw new GtfError(`cue crudo ${cueName} necesita switch JUEGO o JUEGO.${cueName}`, lineNo, path);
    let fnOff: number;
    try {
      fnOff = parseIntStrict(cueName);
    } catch {
      throw new GtfError(`direccion de cue invalida '${cueName}'`, lineNo, path);
    }
    const kind = CUE_FNS.get(`${g}:${fnOff}`);
    if (kind === undefined) {
      throw new GtfError(`la funcion 0x${fnOff.toString(16).toUpperCase()} no es un cue permitido de ${g}`, lineNo, path);
    }
    let idx = 0;
    let word: TheAWord | null = null;
    if (kind === 1) {
      if (!rest.length) throw new GtfError(`${g} necesita una palabra (TEA|SODA|COCOA|AAA)`, lineNo, path);
      const w = rest[0].toUpperCase();
      if (!(THE_A_WORDS as readonly string[]).includes(w)) {
        throw new GtfError(`palabra invalida '${rest[0]}' (usa TEA|SODA|COCOA|AAA)`, lineNo, path);
      }
      word = w as TheAWord;
      idx = 1;
    }
    const args: number[] = [];
    while (idx < rest.length && args.length < 4 && isIntToken(rest[idx])) {
      args.push(parseIntStrict(rest[idx]));
      idx++;
    }
    if (kind === 1 && args.length > 0) {
      throw new GtfError(`word cue ${g} no acepta argumentos enteros`, lineNo, path);
    }
    let tag: string | null = null;
    if (idx < rest.length) {
      if (idx !== rest.length - 1 || (!validName(rest[idx]) && rest[idx] !== '-')) {
        throw new GtfError(`argumento o etiqueta invalida '${rest[idx]}'`, lineNo, path);
      }
      if (rest[idx] !== '-') tag = rest[idx];
    }
    const finalArgs = pad4(args);
    const contractCheck = validateCueArgsContract(g, fnOff, finalArgs);
    if (!contractCheck.ok) {
      throw new GtfError(contractCheck.reason ?? 'argumentos fuera del dominio verificado', lineNo, path);
    }
    return {
      id: nextEventId('cue'),
      tick: 0,
      op: 'call',
      game: g,
      fn: fnOff,
      args: finalArgs,
      word,
      tag,
    };
  }

  let cueDef;
  const gCtx = gExplicit ?? currentGame;
  if (gExplicit) {
    cueDef = CUE_BY_NAME.get(`${gExplicit}:${cueName.toLowerCase()}`);
    if (!cueDef) throw new GtfError(`cue desconocido '${cueName}' para ${gExplicit}`, lineNo, path);
  } else {
    if (gCtx && CUE_BY_NAME.has(`${gCtx}:${cueName.toLowerCase()}`)) {
      cueDef = CUE_BY_NAME.get(`${gCtx}:${cueName.toLowerCase()}`);
    } else {
      const cands = CUE_SHORT.get(cueName.toLowerCase()) ?? [];
      if (cands.length === 0) {
        throw new GtfError(`cue o instruccion desconocida '${cueName}'`, lineNo, path);
      }
      if (cands.length > 1) {
        const names = cands.map((c) => `${c.game}.${c.name}`).join(', ');
        throw new GtfError(`cue '${cueName}' es ambiguo sin switch (${names})`, lineNo, path);
      }
      if (!gCtx) {
        throw new GtfError(`cue '${cueName}' sin switch previo (usa switch ${cands[0].game} o ${cands[0].game}.${cueName})`, lineNo, path);
      }
      throw new GtfError(`cue '${cueName}' pertenece a ${cands[0].game}, no a ${gCtx} (usa ${cands[0].game}.${cueName})`, lineNo, path);
    }
  }

  if (!cueDef) throw new GtfError(`cue desconocido '${cueName}'`, lineNo, path);

  let idx = 0;
  let word = cueDef.word;
  if (cueDef.kind === 1 && rest.length > 0 && (THE_A_WORDS as readonly string[]).includes(rest[0].toUpperCase())) {
    word = rest[0].toUpperCase() as TheAWord;
    idx = 1;
  }
  const overrides: number[] = [];
  while (idx < rest.length && overrides.length < 4 && isIntToken(rest[idx])) {
    overrides.push(parseIntStrict(rest[idx]));
    idx++;
  }
  if (cueDef.kind === 1 && overrides.length > 0) {
    throw new GtfError(`word cue ${cueDef.game} no acepta argumentos enteros`, lineNo, path);
  }
  const finalArgs: [number, number, number, number] = overrides.length ? [0, 0, 0, 0] : [...cueDef.args];
  for (let k = 0; k < overrides.length; k++) {
    finalArgs[k] = overrides[k];
  }
  let tag: string | null = null;
  if (idx < rest.length) {
    if (idx !== rest.length - 1 || (!validName(rest[idx]) && rest[idx] !== '-')) {
      throw new GtfError(`argumento o etiqueta invalida '${rest[idx]}'`, lineNo, path);
    }
    if (rest[idx] !== '-') tag = rest[idx];
  }
  const contractCheck = validateCueArgsContract(cueDef.game, cueDef.fn, finalArgs);
  if (!contractCheck.ok) {
    throw new GtfError(contractCheck.reason ?? 'argumentos fuera del dominio verificado', lineNo, path);
  }
  return {
    id: nextEventId('cue'),
    tick: 0,
    op: 'call',
    game: cueDef.game,
    fn: cueDef.fn,
    args: finalArgs,
    word,
    tag,
  };
}

export function compileGtf(
  source: string,
  path = 'remix.gtf',
  options?: ParseAndEmitOptions
): Timeline {
  const runtimeMode = Boolean(options?.runtimeMode);
  const rawLines = validateSourceBounds(source, path, runtimeMode);
  const lines: SrcLine[] = [];
  let runtimeStartCount = 0;
  let runtimeResultsCount = 0;
  for (let i = 0; i < rawLines.length; i++) {
    let cleaned: string;
    try {
      cleaned = stripComment(rawLines[i]);
    } catch (e) {
      if (e instanceof GtfError) throw new GtfError(e.message, i + 1, path);
      throw e;
    }
    if (!cleaned) continue;
    const toks = tokenizeGtf(cleaned, i + 1, path);
    if (toks.length) {
      const kw = toks[0].toLowerCase();
      if (kw !== 'title' && toks.length > MAX_TOKENS) {
        throw new GtfError(`demasiados tokens en linea (max ${MAX_TOKENS})`, i + 1, path);
      }
      if (runtimeMode) {
        if (kw === 'force' || kw === 'disable') {
          throw new GtfError(`directiva '${toks[0]}' prohibida en paquete runtime`, i + 1, path);
        }
        if (kw === 'start') runtimeStartCount++;
        if (kw === 'results') runtimeResultsCount++;
      }
      lines.push({ no: i + 1, toks });
    }
  }
  if (runtimeMode) {
    if (runtimeStartCount === 0) {
      throw new GtfError('start explicito obligatorio en timeline runtime', undefined, path);
    }
    if (runtimeStartCount > 1) {
      throw new GtfError('start duplicado no permitido en timeline runtime', undefined, path);
    }
    if (runtimeResultsCount === 0) {
      throw new GtfError('results exit explicito obligatorio en timeline runtime', undefined, path);
    }
    if (runtimeResultsCount > 1) {
      throw new GtfError('results duplicado no permitido en timeline runtime', undefined, path);
    }
  }

  // Extract top-level defs
  const defs = new Map<string, SrcLine[]>();
  const body: SrcLine[] = [];
  let idx = 0;
  while (idx < lines.length) {
    const sl = lines[idx];
    if (sl.toks[0].toLowerCase() === 'def') {
      if (sl.toks.length !== 2 || !validName(sl.toks[1])) {
        throw new GtfError('def necesita un unico nombre valido (letras, numeros o _)', sl.no, path);
      }
      if (defs.size >= MAX_DEFS) {
        throw new GtfError(`demasiados defs (max ${MAX_DEFS})`, sl.no, path);
      }
      const name = sl.toks[1].toLowerCase();
      if (RESERVED.has(name.toLowerCase()) || canonicalGame(name)) {
        throw new GtfError(`'${name}' es una palabra reservada; elige otro nombre de def`, sl.no, path);
      }
      if (defs.has(name)) {
        throw new GtfError(`def '${name}' ya esta definido`, sl.no, path);
      }
      const [inner, endIdx] = collectBlock(lines, idx + 1, sl.no, path, 'def');
      for (const innerSl of inner) {
        if (innerSl.toks[0].toLowerCase() === 'def') {
          throw new GtfError('un def no puede ir anidado', innerSl.no, path);
        }
      }
      defs.set(name, inner);
      idx = endIdx + 1;
      continue;
    }
    body.push(sl);
    idx++;
  }

  const tl: Timeline = {
    bgm: 139,
    start: 0,
    translen: 960,
    swing: 120,
    results: 0,
    match: [-1, 9, 4],
    end: 0,
    endFade: 960,
    finish: 0,
    first: null,
    title: '',
    prologue: '',
    jingle: -1,
    events: [],
  };

  let clock = 0;
  let endSet = false;
  let finishSet = false;
  let loopDepth = 0;
  let work = 0;
  const callStack: string[] = [];

  const addEvent = (ev: TimelineEvent, lineNo: number) => {
    if (tl.events.length >= MAX_EVENTS) {
      throw new GtfError(`demasiados eventos (max ${MAX_EVENTS})`, lineNo, path);
    }
    tl.events.push(ev);
  };

  const emitBlock = (block: SrcLine[], currentGame: GameId | null): GameId | null => {
    let game = currentGame;
    let i = 0;
    while (i < block.length) {
      const sl = block[i];
      const toks = sl.toks;
      const k = toks[0].toLowerCase();
      work += 1;
      if (work > MAX_EXPANSION_WORK) {
        throw new GtfError(`limite de expansion (${MAX_EXPANSION_WORK})`, sl.no, path);
      }

      if (k === 'title') {
        if (toks.length < 2) throw new GtfError('title "texto"', sl.no, path);
        const txt = toks.slice(1).join(' ');
        if (utf8ByteLength(txt) > TITLE_MAX) throw new GtfError(`title demasiado largo (max ${TITLE_MAX} bytes)`, sl.no, path);
        tl.title = txt;
        i++;
        continue;
      }
      if (k === 'prologue') {
        if (toks.length < 2 || utf8ByteLength(toks[1]) > PROLOGUE_MAX || !isValidPrologueContract(toks[1])) {
          throw new GtfError('prologue type_XX|ruta invalida', sl.no, path);
        }
        tl.prologue = toks[1];
        i++;
        continue;
      }
      if (k === 'jingle') {
        if (toks.length < 2) throw new GtfError('jingle 0x158..0x16C', sl.no, path);
        let j: number;
        try {
          j = parseIntStrict(toks[1]);
        } catch {
          throw new GtfError(`jingle invalido '${toks[1]}'`, sl.no, path);
        }
        if (j < JINGLE_MIN || j > JINGLE_MAX) {
          throw new GtfError('jingle debe estar entre 0x158 y 0x16C', sl.no, path);
        }
        tl.jingle = j;
        i++;
        continue;
      }
      if (k === 'bgm') {
        if (toks.length < 2) throw new GtfError('bgm <numero>', sl.no, path);
        let v: number;
        try {
          v = parseIntStrict(toks[1]);
        } catch (e) {
          throw new GtfError(e instanceof Error ? e.message : String(e), sl.no, path);
        }
        if (v < 0 || v > 0xffff) throw new GtfError('bgm fuera de rango', sl.no, path);
        tl.bgm = v;
        i++;
        continue;
      }
      if (k === 'start') {
        if (toks.length < 2) throw new GtfError('start <pulsos>', sl.no, path);
        try {
          tl.start = parseDuration(toks[1], 'start');
        } catch (e) {
          throw new GtfError(e instanceof Error ? e.message : String(e), sl.no, path);
        }
        i++;
        continue;
      }
      if (k === 'translen') {
        if (toks.length < 2) throw new GtfError('translen <pulsos>', sl.no, path);
        let v: number;
        try {
          v = parseDuration(toks[1], 'translen');
        } catch (e) {
          throw new GtfError(e instanceof Error ? e.message : String(e), sl.no, path);
        }
        if (v < 0 || v > 7680) throw new GtfError('translen debe estar entre 0 y 16 pulsos', sl.no, path);
        tl.translen = v;
        i++;
        continue;
      }
      if (k === 'swing') {
        if (toks.length < 2) throw new GtfError('swing <ticks|pulsos>', sl.no, path);
        try {
          tl.swing = parseIntStrict(toks[1]);
        } catch (e) {
          throw new GtfError(e instanceof Error ? e.message : String(e), sl.no, path);
        }
        i++;
        continue;
      }
      if (k === 'results') {
        if (toks.length < 2) throw new GtfError('results native|exit|custom', sl.no, path);
        const r = toks[1].toLowerCase();
        if (r === 'native') {
          if (runtimeMode) {
            throw new GtfError('results native no permitido en paquete runtime', sl.no, path);
          }
          tl.results = 1;
        } else if (r === 'exit' || r === 'custom') {
          if (runtimeMode && (toks.length !== 2 || toks[1] !== 'exit')) {
            throw new GtfError(`results debe ser exactamente 'results exit' en paquete runtime`, sl.no, path);
          }
          tl.results = 0;
        } else {
          throw new GtfError('results debe ser native, exit o custom', sl.no, path);
        }
        i++;
        continue;
      }
      if (k === 'match') {
        if (runtimeMode) {
          throw new GtfError('directiva match prohibida en paquete runtime (el registro asigna el slot)', sl.no, path);
        }
        if (toks.length !== 4) throw new GtfError('match MUNDO COL FILA', sl.no, path);
        let parsedMatch: [number, number, number];
        try {
          parsedMatch = [parseIntStrict(toks[1]), parseIntStrict(toks[2]), parseIntStrict(toks[3])];
        } catch (e) {
          throw new GtfError(e instanceof Error ? e.message : String(e), sl.no, path);
        }
        if (!isValidMatchContract(parsedMatch)) {
          throw new GtfError('match fuera de rango (mundo -1..2, col 0..11, fila 0..4)', sl.no, path);
        }
        tl.match = parsedMatch;
        i++;
        continue;
      }
      if (k === 'first') {
        if (toks.length < 2) throw new GtfError('first JUEGO', sl.no, path);
        const g = canonicalGame(toks[1]);
        if (!g) throw new GtfError(`juego desconocido '${toks[1]}'`, sl.no, path);
        tl.first = g;
        if (!game) game = g;
        i++;
        continue;
      }
      if (k === 'end' && toks.length >= 2) {
        try {
          tl.end = parseDuration(toks[1], 'end');
          if (toks.length > 2) tl.endFade = parseDuration(toks[2], 'end fade');
        } catch (e) {
          throw new GtfError(e instanceof Error ? e.message : String(e), sl.no, path);
        }
        endSet = true;
        i++;
        continue;
      }
      if (k === 'finish' && toks.length >= 2) {
        try {
          tl.finish = parseDuration(toks[1], 'finish');
        } catch (e) {
          throw new GtfError(e instanceof Error ? e.message : String(e), sl.no, path);
        }
        finishSet = true;
        i++;
        continue;
      }
      if (k === 'rest') {
        if (toks.length < 2) throw new GtfError('rest <pulsos>', sl.no, path);
        try {
          clock += parseDuration(toks[1], 'rest');
        } catch (e) {
          throw new GtfError(e instanceof Error ? e.message : String(e), sl.no, path);
        }
        if (clock > MAX_TICK) throw new GtfError('desbordamiento de reloj', sl.no, path);
        i++;
        continue;
      }
      if (k === 'at') {
        if (toks.length < 2) throw new GtfError('at <pulso absoluto>', sl.no, path);
        let target: number;
        try {
          target = parseDuration(toks[1], 'at');
        } catch (e) {
          throw new GtfError(e instanceof Error ? e.message : String(e), sl.no, path);
        }
        if (target < clock) {
          throw new GtfError(
            `at ${toks[1]} (tick ${target}) va hacia atras; el reloj esta en ${formatBeats(clock)} (tick ${clock})`,
            sl.no,
            path
          );
        }
        clock = target;
        i++;
        continue;
      }
      if (k === 'switch') {
        if (toks.length < 2) throw new GtfError('switch JUEGO [cut|hard|0|1|2] [1|2]', sl.no, path);
        const g = canonicalGame(toks[1]);
        if (!g) throw new GtfError(`juego desconocido '${toks[1]}'`, sl.no, path);
        let style = 0;
        let sub = 2;
        if (toks.length > 2) {
          const st = toks[2].toLowerCase();
          if (st === 'cut' || st === 'hard') style = -1;
          else {
            style = parseIntStrict(toks[2]);
            if (style < 0 || style > 2) throw new GtfError('estilo cut|hard|0|1|2', sl.no, path);
          }
        }
        if (toks.length > 3) {
          sub = parseIntStrict(toks[3]);
          if (sub < 1 || sub > 2) throw new GtfError('sub 1|2', sl.no, path);
        }
        addEvent({ id: nextEventId('sw'), tick: clock, op: 'switch', game: g, style, sub }, sl.no);
        game = g;
        i++;
        continue;
      }
      if (k === 'loop') {
        if (toks.length !== 2) throw new GtfError('loop <veces>', sl.no, path);
        let count: number;
        try {
          count = parseIntStrict(toks[1]);
        } catch (e) {
          throw new GtfError(e instanceof Error ? e.message : String(e), sl.no, path);
        }
        if (count < 1 || count > MAX_EXPANSION_WORK) {
          throw new GtfError('loop necesita un entero >= 1', sl.no, path);
        }
        const [inner, endIdx] = collectBlock(block, i + 1, sl.no, path, 'loop');
        if (loopDepth >= MAX_LOOP_CALL_DEPTH) {
          throw new GtfError('loop demasiado profundo (max 8)', sl.no, path);
        }
        loopDepth++;
        try {
          for (let rep = 0; rep < count; rep++) {
            work += 1;
            if (work > MAX_EXPANSION_WORK) {
              throw new GtfError(`limite de expansion (${MAX_EXPANSION_WORK})`, sl.no, path);
            }
            game = emitBlock(inner, game);
          }
        } finally {
          loopDepth--;
        }
        i = endIdx + 1;
        continue;
      }
      if (k === 'call') {
        if (toks.length !== 2) throw new GtfError('call <nombre>', sl.no, path);
        if (callStack.length >= MAX_LOOP_CALL_DEPTH) {
          throw new GtfError('call demasiado profundo (max 8)', sl.no, path);
        }
        const name = toks[1].toLowerCase();
        const defBody = defs.get(name);
        if (!defBody) throw new GtfError(`no hay un def '${name}'`, sl.no, path);
        if (callStack.includes(name)) {
          throw new GtfError(`llamada recursiva a '${name}' (${[...callStack, name].join(' -> ')})`, sl.no, path);
        }
        callStack.push(name);
        game = emitBlock(defBody, game);
        callStack.pop();
        i++;
        continue;
      }
      if (k === 'def') {
        throw new GtfError('un def no puede ir anidado (ni dentro de un loop)', sl.no, path);
      }
      if (k === 'end' && toks.length === 1) {
        tl.end = clock;
        endSet = true;
        i++;
        continue;
      }
      if (k === 'finish' && toks.length === 1) {
        tl.finish = clock;
        finishSet = true;
        i++;
        continue;
      }
      if (k === 'fade') {
        if (toks.length !== 3) throw new GtfError('fade <duracion> <alpha 0..1>', sl.no, path);
        let dur: number;
        try {
          dur = parseDuration(toks[1], 'fade');
        } catch (e) {
          throw new GtfError(e instanceof Error ? e.message : String(e), sl.no, path);
        }
        if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(toks[2]) || toks[2].replace(/[^0-9]/g, '').length > 13) {
          throw new GtfError(`alpha decimal invalida: ${toks[2]}`, sl.no, path);
        }
        const alpha = Number(toks[2]);
        if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
          throw new GtfError('alpha debe estar entre 0 y 1', sl.no, path);
        }
        addEvent({ id: nextEventId('fade'), tick: clock, op: 'fade', fadeLen: dur, alpha }, sl.no);
        i++;
        continue;
      }
      if (k === 'anim') {
        let rest = toks.slice(1);
        if (!rest.length) throw new GtfError('anim [JUEGO] NOMBRE [layout]', sl.no, path);
        let ag: GameId | null = null;
        if (canonicalGame(rest[0])) {
          ag = canonicalGame(rest[0]);
          rest = rest.slice(1);
        }
        if (!rest.length || rest.length > 2) throw new GtfError('anim [JUEGO] NOMBRE [layout]', sl.no, path);
        const aname = rest[0];
        if (!isValidAnimNameContract(aname)) {
          throw new GtfError(`nombre de animacion invalido: ${aname}`, sl.no, path);
        }
        let layout: number | undefined;
        if (rest.length > 1) {
          try {
            layout = parseIntStrict(rest[1]);
          } catch {
            throw new GtfError(`layout invalido: ${rest[1]}`, sl.no, path);
          }
        }
        const g = ag ?? game;
        if (!g) throw new GtfError('anim necesita un juego (pon switch JUEGO o anim JUEGO NOMBRE)', sl.no, path);
        if (layout === undefined) {
          layout = LAYOUT_OFF[g];
          if (layout === undefined) {
            throw new GtfError(`no hay layout verificado en engine_contract.json para ${g}`, sl.no, path);
          }
        }
        if (!isValidLayoutContract(g, layout)) {
          throw new GtfError(`layout 0x${layout.toString(16).toUpperCase()} no verificado para ${g} (engine_contract.json)`, sl.no, path);
        }
        addEvent({ id: nextEventId('anim'), tick: clock, op: 'anim', game: g, layout, animName: aname }, sl.no);
        i++;
        continue;
      }

      const cueToks = k === 'cue' ? toks.slice(1) : toks;
      if (k === 'cue' && cueToks.length === 0) {
        throw new GtfError('cue <nombre> [args] [etiqueta]', sl.no, path);
      }
      const ev = parseCueLine(cueToks, game, sl.no, path);
      ev.tick = clock;
      addEvent(ev, sl.no);
      i++;
    }
    return game;
  };

  emitBlock(body, null);

  if (!tl.first) {
    for (const ev of tl.events) {
      if ((ev.op === 'switch' || ev.op === 'call' || ev.op === 'anim') && ev.game) {
        tl.first = ev.game;
        break;
      }
    }
  }
  const expectedEnd = endSet ? tl.end : (tl.events.at(-1)?.tick ?? 0) + 4 * TPB;
  if ((endSet && tl.end <= 0) || (finishSet && tl.finish < expectedEnd)) {
    throw new GtfError('end/finish explicito invalido', undefined, path);
  }
  if (!endSet) tl.end = 0;
  if (!finishSet) tl.finish = 0;
  finalizeTimeline(tl, path, true, runtimeMode);
  return tl;
}

export function parseGtl(
  source: string,
  path = 'multi.gtl',
  options?: ParseAndEmitOptions
): Timeline {
  const runtimeMode = Boolean(options?.runtimeMode);
  const tl: Timeline = {
    bgm: 139,
    start: 2880,
    translen: 960,
    swing: 120,
    results: 0,
    match: [-1, 9, 4],
    end: -1,
    endFade: 960,
    finish: -1,
    first: null,
    title: '',
    prologue: '',
    jingle: -1,
    events: [],
  };

  let header = false;
  let last = 0;
  let runtimeStartCount = 0;
  let runtimeResultsCount = 0;
  const rawLines = validateSourceBounds(source, path, runtimeMode);

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const raw = rawLines[i].split('#', 1)[0].trim();
    if (!raw) continue;
    const parts = raw.split(/\s+/);
    if (!header) {
      if (runtimeMode && parts[0] === 'GTL1') {
        throw new GtfError('GTL1 (Hoop) es legacy y no esta permitido en paquete runtime', lineNo, path);
      }
      if (parts.length < 2 || parts[0] !== 'GTLM' || parts[1] !== '1') {
        throw new GtfError('falta la cabecera GTLM 1', lineNo, path);
      }
      header = true;
      continue;
    }

    const k = parts[0];
    if (k !== 'title' && parts.length > MAX_TOKENS) {
      throw new GtfError(`demasiados tokens en linea (max ${MAX_TOKENS})`, lineNo, path);
    }
    if (runtimeMode && (k.toLowerCase() === 'force' || k.toLowerCase() === 'disable')) {
      throw new GtfError(`directiva '${k}' prohibida en paquete runtime`, lineNo, path);
    }
    if (k === 'title') {
      const m = raw.match(/^title\s+(.+)$/);
      const txt = m ? m[1].trim() : '';
      if (utf8ByteLength(txt) > TITLE_MAX) throw new GtfError('title demasiado largo', lineNo, path);
      tl.title = txt;
      continue;
    }
    try {
      if (k === 'ticks_per_beat') {
        if (parseIntStrict(parts[1]) !== TPB) throw new GtfError('ticks_per_beat debe ser 480', lineNo, path);
      } else if (k === 'bgm') {
        const bgm = parseIntStrict(parts[1]);
        if (bgm < 0 || bgm > 0xffff) throw new GtfError('bgm fuera de rango', lineNo, path);
        tl.bgm = bgm;
      } else if (k === 'start') {
        runtimeStartCount++;
        if (runtimeMode && runtimeStartCount > 1) {
          throw new GtfError('start duplicado no permitido en timeline runtime', lineNo, path);
        }
        tl.start = parseIntStrict(parts[1]);
      } else if (k === 'translen') {
        tl.translen = parseIntStrict(parts[1]);
      } else if (k === 'swing') {
        tl.swing = parseIntStrict(parts[1]);
      } else if (k === 'results') {
        runtimeResultsCount++;
        if (runtimeMode && runtimeResultsCount > 1) {
          throw new GtfError('results duplicado no permitido en timeline runtime', lineNo, path);
        }
        if (parts[1] === 'native') {
          if (runtimeMode) {
            throw new GtfError('results native no permitido en paquete runtime', lineNo, path);
          }
          tl.results = 1;
        } else if (parts[1] === 'exit' || parts[1] === 'custom') {
          if (runtimeMode && (parts.length !== 2 || parts[1] !== 'exit')) {
            throw new GtfError(`results debe ser exactamente 'results exit' en paquete runtime`, lineNo, path);
          }
          tl.results = 0;
        } else throw new GtfError('results native|exit', lineNo, path);
      } else if (k === 'prologue') {
        if (!parts[1] || utf8ByteLength(parts[1]) > PROLOGUE_MAX || !isValidPrologueContract(parts[1])) {
          throw new GtfError('prologue invalido', lineNo, path);
        }
        tl.prologue = parts[1];
      } else if (k === 'jingle') {
        const j = parseIntStrict(parts[1]);
        if (j < JINGLE_MIN || j > JINGLE_MAX) throw new GtfError('jingle fuera de rango (0x158..0x16C)', lineNo, path);
        tl.jingle = j;
      } else if (k === 'match') {
        if (runtimeMode) {
          throw new GtfError('directiva match prohibida en paquete runtime (el registro asigna el slot)', lineNo, path);
        }
        const m: [number, number, number] = [parseIntStrict(parts[1]), parseIntStrict(parts[2]), parseIntStrict(parts[3])];
        if (!isValidMatchContract(m)) throw new GtfError('match fuera de rango', lineNo, path);
        tl.match = m;
      } else if (k === 'end') {
        tl.end = parseIntStrict(parts[1]);
        if (parts.length > 2) tl.endFade = parseIntStrict(parts[2]);
      } else if (k === 'finish') {
        tl.finish = parseIntStrict(parts[1]);
      } else if (k === 'first') {
        const g = canonicalGame(parts[1]);
        if (!g) throw new GtfError('juego desconocido', lineNo, path);
        tl.first = g;
      } else if (k === 'X' || k === 'W' || k === 'F' || k === 'A') {
        if (tl.events.length >= MAX_EVENTS) throw new GtfError('demasiados eventos', lineNo, path);
        const tick = parseIntStrict(parts[1]);
        if (tick < 0 || tick > MAX_TICK) throw new GtfError('tick invalido', lineNo, path);
        if (tick < last) throw new GtfError('los eventos deben ir ordenados por tick', lineNo, path);

        if (k === 'F') {
          if (parts.length !== 4) throw new GtfError('F TICK TICKS ALPHA(0..1)', lineNo, path);
          const fadeLen = parseIntStrict(parts[2]);
          if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(parts[3]) || parts[3].replace(/[^0-9]/g, '').length > 13) {
            throw new GtfError('alpha decimal invalida', lineNo, path);
          }
          const alpha = Number(parts[3]);
          if (fadeLen < 0 || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
            throw new GtfError('F TICK TICKS ALPHA(0..1)', lineNo, path);
          }
          tl.events.push({ id: nextEventId('fade'), tick, op: 'fade', fadeLen, alpha });
        } else {
          const g = canonicalGame(parts[2]);
          if (!g) throw new GtfError(`juego desconocido ${parts[2]}`, lineNo, path);
          if (k === 'X') {
            if (parts.length < 4) throw new GtfError('X TICK JUEGO FN [a b c d] [etiqueta]', lineNo, path);
            const off = parseIntStrict(parts[3]);
            const kind = CUE_FNS.get(`${g}:${off}`);
            if (kind === undefined) {
              throw new GtfError(`la funcion 0x${off.toString(16).toUpperCase()} no es un cue permitido de ${g}`, lineNo, path);
            }
            let ti = 4;
            let word: TheAWord | null = null;
            if (kind === 1) {
              const w = (parts[4] ?? '').toUpperCase();
              if (!(THE_A_WORDS as readonly string[]).includes(w)) {
                throw new GtfError('la palabra debe ser TEA|SODA|COCOA|AAA', lineNo, path);
              }
              word = w as TheAWord;
              ti = 5;
            }
            const args: number[] = [];
            while (ti < parts.length && args.length < 4 && isIntToken(parts[ti])) {
              args.push(parseIntStrict(parts[ti]));
              ti++;
            }
            if (kind === 1 && args.length > 0) {
              throw new GtfError(`word cue ${g} no acepta argumentos enteros`, lineNo, path);
            }
            let tag: string | null = null;
            if (ti < parts.length) {
              if (ti !== parts.length - 1 || (!validName(parts[ti]) && parts[ti] !== '-')) {
                throw new GtfError('argumento/etiqueta invalido', lineNo, path);
              }
              if (parts[ti] !== '-') tag = parts[ti];
            }
            const finalArgs = pad4(args);
            const contractCheck = validateCueArgsContract(g, off, finalArgs);
            if (!contractCheck.ok) {
              throw new GtfError(contractCheck.reason ?? 'argumentos fuera del dominio verificado', lineNo, path);
            }
            tl.events.push({
              id: nextEventId('cue'),
              tick,
              op: 'call',
              game: g,
              fn: off,
              args: finalArgs,
              word,
              tag,
            });
          } else if (k === 'W') {
            if (parts.length < 3 || parts.length > 5) throw new GtfError('W TICK JUEGO [cut|0|1|2] [1|2]', lineNo, path);
            let style = 0;
            let sub = 2;
            if (parts.length > 3) {
              if (parts[3] === 'cut' || parts[3] === 'hard') style = -1;
              else {
                style = parseIntStrict(parts[3]);
                if (style < 0 || style > 2) throw new GtfError('estilo cut|0|1|2', lineNo, path);
              }
            }
            if (parts.length > 4) {
              sub = parseIntStrict(parts[4]);
              if (sub < 1 || sub > 2) throw new GtfError('sub 1|2', lineNo, path);
            }
            tl.events.push({ id: nextEventId('sw'), tick, op: 'switch', game: g, style, sub });
          } else {
            if (parts.length !== 5) throw new GtfError('A TICK JUEGO LAYOUT NOMBRE', lineNo, path);
            const layout = parseIntStrict(parts[3]);
            const animName = parts[4];
            if (!isValidLayoutContract(g, layout)) {
              throw new GtfError(`layout 0x${layout.toString(16).toUpperCase()} no verificado para ${g}`, lineNo, path);
            }
            if (!isValidAnimNameContract(animName)) {
              throw new GtfError(`nombre de animacion invalido: ${animName}`, lineNo, path);
            }
            tl.events.push({ id: nextEventId('anim'), tick, op: 'anim', game: g, layout, animName });
          }
        }
        last = tick;
      } else {
        throw new GtfError(`clave desconocida '${k}'`, lineNo, path);
      }
    } catch (e) {
      if (e instanceof GtfError) throw e;
      throw new GtfError(e instanceof Error ? e.message : String(e), lineNo, path);
    }
  }

  if (!header) throw new GtfError('archivo vacio (falta GTLM 1)', undefined, path);
  if (runtimeMode) {
    if (runtimeStartCount === 0) {
      throw new GtfError('start explicito obligatorio en timeline runtime', undefined, path);
    }
    if (runtimeResultsCount === 0) {
      throw new GtfError('results exit explicito obligatorio en timeline runtime', undefined, path);
    }
  }
  finalizeTimeline(tl, path, false, runtimeMode);
  return tl;
}

export function emitGtl(
  tl: Timeline,
  sourceName = 'Groove Builder',
  options?: ParseAndEmitOptions
): string {
  const runtimeMode = Boolean(options?.runtimeMode);
  const sorted = [...tl.events].sort((a, b) => a.tick - b.tick);
  const games = gamesUsedInTimeline(tl);
  const resultsStr = runtimeMode ? 'exit' : tl.results ? 'native' : 'exit';
  const lines: string[] = [
    'GTLM 1',
    `# Exportado por Groove Builder desde ${sourceName}`,
    `# Juegos: ${games.join(' ')}`,
    'ticks_per_beat 480',
    `bgm ${tl.bgm}`,
    `results ${resultsStr}`,
  ];
  if (!runtimeMode) {
    lines.push(`match ${tl.match[0]} ${tl.match[1]} ${tl.match[2]}`);
  }
  lines.push(
    `start ${tl.start}`,
    `translen ${tl.translen}`,
    `swing ${tl.swing}`,
    `first ${tl.first ?? games[0] ?? 'CARS'}`,
    `end ${tl.end} ${tl.endFade}`,
    `finish ${tl.finish}`
  );
  if (tl.title) lines.push(`title ${tl.title.replace(/#/g, '')}`);
  if (tl.prologue) lines.push(`prologue ${tl.prologue}`);
  if (tl.jingle >= JINGLE_MIN && tl.jingle <= JINGLE_MAX) {
    lines.push(`jingle 0x${tl.jingle.toString(16).toUpperCase()}`);
  }
  lines.push('# --- eventos');
  for (const ev of sorted) {
    if (ev.op === 'call' && ev.game && ev.fn !== undefined) {
      const fnHex = `0x${ev.fn.toString(16).toUpperCase()}`;
      const args = ev.args ?? [0, 0, 0, 0];
      const tag = ev.tag ?? '-';
      if (ev.word) {
        lines.push(`X ${ev.tick} ${ev.game} ${fnHex} ${ev.word} ${tag}`);
      } else {
        lines.push(`X ${ev.tick} ${ev.game} ${fnHex} ${args[0]} ${args[1]} ${args[2]} ${args[3]} ${tag}`);
      }
    } else if (ev.op === 'switch' && ev.game) {
      const styleStr = ev.style === -1 ? 'cut' : String(ev.style ?? 0);
      if ((ev.sub ?? 2) !== 2) {
        lines.push(`W ${ev.tick} ${ev.game} ${styleStr} ${ev.sub}`);
      } else if (styleStr !== '0') {
        lines.push(`W ${ev.tick} ${ev.game} ${styleStr}`);
      } else {
        lines.push(`W ${ev.tick} ${ev.game}`);
      }
    } else if (ev.op === 'fade') {
      const alphaStr = Number((ev.alpha ?? 1).toFixed(4)).toString();
      lines.push(`F ${ev.tick} ${ev.fadeLen ?? 480} ${alphaStr}`);
    } else if (ev.op === 'anim' && ev.game) {
      const layoutHex = `0x${(ev.layout ?? 0x3b58).toString(16).toUpperCase()}`;
      lines.push(`A ${ev.tick} ${ev.game} ${layoutHex} ${ev.animName ?? 'Remix8'}`);
    }
  }
  return lines.join('\n') + '\n';
}

function formatCallGtf(ev: TimelineEvent, currentGame: GameId | null): string {
  const game = ev.game!;
  const fn = ev.fn!;
  const args = ev.args ?? [0, 0, 0, 0];
  const cue = findCueDef(game, fn, args, ev.word ?? null);
  const tag = ev.tag ? ` ${ev.tag}` : '';

  if (cue) {
    const exactMatch =
      cue.args[0] === args[0] &&
      cue.args[1] === args[1] &&
      cue.args[2] === args[2] &&
      cue.args[3] === args[3] &&
      cue.word === (ev.word ?? null);
    const prefix = game === currentGame ? '' : `${game}.`;
    if (exactMatch) {
      return `${prefix}${cue.name}${tag}`;
    }
    if (cue.word === (ev.word ?? null)) {
      let lastDiff = 3;
      while (lastDiff >= 0 && args[lastDiff] === cue.args[lastDiff]) lastDiff--;
      if (lastDiff >= 0) {
        const argSlice = args.slice(0, lastDiff + 1).join(' ');
        return `${prefix}${cue.name} ${argSlice}${tag}`;
      }
      return `${prefix}${cue.name}${tag}`;
    }
  }

  const fnHex = `0x${fn.toString(16).toUpperCase()}`;
  const prefix = game === currentGame ? '' : `${game}.`;
  if (ev.word) return `${prefix}${fnHex} ${ev.word}${tag}`;
  let trim = 4;
  while (trim > 0 && args[trim - 1] === 0) trim--;
  const argStr = trim > 0 ? ' ' + args.slice(0, trim).join(' ') : '';
  return `${prefix}${fnHex}${argStr}${tag}`;
}

export function decompileToGtf(
  tl: Timeline,
  sourceName = 'Groove Builder',
  options?: ParseAndEmitOptions
): string {
  const runtimeMode = Boolean(options?.runtimeMode);
  const sorted = [...tl.events].sort((a, b) => a.tick - b.tick);
  const lines: string[] = [
    `# Groove Tickflow v0.1 — ${sourceName}`,
    '# 1 pulso = 480 ticks. rest avanza el reloj; switch y los cues ocurren en el pulso actual.',
    '',
  ];
  if (tl.title) lines.push(`title "${tl.title.replace(/"/g, '\\"')}"`);
  if (tl.prologue) lines.push(`prologue ${tl.prologue}`);
  if (tl.jingle >= JINGLE_MIN && tl.jingle <= JINGLE_MAX) {
    lines.push(`jingle 0x${tl.jingle.toString(16).toUpperCase()}`);
  }
  lines.push(`bgm ${tl.bgm}`);
  lines.push(`results ${runtimeMode ? 'exit' : tl.results ? 'native' : 'exit'}`);
  if (!runtimeMode) {
    lines.push(`match ${tl.match[0]} ${tl.match[1]} ${tl.match[2]}`);
  }
  lines.push(`start ${formatBeats(tl.start)}`);
  lines.push(`translen ${formatBeats(tl.translen)}`);
  if (tl.swing !== 120) lines.push(`swing ${tl.swing}`);
  if (tl.first) lines.push(`first ${tl.first}`);
  if (tl.endFade !== 960) {
    lines.push(`end ${formatBeats(tl.end)} ${formatBeats(tl.endFade)}`);
  } else {
    lines.push(`end ${formatBeats(tl.end)}`);
  }
  lines.push(`finish ${formatBeats(tl.finish)}`);
  lines.push('');

  let clock = 0;
  let currentGame: GameId | null = null;
  for (const ev of sorted) {
    if (ev.tick > clock) {
      lines.push(`rest ${formatBeats(ev.tick - clock)}`);
      clock = ev.tick;
    }
    if (ev.op === 'switch' && ev.game) {
      if (ev.style === -1) {
        lines.push((ev.sub ?? 2) !== 2 ? `switch ${ev.game} cut ${ev.sub}` : `switch ${ev.game} cut`);
      } else if ((ev.sub ?? 2) !== 2) {
        lines.push(`switch ${ev.game} ${ev.style ?? 0} ${ev.sub}`);
      } else if ((ev.style ?? 0) !== 0) {
        lines.push(`switch ${ev.game} ${ev.style}`);
      } else {
        lines.push(`switch ${ev.game}`);
      }
      currentGame = ev.game;
    } else if (ev.op === 'call') {
      lines.push(formatCallGtf(ev, currentGame));
    } else if (ev.op === 'fade') {
      const alphaStr = Number((ev.alpha ?? 1).toFixed(4)).toString();
      lines.push(`fade ${formatBeats(ev.fadeLen ?? 480)} ${alphaStr}`);
    } else if (ev.op === 'anim' && ev.game) {
      const defLayout = LAYOUT_OFF[ev.game];
      const layoutHex = `0x${(ev.layout ?? 0x3b58).toString(16).toUpperCase()}`;
      if (ev.game === currentGame && defLayout === ev.layout) {
        lines.push(`anim ${ev.animName ?? 'Remix8'}`);
      } else if (defLayout === ev.layout) {
        lines.push(`anim ${ev.game} ${ev.animName ?? 'Remix8'}`);
      } else {
        lines.push(`anim ${ev.game} ${ev.animName ?? 'Remix8'} ${layoutHex}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

export function validateTimeline(tl: Timeline, options?: ParseAndEmitOptions): ValidationReport {
  const issues: ValidationIssue[] = [];
  const gamesUsed = gamesUsedInTimeline(tl);
  const calls = tl.events.filter((e) => e.op === 'call');
  const switches = tl.events.filter((e) => e.op === 'switch');
  const fades = tl.events.filter((e) => e.op === 'fade');
  const anims = tl.events.filter((e) => e.op === 'anim');

  if (options?.runtimeMode && tl.results !== 0) {
    issues.push({ level: 'error', message: 'El perfil runtime requiere results custom/exit (no native).' });
  }
  if (calls.length === 0) {
    issues.push({ level: 'error', message: 'El remix necesita al menos un cue (llamada X).' });
  }
  if (gamesUsed.length === 0) {
    issues.push({ level: 'error', message: 'No hay ningún minijuego asignado.' });
  }
  if (gamesUsed.length > MAX_GAMES) {
    issues.push({ level: 'error', message: `Máximo ${MAX_GAMES} minijuegos por remix (usados: ${gamesUsed.length}).` });
  }
  if (tl.jingle !== -1 && (tl.jingle < JINGLE_MIN || tl.jingle > JINGLE_MAX)) {
    issues.push({ level: 'error', message: `Jingle fuera de rango (0x158..0x16C): 0x${tl.jingle.toString(16).toUpperCase()}` });
  }
  if (tl.end <= 0) {
    issues.push({ level: 'error', message: 'Falta definir el pulso final (end).' });
  }
  if (tl.finish < tl.end) {
    issues.push({ level: 'error', message: 'El pulso finish no puede ser anterior a end.' });
  }
  if (tl.start > tl.end) {
    issues.push({ level: 'error', message: 'El inicio (start) es posterior al final (end).' });
  }
  if (!isValidMatchContract(tl.match)) {
    issues.push({ level: 'error', message: 'match fuera de rango (mundo -1..2, col 0..11, fila 0..4).' });
  }
  if (!isValidPrologueContract(tl.prologue)) {
    issues.push({ level: 'error', message: 'prologue invalido (solo letras, digitos, _, - o / relativos).' });
  }

  const sorted = [...tl.events].sort((a, b) => a.tick - b.tick);
  if (sorted.length > MAX_EVENTS) {
    issues.push({ level: 'error', message: `Superado el límite de ${MAX_EVENTS} eventos.` });
  }

  const poolStrings = new Set<string>();
  for (const ev of sorted) {
    if (ev.tag) poolStrings.add(ev.tag);
    if (ev.animName) poolStrings.add(ev.animName);

    if (ev.tick < 0 || ev.tick > MAX_TICK) {
      issues.push({ level: 'error', message: 'Hay eventos con tick fuera de rango.', tick: ev.tick, eventId: ev.id });
    }
    if (tl.end > 0 && ev.tick > tl.end) {
      issues.push({
        level: 'error',
        message: `Evento en pulso ${formatBeats(ev.tick)} queda después de end (${formatBeats(tl.end)}).`,
        tick: ev.tick,
        eventId: ev.id,
      });
    }
    if (ev.op === 'call' && ev.game && ev.fn !== undefined) {
      const check = validateCueArgsContract(ev.game, ev.fn, ev.args ?? [0, 0, 0, 0]);
      if (!check.ok) {
        issues.push({
          level: 'error',
          message: check.reason ?? `Argumentos no verificados en ${ev.game}`,
          tick: ev.tick,
          eventId: ev.id,
        });
      }
      if (ev.game === 'THE_A' && (!ev.word || !(THE_A_WORDS as readonly string[]).includes(ev.word))) {
        issues.push({
          level: 'error',
          message: 'THE_A requiere una palabra verificada (TEA|SODA|COCOA|AAA).',
          tick: ev.tick,
          eventId: ev.id,
        });
      }
    }
    if (ev.op === 'anim') {
      if (!ev.game || ev.layout === undefined || !isValidLayoutContract(ev.game, ev.layout)) {
        issues.push({
          level: 'error',
          message: `Layout no verificado en engine_contract.json para ${ev.game ?? '?'}.`,
          tick: ev.tick,
          eventId: ev.id,
        });
      }
      if (!ev.animName || !isValidAnimNameContract(ev.animName)) {
        issues.push({
          level: 'error',
          message: `Nombre de animacion invalido (${ev.animName ?? ''}): usa [A-Za-z0-9_]{1,47}.`,
          tick: ev.tick,
          eventId: ev.id,
        });
      }
    }
  }

  let poolBytes = 0;
  for (const s of poolStrings) poolBytes += utf8ByteLength(s) + 1;
  if (poolBytes > STRING_POOL_MAX) {
    issues.push({ level: 'error', message: `Pool de cadenas excedido (${poolBytes} > ${STRING_POOL_MAX} bytes).` });
  }

  // Switch transition overlap warning (same as groove_rhre.py)
  const sortedSw = [...switches].sort((a, b) => a.tick - b.tick);
  for (let i = 1; i < sortedSw.length; i++) {
    const prev = sortedSw[i - 1];
    const curr = sortedSw[i];
    if (prev.style !== -1 && curr.tick - prev.tick < tl.translen) {
      issues.push({
        level: 'warning',
        message: `Switch a ${curr.game} en pulso ${formatBeats(curr.tick)} llega antes de terminar la transición suave anterior (${formatBeats(tl.translen)} pulsos). Usa 'cut/hard' para cambios rápidos.`,
        tick: curr.tick,
        eventId: curr.id,
      });
    }
  }

  // Dense calls warning per game (< 0.5 beats = 240 ticks)
  const byGame = new Map<GameId, TimelineEvent[]>();
  for (const c of calls) {
    if (!c.game) continue;
    const arr = byGame.get(c.game) ?? [];
    arr.push(c);
    byGame.set(c.game, arr);
  }
  for (const [g, arr] of byGame.entries()) {
    arr.sort((a, b) => a.tick - b.tick);
    for (let i = 1; i < arr.length; i++) {
      const gap = arr[i].tick - arr[i - 1].tick;
      if (gap < 240 && gap > 0) {
        issues.push({
          level: 'warning',
          message: `${g}: llamadas a menos de medio pulso (${gap} ticks) en pulso ${formatBeats(arr[i].tick)}.`,
          tick: arr[i].tick,
          eventId: arr[i].id,
        });
      }
    }
  }

  return {
    ok: !issues.some((i) => i.level === 'error'),
    issues,
    gamesUsed,
    callCount: calls.length,
    switchCount: switches.length,
    fadeCount: fades.length,
    animCount: anims.length,
  };
}

export function timelinesEqual(a: Timeline, b: Timeline): string[] {
  const diffs: string[] = [];
  const fields: Array<keyof Timeline> = [
    'bgm',
    'start',
    'translen',
    'swing',
    'results',
    'end',
    'endFade',
    'finish',
    'first',
    'title',
    'prologue',
    'jingle',
  ];
  for (const f of fields) {
    if (a[f] !== b[f]) {
      diffs.push(`${String(f)}: ${String(a[f])} != ${String(b[f])}`);
    }
  }
  if (a.match.join(',') !== b.match.join(',')) {
    diffs.push(`match: ${a.match.join(',')} != ${b.match.join(',')}`);
  }
  if (a.events.length !== b.events.length) {
    diffs.push(`events.length: ${a.events.length} != ${b.events.length}`);
    return diffs;
  }
  const sa = [...a.events].sort((x, y) => x.tick - y.tick);
  const sb = [...b.events].sort((x, y) => x.tick - y.tick);
  for (let i = 0; i < sa.length; i++) {
    const ea = sa[i];
    const eb = sb[i];
    if (ea.tick !== eb.tick || ea.op !== eb.op || ea.game !== eb.game) {
      diffs.push(`event[${i}]: (${ea.tick},${ea.op},${ea.game}) != (${eb.tick},${eb.op},${eb.game})`);
      continue;
    }
    if (ea.op === 'call') {
      if (
        ea.fn !== eb.fn ||
        (ea.args ?? []).join(',') !== (eb.args ?? []).join(',') ||
        (ea.word ?? null) !== (eb.word ?? null) ||
        (ea.tag ?? null) !== (eb.tag ?? null)
      ) {
        diffs.push(`event[${i}] call mismatch at tick ${ea.tick}`);
      }
    } else if (ea.op === 'switch') {
      if ((ea.style ?? 0) !== (eb.style ?? 0) || (ea.sub ?? 2) !== (eb.sub ?? 2)) {
        diffs.push(`event[${i}] switch mismatch at tick ${ea.tick}`);
      }
    } else if (ea.op === 'fade') {
      if (ea.fadeLen !== eb.fadeLen || Math.abs((ea.alpha ?? 0) - (eb.alpha ?? 0)) > 1e-4) {
        diffs.push(`event[${i}] fade mismatch at tick ${ea.tick}`);
      }
    } else if (ea.op === 'anim') {
      if (ea.layout !== eb.layout || ea.animName !== eb.animName) {
        diffs.push(`event[${i}] anim mismatch at tick ${ea.tick}`);
      }
    }
  }
  return diffs;
}

export function activeGameAtTick(tl: Timeline, tick: number): {
  game: GameId;
  prevGame: GameId;
  transitionProgress: number; // 0..1 (1 = settled)
  transitionStyle: number;
  fadeAlpha: number;
} {
  let game: GameId = tl.first ?? gamesUsedInTimeline(tl)[0] ?? 'CARS';
  let prevGame: GameId = game;
  let lastSwitchTick = -1e9;
  let transitionStyle = 0;

  const sorted = [...tl.events].sort((a, b) => a.tick - b.tick);
  for (const ev of sorted) {
    if (ev.tick > tick) break;
    if (ev.op === 'switch' && ev.game) {
      prevGame = game;
      game = ev.game;
      lastSwitchTick = ev.tick;
      transitionStyle = ev.style ?? 0;
    }
  }

  let transitionProgress = 1;
  if (lastSwitchTick >= 0 && transitionStyle !== -1 && tl.translen > 0) {
    const elapsed = tick - lastSwitchTick;
    if (elapsed < tl.translen) {
      transitionProgress = Math.max(0, Math.min(1, elapsed / tl.translen));
    }
  }

  // Compute fade alpha overlay
  let fadeAlpha = 0;
  let currentAlpha = 0;
  for (const ev of sorted) {
    if (ev.op !== 'fade') continue;
    if (ev.tick > tick) break;
    const len = ev.fadeLen ?? 0;
    const target = ev.alpha ?? 0;
    if (len <= 0 || tick >= ev.tick + len) {
      currentAlpha = target;
    } else {
      const p = (tick - ev.tick) / len;
      currentAlpha = currentAlpha + (target - currentAlpha) * p;
    }
  }
  fadeAlpha = currentAlpha;

  return { game, prevGame, transitionProgress, transitionStyle, fadeAlpha };
}
