import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { beforeAll, describe, expect, it } from 'vitest';
import { encodeCursor } from '../src/lib/cursor.js';
import { PAGE_SIZE } from '../src/services/document.service.js';
import { storage } from '../src/storage/index.js';
import {
  SAME_ORIGIN,
  createWorkspace,
  signUp,
  uploadDocument,
  type TestUser,
  type UploadedDoc,
} from './helpers.js';

/** A real 1x1 PNG. The first bytes are what sniffMime() actually reads. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Lists the real bucket, so "no object left behind" is checked against the
 *  object store rather than against the application's opinion of it. */
async function keysUnder(prefix: string): Promise<string[]> {
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT!,
    region: process.env.S3_REGION!,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  });
  try {
    const out = await s3.send(
      new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET!, Prefix: prefix }),
    );
    return (out.Contents ?? []).flatMap((o) => (o.Key ? [o.Key] : [])).sort();
  } finally {
    s3.destroy();
  }
}

/** ARCHITECTURE #6. */
describe('oversize upload leaves no row and no object behind (ARCHITECTURE #6)', () => {
  it('returns 413 and the workspace holds only the document that fit', async () => {
    const user = await signUp('Uploader');
    const wid = await createWorkspace(user, 'Limits');

    // globalSetup sets MAX_UPLOAD_BYTES to 1 MiB.
    const good = await uploadDocument(user, wid, 'small enough', 'small.txt');
    const goodKey = `ws/${wid}/doc/${good.id}`;
    expect(await storage.exists(goodKey)).toBe(true);

    const oversize = await user.agent
      .post(`/api/workspaces/${wid}/documents`)
      .set(SAME_ORIGIN)
      .attach('file', Buffer.alloc(2 * 1024 * 1024, 0x61), { filename: 'huge.bin' });

    expect(oversize.status).toBe(413);
    expect(oversize.body.error.code).toBe('PAYLOAD_TOO_LARGE');

    // No row.
    const list = await user.agent.get(`/api/workspaces/${wid}/documents`);
    expect(list.body.documents.map((d: UploadedDoc) => d.name)).toEqual(['small.txt']);

    // No object: the only key under this workspace's prefix is the good one,
    // and every other key that the bucket might hold for it does not exist.
    const keys = await keysUnder(`ws/${wid}/`);
    expect(keys).toEqual([goodKey]);
    // And the one key that is there really is readable, so an empty listing
    // cannot pass this test by the bucket being unreachable.
    expect(await storage.exists(goodKey)).toBe(true);

    // Trash is not a hiding place for it either.
    const trash = await user.agent.get(`/api/workspaces/${wid}/trash`);
    expect(trash.body.documents).toEqual([]);
  });
});

