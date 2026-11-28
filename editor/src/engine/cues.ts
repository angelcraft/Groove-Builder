/**
 * Canonical Groove Engine v0.5.0 minigame & cue registry.
 * Mirrors engine/src/gtf_cues.hpp, tools/gtf.py, docs/cue_functions.md, and tools/groove_rhre.py.
 */

export const TPB = 480;
export const MAX_EVENTS = 2048;
export const MAX_GAMES = 24;
export const TITLE_MAX = 95;
export const PROLOGUE_MAX = 95;
export const JINGLE_MIN = 0x158;
export const JINGLE_MAX = 0x16C;

export const GAMES = [
  'PUMPUP',
  'FLYDISC',
  'ROLLING',
  'HUNGRY',
  'CARS',
  'KAERU',
  'CRAB',
  'INSECT',
  'SOFTCATCH',
  'RING',
  'THUNDER',
  'HAMMER',
  'MOON',
  'THE_A',
  'PUTILABO',
  'WIPER',
  'SOCCER',
  'HURDLE',
  'TALK',
  'COOKING',
  'PARASOL',
  'DANCER',
  'SAMURAI',
  'BRUSH',
] as const;

export type GameId = (typeof GAMES)[number];

export interface GameMeta {
  id: GameId;
  title: string;
  rhreName: string;
  accent: string;
  layoutOff: number | null;
  category: 'Sports & Action' | 'Creatures & Food' | 'Music & Stage' | 'Sci-Fi & Quirky';
  defaultLeadInBeats: number;
  summary: string;
}

