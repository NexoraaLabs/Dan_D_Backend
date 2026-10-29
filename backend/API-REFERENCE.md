# DAN D Collection — API Reference

Plain endpoint + request/response reference for frontend integration. No repo
access or backend source needed — everything a client needs to call the API
is below.

Base URL: `http://localhost:4000` while running locally (ask for the shared
URL once it's deployed). All paths below are relative to that, e.g.
`POST /api/auth/login` = `POST http://localhost:4000/api/auth/login`.

## Auth

Every endpoint marked **Auth: yes** requires a header:

```
Authorization: Bearer <accessToken>
```

Get `accessToken` from `POST /api/auth/register` or `POST /api/auth/login`.
It expires in 15 minutes — use `POST /api/auth/refresh` with the
`refreshToken` (valid 30 days) to get a new pair without asking the user to
log in again.

Money fields are always integer **cents** (e.g. `499` = $4.99), not decimals.

---

## Auth

### `POST /api/auth/register` — Auth: no
Create Account → Verify Your Email → Enter The Code → Congratulations

Request body:
```json
{
  "email": "rider@example.com",
  "password": "at-least-8-chars",
  "username": "hd_collector",
  "fullName": "Jamie Rivera"
}
```
Response `201`:
```json
{ "accessToken": "eyJ...", "refreshToken": "eyJ..." }
```
`409` if email or username is already taken.

### `POST /api/auth/login` — Auth: no
Request body:
```json
{ "email": "rider@example.com", "password": "at-least-8-chars" }
```
Response `200`: same shape as register. `401` on bad credentials.

### `POST /api/auth/refresh` — Auth: no
Request body:
```json
{ "refreshToken": "eyJ..." }
```
Response `200`: new `{ accessToken, refreshToken }` pair.

### `POST /api/auth/logout` — Auth: yes
Request body:
```json
{ "refreshToken": "eyJ..." }
```
Response `204`, empty body.

---

## Users

### `GET /api/users/me` — Auth: yes
Screen: My Profile. No body. Response `200`:
```json
{
  "id": 12, "email": "rider@example.com", "username": "hd_collector",
  "fullName": "Jamie Rivera", "avatarUrl": null, "bio": null, "phone": null,
  "lat": null, "lng": null, "address": null,
  "planId": 1, "plan": { "id": 1, "code": "FREE", "name": "Free Trial", "priceCents": 0, "billingPeriod": "trial_15d", "itemLimit": 100 },
  "trialEndsAt": "2026-09-22T00:00:00.000Z", "createdAt": "2026-09-07T00:00:00.000Z"
}
```

### `GET /api/users/{id}` — Auth: no
Screens: Seller Profile - Tom, User Profile - Tom. Response `200`:
```json
{ "id": 7, "username": "tom_hd", "fullName": "Tom K.", "avatarUrl": null, "bio": null, "createdAt": "..." }
```

### `PATCH /api/users/me` — Auth: yes
Screen: Edit Profile. Request body (all fields optional):
```json
{ "fullName": "Jamie R.", "avatarUrl": "https://...", "bio": "Harley pin collector since 2010", "phone": "+1-555-0100", "lat": 39.96, "lng": -83.0, "address": "Columbus, OH" }
```
Response `200`: updated `User` object (same shape as `GET /api/users/me`).

### `POST /api/users/me/change-password` — Auth: yes
Screens: Change Password → Thank You - Password. Request body:
```json
{ "currentPassword": "old-pass", "newPassword": "new-pass-min-8" }
```
Response `204`. `401` if `currentPassword` is wrong.

---

## Plans

### `GET /api/plans` — Auth: no
Screen: Choose Your Plan. No body. Response `200`:
```json
[
  { "id": 1, "code": "FREE", "name": "Free Trial", "priceCents": 0, "billingPeriod": "trial_15d", "itemLimit": 100 },
  { "id": 2, "code": "SILVER", "name": "Silver Package", "priceCents": 499, "billingPeriod": "year", "itemLimit": 200 },
  { "id": 3, "code": "GOLD", "name": "Gold Package", "priceCents": 999, "billingPeriod": "year", "itemLimit": 450 },
  { "id": 4, "code": "PLATINUM", "name": "Platinum Package", "priceCents": 1999, "billingPeriod": "year", "itemLimit": null }
]
```

---

## Categories

### `GET /api/categories` — Auth: no
Screen: What Do You Collect. Top-level categories with nested `children`. Response `200`:
```json
[
  { "id": 1, "name": "Motorcycles & Memorabilia", "slug": "motorcycles", "icon": null, "parentId": null,
    "children": [ { "id": 2, "name": "Harley-Davidson Pins", "slug": "hd-pins", "icon": null, "parentId": 1, "children": [] } ] }
]
```

### `PUT /api/categories/me/interests` — Auth: yes
Screens: What Do You Collect, What Do You Collect - Edit. Request body:
```json
{ "categoryIds": [2, 3, 5] }
```
Response `204`. Replaces the user's full interest set (not additive).

---

## Collections

### `GET /api/collections` — Auth: yes
Screens: Collections - Events. My collections, each with an `_count.items`. Response `200`:
```json
[ { "id": 4, "ownerId": 12, "name": "Sturgis 2023", "description": null, "coverImageUrl": null, "eventDate": "2023-08-01T00:00:00.000Z", "createdAt": "...", "_count": { "items": 6 } } ]
```

### `POST /api/collections` — Auth: yes
Request body:
```json
{ "name": "Sturgis 2023", "description": "Rally run pins & patches", "coverImageUrl": "https://...", "eventDate": "2023-08-01T00:00:00.000Z" }
```
(`description`, `coverImageUrl`, `eventDate` optional.) Response `201`: the created `Collection`.

### `GET /api/collections/{id}` — Auth: no
Screen: Collections - Event Detail. Response `200`: `Collection` including `items` (each with `images`).

### `PATCH /api/collections/{id}` — Auth: yes
Request body: any subset of the create fields. Response `200`: updated `Collection`. `403` if you don't own it.

### `DELETE /api/collections/{id}` — Auth: yes
No body. Response `204`. `403` if you don't own it.

---

## Items (Collection Engine)

### `GET /api/items` — Auth: no
Screens: Home, My Profile - Listings, My Profile - Wishlist (`status=WANT`). Query params (all optional): `ownerId`, `status` (`HAVE`|`WANT`|`FOR_TRADE`|`SHOWCASE`), `categoryId`, `search`, `page` (default 1), `pageSize` (default 20).
Response `200`:
```json
{ "items": [ { "id": 101, "ownerId": 12, "collectionId": 4, "categoryId": 2, "title": "1994 Buckeye Chapter Pin", "description": null, "status": "SHOWCASE", "condition": "Mint", "brand": "Harley-Davidson", "year": 1994, "estimatedValueCents": 4500, "images": [ { "id": 1, "url": "https://...", "position": 0 } ], "createdAt": "..." } ], "total": 37, "page": 1, "pageSize": 20 }
```

### `POST /api/items` — Auth: yes
Screens: Add Item - Camera Scan → Item Details Form → Add to Collection. **Enforces the current plan's upload limit** (returns `403` once the plan's `itemLimit` is hit). Request body:
```json
{
  "title": "1994 Buckeye Chapter Pin",
  "description": "Enamel pin, minor wear",
  "status": "HAVE",
  "categoryId": 2,
  "collectionId": 4,
  "condition": "Mint",
  "brand": "Harley-Davidson",
  "year": 1994,
  "estimatedValueCents": 4500,
  "imageUrls": ["https://cdn.example.com/pin1.jpg"]
}
```
Only `title` is required. `imageUrls` are already-uploaded URLs — this endpoint does not accept file uploads (see "Known gaps" below). Response `201`: the created `Item`.

