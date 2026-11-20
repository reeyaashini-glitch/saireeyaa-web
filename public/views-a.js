// Dashboard, applicants, cases board, calendar, reminders, follow-ups, services, agents.
A.views.dashboard = async (el) => {
  const d = await GET('/api/dashboard');
  const max = Math.max(1, ...d.stages.map((s) => s.count));
  el.innerHTML = `<div class="page-head"><h2>Dashboard</h2></div>
  <div class="stats"><div class="stat"><small>Applicants</small><b>${d.applicants}</b></div><div class="stat"><small>Active cases</small><b>${d.active}</b></div>
  <div class="stat"><small>Collected this month</small><b>${money(d.collectedMonth)}</b></div><div class="stat"><small>Invoiced this month</small><b>${money(d.invoicedMonth)}</b></div>
  <div class="stat"><small>Outstanding (${d.unpaid} invoices)</small><b>${money(d.outstanding)}</b></div></div>
  <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">Reminders & alerts</h3><a href="#/reminders">See all</a></div><div id="al">${A.alertRows(d.alerts)}</div></div>
  <div class="card"><h3>Case pipeline — time in current stage</h3><div class="tablewrap"><table><thead><tr><th>Stage</th><th class="num">Cases</th><th></th><th class="num">Avg days in stage</th></tr></thead><tbody>
  ${d.stages.map((s) => `<tr><td>${statusPill(s.status)}</td><td class="num">${s.count}</td><td style="width:40%"><div class="bar"><i style="width:${(s.count / max) * 100}%"></i></div></td><td class="num">${s.count ? s.avgDays : '—'}</td></tr>`).join('')}</tbody></table></div></div>`;
  A.wireAlerts(el, d.alerts, () => A.route());
};