export const GAME_META: Record<GameId, GameMeta> = {
  PUMPUP: {
    id: 'PUMPUP',
    title: 'Fruit Flex',
    rhreName: 'fruitFlex',
    accent: '#EF4444',
    layoutOff: null,
    category: 'Sports & Action',
    defaultLeadInBeats: 1.5,
    summary: 'Flex biceps with apples and lemons on the beat.',
  },
  FLYDISC: {
    id: 'FLYDISC',
    title: 'Disc Dog',
    rhreName: 'discDog',
    accent: '#F59E0B',
    layoutOff: 0x40B8,
    category: 'Creatures & Food',
    defaultLeadInBeats: 2,
    summary: 'Launch flying discs for the dog to catch.',
  },
  ROLLING: {
    id: 'ROLLING',
    title: 'Hop, Stop & Roll',
    rhreName: 'hopStopNRoll',
    accent: '#10B981',
    layoutOff: 0x3E08,
    category: 'Sports & Action',
    defaultLeadInBeats: 2,
    summary: 'Roll and stop hopping in sync with the troupe.',
  },
  HUNGRY: {
    id: 'HUNGRY',
    title: 'Feeding the Beast',
    rhreName: 'feedingTheBeast',
    accent: '#EC4899',
    layoutOff: 0x3CB0,
    category: 'Creatures & Food',
    defaultLeadInBeats: 8,
    summary: 'Shoot yellow or purple hearts to feed the beast (8-beat lead-in).',
  },
  CARS: {
    id: 'CARS',
    title: 'Stop, Go, Stop',
    rhreName: 'stopNGoNStop',
    accent: '#3B82F6',
    layoutOff: 0x3CB0,
    category: 'Sports & Action',
    defaultLeadInBeats: 2,
    summary: 'Accelerate and brake cars along the highway.',
  },
  KAERU: {
    id: 'KAERU',
    title: 'Ribbit Rocket',
    rhreName: 'ribbitRocket',
    accent: '#22C55E',
    layoutOff: 0x4778,
    category: 'Creatures & Food',
    defaultLeadInBeats: 3,
    summary: 'Call-and-response frog croaks (2, 3, 4, or 5 beats).',
  },
  CRAB: {
    id: 'CRAB',
    title: 'Crab Snacks',
    rhreName: 'crabSnacks',
    accent: '#F97316',
    layoutOff: 0x3B58,
    category: 'Creatures & Food',
    defaultLeadInBeats: 2,
    summary: 'Snap macarons and fava beans on crab claws.',
  },
  INSECT: {
    id: 'INSECT',
    title: 'Flutter Speed',
    rhreName: 'flutterSpeed',
    accent: '#84CC16',
    layoutOff: 0x3CA8,
    category: 'Creatures & Food',
    defaultLeadInBeats: 4,
    summary: 'Catch butterflies, grasshoppers, and dragonflies.',
  },
  SOFTCATCH: {
    id: 'SOFTCATCH',
    title: 'Yum-Bot Simulator',
    rhreName: 'yumBotSimulator',
    accent: '#FBBF24',
    layoutOff: 0x3CB0,
    category: 'Creatures & Food',
    defaultLeadInBeats: 2,
    summary: 'Serve standard, long, or defective puddings with custom tick spacing.',
  },
  RING: {
    id: 'RING',
    title: 'Hoop Trundling',
    rhreName: 'hoopTrundling',
    accent: '#06B6D4',
    layoutOff: 0x3B58,
    category: 'Sports & Action',
    defaultLeadInBeats: 0,
    summary: 'Pass the hoop through pa-pi-pu-pe-po beats.',
  },
  THUNDER: {
    id: 'THUNDER',
    title: 'Lightning Bolting',
    rhreName: 'lightningBolting',
    accent: '#EAB308',
    layoutOff: 0x3B58,
    category: 'Sci-Fi & Quirky',
    defaultLeadInBeats: 1,
    summary: 'Charge yellow and pink thunderclouds.',
  },
  HAMMER: {
    id: 'HAMMER',
    title: 'Can-Do',
    rhreName: 'canDo',
    accent: '#DC2626',
    layoutOff: 0x3B58,
    category: 'Sports & Action',
    defaultLeadInBeats: 14,
    summary: 'Smash red and blue cans (14–14.5 beat early launch).',
  },
  MOON: {
    id: 'MOON',
    title: 'Sneezy Moon',
    rhreName: 'sneezyMoon',
    accent: '#6366F1',
    layoutOff: 0x3E00,
    category: 'Sci-Fi & Quirky',
    defaultLeadInBeats: 1,
    summary: 'Trigger moon sneezes with or without preparation.',
  },
  THE_A: {
    id: 'THE_A',
    title: 'A for Effort',
    rhreName: 'aForEffort',
    accent: '#A855F7',
    layoutOff: 0x4360,
    category: 'Music & Stage',
    defaultLeadInBeats: 4,
    summary: 'Spell out TEA, SODA, COCOA, or AAA in rhythm.',
  },
  PUTILABO: {
    id: 'PUTILABO',
    title: "Pop, Don't Drop",
    rhreName: 'popDontDrop',
    accent: '#14B8A6',
    layoutOff: 0x3E08,
    category: 'Sci-Fi & Quirky',
    defaultLeadInBeats: 5,
    summary: 'Inflate soft or hard bubbles in the lab (pops at +3 after appear).',
  },
  WIPER: {
    id: 'WIPER',
    title: 'Wiper Bosses',
    rhreName: 'wiperBosses',
    accent: '#EC4899',
    layoutOff: 0x3F60,
    category: 'Sci-Fi & Quirky',
    defaultLeadInBeats: 1,
    summary: 'Sweep pink, blue, or paired windshield wipers slow or fast.',
  },
  SOCCER: {
    id: 'SOCCER',
    title: 'Soccer Dreams',
    rhreName: 'soccerDreams',
    accent: '#22C55E',
    layoutOff: 0x3E00,
    category: 'Sports & Action',
    defaultLeadInBeats: 2.5,
    summary: 'Kick white, pink, and yellow soccer balls.',
  },
  HURDLE: {
    id: 'HURDLE',
    title: 'Hop & Slide',
    rhreName: 'hopNSlide',
    accent: '#0EA5E9',
    layoutOff: 0x3CB0,
    category: 'Sports & Action',
    defaultLeadInBeats: 6,
    summary: 'Jump over or slide beneath track hurdles.',
  },
  TALK: {
    id: 'TALK',
    title: 'Alien Alphabet',
    rhreName: 'alienAlphabet',
    accent: '#8B5CF6',
    layoutOff: 0x3CB0,
    category: 'Sci-Fi & Quirky',
    defaultLeadInBeats: 0.5,
    summary: 'Translate alien cha syllables in sync.',
  },
  COOKING: {
    id: 'COOKING',
    title: 'Slice & Dice Kitchen',
    rhreName: 'sliceNDiceKitchen',
    accent: '#F97316',
    layoutOff: 0x3CB0,
    category: 'Creatures & Food',
    defaultLeadInBeats: 1.5,
    summary: 'Dice tomatoes, peppers (1–4), and broccoli.',
  },
  PARASOL: {
    id: 'PARASOL',
    title: 'Brolly Good Show',
    rhreName: 'brollyGoodShow',
    accent: '#F43F5E',
    layoutOff: 0x3CA8,
    category: 'Music & Stage',
    defaultLeadInBeats: 3,
    summary: 'Toss parasols with cho, pa (stretchable spacing), and allez.',
  },
  DANCER: {
    id: 'DANCER',
    title: 'Backup Spotlight',
    rhreName: 'backupSpotlight',
    accent: '#D946EF',
    layoutOff: 0x3E08,
    category: 'Music & Stage',
    defaultLeadInBeats: 3,
    summary: 'Count dance steps, elbow poses, and flashy spotlight turns.',
  },
  SAMURAI: {
    id: 'SAMURAI',
    title: 'Spirit Slasher',
    rhreName: 'spiritSlasher',
    accent: '#64748B',
    layoutOff: 0x3E08,
    category: 'Sports & Action',
    defaultLeadInBeats: 2,
    summary: 'Deliver single and double spirit slashes.',
  },
  BRUSH: {
    id: 'BRUSH',
    title: 'Sweeper Star',
    rhreName: 'sweeperStar',
    accent: '#06B6D4',
    layoutOff: 0x40B0,
    category: 'Music & Stage',
    defaultLeadInBeats: 2,
    summary: 'Spin, sweep three, or sweep continuously.',
  },
};

