import 'dotenv/config'; // automatically loads .env
import nodemailer from 'nodemailer';

async function testEmail() {
const transporter = nodemailer.createTransport({
  host: "outlook.office365.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  logger: true,
  debug: true
});


  try {
    await transporter.verify();
    console.log("✅ SMTP credentials are valid! You can send emails.");
  } catch (err) {
    console.error("❌ SMTP authentication failed:", err.message);
  }
}

testEmail();