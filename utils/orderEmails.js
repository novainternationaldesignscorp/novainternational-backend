import nodemailer from "nodemailer";
import PurchaseOrder from "../models/PurchaseOrder.js";
import User from "../models/User.js";
import Guest from "../models/Guest.js";

const transporter = nodemailer.createTransport({
    host: "outlook.office365.com",
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    logger: true,
    tls: {
        ciphers: "SSLv3",
    },
});

const resolveCustomerEmail = async (order) => {
    if (order?.email) return order.email;

    if (order?.ownerType === "User" && order?.ownerId) {
        const user = await User.findById(order.ownerId).select("email").lean();
        if (user?.email) return user.email;
    }

    if (order?.ownerType === "Guest" && order?.ownerId) {
        const guest = await Guest.findById(order.ownerId).select("email").lean();
        if (guest?.email) return guest.email;
    }

    return "";
};

export async function sendOrderEmailsIfNeeded(orderLike, logPrefix = "OrderEmail") {
    if (!orderLike?._id) return;

    const order = await PurchaseOrder.findById(orderLike._id);
    if (!order) return;

    const customerEmail = await resolveCustomerEmail(order);
    const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;

    const updates = {};

    if (!order.customerEmailSentAt && customerEmail) {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: customerEmail,
            subject: `Purchase Order Confirmation - ${order.purchaseOrderId}`,
            html: `<h2>Thank you for your purchase</h2><p>Order ID: ${order.purchaseOrderId}</p><p>Total: $${Number(
                order.totalAmount || 0
            ).toFixed(2)}</p>`,
        });

        updates.customerEmailSentAt = new Date();
        if (!order.email) updates.email = customerEmail;
        console.log(`[${logPrefix}] Customer email sent`, {
            purchaseOrderId: order.purchaseOrderId,
            to: customerEmail,
        });
    }

    if (!order.adminEmailSentAt && adminEmail) {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: adminEmail,
            subject: `New Order Received - ${order.purchaseOrderId}`,
            html: `<h2>New Order</h2><p>Order ID: ${order.purchaseOrderId}</p><p>Customer: ${customerEmail || order.email || "N/A"}</p><p>Total: $${Number(
                order.totalAmount || 0
            ).toFixed(2)}</p>`,
        });

        updates.adminEmailSentAt = new Date();
        console.log(`[${logPrefix}] Admin email sent`, {
            purchaseOrderId: order.purchaseOrderId,
            to: adminEmail,
        });
    }

    if (Object.keys(updates).length) {
        await PurchaseOrder.findByIdAndUpdate(order._id, { $set: updates });
    }
}
