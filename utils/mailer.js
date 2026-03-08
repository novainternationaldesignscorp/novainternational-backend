// src/utils/mailer.js
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const { EMAIL_USER, EMAIL_PASS, ADMIN_EMAIL } = process.env;

if (!EMAIL_USER || !EMAIL_PASS) {
  console.error("❌ Missing EMAIL_USER or EMAIL_PASS in environment variables.");
  process.exit(1);
}

// Create SMTP transporter for Outlook
const transporter = nodemailer.createTransport({
  host: "outlook.office365.com",
  port: 587,
  secure: false,
  requireTLS: true,
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
  tls: {
    minVersion: "TLSv1.2",
  },
  connectionTimeout: 20000,
  greetingTimeout: 15000,
  socketTimeout: 20000,
  pool: true,            // Enable connection pooling
  maxConnections: 5,
  maxMessages: 100,
  logger: true,          // Set to false in production
});

// Verify connection on startup
transporter.verify((err, success) => {
  if (success) {
    console.log("✅ Email service connected - SMTP ready");
  } else {
    console.error("❌ Email service failed:", err?.message || "Unknown error");
  }
});

/**
 * Send a generic email
 */
export const sendEmail = async ({ to, subject, html, text }) => {
  try {
    await transporter.sendMail({
      from: `"Nova International Designs" <${EMAIL_USER}>`,
      to,
      subject,
      html,
      text,
    });
    console.log(`✅ Email sent to ${to}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send email to ${to}:`, err.message);
    return false;
  }
};

/**
 * Send welcome email
 */
export const sendWelcomeEmail = async (email, name) => {
  const html = `<p>Hello <strong>${name}</strong>, welcome to Nova International Designs!</p>`;
  return sendEmail({ to: email, subject: "Welcome to Nova International Designs!", html });
};

/**
 * Send purchase order confirmation email
 */
export const sendPurchaseOrderConfirmation = async (email, orderData) => {
  const { purchaseOrderId, customerName, items = [], totalAmount, shippingInfo, notes, createdAt } = orderData;

  const orderDate = createdAt
    ? new Date(createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : new Date().toLocaleDateString();

  let itemsHTML = items
    .map(
      (item) => `
      <tr>
        <td>${item.styleNo || "N/A"} - ${item.description || "Product"}</td>
        <td>${item.color || "-"}</td>
        <td>${item.size || "-"}</td>
        <td>${item.qty || 1}</td>
        <td>$${(item.price || 0).toFixed(2)}</td>
        <td>$${((item.total || (item.qty || 1) * (item.price || 0))).toFixed(2)}</td>
      </tr>`
    )
    .join("");

  const htmlContent = `
    <h2>Purchase Order Confirmation</h2>
    <p><strong>Order ID:</strong> ${purchaseOrderId}</p>
    <p><strong>Order Date:</strong> ${orderDate}</p>
    <p><strong>Customer Name:</strong> ${customerName || "N/A"}</p>
    <table border="1" cellspacing="0" cellpadding="6">
      <thead>
        <tr><th>Product</th><th>Color</th><th>Size</th><th>Qty</th><th>Price</th><th>Total</th></tr>
      </thead>
      <tbody>
        ${itemsHTML}
      </tbody>
    </table>
    <p><strong>Order Total:</strong> $${(totalAmount || 0).toFixed(2)}</p>
    ${shippingInfo ? `<p><strong>Shipping:</strong> ${shippingInfo.name || ""}, ${shippingInfo.address || ""}</p>` : ""}
    ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ""}
  `;

  return sendEmail({ to: email, subject: `Purchase Order Confirmation - ${purchaseOrderId}`, html: htmlContent });
};

/**
 * Send payment confirmation email
 */
export const sendPaymentConfirmationEmail = async (email, paymentData) => {
  const { purchaseOrderId, customerName, totalAmount } = paymentData;
  const htmlContent = `
    <p>Hi ${customerName || ""},</p>
    <p>Your payment for order <strong>${purchaseOrderId}</strong> has been received.</p>
    <p>Total Amount Paid: <strong>$${(totalAmount || 0).toFixed(2)}</strong></p>
    <p>Thank you for your purchase!</p>
  `;
  return sendEmail({ to: email, subject: `Payment Confirmation - ${purchaseOrderId}`, html: htmlContent });
};

/**
 * Send admin notification email
 */
export const sendAdminOrderNotification = async (orderData) => {
  const adminEmail = ADMIN_EMAIL || EMAIL_USER;
  if (!adminEmail) return false;

  const orderId = orderData.purchaseOrderId || "N/A";
  const customerName = orderData.customerName || orderData.shippingInfo?.name || "N/A";
  const total = Number(orderData.totalAmount || 0).toFixed(2);

  const htmlContent = `
    <h3>New Paid Order Received</h3>
    <p><strong>Order ID:</strong> ${orderId}</p>
    <p><strong>Customer Name:</strong> ${customerName}</p>
    <p><strong>Total Amount:</strong> $${total}</p>
  `;

  return sendEmail({ to: adminEmail, subject: `New Paid Order - ${orderId}`, html: htmlContent });
};