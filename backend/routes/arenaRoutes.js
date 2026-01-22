const express = require("express");
const arenaController = require("../controllers/arenaController");

const router = express.Router();

router.post("/resolve", arenaController.resolveChallenge);
router.post("/progress", arenaController.refreshProgress);
router.post("/claim", arenaController.claimReward);

module.exports = router;
