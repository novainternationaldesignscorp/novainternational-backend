import express from "express";
import Stripe from "stripe";
import mongoose from "mongoose";
import PurchaseOrder from "../models/PurchaseOrder.js";
import PurchaseOrderDraft from "../models/PurchaseOrderDraft.js";
import { sendOrderEmailsIfNeeded } from "../utils/orderEmails.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ----------------------
// Helpers
// ----------------------
const logWebhook = (stage, data = {}) => {
  console.log(`[Webhook][${stage}]`, { at: new Date().toISOString(), ...data });
};

const buildFallbackPurchaseOrderId = (sessionId) => {
  const tail = String(sessionId || "").slice(-8) || "session";
  return `PO-${Date.now()}-${tail}`;
};

// ----------------------
// Stripe Webhook
// ----------------------
router.post("/", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    logWebhook("event_received", { eventId: event.id, type: event.type });
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // ----------------------
    // Handle Checkout Session Completed
    // ----------------------
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      await handleCheckoutSession(session);
    }

    // ----------------------
    // Handle Payment Intent Succeeded (for direct payments)
    // ----------------------
    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;
      const sessionId = paymentIntent.metadata?.sessionId;

      if (!sessionId) {
        console.warn("[Webhook] PaymentIntent has no sessionId in metadata");
      } else {
        const order = await PurchaseOrder.findOne({ stripeSessionId: sessionId });
        if (order) {
          order.paymentStatus = "paid";
          await order.save();
          await sendOrderEmailsIfNeeded(order, "Webhook");
          logWebhook("payment_intent_updated", { sessionId, purchaseOrderId: order.purchaseOrderId });
        } else {
          console.warn("[Webhook] No order found for PaymentIntent sessionId:", sessionId);
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("[Webhook] Fulfillment failed:", err);
    res.status(500).json({ received: false, error: err.message });
  }
});

// ----------------------
// Checkout Session Handler
// ----------------------
async function handleCheckoutSession(session) {
  const metadata = session.metadata || {};
  let ownerType = metadata.ownerType || null;
  let ownerId = metadata.ownerId || null;

  // Fallback to draft if metadata missing
  if ((!ownerType || !ownerId) && metadata.purchaseOrderId) {
    const draft = await PurchaseOrderDraft.findOne({ purchaseOrderId: metadata.purchaseOrderId }).lean();
    if (draft) {
      ownerType = ownerType || draft.ownerType;
      ownerId = ownerId || String(draft.ownerId);
    }
  }

  if (!ownerType || !ownerId) {
    console.error("[Webhook] Missing owner info for session", session.id);
    return;
  }

  const ownerIdObj = mongoose.Types.ObjectId.isValid(ownerId) ? new mongoose.Types.ObjectId(ownerId) : ownerId;

  // Line items
  const lineItemsRes = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
  const lineItems = lineItemsRes.data || [];
  const items = lineItems
    .filter(li => li.description !== "Shipping" && li.description !== "Estimated Tax")
    .map(li => {
      const qty = Number(li.quantity || 1);
      const total = Number(li.amount_total || li.amount_subtotal || 0) / 100;
      const price = qty > 0 ? total / qty : 0;
      return { description: li.description || "Product", qty, price, total };
    });

  const subtotal = items.reduce((sum, it) => sum + it.total, 0);
  const shippingCost = lineItems
    .filter(li => li.description === "Shipping")
    .reduce((sum, li) => sum + (li.amount_total || 0) / 100, 0);
  const estimatedTax = lineItems
    .filter(li => li.description === "Estimated Tax")
    .reduce((sum, li) => sum + (li.amount_total || 0) / 100, 0);

  // Resolve purchaseOrderId
  let purchaseOrderId = metadata.purchaseOrderId || buildFallbackPurchaseOrderId(session.id);
  const existingByPOId = await PurchaseOrder.findOne({ purchaseOrderId }).lean();
  if (existingByPOId) purchaseOrderId = buildFallbackPurchaseOrderId(session.id);

  const customerEmail = session.customer_email || session.customer_details?.email || metadata.customer_email || "";

  // Check if order exists
  let order = await PurchaseOrder.findOne({ stripeSessionId: session.id });
  if (!order) {
    order = await PurchaseOrder.create({
      purchaseOrderId,
      ownerType,
      ownerId: ownerIdObj,
      stripeSessionId: session.id,
      email: customerEmail,
      items,
      subtotal,
      shippingCost,
      estimatedTax,
      totalAmount: Number(session.amount_total || 0) / 100,
      paymentStatus: "paid",
      shippingInfo: {
        name: session.customer_details?.name || metadata.shipping_name || "",
        address: session.customer_details?.address?.line1 || metadata.shipping_address || "",
        city: session.customer_details?.address?.city || metadata.shipping_city || "",
        postalCode: session.customer_details?.address?.postal_code || metadata.shipping_postal_code || "",
        country: session.customer_details?.address?.country || metadata.shipping_country || "",
      },
    });
  } else {
    order.paymentStatus = "paid";
    await order.save();
  }

  logWebhook("fulfillment_success", { sessionId: session.id, purchaseOrderId: order.purchaseOrderId });

  await sendOrderEmailsIfNeeded(order, "Webhook");
}

export default router;