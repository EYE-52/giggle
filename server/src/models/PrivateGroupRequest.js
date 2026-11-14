const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  requestId: { type: String, required: true, unique: true },
  squadId: { type: String, required: true },
  senderId: { type: String, required: true },
  recipientId: { type: String, required: true },
  status: {
    type: String,
    enum: ["pending", "accepted", "declined", "cancelled"],
    default: "pending",
  },
  resultSquadId: String,
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ senderId: 1, status: 1, expiresAt: 1 });
schema.index({ recipientId: 1, status: 1, expiresAt: 1 });
module.exports = mongoose.model("PrivateGroupRequest", schema);
