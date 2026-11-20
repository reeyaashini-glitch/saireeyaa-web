// Accounts, price list, payroll, reports, users, audit log, company settings, account.
A.views.pricelist = async (el) => {
  await GET('/api/catalog');
  A.views._pl = () => A.crud(el, {
    title: 'Price list', single: 'service price', entity: 'ServiceCatalog', label: (r) => r.Name, search: (r) => r.Category + r.Name,
    intro: 'Standard services and prices. Use "From price list" on an invoice to add them quickly.',
    columns: [{ h: 'Category', r: (r) => esc(r.Category) }, { h: 'Service', r: (r) => `<b>${esc(r.Name)}</b>` }, { h: 'Price (Rs.)', cls: 'num', r: (r) => num2(r.Price) }, { h: 'Active', r: (r) => (Number(r.IsActive) ? 'Yes' : 'No') }],
    fields: [{ k: 'Category', label: 'Category', req: 1, list: A.meta.lists.catalog.map((c) => c[0]) }, { k: 'Name', label: 'Service name', req: 1 }, { k: 'Price', label: 'Price (Rs.)', type: 'number' }, { k: 'IsActive', label: 'Active', type: 'check' }],
    defaults: { IsActive: 1, Price: 0 },
  });
  return A.views._pl();
};

// ---------- accounts ----------
A.views.accounts = async (el) => {
  const tabs = A.me.accounts ? [['ledger', 'Ledger'], ['purchases', 'Purchases & approvals'], ['monthly', 'Monthly report']] : [['purchases', 'My purchases']];
  let tab = A._accTab && tabs.some((t) => t[0] === A._accTab) ? A._accTab : tabs[0][0];
  const head = `<div class="page-head"><h2>Accounts</h2></div><div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div><div id="body"></div>`;
  el.innerHTML = head;
  el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { A._accTab = b.dataset.t; A.route(); }));
  const body = $('#body', el);
  const cats = (k) => (k === 'Income' ? ['Service fees', 'Consultation', 'Commission received', 'Other income'] : ['Salaries', 'Rent', 'Utilities', 'Office supplies', 'Transport', 'Marketing', 'VFS / embassy fees', 'Agent commission', 'Bank charges', 'Tax / levies', 'Other expense']);
  if (tab === 'ledger') {
    const now = todayStr(); const q = A._ledRange || { from: now.slice(0, 8) + '01', to: now };
    const l = await GET(`/api/ledger?from=${q.from}&to=${q.to}`);
    body.innerHTML = `<div class="toolbar"><label>From <input type="date" id="f" value="${q.from}"></label><label>To <input type="date" id="t" value="${q.to}"></label><button class="btn" id="go">Show</button><button class="btn primary" id="addi">+ Income</button><button class="btn primary" id="adde">+ Expense</button><button class="btn" id="csv">Export CSV</button></div>
    <div class="stats"><div class="stat"><small>Brought forward</small><b>${money(l.broughtForward)}</b></div><div class="stat"><small>Income</small><b>${money(l.income)}</b></div><div class="stat"><small>Expenses</small><b>${money(l.expense)}</b></div><div class="stat"><small>Closing balance</small><b>${money(l.rows.length ? l.rows[l.rows.length - 1].balance : l.broughtForward)}</b></div></div>
    <div class="tablewrap"><table><thead><tr><th>Date</th><th>Description</th><th>Party</th><th>Category</th><th>Method</th><th class="num">Income</th><th class="num">Expense</th><th class="num">Balance</th><th></th></tr></thead><tbody>${l.rows.map((r) => `<tr><td>${r.date}</td><td>${esc(r.description)}</td><td>${esc(r.party)}</td><td>${esc(r.category)}</td><td>${esc(r.method)}</td><td class="num">${r.income ? num2(r.income) : ''}</td><td class="num">${r.expense ? num2(r.expense) : ''}</td><td class="num">${num2(r.balance)}</td><td>${r.source === 'invoice' || r.source === 'salary' ? '<span class="muted">auto</span>' : r.id ? `<button class="btn small danger" data-x="${r.id}">Delete</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted" style="padding:16px">No entries in this period.</td></tr>'}</tbody></table></div>`;
    $('#go', el).onclick = () => { A._ledRange = { from: $('#f', el).value, to: $('#t', el).value }; A.route(); };
    const add = (kind) => async () => { const v = await formModal('Add ' + kind.toLowerCase(), [{ k: 'Date', label: 'Date', type: 'date' }, { k: 'Amount', label: 'Amount (Rs.)', type: 'number', req: 1 }, { k: 'Category', label: 'Category', type: 'select', options: cats(kind) }, { k: 'Description', label: 'Description', req: 1 }, { k: 'Party', label: kind === 'Income' ? 'Received from' : 'Paid to' }, { k: 'Method', label: 'Method', type: 'select', options: ['Cash', 'Bank transfer', 'Card', 'Online', 'Cheque'] }], { Date: todayStr() }, { onSave: (vals) => POST('/api/ledger', { ...vals, Kind: kind }) }); if (v) { toast('Saved'); A.route(); } };
    $('#addi', el).onclick = add('Income'); $('#adde', el).onclick = add('Expense');
    el.querySelectorAll('[data-x]').forEach((b) => (b.onclick = async () => { if (await del('/api/e/LedgerEntries/' + b.dataset.x, 'this entry')) A.route(); }));
    $('#csv', el).onclick = () => A.csv('ledger.csv', [['Date', 'Description', 'Party', 'Category', 'Method', 'Income', 'Expense', 'Balance'], ...l.rows.map((r) => [r.date, r.description, r.party, r.category, r.method, r.income, r.expense, r.balance])]);
  } else if (tab === 'purchases') {
    const rows = await GET('/api/purchases');
    body.innerHTML = `<div class="toolbar"><button class="btn primary" id="np">+ Record a purchase</button><span class="muted">${A.me.accounts ? 'Approve or reject staff purchases below.' : 'Your purchases wait for approval by accounts / admin.'}</span></div><div class="tablewrap"><table><thead><tr><th>Date</th><th>Description</th><th>By</th><th>Category</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td>${d10(r.Date)}</td><td>${esc(r.Description)}<div class="muted">${esc(r.Party)}</div></td><td>${esc(r.CreatedBy)}</td><td>${esc(r.Category)}</td><td class="num">${num2(r.Amount)}</td><td><span class="pill ${r.Status === 'approved' ? 'green' : r.Status === 'rejected' ? 'red' : 'amber'}">${esc(r.Status)}</span></td><td class="row-actions">${A.me.accounts && r.Status === 'pending' ? `<button class="btn small primary" data-ap="${r.Id}">Approve</button><button class="btn small danger" data-rj="${r.Id}">Reject</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted" style="padding:16px">No purchases.</td></tr>'}</tbody></table></div>`;
    $('#np', el).onclick = async () => { const v = await formModal('Record a purchase', [{ k: 'Date', label: 'Date', type: 'date' }, { k: 'Amount', label: 'Amount (Rs.)', type: 'number', req: 1 }, { k: 'Description', label: 'What was bought?', req: 1 }, { k: 'Party', label: 'Shop / supplier' }, { k: 'Category', label: 'Category', type: 'select', options: cats('Expense') }, { k: 'Method', label: 'Paid by', type: 'select', options: ['Cash', 'Bank transfer', 'Card', 'Online'] }], { Date: todayStr(), Category: 'Office supplies' }, { onSave: (vals) => POST('/api/purchases', vals) }); if (v) { toast('Saved'); A.route(); } };
    el.querySelectorAll('[data-ap]').forEach((b) => (b.onclick = async () => { await POST(`/api/ledger/${b.dataset.ap}/approve`); A.route(); }));
    el.querySelectorAll('[data-rj]').forEach((b) => (b.onclick = async () => { await POST(`/api/ledger/${b.dataset.rj}/approve`, { reject: true }); A.route(); }));
  } else {
    const now = todayStr(); const y = A._mY || +now.slice(0, 4), m = A._mM || +now.slice(5, 7);
    const s = await GET(`/api/ledger/monthly?year=${y}&month=${m}`);
    const tbl = (o) => Object.entries(o).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${num2(v)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">None</td></tr>';
    body.innerHTML = `<div class="toolbar"><select id="mm">${MONTHS.map((n, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${n}</option>`).join('')}</select><input type="number" id="yy" value="${y}" style="width:100px"><button class="btn" id="go">Show</button><button class="btn" id="pr">🖨 Print</button></div>
    <div class="stats"><div class="stat"><small>Income</small><b>${money(s.totalIncome)}</b></div><div class="stat"><small>Expenses</small><b>${money(s.totalExpenses)}</b></div><div class="stat"><small>Net</small><b>${money(s.net)}</b></div><div class="stat"><small>Invoiced this month</small><b>${money(s.invoicedThisMonth)}</b></div><div class="stat"><small>Outstanding now</small><b>${money(s.outstandingNow)}</b></div></div>
    <div class="grid2"><div class="card"><h3>Income by category</h3><table>${tbl(s.income)}</table></div><div class="card"><h3>Expenses by category</h3><table>${tbl(s.expenses)}</table></div></div>`;
    $('#go', el).onclick = () => { A._mM = +$('#mm', el).value; A._mY = +$('#yy', el).value; A.route(); };
    $('#pr', el).onclick = async () => { const c = await GET('/api/company'); printHtml('Monthly report', `<h2 style="color:#0c2d6b">${esc(c.settings.LegalName)}</h2><h3>Monthly report — ${esc(s.label)}</h3><table class="hist"><tr><th>Income</th><th style="text-align:right">Rs.</th></tr>${Object.entries(s.income).map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right">${num2(v)}</td></tr>`).join('')}<tr><td><b>Total income</b></td><td style="text-align:right"><b>${num2(s.totalIncome)}</b></td></tr></table><br><table class="hist"><tr><th>Expenses</th><th style="text-align:right">Rs.</th></tr>${Object.entries(s.expenses).map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right">${num2(v)}</td></tr>`).join('')}<tr><td><b>Total expenses</b></td><td style="text-align:right"><b>${num2(s.totalExpenses)}</b></td></tr></table><h3>Net: Rs. ${num2(s.net)}</h3><p>Invoiced this month: Rs. ${num2(s.invoicedThisMonth)} · Outstanding now: Rs. ${num2(s.outstandingNow)}</p>`, INV_CSS); };
  }
};
A.csv = (name, rows) => {
  const body = rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv' })); a.download = name; a.click();
};

