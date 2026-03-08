import express from "express";
import Stripe from "stripe";
import crypto from "crypto";
import mongoose from "mongoose";
import PurchaseOrder from "../models/PurchaseOrder.js";
import PurchaseOrderDraft from "../models/PurchaseOrderDraft.js";
import User from "../models/User.js";
import Guest from "../models/Guest.js";
import { sendOrderEmailsIfNeeded } from "../utils/orderEmails.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

console.log(
  "Stripe key loaded:",
  process.env.STRIPE_SECRET_KEY
    ? process.env.STRIPE_SECRET_KEY.slice(0, 8) + "..."
    : "NOT FOUND"
);

// Utility: get email from order, owner, or fallback
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
  const tail = String(sessionId || "").slice(-8) || crypto.randomBytes(4).toString("hex");
  return `PO-${Date.now()}-${tail}`;
};

const splitStripeLineItems = (lineItems = []) => {
  const items = [];
  let shippingCost = 0;
  let estimatedTax = 0;

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

    const price = qty > 0 ? amount / qty : 0;
    items.push({
      description: label || "Product",
      qty,
      price,
      total: amount,
    });
  }

  const subtotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
  return { items, subtotal, shippingCost, estimatedTax };
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

async function createOrderFromStripeSession(sessionId) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!session) return null;

  const existingBySession = await PurchaseOrder.findOne({ stripeSessionId: session.id });
  if (existingBySession) return existingBySession;

  const metadata = session.metadata || {};
  const { ownerType, ownerId } = await resolveOwnerFromMetadata(metadata);
  if (!ownerType || !ownerId) return null;

  const lineItemsRes = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
  const lineItems = lineItemsRes?.data || [];
  const { items, subtotal, shippingCost, estimatedTax } = splitStripeLineItems(lineItems);

  if (!items.length) return null;

  const basePurchaseOrderId = metadata.purchaseOrderId || buildFallbackPurchaseOrderId(session.id);
  let purchaseOrderId = basePurchaseOrderId;
  const alreadyUsed = await PurchaseOrder.findOne({ purchaseOrderId }).lean();
  if (alreadyUsed) {
    purchaseOrderId = buildFallbackPurchaseOrderId(session.id);
  }

  const customerEmail =
    session.customer_email || session.customer_details?.email || metadata.customer_email || "";

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
    totalAmount: Number(session.amount_total || 0) / 100,
    paymentStatus: session.payment_status === "paid" ? "paid" : "pending",
    shippingInfo: {
      name: session.customer_details?.name || metadata.shipping_name || "",
      address: session.customer_details?.address?.line1 || metadata.shipping_address || "",
      city: session.customer_details?.address?.city || metadata.shipping_city || "",
      postalCode:
        session.customer_details?.address?.postal_code || metadata.shipping_postal_code || "",
      country: session.customer_details?.address?.country || metadata.shipping_country || "",
    },
  });

  if (order.paymentStatus === "paid") {
    await sendOrderEmailsIfNeeded(order, "PaymentFallback");
  }

  return order;
}

