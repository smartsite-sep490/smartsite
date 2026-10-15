import type { Readable } from 'node:stream';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { MAX_CHECKLIST_TOTAL } from './safety-upload.service.js';
type FileStream = { stream: Readable };
type StoredFile = { buffer?: Buffer; size?: number };
type Callback = (error: Error | null, info?: StoredFile) => void;
/** Share the byte budget across files before Multer buffers a whole report. */
export function checklistMultipartStorage() {
  const totals = new WeakMap<object, number>();
  return {
    _handleFile(request: object, file: FileStream, callback: Callback) {
      const chunks: Buffer[] = [];
      let complete = false,
        size = 0;
      const finish = (error: Error | null, info?: StoredFile) => {
        if (complete) return;
        complete = true;
        callback(error, info);
      };
      file.stream.on('data', (value: Buffer) => {
        if (complete) return;
        size += value.length;
        const total = (totals.get(request) ?? 0) + value.length;
        totals.set(request, total);
        if (total > MAX_CHECKLIST_TOTAL) {
          chunks.length = 0;
          finish(
            new PublicHttpException(413, {
              code: 'PAYLOAD_TOO_LARGE',
              message: 'Checklist files must total at most 20 MiB',
            }),
          );
          return;
        }
        chunks.push(value);
      });
      file.stream.once('error', (error: Error) => finish(error));
      file.stream.once('end', () => finish(null, { buffer: Buffer.concat(chunks), size }));
    },
    _removeFile(_request: object, file: StoredFile, callback: (error: Error | null) => void) {
      delete file.buffer;
      callback(null);
    },
  };
}
