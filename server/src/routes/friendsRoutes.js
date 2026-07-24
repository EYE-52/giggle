const express = require("express");
const { requireApiAuth } = require("../middlewares/authMiddleware");
const {
  listFriends,
  listRequests,
  sendRequest,
  acceptRequest,
  declineRequest,
  removeFriend,
  searchUsers,
} = require("../controllers/friendsController");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Friends
 *   description: Friends graph & online presence
 */

// All friends/presence routes require auth.
router.get("/friends", requireApiAuth, listFriends);
router.get("/friends/requests", requireApiAuth, listRequests);
router.post("/friends/request", requireApiAuth, sendRequest);
router.post("/friends/accept", requireApiAuth, acceptRequest);
router.post("/friends/decline", requireApiAuth, declineRequest);
router.post("/friends/remove", requireApiAuth, removeFriend);

// User search (excludes self + existing friends).
router.get("/users/search", requireApiAuth, searchUsers);

module.exports = router;
