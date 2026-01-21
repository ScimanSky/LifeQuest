const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const REQUIRED_ENV = [
  "STRAVA_CLIENT_ID",
  "STRAVA_CLIENT_SECRET",
  "POLYGON_RPC_URL",
  "CONTRACT_ADDRESS",
  "OWNER_PRIVATE_KEY"
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const PORT = process.env.PORT || 4000;
const STRAVA_REDIRECT_URI =
  process.env.STRAVA_REDIRECT_URI ||
  `http://localhost:${PORT}/strava/callback`;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const STRAVA_AFTER_TIMESTAMP = 1767225600;
const STRAVA_PER_PAGE = 100;
const IRON_PROTOCOL_TYPES = new Set([
  "WeightTraining",
  "Workout",
  "Crossfit"
]);
const MINDFULNESS_TYPES = new Set(["Yoga", "Meditation", "Mindfulness"]);
const MINDFULNESS_MIN_SECONDS = 600;
const LEVEL_XP = 2000;
const WEEKLY_GOALS = {
  run: 2,
  swim: 2,
  iron: 3,
  mindfulness: 2
};

const CONTRACT_ABI = [
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)"
];
const PAID_ACTIVITIES_PATH = path.join(__dirname, "paid_activities.json");
const STRAVA_TOKEN_PATH = path.join(__dirname, "strava_tokens.json");
const DATABASE_PATH = path.join(__dirname, "database.json");

function normalizeWallet(address) {
  if (!address || typeof address !== "string") return null;
  if (!ethers.isAddress(address)) return null;
  return address.toLowerCase();
}

function loadPaidActivitiesStore() {
  try {
    if (!fs.existsSync(PAID_ACTIVITIES_PATH)) {
      const initial = { wallets: {} };
      fs.writeFileSync(PAID_ACTIVITIES_PATH, JSON.stringify(initial, null, 2));
      return initial;
    }

    const raw = fs.readFileSync(PAID_ACTIVITIES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { wallets: { __legacy: parsed } };
    }
    if (!parsed || typeof parsed !== "object") {
      return { wallets: {} };
    }
    const wallets =
      parsed.wallets && typeof parsed.wallets === "object" ? parsed.wallets : {};
    return { wallets };
  } catch (err) {
    console.error("Errore lettura paid_activities.json:", err);
    return { wallets: {} };
  }
}

function savePaidActivitiesStore(store) {
  try {
    fs.writeFileSync(
      PAID_ACTIVITIES_PATH,
      JSON.stringify(store, null, 2)
    );
  } catch (err) {
    console.error("Errore scrittura paid_activities.json:", err);
  }
}

function getWalletActivities(store, wallet) {
  if (!store || !store.wallets) return [];
  const list = store.wallets[wallet];
  return Array.isArray(list) ? list : [];
}

function loadStravaTokens() {
  try {
    if (!fs.existsSync(STRAVA_TOKEN_PATH)) {
      const initial = { wallets: {}, athleteToWallet: {} };
      fs.writeFileSync(STRAVA_TOKEN_PATH, JSON.stringify(initial, null, 2));
      return initial;
    }

    const raw = fs.readFileSync(STRAVA_TOKEN_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { wallets: {}, athleteToWallet: {} };
    }
    const wallets =
      parsed.wallets && typeof parsed.wallets === "object" ? parsed.wallets : {};
    const athleteToWallet =
      parsed.athleteToWallet && typeof parsed.athleteToWallet === "object"
        ? parsed.athleteToWallet
        : {};
    return { wallets, athleteToWallet };
  } catch (err) {
    console.error("Errore lettura strava_tokens.json:", err);
    return { wallets: {}, athleteToWallet: {} };
  }
}

function saveStravaTokens(tokens) {
  try {
    fs.writeFileSync(STRAVA_TOKEN_PATH, JSON.stringify(tokens, null, 2));
  } catch (err) {
    console.error("Errore scrittura strava_tokens.json:", err);
  }
}

function removeWalletTokens(tokensStore, wallet) {
  if (!tokensStore.wallets || !tokensStore.wallets[wallet]) return false;
  const athleteId = tokensStore.wallets[wallet]?.athlete_id;
  delete tokensStore.wallets[wallet];
  if (athleteId && tokensStore.athleteToWallet?.[athleteId] === wallet) {
    delete tokensStore.athleteToWallet[athleteId];
  }
  return true;
}

