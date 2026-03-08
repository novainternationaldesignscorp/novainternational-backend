// routes/orders.js
import express from "express";
import mongoose from "mongoose";
import PurchaseOrder from "../models/PurchaseOrder.js";
import Guest from "../models/Guest.js";

const router = express.Router();

/* =============================
   Helper to convert to ObjectId
============================= */
const toObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;
};

/* =============================
   GET MY ORDERS (logged-in session)
============================= */
router.get("/my-orders", async (req, res) => {
  try {
    const sessionUserId = req.session.userId || req.session.user?._id;
    if (!sessionUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const ownerId = toObjectId(sessionUserId);

    const orders = await PurchaseOrder.find({
      ownerType: "User",
      ownerId,
    }).sort({ createdAt: -1 });

    res.json({ orders, count: orders.length });
  } catch (err) {
    console.error("Fetch orders error:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

/* =============================
   GET ORDERS BY USER ID
============================= */
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const ownerId = toObjectId(userId);

    const orders = await PurchaseOrder.find({
      ownerType: "User",
      ownerId,
    }).sort({ createdAt: -1 });

    res.json({ orders, count: orders.length });
  } catch (err) {
    console.error("Fetch user orders error:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

/* =============================
   GET ORDERS BY GUEST ID
============================= */
router.get("/guest/:guestId", async (req, res) => {
  try {
    const { guestId } = req.params;
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(401).json({ error: "Guest sessionId is required" });
    }

    const guest = await Guest.findById(guestId).select("sessionId").lean();
    if (!guest || guest.sessionId !== sessionId) {
      return res.status(401).json({ error: "Invalid or expired guest session" });
    }

    const ownerId = toObjectId(guestId);

    const orders = await PurchaseOrder.find({
      ownerType: "Guest",
      ownerId,
    }).sort({ createdAt: -1 });

    res.json({ orders, count: orders.length });
  } catch (err) {
    console.error("Fetch guest orders error:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

export default router;