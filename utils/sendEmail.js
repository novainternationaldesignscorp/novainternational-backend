// mailer.js
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  host: "outlook.office365.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  logger: true,
  // debug: true,
  tls: {
    ciphers: "SSLv3"
  }
});


// Verify SMTP connection on startup
transporter.verify((err, success) => {
  if (success) {
    console.log("✅ Email service connected - SMTP ready");
  } else {
    console.error("❌ Email service failed:", err?.message || "Unknown error");
    console.error("Check EMAIL_USER and EMAIL_PASS in .env");
  }
});

/**
 * Generic send email function
 */
export const sendEmail = async (to, subject, content, isHtml = true) => {
  if (!to) return false;

  try {
    const info = await transporter.sendMail({
      from: `"Nova International Designs" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: "SMTP Test",
      [isHtml ? "html" : "text"]: content,
    });

    console.log(`✅ Email sent to ${to}: ${info.messageId}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send email to ${to}:`, err.message);
    return false;
  }
};

/**
 * Purchase Order Confirmation Email
 */
export const sendPurchaseOrderConfirmation = async (email, orderData) => {
  const { purchaseOrderId, customerName, items = [], totalAmount, shippingInfo, notes, createdAt } = orderData;

  const orderDate = createdAt ? new Date(createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : new Date().toLocaleDateString();

  const itemsHTML = items
    .map(
      item => `
      <tr>
        <td>${item.description || "Product"}</td>
        <td>${item.color || "-"}</td>
        <td>${item.size || "-"}</td>
        <td>${item.qty || 1}</td>
        <td>$${(item.price || 0).toFixed(2)}</td>
        <td>$${((item.qty || 1) * (item.price || 0)).toFixed(2)}</td>
      </tr>`
    ).join("");

  const html = `
    <h2>Thank you for your order!</h2>
    <p>Purchase Order ID: <strong>${purchaseOrderId}</strong></p>
    <p>Order Date: ${orderDate}</p>
    <p>Customer: ${customerName || "N/A"}</p>
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
};

/**
 * Payment Confirmation Email
 */
export const sendPaymentConfirmationEmail = async (email, paymentData) => {
  const { purchaseOrderId, customerName, totalAmount } = paymentData;

  const html = `
    <p>Hi ${customerName || ""},</p>
    <p>Your payment for order <strong>${purchaseOrderId}</strong> has been received.</p>
    <p>Total Amount Paid: <strong>$${(totalAmount || 0).toFixed(2)}</strong></p>
    <p>Thank you for your purchase!</p>
  `;

  return sendEmail(email, `Payment Confirmation - ${purchaseOrderId}`, html, true);
};

/**
 * Admin Notification Email
 */
export const sendAdminOrderNotification = async (orderData) => {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
  if (!adminEmail) return false;

  const { purchaseOrderId, customerName, email: customerEmail, totalAmount, items = [] } = orderData;

  const html = `
    <h3>New Order Received</h3>
    <p>Order ID: ${purchaseOrderId}</p>
    <p>Customer: ${customerName}</p>
    <p>Customer Email: ${customerEmail}</p>
    <p>Items: ${items.length}</p>
    <p>Total Amount: $${(totalAmount || 0).toFixed(2)}</p>
  `;

  return sendEmail(adminEmail, `New Paid Order - ${purchaseOrderId}`, html, true);
};

export default sendEmail;