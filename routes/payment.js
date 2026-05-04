// payment.js (Stripe-friendly, Resend email ready)
import express from "express";
import Stripe from "stripe";
import crypto from "crypto";
import mongoose from "mongoose";
import PurchaseOrder from "../models/PurchaseOrder.js";
import PurchaseOrderDraft from "../models/PurchaseOrderDraft.js";
import User from "../models/User.js";
import Guest from "../models/Guest.js";
import {
  sendPurchaseOrderConfirmation,
  sendAdminOrderNotification,
} from "../utils/sendEmail.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PROCESSING_FEE_RATE = 0.05;

console.log(
  "Stripe key loaded:",
  process.env.STRIPE_SECRET_KEY
    ? process.env.STRIPE_SECRET_KEY.slice(0, 8) + "..."
    : "NOT FOUND"
);

// UTILITY FUNCTIONS

async function resolveCustomerEmail(order, ownerType, ownerId) {
  if (order?.email) return order.email;

  if (order?.ownerType && order?.ownerId) {
    if (order.ownerType === "User") {
      const user = await User.findById(order.ownerId).select("email").lean();
      if (user?.email) return user.email;
    } else if (order.ownerType === "Guest") {
      const guest = await Guest.findById(order.ownerId).select("email").lean();
      if (guest?.email) return guest.email;
    }
  }

  if (ownerType && ownerId) {
    if (ownerType === "User") {
      const user = await User.findById(ownerId).select("email").lean();
      if (user?.email) return user.email;
    } else if (ownerType === "Guest") {
      const guest = await Guest.findById(ownerId).select("email").lean();
      if (guest?.email) return guest.email;
    }
  }

  return undefined;
}

const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;

const buildFallbackPurchaseOrderId = (sessionId) => {
  const tail =
    String(sessionId || "").slice(-8) || crypto.randomBytes(4).toString("hex");
  return `PO-${Date.now()}-${tail}`;
};

const splitStripeLineItems = (lineItems = []) => {
  const items = [];
  let shippingCost = 0;
  let estimatedTax = 0;
  let Processing_Fee = 0;

  for (const li of lineItems) {
    const label = String(li.description || "").trim();
    const amount = Number(li.amount_total || li.amount_subtotal || 0) / 100;
    const qty = Math.max(1, Number(li.quantity || 1));

    if (label === "Shipping") {
      shippingCost += amount;
      continue;
    }
    if (label === "Estimated Tax") {
      estimatedTax += amount;
      continue;
    }
    if (label === "Processing Fee") {
      Processing_Fee += amount;
      continue;
    }

    const price = qty > 0 ? amount / qty : 0;
    items.push({
      description: label || "Product",
      qty,
      price,
      total: amount,
    });
  }

  const subtotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
  return { items, subtotal, shippingCost, estimatedTax, Processing_Fee };
};

async function resolveOwnerFromMetadata(metadata = {}) {
  let ownerType = metadata.ownerType || null;
  let ownerId = metadata.ownerId || null;

  if ((!ownerType || !ownerId) && metadata.purchaseOrderId) {
    const draft = await PurchaseOrderDraft.findOne({
      purchaseOrderId: metadata.purchaseOrderId,
    }).lean();
    if (draft) {
      ownerType = ownerType || draft.ownerType;
      ownerId = ownerId || String(draft.ownerId);
    }
  }

  return { ownerType, ownerId };
}

// CREATE OR RECONCILE ORDER FROM STRIPE SESSION
async function createOrderFromStripeSession(sessionId) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  console.log("Create order - session live mode:", session.livemode);
  if (!session) return null;

  const existingBySession = await PurchaseOrder.findOne({ stripeSessionId: session.id });
  if (existingBySession) return existingBySession;

  const metadata = session.metadata || {};
  const { ownerType, ownerId } = await resolveOwnerFromMetadata(metadata);
  if (!ownerType || !ownerId) return null;

  const lineItemsRes = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
  const { items, subtotal, shippingCost, estimatedTax, Processing_Fee } = splitStripeLineItems(lineItemsRes.data);

  if (!items.length) return null;

  const basePurchaseOrderId = metadata.purchaseOrderId || buildFallbackPurchaseOrderId(session.id);
  let purchaseOrderId = basePurchaseOrderId;
  const alreadyUsed = await PurchaseOrder.findOne({ purchaseOrderId }).lean();
  if (alreadyUsed) purchaseOrderId = buildFallbackPurchaseOrderId(session.id);

  const customerEmail = session.customer_email || session.customer_details?.email || metadata.customer_email || "";

  const order = await PurchaseOrder.create({
    purchaseOrderId,
    ownerType,
    ownerId: toObjectId(ownerId),
    stripeSessionId: session.id,
    email: customerEmail,
    items,
    subtotal,
    shippingCost,
    estimatedTax,
    Processing_Fee,
    totalAmount: Number(session.amount_total || 0) / 100,
    paymentStatus: session.payment_status === "paid" ? "paid" : "pending",
    shippingInfo: {
      name: session.customer_details?.name || metadata.shipping_name || "",
      address: session.customer_details?.address?.line1 || metadata.shipping_address || "",
      city: session.customer_details?.address?.city || metadata.shipping_city || "",
      postalCode: session.customer_details?.address?.postal_code || metadata.shipping_postal_code || "",
      country: session.customer_details?.address?.country || metadata.shipping_country || "",
    },
  });

  // ✅ FIX: clear cart when payment is successful
  if (order.paymentStatus === "paid") {

    await PurchaseOrderDraft.deleteOne({
      ownerId: order.ownerId,
      ownerType: order.ownerType,
    });

    (async () => {
      try {
        if (customerEmail) await sendPurchaseOrderConfirmation(customerEmail, order);
        await sendAdminOrderNotification(order);
      } catch (emailErr) {
        console.error("Resend email error:", emailErr?.message || emailErr);
      }
    })();
  }

  return order;
}