function createDefaultWalletDb() {
  return {
    unlockedBadges: [],
    weeklyBonuses: [],
    badges: {
      sonicBurst: false,
      hydroMaster: false,
      ironProtocol: false,
      zenFocus: false
    },
    stats: {
      gymSessions: 0,
      zenSessions: 0
    },
    level: 1
  };
}

function loadDatabase() {
  try {
    if (!fs.existsSync(DATABASE_PATH)) {
      const initial = { wallets: {} };
      fs.writeFileSync(DATABASE_PATH, JSON.stringify(initial, null, 2));
      return initial;
    }

    const raw = fs.readFileSync(DATABASE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { wallets: {} };
    }
    if (!parsed.wallets || typeof parsed.wallets !== "object") {
      return { wallets: { __legacy: parsed } };
    }
    return parsed;
  } catch (err) {
    console.error("Errore lettura database.json:", err);
    return { wallets: {} };
  }
}

function saveDatabase(data) {
  try {
    fs.writeFileSync(DATABASE_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Errore scrittura database.json:", err);
  }
}

function computeRank(balanceWei) {
  const thresholds = {
    neofita: ethers.parseUnits("1500", 18),
    challenger: ethers.parseUnits("5000", 18),
    elite: ethers.parseUnits("15000", 18)
  };

  if (balanceWei <= thresholds.neofita) {
    return "NEOFITA (Lv 1-5)";
  }
  if (balanceWei <= thresholds.challenger) {
    return "CHALLENGER (Lv 6-10)";
  }
  if (balanceWei <= thresholds.elite) {
    return "ELITE (Lv 11-20)";
  }
  return "LEGEND (Lv 21+)";
}

function getWalletDb(store, wallet) {
  if (!store.wallets) {
    store.wallets = {};
  }
  if (!store.wallets[wallet]) {
    store.wallets[wallet] = createDefaultWalletDb();
  }
  const db = store.wallets[wallet];
  if (!Array.isArray(db.unlockedBadges)) {
    db.unlockedBadges = [];
  }
  if (!Array.isArray(db.weeklyBonuses)) {
    db.weeklyBonuses = [];
  }
  if (!db.badges || typeof db.badges !== "object") {
    db.badges = createDefaultWalletDb().badges;
  }
  db.badges.sonicBurst = Boolean(db.badges.sonicBurst);
  db.badges.hydroMaster = Boolean(db.badges.hydroMaster);
  db.badges.ironProtocol = Boolean(db.badges.ironProtocol);
  db.badges.zenFocus = Boolean(db.badges.zenFocus);
  if (!db.stats || typeof db.stats !== "object") {
    db.stats = createDefaultWalletDb().stats;
  }
  db.stats.gymSessions = Number(db.stats.gymSessions) || 0;
  db.stats.zenSessions = Number(db.stats.zenSessions) || 0;
  db.level = Number(db.level) || 1;
  return db;
}
function computeXpMissing(balanceWei) {
  const tokenUnit = ethers.parseUnits("1", 18);
  const balanceTokens = balanceWei / tokenUnit;
  const xpPerLevel = 2000n;
  const nextLevelXp = (balanceTokens / xpPerLevel + 1n) * xpPerLevel;
  return nextLevelXp - balanceTokens;
}

function computeXpTotal(activities, db) {
  const activityXp = activities.reduce((sum, activity) => {
    return sum + (Number(activity?.reward) || 0);
  }, 0);
  const bonuses = Array.isArray(db.weeklyBonuses) ? db.weeklyBonuses : [];
  const bonusXp = bonuses.reduce((sum, bonus) => {
    return sum + (Number(bonus?.reward) || 0);
  }, 0);
  return activityXp + bonusXp;
}

function getWeekBounds(reference) {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const diffToMonday = (day + 6) % 7;
  start.setDate(start.getDate() - diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

function isValidRun(activity) {
  return activity.type === "Run" && Number(activity.distance) > 1000;
}

function isValidSwim(activity) {
  return activity.type === "Swim" && Number(activity.distance) > 250;
}

function isValidIron(activity) {
  return IRON_PROTOCOL_TYPES.has(activity.type);
}

function isValidMindfulness(activity) {
  return (
    MINDFULNESS_TYPES.has(activity.type) &&
    Number(activity.elapsed_time) > MINDFULNESS_MIN_SECONDS
  );
}

function getActivityDate(activity) {
  return activity.start_date || activity.start_date_local || activity.date;
}

function computeWeeklyGoalCounts(activities, reference) {
  const { start, end } = getWeekBounds(reference);
  const counts = {
    run: 0,
    swim: 0,
    iron: 0,
    mindfulness: 0
  };

  for (const activity of activities) {
    if (!activity) continue;
    const dateValue = getActivityDate(activity);
    if (!dateValue) continue;
    const timestamp = new Date(dateValue).getTime();
    if (Number.isNaN(timestamp)) continue;
    if (timestamp < start.getTime() || timestamp >= end.getTime()) {
      continue;
    }

    if (isValidRun(activity)) counts.run += 1;
    if (isValidSwim(activity)) counts.swim += 1;
    if (isValidIron(activity)) counts.iron += 1;
    if (isValidMindfulness(activity)) counts.mindfulness += 1;
  }

  return counts;
}

function checkPerfectWeekBonus(activities, db) {
  const now = new Date();
  const { start } = getWeekBounds(now);
  const weekKey = start.toISOString().split("T")[0];
  const counts = computeWeeklyGoalCounts(activities, now);
  const completed = {
    run: counts.run >= WEEKLY_GOALS.run,
    swim: counts.swim >= WEEKLY_GOALS.swim,
    iron: counts.iron >= WEEKLY_GOALS.iron,
    mindfulness: counts.mindfulness >= WEEKLY_GOALS.mindfulness
  };
  const completedCount = Object.values(completed).filter(Boolean).length;

  const bonuses = Array.isArray(db.weeklyBonuses) ? db.weeklyBonuses : [];
  const alreadyAwarded = bonuses.some((bonus) => bonus.weekStart === weekKey);
  let bonusReward = 0;

  if (completedCount === 4 && !alreadyAwarded) {
    bonusReward = 200;
    bonuses.push({
      weekStart: weekKey,
      reward: bonusReward,
      label: "Bonus Settimana Perfetta",
      awardedAt: new Date().toISOString()
    });
    db.weeklyBonuses = bonuses;
  }

  return {
    bonusReward,
    completedCount,
    counts
  };
}

function computeBadgeStats(activities, stats = {}) {
  let totalRunDistanceMeters = 0;
  let swimSessions = 0;
  let gymSessions = 0;

  for (const activity of activities) {
    if (!activity || !activity.type) {
      continue;
    }

    const distance = Number(activity.distance) || 0;

    if (activity.type === "Run") {
      totalRunDistanceMeters += distance;
    }

    if (activity.type === "Swim") {
      swimSessions += 1;
    }

    if (
      IRON_PROTOCOL_TYPES.has(activity.type) &&
      Number(activity.elapsed_time) > 1800
    ) {
      gymSessions += 1;
    }
  }

  return {
    totalRunDistanceKm: totalRunDistanceMeters / 1000,
    swimSessions,
    gymSessions: Math.max(Number(stats.gymSessions) || 0, gymSessions),
    zenSessions: Number(stats.zenSessions) || 0
  };
}

function checkBadgeUnlock(stats, db) {
  const badges = {
    sonicBurst: false,
    hydroMaster: false,
    ironProtocol: false,
    zenFocus: false,
    ...(db.badges || {})
  };

  if (stats.totalRunDistanceKm >= 50) {
    badges.sonicBurst = true;
  }
  if (stats.swimSessions >= 10) {
    badges.hydroMaster = true;
  }
  if (stats.gymSessions >= 5) {
    badges.ironProtocol = true;
  }
  if (stats.zenSessions >= 5) {
    badges.zenFocus = true;
  }

  db.badges = badges;
  return badges;
}

async function fetchBalance(address) {
  const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
  const contract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    CONTRACT_ABI,
    provider
  );
  return contract.balanceOf(address);
}

async function fetchRecentActivities(accessToken) {
  const activities = [];
  let page = 1;

  while (true) {
    const response = await axios.get(
      "https://www.strava.com/api/v3/athlete/activities",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        params: {
          per_page: STRAVA_PER_PAGE,
          page,
          after: STRAVA_AFTER_TIMESTAMP
        }
      }
    );

    const data = Array.isArray(response.data) ? response.data : [];
    if (data.length === 0) {
      break;
    }

    activities.push(...data);
    if (data.length < STRAVA_PER_PAGE) {
      break;
    }
    page += 1;
  }

  return activities;
}

function evaluateActivities(activities, paidIds) {
  const pendingActivities = [];
  let totalReward = 0;

  for (const activity of activities) {
    if (!activity || !activity.id || paidIds.has(activity.id)) {
      continue;
    }

    const distanceMeters = activity.distance || 0;
    const elapsedTime = Number(activity.elapsed_time) || 0;
    let reward = 0;
    let mappedType = activity.type;
    let mappedIcon;

    if (isValidRun(activity)) {
      reward = 50;
    }

    if (isValidSwim(activity)) {
      reward = 40;
    }

    if (isValidIron(activity)) {
      reward = 30;
      mappedType = "Iron Protocol";
      mappedIcon = "🏋️";
    }

    if (reward === 0) {
      continue;
    }

    pendingActivities.push({
      id: activity.id,
      type: mappedType,
      icon: mappedIcon,
      distance: distanceMeters,
      duration: elapsedTime,
      reward,
      date: activity.start_date || activity.start_date_local || new Date().toISOString()
    });
    totalReward += reward;
  }

  return { pendingActivities, totalReward };
}

async function mintReward(totalReward, recipient) {
  const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
  const wallet = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY, provider);
  const contract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    CONTRACT_ABI,
    wallet
  );

  const tx = await contract.mint(
    recipient,
    ethers.parseUnits(totalReward.toString(), 18),
    { gasLimit: 200000n }
  );
  return tx.wait();
}