export const GAME_TITLE: Record<GameId, string> = Object.fromEntries(
  GAMES.map((g) => [g, GAME_META[g].title])
) as Record<GameId, string>;

export const GAME_ALIASES: Record<string, GameId> = {
  hooptrundling: 'RING',
  hooptrundlingcast: 'RING',
  hooptrundlingcastofcharacters: 'RING',
  feedingthebeast: 'HUNGRY',
  crabsnacks: 'CRAB',
  sneezymoon: 'MOON',
  ribbitrocket: 'KAERU',
  hopstopnroll: 'ROLLING',
  fruitflex: 'PUMPUP',
  wiperbosses: 'WIPER',
  soccercdreams: 'SOCCER',
  soccerdreams: 'SOCCER',
  lightningbolting: 'THUNDER',
  discdog: 'FLYDISC',
  aforeffort: 'THE_A',
  brollygoodshow: 'PARASOL',
  slicendicekitchen: 'COOKING',
  backupspotlight: 'DANCER',
  sweeperstar: 'BRUSH',
  spiritslasher: 'SAMURAI',
  yumbotsimulator: 'SOFTCATCH',
  stopngonstop: 'CARS',
  flutterspeed: 'INSECT',
  popdontdrop: 'PUTILABO',
  cando: 'HAMMER',
  hopnslide: 'HURDLE',
  alienalphabet: 'TALK',
};

export const LAYOUT_OFF: Partial<Record<GameId, number>> = {
  FLYDISC: 0x40B8,
  ROLLING: 0x3E08,
  HUNGRY: 0x3CB0,
  CARS: 0x3CB0,
  KAERU: 0x4778,
  CRAB: 0x3B58,
  INSECT: 0x3CA8,
  SOFTCATCH: 0x3CB0,
  RING: 0x3B58,
  THUNDER: 0x3B58,
  HAMMER: 0x3B58,
  MOON: 0x3E00,
  THE_A: 0x4360,
  PUTILABO: 0x3E08,
  WIPER: 0x3F60,
  SOCCER: 0x3E00,
  HURDLE: 0x3CB0,
  TALK: 0x3CB0,
  COOKING: 0x3CB0,
  PARASOL: 0x3CA8,
  DANCER: 0x3E08,
  SAMURAI: 0x3E08,
  BRUSH: 0x40B0,
};

export const THE_A_WORDS = ['TEA', 'SODA', 'COCOA', 'AAA'] as const;
export type TheAWord = (typeof THE_A_WORDS)[number];

export const SCORE_TAGS = ['basic', 'tech', 'busy', 'back'] as const;

export const PROLOGUE_TYPES = Array.from({ length: 20 }, (_, i) => `type_${String(i).padStart(2, '0')}`);

export const JINGLE_PRESETS = Array.from({ length: JINGLE_MAX - JINGLE_MIN + 1 }, (_, i) => {
  const code = JINGLE_MIN + i;
  return {
    code,
    hex: `0x${code.toString(16).toUpperCase()}`,
    label: `Jingle ${i + 1} (0x${code.toString(16).toUpperCase()})`,
  };
});

export interface CueDef {
  name: string;
  game: GameId;
  fn: number;
  args: [number, number, number, number];
  aliases: string[];
  word: TheAWord | null;
  kind: 0 | 1; // 0 = int args, 1 = THE_A word
  leadInBeats: number; // how early call tick happens relative to player action/visual beat
  durationBeats: number; // default visual span in timeline
  stretchable?: 'spacingTicks' | 'stopBeats';
  status: 'calibrated' | 'approx' | 'raw';
  description: string;
}

type RawCueSeed = {
  name: string;
  game: GameId;
  fn: number;
  args: number[];
  aliases?: string[];
  word?: TheAWord | null;
  leadInBeats?: number;
  durationBeats?: number;
  stretchable?: 'spacingTicks' | 'stopBeats';
  status?: 'calibrated' | 'approx' | 'raw';
  description?: string;
};

function pad4(a: number[]): [number, number, number, number] {
  return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 0];
}

