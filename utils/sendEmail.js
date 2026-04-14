// sendEmail.js (Resend only - clean version)

import { Resend } from "resend";
import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/User.js";
import Guest from "../models/Guest.js";

dotenv.config();

// ✅ Validate API key early
if (!process.env.RESEND_API_KEY) {
  console.error("❌ RESEND_API_KEY is missing in .env");
}

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Resolve user name
 */
async function userName(orderData) {
  if (orderData.customerName?.trim()) return orderData.customerName.trim();
  if (orderData.shippingInfo?.name?.trim()) return orderData.shippingInfo.name.trim();

  try {
    const { ownerType, ownerId } = orderData;

    if (ownerType && ownerId) {
      const id = mongoose.Types.ObjectId.isValid(ownerId)
        ? new mongoose.Types.ObjectId(ownerId)
        : ownerId;

      let record = null;

      if (ownerType === "User") {
        record = await User.findById(id).select("name").lean();
      } else if (ownerType === "Guest") {
        record = await Guest.findById(id).select("name").lean();
      }

      if (record?.name) return record.name.trim();
    }
  } catch (err) {
    console.warn("Name lookup failed:", err.message);
  }

  if (orderData.email) return orderData.email.split("@")[0];

  return "Customer";
}

/**
 * Generic email sender
 */
export async function sendEmail(to, subject, content, isHtml = true) {
  if (!process.env.RESEND_API_KEY) {
    console.error("❌ Cannot send email: missing RESEND_API_KEY");
    return false;
  }

  if (!to) {
    console.warn("sendEmail: missing recipient");
    return false;
  }

  try {
    const response = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to,
      subject,
      [isHtml ? "html" : "text"]: content,
    });

    console.log("📧 Email sent to:", to);
    console.log("Resend response:", response);

    return !!response?.id;
  } catch (err) {
    console.error("❌ Email failed:", err?.message || err);
    return false;
  }
}

/**
 * Purchase confirmation
 */
export async function sendPurchaseOrderConfirmation(email, orderData) {
  const customerName = await userName(orderData);

  const html = `
    <h2>Thank you for your order!</h2>
    <p>Hi ${customerName}</p>
    <p>Order ID: <b>${orderData.purchaseOrderId}</b></p>
  `;

  return sendEmail(
    email,
    `Purchase Order Confirmation - ${orderData.purchaseOrderId}`,
    html
  );
}

/**
 * Payment confirmation
 */
export async function sendPaymentConfirmationEmail(email, paymentData) {
  const html = `
    <p>Payment received for order <b>${paymentData.purchaseOrderId}</b></p>
    <p>Total: $${(paymentData.totalAmount || 0).toFixed(2)}</p>
  `;

  return sendEmail(
    email,
    `Payment Confirmation - ${paymentData.purchaseOrderId}`,
    html
  );
}

/**
 * Admin notification
 */
export async function sendAdminOrderNotification(orderData) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.RESEND_FROM_EMAIL;

  if (!adminEmail) {
    console.warn("Admin email missing");
    return false;
  }

  const html = `
    <h3>New Order</h3>
    <p>ID: ${orderData.purchaseOrderId}</p>
    <p>Total: $${(orderData.totalAmount || 0).toFixed(2)}</p>
  `;

  return sendEmail(
    adminEmail,
    `New Order - ${orderData.purchaseOrderId}`,
    html
  );
}

export default sendEmail;