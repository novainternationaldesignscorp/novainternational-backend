// routes/emailTest.js
import express from "express";
import { sendEmail } from "./utils/sendEmail.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    await sendEmail("your_test_email@example.com", "Test Resend Email", "<p>Hello from Resend!</p>");
    res.send("✅ Email sent successfully!");
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Email failed: " + err.message);
  }
});

export default router;