### `GET /api/items/{id}` — Auth: no
Screens: Item Detail - *. Response `200`: `Item` plus `category`, `owner` (`{id, username, avatarUrl}`), and `listing` if it's on the marketplace.

### `PATCH /api/items/{id}` — Auth: yes
Request body: any subset of the create fields except `imageUrls`. Response `200`: updated `Item`. `403` if you don't own it.

### `DELETE /api/items/{id}` — Auth: yes
No body. Response `204`. `403` if you don't own it.

---

## Wishlist

### `GET /api/wishlist` — Auth: yes
Screen: Wishlist. Response `200`: array of `Wishlist` entries with `category` and `matchedItem` (if any) populated.

### `POST /api/wishlist` — Auth: yes
Screen: Wishlist - Item Added. Request body:
```json
{ "query": "Sturgis 2005 rally pin", "categoryId": 2 }
```
(`categoryId` optional.) Response `201`: created `Wishlist` entry.

### `DELETE /api/wishlist/{id}` — Auth: yes
No body. Response `204`.

### `GET /api/wishlist/{id}/matches` — Auth: yes
Naive keyword match against active marketplace items in the same category. Response `200`: array of `Item`.

---

## Marketplace

### `GET /api/marketplace` — Auth: no
Screens: Marketplace, Filters. Query params (all optional): `listingType` (`SALE`|`TRADE`|`AUCTION`), `categoryId`, `minPriceCents`, `maxPriceCents`, `search`, `page`, `pageSize`.
Response `200`:
```json
{ "listings": [ { "id": 55, "itemId": 101, "item": { "...": "Item" }, "sellerId": 12, "listingType": "SALE", "priceCents": 2500, "status": "ACTIVE", "auction": null, "createdAt": "..." } ], "total": 12 }
```

