import "dotenv/config";
import nodemailer from "nodemailer";

async function emailTest() {
  const { EMAIL_USER, EMAIL_PASS } = process.env;

  // Validate environment variables
  if (!EMAIL_USER || !EMAIL_PASS) {
    console.error("❌ Missing EMAIL_USER or EMAIL_PASS in environment variables.");
    process.exit(1);
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
    logger: true, // set to false in production
  });

  try {
    console.log("🔎 Verifying SMTP connection...");

    await transporter.verify();

    console.log("✅ SMTP credentials are valid. Email service is ready.");
  } catch (error) {
    console.error("❌ SMTP verification failed.");
    console.error("Message:", error?.message);
    console.error("Code:", error?.code || "N/A");
  } finally {
    process.exit();
  }
}

emailTest();