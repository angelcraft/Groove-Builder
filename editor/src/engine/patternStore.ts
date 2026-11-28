import {
  canonicalGame,
  findCueDef,
  GAME_META,
  type GameId,
  type TheAWord,
  TPB,
} from './cues.ts';
import {
  isValidAnimNameContract,
  isValidLayoutContract,
  validateCueArgsContract,
} from './engineContract.ts';
import { nextEventId, type Timeline, type TimelineEvent } from './gtfEngine.ts';
import { parseStrictJson } from './zipSecurity.ts';

export type EditorTool = 'select' | 'switch' | 'pickaxe' | 'ruler' | 'stamp';

export interface PatternEventSpec {
  relTick: number;
  op: 'call' | 'switch' | 'fade' | 'anim';
  game?: GameId;
  fn?: number;
  args?: [number, number, number, number];
  word?: TheAWord | null;
  tag?: string | null;
  style?: number;
  sub?: number;
  fadeLen?: number;
  alpha?: number;
  layout?: number;
  animName?: string;
}

export interface StoredPattern {
  id: string;
  name: string;
  primaryGame: GameId;
  description: string;
  durationTicks: number;
  builtIn: boolean;
  events: PatternEventSpec[];
}

export interface GameSection {
  game: GameId;
  startTick: number;
  endTick: number;
  transitionStyle: number;
}

export type HitJudgement = 'ACE' | 'JUST' | 'EARLY' | 'LATE' | 'MISS';

export interface PlayalongHitResult {
  judgement: HitJudgement;
  deltaMs: number;
  targetTick: number;
  game: GameId;
  cueName: string;
}

const STORAGE_KEY_PATTERNS = 'groove_builder_stored_patterns_v1';
const STORAGE_KEY_FAVORITES = 'groove_builder_favorite_games_v1';
const STORAGE_KEY_RECENTS = 'groove_builder_recent_games_v1';

export const BUILTIN_PATTERNS: StoredPattern[] = [
  {
    id: 'builtin_kaeru_4beat_combo',
    name: 'Ribbit 3+5 Call Phrase',
    primaryGame: 'KAERU',
    description: '3-count croak setup followed by a 5-count croak response.',
    durationTicks: 8 * TPB,
    builtIn: true,
    events: [
      { relTick: 0, op: 'call', game: 'KAERU', fn: 0x1b8db0, args: [3, 0, 0, 0] },
      { relTick: 4 * TPB, op: 'call', game: 'KAERU', fn: 0x1b8db0, args: [5, 0, 0, 0] },
    ],
  },
  {
    id: 'builtin_cars_stop_go_phrase',
    name: 'Highway Stop-Go-Stop Phrase',
    primaryGame: 'CARS',
    description: 'Accelerate followed by a tight brake cue on 2-beat cadence.',
    durationTicks: 6 * TPB,
    builtIn: true,
    events: [
      { relTick: 0, op: 'call', game: 'CARS', fn: 0x1601d0, args: [1, 0, 0, 0] },
      { relTick: 2 * TPB, op: 'call', game: 'CARS', fn: 0x1608f0, args: [0, -1, 0, 0] },
    ],
  },
  {
    id: 'builtin_ring_papipupepo',
    name: 'Hoop Pa-Pi-Pu-Pe-Po Combo',
    primaryGame: 'RING',
    description: 'Full 4-hoop cadence followed by a 1+3 pass launch.',
    durationTicks: 8 * TPB,
    builtIn: true,
    events: [
      { relTick: 0, op: 'call', game: 'RING', fn: 0x217960, args: [-1, 0, 0, 0] },
      { relTick: 4 * TPB, op: 'call', game: 'RING', fn: 0x217960, args: [5, 1, 0, 0] },
    ],
  },
  {
    id: 'builtin_the_a_phrase',
    name: 'The A Trio (TEA · SODA · COCOA)',
    primaryGame: 'THE_A',
    description: 'Classic three-word Rhythm Heaven phrasing.',
    durationTicks: 8 * TPB,
    builtIn: true,
    events: [
      { relTick: 0, op: 'call', game: 'THE_A', fn: 0x278fe0, args: [0, 0, 0, 0], word: 'TEA' },
      { relTick: 2 * TPB, op: 'call', game: 'THE_A', fn: 0x278fe0, args: [0, 0, 0, 0], word: 'SODA' },
      { relTick: 4 * TPB, op: 'call', game: 'THE_A', fn: 0x278fe0, args: [0, 0, 0, 0], word: 'COCOA' },
    ],
  },
  {
    id: 'builtin_pumpup_duo',
    name: 'Fruit Flex Apple-Lemon Sync',
    primaryGame: 'PUMPUP',
    description: 'Alternating Apple and Lemon flex cues on 4-beat cadence.',
    durationTicks: 8 * TPB,
    builtIn: true,
    events: [
      { relTick: 0, op: 'call', game: 'PUMPUP', fn: 0x209b80, args: [1, 0, 0, 0] },
      { relTick: 4 * TPB, op: 'call', game: 'PUMPUP', fn: 0x20a170, args: [0, 0, 0, 0] },
    ],
  },
  {
    id: 'builtin_samurai_slash_set',
    name: 'Samurai Dual Demon Slash',
    primaryGame: 'SAMURAI',
    description: 'Single spirit slash followed by double spirit slash.',
    durationTicks: 8 * TPB,
    builtIn: true,
    events: [
      { relTick: 0, op: 'call', game: 'SAMURAI', fn: 0x22ad50, args: [1, 1, 0, 0] },
      { relTick: 4 * TPB, op: 'call', game: 'SAMURAI', fn: 0x22aff0, args: [1, 1, 0, 0] },
    ],
  },
  {
    id: 'builtin_crab_macaron_snap',
    name: 'Crab Snacks Alternating Tray',
    primaryGame: 'CRAB',
    description: 'Macaron followed by fava bean claw snap.',
    durationTicks: 6 * TPB,
    builtIn: true,
    events: [
      { relTick: 0, op: 'call', game: 'CRAB', fn: 0x17bfc0, args: [-1, -1, -1, 0] },
      { relTick: 2 * TPB, op: 'call', game: 'CRAB', fn: 0x17d0d0, args: [-1, -1, -1, 0] },
    ],
  },
  {
    id: 'builtin_hungry_heart_pair',
    name: 'Feeding the Beast Yellow + Purple',
    primaryGame: 'HUNGRY',
    description: '8-beat lead-in pair of yellow then purple hearts.',
    durationTicks: 10 * TPB,
    builtIn: true,
    events: [
      { relTick: 0, op: 'call', game: 'HUNGRY', fn: 0x1af800, args: [0, 0, 0, 0] },
      { relTick: 4 * TPB, op: 'call', game: 'HUNGRY', fn: 0x1af800, args: [1, 0, 0, 0] },
    ],
  },
];