function buildStravaAuthUrl(wallet) {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    redirect_uri: STRAVA_REDIRECT_URI,
    response_type: "code",
    scope: "activity:read_all",
    approval_prompt: "auto"
  });
  if (wallet) {
    params.set("state", wallet);
  }

  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

app.get("/strava/auth", (req, res) => {
  const wallet = normalizeWallet(req.query.wallet);
  if (!wallet) {
    return res.status(400).json({ error: "Wallet non valido" });
  }
  const url = buildStravaAuthUrl(wallet);
  return res.redirect(url);
});

app.post("/strava/disconnect", (req, res) => {
  const wallet = normalizeWallet(req.body?.walletAddress || req.query?.wallet);
  if (!wallet) {
    return res.status(400).json({ status: "error", message: "Wallet non valido" });
  }
  const tokensStore = loadStravaTokens();
  const removed = removeWalletTokens(tokensStore, wallet);
  if (removed) {
    saveStravaTokens(tokensStore);
  }
  return res.json({ status: removed ? "disconnected" : "not_connected" });
});

app.get("/activities", (req, res) => {
  const wallet = normalizeWallet(req.query.wallet);
  if (!wallet) {
    return res.status(400).json({ error: "Wallet non valido" });
  }
  const store = loadPaidActivitiesStore();
  const activities = getWalletActivities(store, wallet);
  return res.json(activities);
});

