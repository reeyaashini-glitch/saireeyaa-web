// Passwords use the same PBKDF2 format as the desktop app ("iterations.saltBase64.hashBase64"), so one login works in both.
const crypto = require('crypto');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16), it = 100000;
  const h = crypto.pbkdf2Sync(pw, salt, it, 32, 'sha256');
  return `${it}.${salt.toString('base64')}.${h.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [it, salt, hash] = String(stored).split('.');
    if (!it || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = crypto.pbkdf2Sync(pw, Buffer.from(salt, 'base64'), parseInt(it, 10), expected.length, 'sha256');
    return crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET not set - using a random one (everyone is logged out whenever the server restarts).');
const b64 = (s) => Buffer.from(s).toString('base64url');
function sign(payload) { const p = b64(JSON.stringify(payload)); return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); }
function unsign(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [p, sig] = tok.split('.');
  const good = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}

// very small login throttle: 6 wrong tries per username+IP in 10 minutes
const fails = new Map();
const throttle = { blocked(k) { const f = fails.get(k); return !!f && f.n >= 6 && Date.now() - f.t < 600000; }, fail(k) { const f = fails.get(k); fails.set(k, f && Date.now() - f.t < 600000 ? { n: f.n + 1, t: f.t } : { n: 1, t: Date.now() }); }, ok(k) { fails.delete(k); } };

function roles(u) { return [u.Role, ...String(u.ExtraRoles || '').split(',').map((s) => s.trim())].filter(Boolean); }
module.exports = { hashPassword, verifyPassword, sign, unsign, throttle, roles };