A.views.reminders = async (el) => {
  const all = await GET('/api/alerts');
  let kind = '';
  const draw = () => {
    const kinds = [...new Set(all.map((a) => a.kind))];
    const list = all.filter((a) => !kind || a.kind === kind);
    el.innerHTML = `<div class="page-head"><h2>Reminders & alerts</h2><select id="k"><option value="">All types</option>${kinds.map((k) => `<option ${k === kind ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div>${A.alertRows(list)}`;
    $('#k', el).onchange = (e) => { kind = e.target.value; draw(); };
    A.wireAlerts(el, list, () => A.route());
  };
  draw();
};

A.views.followups = async (el) => {
  const [acts, apps] = await Promise.all([A.load('CaseActivities', true), A.load('Applicants', true)]);
  const name = (id) => (apps.find((a) => a.Id === id) || {}).FullName || '—';
  const today = todayStr();
  const open = acts.filter((a) => a.FollowUpDate && !Number(a.FollowUpCompleted)).sort((a, b) => d10(a.FollowUpDate).localeCompare(d10(b.FollowUpDate)));
  const group = (title, list) => `<div class="card"><h3>${title} (${list.length})</h3>${list.map((a) => `<div class="alert ${d10(a.FollowUpDate) < today ? 'overdue' : d10(a.FollowUpDate) === today ? 'soon' : ''}"><div class="t"><b>${esc(name(a.ApplicantId))}</b> — ${esc(a.Notes || a.Type)}<div class="muted">${esc(a.Type)} · due ${d10(a.FollowUpDate)} · ${esc(a.StaffName)}</div></div><button class="btn small" data-o="${a.ApplicantId}">Open</button><button class="btn small" data-x="${a.Id}">Done</button></div>`).join('') || '<p class="muted">None</p>'}</div>`;
  el.innerHTML = `<div class="page-head"><h2>Follow-ups</h2></div>${group('Overdue', open.filter((a) => d10(a.FollowUpDate) < today))}${group('Due today', open.filter((a) => d10(a.FollowUpDate) === today))}${group('Upcoming', open.filter((a) => d10(a.FollowUpDate) > today))}`;
  el.querySelectorAll('[data-o]').forEach((b) => (b.onclick = () => A.go('#/applicant/' + b.dataset.o)));
  el.querySelectorAll('[data-x]').forEach((b) => (b.onclick = async () => { await POST(`/api/activities/${b.dataset.x}/done`); A.bust(); toast('Done'); A.route(); }));
};

// ---------- applicants ----------
const COUNTRY_HINTS = ['Australia', 'United Kingdom', 'Canada', 'USA', 'New Zealand', 'Germany', 'France', 'Dubai / UAE', 'Malaysia', 'Singapore', 'India', 'Japan'];
async function applicantFields() {
  const [sectors, agents, users] = await Promise.all([A.load('Sectors'), A.load('Agents'), A.me.admin ? GET('/api/users') : Promise.resolve([])]);
  return [
    { k: 'FullName', label: 'Full name', req: 1 }, { k: 'Phone', label: 'Phone' }, { k: 'WhatsApp', label: 'WhatsApp number', hint: 'Leave blank if same as phone' }, { k: 'Email', label: 'Email' },
    { k: 'Address', label: 'Address', wide: 1 }, { k: 'PassportNumber', label: 'Passport number' }, { k: 'PassportExpiryDate', label: 'Passport expiry', type: 'date' },
    { k: 'DestinationCountry', label: 'Destination country', list: COUNTRY_HINTS },
    { k: 'SectorId', label: 'Service / visa type', type: 'select', options: [['', '— choose —'], ...sectors.filter((s) => Number(s.IsActive)).map((s) => [s.Id, s.Name])] },
    { k: 'Status', label: 'Status', type: 'select', options: A.meta.statuses.map((s) => [s, STATUS_LABEL[s]]) },
    { k: 'InterviewDate', label: 'Visa appointment / interview', type: 'date' },
    { k: 'AssignedStaff', label: 'Assigned staff', list: users.map((u) => u.FullName) },
    { k: 'ReferralAgentId', label: 'Referral agent', type: 'select', options: [['', '— none —'], ...agents.filter((a) => Number(a.IsActive)).map((a) => [a.Id, a.Name])] },
    { k: 'University', label: 'University' }, { k: 'Course', label: 'Course' }, { k: 'Intake', label: 'Intake' }, { k: 'AdmissionDeadline', label: 'Admission deadline', type: 'date' },
    { k: 'TravelStartDate', label: 'Travel start', type: 'date' }, { k: 'TravelEndDate', label: 'Travel end', type: 'date' }, { k: 'NumberOfTravelers', label: 'Number of travelers', type: 'number' },
    { k: 'FlightAirline', label: 'Airline' }, { k: 'FlightPnr', label: 'PNR' }, { k: 'TicketNumber', label: 'Ticket number' }, { k: 'FlightRoute', label: 'Flight route' }, { k: 'FlightDepartureDate', label: 'Departure date', type: 'date' },
    { k: 'ItineraryNotes', label: 'Itinerary notes', type: 'textarea' }, { k: 'Notes', label: 'Notes', type: 'textarea' },
  ];
}

A.views.applicants = async (el) => {
  const [rows, sectors] = await Promise.all([A.load('Applicants', true), A.load('Sectors')]);
  const sec = (id) => (sectors.find((s) => s.Id === id) || {}).Name || '';
  const st = { q: '', status: '' };
  const draw = () => {
    const list = rows.filter((r) => (!st.status || r.Status === st.status) && (!st.q || [r.FullName, r.Phone, r.PassportNumber, r.Email, r.DestinationCountry, r.University].join(' ').toLowerCase().includes(st.q.toLowerCase())))
      .sort((a, b) => d10(b.CreatedDate).localeCompare(d10(a.CreatedDate)));
    el.innerHTML = `<div class="page-head"><h2>Applicants</h2><button class="btn primary" id="add">+ New applicant</button></div>
    <div class="toolbar"><input id="q" placeholder="Search name, phone, passport..." value="${esc(st.q)}"><select id="s"><option value="">All statuses</option>${A.meta.statuses.map((s) => `<option value="${s}" ${st.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select><span class="muted">${list.length} shown</span></div>
    <div class="tablewrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Service</th><th>Destination</th><th>Status</th><th>Interview</th><th></th></tr></thead><tbody>
    ${list.map((r) => `<tr class="click" data-id="${r.Id}"><td><b>${esc(r.FullName)}</b><div class="muted">${esc(r.PassportNumber)}</div></td><td>${esc(r.Phone)}</td><td>${esc(sec(r.SectorId))}</td><td>${esc(r.DestinationCountry)}</td><td>${statusPill(r.Status)}</td><td>${d10(r.InterviewDate)}</td><td>${waLink(r.WhatsApp || r.Phone, '') ? `<button class="btn small green" data-wa="${r.Id}">WhatsApp</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted" style="padding:20px">No applicants found.</td></tr>'}</tbody></table></div>`;
    $('#q', el).oninput = (e) => { st.q = e.target.value; const p = e.target.selectionStart; draw(); const n = $('#q', el); n.focus(); n.setSelectionRange(p, p); };
    $('#s', el).onchange = (e) => { st.status = e.target.value; draw(); };
    $('#add', el).onclick = async () => {
      const v = await formModal('New applicant', await applicantFields(), { Status: 'Inquiry' }, { wide: 1, onSave: async (vals) => { window._newId = (await POST('/api/e/Applicants', vals)).id; } });
      if (v) { A.bust(); toast('Applicant added'); A.go('#/applicant/' + window._newId); }
    };
    el.querySelectorAll('tr.click').forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('[data-wa]')) return; A.go('#/applicant/' + tr.dataset.id); }));
    el.querySelectorAll('[data-wa]').forEach((b) => (b.onclick = () => { const r = rows.find((x) => x.Id === b.dataset.wa); openWA(r.WhatsApp || r.Phone, `Dear ${r.FullName}, this is Sai Reeyaa Consultancy. `); }));
  };
  draw();
};