const RAW_CUE_SEEDS: RawCueSeed[] = [
  { name: 'apple', game: 'PUMPUP', fn: 0x209B80, args: [1, 0, 0], aliases: ['fruitFlexApple'], leadInBeats: 1.75, durationBeats: 4.5, status: 'approx', description: 'Apple flex pattern' },
  { name: 'lemon', game: 'PUMPUP', fn: 0x20A170, args: [0, 0, 0], aliases: ['fruitFlexLemon'], leadInBeats: 1.5, durationBeats: 4.25, status: 'calibrated', description: 'Lemon flex pattern' },

  { name: 'throw', game: 'FLYDISC', fn: 0x18D3F0, args: [0, 3360, -1, 0], aliases: ['throwGrowl', 'throwCounting', 'throwCountingGrowl', 'throwFade', 'throwFadeGrowl', 'throwCountingOffbeat', 'throwCountingGrowlOffbeat', 'throwFadeOffbeat', 'throwFadeGrowlOffbeat'], leadInBeats: 2, durationBeats: 8, status: 'calibrated', description: 'Throw flying disc (d=0)' },

  { name: 'rolling', game: 'ROLLING', fn: 0x222FA0, args: [1, 0, 0], aliases: ['rollingHops', 'rollingWithPartyPopper', 'rollingHopsWithPartyPopper'], leadInBeats: 2, durationBeats: 4.5, status: 'calibrated', description: 'Rolling hops (a=1)' },
  { name: 'stopHopping', game: 'ROLLING', fn: 0x222FA0, args: [2, 0, 0], leadInBeats: 1, durationBeats: 5, status: 'calibrated', description: 'Stop hopping signal (a=2)' },
  { name: 'startHopping', game: 'ROLLING', fn: 0x223350, args: [0, 0, 0], leadInBeats: 2, durationBeats: 4.5, status: 'approx', description: 'Start hopping signal' },
  { name: 'rollExtra', game: 'ROLLING', fn: 0x223800, args: [0, 0, 0], leadInBeats: 1, durationBeats: 3, status: 'raw', description: 'Extra native rolling cue' },

  { name: 'yellow', game: 'HUNGRY', fn: 0x1AF800, args: [0], aliases: ['shootYellow', 'chompYellow', 'pinkHeartShoot', 'munch1'], leadInBeats: 8, durationBeats: 9, status: 'calibrated', description: 'Yellow beast feed (8-beat lead-in)' },
  { name: 'purple', game: 'HUNGRY', fn: 0x1AF800, args: [1], aliases: ['shootPurple', 'chompPurple', 'greenHeartShoot', 'munch2'], leadInBeats: 8, durationBeats: 9, status: 'calibrated', description: 'Purple beast feed (8-beat lead-in)' },

  { name: 'accel', game: 'CARS', fn: 0x1601D0, args: [1, 0, 0, 0], leadInBeats: 0.5, durationBeats: 4.5, status: 'calibrated', description: 'Accelerate car (a=1)' },
  { name: 'accelRemix7', game: 'CARS', fn: 0x1601D0, args: [0, 0, 0, 0], leadInBeats: 2.5, durationBeats: 4.5, status: 'calibrated', description: 'Remix 7 accelerate variant (a=0)' },
  { name: 'brake', game: 'CARS', fn: 0x1608F0, args: [0, -1, 0, 0], leadInBeats: 2, durationBeats: 4.5, status: 'calibrated', description: 'Brake car cue' },

  { name: 'frog3', game: 'KAERU', fn: 0x1B8DB0, args: [3, 0, 0], leadInBeats: 3, durationBeats: 5.5, status: 'calibrated', description: '3-count frog croak' },
  { name: 'frog4', game: 'KAERU', fn: 0x1B8DB0, args: [4, 0, 0], leadInBeats: 2, durationBeats: 5.5, status: 'calibrated', description: '4-count frog croak' },
  { name: 'frog5', game: 'KAERU', fn: 0x1B8DB0, args: [5, 0, 0], leadInBeats: 1, durationBeats: 5.5, status: 'calibrated', description: '5-count frog croak' },
  { name: 'frog2', game: 'KAERU', fn: 0x1B8DB0, args: [2, 0, 0], leadInBeats: 2, durationBeats: 4, status: 'calibrated', description: '2-count frog croak' },
  { name: 'tadpole', game: 'KAERU', fn: 0x1B8F70, args: [3, 0, 0], leadInBeats: 2, durationBeats: 4, status: 'raw', description: 'Tadpole native cue' },

  { name: 'macaron', game: 'CRAB', fn: 0x17BFC0, args: [-1, -1, -1], aliases: ['macaronhitplayer', 'macaronvoice'], leadInBeats: 2, durationBeats: 4, status: 'calibrated', description: 'Macaron crab snap' },
  { name: 'favabeans', game: 'CRAB', fn: 0x17D0D0, args: [-1, -1, -1], aliases: ['favabean', 'favabeanhit1'], leadInBeats: 2, durationBeats: 5, status: 'calibrated', description: 'Fava beans crab snap' },

  { name: 'butterfly', game: 'INSECT', fn: 0x1B54C0, args: [360, 1920, 0, 0], aliases: ['butterflyNoVoice'], leadInBeats: 4, durationBeats: 6, status: 'calibrated', description: 'Butterfly (spacing 360t)' },
  { name: 'butterflyRemix5', game: 'INSECT', fn: 0x1B54C0, args: [720, 1920, 0, 0], aliases: ['butterflyRemix5Counting', 'butterflyRemix5NoVoice', 'butterflyRemix5CountingNoVoice'], leadInBeats: 4, durationBeats: 7.5, status: 'calibrated', description: 'Butterfly Remix 5 (spacing 720t)' },
  { name: 'grasshopper', game: 'INSECT', fn: 0x1B5A60, args: [240, 1920, 0, 0], aliases: ['grasshopperNoVoice'], leadInBeats: 4, durationBeats: 6, status: 'calibrated', description: 'Grasshopper (spacing 240t)' },
  { name: 'grasshopperRemix5', game: 'INSECT', fn: 0x1B5A60, args: [480, 1920, 0, 0], aliases: ['grasshopperRemix5NoVoice'], leadInBeats: 4, durationBeats: 7.5, status: 'calibrated', description: 'Grasshopper Remix 5 (spacing 480t)' },
  { name: 'dragonfly', game: 'INSECT', fn: 0x1B60F0, args: [480, 1920, 0, 0], aliases: ['dragonflyNoVoice'], leadInBeats: 3, durationBeats: 7.5, status: 'calibrated', description: 'Dragonfly (spacing 480t)' },

  { name: 'pudding', game: 'SOFTCATCH', fn: 0x248B70, args: [0, 320, 0, 0], aliases: ['puddingPractice'], leadInBeats: 2, durationBeats: 4.5, stretchable: 'spacingTicks', status: 'calibrated', description: 'Standard pudding (320t spacing)' },
  { name: 'puddingLong', game: 'SOFTCATCH', fn: 0x248B70, args: [0, 480, 0, 0], aliases: ['puddingLongPractice'], leadInBeats: 2, durationBeats: 5.5, stretchable: 'spacingTicks', status: 'calibrated', description: 'Long pudding (480t spacing)' },
  { name: 'defectivePudding', game: 'SOFTCATCH', fn: 0x248B70, args: [1, 320, 0, 0], leadInBeats: 1, durationBeats: 4.5, stretchable: 'spacingTicks', status: 'calibrated', description: 'Defective pudding (320t spacing)' },
  { name: 'defectivePuddingLong', game: 'SOFTCATCH', fn: 0x248B70, args: [1, 480, 0, 0], leadInBeats: 1, durationBeats: 5.5, stretchable: 'spacingTicks', status: 'calibrated', description: 'Defective long pudding (480t spacing)' },

  { name: 'hoop', game: 'RING', fn: 0x217960, args: [-1], aliases: ['hoopPass'], leadInBeats: 0, durationBeats: 4, status: 'calibrated', description: 'Hoop throw (full pa-pi-pu-pe-po mask -1)' },

  { name: 'cloudYellow', game: 'THUNDER', fn: 0x27DBA0, args: [1, 0, 0], aliases: ['cloudYellowSwing'], leadInBeats: 1, durationBeats: 4, status: 'calibrated', description: 'Yellow cloud thunder bolt' },
  { name: 'cloudYellowAlt', game: 'THUNDER', fn: 0x27E130, args: [0, 0, 0], leadInBeats: 1, durationBeats: 3, status: 'raw', description: 'Yellow cloud alternate function' },
  { name: 'cloudPink', game: 'THUNDER', fn: 0x27E6C0, args: [1, 0, 0], aliases: ['cloudPinkSwing'], leadInBeats: 1.5, durationBeats: 4, status: 'calibrated', description: 'Pink cloud thunder bolt' },
  { name: 'cloudPinkAlt', game: 'THUNDER', fn: 0x27EC00, args: [0, 0, 0], leadInBeats: 1.5, durationBeats: 3, status: 'raw', description: 'Pink cloud alternate function' },

  { name: 'red', game: 'HAMMER', fn: 0x1AB410, args: [0, 0, 7680, 0], leadInBeats: 14.5, durationBeats: 17.5, status: 'approx', description: 'Red can launch (14.5-beat lead-in)' },
  { name: 'redFrog', game: 'HAMMER', fn: 0x1AB410, args: [-960, 1, 7680, 0], leadInBeats: 14.5, durationBeats: 17.5, status: 'approx', description: 'Red can + frog variant' },
  { name: 'blue', game: 'HAMMER', fn: 0x1ABCB0, args: [0, 0, 7680, 0], leadInBeats: 14, durationBeats: 17.5, status: 'calibrated', description: 'Blue can launch (14-beat lead-in)' },
  { name: 'blueFrog', game: 'HAMMER', fn: 0x1ABCB0, args: [-1200, 1, 7680, 0], leadInBeats: 14, durationBeats: 17.5, status: 'approx', description: 'Blue can + frog variant' },

  { name: 'greenSneeze', game: 'MOON', fn: 0x1DB630, args: [1, 0, 0], aliases: ['greenSneezeFast', 'greenSneezePractice'], leadInBeats: 1, durationBeats: 4.5, status: 'calibrated', description: 'Moon sneeze with preparation (a=1)' },
  { name: 'greenSneezeStandalone', game: 'MOON', fn: 0x1DB630, args: [0, 0, 0], aliases: ['greenSneezeFastStandalone', 'greenSneezeStandalonePractice'], leadInBeats: 3, durationBeats: 4.5, status: 'calibrated', description: 'Standalone moon sneeze (a=0)' },

  { name: 'tea', game: 'THE_A', fn: 0x278FE0, args: [], aliases: ['aForEffortTea'], word: 'TEA', leadInBeats: 4, durationBeats: 8, status: 'calibrated', description: 'Spell TEA' },
  { name: 'soda', game: 'THE_A', fn: 0x278FE0, args: [], aliases: ['aForEffortSoda'], word: 'SODA', leadInBeats: 4, durationBeats: 7.5, status: 'calibrated', description: 'Spell SODA' },
  { name: 'cocoa', game: 'THE_A', fn: 0x278FE0, args: [], aliases: ['aForEffortCocoa'], word: 'COCOA', leadInBeats: 4, durationBeats: 8, status: 'calibrated', description: 'Spell COCOA' },
  { name: 'aaa', game: 'THE_A', fn: 0x278FE0, args: [], aliases: ['aForEffortAaa'], word: 'AAA', leadInBeats: 4, durationBeats: 8, status: 'approx', description: 'Spell AAA' },

  { name: 'softGrow', game: 'PUTILABO', fn: 0x20BF90, args: [0, 0, 0, 0], aliases: ['soft'], leadInBeats: 5, durationBeats: 8.5, status: 'calibrated', description: 'Soft bubble grow (appears +5, pop +8)' },
  { name: 'hardGrow', game: 'PUTILABO', fn: 0x20C190, args: [480, 0, 0, 0], aliases: ['hard'], leadInBeats: 5, durationBeats: 8.5, status: 'approx', description: 'Hard bubble grow (a=480t)' },

  { name: 'pinkFast', game: 'WIPER', fn: 0x2AA2F0, args: [3, 0, 0], leadInBeats: 1, durationBeats: 4.5, status: 'calibrated', description: 'Pink wiper fast' },
  { name: 'bothSlow', game: 'WIPER', fn: 0x2A9B00, args: [3, 0, 0], leadInBeats: 1, durationBeats: 7.5, status: 'calibrated', description: 'Both wipers slow' },
  { name: 'bothFast', game: 'WIPER', fn: 0x2AA6F0, args: [3, 0, 0], leadInBeats: 1, durationBeats: 4.5, status: 'calibrated', description: 'Both wipers fast' },
  { name: 'blueFast', game: 'WIPER', fn: 0x2AA4F0, args: [3, 0, 0], leadInBeats: 1, durationBeats: 4.5, status: 'calibrated', description: 'Blue wiper fast' },
  { name: 'blueSlow', game: 'WIPER', fn: 0x2A9900, args: [1, 0, 0], leadInBeats: 1, durationBeats: 7.5, status: 'calibrated', description: 'Blue wiper slow' },
  { name: 'pinkSlow', game: 'WIPER', fn: 0x2A9700, args: [0, 0, 0], leadInBeats: 1, durationBeats: 7.5, status: 'calibrated', description: 'Pink wiper slow' },

  { name: 'white', game: 'SOCCER', fn: 0x246760, args: [0, 0, 0], leadInBeats: 3.5, durationBeats: 5.5, status: 'calibrated', description: 'White soccer ball' },
  { name: 'pink', game: 'SOCCER', fn: 0x246B80, args: [0, 0, 0], leadInBeats: 2.5, durationBeats: 6.5, status: 'calibrated', description: 'Pink soccer ball' },
  { name: 'yellow', game: 'SOCCER', fn: 0x246FF0, args: [0, 0, 0], aliases: ['soccerYellow'], leadInBeats: 2.5, durationBeats: 7.5, status: 'calibrated', description: 'Yellow soccer ball' },
  { name: 'yellowThunder', game: 'SOCCER', fn: 0x246FF0, args: [0, 1920, 0], leadInBeats: 2.5, durationBeats: 7.5, status: 'approx', description: 'Yellow soccer ball + thunder (b=1920)' },

  { name: 'hop', game: 'HURDLE', fn: 0x1B1FC0, args: [0, 0, 0, 0], leadInBeats: 6, durationBeats: 8.5, status: 'calibrated', description: 'Hurdle hop (a=0, 6-beat lead-in)' },
  { name: 'slide', game: 'HURDLE', fn: 0x1B1FC0, args: [1, 0, 0, 0], leadInBeats: 6.5, durationBeats: 8.5, status: 'approx', description: 'Hurdle slide (a=1, 6.5-beat lead-in)' },
  { name: 'hurdleAlt', game: 'HURDLE', fn: 0x1B24D0, args: [2, 2, 0], leadInBeats: 4, durationBeats: 6, status: 'raw', description: 'Alternate hurdle native function' },

  { name: 'cha', game: 'TALK', fn: 0x255100, args: [1, 0, 0, 0], aliases: ['chaGrown'], leadInBeats: 0.5, durationBeats: 4, status: 'approx', description: 'Alien Alphabet cha cue' },

  { name: 'tomato1', game: 'COOKING', fn: 0x178880, args: [0, 1, 0, 0], leadInBeats: 1.5, durationBeats: 3.5, status: 'calibrated', description: 'Tomato slice (1 beat)' },
  { name: 'tomato2', game: 'COOKING', fn: 0x178880, args: [1, 1, 0, 0], leadInBeats: 1.5, durationBeats: 3.5, status: 'calibrated', description: 'Tomato slice (2 beats)' },
  { name: 'tomato3', game: 'COOKING', fn: 0x178880, args: [2, 1, 0, 0], leadInBeats: 1.5, durationBeats: 3.5, status: 'calibrated', description: 'Tomato slice (3 beats)' },
  { name: 'tomato4', game: 'COOKING', fn: 0x178880, args: [3, 1, 0, 0], leadInBeats: 1.5, durationBeats: 3.5, status: 'calibrated', description: 'Tomato slice (4 beats)' },
  { name: 'pepper1', game: 'COOKING', fn: 0x178880, args: [0, 3, 0, 0], leadInBeats: 1.5, durationBeats: 3.5, status: 'calibrated', description: 'Pepper slice (1 beat)' },
  { name: 'pepper2', game: 'COOKING', fn: 0x178880, args: [1, 3, 0, 0], leadInBeats: 1.5, durationBeats: 3.5, status: 'calibrated', description: 'Pepper slice (2 beats)' },
  { name: 'pepper3', game: 'COOKING', fn: 0x178880, args: [2, 3, 0, 0], leadInBeats: 1.5, durationBeats: 3.5, status: 'calibrated', description: 'Pepper slice (3 beats)' },
  { name: 'pepper4', game: 'COOKING', fn: 0x178880, args: [3, 3, 0, 0], leadInBeats: 1.5, durationBeats: 3.5, status: 'calibrated', description: 'Pepper slice (4 beats)' },
  { name: 'broccoli', game: 'COOKING', fn: 0x178DC0, args: [3, 2, -1, -1], leadInBeats: 2, durationBeats: 4.5, status: 'calibrated', description: 'Broccoli chop (d=-1)' },

  { name: 'cho', game: 'PARASOL', fn: 0x204970, args: [480, 0, 0, 0], aliases: ['encore'], leadInBeats: 3, durationBeats: 4, stretchable: 'spacingTicks', status: 'calibrated', description: 'Parasol cho (a=spacing ticks)' },
  { name: 'pa', game: 'PARASOL', fn: 0x204970, args: [480, 1, 0, 0], leadInBeats: 3, durationBeats: 4, stretchable: 'spacingTicks', status: 'calibrated', description: 'Parasol pa (a=spacing ticks)' },
  { name: 'allez', game: 'PARASOL', fn: 0x205030, args: [1, 1, 0, 0], leadInBeats: 1, durationBeats: 3.5, status: 'calibrated', description: 'Parasol allez finish' },

  { name: 'countDance', game: 'DANCER', fn: 0x181210, args: [12, 3, 0, 0], aliases: ['countDanceL', 'countDanceR'], leadInBeats: 3, durationBeats: 12, stretchable: 'stopBeats', status: 'calibrated', description: 'Count dance (a=stop-start+2)' },
  { name: 'countElbow', game: 'DANCER', fn: 0x181C70, args: [12, 3, 0, 0], leadInBeats: 3.5, durationBeats: 12, stretchable: 'stopBeats', status: 'calibrated', description: 'Count elbow (a=stop-start+2.5)' },
  { name: 'flashy', game: 'DANCER', fn: 0x182460, args: [0, 1, 0, 0], aliases: ['flashyLeft', 'flashyRight'], leadInBeats: 3.5, durationBeats: 6.5, status: 'approx', description: 'Flashy spotlight turn' },

  { name: 'singleSlash', game: 'SAMURAI', fn: 0x22AD50, args: [1, 1, 0, 0], aliases: ['singleStarter'], leadInBeats: 2, durationBeats: 5.5, status: 'calibrated', description: 'Single spirit slash' },
  { name: 'doubleSlash', game: 'SAMURAI', fn: 0x22AFF0, args: [1, 1, 0, 0], aliases: ['doubleStarter'], leadInBeats: 2, durationBeats: 6, status: 'calibrated', description: 'Double spirit slash' },

  { name: 'spin', game: 'BRUSH', fn: 0x15AF40, args: [0, 0, 0, 0], aliases: ['spinTimestretched'], leadInBeats: 2, durationBeats: 4.5, status: 'calibrated', description: 'Sweeper spin' },
  { name: 'spinAlt', game: 'BRUSH', fn: 0x15B2E0, args: [0, 0, 0, 0], leadInBeats: 2, durationBeats: 4.5, status: 'raw', description: 'Alternate spin native function' },
  { name: 'sweepThree', game: 'BRUSH', fn: 0x15AB00, args: [0, 0, 0, 0], leadInBeats: 3.5, durationBeats: 7.5, status: 'calibrated', description: 'Sweep three cue' },
  { name: 'sweeping', game: 'BRUSH', fn: 0x15A560, args: [12, 1, 1], aliases: ['sweepingStart'], leadInBeats: 2, durationBeats: 12, stretchable: 'stopBeats', status: 'approx', description: 'Continuous sweeping (a=beats)' },
];

