const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('./db');
const { tables, access, STATUSES, ROLES } = require('./schema');
const auth = require('./auth');
const L = require('./logic');
const storage = require('./storage');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const COOKIE = 'src_session';

// ---------- session ----------
function cookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
const userCache = new Map();
async function currentUser(req) {
  const tok = auth.unsign(cookie(req, COOKIE));
  if (!tok) return null;
  const hit = userCache.get(tok.uid);
  if (hit && Date.now() - hit.t < 20000) return hit.u;
  const u = (await db.q('SELECT * FROM Users WHERE Id=?', [tok.uid]))[0];
  if (!u || !u.IsActive) { userCache.delete(tok.uid); return null; }
  u.roles = auth.roles(u);
  userCache.set(tok.uid, { u, t: Date.now() });
  return u;
}
const has = (u, list) => !!u && u.roles.some((r) => list.includes(r));
const isAdmin = (u) => has(u, ['Admin']);
const ACCOUNTS = ['Admin', 'Manager', 'Accountant'], PAYROLL = ['Admin', 'Manager', 'Payroll'];

// CSRF guard: state-changing requests must come from this site
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const o = req.headers.origin;
    if (o && new URL(o).host !== req.headers.host) return res.status(403).json({ error: 'Blocked cross-site request' });
  }
  next();
});

