// sendEmail.js (Resend version with enhanced logging)
import { Resend } from "resend";
import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/User.js";
import Guest from "../models/Guest.js";

dotenv.config();

/**
 * Resolve the display name for an order owner from the database.
 * Falls back to shippingInfo.name, then email prefix if not found.
 */
async function userName(orderData) {
  if (orderData.customerName && String(orderData.customerName).trim()) {
    return orderData.customerName.trim();
  }

  if (orderData.shippingInfo?.name && String(orderData.shippingInfo.name).trim()) {
    return orderData.shippingInfo.name.trim();
  }

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

      if (record?.name && String(record.name).trim()) {
        return record.name.trim();
      }
    }
  } catch (err) {
    console.warn("Could not resolve customer name from DB:", err?.message);
  }

  // Last resort – use email prefix
  if (orderData.email) {
    return orderData.email.split("@")[0];
  }

  return "Customer";
}

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Generic sendEmail function
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} content - HTML or plain text content
 * @param {boolean} isHtml - True for HTML, false for plain text
 */
export async function sendEmail(to, subject, content, isHtml = true) {
  if (!to) {
    console.warn("sendEmail called without recipient (to). Skipping.");
    return false;
  }

  try {
    const response = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to,
      subject,
      [isHtml ? "html" : "text"]: content,
    });

    // Log full response for debugging
    console.log("✅ Email request sent to", to);
    console.log("Resend response:", response);

    // Optional: indicate success if Resend returns an ID
    return response?.id ? true : false;
  } catch (err) {
    console.error(`❌ Failed to send email to ${to}:`, err?.message || err);
    return false;
  }
}

/**
 * Purchase Order Confirmation Email
 */
export async function sendPurchaseOrderConfirmation(email, orderData) {
  const customerName = await userName(orderData);
  const { purchaseOrderId, items = [], totalAmount, shippingInfo, notes, createdAt } = orderData;

  const orderDate = createdAt
    ? new Date(createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : new Date().toLocaleDateString();

  const itemsHTML = items
    .map(item => `
      <tr>
        <td>${item.description || "Product"}</td>
        <td>${item.color || "-"}</td>
        <td>${item.size || "-"}</td>
        <td>${item.qty || 1}</td>
        <td>$${(item.price || 0).toFixed(2)}</td>
        <td>$${((item.qty || 1) * (item.price || 0)).toFixed(2)}</td>
      </tr>
    `)
    .join("");

  const html = `
    <h2>Thank you for your order!</h2>
    <p>Purchase Order ID: <strong>${purchaseOrderId}</strong></p>
    <p>Order Date: ${orderDate}</p>
    <p>Customer: ${customerName}</p>
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;">
      <thead>
        <tr><th>Product</th><th>Color</th><th>Size</th><th>Qty</th><th>Price</th><th>Total</th></tr>
      </thead>
      <tbody>
        ${itemsHTML}
      </tbody>
    </table>
    <p><strong>Order Total:</strong> $${(totalAmount || 0).toFixed(2)}</p>
    ${shippingInfo ? `<p>Shipping: ${shippingInfo.name}, ${shippingInfo.address}, ${shippingInfo.city} ${shippingInfo.postalCode}, ${shippingInfo.country}</p>` : ""}
    ${notes ? `<p>Notes: ${notes}</p>` : ""}
  `;

  return sendEmail(email, `Purchase Order Confirmation - ${purchaseOrderId}`, html, true);
}

/**
 * Payment Confirmation Email
 */
export async function sendPaymentConfirmationEmail(email, paymentData) {
  const { purchaseOrderId, customerName, totalAmount } = paymentData;

  const html = `
    <p>Hi ${customerName || ""},</p>
    <p>Your payment for order <strong>${purchaseOrderId}</strong> has been received.</p>
    <p>Total Amount Paid: <strong>$${(totalAmount || 0).toFixed(2)}</strong></p>
    <p>Thank you for your purchase!</p>
  `;

  return sendEmail(email, `Payment Confirmation - ${purchaseOrderId}`, html, true);
}

/**
 * Admin Notification Email
 */
export async function sendAdminOrderNotification(orderData) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.RESEND_FROM_EMAIL;
  if (!adminEmail) {
    console.warn("Admin email not set. Skipping admin notification.");
    return false;
  }

  const customerName = await userName(orderData);
  const { purchaseOrderId, email: customerEmail, totalAmount, items = [] } = orderData;

  const html = `
    <h3>New Order Received</h3>
    <p>Order ID: ${purchaseOrderId}</p>
    <p>Customer: ${customerName}</p>
    <p>Customer Email: ${customerEmail}</p>
    <p>Items: ${items.length}</p>
    <p>Total Amount: $${(totalAmount || 0).toFixed(2)}</p>
  `;

  return sendEmail(adminEmail, `New Paid Order - ${purchaseOrderId}`, html, true);
}

// Default export is the generic sendEmail function
export default sendEmail;