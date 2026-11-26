import 'reflect-metadata';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import sharp from 'sharp';
import { validateWorkerDocumentFile } from '../src/modules/workforce/documents/worker-document-file.js';

function syntheticPdf(pages: number) {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>'),
  ];
  let pdf = '%PDF-1.7\n';
  const entries = ['0000000000 65535 f \n'];
  for (const [index, object] of objects.entries()) {
    entries.push(`${String(pdf.length).padStart(10, '0')} 00000 n \n`);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${entries.length}\n${entries.join('')}trailer\n<< /Size ${entries.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

test('worker document images must match their declared type and decode', async () => {
  const image = await sharp({
    create: { width: 16, height: 12, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  assert.equal((await validateWorkerDocumentFile(image, 'image/png')).extension, 'png');
  await assert.rejects(validateWorkerDocumentFile(image, 'image/jpeg'));
  await assert.rejects(
    validateWorkerDocumentFile(Buffer.from([255, 216, 255, 1, 255, 217]), 'image/jpeg'),
    { status: 422 },
  );
});

const poppler = ['pdfinfo', 'pdftoppm'].every((tool) => spawnSync(tool, ['-v']).status === 0);
test('worker PDFs decode locally and limit the number of pages', { skip: !poppler }, async () => {
  assert.equal(
    (await validateWorkerDocumentFile(syntheticPdf(4), 'application/pdf')).extension,
    'pdf',
  );
  await assert.rejects(validateWorkerDocumentFile(syntheticPdf(5), 'application/pdf'), {
    status: 422,
  });
  await assert.rejects(
    validateWorkerDocumentFile(Buffer.from('%PDF-1.7\nUnusable PDF\n%%EOF'), 'application/pdf'),
    { status: 422 },
  );
});
