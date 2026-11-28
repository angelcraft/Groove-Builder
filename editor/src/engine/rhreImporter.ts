import {
  canonicalGame,
  CUE_FNS,
  type GameId,
  LAYOUT_OFF,
  THE_A_WORDS,
  type TheAWord,
  TPB,
} from './cues.ts';
import {
  isValidAnimNameContract,
  isValidLayoutContract,
  snapCueArgsToContract,
  validateCueArgsContract,
} from './engineContract.ts';
import {
  createDefaultTimeline,
  nextEventId,
  type Timeline,
  type TimelineEvent,
} from './gtfEngine.ts';
import {
  decodeUtf8Strict,
  inspectAndOpenZip,
  parseStrictJson,
} from './zipSecurity.ts';

const MAX_RHRE_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_RHRE_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_RHRE_JSON_BYTES = 16 * 1024 * 1024;
const MAX_RHRE_FILES = 512;

interface PatternRule {
  game: GameId;
  fn: number;
  args: (number | TheAWord)[];
  callOffset: number;
  endOffset: number;
  note?: string;
}

const PATTERN_RULES: Record<string, PatternRule> = {};

function addPr(
  rhreGame: string,
  names: string[],
  game: GameId,
  fn: number,
  args: (number | TheAWord)[],
  callOffset: number,
  endOffset: number,
  note?: string
) {
  for (const n of names) {
    PATTERN_RULES[`${rhreGame}_${n}`] = { game, fn, args, callOffset, endOffset, note };
  }
}

