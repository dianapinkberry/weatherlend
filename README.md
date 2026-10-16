# Weatherlend

Prototype of a community lending platform for students in Zurich. People lend and borrow what they need during extreme weather (fans in a heat wave, heaters in a cold snap, pumps and dehumidifiers after heavy rain) and pay with points instead of money.

## What is in it

| Screen | Route | What it does |
|---|---|---|
| Offers (landing) | `#/offers` | Phenomenon filter (pick one or more), item cards, borrowing request for a period |
| Offer an item | `#/offer` | Onboarding step 1 “What can you lend?” with live preview, optional photo; step 2 picks phenomena to be notified about |
| Requests | `#/requests` | Post “I need X from … to …”, browse open requests, answer with “I have this” |
| Points | `#/points` | Balance, history, requests for your items (accept / decline), your pending requests |
| Calendar | `#/calendar` | Month view of lending and borrowing (nice-to-have) |

There is no login. The **“Acting as”** selector in the header switches between six demo users, so you can play both sides of a loan.

## Run it locally

Requirements: [Node.js](https://nodejs.org) 18 or newer. Nothing else: the database is SQLite and runs inside the local Cloudflare runtime.

```bash
npm install        # installs wrangler (Cloudflare's CLI)
npm run setup      # creates the local database and loads the sample data
npm run dev        # starts the app on http://localhost:8788
```

To start over with fresh sample data: `npm run db:reset`.

## Stack

- **Front end:** plain HTML, CSS and JavaScript in `public/`. No framework and no build step.
- **API:** one Cloudflare Pages Function, `functions/api/[[path]].js`.
- **Database:** Cloudflare D1 (SQLite). Schema in `migrations/`, sample data in `seed/seed.sql`.
- **Hosting:** Cloudflare Pages (free tier). The same code runs locally and in production.

```
public/            index.html, styles.css, app.js, favicon.svg
functions/api/     the whole API (one file, ~400 lines, commented)
migrations/        database schema
seed/              sample users, items, loans and requests
scripts/           helper for resetting the local database
```

## Phenomena are data

Phenomena live in the `phenomena` table (name, short name, card colour, sort order, active flag). Filters, forms, chips and card colours are all built from that table, so a new phenomenon needs no code change:

```bash
npx wrangler d1 execute weatherlend-db --local --command \
  "INSERT INTO phenomena (slug, name, short_name, tint, ink, sort) VALUES ('hail', 'Hail', 'Hail', '#E1E8EC', '#35505E', 8)"
```

An item can belong to several phenomena (`item_phenomena`). The first one is the main one shown on the card, the others appear as “Also: …”. Size categories and their points per day (`size_categories`) and neighbourhoods are data as well.

## Points system

- Every user starts with **10 points** (one `welcome` row in the ledger).
- A loan costs **days × points per day** of the item's size category. Days are inclusive: 4 to 6 November is 3 days. Default values: small 1, medium 2, large 3.
- Borrowing deducts the points, lending adds **the same amount**, so the total in the community stays constant.
- **Ledger, not a counter.** Points are never stored as a single number. Each movement is a row in `ledger`, and the balance is `SUM(amount)`. That gives a full history for free and makes the balance easy to audit.
- **Request → accept.** A borrowing request is `pending` and reserves its points. You cannot request more than *balance − reserved points*. When the owner accepts, the status change and both ledger rows (−points for the borrower, +points for the lender) are written in one atomic database batch. Decline or withdraw releases the reservation.
- **“I have this”** on a posted request: the requester already asked for exactly those days, so the loan is accepted right away and the points move.
- **No double-booking:** an item cannot be requested for days on which it is already promised (pending or accepted), and only within its availability season (e.g. November to February).

## API

All endpoints are under `/api` and return JSON.

| Method | Path | |
|---|---|---|
| GET | `/meta` | phenomena (with item counts), size categories, neighbourhoods, demo users with balance |
| GET | `/items?phenomena=heat-wave,storm` | offers, filtered by any of the given phenomena |
| POST | `/items` | publish an offer |
| GET / POST | `/needs` | open requests / post a request |
| POST | `/needs/:id/fulfil` | answer a request with one of your items |
| POST | `/loans` | borrowing request for an offer |
| POST | `/loans/:id/accept` · `/decline` · `/cancel` | answer or withdraw a request |
| GET | `/users/:id/account` | balance, history, pending requests |
| GET | `/users/:id/loans?from=&to=` | loans in a date range (calendar) |
| POST | `/users/:id/notifications` | onboarding step 2 |

## Deploy to Cloudflare

```bash
npx wrangler login
npx wrangler d1 create weatherlend-db      # copy the printed database_id into wrangler.toml
npm run db:migrate:remote
npm run db:seed:remote
npm run deploy                             # prints the public URL, e.g. https://weatherlend.pages.dev
```

After the first deploy, open the project in the Cloudflare dashboard → **Settings → Bindings** and check that the D1 database `weatherlend-db` is bound as `DB` (wrangler normally takes it from `wrangler.toml`).

## Known limits of the prototype

- No authentication, by design. Anyone can act as any demo user.
- Notifications (onboarding step 2) are saved but not sent yet.
- Photos are stored in the database as small JPEGs (resized in the browser to max 900 px). A larger version should move them to object storage (Cloudflare R2).
- Balance checks and the insert are separate queries. With real concurrent users this should become a single conditional statement.

