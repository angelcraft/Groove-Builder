import { GameId } from './cues.ts';

/**
 * Native Groove Engine validation contract aligned with:
 * codex/engine-v0.5.1-hardening/tools/engine_contract.json
 * codex/engine-v0.5.1-hardening/engine/src/cue_validation.hpp
 * codex/engine-v0.5.1-hardening/engine/src/parser_support.hpp
 */

export const CONTRACT_VERSION = 1;

export const MAX_FILE_BYTES = 60 * 1024;
export const MAX_SOURCE_LINES = 4096;
export const MAX_LINE_BYTES = 255;
export const MAX_TOKENS = 12;
export const MAX_EXPANSION_WORK = 32768;
export const MAX_LOOP_CALL_DEPTH = 8;
export const MAX_DEFS = 32;
export const MAX_TICK = 0x7fffffff;
export const STRING_POOL_MAX = 8192;

export type ArgTuple = [number, number, number, number];

export interface BlockedProfile {
  cue: string;
  args: ArgTuple;
  reason: string;
}

export interface EngineContractSchema {
  version: number;
  provenance: string[];
  layouts: Partial<Record<GameId, number>>;
  cue_args: Record<string, ArgTuple[]>;
  ring_mask: {
    min: number;
    max: number;
    second: number[];
    third: number;
    fourth: number;
  };
  blocked_profiles: BlockedProfile[];
}

