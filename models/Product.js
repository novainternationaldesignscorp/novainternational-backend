import mongoose from "mongoose";

function normalizeVariantImageField(variant = {}) {
  const normalizedVariant = variant;
  const legacyImagePublicId = normalizedVariant.images_public_id;

  if (!normalizedVariant.image_public_id && legacyImagePublicId) {
    normalizedVariant.image_public_id = legacyImagePublicId;
  }

  delete normalizedVariant.images_public_id;

  return normalizedVariant;
}

const VariantSchema = new mongoose.Schema({
  styleNo: String,
  productId: String,
  color: String,
  size: String,
  price: Number,
  image: String,
  image_public_id: String
}, { _id: false });

VariantSchema.pre("validate", function(next) {
  normalizeVariantImageField(this);
  next();
});

function normalizeProductVariants(_doc, ret) {
  if (Array.isArray(ret.variants)) {
    ret.variants = ret.variants.map((variant) =>
      normalizeVariantImageField(variant)
    );
  }

  return ret;
}

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true},
    price: Number,
    styleNo: {type: String,required: true,unique: true},
    category: { type: String, required: true},
    subcategory: {type: String},
    colors: [String],
    slug: {type: String,unique: true},
    sizes: [String],
    minQty: Number,

    // Images (URLs for now, will migrate to public_id)
    images: [String],

    // NEW: Cloudinary public IDs
    images_public_id: [String],

    // Variants (structured properly)
    variants: [VariantSchema]
  },
  { timestamps: true }
);

ProductSchema.set("toJSON", { transform: normalizeProductVariants });
ProductSchema.set("toObject", { transform: normalizeProductVariants });

export default mongoose.model("Product", ProductSchema);