### `POST /api/marketplace` — Auth: yes
List an item for sale, trade, or auction. You must own the item. Request body for a **sale**:
```json
{ "itemId": 101, "listingType": "SALE", "priceCents": 2500 }
```
Request body for an **auction**:
```json
{
  "itemId": 101, "listingType": "AUCTION",
  "auction": { "startPriceCents": 1000, "bidIncrementCents": 500, "startsAt": "2026-09-08T00:00:00Z", "endsAt": "2026-09-15T00:00:00Z" }
}
```
Response `201`: created `MarketplaceListing` (with `auction` populated for auction listings).

### `GET /api/marketplace/{id}` — Auth: no
Response `200`: `MarketplaceListing` with `item`, `seller`, and `auction` (including its 5 highest bids) populated.

### `POST /api/marketplace/{id}/cancel` — Auth: yes
No body. Response `200`: listing with `status: "CANCELLED"`. `403` if you're not the seller.

---

## Auctions

### `GET /api/auctions/{id}` — Auth: no
Screen: Auction Detail. Response `200`: `Auction` with `listing.item` and up to 20 recent `bids` (each with `bidder.{id,username}`).

### `POST /api/auctions/{id}/bids` — Auth: yes
Screens: Place Your Bid, Bid Placed. Request body:
```json
{ "amountCents": 1500 }
```
Must be `>= currentPriceCents + bidIncrementCents`. `400` if too low or the auction isn't `LIVE`; sellers get `403` bidding on their own auction. Response `201`: the created `Bid`. The previous high bidder gets a `bid_outbid` notification automatically.

### `POST /api/auctions/{id}/close` — Auth: yes
Screens: Auction Winner, Auction Lost. No body. Picks the highest bidder as winner, marks the listing `SOLD`, and notifies the winner. Response `200`: the closed `Auction`.

---

## Trades ("You Give / You Get")

### `GET /api/trades` — Auth: yes
Screen: Trade Matches. Response `200`: array of `TradeRequest` (sent or received), each with `offerItems` (tagged `GIVE`/`GET`) and `initiator`/`recipient`.

### `POST /api/trades` — Auth: yes
Screens: Propose Trade → Add to Trade → Review & Confirm → Trade Offer Sent. Request body:
```json
{
  "recipientId": 7,
  "message": "Would you trade your Asheville pin for my Buckeye + Bourbon Street?",
  "offerItems": [
    { "itemId": 101, "side": "GIVE" },
    { "itemId": 205, "side": "GIVE" },
    { "itemId": 340, "side": "GET" }
  ]
}
```
`side: "GIVE"` items must be owned by you (the caller); `side: "GET"` items must be owned by `recipientId`. Response `201`: created `TradeRequest`, status `PENDING`. Recipient gets a `trade_request` notification.

### `GET /api/trades/{id}` — Auth: yes
Response `200`: `TradeRequest` detail. `403` if you're neither party.

### `POST /api/trades/{id}/respond` — Auth: yes
Screens: Trade Confirmed, Trade Rejected. Only the **recipient** can call this. Request body:
```json
{ "accept": true }
```
Accepting **atomically swaps ownership** of every offered item and sets status `COMPLETED`; rejecting sets `REJECTED`. Response `200`: updated `TradeRequest`.

### `POST /api/trades/{id}/cancel` — Auth: yes
Only the **initiator** can cancel, and only while still `PENDING`. No body. Response `200`: updated `TradeRequest`.

---

