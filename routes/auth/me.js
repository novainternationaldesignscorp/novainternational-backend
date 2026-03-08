// routes/auth/me.js
import express from "express";
import User from "../../models/User.js";

const router = express.Router();

// GET /api/auth/me
router.get("/", async (req, res) => {
  if (!req.session.userId) {
    // Not logged in is a valid app state; return 200 so frontend boot is quiet.
    return res.status(200).json({ user: null, authenticated: false });
  }

  try {
    const user = await User.findById(req.session.userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      user: {
        _id: user._id,       // Use _id for consistency with MongoDB
        name: user.name,
        email: user.email,
      },
      authenticated: true,
    });
  } catch (err) {
    console.error("Fetch user error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