// ROUTES

// CREATE STRIPE CHECKOUT SESSION
router.post("/create-checkout-session", async (req, res) => {
  try {
    const {
      orderId: orderIdRaw,
      purchaseOrderId,
      items,
      shippingInfo,
      subtotal,
      shippingCost,
      estimatedTax,
      totalAmount,
      form,
      ownerType,
      ownerId,
      guestSessionId,
    } = req.body;

    const orderId = orderIdRaw || null;
    const effectivePurchaseOrderId = purchaseOrderId || crypto.randomBytes(16).toString("hex");

    let dbCustomerEmail;
    if (orderId) {
      const orderFromDb = /^[a-fA-F0-9]{24}$/.test(orderId)
        ? await PurchaseOrder.findById(orderId)
        : await PurchaseOrder.findOne({ purchaseOrderId: orderId });
      if (!orderFromDb) return res.status(404).json({ error: "Order not found" });
      dbCustomerEmail = await resolveCustomerEmail(orderFromDb, ownerType, ownerId);
    }

    const customerEmail = form?.email || shippingInfo?.email || dbCustomerEmail;
    if (!customerEmail) return res.status(400).json({ error: "Customer email is required" });

    if (!items?.length) return res.status(400).json({ error: "Items are required to create session" });

    const line_items = items.map((it) => ({
      price_data: {
        currency: "usd",
        product_data: { name: it.name || it.description || "Product" },
        unit_amount: Math.round((it.price || 0) * 100),
      },
      quantity: Math.max(1, Number(it.qty || it.quantity || 1)),
    }));

    const computedSubtotal = items.reduce(
      (sum, it) => sum + Math.max(1, Number(it.qty || it.quantity || 1)) * Number(it.price || 0),
      0
    );

    const processingFee = computedSubtotal > 0 ? computedSubtotal * PROCESSING_FEE_RATE : 0;

    if (estimatedTax && estimatedTax > 0) {
      line_items.push({
        price_data: {
          currency: "usd",
          product_data: { name: "Estimated Tax" },
          unit_amount: Math.round(estimatedTax * 100),
        },
        quantity: 1,
      });
    }

    if (processingFee > 0) {
      line_items.push({
        price_data: {
          currency: "usd",
          product_data: { name: "Processing Fee" },
          unit_amount: Math.round(processingFee * 100),
        },
        quantity: 1,
      });
    }

    let frontendUrl = req.headers.origin || process.env.VITE_FRONTEND_URL || "http://localhost:5173";

    const metadata = {
      purchaseOrderId: effectivePurchaseOrderId,
      ...(orderId && { orderId }),
      ...(ownerType && { ownerType }),
      ...(ownerId && { ownerId }),
      ...(guestSessionId && { guestSessionId }),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      success_url: `${frontendUrl}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/checkout`,
      metadata,
      customer_email: customerEmail,
    });

    console.log("Stripe session created. Live mode:", session.livemode);

    res.json({ url: session.url, purchaseOrderId: effectivePurchaseOrderId });

  } catch (err) {
    console.error("Stripe session error:", err);
    res.status(500).json({ error: "Failed to create checkout session", details: err.message });
  }
});

// GET ORDER BY STRIPE SESSION (unchanged except your fix already added)
router.get("/order/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const existing = await PurchaseOrder.findOne({ stripeSessionId: sessionId });

    if (existing) {
      if (existing.paymentStatus !== "paid") {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session?.payment_status === "paid") {
          existing.paymentStatus = "paid";
          await existing.save();

          await PurchaseOrderDraft.deleteOne({
            ownerId: existing.ownerId,
            ownerType: existing.ownerType,
          });
        }
      }

      return res.json(existing);
    }

    const order = await createOrderFromStripeSession(sessionId);
    return res.json(order);

  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

export default router;