export const CUE_FNS = new Map<string, 0 | 1>();
export const CUES: CueDef[] = [];
export const CUE_BY_NAME = new Map<string, CueDef>();
export const CUE_SHORT = new Map<string, CueDef[]>();
export const CUE_BY_SIG = new Map<string, CueDef>();
export const CUE_BY_FN = new Map<string, CueDef>();

function sigKey(game: GameId, fn: number, args: [number, number, number, number], word: TheAWord | null): string {
  return `${game}:${fn}:${args.join(',')}:${word ?? ''}`;
}

for (const seed of RAW_CUE_SEEDS) {
  const kind: 0 | 1 = seed.game === 'THE_A' && seed.fn === 0x278FE0 ? 1 : 0;
  CUE_FNS.set(`${seed.game}:${seed.fn}`, kind);

  const cue: CueDef = {
    name: seed.name,
    game: seed.game,
    fn: seed.fn,
    args: pad4(seed.args),
    aliases: seed.aliases ?? [],
    word: seed.word ?? null,
    kind,
    leadInBeats: seed.leadInBeats ?? GAME_META[seed.game].defaultLeadInBeats,
    durationBeats: seed.durationBeats ?? 4,
    stretchable: seed.stretchable,
    status: seed.status ?? 'calibrated',
    description: seed.description ?? seed.name,
  };
  CUES.push(cue);

  for (const n of [cue.name, ...cue.aliases]) {
    const key = `${cue.game}:${n.toLowerCase()}`;
    if (!CUE_BY_NAME.has(key)) {
      CUE_BY_NAME.set(key, cue);
    }
    const shortKey = n.toLowerCase();
    const list = CUE_SHORT.get(shortKey) ?? [];
    if (!list.includes(cue)) {
      list.push(cue);
      CUE_SHORT.set(shortKey, list);
    }
  }

  const sk = sigKey(cue.game, cue.fn, cue.args, cue.word);
  if (!CUE_BY_SIG.has(sk)) {
    CUE_BY_SIG.set(sk, cue);
  }
  const fk = `${cue.game}:${cue.fn}`;
  if (!CUE_BY_FN.has(fk)) {
    CUE_BY_FN.set(fk, cue);
  }
}