// ---------- reports ----------
A.views.reports = async (el) => {
  const now = todayStr(); const q = A._repRange || { from: now.slice(0, 4) + '-01-01', to: now };
  const r = await GET(`/api/reports/financial?from=${q.from}&to=${q.to}`);
  const mx = Math.max(1, ...r.trend.flatMap((t) => [t.invoiced, t.collected]));
  el.innerHTML = `<div class="page-head"><h2>Reports</h2><label>From <input type="date" id="f" value="${q.from}" style="width:auto"></label><label>To <input type="date" id="t" value="${q.to}" style="width:auto"></label><button class="btn" id="go">Show</button><button class="btn" id="csv">Export invoice register (CSV)</button><button class="btn" id="pr">🖨 Print</button></div>
  <div class="stats"><div class="stat"><small>Invoiced</small><b>${money(r.invoiced)}</b></div><div class="stat"><small>Collected</small><b>${money(r.collected)}</b></div><div class="stat"><small>Outstanding (these invoices)</small><b>${money(r.outstanding)}</b></div><div class="stat"><small>Invoices</small><b>${r.invoiceCount}</b></div></div>
  <div class="card"><h3>Revenue trend (last 12 months)</h3><div class="trend">${r.trend.map((t) => `<div title="${t.month}: invoiced ${num2(t.invoiced)}, collected ${num2(t.collected)}"><div style="flex-direction:row;align-items:flex-end;gap:2px;width:100%"><span style="height:${(t.invoiced / mx) * 100}%"></span><span class="c" style="height:${(t.collected / mx) * 100}%"></span></div>${t.month.slice(5)}</div>`).join('')}</div><p class="muted">Blue = invoiced, green = collected</p></div>
  <div class="grid2"><div class="card"><h3>By service</h3><table><thead><tr><th>Service</th><th class="num">Invoices</th><th class="num">Invoiced</th><th class="num">Paid</th></tr></thead><tbody>${r.bySector.map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${s.invoices}</td><td class="num">${num2(s.invoiced)}</td><td class="num">${num2(s.paid)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None</td></tr>'}</tbody></table></div>
  <div class="card"><h3>Applicants by status</h3><table>${Object.entries(r.applicantStatus).map(([k, v]) => `<tr><td>${statusPill(k)}</td><td class="num">${v}</td></tr>`).join('')}</table></div></div>
  <div class="card"><h3>Agent commissions (on invoices in this period)</h3><table><thead><tr><th>Agent</th><th class="num">Invoices</th><th class="num">Base</th><th class="num">%</th><th class="num">Gross</th><th class="num">WHT</th><th class="num">Net</th></tr></thead><tbody>${r.commissions.map((c) => `<tr><td>${esc(c.agent)}</td><td class="num">${c.invoices}</td><td class="num">${num2(c.base)}</td><td class="num">${c.percent}</td><td class="num">${num2(c.gross)}</td><td class="num">${num2(c.wht)}</td><td class="num">${num2(c.net)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No referred clients invoiced.</td></tr>'}</tbody></table></div>
  <div class="card"><h3>Invoice register</h3><div class="tablewrap"><table><thead><tr><th>Number</th><th>Date</th><th>Customer</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th></tr></thead><tbody>${r.register.map((i) => `<tr><td>${esc(i.number)}</td><td>${i.date}</td><td>${esc(i.customer)}</td><td class="num">${num2(i.total)}</td><td class="num">${num2(i.paid)}</td><td class="num">${num2(i.balance)}</td><td>${payPill(i.status)}</td></tr>`).join('')}</tbody></table></div></div>`;
  $('#go', el).onclick = () => { A._repRange = { from: $('#f', el).value, to: $('#t', el).value }; A.route(); };
  $('#csv', el).onclick = () => A.csv('invoice-register.csv', [['Number', 'Date', 'Customer', 'Total', 'Paid', 'Balance', 'Status'], ...r.register.map((i) => [i.number, i.date, i.customer, i.total, i.paid, i.balance, i.status])]);
  $('#pr', el).onclick = () => window.print();
};

// ---------- payroll ----------
A.views.payroll = async (el) => {
  const tab = (A._payTab = A._payTab || 'epf');
  const now = todayStr(); const y = A._pY || +now.slice(0, 4), m = A._pM || +now.slice(5, 7);
  const tabs = [['epf', 'Payroll — With EPF / ETF'], ['noepf', 'Payroll — Without EPF / ETF'], ['emps', 'Employees']];
  const head = `<div class="page-head"><h2>Payroll</h2></div><div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div>`;
  if (tab === 'emps') {
    const holder = document.createElement('div'); el.innerHTML = head; el.appendChild(holder);
    el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { A._payTab = b.dataset.t; A.route(); }));
    return A.crud(holder, {
      title: 'Employees', single: 'employee', entity: 'Employees', label: (r) => r.FullName, search: (r) => r.FullName + r.EmployeeNumber, wide: true,
      columns: [{ h: 'No.', r: (r) => esc(r.EmployeeNumber) }, { h: 'Name', r: (r) => `<b>${esc(r.FullName)}</b><div class="muted">${esc(r.Designation)}</div>` }, { h: 'Basic', cls: 'num', r: (r) => num2(r.BasicSalary) }, { h: 'Payroll', r: (r) => (Number(r.EpfApplicable) ? 'EPF / ETF' : 'No EPF') }, { h: 'Active', r: (r) => (Number(r.IsActive) ? 'Yes' : 'No') }],
      fields: [{ k: 'EmployeeNumber', label: 'Employee number' }, { k: 'FullName', label: 'Full name', req: 1 }, { k: 'Nic', label: 'NIC' }, { k: 'Designation', label: 'Designation' }, { k: 'Location', label: 'Location' }, { k: 'JoinDate', label: 'Join date', type: 'date' }, { k: 'Email', label: 'Email' }, { k: 'BasicSalary', label: 'Basic salary', type: 'number' }, { k: 'EpfAllowance', label: 'Allowances counted for EPF', type: 'number' }, { k: 'OtherAllowance', label: 'Other allowances', type: 'number' }, { k: 'EpfApplicable', label: 'EPF / ETF applies', type: 'check' }, { k: 'EpfNumber', label: 'EPF number' }, { k: 'EtfNumber', label: 'ETF number' }, { k: 'BankName', label: 'Bank' }, { k: 'BankBranch', label: 'Branch' }, { k: 'BankAccountNumber', label: 'Account number' }, { k: 'IsActive', label: 'Active', type: 'check' }, { k: 'Notes', label: 'Notes', type: 'textarea' }],
      defaults: { IsActive: 1, EpfApplicable: 1, BasicSalary: 0, EpfAllowance: 0, OtherAllowance: 0 },
    });
  }
  const epf = tab === 'epf';
  const all = (await GET('/api/payroll')).filter((s) => !!Number(s.EpfApplicable) === epf && s.Year === y && s.Month === m);
  const tot = all.reduce((a, s) => ({ g: a.g + s.totals.gross + Number(s.Commission), n: a.n + s.totals.net, c: a.c + s.totals.employerCost }), { g: 0, n: 0, c: 0 });
  el.innerHTML = head + `<div class="toolbar"><select id="mm">${MONTHS.map((n, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${n}</option>`).join('')}</select><input type="number" id="yy" value="${y}" style="width:100px"><button class="btn" id="go">Show</button><button class="btn primary" id="gen">+ Generate ${epf ? 'EPF / ETF salaries' : 'salaries'}</button><button class="btn" id="reg">🖨 Print register</button></div>
  <div class="stats"><div class="stat"><small>Gross + commission</small><b>${money(tot.g)}</b></div><div class="stat"><small>Net pay</small><b>${money(tot.n)}</b></div><div class="stat"><small>Employer cost</small><b>${money(tot.c)}</b></div></div>
  <div class="tablewrap"><table><thead><tr><th>Employee</th><th class="num">Gross</th><th class="num">EPF 8%</th><th class="num">Deductions</th><th class="num">Net pay</th><th>Paid</th><th></th></tr></thead><tbody>${all.map((s) => `<tr><td><b>${esc(s.employee ? s.employee.FullName : '?')}</b></td><td class="num">${num2(s.totals.gross + Number(s.Commission))}</td><td class="num">${num2(s.EpfEmployee)}</td><td class="num">${num2(s.totals.deductions)}</td><td class="num"><b>${num2(s.totals.net)}</b></td><td>${Number(s.IsPaid) ? `<span class="pill green">${d10(s.PaidDate)}</span>` : '<span class="pill amber">Unpaid</span>'}</td><td class="row-actions"><button class="btn small" data-e="${s.Id}">Edit</button><button class="btn small" data-p="${s.Id}">Slip</button><button class="btn small danger" data-d="${s.Id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted" style="padding:16px">No salary slips for this month yet. Click Generate.</td></tr>'}</tbody></table></div>`;
  el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { A._payTab = b.dataset.t; A.route(); }));
  $('#go', el).onclick = () => { A._pM = +$('#mm', el).value; A._pY = +$('#yy', el).value; A.route(); };
  $('#gen', el).onclick = async () => { const r = await POST('/api/payroll/generate', { year: y, month: m, epf }); toast(`${r.created} slip(s) created${r.skipped ? `, ${r.skipped} already existed` : ''}`); A.route(); };
  el.querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => { if (await del('/api/e/SalaryRecords/' + b.dataset.d, 'this salary slip')) A.route(); }));
  el.querySelectorAll('[data-e]').forEach((b) => (b.onclick = async () => {
    const s = all.find((x) => x.Id === b.dataset.e);
    const f = ['BasicSalary:Basic salary', 'EpfAllowances:EPF allowances', 'OtherAllowances:Other allowances', 'Overtime:Overtime', 'Bonus:Bonus', 'Commission:Commission', 'Advance:Advance', 'OtherDeductions:Other deductions', 'Apit:APIT (tax)'].map((x) => { const [k, l] = x.split(':'); return { k, label: l, type: 'number' }; });
    const v = await formModal(`Salary slip — ${s.employee ? s.employee.FullName : ''} — ${MONTHS[s.Month - 1]} ${s.Year}`, [...f, { k: 'AnnualLeaveDays', label: 'Annual leave days', type: 'number' }, { k: 'IsPaid', label: 'Paid', type: 'check' }, { k: 'PaidDate', label: 'Paid date', type: 'date' }, { k: 'Notes', label: 'Notes', type: 'textarea' }], s, { hint: epf ? 'EPF/ETF are recalculated automatically (8% / 12% / 3% of basic + EPF allowances).' : '', onSave: (vals) => PUT('/api/salary/' + s.Id, vals) });
    if (v) { toast('Saved'); A.route(); }
  }));
  el.querySelectorAll('[data-p]').forEach((b) => (b.onclick = async () => { const s = all.find((x) => x.Id === b.dataset.p); const c = await GET('/api/company'); A.printSlip(s, c, epf); }));
  $('#reg', el).onclick = async () => { const c = await GET('/api/company'); printHtml('Payroll register', `<h2 style="color:#0c2d6b">${esc(c.settings.LegalName)}</h2><h3>Payroll register — ${epf ? 'EPF / ETF' : 'without EPF / ETF'} — ${MONTHS[m - 1]} ${y}</h3><table class="hist"><tr><th>Employee</th><th>Gross</th><th>EPF 8%</th><th>Other deductions</th><th>Net pay</th>${epf ? '<th>EPF 12%</th><th>ETF 3%</th>' : ''}</tr>${all.map((s) => `<tr><td>${esc(s.employee ? s.employee.FullName : '')}</td><td>${num2(s.totals.gross + Number(s.Commission))}</td><td>${num2(s.EpfEmployee)}</td><td>${num2(Number(s.Advance) + Number(s.OtherDeductions) + Number(s.Apit))}</td><td><b>${num2(s.totals.net)}</b></td>${epf ? `<td>${num2(s.EpfEmployer)}</td><td>${num2(s.EtfEmployer)}</td>` : ''}</tr>`).join('')}<tr><td><b>Total</b></td><td></td><td></td><td></td><td><b>${num2(tot.n)}</b></td></tr></table>`, INV_CSS); };
};
A.printSlip = (s, c, epf) => {
  const e = s.employee || {}, t = s.totals, row = (a, b) => `<tr><td>${a}</td><td style="text-align:right">${num2(b)}</td></tr>`;
  printHtml('Salary slip', `<div class="hd"><img src="${location.origin}/logo.png"><div class="co"><b>${esc(c.settings.LegalName)}</b><div>${esc(c.profile['company.address'])}</div></div><div class="ti"><h1 style="font-size:24px">PAY SLIP</h1><div>${MONTHS[s.Month - 1]} ${s.Year}</div></div></div><div class="rule"></div>
  <table class="hist"><tr><td>Employee</td><td><b>${esc(e.FullName)}</b></td><td>Employee no.</td><td>${esc(e.EmployeeNumber)}</td></tr><tr><td>Designation</td><td>${esc(e.Designation)}</td><td>NIC</td><td>${esc(e.Nic)}</td></tr><tr><td>Bank</td><td>${esc(e.BankName)} ${esc(e.BankBranch)}</td><td>Account</td><td>${esc(e.BankAccountNumber)}</td></tr></table><br>
  <div class="two"><table class="hist"><tr><th colspan="2">EARNINGS</th></tr>${row('Basic salary', s.BasicSalary)}${row('EPF allowances', s.EpfAllowances)}${row('Other allowances', s.OtherAllowances)}${row('Overtime', s.Overtime)}${row('Bonus', s.Bonus)}${row('Commission', s.Commission)}<tr><td><b>Total earnings</b></td><td style="text-align:right"><b>${num2(t.gross + Number(s.Commission))}</b></td></tr></table>
  <table class="hist"><tr><th colspan="2">DEDUCTIONS</th></tr>${epf ? row('EPF (employee 8%)', s.EpfEmployee) : ''}${row('Salary advance', s.Advance)}${row('Other deductions', s.OtherDeductions)}${row('APIT (tax)', s.Apit)}<tr><td><b>Total deductions</b></td><td style="text-align:right"><b>${num2(t.deductions)}</b></td></tr></table></div>
  <h2 style="text-align:right;color:#0c2d6b">NET PAY: Rs. ${num2(t.net)}</h2>${epf ? `<table class="hist" style="width:60%"><tr><th colspan="2">EPF / ETF statutory summary</th></tr>${row('EPF employee 8%', s.EpfEmployee)}${row('EPF employer 12%', s.EpfEmployer)}${row('Total EPF', Number(s.EpfEmployee) + Number(s.EpfEmployer))}${row('ETF employer 3%', s.EtfEmployer)}</table>` : ''}
  <p style="margin-top:40px">_____________________<br>Authorised signature</p>`, INV_CSS);
};

