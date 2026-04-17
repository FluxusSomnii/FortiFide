/**
 * Dev-mode launcher for the Python diarization sidecar.
 *
 * The only question that matters is: does *this* Python have pyannote.audio?
 * Version numbers are a proxy we can't trust — pyannote may be pinned to
 * older versions on some installs and bleeding-edge on others. We probe
 * candidates in preference order, try to import pyannote on each, and
 * use the first one that succeeds. Exit cleanly if none do.
 *
 * Production does not use this file — `lib.rs` is responsible for the Node
 * sidecar, and the Python sidecar is currently a manual setup step in v0.1.0
 * (see docs/setup.md).
 */
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const scriptPath = path.join(__dirname, 'diarize_server.py');

// Candidates in preference order. `py -3.11` is the Windows launcher asking
// for 3.11 specifically; direct binary names are next; generic `python` /
// `python3` last. Whichever candidate imports pyannote wins.
const CANDIDATES = [
  { cmd: 'py', args: ['-3.11'] },
  { cmd: 'python3.11', args: [] },
  { cmd: 'python', args: [] },
  { cmd: 'python3', args: [] },
];

/**
 * Ask a candidate its version banner. Returns "3.14.2" etc. on success, or
 * null if the invocation fails. Used only for logging — the version number
 * does not gate anything.
 */
function probeVersion({ cmd, args }) {
  let result;
  try {
    result = spawnSync(cmd, [...args, '--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
  } catch {
    return null;
  }
  if (result.error || result.status !== 0) return null;
  const text = `${result.stdout || ''}${result.stderr || ''}`;
  const m = text.match(/Python\s+(\d+\.\d+\.\d+|\d+\.\d+)/);
  return m ? m[1] : null;
}

/**
 * Try to `import pyannote.audio` in the given Python. Returns true only if
 * the interpreter runs the import-and-print successfully and prints "ok".
 * Any other outcome (interpreter missing, import error, timeout) returns false.
 */
function canImportPyannote({ cmd, args }) {
  let result;
  try {
    result = spawnSync(
      cmd,
      [...args, '-c', 'import pyannote.audio; print("ok")'],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 },
    );
  } catch {
    return false;
  }
  if (result.error || result.status !== 0) return false;
  // pyannote prints noisy deprecation warnings to stderr; what we care about
  // is whether the "ok" sentinel landed in stdout.
  return (result.stdout || '').includes('ok');
}

function findCompatible() {
  for (const cand of CANDIDATES) {
    const version = probeVersion(cand);
    if (!version) continue; // interpreter missing — skip silently
    if (canImportPyannote(cand)) {
      return { ...cand, version };
    }
  }
  return null;
}

const found = findCompatible();

if (!found) {
  console.log('[FORTIFIDE] pyannote.audio not found in any Python installation');
  console.log('[FORTIFIDE] Speakers and Deep modes will not be available');
  console.log('[FORTIFIDE] Install pyannote: pip install pyannote.audio');
  process.exit(0); // clean exit — do not crash the parent concurrently runner
}

console.log('[DIARIZE] Starting Python server...');
console.log(
  `[DIARIZE] Python: ${found.cmd}${found.args.length ? ' ' + found.args.join(' ') : ''} (${found.version})`,
);
console.log('[DIARIZE] Script:', scriptPath);

const proc = spawn(found.cmd, [...found.args, scriptPath], {
  stdio: 'inherit',
  cwd: __dirname,
  windowsHide: true,
});

proc.on('error', (err) => {
  console.error('[DIARIZE] Failed to start:', err.message);
  process.exit(1);
});

proc.on('exit', (code) => {
  console.log('[DIARIZE] Exited with code:', code);
  process.exit(code || 0);
});
