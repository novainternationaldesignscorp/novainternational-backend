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
  debug: true,
  tls: {
    ciphers: "SSLv3"
  }
});


// Verify SMTP connection
transporter.verify((err, success) => {
  if (success) {
    console.log("✅ Email service connected - SMTP ready");
  } else {
    console.error("❌ Email service failed:", err?.message || "Unknown error");
    console.error("Check EMAIL_USER and EMAIL_PASS in .env");
  }
});

/**
 * Send a welcome email
 */
export const sendWelcomeEmail = async (email, name) => {
  try {
    await transporter.sendMail({
      from: `"Nova International Designs" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Welcome to Nova International Designs!",
      html: `<p>Hello <strong>${name}</strong>, welcome to Nova International Designs!</p>`,
    });
    console.log("✅ Welcome email sent to", email);
  } catch (err) {
    console.error("❌ Failed to send welcome email:", err.message);
  }
};

/**
 * Send purchase order confirmation email
 */
export const sendPurchaseOrderConfirmation = async (email, orderData) => {
  try {
    const {
      purchaseOrderId,
      customerName,
      items = [],
      totalAmount,
      shippingInfo,
      notes,
      createdAt,
    } = orderData;

    const orderDate = createdAt
      ? new Date(createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : new Date().toLocaleDateString();

    let itemsHTML = items
      .map(
        (item) => `
        <tr>
          <td style="padding:12px;border-bottom:1px solid #eee;"><strong>${item.styleNo || "N/A"}</strong> - ${item.description || "Product"}</td>
          <td style="padding:12px;border-bottom:1px solid #eee;text-align:center;">${item.color || "-"}</td>
          <td style="padding:12px;border-bottom:1px solid #eee;text-align:center;">${item.size || "-"}</td>
          <td style="padding:12px;border-bottom:1px solid #eee;text-align:center;">${item.qty || 1}</td>
          <td style="padding:12px;border-bottom:1px solid #eee;text-align:center;">$${(item.price || 0).toFixed(2)}</td>
          <td style="padding:12px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;">$${((item.total || (item.qty || 1) * (item.price || 0))).toFixed(2)}</td>
        </tr>`
      )
      .join("");

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body { font-family: Arial, sans-serif; line-height:1.6; color:#333; max-width:600px; margin:0 auto; padding:20px; }
          .header { background-color:#fff; padding:30px; border-bottom:2px solid #667eea; text-align:center; }
          .header h1 { color:#667eea; margin:0; font-size:28px; }
          .content { background-color:#fff; padding:30px; }
          table { width:100%; border-collapse:collapse; margin:15px 0; }
          th { background-color:#667eea; color:#fff; text-align:left; padding:12px; }
          td { padding:12px; border-bottom:1px solid #eee; }
          .total-section { background:#f8f9fa; padding:15px; border-radius:4px; margin-top:15px; text-align:right; font-weight:bold; color:#667eea; }
          .footer { background:#f8f9fa; padding:20px; text-align:center; color:#666; font-size:12px; border-top:1px solid #eee; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Purchase Order Received</h1>
          <p>Thank you for your order with Nova International Designs</p>
        </div>
        <div class="content">
          <p><strong>Purchase Order ID:</strong> ${purchaseOrderId}</p>
          <p><strong>Order Date:</strong> ${orderDate}</p>
          <p><strong>Customer Name:</strong> ${customerName || "N/A"}</p>
          <table>
            <thead>
              <tr>
                <th>Product</th><th>Color</th><th>Size</th><th>Qty</th><th>Price</th><th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHTML}
            </tbody>
          </table>
          <div class="total-section">Order Total: $${(totalAmount || 0).toFixed(2)}</div>
          ${shippingInfo ? `<p><strong>Shipping:</strong> ${shippingInfo.name || ""}, ${shippingInfo.address || ""}, ${shippingInfo.city || ""} ${shippingInfo.postalCode || ""}, ${shippingInfo.country || ""}</p>` : ""}
          ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ""}
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Nova International Designs. All rights reserved.</p>
          <p>Email: <strong>${process.env.EMAIL_USER}</strong></p>
        </div>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: `"Nova International Designs" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Purchase Order Confirmation - Order #${purchaseOrderId}`,
      html: htmlContent,
    });

    console.log("✅ Purchase order confirmation email sent to", email);
    return true;
  } catch (err) {
    console.error("❌ Failed to send purchase order email:", err.message);
    return false;
  }
};

/**
 * Send payment confirmation email
 */
export const sendPaymentConfirmationEmail = async (email, paymentData) => {
  try {
    const { purchaseOrderId, customerName, totalAmount } = paymentData;

    const htmlContent = `
      <p>Hi ${customerName || ""},</p>
      <p>Your payment for order <strong>${purchaseOrderId}</strong> has been received.</p>
      <p>Total Amount Paid: <strong>$${(totalAmount || 0).toFixed(2)}</strong></p>
      <p>Thank you for your purchase!</p>
    `;

    await transporter.sendMail({
      from: `"Nova International Designs" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Payment Confirmation - Order #${purchaseOrderId}`,
      html: htmlContent,
    });

    console.log("✅ Payment confirmation email sent to", email);
    return true;
  } catch (err) {
    console.error("❌ Failed to send payment confirmation email:", err.message);
    return false;
  }
};

/**
 * Send admin notification email
 */
export const sendAdminOrderNotification = async (orderData) => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
    if (!adminEmail) return false;

    const orderId = orderData.purchaseOrderId || "N/A";
    const customerName = orderData.customerName || orderData.shippingInfo?.name || "N/A";
    const customerEmail = orderData.email || "N/A";
    const total = Number(orderData.totalAmount || 0).toFixed(2);
    const itemCount = Array.isArray(orderData.items) ? orderData.items.length : 0;

    await transporter.sendMail({
      from: `"Nova International Designs" <${process.env.EMAIL_USER}>`,
      to: adminEmail,
      subject: `New Paid Order - ${orderId}`,
      html: `
        <h3>New Paid Order Received</h3>
        <p><strong>Order ID:</strong> ${orderId}</p>
        <p><strong>Customer Name:</strong> ${customerName}</p>
        <p><strong>Customer Email:</strong> ${customerEmail}</p>
        <p><strong>Items:</strong> ${itemCount}</p>
        <p><strong>Total Amount:</strong> $${total}</p>
      `,
    });

    console.log("✅ Admin order notification email sent to", adminEmail);
    return true;
  } catch (err) {
    console.error("❌ Failed to send admin order notification:", err.message);
    return false;
  }
};