// ---------- users ----------
A.views.users = async (el) => {
  const users = await GET('/api/users');
  const ROLE_HELP = { Admin: 'Everything, including users and deleting', Manager: 'Payroll, accounts, audit log', Accountant: 'Accounts and reports', Payroll: 'Payroll only', Staff: 'Day-to-day work (cannot delete)' };
  el.innerHTML = `<div class="page-head"><h2>Users</h2><button class="btn primary" id="add">+ Add user</button></div><p class="muted">One person can have several roles. Only Admin can delete; other users need an Admin password to delete anything.</p><div class="tablewrap"><table><thead><tr><th>Name</th><th>Username</th><th>Roles</th><th>Active</th><th>Last login</th><th></th></tr></thead><tbody>${users.map((u) => `<tr><td><b>${esc(u.FullName)}</b></td><td>${esc(u.Username)}</td><td>${u.roles.map((r) => `<span class="pill">${esc(r)}</span>`).join(' ')}</td><td>${Number(u.IsActive) ? 'Yes' : '<span class="pill gray">No</span>'}</td><td>${d10(u.LastLogin)}</td><td class="row-actions"><button class="btn small" data-e="${u.Id}">Edit</button><button class="btn small danger" data-d="${u.Id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`;
  const edit = async (u) => {
    const roleBoxes = `<div class="field wide"><span>Roles (tick one or more)</span>${A.meta.roles.map((r) => `<label style="display:flex;gap:8px;align-items:center;padding:2px 0"><input type="checkbox" class="rl" value="${r}" ${u && u.roles.includes(r) ? 'checked' : !u && r === 'Staff' ? 'checked' : ''}> <b>${r}</b> <span class="muted">— ${ROLE_HELP[r]}</span></label>`).join('')}</div>`;
    const v = await formModal(u ? 'Edit user' : 'Add user', [{ k: 'FullName', label: 'Full name', req: 1 }, { k: 'Username', label: 'Username', req: 1 }, { k: 'password', label: u ? 'New password (leave blank to keep)' : 'Password (min 6)', type: 'password', req: !u }, { k: 'IsActive', label: 'Active', type: 'check' }], u ? { ...u, password: '' } : { IsActive: 1 }, {
      extra: roleBoxes,
      onSave: async (vals) => { const roles = [...document.querySelectorAll('.rl')].filter((c) => c.checked).map((c) => c.value); if (u) await PUT('/api/users/' + u.Id, { ...vals, roles }); else await POST('/api/users', { ...vals, roles }); },
    });
    if (v) { toast('Saved'); A.route(); }
  };
  $('#add', el).onclick = () => edit(null);
  el.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => edit(users.find((u) => u.Id === b.dataset.e))));
  el.querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => { if (await del('/api/users/' + b.dataset.d, 'this user')) A.route(); }));
};

