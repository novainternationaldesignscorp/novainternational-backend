import express from "express";
import Stripe from "stripe";
import mongoose from "mongoose";
import PurchaseOrder from "../models/PurchaseOrder.js";
import PurchaseOrderDraft from "../models/PurchaseOrderDraft.js";
import { sendPurchaseOrderConfirmation, sendAdminOrderNotification } from "../utils/mailer.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Logging helper
const log = (stage, data = {}) => {
  console.log(`[Webhook][${stage}]`, { at: new Date().toISOString(), ...data });
};

// Fallback PurchaseOrderId
const buildFallbackPurchaseOrderId = (sessionId) => {
  const tail = String(sessionId || "").slice(-8) || "session";
  return `PO-${Date.now()}-${tail}`;
};

// Health check
router.get("/health", (req, res) => {
  return res.json({
    ok: true,
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    webhookSecretConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    smtpConfigured: Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS),
    timestamp: new Date().toISOString(),
  });
});

// Main webhook
router.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
      log("event_received", { id: event.id, type: event.type });
    } catch (err) {
      console.error("Webhook signature error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const metadata = session.metadata || {};

      try {
        // Prevent duplicate save
        const existing = await PurchaseOrder.findOne({ stripeSessionId: session.id });
        if (existing) {
          log("duplicate_ignored", { sessionId: session.id, orderId: existing._id });
          return res.json({ received: true });
        }

        // Fetch line items
        const lineItemsRes = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
        const lineItems = lineItemsRes.data || [];

        const items = lineItems
          .filter(li => li.description !== "Shipping" && li.description !== "Estimated Tax")
          .map(li => {
            const qty = Number(li.quantity || 1);
            const lineTotal = Number(li.amount_total || li.amount_subtotal || 0) / 100;
            const unitPrice = qty > 0 ? lineTotal / qty : 0;
            return { description: li.description || "Product", qty, price: unitPrice, total: lineTotal };
          });

        const subtotal = items.reduce((sum, it) => sum + it.total, 0);
        const shippingCost = lineItems.filter(li => li.description === "Shipping").reduce((sum, li) => sum + Number(li.amount_total || 0)/100, 0);
        const estimatedTax = lineItems.filter(li => li.description === "Estimated Tax").reduce((sum, li) => sum + Number(li.amount_total || 0)/100, 0);

        // Resolve owner info
        let ownerType = metadata.ownerType || null;
        let ownerId = metadata.ownerId || null;
        if ((!ownerType || !ownerId) && metadata.purchaseOrderId) {
          const draft = await PurchaseOrderDraft.findOne({ purchaseOrderId: metadata.purchaseOrderId }).lean();
          if (draft) { ownerType = ownerType || draft.ownerType; ownerId = ownerId || String(draft.ownerId); }
        }
        if (!ownerType || !ownerId) return res.status(400).json({ received: false, error: "Missing owner info" });

        // Resolve customer email
        const customerEmail = session.customer_email || metadata.customer_email || metadata.prefilledEmail || "";

        // Fallback PO ID
        let purchaseOrderId = metadata.purchaseOrderId || buildFallbackPurchaseOrderId(session.id);
        const existingByPOId = await PurchaseOrder.findOne({ purchaseOrderId }).lean();
        if (existingByPOId) purchaseOrderId = buildFallbackPurchaseOrderId(session.id);

        // Save order
        const order = await PurchaseOrder.create({
          purchaseOrderId,
          ownerType,
          ownerId,
          email: customerEmail,
          items,
          subtotal,
          shippingCost,
          estimatedTax,
          totalAmount: Number(session.amount_total || 0)/100,
          stripeSessionId: session.id,
          shippingInfo: {
            name: session.customer_details?.name || metadata.shipping_name || "",
            address: session.customer_details?.address?.line1 || metadata.shipping_address || "",
            city: session.customer_details?.address?.city || metadata.shipping_city || "",
            postalCode: session.customer_details?.address?.postal_code || metadata.shipping_postal_code || "",
            country: session.customer_details?.address?.country || metadata.shipping_country || "",
          },
        });

        log("db_save_success", { orderId: order._id, purchaseOrderId: order.purchaseOrderId });

        // Send emails safely
        if (customerEmail) {
          try {
            await sendPurchaseOrderConfirmation(customerEmail, {
              purchaseOrderId: order.purchaseOrderId,
              customerName: order.shippingInfo?.name,
              items: order.items,
              totalAmount: order.totalAmount,
              shippingInfo: order.shippingInfo,
              createdAt: order.createdAt,
            });
            log("email_customer_sent", { to: customerEmail });
          } catch (err) { console.error("Customer email failed:", err); }
        }

        try {
          await sendAdminOrderNotification({
            purchaseOrderId: order.purchaseOrderId,
            customerName: order.shippingInfo?.name,
            email: customerEmail,
            totalAmount: order.totalAmount,
            items: order.items,
          });
          log("email_admin_sent");
        } catch (err) { console.error("Admin email failed:", err); }

      } catch (err) {
        console.error("Fulfillment failed:", err);
        return res.status(500).json({ received: false, error: "Webhook fulfillment failed" });
      }
    }

    res.json({ received: true });
  }
);

export default router;