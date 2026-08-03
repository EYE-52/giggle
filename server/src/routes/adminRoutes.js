const express = require("express");
const { requireIdentityAuth } = require("../middlewares/authMiddleware");
const {
  requireAdmin,
  getPendingUsersHandler,
  approveUserHandler,
  updateUserAccessHandler,
} = require("../controllers/adminController");

const router = express.Router();

// All admin routes require basic auth AND the specific admin email check
router.get("/pending-users", requireIdentityAuth, requireAdmin, getPendingUsersHandler);
router.post("/approve-user/:userId", requireIdentityAuth, requireAdmin, approveUserHandler);
router.patch("/users/:userId/access", requireIdentityAuth, requireAdmin, updateUserAccessHandler);

module.exports = router;
