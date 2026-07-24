const express = require("express");
const { requireApiAuth } = require("../middlewares/authMiddleware");
const {
  listNotifications,
  markAllRead,
  markOneRead,
  dismissNotification,
} = require("../controllers/notificationController");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: Per-user notification feed
 */

router.get("/notifications", requireApiAuth, listNotifications);
router.post("/notifications/read-all", requireApiAuth, markAllRead);
router.post("/notifications/:id/read", requireApiAuth, markOneRead);
router.delete("/notifications/:id", requireApiAuth, dismissNotification);

module.exports = router;
