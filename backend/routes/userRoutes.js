const express = require("express");
const userController = require("../controllers/userController");

const router = express.Router();

router.get("/activities", userController.getActivities);
router.get("/user/stats", userController.getUserStats);
router.post("/user/level-up", userController.levelUp);

module.exports = router;
