// Core helpers: API calls, forms/modals, router, navigation, printing.
const A = { me: null, views: {}, cache: {}, meta: null };
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => 'Rs. ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num2 = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const d10 = (v) => (v ? String(v).slice(0, 10) : '');
const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Colombo' });
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATUS_LABEL = { Inquiry: 'Inquiry', DocumentCollection: 'Document collection', Submitted: 'Submitted', VfsInterviewScheduled: 'VFS interview scheduled', Approved: 'Approved', Rejected: 'Rejected', Completed: 'Completed' };
const statusPill = (s) => `<span class="pill ${s === 'Approved' || s === 'Completed' ? 'green' : s === 'Rejected' ? 'red' : s === 'Inquiry' ? 'gray' : ''}">${esc(STATUS_LABEL[s] || s)}</span>`;
const payPill = (s) => `<span class="pill ${s === 'Paid' ? 'green' : s === 'PartiallyPaid' ? 'amber' : 'red'}">${s === 'PartiallyPaid' ? 'Partly paid' : esc(s)}</span>`;

function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = 'toast'), bad ? 5000 : 2600); }

async function api(method, url, body, headers) {
  const opt = { method, headers: { ...(headers || {}) } };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  if (r.status === 401 && url !== '/api/login') { A.showLogin(); throw new Error('Please sign in'); }
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) { const e = new Error((j && j.error) || 'Request failed'); e.status = r.status; e.body = j; throw e; }
  return j;
}
const GET = (u) => api('GET', u), POST = (u, b) => api('POST', u, b || {}), PUT = (u, b) => api('PUT', u, b || {});

// Delete with Admin approval for non-admins
async function del(url, what) {
  if (!(await confirmBox(`Delete ${what || 'this record'}? This cannot be undone.`))) return false;
  const attempt = async (h) => { try { await api('DELETE', url, undefined, h); return true; } catch (e) { if (e.body && e.body.needApproval) return e; throw e; } };
  let res = await attempt();
  while (res !== true) {
    const cred = await formModal('Admin approval needed', [{ k: 'u', label: 'Admin username', req: 1 }, { k: 'p', label: 'Admin password', type: 'password', req: 1 }], {}, { hint: res.message, ok: 'Approve & delete', keepOpenOnError: false });
    if (!cred) return false;
    try { res = await attempt({ 'x-admin-user': cred.u, 'x-admin-pass': cred.p }); } catch (e) { toast(e.message, true); return false; }
    if (res !== true) toast(res.message, true);
  }
  toast('Deleted'); return true;
}

// ---------- modals ----------
function modal(html, wide) {
  return new Promise((resolve) => {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal${wide ? ' wide' : ''}">${html}</div>`;
    $('#modals').appendChild(bg);
    const close = (v) => { bg.remove(); resolve(v); };
    bg._close = close;
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) bg._down = true; });
    bg.addEventListener('mouseup', (e) => { if (e.target === bg && bg._down) close(null); bg._down = false; });
    const f = bg.querySelector('input,select,textarea'); if (f) f.focus();
    bg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(null)));
    bg._el = bg.firstElementChild;
  });
}
function confirmBox(msg, ok = 'Yes') {
  return new Promise((resolve) => {
    modal(`<h3>Please confirm</h3><p>${esc(msg)}</p><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="cb-ok">${esc(ok)}</button></div>`).then(() => resolve(false));
    const bg = $('#modals').lastElementChild; bg.querySelector('#cb-ok').onclick = () => { bg._close(true); resolve(true); };
  });
}

