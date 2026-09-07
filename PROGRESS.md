# DAN D Collection — Progress

Living status doc for this project. **Read this first when picking development
back up, and update it before wrapping up a session** — it's the single place
that tracks what's built, what's stubbed, and what's blocked on a decision, so
context carries forward instead of getting re-derived every time.

Last updated: 2026-09-07 · Repo: [`Dan_D_Backend`](https://github.com/Muhammad-Faizkhan/Dan_D_Backend) · Branch: `main` · Latest commit: `fdafd1b`

## Scope

Collector & trading platform mobile app — starts with Harley-Davidson
memorabilia, expands to a general collectibles marketplace. Source docs:
`Dan_D_Collections.docx` (business proposal) and `dc.html` (136-screen Figma
clickthrough prototype, screens mapped to routes via comments in the code).

Split of work: **backend built here**; the **mobile app is being built
separately by another developer** — not tracked in this file. Stack: Node.js,
Express, TypeScript, Prisma, MySQL (see "Decisions pending" — likely moving to
Postgres), Socket.IO for realtime.

## What's built

15 modules, 46 REST endpoints, real business logic (not scaffolding) — see
`backend/README.md` for the full real-vs-stubbed breakdown and
`backend/API-REFERENCE.md` for every endpoint's request/response shape.

| Module | Status | Notes |
|---|---|---|
| Auth | Built | Register/login/refresh/logout, JWT access + refresh tokens |
| Users & Plans | Built | Profile, password change, Free/Silver/Gold/Platinum tiers |
| Collections & Items | Built | Have/Want/For Trade/Showcase, plan upload-limit enforced |
| Wishlist | Built | Saved wants + keyword matching against active listings |
| Marketplace | Built | Sale/trade/auction listings, filtering & browsing |
| Auctions | Built | Bid validation, outbid alerts, winner settlement |
| Trades | Built | "You Give / You Get" — accept atomically swaps item ownership |
| Orders | Built | Checkout, price-offer negotiation, shipment status tracking |
| Messaging | Built | 1:1 conversations, REST **and live WebSocket** (send, typing, read receipts) |
| Notifications & Dealers | Built | In-app alerts; dealer locator with distance search |
| Payments | Stubbed | Checkout marks orders paid without a real charge — processor undecided |
| Image storage | Stubbed | Items accept ready-made URLs — no upload endpoint wired yet |
| Forgot-password OTP | Stubbed | No email/SMS provider chosen |
| Camera-scan item entry | Stubbed | No OCR vendor chosen |
| Push notifications | Not started | FCM/APNs not wired up |

## Docs & handoff (for the frontend/mobile dev)

- **Swagger UI**: `/docs` on the running server — interactive, every endpoint
- **`backend/openapi.json`**: raw OpenAPI 3.0 spec, also served at `/openapi.json`
- **`backend/postman_collection.json`**: import into Postman — auth token
  auto-fills after Login/Register (regenerate via `npm run postman:generate`
  after changing `openapi.json`)
- **`backend/API-REFERENCE.md`**: plain-text endpoint + body reference,
  including the WebSocket chat event contract — no tooling required to read it

## Decisions pending (blocking further work)

1. **"Selling chips" feature — what does "chips" mean?** Not in the original
   scope doc. Either a physical collectible (poker-run/casino chips, listed &
   traded like any other item — no new build needed) or an in-app currency
   wallet (a real new subsystem: purchase flow, ledger, spend logic). **Needs
   client answer.**
2. **Deployment host.** Leaning Render (easy setup, free tier, sleeps after 15
   min idle — avoidable with a keep-alive ping) vs. Fly.io (no sleep, more
   setup: Dockerfile + CLI). **Needs final pick.**
3. **Database engine for hosting.** Proposal specifies MySQL, but free MySQL
   hosting is trial-only (~30 days, e.g. Aiven). Leaning Supabase Postgres —
   genuinely free, one-line Prisma `provider` change, no schema/code impact.
   **Needs final pick.**
4. **Image storage provider.** Supabase Storage (same account as the DB
   decision above, 1GB free) vs. Cloudinary (image-specific, auto
   resize/CDN, separate account). **Needs pick before building the upload
   endpoint.**
5. **Payment processor.** Marketplace purchases need a real processor
   (Stripe is the default assumption); mobile subscription tiers need
   Apple/Google IAP specifically, for App Store/Play Store compliance — a
   card processor alone isn't allowed there. **Needs decision + accounts.**

## Full blocker list

See `README.md` (project root) and `backend/README.md` for the complete list,
including ones that don't block current work: app store developer accounts,
OCR vendor, real-time push for auctions/notifications (chat is the only
realtime feature so far), and design fidelity (the Figma source is flattened
screenshots, not editable — mobile UI will need to be eyeballed per screen).

## Next up

- Wire the chosen image store behind a signed-upload endpoint
- Deploy to the chosen free host, connect the chosen database, run the migration
- Scope and build the chips feature once its definition is confirmed
- Fill in a real payment processor for checkout once one's picked

---

*Maintenance note: when a module moves from stubbed to built, a decision
gets made, or a new blocker surfaces, update the relevant section above in
the same change — don't let this drift from what `backend/README.md` says.*