describe('the stored MIME type comes from the bytes, never from the client (SPEC §3)', () => {
  let user: TestUser;
  let wid: string;

  beforeAll(async () => {
    user = await signUp('Uploader');
    wid = await createWorkspace(user, 'Sniffing');
  });

  it("ignores a lying Content-Type: PNG bytes sent as text/plain are stored as image/png", async () => {
    const doc = await uploadDocument(user, wid, PNG, 'photo.png', 'text/plain');
    expect(doc.mimeType).toBe('image/png');

    // The same in reverse: text bytes claiming to be a PNG stay text/plain.
    const liar = await uploadDocument(user, wid, 'just words', 'notes.txt', 'image/png');
    expect(liar.mimeType).toBe('text/plain');

    const download = await user.agent.get(`/api/workspaces/${wid}/documents/${doc.id}/download`);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('image/png');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
  });

  it('stores an uploaded .html file as application/octet-stream, served as an attachment', async () => {
    const html = '<html><body><script>alert(document.cookie)</script></body></html>';
    const doc = await uploadDocument(user, wid, html, 'evil.html', 'text/html');

    // text/html would be enough to run in our origin if a header ever slipped.
    expect(doc.mimeType).toBe('application/octet-stream');

    const download = await user.agent
      .get(`/api/workspaces/${wid}/documents/${doc.id}/download`)
      .buffer(true);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('application/octet-stream');
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.headers['content-disposition']).toContain('evil.html');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(download.body as Buffer).toString('utf8')).toBe(html);
  });

  it('sanitises the filename to a basename and keeps the storage key app-generated', async () => {
    // Hand-rolled multipart: form-data would helpfully strip the separators
    // client-side, and the point is what the server does with a hostile name.
    const boundary = '----blkboxTraversalBoundary';
    const body =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="../../etc/passwd.txt"\r\n' +
      'Content-Type: application/octet-stream\r\n\r\n' +
      'traversal\r\n' +
      `--${boundary}--\r\n`;

    const res = await user.agent
      .post(`/api/workspaces/${wid}/documents`)
      .set(SAME_ORIGIN)
      .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.document.name).toBe('passwd.txt');
    expect(res.body.document.name).not.toMatch(/[\\/]/);

    // The object lives under the generated key, not under anything the client
    // suggested.
    expect(await storage.exists(`ws/${wid}/doc/${res.body.document.id}`)).toBe(true);
    expect(await keysUnder(`ws/${wid}/`)).toContain(`ws/${wid}/doc/${res.body.document.id}`);
  });

  it('records the sha256 of the bytes that were actually stored', async () => {
    const doc = await uploadDocument(user, wid, 'hash me', 'hash.txt');
    const detail = await user.agent.get(`/api/workspaces/${wid}/documents/${doc.id}`);

    // sha256("hash me")
    expect(detail.body.document.sha256).toBe(
      'eb201af5aaf0d60629d3d2a61e466cfc0fedb517add831ecac5235e1daa963d6',
    );
    expect(detail.body.document.sizeBytes).toBe(7);
  });
});

