import express from "express";
import nodemailer from "nodemailer";

const router = express.Router();

/**
 * GET /api/debug/smtp-test?to=email@example.com
 * Verifies SMTP connection and optionally sends a test email
 */
router.get("/smtp-test", async (req, res) => {
    try {
        const { to } = req.query;
        const { EMAIL_USER, EMAIL_PASS } = process.env;

        // Validate environment variables
        if (!EMAIL_USER || !EMAIL_PASS) {
            return res.status(500).json({
                ok: false,
                error: "Missing EMAIL_USER or EMAIL_PASS environment variables",
            });
        }

        // Create SMTP transporter
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
        });

        // Verify SMTP connection
        await transporter.verify();

        let sent = false;

        // Send test email if "to" is provided
        if (to) {
            await transporter.sendMail({
                from: `"Nova International Designs" <${EMAIL_USER}>`,
                to,
                subject: "SMTP Test Email",
                text: "SMTP connection is working correctly from the deployed backend.",
            });

            sent = true;
        }

        return res.json({
            ok: true,
            verified: true,
            emailSent: sent,
            message: sent
                ? "SMTP verified and test email sent."
                : "SMTP verified successfully.",
        });
    } catch (error) {
        console.error("SMTP Test Error:", error);

        return res.status(500).json({
            ok: false,
            error: error?.message || "SMTP verification failed",
            code: error?.code || null,
            responseCode: error?.responseCode || null,
        });
    }
});

export default router;