const {
  DEFAULT_ARENA_START_GRACE_MINUTES
} = require("./constants");

function getContractAddress() {
  return (
    process.env.CONTRACT_ADDRESS ||
    process.env.NEXT_PUBLIC_LIFE_TOKEN_ADDRESS ||
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
    ""
  );
}

const PORT = process.env.PORT || 4000;
const STRAVA_REDIRECT_URI =
  process.env.STRAVA_REDIRECT_URI ||
  `http://localhost:${PORT}/strava/callback`;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "";
const OWNER_PRIVATE_KEY = process.env.OWNER_PRIVATE_KEY || "";
const CONTRACT_ADDRESS = getContractAddress();

const ARENA_TEST_MODE =
  process.env.ARENA_TEST_MODE === "true" ||
  process.env.ARENA_TEST_MODE === "1" ||
  !process.env.ARENA_TEST_MODE;
const ARENA_START_GRACE_MINUTES =
  Number(process.env.ARENA_START_GRACE_MINUTES) ||
  DEFAULT_ARENA_START_GRACE_MINUTES;

const REQUIRED_ENV = [
  "STRAVA_CLIENT_ID",
  "STRAVA_CLIENT_SECRET",
  "POLYGON_RPC_URL",
  "OWNER_PRIVATE_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY"
];

function validateEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
}

module.exports = {
  PORT,
  STRAVA_REDIRECT_URI,
  FRONTEND_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  POLYGON_RPC_URL,
  OWNER_PRIVATE_KEY,
  CONTRACT_ADDRESS,
  ARENA_TEST_MODE,
  ARENA_START_GRACE_MINUTES,
  validateEnv
};