describe('document listing is cursor-paginated, newest first, live only (SPEC §3)', () => {
  let user: TestUser;
  let wid: string;
  let first: UploadedDoc;
  let second: UploadedDoc;
  let third: UploadedDoc;

  beforeAll(async () => {
    user = await signUp('Lister');
    wid = await createWorkspace(user, 'Pages');
    // Sequential, so "newest first" has a defined meaning.
    first = await uploadDocument(user, wid, 'one', 'one.txt');
    second = await uploadDocument(user, wid, 'two', 'two.txt');
    third = await uploadDocument(user, wid, 'three', 'three.txt');
  });

  it('returns newest first with a null cursor when one page holds everything', async () => {
    const res = await user.agent.get(`/api/workspaces/${wid}/documents`);

    expect(res.status).toBe(200);
    expect(res.body.documents.map((d: UploadedDoc) => d.id)).toEqual([
      third.id,
      second.id,
      first.id,
    ]);
    // Fewer than PAGE_SIZE (50) rows, so there is no second page to offer.
    expect(res.body.nextCursor).toBeNull();

    const timestamps = res.body.documents.map((d: { createdAt: string }) =>
      Date.parse(d.createdAt),
    );
    expect(timestamps).toEqual([...timestamps].sort((a: number, b: number) => b - a));
  });

  it('continues after a cursor without repeating or skipping a document', async () => {
    const page1 = await user.agent.get(`/api/workspaces/${wid}/documents`);
    const boundary = page1.body.documents[1];

    // The cursor the API would emit at that boundary, encoded the same way.
    const cursor = encodeCursor({ createdAt: new Date(boundary.createdAt), id: boundary.id });
    const page2 = await user.agent.get(`/api/workspaces/${wid}/documents?cursor=${cursor}`);

    expect(page2.status).toBe(200);
    expect(page2.body.documents.map((d: UploadedDoc) => d.id)).toEqual([first.id]);
    expect(page2.body.nextCursor).toBeNull();
  });

  it(`hands back a cursor once there are more than ${PAGE_SIZE} documents`, async () => {
    const paginator = await signUp('Paginator');
    const pagedWid = await createWorkspace(paginator, 'Two pages');

    // Sequential on purpose: the cursor is (created_at desc, id), so the
    // upload order is the expected list order reversed.
    const uploaded: string[] = [];
    for (let i = 0; i <= PAGE_SIZE; i += 1) {
      uploaded.push((await uploadDocument(paginator, pagedWid, `doc ${i}`, `doc-${i}.txt`)).id);
    }
    expect(uploaded).toHaveLength(PAGE_SIZE + 1);

    const page1 = await paginator.agent.get(`/api/workspaces/${pagedWid}/documents`);
    expect(page1.status).toBe(200);
    // The literal 50 from SPEC §3, asserted against what the endpoint actually
    // returned. Every other expectation here derives from PAGE_SIZE, so this is
    // the one line that would fail if the page size drifted from the spec.
    expect(page1.body.documents).toHaveLength(50);
    expect(typeof page1.body.nextCursor).toBe('string');
    expect(page1.body.documents.map((d: UploadedDoc) => d.id)).toEqual(
      [...uploaded].reverse().slice(0, PAGE_SIZE),
    );

    const page2 = await paginator.agent.get(
      `/api/workspaces/${pagedWid}/documents?cursor=${encodeURIComponent(page1.body.nextCursor)}`,
    );
    expect(page2.status).toBe(200);
    // The last page: the oldest document, and nothing after it.
    expect(page2.body.documents.map((d: UploadedDoc) => d.id)).toEqual([uploaded[0]]);
    expect(page2.body.nextCursor).toBeNull();

    // No overlap, no gap: the two pages are exactly the workspace.
    const seen = [
      ...page1.body.documents.map((d: UploadedDoc) => d.id),
      ...page2.body.documents.map((d: UploadedDoc) => d.id),
    ];
    expect(new Set(seen).size).toBe(uploaded.length);
  });

  it('rejects a malformed cursor with 400 rather than silently listing page one', async () => {
    const res = await user.agent.get(`/api/workspaces/${wid}/documents?cursor=not-a-cursor`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('excludes soft-deleted documents from the list and shows them in trash', async () => {
    await user.agent
      .delete(`/api/workspaces/${wid}/documents/${second.id}`)
      .set(SAME_ORIGIN)
      .expect(204);

    const list = await user.agent.get(`/api/workspaces/${wid}/documents`);
    expect(list.body.documents.map((d: UploadedDoc) => d.id)).toEqual([third.id, first.id]);

    // Gone from detail and download too, not just from the list.
    expect((await user.agent.get(`/api/workspaces/${wid}/documents/${second.id}`)).status).toBe(404);
    expect(
      (await user.agent.get(`/api/workspaces/${wid}/documents/${second.id}/download`)).status,
    ).toBe(404);

    const trash = await user.agent.get(`/api/workspaces/${wid}/trash`);
    expect(trash.body.documents.map((d: UploadedDoc) => d.id)).toEqual([second.id]);

    // Restoring puts it back in the right place in the ordering.
    await user.agent
      .post(`/api/workspaces/${wid}/trash/${second.id}/restore`)
      .set(SAME_ORIGIN)
      .expect(200);

    const restored = await user.agent.get(`/api/workspaces/${wid}/documents`);
    expect(restored.body.documents.map((d: UploadedDoc) => d.id)).toEqual([
      third.id,
      second.id,
      first.id,
    ]);
  });
});

describe('download proxies the bytes with no path to the object store', () => {
  it('round-trips the exact content for a member', async () => {
    const user = await signUp('Downloader');
    const wid = await createWorkspace(user, 'Bytes');
    const content = 'line one\nline two\n';
    const doc = await uploadDocument(user, wid, content, 'round-trip.txt');

    const res = await user.agent.get(`/api/workspaces/${wid}/documents/${doc.id}/download`);

    expect(res.status).toBe(200);
    expect(res.text).toBe(content);
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength(content)));
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // Nothing in the response points at MinIO.
    expect(JSON.stringify(res.headers)).not.toMatch(/amz|minio|X-Amz-Signature/i);
  });

  it('is 404 for an unknown document id inside a workspace the caller can see', async () => {
    const user = await signUp('Downloader');
    const wid = await createWorkspace(user, 'Bytes');
    const res = await user.agent.get(
      `/api/workspaces/${wid}/documents/00000000-0000-4000-8000-000000000000/download`,
    );
    expect(res.status).toBe(404);
  });
});
