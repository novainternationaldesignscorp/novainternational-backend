app.get("/emailTest", async (req, res) => {
  try {
    const nodemailer = require("nodemailer");

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10000, // 10 seconds
    });

    await transporter.sendMail({
      from: `"Test" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER,
      subject: "Test Email from Render",
      text: "Hello! This is a test email.",
    });

    res.send("Email sent!");
  } catch (err) {
    console.error("Email failed:", err.message);
    res.status(500).send("Email failed: " + err.message);
  }
});