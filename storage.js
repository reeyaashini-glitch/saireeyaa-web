// File storage for scanned documents: Cloudflare R2 (S3-compatible) when configured, otherwise a local folder (testing only -
// on free hosts the local folder is wiped on every restart, so set up R2 for real use).
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const bucket = process.env.R2_BUCKET;
const enabled = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && bucket);
const s3 = enabled ? new S3Client({
  region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
}) : null;
const useDb = !enabled && (process.env.FILE_STORAGE || 'db') === 'db';
const MAX_DB_BYTES = 4 * 1024 * 1024;
const localDir = path.join(__dirname, 'data', 'uploads');

async function put(key, buffer, contentType) {
  if (useDb) {
    if (buffer.length > MAX_DB_BYTES) throw Object.assign(new Error('Without R2 storage, files must be under 4 MB (compress or scan at lower quality).'), { status: 400 });
    const db = require('./db'); const id = require('crypto').randomBytes(16).toString('hex');
    await db.run('INSERT INTO DocFiles (Id,Data) VALUES (?,?)', [id, JSON.stringify({ t: contentType || '', b: buffer.toString('base64') })]); return 'db:' + id;
  }
  if (enabled) { await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType || 'application/octet-stream' })); return 'r2:' + key; }
  const f = path.join(localDir, key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buffer); return 'local:' + key;
}
async function get(stored) {
  if (stored.startsWith('db:')) {
    const db = require('./db'); const r = (await db.q('SELECT Data FROM DocFiles WHERE Id=?', [stored.slice(3)]))[0]; if (!r) return null;
    const o = JSON.parse(r.Data); const { Readable } = require('stream'); return { stream: Readable.from(Buffer.from(o.b, 'base64')), type: o.t };
  }
  if (stored.startsWith('r2:') && enabled) {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: stored.slice(3) }));
    return { stream: r.Body, type: r.ContentType };
  }
  if (stored.startsWith('local:')) { const f = path.join(localDir, stored.slice(6)); if (fs.existsSync(f)) return { stream: fs.createReadStream(f) }; }
  return null;
}
async function del(stored) {
  try {
    if (stored.startsWith('db:')) { await require('./db').run('DELETE FROM DocFiles WHERE Id=?', [stored.slice(3)]); return; }
    if (stored.startsWith('r2:') && enabled) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: stored.slice(3) }));
    else if (stored.startsWith('local:')) fs.rmSync(path.join(localDir, stored.slice(6)), { force: true });
  } catch { /* best effort */ }
}
module.exports = { put, get, del, enabled, useDb };
