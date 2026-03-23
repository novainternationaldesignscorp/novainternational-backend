// src/utils/mailer.js
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const { SMTP_USER, SMTP_PASS, ADMIN_EMAIL } = process.env;

let transporter = null;

// Only create transporter if credentials exist
if (SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: "outlook.office365.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { minVersion: "TLSv1.2" },
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    logger: false, // true for debug
  });

  console.log(" Mailer initialized with Outlook SMTP.");
} else {
  console.warn(" SMTP_USER or SMTP_PASS not set. Mailer disabled.");
}

/**
 * Generic send email
 */
export const sendEmail = async ({ to, subject, html, text }) => {
  if (!transporter) {
    console.warn(" Mailer not configured. Email not sent:", subject);
    return false;
  }

  try {
    await transporter.sendMail({
      from: `"Nova International Designs" <${SMTP_USER}>`,
      to,
      subject,
      html,
      text,
    });
    console.log(` Email sent to ${to}`);
    return true;
  } catch (err) {
    console.error(` Failed to send email to ${to}:`, err.message);
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
  if (!orderData) return false;

  const { purchaseOrderId, customerName, items = [], totalAmount } = orderData;

  const itemsHTML = items
    .map(
      (item) => `<tr>
        <td>${item.styleNo || "N/A"} - ${item.description || "Product"}</td>
        <td>${item.color || "-"}</td>
        <td>${item.size || "-"}</td>
        <td>${item.qty || 1}</td>
        <td>$${(item.price || 0).toFixed(2)}</td>
        <td>$${((item.total || (item.qty || 1) * (item.price || 0))).toFixed(2)}</td>
      </tr>`
    )
    .join("");

  const html = `
    <h2>Purchase Order Confirmation</h2>
    <p><strong>Order ID:</strong> ${purchaseOrderId}</p>
    <p><strong>Customer Name:</strong> ${customerName || "N/A"}</p>
    <table border="1" cellspacing="0" cellpadding="6">
      <thead><tr><th>Product</th><th>Color</th><th>Size</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
      <tbody>${itemsHTML}</tbody>
    </table>
    <p><strong>Order Total:</strong> $${(totalAmount || 0).toFixed(2)}</p>
  `;

  return sendEmail({ to: email, subject: `Purchase Order #${purchaseOrderId}`, html });
};

/**
 * Admin notification email
 */
export const sendAdminOrderNotification = async (orderData) => {
  const adminEmail = ADMIN_EMAIL || SMTP_USER;
  if (!adminEmail) return false;

  const orderId = orderData?.purchaseOrderId || "N/A";
  const total = Number(orderData?.totalAmount || 0).toFixed(2);

  const html = `<h3>New Paid Order Received</h3>
    <p><strong>Order ID:</strong> ${orderId}</p>
    <p><strong>Total Amount:</strong> $${total}</p>
  `;

  return sendEmail({ to: adminEmail, subject: `New Paid Order - ${orderId}`, html });
};