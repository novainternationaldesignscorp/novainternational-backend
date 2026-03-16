import mongoose from "mongoose";

const ProductSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true
    },
    price: Number,
    styleNo: {
      type: String,
      required: true,
      unique: true
    },

    category: {
    type: String,
    required: true, // electronics, fashion, robots
    },
    subcategory: {
    type: String,   // fans, vacuum, clutches
    },
    colors: [String],
    slug: { type: String, unique: true },
    sizes: [String],
    minQty: Number,
    images: [String],
    description: String
  },
  { timestamps: true }
);

export default mongoose.model("Product", ProductSchema);
