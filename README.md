# Sai Reeyaa Consultancy — browser version

Use the Workflow Manager from any computer or phone with a web browser. It reads and writes the **same Turso database as your desktop app**, so a change made in the browser appears in the desktop app (after its next auto-sync, usually within a few minutes) and the other way round. The same usernames and passwords work in both.

**What is included:** Dashboard with reminders, Applicants (details, status, activity & follow-ups, documents, invoices), Cases board, Calendar, Reminders, Follow-ups, Invoices (items, walk-in customers, price list, family/group lines, payments with history and receipts, payment plans, printable invoice that matches the reference design), Accounts (ledger, purchases & approvals, monthly report), Price list, Reports (with CSV), Documents (customer + institutional, stored in Cloudflare R2), Services, Referral agents, Payroll (with / without EPF-ETF, payslips, register), Users (multiple roles), Audit log, Company & settings. Only Admin can delete; other users must type an Admin username and password to delete anything.

**Not included yet:** emailing invoices/slips, backup & restore (Turso already keeps your data in the cloud), the desktop's local/shared-folder database modes.

## Setting it up (all free)

1. **Turso database** — you already have one for the desktop app. In the Turso dashboard create a **new database token** (do not reuse a token that was ever pasted into a chat). Note the database URL (`libsql://...`).
2. **(Optional) Cloudflare R2 for scanned documents — you can SKIP this.** Without R2 the app stores documents (up to 4 MB each) inside your Turso database, which is free and needs no card. Use R2 only if you need bigger files or lots of them. Setup for R2: — sign up at cloudflare.com → R2 → create bucket `saireeyaa-documents` → *Manage R2 API tokens* → create a token with *Object Read & Write* for that bucket. Note the Account ID, Access Key ID and Secret Access Key. (R2 needs a payment card on file but the free allowance of 10 GB is plenty.)
3. **GitHub** — create a **private** repository and upload this folder (without `node_modules` and `data`; `.gitignore` already excludes them).
4. **Render** — sign up at render.com with GitHub → *New → Blueprint* (or *Web Service*) → pick the repository. Fill in the environment variables from `.env.example`. Render gives you a free address like `https://saireeyaa-web.onrender.com`.
   - The free plan **sleeps after ~15 minutes of no use**, so the first page load after a quiet period takes about 30–60 seconds. Nothing is lost, because all data is in Turso and R2.
5. Open the address and sign in with your existing desktop username and password. (If the database has no users at all, the first Admin is created from `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_PASSWORD`.)

**Own domain (optional):** buy a name (about US$10–12/year, e.g. from Cloudflare Registrar) and add it under Render → *Settings → Custom Domains*. HTTPS is free and automatic.

## Things to know

- **Documents:** files uploaded in the browser are stored in R2 (or in Turso if R2 is not set up) and visible in the browser. Files uploaded in the desktop app are still only on the PCs; the desktop app does not yet read R2 (planned next step).
- **Clocks and conflicts:** like the desktop app, the newest save of a record wins. Two people editing the same record at the same moment: the later save replaces the earlier one.
- **Security:** passwords are stored hashed (same method as the desktop app). Login is limited to 6 wrong tries per 10 minutes. Sessions last 12 hours. Only use `https://` addresses.
- Role changes made to a user can take up to 20 seconds to apply to their open session.

## Running on your own computer (testing)

```
npm install
set TURSO_URL=file:./data/local.db   (Windows)   or   export TURSO_URL=file:./data/local.db
set INITIAL_ADMIN_PASSWORD=choose-one
npm start      # http://localhost:3000
npm test       # automatic checks on a throw-away database
```