A.views.audit = async (el) => {
  const rows = await GET('/api/e/AuditLog');
  el.innerHTML = `<div class="page-head"><h2>Audit log</h2><input id="q" placeholder="Filter..." style="max-width:240px"><button class="btn" id="csv">Export CSV</button></div><div class="tablewrap"><table><thead><tr><th>When</th><th>User</th><th>Action</th><th>Type</th><th>Details</th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const paint = () => { const q = $('#q', el).value.toLowerCase(); $('#tb', el).innerHTML = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q)).slice(0, 500).map((r) => `<tr><td>${d10(r.Timestamp)} ${String(r.Timestamp).slice(11, 16)}</td><td>${esc(r.UserName)}</td><td>${esc(r.Action)}</td><td>${esc(r.EntityType)}</td><td>${esc(r.Description)}</td></tr>`).join(''); };
  $('#q', el).oninput = paint; paint();
  $('#csv', el).onclick = () => A.csv('audit-log.csv', [['When', 'User', 'Action', 'Type', 'Details'], ...rows.map((r) => [r.Timestamp, r.UserName, r.Action, r.EntityType, r.Description])]);
};

// ---------- company & settings ----------
A.views.company = async (el) => {
  const c = await GET('/api/company'); const s = c.settings;
  const prof = [['company.tagline', 'Tagline'], ['company.phone', 'Phone / WhatsApp'], ['company.email', 'Email'], ['company.website', 'Website'], ['company.address', 'Head office address', 1], ['company.branches', 'Other branch addresses (one per line)', 1], ['company.services', 'Our services (one per line)', 1], ['company.bank', 'Bank / payment details (printed on invoices)', 1], ['company.terms', 'Invoice terms & notes (printed on invoices)', 1]];
  el.innerHTML = `<div class="page-head"><h2>Company & settings</h2><button class="btn primary" id="save">Save</button></div>
  <div class="card"><h3>Company & tax registration</h3><div class="form-grid">${[['LegalName', 'Legal name'], ['RegisteredAddress', 'Registered address'], ['Tin', 'TIN'], ['VatRegistrationNumber', 'VAT registration number'], ['BusinessRegistrationNumber', 'Business registration number'], ['BranchCode', 'Branch code']].map(([k, l]) => fieldHtml({ k: 's_' + k, label: l }, s[k])).join('')}${fieldHtml({ k: 's_IsVatRegistered', label: 'VAT registered (prints TAX INVOICE and VAT lines)', type: 'check' }, s.IsVatRegistered)}${fieldHtml({ k: 's_DefaultWhtRatePercent', label: 'Default WHT rate %', type: 'number' }, s.DefaultWhtRatePercent)}${fieldHtml({ k: 's_WhtMonthlyThresholdLkr', label: 'WHT monthly threshold (Rs.)', type: 'number' }, s.WhtMonthlyThresholdLkr)}</div></div>
  <div class="card"><h3>Printed on invoices</h3><div class="form-grid">${prof.map(([k, l, ml]) => fieldHtml({ k: 'p_' + k.replace('.', '_'), label: l, type: ml ? 'textarea' : 'text', wide: ml }, c.profile[k])).join('')}</div></div>
  <div class="card"><h3>Accounts</h3><div class="form-grid">${fieldHtml({ k: 'ob', label: 'Opening balance (Rs.)', type: 'number', hint: 'Cash/bank balance before the first ledger entry' }, c.openingBalance)}</div></div>`;
  $('#save', el).onclick = async () => {
    const g = (id) => $('#f_' + id, el);
    const settings = { ...s }; ['LegalName', 'RegisteredAddress', 'Tin', 'VatRegistrationNumber', 'BusinessRegistrationNumber', 'BranchCode', 'DefaultWhtRatePercent', 'WhtMonthlyThresholdLkr'].forEach((k) => (settings[k] = g('s_' + k).value)); settings.IsVatRegistered = g('s_IsVatRegistered').checked;
    const profile = {}; prof.forEach(([k]) => (profile[k] = g('p_' + k.replace('.', '_')).value));
    try { await PUT('/api/company', { settings, profile, openingBalance: g('ob').value }); toast('Saved'); } catch (e) { toast(e.message, true); }
  };
};

A.views.account = async (el) => {
  el.innerHTML = `<div class="page-head"><h2>My account</h2></div><div class="card" style="max-width:420px"><p><b>${esc(A.me.name)}</b><br><span class="muted">${esc(A.me.username)} · ${A.me.roles.join(' + ')}</span></p><h3>Change password</h3><label class="field"><span>Current password</span><input type="password" id="cp"></label><label class="field"><span>New password (min 6)</span><input type="password" id="np"></label><button class="btn primary" id="go">Change password</button></div>`;
  $('#go', el).onclick = async () => { try { await POST('/api/password', { current: $('#cp', el).value, password: $('#np', el).value }); toast('Password changed'); $('#cp', el).value = $('#np', el).value = ''; } catch (e) { toast(e.message, true); } };
};
