import { type GameId } from './cues.ts';
import pinnedContract from './engine_contract.pinned.json' with { type: 'json' };

/**
 * Native Groove Engine validation contract loaded directly from pinned:
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

export const ENGINE_CONTRACT: EngineContractSchema = pinnedContract as unknown as EngineContractSchema;

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
