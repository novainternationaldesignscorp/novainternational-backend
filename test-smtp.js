import { sendEmail } from "./utils/sendEmail.js";

(async () => {
  try {
    const to = process.env.RESEND_FROM_EMAIL;

    const response = await sendEmail(
      to,
      "Test Email",
      "<h1>This is a test from Resend - Nova International Designs.</h1>"
    );

    console.log(`✅ Email sent to ${to}: ${response?.id}`);
  } catch (err) {
    console.error("❌ Email failed:", err.message);
  }
})();