export const ENGINE_CONTRACT: EngineContractSchema = {
  version: 1,
  provenance: ['docs/cue_functions.md', 'tools/gtf.py:_CUE_ROWS'],
  layouts: {
    FLYDISC: 16568,
    ROLLING: 15880,
    HUNGRY: 15536,
    CARS: 15536,
    KAERU: 18296,
    CRAB: 15192,
    INSECT: 15528,
    SOFTCATCH: 15536,
    RING: 15192,
    THUNDER: 15192,
    HAMMER: 15192,
    MOON: 15872,
    THE_A: 17248,
    PUTILABO: 15880,
    WIPER: 16224,
    SOCCER: 15872,
    HURDLE: 15536,
    TALK: 15536,
    COOKING: 15536,
    PARASOL: 15528,
    DANCER: 15880,
    SAMURAI: 15880,
    BRUSH: 16560,
  },
  cue_args: {
    'BRUSH:0x15A560': [[4, 1, 0, 0], [6, 1, 1, 0], [12, 1, 1, 0]],
    'BRUSH:0x15AB00': [[0, 0, 0, 0], [2, 0, -1, 0]],
    'BRUSH:0x15AF40': [[0, 0, -1, 0], [0, 0, 0, 0], [0, 1, 1, 0]],
    'BRUSH:0x15B2E0': [[0, 0, -1, 0], [0, 0, 0, 0], [0, 1, 1, 0]],
    'CARS:0x1601D0': [[0, 0, 0, 0], [1, 0, 0, 0]],
    'CARS:0x1608F0': [[0, -1, 0, 0], [0, -1, 1, 0]],
    'COOKING:0x178880': [
      [0, 1, -1, 0],
      [0, 1, 0, 0],
      [0, 3, 0, 0],
      [1, 1, 0, 0],
      [1, 3, 0, 0],
      [2, 1, 0, 0],
      [2, 3, 0, 0],
      [3, 1, -1, 0],
      [3, 1, 0, 0],
      [3, 3, 0, 0],
    ],
    'COOKING:0x178DC0': [[3, 2, -1, -1], [3, 2, -1, 0]],
    'CRAB:0x17BFC0': [[-1, -1, -1, 0]],
    'CRAB:0x17D0D0': [[-1, -1, -1, 0]],
    'DANCER:0x181210': [[4, 3, 0, 0], [8, 3, 0, 0], [10, 1, 0, 0], [12, 3, 0, 0]],
    'DANCER:0x181C70': [[4, 1, 1, 0], [8, 1, 0, 0], [12, 3, 0, 0]],
    'DANCER:0x182460': [[0, 0, 0, 0], [0, 1, 0, 0]],
    'FLYDISC:0x18D3F0': [[0, 3360, -1, 0]],
    'HAMMER:0x1AB410': [[-3360, 0, 7680, 0], [-1440, 1, 7680, 0], [-960, 1, 7680, 0], [0, 0, 7680, 0]],
    'HAMMER:0x1ABCB0': [[-1440, 0, 7680, 0], [-1440, 1, 7680, 0], [-1200, 1, 7680, 0], [0, 0, 7680, 0]],
    'HUNGRY:0x1AF800': [[0, 0, 0, 0], [1, 0, 0, 0]],
    'HURDLE:0x1B1FC0': [[0, 0, 0, 0], [1, 0, 0, 0]],
    'HURDLE:0x1B24D0': [[2, 0, 0, 0], [2, 2, 0, 0], [5, 0, 0, 0]],
    'INSECT:0x1B54C0': [[360, 1920, 0, 0], [720, 1920, 0, 0]],
    'INSECT:0x1B5A60': [[240, 1920, 0, 0], [480, 1920, 0, 0]],
    'INSECT:0x1B60F0': [[480, 1920, 0, 0]],
    'KAERU:0x1B8DB0': [[2, 0, 0, 0], [3, 0, 0, 0], [4, 0, 0, 0], [4, 1, 0, 0], [5, 0, 0, 0]],
    'KAERU:0x1B8F70': [[3, 0, 0, 0], [3, 3, 0, 0]],
    'MOON:0x1DB630': [[0, 0, 0, 0], [1, 0, 0, 0], [1, 1, -1, 0]],
    'PARASOL:0x204970': [[480, 0, 0, 0], [480, 1, 0, 0], [960, 0, 0, 0], [960, 1, 0, 0]],
    'PARASOL:0x205030': [[1, 1, 0, 0]],
    'PUMPUP:0x209B80': [[0, 0, 0, 0], [1, 0, 0, 0]],
    'PUMPUP:0x20A170': [[0, 0, 0, 0]],
    'PUTILABO:0x20BF90': [[0, 0, 0, 0], [0, 1, 0, 0]],
    'PUTILABO:0x20C190': [[240, 0, 0, 0], [480, 0, 0, 0]],
    'RING:0x217960': [[-1, 0, 0, 0], [-1, 1, 0, 0], [0, 1, 0, 0]],
    'ROLLING:0x222FA0': [[0, 0, 0, 0], [0, 3360, -1, 0], [1, 0, 0, 0], [2, 0, 0, 0]],
    'ROLLING:0x223350': [[0, 0, 0, 0], [0, 3360, -1, 0]],
    'ROLLING:0x223800': [[0, 0, 0, 0]],
    'SAMURAI:0x22AD50': [[1, 1, 0, 0], [1, 2, 0, 0], [1, 3, 0, 0], [2, 2, 0, 0]],
    'SAMURAI:0x22AFF0': [[1, 1, 0, 0]],
    'SOCCER:0x246760': [[0, 0, 0, 0], [0, 1920, 0, 0]],
    'SOCCER:0x246B80': [[0, 0, 0, 0], [0, 1920, 0, 0]],
    'SOCCER:0x246FF0': [[0, 0, 0, 0], [0, 1920, 0, 0]],
    'SOFTCATCH:0x248B70': [[0, 320, 0, 0], [0, 480, 0, 0], [1, 320, 0, 0], [1, 480, 0, 0]],
    'TALK:0x255100': [[1, 0, 0, 0], [4, 0, 0, 0]],
    'THE_A:0x278FE0': [[0, 0, 0, 0]],
    'THUNDER:0x27DBA0': [[1, 0, 0, 0], [2, 0, 0, 0]],
    'THUNDER:0x27E130': [[0, 0, 0, 0]],
    'THUNDER:0x27E6C0': [[1, 0, 0, 0], [2, 0, 0, 0]],
    'THUNDER:0x27EC00': [[0, 0, 0, 0]],
    'WIPER:0x2A9700': [[0, 0, 0, 0], [1, 0, 0, 0]],
    'WIPER:0x2A9900': [[1, 0, 0, 0]],
    'WIPER:0x2A9B00': [[3, 0, 0, 0]],
    'WIPER:0x2AA2F0': [[0, 0, 0, 0], [3, 0, 0, 0]],
    'WIPER:0x2AA4F0': [[0, 0, 0, 0], [3, 0, 0, 0]],
    'WIPER:0x2AA6F0': [[0, 0, 0, 0], [3, 0, 0, 0], [9, 0, 0, 0], [15, 0, 0, 0]],
  },
  ring_mask: {
    min: -1,
    max: 15,
    second: [0, 1],
    third: 0,
    fourth: 0,
  },
  blocked_profiles: [
    {
      cue: 'THUNDER:0x27DBA0',
      args: [1, 11420568, 0, 0],
      reason: 'Reference-like raw value; native ABI/ASLR interpretation not established',
    },
    {
      cue: 'THUNDER:0x27DBA0',
      args: [1, 11420576, 0, 0],
      reason: 'Reference-like raw value; native ABI/ASLR interpretation not established',
    },
    {
      cue: 'THUNDER:0x27E6C0',
      args: [1, 11420576, 0, 0],
      reason: 'Reference-like raw value; native ABI/ASLR interpretation not established',
    },
  ],
};

