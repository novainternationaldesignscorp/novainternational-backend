import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import session from "express-session";
import MongoStore from "connect-mongo";
import connectDB from "./config/db.js";
import Stripe from "stripe";

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

// LOAD ENV FIRST (IMPORTANT)
const env = process.env.NODE_ENV;

if (env === "production") {
  dotenv.config({ path: ".env.production" });
} else if (env === "test") {
  dotenv.config({ path: ".env.test" });
} else {
  dotenv.config();
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();

// CONNECT DATABASE
connectDB();

// STRIPE WEBHOOK (MUST BE FIRST)
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

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // allow Postman, server-to-server requests
      if (allowedOrigins.includes(origin)) return callback(null, true);
      console.log("Blocked by CORS:", origin);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true, // needed if using cookies/session
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
      secure: env === "production",
      sameSite: env === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

// JSON PARSER (AFTER WEBHOOK)
app.use(express.json());

// ROUTES
app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/products", productRoutes);
app.use("/api/purchase-order", purchaseOrderRoute);
app.use("/api/purchaseOrderDraft", purchaseOrderDraftRoutes);
app.use("/api/guests", guestRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/signup", signupRouter);

// HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    mongoState: mongoose.connection.readyState,
  });
});


//ROOT
app.get("/", (req, res) => {
  res.send("Backend is running...");
});


//SERVER
const PORT = process.env.PORT || 5000;

console.log("EMAIL_USER:", process.env.EMAIL_USER);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});