export function getCuesForGame(game: GameId): CueDef[] {
  return CUES.filter((c) => c.game === game);
}

export function findCueDef(
  game: GameId,
  fn: number,
  args: [number, number, number, number],
  word: TheAWord | null
): CueDef | undefined {
  return CUE_BY_SIG.get(sigKey(game, fn, args, word)) ?? CUE_BY_FN.get(`${game}:${fn}`);
}

export function canonicalGame(tok: string): GameId | null {
  const u = tok.trim().toUpperCase();
  if ((GAMES as readonly string[]).includes(u)) {
    return u as GameId;
  }
  const low = tok.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (low in GAME_ALIASES) {
    return GAME_ALIASES[low];
  }
  return null;
}

export const EXAMPLE_GTF = `# Ejemplo de Groove Tickflow v0.1
# 1 pulso = 480 ticks. rest avanza el reloj;
# switch y los cues se disparan en el pulso actual.

title "Remix 21"
prologue type_19
jingle 0x163
bgm 139
start 0
match -1 9 4
results native
first CARS
end 48
finish 52
translen 2

def burbujas
  loop 3
    softGrow basic
    rest 1
  end
end

rest 8
switch KAERU
frog5 basic
rest 4
frog3 basic
rest 4
frog4 basic
rest 2
switch PUTILABO
call burbujas
rest 8
switch CARS cut
brake basic
rest 4
accel basic
rest 4
accelRemix7 basic
rest 2
switch PUTILABO
call burbujas
`;