addPr('sneezyMoon', ['greenSneeze', 'greenSneezeFast', 'greenSneezePractice'], 'MOON', 0x1DB630, [1, 0, 0], -1.0, 3.5);
addPr('sneezyMoon', ['greenSneezeStandalone', 'greenSneezeFastStandalone', 'greenSneezeStandalonePractice'], 'MOON', 0x1DB630, [0, 0, 0], -3.0, 1.5);
addPr('ribbitRocket', ['frog3'], 'KAERU', 0x1B8DB0, [3, 0, 0], -3.0, 2.5);
addPr('ribbitRocket', ['frog4'], 'KAERU', 0x1B8DB0, [4, 0, 0], -2.0, 3.5);
addPr('ribbitRocket', ['frog5'], 'KAERU', 0x1B8DB0, [5, 0, 0], -1.0, 4.5);
addPr('hopStopNRoll', ['rolling', 'rollingHops', 'rollingWithPartyPopper', 'rollingHopsWithPartyPopper'], 'ROLLING', 0x222FA0, [1, 0, 0], -2.0, 2.5);
addPr('hopStopNRoll', ['stopHopping'], 'ROLLING', 0x222FA0, [2, 0, 0], -1.0, 4.0);
addPr('hopStopNRoll', ['startHopping'], 'ROLLING', 0x223350, [0, 0, 0], -2.0, 2.5, 'aprox: startHopping');
addPr('fruitFlex', ['apple'], 'PUMPUP', 0x209B80, [1, 0, 0], -1.75, 2.75, 'aprox: manzana alineada al primer flex');
addPr('fruitFlex', ['lemon'], 'PUMPUP', 0x20A170, [0, 0, 0], -1.5, 2.75);
addPr('wiperBosses', ['pinkSlow'], 'WIPER', 0x2A9700, [0, 0, 0], -1.0, 6.5);
addPr('wiperBosses', ['blueSlow'], 'WIPER', 0x2A9900, [1, 0, 0], -1.0, 6.5);
addPr('wiperBosses', ['bothSlow'], 'WIPER', 0x2A9B00, [3, 0, 0], -1.0, 6.5);
addPr('wiperBosses', ['pinkFast'], 'WIPER', 0x2AA2F0, [3, 0, 0], -1.0, 3.5);
addPr('wiperBosses', ['blueFast'], 'WIPER', 0x2AA4F0, [3, 0, 0], -1.0, 3.5);
addPr('wiperBosses', ['bothFast'], 'WIPER', 0x2AA6F0, [3, 0, 0], -1.0, 3.5);
addPr('soccerDreams', ['white'], 'SOCCER', 0x246760, [0, 0, 0], -3.5, 2.0);
addPr('soccerDreams', ['pink'], 'SOCCER', 0x246B80, [0, 0, 0], -2.5, 4.0);
addPr('soccerDreams', ['yellow'], 'SOCCER', 0x246FF0, [0, 0, 0], -2.5, 5.0);
addPr('soccerDreams', ['yellowThunder'], 'SOCCER', 0x246FF0, [0, 1920, 0], -2.5, 5.0, 'aprox: yellowThunder');
addPr('lightningBolting', ['cloudYellow', 'cloudYellowSwing'], 'THUNDER', 0x27DBA0, [1, 0, 0], -1.0, 3.0);
addPr('lightningBolting', ['cloudPink', 'cloudPinkSwing'], 'THUNDER', 0x27E6C0, [1, 0, 0], -1.5, 2.5);
addPr('discDog', ['throw', 'throwGrowl', 'throwCounting', 'throwCountingGrowl', 'throwFade', 'throwFadeGrowl', 'throwCountingOffbeat', 'throwCountingGrowlOffbeat', 'throwFadeOffbeat', 'throwFadeGrowlOffbeat'], 'FLYDISC', 0x18D3F0, [0, 3360, -1, 0], -2.0, 10.5);
addPr('aForEffort', ['tea'], 'THE_A', 0x278FE0, ['TEA'], -4.0, 4.0);
addPr('aForEffort', ['soda'], 'THE_A', 0x278FE0, ['SODA'], -4.0, 3.5);
addPr('aForEffort', ['cocoa'], 'THE_A', 0x278FE0, ['COCOA'], -4.0, 4.0);
addPr('aForEffort', ['aaa'], 'THE_A', 0x278FE0, ['AAA'], -4.0, 4.0, 'aprox: AAA');
addPr('brollyGoodShow', ['allez'], 'PARASOL', 0x205030, [1, 1, 0, 0], -1.0, 2.5);
addPr('brollyGoodShow', ['encore', 'encoreCheer'], 'PARASOL', 0x204970, [480, 0, 0, 0], -3.0, 2.75);
for (const n of [1, 2, 3, 4]) {
  addPr('sliceNDiceKitchen', [`tomato${n}`], 'COOKING', 0x178880, [n - 1, 1, 0, 0], -1.5, 2.0);
  addPr('sliceNDiceKitchen', [`pepper${n}`], 'COOKING', 0x178880, [n - 1, 3, 0, 0], -1.5, 2.0);
}
addPr('sliceNDiceKitchen', ['broccoli'], 'COOKING', 0x178DC0, [3, 2, -1, -1], -2.0, 2.5);
addPr('backupSpotlight', ['flashyLeft', 'flashyRight'], 'DANCER', 0x182460, [0, 1, 0, 0], -3.5, 3.0);
addPr('sweeperStar', ['sweepThree'], 'BRUSH', 0x15AB00, [0, 0, 0, 0], -3.5, 4.0);
addPr('sweeperStar', ['spin', 'spinTimestretched'], 'BRUSH', 0x15AF40, [0, 0, 0, 0], -2.0, 2.5);
addPr('spiritSlasher', ['singleSlash', 'singleStarter'], 'SAMURAI', 0x22AD50, [1, 1, 0, 0], -2.0, 3.5);
addPr('spiritSlasher', ['doubleSlash', 'doubleStarter'], 'SAMURAI', 0x22AFF0, [1, 1, 0, 0], -2.0, 4.0);
addPr('popDontDrop', ['softGrow'], 'PUTILABO', 0x20BF90, [0, 0, 0, 0], -5.0, 3.5);
addPr('popDontDrop', ['hardGrow'], 'PUTILABO', 0x20C190, [480, 0, 0, 0], -5.0, 3.5);
addPr('yumBotSimulator', ['pudding', 'puddingPractice'], 'SOFTCATCH', 0x248B70, [0, 320, 0, 0], -2.0, 2.5);
addPr('yumBotSimulator', ['puddingLong', 'puddingLongPractice'], 'SOFTCATCH', 0x248B70, [0, 480, 0, 0], -2.0, 3.5);
addPr('yumBotSimulator', ['defectivePudding'], 'SOFTCATCH', 0x248B70, [1, 320, 0, 0], -1.0, 3.5);
addPr('yumBotSimulator', ['defectivePuddingLong'], 'SOFTCATCH', 0x248B70, [1, 480, 0, 0], -1.0, 4.5);
addPr('stopNGoNStop', ['accel'], 'CARS', 0x1601D0, [1, 0, 0, 0], -0.5, 4.0);
addPr('stopNGoNStop', ['accelRemix7'], 'CARS', 0x1601D0, [0, 0, 0, 0], -2.5, 2.0);
addPr('stopNGoNStop', ['brake'], 'CARS', 0x1608F0, [0, -1, 0, 0], -2.0, 2.5);
addPr('flutterSpeed', ['butterfly', 'butterflyNoVoice'], 'INSECT', 0x1B54C0, [360, 1920, 0, 0], -4.0, 2.0);
addPr('flutterSpeed', ['butterflyRemix5', 'butterflyRemix5Counting', 'butterflyRemix5NoVoice', 'butterflyRemix5CountingNoVoice'], 'INSECT', 0x1B54C0, [720, 1920, 0, 0], -4.0, 3.5);
addPr('flutterSpeed', ['grasshopper', 'grasshopperNoVoice'], 'INSECT', 0x1B5A60, [240, 1920, 0, 0], -4.0, 2.0);
addPr('flutterSpeed', ['grasshopperRemix5', 'grasshopperRemix5NoVoice'], 'INSECT', 0x1B5A60, [480, 1920, 0, 0], -4.0, 3.5);
addPr('flutterSpeed', ['dragonfly', 'dragonflyNoVoice'], 'INSECT', 0x1B60F0, [480, 1920, 0, 0], -3.0, 4.5);
addPr('canDo', ['blue'], 'HAMMER', 0x1ABCB0, [0, 0, 7680, 0], -14.0, 3.5);
addPr('canDo', ['blueFrog'], 'HAMMER', 0x1ABCB0, [-1200, 1, 7680, 0], -14.0, 3.5);
addPr('canDo', ['red'], 'HAMMER', 0x1AB410, [0, 0, 7680, 0], -14.5, 3.0);
addPr('canDo', ['redFrog'], 'HAMMER', 0x1AB410, [-960, 1, 7680, 0], -14.5, 3.0);
addPr('hopNSlide', ['hop'], 'HURDLE', 0x1B1FC0, [0, 0, 0, 0], -6.0, 2.5);
addPr('hopNSlide', ['slide'], 'HURDLE', 0x1B1FC0, [1, 0, 0, 0], -6.5, 2.0);
addPr('alienAlphabet', ['cha', 'chaGrown'], 'TALK', 0x255100, [1, 0, 0, 0], -0.5, 3.5);