A.views.applicant = async (el, [id]) => {
  const [apps, sectors, agents] = await Promise.all([A.load('Applicants', true), A.load('Sectors', true), A.load('Agents', true)]);
  let a = apps.find((x) => x.Id === id);
  if (!a) { el.innerHTML = '<div class="card">Applicant not found.</div>'; return; }
  const sector = sectors.find((s) => s.Id === a.SectorId);
  const tab = (A._appTab = A._appTab || 'details');
  const [acts, docs, hist, invs] = await Promise.all([A.load('CaseActivities', true), A.load('Documents', true), GET(`/api/applicants/${id}/history`), GET('/api/invoices')]);
  const myActs = acts.filter((x) => x.ApplicantId === id).sort((x, y) => d10(y.ActivityDate).localeCompare(d10(x.ActivityDate)));
  const myDocs = docs.filter((x) => x.ApplicantId === id);
  const myInv = invs.filter((i) => i.ApplicantId === id);
  const required = String(sector ? sector.RequiredDocumentTypes : '').split(',').map((s) => s.trim()).filter(Boolean);
  const tabs = [['details', 'Details'], ['status', 'Status & history'], ['activity', 'Activity & follow-ups'], ['documents', 'Documents'], ['invoices', 'Invoices']];
  const info = [['Phone', a.Phone], ['WhatsApp', a.WhatsApp], ['Email', a.Email], ['Address', a.Address], ['Passport', a.PassportNumber + (a.PassportExpiryDate ? ' (expires ' + d10(a.PassportExpiryDate) + ')' : '')], ['Destination', a.DestinationCountry], ['Service', sector ? sector.Name : ''], ['Assigned staff', a.AssignedStaff], ['Referral agent', (agents.find((g) => g.Id === a.ReferralAgentId) || {}).Name || ''], ['Interview', d10(a.InterviewDate)], ['University', a.University], ['Course', a.Course], ['Intake', a.Intake], ['Admission deadline', d10(a.AdmissionDeadline)], ['Travel', [d10(a.TravelStartDate), d10(a.TravelEndDate)].filter(Boolean).join(' → ')], ['Flight', [a.FlightAirline, a.FlightRoute, a.FlightPnr, a.TicketNumber].filter(Boolean).join(' · ')], ['Notes', a.Notes]].filter((r) => r[1]);
  const panel = {
    details: `<div class="card"><div class="grid2">${info.map(([k, v]) => `<div><div class="muted" style="font-size:11.5px;text-transform:uppercase">${k}</div>${esc(v)}</div>`).join('')}</div></div>`,
    status: `<div class="card"><h3>Move to another stage</h3><div class="toolbar"><select id="ns">${A.meta.statuses.map((s) => `<option value="${s}" ${s === a.Status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select><button class="btn primary" id="setst">Update status</button></div></div>
      <div class="card"><h3>History</h3><div class="tablewrap"><table><thead><tr><th>When</th><th>From</th><th>To</th></tr></thead><tbody>${hist.map((h) => `<tr><td>${d10(h.Timestamp)} ${String(h.Timestamp).slice(11, 16)}</td><td>${esc(STATUS_LABEL[h.FromStatus] || h.FromStatus || '—')}</td><td>${esc(STATUS_LABEL[h.ToStatus] || h.ToStatus)}</td></tr>`).join('')}</tbody></table></div></div>`,
    activity: `<div class="card"><div class="page-head" style="margin:0 0 10px"><h3 style="margin:0;margin-right:auto">Activity & follow-ups</h3><button class="btn primary" id="addact">+ Add activity</button></div>
      ${myActs.map((x) => `<div class="alert ${x.FollowUpDate && !Number(x.FollowUpCompleted) && d10(x.FollowUpDate) <= todayStr() ? 'overdue' : ''}"><div class="t"><b>${esc(x.Type)}</b> · ${d10(x.ActivityDate)} · ${esc(x.StaffName)}<div>${esc(x.Notes)}</div>${x.FollowUpDate ? `<div class="muted">Follow-up ${d10(x.FollowUpDate)} ${Number(x.FollowUpCompleted) ? '(done)' : ''}</div>` : ''}</div>${x.FollowUpDate && !Number(x.FollowUpCompleted) ? `<button class="btn small" data-done="${x.Id}">Done</button>` : ''}<button class="btn small danger" data-delact="${x.Id}">Delete</button></div>`).join('') || '<p class="muted">No activity logged yet.</p>'}</div>`,
    documents: `<div class="card"><div class="page-head" style="margin:0 0 10px"><h3 style="margin:0;margin-right:auto">Documents</h3><button class="btn primary" id="upl">⬆ Upload document</button></div>
      ${required.length ? `<h3 style="font-size:13px">Required for ${esc(sector.Name)}</h3><ul class="checklist">${required.map((r) => { const got = myDocs.filter((d) => d.DocType.toLowerCase() === r.toLowerCase()).length; return `<li>${got ? '✅' : '⬜'} ${esc(r)} ${got ? `<span class="muted">(${got})</span>` : '<span class="muted">— missing</span>'}</li>`; }).join('')}</ul>` : ''}
      <div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>Type</th><th>File</th><th>Uploaded</th><th>Expires</th><th></th></tr></thead><tbody>${myDocs.map((d) => `<tr><td>${esc(d.DocType)}</td><td><a href="/api/file/documents/${d.Id}" target="_blank">${esc(d.FileName)}</a></td><td>${d10(d.UploadDate)}</td><td>${d10(d.ExpiryDate)}</td><td><button class="btn small danger" data-deldoc="${d.Id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted" style="padding:16px">No documents uploaded.</td></tr>'}</tbody></table></div></div>`,
    invoices: `<div class="card"><div class="page-head" style="margin:0 0 10px"><h3 style="margin:0;margin-right:auto">Invoices</h3><button class="btn primary" id="newinv">+ New invoice</button></div><div class="tablewrap"><table><thead><tr><th>Number</th><th>Date</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th></tr></thead><tbody>${myInv.map((i) => `<tr class="click" data-inv="${i.Id}"><td>${esc(i.InvoiceNumber)}</td><td>${d10(i.Date)}</td><td class="num">${num2(i.totals.grand)}</td><td class="num">${num2(i.totals.balance)}</td><td>${payPill(i.Status)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted" style="padding:16px">No invoices.</td></tr>'}</tbody></table></div></div>`,
  };
  el.innerHTML = `<div class="page-head"><a href="#/applicants">← Applicants</a><h2 style="margin-left:8px">${esc(a.FullName)}</h2>${statusPill(a.Status)}
    ${waLink(a.WhatsApp || a.Phone, '') ? `<button class="btn green" id="wa">WhatsApp</button>` : ''}<button class="btn" id="edit">Edit details</button><button class="btn danger" id="del">Delete</button></div>
    <div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div>${panel[tab]}`;
  el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { A._appTab = b.dataset.t; A.route(); }));
  const w = $('#wa', el); if (w) w.onclick = () => openWA(a.WhatsApp || a.Phone, `Dear ${a.FullName}, this is Sai Reeyaa Consultancy. `);
  $('#edit', el).onclick = async () => { const v = await formModal('Edit applicant', await applicantFields(), a, { wide: 1, onSave: (vals) => PUT('/api/e/Applicants/' + id, vals) }); if (v) { A.bust(); toast('Saved'); A.route(); } };
  $('#del', el).onclick = async () => { if (await del('/api/e/Applicants/' + id, `${a.FullName} and all their records`)) { A.bust(); A.go('#/applicants'); } };
  const ss = $('#setst', el); if (ss) ss.onclick = async () => { await POST(`/api/applicants/${id}/status`, { status: $('#ns', el).value }); A.bust(); toast('Status updated'); A.route(); };
  const aa = $('#addact', el);
  if (aa) aa.onclick = async () => {
    const v = await formModal('Add activity', [
      { k: 'Type', label: 'Type', type: 'select', options: ['Call', 'WhatsApp', 'Email', 'Meeting', 'Consultation', 'Document request', 'Document received', 'Payment reminder', 'Follow-up', 'Note'] },
      { k: 'ActivityDate', label: 'Date', type: 'date' }, { k: 'Notes', label: 'Notes', type: 'textarea' }, { k: 'FollowUpDate', label: 'Follow-up date (optional)', type: 'date' },
    ], { ActivityDate: todayStr(), Type: 'Call' }, { onSave: (vals) => POST('/api/e/CaseActivities', { ...vals, ApplicantId: id, StaffName: A.me.name, FollowUpCompleted: 0 }) });
    if (v) { A.bust(); toast('Added'); A.route(); }
  };
  el.querySelectorAll('[data-done]').forEach((b) => (b.onclick = async () => { await POST(`/api/activities/${b.dataset.done}/done`); A.bust(); A.route(); }));
  el.querySelectorAll('[data-delact]').forEach((b) => (b.onclick = async () => { if (await del('/api/e/CaseActivities/' + b.dataset.delact, 'this activity')) { A.bust(); A.route(); } }));
  el.querySelectorAll('[data-deldoc]').forEach((b) => (b.onclick = async () => { if (await del('/api/e/Documents/' + b.dataset.deldoc, 'this document')) { A.bust(); A.route(); } }));
  const up = $('#upl', el);
  if (up) up.onclick = () => A.uploadDoc(id, required, () => { A.bust(); A.route(); });
  const ni = $('#newinv', el); if (ni) ni.onclick = () => A.go('#/invoice/new?applicant=' + id);
  el.querySelectorAll('[data-inv]').forEach((tr) => (tr.onclick = () => A.go('#/invoice/' + tr.dataset.inv)));
};

A.uploadDoc = async (applicantId, types, done) => {
  const all = [...new Set([...(types || []), 'Passport', 'Photograph', 'NIC', 'Bank Statement', 'Offer / Admission Letter', 'Educational Certificate', 'Visa Application', 'Other'])];
  const v = await formModal('Upload document', [{ k: 'DocType', label: 'Document type', list: all, req: 1 }, { k: 'ExpiryDate', label: 'Expiry date (optional)', type: 'date' }], { DocType: (types && types[0]) || 'Passport' }, {
    extra: '<label class="field"><span>File *</span><input type="file" id="ufile" required></label>',
    onSave: async (vals, bg) => {
      const f = bg.querySelector('#ufile').files[0]; if (!f) throw new Error('Choose a file');
      const fd = new FormData(); fd.append('ApplicantId', applicantId); fd.append('DocType', vals.DocType); fd.append('ExpiryDate', vals.ExpiryDate || ''); fd.append('file', f);
      await api('POST', '/api/documents', fd);
    },
  });
  if (v) { toast('Uploaded'); done(); }
};

// ---------- cases board ----------
A.views.cases = async (el) => {
  const [apps, sectors] = await Promise.all([A.load('Applicants', true), A.load('Sectors')]);
  const sec = (id) => (sectors.find((s) => s.Id === id) || {}).Name || '';
  el.innerHTML = `<div class="page-head"><h2>Cases board</h2><span class="muted">Click a client to see status, update it and upload documents.</span></div><div class="board">${A.meta.statuses.map((s) => `<div class="col"><h4>${STATUS_LABEL[s]}<span>${apps.filter((a) => a.Status === s).length}</span></h4>${apps.filter((a) => a.Status === s).map((a) => `<div class="cardlet" data-id="${a.Id}"><b>${esc(a.FullName)}</b><small>${esc(sec(a.SectorId))}${a.DestinationCountry ? ' · ' + esc(a.DestinationCountry) : ''}</small>${a.InterviewDate ? `<small>Interview ${d10(a.InterviewDate)}</small>` : ''}<select data-mv="${a.Id}" style="margin-top:6px;padding:3px;font-size:12px" onclick="event.stopPropagation()">${A.meta.statuses.map((x) => `<option value="${x}" ${x === s ? 'selected' : ''}>${STATUS_LABEL[x]}</option>`).join('')}</select></div>`).join('')}</div>`).join('')}</div>`;
  el.querySelectorAll('.cardlet').forEach((c) => (c.onclick = () => A.go('#/applicant/' + c.dataset.id)));
  el.querySelectorAll('[data-mv]').forEach((s) => (s.onchange = async () => { await POST(`/api/applicants/${s.dataset.mv}/status`, { status: s.value }); A.bust(); toast('Status updated'); A.route(); }));
};

// ---------- calendar ----------
A.calMonth = null;
A.views.calendar = async (el) => {
  const apps = await A.load('Applicants', true);
  const acts = await A.load('CaseActivities', true);
  const t = todayStr(); let [y, m] = (A.calMonth || t.slice(0, 7)).split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)), start = new Date(first); start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  const ev = {};
  const push = (d, text, id, cls) => { if (!d) return; const k = d10(d); (ev[k] = ev[k] || []).push({ text, id, cls }); };
  apps.forEach((a) => { push(a.InterviewDate, '🛂 ' + a.FullName, a.Id); push(a.AdmissionDeadline, '🎓 ' + a.FullName, a.Id); });
  acts.filter((x) => !Number(x.FollowUpCompleted)).forEach((x) => { const a = apps.find((p) => p.Id === x.ApplicantId); push(x.FollowUpDate, '📞 ' + (a ? a.FullName : ''), x.ApplicantId); });
  let cells = '';
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); const k = d.toISOString().slice(0, 10); cells += `<div class="day ${d.getUTCMonth() !== m - 1 ? 'out' : ''} ${k === t ? 'today' : ''}"><b>${d.getUTCDate()}</b>${(ev[k] || []).map((e) => `<div class="ev" data-id="${e.id}" title="${esc(e.text)}">${esc(e.text)}</div>`).join('')}</div>`; }
  el.innerHTML = `<div class="page-head"><h2>Calendar</h2><button class="btn" id="pv">◀</button><b>${MONTHS[m - 1]} ${y}</b><button class="btn" id="nx">▶</button><button class="btn" id="td">Today</button></div><p class="muted">🛂 visa appointment · 🎓 admission deadline · 📞 follow-up</p><div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="dh">${d}</div>`).join('')}${cells}</div>`;
  const mv = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); A.calMonth = d.toISOString().slice(0, 7); A.route(); };
  $('#pv', el).onclick = () => mv(-1); $('#nx', el).onclick = () => mv(1); $('#td', el).onclick = () => { A.calMonth = null; A.route(); };
  el.querySelectorAll('.ev').forEach((e) => (e.onclick = () => A.go('#/applicant/' + e.dataset.id)));
};

// ---------- services (sectors) & agents ----------
A.views.services = (el) => A.crud(el, {
  title: 'Services', single: 'service', entity: 'Sectors', label: (r) => r.Name,
  intro: 'Visa types and other services you offer, with the documents each one needs.',
  search: (r) => r.Name + r.Description,
  columns: [{ h: 'Name', r: (r) => `<b>${esc(r.Name)}</b><div class="muted">${esc(r.Description)}</div>` }, { h: 'Base fee', cls: 'num', r: (r) => num2(r.BaseFee) }, { h: 'Required documents', r: (r) => esc(r.RequiredDocumentTypes) }, { h: 'Active', r: (r) => (Number(r.IsActive) ? '<span class="pill green">Yes</span>' : '<span class="pill gray">No</span>') }],
  fields: [{ k: 'Name', label: 'Name', req: 1 }, { k: 'Description', label: 'Description' }, { k: 'BaseFee', label: 'Base fee (Rs.)', type: 'number' }, { k: 'IsActive', label: 'Active', type: 'check' }, { k: 'IsTourPackageType', label: 'Tour package (shows travel fields)', type: 'check' }, { k: 'IsAirTicketType', label: 'Air ticket (shows flight fields)', type: 'check' }, { k: 'RequiredDocumentTypes', label: 'Required documents (comma separated)', type: 'textarea', wide: 1 }],
  defaults: { IsActive: 1, BaseFee: 0 },
  extraHelp: true,
  onEditOpen: (bg) => {
    const ta = bg.querySelector('#f_RequiredDocumentTypes'); if (!ta) return;
    const wrap = document.createElement('div'); wrap.className = 'toolbar';
    wrap.innerHTML = '<button type="button" class="btn small" data-l="student">Load standard Student Visa checklist</button><button type="button" class="btn small" data-l="visit">Load standard Visit Visa checklist</button>';
    ta.parentElement.appendChild(wrap);
    wrap.querySelectorAll('button').forEach((b) => (b.onclick = () => { ta.value = A.meta.lists[b.dataset.l].map((x) => x[1]).join(', '); }));
  },
  beforeSave: (v) => v,
});
A.views.agents = (el) => A.crud(el, {
  title: 'Referral agents', single: 'agent', entity: 'Agents', label: (r) => r.Name, search: (r) => r.Name + r.Phone,
  columns: [{ h: 'Name', r: (r) => `<b>${esc(r.Name)}</b>` }, { h: 'Phone', r: (r) => esc(r.Phone) }, { h: 'Commission', cls: 'num', r: (r) => r.CommissionPercent + '%' }, { h: 'WHT', r: (r) => (Number(r.ApplyWht) ? r.WhtRatePercent + '%' : '—') }, { h: 'Active', r: (r) => (Number(r.IsActive) ? 'Yes' : 'No') }],
  fields: [{ k: 'Name', label: 'Name', req: 1 }, { k: 'Phone', label: 'Phone' }, { k: 'Email', label: 'Email' }, { k: 'CommissionPercent', label: 'Commission %', type: 'number' }, { k: 'ApplyWht', label: 'Deduct withholding tax', type: 'check' }, { k: 'WhtRatePercent', label: 'WHT rate %', type: 'number' }, { k: 'IsActive', label: 'Active', type: 'check' }, { k: 'Notes', label: 'Notes', type: 'textarea' }],
  defaults: { IsActive: 1, CommissionPercent: 0, WhtRatePercent: 0 },
});
