import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalGame,
  CUES,
  EXAMPLE_GTF,
  GAMES,
  getCuesForGame,
  SHOWCASE_24_GTF,
  TPB,
} from '../src/engine/cues.ts';
import {
  ENGINE_CONTRACT,
  isValidLayoutContract,
  validateCueArgsContract,
} from '../src/engine/engineContract.ts';
import {
  exportGroovePackage,
  importGroovePackage,
} from '../src/engine/groovePackage.ts';
import {
  compileGtf,
  decompileToGtf,
  emitGtl,
  formatBeats,
  GtfError,
  parseDuration,
  parseGtl,
  timelinesEqual,
  validateTimeline,
} from '../src/engine/gtfEngine.ts';
import { convertRhreJsonToTimeline } from '../src/engine/rhreImporter.ts';

test('all 24 Groove Engine minigames have registered cues', () => {
  assert.equal(GAMES.length, 24);
  for (const g of GAMES) {
    const cues = getCuesForGame(g);
    assert.ok(cues.length > 0, `Expected cues for ${g}`);
  }
  assert.ok(CUES.length >= 75);
  assert.equal(canonicalGame('ribbitRocket'), 'KAERU');
  assert.equal(canonicalGame('hopStopNRoll'), 'ROLLING');
  assert.equal(canonicalGame('popDontDrop'), 'PUTILABO');
});

test('duration parsing and beat formatting match gtf.py', () => {
  assert.equal(parseDuration('1'), 480);
  assert.equal(parseDuration('0.5'), 240);
  assert.equal(parseDuration('1.5'), 720);
  assert.equal(parseDuration('1/3'), 160);
  assert.equal(parseDuration('2/3'), 320);
  assert.equal(parseDuration('240t'), 240);
  assert.equal(parseDuration('0x1E0t'), 480);

  assert.equal(formatBeats(480), '1');
  assert.equal(formatBeats(240), '0.5');
  assert.equal(formatBeats(720), '1.5');
  assert.equal(formatBeats(160), '1/3');
  assert.equal(formatBeats(320), '2/3');
  assert.equal(formatBeats(120), '0.25');

  assert.throws(() => parseDuration('0x1E0'));
});

test('loop, def/call, fractions, prologue/jingle/title, fade, anim, switch cut round-trip', () => {
  const src = [
    'title "Remix 21"',
    'prologue type_19',
    'jingle 0x163',
    'bgm 139',
    'start 0',
    'match -1 9 4',
    'results native',
    'first CARS',
    'end 24',
    'finish 28',
    'def trio',
    '  loop 3',
    '    softGrow basic',
    '    rest 1',
    '  end',
    'end',
    'rest 1/3',
    'switch KAERU',
    'frog5 basic',
    'rest 2/3',
    'KAERU.frog3 basic',
    'rest 1.5',
    'switch PUTILABO cut',
    'call trio',
    'rest 0.5',
    'fade 0.5 0.6',
    'anim Remix8',
  ].join('\n');

  const tl = compileGtf(src, 'unit.gtf');
  assert.equal(tl.title, 'Remix 21');
  assert.equal(tl.prologue, 'type_19');
  assert.equal(tl.jingle, 0x163);
  assert.equal(tl.end, 24 * TPB);
  assert.equal(tl.finish, 28 * TPB);

  const calls = tl.events.filter((e) => e.op === 'call');
  const switches = tl.events.filter((e) => e.op === 'switch');
  assert.equal(calls.length, 5);
  assert.equal(switches[0].game, 'KAERU');
  assert.equal(switches[0].style, 0);
  assert.equal(switches[1].game, 'PUTILABO');
  assert.equal(switches[1].style, -1);

  assert.equal(calls[0].tick, 160);
  assert.equal(calls[0].fn, 0x1b8db0);
  assert.equal(calls[0].args?.[0], 5);

  const gtlText = emitGtl(tl, 'unit.gtf');
  assert.ok(gtlText.includes('GTLM 1'));
  assert.ok(gtlText.includes('title Remix 21'));
  assert.ok(gtlText.includes('prologue type_19'));
  assert.ok(gtlText.includes('jingle 0x163'));
  assert.ok(gtlText.includes(' cut'));

  const backFromGtl = parseGtl(gtlText, 'unit.gtl');
  assert.deepEqual(timelinesEqual(tl, backFromGtl), []);

  const gtf2 = decompileToGtf(tl, 'unit.gtl');
  const tl2 = compileGtf(gtf2, 'unit2.gtf');
  assert.deepEqual(timelinesEqual(tl, tl2), []);
});

test('example GTF and 24-game showcase GTF compile and round-trip cleanly', () => {
  for (const [name, src] of [
    ['ejemplo.gtf', EXAMPLE_GTF],
    ['showcase_24.gtf', SHOWCASE_24_GTF],
  ] as const) {
    const tl = compileGtf(src, name);
    const report = validateTimeline(tl);
    assert.equal(report.ok, true, `${name} should validate without errors: ${JSON.stringify(report.issues)}`);

    const gtl = emitGtl(tl, name);
    const parsedGtl = parseGtl(gtl, name);
    assert.deepEqual(timelinesEqual(tl, parsedGtl), []);

    const gtf = decompileToGtf(parsedGtl, name);
    const recompiled = compileGtf(gtf, name);
    assert.deepEqual(timelinesEqual(tl, recompiled), []);
  }

  const showcase = compileGtf(SHOWCASE_24_GTF, 'showcase_24.gtf');
  const report = validateTimeline(showcase);
  assert.ok(report.gamesUsed.length >= 20);
});