export function buildPatternFromSelection(
  selectedEvents: TimelineEvent[],
  name: string,
  fallbackGame: GameId
): StoredPattern {
  if (selectedEvents.length === 0) {
    throw new Error('Select at least one event on the timeline to save a pattern.');
  }
  const sorted = [...selectedEvents].sort((a, b) => a.tick - b.tick);
  const baseTick = sorted[0].tick;
  let maxEndRel = TPB;
  const gameCounts = new Map<GameId, number>();

  const specs: PatternEventSpec[] = sorted.map((ev) => {
    const relTick = Math.max(0, ev.tick - baseTick);
    if (ev.game) {
      gameCounts.set(ev.game, (gameCounts.get(ev.game) ?? 0) + 1);
    }
    const def =
      ev.op === 'call' && ev.game
        ? findCueDef(ev.game, ev.fn ?? 0, ev.args ?? [0, 0, 0, 0], ev.word ?? null)
        : undefined;
    const span = def ? Math.max(TPB, Math.round(def.durationBeats * TPB)) : ev.fadeLen ?? TPB;
    maxEndRel = Math.max(maxEndRel, relTick + span);

    return {
      relTick,
      op: ev.op,
      game: ev.game,
      fn: ev.fn,
      args: ev.args ? ([...ev.args] as [number, number, number, number]) : undefined,
      word: ev.word,
      tag: ev.tag,
      style: ev.style,
      sub: ev.sub,
      fadeLen: ev.fadeLen,
      alpha: ev.alpha,
      layout: ev.layout,
      animName: ev.animName,
    };
  });

  let primaryGame = fallbackGame;
  let bestCount = -1;
  for (const [g, count] of gameCounts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      primaryGame = g;
    }
  }

  return {
    id: `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim().slice(0, 64) || `${GAME_META[primaryGame].title} Pattern`,
    primaryGame,
    description: `${specs.length} events · ${(maxEndRel / TPB).toFixed(1)} beats`,
    durationTicks: maxEndRel,
    builtIn: false,
    events: specs,
  };
}

export function instantiatePattern(
  pattern: StoredPattern,
  targetTick: number,
  includeLeadingSwitch = false
): TimelineEvent[] {
  const baseTick = Math.max(0, Math.round(targetTick));
  const out: TimelineEvent[] = [];
  const hasLeadingSwitch = pattern.events.some((e) => e.op === 'switch' && e.relTick === 0);

  if (includeLeadingSwitch && !hasLeadingSwitch) {
    out.push({
      id: nextEventId('sw'),
      tick: baseTick,
      op: 'switch',
      game: pattern.primaryGame,
      style: 0,
      sub: 2,
    });
  }

  for (const spec of pattern.events) {
    const tick = baseTick + Math.max(0, Math.round(spec.relTick));
    if (spec.op === 'call' && spec.game && spec.fn !== undefined) {
      const args = spec.args ? ([...spec.args] as [number, number, number, number]) : ([0, 0, 0, 0] as [number, number, number, number]);
      const check = validateCueArgsContract(spec.game, spec.fn, args);
      if (!check.ok) {
        throw new Error(`Pattern '${pattern.name}' violates engine_contract.json: ${check.reason}`);
      }
      out.push({
        id: nextEventId('cue'),
        tick,
        op: 'call',
        game: spec.game,
        fn: spec.fn,
        args,
        word: spec.word ?? null,
        tag: spec.tag ?? null,
      });
    } else if (spec.op === 'switch' && spec.game) {
      out.push({
        id: nextEventId('sw'),
        tick,
        op: 'switch',
        game: spec.game,
        style: spec.style ?? 0,
        sub: spec.sub ?? 2,
      });
    } else if (spec.op === 'fade') {
      out.push({
        id: nextEventId('fade'),
        tick,
        op: 'fade',
        fadeLen: spec.fadeLen ?? TPB,
        alpha: spec.alpha ?? 0.6,
      });
    } else if (spec.op === 'anim' && spec.game && spec.animName) {
      if (
        spec.layout === undefined ||
        !isValidLayoutContract(spec.game, spec.layout) ||
        !isValidAnimNameContract(spec.animName)
      ) {
        continue;
      }
      out.push({
        id: nextEventId('anim'),
        tick,
        op: 'anim',
        game: spec.game,
        layout: spec.layout,
        animName: spec.animName,
      });
    }
  }

  return out;
}

/**
 * RHREfresh GameBoundaries equivalent: computes contiguous active minigame spans
 * from `timeline.first` and all `switch` events across the song.
 */
export function computeGameSections(timeline: Timeline, totalTicks: number): GameSection[] {
  const switches = timeline.events
    .filter((e): e is TimelineEvent & { game: GameId } => e.op === 'switch' && Boolean(e.game))
    .sort((a, b) => a.tick - b.tick);

  const initialGame: GameId = timeline.first ?? switches[0]?.game ?? 'CARS';
  const sections: GameSection[] = [];
  let cursor = 0;
  let currentGame = initialGame;
  let currentStyle = 0;

  for (const sw of switches) {
    if (sw.tick > cursor) {
      sections.push({
        game: currentGame,
        startTick: cursor,
        endTick: sw.tick,
        transitionStyle: currentStyle,
      });
    }
    cursor = sw.tick;
    currentGame = sw.game;
    currentStyle = sw.style ?? 0;
  }

  const endCap = Math.max(totalTicks, timeline.finish, timeline.end, cursor + 4 * TPB);
  sections.push({
    game: currentGame,
    startTick: cursor,
    endTick: endCap,
    transitionStyle: currentStyle,
  });

  return sections;
}

/**
 * Heaven Studio Minigame.cs-inspired timing judgment evaluator anchored on Groove Engine TPB=480.
 * Checks nearest input target beat (`ev.tick + leadInBeats * TPB`, or `ev.tick` when leadIn is 0).
 */
export function evaluatePlayalongHit(
  timeline: Timeline,
  hitTick: number,
  bpm: number
): PlayalongHitResult | null {
  const safeBpm = Math.max(20, bpm);
  const msPerTick = (60_000 / safeBpm) / TPB;
  let best: PlayalongHitResult | null = null;
  let bestAbsMs = Infinity;

  for (const ev of timeline.events) {
    if (ev.op !== 'call' || !ev.game) continue;
    const def = findCueDef(ev.game, ev.fn ?? 0, ev.args ?? [0, 0, 0, 0], ev.word ?? null);
    const leadTicks = Math.round((def?.leadInBeats ?? 0) * TPB);
    const targetTick = ev.tick + leadTicks;
    const deltaMs = (hitTick - targetTick) * msPerTick;
    const absMs = Math.abs(deltaMs);
    if (absMs < bestAbsMs && absMs <= 165) {
      bestAbsMs = absMs;
      let judgement: HitJudgement = 'MISS';
      if (absMs <= 16) judgement = 'ACE';
      else if (absMs <= 55) judgement = 'JUST';
      else if (absMs <= 115) judgement = deltaMs < 0 ? 'EARLY' : 'LATE';
      best = {
        judgement,
        deltaMs: Math.round(deltaMs),
        targetTick,
        game: ev.game,
        cueName: ev.word ?? def?.name ?? ev.game,
      };
    }
  }
  return best;
}

export function loadUserPatterns(): StoredPattern[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PATTERNS);
    if (!raw) return [];
    const parsed = parseStrictJson(raw);
    if (!Array.isArray(parsed)) return [];
    const out: StoredPattern[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const g = canonicalGame(String(obj.primaryGame ?? ''));
      if (!g || typeof obj.id !== 'string' || typeof obj.name !== 'string' || !Array.isArray(obj.events)) {
        continue;
      }
      const cleanEvents: PatternEventSpec[] = [];
      for (const ev of obj.events) {
        if (!ev || typeof ev !== 'object') continue;
        const eObj = ev as Record<string, unknown>;
        const op = eObj.op;
        if (op !== 'call' && op !== 'switch' && op !== 'fade' && op !== 'anim') continue;
        const evGame = eObj.game ? canonicalGame(String(eObj.game)) ?? undefined : undefined;
        cleanEvents.push({
          relTick: typeof eObj.relTick === 'number' && Number.isFinite(eObj.relTick) ? Math.max(0, eObj.relTick) : 0,
          op,
          game: evGame,
          fn: typeof eObj.fn === 'number' ? eObj.fn : undefined,
          args:
            Array.isArray(eObj.args) && eObj.args.length === 4
              ? ([
                  Number(eObj.args[0]) || 0,
                  Number(eObj.args[1]) || 0,
                  Number(eObj.args[2]) || 0,
                  Number(eObj.args[3]) || 0,
                ] as [number, number, number, number])
              : undefined,
          word: typeof eObj.word === 'string' ? (eObj.word as TheAWord) : null,
          tag: typeof eObj.tag === 'string' ? eObj.tag : null,
          style: typeof eObj.style === 'number' ? eObj.style : undefined,
          sub: typeof eObj.sub === 'number' ? eObj.sub : undefined,
          fadeLen: typeof eObj.fadeLen === 'number' ? eObj.fadeLen : undefined,
          alpha: typeof eObj.alpha === 'number' ? eObj.alpha : undefined,
          layout: typeof eObj.layout === 'number' ? eObj.layout : undefined,
          animName: typeof eObj.animName === 'string' ? eObj.animName : undefined,
        });
      }
      if (cleanEvents.length > 0) {
        out.push({
          id: obj.id,
          name: obj.name,
          primaryGame: g,
          description: typeof obj.description === 'string' ? obj.description : `${cleanEvents.length} events`,
          durationTicks: typeof obj.durationTicks === 'number' ? Math.max(TPB, obj.durationTicks) : 4 * TPB,
          builtIn: false,
          events: cleanEvents,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function saveUserPatterns(patterns: StoredPattern[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const custom = patterns.filter((p) => !p.builtIn);
    localStorage.setItem(STORAGE_KEY_PATTERNS, JSON.stringify(custom));
  } catch {
    // ignore quota errors
  }
}

export function loadFavoriteGames(): GameId[] {
  if (typeof localStorage === 'undefined') return ['KAERU', 'CARS', 'RING', 'THE_A'];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FAVORITES);
    if (!raw) return ['KAERU', 'CARS', 'RING', 'THE_A'];
    const arr = parseStrictJson(raw);
    if (!Array.isArray(arr)) return ['KAERU', 'CARS', 'RING', 'THE_A'];
    return arr.map((x) => canonicalGame(String(x))).filter((g): g is GameId => Boolean(g));
  } catch {
    return ['KAERU', 'CARS', 'RING', 'THE_A'];
  }
}

export function saveFavoriteGames(games: GameId[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_FAVORITES, JSON.stringify(games));
  } catch {
    // ignore
  }
}

export function loadRecentGames(): GameId[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RECENTS);
    if (!raw) return [];
    const arr = parseStrictJson(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => canonicalGame(String(x))).filter((g): g is GameId => Boolean(g));
  } catch {
    return [];
  }
}

export function saveRecentGames(games: GameId[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(games.slice(0, 8)));
  } catch {
    // ignore
  }
}