const EQUI_RULES: Record<string, { game: GameId; fn: number; bVal: number; isDefective?: boolean; callOffset: number; nCues: number }> = {
  brollyGoodShow_cho: { game: 'PARASOL', fn: 0x204970, bVal: 0, callOffset: -3.0, nCues: 4 },
  brollyGoodShow_pa: { game: 'PARASOL', fn: 0x204970, bVal: 1, callOffset: -3.0, nCues: 4 },
  yumBotSimulator_puddingCueStretchable: { game: 'SOFTCATCH', fn: 0x248B70, bVal: 0, isDefective: false, callOffset: -2.0, nCues: 4 },
  yumBotSimulator_defectivePuddingCueStretchable: { game: 'SOFTCATCH', fn: 0x248B70, bVal: 0, isDefective: true, callOffset: -2.0, nCues: 4 },
};

const PAIR_RULES: Record<string, { game: GameId; fn: number; b: number; c: number; callOffset: number; k: number; stopId: string; fallbackA: number }> = {
  backupSpotlight_countDanceL: { game: 'DANCER', fn: 0x181210, b: 3, c: 0, callOffset: -3.0, k: 2.0, stopId: 'backupSpotlight_countStop', fallbackA: 4 },
  backupSpotlight_countDanceR: { game: 'DANCER', fn: 0x181210, b: 3, c: 0, callOffset: -3.0, k: 2.0, stopId: 'backupSpotlight_countStop', fallbackA: 4 },
  backupSpotlight_countElbow: { game: 'DANCER', fn: 0x181C70, b: 3, c: 0, callOffset: -3.5, k: 2.5, stopId: 'backupSpotlight_countStop', fallbackA: 4 },
  sweeperStar_sweepingStart: { game: 'BRUSH', fn: 0x15A560, b: 1, c: 1, callOffset: -2.0, k: 0.0, stopId: 'sweeperStar_sweepingStop', fallbackA: 8 },
};

