import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../apps/backend/ocr/', import.meta.url));
const python = path.join(
  directory,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
const result = spawnSync(
  python,
  ['-m', 'unittest', 'discover', '-s', directory, '-p', 'test_*.py'],
  { stdio: 'inherit', cwd: directory, windowsHide: true },
);
if (result.error) console.error('Run pnpm ocr:setup first to install the Backend OCR environment.');
process.exitCode = result.status ?? 1;
