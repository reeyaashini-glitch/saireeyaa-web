// Business logic shared by the routes: invoice maths, payroll maths, reminders, reports, ledger.
const db = require('./db');
const { q } = db;

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const d10 = (v) => (v ? String(v).slice(0, 10) : '');
const dayNum = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
const daysFromToday = (s) => dayNum(s) - dayNum(db.today());
const num = (v) => Number(v) || 0;

// ---------- invoices ----------
function totals(inv) {
  const sub = r2((inv.items || []).reduce((s, i) => s + num(i.Quantity) * num(i.UnitPrice), 0));
  const discount = r2(sub * (num(inv.DiscountPercent) / 100));
  const taxable = r2(sub - discount);
  const tax = r2(taxable * (num(inv.TaxPercent) / 100));
  const grand = r2(taxable + tax);
  const paid = r2((inv.payments || []).reduce((s, p) => s + num(p.Amount), 0));
  return { sub, discount, taxable, tax, grand, paid, balance: r2(grand - paid) };
}
function statusFor(t) { return t.paid <= 0 ? 'Unpaid' : t.paid + 0.004 >= t.grand && t.grand > 0 ? 'Paid' : 'PartiallyPaid'; }

async function loadInvoices(where = '', args = []) {
  const invs = await q(`SELECT * FROM Invoices ${where} ORDER BY Date DESC, InvoiceNumber DESC`, args);
  if (!invs.length) return [];
  const items = await q('SELECT * FROM InvoiceItems ORDER BY Id');
  const pays = await q('SELECT * FROM Payments ORDER BY Date, Id');
  const apps = new Map((await q('SELECT Id,FullName,Phone,WhatsApp,Email,Address,PassportNumber,SectorId,AssignedStaff,ReferralAgentId FROM Applicants')).map((a) => [a.Id, a]));
  const byInv = (rows) => rows.reduce((m, r) => { (m.get(r.InvoiceId) || m.set(r.InvoiceId, []).get(r.InvoiceId)).push(r); return m; }, new Map());
  const im = byInv(items), pm = byInv(pays);
  return invs.map((i) => {
    const full = { ...i, items: im.get(i.Id) || [], payments: pm.get(i.Id) || [] };
    full.applicant = apps.get(i.ApplicantId) || null;
    full.CustomerName = full.applicant ? full.applicant.FullName : (i.WalkInName ? `${i.WalkInName} (walk-in)` : '—');
    full.totals = totals(full);
    return full;
  });
}

async function nextInvoiceNumber() {
  const cs = (await q("SELECT * FROM CompanySettings WHERE Id='company'"))[0] || {};
  const existing = new Set((await q('SELECT InvoiceNumber FROM Invoices')).map((r) => String(r.InvoiceNumber).toLowerCase()));
  const now = new Date(db.nowLocal().slice(0, 19));
  if (cs.IsVatRegistered) {
    const yy = String(now.getFullYear()).slice(2);
    const mmm = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][now.getMonth()];
    const prefix = `${yy}${mmm}_${cs.BranchCode || 'MAIN'}_`;
    let seq = [...existing].filter((n) => n.startsWith(prefix.toLowerCase())).length + 1, c;
    do { c = `${prefix}${seq++}`; } while (existing.has(c.toLowerCase()));
    return c;
  }
  let seq = existing.size + 1, c;
  do { c = `SRC-${now.getFullYear()}-${String(seq++).padStart(4, '0')}`; } while (existing.has(c.toLowerCase()));
  return c;
}