app.get("/user/stats", async (req, res) => {
  try {
    const wallet = normalizeWallet(req.query.wallet);
    if (!wallet) {
      return res.status(400).json({ error: "Wallet non valido" });
    }
    const balanceWei = await fetchBalance(wallet);
    const rank = computeRank(balanceWei);
    const store = loadPaidActivitiesStore();
    const activities = getWalletActivities(store, wallet);

    const dbStore = loadDatabase();
    const db = getWalletDb(dbStore, wallet);
    const unlockedBadges = Array.isArray(db.unlockedBadges)
      ? db.unlockedBadges
      : [];
    const badges = db.badges && typeof db.badges === "object" ? db.badges : {};

    const xpTotal = computeXpTotal(activities, db);
    const currentLevel = Number(db.level) || 1;
    const baseXp = Math.max(0, (currentLevel - 1) * LEVEL_XP);
    const xpCurrentRaw = Math.max(0, xpTotal - baseXp);
    const xpCurrent = Math.min(xpCurrentRaw, LEVEL_XP);
    const xpMissing = Math.max(0, LEVEL_XP - xpCurrent);

    const ignitionUnlocked = balanceWei > ethers.parseUnits("1500", 18);
    if (ignitionUnlocked) {
      const exists = unlockedBadges.some((badge) => badge.id === "ignition");
      if (!exists) {
        unlockedBadges.push({
          id: "ignition",
          name: "The Ignition",
          icon: "zap"
        });
        db.unlockedBadges = unlockedBadges;
        saveDatabase(dbStore);
      }
    }

    return res.json({
      balance: ethers.formatUnits(balanceWei, 18),
      rank,
      xpMissing: xpMissing.toString(),
      level: currentLevel,
      xpCurrent: xpCurrent.toString(),
      nextLevelXp: LEVEL_XP.toString(),
      xpTotal: xpTotal.toString(),
      unlockedBadges,
      badges
    });
  } catch (err) {
    console.error("User stats error:", err);
    return res.status(500).json({ error: "Errore interno" });
  }
});

