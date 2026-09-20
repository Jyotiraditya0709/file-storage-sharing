import type { Readable } from 'node:stream';
import busboy from 'busboy';
import type { Request } from 'express';
import { PayloadTooLargeError, ValidationError } from './errors.js';

export interface UploadedFile {
  /** Raw client filename. Sanitise before storing or echoing it. */
  filename: string;
  stream: Readable;
  /** True once busboy has truncated the file at the configured limit. */
  limitReached: () => boolean;
  /** Drain the request so a rejected upload does not hang the connection. */
  discard: () => void;
}

/**
 * Turns a multipart request into exactly one file stream. Lives in lib/ so a
 * route can use it without importing storage/ or db/: the route hands the
 * stream to a service and never touches the bytes.
 *
 * Nothing is buffered — the promise resolves when the file part *starts*.
 */
export function readSingleFile(req: Request, maxBytes: number): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    if (!req.is('multipart/form-data')) {
      reject(new ValidationError('Expected a multipart/form-data upload'));
      return;
    }

    const bb = busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: maxBytes,
        // Without these, a body of thousands of tiny non-file parts is parsed
        // without bound even though we only ever read one file field.
        fields: 10,
        fieldSize: 8 * 1024,
        parts: 12,
      },
    });

    let settled = false;
    let truncated = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      req.unpipe(bb);
      req.resume();
      reject(err);
    };

    bb.on('file', (fieldname, stream, info) => {
      if (fieldname !== 'file') {
        stream.resume();
        fail(new ValidationError('Expected a single file field named "file"'));
        return;
      }

      stream.on('limit', () => {
        truncated = true;
      });

      settled = true;
      resolve({
        filename: info.filename,
        stream,
        limitReached: () => truncated,
        discard: () => {
          stream.resume();
          req.unpipe(bb);
          req.resume();
        },
      });
    });

    // More than one file part, per SPEC §8 "one document per upload".
    bb.on('filesLimit', () => fail(new PayloadTooLargeError('Only one file per upload')));
    bb.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
    bb.on('close', () => fail(new ValidationError('Expected a file field named "file"')));

    req.pipe(bb);
  });
}