## Orders (Buy Flow)

### `GET /api/orders` — Auth: yes
Screens: Orders - Purchase, Orders - Trade. Response `200`: array of `Order` (as buyer or seller), each with `items` and `listing`.

### `GET /api/orders/{id}` — Auth: yes
Response `200`: `Order` detail with `shippingAddress`. `403` if you're neither buyer nor seller.

### `POST /api/orders/checkout` — Auth: yes
Screens: Shipping → Payment - Checkout → Order Placed. Only for `SALE` listings (not `AUCTION` — those settle via `/auctions/{id}/close`). Request body:
```json
{ "listingId": 55, "shippingAddressId": 3, "paymentMethodId": 8 }
```
(`shippingAddressId`/`paymentMethodId` optional.) **Payment capture is currently stubbed** — the order is marked `PAID` immediately without an actual charge (see "Known gaps"). Response `201`: created `Order`.

### `POST /api/orders/{id}/advance` — Auth: yes (seller only)
Screen: Track Order. Valid transitions: `PAID`→`SHIPPED`|`CANCELLED`, `SHIPPED`→`DELIVERED`. Request body:
```json
{ "status": "SHIPPED", "trackingNumber": "1Z999AA10123456784" }
```
Response `200`: updated `Order`. `400` if the transition isn't valid from the order's current status.

### `POST /api/orders/requests` — Auth: yes
Screens: Order Request - Sent, Order Request - Received. Propose a different price on a `SALE` listing before checkout. Request body:
```json
{ "listingId": 55, "offerAmountCents": 2000 }
```
Response `201`: created `OrderRequest`, status `PENDING`. Seller gets an `order_request` notification.

### `GET /api/orders/requests/mine` — Auth: yes
Response `200`: array of `OrderRequest` (sent or received).

### `POST /api/orders/requests/{id}/respond` — Auth: yes (seller only)
Screens: Confirm Request → Request Sent, Order Rejected. Request body:
```json
{ "accept": true }
```
Response `200`: updated `OrderRequest`. Note: accepting an order request does **not** auto-create an `Order` — the buyer still calls `/orders/checkout` afterward at the agreed price.

---

## Checkout profile: shipping addresses & cards

### `GET /api/shipping-addresses` — Auth: yes
Response `200`: array of `ShippingAddress`.

### `POST /api/shipping-addresses` — Auth: yes
Request body:
```json
{ "fullName": "Jamie Rivera", "line1": "123 Main St", "line2": "Apt 4", "city": "Columbus", "state": "OH", "zip": "43215", "country": "US", "phone": "+1-555-0100", "isDefault": true }
```
(`line1`/`city`/`state`/`zip`/`country`/`fullName` required, rest optional.) Response `201`: created `ShippingAddress`.

### `DELETE /api/shipping-addresses/{id}` — Auth: yes
No body. Response `204`.

### `GET /api/payment-methods` — Auth: yes
Screen: Payment Methods. Response `200`: array of `PaymentMethod` (no raw card numbers ever stored or returned — only `brand`/`last4`/expiry/`isDefault`).

### `POST /api/payment-methods` — Auth: yes
Screens: Add Card → Card Added. **Tokenize the card client-side (e.g. Stripe SDK) first — never send a raw card number to this API.** Request body:
```json
{ "brand": "Visa", "last4": "4242", "expMonth": 12, "expYear": 2028, "providerToken": "pm_xxx_from_stripe_sdk", "isDefault": true }
```
Response `201`: created `PaymentMethod`.

### `DELETE /api/payment-methods/{id}` — Auth: yes
Screen: Manage Card. No body. Response `204`.

---

## Messages

### `GET /api/messages/conversations` — Auth: yes
Screens: Messages, Messages 2. Response `200`: array of `Conversation`, each with `participants` (`{userId, user}`) and the latest `messages[0]` as a preview.

### `POST /api/messages/conversations` — Auth: yes
Screens: Chat - Tom, Chat - ChipKing92 (starting a new thread). Reuses an existing 1:1 conversation with that user if one exists. Request body:
```json
{ "userId": 7, "body": "Hey, is the Asheville pin still available?" }
```
Response `201`:
```json
{ "conversationId": 9, "message": { "id": 41, "conversationId": 9, "senderId": 12, "body": "Hey, is the Asheville pin still available?", "attachmentUrl": null, "createdAt": "..." } }
```

