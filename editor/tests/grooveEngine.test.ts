import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { planLookaheadWindow } from '../src/audio/rhythmAudio.ts';
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
  analyzeRuntimeExportImpact,
  checkPackageRegistryConflict,
  exportGroovePackage,
  generateProjectId,
  importGroovePackage,
  isValidPackageId,
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
import { convertRhreJsonToTimeline, importRhreFile } from '../src/engine/rhreImporter.ts';
import {
  buildCanonicalZip,
  crc32,
  decodeUtf8Strict,
  inspectAndOpenZip,
  parseStrictJson,
} from '../src/engine/zipSecurity.ts';

function readU32LE(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}
function writeU16LE(b: Uint8Array, off: number, val: number) {
  b[off] = val & 0xff;
  b[off + 1] = (val >>> 8) & 0xff;
}
function writeU32LE(b: Uint8Array, off: number, val: number) {
  b[off] = val & 0xff;
  b[off + 1] = (val >>> 8) & 0xff;
  b[off + 2] = (val >>> 16) & 0xff;
  b[off + 3] = (val >>> 24) & 0xff;
}

function buildRawStoredZip(
  entries: Array<{
    nameBytes: Uint8Array;
    data: Uint8Array;
    flags?: number;
    method?: number;
    externalAttrs?: number;
    overrideUncompressedSize?: number;
    overrideLfhNameBytes?: Uint8Array;
  }>
): Uint8Array {
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const flags = e.flags ?? 0x0800;
    const method = e.method ?? 0;
    const c = crc32(e.data);
    const lfhName = e.overrideLfhNameBytes ?? e.nameBytes;
    const compSize = e.data.length;
    const uncompSize = e.overrideUncompressedSize ?? e.data.length;

    const lfh = new Uint8Array(30 + lfhName.length);
    writeU32LE(lfh, 0, 0x04034b50);
    writeU16LE(lfh, 4, 20);
    writeU16LE(lfh, 6, flags);
    writeU16LE(lfh, 8, method);
    writeU32LE(lfh, 14, c);
    writeU32LE(lfh, 18, compSize);
    writeU32LE(lfh, 22, uncompSize);
    writeU16LE(lfh, 26, lfhName.length);
    lfh.set(lfhName, 30);

    const cdh = new Uint8Array(46 + e.nameBytes.length);
    writeU32LE(cdh, 0, 0x02014b50);
    writeU16LE(cdh, 4, 0x031e);
    writeU16LE(cdh, 6, 20);
    writeU16LE(cdh, 8, flags);
    writeU16LE(cdh, 10, method);
    writeU32LE(cdh, 16, c);
    writeU32LE(cdh, 20, compSize);
    writeU32LE(cdh, 24, uncompSize);
    writeU16LE(cdh, 28, e.nameBytes.length);
    writeU32LE(cdh, 38, e.externalAttrs ?? ((0o100644 << 16) >>> 0));
    writeU32LE(cdh, 42, offset);
    cdh.set(e.nameBytes, 46);

    localParts.push(lfh, e.data);
    cdParts.push(cdh);
    offset += lfh.length + e.data.length;
  }

  const cdSize = cdParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  writeU32LE(eocd, 0, 0x06054b50);
  writeU16LE(eocd, 8, entries.length);
  writeU16LE(eocd, 10, entries.length);
  writeU32LE(eocd, 12, cdSize);
  writeU32LE(eocd, 16, offset);

  const out = new Uint8Array(offset + cdSize + 22);
  let pos = 0;
  for (const p of [...localParts, ...cdParts, eocd]) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

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
  assert.equal(calls[2].args?.[0], 960);
  assert.equal(calls[3].game, 'DANCER');
  assert.equal(validateTimeline(res.timeline).ok, true);
});

