const express = require("express");
const cors = require("cors");
require("dotenv").config();

const {
  PORT,
  STRAVA_REDIRECT_URI,
  FRONTEND_URL,
  validateEnv
} = require("./config/env");
const stravaRoutes = require("./routes/stravaRoutes");
const userRoutes = require("./routes/userRoutes");
const arenaRoutes = require("./routes/arenaRoutes");

try {
  validateEnv();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

app.use("/strava", stravaRoutes);
app.use("/arena", arenaRoutes);
app.use("/", userRoutes);

app.listen(PORT, () => {
  console.log(`Server avviato su http://localhost:${PORT}`);
  console.log(`Strava redirect URI: ${STRAVA_REDIRECT_URI}`);
  console.log(`Frontend URL: ${FRONTEND_URL}`);
});