// Field definition: {k,label,type: text|textarea|number|date|select|check|password, options:[[v,l]]|[v], req, wide, hint}
function fieldHtml(f, v) {
  const id = 'f_' + f.k, val = v === undefined || v === null ? '' : v;
  const wide = f.wide || f.type === 'textarea' ? ' wide' : '';
  if (f.type === 'check') return `<label class="field check${wide}"><input type="checkbox" id="${id}" ${val === true || val === 1 || val === '1' ? 'checked' : ''}><span>${esc(f.label)}</span></label>`;
  let ctl;
  if (f.type === 'textarea') ctl = `<textarea id="${id}" rows="${f.rows || 3}">${esc(val)}</textarea>`;
  else if (f.type === 'select') ctl = `<select id="${id}">${(f.options || []).map((o) => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`;
  else if (f.type === 'date') ctl = `<input type="date" id="${id}" value="${esc(d10(val))}">`;
  else if (f.type === 'number') ctl = `<input type="number" step="${f.step || 'any'}" id="${id}" value="${esc(val)}">`;
  else if (f.type === 'password') ctl = `<input type="password" id="${id}" autocomplete="new-password" value="${esc(val)}">`;
  else ctl = `<input id="${id}" value="${esc(val)}" ${f.list ? `list="dl_${id}"` : ''}>${f.list ? `<datalist id="dl_${id}">${f.list.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : ''}`;
  return `<label class="field${wide}"><span>${esc(f.label)}${f.req ? ' *' : ''}</span>${ctl}${f.hint ? `<small class="muted">${esc(f.hint)}</small>` : ''}</label>`;
}
function readFields(root, fields) {
  const out = {};
  for (const f of fields) { const el = root.querySelector('#f_' + f.k); if (!el) continue; out[f.k] = f.type === 'check' ? el.checked : el.value; }
  return out;
}
// Shows a form; resolves with the values (after onSave succeeds) or null if cancelled.
function formModal(title, fields, values = {}, opt = {}) {
  return new Promise((resolve) => {
    const html = `<h3>${esc(title)}</h3>${opt.hint ? `<p class="muted">${esc(opt.hint)}</p>` : ''}<form id="mf"><div class="form-grid">${fields.map((f) => fieldHtml(f, values[f.k])).join('')}</div>${opt.extra || ''}<div class="err" id="mferr"></div><div class="actions">${opt.extraButtons || ''}<button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${esc(opt.ok || 'Save')}</button></div></form>`;
    modal(html, opt.wide).then(() => resolve(null));
    const bg = $('#modals').lastElementChild, form = bg.querySelector('#mf');
    if (opt.onOpen) opt.onOpen(bg);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const v = readFields(bg, fields);
      for (const f of fields) if (f.req && !String(v[f.k] ?? '').trim()) { bg.querySelector('#mferr').textContent = `${f.label} is required`; return; }
      try { if (opt.onSave) await opt.onSave(v, bg); bg._close(v); resolve(v); } catch (er) { bg.querySelector('#mferr').textContent = er.message; }
    };
  });
}

// ---------- WhatsApp ----------
function waNumber(p) { let d = String(p || '').replace(/\D/g, ''); if (!d) return ''; if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = '94' + d.slice(1); return d; }
function waLink(phone, msg) { const n = waNumber(phone); return n.length >= 8 ? `https://wa.me/${n}?text=${encodeURIComponent(msg || '')}` : ''; }
function openWA(phone, msg) { const l = waLink(phone, msg); if (!l) return toast('No valid phone / WhatsApp number on file', true); window.open(l, '_blank', 'noopener'); }

// ---------- printing ----------
function printHtml(title, body, css = '') {
  const w = window.open('', '_blank');
  if (!w) return toast('Please allow pop-ups to print', true);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  body{font-family:"Segoe UI",Arial,sans-serif;font-size:12px;color:#111;margin:0;padding:24px}
  table{border-collapse:collapse;width:100%}@page{size:A4;margin:12mm}
  .navy{background:#0c2d6b;color:#fff;font-weight:700;text-transform:uppercase;font-size:11px;padding:6px 8px;text-align:left}
  ${css}</style></head><body>${body}<script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`);
  w.document.close();
}

// ---------- data cache (small lists used in dropdowns) ----------
A.load = async (name, force) => {
  if (!force && A.cache[name] && Date.now() - A.cache[name].t < 15000) return A.cache[name].v;
  const v = await GET('/api/e/' + name); A.cache[name] = { v, t: Date.now() }; return v;
};
A.bust = () => { A.cache = {}; };

// ---------- generic CRUD page ----------
// cfg: title, entity, columns [{h,r(row)->html,cls}], fields, defaults, search(row)->text, canAdd, onEditOpen
A.crud = async function (el, cfg) {
  const rows = await A.load(cfg.entity, true);
  const state = { q: '' };
  const draw = () => {
    const list = rows.filter((r) => !state.q || (cfg.search ? cfg.search(r) : JSON.stringify(r)).toLowerCase().includes(state.q.toLowerCase()));
    el.innerHTML = `<div class="page-head"><h2>${esc(cfg.title)}</h2>${cfg.head ? cfg.head : ''}<input id="q" placeholder="Search..." value="${esc(state.q)}" style="max-width:220px">${cfg.canAdd === false ? '' : `<button class="btn primary" id="add">+ Add</button>`}</div>${cfg.intro ? `<p class="muted">${cfg.intro}</p>` : ''}
    <div class="tablewrap"><table><thead><tr>${cfg.columns.map((c) => `<th class="${c.cls || ''}">${esc(c.h)}</th>`).join('')}<th></th></tr></thead><tbody>
    ${list.map((r) => `<tr>${cfg.columns.map((c) => `<td class="${c.cls || ''}">${c.r(r)}</td>`).join('')}<td class="row-actions" style="justify-content:flex-end"><button class="btn small" data-e="${esc(r.Id)}">Edit</button>${cfg.canDelete === false ? '' : `<button class="btn small danger" data-d="${esc(r.Id)}">Delete</button>`}${cfg.rowButtons ? cfg.rowButtons(r) : ''}</td></tr>`).join('') || `<tr><td colspan="${cfg.columns.length + 1}" class="muted" style="padding:20px">Nothing here yet.</td></tr>`}
    </tbody></table></div>`;
    $('#q', el).oninput = (e) => { state.q = e.target.value; const pos = e.target.selectionStart; draw(); const n = $('#q', el); n.focus(); n.setSelectionRange(pos, pos); };
    const add = $('#add', el); if (add) add.onclick = () => edit(null);
    el.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => edit(rows.find((r) => r.Id === b.dataset.e))));
    el.querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => { const r = rows.find((x) => x.Id === b.dataset.d); if (await del(`/api/e/${cfg.entity}/${r.Id}`, cfg.label ? cfg.label(r) : '')) reload(); }));
    if (cfg.afterDraw) cfg.afterDraw(el, rows, reload);
  };
  const reload = async () => { const fresh = await A.load(cfg.entity, true); rows.length = 0; rows.push(...fresh); draw(); };
  async function edit(row) {
    const fields = typeof cfg.fields === 'function' ? await cfg.fields(row) : cfg.fields;
    const v = await formModal((row ? 'Edit ' : 'Add ') + (cfg.single || cfg.title), fields, row || cfg.defaults || {}, {
      wide: cfg.wide, onOpen: cfg.onEditOpen,
      onSave: async (vals) => { const body = cfg.beforeSave ? cfg.beforeSave(vals, row) : vals; if (row) await PUT(`/api/e/${cfg.entity}/${row.Id}`, body); else await POST(`/api/e/${cfg.entity}`, body); },
    });
    if (v) { toast('Saved'); A.bust(); reload(); }
  }
  A.reloadCurrent = reload;
  draw();
};

// ---------- router & navigation ----------
const NAV = [
  ['#/dashboard', 'Dashboard'], ['#/applicants', 'Applicants'], ['#/cases', 'Cases board'], ['#/calendar', 'Calendar'], ['#/reminders', 'Reminders'], ['#/followups', 'Follow-ups'],
  ['sep', 'Billing'], ['#/invoices', 'Invoices'], ['#/accounts', 'Accounts'], ['#/pricelist', 'Price list'], ['#/reports', 'Reports', 'accounts'],
  ['sep', 'Records'], ['#/documents', 'Documents'], ['#/services', 'Services'], ['#/agents', 'Referral agents'],
  ['sep', 'Admin'], ['#/payroll', 'Payroll', 'payroll'], ['#/users', 'Users', 'admin'], ['#/audit', 'Audit log', 'audit'], ['#/company', 'Company & settings', 'manage'],
];
A.renderNav = () => {
  const m = A.me, can = { accounts: m.accounts, payroll: m.payroll, admin: m.admin, audit: m.audit, manage: m.admin || m.roles.includes('Manager') };
  const cur = location.hash.split('/')[1];
  $('#nav').innerHTML = NAV.filter((n) => !n[2] || can[n[2]]).map((n) => n[0] === 'sep' ? `<div class="sep">${n[1]}</div>` : `<a href="${n[0]}" class="${n[0].split('/')[1] === cur ? 'active' : ''}" onclick="A.closeNav()">${n[1]}</a>`).join('');
};
A.toggleNav = () => $('#nav').classList.toggle('open');
A.closeNav = () => $('#nav').classList.remove('open');
A.go = (h) => { if (location.hash === h) A.route(); else location.hash = h; };

A.route = async () => {
  if (!A.me) return;
  const parts = (location.hash || '#/dashboard').slice(2).split('/');
  const name = parts[0] || 'dashboard';
  A.renderNav();
  const main = $('#main');
  const v = A.views[name];
  if (!v) { main.innerHTML = '<div class="card">Page not found.</div>'; return; }
  main.innerHTML = '<p class="muted">Loading...</p>';
  const token = (A.routeToken = (A.routeToken || 0) + 1);
  try { await v(main, parts.slice(1), token); } catch (e) { if (token === A.routeToken) main.innerHTML = `<div class="card"><b>Could not load this page.</b><p class="err">${esc(e.message)}</p></div>`; }
  window.scrollTo(0, 0);
};

A.showLogin = () => { A.me = null; $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); };
A.login = async (e) => {
  e.preventDefault(); $('#lerr').textContent = '';
  try { await POST('/api/login', { username: $('#lu').value, password: $('#lp').value }); $('#lp').value = ''; await A.boot(); } catch (er) { $('#lerr').textContent = er.message; }
};
A.logout = async () => { await POST('/api/logout'); A.bust(); A.showLogin(); };
A.boot = async () => {
  A.me = await GET('/api/me'); A.meta = await GET('/api/meta');
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#whoami').textContent = `${A.me.name} (${A.me.roles.join(' + ')})`;
  if (!location.hash) location.hash = '#/dashboard'; else A.route();
};
A.start = async () => {
  window.addEventListener('hashchange', A.route);
  try { await A.boot(); } catch { A.showLogin(); }
};

// alert rows (shared by Dashboard & Reminders)
A.alertRows = (alerts) => alerts.map((a, i) => `<div class="alert ${a.severity}"><div class="t"><div class="kind">${esc(a.kind)}</div>${esc(a.title)}</div>
  ${a.phone ? `<button class="btn small green" data-wa="${i}">WhatsApp</button>` : ''}${a.applicantId || a.invoiceId ? `<button class="btn small" data-open="${i}">Open</button>` : ''}${a.activityId ? `<button class="btn small" data-done="${i}">Done</button>` : ''}</div>`).join('') || '<p class="muted">Nothing needs attention. 🎉</p>';
A.wireAlerts = (root, alerts, refresh) => {
  root.querySelectorAll('[data-wa]').forEach((b) => (b.onclick = () => { const a = alerts[b.dataset.wa]; openWA(a.phone, a.message); }));
  root.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => { const a = alerts[b.dataset.open]; A.go(a.invoiceId ? '#/invoice/' + a.invoiceId : '#/applicant/' + a.applicantId); }));
  root.querySelectorAll('[data-done]').forEach((b) => (b.onclick = async () => { await POST(`/api/activities/${alerts[b.dataset.done].activityId}/done`); toast('Marked done'); refresh(); }));
};
