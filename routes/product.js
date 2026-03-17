import express from "express";
import Product from "../models/Product.js";

const router = express.Router();

/**
 * GET PRODUCTS
 * Examples:
 * /api/products
 * /api/products?category=fashion
 * /api/products?category=fashion&subcategory=men
 */
router.get("/", async (req, res) => {
  try {
    const { category, subcategory } = req.query;

    let filter = {};

    if (category) filter.category = new RegExp(`^${category}$`, "i");
    if (subcategory) filter.subcategory = new RegExp(`^${subcategory}$`, "i");

    const products = await Product.find(filter);
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET PRODUCT BY ID
 */
router.get("/id/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET PRODUCT BY STYLE NO
 */
router.get("/style/:styleNo", async (req, res) => {
  try {
    const rawStyleNo = String(req.params.styleNo || "").trim();
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const styleNoRegex = new RegExp(`^\\s*${esc(rawStyleNo)}\\s*$`, "i");

    const product = await Product.findOne({ styleNo: { $regex: styleNoRegex } });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET PRODUCT BY FLEXIBLE IDENTIFIER
 * Accepts Mongo _id, styleNo, variant.styleNo, or variant.productId
 */
router.get("/lookup/:identifier", async (req, res) => {
  try {
    const rawIdentifier = String(req.params.identifier || "").trim();
    if (!rawIdentifier) {
      return res.status(400).json({ message: "Identifier is required" });
    }

    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const idRegex = new RegExp(`^\\s*${esc(rawIdentifier)}\\s*$`, "i");

    let product = null;

    if (/^[a-f\d]{24}$/i.test(rawIdentifier)) {
      product = await Product.findById(rawIdentifier);
    }

    if (!product) {
      product = await Product.findOne({
        $or: [
          { styleNo: { $regex: idRegex } },
          { "variants.styleNo": { $regex: idRegex } },
          { "variants.productId": { $regex: idRegex } },
        ],
      });
    }

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET PRODUCT BY SLUG
 */
router.get("/slug/:slug", async (req, res) => {
  try {
    // Trim incoming slug and match ignoring surrounding whitespace in DB
    const rawSlug = String(req.params.slug || "").trim();
    // Escape regex special chars
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const slugRegex = new RegExp(`^\\s*${esc(rawSlug)}\\s*$`, "i");
    const product = await Product.findOne({ slug: { $regex: slugRegex } });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
