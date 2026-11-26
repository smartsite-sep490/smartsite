import { execFile } from 'node:child_process';
import sharp from 'sharp';
import type { WorkerDocumentResponse } from '@smartsite/contracts';
import { invalid } from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';

export interface DocumentUpload {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname?: string;
}

export function validateWorkerDocument(file: DocumentUpload | undefined) {
  if (
    !file ||
    !Buffer.isBuffer(file.buffer) ||
    file.size !== file.buffer.length ||
    file.size < 1 ||
    file.size > 5 * 1024 * 1024
  )
    invalid('Choose a document up to 5 MiB');
  const b = file.buffer;
  const jpeg =
    file.mimetype === 'image/jpeg' &&
    b.length >= 5 &&
    b[0] === 255 &&
    b[1] === 216 &&
    b[2] === 255 &&
    b.at(-2) === 255 &&
    b.at(-1) === 217;
  const png =
    file.mimetype === 'image/png' &&
    b.length >= 33 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'));
  const pdf =
    file.mimetype === 'application/pdf' &&
    /^%PDF-(?:1\.[0-9]|2\.0)/.test(b.subarray(0, 8).toString('ascii')) &&
    /%%EOF\s*$/.test(b.subarray(-1024).toString('ascii'));
  if (!jpeg && !png && !pdf) invalid('Choose a JPEG, PNG or PDF with a matching signature');
  return {
    extension: jpeg ? 'jpg' : png ? 'png' : 'pdf',
    mediaType: file.mimetype as WorkerDocumentResponse['mediaType'],
  };
}

export function documentOriginalName(file: DocumentUpload, fallback: string) {
  return (file.originalname ?? fallback).replace(/[\p{Cc}\p{Cs}\\/]/gu, '_').slice(0, 255);
}

function invalidPdf(): never {
  throw new PublicHttpException(422, {
    code: 'VALIDATION_FAILED',
    message: 'Choose a readable PDF with at most four pages',
  });
}

function validatorUnavailable(): never {
  throw new PublicHttpException(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Document file validation is unavailable. Retry before submitting.',
  });
}

function runPoppler(program: 'pdfinfo' | 'pdftoppm', args: string[], bytes: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    const env = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      LC_ALL: 'C',
    };
    const child = execFile(
      program,
      args,
      { env, windowsHide: true, timeout: 10000, maxBuffer: 512 * 1024, encoding: 'buffer' },
      (error, stdout, stderr) => {
        if (error?.code === 'ENOENT' || error?.code === 'EACCES') {
          reject(
            new PublicHttpException(503, {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Document file validation is unavailable. Retry before submitting.',
            }),
          );
        } else if (error || /Syntax Error/i.test(stderr.toString('utf8'))) {
          reject(
            new PublicHttpException(422, {
              code: 'VALIDATION_FAILED',
              message: 'Choose a readable PDF with at most four pages',
            }),
          );
        } else resolve(stdout);
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(bytes);
  });
}

let pdfValidations = 0;

export async function validateWorkerDocumentFile(bytes: Buffer, mediaType: string) {
  const format = validateWorkerDocument({ buffer: bytes, size: bytes.length, mimetype: mediaType });
  if (format.mediaType !== 'application/pdf') {
    try {
      await sharp(bytes, { limitInputPixels: 20_000_000 }).stats();
    } catch {
      throw new PublicHttpException(422, {
        code: 'VALIDATION_FAILED',
        message: 'Choose a readable image up to 20 megapixels',
      });
    }
    return format;
  }
  if (pdfValidations >= 4) validatorUnavailable();
  pdfValidations += 1;
  try {
    const info = await runPoppler('pdfinfo', ['-'], bytes);
    const pages = Number(/^Pages:\s+([0-9]+)\s*$/m.exec(info.toString('utf8'))?.[1]);
    if (!Number.isInteger(pages) || pages < 1 || pages > 4) invalidPdf();
    const preview = await runPoppler(
      'pdftoppm',
      ['-f', '1', '-l', String(pages), '-scale-to', '256', '-gray', '-'],
      bytes,
    );
    if (!preview.length) invalidPdf();
    return format;
  } finally {
    pdfValidations -= 1;
  }
}