export const SHOWCASE_24_GTF = `# Groove Builder — 24-Minigame Showcase
title "Groove Megamix 24"
prologue type_19
jingle 0x163
bgm 139
start 0
match -1 9 4
results native
first RING
translen 2
end 108
finish 112

rest 4
hoop basic
rest 4
switch KAERU
frog5 basic
rest 4
switch PUTILABO
softGrow basic
rest 6
switch CARS cut
accel basic
rest 4
brake basic
rest 4
switch CRAB
macaron basic
rest 4
switch THE_A
tea basic
rest 6
switch PARASOL
cho basic
rest 4
allez tech
rest 4
switch DANCER
countDance basic
rest 10
switch SAMURAI cut
singleSlash tech
rest 4
switch BRUSH
spin basic
rest 4
switch COOKING
tomato2 basic
rest 4
broccoli tech
rest 4
switch WIPER
bothFast basic
rest 4
switch SOCCER
white basic
rest 4
switch THUNDER
cloudYellow basic
rest 4
switch MOON
greenSneeze basic
rest 4
switch PUMPUP
lemon basic
rest 4
switch ROLLING
rolling basic
rest 4
switch TALK
cha basic
rest 4
switch INSECT
butterfly basic
rest 4
switch SOFTCATCH
pudding basic
`;
