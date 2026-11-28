import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLE_GTF, SHOWCASE_24_GTF } from '../src/engine/cues.ts';
import {
  exportGroovePackage,
  generateProjectId,
  validateRuntimeGroovePackage,
} from '../src/engine/groovePackage.ts';
import { compileGtf } from '../src/engine/gtfEngine.ts';

export const PINNED_GE155_COMMIT = 'd3c971f3862bb6c16cfccd4009bcfb25e37319b6';
const EXPECTED_VALID_COUNT = 3;
const EXPECTED_INVALID_COUNT = 113;
const DEFAULT_REPO_URL = 'https://github.com/angelcraft/Groove-Builder.git';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

function parseCliArgs(argv) {
  let ge155Dir = process.env.GE155_DIR || '';
  let pythonBin = process.env.PYTHON_BIN || process.env.PYTHON || '';
  let allowUncheckedDirSha = false;
  for (const arg of argv) {
    if (arg.startsWith('--ge155-dir=')) {
      ge155Dir = arg.slice('--ge155-dir='.length);
    } else if (arg.startsWith('--python=')) {
      pythonBin = arg.slice('--python='.length);
    } else if (arg === '--allow-dirty-ge155-dir') {
      allowUncheckedDirSha = true;
    }
  }
  return {
    ge155Dir: ge155Dir ? path.resolve(ge155Dir) : '',
    pythonBin,
    allowUncheckedDirSha,
  };
}