app.post('/api/login', wrap(async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const key = (req.ip || '') + '|' + String(username).toLowerCase();
  if (auth.throttle.blocked(key)) return res.status(429).json({ error: 'Too many wrong attempts. Please wait 10 minutes.' });
  const u = (await db.q('SELECT * FROM Users WHERE lower(Username)=lower(?) AND IsActive=1', [String(username).trim()]))[0];
  if (!u || !auth.verifyPassword(String(password), u.PasswordHash)) { auth.throttle.fail(key); return res.status(401).json({ error: 'Wrong username or password' }); }
  auth.throttle.ok(key);
  await db.run('UPDATE Users SET LastLogin=?, UpdatedAt=? WHERE Id=?', [db.nowLocal(), db.stamp(), u.Id]);
  await db.audit(u, 'Login', 'Session', 'Signed in (web)');
  const tok = auth.sign({ uid: u.Id, exp: Date.now() + 12 * 3600 * 1000 });
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(tok)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${12 * 3600}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
}));
app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`); res.json({ ok: true }); });

// everything below needs a signed-in user
app.use('/api', wrap(async (req, res, next) => {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'Please sign in' });
  req.user = u; next();
}));
const need = (list) => (req, res, next) => (has(req.user, list) ? next() : res.status(403).json({ error: 'You do not have permission for this' }));

// Only Admin may delete. Anyone else must supply an Admin's username + password for that delete (logged).
async function approveDelete(req, what) {
  if (isAdmin(req.user)) return;
  const au = req.headers['x-admin-user'], ap = req.headers['x-admin-pass'];
  const err = new Error('Only an Admin can delete. Enter an Admin username and password to approve.'); err.status = 403; err.needApproval = true;
  if (!au || !ap) throw err;
  const a = (await db.q('SELECT * FROM Users WHERE lower(Username)=lower(?) AND IsActive=1', [au]))[0];
  if (!a || !auth.roles(a).includes('Admin') || !auth.verifyPassword(String(ap), a.PasswordHash)) { err.message = 'Admin username or password is wrong.'; throw err; }
  await db.audit(req.user, 'Approved', 'AdminApproval', `Admin '${a.Username}' approved: ${what}`);
}

app.get('/api/me', (req, res) => {
  const u = req.user;
  res.json({ id: u.Id, username: u.Username, name: u.FullName, roles: u.roles, admin: isAdmin(u), payroll: has(u, PAYROLL), accounts: has(u, ACCOUNTS), audit: has(u, ['Admin', 'Manager']), r2: storage.enabled || storage.useDb });
});
app.get('/api/meta', (req, res) => res.json({ statuses: STATUSES, roles: ROLES, lists: require('./standard-lists.json') }));

// ---------- generic tables ----------
const entityName = (e) => Object.keys(tables).find((t) => t.toLowerCase() === String(e).toLowerCase());
app.use('/api/e/:entity', (req, res, next) => {
  const t = entityName(req.params.entity);
  if (!t || !access[t]) return res.status(404).json({ error: 'Unknown table' });
  req.table = t;
  const need_ = ['GET'].includes(req.method) ? access[t].read : access[t].write;
  if (!has(req.user, need_)) return res.status(403).json({ error: 'You do not have permission for this' });
  next();
});
const clean = (t, row) => { if (t === 'Users') delete row.PasswordHash; return row; };

app.get('/api/e/:entity', wrap(async (req, res) => {
  const rows = await db.q(`SELECT * FROM ${req.table}${req.table === 'AuditLog' ? ' ORDER BY Timestamp DESC LIMIT 1000' : ''}`);
  res.json(rows.map((r) => clean(req.table, r)));
}));
app.post('/api/e/:entity', wrap(async (req, res) => {
  const t = req.table;
  if (t === 'Users') return res.status(400).json({ error: 'Use the Users screen' });
  const o = { ...req.body, Id: db.newId() };
  if (tables[t].cols.some((c) => c.name === 'CreatedDate') && !o.CreatedDate) o.CreatedDate = db.nowLocal();
  if (t === 'Applicants' && !o.Status) o.Status = 'Inquiry';
  if (t === 'Applicants' && !String(o.FullName || '').trim()) return res.status(400).json({ error: 'Name is required' });
  await db.save(t, o);
  if (t === 'Applicants') await db.run('INSERT INTO StatusHistory (Id,ApplicantId,FromStatus,ToStatus,Timestamp) VALUES (?,?,?,?,?)', [db.newId(), o.Id, '', o.Status, db.nowLocal()]);
  await db.audit(req.user, 'Created', t, o.FullName || o.Name || o.Title || o.Label || o.Description || o.Id);
  res.json({ id: o.Id });
}));
app.put('/api/e/:entity/:id', wrap(async (req, res) => {
  const t = req.table;
  if (t === 'Users') return res.status(400).json({ error: 'Use the Users screen' });
  const old = (await db.q(`SELECT * FROM ${t} WHERE Id=?`, [req.params.id]))[0];
  if (!old) return res.status(404).json({ error: 'Not found' });
  const o = { ...req.body, Id: req.params.id };
  delete o.CreatedDate;
  await db.save(t, o);
  if (t === 'Applicants' && o.Status && o.Status !== old.Status) await db.run('INSERT INTO StatusHistory (Id,ApplicantId,FromStatus,ToStatus,Timestamp) VALUES (?,?,?,?,?)', [db.newId(), o.Id, old.Status, o.Status, db.nowLocal()]);
  await db.audit(req.user, 'Updated', t, old.FullName || old.Name || old.Title || old.Label || old.Description || old.Id);
  res.json({ ok: true });
}));
app.delete('/api/e/:entity/:id', wrap(async (req, res) => {
  const t = req.table, id = req.params.id;
  const old = (await db.q(`SELECT * FROM ${t} WHERE Id=?`, [id]))[0];
  if (!old) return res.status(404).json({ error: 'Not found' });
  const label = old.FullName || old.Name || old.Title || old.Label || old.Description || id;
  if (t === 'Sectors' && (await db.q('SELECT 1 FROM Applicants WHERE SectorId=? LIMIT 1', [id])).length) return res.status(400).json({ error: 'This service is used by applicants and cannot be deleted. Mark it inactive instead.' });
  await approveDelete(req, `delete ${t} "${label}"`);
  if (t === 'Applicants') {
    for (const d of await db.q('SELECT * FROM Documents WHERE ApplicantId=?', [id])) { await storage.del(d.StoredPath || ''); await db.remove('Documents', d.Id); }
    for (const a of await db.q('SELECT Id FROM CaseActivities WHERE ApplicantId=?', [id])) await db.remove('CaseActivities', a.Id);
    await db.run('DELETE FROM StatusHistory WHERE ApplicantId=?', [id]);
  }
  if (t === 'Documents' || t === 'InstitutionalDocuments') await storage.del(old.StoredPath || '');
  if (t === 'SalaryRecords') await L.syncSalaryToLedger(req.user, { ...old, IsPaid: 0 });
  if (t === 'Employees' && (await db.q('SELECT 1 FROM SalaryRecords WHERE EmployeeId=? LIMIT 1', [id])).length) return res.status(400).json({ error: 'This employee has salary slips. Mark them inactive instead.' });
  await db.remove(t, id);
  await db.audit(req.user, 'Deleted', t, label);
  res.json({ ok: true });
}));

// ---------- applicants: status, activities ----------
app.post('/api/applicants/:id/status', wrap(async (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Bad status' });
  const a = (await db.q('SELECT * FROM Applicants WHERE Id=?', [req.params.id]))[0];
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.Status !== status) {
    await db.save('Applicants', { Id: a.Id, Status: status });
    await db.run('INSERT INTO StatusHistory (Id,ApplicantId,FromStatus,ToStatus,Timestamp) VALUES (?,?,?,?,?)', [db.newId(), a.Id, a.Status, status, db.nowLocal()]);
    await db.audit(req.user, 'Status', 'Applicant', `${a.FullName}: ${a.Status} → ${status}`);
  }
  res.json({ ok: true });
}));
app.get('/api/applicants/:id/history', wrap(async (req, res) => res.json(await db.q('SELECT * FROM StatusHistory WHERE ApplicantId=? ORDER BY Timestamp DESC', [req.params.id]))));
app.post('/api/activities/:id/done', wrap(async (req, res) => { await db.save('CaseActivities', { Id: req.params.id, FollowUpCompleted: 1 }); res.json({ ok: true }); }));

// ---------- users ----------
function roleFields(list) {
  const order = ['Admin', 'Manager', 'Accountant', 'Payroll', 'Staff'];
  const chosen = order.filter((o) => (list || []).includes(o));
  if (!chosen.length) chosen.push('Staff');
  return { Role: chosen[0], ExtraRoles: chosen.slice(1).join(',') };
}
app.get('/api/users', need(['Admin']), wrap(async (req, res) => res.json((await db.q('SELECT * FROM Users ORDER BY FullName')).map((u) => { delete u.PasswordHash; u.roles = auth.roles(u); return u; }))));
app.post('/api/users', need(['Admin']), wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.Username || !b.FullName || !b.password) return res.status(400).json({ error: 'Username, full name and password are required' });
  if (String(b.password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if ((await db.q('SELECT 1 FROM Users WHERE lower(Username)=lower(?)', [b.Username.trim()])).length) return res.status(400).json({ error: 'That username is already taken' });
  const id = db.newId();
  await db.save('Users', { Id: id, Username: b.Username.trim(), FullName: b.FullName, PasswordHash: auth.hashPassword(b.password), IsActive: 1, CreatedDate: db.nowLocal(), ...roleFields(b.roles) });
  await db.audit(req.user, 'Created', 'User', b.Username); res.json({ id });
}));
app.put('/api/users/:id', need(['Admin']), wrap(async (req, res) => {
  const b = req.body || {};
  const u = (await db.q('SELECT * FROM Users WHERE Id=?', [req.params.id]))[0];
  if (!u) return res.status(404).json({ error: 'Not found' });
  const name = (b.Username || u.Username).trim();
  if (name.toLowerCase() !== u.Username.toLowerCase() && (await db.q('SELECT 1 FROM Users WHERE lower(Username)=lower(?) AND Id<>?', [name, u.Id])).length) return res.status(400).json({ error: 'That username is already taken' });
  const o = { Id: u.Id, Username: name, FullName: b.FullName || u.FullName, IsActive: b.IsActive ? 1 : 0, ...roleFields(b.roles || auth.roles(u)) };
  if (u.Id === req.user.Id && (!o.IsActive || !o.Role.includes('Admin'))) return res.status(400).json({ error: 'You cannot deactivate yourself or remove your own Admin role' });
  if (b.password) { if (String(b.password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' }); o.PasswordHash = auth.hashPassword(b.password); }
  await db.save('Users', o); userCache.clear();
  await db.audit(req.user, 'Updated', 'User', name); res.json({ ok: true });
}));
app.delete('/api/users/:id', need(['Admin']), wrap(async (req, res) => {
  if (req.params.id === req.user.Id) return res.status(400).json({ error: 'You cannot delete yourself' });
  const u = (await db.q('SELECT Username FROM Users WHERE Id=?', [req.params.id]))[0];
  await db.remove('Users', req.params.id); userCache.clear(); await db.audit(req.user, 'Deleted', 'User', u && u.Username); res.json({ ok: true });
}));
app.post('/api/password', wrap(async (req, res) => {
  const { current, password } = req.body || {};
  if (!auth.verifyPassword(String(current || ''), req.user.PasswordHash)) return res.status(400).json({ error: 'Current password is wrong' });
  if (String(password || '').length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  await db.save('Users', { Id: req.user.Id, PasswordHash: auth.hashPassword(password) }); userCache.clear();
  await db.audit(req.user, 'Updated', 'User', 'Changed own password'); res.json({ ok: true });
}));

// ---------- invoices ----------
app.get('/api/invoices', wrap(async (req, res) => res.json(await L.loadInvoices())));
app.get('/api/invoices/next-number', wrap(async (req, res) => res.json({ number: await L.nextInvoiceNumber() })));
app.get('/api/invoices/:id', wrap(async (req, res) => {
  const inv = (await L.loadInvoices('WHERE Id=?', [req.params.id]))[0];
  if (!inv) return res.status(404).json({ error: 'Not found' });
  inv.installments = await db.q('SELECT * FROM Installments WHERE InvoiceId=? ORDER BY DueDate', [inv.Id]);
  res.json(inv);
}));
app.post('/api/invoices', wrap(async (req, res) => saveInvoice(req, res)));
app.put('/api/invoices/:id', wrap(async (req, res) => saveInvoice(req, res, req.params.id)));
async function saveInvoice(req, res, id) {
  const b = req.body || {};
  const items = (b.items || []).filter((i) => String(i.Description || '').trim());
  if (!items.length) return res.status(400).json({ error: 'Add at least one line item' });
  if (!b.ApplicantId && !String(b.WalkInName || '').trim()) return res.status(400).json({ error: 'Choose an applicant or enter the walk-in customer name' });
  const dp = L.num(b.DiscountPercent), tp = L.num(b.TaxPercent);
  if (dp < 0 || dp > 100 || tp < 0 || tp > 100) return res.status(400).json({ error: 'Discount and tax must be between 0 and 100' });
  const isNew = !id;
  id = id || db.newId();
  let number = b.InvoiceNumber;
  if (isNew) { number = await L.nextInvoiceNumber(); }
  const payments = isNew ? [] : await db.q('SELECT Amount FROM Payments WHERE InvoiceId=?', [id]);
  const inv = { items, DiscountPercent: dp, TaxPercent: tp, payments };
  const t = L.totals(inv);
  await db.save('Invoices', {
    Id: id, InvoiceNumber: number, ApplicantId: b.ApplicantId || '', Date: b.Date || db.today(), DiscountPercent: dp, TaxPercent: tp, AmountPaid: 0,
    Status: L.statusFor(t), Notes: b.Notes || '', DateOfSupply: b.DateOfSupply || b.Date || db.today(), CustomerTin: b.CustomerTin || '', DueDate: b.DueDate || '',
    WalkInName: b.ApplicantId ? '' : b.WalkInName || '', WalkInPhone: b.ApplicantId ? '' : b.WalkInPhone || '', WalkInEmail: b.ApplicantId ? '' : b.WalkInEmail || '',
  });
  // save every line (stable ids, like the desktop app), then drop leftovers
  await Promise.all(items.map((it, k) => db.save('InvoiceItems', { Id: `${id}_${k}`, InvoiceId: id, Description: it.Description, Quantity: it.Quantity || 1, UnitPrice: it.UnitPrice, ForName: it.ForName || '' })));
  for (const old of await db.q('SELECT Id FROM InvoiceItems WHERE InvoiceId=?', [id])) {
    const k = Number(String(old.Id).split('_').pop());
    if (!String(old.Id).startsWith(id + '_') || k >= items.length) await db.remove('InvoiceItems', old.Id);
  }
  await db.audit(req.user, isNew ? 'Created' : 'Updated', 'Invoice', `${number} Rs. ${t.grand}`);
  res.json({ id, number });
}
async function refreshStatus(invoiceId) {
  const inv = (await L.loadInvoices('WHERE Id=?', [invoiceId]))[0];
  if (inv) { const s = L.statusFor(inv.totals); if (s !== inv.Status) await db.save('Invoices', { Id: invoiceId, Status: s }); }
}
app.delete('/api/invoices/:id', wrap(async (req, res) => {
  const inv = (await db.q('SELECT * FROM Invoices WHERE Id=?', [req.params.id]))[0];
  if (!inv) return res.status(404).json({ error: 'Not found' });
  await approveDelete(req, `delete invoice ${inv.InvoiceNumber}`);
  for (const t of ['InvoiceItems', 'Payments', 'Installments'])
    for (const r of await db.q(`SELECT Id FROM ${t} WHERE InvoiceId=?`, [inv.Id])) await db.remove(t, r.Id);
  await db.remove('Invoices', inv.Id);
  await db.audit(req.user, 'Deleted', 'Invoice', inv.InvoiceNumber); res.json({ ok: true });
}));
app.post('/api/invoices/:id/payments', wrap(async (req, res) => {
  const b = req.body || {}, amount = L.num(b.Amount);
  if (amount <= 0) return res.status(400).json({ error: 'Enter an amount above zero' });
  const inv = (await L.loadInvoices('WHERE Id=?', [req.params.id]))[0];
  if (!inv) return res.status(404).json({ error: 'Not found' });
  if (amount > inv.totals.balance + 0.005 && !b.confirmOver) return res.status(409).json({ error: `This is Rs. ${L.r2(amount - inv.totals.balance)} more than the balance. Record it anyway?`, confirm: true });
  const id = db.newId();
  await db.save('Payments', { Id: id, InvoiceId: inv.Id, Date: b.Date || db.today(), Amount: amount, Method: b.Method || 'Cash', Notes: b.Notes || '', ServiceDescription: b.ServiceDescription || '' });
  await refreshStatus(inv.Id);
  await db.audit(req.user, 'Payment', 'Invoice', `${inv.InvoiceNumber} Rs. ${amount}`);
  res.json({ id });
}));
app.delete('/api/payments/:id', wrap(async (req, res) => {
  const p = (await db.q('SELECT * FROM Payments WHERE Id=?', [req.params.id]))[0];
  if (!p) return res.status(404).json({ error: 'Not found' });
  await approveDelete(req, `remove payment Rs. ${p.Amount}`);
  await db.run('UPDATE Installments SET PaymentId=\'\', UpdatedAt=? WHERE PaymentId=?', [db.stamp(), p.Id]);
  await db.remove('Payments', p.Id); await refreshStatus(p.InvoiceId);
  await db.audit(req.user, 'Deleted', 'Payment', `Rs. ${p.Amount}`); res.json({ ok: true });
}));
// payment plan: replace this invoice's unpaid instalments
app.put('/api/invoices/:id/installments', wrap(async (req, res) => {
  const list = req.body.items || [];
  const keep = new Set();
  for (const it of list) {
    if (!(L.num(it.Amount) > 0)) continue;
    const id = it.Id || db.newId(); keep.add(id);
    await db.save('Installments', { Id: id, InvoiceId: req.params.id, Label: it.Label || 'Instalment', Amount: it.Amount, DueDate: it.DueDate || '', PaymentId: it.PaymentId || '' });
  }
  for (const old of await db.q('SELECT Id,PaymentId FROM Installments WHERE InvoiceId=?', [req.params.id])) if (!keep.has(old.Id) && !old.PaymentId) await db.remove('Installments', old.Id);
  res.json({ ok: true });
}));
app.post('/api/installments/:id/pay', wrap(async (req, res) => {
  const it = (await db.q('SELECT * FROM Installments WHERE Id=?', [req.params.id]))[0];
  if (!it || it.PaymentId) return res.status(400).json({ error: 'Already paid or not found' });
  const pid = db.newId();
  await db.save('Payments', { Id: pid, InvoiceId: it.InvoiceId, Date: db.today(), Amount: it.Amount, Method: req.body.Method || 'Cash', Notes: `Instalment: ${it.Label}`, ServiceDescription: it.Label });
  await db.save('Installments', { Id: it.Id, PaymentId: pid });
  await refreshStatus(it.InvoiceId); await db.audit(req.user, 'Payment', 'Instalment', `${it.Label} Rs. ${it.Amount}`);
  res.json({ ok: true });
}));

// ---------- price list ----------
app.get('/api/catalog', wrap(async (req, res) => { await L.seedCatalogIfNeeded(); res.json(await db.q('SELECT * FROM ServiceCatalog ORDER BY Category, Name')); }));

// ---------- payroll ----------
app.get('/api/payroll', need(PAYROLL), wrap(async (req, res) => {
  const emps = new Map((await db.q('SELECT * FROM Employees')).map((e) => [e.Id, e]));
  const rows = await db.q('SELECT * FROM SalaryRecords ORDER BY Year DESC, Month DESC');
  res.json(rows.map((s) => ({ ...s, employee: emps.get(s.EmployeeId) || null, totals: L.slipTotals(s) })));
}));
app.post('/api/payroll/generate', need(PAYROLL), wrap(async (req, res) => {
  const year = parseInt(req.body.year, 10), month = parseInt(req.body.month, 10), epf = !!req.body.epf;
  if (!year || month < 1 || month > 12) return res.status(400).json({ error: 'Choose a month' });
  const emps = (await db.q('SELECT * FROM Employees WHERE IsActive=1')).filter((e) => !!L.num(e.EpfApplicable) === epf);
  const have = new Set((await db.q('SELECT EmployeeId FROM SalaryRecords WHERE Year=? AND Month=?', [year, month])).map((r) => r.EmployeeId));
  let n = 0;
  for (const e of emps) {
    if (have.has(e.Id)) continue;
    const rec = L.applyStatutory({ Id: db.newId(), EmployeeId: e.Id, Year: year, Month: month, BasicSalary: e.BasicSalary, EpfAllowances: e.EpfAllowance, OtherAllowances: e.OtherAllowance, Overtime: 0, Bonus: 0, Commission: 0, Advance: 0, OtherDeductions: 0, Apit: 0, IsPaid: 0, Notes: '', CreatedDate: db.nowLocal() }, epf);
    await db.save('SalaryRecords', rec); n++;
  }
  await db.audit(req.user, 'Created', 'Payroll', `${n} slips for ${L.MONTHS[month - 1]} ${year}`);
  res.json({ created: n, skipped: emps.length - n });
}));
app.put('/api/salary/:id', need(PAYROLL), wrap(async (req, res) => {
  const old = (await db.q('SELECT * FROM SalaryRecords WHERE Id=?', [req.params.id]))[0];
  if (!old) return res.status(404).json({ error: 'Not found' });
  const rec = { ...old, ...req.body, Id: old.Id, Year: old.Year, Month: old.Month, EmployeeId: old.EmployeeId };
  L.applyStatutory(rec, !!L.num(old.EpfApplicable));
  if (L.num(rec.IsPaid) && !rec.PaidDate) rec.PaidDate = db.today();
  if (!L.num(rec.IsPaid)) rec.PaidDate = '';
  await db.save('SalaryRecords', rec);
  await L.syncSalaryToLedger(req.user, rec);
  await db.audit(req.user, 'Updated', 'Salary', `${old.Month}/${old.Year}`);
  res.json({ ok: true });
}));

// ---------- reminders & dashboard ----------
app.get('/api/alerts', wrap(async (req, res) => res.json(await L.buildAlerts())));
app.get('/api/dashboard', wrap(async (req, res) => {
  const apps = await db.q('SELECT Id,FullName,Status,CreatedDate FROM Applicants');
  const hist = await db.q('SELECT * FROM StatusHistory ORDER BY Timestamp');
  const invs = await L.loadInvoices();
  const month = db.today().slice(0, 7);
  const stages = STATUSES.map((s) => {
    const mine = apps.filter((a) => a.Status === s);
    const days = mine.map((a) => {
      const last = hist.filter((h) => h.ApplicantId === a.Id && h.ToStatus === s).pop();
      return Math.max(0, -L.daysFromToday((last ? last.Timestamp : a.CreatedDate) || db.today()));
    });
    return { status: s, count: mine.length, avgDays: days.length ? Math.round((days.reduce((x, y) => x + y, 0) / days.length) * 10) / 10 : 0 };
  });
  res.json({
    applicants: apps.length, active: apps.filter((a) => !['Completed', 'Rejected'].includes(a.Status)).length, stages,
    outstanding: L.r2(invs.reduce((s, i) => s + Math.max(0, i.totals.balance), 0)), unpaid: invs.filter((i) => i.totals.balance > 0).length,
    collectedMonth: L.r2(invs.reduce((s, i) => s + i.payments.filter((p) => L.d10(p.Date).startsWith(month)).reduce((a, p) => a + L.num(p.Amount), 0), 0)),
    invoicedMonth: L.r2(invs.filter((i) => L.d10(i.Date).startsWith(month)).reduce((s, i) => s + i.totals.grand, 0)),
    alerts: (await L.buildAlerts()).slice(0, 8),
  });
}));

// ---------- accounts ----------
app.get('/api/ledger', need(ACCOUNTS), wrap(async (req, res) => {
  const from = req.query.from || db.today().slice(0, 8) + '01', to = req.query.to || db.today();
  const l = await L.buildLedger(from, to);
  res.json({ ...l, from, to, income: L.r2(l.rows.reduce((s, r) => s + r.income, 0)), expense: L.r2(l.rows.reduce((s, r) => s + r.expense, 0)), pending: (await db.q("SELECT * FROM LedgerEntries WHERE Status='pending' ORDER BY Date DESC")) });
}));
app.get('/api/ledger/monthly', need(ACCOUNTS), wrap(async (req, res) => {
  const now = db.today();
  res.json(await L.monthlySummary(parseInt(req.query.year, 10) || +now.slice(0, 4), parseInt(req.query.month, 10) || +now.slice(5, 7)));
}));
app.post('/api/ledger/:id/approve', need(ACCOUNTS), wrap(async (req, res) => {
  await db.save('LedgerEntries', { Id: req.params.id, Status: req.body.reject ? 'rejected' : 'approved' });
  await db.audit(req.user, req.body.reject ? 'Rejected' : 'Approved', 'Purchase', req.params.id); res.json({ ok: true });
}));
app.post('/api/ledger', need(ACCOUNTS), wrap(async (req, res) => {
  const b = req.body, id = db.newId();
  if (L.num(b.Amount) <= 0) return res.status(400).json({ error: 'Enter an amount above zero' });
  await db.save('LedgerEntries', { Id: id, Date: b.Date || db.today(), Kind: b.Kind === 'Income' ? 'Income' : 'Expense', Category: b.Category || '', Description: b.Description || '', Party: b.Party || '', Amount: b.Amount, Method: b.Method || 'Cash', ApplicantId: '', InvoiceId: '', Status: 'approved', CreatedBy: req.user.FullName, CreatedDate: db.nowLocal(), Source: 'manual' });
  await db.audit(req.user, 'Created', 'Ledger', `${b.Kind} Rs. ${b.Amount} ${b.Description || ''}`); res.json({ id });
}));
// staff purchase requests (anyone signed in; they see their own, accounts roles see all)
app.get('/api/purchases', wrap(async (req, res) => {
  const all = has(req.user, ACCOUNTS);
  res.json(await db.q(`SELECT * FROM LedgerEntries WHERE Source='purchase' ${all ? '' : 'AND CreatedBy=?'} ORDER BY Date DESC`, all ? [] : [req.user.FullName]));
}));
app.post('/api/purchases', wrap(async (req, res) => {
  const b = req.body, id = db.newId();
  if (L.num(b.Amount) <= 0) return res.status(400).json({ error: 'Enter an amount above zero' });
  await db.save('LedgerEntries', { Id: id, Date: b.Date || db.today(), Kind: 'Expense', Category: b.Category || 'Office supplies', Description: b.Description || '', Party: b.Party || '', Amount: b.Amount, Method: b.Method || 'Cash', ApplicantId: '', InvoiceId: '', Status: has(req.user, ACCOUNTS) ? 'approved' : 'pending', CreatedBy: req.user.FullName, CreatedDate: db.nowLocal(), Source: 'purchase' });
  await db.audit(req.user, 'Created', 'Purchase', `Rs. ${b.Amount} ${b.Description || ''}`); res.json({ id });
}));

// ---------- reports ----------
app.get('/api/reports/financial', need(['Admin', 'Manager', 'Accountant']), wrap(async (req, res) => {
  const t = db.today();
  res.json(await L.financialReport(req.query.from || t.slice(0, 4) + '-01-01', req.query.to || t));
}));

// ---------- company profile & tax settings ----------
app.get('/api/company', wrap(async (req, res) => {
  let cs = (await db.q("SELECT * FROM CompanySettings WHERE Id='company'"))[0];
  if (!cs) cs = { Id: 'company', LegalName: 'Sai Reeyaa Consultancy (Pvt) Ltd', RegisteredAddress: '', Tin: '', VatRegistrationNumber: '', BusinessRegistrationNumber: '', BranchCode: 'MAIN', IsVatRegistered: 0, DefaultWhtRatePercent: 5, WhtMonthlyThresholdLkr: 100000 };
  res.json({ settings: cs, profile: await L.profile(), openingBalance: await L.openingBalance() });
}));
app.put('/api/company', need(['Admin', 'Manager']), wrap(async (req, res) => {
  const b = req.body || {};
  if (b.settings) await db.save('CompanySettings', { ...b.settings, Id: 'company' });
  for (const k of Object.keys(L.PROFILE_DEFAULTS)) if (b.profile && b.profile[k] !== undefined) await db.setSetting(k, b.profile[k]);
  if (b.openingBalance !== undefined) await db.setSetting('opening.balance', String(L.num(b.openingBalance)));
  await db.audit(req.user, 'Saved', 'CompanyProfile', 'Company profile / settings updated (web)'); res.json({ ok: true });
}));

// ---------- documents (files live in R2) ----------
async function saveFile(req, res, table, extra) {
  if (!req.file) return res.status(400).json({ error: 'Choose a file' });
  const bad = /\.(exe|bat|cmd|com|scr|msi|js|vbs|ps1|dll)$/i;
  if (bad.test(req.file.originalname)) return res.status(400).json({ error: 'This file type is not allowed' });
  const safe = req.file.originalname.replace(/[^\w.\- ]+/g, '_').slice(-80);
  const id = db.newId();
  const stored = await storage.put(`${table.toLowerCase()}/${id}_${safe}`, req.file.buffer, req.file.mimetype);
  await db.save(table, { Id: id, FileName: safe, StoredPath: stored, ...extra });
  await db.audit(req.user, 'Uploaded', table, safe); res.json({ id });
}
app.post('/api/documents', upload.single('file'), wrap(async (req, res) => {
  if (!req.body.ApplicantId) return res.status(400).json({ error: 'Applicant missing' });
  await saveFile(req, res, 'Documents', { ApplicantId: req.body.ApplicantId, DocType: req.body.DocType || 'Other', UploadDate: db.nowLocal(), ExpiryDate: req.body.ExpiryDate || '' });
}));
app.post('/api/institutional', upload.single('file'), wrap(async (req, res) => {
  const b = req.body;
  if (!b.Title) return res.status(400).json({ error: 'Title is required' });
  await saveFile(req, res, 'InstitutionalDocuments', { Title: b.Title, Category: b.Category || '', CounterpartyName: b.CounterpartyName || '', CounterpartyCountry: b.CounterpartyCountry || '', ReferenceNumber: b.ReferenceNumber || '', SignedDate: b.SignedDate || '', ExpiryDate: b.ExpiryDate || '', Notes: b.Notes || '', CreatedDate: db.nowLocal() });
}));
app.get('/api/file/:table/:id', wrap(async (req, res) => {
  const t = req.params.table === 'documents' ? 'Documents' : req.params.table === 'institutional' ? 'InstitutionalDocuments' : null;
  if (!t) return res.status(404).end();
  const d = (await db.q(`SELECT * FROM ${t} WHERE Id=?`, [req.params.id]))[0];
  if (!d) return res.status(404).json({ error: 'Not found' });
  const f = await storage.get(d.StoredPath || '');
  if (!f) return res.status(404).json({ error: 'This file is stored on the desktop PC only and is not available in the browser.' });
  res.setHeader('Content-Disposition', `inline; filename="${String(d.FileName).replace(/"/g, '')}"`);
  if (f.type) res.setHeader('Content-Type', f.type);
  f.stream.pipe(res);
}));

