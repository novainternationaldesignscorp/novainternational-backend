import express from "express";
import Stripe from "stripe";
import mongoose from "mongoose";
import PurchaseOrder from "../models/PurchaseOrder.js";
import PurchaseOrderDraft from "../models/PurchaseOrderDraft.js";
import nodemailer from "nodemailer";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ----------------------
// GoDaddy SMTP transporter
// ----------------------
const transporter = nodemailer.createTransport({
  host: "outlook.office365.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  logger: true,
  debug: true,
  tls: {
    ciphers: "SSLv3"
  }
});


// Verify transporter connection
transporter.verify((err, success) => {
  if (err) {
    console.error("SMTP transporter error:", err);
  } else {
    console.log("✅ Email service connected - SMTP ready");
  }
});

// ----------------------
// Helpers
// ----------------------
const logWebhook = (stage, data = {}) => {
  console.log(`[Webhook][${stage}]`, { at: new Date().toISOString(), ...data });
};

// Fallback PO ID generator
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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    try {
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
        return res.status(400).json({ received: false, error: "Missing owner info" });
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
      if (existingByPOId) {
        purchaseOrderId = buildFallbackPurchaseOrderId(session.id);
        logWebhook("purchase_order_id_regenerated", { previousId: metadata.purchaseOrderId, newId: purchaseOrderId });
      }

      const customerEmail = session.customer_email || session.customer_details?.email || metadata.customer_email || "";

      // Check if order already exists by Stripe session
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
        // Update payment status if already exists
        order.paymentStatus = "paid";
        await order.save();
      }

      logWebhook("fulfillment_success", { sessionId: session.id, purchaseOrderId: order.purchaseOrderId });

      // Send emails asynchronously
      (async () => {
        try {
          if (order.email) {
            await transporter.sendMail({
              from: process.env.EMAIL_USER,
              to: order.email,
              subject: "Order Confirmation",
              html: `<h2>Thank you for your purchase</h2><p>Order ID: ${order.purchaseOrderId}</p><p>Total: $${order.totalAmount}</p>`,
            });
          }

          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.ADMIN_EMAIL || "info@novainternationaldesigns.com",
            subject: "New Order Received",
            html: `<h2>New Order</h2><p>Order ID: ${order.purchaseOrderId}</p><p>Customer: ${order.email || "N/A"}</p><p>Total: $${order.totalAmount}</p>`,
          });
        } catch (emailErr) {
          console.error("[Webhook] Email sending failed:", emailErr);
        }
      })();

    } catch (fulfillmentErr) {
      console.error("[Webhook] Fulfillment failed:", fulfillmentErr);
      return res.status(500).json({ received: false, error: "Webhook fulfillment failed" });
    }
  }

  res.json({ received: true });
});

export default router;