// ---------- payroll ----------
function applyStatutory(rec, epf) {
  rec.EpfApplicable = epf ? 1 : 0;
  if (!epf) { rec.EpfEmployee = 0; rec.EpfEmployer = 0; rec.EtfEmployer = 0; return rec; }
  const base = num(rec.BasicSalary) + num(rec.EpfAllowances);
  rec.EpfEmployee = r2(base * 0.08); rec.EpfEmployer = r2(base * 0.12); rec.EtfEmployer = r2(base * 0.03);
  return rec;
}
function slipTotals(s) {
  const gross = num(s.BasicSalary) + num(s.EpfAllowances) + num(s.OtherAllowances) + num(s.Overtime) + num(s.Bonus);
  const ded = num(s.EpfEmployee) + num(s.Advance) + num(s.OtherDeductions) + num(s.Apit);
  return { gross, deductions: ded, net: r2(gross + num(s.Commission) - ded), employerCost: r2(gross + num(s.Commission) + num(s.EpfEmployer) + num(s.EtfEmployer)) };
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

async function syncSalaryToLedger(user, s) {
  const id = 'sal_' + s.Id;
  if (num(s.IsPaid)) {
    const emp = (await q('SELECT FullName FROM Employees WHERE Id=?', [s.EmployeeId]))[0];
    const name = emp ? emp.FullName : 'Employee';
    await db.save('LedgerEntries', {
      Id: id, Date: d10(s.PaidDate) || db.today(), Kind: 'Expense', Category: 'Salaries',
      Description: `Salary - ${name} - ${MONTHS[s.Month - 1]} ${s.Year}`, Party: name, Amount: slipTotals(s).net, Method: 'Bank transfer',
      Status: 'approved', CreatedBy: user ? user.FullName : '', CreatedDate: db.nowLocal(), Source: 'salary', ApplicantId: '', InvoiceId: '',
    });
  } else if ((await q('SELECT 1 FROM LedgerEntries WHERE Id=?', [id])).length) await db.remove('LedgerEntries', id);
}

// ---------- reminders ----------
async function buildAlerts() {
  const alerts = [];
  const make = (kind, name, what, date, phone, message, extra = {}) => {
    const days = daysFromToday(date);
    const when = days < 0 ? `${what} overdue by ${-days} day(s)` : days === 0 ? `${what} today` : `${what} in ${days} day(s)`;
    alerts.push({ kind, date: d10(date), severity: days <= 1 ? 'overdue' : days <= 7 ? 'soon' : 'info', title: `${name}: ${when} (${d10(date)})`, phone, message, ...extra });
  };
  const within = (d, h) => daysFromToday(d) <= h;
  const fmt = (d) => { const [y, m, dd] = d10(d).split('-'); return `${dd} ${MONTHS[+m - 1].slice(0, 3)} ${y}`; };
  const apps = await q('SELECT * FROM Applicants');
  const wa = (a) => a.WhatsApp || a.Phone || '';
  for (const a of apps) {
    if (a.AdmissionDeadline && within(a.AdmissionDeadline, 14)) make('Admission deadline', a.FullName, 'Admission deadline', a.AdmissionDeadline, wa(a), `Dear ${a.FullName}, this is Sai Reeyaa Consultancy. A reminder that the admission deadline is ${fmt(a.AdmissionDeadline)}. Please send any pending documents.`, { applicantId: a.Id });
    if (a.InterviewDate && within(a.InterviewDate, 14) && daysFromToday(a.InterviewDate) >= -1) make('Visa appointment', a.FullName, 'Visa appointment / interview', a.InterviewDate, wa(a), `Dear ${a.FullName}, this is Sai Reeyaa Consultancy. Your visa appointment / interview is on ${fmt(a.InterviewDate)}. Please be ready with your documents.`, { applicantId: a.Id });
    if (a.PassportExpiryDate && within(a.PassportExpiryDate, 180)) make('Passport expiry', a.FullName, 'Passport expires', a.PassportExpiryDate, wa(a), `Dear ${a.FullName}, this is Sai Reeyaa Consultancy. Your passport ${daysFromToday(a.PassportExpiryDate) < 0 ? 'has expired' : 'will expire on ' + fmt(a.PassportExpiryDate)}. Please renew it so we can continue with your application.`, { applicantId: a.Id });
  }
  for (const d of await q('SELECT * FROM InstitutionalDocuments WHERE ExpiryDate IS NOT NULL AND ExpiryDate<>\'\'')) if (within(d.ExpiryDate, 60)) make('Document expiry', d.Title, 'Document expires', d.ExpiryDate, '', '');
  const inst = await q('SELECT * FROM Installments');
  const appMap = new Map(apps.map((a) => [a.Id, a]));
  for (const inv of await loadInvoices()) {
    if (inv.totals.balance <= 0) continue;
    const a = appMap.get(inv.ApplicantId);
    const name = a ? a.FullName : (inv.WalkInName || 'Client'), phone = a ? wa(a) : inv.WalkInPhone || '';
    const plan = inst.filter((x) => x.InvoiceId === inv.Id && !x.PaymentId && x.DueDate);
    if (inv.DueDate && !plan.length && within(inv.DueDate, 7)) make('Invoice due', name, `Invoice ${inv.InvoiceNumber} (Rs. ${inv.totals.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}) due`, inv.DueDate, phone, `Dear ${name}, a friendly reminder from Sai Reeyaa Consultancy: invoice ${inv.InvoiceNumber} has a balance of Rs. ${inv.totals.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })} due on ${fmt(inv.DueDate)}. Thank you.`, { applicantId: inv.ApplicantId, invoiceId: inv.Id });
    for (const pl of plan.filter((x) => within(x.DueDate, 7))) make('Instalment', name, `Instalment "${pl.Label}" (Rs. ${num(pl.Amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}) due`, pl.DueDate, phone, `Dear ${name}, a friendly reminder from Sai Reeyaa Consultancy: your instalment "${pl.Label}" of Rs. ${num(pl.Amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} is due on ${fmt(pl.DueDate)}. Thank you.`, { applicantId: inv.ApplicantId, invoiceId: inv.Id });
  }
  for (const act of await q("SELECT * FROM CaseActivities WHERE FollowUpDate IS NOT NULL AND FollowUpDate<>'' AND (FollowUpCompleted IS NULL OR FollowUpCompleted=0)")) {
    if (!within(act.FollowUpDate, 7)) continue;
    const a = appMap.get(act.ApplicantId);
    make('Follow-up', a ? a.FullName : 'Client', `Follow-up - ${(act.Notes || '').trim() || 'Follow-up'}`, act.FollowUpDate, a ? wa(a) : '', `Dear ${a ? a.FullName : 'Client'}, this is Sai Reeyaa Consultancy following up regarding your application.`, { applicantId: act.ApplicantId, activityId: act.Id });
  }
  const rank = { overdue: 0, soon: 1, info: 2 };
  return alerts.sort((x, y) => rank[x.severity] - rank[y.severity] || x.date.localeCompare(y.date));
}

// ---------- accounts ----------
async function openingBalance() { return parseFloat(await db.getSetting('opening.balance', '0')) || 0; }

async function buildLedger(from, to) {
  const rows = [];
  const entries = (await q("SELECT * FROM LedgerEntries WHERE Status IS NULL OR Status='' OR Status='approved'")).map((e) => ({ ...e, day: d10(e.Date) }));
  const invs = await loadInvoices();
  const pays = [];
  for (const inv of invs) for (const p of inv.payments) pays.push({ day: d10(p.Date), amount: num(p.Amount), method: p.Method, who: inv.CustomerName, desc: `Invoice ${inv.InvoiceNumber}${p.ServiceDescription ? ' - ' + p.ServiceDescription : ''}` });
  let before = 0;
  for (const e of entries) {
    if (e.day < from) before += e.Kind === 'Income' ? num(e.Amount) : -num(e.Amount);
    else if (e.day <= to) rows.push({ date: e.day, kind: e.Kind, category: e.Category, description: e.Description, party: e.Party, method: e.Method, id: e.Id, source: e.Source, income: e.Kind === 'Income' ? num(e.Amount) : 0, expense: e.Kind === 'Expense' ? num(e.Amount) : 0 });
  }
  for (const p of pays) {
    if (p.day < from) before += p.amount;
    else if (p.day <= to) rows.push({ date: p.day, kind: 'Income', category: 'Service fees', description: p.desc, party: p.who, method: p.method, source: 'invoice', income: p.amount, expense: 0 });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  const opening = (await openingBalance()) + before;
  let running = opening;
  for (const r of rows) { running += r.income - r.expense; r.balance = r2(running); }
  return { broughtForward: r2(opening), rows };
}

async function monthlySummary(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  const { rows } = await buildLedger(from, to);
  const income = {}, expenses = {};
  for (const r of rows) {
    const c = r.category || 'Other';
    if (r.income) income[c] = (income[c] || 0) + r.income;
    if (r.expense) expenses[c] = (expenses[c] || 0) + r.expense;
  }
  const invs = await loadInvoices();
  const ti = Object.values(income).reduce((a, b) => a + b, 0), te = Object.values(expenses).reduce((a, b) => a + b, 0);
  return {
    year, month, label: `${MONTHS[month - 1]} ${year}`, income, expenses, totalIncome: r2(ti), totalExpenses: r2(te), net: r2(ti - te),
    invoicedThisMonth: r2(invs.filter((i) => d10(i.Date).startsWith(from.slice(0, 7))).reduce((s, i) => s + i.totals.grand, 0)),
    outstandingNow: r2(invs.filter((i) => i.totals.balance > 0).reduce((s, i) => s + i.totals.balance, 0)),
  };
}

// ---------- reports ----------
async function financialReport(from, to) {
  const invs = await loadInvoices();
  const sectors = new Map((await q('SELECT Id,Name FROM Sectors')).map((s) => [s.Id, s.Name]));
  const agents = await q('SELECT * FROM Agents');
  const inRange = invs.filter((i) => d10(i.Date) >= from && d10(i.Date) <= to);
  const collected = r2(invs.reduce((s, i) => s + i.payments.filter((p) => d10(p.Date) >= from && d10(p.Date) <= to).reduce((a, p) => a + num(p.Amount), 0), 0));
  const bySector = {}, byStatus = {};
  for (const i of inRange) {
    const sec = i.applicant ? sectors.get(i.applicant.SectorId) || 'Unassigned' : 'Walk-in customers';
    const b = bySector[sec] || (bySector[sec] = { name: sec, invoices: 0, invoiced: 0, paid: 0 });
    b.invoices++; b.invoiced = r2(b.invoiced + i.totals.grand); b.paid = r2(b.paid + i.totals.paid);
    byStatus[i.Status] = (byStatus[i.Status] || 0) + 1;
  }
  const commissions = [];
  for (const ag of agents) {
    const mine = inRange.filter((i) => i.applicant && i.applicant.ReferralAgentId === ag.Id);
    if (!mine.length) continue;
    const base = mine.reduce((s, i) => s + i.totals.grand, 0);
    const gross = r2(base * (num(ag.CommissionPercent) / 100));
    const wht = num(ag.ApplyWht) ? r2(gross * (num(ag.WhtRatePercent) / 100)) : 0;
    commissions.push({ agent: ag.Name, invoices: mine.length, base: r2(base), percent: num(ag.CommissionPercent), gross, wht, net: r2(gross - wht) });
  }
  const trend = [];
  const now = new Date(db.today());
  for (let k = 11; k >= 0; k--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    trend.push({ month: key, invoiced: r2(invs.filter((i) => d10(i.Date).startsWith(key)).reduce((s, i) => s + i.totals.grand, 0)), collected: r2(invs.reduce((s, i) => s + i.payments.filter((p) => d10(p.Date).startsWith(key)).reduce((a, p) => a + num(p.Amount), 0), 0)) });
  }
  const statusCounts = {};
  for (const a of await q('SELECT Status FROM Applicants')) statusCounts[a.Status] = (statusCounts[a.Status] || 0) + 1;
  return {
    from, to,
    invoiced: r2(inRange.reduce((s, i) => s + i.totals.grand, 0)), collected,
    outstanding: r2(inRange.reduce((s, i) => s + Math.max(0, i.totals.balance), 0)), invoiceCount: inRange.length,
    bySector: Object.values(bySector), invoiceStatus: byStatus, applicantStatus: statusCounts, commissions, trend,
    register: inRange.map((i) => ({ number: i.InvoiceNumber, date: d10(i.Date), customer: i.CustomerName, total: i.totals.grand, paid: i.totals.paid, balance: i.totals.balance, status: i.Status })),
  };
}

// ---------- price list seed (same deterministic ids as the desktop app) ----------
function stableKey(text) {
  let h = 1469598103934665603n; const M = (1n << 64n) - 1n;
  for (let i = 0; i < text.length; i++) { h ^= BigInt(text.charCodeAt(i)); h = (h * 1099511628211n) & M; }
  return h.toString(16).padStart(16, '0');
}
async function seedCatalogIfNeeded() {
  if ((await q("SELECT 1 FROM SharedSettings WHERE Id='catalog.seeded'")).length) return;
  if ((await q('SELECT 1 FROM ServiceCatalog LIMIT 1')).length) return;
  const lists = require('./standard-lists.json');
  const base = '0001-01-01T00:00:00.000Z';
  for (const [cat, names] of lists.catalog) for (const name of names)
    await db.run('INSERT OR IGNORE INTO ServiceCatalog (Id,Category,Name,Price,IsActive,UpdatedAt) VALUES (?,?,?,0,1,?)', ['cat_' + stableKey(cat + '|' + name), cat, name, base]);
  await db.run("INSERT OR IGNORE INTO SharedSettings (Id,Value,UpdatedAt) VALUES ('catalog.seeded','1',?)", [base]);
}

const PROFILE_DEFAULTS = {
  'company.tagline': 'Expert in Flight Ticket & Visa Consultancy',
  'company.phone': '+94 722 222 084 | +94 262 223 546 | +94 726 737 717',
  'company.email': 'saireeyaaconsultancy@gmail.com',
  'company.website': 'www.saireeyaavisahub.com',
  'company.address': 'No. 820, A&B 1/1, Ahambaram Road, Trincomalee',
  'company.branches': '', 'company.services': '',
  'company.bank': 'Sai Reeyaa Consultancy (Pvt) Ltd\n1. Savings Account\nBank: Hatton National Bank (HNB)\nAccount Number: 225020095397\nBranch: Trinco Metro Branch',
  'company.terms': 'Please quote the invoice number with your payment. Services start once the registration / advance payment is received.\nMake all payments payable to Sai Reeyaa Consultancy (Pvt) Ltd.',
};
async function profile() {
  const out = {};
  for (const [k, d] of Object.entries(PROFILE_DEFAULTS)) out[k] = await db.getSetting(k, d);
  return out;
}

module.exports = { r2, d10, num, totals, statusFor, loadInvoices, nextInvoiceNumber, applyStatutory, slipTotals, syncSalaryToLedger, buildAlerts, buildLedger, monthlySummary, financialReport, seedCatalogIfNeeded, profile, PROFILE_DEFAULTS, openingBalance, daysFromToday, MONTHS };
