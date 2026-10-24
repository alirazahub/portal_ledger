# Portal Ledger (MERN)

Portal Ledger is a small supplier-side workspace for recording invoices submitted through customer portals, monitoring due dates, and keeping renewal reminders together.

## Stack

- React 19 + Vite 8 client
- Express 5 API on Node.js
- MongoDB with Mongoose 9

## Run locally

Requirements: Node.js 20.19+ (or 22.12+) and a MongoDB instance.

1. Install dependencies from the project root:

   `npm install`

2. Copy `.env.example` to `server/.env` and set `MONGODB_URI`. The example URI works with a local MongoDB server.

3. Start the API and web client in separate terminals:

   `npm run dev:api`

   `npm run dev:web`

4. Open the Vite URL printed in the web terminal (normally `http://localhost:5173`).

5. To load sample data into an empty database, run:

   `npm run seed:demo`

The demo seed refuses to add records if the invoice collection already has data.

## Main API routes

- `GET /api/health`
- `GET /api/invoices?q=&status=`
- `POST /api/invoices`
- `PATCH /api/invoices/:id` (status, note, reference, due, submitted)
- `DELETE /api/invoices/:id`
- `GET/POST/PATCH/DELETE /api/portals`
- `GET/POST/PATCH/DELETE /api/documents`

The client talks to `/api`; Vite proxies those requests to the Express API on port 4000.

## Current scope

This is a single-workspace MVP. It has no sign-in, tenant isolation, portal automation, file uploads, or payment processing. Portal status is entered by the user; portal credentials are not collected. Do not use real customer or financial records until authentication, authorization, operational logging, backups, and production deployment settings are added.
