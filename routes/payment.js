import express from "express";
import Stripe from "stripe";
import crypto from "crypto";
import mongoose from "mongoose";
import PurchaseOrder from "../models/PurchaseOrder.js";
import PurchaseOrderDraft from "../models/PurchaseOrderDraft.js";
import User from "../models/User.js";
import Guest from "../models/Guest.js";
import { sendOrderEmailsInBackground } from "../utils/orderEmails.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

console.log(
  "Stripe key loaded:",
  process.env.STRIPE_SECRET_KEY
    ? process.env.STRIPE_SECRET_KEY.slice(0, 8) + "..."
    : "NOT FOUND"
);

/* ------------------------------------------------ */
/* EMAIL HELPER (PREVENT DUPLICATES) */
/* ------------------------------------------------ */

async function sendOrderEmailIfNeeded(order, source) {
  try {
    if (order.customerEmailSentAt && order.adminEmailSentAt) {
      console.log("Emails already sent. Skipping.");
      return;
    }

    console.log(`Sending order emails from ${source} for order ${order.purchaseOrderId}`);

    await sendOrderEmailsInBackground(order, source);

    order.customerEmailSentAt = new Date();
    order.adminEmailSentAt = new Date();

    await order.save();
  } catch (err) {
    console.error("Email send error:", err);
  }
}

/* ------------------------------------------------ */
/* UTILITIES */
/* ------------------------------------------------ */

async function resolveCustomerEmail(order, ownerType, ownerId) {
  if (order?.email) return order.email;

  if (order?.ownerType && order?.ownerId) {
    if (order.ownerType === "User") {
      const user = await User.findById(order.ownerId).select("email").lean();
      if (user?.email) return user.email;
    }

    if (order.ownerType === "Guest") {
      const guest = await Guest.findById(order.ownerId).select("email").lean();
      if (guest?.email) return guest.email;
    }
  }

  if (ownerType && ownerId) {
    if (ownerType === "User") {
      const user = await User.findById(ownerId).select("email").lean();
      if (user?.email) return user.email;
    }

    if (ownerType === "Guest") {
      const guest = await Guest.findById(ownerId).select("email").lean();
      if (guest?.email) return guest.email;
    }
  }

  return undefined;
}

const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id)
    ? new mongoose.Types.ObjectId(id)
    : id;

const buildFallbackPurchaseOrderId = (sessionId) => {
  const tail =
    String(sessionId || "").slice(-8) ||
    crypto.randomBytes(4).toString("hex");

  return `PO-${Date.now()}-${tail}`;
};

/* ------------------------------------------------ */
/* CREATE ORDER FROM STRIPE SESSION */
/* ------------------------------------------------ */

async function createOrderFromStripeSession(sessionId) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (!session) return null;

  const existing = await PurchaseOrder.findOne({
    stripeSessionId: session.id,
  });

  if (existing) return existing;

  const metadata = session.metadata || {};

  const lineItemsRes =
    await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 100,
    });

  const items =
    lineItemsRes?.data?.map((li) => ({
      description: li.description || "Product",
      qty: li.quantity || 1,
      price: (li.amount_total || 0) / 100,
      total: (li.amount_total || 0) / 100,
    })) || [];

  const purchaseOrderId =
    metadata.purchaseOrderId || buildFallbackPurchaseOrderId(session.id);

  const order = await PurchaseOrder.create({
    purchaseOrderId,
    ownerType: metadata.ownerType,
    ownerId: toObjectId(metadata.ownerId),
    stripeSessionId: session.id,
    email:
      session.customer_email ||
      session.customer_details?.email ||
      "",
    items,
    subtotal: items.reduce((s, i) => s + i.total, 0),
    totalAmount: (session.amount_total || 0) / 100,
    paymentStatus:
      session.payment_status === "paid" ? "paid" : "pending",
    shippingInfo: {
      name: session.customer_details?.name || "",
      address: session.customer_details?.address?.line1 || "",
      city: session.customer_details?.address?.city || "",
      postalCode:
        session.customer_details?.address?.postal_code || "",
      country:
        session.customer_details?.address?.country || "",
    },
  });

  if (order.paymentStatus === "paid") {
    await sendOrderEmailIfNeeded(order, "PaymentFallback");
  }

  return order;
}

/* ------------------------------------------------ */
/* CREATE STRIPE CHECKOUT SESSION */
/* ------------------------------------------------ */

router.post("/create-checkout-session", async (req, res) => {
  try {
    const {
      items,
      shippingInfo,
      purchaseOrderId,
      form,
    } = req.body;

    if (!items?.length)
      return res
        .status(400)
        .json({ error: "items required" });

    const line_items = items.map((it) => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: it.name || it.description || "Product",
        },
        unit_amount: Math.round((it.price || 0) * 100),
      },
      quantity: Math.max(1, Number(it.qty || 1)),
    }));

    const customerEmail =
      form?.email || shippingInfo?.email;

    if (!customerEmail)
      return res
        .status(400)
        .json({ error: "Customer email required" });

    const frontendUrl =
      req.headers.origin ||
      process.env.VITE_FRONTEND_URL ||
      "http://localhost:5173";

    const session =
      await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items,
        success_url: `${frontendUrl}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/checkout`,
        customer_email: customerEmail,
        metadata: {
          purchaseOrderId,
        },
      });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to create checkout session",
    });
  }
});

/* ------------------------------------------------ */
/* FETCH ORDER BY STRIPE SESSION */
/* ------------------------------------------------ */

router.get("/order/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId)
      return res
        .status(400)
        .json({ error: "sessionId required" });

    const existing =
      await PurchaseOrder.findOne({
        stripeSessionId: sessionId,
      });

    if (existing) {
      if (existing.paymentStatus !== "paid") {
        const session =
          await stripe.checkout.sessions.retrieve(
            sessionId
          );

        if (session?.payment_status === "paid") {
          existing.paymentStatus = "paid";
          await existing.save();

          await sendOrderEmailIfNeeded(
            existing,
            "PaymentReconcile"
          );
        }
      }

      return res.json(existing);
    }

    const order =
      await createOrderFromStripeSession(sessionId);

    if (!order)
      return res
        .status(404)
        .json({ error: "Order not found" });

    return res.json(order);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to fetch order",
    });
  }
});

export default router;