export interface RhreImportResult {
  timeline: Timeline;
  bpm: number;
  warnings: string[];
}

export async function importRhreFile(
  file: File | ArrayBuffer | Uint8Array,
  filename = 'remix.rhref'
): Promise<RhreImportResult> {
  const rawBytes =
    file instanceof Uint8Array
      ? file
      : file instanceof ArrayBuffer
      ? new Uint8Array(file)
      : new Uint8Array(await file.arrayBuffer());

  let remixJson: Record<string, unknown>;
  if (filename.toLowerCase().endsWith('.json')) {
    if (rawBytes.byteLength > MAX_RHRE_JSON_BYTES) {
      throw new Error('Archivo JSON RHREfresh supera el limite de 16 MiB');
    }
    const text = decodeUtf8Strict(rawBytes, filename);
    const parsed = parseStrictJson(text, 64);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('remix.json debe ser un objeto JSON');
    }
    remixJson = parsed as Record<string, unknown>;
  } else {
    const zip = await inspectAndOpenZip(rawBytes, {
      maxCompressedBytes: MAX_RHRE_ZIP_BYTES,
      maxTotalUncompressedBytes: MAX_RHRE_DECOMPRESSED_BYTES,
      maxEntries: MAX_RHRE_FILES,
      allowDirectories: true,
      allowDataDescriptor: true,
      maxEntryBytesByPath: (p) => (p === 'remix.json' ? MAX_RHRE_JSON_BYTES : MAX_RHRE_DECOMPRESSED_BYTES),
    });
    if (!zip.getEntry('remix.json')) {
      throw new Error('El archivo .rhref/.rhre3 no contiene remix.json');
    }
    const remixBytes = await zip.readBytes('remix.json', MAX_RHRE_JSON_BYTES);
    const parsed = parseStrictJson(remixBytes, 64);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('remix.json debe ser un objeto JSON');
    }
    remixJson = parsed as Record<string, unknown>;
  }
  return convertRhreJsonToTimeline(remixJson);
}

interface RhreEntity {
  datamodel?: string;
  beat?: number;
  width?: number;
  subtitle?: string;
}

