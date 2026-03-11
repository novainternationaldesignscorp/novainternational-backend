// purchaseOrder.js (Stripe + Resend email ready)
import express from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import PurchaseOrder from "../models/PurchaseOrder.js";
import PurchaseOrderDraft from "../models/PurchaseOrderDraft.js";
import User from "../models/User.js";
import Guest from "../models/Guest.js";
import { sendPurchaseOrderConfirmation, sendAdminOrderNotification } from "../utils/sendEmail.js"; // fixed path


const router = express.Router();

/*
 * Utility: validate email format
 */
const isValidEmail = (email) => {
  if (!email) return false;
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(String(email).toLowerCase());
};

/**
 * Utility: convert to ObjectId if valid
 */
const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;

/**
 * POST /purchase-order
 * Create a new purchase order (Stripe-ready)
 */
router.post("/", async (req, res) => {
  try {
    const {
      email,
      userId,
      guestId,
      purchaseOrderId: incomingPOId,
      ownerType,
      ownerId,
      stripeSessionId,
    } = req.body;

    // Determine owner type & ID
    let finalOwnerType = ownerType;
    let finalOwnerId = ownerId;
    if (!finalOwnerType || !finalOwnerId) {
      if (userId) {
        finalOwnerType = "User";
        finalOwnerId = userId;
      } else if (guestId) {
        finalOwnerType = "Guest";
        finalOwnerId = guestId;
      } else {
        return res
          .status(400)
          .json({ error: "Either userId or guestId must be provided" });
      }
    }

    if (!["User", "Guest"].includes(finalOwnerType)) {
      return res
        .status(400)
        .json({ error: "ownerType must be 'User' or 'Guest'" });
    }

    // Validate email if provided
    let recipientEmail = email;
    if (recipientEmail && !isValidEmail(recipientEmail)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // Determine purchaseOrderId
    let purchaseOrderId = incomingPOId;
    if (!purchaseOrderId) {
      const ownerIdObj = toObjectId(finalOwnerId);
      const draft = await PurchaseOrderDraft.findOne({
        ownerType: finalOwnerType,
        ownerId: ownerIdObj,
      });
      if (draft?.purchaseOrderId) purchaseOrderId = draft.purchaseOrderId;
    }
    if (!purchaseOrderId) purchaseOrderId = crypto.randomBytes(16).toString("hex");

    // Clean empty strings from top-level fields
    const cleaned = {};
    Object.keys(req.body || {}).forEach((k) => {
      const v = req.body[k];
      if (v === null || v === undefined) return;
      if (typeof v === "string" && v.trim() === "") return;
      cleaned[k] = v;
    });

    // Clean empty strings in nested objects
    ["form", "shippingInfo"].forEach((field) => {
      if (cleaned[field] && typeof cleaned[field] === "object") {
        Object.keys(cleaned[field]).forEach((k) => {
          if (typeof cleaned[field][k] === "string" && cleaned[field][k].trim() === "")
            delete cleaned[field][k];
        });
        if (Object.keys(cleaned[field]).length === 0) delete cleaned[field];
      }
    });

    // Lookup email from DB if not provided
    if (!recipientEmail) {
      try {
        if (finalOwnerType === "User") {
          const userDoc = await User.findById(finalOwnerId)
            .select("email name")
            .lean();
          if (userDoc?.email) {
            recipientEmail = userDoc.email;
            if (!cleaned.customerName && userDoc.name) cleaned.customerName = userDoc.name;
          }
        } else if (finalOwnerType === "Guest") {
          const guestDoc = await Guest.findById(finalOwnerId)
            .select("email name")
            .lean();
          if (guestDoc?.email) {
            recipientEmail = guestDoc.email;
            if (!cleaned.customerName && guestDoc.name) cleaned.customerName = guestDoc.name;
          }
        }
      } catch (err) {
        console.warn("Email lookup error:", err.message);
      }
    }

    // Prepare order data
    const orderData = {
      ...cleaned,
      email: recipientEmail,
      purchaseOrderId,
      ownerType: finalOwnerType,
      ownerId: toObjectId(finalOwnerId),
      stripeSessionId: stripeSessionId || null,
      paymentStatus: "pending",
    };

    // Save order with retry for unique purchaseOrderId
    let order = null;
    const maxRetries = 5;
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        order = new PurchaseOrder({ ...orderData });
        await order.save();
        break;
      } catch (e) {
        if (e.code === 11000 && e.keyPattern?.purchaseOrderId) {
          attempt++;
          purchaseOrderId = crypto.randomBytes(16).toString("hex");
          orderData.purchaseOrderId = purchaseOrderId;
          continue;
        }
        throw e;
      }
    }
    if (!order) throw new Error("Failed to save order after multiple attempts");

    // Async: send customer & admin emails
    (async () => {
      try {
        if (recipientEmail) await sendPurchaseOrderConfirmation(recipientEmail, order);
        await sendAdminOrderNotification(order);
      } catch (emailErr) {
        console.error("Email sending error:", emailErr.message);
      }
    })();

    res.json({ message: "Order saved successfully", order });
  } catch (error) {
    console.error("PurchaseOrder save error:", error);
    res.status(500).json({ error: "Failed to save order", details: error.message });
  }
});

export default router;