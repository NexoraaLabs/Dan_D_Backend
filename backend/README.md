# backend

Node.js + TypeScript + Express + Prisma (MySQL) API for the DAN D Collection app.

## Setup

```bash
npm install
cp .env.example .env   # then fill in DATABASE_URL at minimum
npx prisma migrate dev --name init
npm run seed            # subscription plans + starter categories
npm run dev              # http://localhost:4000
```

`GET /health` should return `{ "ok": true }` once it's running.

## API docs (for the mobile developer)

The mobile app is being built separately, so the API is documented for
integration without needing to read this source:

- **Interactive docs:** `http://localhost:4000/docs` (Swagger UI) once the
  server is running — every endpoint, request/response shape, and which
  Figma screen(s) it backs.
- **Raw spec:** `openapi.json` in this folder, also served live at
  `/openapi.json`.
- **Postman collection:** `postman_collection.json`, generated from the spec
  via `npm run postman:generate` (regenerate after changing `openapi.json`).
  Import it into Postman — it comes with a `baseUrl` variable and a
  `bearerToken` variable that auto-populates from the response of
  Register/Login/Refresh, so every other request just works after one login
  call.

Auth for every protected endpoint: `Authorization: Bearer <accessToken>` from
`/api/auth/login` or `/api/auth/register`; refresh with `/api/auth/refresh`
when the access token (15 min TTL) expires.

**Keep `openapi.json` in sync with the routes.** It's hand-written, not
generated from the Express/Zod code, so if a route's request/response shape
changes, update `openapi.json` in the same change and re-run
`npm run postman:generate`.

## Layout

```
prisma/schema.prisma   data model for every module (see top-level README's blocker list)
prisma/seed.ts          plans + starter categories
src/app.ts               express app, all routers mounted under /api/*
src/index.ts              entrypoint
src/config/               env loading, prisma client
src/middleware/            JWT auth guard, centralized error handler
src/utils/                 jwt signing, async route wrapper, typed HttpError
src/modules/<name>/        one module per proposal feature area:
                            auth, users, plans, categories, collections, items,
                            wishlist, marketplace, auctions, trades, orders,
                            checkout-profile (shipping addresses + cards),
                            messages, notifications, dealers
```

Each route handler has a comment naming the Figma screen(s) it backs, so it's
easy to cross-reference against `dc.html`'s screen list while building the
Flutter UI.

## What's real vs. stubbed

Real, with actual business logic and validation:
- Auth (register/login/refresh/logout, JWT access + refresh tokens)
- Collection Engine (collections, items, status transitions, plan upload-limit
  enforcement)
- Wishlist + naive keyword matching
- Marketplace listings (sale/trade/auction creation, browsing/filtering)
- Auctions: bid validation (increment, timing, self-bid guard), outbid
  notifications, closing an auction and picking a winner
- Trading: propose (You Give / You Get), accept (atomically swaps item
  ownership), reject, cancel
- Orders: checkout, order-request price negotiation, order status
  progression (PAID -> SHIPPED -> DELIVERED) with valid-transition checks
- Messaging: 1:1 conversations, send/read
- Notifications: created as a side effect of the above, list/mark-read

Stubbed (see top-level `README.md` blockers list for why):
- Payment capture in `orders.service.ts` (`checkout`) — marks orders PAID
  immediately instead of calling a real processor
- Forgot-password OTP delivery (no email/SMS provider wired up)
- Image upload (`POST /api/items` takes ready-made URLs, not files)
- Push notifications, WebSocket delivery for chat/live bidding
