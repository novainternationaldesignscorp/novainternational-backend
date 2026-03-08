import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

console.log("\n🔍 TESTING SMTP CONNECTION (Outlook)\n");
console.log("═".repeat(50));
console.log("SMTP Configuration:");
console.log("  Host:", process.env.SMTP_HOST);
console.log("  Port:", process.env.SMTP_PORT);
console.log("  User:", process.env.SMTP_USER);
console.log("  Password length:", process.env.SMTP_PASS ? process.env.SMTP_PASS.length : "NOT SET");
console.log("═".repeat(50));

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, // e.g. outlook.office365.com
    port: parseInt(process.env.SMTP_PORT), // typically 587
    secure: false, // use TLS via STARTTLS
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    tls: {
        minVersion: "TLSv1.2", // ensure secure connection
    },
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
});

console.log("\n⏳ Testing connection...\n");

transporter.verify((error, success) => {
    if (error) {
        console.log("❌ CONNECTION FAILED\n");
        console.log("Error:", error.message);
        console.log("\n🔧 TROUBLESHOOTING:");
        console.log("1. Is your Outlook App Password correct? (If using MFA)");
        console.log("2. Did you enable Multi-Factor Authentication (MFA) in your Outlook account?");
        console.log("3. Did you generate an App Password (not your normal account password)?");
        console.log("4. Check https://account.live.com/proofs/AppPassword for App Password setup.");
        process.exit(1);
    } else {
        console.log("✅ CONNECTION SUCCESSFUL!\n");
        console.log("Sending test email to:", process.env.SMTP_USER);
        sendTestEmail();
    }
});

async function sendTestEmail() {
    try {
        const info = await transporter.sendMail({
            from: `"Nova Test" <${process.env.SMTP_USER}>`,
            to: process.env.SMTP_USER,
            subject: "✅ Nova International - SMTP Test",
            html: `
        <h2 style="color: #0078D4;">✅ Email Configuration Working!</h2>
        <p>Your Outlook SMTP is configured correctly.</p>
        <p><strong>From:</strong> ${process.env.SMTP_USER}</p>
        <p><strong>Sent at:</strong> ${new Date().toLocaleString()}</p>
        <hr>
        <p style="color: #666; font-size: 12px;">If you see this email, purchase order confirmations will work perfectly!</p>
      `,
        });

        console.log("✅ TEST EMAIL SENT SUCCESSFULLY!\n");
        console.log("Message ID:", info.messageId);
        console.log("\n📧 Check your Outlook inbox at:", process.env.SMTP_USER);
        console.log("   (May take 1-2 minutes or check spam/junk folder)");
        console.log("\n✨ Your email system is ready for purchase orders!\n");
    } catch (error) {
        console.log("❌ FAILED TO SEND EMAIL\n");
        console.log("Error:", error.message);
        process.exit(1);
    }
}