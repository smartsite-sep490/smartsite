import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = fileURLToPath(new URL('../apps/backend/', import.meta.url));
const require = createRequire(path.join(backend, 'package.json'));
const { parse } = require('dotenv');
const envFile = path.join(backend, '.env');
const existing = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
const config = { ...parse(existing), ...process.env };
const python = path.join(
  backend,
  'ocr/.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--python')) {
  console.error('Usage: pnpm ocr:setup [--python <Python executable>]');
  process.exit(1);
}
const executable = (value) =>
  value.includes('/') || value.includes('\\') ? path.resolve(backend, value) : value;
const tesseract = executable(config.WORKER_DOCUMENT_TESSERACT || 'tesseract');
const pdftoppm = executable(config.WORKER_DOCUMENT_PDFTOPPM || 'pdftoppm');
try {
  if (!existsSync(python))
    execFileSync(
      args[1] || (process.platform === 'win32' ? 'python' : 'python3'),
      ['-m', 'venv', path.dirname(path.dirname(python))],
      { stdio: 'inherit', windowsHide: true },
    );
  execFileSync(
    python,
    [
      '-m',
      'pip',
      'install',
      '--require-hashes',
      '--only-binary=:all:',
      '--disable-pip-version-check',
      '-r',
      path.join(backend, 'ocr/requirements.txt'),
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  const languages = execFileSync(tesseract, ['--list-langs'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  });
  if (!/^vie\s*$/m.test(languages) || !/^eng\s*$/m.test(languages)) throw new Error('languages');
  execFileSync(pdftoppm, ['-v'], { stdio: 'ignore', windowsHide: true, timeout: 10_000 });
  const pdfinfo =
    path.dirname(pdftoppm) === '.'
      ? 'pdfinfo'
      : path.join(path.dirname(pdftoppm), process.platform === 'win32' ? 'pdfinfo.exe' : 'pdfinfo');
  execFileSync(pdfinfo, ['-v'], { stdio: 'ignore', windowsHide: true, timeout: 10_000 });
  let next = existing.replace(/^SMARTSITE_DOCUMENT_OCR_URL=.*\r?\n?/gm, '');
  for (const [key, value] of Object.entries({
    WORKER_DOCUMENT_PYTHON: python,
    WORKER_DOCUMENT_TESSERACT: tesseract,
    WORKER_DOCUMENT_PDFTOPPM: pdftoppm,
  })) {
    const line = `${key}=${JSON.stringify(value.replaceAll('\\', '/'))}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    next = pattern.test(next) ? next.replace(pattern, () => line) : `${next.trimEnd()}\n${line}\n`;
  }
  writeFileSync(envFile, next, { mode: 0o600 });
  console.log(
    'Backend OCR is ready. Start pnpm dev:api or pnpm dev; no separate OCR service is needed.',
  );
} catch {
  console.error(
    'OCR setup failed. Install Python, Tesseract (vie + eng) and Poppler (pdftoppm + pdfinfo), or set their WORKER_DOCUMENT_* paths. See contracts/worker-documents.md.',
  );
  process.exitCode = 1;
}