### `GET /api/messages/conversations/{id}/messages` — Auth: yes
Response `200`: array of `Message`, oldest first. `403` if you're not a participant.

### `POST /api/messages/conversations/{id}/messages` — Auth: yes
Request body (need `body` and/or `attachmentUrl`):
```json
{ "body": "Yep, still have it!" }
```
Response `201`: created `Message`. Other participants get a `new_message` notification.

### `POST /api/messages/conversations/{id}/read` — Auth: yes
No body. Marks the conversation read for the caller. Response `204`.

### Realtime chat (WebSocket)

Everything above also works live over Socket.IO — same auth, same data,
instant delivery instead of polling. Connect once per app session:

```js
import { io } from "socket.io-client";
const socket = io("http://localhost:4000", { auth: { token: accessToken } });
```

Connection is rejected (`connect_error`) if `token` is missing, invalid, or
expired — refresh and reconnect the same way you'd retry a REST call.

**Client → server events:**

| Event | Payload | What it does |
|---|---|---|
| `conversation:join` | `{ conversationId }` | Start receiving `message:new` for this conversation. Call before opening a chat screen. Ack: `{ ok: true }` or `{ ok: false, error }` (e.g. not a participant). |
| `conversation:leave` | `{ conversationId }` | Stop receiving events for it (e.g. on screen close). |
| `message:send` | `{ conversationId, body?, attachmentUrl? }` | Same validation as the REST send endpoint. Ack returns `{ ok: true, message }` or `{ ok: false, error }`. |
| `typing:start` / `typing:stop` | `{ conversationId }` | Broadcasts a typing indicator to the other participant(s). |
| `conversation:read` | `{ conversationId }` | Same as the REST read endpoint; also notifies the room. |

**Server → client events:**

| Event | Payload | When |
|---|---|---|
| `message:new` | `Message` object | Any time a message is created in a conversation you've joined — whether it was sent via socket or via the REST endpoint. |
| `typing` | `{ conversationId, userId, isTyping }` | Another participant started/stopped typing. |
| `conversation:read` | `{ conversationId, userId }` | Another participant marked the conversation read. |
| `conversation:new` | `{ conversationId }` | Sent to you personally (no join needed) when someone starts a brand-new thread with you. |
| `notification:new` | `{ type, conversationId }` | Lightweight ping for badge/unread-count updates; same events as the `/api/notifications` list. |

Every socket auto-joins a personal room, so `conversation:new` and
`notification:new` arrive without calling `conversation:join` first — only
in-conversation events (`message:new`, `typing`, `conversation:read`) need
that join.

---

## Notifications

### `GET /api/notifications` — Auth: yes
Screen: Notifications. Response `200`: up to 100 most recent `Notification`, newest first. `type` values currently emitted: `trade_request`, `trade_accepted`, `trade_rejected`, `bid_outbid`, `auction_won`, `order_placed`, `order_status`, `order_request`, `order_request_accepted`, `order_request_rejected`, `new_message`.

### `POST /api/notifications/{id}/read` — Auth: yes
No body. Response `200`: updated `Notification`. `403` if it's not yours.

### `POST /api/notifications/read-all` — Auth: yes
No body. Response `204`.

---

## Dealers (Map)

### `GET /api/dealers/nearby` — Auth: no
Screens: Map, Map - Dealers List. Query params: `lat` (required), `lng` (required), `radiusKm` (optional, default 50).
Response `200`: array of `Dealer` sorted nearest-first, each with a computed `distanceKm`.

---

## Error shape

Every non-2xx response looks like:
```json
{ "error": "Human-readable message", "details": { } }
```
`details` is present for validation failures (`400`) and omitted otherwise. Common status codes: `400` bad input, `401` missing/invalid/expired token, `403` not allowed (wrong owner, wrong role in a flow), `404` not found, `409` conflict (duplicate email/username on register).

## Known gaps (things that look real but are stubbed)

- **Payment capture**: `/orders/checkout` marks the order `PAID` without calling a real payment processor.
- **Card tokenization**: `/payment-methods` expects a `providerToken` already produced by a client-side SDK (e.g. Stripe) — it does not accept raw card numbers.
- **Image upload**: `/items` takes `imageUrls` (already-hosted URLs), not file uploads.
- **Forgot-password OTP**: not implemented yet (no email/SMS provider chosen).
- **Real-time delivery**: chat now has full WebSocket support (see above). Bid updates and general notifications are still poll-via-REST — no live push for those yet.

