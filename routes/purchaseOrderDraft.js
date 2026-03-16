import express from "express";
import PurchaseOrderDraft from "../models/PurchaseOrderDraft.js";
import crypto from "crypto";
import mongoose from "mongoose";

const router = express.Router();

const normalizeField = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
};

const matchesDraftItem = (item, { productId, color, size }) => {
  const itemProductId = normalizeField(item.productId);
  const targetProductId = normalizeField(productId);
  if (!targetProductId || itemProductId !== targetProductId) return false;

  const targetColor = normalizeField(color);
  const targetSize = normalizeField(size);
  const itemColor = normalizeField(item.color);
  const itemSize = normalizeField(item.size);

  const colorMatch = targetColor === null ? true : itemColor === targetColor;
  const sizeMatch = targetSize === null ? true : itemSize === targetSize;

  return colorMatch && sizeMatch;
};

/**
 * GET /:ownerType/:ownerId
 * Fetch or create a draft PO for a user or guest
 */
router.get("/:ownerType/:ownerId", async (req, res) => {
  try {
    const { ownerType, ownerId } = req.params;

    if (!["User", "Guest"].includes(ownerType)) {
      return res.status(400).json({ error: "ownerType must be 'User' or 'Guest'" });
    }

    // Convert string ownerId to ObjectId for MongoDB query
    const ownerIdObj = mongoose.Types.ObjectId.isValid(ownerId)
      ? new mongoose.Types.ObjectId(ownerId)
      : ownerId;

    let po = await PurchaseOrderDraft.findOne({ ownerType, ownerId: ownerIdObj });
    if (!po) {
      const purchaseOrderId = crypto.randomBytes(16).toString("hex");
      po = new PurchaseOrderDraft({ ownerType, ownerId: ownerIdObj, purchaseOrderId, items: [] });
      await po.save();
    }

    res.json(po);
  } catch (err) {
    console.error("Error fetching PO draft:", err);
    res.status(500).json({ error: "Failed to fetch PO draft" });
  }
});

/**
 * POST /:ownerType/:ownerId/items
 * Add/update items in draft PO
 */
router.post("/:ownerType/:ownerId/items", async (req, res) => {
  try {
    const { ownerType, ownerId } = req.params;
    const { items } = req.body;

    if (!["User", "Guest"].includes(ownerType)) {
      return res.status(400).json({ error: "ownerType must be 'User' or 'Guest'" });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items array is required" });
    }

    // Convert string ownerId to ObjectId for MongoDB query
    const ownerIdObj = mongoose.Types.ObjectId.isValid(ownerId)
      ? new mongoose.Types.ObjectId(ownerId)
      : ownerId;

    let po = await PurchaseOrderDraft.findOne({ ownerType, ownerId: ownerIdObj });
    if (!po) {
      const purchaseOrderId = crypto.randomBytes(16).toString("hex");
      po = new PurchaseOrderDraft({ ownerType, ownerId: ownerIdObj, purchaseOrderId, items: [] });
      await po.save();
    }

    // merge items into a plain array then atomically replace
    const merged = [...po.items.map((i) => ({
      productId: i.productId,
      name: i.name,
      price: i.price,
      qty: i.qty,
      image: i.image || null,
      color: i.color,
      size: i.size,
    }))];

    items.forEach((item) => {
      const idx = merged.findIndex((i) =>
        matchesDraftItem(i, {
          productId: item.productId,
          color: item.color,
          size: item.size,
        })
      );
      if (idx > -1) {
        merged[idx].qty = (Number(merged[idx].qty) || 0) + (Number(item.quantity) || 0);
      } else {
        merged.push({
          productId: item.productId,
          name: item.name,
          price: item.price,
          qty: Number(item.quantity) || 0,
          image: item.image || null,
          color: item.color || null,
          size: item.size || null,
        });
      }
    });

    const updated = await PurchaseOrderDraft.findOneAndUpdate(
      { ownerType, ownerId: ownerIdObj },
      { $set: { items: merged } },
      { new: true, upsert: true }
    );

    res.json({ message: "Order added successfully", po: updated });
  } catch (err) {
    console.error("Error adding items to PO:", err);
    res.status(500).json({ error: "Failed to update PO draft", details: err.message });
  }
});

/**
 * DELETE /:ownerType/:ownerId/items
 * Delete a single item from draft PO or clear all items
 */
router.delete("/:ownerType/:ownerId/items", async (req, res) => {
  try {
    const { ownerType, ownerId } = req.params;
    const { productId, color, size } = req.body || {};

    if (!["User", "Guest"].includes(ownerType)) {
      return res.status(400).json({ error: "ownerType must be 'User' or 'Guest'" });
    }

    // Convert string ownerId to ObjectId for MongoDB query
    const ownerIdObj = mongoose.Types.ObjectId.isValid(ownerId)
      ? new mongoose.Types.ObjectId(ownerId)
      : ownerId;

    const po = await PurchaseOrderDraft.findOne({ ownerType, ownerId: ownerIdObj });
    if (!po) return res.status(404).json({ error: "Draft not found" });

    if (productId) {
      // Remove matching items (match productId + optional color + size)
      const newItems = po.items.filter(
        (i) => !matchesDraftItem(i, { productId, color, size })
      );

      if (newItems.length === po.items.length) {
        return res.status(404).json({ error: "Item not found in draft" });
      }

      const updated = await PurchaseOrderDraft.findOneAndUpdate(
        { ownerType, ownerId: ownerIdObj },
        { $set: { items: newItems } },
        { new: true }
      );

      return res.json({ message: "Item removed", po: updated });
    }

    // No productId -> clear all items
    const cleared = await PurchaseOrderDraft.findOneAndUpdate(
      { ownerType, ownerId: ownerIdObj },
      { $set: { items: [] } },
      { new: true }
    );
    return res.json({ message: "Draft cleared", po: cleared });
  } catch (err) {
    console.error("Error deleting items from PO:", err);
    res.status(500).json({ error: "Failed to delete items from PO" });
  }
});

/**
 * PATCH /:ownerType/:ownerId/items
 * Update quantity for a single item in draft PO
 */
router.patch("/:ownerType/:ownerId/items", async (req, res) => {
  try {
    const { ownerType, ownerId } = req.params;
    const { productId, color, size, qty } = req.body || {};

    if (!['User', 'Guest'].includes(ownerType)) {
      return res.status(400).json({ error: "ownerType must be 'User' or 'Guest'" });
    }

    if (!productId) {
      return res.status(400).json({ error: "productId is required" });
    }

    const numericQty = Number(qty);
    if (!Number.isFinite(numericQty) || numericQty < 1) {
      return res.status(400).json({ error: "qty must be a number greater than or equal to 1" });
    }

    const ownerIdObj = mongoose.Types.ObjectId.isValid(ownerId)
      ? new mongoose.Types.ObjectId(ownerId)
      : ownerId;

    const po = await PurchaseOrderDraft.findOne({ ownerType, ownerId: ownerIdObj });
    if (!po) return res.status(404).json({ error: "Draft not found" });

    const index = po.items.findIndex((i) =>
      matchesDraftItem(i, { productId, color, size })
    );

    if (index === -1) {
      return res.status(404).json({ error: "Item not found in draft" });
    }

    po.items[index].qty = numericQty;
    po.updatedAt = new Date();
    await po.save();

    return res.json({ message: "Item quantity updated", po });
  } catch (err) {
    console.error("Error updating item quantity in PO:", err);
    return res.status(500).json({ error: "Failed to update item quantity" });
  }
});

export default router;