export function cueContractKey(game: GameId, fn: number): string {
  return `${game}:0x${fn.toString(16).toUpperCase()}`;
}

export function isRingMaskCue(game: GameId, fn: number): boolean {
  return game === 'RING' && fn === 0x217960;
}

export function getAllowedCueProfiles(game: GameId, fn: number): ArgTuple[] {
  return ENGINE_CONTRACT.cue_args[cueContractKey(game, fn)] ?? [];
}

export function validateCueArgsContract(
  game: GameId,
  fn: number,
  args: ArgTuple
): { ok: boolean; blocked?: boolean; reason?: string } {
  const key = cueContractKey(game, fn);

  for (const b of ENGINE_CONTRACT.blocked_profiles) {
    if (
      b.cue === key &&
      b.args[0] === args[0] &&
      b.args[1] === args[1] &&
      b.args[2] === args[2] &&
      b.args[3] === args[3]
    ) {
      return {
        ok: false,
        blocked: true,
        reason: `${key} [${args.join(', ')}] bloqueado por el motor nativo: ${b.reason}`,
      };
    }
  }

  if (isRingMaskCue(game, fn)) {
    const rm = ENGINE_CONTRACT.ring_mask;
    const ok =
      args[0] >= rm.min &&
      args[0] <= rm.max &&
      rm.second.includes(args[1]) &&
      args[2] === rm.third &&
      args[3] === rm.fourth;
    if (!ok) {
      return {
        ok: false,
        reason: `${key} [${args.join(', ')}] fuera de dominio ring_mask (a=${rm.min}..${rm.max}, b=0|1, c=0, d=0)`,
      };
    }
    return { ok: true };
  }

  const allowed = ENGINE_CONTRACT.cue_args[key];
  if (!allowed || allowed.length === 0) {
    return {
      ok: false,
      reason: `Funcion ${key} no tiene perfiles verificados en engine_contract.json`,
    };
  }

  const matches = allowed.some(
    (p) => p[0] === args[0] && p[1] === args[1] && p[2] === args[2] && p[3] === args[3]
  );
  if (!matches) {
    return {
      ok: false,
      reason: `${key} [${args.join(', ')}] fuera del dominio verificado (${allowed.map((p) => `[${p.join(',')}]`).join(' | ')})`,
    };
  }

  return { ok: true };
}

export function snapCueArgsToContract(game: GameId, fn: number, desired: ArgTuple): ArgTuple {
  if (isRingMaskCue(game, fn)) {
    const rm = ENGINE_CONTRACT.ring_mask;
    const a = Math.max(rm.min, Math.min(rm.max, Math.round(desired[0])));
    const b = desired[1] === 1 ? 1 : 0;
    return [a, b, rm.third, rm.fourth];
  }

  const profiles = getAllowedCueProfiles(game, fn);
  if (profiles.length === 0) return [...desired] as ArgTuple;

  let best = profiles[0];
  let bestScore = Infinity;
  for (const p of profiles) {
    const dist =
      Math.abs(p[0] - desired[0]) +
      Math.abs(p[1] - desired[1]) * 10 +
      Math.abs(p[2] - desired[2]) * 100 +
      Math.abs(p[3] - desired[3]) * 100;
    if (dist < bestScore) {
      bestScore = dist;
      best = p;
    }
  }
  return [...best] as ArgTuple;
}

export function isValidLayoutContract(game: GameId, layout: number): boolean {
  const expected = ENGINE_CONTRACT.layouts[game];
  return typeof expected === 'number' && layout === expected;
}

export function isValidAnimNameContract(name: string): boolean {
  return /^[A-Za-z0-9_]{1,47}$/.test(name);
}

export function isValidMatchContract(match: [number, number, number]): boolean {
  return (
    Number.isInteger(match[0]) &&
    Number.isInteger(match[1]) &&
    Number.isInteger(match[2]) &&
    match[0] >= -1 &&
    match[0] <= 2 &&
    match[1] >= 0 &&
    match[1] < 12 &&
    match[2] >= 0 &&
    match[2] < 5
  );
}

export function isValidPrologueContract(prologue: string): boolean {
  if (!prologue) return true;
  if (!/^[A-Za-z0-9_/-]+$/.test(prologue)) return false;
  if (prologue.startsWith('/') || prologue.includes('..')) return false;
  return new TextEncoder().encode(prologue).length <= 95;
}
