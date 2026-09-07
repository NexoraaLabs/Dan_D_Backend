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
import { errorHandler, notFoundHandler } from "./middleware/error";

export function createApp() {
  const app = express();

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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