// ---------- static site ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, extensions: ['html'] }));
app.use((err, req, res, next) => {
  if (err.needApproval) return res.status(403).json({ error: err.message, needApproval: true });
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong: ' + err.message });
});

const port = process.env.PORT || 3000;
let ready;
const init = () => (ready = ready || db.ensureSchemaFast().catch((e) => { ready = null; throw e; }));
async function start() {
  await init();
  if (!(await db.q('SELECT 1 FROM Users LIMIT 1')).length) {
    const pw = process.env.INITIAL_ADMIN_PASSWORD;
    if (pw) {
      await db.save('Users', { Id: db.newId(), Username: process.env.INITIAL_ADMIN_USERNAME || 'admin', FullName: 'Administrator', PasswordHash: auth.hashPassword(pw), Role: 'Admin', ExtraRoles: '', IsActive: 1, CreatedDate: db.nowLocal() });
      console.log('Created first Admin user.');
    } else console.warn('No users exist yet. Set INITIAL_ADMIN_PASSWORD (and optionally INITIAL_ADMIN_USERNAME) and restart to create the first Admin.');
  }
  app.listen(port, () => console.log('Sai Reeyaa web app running on port ' + port));
}
if (require.main === module) start().catch((e) => { console.error('Startup failed:', e); process.exit(1); });
module.exports = { app, start, init };