test('Authoring and Runtime (GTF + GTL) .groove Draft 0.2 round-trips deterministically with persistent UUID identity', async () => {
  const tl = compileGtf(EXAMPLE_GTF, 'ejemplo.gtf');
  const tinyPngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const pid = generateProjectId();
  assert.equal(isValidPackageId(pid), true);

  // 1) Authoring ('editor') profile round-trip + deterministic SHA-256
  const editorExport1 = await exportGroovePackage({
    profile: 'editor',
    packageId: pid,
    packageVersion: '1.2.3',
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
  const editorExport2 = await exportGroovePackage({
    profile: 'editor',
    packageId: pid,
    packageVersion: '1.2.3',
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
  assert.equal(editorExport1.sha256, editorExport2.sha256, 'Canonical editor export must be deterministic');

  const importedEditor = await importGroovePackage(await editorExport1.blob.arrayBuffer());
  assert.equal(importedEditor.profile, 'editor');
  assert.equal(importedEditor.packageId, pid);
  assert.equal(importedEditor.packageVersion, '1.2.3');
  assert.equal(importedEditor.bpm, 139);
  assert.equal(importedEditor.musicOffsetSec, 0.25);
  assert.deepEqual(timelinesEqual(tl, importedEditor.timeline), []);
  assert.ok(importedEditor.prologueImage?.dataUrl.startsWith('data:image/png;base64,'));
  assert.equal(importedEditor.sprites.KAERU?.scale, 1.25);

  // Impact detector flags omitted resources before runtime export
  const impact = analyzeRuntimeExportImpact({
    packageId: pid,
    packageVersion: '1.2.3',
    timeline: tl,
    bpm: 139,
    musicOffsetSec: 0.25,
    musicFile: null,
    prologueImage: { name: 'intro.png', dataUrl: tinyPngDataUrl },
    sprites: { KAERU: { game: 'KAERU', imageDataUrl: tinyPngDataUrl, scale: 1.25, offsetX: 0, offsetY: 0, tint: '', bounceAmount: 1, defaultAnim: 'Remix8' } },
  });
  assert.equal(impact.hasChanges, true);
  assert.ok(impact.omittedAssets.some((s) => s.includes('sprite')));
  assert.ok(impact.omittedAssets.some((s) => s.includes('intro')));

  // 2) Runtime ('runtime') Draft 0.2 positive fixtures for BOTH GTF and GTL
  for (const rtFmt of ['gtf', 'gtl'] as const) {
    const renamedTl = { ...tl, title: `Renamed (${rtFmt})` };
    const rtOut = await exportGroovePackage({
      profile: 'runtime',
      runtimeFormat: rtFmt,
      packageId: pid,
      packageVersion: '1.2.3',
      timeline: renamedTl,
      bpm: 139,
      musicOffsetSec: 0.25,
      musicFile: null,
      prologueImage: null,
      sprites: {},
    });
    assert.equal(rtOut.manifest.profile, 'runtime');
    assert.equal(rtOut.manifest.engine_contract, 1);
    assert.equal(rtOut.manifest.adapter, 'multi');
    assert.equal(rtOut.manifest.results, 'custom');
    assert.deepEqual(rtOut.manifest.required_capabilities, [`timeline.${rtFmt}`]);

    const rtBuf = new Uint8Array(await rtOut.blob.arrayBuffer());
    const zipEntries = await inspectAndOpenZip(rtBuf, {
      maxCompressedBytes: 1024 * 1024,
      maxTotalUncompressedBytes: 1024 * 1024,
      maxEntries: 2,
      allowDirectories: false,
    });
    assert.deepEqual(zipEntries.listPaths(), ['manifest.json', `timeline.${rtFmt}`]);

    const rtImported = await importGroovePackage(rtBuf);
    assert.equal(rtImported.profile, 'runtime');
    assert.equal(rtImported.packageId, pid, 'Persistent UUID must be preserved across title rename');
    assert.equal(rtImported.timeline.results, 0, 'Runtime package forces custom/exit results');
    assert.equal(rtImported.timeline.title, `Renamed (${rtFmt})`);
  }

  // 3) Identity conflict & downgrade detection
  assert.equal(
    checkPackageRegistryConflict(
      { id: pid, version: '1.2.3', sha256: 'aaa' },
      { id: pid, version: '1.2.3', sha256: 'bbb' }
    ).status,
    'version_conflict'
  );
  assert.equal(
    checkPackageRegistryConflict(
      { id: pid, version: '1.2.3', sha256: 'aaa' },
      { id: pid, version: '1.2.2', sha256: 'bbb' }
    ).status,
    'downgrade'
  );
  assert.equal(
    checkPackageRegistryConflict(
      { id: pid, version: '1.2.3', sha256: 'aaa' },
      { id: pid, version: '1.2.3', sha256: 'aaa' }
    ).status,
    'identical_duplicate'
  );
});

test('rejects malformed Draft 0.2 manifests, duplicate JSON keys, raw ZIP attacks, and decompression bombs', async () => {
  const validManifest = {
    format: 'groove-package/1',
    profile: 'runtime',
    id: generateProjectId(),
    version: '1.0.0',
    title: 'Valid Runtime',
    engine_min: '0.6.0',
    engine_contract: 1,
    adapter: 'multi',
    timeline: { format: 'gtf', path: 'timeline.gtf' },
    required_capabilities: ['timeline.gtf'],
    results: 'custom',
  };
  const validRuntimeGtf = decompileToGtf(compileGtf(EXAMPLE_GTF, 'ex.gtf'), 'Valid Runtime', {
    runtimeMode: true,
  });

  // Duplicate JSON keys rejected before schema
  assert.throws(
    () => parseStrictJson('{"id":"org.a.b","id":"org.a.c"}'),
    /Clave JSON duplicada/i
  );
  assert.throws(
    () => parseStrictJson(new Uint8Array([0x7b, 0xff, 0x7d])),
    /UTF-8 invalido/i
  );

  // Missing manifest.json rejected (no fallback)
  const noManifestZip = await buildCanonicalZip([{ path: 'timeline.gtf', data: validRuntimeGtf }]);
  await assert.rejects(() => importGroovePackage(noManifestZip), /Falta manifest\.json/i);

  // Extra unexpected key in runtime manifest (additionalProperties: false)
  const extraPropZip = await buildCanonicalZip([
    { path: 'manifest.json', data: JSON.stringify({ ...validManifest, extra: true }) },
    { path: 'timeline.gtf', data: validRuntimeGtf },
  ]);
  await assert.rejects(() => importGroovePackage(extraPropZip), /Propiedad desconocida/i);

  // Unsupported adapter ('hoop')
  const hoopZip = await buildCanonicalZip([
    { path: 'manifest.json', data: JSON.stringify({ ...validManifest, adapter: 'hoop' }) },
    { path: 'timeline.gtf', data: validRuntimeGtf },
  ]);
  await assert.rejects(() => importGroovePackage(hoopZip), /Adaptador no soportado/i);

  // Mismatched capability vs timeline format
  const badCapZip = await buildCanonicalZip([
    {
      path: 'manifest.json',
      data: JSON.stringify({ ...validManifest, required_capabilities: ['timeline.gtl'] }),
    },
    { path: 'timeline.gtf', data: validRuntimeGtf },
  ]);
  await assert.rejects(() => importGroovePackage(badCapZip), /required_capabilities incompatible/i);

  // Unsupported engine_min (0.7.0 > 0.6.0)
  const futureEngZip = await buildCanonicalZip([
    { path: 'manifest.json', data: JSON.stringify({ ...validManifest, engine_min: '0.7.0' }) },
    { path: 'timeline.gtf', data: validRuntimeGtf },
  ]);
  await assert.rejects(() => importGroovePackage(futureEngZip), /Groove Engine >= 0\.7\.0/i);

  // Extra 3rd file in runtime package rejected
  const threeFileZip = await buildCanonicalZip([
    { path: 'manifest.json', data: JSON.stringify(validManifest) },
    { path: 'timeline.gtf', data: validRuntimeGtf },
    { path: 'timeline.gtl', data: emitGtl(compileGtf(EXAMPLE_GTF, 'ex.gtf'), 'Valid', { runtimeMode: true }) },
  ]);
  await assert.rejects(() => importGroovePackage(threeFileZip), /exactamente 2 archivos/i);

  // Runtime timeline with `results native` or explicit `match` rejected
  const nativeResGtf = validRuntimeGtf.replace('results exit', 'results native');
  const nativeResZip = await buildCanonicalZip([
    { path: 'manifest.json', data: JSON.stringify(validManifest) },
    { path: 'timeline.gtf', data: nativeResGtf },
  ]);
  await assert.rejects(() => importGroovePackage(nativeResZip), /results native no permitido/i);

  const matchGtf = validRuntimeGtf.replace('results exit', 'results exit\nmatch -1 9 4');
  const matchZip = await buildCanonicalZip([
    { path: 'manifest.json', data: JSON.stringify(validManifest) },
    { path: 'timeline.gtf', data: matchGtf },
  ]);
  await assert.rejects(() => importGroovePackage(matchZip), /match prohibida/i);

  // Raw ZIP attack checks before normalization
  const enc = new TextEncoder();
  const traversalZip = buildRawStoredZip([
    { nameBytes: enc.encode('foo/../escape.txt'), data: enc.encode('bad') },
    { nameBytes: enc.encode('manifest.json'), data: enc.encode(JSON.stringify(validManifest)) },
  ]);
  await assert.rejects(() => importGroovePackage(traversalZip), /Ruta invalida/i);

  const backslashZip = buildRawStoredZip([
    { nameBytes: enc.encode('sub\\evil.txt'), data: enc.encode('bad') },
  ]);
  await assert.rejects(() => importGroovePackage(backslashZip), /Barra invertida prohibida/i);

  const caseCollisionZip = buildRawStoredZip([
    { nameBytes: enc.encode('manifest.json'), data: enc.encode(JSON.stringify(validManifest)) },
    { nameBytes: enc.encode('Manifest.json'), data: enc.encode(JSON.stringify(validManifest)) },
  ]);
  await assert.rejects(() => importGroovePackage(caseCollisionZip), /colision de mayusculas/i);

  const dosDeviceZip = buildRawStoredZip([
    { nameBytes: enc.encode('CON.txt'), data: enc.encode('bad') },
  ]);
  await assert.rejects(() => importGroovePackage(dosDeviceZip), /DOS reservado/i);

  const trailingDotZip = buildRawStoredZip([
    { nameBytes: enc.encode('bad.txt.'), data: enc.encode('bad') },
  ]);
  await assert.rejects(() => importGroovePackage(trailingDotZip), /punto o espacio final/i);

  const symlinkZip = buildRawStoredZip([
    {
      nameBytes: enc.encode('manifest.json'),
      data: enc.encode(JSON.stringify(validManifest)),
      externalAttrs: (0o120777 << 16) >>> 0,
    },
  ]);
  await assert.rejects(() => importGroovePackage(symlinkZip), /symlinks/i);

  const encryptedZip = buildRawStoredZip([
    {
      nameBytes: enc.encode('manifest.json'),
      data: enc.encode(JSON.stringify(validManifest)),
      flags: 0x0801,
    },
  ]);
  await assert.rejects(() => importGroovePackage(encryptedZip), /cifradas/i);

  const nestedZip = buildRawStoredZip([
    { nameBytes: enc.encode('inner.zip'), data: enc.encode('PK') },
  ]);
  await assert.rejects(() => importGroovePackage(nestedZip), /anidado/i);

  const mismatchLfhZip = buildRawStoredZip([
    {
      nameBytes: enc.encode('manifest.json'),
      overrideLfhNameBytes: enc.encode('different.json'),
      data: enc.encode(JSON.stringify(validManifest)),
    },
  ]);
  await assert.rejects(() => importGroovePackage(mismatchLfhZip), /Inconsistencia.*CD y LFH/i);

  // Truncated ZIP rejected
  await assert.rejects(() => importGroovePackage(extraPropZip.slice(0, extraPropZip.length - 10)), /truncad|EOCD/i);

  // Decompression bomb: valid DEFLATE stream of 32 KiB zeros claiming uncompressedSize = 100 inside manifest.json (limit 16 KiB)
  const bombPlain = new Uint8Array(32 * 1024);
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  const r = cs.readable.getReader();
  void w.write(bombPlain).then(() => w.close());
  const compChunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await r.read();
    if (done) break;
    if (value) compChunks.push(value);
  }
  const compLen = compChunks.reduce((s, c) => s + c.length, 0);
  const compData = new Uint8Array(compLen);
  let off = 0;
  for (const c of compChunks) {
    compData.set(c, off);
    off += c.length;
  }
  const bombZip = buildRawStoredZip([
    {
      nameBytes: enc.encode('manifest.json'),
      data: compData,
      method: 8,
      overrideUncompressedSize: 100,
    },
    {
      nameBytes: enc.encode('timeline.gtf'),
      data: enc.encode(validRuntimeGtf),
    },
  ]);
  // Patch CRC in both CD and LFH to plain CRC so only decompression cap stops it (or either cap rejects before allocation)
  const plainCrc = crc32(bombPlain);
  writeU32LE(bombZip, 14, plainCrc);
  const cdOff = readU32LE(bombZip, bombZip.length - 6);
  writeU32LE(bombZip, cdOff + 16, plainCrc);
  await assert.rejects(() => importGroovePackage(bombZip), /excede el limite permitido/i);

  // RHRE traversal rejected too
  const badRhreZip = buildRawStoredZip([
    { nameBytes: enc.encode('../remix.json'), data: enc.encode('{}') },
  ]);
  await assert.rejects(() => importRhreFile(badRhreZip, 'bad.rhref'), /Ruta invalida/i);
});

test('enforces pinned engine_contract.json cue arg profiles, ring_mask, blocked profiles, layouts, and differential parser parity', () => {
  // Verify pinned JSON matches runtime ENGINE_CONTRACT object
  const pinnedRaw = JSON.parse(
    fs.readFileSync(path.resolve('src/engine/engine_contract.pinned.json'), 'utf8')
  );
  assert.deepEqual(ENGINE_CONTRACT, pinnedRaw);

  for (const cue of CUES) {
    const check = validateCueArgsContract(cue.game, cue.fn, cue.args);
    assert.equal(check.ok, true, `Cue ${cue.game}.${cue.name} failed contract: ${check.reason}`);
  }

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

  assert.throws(
    () => compileGtf('first KAERU\nend 8\nfinish 12\nfrog5 99\n', 'badargs.gtf'),
    /fuera del dominio verificado/i
  );
  assert.throws(
    () => compileGtf('first THE_A\nend 8\nfinish 12\nTHE_A.0x278FE0 TEA 1\n', 'badword.gtf'),
    /no acepta argumentos enteros/i
  );

  const validRing = compileGtf('first RING\nend 8\nfinish 12\nhoop 5 1\n', 'ring_ok.gtf');
  assert.equal(validRing.events[0].args?.[0], 5);
  assert.equal(validRing.events[0].args?.[1], 1);
  assert.throws(() => compileGtf('first RING\nend 8\nfinish 12\nhoop 16 0\n', 'ring_bad1.gtf'), /ring_mask/i);
  assert.throws(() => compileGtf('first RING\nend 8\nfinish 12\nhoop -2 0\n', 'ring_bad2.gtf'), /ring_mask/i);
  assert.throws(() => compileGtf('first RING\nend 8\nfinish 12\nhoop 1 2\n', 'ring_bad3.gtf'), /ring_mask/i);

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
  assert.throws(() => compileGtf('first KAERU\nmatch 5 0 0\nend 8\nfinish 12\nfrog3\n', 'bad_match.gtf'), /match fuera de rango/i);
  assert.throws(() => compileGtf('first KAERU\nprologue ../escape\nend 8\nfinish 12\nfrog3\n', 'bad_pro.gtf'), /prologue/i);

  // Source bounds parity
  const longLine = `first KAERU\n# ${'x'.repeat(260)}\nend 8\nfinish 12\nfrog3\n`;
  assert.throws(() => compileGtf(longLine, 'longline.gtf'), /255 bytes/i);

  // Strict UTF-8 check for GTF/GTL file byte decoding
  assert.throws(
    () => decodeUtf8Strict(new Uint8Array([0x66, 0x69, 0x72, 0x73, 0x74, 0xff]), 'bad_utf8.gtf'),
    /UTF-8 invalido/i
  );

  // Differential check against Codex Python parser when available in host environment
  const pyTool = '/tmp/codex_gtf.py';
  if (fs.existsSync(pyTool)) {
    const runPyGtfToGtl = (src: string) =>
      execFileSync(
        'python3',
        [
          '-c',
          `import sys, importlib.util
spec = importlib.util.spec_from_file_location("gtf", "${pyTool}")
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)
tl = m.compile_gtf(sys.stdin.read(), "diff.gtf")
print(m.emit_gtl(tl, "diff.gtf"))`,
        ],
        { input: src, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );

    for (const fixture of [EXAMPLE_GTF, SHOWCASE_24_GTF]) {
      const pyGtl = runPyGtfToGtl(fixture);
      const pyTimeline = parseGtl(pyGtl, 'py_diff.gtl');
      const tsTimeline = compileGtf(fixture, 'ts_diff.gtf');
      assert.deepEqual(timelinesEqual(pyTimeline, tsTimeline), []);
    }

    // Negative differential parity: invalid inputs must be rejected by both Python and TS parsers
    const badInputs = [
      'first KAERU\nend 8\nfinish 12\nlemon\n',
      'first RING\nend 8\nfinish 12\nhoop 16 0\n',
      'first KAERU\nend 8\nfinish 12\nfrog3\nanim KAERU Remix8 0x3B58\n',
      'first KAERU\nmatch 5 0 0\nend 8\nfinish 12\nfrog3\n',
      'first KAERU\nprologue ../escape\nend 8\nfinish 12\nfrog3\n',
    ];
    for (const bad of badInputs) {
      assert.throws(() => compileGtf(bad, 'bad_ts.gtf'));
      assert.throws(() => runPyGtfToGtl(bad));
    }
  }
});

test('AudioContext lookahead scheduler handles seek, deduplication, and background/resume safely', () => {
  const events = compileGtf(EXAMPLE_GTF, 'audio.gtf').events;
  const scheduledKeys = new Set<string>();

  // Window 1 at audioTime=10.0, BPM=120 (0.5s/beat => 960 ticks/sec)
  const p1 = planLookaheadWindow({
    anchorAudioTime: 10.0,
    anchorTick: 0,
    nowAudioTime: 10.0,
    bpm: 120,
    lookaheadSec: 0.25,
    maxTick: 20000,
    events,
    nextBeatToSchedule: 0,
    scheduledKeys,
  });
  assert.equal(p1.beatsToSchedule.length, 1); // beat 0 at t=10.0
  assert.equal(p1.beatsToSchedule[0].when, 10.0);

  // Overlapping window at audioTime=10.05 must NOT re-schedule beat 0 or already-queued events
  const p2 = planLookaheadWindow({
    anchorAudioTime: 10.0,
    anchorTick: 0,
    nowAudioTime: 10.05,
    bpm: 120,
    lookaheadSec: 0.25,
    maxTick: 20000,
    events,
    nextBeatToSchedule: p1.nextBeatToSchedule,
    scheduledKeys,
  });
  assert.equal(p2.beatsToSchedule.some((b) => b.beat === 0), false);

  // Simulate background tab resume jump: nowAudioTime jumps +4.0s forward; stale beats/cues older than tolerance are NOT burst-fired!
  const resumeKeys = new Set<string>();
  const pResume = planLookaheadWindow({
    anchorAudioTime: 10.0,
    anchorTick: 0,
    nowAudioTime: 14.0, // tick 3840 (beat 8)
    bpm: 120,
    lookaheadSec: 0.14,
    maxTick: 20000,
    events,
    nextBeatToSchedule: 0,
    scheduledKeys: resumeKeys,
  });
  assert.ok(pResume.beatsToSchedule.every((b) => b.beat >= 8), 'Stale beats during tab suspension must not burst-fire');
  assert.ok(pResume.eventsToSchedule.every((e) => e.when >= 14.0), 'Resumed events must not schedule in the past');
});
