import express from "express";
import bcrypt from "bcryptjs";
import User from "../../models/User.js";
import { sendWelcomeEmail } from "../../utils/mailer.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const rawName = req.body?.name;
  const rawEmail = req.body?.email;
  const rawPassword = req.body?.password;

  const name = String(rawName || "").trim();
  const email = String(rawEmail || "").trim().toLowerCase();
  const password = String(rawPassword || "");

  if (!name || !email || !password) {
    return res.status(422).json({ message: "Name, email and password are required" });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(422).json({ message: "Please enter a valid email address" });
  }

  if (password.length < 6) {
    return res.status(422).json({ message: "Password must be at least 6 characters" });
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "User already exists. Please sign in." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
    });

    req.session.userId = user._id;

    // Send welcome email asynchronously (errors won't block signup)
    sendWelcomeEmail(email, name);

    res.status(201).json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
