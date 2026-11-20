// Invoices (list + editor + printing) and documents.
A.views.invoices = async (el) => {
  const invs = await GET('/api/invoices');
  const st = { q: '', s: '' };
  const draw = () => {
    const list = invs.filter((i) => (!st.s || i.Status === st.s) && (!st.q || (i.InvoiceNumber + i.CustomerName).toLowerCase().includes(st.q.toLowerCase())));
    const tot = list.reduce((a, i) => ({ g: a.g + i.totals.grand, p: a.p + i.totals.paid, b: a.b + i.totals.balance }), { g: 0, p: 0, b: 0 });
    el.innerHTML = `<div class="page-head"><h2>Invoices</h2><button class="btn primary" id="new">+ New invoice</button></div>
    <div class="toolbar"><input id="q" placeholder="Search number or customer..." value="${esc(st.q)}"><select id="s"><option value="">All</option><option value="Unpaid" ${st.s === 'Unpaid' ? 'selected' : ''}>Unpaid</option><option value="PartiallyPaid" ${st.s === 'PartiallyPaid' ? 'selected' : ''}>Partly paid</option><option value="Paid" ${st.s === 'Paid' ? 'selected' : ''}>Paid</option></select>
    <span class="muted">${list.length} invoices · total ${money(tot.g)} · paid ${money(tot.p)} · balance ${money(tot.b)}</span></div>
    <div class="tablewrap"><table><thead><tr><th>Number</th><th>Date</th><th>Customer</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th></tr></thead><tbody>
    ${list.map((i) => `<tr class="click" data-id="${i.Id}"><td><b>${esc(i.InvoiceNumber)}</b></td><td>${d10(i.Date)}</td><td>${esc(i.CustomerName)}</td><td class="num">${num2(i.totals.grand)}</td><td class="num">${num2(i.totals.paid)}</td><td class="num">${num2(i.totals.balance)}</td><td>${payPill(i.Status)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted" style="padding:20px">No invoices.</td></tr>'}</tbody></table></div>`;
    $('#q', el).oninput = (e) => { st.q = e.target.value; const p = e.target.selectionStart; draw(); const n = $('#q', el); n.focus(); n.setSelectionRange(p, p); };
    $('#s', el).onchange = (e) => { st.s = e.target.value; draw(); };
    $('#new', el).onclick = () => A.go('#/invoice/new');
    el.querySelectorAll('tr.click').forEach((tr) => (tr.onclick = () => A.go('#/invoice/' + tr.dataset.id)));
  };
  draw();
};

A.views.invoice = async (el, [raw]) => {
  const [idPart, qs] = String(raw || 'new').split('?');
  const isNew = idPart === 'new';
  const [apps, sectors, company] = await Promise.all([A.load('Applicants', true), A.load('Sectors'), GET('/api/company')]);
  const vat = !!Number(company.settings.IsVatRegistered);
  let inv;
  if (isNew) {
    const pre = new URLSearchParams(qs || '').get('applicant') || '';
    inv = { Id: '', InvoiceNumber: '', ApplicantId: pre, Date: todayStr(), DateOfSupply: todayStr(), DueDate: '', CustomerTin: '', DiscountPercent: 0, TaxPercent: 0, Notes: '', WalkInName: '', WalkInPhone: '', WalkInEmail: '', items: [{ Description: '', Quantity: 1, UnitPrice: 0, ForName: '' }], payments: [], installments: [] };
  } else inv = await GET('/api/invoices/' + idPart);
  let walkIn = !inv.ApplicantId && (!isNew || false);
  if (isNew && !inv.ApplicantId) walkIn = false;
  const sorted = [...apps].sort((a, b) => a.FullName.localeCompare(b.FullName));
  const calc = () => {
    const sub = inv.items.reduce((s, i) => s + (Number(i.Quantity) || 0) * (Number(i.UnitPrice) || 0), 0);
    const disc = Math.round(sub * (Number(inv.DiscountPercent) || 0)) / 100, taxable = sub - disc, tax = Math.round(taxable * (Number(inv.TaxPercent) || 0)) / 100;
    const grand = taxable + tax, paid = inv.payments.reduce((s, p) => s + Number(p.Amount), 0);
    return { sub, disc, tax, grand, paid, bal: grand - paid };
  };
  const draw = () => {
    const t = calc();
    el.innerHTML = `<div class="page-head"><a href="#/invoices">← Invoices</a><h2 style="margin-left:8px">${isNew ? 'New invoice' : 'Invoice ' + esc(inv.InvoiceNumber)}</h2>${isNew ? '' : payPill(inv.Status)}
      ${isNew ? '' : '<button class="btn" id="print">🖨 Print / PDF</button><button class="btn green" id="wa">WhatsApp</button>'}<button class="btn primary" id="save">Save invoice</button></div>
    <div class="card"><div class="form-grid">
      <label class="field"><span>Invoice number</span><input value="${esc(inv.InvoiceNumber || '(assigned when saved)')}" disabled></label>
      <label class="field"><span>Customer</span><select id="cust" ${walkIn ? 'disabled' : ''}><option value="">— choose registered applicant —</option>${sorted.map((a) => `<option value="${a.Id}" ${a.Id === inv.ApplicantId ? 'selected' : ''}>${esc(a.FullName)}</option>`).join('')}</select>
        <label style="margin-top:6px;display:flex;gap:6px;align-items:center"><input type="checkbox" id="walk" ${walkIn ? 'checked' : ''}> Walk-in customer (not registered)</label></label>
      <label class="field"><span>Invoice date</span><input type="date" id="date" value="${d10(inv.Date)}"></label>
      ${vat ? `<label class="field"><span>Date of supply</span><input type="date" id="sup" value="${d10(inv.DateOfSupply)}"></label><label class="field"><span>Customer TIN (VAT-registered business clients only)</span><input id="tin" value="${esc(inv.CustomerTin)}"></label>` : ''}
      <label class="field"><span>Payment due date (optional)</span><input type="date" id="due" value="${d10(inv.DueDate)}"></label>
      ${walkIn ? `<label class="field"><span>Customer name *</span><input id="wn" value="${esc(inv.WalkInName)}"></label><label class="field"><span>Phone / WhatsApp</span><input id="wp" value="${esc(inv.WalkInPhone)}"></label><label class="field"><span>Email</span><input id="we" value="${esc(inv.WalkInEmail)}"></label>` : ''}
    </div></div>
    <div class="card items"><h3>Items</h3><div class="tablewrap"><table><thead><tr><th>Description</th><th>For (traveller)</th><th style="width:70px">Qty</th><th style="width:130px">Unit price (Rs.)</th><th class="num" style="width:120px">Line total</th><th></th></tr></thead><tbody>
      ${inv.items.map((it, k) => `<tr><td><input data-k="${k}" data-f="Description" value="${esc(it.Description)}"></td><td><input data-k="${k}" data-f="ForName" value="${esc(it.ForName || '')}"></td><td><input type="number" min="1" data-k="${k}" data-f="Quantity" value="${esc(it.Quantity)}"></td><td><input type="number" step="any" data-k="${k}" data-f="UnitPrice" value="${esc(it.UnitPrice)}"></td><td class="num">${num2((Number(it.Quantity) || 0) * (Number(it.UnitPrice) || 0))}</td><td><button class="btn small danger" data-rm="${k}">✕</button></td></tr>`).join('')}</tbody></table></div>
      <div class="toolbar" style="margin-top:10px"><button class="btn" id="addl">+ Add line</button><button class="btn" id="pl">🏷 From price list...</button><button class="btn" id="fam">👪 Add family / group members</button><button class="btn" id="sf">Use service base fee</button></div></div>
    <div class="card"><div class="page-head" style="margin:0 0 8px"><h3 style="margin:0;margin-right:auto">Payment history</h3>${isNew ? '' : '<button class="btn" id="plan">📅 Payment plan...</button><button class="btn primary" id="rec">+ Record payment</button>'}</div>
      ${isNew ? '<p class="muted">Save the invoice first, then record payments here.</p>' : `<div class="tablewrap"><table><thead><tr><th>Date</th><th class="num">Amount</th><th>For</th><th>Method</th><th>Notes</th><th></th></tr></thead><tbody>${inv.payments.map((p) => `<tr><td>${d10(p.Date)}</td><td class="num">${num2(p.Amount)}</td><td>${esc(p.ServiceDescription)}</td><td>${esc(p.Method)}</td><td>${esc(p.Notes)}</td><td class="row-actions"><button class="btn small" data-rc="${p.Id}">Receipt</button><button class="btn small danger" data-rp="${p.Id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted" style="padding:14px">No payments recorded yet.</td></tr>'}</tbody></table></div>
      ${inv.installments && inv.installments.length ? `<h3 style="font-size:13px;margin-top:12px">Payment plan</h3>${inv.installments.map((i) => `<div class="alert ${i.PaymentId ? '' : d10(i.DueDate) < todayStr() ? 'overdue' : ''}"><div class="t">${esc(i.Label)} — ${money(i.Amount)} due ${d10(i.DueDate)}</div>${i.PaymentId ? '<span class="pill green">Paid</span>' : `<button class="btn small" data-ip="${i.Id}">Mark paid</button>`}</div>`).join('')}` : ''}`}</div>
    <div class="grid2"><div class="card"><label class="field"><span>Notes</span><textarea id="notes" rows="4">${esc(inv.Notes)}</textarea></label></div>
    <div class="card"><div class="form-grid"><label class="field"><span>Discount %</span><input type="number" step="any" id="dp" value="${esc(inv.DiscountPercent)}"></label><label class="field"><span>${vat ? 'VAT' : 'Tax'} %</span><input type="number" step="any" id="tp" value="${esc(inv.TaxPercent)}"></label></div>
      <div class="totals"><div><span>Subtotal</span><span>${num2(t.sub)}</span></div>${t.disc ? `<div><span>Discount</span><span>- ${num2(t.disc)}</span></div>` : ''}${t.tax ? `<div><span>${vat ? 'VAT' : 'Tax'}</span><span>${num2(t.tax)}</span></div>` : ''}<div class="big"><span>Grand total</span><span>${num2(t.grand)}</span></div><div><span>Paid</span><span>${num2(t.paid)}</span></div><div><b>Balance due</b><b>${num2(t.bal)}</b></div></div></div></div>
    ${isNew ? '' : '<div style="text-align:right"><button class="btn danger" id="delinv">Delete invoice</button></div>'}`;
    wire();
  };
  const grab = () => { // copy inputs into the model before re-drawing
    el.querySelectorAll('[data-k]').forEach((i) => { inv.items[i.dataset.k][i.dataset.f] = i.value; });
    const g = (id) => { const n = $('#' + id, el); return n ? n.value : undefined; };
    if (g('date') !== undefined) inv.Date = g('date'); if (g('sup') !== undefined) inv.DateOfSupply = g('sup'); if (g('tin') !== undefined) inv.CustomerTin = g('tin'); if (g('due') !== undefined) inv.DueDate = g('due');
    if (g('wn') !== undefined) { inv.WalkInName = g('wn'); inv.WalkInPhone = g('wp'); inv.WalkInEmail = g('we'); }
    if (g('dp') !== undefined) { inv.DiscountPercent = g('dp'); inv.TaxPercent = g('tp'); inv.Notes = g('notes'); }
    if (g('cust') !== undefined && !walkIn) inv.ApplicantId = g('cust');
  };
  const wire = () => {
    const redraw = () => { grab(); draw(); };
    el.querySelectorAll('[data-k]').forEach((i) => (i.onchange = redraw));
    ['dp', 'tp'].forEach((id) => { $('#' + id, el).onchange = redraw; });
    $('#walk', el).onchange = (e) => { grab(); walkIn = e.target.checked; if (walkIn) inv.ApplicantId = ''; draw(); };
    $('#cust', el).onchange = () => { grab(); };
    el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { grab(); inv.items.splice(+b.dataset.rm, 1); if (!inv.items.length) inv.items.push({ Description: '', Quantity: 1, UnitPrice: 0, ForName: '' }); draw(); }));
    $('#addl', el).onclick = () => { grab(); inv.items.push({ Description: '', Quantity: 1, UnitPrice: 0, ForName: '' }); draw(); };
    $('#pl', el).onclick = async () => {
      grab();
      const cat = await GET('/api/catalog'); const active = cat.filter((c) => Number(c.IsActive));
      const v = await formModal('Add from price list', [{ k: 'item', label: 'Service', type: 'select', options: active.map((c) => [c.Id, `${c.Category} — ${c.Name}${Number(c.Price) ? ' (Rs. ' + num2(c.Price) + ')' : ''}`]) }, { k: 'q', label: 'Quantity', type: 'number' }], { q: 1 });
      if (v) { const c = cat.find((x) => x.Id === v.item); const blank = inv.items.length === 1 && !inv.items[0].Description; const line = { Description: c.Name, Quantity: v.q || 1, UnitPrice: c.Price, ForName: '' }; if (blank) inv.items[0] = line; else inv.items.push(line); draw(); }
    };
    $('#fam', el).onclick = async () => {
      grab();
      const v = await formModal('Add family / group members', [], {}, { extra: `<p class="muted">Tick everyone who should get a line at their service's base fee. The invoice stays in the main customer's name.</p><div style="max-height:300px;overflow:auto">${sorted.map((a) => `<label style="display:flex;gap:8px;padding:3px 0"><input type="checkbox" class="fm" value="${a.Id}"> ${esc(a.FullName)}</label>`).join('')}</div>`, ok: 'Add lines', onSave: async (vals) => { vals.__ids = [...document.querySelectorAll('.fm')].filter((c) => c.checked).map((c) => c.value); } });
      if (v) {
        const ids = v.__ids || [];
        const blank = inv.items.length === 1 && !inv.items[0].Description; if (blank) inv.items = [];
        ids.forEach((id) => { const p = apps.find((x) => x.Id === id); const s = p && sectors.find((x) => x.Id === p.SectorId); inv.items.push({ Description: s ? s.Name : 'Service', Quantity: 1, UnitPrice: s ? s.BaseFee : 0, ForName: p.FullName }); });
        if (!inv.items.length) inv.items.push({ Description: '', Quantity: 1, UnitPrice: 0, ForName: '' });
        draw();
      }
    };
    $('#sf', el).onclick = () => {
      grab(); const a = apps.find((x) => x.Id === inv.ApplicantId); const s = a && sectors.find((x) => x.Id === a.SectorId);
      if (!s) return toast('Choose an applicant that has a service first', true);
      const blank = inv.items.length === 1 && !inv.items[0].Description; const line = { Description: s.Name, Quantity: 1, UnitPrice: s.BaseFee, ForName: '' }; if (blank) inv.items[0] = line; else inv.items.push(line); draw();
    };
    $('#save', el).onclick = async () => {
      grab();
      const body = { ...inv, ApplicantId: walkIn ? '' : inv.ApplicantId };
      try { const r = isNew ? await POST('/api/invoices', body) : await PUT('/api/invoices/' + inv.Id, body); toast('Invoice saved'); A.bust(); if (isNew) A.go('#/invoice/' + r.id); else A.route(); } catch (e) { toast(e.message, true); }
    };
    if (isNew) return;
    $('#print', el).onclick = async () => { const fresh = await GET('/api/invoices/' + inv.Id); A.printInvoice(fresh, company, apps); };
    $('#wa', el).onclick = () => { const a = apps.find((x) => x.Id === inv.ApplicantId); const t = calc(); openWA(a ? a.WhatsApp || a.Phone : inv.WalkInPhone, `Dear ${a ? a.FullName : inv.WalkInName}, your invoice ${inv.InvoiceNumber} from Sai Reeyaa Consultancy: total ${money(t.grand)}, paid ${money(t.paid)}, balance ${money(t.bal)}. Thank you.`); };
    $('#rec', el).onclick = () => A.recordPayment(inv, t0(), () => A.route());
    el.querySelectorAll('[data-rp]').forEach((b) => (b.onclick = async () => { if (await del('/api/payments/' + b.dataset.rp, 'this payment')) { A.bust(); A.route(); } }));
    el.querySelectorAll('[data-rc]').forEach((b) => (b.onclick = () => A.printReceipt(inv, inv.payments.find((p) => p.Id === b.dataset.rc), company, apps)));
    el.querySelectorAll('[data-ip]').forEach((b) => (b.onclick = async () => { try { await POST(`/api/installments/${b.dataset.ip}/pay`, {}); toast('Payment recorded'); A.route(); } catch (e) { toast(e.message, true); } }));
    $('#plan', el).onclick = () => A.paymentPlan(inv, calc().bal, () => A.route());
    $('#delinv', el).onclick = async () => { if (await del('/api/invoices/' + inv.Id, 'invoice ' + inv.InvoiceNumber)) { A.bust(); A.go('#/invoices'); } };
  };
  const t0 = () => calc();
  draw();
};

A.recordPayment = async (inv, t, done) => {
  const go = async (vals, confirmOver) => POST(`/api/invoices/${inv.Id}/payments`, { ...vals, confirmOver });
  const v = await formModal('Record payment', [
    { k: 'Amount', label: 'Amount (Rs.)', type: 'number', req: 1 }, { k: 'Date', label: 'Date', type: 'date' },
    { k: 'Method', label: 'Method', type: 'select', options: ['Cash', 'Bank transfer', 'Card', 'Online', 'Cheque'] },
    { k: 'ServiceDescription', label: 'What is this payment for? (optional)' }, { k: 'Notes', label: 'Notes', type: 'textarea' },
  ], { Amount: t.bal > 0 ? Math.round(t.bal * 100) / 100 : '', Date: todayStr(), Method: 'Cash' }, {
    hint: `Balance due: ${money(t.bal)}`,
    onSave: async (vals) => { try { await go(vals, false); } catch (e) { if (e.status === 409 && (await confirmBox(e.message, 'Record anyway'))) await go(vals, true); else throw e; } },
  });
  if (v) { toast('Payment recorded'); A.bust(); done(); }
};

A.paymentPlan = async (inv, balance, done) => {
  let rows = (inv.installments || []).map((x) => ({ ...x }));
  const body = () => `<div class="muted" style="margin-bottom:8px">Invoice balance: ${money(balance)}. Paid instalments cannot be changed.</div>
  <div class="toolbar"><input id="n" type="number" min="1" placeholder="No. of instalments" style="width:150px"><input id="first" type="date" style="width:160px"><input id="gap" type="number" placeholder="Days between" value="30" style="width:130px"><button type="button" class="btn" id="split">Split evenly</button></div>
  <table><thead><tr><th>Label</th><th>Amount</th><th>Due date</th><th></th></tr></thead><tbody>${rows.map((r, k) => `<tr><td><input data-k="${k}" data-f="Label" value="${esc(r.Label)}" ${r.PaymentId ? 'disabled' : ''}></td><td><input type="number" step="any" data-k="${k}" data-f="Amount" value="${esc(r.Amount)}" ${r.PaymentId ? 'disabled' : ''}></td><td><input type="date" data-k="${k}" data-f="DueDate" value="${d10(r.DueDate)}" ${r.PaymentId ? 'disabled' : ''}></td><td>${r.PaymentId ? '✅' : `<button type="button" class="btn small danger" data-x="${k}">✕</button>`}</td></tr>`).join('')}</tbody></table>
  <button type="button" class="btn" id="addr" style="margin-top:8px">+ Add instalment</button>`;
  const v = await formModal('Payment plan', [], {}, { wide: 1, ok: 'Save plan', extra: `<div id="pp">${body()}</div>`,
    onOpen: (bg) => {
      const sync = () => bg.querySelectorAll('[data-k]').forEach((i) => { rows[i.dataset.k][i.dataset.f] = i.value; });
      const redraw = () => { sync(); bg.querySelector('#pp').innerHTML = body(); bind(); };
      const bind = () => {
        bg.querySelector('#addr').onclick = () => { sync(); rows.push({ Label: 'Instalment ' + (rows.length + 1), Amount: '', DueDate: '' }); redraw(); };
        bg.querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => { sync(); rows.splice(+b.dataset.x, 1); redraw(); }));
        bg.querySelector('#split').onclick = () => {
          const n = parseInt(bg.querySelector('#n').value, 10), first = bg.querySelector('#first').value, gap = parseInt(bg.querySelector('#gap').value, 10) || 30; sync();
          if (!n || n < 1 || !first) return toast('Enter the number of instalments and the first due date', true);
          const paidRows = rows.filter((r) => r.PaymentId); const remaining = balance; const each = Math.floor((remaining / n) * 100) / 100;
          rows = [...paidRows]; for (let k = 0; k < n; k++) { const d = new Date(first + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + gap * k); rows.push({ Label: `Instalment ${k + 1}`, Amount: k === n - 1 ? Math.round((remaining - each * (n - 1)) * 100) / 100 : each, DueDate: d.toISOString().slice(0, 10) }); }
          redraw();
        };
      };
      bind();
    },
    onSave: async (vals, bg) => { bg.querySelectorAll('[data-k]').forEach((i) => { rows[i.dataset.k][i.dataset.f] = i.value; }); await PUT(`/api/invoices/${inv.Id}/installments`, { items: rows }); } });
  if (v) { toast('Payment plan saved'); done(); }
};

// ---------- printing ----------
A.customerId = (inv, apps) => { if (!inv.ApplicantId) return 'WALK-IN'; const o = [...apps].sort((a, b) => d10(a.CreatedDate).localeCompare(d10(b.CreatedDate)) || a.Id.localeCompare(b.Id)); const i = o.findIndex((a) => a.Id === inv.ApplicantId); return i < 0 ? '' : 'C-' + String(i + 1).padStart(4, '0'); };
const INV_CSS = `.hd{display:flex;align-items:flex-start;gap:12px}.hd img{height:84px}.co b{font-size:17px;color:#0c2d6b}.co div{font-size:11.5px;line-height:1.5}
.ti{margin-left:auto;text-align:right}.ti h1{margin:0 0 6px;font-size:34px;color:#1c64c0;letter-spacing:.5px}.ti table{width:auto;margin-left:auto;border:1px solid #b9c6db}.ti td{border:1px solid #b9c6db;padding:3px 10px;font-size:11px}.ti td:first-child{background:#eef3fa;color:#0c2d6b;font-weight:700;text-align:right}.ti td:last-child{text-align:center;min-width:90px}
.rule{border-top:3px solid #0c2d6b;margin:8px 0 12px}.rule.red{border-color:#e01b24;margin:12px 0}
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.box .navy{} .box .body{border:1px solid #b9c6db;border-top:0;padding:7px 8px;min-height:64px;font-size:12px;line-height:1.5}
.info{margin:12px 0;border:1px solid #b9c6db}.info td,.items td{border-right:1px solid #b9c6db;border-bottom:1px solid #b9c6db;padding:6px 8px;font-size:12px;height:26px}.info td:last-child,.items td:last-child{border-right:0}
.info td.navy,.items td.navy{height:auto;padding:5px 8px;border-right:0}.items{border:1px solid #b9c6db;margin-bottom:12px}.items td.n{text-align:right;white-space:nowrap}
.low{display:grid;grid-template-columns:1.25fr 1fr;gap:14px}.tot{border:1px solid #b9c6db;align-self:start}.tot td{padding:6px 8px;border-bottom:1px solid #b9c6db;font-size:12px}.tot td:first-child{background:#eef3fa;color:#0c2d6b;font-weight:700;text-align:right}.tot td:last-child{text-align:right}.tot tr.dk td{background:#0c2d6b;color:#fff;font-weight:700;font-size:13px}
.q{margin:12px 0 8px;font-size:11.5px}.pay{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}.pay .box:nth-child(1),.pay .box:nth-child(3){visibility:hidden}.hist td,.hist th{border:1px solid #b9c6db;padding:4px 8px;font-size:11px}`;
A.printInvoice = (inv, company, apps) => {
  const c = company.settings, p = company.profile, vat = !!Number(c.IsVatRegistered);
  const a = inv.applicant || { FullName: inv.WalkInName, Phone: inv.WalkInPhone, Email: inv.WalkInEmail, Address: '' };
  const full = inv.ApplicantId ? (apps.find((x) => x.Id === inv.ApplicantId) || a) : a;
  const t = inv.totals, lines = (s) => String(s || '').split(/\r?\n/).filter((x) => x.trim());
  const rows = inv.items.map((it, k) => `<tr><td style="text-align:center;width:50px">${k + 1}</td><td>${esc(it.Description)}${it.ForName ? `<br><small>For: ${esc(it.ForName)}</small>` : ''}</td><td style="text-align:center;width:50px">${it.Quantity}</td><td class="n" style="width:110px">Rs. ${num2(it.UnitPrice)}</td><td class="n" style="width:110px">Rs. ${num2(it.Quantity * it.UnitPrice)}</td></tr>`);
  while (rows.length < 7) rows.push('<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>');
  const terms = lines(p['company.terms']).map((l) => (/^make all payments/i.test(l) ? `<b>${esc(l)}</b>` : esc(l))).join('<br><br>');
  const pays = inv.payments.length ? `<div style="margin-top:12px"><div class="navy">Payment history</div><table class="hist"><tr><th>Date</th><th>Method</th><th>For / notes</th><th style="text-align:right">Amount</th></tr>${inv.payments.map((x) => `<tr><td>${d10(x.Date)}</td><td>${esc(x.Method)}</td><td>${esc([x.ServiceDescription, x.Notes].filter(Boolean).join(' - '))}</td><td style="text-align:right">Rs. ${num2(x.Amount)}</td></tr>`).join('')}</table></div>` : '';
  const html = `<div class="hd"><img src="${location.origin}/logo.png"><div class="co"><b>${esc(c.LegalName)}</b><div>${esc(p['company.tagline'])}</div><div>${esc(p['company.address'])}</div><div>Tel: ${esc(p['company.phone'])}</div><div>${esc(p['company.email'])}</div>${vat ? `<div>TIN: ${esc(c.Tin)} ${c.VatRegistrationNumber ? '· VAT Reg No: ' + esc(c.VatRegistrationNumber) : ''}</div>` : ''}</div>
    <div class="ti"><h1>${vat ? 'TAX INVOICE' : 'INVOICE'}</h1><table><tr><td>DATE</td><td>${d10(inv.Date)}</td></tr><tr><td>INVOICE #</td><td>${esc(inv.InvoiceNumber)}</td></tr><tr><td>CUSTOMER ID</td><td>${esc(A.customerId(inv, apps))}</td></tr>${vat ? `<tr><td>SUPPLY DATE</td><td>${d10(inv.DateOfSupply)}</td></tr>` : ''}</table></div></div>
    <div class="rule"></div>
    <div class="two"><div class="box"><div class="navy">Bill to</div><div class="body"><b>${esc(full.FullName)}</b><br>${esc(full.Address)}${full.Address ? '<br>' : ''}${esc(full.Phone)}${full.Phone ? '<br>' : ''}${esc(full.Email)}${inv.CustomerTin ? `<br>Customer TIN: ${esc(inv.CustomerTin)}` : ''}</div></div><div class="box"><div class="navy">Service details</div><div class="body">${esc(full.DestinationCountry || '')}${full.University ? '<br>' + esc(full.University) + (full.Course ? ' - ' + esc(full.Course) : '') : ''}</div></div></div>
    <table class="info"><tr><td class="navy">Salesperson</td><td class="navy">Case ref</td><td class="navy">Passport no</td><td class="navy">Payment terms</td><td class="navy">Due date</td></tr><tr><td>${esc(full.AssignedStaff || '')}</td><td></td><td>${esc(full.PassportNumber || '')}</td><td>${inv.DueDate ? 'Payable by due date' : 'Due on receipt'}</td><td>${d10(inv.DueDate)}</td></tr></table>
    <table class="items"><tr><td class="navy">Item #</td><td class="navy">Description</td><td class="navy" style="text-align:center">Qty</td><td class="navy" style="text-align:right">Unit price</td><td class="navy" style="text-align:right">Total</td></tr>${rows.join('')}</table>
    <div class="low"><div class="box"><div class="navy">Other comments or special instructions</div><div class="body">${inv.Notes ? esc(inv.Notes) + '<br><br>' : ''}${terms}</div></div>
    <table class="tot"><tr><td>SUBTOTAL</td><td>Rs. ${num2(t.sub)}</td></tr>${t.discount ? `<tr><td>DISCOUNT (${inv.DiscountPercent}%)</td><td>- Rs. ${num2(t.discount)}</td></tr>` : ''}${t.tax ? `<tr><td>${vat ? 'VAT' : 'TAX'} (${inv.TaxPercent}%)</td><td>+ Rs. ${num2(t.tax)}</td></tr>` : ''}<tr class="dk"><td style="background:#0c2d6b;color:#fff">TOTAL</td><td>Rs. ${num2(t.grand)}</td></tr><tr><td>PAID</td><td>Rs. ${num2(t.paid)}</td></tr><tr class="dk"><td style="background:#0c2d6b;color:#fff">BALANCE DUE</td><td>Rs. ${num2(t.balance)}</td></tr></table></div>
    ${pays}<div class="q">If you have any questions about this invoice, please contact ${esc(p['company.phone'])} | ${esc(p['company.email'])}</div><div class="rule red"></div>
    ${lines(p['company.bank']).length ? `<div class="pay"><div class="box"></div><div class="box"><div class="navy">Payment options</div><div class="body" style="min-height:0">${lines(p['company.bank']).map(esc).join('<br>')}</div></div><div class="box"></div></div>` : ''}`;
  printHtml('Invoice ' + inv.InvoiceNumber, html, INV_CSS);
};
A.printReceipt = (inv, pay, company, apps) => {
  const c = company.settings, p = company.profile;
  const html = `<div class="hd"><img src="${location.origin}/logo.png"><div class="co"><b>${esc(c.LegalName)}</b><div>${esc(p['company.address'])}</div><div>Tel: ${esc(p['company.phone'])}</div></div><div class="ti"><h1 style="font-size:26px">PAYMENT RECEIPT</h1></div></div><div class="rule"></div>
  <table class="hist" style="width:70%"><tr><td>Received from</td><td><b>${esc(inv.CustomerName)}</b></td></tr><tr><td>Invoice</td><td>${esc(inv.InvoiceNumber)}</td></tr><tr><td>Date</td><td>${d10(pay.Date)}</td></tr><tr><td>Method</td><td>${esc(pay.Method)}</td></tr>${pay.ServiceDescription ? `<tr><td>For</td><td>${esc(pay.ServiceDescription)}</td></tr>` : ''}<tr><td>Amount received</td><td><b style="font-size:16px">Rs. ${num2(pay.Amount)}</b></td></tr><tr><td>Invoice total</td><td>Rs. ${num2(inv.totals.grand)}</td></tr><tr><td>Paid to date</td><td>Rs. ${num2(inv.totals.paid)}</td></tr><tr><td>Balance</td><td>Rs. ${num2(inv.totals.balance)}</td></tr></table>
  <p style="margin-top:50px">_____________________<br>Authorised signature</p>`;
  printHtml('Receipt', html, INV_CSS + '.hist td{padding:6px 10px;font-size:13px}');
};

// ---------- documents ----------
A.views.documents = async (el) => {
  const tab = (A._docTab = A._docTab || 'customer');
  const [apps, docs, inst] = await Promise.all([A.load('Applicants', true), A.load('Documents', true), A.load('InstitutionalDocuments', true)]);
  const name = (id) => (apps.find((a) => a.Id === id) || {}).FullName || '—';
  const head = `<div class="page-head"><h2>Documents</h2>${A.me.r2 ? '' : '<span class="pill amber">File storage (R2) not set up — files will not survive a restart</span>'}</div><div class="tabs"><button data-t="customer" class="${tab === 'customer' ? 'active' : ''}">Customer documents</button><button data-t="inst" class="${tab === 'inst' ? 'active' : ''}">Institutional documents</button></div>`;
  if (tab === 'customer') {
    el.innerHTML = head + `<div class="toolbar"><input id="q" placeholder="Search..."><button class="btn primary" id="up">⬆ Upload for an applicant</button></div><div class="tablewrap"><table><thead><tr><th>Applicant</th><th>Type</th><th>File</th><th>Uploaded</th><th>Expires</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>`;
    const paint = () => { const q = $('#q', el).value.toLowerCase(); $('#tb', el).innerHTML = docs.filter((d) => (name(d.ApplicantId) + d.DocType + d.FileName).toLowerCase().includes(q)).map((d) => `<tr><td><a href="#/applicant/${d.ApplicantId}">${esc(name(d.ApplicantId))}</a></td><td>${esc(d.DocType)}</td><td><a href="/api/file/documents/${d.Id}" target="_blank">${esc(d.FileName)}</a></td><td>${d10(d.UploadDate)}</td><td>${d10(d.ExpiryDate)}</td><td><button class="btn small danger" data-x="${d.Id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted" style="padding:16px">No documents.</td></tr>'; $('#tb', el).querySelectorAll('[data-x]').forEach((b) => (b.onclick = async () => { if (await del('/api/e/Documents/' + b.dataset.x, 'this document')) { A.bust(); A.route(); } })); };
    $('#q', el).oninput = paint; paint();
    $('#up', el).onclick = async () => { const v = await formModal('Choose applicant', [{ k: 'a', label: 'Applicant', type: 'select', options: apps.map((a) => [a.Id, a.FullName]) }]); if (v) A.uploadDoc(v.a, [], () => { A.bust(); A.route(); }); };
  } else {
    el.innerHTML = head + `<div class="toolbar"><button class="btn primary" id="up">⬆ Upload institutional document</button><span class="muted">University agreements, licences, contracts</span></div><div class="tablewrap"><table><thead><tr><th>Title</th><th>Category</th><th>Counterparty</th><th>Signed</th><th>Expires</th><th>File</th><th></th></tr></thead><tbody>${inst.map((d) => `<tr><td><b>${esc(d.Title)}</b><div class="muted">${esc(d.ReferenceNumber)}</div></td><td>${esc(d.Category)}</td><td>${esc(d.CounterpartyName)} ${esc(d.CounterpartyCountry)}</td><td>${d10(d.SignedDate)}</td><td>${d10(d.ExpiryDate)}</td><td><a href="/api/file/institutional/${d.Id}" target="_blank">${esc(d.FileName)}</a></td><td><button class="btn small danger" data-x="${d.Id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted" style="padding:16px">None yet.</td></tr>'}</tbody></table></div>`;
    $('#up', el).onclick = async () => {
      const v = await formModal('Upload institutional document', [{ k: 'Title', label: 'Title', req: 1 }, { k: 'Category', label: 'Category', list: ['University Partnership', 'Licence', 'Contract', 'Registration', 'Other'] }, { k: 'CounterpartyName', label: 'Counterparty (university / company)' }, { k: 'CounterpartyCountry', label: 'Country' }, { k: 'ReferenceNumber', label: 'Reference number' }, { k: 'SignedDate', label: 'Signed date', type: 'date' }, { k: 'ExpiryDate', label: 'Expiry date', type: 'date' }, { k: 'Notes', label: 'Notes', type: 'textarea' }], {}, {
        extra: '<label class="field"><span>File *</span><input type="file" id="ufile" required></label>',
        onSave: async (vals, bg) => { const f = bg.querySelector('#ufile').files[0]; if (!f) throw new Error('Choose a file'); const fd = new FormData(); Object.entries(vals).forEach(([k, x]) => fd.append(k, x)); fd.append('file', f); await api('POST', '/api/institutional', fd); } });
      if (v) { toast('Uploaded'); A.bust(); A.route(); }
    };
    el.querySelectorAll('[data-x]').forEach((b) => (b.onclick = async () => { if (await del('/api/e/InstitutionalDocuments/' + b.dataset.x, 'this document')) { A.bust(); A.route(); } }));
  }
  el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { A._docTab = b.dataset.t; A.route(); }));
};