function resolvePythonRunner(configuredBin) {
  const candidates = [];
  if (configuredBin) {
    // Support simple "py -3" or full executable paths with spaces
    const trimmed = configuredBin.trim();
    if (trimmed === 'py -3') {
      candidates.push({ cmd: 'py', prefixArgs: ['-3'] });
    } else {
      candidates.push({ cmd: trimmed, prefixArgs: [] });
    }
  } else {
    if (process.platform === 'win32') {
      candidates.push({ cmd: 'py', prefixArgs: ['-3'] });
      candidates.push({ cmd: 'python', prefixArgs: [] });
      candidates.push({ cmd: 'python3', prefixArgs: [] });
    } else {
      candidates.push({ cmd: 'python3', prefixArgs: [] });
      candidates.push({ cmd: 'python', prefixArgs: [] });
    }
  }

  for (const cand of candidates) {
    try {
      const out = execFileSync(cand.cmd, [...cand.prefixArgs, '--version'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (/^Python 3\./i.test(out)) {
        return { ...cand, version: out };
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    configuredBin
      ? `Configured Python executable '${configuredBin}' is not a working Python 3 interpreter.`
      : 'No working Python 3 interpreter found (tried python3, python, py -3). Set PYTHON or --python=<path>.'
  );
}

function resolveGe155Checkout(explicitDir, allowUncheckedDirSha) {
  if (explicitDir) {
    const gitDir = path.join(explicitDir, '.git');
    if (fs.existsSync(gitDir) && !allowUncheckedDirSha) {
      const headSha = execFileSync('git', ['-C', explicitDir, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      assert.equal(
        headSha,
        PINNED_GE155_COMMIT,
        `GE155_DIR git HEAD (${headSha}) does not match pinned commit ${PINNED_GE155_COMMIT}`
      );
    }
    return { dir: explicitDir, headSha: fs.existsSync(gitDir) ? PINNED_GE155_COMMIT : null, cleanup: () => {} };
  }

  const tmpClone = fs.mkdtempSync(path.join(os.tmpdir(), 'ge155-corpus-'));
  try {
    const repo = process.env.GE155_REPO || DEFAULT_REPO_URL;
    console.log(`Fetching pinned GE-155 commit ${PINNED_GE155_COMMIT} from ${repo}...`);
    execFileSync('git', ['init', '-q'], { cwd: tmpClone, stdio: 'pipe' });
    execFileSync('git', ['remote', 'add', 'origin', repo], { cwd: tmpClone, stdio: 'pipe' });
    execFileSync('git', ['fetch', '--depth', '1', 'origin', PINNED_GE155_COMMIT], {
      cwd: tmpClone,
      stdio: 'pipe',
    });
    execFileSync('git', ['checkout', '-q', 'FETCH_HEAD'], { cwd: tmpClone, stdio: 'pipe' });
    const checkedSha = execFileSync('git', ['-C', tmpClone, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    assert.equal(checkedSha, PINNED_GE155_COMMIT, 'Fetched GE-155 checkout SHA mismatch');
    return {
      dir: tmpClone,
      headSha: checkedSha,
      cleanup: () => fs.rmSync(tmpClone, { recursive: true, force: true }),
    };
  } catch (err) {
    fs.rmSync(tmpClone, { recursive: true, force: true });
    throw err;
  }
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Invokes GE-155 Python validator strictly distinguishing expected PackageError
 * rejections from Python process/import/syntax/IO infrastructure failures.
 */
function runPythonValidator(pythonRunner, toolsDir, packagePath) {
  const pyCode = [
    'import sys, json',
    'sys.path.insert(0, sys.argv[1])',
    'from groove_package.validator import validate_package',
    'from groove_package.errors import PackageError',
    'with open(sys.argv[2], "rb") as f:',
    '    data = f.read()',
    'try:',
    '    res = validate_package(data)',
    '    print(json.dumps({"status": "valid", "summary": res.summary()}))',
    'except PackageError as exc:',
    '    print(json.dumps({"status": "package_error", "code": exc.code, "message": str(exc)}))',
  ].join('\n');

  let stdout;
  try {
    stdout = execFileSync(
      pythonRunner.cmd,
      [...pythonRunner.prefixArgs, '-c', pyCode, toolsDir, packagePath],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (err) {
    const stderr = err?.stderr ? String(err.stderr).trim() : String(err);
    throw new Error(`Python validator infrastructure/process failure on ${packagePath}: ${stderr}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (err) {
    throw new Error(`Invalid JSON output from Python validator on ${packagePath}: ${stdout}`);
  }
  if (parsed.status !== 'valid' && parsed.status !== 'package_error') {
    throw new Error(`Unexpected Python validator status on ${packagePath}: ${stdout}`);
  }
  return parsed;
}

async function main() {
  const { ge155Dir, pythonBin, allowUncheckedDirSha } = parseCliArgs(process.argv.slice(2));
  const pythonRunner = resolvePythonRunner(pythonBin);
  const checkout = resolveGe155Checkout(ge155Dir, allowUncheckedDirSha);
  const tmpExportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ge155-exports-'));

  try {
    const toolsDir = path.join(checkout.dir, 'tools');
    const fixturesDir = path.join(checkout.dir, 'tests', 'package', 'fixtures');
    const corpusJsonPath = path.join(fixturesDir, 'corpus.json');
    const validDir = path.join(fixturesDir, 'valid');
    const invalidDir = path.join(fixturesDir, 'invalid');

    for (const requiredPath of [
      path.join(toolsDir, 'groove_package', 'validator.py'),
      path.join(toolsDir, 'groove_package', 'errors.py'),
      corpusJsonPath,
      validDir,
      invalidDir,
    ]) {
      assert.ok(fs.existsSync(requiredPath), `Missing GE-155 asset: ${requiredPath}`);
    }

    const corpus = JSON.parse(fs.readFileSync(corpusJsonPath, 'utf8'));
    const corpusValidEntries = Object.entries(corpus.valid || {});
    const corpusInvalidEntries = Object.entries(corpus.invalid || {});
    assert.equal(
      corpusValidEntries.length,
      EXPECTED_VALID_COUNT,
      `corpus.json must declare ${EXPECTED_VALID_COUNT} valid fixtures`
    );
    assert.equal(
      corpusInvalidEntries.length,
      EXPECTED_INVALID_COUNT,
      `corpus.json must declare ${EXPECTED_INVALID_COUNT} invalid fixtures`
    );

    const validFiles = fs.readdirSync(validDir).filter((f) => f.endsWith('.groove')).sort();
    const invalidFiles = fs.readdirSync(invalidDir).filter((f) => f.endsWith('.groove')).sort();
    assert.equal(
      validFiles.length,
      EXPECTED_VALID_COUNT,
      `Expected exact count ${EXPECTED_VALID_COUNT} positive fixtures, got ${validFiles.length}`
    );
    assert.equal(
      invalidFiles.length,
      EXPECTED_INVALID_COUNT,
      `Expected exact count ${EXPECTED_INVALID_COUNT} negative fixtures, got ${invalidFiles.length}`
    );
    assert.deepEqual(
      validFiles,
      corpusValidEntries.map(([k]) => k).sort(),
      'valid/ directory does not match corpus.json'
    );
    assert.deepEqual(
      invalidFiles,
      corpusInvalidEntries.map(([k]) => k).sort(),
      'invalid/ directory does not match corpus.json'
    );

    // Verify exact SHA-256 of every valid/invalid fixture from corpus.json and run both validators
    const tsValidFailures = [];
    const pyValidFailures = [];
    for (const f of validFiles) {
      const fullPath = path.join(validDir, f);
      const buf = fs.readFileSync(fullPath);
      assert.equal(
        sha256Hex(buf),
        corpus.valid[f],
        `Valid fixture SHA-256 mismatch vs corpus.json: ${f}`
      );
      try {
        await validateRuntimeGroovePackage(new Uint8Array(buf));
      } catch (err) {
        tsValidFailures.push({ file: f, err: err instanceof Error ? err.message : String(err) });
      }
      const pyRes = runPythonValidator(pythonRunner, toolsDir, fullPath);
      if (pyRes.status !== 'valid') {
        pyValidFailures.push({ file: f, code: pyRes.code, err: pyRes.message });
      }
    }

    const tsInvalidPasses = [];
    const pyInvalidMismatches = [];
    for (const f of invalidFiles) {
      const fullPath = path.join(invalidDir, f);
      const buf = fs.readFileSync(fullPath);
      const expected = corpus.invalid[f];
      assert.equal(
        sha256Hex(buf),
        expected.sha256,
        `Invalid fixture SHA-256 mismatch vs corpus.json: ${f}`
      );
      try {
        await validateRuntimeGroovePackage(new Uint8Array(buf));
        tsInvalidPasses.push(f);
      } catch {
        // Expected rejection
      }
      const pyRes = runPythonValidator(pythonRunner, toolsDir, fullPath);
      if (pyRes.status !== 'package_error' || pyRes.code !== expected.expect) {
        pyInvalidMismatches.push({
          file: f,
          expectedCode: expected.expect,
          gotStatus: pyRes.status,
          gotCode: pyRes.code,
          message: pyRes.message,
        });
      }
    }

    console.log(
      `GE-155 corpus (${checkout.dir}${checkout.headSha ? ` @ ${checkout.headSha.slice(0, 12)}` : ''}) via ${pythonRunner.version}:`
    );
    console.log(
      `  TS validateRuntimeGroovePackage: ${validFiles.length - tsValidFailures.length}/${EXPECTED_VALID_COUNT} valid passed, ${invalidFiles.length - tsInvalidPasses.length}/${EXPECTED_INVALID_COUNT} invalid rejected`
    );
    console.log(
      `  Python groove_package.validator: ${validFiles.length - pyValidFailures.length}/${EXPECTED_VALID_COUNT} valid passed, ${invalidFiles.length - pyInvalidMismatches.length}/${EXPECTED_INVALID_COUNT} invalid rejected with exact PackageError.code`
    );

    if (
      tsValidFailures.length ||
      pyValidFailures.length ||
      tsInvalidPasses.length ||
      pyInvalidMismatches.length
    ) {
      console.error('Corpus mismatch details:', {
        tsValidFailures,
        pyValidFailures,
        tsInvalidPasses,
        pyInvalidMismatches,
      });
      process.exitCode = 1;
      return;
    }

    // Export Groove Builder runtime & editor .groove packages and validate against BOTH validators
    const pid = generateProjectId();
    const exTl = compileGtf(EXAMPLE_GTF, 'ejemplo.gtf');
    const scTl = compileGtf(SHOWCASE_24_GTF, 'showcase_24.gtf');
    const exportsToCheck = [
      { name: 'example_rt_gtf', tl: exTl, profile: 'runtime', fmt: 'gtf', expectValid: true },
      { name: 'example_rt_gtl', tl: exTl, profile: 'runtime', fmt: 'gtl', expectValid: true },
      { name: 'showcase_rt_gtf', tl: scTl, profile: 'runtime', fmt: 'gtf', expectValid: true },
      { name: 'showcase_rt_gtl', tl: scTl, profile: 'runtime', fmt: 'gtl', expectValid: true },
      {
        name: 'example_editor',
        tl: exTl,
        profile: 'editor',
        fmt: 'gtf',
        expectValid: false,
        expectPyCode: 'NOT_RUNTIME_PROFILE',
      },
    ];

    let exportMismatch = false;
    console.log(`Groove Builder exporter vs GE-155 validator (${WORKSPACE_ROOT}):`);
    for (const item of exportsToCheck) {
      const out = await exportGroovePackage({
        profile: item.profile,
        runtimeFormat: item.fmt,
        packageId: pid,
        packageVersion: '1.0.0',
        timeline: item.tl,
        bpm: 139,
        musicOffsetSec: 0,
        musicFile: null,
        prologueImage: null,
        sprites: {},
      });
      const outBytes = new Uint8Array(await out.blob.arrayBuffer());
      const outPath = path.join(tmpExportDir, `${item.name}.groove`);
      fs.writeFileSync(outPath, outBytes);

      let tsOk = false;
      let tsErr = '';
      try {
        await validateRuntimeGroovePackage(outBytes);
        tsOk = true;
      } catch (err) {
        tsErr = err instanceof Error ? err.message : String(err);
      }
      const pyRes = runPythonValidator(pythonRunner, toolsDir, outPath);
      const pyOk = pyRes.status === 'valid';

      console.log(
        `  ${item.name}: TS=${tsOk ? 'VALID' : 'REJECTED'} PY=${pyOk ? 'VALID' : `REJECTED[${pyRes.code}]`} (expected=${item.expectValid ? 'VALID' : 'REJECTED'})`,
        pyOk ? `${pyRes.summary.timeline} games=${pyRes.summary.games.length}` : pyRes.message || tsErr
      );
      if (tsOk !== item.expectValid || pyOk !== item.expectValid) {
        exportMismatch = true;
      }
      if (item.expectPyCode && pyRes.code !== item.expectPyCode) {
        exportMismatch = true;
      }
    }

    if (exportMismatch) {
      process.exitCode = 1;
    }
  } finally {
    fs.rmSync(tmpExportDir, { recursive: true, force: true });
    checkout.cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
