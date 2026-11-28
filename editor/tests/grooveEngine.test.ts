import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  AudioDecodeLimiter,
  BoundedAudioBufferCache,
  MAX_AUDIO_DECODE_FAILURES,
  MAX_BGM_COMPRESSED_BYTES,
  MAX_BGM_DURATION_SEC,
  MAX_CONCURRENT_AUDIO_DECODES,
  MAX_SFX_COMPRESSED_BYTES,
  planLookaheadWindow,
  preflightAudioContainer,
  RhythmAudioEngine,
} from '../src/audio/rhythmAudio.ts';
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
  validateRuntimeGroovePackage,
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
  BUILTIN_PATTERNS,
  buildPatternFromSelection,
  computeGameSections,
  instantiatePattern,
  evaluatePlayalongHit,
} from '../src/engine/patternStore.ts';
import {
  buildCanonicalZip,
  crc32,
  decodeUtf8Strict,
  inspectAndOpenZip,
  parseStrictJson,
} from '../src/engine/zipSecurity.ts';
import {
  assertImageDimensionBounds,
  buildLocalAssetCueList,
  collectStageBoundImages,
  createDefaultGameBinding,
  deleteVaultAsset,
  estimateRgbaBytes,
  estimateStoredRecordBytes,
  exportVaultBindingsManifestOnly,
  FORMAT_RESEARCH_CATALOG,
  getReferencedAudioAssetIds,
  importSwitchContainerAsset,
  inspectAssetFileHeader,
  loadLocalVault,
  type LocalAssetRecord,
  LocalVaultStorageError,
  MAX_ATLAS_FRAMES,
  MAX_AUDIO_DURATION_SEC,
  MAX_DECODED_PCM_BYTES,
  MAX_VAULT_IMPORT_BATCH_BYTES,
  MAX_VAULT_IMPORT_FILES,
  MAX_VAULT_TOTAL_ASSETS,
  MAX_VAULT_TOTAL_BYTES,
  parseAtlasJson,
  purgeLocalVault,
  resolveActiveAnimationFrame,
  resolveAtlasTargetAsset,
  resolveCueSfxAssetId,
  saveVaultAssetsBatch,
  saveVaultBindings,
  sniffImageDimensions,
  StageImageCacheManager,
  suggestAssetAssociation,
  upsertAssetsById,
  validateVaultImportBudget,
  verifyVaultImageHeader,
} from '../src/engine/localAssetVault.ts';
import {
  deswizzleTegraBlockLinear,
  encodeRgbaToPngBytes,
  evaluateBflanAtFrame,
  parseBflanContainer,
  parseBflytContainer,
  parseBfresContainer,
  parseBntxContainer,
  swizzleTegraBlockLinear,
} from '../src/engine/switchFormats.ts';
import { computeRingSceneState, renderRingScene } from '../src/stage/scenes/ringScene.ts';
import { getRegisteredSceneCount, SCENE_PROFILES } from '../src/stage/sceneEngine.ts';
import { renderBflytLayoutWithBflan, renderBfresModel } from '../src/stage/switchCompositor.ts';

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
  const writeDone = w.write(bombPlain).then(() => w.close());
  const compChunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await r.read();
    if (done) break;
    if (value) compChunks.push(value);
  }
  await writeDone;
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
  const plainCrc = crc32(bombPlain);
  writeU32LE(bombZip, 14, plainCrc);
  const cdOff = readU32LE(bombZip, bombZip.length - 6);
  writeU32LE(bombZip, cdOff + 16, plainCrc);
  await assert.rejects(() => importGroovePackage(bombZip), /excede el limite permitido/i);

  // Malformed DEFLATE stream: writer rejection must be observed and disposed cleanly
  const malformed = buildRawStoredZip([
    { nameBytes: enc.encode('manifest.json'), data: new Uint8Array([7]), method: 8, overrideUncompressedSize: 1 },
  ]);
  await assert.rejects(() => importGroovePackage(malformed));

  // Overlapping local regions embedded inside another member must be rejected
  const inner = buildRawStoredZip([{ nameBytes: enc.encode('b'), data: enc.encode('X') }]);
  const overlap = buildRawStoredZip([
    { nameBytes: enc.encode('a'), data: inner.slice(0, 32) },
    { nameBytes: enc.encode('b'), data: enc.encode('X') },
  ]);
  const overlapCd = readU32LE(overlap, overlap.length - 6);
  writeU32LE(overlap, overlapCd + 47 + 42, 31);
  await assert.rejects(
    () =>
      inspectAndOpenZip(overlap, {
        maxCompressedBytes: 4096,
        maxTotalUncompressedBytes: 4096,
        maxEntries: 5,
        allowDirectories: false,
      }),
    /solapadas/i
  );

  // Draft 0.3 / GE-155 hardening checks: BOM, lone surrogate, DEFLATE trailing bytes, editor-profile runtime reject, runtime script directives
  assert.throws(() => parseStrictJson(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), /BOM/i);
  assert.throws(() => parseStrictJson('{"s":"\\uD800"}'), /surrogate/i);
  const editorSubZip = await buildCanonicalZip([
    {
      path: 'manifest.json',
      data: JSON.stringify({ ...validManifest, profile: 'editor', editor: { bad: true } }),
    },
    { path: 'timeline.gtf', data: validRuntimeGtf },
  ]);
  await assert.rejects(() => validateRuntimeGroovePackage(editorSubZip), /NOT_RUNTIME_PROFILE/);

  // DEFLATE trailing bytes appended after BFINAL block must fail in strictDraft03
  const validManifestBytes = enc.encode(JSON.stringify(validManifest));
  const csDef = new CompressionStream('deflate-raw');
  const wDef = csDef.writable.getWriter();
  const rDef = csDef.readable.getReader();
  const wDefDone = wDef.write(validManifestBytes).then(() => wDef.close());
  const defChunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await rDef.read();
    if (done) break;
    if (value) defChunks.push(value);
  }
  await wDefDone;
  const defLen = defChunks.reduce((s, c) => s + c.length, 0);
  const defTrailing = new Uint8Array(defLen + 1);
  let dOff = 0;
  for (const c of defChunks) {
    defTrailing.set(c, dOff);
    dOff += c.length;
  }
  defTrailing[defLen] = 0x00;
  const trailingZip = buildRawStoredZip([
    {
      nameBytes: enc.encode('manifest.json'),
      data: defTrailing,
      method: 8,
      overrideUncompressedSize: validManifestBytes.length,
    },
    {
      nameBytes: enc.encode('timeline.gtf'),
      data: enc.encode(validRuntimeGtf),
    },
  ]);
  const manCrc = crc32(validManifestBytes);
  writeU32LE(trailingZip, 14, manCrc);
  const tCdOff = readU32LE(trailingZip, trailingZip.length - 6);
  writeU32LE(trailingZip, tCdOff + 16, manCrc);
  await assert.rejects(() => validateRuntimeGroovePackage(trailingZip), /trailing|sobrantes|deflate/i);

  // Editor profile rejected by runtime-only validator
  const editorProfileManifest = { ...validManifest, profile: 'editor' };
  const editorProfileRuntimeCheckZip = await buildCanonicalZip([
    { path: 'manifest.json', data: JSON.stringify(editorProfileManifest) },
    { path: 'timeline.gtf', data: validRuntimeGtf },
  ]);
  await assert.rejects(
    () => validateRuntimeGroovePackage(editorProfileRuntimeCheckZip),
    /NOT_RUNTIME_PROFILE/
  );

  // Runtime timeline script invalid directives: legacy GTL1, `results custom`, duplicate `start`, missing `start`
  await assert.rejects(
    async () =>
      validateRuntimeGroovePackage(
        await buildCanonicalZip([
          { path: 'manifest.json', data: JSON.stringify({ ...validManifest, timeline: { format: 'gtl', path: 'timeline.gtl' }, required_capabilities: ['timeline.gtl'] }) },
          { path: 'timeline.gtl', data: 'GTL1\nfirst KAERU\nstart 0\nresults exit\nend 960 0\nfinish 1440\nX 0 KAERU 0x1B8DB0 3 0 0 0 -\n' },
        ])
      ),
    /GTL1.*legacy/i
  );
  await assert.rejects(
    async () =>
      validateRuntimeGroovePackage(
        await buildCanonicalZip([
          { path: 'manifest.json', data: JSON.stringify(validManifest) },
          { path: 'timeline.gtf', data: validRuntimeGtf.replace('results exit', 'results custom') },
        ])
      ),
    /results exit/i
  );

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

  // Mandatory differential check against the pinned authoritative Python parser (commit ff2adc2)
  const referenceCommit = 'ff2adc2a186cfc3e1a15ca1957d673cf7f230dc2';
  const referenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ge153-python-'));
  const pyTool = path.join(referenceDir, 'gtf.py');
  try {
    // Fail loudly rather than silently skipping if git, python3, or the commit is unavailable.
    for (const file of ['gtf.py', 'engine_contract.json']) {
      fs.writeFileSync(
        path.join(referenceDir, file),
        process.env.GROOVE_REFERENCE_DIR
          ? fs.readFileSync(path.join(process.env.GROOVE_REFERENCE_DIR, file))
          : execFileSync('git', ['show', `${referenceCommit}:tools/${file}`])
      );
    }
    const runPyGtfToGtl = (src: string, mode = 'gtf') => {
      const inputPath = path.join(referenceDir, 'fixture.txt');
      fs.writeFileSync(inputPath, src, 'utf8');
      return execFileSync(
        process.env.GROOVE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
        [
          '-c',
          `import sys, importlib.util, pathlib
spec = importlib.util.spec_from_file_location("gtf", ${JSON.stringify(pyTool)})
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)
tl = (m.parse_gtl if sys.argv[1] == "gtl" else m.compile_gtf)(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"), "diff")
print(m.emit_gtl(tl, "diff.gtf"))`,
          mode,
          inputPath,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }
      );
    };

    for (const fixture of [
      EXAMPLE_GTF,
      SHOWCASE_24_GTF,
      'swing 120\nRING.hoop\n',
      'def Pattern\nRING.hoop\nend\ncall pattern\n',
      ...CUES.map((c) => `${c.game}.${c.name}\n`),
    ]) {
      const pyGtl = runPyGtfToGtl(fixture);
      const pyTimeline = parseGtl(pyGtl, 'py_diff.gtl');
      const tsTimeline = compileGtf(fixture, 'ts_diff.gtf');
      assert.deepEqual(timelinesEqual(pyTimeline, tsTimeline), []);
    }

    const legacyGtl = 'GTLM 1\nX 0 RING 0x217960 -1\nend 4000 960\nfinish 5000\n';
    assert.deepEqual(
      timelinesEqual(parseGtl(runPyGtfToGtl(legacyGtl, 'gtl'), 'py.gtl'), parseGtl(legacyGtl, 'ts.gtl')),
      []
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(referenceDir, 'engine_contract.json'), 'utf8')),
      ENGINE_CONTRACT
    );

    // Negative differential parity: invalid inputs must be rejected by both Python and TS parsers
    const badInputs = [
      'first KAERU\nend 8\nfinish 12\nlemon\n',
      'first RING\nend 8\nfinish 12\nhoop 16 0\n',
      'first KAERU\nend 8\nfinish 12\nfrog3\nanim KAERU Remix8 0x3B58\n',
      'first KAERU\nmatch 5 0 0\nend 8\nfinish 12\nfrog3\n',
      'first KAERU\nprologue ../escape\nend 8\nfinish 12\nfrog3\n',
      'RING.hoop 0xFFFFFFFF\n',
      'CARS.brake 0\n',
      'RING.hoop\nend 0\n',
      'RING.hoop\nend 4\nfinish 1\n',
      'rest 2147483647t\nrest 1t\nRING.hoop\n',
      'rest 0.00001\nRING.hoop\n',
    ];
    for (const bad of badInputs) {
      assert.throws(() => compileGtf(bad, 'bad_ts.gtf'), Error, bad);
      assert.throws(() => runPyGtfToGtl(bad));
    }
  } finally {
    fs.rmSync(referenceDir, { recursive: true, force: true });
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

test('RHREfresh-style reusable patterns, GameBoundaries sections, and Heaven Studio Playalong evaluation respect engine contract', () => {
  // 1) All built-in patterns instantiate within engine_contract.json and round-trip through GTF/GTL
  let cursor = 0;
  const assembledEvents = [];
  for (const pat of BUILTIN_PATTERNS) {
    const inst = instantiatePattern(pat, cursor, true);
    assert.ok(inst.length >= 2, `Pattern ${pat.id} should include switch + cue events`);
    assert.equal(inst[0].op, 'switch');
    assert.equal(inst[0].game, pat.primaryGame);
    assembledEvents.push(...inst);
    cursor += pat.durationTicks + TPB;
  }

  const baseTl = {
    title: 'Pattern Showcase',
    prologue: 'type_19',
    jingle: 0x163,
    bgm: 139,
    start: 0,
    swing: 120,
    match: [-1, 9, 4] as [number, number, number],
    results: 1 as const,
    first: BUILTIN_PATTERNS[0].primaryGame,
    translen: 2 * TPB,
    end: cursor,
    endFade: 960,
    finish: cursor + 4 * TPB,
    events: assembledEvents,
  };
  assert.equal(validateTimeline(baseTl).ok, true);

  const gtf = decompileToGtf(baseTl, 'patterns.gtf');
  const recompiled = compileGtf(gtf, 'patterns.gtf');
  assert.deepEqual(timelinesEqual(baseTl, recompiled), []);

  const runtimeGtl = emitGtl(baseTl, 'patterns.gtl', { runtimeMode: true });
  const parsedRuntime = parseGtl(runtimeGtl, 'patterns.gtl', { runtimeMode: true });
  assert.equal(parsedRuntime.results, 0);

  // 2) Save Selection as Pattern -> Instantiate round-trip preserves relative beat offsets & THE_A word
  const sampleSelection = assembledEvents.slice(0, 5);
  const customPattern = buildPatternFromSelection(sampleSelection, 'My Frog & Car Phrase', 'KAERU');
  assert.equal(customPattern.builtIn, false);
  const stamped = instantiatePattern(customPattern, 8 * TPB, false);
  assert.equal(stamped.length, sampleSelection.length);
  assert.equal(stamped[0].tick, 8 * TPB);

  // 3) computeGameSections (RHREfresh GameBoundaries parity)
  const sections = computeGameSections(baseTl, cursor + 4 * TPB);
  assert.ok(sections.length >= BUILTIN_PATTERNS.length);
  for (let i = 1; i < sections.length; i++) {
    assert.ok(sections[i].startTick >= sections[i - 1].endTick);
  }

  // 4) evaluatePlayalongHit windows at 120 BPM (0.5s/beat = 500ms / 480 ticks)
  // Verified KAERU frog3 (0x1B8DB0, [3,0,0,0]) has leadInBeats = 3 => targetTick = 0 + 3*480 = 1440
  const kaeruTarget = 3 * TPB;
  const kaeruTl = {
    ...baseTl,
    events: [{ id: 'k1', tick: 0, op: 'call' as const, game: 'KAERU' as const, fn: 0x1b8db0, args: [3, 0, 0, 0] as [number, number, number, number] }],
  };
  const ace = evaluatePlayalongHit(kaeruTl, kaeruTarget, 120);
  assert.equal(ace?.judgement, 'ACE');
  const just = evaluatePlayalongHit(kaeruTl, kaeruTarget + 30, 120); // ~31ms
  assert.equal(just?.judgement, 'JUST');
  const early = evaluatePlayalongHit(kaeruTl, kaeruTarget - 80, 120); // ~-83ms
  assert.equal(early?.judgement, 'EARLY');
  const late = evaluatePlayalongHit(kaeruTl, kaeruTarget + 80, 120); // ~+83ms
  assert.equal(late?.judgement, 'LATE');
  const miss = evaluatePlayalongHit(kaeruTl, kaeruTarget + 135, 120); // ~141ms
  assert.equal(miss?.judgement, 'MISS');
  const outOfRange = evaluatePlayalongHit(kaeruTl, kaeruTarget + 300, 120);
  assert.equal(outOfRange, null);
});

test('Local Asset Vault inspects Switch containers honestly, parses atlases, associates 24-game cues, and isolates binary payloads', () => {
  const enc = new TextEncoder();

  // 1) Browser-decodable local extracted formats
  const pngHdr = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(inspectAssetFileHeader('frog_idle.png', pngHdr, 'image/png').kind, 'sprite');
  assert.equal(inspectAssetFileHeader('frog_sheet_4x2.png', pngHdr, 'image/png').kind, 'texture_atlas');

  const wavHdr = new Uint8Array(12);
  wavHdr.set(enc.encode('RIFF'), 0);
  wavHdr.set(enc.encode('WAVE'), 8);
  assert.equal(inspectAssetFileHeader('frog3_sfx.wav', wavHdr, 'audio/wav').kind, 'sfx');
  assert.equal(inspectAssetFileHeader('remix21_bgm.wav', wavHdr, 'audio/wav').kind, 'music');

  assert.equal(inspectAssetFileHeader('song.ogg', enc.encode('OggS\x00'), 'audio/ogg').kind, 'music');

  // 2) Unparsed Switch / Rhythm Heaven Groove native binaries flagged honestly (never fabricated)
  for (const [fname, magic] of [
    ['kaeru.bntx', enc.encode('BNTX\x00\x00\x00\x00')],
    ['cars.bfres', enc.encode('FRES    ')],
    ['ui.bflyt', enc.encode('FLYT\xfe\xff')],
    ['anim.bflan', enc.encode('FLAN\xfe\xff')],
    ['sound.bars', enc.encode('BARS\x01\x00')],
    ['sfx.bwav', enc.encode('BWAV\x01\x00')],
    ['bgm.bfstm', enc.encode('FSTM\xfe\xff')],
    ['rom.sarc', enc.encode('SARC\x00\x14')],
    ['pack.zs', new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00])],
  ] as const) {
    const res = inspectAssetFileHeader(fname, magic);
    assert.equal(res.kind, 'native_unparsed', `${fname} must be flagged native_unparsed`);
    assert.equal(res.needsConversion, true, `${fname} must require conversion`);
    assert.ok(res.conversionHint && res.conversionHint.length > 10);
  }
  assert.ok(
    FORMAT_RESEARCH_CATALOG.some(
      (e) => e.status === 'supported_local_extracted' && e.extensionOrMagic.includes('BNTX')
    )
  );
  assert.ok(
    FORMAT_RESEARCH_CATALOG.some(
      (e) => e.status === 'needs_research' && e.extensionOrMagic.includes('.spr')
    )
  );

  // 3) Atlas JSON parsing (TexturePacker hash & array formats)
  const hashAtlas = parseAtlasJson(
    JSON.stringify({
      frames: {
        idle_0: { frame: { x: 0, y: 0, w: 64, h: 64 } },
        hop_1: { frame: { x: 64, y: 0, w: 64, h: 64 } },
      },
      meta: { image: 'frog_sheet_4x2.png' },
    })
  );
  assert.equal(hashAtlas.frames.length, 2);
  assert.equal(hashAtlas.metaImage, 'frog_sheet_4x2.png');

  const arrAtlas = parseAtlasJson(
    JSON.stringify({
      frames: [
        { filename: 'f0', frame: { x: 0, y: 0, w: 32, h: 32 } },
        { filename: 'f1', frame: { x: 32, y: 0, w: 32, h: 32 } },
      ],
    })
  );
  assert.equal(arrAtlas.frames.length, 2);
  assert.equal(arrAtlas.frames[1].x, 32);

  // 4) Auto-association against 24 Groove Engine minigames, aliases, cues, slots & grid hints
  const sFrog = suggestAssetAssociation('frog3_sheet_4x2.png', 'extracted/ribbitRocket/sprites/', 'texture_atlas');
  assert.equal(sFrog.game, 'KAERU');
  assert.equal(sFrog.slot, 'actor');
  assert.equal(sFrog.cols, 4);
  assert.equal(sFrog.rows, 2);
  assert.equal(sFrog.cueKey, 'KAERU:0x1B8DB0');

  const sBg = suggestAssetAssociation('stage_backdrop.png', 'hopStopNRoll/bg/', 'sprite');
  assert.equal(sBg.game, 'ROLLING');
  assert.equal(sBg.slot, 'backdrop');

  const sFg = suggestAssetAssociation('foreground_overlay.png', 'popDontDrop/ui/', 'sprite');
  assert.equal(sFg.game, 'PUTILABO');
  assert.equal(sFg.slot, 'foreground');

  // Verify cue list builder reuses Groove Engine catalog across all 24 games
  for (const g of GAMES) {
    const cueList = buildLocalAssetCueList(g);
    assert.ok(cueList.length >= 2, `Expected default + cues for ${g}`);
  }

  // 5) Multi-layer animation frame resolution (priority: anim > cue > beat > idle) & cue SFX mapping
  const sheetAsset: LocalAssetRecord = {
    id: 'ast_frog_sheet',
    name: 'frog_sheet_4x2.png',
    relativePath: 'KAERU/frog_sheet_4x2.png',
    kind: 'texture_atlas',
    mimeType: 'image/png',
    sizeBytes: 1024,
    addedAtIso: '2026-01-01T00:00:00.000Z',
    imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    width: 256,
    height: 128,
    cols: 4,
    rows: 2,
  };
  const kaeruBinding = createDefaultGameBinding('KAERU');
  kaeruBinding.actorAssetId = sheetAsset.id;
  kaeruBinding.cueSfxMap = {
    'KAERU:0x1B8DB0': 'sfx_frog3',
    'KAERU:default': 'sfx_default',
  };
  kaeruBinding.animations = [
    {
      id: 'clip_idle',
      label: 'Idle',
      triggerType: 'idle',
      triggerKey: '',
      assetId: sheetAsset.id,
      cols: 4,
      rows: 2,
      startFrame: 0,
      endFrame: 1,
      fps: 8,
      beatSync: true,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    {
      id: 'clip_cue',
      label: 'Frog3 Jump',
      triggerType: 'cue',
      triggerKey: 'KAERU:0x1B8DB0',
      assetId: sheetAsset.id,
      cols: 4,
      rows: 2,
      startFrame: 2,
      endFrame: 5,
      fps: 12,
      beatSync: true,
      scale: 1.1,
      offsetX: 0,
      offsetY: -8,
    },
    {
      id: 'clip_anim',
      label: 'Remix8',
      triggerType: 'anim',
      triggerKey: 'Remix8',
      assetId: sheetAsset.id,
      cols: 4,
      rows: 2,
      startFrame: 6,
      endFrame: 7,
      fps: 12,
      beatSync: true,
      scale: 1.2,
      offsetX: 0,
      offsetY: -12,
    },
  ];

  const assetsById = new Map([[sheetAsset.id, sheetAsset]]);
  const cueEv = { id: 'c1', tick: 0, op: 'call' as const, game: 'KAERU' as const, fn: 0x1b8db0, args: [3, 0, 0, 0] as [number, number, number, number] };
  const animEv = { id: 'a1', tick: 0, op: 'anim' as const, game: 'KAERU' as const, animName: 'Remix8', layout: 0x4128 };

  const frameAnim = resolveActiveAnimationFrame({
    game: 'KAERU',
    binding: kaeruBinding,
    assetsById,
    currentTick: 0,
    bpm: 120,
    activeCue: cueEv,
    cueAgeBeats: 0.2,
    activeAnim: animEv,
  });
  assert.equal(frameAnim?.scale, 1.2, 'anim event must take top priority over cue/idle clips');
  assert.equal(frameAnim?.sw, 64);
  assert.equal(frameAnim?.sh, 64);
  assert.equal(frameAnim?.sy, 64); // frame 6 is row 1

  const frameCue = resolveActiveAnimationFrame({
    game: 'KAERU',
    binding: kaeruBinding,
    assetsById,
    currentTick: 240,
    bpm: 120,
    activeCue: cueEv,
    cueAgeBeats: 0.5,
    activeAnim: null,
  });
  assert.equal(frameCue?.scale, 1.1, 'active cue clip must activate when no anim event is running');

  assert.equal(resolveCueSfxAssetId(cueEv, { KAERU: kaeruBinding }), 'sfx_frog3');
  const otherKaeruCue = { ...cueEv, fn: 0x1b8fb0 };
  assert.equal(resolveCueSfxAssetId(otherKaeruCue, { KAERU: kaeruBinding }), 'sfx_default');

  // 6) Metadata-only vault manifest must NEVER include binary imageDataUrl / audioBufferData
  const metaJson = exportVaultBindingsManifestOnly({
    assets: [
      {
        ...sheetAsset,
        audioBufferData: new ArrayBuffer(16),
      },
    ],
    bindings: { KAERU: kaeruBinding },
    globalAudio: { jingleAssetMap: {} },
  });
  assert.equal(metaJson.includes('data:image/png'), false);
  assert.equal(metaJson.includes('audioBufferData'), false);
  assert.ok(metaJson.includes('groove-builder-local-bindings/1'));
});

