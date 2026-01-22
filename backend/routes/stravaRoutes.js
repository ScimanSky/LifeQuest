const express = require("express");
const stravaController = require("../controllers/stravaController");

const router = express.Router();

router.get("/auth", stravaController.stravaAuth);
router.post("/disconnect", stravaController.stravaDisconnect);
router.post("/sync", stravaController.stravaSync);
router.get("/callback", stravaController.stravaCallback);

module.exports = router;
