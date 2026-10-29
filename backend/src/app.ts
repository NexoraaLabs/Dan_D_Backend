import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import openapiDocument from "../openapi.json";

import { authRouter } from "./modules/auth/auth.routes";
import { usersRouter } from "./modules/users/users.routes";
import { plansRouter } from "./modules/plans/plans.routes";
import { categoriesRouter } from "./modules/categories/categories.routes";
import { collectionsRouter } from "./modules/collections/collections.routes";
import { itemsRouter } from "./modules/items/items.routes";
import { wishlistRouter } from "./modules/wishlist/wishlist.routes";
import { marketplaceRouter } from "./modules/marketplace/marketplace.routes";
import { auctionsRouter } from "./modules/auctions/auctions.routes";
import { tradesRouter } from "./modules/trades/trades.routes";
import { ordersRouter } from "./modules/orders/orders.routes";
import { shippingAddressesRouter, paymentMethodsRouter } from "./modules/checkout-profile/checkout-profile.routes";
import { messagesRouter } from "./modules/messages/messages.routes";
import { notificationsRouter } from "./modules/notifications/notifications.routes";
import { dealersRouter } from "./modules/dealers/dealers.routes";
import { promotionsRouter } from "./modules/promotions/promotions.routes";
import { subscriptionsRouter } from "./modules/subscriptions/subscriptions.routes";
import { uploadDir, uploadsRouter } from "./modules/uploads/uploads.routes";
import { feedbackRouter } from "./modules/feedback/feedback.routes";
import { adminDashboardRouter } from "./modules/admin/admin.dashboard.routes";
import { adminUsersRouter } from "./modules/admin/admin.users.routes";
import { adminPlansRouter } from "./modules/admin/admin.plans.routes";
import { adminSubscriptionsRouter } from "./modules/admin/admin.subscriptions.routes";
import { adminPromotionsRouter } from "./modules/admin/admin.promotions.routes";
import { requireAdmin } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/error";

export function createApp() {
  const app = express();

  // Railway terminates TLS at its proxy; trust it so req.protocol is "https" in upload URLs.
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());
  if (process.env.NODE_ENV !== "test") {
    app.use(morgan("dev"));
  }

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Interactive API docs for the mobile team: http://localhost:4000/docs
  app.get("/openapi.json", (_req, res) => res.json(openapiDocument));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));

  // Uploaded images. helmet's default same-origin resource policy would stop
  // the web app and admin dashboard (other origins) from displaying them.
  app.use(
    "/uploads",
    express.static(uploadDir, {
      immutable: true,
      maxAge: "365d",
      setHeaders: (res) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"),
    })
  );

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/plans", plansRouter);
  app.use("/api/categories", categoriesRouter);
  app.use("/api/collections", collectionsRouter);
  app.use("/api/items", itemsRouter);
  app.use("/api/wishlist", wishlistRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/auctions", auctionsRouter);
  app.use("/api/trades", tradesRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/shipping-addresses", shippingAddressesRouter);
  app.use("/api/payment-methods", paymentMethodsRouter);
  app.use("/api/messages", messagesRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/dealers", dealersRouter);
  app.use("/api/promotions", promotionsRouter);
  app.use("/api/subscriptions", subscriptionsRouter);
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/feedback", feedbackRouter);

  // Admin dashboard: every route needs a valid token on an isAdmin account.
  // The admin's own profile and password use /api/users/me like any user.
  app.use("/api/admin", requireAdmin);
  app.use("/api/admin", adminDashboardRouter);
  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/admin/plans", adminPlansRouter);
  app.use("/api/admin/subscriptions", adminSubscriptionsRouter);
  app.use("/api/admin/promotions", adminPromotionsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
