import express from "express";
import nodemailer from "nodemailer";

const router = express.Router();

/**
 * GET /api/debug/smtp-test?to=email@example.com
 * Verifies SMTP connection (dev only) and optionally sends a test email
 */
router.get("/smtp-test", async (req, res) => {
    try {
        const { to } = req.query;
        const { EMAIL_USER, EMAIL_PASS, NODE_ENV } = process.env;
        const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
        const SMTP_ALT_PORT = Number(process.env.SMTP_ALT_PORT || 465);
        const SMTP_HOST = process.env.SMTP_HOST || "smtp.office365.com";
        const SMTP_FALLBACK_HOST = process.env.SMTP_FALLBACK_HOST || "outlook.office365.com";
        const SMTP_EXTRA_FALLBACK_HOST =
            process.env.SMTP_EXTRA_FALLBACK_HOST || "smtp-mail.outlook.com";

        if (!EMAIL_USER || !EMAIL_PASS) {
            return res.status(500).json({
                ok: false,
                error: "Missing EMAIL_USER or EMAIL_PASS environment variables",
            });
        }

        const hosts = [SMTP_HOST, SMTP_FALLBACK_HOST, SMTP_EXTRA_FALLBACK_HOST].filter(
            (host, index, arr) => host && arr.indexOf(host) === index
        );

        const createTransport = (host, port) =>
            nodemailer.createTransport({
                host,
                port,
                secure: port === 465,
                requireTLS: port !== 465,
                auth: { user: EMAIL_USER, pass: EMAIL_PASS },
                tls: { minVersion: "TLSv1.2", servername: host },
                connectionTimeout: 30000,
                greetingTimeout: 20000,
                socketTimeout: 30000,
                logger: NODE_ENV !== "production",
            });

        let transporter = null;
        let verifiedHost = null;
        let verifiedPort = null;
        let lastVerifyError = null;

        const profiles = [];
        for (const host of hosts) {
            profiles.push({ host, port: SMTP_PORT });
            if (SMTP_ALT_PORT && SMTP_ALT_PORT !== SMTP_PORT) {
                profiles.push({ host, port: SMTP_ALT_PORT });
            }
        }

        for (const profile of profiles) {
            try {
                const candidate = createTransport(profile.host, profile.port);
                await candidate.verify();
                transporter = candidate;
                verifiedHost = profile.host;
                verifiedPort = profile.port;
                break;
            } catch (verifyErr) {
                lastVerifyError = verifyErr;
                console.warn(
                    `[SMTP Test] verify failed for ${profile.host}:${profile.port}:`,
                    verifyErr?.message
                );
            }
        }

        if (!transporter) {
            throw lastVerifyError || new Error("SMTP verification failed for all hosts");
        }

        let emailSent = false;

        // Send test email if "to" is provided
        if (to) {
            await transporter.sendMail({
                from: `"Nova International Designs" <${EMAIL_USER}>`,
                to,
                subject: "SMTP Test Email",
                text: "SMTP connection is working correctly from the deployed backend.",
            });
            emailSent = true;
        }

        return res.json({
            ok: true,
            verified: true,
            host: verifiedHost,
            port: verifiedPort,
            emailSent,
            message: emailSent
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