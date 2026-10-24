# Portal Ledger

Portal Ledger helps a supplier team track customer-portal invoice submissions, due dates, follow-ups, and document renewals.

## Stack

- React and Vite client
- Express API on Node.js
- MongoDB and Mongoose
- Vercel static hosting and serverless API

## Local setup

1. Use Node.js 20.19 or newer.
2. Copy `.env.example` to `server/.env`.
3. Set `MONGODB_URI` and a random `PORTAL_LEDGER_SETUP_KEY` in `server/.env`.
4. Install dependencies from the repository root with `npm install`.
5. Start the API and UI in separate terminals with `npm run dev:api` and `npm run dev:web`.
6. Open the Vite URL. The first account uses the one-time setup key to create the workspace owner.

## Authentication and roles

- Workspace setup is closed after the first owner account is created.
- The owner and admins create single-use invitation links that expire after seven days. Share the link directly; this project does not send email.
- Sessions use random, hashed server-side tokens in HTTP-only, secure, same-site cookies. Passwords are hashed with scrypt.
- Every invoice, portal, and document query is scoped to the signed-in user's workspace.
- **Owner:** full access, including admin invitations and member management.
- **Admin:** record and team management; can invite accountants and viewers.
- **Accountant:** create, edit, and remove invoices, portals, and renewal reminders.
- **Viewer:** read and export records.
- Password changes revoke the account's other active sessions.

## Demo data and RBAC checks

The seed is insert-only: it refuses to run if its target workspace or any of the four demo login emails already exists. It never deletes or replaces records.

### Separate local demo database

Use a MongoDB database whose name ends in `_demo` (for example, `portal_ledger_demo`). Put its URI in `server/.env`, then run from the repository root:

```powershell
$env:DEMO_SEED_CONFIRM = "YES"
npm run seed:demo
```

### Live database

The live mode adds a separate workspace named **Portal Ledger Demo Sandbox (Synthetic)** to the production database. It creates 4 role accounts, 56 invoices across all statuses, 3 legal entities and currencies, 8 customer portals, 15 expiring documents, 6 synthetic PDF evidence files, 64 audit events, and a pending invitation. App data access is scoped by workspace.

Run this only once, from a trusted local checkout. Set `MONGODB_URI` in `server/.env` to the intended production database, then use a unique password of at least 20 characters for the demo accounts:

```powershell
$env:DEMO_SEED_LIVE_CONFIRM = "YES_I_CONFIRM_LIVE_DEMO_DATA"
$env:DEMO_SEED_PASSWORD = "choose-a-unique-password-at-least-20-characters"
npm run seed:demo
```

Live mode refuses the `*_demo` database, refuses if the sandbox or any demo email already exists, and has no reset path. The four accounts are `owner@portal-ledger.test`, `admin@portal-ledger.test`, `accountant@portal-ledger.test`, and `viewer@portal-ledger.test`; all use the password supplied through `DEMO_SEED_PASSWORD`. The RBAC smoke test remains restricted to a separate `*_demo` database.

### Role smoke test

With the API running against the separate demo database, run:

```powershell
$env:DEMO_TEST_CONFIRM = "YES"
npm run test:rbac
```

It checks sign-in and identity for all roles, read access, audit/team restrictions, and invoice creation permissions. Smoke-created invoices are deleted after each check.

## Vercel deployment

The project is configured to build the Vite client and expose the Express API as a Vercel function. Set these environment variables for Production and Preview:

- `MONGODB_URI`: MongoDB Atlas connection string.
- `CLIENT_ORIGIN` and `APP_ORIGIN`: the deployed app origin.
- `PORTAL_LEDGER_SETUP_KEY`: a long random one-time code for the first owner registration. Remove it from Vercel after the owner account is created.

The first owner creates the organization and claims records from the original single-workspace MVP. Data created after that is isolated by organization. Use a restricted MongoDB database user and limit its network access to the deployment where practical.

## Important limitations

This is an MVP. It does not yet send email, verify email addresses, or provide password-reset email. Admins share invitation links manually. Do not use real financial records until you have reviewed the deployment, backup, and access policies.