function createMockIdbFactory(opts?: {
  failMode?: 'quota_exceeded' | 'abort' | null;
  abortAfterPutCount?: number;
}) {
  const stores: Record<string, Map<string, unknown>> = {
    assets: new Map(),
    meta: new Map(),
  };

  let rwQueueTail: Promise<void> = Promise.resolve();
  let putCalls = 0;

  const schedule = (fn: () => void) => {
    queueMicrotask(fn);
  };

  const makeReq = () => ({
    result: undefined as unknown,
    error: null as Error | null,
    onsuccess: null as ((ev: unknown) => void) | null,
    onerror: null as ((ev: unknown) => void) | null,
  });

  const makeDb = () => {
    const dbObj = {
      objectStoreNames: {
        contains: (name: string) => name in stores,
      },
      createObjectStore: (name: string) => {
        if (!stores[name]) stores[name] = new Map();
        return {} as IDBObjectStore;
      },
      close: () => {},
      transaction: (storeNames: string | string[], mode: IDBTransactionMode) => {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        let snapshots = new Map<string, Map<string, unknown>>();
        let releaseLock!: () => void;
        const waitForLock =
          mode === 'readwrite'
            ? (() => {
                const prev = rwQueueTail;
                const next = new Promise<void>((r) => {
                  releaseLock = r;
                });
                rwQueueTail = next;
                return prev.then(() => {
                  snapshots = new Map<string, Map<string, unknown>>();
                  for (const n of names) {
                    snapshots.set(n, new Map(stores[n]));
                  }
                });
              })()
            : Promise.resolve();

        let pendingOps = 0;
        let failed = false;
        let released = false;
        const releaseOnce = () => {
          if (mode === 'readwrite' && !released) {
            released = true;
            releaseLock();
          }
        };

        const tx = {
          error: null as Error | null,
          oncomplete: null as (() => void) | null,
          onabort: null as (() => void) | null,
          onerror: null as (() => void) | null,
          abort: () => {
            if (failed) return;
            failed = true;
            if (mode === 'readwrite') {
              for (const [n, snap] of snapshots) stores[n] = snap;
            }
            const err = new Error('Transaction aborted');
            err.name = 'AbortError';
            tx.error = err;
            schedule(() => {
              releaseOnce();
              tx.onabort?.();
            });
          },
          objectStore: (name: string) => {
            const settleOp = () => {
              pendingOps--;
              if (pendingOps === 0 && !failed) {
                schedule(() => {
                  if (pendingOps === 0 && !failed) {
                    releaseOnce();
                    tx.oncomplete?.();
                  }
                });
              }
            };
            return {
              put: (val: unknown, key?: string) => {
                pendingOps++;
                const req = makeReq();
                void waitForLock.then(() => {
                  schedule(() => {
                    if (failed) return;
                    if (opts?.failMode === 'quota_exceeded') {
                      failed = true;
                      const err = new Error('Simulated storage quota exceeded');
                      err.name = 'QuotaExceededError';
                      req.error = err;
                      tx.error = err;
                      if (mode === 'readwrite') {
                        for (const [n, snap] of snapshots) stores[n] = snap;
                      }
                      releaseOnce();
                      req.onerror?.({});
                      tx.onerror?.();
                      return;
                    }
                    putCalls++;
                    if (
                      opts?.failMode === 'abort' ||
                      (opts?.abortAfterPutCount !== undefined && putCalls > opts.abortAfterPutCount)
                    ) {
                      tx.abort();
                      return;
                    }
                    const store = stores[name] ?? (stores[name] = new Map());
                    const k = key ?? String((val as { id: string }).id);
                    store.set(k, structuredClone(val));
                    req.result = k;
                    req.onsuccess?.({});
                    settleOp();
                  });
                });
                return req;
              },
              get: (key: string) => {
                pendingOps++;
                const req = makeReq();
                void waitForLock.then(() => {
                  schedule(() => {
                    if (failed) return;
                    const store = stores[name] ?? (stores[name] = new Map());
                    req.result = store.has(key) ? structuredClone(store.get(key)) : undefined;
                    req.onsuccess?.({});
                    settleOp();
                  });
                });
                return req;
              },
              delete: (key: string) => {
                pendingOps++;
                const req = makeReq();
                void waitForLock.then(() => {
                  schedule(() => {
                    if (failed) return;
                    const store = stores[name] ?? (stores[name] = new Map());
                    store.delete(key);
                    req.onsuccess?.({});
                    settleOp();
                  });
                });
                return req;
              },
              clear: () => {
                pendingOps++;
                const req = makeReq();
                void waitForLock.then(() => {
                  schedule(() => {
                    if (failed) return;
                    const store = stores[name] ?? (stores[name] = new Map());
                    store.clear();
                    req.onsuccess?.({});
                    settleOp();
                  });
                });
                return req;
              },
              openCursor: () => {
                pendingOps++;
                const req = makeReq();
                void waitForLock.then(() => {
                  const store = stores[name] ?? (stores[name] = new Map());
                  const values = [...store.values()];
                  let idx = 0;
                  const emitNext = () => {
                    if (failed) return;
                    if (idx >= values.length) {
                      req.result = null;
                      req.onsuccess?.({});
                      settleOp();
                      return;
                    }
                    req.result = {
                      value: structuredClone(values[idx++]),
                      continue: () => schedule(emitNext),
                    };
                    req.onsuccess?.({});
                  };
                  schedule(emitNext);
                });
                return req;
              },
            };
          },
        };
        return tx as unknown as IDBTransaction;
      },
    };
    return dbObj as unknown as IDBDatabase;
  };

  return {
    factory: {
      open: () => {
        const req = {
          result: makeDb(),
          error: null,
          onupgradeneeded: null as (() => void) | null,
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
          onblocked: null as (() => void) | null,
        };
        schedule(() => {
          req.onupgradeneeded?.();
          req.onsuccess?.();
        });
        return req as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory,
    stores,
  };
}

test('Local Asset Vault enforces persistence, ID deduplication, error propagation, cumulative budgets, and ambiguity detection', async () => {
  const sampleRec = (id: string, name: string, relPath: string, sizeBytes = 1024): LocalAssetRecord => ({
    id,
    name,
    relativePath: relPath,
    kind: 'sprite',
    mimeType: 'image/png',
    sizeBytes,
    addedAtIso: '2026-01-01T00:00:00.000Z',
    imageDataUrl: 'data:image/png;base64,AA==',
    width: 64,
    height: 64,
  });

  // 1) Mocked IndexedDB lifecycle: save batch -> bindings -> simulated reload -> delete -> purge
  const { factory } = createMockIdbFactory();
  const r1 = sampleRec('id_a', 'frog.png', 'KAERU/frog.png');
  const r2 = sampleRec('id_b', 'sfx_hop.wav', 'KAERU/sfx_hop.wav');
  r2.kind = 'sfx';
  delete r2.imageDataUrl;
  r2.audioBufferData = new ArrayBuffer(64);

  // Deduplication check: attaching atlas updates existing record without duplicating id_a
  const r1Atlas: LocalAssetRecord = {
    ...r1,
    kind: 'texture_atlas',
    atlasFrames: [{ name: 'f0', x: 0, y: 0, w: 32, h: 32 }],
  };
  await saveVaultAssetsBatch([r1, r1Atlas, r2], factory);
  const binding = createDefaultGameBinding('KAERU');
  binding.actorAssetId = 'id_a';
  binding.cueSfxMap['KAERU:default'] = 'id_b';
  await saveVaultBindings({ KAERU: binding }, { jingleAssetMap: {} }, factory);

  const reloaded = await loadLocalVault(factory);
  assert.equal(reloaded.assets.length, 2, 'upsert/batch save must never duplicate same id');
  assert.equal(reloaded.assets.find((a) => a.id === 'id_a')?.kind, 'texture_atlas');
  assert.equal(reloaded.bindings.KAERU?.actorAssetId, 'id_a');

  await deleteVaultAsset('id_b', factory);
  const afterDelete = await loadLocalVault(factory);
  assert.equal(afterDelete.assets.length, 1);

  await purgeLocalVault(factory);
  const afterPurge = await loadLocalVault(factory);
  assert.equal(afterPurge.assets.length, 0);
  assert.deepEqual(afterPurge.bindings, {});

  // 2) Explicit storage error reporting (NEVER silent success)
  await assert.rejects(
    () => loadLocalVault(undefined),
    (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'unavailable'
  );
  const quotaDb = createMockIdbFactory({ failMode: 'quota_exceeded' }).factory;
  await assert.rejects(
    () => saveVaultAssetsBatch([r1], quotaDb),
    (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'quota_exceeded'
  );
  const abortDb = createMockIdbFactory({ failMode: 'abort' }).factory;
  await assert.rejects(
    () => saveVaultBindings({ KAERU: binding }, { jingleAssetMap: {} }, abortDb),
    (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'aborted'
  );

  // 3) Cursor-bounded loadLocalVault rejects DB exceeding cumulative MAX_VAULT_TOTAL_ASSETS
  const overDb = createMockIdbFactory();
  for (let i = 0; i <= MAX_VAULT_TOTAL_ASSETS; i++) {
    overDb.stores.assets.set(`ov_${i}`, sampleRec(`ov_${i}`, `f${i}.png`, `f${i}.png`, 10));
  }
  await assert.rejects(
    () => loadLocalVault(overDb.factory),
    (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'budget_exceeded'
  );

  // 4) Cumulative batch & vault budgets, image dimension sniff, atlas frame cap, and LRU PCM buffer cap
  assert.throws(
    () =>
      validateVaultImportBudget({
        existingAssets: [],
        incoming: Array.from({ length: MAX_VAULT_IMPORT_FILES + 1 }, (_, i) => ({
          name: `f${i}.png`,
          sizeBytes: 128,
        })),
      }),
    (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'budget_exceeded'
  );
  assert.throws(
    () =>
      validateVaultImportBudget({
        existingAssets: [],
        incoming: [
          { name: 'a.wav', sizeBytes: 30 * 1024 * 1024 },
          { name: 'b.wav', sizeBytes: MAX_VAULT_IMPORT_BATCH_BYTES - 29 * 1024 * 1024 },
        ],
      }),
    (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'budget_exceeded'
  );

  // PNG dimension bomb header (8192x8192) caught before DataURL/Image decode
  const giantPngHdr = new Uint8Array(24);
  giantPngHdr.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const dv = new DataView(giantPngHdr.buffer);
  dv.setUint32(16, 8192, false);
  dv.setUint32(20, 8192, false);
  const dims = sniffImageDimensions(giantPngHdr);
  assert.deepEqual(dims, { width: 8192, height: 8192 });
  assert.throws(() => assertImageDimensionBounds(dims!.width, dims!.height, 'bomb.png'), /limit/i);

  // Atlas JSON exceeding MAX_ATLAS_FRAMES rejected
  const tooManyFrames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> = {};
  for (let i = 0; i <= MAX_ATLAS_FRAMES; i++) {
    tooManyFrames[`f_${i}`] = { frame: { x: 0, y: 0, w: 16, h: 16 } };
  }
  assert.throws(() => parseAtlasJson(JSON.stringify({ frames: tooManyFrames })), /MAX_ATLAS_FRAMES/i);

  // LRU decoded PCM buffer cache enforces count/bytes & duration bounds
  const pcmCache = new BoundedAudioBufferCache<string>(1000, 2, MAX_AUDIO_DURATION_SEC);
  assert.throws(() => pcmCache.set('too_long', 'x', 100, MAX_AUDIO_DURATION_SEC + 1), /duration/i);
  pcmCache.set('k1', 'buf1', 400, 1);
  pcmCache.set('k2', 'buf2', 400, 1);
  assert.equal(pcmCache.get('k1'), 'buf1'); // touch k1 -> k2 is now LRU
  const evicted = pcmCache.set('k3', 'buf3', 400, 1);
  assert.deepEqual(evicted, ['k2']);
  assert.equal(pcmCache.has('k1'), true);
  assert.equal(pcmCache.has('k3'), true);
  assert.equal(pcmCache.totalBytes, 800);

  // 5) Directory-aware atlas matching & ambiguity detection
  const kaeruSheet = sampleRec('kaeru_sheet', 'sheet.png', 'KAERU/sheet.png');
  const carsSheet = sampleRec('cars_sheet', 'sheet.png', 'CARS/sheet.png');
  const exactRes = resolveAtlasTargetAsset('KAERU/sheet.json', undefined, [kaeruSheet, carsSheet]);
  assert.equal(exactRes.target?.id, 'kaeru_sheet');
  assert.equal(exactRes.ambiguous, false);
  const ambigRes = resolveAtlasTargetAsset('OTHER/sheet.json', undefined, [kaeruSheet, carsSheet]);
  assert.equal(ambigRes.target, null);
  assert.equal(ambigRes.ambiguous, true);

  const ambigCue = suggestAssetAssociation('yellow.wav', 'sfx/', 'sfx');
  assert.equal(ambigCue.game, null);
  assert.equal(ambigCue.ambiguous, true);
  assert.ok((ambigCue.matchedGames?.length ?? 0) >= 2);

  // upsertAssetsById preserves unique IDs cleanly
  const dedupedState = upsertAssetsById([r1, r2], [r1Atlas]);
  assert.equal(dedupedState.length, 2);
  assert.equal(dedupedState.filter((x) => x.id === 'id_a').length, 1);

  // 6) Lazy audio references only return bound SFX/jingle assets (NOT unreferenced music tracks)
  const refIds = getReferencedAudioAssetIds(
    { KAERU: { ...binding, bgmAssetId: 'unbound_music_only' } },
    { jingleAssetMap: { 355: 'jingle_1' }, switchCutAssetId: 'cut_sfx' }
  );
  assert.equal(refIds.has('id_b'), true);
  assert.equal(refIds.has('jingle_1'), true);
  assert.equal(refIds.has('cut_sfx'), true);
  assert.equal(refIds.has('unbound_music_only'), false);

  // 7) Export isolation: runtime .groove exports strictly 2 files and omits all vault resources
  const tl = compileGtf(EXAMPLE_GTF, 'iso.gtf');
  const pid = generateProjectId();
  const rtOut = await exportGroovePackage({
    profile: 'runtime',
    runtimeFormat: 'gtf',
    packageId: pid,
    packageVersion: '1.0.0',
    timeline: tl,
    bpm: 139,
    musicOffsetSec: 0,
    musicFile: null,
    prologueImage: null,
    sprites: {},
  });
  const rtZip = await inspectAndOpenZip(new Uint8Array(await rtOut.blob.arrayBuffer()), {
    maxCompressedBytes: 1024 * 1024,
    maxTotalUncompressedBytes: 1024 * 1024,
    maxEntries: 2,
    allowDirectories: false,
    strictDraft03: true,
    allowDataDescriptor: true,
  });
  assert.deepEqual(rtZip.listPaths(), ['manifest.json', 'timeline.gtf']);

  const edOut = await exportGroovePackage({
    profile: 'editor',
    packageId: pid,
    packageVersion: '1.0.0',
    timeline: tl,
    bpm: 139,
    musicOffsetSec: 0,
    musicFile: null,
    prologueImage: null,
    sprites: {},
  });
  const edZip = await inspectAndOpenZip(new Uint8Array(await edOut.blob.arrayBuffer()), {
    maxCompressedBytes: 1024 * 1024,
    maxTotalUncompressedBytes: 1024 * 1024,
    maxEntries: 64,
    allowDirectories: true,
  });
  assert.equal(edZip.listPaths().some((p) => p.includes('frog.png') || p.includes('sfx_hop')), false);
});

test('StageImageCacheManager, strict raster header bounds, audio preflight/limiter, and concurrent/rollback IndexedDB transactions', async () => {
  const sampleRec = (id: string, name: string, relPath: string, sizeBytes = 1024): LocalAssetRecord => ({
    id,
    name,
    relativePath: relPath,
    kind: 'sprite',
    mimeType: 'image/png',
    sizeBytes,
    addedAtIso: '2026-01-01T00:00:00.000Z',
    imageDataUrl: 'data:image/png;base64,AA==',
    width: 1024,
    height: 1024,
  });

  // 1) Reject image formats lacking verifiable pixel headers (including SVG & unknown headers)
  const enc = new TextEncoder();
  const svgBytes = enc.encode('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"></svg>');
  assert.equal(inspectAssetFileHeader('vector.svg', svgBytes, 'image/svg+xml').kind, 'native_unparsed');
  assert.throws(
    () => verifyVaultImageHeader(svgBytes, 'vector.svg'),
    (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'budget_exceeded'
  );
  assert.throws(
    () => verifyVaultImageHeader(enc.encode('NOT_AN_IMAGE'), 'fake.png'),
    (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'budget_exceeded'
  );

  // 2) StageImageCacheManager: scene-only loading + pending/loaded RGBA budget + image disposal
  const disposedIds: string[] = [];
  const loadCallbacks = new Map<string, { onLoad: () => void; onError: () => void }>();
  const single4096Rgba = estimateRgbaBytes(4096, 4096); // 64 MiB per 4096x4096 image!
  assert.equal(single4096Rgba, 64 * 1024 * 1024);

  const stageMgr = new StageImageCacheManager<{ src: string; disposed: boolean }>({
    maxImages: 64,
    maxRgbaBytes: 128 * 1024 * 1024, // 128 MiB -> fits at most TWO 4096x4096 RGBA images (cached + pending)!
    createImage: (src, handlers) => {
      loadCallbacks.set(src, handlers);
      return { src, disposed: false };
    },
    disposeImage: (img) => {
      img.disposed = true;
      disposedIds.push(img.src);
    },
  });

  const a1 = { ...sampleRec('kaeru_actor', 'kaeru.png', 'kaeru.png'), width: 4096, height: 4096, imageDataUrl: 'data:kaeru' };
  const a2 = { ...sampleRec('kaeru_bg', 'kbg.png', 'kbg.png'), width: 4096, height: 4096, imageDataUrl: 'data:kbg' };
  const a3 = { ...sampleRec('cars_actor', 'cars.png', 'cars.png'), width: 4096, height: 4096, imageDataUrl: 'data:cars' };
  const aUnbound = { ...sampleRec('free_item', 'free.png', 'free.png'), width: 4096, height: 4096, imageDataUrl: 'data:unbound' };

  const kaeruB = createDefaultGameBinding('KAERU');
  kaeruB.actorAssetId = a1.id;
  kaeruB.backdropAssetId = a2.id;
  const carsB = createDefaultGameBinding('CARS');
  carsB.actorAssetId = a3.id;

  const mapById = new Map([a1, a2, a3, aUnbound].map((x) => [x.id, x]));
  const wanted = collectStageBoundImages({
    currentGame: 'KAERU',
    prevGame: null,
    vaultBindings: { KAERU: kaeruB, CARS: carsB },
    vaultAssetsById: mapById,
  });
  // Unbound inventory asset MUST NOT appear in wanted scene list
  assert.equal(wanted.some((w) => w.id === 'free_item'), false);

  stageMgr.syncActiveScenes(wanted);
  // Active scene KAERU claims all 128 MiB across TWO pending images BEFORE onload fires; CARS stays uncached!
  assert.equal(stageMgr.size, 2);
  assert.equal(stageMgr.pendingRgbaBytes, 128 * 1024 * 1024);
  assert.equal(stageMgr.loadedRgbaBytes, 0);
  assert.ok(stageMgr.getImage('kaeru_actor'));
  assert.ok(stageMgr.getImage('kaeru_bg'));
  assert.equal(stageMgr.getImage('cars_actor'), undefined);

  loadCallbacks.get('data:kaeru')?.onLoad();
  assert.equal(stageMgr.loadedRgbaBytes, 64 * 1024 * 1024);
  assert.equal(stageMgr.pendingRgbaBytes, 64 * 1024 * 1024);

  // Switch active scene to CARS: priority CARS evicts KAERU cleanly and calls disposeImage()
  const wantedCars = collectStageBoundImages({
    currentGame: 'CARS',
    prevGame: null,
    vaultBindings: { KAERU: kaeruB, CARS: carsB },
    vaultAssetsById: mapById,
  });
  stageMgr.syncActiveScenes(wantedCars);
  assert.ok(stageMgr.getImage('cars_actor'));
  assert.ok(disposedIds.length >= 1, 'Evicted stage images must be disposed cleanly');
  stageMgr.disposeAll();
  assert.equal(stageMgr.totalRgbaBytes, 0);

  // 3) Audio container preflight, concurrency limiter, BGM & audition OR bounds
  assert.throws(
    () =>
      preflightAudioContainer(enc.encode('NOT_AUDIO_GARBAGE'), {
        maxCompressedBytes: MAX_SFX_COMPRESSED_BYTES,
        maxDurationSec: MAX_AUDIO_DURATION_SEC,
        maxPcmBytes: MAX_DECODED_PCM_BYTES,
        label: 'garbage.bin',
      }),
    (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'aborted'
  );

  // Construct WAV header claiming > 300s (e.g., 400s stereo 48kHz 16-bit in small byte buffer) -> caught BEFORE decodeAudioData!
  const fakeLongWav = new Uint8Array(44);
  fakeLongWav.set(enc.encode('RIFF'), 0);
  writeU32LE(fakeLongWav, 4, 36 + 400 * 48000 * 4);
  fakeLongWav.set(enc.encode('WAVE'), 8);
  fakeLongWav.set(enc.encode('fmt '), 12);
  writeU32LE(fakeLongWav, 16, 16);
  writeU16LE(fakeLongWav, 20, 1); // PCM
  writeU16LE(fakeLongWav, 22, 2); // 2 channels
  writeU32LE(fakeLongWav, 24, 48000); // sampleRate
  writeU32LE(fakeLongWav, 28, 48000 * 4); // byteRate
  writeU16LE(fakeLongWav, 32, 4); // blockAlign
  writeU16LE(fakeLongWav, 34, 16); // bitsPerSample
  fakeLongWav.set(enc.encode('data'), 36);
  writeU32LE(fakeLongWav, 40, 400 * 48000 * 4);

  assert.throws(
    () =>
      preflightAudioContainer(fakeLongWav, {
        maxCompressedBytes: MAX_SFX_COMPRESSED_BYTES,
        maxDurationSec: MAX_AUDIO_DURATION_SEC,
        maxPcmBytes: MAX_DECODED_PCM_BYTES,
        label: 'huge.wav',
      }),
    (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'budget_exceeded'
  );

  // AudioDecodeLimiter caps concurrent tasks <= MAX_CONCURRENT_AUDIO_DECODES and trips after MAX_AUDIO_DECODE_FAILURES
  const limiter = new AudioDecodeLimiter(MAX_CONCURRENT_AUDIO_DECODES, MAX_AUDIO_DECODE_FAILURES);
  let peakConcurrent = 0;
  let running = 0;
  await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      limiter.run(`ok_${i}`, async () => {
        running++;
        peakConcurrent = Math.max(peakConcurrent, running);
        await new Promise((r) => setTimeout(r, 8));
        running--;
        return i;
      })
    )
  );
  assert.ok(peakConcurrent <= MAX_CONCURRENT_AUDIO_DECODES);

  for (let i = 0; i < MAX_AUDIO_DECODE_FAILURES; i++) {
    await assert.rejects(() =>
      limiter.run(`bad_${i}`, async () => {
        throw new Error('decode failed');
      })
    );
  }
  await assert.rejects(
    () => limiter.run('ok_after_cap', async () => 'should_not_run'),
    (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'aborted'
  );

  // Verify RhythmAudioEngine auditionBufferOnce (OR duration vs PCM) and BGM loadAudioBuffer limits via mocked AudioContext
  const origWindow = (globalThis as Record<string, unknown>).window;
  let decodeCalls = 0;
  try {
    (globalThis as Record<string, unknown>).window = {
      AudioContext: class MockAudioContext {
        state = 'running';
        currentTime = 0;
        sampleRate = 48000;
        destination = {};
        createGain() {
          return { gain: { value: 1, setValueAtTime() {} }, connect() {} };
        }
        createBufferSource() {
          return { buffer: null, connect() {}, start() {}, stop() {}, disconnect() {}, onended: null };
        }
        decodeAudioData() {
          decodeCalls++;
          // Valid compressed OGG mock that decompresses into 40s high-PCM buffer > MAX_DECODED_PCM_BYTES
          return Promise.resolve({
            duration: 40, // <= 300s (tests `||` when duration is OK but PCM exceeds 32 MiB!)
            numberOfChannels: 2,
            length: 5_000_000, // 5M * 2 * 4 = 40 MB > 32 MiB
            getChannelData: () => new Float32Array(256),
          });
        }
      },
    };
    const eng = new RhythmAudioEngine();
    const oggValidMagic = new Uint8Array(32);
    oggValidMagic.set(enc.encode('OggS'), 0);

    await assert.rejects(
      () => eng.auditionBufferOnce(oggValidMagic.buffer, 'ogg_huge_pcm'),
      (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'budget_exceeded'
    );
    assert.equal(decodeCalls, 1);

    // Repeating same failed assetId skips decodeAudioData cleanly without hammering decoder
    await assert.rejects(
      () => eng.auditionBufferOnce(oggValidMagic.buffer, 'ogg_huge_pcm'),
      (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'aborted'
    );
    assert.equal(decodeCalls, 1);

    // BGM loadAudioBuffer rejects > MAX_BGM_COMPRESSED_BYTES and > MAX_BGM_DURATION_SEC
    const giantBgm = new Uint8Array(MAX_BGM_COMPRESSED_BYTES + 1024);
    giantBgm.set(enc.encode('OggS'), 0);
    await assert.rejects(
      () => eng.loadAudioBuffer(giantBgm.buffer),
      (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'budget_exceeded'
    );
    assert.equal(eng.musicDurationSec, 0);

    // Mock BGM returning > MAX_BGM_DURATION_SEC on decode
    (globalThis as Record<string, unknown>).window = {
      AudioContext: class MockLongBgmContext {
        state = 'running';
        currentTime = 0;
        destination = {};
        createGain() {
          return { gain: { value: 1, setValueAtTime() {} }, connect() {} };
        }
        decodeAudioData() {
          return Promise.resolve({
            duration: MAX_BGM_DURATION_SEC + 30,
            numberOfChannels: 2,
            length: 1000,
            getChannelData: () => new Float32Array(256),
          });
        }
      },
    };
    const bgmEng = new RhythmAudioEngine();
    await assert.rejects(
      () => bgmEng.loadAudioBuffer(oggValidMagic.buffer),
      (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'budget_exceeded'
    );
    assert.equal(bgmEng.musicDurationSec, 0);
  } finally {
    if (origWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = origWindow;
    }
  }

  // 4) Transactional IndexedDB: concurrent saveVaultAssetsBatch near byte/count cap + mid-batch abort rollback
  const concDb = createMockIdbFactory();
  const makeBigAudioRec = (id: string, byteSize: number): LocalAssetRecord => ({
    id,
    name: `${id}.wav`,
    relativePath: `KAERU/${id}.wav`,
    kind: 'sfx',
    mimeType: 'audio/wav',
    sizeBytes: byteSize,
    addedAtIso: '2026-01-01T00:00:00.000Z',
    audioBufferData: new ArrayBuffer(byteSize),
  });

  // Seed 20 MiB first, then race two concurrent <=48 MiB batches (45 MiB each -> TX1 reaches 65 MiB OK; TX2 sees 65+45 = 110 MiB > 96 MiB!)
  await saveVaultAssetsBatch([makeBigAudioRec('seed_20', 20 * 1024 * 1024)], concDb.factory);
  const batchOne = [makeBigAudioRec('b1_a', 25 * 1024 * 1024), makeBigAudioRec('b1_b', 20 * 1024 * 1024)]; // 45 MiB (<= 48 MiB)
  const batchTwo = [makeBigAudioRec('b2_a', 25 * 1024 * 1024), makeBigAudioRec('b2_b', 20 * 1024 * 1024)]; // 45 MiB (<= 48 MiB)
  const [res1, res2] = await Promise.allSettled([
    saveVaultAssetsBatch(batchOne, concDb.factory),
    saveVaultAssetsBatch(batchTwo, concDb.factory),
  ]);
  assert.equal(res1.status, 'fulfilled', 'First serialized transaction must succeed within 96 MiB');
  assert.equal(res2.status, 'rejected', 'Second serialized transaction seeing TX1 rows must reject with budget_exceeded');
  if (res2.status === 'rejected') {
    assert.ok(res2.reason instanceof LocalVaultStorageError && res2.reason.code === 'budget_exceeded');
  }
  const afterConcurrent = await loadLocalVault(concDb.factory);
  assert.equal(afterConcurrent.assets.length, 3);
  assert.ok(
    afterConcurrent.assets.reduce((s, r) => s + estimateStoredRecordBytes(r), 0) <= MAX_VAULT_TOTAL_BYTES
  );

  // Mid-batch abort rollback: pre-populate 1 row, then start a 2-row batch where put #2 aborts -> store MUST keep ONLY the pre-existing row
  const rollbackDb = createMockIdbFactory({ abortAfterPutCount: 2 });
  await saveVaultAssetsBatch([sampleRec('pre_existing', 'pre.png', 'pre.png')], rollbackDb.factory);
  await assert.rejects(
    () =>
      saveVaultAssetsBatch(
        [
          sampleRec('partial_1', 'p1.png', 'p1.png'),
          sampleRec('partial_2', 'p2.png', 'p2.png'),
        ],
        rollbackDb.factory
      ),
    (err: unknown) => err instanceof LocalVaultStorageError && err.code === 'aborted'
  );
  const afterRollback = await loadLocalVault(rollbackDb.factory);
  assert.deepEqual(
    afterRollback.assets.map((a) => a.id),
    ['pre_existing'],
    'Mid-batch transaction abort must roll back all partial batch writes atomically'
  );
});

// ---------------------------------------------------------------------------
// GE-157: Native Switch Container Parsers (BNTX/BFLYT/BFLAN/BFRES),
// Hoop Trundling (RING) Scene, 24-Minigame Engine, & Drive Security Helpers
// ---------------------------------------------------------------------------

function buildSyntheticBntx(opts: {
  name: string;
  width: number;
  height: number;
  format: number;
  swizzledBytes: Uint8Array;
  blockHeightLog2?: number;
}): Uint8Array {
  const buf = new Uint8Array(0x400 + opts.swizzledBytes.length);
  const view = new DataView(buf.buffer);
  const enc = new TextEncoder();
  // BNTX header
  buf.set(enc.encode('BNTX\0\0\0\0'), 0x00);
  view.setUint32(0x08, 0x00040000, true);
  view.setUint16(0x0c, 0xfeff, true);
  view.setUint32(0x10, 0x00000000, true); // name offset
  view.setUint32(0x18, 0x200, true); // reloc offset
  view.setUint32(0x1c, buf.length, true);

  // NX header at 0x20
  buf.set(enc.encode('NX  '), 0x20);
  view.setUint32(0x24, 1, true); // texture count = 1
  const infoPtrsOff = 0x50;
  const brtiOff = 0x60;
  const nameOff = 0x1a0;
  const mipPtrsOff = 0x1e0;
  const dataOff = 0x240;

  view.setBigUint64(0x28, BigInt(infoPtrsOff), true);
  view.setBigUint64(0x30, BigInt(dataOff - 0x10), true);
  view.setBigUint64(0x38, BigInt(0x220), true);

  view.setBigUint64(infoPtrsOff, BigInt(brtiOff), true);

  // BRTI at 0x60
  buf.set(enc.encode('BRTI'), brtiOff);
  view.setUint32(brtiOff + 0x04, 0x100, true);
  view.setBigUint64(brtiOff + 0x08, 0x100n, true);
  buf[brtiOff + 0x10] = 0x01; // flags
  buf[brtiOff + 0x11] = 2; // dim = 2D
  view.setUint16(brtiOff + 0x12, 0, true); // tileMode = BlockLinear
  view.setUint16(brtiOff + 0x14, 0, true);
  view.setUint16(brtiOff + 0x16, 1, true); // mipCount = 1
  view.setUint32(brtiOff + 0x18, 1, true); // sampleCount
  view.setUint32(brtiOff + 0x1c, opts.format, true);
  view.setUint32(brtiOff + 0x24, opts.width, true);
  view.setUint32(brtiOff + 0x28, opts.height, true);
  view.setUint32(brtiOff + 0x2c, 1, true);
  view.setUint32(brtiOff + 0x30, 1, true);
  view.setUint32(brtiOff + 0x34, opts.blockHeightLog2 ?? 0, true);
  view.setUint32(brtiOff + 0x50, opts.swizzledBytes.length, true);
  view.setUint32(brtiOff + 0x54, 512, true);
  view.setUint32(brtiOff + 0x58, 0x05040302, true); // RGBA channel map
  view.setBigUint64(brtiOff + 0x60, BigInt(nameOff), true);
  view.setBigUint64(brtiOff + 0x70, BigInt(mipPtrsOff), true);

  const nameBytes = enc.encode(opts.name);
  view.setUint16(nameOff, nameBytes.length, true);
  buf.set(nameBytes, nameOff + 2);

  view.setBigUint64(mipPtrsOff, BigInt(dataOff), true);
  buf.set(opts.swizzledBytes, dataOff);
  return buf;
}

function buildSyntheticBflyt(): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];

  // lyt1 (0x1c bytes)
  const lyt1 = new Uint8Array(0x1c);
  const lyt1View = new DataView(lyt1.buffer);
  lyt1.set(enc.encode('lyt1'), 0);
  lyt1View.setUint32(4, lyt1.length, true);
  lyt1[8] = 0; // centered origin
  lyt1View.setFloat32(12, 1280, true);
  lyt1View.setFloat32(16, 720, true);
  chunks.push(lyt1);

  // txl1 with 1 texture "ring_hoop"
  const texName = enc.encode('ring_hoop\0');
  const txl1Size = (16 + texName.length + 3) & ~3;
  const txl1 = new Uint8Array(txl1Size);
  const txl1View = new DataView(txl1.buffer);
  txl1.set(enc.encode('txl1'), 0);
  txl1View.setUint32(4, txl1Size, true);
  txl1View.setUint16(8, 1, true);
  txl1View.setUint32(12, 4, true); // offset from table start (12) to string (16)
  txl1.set(texName, 16);
  chunks.push(txl1);

  // pan1 root pane
  const pan1 = new Uint8Array(0x54);
  const pan1View = new DataView(pan1.buffer);
  pan1.set(enc.encode('pan1'), 0);
  pan1View.setUint32(4, pan1.length, true);
  pan1[8] = 1; // visible
  pan1[10] = 255; // alpha
  pan1.set(enc.encode('RootPane'), 12);
  pan1View.setFloat32(0x2c, 0, true); // tx
  pan1View.setFloat32(0x30, 0, true); // ty
  pan1View.setFloat32(0x44, 1, true); // sx
  pan1View.setFloat32(0x48, 1, true); // sy
  pan1View.setFloat32(0x4c, 1280, true);
  pan1View.setFloat32(0x50, 720, true);
  chunks.push(pan1);

  // pas1
  const pas1 = new Uint8Array(8);
  pas1.set(enc.encode('pas1'), 0);
  new DataView(pas1.buffer).setUint32(4, 8, true);
  chunks.push(pas1);

  // pic1 child pane "HoopPic"
  const pic1 = new Uint8Array(0x70);
  const pic1View = new DataView(pic1.buffer);
  pic1.set(enc.encode('pic1'), 0);
  pic1View.setUint32(4, pic1.length, true);
  pic1[8] = 1;
  pic1[10] = 255;
  pic1.set(enc.encode('HoopPic'), 12);
  pic1View.setFloat32(0x2c, 40, true);
  pic1View.setFloat32(0x30, 20, true);
  pic1View.setFloat32(0x44, 1, true);
  pic1View.setFloat32(0x48, 1, true);
  pic1View.setFloat32(0x4c, 180, true);
  pic1View.setFloat32(0x50, 180, true);
  // Vertex colors RGBA at 0x54..0x63
  for (let i = 0; i < 16; i++) pic1[0x54 + i] = 0xff;
  pic1View.setUint16(0x64, 0, true); // materialIndex = 0 -> ring_hoop
  chunks.push(pic1);

  // pae1
  const pae1 = new Uint8Array(8);
  pae1.set(enc.encode('pae1'), 0);
  new DataView(pae1.buffer).setUint32(4, 8, true);
  chunks.push(pae1);

  const totalSize = 0x14 + chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  out.set(enc.encode('FLYT'), 0);
  view.setUint16(4, 0xfeff, true);
  view.setUint16(6, 0x14, true);
  view.setUint32(8, 0x05020000, true);
  view.setUint32(12, totalSize, true);
  view.setUint16(16, chunks.length, true);

  let off = 0x14;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function buildSyntheticBflan(): Uint8Array {
  const enc = new TextEncoder();
  // Header 0x14 + pai1 section
  const pai1 = new Uint8Array(0x100);
  const pView = new DataView(pai1.buffer);
  pai1.set(enc.encode('pai1'), 0);
  pView.setUint32(4, pai1.length, true);
  pView.setUint16(8, 60, true); // frameSize = 60
  pai1[10] = 1; // loop
  pView.setUint16(12, 0, true); // texCount
  pView.setUint16(14, 1, true); // entryCount = 1
  pView.setUint32(16, 0x18, true); // entryOffsetTable at +0x18

  const entryOff = 0x20;
  pView.setUint32(0x18, entryOff, true);
  pai1.set(enc.encode('HoopPic'), entryOff); // 28-byte pane name
  pai1[entryOff + 28] = 1; // tagCount = 1
  pai1[entryOff + 29] = 0; // targetKind = pane
  // Tag offset table starts at entryOff + 0x20 (relative to entryOff)
  const tagRelFromEntry = 0x24;
  pView.setUint32(entryOff + 0x20, tagRelFromEntry, true);

  const tagOff = entryOff + tagRelFromEntry; // 0x44
  pai1.set(enc.encode('FLPA'), tagOff);
  pai1[tagOff + 4] = 1; // curveCount = 1
  const curveOffInTag = 0x0c;
  pView.setUint32(tagOff + 8, curveOffInTag, true);

  const curveOff = tagOff + curveOffInTag; // 0x50
  pai1[curveOff + 0] = 0; // idx
  pai1[curveOff + 1] = 1; // target = transY (FLPA target 1)
  pai1[curveOff + 2] = 2; // curveType = Hermite (2)
  pView.setUint16(curveOff + 4, 2, true); // keyCount = 2
  pView.setUint32(curveOff + 0x0c, 0x10, true); // keys at curveOff + 0x10

  const keysOff = curveOff + 0x10; // 0x60
  // Key 0: frame 0, val 0, slope 0
  pView.setFloat32(keysOff + 0, 0, true);
  pView.setFloat32(keysOff + 4, 0, true);
  pView.setFloat32(keysOff + 8, 0, true);
  // Key 1: frame 60, val 120, slope 0
  pView.setFloat32(keysOff + 12, 60, true);
  pView.setFloat32(keysOff + 16, 120, true);
  pView.setFloat32(keysOff + 20, 0, true);

  const out = new Uint8Array(0x14 + pai1.length);
  const view = new DataView(out.buffer);
  out.set(enc.encode('FLAN'), 0);
  view.setUint16(4, 0xfeff, true);
  view.setUint16(6, 0x14, true);
  view.setUint32(8, 0x01040000, true);
  view.setUint32(12, out.length, true);
  view.setUint16(16, 1, true);
  out.set(pai1, 0x14);
  return out;
}

function buildSyntheticBfres(): Uint8Array {
  const enc = new TextEncoder();
  const buf = new Uint8Array(0x400);
  const view = new DataView(buf.buffer);

  buf.set(enc.encode('FRES    '), 0x00);
  view.setUint32(0x08, 0x00090000, true);
  view.setUint16(0x0c, 0xfeff, true);
  view.setUint32(0x1c, buf.length, true);
  const fileNameOff = 0x180;
  view.setBigUint64(0x20, BigInt(fileNameOff), true);
  const fnBytes = enc.encode('ring_trundlorb');
  view.setUint16(fileNameOff, fnBytes.length, true);
  buf.set(fnBytes, fileNameOff + 2);

  // Switch FRES v9 layout: model array offset at 0x28, model count at 0x8C
  const fmdlOff = 0x200;
  view.setBigUint64(0x28, BigInt(fmdlOff), true);
  view.setUint16(0x8c, 1, true);

  buf.set(enc.encode('FMDL'), fmdlOff);
  const modelNameOff = 0x1a0;
  const mnBytes = enc.encode('TrundlorbModel');
  view.setUint16(modelNameOff, mnBytes.length, true);
  buf.set(mnBytes, modelNameOff + 2);
  view.setBigUint64(fmdlOff + 0x10, BigInt(modelNameOff), true);
  view.setUint16(fmdlOff + 0x68, 1, true); // fvtxCount
  view.setUint16(fmdlOff + 0x6a, 1, true); // fshpCount
  view.setUint16(fmdlOff + 0x6c, 1, true); // fmatCount
  return buf;
}

function createMockCanvasCtx() {
  const ops: string[] = [];
  const gradientStub = { addColorStop: () => {} };
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: () => ops.push('save'),
    restore: () => ops.push('restore'),
    translate: () => ops.push('translate'),
    rotate: () => ops.push('rotate'),
    scale: () => ops.push('scale'),
    beginPath: () => ops.push('beginPath'),
    closePath: () => ops.push('closePath'),
    moveTo: () => ops.push('moveTo'),
    lineTo: () => ops.push('lineTo'),
    arc: () => ops.push('arc'),
    ellipse: () => ops.push('ellipse'),
    rect: () => ops.push('rect'),
    roundRect: () => ops.push('roundRect'),
    fill: () => ops.push('fill'),
    stroke: () => ops.push('stroke'),
    fillRect: () => ops.push('fillRect'),
    strokeRect: () => ops.push('strokeRect'),
    fillText: () => ops.push('fillText'),
    strokeText: () => ops.push('strokeText'),
    drawImage: () => ops.push('drawImage'),
    clip: () => ops.push('clip'),
    setLineDash: () => ops.push('setLineDash'),
    createLinearGradient: () => gradientStub,
    createRadialGradient: () => gradientStub,
    measureText: (t: string) => ({ width: t.length * 7 }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

test('GE-157: parses Switch BNTX/BFLYT/BFLAN/BFRES, renders RING Hoop Trundling & 24-minigame engine, and validates Drive helpers', async () => {
  // 1) Tegra X1 Block-Linear GOB swizzle/deswizzle round-trip + RGBA8 BNTX decode -> valid PNG
  const w = 8;
  const h = 8;
  const linearRgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      linearRgba[i] = (x * 32) & 0xff;
      linearRgba[i + 1] = (y * 32) & 0xff;
      linearRgba[i + 2] = 0xcc;
      linearRgba[i + 3] = 0xff;
    }
  }
  const swizzled = swizzleTegraBlockLinear({
    width: w,
    height: h,
    blkW: 1,
    blkH: 1,
    bpp: 4,
    blockHeightLog2: 0,
    linear: linearRgba,
  });
  const roundTripped = deswizzleTegraBlockLinear({
    width: w,
    height: h,
    blkW: 1,
    blkH: 1,
    bpp: 4,
    tileMode: 0,
    blockHeightLog2: 0,
    src: swizzled,
  });
  assert.deepEqual(roundTripped, linearRgba, 'Tegra X1 GOB swizzle/deswizzle must be lossless');

  const bntxBytes = buildSyntheticBntx({
    name: 'ring_hoop',
    width: w,
    height: h,
    format: 0x0b01, // R8G8B8A8_UNORM
    swizzledBytes: swizzled,
  });
  const parsedBntx = parseBntxContainer(bntxBytes, 'ring_hoop.bntx', { generatePngDataUrl: true });
  assert.equal(parsedBntx.textures.length, 1);
  assert.equal(parsedBntx.textures[0].name, 'ring_hoop');
  assert.equal(parsedBntx.textures[0].decoded, true);
  assert.ok(parsedBntx.textures[0].rgba);
  assert.deepEqual(new Uint8Array(parsedBntx.textures[0].rgba!), linearRgba);

  const pngBytes = encodeRgbaToPngBytes(parsedBntx.textures[0].rgba!, w, h);
  const pngDims = sniffImageDimensions(pngBytes);
  assert.deepEqual(pngDims, { width: 8, height: 8 }, 'Encoded BNTX PNG must have valid PNG header & dimensions');

  // Honest unsupported reporting for BC7 & dimension-bomb rejection
  const bc7Bntx = buildSyntheticBntx({
    name: 'ring_bc7',
    width: 8,
    height: 8,
    format: 0x2001, // BC7_UNORM
    swizzledBytes: new Uint8Array(512),
  });
  const parsedBc7 = parseBntxContainer(bc7Bntx, 'ring_bc7.bntx');
  assert.equal(parsedBc7.textures[0].decoded, false);
  assert.match(parsedBc7.textures[0].unsupportedReason ?? '', /BC7|not yet|unsupported/i);

  const bombBntx = buildSyntheticBntx({
    name: 'bomb_tex',
    width: 8192,
    height: 8192,
    format: 0x0b01,
    swizzledBytes: new Uint8Array(64),
  });
  assert.throws(
    () => parseBntxContainer(bombBntx, 'bomb_tex.bntx'),
    /limit|4096|dimension|bounds/i,
    'Oversized BNTX texture dimensions must be rejected'
  );

  // 2) BFLYT + BFLAN parsing & Hermite curve evaluation
  const bflytBytes = buildSyntheticBflyt();
  const parsedBflyt = parseBflytContainer(bflytBytes, 'ring_stage.bflyt');
  assert.equal(parsedBflyt.width, 1280);
  assert.equal(parsedBflyt.height, 720);
  assert.deepEqual(parsedBflyt.textures, ['ring_hoop']);
  assert.ok(parsedBflyt.panes.some((p) => p.name === 'HoopPic' && p.parentName === 'RootPane'));

  const bflanBytes = buildSyntheticBflan();
  const parsedBflan = parseBflanContainer(bflanBytes, 'ring_anim.bflan');
  assert.equal(parsedBflan.frameSize, 60);
  assert.equal(parsedBflan.loop, true);
  assert.equal(parsedBflan.entries.length, 1);
  const eval0 = evaluateBflanAtFrame(parsedBflan, 0);
  const eval30 = evaluateBflanAtFrame(parsedBflan, 30);
  assert.ok(Math.abs((eval0.get('HoopPic')?.ty ?? -1) - 0) < 1e-4);
  assert.ok(
    Math.abs((eval30.get('HoopPic')?.ty ?? -1) - 60) < 1e-3,
    'Hermite midpoint at frame 30 should evaluate to 60'
  );

  // 3) BFRES parsing
  const bfresBytes = buildSyntheticBfres();
  const parsedBfres = parseBfresContainer(bfresBytes, 'ring_trundlorb.bfres');
  assert.equal(parsedBfres.name, 'ring_trundlorb');
  assert.equal(parsedBfres.models.length, 1);
  assert.equal(parsedBfres.models[0].name, 'TrundlorbModel');

  // 4) importSwitchContainerAsset integration
  const importedBntx = importSwitchContainerAsset(
    'ring_hoop.bntx',
    'RING/ring_hoop.bntx',
    bntxBytes
  );
  assert.equal(importedBntx.length, 1);
  assert.equal(importedBntx[0].kind, 'sprite');
  assert.equal(importedBntx[0].width, 8);
  assert.equal(importedBntx[0].height, 8);

  const importedBflyt = importSwitchContainerAsset(
    'ring_stage.bflyt',
    'RING/ring_stage.bflyt',
    bflytBytes
  );
  assert.equal(importedBflyt[0].kind, 'native_layout');
  assert.ok(importedBflyt[0].bflytData);

  // 5) RING Hoop Trundling scene state + rendering + compositor + 24-minigame registry
  assert.equal(getRegisteredSceneCount(), 24, 'All 24 Groove Engine minigames must be registered');
  assert.equal(Object.keys(SCENE_PROFILES).length, 24);

  const ringTimeline = compileGtf(
    [
      'title "Hoop Trundling Test"',
      'bgm 135',
      'first RING',
      'rest 4',
      'hoop 5',
    ].join('\n'),
    'ring.gtf'
  );
  // At beat 7.0 (H + 3.0), player 'po' jumps; mask=5 => 0b0101 (bits 0 & 2 jump, bits 1 & 3 are bubbled)
  const ringState = computeRingSceneState({
    timeline: ringTimeline,
    currentTick: 7 * TPB,
    activeAnim: null,
  });
  assert.equal(ringState.actors.length, 5);
  assert.equal(ringState.bubbledNpcCount, 2, 'ring_mask=5 must bubble 2 NPCs (pi & pe)');
  assert.ok(ringState.jumpingActorIds.includes('po'), 'Player Trundlorb po must be mid-jump at H+3.0');
  assert.ok(ringState.cameraZoom > 1.0, 'Camera should zoom in slightly on player po jump');

  // HT3 crimson sky tint check
  const ht3Timeline = compileGtf(
    [
      'title "Hoop Trundling 3"',
      'bgm 135',
      'first RING',
      'rest 4',
      'hoop 15',
    ].join('\n'),
    'ring3.gtf'
  );
  const ht3State = computeRingSceneState({
    timeline: ht3Timeline,
    currentTick: 5 * TPB,
    activeAnim: null,
  });
  assert.equal(ht3State.ht3CrimsonTint, true);

  const { ctx, ops } = createMockCanvasCtx();
  renderRingScene(ctx, 640, 360, {
    timeline: ringTimeline,
    currentTick: 7 * TPB,
    bpm: 135,
    activeCue: ringTimeline.events[0] ?? null,
    cueAgeBeats: 3.0,
    activeAnim: null,
  });
  assert.ok(ops.length > 20, 'RING Hoop Trundling renderer must issue drawing operations');

  // BFLYT + BFLAN compositor smoke check
  const { ctx: compCtx, ops: compOps } = createMockCanvasCtx();
  const compRes = renderBflytLayoutWithBflan(compCtx, 640, 360, {
    layout: parsedBflyt,
    activeAnim: null,
    currentTick: 0,
    bpm: 135,
  });
  assert.ok(compOps.length > 0 && compRes.panesRendered >= 1, 'BFLYT+BFLAN compositor should render panes cleanly');

  // BFRES software 3D projector smoke check
  const { ctx: meshCtx } = createMockCanvasCtx();
  const meshRes = renderBfresModel(meshCtx, 640, 360, {
    model: parsedBfres,
    yawRad: 0.4,
    pitchRad: 0.2,
    scale: 1.0,
    accentColor: '#38BDF8',
  });
  assert.ok(meshRes.trianglesRendered >= 0);

  // 6) Google Drive read-only scope, query escaping, ID validation & Drive v3 API flow
  const {
    SCOPES,
    escapeDriveQueryLiteral,
    assertValidDriveId,
    DEFAULT_DRIVE_FOLDER_NAME,
    findDriveFolderByName,
    listDriveFolderChildren,
    downloadDriveFileBytes,
  } = await import('../src/engine/driveConnector.ts');
  assert.deepEqual([...SCOPES], ['https://www.googleapis.com/auth/drive.readonly']);
  assert.equal(DEFAULT_DRIVE_FOLDER_NAME, 'RhythmGrooveDecompiled');
  assert.equal(escapeDriveQueryLiteral("Ring's\\Folder"), "Ring\\'s\\\\Folder");
  assert.equal(assertValidDriveId('1aBcDeFg_12345-xyz'), '1aBcDeFg_12345-xyz');
  assert.throws(() => assertValidDriveId("../etc/passwd' or '1'='1"));

  const origFetch = globalThis.fetch;
  try {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requestedUrls.push(url);
      const authHeader = (init?.headers as Record<string, string> | undefined)?.Authorization;
      assert.equal(authHeader, 'Bearer test_drive_token_readonly');
      if (url.includes('alt=media')) {
        return new Response(bntxBytes.slice().buffer, { status: 200 });
      }
      if (url.includes('in+parents') || url.includes('in%20parents')) {
        return new Response(
          JSON.stringify({
            files: [
              {
                id: 'file_ring_bntx_01',
                name: 'ring_hoop.bntx',
                mimeType: 'application/octet-stream',
                size: String(bntxBytes.byteLength),
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          files: [
            {
              id: 'folder_rgd_root_01',
              name: 'RhythmGrooveDecompiled',
              mimeType: 'application/vnd.google-apps.folder',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;

    const folder = await findDriveFolderByName('RhythmGrooveDecompiled', 'test_drive_token_readonly');
    assert.ok(folder && folder.isFolder && folder.id === 'folder_rgd_root_01');
    const children = await listDriveFolderChildren(folder.id, 'test_drive_token_readonly');
    assert.equal(children.length, 1);
    assert.equal(children[0].name, 'ring_hoop.bntx');
    const dlBytes = await downloadDriveFileBytes(children[0], 'test_drive_token_readonly', 1024 * 1024);
    assert.equal(dlBytes.byteLength, bntxBytes.byteLength);
    assert.equal(requestedUrls.length, 3);
  } finally {
    globalThis.fetch = origFetch;
  }
});
