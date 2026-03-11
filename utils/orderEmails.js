// orderEmails.js (Resend version)
import PurchaseOrder from "../models/PurchaseOrder.js";
import User from "../models/User.js";
import Guest from "../models/Guest.js";
import { sendPurchaseOrderConfirmation, sendAdminOrderNotification } from "./sendEmail.js";

/**
 * Resolve the customer's email from order or owner document
 */
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

/**
 * Sends customer and admin order emails if not already sent
 * @param {Object} orderLike - Mongoose document or object with _id
 * @param {string} logPrefix - Optional logging prefix
 */
export async function sendOrderEmailsIfNeeded(orderLike, logPrefix = "OrderEmail") {
    if (!orderLike?._id) return;

    const order = await PurchaseOrder.findById(orderLike._id).lean();
    if (!order) return;

    const customerEmail = await resolveCustomerEmail(order);
    const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;

    // Send customer email if not already sent
    if (customerEmail) {
        const reservation = new Date();
        const claimedCustomer = await PurchaseOrder.findOneAndUpdate(
            { _id: order._id, customerEmailSentAt: null },
            { $set: { customerEmailSentAt: reservation, ...(order.email ? {} : { email: customerEmail }) } },
            { new: true }
        ).lean();

        if (claimedCustomer) {
            try {
                await sendPurchaseOrderConfirmation(customerEmail, order);
                console.log(`[${logPrefix}] Customer email sent`, {
                    purchaseOrderId: order.purchaseOrderId,
                    to: customerEmail,
                });
            } catch (err) {
                await PurchaseOrder.updateOne(
                    { _id: order._id, customerEmailSentAt: reservation },
                    { $set: { customerEmailSentAt: null } }
                );
                console.error(`[${logPrefix}] Customer email failed:`, err?.message || err);
            }
        }
    }

    // Send admin email if not already sent
    if (adminEmail) {
        const reservation = new Date();
        const claimedAdmin = await PurchaseOrder.findOneAndUpdate(
            { _id: order._id, adminEmailSentAt: null },
            { $set: { adminEmailSentAt: reservation } },
            { new: true }
        ).lean();

        if (claimedAdmin) {
            try {
                await sendAdminOrderNotification(order);
                console.log(`[${logPrefix}] Admin email sent`, {
                    purchaseOrderId: order.purchaseOrderId,
                    to: adminEmail,
                });
            } catch (err) {
                await PurchaseOrder.updateOne(
                    { _id: order._id, adminEmailSentAt: reservation },
                    { $set: { adminEmailSentAt: null } }
                );
                console.error(`[${logPrefix}] Admin email failed:`, err?.message || err);
            }
        }
    }
}

/**
 * Async wrapper to send emails in the background
 */
export function sendOrderEmailsInBackground(orderLike, logPrefix = "OrderEmail") {
    // Never block request/response lifecycle on email delivery
    Promise.resolve(sendOrderEmailsIfNeeded(orderLike, logPrefix)).catch((err) => {
        console.error(`[${logPrefix}] Async email dispatch failed:`, {
            message: err?.message || String(err),
        });
    });
}