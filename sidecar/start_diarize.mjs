import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pythonPath = 'C:\\Python314\\python.exe';
const scriptPath = join(__dirname, 'diarize_server.py');

const proc = spawn(pythonPath, [scriptPath], {
  stdio: 'inherit',
  cwd: __dirname
});

proc.on('error', (err) => {
  console.error('[DIARIZE] Failed to start:', err.message);
});

proc.on('exit', (code) => {
  console.log('[DIARIZE] Exited with code:', code);
});
