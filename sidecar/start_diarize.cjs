const { spawn } = require('child_process');
const path = require('path');

const pythonPath = 'C:\\Python314\\python.exe';
const scriptPath = path.join(__dirname, 'diarize_server.py');

console.log('[DIARIZE] Starting Python server...');
console.log('[DIARIZE] Python:', pythonPath);
console.log('[DIARIZE] Script:', scriptPath);

const proc = spawn(pythonPath, [scriptPath], {
  stdio: 'inherit',
  cwd: __dirname,
});

proc.on('error', (err) => {
  console.error('[DIARIZE] Failed to start:', err.message);
  process.exit(1);
});

proc.on('exit', (code) => {
  console.log('[DIARIZE] Exited with code:', code);
  process.exit(code || 0);
});