/** CREATE STRIPE CHECKOUT SESSION */
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

    let line_items = [];
    let dbCustomerEmail;

    let orderFromDb = null;

    if (orderId) {
      // Fetch order from DB
      orderFromDb = /^[a-fA-F0-9]{24}$/.test(orderId)
        ? await PurchaseOrder.findById(orderId)
        : await PurchaseOrder.findOne({ purchaseOrderId: orderId });

      if (!orderFromDb) return res.status(404).json({ error: "Order not found" });
      if (!orderFromDb.items?.length) return res.status(400).json({ error: "Order has no items" });

      // Resolve email from order or owner
      dbCustomerEmail = await resolveCustomerEmail(orderFromDb, ownerType, ownerId);

      // Build line items
      line_items = orderFromDb.items.map((it) => ({
        price_data: {
          currency: "usd",
          product_data: { name: it.description || "Product", metadata: { styleNo: it.styleNo || "" } },
          unit_amount: Math.round((it.price || 0) * 100),
        },
        quantity: it.qty || 1,
      }));

      // Calculate shipping/tax
      const itemsSubtotal = orderFromDb.items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
      const shippingAmount = Number(shippingCost ?? orderFromDb.shippingCost ?? 0);
      const taxAmount = Number(estimatedTax ?? orderFromDb.estimatedTax ?? 0);
      const remaining = Number(orderFromDb.totalAmount ?? 0) - itemsSubtotal;
      const inferredExtra = remaining > 0 ? remaining : 0;
      const finalShipping = shippingAmount > 0 ? shippingAmount : 0;
      const finalTax = taxAmount > 0 ? taxAmount : finalShipping === 0 ? inferredExtra : 0;

      if (finalShipping > 0) line_items.push({ price_data: { currency: "usd", product_data: { name: "Shipping" }, unit_amount: Math.round(finalShipping * 100) }, quantity: 1 });
      if (finalTax > 0) line_items.push({ price_data: { currency: "usd", product_data: { name: "Estimated Tax" }, unit_amount: Math.round(finalTax * 100) }, quantity: 1 });

    } else {
      // No DB order — use payload
      if (!items?.length) return res.status(400).json({ error: "items are required to create session" });

      line_items = items.map((it) => ({
        price_data: {
          currency: "usd",
          product_data: { name: it.name || it.description || "Product", metadata: { productId: it.productId || "" } },
          unit_amount: Math.round((it.price || 0) * 100),
        },
        quantity: Math.max(1, Number(it.qty || it.quantity || 1)),
      }));

      if (shippingCost && Number(shippingCost) > 0) line_items.push({ price_data: { currency: "usd", product_data: { name: "Shipping" }, unit_amount: Math.round(Number(shippingCost) * 100) }, quantity: 1 });
      if (estimatedTax && Number(estimatedTax) > 0) line_items.push({ price_data: { currency: "usd", product_data: { name: "Estimated Tax" }, unit_amount: Math.round(Number(estimatedTax) * 100) }, quantity: 1 });
    }

    // FINAL CUSTOMER EMAIL: form -> shippingInfo -> DB -> fallback
    const customerEmail = form?.email || shippingInfo?.email || dbCustomerEmail;
    if (!customerEmail) {
      return res.status(400).json({ error: "Customer email is required to send Stripe receipt" });
    }

    console.log("[Stripe] customerEmail:", customerEmail);

    // Validate line items
    if (!line_items.every((li) => li.price_data.unit_amount > 0 && li.quantity > 0))
      return res.status(400).json({ error: "Invalid item price or quantity" });

    let frontendUrl = req.headers.origin || process.env.VITE_FRONTEND_URL || "http://localhost:5173";
    if (!frontendUrl.startsWith("http")) frontendUrl = `http://${frontendUrl}`;

    const metadata = {
      purchaseOrderId: effectivePurchaseOrderId,
      ...(orderId && { orderId }),
      ...(ownerType && { ownerType }),
      ...(ownerId && { ownerId }),
      ...(guestSessionId && { guestSessionId }),
      ...(subtotal && { subtotal: String(subtotal) }),
      ...(shippingCost && { shippingCost: String(shippingCost) }),
      ...(estimatedTax && { estimatedTax: String(estimatedTax) }),
      ...(totalAmount && { totalAmount: String(totalAmount) }),
      ...(shippingInfo?.firstName || shippingInfo?.lastName ? { shipping_name: `${shippingInfo.firstName || ""} ${shippingInfo.lastName || ""}`.trim() } : {}),
      ...(shippingInfo?.address && { shipping_address: shippingInfo.address }),
      ...(shippingInfo?.city && { shipping_city: shippingInfo.city }),
      ...(shippingInfo?.zip && { shipping_postal_code: shippingInfo.zip }),
      ...(shippingInfo?.country && { shipping_country: shippingInfo.country }),
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

    // Save stripeSessionId if DB order exists
    if (orderFromDb) {
      orderFromDb.stripeSessionId = session.id;
      await orderFromDb.save();
    }

    res.json({ url: session.url, purchaseOrderId: effectivePurchaseOrderId });
  } catch (err) {
    console.error("Stripe session error:", err);
    res.status(500).json({ error: "Failed to create checkout session", details: err.message });
  }
});

/**
 * GET ORDER BY STRIPE SESSION
 * Returns an existing order or creates one from Stripe session data when webhook is delayed.
 */
router.get("/order/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const existing = await PurchaseOrder.findOne({ stripeSessionId: sessionId });
    if (existing) {
      if (existing.paymentStatus === "paid") {
        await sendOrderEmailsIfNeeded(existing, "PaymentFetch");
      }
      return res.json(existing);
    }

    const order = await createOrderFromStripeSession(sessionId);
    if (!order) {
      return res.status(404).json({ error: "Order not found for this session" });
    }

    if (order.paymentStatus === "paid") {
      await sendOrderEmailsIfNeeded(order, "PaymentFetch");
    }

    return res.json(order);
  } catch (err) {
    console.error("Fetch order by session error:", err);
    return res.status(500).json({ error: "Failed to fetch order", details: err.message });
  }
});

export default router;