# DAN D Collection

Collector & trading platform mobile app — implementation workspace, derived from
`Dan_D_Collections.docx` (Exhibit C business proposal) and the `dc.html`
Figma clickthrough prototype (136 screens).

## What's here

- `backend/` — Node.js + TypeScript + Express + Prisma (MySQL) API. Backend-first
  slice, built out first per project priority. Covers every module in the
  proposal: auth, users/profile, plans & subscriptions, categories, collections,
  items (Have/Want/For Trade/Showcase), wishlist & matching, marketplace
  (sale/trade/auction), auctions & bidding, the "You Give / You Get" trading
  system, orders (checkout, order requests, shipping, payment methods,
  tracking), messaging, notifications, and the dealer locator/map.
- `mobile/` — not started yet. Flutter app matching the 136 Figma screens
  (`SIDEBAR`/`LABELS` map inside `dc.html`'s `<script>` gives the full screen
  list and navigation graph — reuse it directly for the app's route table).

See `backend/README.md` for setup and what's stubbed vs. real.

## Open blockers (need a decision before certain pieces can be finished)

1. **MySQL instance.** Nothing is running locally (no `mysql` client, no
   Docker found on this machine). Point `DATABASE_URL` at a local install, a
   Docker container, or a managed instance (AWS RDS / PlanetScale / GCP Cloud
   SQL) and run `npx prisma migrate dev`.
2. **Mobile subscription billing.** The proposal's Silver/Gold/Platinum tiers
   are in-app subscriptions; Apple App Store and Google Play require these to
   go through their native IAP systems, not a third-party card processor.
   `backend/.env.example` has placeholders for `APPLE_IAP_SHARED_SECRET` /
   `GOOGLE_PLAY_PACKAGE_NAME`, but receipt validation isn't implemented yet.
3. **Marketplace payments.** Non-subscription purchases (buying an item,
   winning an auction) can use Stripe; `orders.service.ts` stubs checkout as
   "always succeeds" — real charge capture needs a Stripe account + webhook
   handling for payment confirmation/refunds.
4. **Camera-scan item entry.** The "Add Item - Camera Scan" screen implies
   OCR/image recognition to auto-fill item details; no vendor chosen. Backend
   currently just accepts already-uploaded image URLs on item create.
5. **Image storage.** `.env.example` has S3 placeholders; nothing uploads
   there yet — `POST /api/items` takes image URLs, assuming upload happens
   client-side or via a small pre-signed-URL endpoint still to be added.
6. **Real-time delivery.** ~~Messaging~~ is now live over WebSocket
   (JWT-authenticated Socket.IO — message push, typing, read receipts; see
   `backend/src/realtime/`). Live auction bid updates and general
   notifications are still REST-only (poll-based) — `socket.io` is wired up
   for chat but not yet reused for those.
7. **Push notifications.** `DeviceToken` model exists; nothing sends to FCM/APNs
   yet.
8. **Maps/geocoding.** Dealer "nearby" search takes raw lat/lng from the
   client; no geocoding of typed addresses (needs a Google Maps or Mapbox key).
9. **App store accounts.** Deployment-ready builds need Apple Developer and
   Google Play Console accounts/signing certs — outside what I can set up.
10. **Design fidelity.** `dc.html` is flattened screenshots, not editable
    Figma — the mobile app's pixel-level styling will need to be eyeballed
    per screen rather than pulled from design tokens.

None of these block starting the Flutter app or continuing backend work —
they're flagged so the right calls get made (which processor, which OCR
vendor, etc.) before those specific pieces are built for real.
# Dan_D_Backend