app.post("/strava/sync", async (req, res) => {
  try {
    const wallet = normalizeWallet(req.body?.walletAddress || req.query?.wallet);
    if (!wallet) {
      return res.status(400).json({ status: "error", message: "Wallet non valido" });
    }

    const tokensStore = loadStravaTokens();
    const tokens = tokensStore.wallets[wallet];
    if (!tokens || !tokens.refresh_token) {
      return res.status(400).json({
        status: "needs_auth",
        message: "Autorizzazione Strava mancante"
      });
    }
    if (tokens.athlete_id) {
      const boundWallet = tokensStore.athleteToWallet[tokens.athlete_id];
      if (boundWallet && boundWallet !== wallet) {
        return res.status(409).json({
          status: "wallet_conflict",
          message: `Questo account Strava è già collegato a un altro wallet (${boundWallet})`
        });
      }
    }

    const refreshResponse = await axios.post(
      "https://www.strava.com/oauth/token",
      new URLSearchParams({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const accessToken = refreshResponse.data?.access_token;
    const refreshToken = refreshResponse.data?.refresh_token;
    if (!accessToken) {
      return res.status(502).json({ status: "error", message: "Token Strava non valido" });
    }

    if (refreshToken && refreshToken !== tokens.refresh_token) {
      tokensStore.wallets[wallet] = {
        ...tokens,
        refresh_token: refreshToken,
        updated_at: new Date().toISOString()
      };
      if (tokensStore.wallets[wallet]?.athlete_id) {
        tokensStore.athleteToWallet[tokensStore.wallets[wallet].athlete_id] = wallet;
      }
      saveStravaTokens(tokensStore);
    }

    const activities = await fetchRecentActivities(accessToken);
    const store = loadPaidActivitiesStore();
    const walletActivities = getWalletActivities(store, wallet);
    const paidIds = new Set(walletActivities.map((activity) => activity.id));

    const dbStore = loadDatabase();
    const db = getWalletDb(dbStore, wallet);
    const perfectWeek = checkPerfectWeekBonus(activities, db);

    const { pendingActivities, totalReward } = evaluateActivities(
      activities,
      paidIds
    );
    const totalRewardWithBonus = totalReward + perfectWeek.bonusReward;
    if (totalRewardWithBonus === 0) {
      const stats = computeBadgeStats(activities, db.stats);
      db.stats = stats;
      checkBadgeUnlock(stats, db);
      saveDatabase(dbStore);
      return res.json({
        status: "no_new_activities",
        totalReward: 0,
        activities: walletActivities,
        perfectWeekProgress: perfectWeek.completedCount
      });
    }

    await mintReward(totalRewardWithBonus, wallet);

    const updatedActivities = walletActivities.concat(pendingActivities);
    store.wallets[wallet] = updatedActivities;
    savePaidActivitiesStore(store);

    const stats = computeBadgeStats(activities, db.stats);
    db.stats = stats;
    checkBadgeUnlock(stats, db);
    saveDatabase(dbStore);

    return res.json({
      status: "minted",
      totalReward: totalRewardWithBonus,
      perfectWeekBonus: perfectWeek.bonusReward,
      perfectWeekProgress: perfectWeek.completedCount,
      validCount: pendingActivities.length,
      activities: updatedActivities
    });
  } catch (err) {
    console.error("Strava sync error:", err);
    return res.status(500).json({ status: "error", message: "Errore interno" });
  }
});

app.post("/user/level-up", (req, res) => {
  try {
    const wallet = normalizeWallet(req.body?.walletAddress || req.query?.wallet);
    if (!wallet) {
      return res.status(400).json({ error: "Wallet non valido" });
    }
    const store = loadPaidActivitiesStore();
    const activities = getWalletActivities(store, wallet);
    const dbStore = loadDatabase();
    const db = getWalletDb(dbStore, wallet);
    const xpTotal = computeXpTotal(activities, db);
    const currentLevel = Number(db.level) || 1;
    const baseXp = Math.max(0, (currentLevel - 1) * LEVEL_XP);
    const xpCurrent = Math.max(0, xpTotal - baseXp);
    if (xpCurrent < LEVEL_XP) {
      return res.status(400).json({ error: "XP insufficienti" });
    }
    db.level = currentLevel + 1;
    saveDatabase(dbStore);
    return res.json({ level: db.level });
  } catch (err) {
    console.error("Level up error:", err);
    return res.status(500).json({ error: "Errore interno" });
  }
});

app.get("/strava/callback", async (req, res) => {
  try {
    const { code, error, state } = req.query;
    const wallet = normalizeWallet(state);

    if (error) {
      return res.status(400).json({ error });
    }

    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Missing authorization code" });
    }
    if (!wallet) {
      return res.status(400).json({ error: "Wallet mancante o non valido" });
    }

    const tokenResponse = await axios.post(
      "https://www.strava.com/oauth/token",
      new URLSearchParams({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: "authorization_code"
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const accessToken = tokenResponse.data?.access_token;
    const refreshToken = tokenResponse.data?.refresh_token;
    const athleteId = tokenResponse.data?.athlete?.id;
    if (!accessToken) {
      return res.status(502).json({ error: "No access token from Strava" });
    }
    if (refreshToken) {
      const tokensStore = loadStravaTokens();
      if (athleteId) {
        const boundWallet = tokensStore.athleteToWallet[athleteId];
        if (boundWallet && boundWallet !== wallet) {
          return res.redirect(
            `${FRONTEND_URL}/?strava_error=wallet_conflict&wallet=${boundWallet}`
          );
        }
      }
      tokensStore.wallets[wallet] = {
        refresh_token: refreshToken,
        athlete_id: athleteId,
        updated_at: new Date().toISOString()
      };
      if (athleteId) {
        tokensStore.athleteToWallet[athleteId] = wallet;
      }
      saveStravaTokens(tokensStore);
    }

    const activities = await fetchRecentActivities(accessToken);
    const store = loadPaidActivitiesStore();
    const walletActivities = getWalletActivities(store, wallet);
    const paidIds = new Set(walletActivities.map((activity) => activity.id));

    const dbStore = loadDatabase();
    const db = getWalletDb(dbStore, wallet);
    const perfectWeek = checkPerfectWeekBonus(activities, db);

    const { pendingActivities, totalReward } = evaluateActivities(
      activities,
      paidIds
    );
    const totalRewardWithBonus = totalReward + perfectWeek.bonusReward;

    if (totalRewardWithBonus === 0) {
      const stats = computeBadgeStats(activities, db.stats);
      db.stats = stats;
      checkBadgeUnlock(stats, db);
      saveDatabase(dbStore);
      return res.redirect(`${FRONTEND_URL}/?no_new_activities=true`);
    }

    await mintReward(totalRewardWithBonus, wallet);

    const updatedActivities = walletActivities.concat(pendingActivities);
    store.wallets[wallet] = updatedActivities;
    savePaidActivitiesStore(store);

    const stats = computeBadgeStats(activities, db.stats);
    db.stats = stats;
    checkBadgeUnlock(stats, db);
    saveDatabase(dbStore);

    return res.redirect(`${FRONTEND_URL}/?minted=true`);
  } catch (err) {
    console.error("Strava callback error:", err);
    return res.status(500).json({ error: "Errore interno" });
  }
});

app.listen(PORT, () => {
  console.log(`Server avviato su http://localhost:${PORT}`);
  console.log(`Strava redirect URI: ${STRAVA_REDIRECT_URI}`);
  console.log(`Frontend URL: ${FRONTEND_URL}`);
});
