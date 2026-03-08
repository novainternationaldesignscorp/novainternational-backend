import nodemailer from "nodemailer";
import PurchaseOrder from "../models/PurchaseOrder.js";
import User from "../models/User.js";
import Guest from "../models/Guest.js";

const SMTP_HOST = process.env.SMTP_HOST || "smtp.office365.com";
const SMTP_FALLBACK_HOST = process.env.SMTP_FALLBACK_HOST || "outlook.office365.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_EXTRA_FALLBACK_HOST =
    process.env.SMTP_EXTRA_FALLBACK_HOST || "smtp-mail.outlook.com";

const SMTP_ALT_PORT = Number(process.env.SMTP_ALT_PORT || 465);

function createTransport(host) {
    return nodemailer.createTransport({
        host,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        requireTLS: SMTP_PORT !== 465,
        connectionTimeout: 30000,
        greetingTimeout: 20000,
        socketTimeout: 30000,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
        logger: true,
        tls: {
            minVersion: "TLSv1.2",
        },
    });
}

function createTransportWithPort(host, port) {
    return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        requireTLS: port !== 465,
        connectionTimeout: 30000,
        greetingTimeout: 20000,
        socketTimeout: 30000,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
        logger: true,
        tls: {
            minVersion: "TLSv1.2",
            servername: host,
        },
    });
}

let transporter = createTransport(SMTP_HOST);

transporter.verify((err) => {
    if (err) {
        console.error("[OrderEmail] SMTP verify failed:", err?.message || err);
        return;
    }
    console.log("[OrderEmail] SMTP verified and ready");
});

async function sendMailWithFallback(mailOptions) {
    try {
        return await transporter.sendMail(mailOptions);
    } catch (err) {
        const isTimeout =
            err?.code === "ETIMEDOUT" ||
            /timeout/i.test(String(err?.message || ""));

        if (!isTimeout) {
            throw err;
        }

        const hostCandidates = [SMTP_HOST, SMTP_FALLBACK_HOST, SMTP_EXTRA_FALLBACK_HOST].filter(
            (host, index, arr) => host && arr.indexOf(host) === index
        );

        const profiles = [];
        for (const host of hostCandidates) {
            profiles.push({ host, port: SMTP_PORT });
            if (SMTP_ALT_PORT && SMTP_ALT_PORT !== SMTP_PORT) {
                profiles.push({ host, port: SMTP_ALT_PORT });
            }
        }

        let lastError = err;
        for (const profile of profiles) {
            try {
                console.warn("[OrderEmail] SMTP timeout. Retrying with Outlook profile", {
                    primaryHost: SMTP_HOST,
                    retryHost: profile.host,
                    retryPort: profile.port,
                });

                transporter = createTransportWithPort(profile.host, profile.port);
                return await transporter.sendMail(mailOptions);
            } catch (retryErr) {
                lastError = retryErr;
                const retryTimedOut =
                    retryErr?.code === "ETIMEDOUT" ||
                    /timeout/i.test(String(retryErr?.message || ""));

                if (!retryTimedOut) {
                    throw retryErr;
                }
            }
        }

        throw lastError;
    }
}

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

    const order = await PurchaseOrder.findById(orderLike._id).lean();
    if (!order) return;

    const customerEmail = await resolveCustomerEmail(order);
    const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;

    if (customerEmail) {
        const reservation = new Date();
        const claimedCustomer = await PurchaseOrder.findOneAndUpdate(
            { _id: order._id, customerEmailSentAt: null },
            {
                $set: {
                    customerEmailSentAt: reservation,
                    ...(order.email ? {} : { email: customerEmail }),
                },
            },
            { new: true }
        ).lean();

        if (claimedCustomer) {
            try {
                await sendMailWithFallback({
                    from: process.env.EMAIL_USER,
                    to: customerEmail,
                    subject: `Purchase Order Confirmation - ${order.purchaseOrderId}`,
                    html: `<h2>Thank you for your purchase</h2><p>Order ID: ${order.purchaseOrderId}</p><p>Total: $${Number(
                        order.totalAmount || 0
                    ).toFixed(2)}</p>`,
                });

                console.log(`[${logPrefix}] Customer email sent`, {
                    purchaseOrderId: order.purchaseOrderId,
                    to: customerEmail,
                });
            } catch (err) {
                await PurchaseOrder.updateOne(
                    { _id: order._id, customerEmailSentAt: reservation },
                    { $set: { customerEmailSentAt: null } }
                );
                throw err;
            }
        }
    }

    if (adminEmail) {
        const reservation = new Date();
        const claimedAdmin = await PurchaseOrder.findOneAndUpdate(
            { _id: order._id, adminEmailSentAt: null },
            { $set: { adminEmailSentAt: reservation } },
            { new: true }
        ).lean();

        if (claimedAdmin) {
            try {
                await sendMailWithFallback({
                    from: process.env.EMAIL_USER,
                    to: adminEmail,
                    subject: `New Order Received - ${order.purchaseOrderId}`,
                    html: `<h2>New Order</h2><p>Order ID: ${order.purchaseOrderId}</p><p>Customer: ${customerEmail || order.email || "N/A"}</p><p>Total: $${Number(
                        order.totalAmount || 0
                    ).toFixed(2)}</p>`,
                });

                console.log(`[${logPrefix}] Admin email sent`, {
                    purchaseOrderId: order.purchaseOrderId,
                    to: adminEmail,
                });
            } catch (err) {
                await PurchaseOrder.updateOne(
                    { _id: order._id, adminEmailSentAt: reservation },
                    { $set: { adminEmailSentAt: null } }
                );
                throw err;
            }
        }
    }
}

export function sendOrderEmailsInBackground(orderLike, logPrefix = "OrderEmail") {
    // Never block request/response lifecycle on SMTP availability.
    Promise.resolve(sendOrderEmailsIfNeeded(orderLike, logPrefix)).catch((err) => {
        console.error(`[${logPrefix}] Async email dispatch failed:`, {
            message: err?.message || String(err),
            code: err?.code,
            command: err?.command,
            responseCode: err?.responseCode,
            response: err?.response,
        });
    });
}