export function convertRhreJsonToTimeline(remix: Record<string, unknown>): RhreImportResult {
  const warnings: string[] = [];
  const tl = createDefaultTimeline();
  const entities = (remix.entities as RhreEntity[]) ?? [];

  // Extract BPM
  const trackers = (remix.trackers as Record<string, unknown>) ?? {};
  const temposObj = (trackers.tempos as Record<string, unknown>) ?? {};
  const tempoTrackers = (temposObj.trackers as Array<{ bpm?: number }>) ?? [];
  const bpms = tempoTrackers.map((t) => Number(t.bpm ?? 0)).filter((b) => b > 0);
  const bpm = bpms.length > 0 ? bpms[0] : 120;
  if (new Set(bpms).size > 1) {
    warnings.push(`El remix tiene cambios de tempo (${bpms.join(', ')} BPM); el juego nativo usa un solo tempo del bgm.`);
  }

  let originBeat = 0;
  let endBeat: number | null = null;
  const changes: number[] = [];
  const rawCalls: Array<{
    callBeat: number;
    visBeat: number;
    game: GameId;
    fn: number;
    args: [number, number, number, number];
    word: TheAWord | null;
    tag: string | null;
    endBeat: number;
  }> = [];

  const stopsById = new Map<string, number[]>();
  const ringHoops: number[] = [];
  const ringSyls: Array<{ beat: number; name: string }> = [];
  const beastCues: Array<{ beat: number; name: string }> = [];
  const crabCues: Array<{ beat: number; name: string }> = [];
  const extraSubs: Array<{ beat: number; text: string }> = [];

  for (const e of entities) {
    const dm = e.datamodel ?? '';
    const b = Number(e.beat ?? 0);
    if (dm.endsWith('_countStop') || dm.endsWith('_sweepingStop')) {
      const arr = stopsById.get(dm) ?? [];
      arr.push(b);
      stopsById.set(dm, arr);
    }
  }
  for (const arr of stopsById.values()) arr.sort((a, b) => a - b);

  for (const e of entities) {
    const dm = e.datamodel ?? '';
    const b = Number(e.beat ?? 0);
    const width = Number(e.width ?? 1);

    if (dm === 'special_subtitleEntity' || dm === 'special_songTitleEntity' || dm === 'special_songArtistEntity') {
      const sub = (e.subtitle ?? '').trim();
      if (sub.toLowerCase().startsWith('gtl:')) {
        const cmd = sub.slice(4).trim();
        if (cmd === 'origin') originBeat = b;
        else extraSubs.push({ beat: b, text: cmd });
      }
      continue;
    }
    if (dm === 'special_endEntity') {
      endBeat = b;
      continue;
    }
    if (dm === 'special_gameChangeEntity' || dm.includes('gameChange')) {
      changes.push(b);
      continue;
    }

    // Hoop Trundling
    if (dm === 'hoopTrundling/hoop' || dm === 'hoopTrundling/hoopPass') {
      ringHoops.push(b);
      continue;
    }
    if (dm.startsWith('hoopTrundling/')) {
      const n = dm.split('/')[1];
      if (['pa', 'pi', 'pu', 'pe', 'po'].includes(n)) {
        ringSyls.push({ beat: b, name: n });
      } else {
        rawCalls.push({ callBeat: b, visBeat: b, game: 'RING', fn: 0x217960, args: [-1, 0, 0, 0], word: null, tag: 'basic', endBeat: b + 4 });
      }
      continue;
    }

    // Feeding the Beast
    if (dm.startsWith('feedingTheBeast/')) {
      beastCues.push({ beat: b, name: dm.split('/')[1] });
      continue;
    }

    // Crab Snacks
    if (dm.startsWith('crabSnacks/')) {
      crabCues.push({ beat: b, name: dm.split('/')[1] });
      continue;
    }

    // Equidistant stretchable
    if (dm in EQUI_RULES) {
      const rule = EQUI_RULES[dm];
      const wTicks = Math.max(120, Math.round(width * TPB));
      const rawArgs: [number, number, number, number] =
        rule.game === 'PARASOL' ? [wTicks, rule.bVal, 0, 0] : [rule.isDefective ? 1 : 0, wTicks, 0, 0];
      const args = snapCueArgsToContract(rule.game, rule.fn, rawArgs);
      if (args.join(',') !== rawArgs.join(',')) {
        warnings.push(`${dm} @ beat ${b}: args [${rawArgs.join(', ')}] ajustados al perfil verificado [${args.join(', ')}] (engine_contract.json).`);
      }
      rawCalls.push({
        callBeat: b + rule.callOffset,
        visBeat: b,
        game: rule.game,
        fn: rule.fn,
        args,
        word: null,
        tag: 'basic',
        endBeat: b + rule.nCues * width,
      });
      continue;
    }

    // Pair rules
    if (dm in PAIR_RULES) {
      const pr = PAIR_RULES[dm];
      const stops = stopsById.get(pr.stopId) ?? [];
      const stopBeat = stops.find((sb) => sb > b);
      const aVal = stopBeat !== undefined ? Math.max(1, Math.round(stopBeat - b + pr.k)) : pr.fallbackA;
      const rawArgs: [number, number, number, number] = [aVal, pr.b, pr.c, 0];
      const args = snapCueArgsToContract(pr.game, pr.fn, rawArgs);
      if (args.join(',') !== rawArgs.join(',')) {
        warnings.push(`${dm} @ beat ${b}: args [${rawArgs.join(', ')}] ajustados al perfil verificado [${args.join(', ')}] (engine_contract.json).`);
      }
      rawCalls.push({
        callBeat: b + pr.callOffset,
        visBeat: b,
        game: pr.game,
        fn: pr.fn,
        args,
        word: null,
        tag: 'basic',
        endBeat: stopBeat ?? b + 4,
      });
      continue;
    }

    // Standard pattern rules
    if (dm in PATTERN_RULES) {
      const pr = PATTERN_RULES[dm];
      if (pr.note) warnings.push(`${dm} @ beat ${b}: ${pr.note}`);
      const isWord = CUE_FNS.get(`${pr.game}:${pr.fn}`) === 1;
      const word = isWord && typeof pr.args[0] === 'string' && (THE_A_WORDS as readonly string[]).includes(pr.args[0])
        ? (pr.args[0] as TheAWord)
        : null;
      const rawArgs: [number, number, number, number] = isWord
        ? [0, 0, 0, 0]
        : [Number(pr.args[0] ?? 0), Number(pr.args[1] ?? 0), Number(pr.args[2] ?? 0), Number(pr.args[3] ?? 0)];
      const numArgs = validateCueArgsContract(pr.game, pr.fn, rawArgs).ok
        ? rawArgs
        : snapCueArgsToContract(pr.game, pr.fn, rawArgs);
      rawCalls.push({
        callBeat: b + pr.callOffset,
        visBeat: b,
        game: pr.game,
        fn: pr.fn,
        args: numArgs,
        word,
        tag: 'basic',
        endBeat: b + pr.endOffset,
      });
      continue;
    }
  }

  // Resolve Hoop Trundling
  const sylOff: Record<string, number> = { pa: 1, pi: 1.5, pu: 2, pe: 2.5, po: 3 };
  for (const h of ringHoops) {
    let mask = 0;
    const names = ['pa', 'pi', 'pu', 'pe'];
    names.forEach((s, idx) => {
      if (ringSyls.some((x) => x.name === s && Math.abs(x.beat - (h + sylOff[s])) < 0.05)) {
        mask |= 1 << idx;
      }
    });
    if (mask === 15 || mask === 0) mask = -1;
    rawCalls.push({ callBeat: h, visBeat: h, game: 'RING', fn: 0x217960, args: [mask, 0, 0, 0], word: null, tag: 'basic', endBeat: h + 3.5 });
  }

  // Resolve Feeding the Beast
  for (const bc of beastCues) {
    if (bc.name.includes('Yellow') || bc.name.includes('yellow') || bc.name === 'munch1' || bc.name === 'pinkHeartShoot') {
      rawCalls.push({ callBeat: bc.beat - 8, visBeat: bc.beat, game: 'HUNGRY', fn: 0x1AF800, args: [0, 0, 0, 0], word: null, tag: 'basic', endBeat: bc.beat + 1 });
    } else if (bc.name.includes('Purple') || bc.name.includes('purple') || bc.name === 'munch2' || bc.name === 'greenHeartShoot') {
      rawCalls.push({ callBeat: bc.beat - 8, visBeat: bc.beat, game: 'HUNGRY', fn: 0x1AF800, args: [1, 0, 0, 0], word: null, tag: 'basic', endBeat: bc.beat + 1 });
    }
  }

  // Resolve Crab Snacks
  for (const cc of crabCues) {
    if (cc.name.startsWith('macaron')) {
      rawCalls.push({ callBeat: cc.beat - 2, visBeat: cc.beat, game: 'CRAB', fn: 0x17BFC0, args: [-1, -1, -1, 0], word: null, tag: 'basic', endBeat: cc.beat + 2 });
    } else if (cc.name.startsWith('favabean')) {
      rawCalls.push({ callBeat: cc.beat - 2, visBeat: cc.beat, game: 'CRAB', fn: 0x17D0D0, args: [-1, -1, -1, 0], word: null, tag: 'basic', endBeat: cc.beat + 3 });
    }
  }

  const toTick = (b: number) => Math.round((b - originBeat) * TPB);
  const events: TimelineEvent[] = [];

  // Process gtl: subtitles
  const explicitSwitches: Array<{ beat: number; game: GameId; style: number }> = [];
  for (const sub of extraSubs) {
    const parts = sub.text.split(/\s+/);
    const op = parts[0]?.toLowerCase();
    if (op === 'title' && parts.length > 1) {
      tl.title = parts.slice(1).join(' ');
    } else if (op === 'start' && parts.length > 1) {
      tl.start = toTick(Number(parts[1]));
    } else if (op === 'translen' && parts.length > 1) {
      tl.translen = Number(parts[1]);
    } else if (op === 'end') {
      endBeat = sub.beat;
    } else if (op === 'finish') {
      tl.finish = toTick(sub.beat);
    } else if (op === 'switch' && parts.length > 1) {
      const g = canonicalGame(parts[1]);
      if (g) {
        const st = parts[2]?.toLowerCase();
        const style = st === 'cut' || st === 'hard' ? -1 : Number(parts[2] ?? 0) || 0;
        explicitSwitches.push({ beat: sub.beat, game: g, style });
      }
    } else if (op === 'fade' && parts.length >= 3) {
      events.push({ id: nextEventId('fade'), tick: Math.max(0, toTick(sub.beat)), op: 'fade', fadeLen: Number(parts[1]), alpha: Number(parts[2]) });
    } else if (op === 'anim' && parts.length >= 3) {
      const g = canonicalGame(parts[1]);
      if (g) {
        const layout = LAYOUT_OFF[g];
        const animName = parts[2];
        if (layout === undefined || !isValidLayoutContract(g, layout)) {
          warnings.push(`anim @ beat ${sub.beat}: ${g} no tiene layout verificado en engine_contract.json y se omitio.`);
        } else if (!isValidAnimNameContract(animName)) {
          warnings.push(`anim @ beat ${sub.beat}: nombre '${animName}' invalido y se omitio.`);
        } else {
          events.push({ id: nextEventId('anim'), tick: Math.max(0, toTick(sub.beat)), op: 'anim', game: g, layout, animName });
        }
      }
    }
  }

  rawCalls.sort((a, b) => a.callBeat - b.callBeat);
  const validCalls = rawCalls.filter((c) => {
    const tk = toTick(c.callBeat);
    if (tk < 0) {
      warnings.push(`${c.game} en pulso ${c.visBeat} necesita ${c.visBeat - c.callBeat} pulsos de antelación (quedó < 0) y se omitió.`);
      return false;
    }
    return true;
  });

  if (validCalls.length === 0 && explicitSwitches.length === 0) {
    throw new Error('El archivo RHREfresh no contiene cues compatibles con Groove Engine.');
  }

  let currentVisGame: GameId = explicitSwitches[0]?.game ?? validCalls[0]?.game ?? 'CARS';
  tl.first = currentVisGame;

  for (const sw of explicitSwitches) {
    const tk = toTick(sw.beat);
    if (tk > 0 && sw.game !== currentVisGame) {
      events.push({ id: nextEventId('sw'), tick: tk, op: 'switch', game: sw.game, style: sw.style, sub: 2 });
      currentVisGame = sw.game;
    }
  }

  // Insert automatic switches before game changes if not covered
  let lastAutoGame: GameId = tl.first;
  for (const c of validCalls) {
    const tk = toTick(c.callBeat);
    if (c.game !== lastAutoGame && !events.some((e) => e.op === 'switch' && Math.abs(e.tick - tk) <= 10 && e.game === c.game)) {
      events.push({ id: nextEventId('sw'), tick: tk, op: 'switch', game: c.game, style: 0, sub: 2 });
      lastAutoGame = c.game;
    }
    events.push({
      id: nextEventId('cue'),
      tick: tk,
      op: 'call',
      game: c.game,
      fn: c.fn,
      args: c.args,
      word: c.word,
      tag: c.tag,
    });
  }

  events.sort((a, b) => a.tick - b.tick);
  tl.events = events;

  const maxTick = events.length ? events[events.length - 1].tick : 0;
  tl.end = endBeat !== null ? Math.max(maxTick, toTick(endBeat)) : maxTick + 4 * TPB;
  if (tl.finish < tl.end) tl.finish = tl.end + 4 * TPB;

  return { timeline: tl, bpm, warnings };
}
