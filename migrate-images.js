import { v2 as cloudinary } from "cloudinary";
import axios from "axios";
import products from "./seedProducts.js";

// 🔹 TEST account (source)
const testCloud = cloudinary;
testCloud.config({
  cloud_name: "djgz1kays",
  api_key: "642728461838965",
  api_secret: "Dx3ezV3-yAcVL6lsMeaxMpqf7fA"
});

// 🔹 PROD account (destination)
const prodCloud = cloudinary;
prodCloud.config({
  cloud_name: "djux8tl4r",
  api_key: "869585928496349",
  api_secret: "y_BY0BewVk0W1PV3Me3Qsr_RjMs"
});

// Helper: extract public_id
function extractPublicId(url) {
  const parts = url.split("/upload/")[1];
  const withoutVersion = parts.replace(/^v\d+\//, "");
  return withoutVersion.replace(/\.[^/.]+$/, "");
}

// Delay
const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function migrateImages() {
  for (const product of products) {

    for (const imageUrl of product.images || []) {
      const publicId = extractPublicId(imageUrl);

      try {
        console.log("Migrating:", publicId);

        // Download from TEST Cloudinary
        const response = await axios.get(imageUrl, {
          responseType: "arraybuffer",
        });

        const base64 = Buffer.from(response.data, "binary").toString("base64");

        // Upload to PROD Cloudinary
        await prodCloud.uploader.upload(
          `data:image/jpeg;base64,${base64}`,
          {
            public_id: publicId,
            overwrite: true,
          }
        );

        console.log("Uploaded:", publicId);

        await delay(200);
      } catch (err) {
        console.error("Failed:", publicId, err.message);
      }
    }
  }

  console.log("Migration completed!");
}

migrateImages();