---

## Added 2026-10-29 — integration endpoints

Everything below was added for wiring up the mobile app, web app and admin
dashboard. Changes to existing endpoints are listed first.

### Changes to existing endpoints

- `POST /api/auth/register` now also emails a 6-digit verification code. The
  response may include `devCode` (see "Email codes" below).
- `GET /api/users/me` now includes `preferences` and
  `stats: { items, listings, trades, collections, wishlist }`.
- `GET /api/users/{id}` now includes the same `stats` object (seller profile header).
- `POST/PATCH /api/items`: new optional `rarity`, one of `COMMON | RARE | ULTRA_RARE | LEGENDARY`.
  `GET /api/items` accepts `?rarity=`.
- `POST/PATCH /api/collections`: new optional `location` (string, e.g. `"Sturgis, SD"`).
- `GET /api/marketplace` takes these new query params:
  - `rarity`
  - `sort`: `newest` (default), `price_asc`, `price_desc` or `nearest`
  - `lat` + `lng` (the viewer's position). With these, every listing gets a `distanceKm` field.
  - `radiusKm`: needs `lat`/`lng`. `sort=nearest` also needs `lat`/`lng`.
  - Each listing's `item` now includes `category`.
- `GET /api/trades` and `GET /api/trades/{id}` now return only public fields
  for `initiator` / `recipient` (`id, username, fullName, avatarUrl`).

### Email codes (verification + password reset)

No email provider has been chosen yet. Codes are written to the server log
(Railway → Deployments → Logs, look for `[mailer]`). If the server sets
`EXPOSE_DEV_CODES=true`, responses that send a code also include
`"devCode": "123456"` so the apps can be tested end to end. Turn this off
before real users sign up. Codes are 6 digits, expire after 10 minutes, and
stop working after 5 wrong attempts.

### `POST /api/auth/verify-email/resend` — Auth: yes
Verify Your Email → "Resend". Response: `{ "sent": true, "devCode"?: "123456" }`

### `POST /api/auth/verify-email` — Auth: yes
Enter The Code. Body: `{ "code": "123456" }` → `204`. Sets `emailVerifiedAt` on the user.

### `POST /api/auth/forgot-password` — Auth: no
Forgot Password. Body: `{ "email": "rider@example.com" }` → `{ "sent": true }`.
Always returns `sent: true`, even for unknown emails, so it can't be used to
probe for accounts.

### `POST /api/auth/forgot-password/verify` — Auth: no
Enter OTP (Reset). Body: `{ "email", "code" }` → `{ "valid": true }`, or `400`
with `"Incorrect code"` / `"Code expired. Request a new one."`. The code is
not used up by this call.

### `POST /api/auth/reset-password` — Auth: no
Create New Password. Body: `{ "email", "code", "newPassword" }` → `204`.
Signs the user out on every device (all refresh tokens are revoked).

### `POST /api/uploads` — Auth: yes
Upload images before referencing them. Send `multipart/form-data` with 1–10
parts named `files` (JPEG/PNG/WebP/HEIC, max 10 MB each).
Response `201`: `{ "urls": ["https://<host>/uploads/ab12....jpg"] }`.
Put the URLs in `imageUrls` (items, feedback), `avatarUrl` (profile),
`coverImageUrl` (collections) or `attachmentUrl` (messages).

### Subscriptions (app side)

Choose Your Plan → Payment → Subscribed. **The charge is stubbed**: it always
succeeds and records a `PAID` payment. For the store builds this must become
Apple/Google in-app purchase validation.

- `GET /api/subscriptions/me` — Auth: yes →
  `{ plan, trialEndsAt, planExpiresAt, itemCount, subscription | null }`
- `POST /api/subscriptions` — Auth: yes. Body: `{ "planId": 2, "paymentMethodId"?: 5 }` → `201` subscription with `plan` and `payments`.
  Ends any current subscription. The free trial plan can't be bought.
- `PATCH /api/subscriptions/me` — Auth: yes. Body: `{ "autoRenew": false }`
- `POST /api/subscriptions/me/cancel` — Auth: yes. Stops renewal. The plan
  stays active until `expiresAt`, then the user drops back to Free.

### `GET /api/trades/matches` — Auth: yes
Trade Matches. Built from the user's WANT items and wishlist entries. Up to 20 results, best first:
```json
[{ "user": { "id": 7, "username": "HDCollector", "fullName": null, "avatarUrl": null },
   "userTrades": 156, "match": 92,
   "get":  { "id": 41, "title": "Yankee Bristol Teal", "rarity": "RARE", "images": [...] },
   "give": { "id": 12, "title": "Bristol Wide", "images": [...] } }]
```
`give` is `null` when nothing of yours matches their wants. `match` is 0–100.

### `GET /api/users/me/activity` — Auth: yes
My Activity. Newest first, up to 50 entries. Each entry has `type` and `at`:
- `listed`: `item`, `listingType`, `listingId`
- `bid`: `item`, `amountCents`, `winning`, `auctionId`
- `trade_completed`: `tradeId`, `with` (user)
- `wishlist_added`: `wishlistId`, `query`

### `GET /api/users/me/preferences` · `PATCH /api/users/me/preferences` — Auth: yes
Settings → Push Notifications and Trade Preferences. The PATCH body is partial at every level:
```json
{ "push": { "auctionAlerts": true, "wishlistMatches": true, "nearbyTopTrades": false, "weeklyDigest": false },
  "trade": { "autoAcceptFairTrades": false, "willingToTradeFor": ["Harley chips", "Patches"] } }
```

### `POST /api/users/me/device-tokens` · `DELETE /api/users/me/device-tokens` — Auth: yes
Registers the device's FCM/APNs token after login, and removes it on logout.
Body: `{ "token": "...", "platform": "ios" | "android" | "web" }`. DELETE needs only `{ "token" }`.
Nothing sends pushes yet. This only stores the tokens.

### `POST /api/feedback` — Auth: yes
Help & Feedback. Body: `{ "message": "...", "imageUrls"?: [...] }` → `201`.

### `GET /api/promotions/active` — Auth: no
Home carousel: promotions running right now. Optional `?type=PROFILE|SELLER|LISTING`.

---

## Admin dashboard

Log in with `POST /api/auth/admin/login` (same body and response as `/login`,
but only accounts with `isAdmin` can sign in). Every `/api/admin/*` route
needs that token and returns `403` if the account isn't an admin.

For the admin's own profile and password, use `GET/PATCH /api/users/me` and
`POST /api/users/me/change-password`. Forgot password uses the same
`/api/auth/forgot-password` flow as above.

Lists are paginated with `?page=1&pageSize=20` and return `{ items, total, page, pageSize }`.

| Endpoint | Screen |
|---|---|
| `GET /api/admin/dashboard?days=30` | Dashboard: `stats {totalUsers,newUsers,activeSubscriptions,activePromotions}`, `userGrowth[] {date,newUsers,totalUsers}`, `weeklyActivity[] {date,subscriptions,promotions}`, `recentUsers[]`, `recentSubscriptionActivity[]` |
| `GET /api/admin/analytics?months=12` | Analytics: `revenue {totalCents,subscriptionsCents,promotionsCents,growthPercent}`, `series[] {month,subscriptionsCents,promotionsCents,totalCents,newUsers,totalUsers}` |
| `GET /api/admin/settings` · `PATCH /api/admin/settings` | Settings → General: `{ storeName, supportEmail, timezone }` |
| `GET /api/admin/notifications` | Top-bar panel, last 7 days: `type` is `user_signup`, `subscription_started`, `payment_failed` or `feedback` |
| `GET /api/admin/feedback` | Feedback sent from the apps |
| `GET /api/admin/users?filter=all\|active\|free\|suspended\|subscribed\|banned&search=&sort=newest\|oldest\|lastActive` | User Management |
| `GET /api/admin/users/{id}` | User Details |
| `POST /api/admin/users/{id}/suspend` · `/restore` · `/ban` | Body `{ "reason": "..." }`, recorded in the audit log |
| `GET /api/admin/subscriptions?status=&planId=&search=` · `GET /api/admin/subscriptions/{id}` | Subscribers, Subscription Details + billing history |
| `GET/POST /api/admin/plans` · `GET/PATCH/DELETE /api/admin/plans/{id}` | Plans tab, Create / Edit Plan |
| `GET/POST /api/admin/promotions` · `GET/PATCH/DELETE /api/admin/promotions/{id}` · `POST /api/admin/promotions/{id}/cancel` | Ads Promotion |