test('GTF error cases match gtf.py validation rules', () => {
  const cases: Array<[string, RegExp]> = [
    ['rest 1\nend 8\nfinish 12\n', /no hay/i],
    ['first CARS\nend 8\nfinish 12\nrest 1\nfrog5 basic\n', /pertenece/i],
    ['first CARS\nend 8\nfinish 12\nyellow basic\n', /ambiguo/i],
    ['first KAERU\nend 8\nfinish 12\nfrog9 basic\n', /desconocid/i],
    ['first CARS\nend 8\nfinish 12\nswitch NOEXISTE\n', /juego desconocido/i],
    ['first CARS\nend 8\nfinish 12\nrest -1\nbrake basic\n', /negativ/i],
    ['first CARS\nend 8\nfinish 12\nrest 2\nat 1\nbrake basic\n', /atras/i],
    ['first CARS\nend 8\nfinish 12\nloop 3\nbrake basic\n', /falta 'end'/i],
    ['first CARS\nend 8\nfinish 12\ncall fantasma\nbrake basic\n', /def/i],
    ['first CARS\nend 8\nfinish 12\njingle 0x1\nbrake basic\n', /jingle/i],
    ['def foo\n  def bar\n  end\nend\nfirst CARS\nend 8\nfinish 12\nbrake basic\n', /anidado/i],
    ['def foo\n  call foo\nend\nfirst CARS\nend 8\nfinish 12\ncall foo\nbrake basic\n', /recursiv/i],
  ];

  for (const [src, re] of cases) {
    assert.throws(
      () => compileGtf(src, 'err.gtf'),
      (err: unknown) => err instanceof GtfError && re.test(err.message),
      `Expected error matching ${re} for:\n${src}`
    );
  }
});

test('RHREfresh remix JSON converts patterns, pairs, stretchables, and subtitles', () => {
  const sampleRhre = {
    trackers: {
      tempos: {
        trackers: [{ bpm: 142 }],
      },
    },
    entities: [
      { datamodel: 'special_subtitleEntity', beat: 0, subtitle: 'gtl: title RHRE Test' },
      { datamodel: 'hoopTrundling/hoop', beat: 4 },
      { datamodel: 'hoopTrundling/pa', beat: 5 },
      { datamodel: 'hoopTrundling/pi', beat: 5.5 },
      { datamodel: 'hoopTrundling/pu', beat: 6 },
      { datamodel: 'hoopTrundling/pe', beat: 6.5 },
      { datamodel: 'ribbitRocket_frog5', beat: 10 },
      { datamodel: 'brollyGoodShow_cho', beat: 16, width: 2 },
      { datamodel: 'backupSpotlight_countDanceL', beat: 24 },
      { datamodel: 'backupSpotlight_countStop', beat: 32 },
      { datamodel: 'special_endEntity', beat: 36 },
    ],
  };

  const res = convertRhreJsonToTimeline(sampleRhre);
  assert.equal(res.bpm, 142);
  assert.equal(res.timeline.title, 'RHRE Test');
  assert.equal(res.timeline.first, 'RING');
  const calls = res.timeline.events.filter((e) => e.op === 'call');
  assert.equal(calls.length, 4);
  assert.equal(calls[0].game, 'RING');
  assert.equal(calls[1].game, 'KAERU');
  assert.equal(calls[2].game, 'PARASOL');
  assert.equal(calls[2].args?.[0], 960); // 2 beats * 480 (in engine_contract.json)
  assert.equal(calls[3].game, 'DANCER');
  assert.equal(validateTimeline(res.timeline).ok, true);
});

test('.groove ZIP package round-trips timeline, BPM, sprites, and prologue image', async () => {
  const tl = compileGtf(EXAMPLE_GTF, 'ejemplo.gtf');
  const tinyPngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const blob = await exportGroovePackage({
    timeline: tl,
    bpm: 139,
    musicOffsetSec: 0.25,
    musicFile: null,
    prologueImage: { name: 'intro.png', dataUrl: tinyPngDataUrl },
    sprites: {
      KAERU: {
        game: 'KAERU',
        imageDataUrl: tinyPngDataUrl,
        imageName: 'frog.png',
        scale: 1.25,
        offsetX: 10,
        offsetY: -5,
        tint: '#22C55E',
        bounceAmount: 1.4,
        defaultAnim: 'Remix8',
      },
    },
  });

  const buf = await blob.arrayBuffer();
  const imported = await importGroovePackage(buf);
  assert.equal(imported.bpm, 139);
  assert.equal(imported.musicOffsetSec, 0.25);
  assert.equal(imported.packageId, 'org.groovebuilder.remix-21');
  assert.equal(imported.packageVersion, '1.0.0');
  assert.deepEqual(timelinesEqual(tl, imported.timeline), []);
  assert.ok(imported.prologueImage?.dataUrl.startsWith('data:image/png;base64,'));
  assert.equal(imported.sprites.KAERU?.scale, 1.25);
  assert.equal(imported.sprites.KAERU?.tint, '#22C55E');

  const JSZip = (await import('jszip')).default;
  const badZip = new JSZip();
  badZip.file('foo/../escape.txt', 'bad');
  badZip.file('timeline.gtf', EXAMPLE_GTF);
  const badBuf = await badZip.generateAsync({ type: 'arraybuffer' });
  await assert.rejects(() => importGroovePackage(badBuf), /Ruta (invalida|absoluta prohibida)/);
});

