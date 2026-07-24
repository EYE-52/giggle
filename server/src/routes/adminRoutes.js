const express = require("express");
const { requireApiAuth } = require("../middlewares/authMiddleware");
const { requireAdmin, getPendingUsersHandler, approveUserHandler } = require("../controllers/adminController");

const router = express.Router();

// All admin routes require basic auth AND the specific admin email check
router.get("/pending-users", requireApiAuth, requireAdmin, getPendingUsersHandler);
router.post("/approve-user/:userId", requireApiAuth, requireAdmin, approveUserHandler);

module.exports = router;
