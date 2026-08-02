# The Daily Tiffin Tracker

A responsive meal-order ledger with calendar entry, transparent audit history, bills, payments, exports and analytics.

## Run locally

```bash
npm install
cp .env.example .env
npx prisma db push
npm run dev
```

The app is offline-first: it keeps a local browser copy for a fast, resilient experience and synchronizes it to PostgreSQL through `GET`/`PUT /api/state` when `DATABASE_URL` is configured. The normalized Prisma schema permanently stores people, meal entries, daily evidence, payments, settings and the audit ledger.

## Deploy to Vercel

1. Import this repository into Vercel.
2. In **Project Settings → Environment Variables**, add `DATABASE_URL` with the Neon PostgreSQL connection string.
3. Deploy. The dynamic `/api/state` route will use Neon automatically.

Never commit `.env`; it is deliberately excluded from Git.