test('enforces Codex engine_contract.json cue arg profiles, ring_mask, blocked profiles, and layouts', () => {
  // All registered cues must conform to engine_contract.json
  for (const cue of CUES) {
    const check = validateCueArgsContract(cue.game, cue.fn, cue.args);
    assert.equal(check.ok, true, `Cue ${cue.game}.${cue.name} failed contract: ${check.reason}`);
  }

  // Blocked THUNDER profiles from engine_contract.json must be rejected in GTF and GTL
  const blockedCases = [
    'first THUNDER\nend 8\nfinish 12\nTHUNDER.0x27DBA0 1 11420568 0 0\n',
    'first THUNDER\nend 8\nfinish 12\nTHUNDER.0x27DBA0 1 11420576 0 0\n',
    'first THUNDER\nend 8\nfinish 12\nTHUNDER.0x27E6C0 1 11420576 0 0\n',
  ];
  for (const src of blockedCases) {
    assert.throws(() => compileGtf(src, 'blocked.gtf'), /bloqueado/i);
  }
  assert.throws(
    () =>
      parseGtl(
        'GTLM 1\nfirst THUNDER\nend 3840 960\nfinish 5760\nX 0 THUNDER 0x27DBA0 1 11420568 0 0 -\n',
        'blocked.gtl'
      ),
    /bloqueado/i
  );

  // Arbitrary/unverified cue args must be rejected
  assert.throws(
    () => compileGtf('first KAERU\nend 8\nfinish 12\nfrog5 99\n', 'badargs.gtf'),
    /fuera del dominio verificado/i
  );
  assert.throws(
    () => compileGtf('first THE_A\nend 8\nfinish 12\nTHE_A.0x278FE0 TEA 1\n', 'badword.gtf'),
    /no acepta argumentos enteros/i
  );

  // RING ring_mask allows a in -1..15, b in 0|1, c=0, d=0
  const validRing = compileGtf('first RING\nend 8\nfinish 12\nhoop 5 1\n', 'ring_ok.gtf');
  assert.equal(validRing.events[0].args?.[0], 5);
  assert.equal(validRing.events[0].args?.[1], 1);
  assert.throws(
    () => compileGtf('first RING\nend 8\nfinish 12\nhoop 16 0\n', 'ring_bad1.gtf'),
    /ring_mask/i
  );
  assert.throws(
    () => compileGtf('first RING\nend 8\nfinish 12\nhoop -2 0\n', 'ring_bad2.gtf'),
    /ring_mask/i
  );
  assert.throws(
    () => compileGtf('first RING\nend 8\nfinish 12\nhoop 1 2\n', 'ring_bad3.gtf'),
    /ring_mask/i
  );

  // anim / layout enforcement against ENGINE_CONTRACT.layouts
  assert.equal(isValidLayoutContract('PUMPUP', 0x3b58), false);
  assert.equal(isValidLayoutContract('KAERU', ENGINE_CONTRACT.layouts.KAERU!), true);
  assert.throws(
    () => compileGtf('first PUMPUP\nend 8\nfinish 12\nlemon\nanim PUMPUP Remix8\n', 'no_layout.gtf'),
    /layout verificado/i
  );
  assert.throws(
    () => compileGtf('first KAERU\nend 8\nfinish 12\nfrog3\nanim KAERU Remix8 0x3B58\n', 'wrong_layout.gtf'),
    /no verificado/i
  );
  assert.throws(
    () => compileGtf('first KAERU\nend 8\nfinish 12\nfrog3\nanim KAERU Bad*Name\n', 'bad_anim.gtf'),
    /nombre de animacion invalido/i
  );
  const longName = 'A'.repeat(48);
  assert.throws(
    () => compileGtf(`first KAERU\nend 8\nfinish 12\nfrog3\nanim KAERU ${longName}\n`, 'long_anim.gtf'),
    /nombre de animacion invalido/i
  );

  // match & prologue safety bounds
  assert.throws(
    () => compileGtf('first KAERU\nmatch 5 0 0\nend 8\nfinish 12\nfrog3\n', 'bad_match.gtf'),
    /match fuera de rango/i
  );
  assert.throws(
    () => compileGtf('first KAERU\nprologue ../escape\nend 8\nfinish 12\nfrog3\n', 'bad_pro.gtf'),
    /prologue/i
  );
});

