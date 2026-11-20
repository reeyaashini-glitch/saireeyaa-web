// Database access: one libsql client (Turso in production, a local file for testing) plus the
// bookkeeping the desktop app expects: UpdatedAt stamps, Tombstones for deletes, and the audit log.
const crypto = require('crypto');
const { createClient } = require('@libsql/client');
const { tables, SQL_TYPE } = require('./schema');

const TZ = process.env.TIMEZONE || 'Asia/Colombo';
if (process.env.VERCEL && !(process.env.TURSO_URL || process.env.TURSO_DATABASE_URL)) throw new Error('TURSO_URL is not set. Add TURSO_URL and TURSO_TOKEN under Vercel > Settings > Environment Variables, then redeploy.');
const client = createClient({
  url: process.env.TURSO_URL || process.env.TURSO_DATABASE_URL || 'file:./data/local.db',
  authToken: process.env.TURSO_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined,
});

const newId = () => crypto.randomBytes(16).toString('hex');
const stamp = () => new Date().toISOString();                     // UpdatedAt, same format the desktop triggers write
function localParts(d = new Date()) {
  const s = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);
  return s.replace(' ', 'T');
}
const nowLocal = () => localParts() + '.0000000';                 // like the desktop's local DateTime "o" format
const today = () => localParts().slice(0, 10);
const dateIso = (v) => (v === null || v === undefined || v === '' ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? v + 'T00:00:00.0000000' : String(v));

async function q(sql, args = []) { return (await client.execute({ sql, args })).rows.map((r) => ({ ...r })); }
async function run(sql, args = []) { return client.execute({ sql, args }); }

const SCHEMA_V = '1';
// Fast path for serverless cold starts: one query when the tables are already up to date.
async function ensureSchemaFast() {
  try { const r = await q("SELECT Value FROM SharedSettings WHERE Id='web.schema.v'"); if (r.length && r[0].Value === SCHEMA_V) return; } catch { /* table missing: do the full setup */ }
  await ensureSchema();
  await save('SharedSettings', { Id: 'web.schema.v', Value: SCHEMA_V });
}

async function ensureSchema() {
  const stmts = [];
  for (const [name, def] of Object.entries(tables)) {
    const cols = def.cols.map((c, i) => `${c.name} ${SQL_TYPE[c.type]}${i === 0 ? ' PRIMARY KEY' : ''}`).join(', ');
    stmts.push(`CREATE TABLE IF NOT EXISTS ${name} (${cols}${def.versioned ? ', UpdatedAt TEXT' : ''}${def.extra || ''})`);
  }
  stmts.push('CREATE TABLE IF NOT EXISTS Tombstones (TableName TEXT NOT NULL, RowId TEXT NOT NULL, DeletedAt TEXT NOT NULL, PRIMARY KEY (TableName, RowId))');
  for (const s of stmts) await run(s);
  // add any column an older database is missing (same idea as the desktop's migrations)
  for (const [name, def] of Object.entries(tables)) {
    const have = new Set((await q(`PRAGMA table_info(${name})`)).map((r) => String(r.name).toLowerCase()));
    const want = def.cols.map((c) => [c.name, SQL_TYPE[c.type]]);
    if (def.versioned) want.push(['UpdatedAt', 'TEXT']);
    for (const [c, t] of want) if (!have.has(c.toLowerCase())) await run(`ALTER TABLE ${name} ADD COLUMN ${c} ${t}`);
  }
}

// Convert an incoming JS value to what is stored.
function coerce(type, v) {
  if (type === 'b') return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
  if (type === 'r') { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
  if (type === 'i') { const n = parseInt(v, 10); return Number.isFinite(n) ? n : (v === '' || v == null ? null : 0); }
  if (type === 'd') return dateIso(v);
  return v == null ? '' : String(v);
}

// Insert-or-update a row from a plain object. Only known columns are written; every write is stamped for sync.
async function save(table, obj, { only } = {}) {
  const def = tables[table];
  const cols = def.cols.filter((c) => (obj[c.name] !== undefined) && (!only || only.includes(c.name) || c.name === 'Id'));
  if (!obj.Id) throw new Error('Id required');
  const names = cols.map((c) => c.name);
  const vals = cols.map((c) => coerce(c.type, obj[c.name]));
  if (def.versioned) { names.push('UpdatedAt'); vals.push(stamp()); }
  const updates = names.filter((n) => n !== 'Id').map((n) => `${n}=excluded.${n}`).join(', ');
  await run(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')}) ON CONFLICT(Id) DO UPDATE SET ${updates}`, vals);
  if (def.versioned) await run('DELETE FROM Tombstones WHERE TableName=? AND RowId=?', [table, obj.Id]);
}

async function remove(table, id) {
  await run(`DELETE FROM ${table} WHERE Id=?`, [id]);
  if (tables[table].versioned) await run('INSERT OR REPLACE INTO Tombstones (TableName,RowId,DeletedAt) VALUES (?,?,?)', [table, id, stamp()]);
}

async function audit(user, action, entity, description) {
  await run('INSERT INTO AuditLog (Id,Timestamp,UserName,Action,EntityType,Description) VALUES (?,?,?,?,?,?)',
    [newId(), nowLocal(), (user && (user.FullName || user.Username)) || '(system)', action, entity, String(description).slice(0, 500)]);
}

async function getSetting(key, def = '') {
  const r = await q('SELECT Value FROM SharedSettings WHERE Id=?', [key]);
  return r.length && r[0].Value != null ? String(r[0].Value) : def;
}
async function setSetting(key, value) { await save('SharedSettings', { Id: key, Value: value }); }

module.exports = { client, q, run, save, remove, audit, newId, stamp, nowLocal, today, dateIso, ensureSchema, ensureSchemaFast, getSetting, setSetting, coerce, localParts };
