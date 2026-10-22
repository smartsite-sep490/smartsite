import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../../config/environment.js';
import { backendDirectory } from '../../../config/runtime-environment.js';

/** A single bounded CPU lane per Backend, with originals confined to a private temporary directory. */
@Injectable()
export class LocalDocumentOcr {
  private busy = false;
  private readonly logger = new Logger(LocalDocumentOcr.name);
  constructor(private readonly config: ConfigService<BackendEnvironment, true>) {}

  async run(
    bytes: Buffer,
    mediaType: string,
    operation: 'ocr' | 'image-quality',
  ): Promise<Record<string, unknown> | null> {
    const configured = this.config.get('WORKER_DOCUMENT_PYTHON', { infer: true });
    if (!configured || this.busy || !bytes.length || bytes.length > 5 * 1024 * 1024) return null;
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(mediaType)) return null;
    this.busy = true;
    let folder: string | undefined;
    try {
      folder = await mkdtemp(path.join(tmpdir(), 'smartsite-document-'));
      const executable = (value: string | undefined) =>
        !value
          ? ''
          : value.includes('/') || value.includes('\\')
            ? path.resolve(backendDirectory, value)
            : value;
      const python = executable(configured);
      const env: NodeJS.ProcessEnv = {
        OMP_THREAD_LIMIT: '1',
        TMPDIR: folder,
        TEMP: folder,
        TMP: folder,
      };
      // Decoder/OCR child processes do not need database URLs, API tokens or application secrets.
      for (const key of [
        'PATH',
        'SystemRoot',
        'WINDIR',
        'PATHEXT',
        'LANG',
        'LC_ALL',
        'TESSDATA_PREFIX',
      ])
        if (process.env[key] !== undefined) env[key] = process.env[key];
      const output = await new Promise<string>((resolve, reject) => {
        const child = execFile(
          python,
          [
            '-I',
            path.join(backendDirectory, 'ocr/worker_document_ocr.py'),
            operation,
            mediaType,
            executable(this.config.get('WORKER_DOCUMENT_TESSERACT', { infer: true })),
            executable(this.config.get('WORKER_DOCUMENT_PDFTOPPM', { infer: true })),
          ],
          {
            cwd: folder,
            env,
            windowsHide: true,
            timeout: 60_000,
            maxBuffer: 8192,
            encoding: 'utf8',
          },
          (error, stdout) =>
            error ? reject(new Error('Local document OCR unavailable')) : resolve(stdout),
        );
        // A missing engine may close stdin before the original has been written.
        child.stdin?.on('error', () => {});
        child.stdin?.end(bytes);
      });
      const result: unknown = JSON.parse(output);
      return result !== null && typeof result === 'object' && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : null;
    } catch {
      return null;
    } finally {
      try {
        if (folder) await rm(folder, { recursive: true, force: true });
      } catch {
        this.logger.error({ event: 'document_ocr_cleanup_failed' });
      } finally {
        this.busy = false;
      }
    }
  }
}
