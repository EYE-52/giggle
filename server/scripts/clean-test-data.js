// One-off cleanup: wipe test/stale data from the database.
// Run with prod env injected:  railway run node scripts/clean-test-data.js
//
// Pre-launch the only real user is the Google-authed owner; every squad/encounter
// so far is test data (E2E harness + curl), and dev sign-ins created
// `*@dev.giggle.local` users. This clears them so real squads start clean.
const mongoose = require("mongoose");

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error("No MONGODB_URI in env"); process.exit(1); }
  await mongoose.connect(uri);
  const { Squad } = require("../src/models/Squad");
  const { Encounter } = require("../src/models/Encounter");
  const { SquadCover } = require("../src/models/SquadCover");
  const User = require("../src/models/User");

  const before = {
    squads: await Squad.countDocuments(),
    encounters: await Encounter.countDocuments(),
    users: await User.countDocuments(),
  };

  // 1) Wipe all squads + encounters (all are test rooms pre-launch).
  const sq = await Squad.deleteMany({});
  await SquadCover.deleteMany({}); // uploaded cover images of those squads
  const en = await Encounter.deleteMany({});

  // 2) Delete dev sign-in users + obvious test accounts. KEEP real users
  //    (anyone with a normal email — e.g. the Google owner). Dev users use the
  //    @dev.giggle.local domain; curl test users have these exact names.
  const TEST_NAMES = ["UserA", "Turbo Wolf", "R2", "Savage Falcon", "BotOne", "BotTwo",
    "Alice", "Bob", "Carol", "Owner", "PremLeader", "Feral Viper"];
  const du = await User.deleteMany({
    $or: [
      { email: /@dev\.giggle\.local$/i },
      { email: /@(dev|test|example)\./i },
      { email: /\.(test|local|example)$/i },   // catches *@g.test harness users
      { email: /@g\.test$/i },
      { email: /@(t|x)\.com$/i },              // e2e-a@x.com, *@t.com harness users
      { email: /^(sqtest_|e2e-)/i },           // scripted test accounts
      { name: { $in: TEST_NAMES } },
    ],
  });

  const after = {
    squads: await Squad.countDocuments(),
    encounters: await Encounter.countDocuments(),
    users: await User.countDocuments(),
  };
  console.log("BEFORE:", before);
  console.log("DELETED:", { squads: sq.deletedCount, encounters: en.deletedCount, users: du.deletedCount });
  console.log("AFTER:", after);
  console.log("Remaining users (should be real ones only):");
  const remaining = await User.find({}, "name email").limit(50);
  remaining.forEach((u) => console.log("  -", u.name, "<" + u.email + ">"));
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
