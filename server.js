import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import session from "express-session";
import MongoStore from "connect-mongo";
import connectDB from "./config/db.js";
import Stripe from "stripe";
import dotenv from "dotenv";

// Routes
import authRoutes from "./routes/auth/index.js";
import uploadRoutes from "./routes/upload.js";
import productRoutes from "./routes/product.js";
import purchaseOrderRoute from "./routes/purchaseOrder.js";
import purchaseOrderDraftRoutes from "./routes/purchaseOrderDraft.js";
import signupRouter from "./routes/auth/signup.js";
import paymentRoutes from "./routes/payment.js";
import webhookRoutes from "./routes/webhook.js";
import guestRoutes from "./routes/guests.js";
import ordersRoutes from "./routes/orders.js";
import debugRoutes from "./routes/debug.js";
import emailTest from "./emailTest.js";

// LOAD ENV FIRST
const env = process.env.NODE_ENV;

if (env !== "production") {
  dotenv.config();
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();

const isProdLike = env === "production" || process.env.RENDER === "true";

if (isProdLike) {
  app.set("trust proxy", 1);
}

// CONNECT DB
connectDB();

// WEBHOOK FIRST
app.use("/api/webhook", webhookRoutes);

// CORS
const envOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://calm-blini-7a30a5.netlify.app",
  "https://www.novainternationaldesigns.com",
  "https://novainternational-backend.onrender.com",
  ...envOrigins,
];

const normalizeOrigin = (value) => String(value || "").replace(/\/$/, "");

const allowOrigin = (origin) => {
  const clean = normalizeOrigin(origin);
  if (!clean) return true;

  if (allowedOrigins.map(normalizeOrigin).includes(clean)) return true;

  if (/^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(clean)) return true;

  return false;
};

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowOrigin(origin)) return callback(null, true);
      console.log("Blocked by CORS:", origin);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// SESSION
app.use(
  session({
    name: "nova.sid",
    secret: process.env.SESSION_SECRET || "secret-key",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: {
      httpOnly: true,
      secure: isProdLike,
      sameSite: isProdLike ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

// JSON
app.use(express.json());

// ROUTES
app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/products", productRoutes);
app.use("/api/purchase-order", purchaseOrderRoute);
app.use("/api/purchaseOrderDraft", purchaseOrderDraftRoutes); // adding this for easier fetching of draft by owner
app.use("/api/guests", guestRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/payment", paymentRoutes); // adding this for easier fetching of draft by owner
app.use("/api/signup", signupRouter);
app.use("/api/debug", debugRoutes);
app.use("/api/emailTest", emailTest);

// HEALTH
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    mongoState: mongoose.connection.readyState,
  });
});

// ROOT
app.get("/", (req, res) => {
  res.send("Backend is running...");
});

// START
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});