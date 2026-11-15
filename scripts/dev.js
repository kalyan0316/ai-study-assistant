// `npm run dev`: runs the API server (auto-restarts on change) and Vite together.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const procs = [
  spawn(process.execPath, ['--watch', 'server/index.js'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PORT: '8787' },
  }),
  spawn(process.execPath, [vite], { cwd: root, stdio: 'inherit' }),
];

const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) stop(); }));
