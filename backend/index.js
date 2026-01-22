const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { ethers } = require("ethers");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const REQUIRED_ENV = [
  "STRAVA_CLIENT_ID",
  "STRAVA_CLIENT_SECRET",
  "POLYGON_RPC_URL",
  "CONTRACT_ADDRESS",
  "OWNER_PRIVATE_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY"
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
const ARENA_DEFAULT_DURATION_DAYS = 7;
const ARENA_DRAW_REFUND_RATE = 0.85;
const ARENA_TEST_MODE =
  process.env.ARENA_TEST_MODE === "true" ||
  process.env.ARENA_TEST_MODE === "1" ||
  !process.env.ARENA_TEST_MODE;
const ARENA_PROGRESS_CACHE_MS = 60000;
const ARENA_START_GRACE_MINUTES = Number(process.env.ARENA_START_GRACE_MINUTES) || 720;
const IRON_PROTOCOL_TYPES = new Set([
  "WeightTraining",
  "Workout",
  "Crossfit"
]);
const MINDFULNESS_TYPES = new Set(["Yoga", "Meditation", "Mindfulness"]);
const ARENA_GYM_TYPES = new Set([
  ...IRON_PROTOCOL_TYPES,
  ...MINDFULNESS_TYPES,
  "Iron Protocol"
]);
const MIN_TRACKED_DISTANCE_METERS = 100;
const MINDFULNESS_MIN_SECONDS = 0;
const XP_CHALLENGE_STATUSES = [
  "completed",
  "claim_completato",
  "resolved",
  "claimed"
];
const LEVEL_XP = 2000;
const WEEKLY_GOALS = {
  run: 2,
  swim: 2,
  iron: 3,
  mindfulness: 2
};

const CONTRACT_ABI = [
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
  "function MINTER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)"
];
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      })
    : null;
const arenaProgressCache = new Map();

function getContractAddress() {
  return (
    process.env.CONTRACT_ADDRESS ||
    process.env.NEXT_PUBLIC_LIFE_TOKEN_ADDRESS ||
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
    ""
  );
}

function normalizeWallet(address) {
  if (!address || typeof address !== "string") return null;
  if (!ethers.isAddress(address)) return null;
  return address.toLowerCase();
}

function buildStravaRateLimitError(error) {
  const retryAfter = Number(error?.response?.headers?.["retry-after"] || 60);
  const err = new Error("Rate limit Strava");
  err.code = "STRAVA_RATE_LIMIT";
  err.retryAfter = Number.isFinite(retryAfter) ? retryAfter : 60;
  return err;
}

function isStravaRateLimitError(error) {
  return (
    error?.code === "STRAVA_RATE_LIMIT" ||
    error?.response?.status === 429
  );
}

function getArenaCacheKey(wallet, type, startAt, endAt) {
  return `${wallet}:${type}:${startAt}:${endAt ?? "open"}`;
}

function getCachedArenaProgress(wallet, type, startAt, endAt) {
  const key = getArenaCacheKey(wallet, type, startAt, endAt);
  const entry = arenaProgressCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > ARENA_PROGRESS_CACHE_MS) return null;
  return entry.progress;
}

function setCachedArenaProgress(wallet, type, startAt, endAt, progress) {
  const key = getArenaCacheKey(wallet, type, startAt, endAt);
  arenaProgressCache.set(key, { progress, fetchedAt: Date.now() });
}

function ensureSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !supabase) {
    throw new Error("Supabase non configurato");
  }
}

async function withSupabase(task, fallback, context) {
  try {
    ensureSupabaseConfig();
    return await task();
  } catch (err) {
    console.error(`Errore Supabase${context ? ` (${context})` : ""}:`, err);
    return fallback;
  }
}

async function fetchChallengeById(challengeId) {
  return withSupabase(
    async () => {
      const { data, error } = await supabase
        .from("challenges")
        .select("*")
        .eq("id", challengeId)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    null,
    "fetchChallengeById"
  );
}

async function updateChallengeById(challengeId, patch) {
  return withSupabase(
    async () => {
      const { data, error } = await supabase
        .from("challenges")
        .update(patch)
        .eq("id", challengeId)
        .select();
      if (error) throw error;
      return data;
    },
    null,
    "updateChallengeById"
  );
}

async function fetchStravaToken(userId) {
  return withSupabase(
    async () => {
      const { data, error } = await supabase
        .from("user_auth")
        .select(
          "user_id,access_token,refresh_token,expires_at,athlete_id,updated_at"
        )
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    null,
    "fetchStravaToken"
  );
}

async function fetchWalletByAthlete(athleteId) {
  if (!athleteId) return null;
  return withSupabase(
    async () => {
      const { data, error } = await supabase
        .from("user_auth")
        .select("user_id")
        .eq("athlete_id", athleteId)
        .maybeSingle();
      if (error) throw error;
      return data?.user_id || null;
    },
    null,
    "fetchWalletByAthlete"
  );
}

async function upsertStravaToken(userId, payload) {
  return withSupabase(
    async () => {
      const record = {
        ...payload,
        user_id: payload.user_id ?? userId,
        updated_at: payload.updated_at ?? new Date().toISOString()
      };
      const { error } = await supabase
        .from("user_auth")
        .upsert(record, { onConflict: "user_id" });
      if (error) throw error;
      return true;
    },
    false,
    "upsertStravaToken"
  );
}

async function deleteStravaToken(wallet) {
  return withSupabase(
    async () => {
      const { data, error } = await supabase
        .from("user_auth")
        .delete()
        .eq("user_id", wallet)
        .select("user_id");
      if (error) throw error;
      return Array.isArray(data) && data.length > 0;
    },
    false,
    "deleteStravaToken"
  );
}

function mapStravaActivityRow(row) {
  const id = normalizeActivityId(row?.activity_id);
  if (!id) return null;
  return {
    id,
    type: row?.type ?? null,
    icon: row?.icon ?? null,
    distance: Number(row?.distance) || 0,
    duration: Number(row?.duration) || 0,
    reward: Number(row?.reward) || 0,
    date: row?.date ?? null
  };
}

async function fetchMintedActivities(wallet) {
  return withSupabase(
    async () => {
      const { data, error } = await supabase
        .from("activities")
        .select("activity_id,type,icon,distance,duration,reward,date")
        .eq("wallet_address", wallet);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      return rows.map(mapStravaActivityRow).filter(Boolean);
    },
    [],
    "fetchMintedActivities"
  );
}

async function upsertMintedActivities(wallet, activities) {
  const payload = activities
    .map((activity) => {
      const id = normalizeActivityId(activity?.id);
      if (!id) return null;
      return {
        wallet_address: wallet,
        activity_id: id,
        type: activity?.type ?? null,
        icon: activity?.icon ?? null,
        distance: Number(activity?.distance) || 0,
        duration: Number(activity?.duration) || 0,
        reward: Number(activity?.reward) || 0,
        date: activity?.date ?? null
      };
    })
    .filter(Boolean);

  if (!payload.length) return;
  return withSupabase(
    async () => {
      const { error } = await supabase
        .from("activities")
        .upsert(payload, { onConflict: "activity_id" });
      if (error) throw error;
      return true;
    },
    false,
    "upsertMintedActivities"
  );
}

async function loadWalletActivities(wallet) {
  const dbActivities = await fetchMintedActivities(wallet);
  return Array.isArray(dbActivities) ? dbActivities : [];
}

function normalizeActivityId(activityId) {
  if (activityId === null || activityId === undefined) return null;
  const text = String(activityId).trim();
  return text.length ? text : null;
}

function createDefaultUserProfile() {
  return {
    level: 1,
    xp: 0,
    badges: {
      sonicBurst: false,
      hydroMaster: false,
      ironProtocol: false,
      zenFocus: false
    },
    stats: {
      gymSessions: 0,
      zenSessions: 0,
      weeklyBonuses: [],
      unlockedBadges: []
    }
  };
}

function normalizeProfile(row) {
  const defaults = createDefaultUserProfile();
  if (!row || typeof row !== "object") {
    return defaults;
  }
  const badges = {
    ...defaults.badges,
    ...(row.badges && typeof row.badges === "object" ? row.badges : {})
  };
  const stats = {
    ...defaults.stats,
    ...(row.stats && typeof row.stats === "object" ? row.stats : {})
  };
  if (!Array.isArray(stats.weeklyBonuses)) stats.weeklyBonuses = [];
  if (!Array.isArray(stats.unlockedBadges)) stats.unlockedBadges = [];
  return {
    level: Number(row.level) || defaults.level,
    xp: Number(row.xp) || 0,
    badges,
    stats
  };
}

async function fetchUserProfile(wallet) {
  return withSupabase(
    async () => {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("user_id,level,xp,badges,stats")
        .eq("user_id", wallet)
        .maybeSingle();
      if (error) throw error;
      return normalizeProfile(data);
    },
    createDefaultUserProfile(),
    "fetchUserProfile"
  );
}

async function upsertUserProfile(wallet, profile) {
  const payload = {
    user_id: wallet,
    level: Number(profile?.level) || 1,
    xp: Number(profile?.xp) || 0,
    badges: profile?.badges ?? createDefaultUserProfile().badges,
    stats: profile?.stats ?? createDefaultUserProfile().stats,
    updated_at: new Date().toISOString()
  };
  return withSupabase(
    async () => {
      const { error } = await supabase
        .from("user_profiles")
        .upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
      return true;
    },
    false,
    "upsertUserProfile"
  );
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

function computeXpMissing(balanceWei) {
  const tokenUnit = ethers.parseUnits("1", 18);
  const balanceTokens = balanceWei / tokenUnit;
  const xpPerLevel = 2000n;
  const nextLevelXp = (balanceTokens / xpPerLevel + 1n) * xpPerLevel;
  return nextLevelXp - balanceTokens;
}

function computeXpTotal(activities, stats) {
  const activityXp = activities.reduce((sum, activity) => {
    return sum + (Number(activity?.reward) || 0);
  }, 0);
  const bonuses = Array.isArray(stats?.weeklyBonuses)
    ? stats.weeklyBonuses
    : [];
  const bonusXp = bonuses.reduce((sum, bonus) => {
    return sum + (Number(bonus?.reward) || 0);
  }, 0);
  return activityXp + bonusXp;
}

async function fetchChallengesForWallet(wallet) {
  return withSupabase(
    async () => {
      const { data, error } = await supabase
        .from("challenges")
        .select(
          "id,creator_address,opponent_address,creator_progress,opponent_progress,status"
        )
        .or(`creator_address.eq.${wallet},opponent_address.eq.${wallet}`)
        .in("status", XP_CHALLENGE_STATUSES);
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    [],
    "fetchChallengesForWallet"
  );
}

function computeChallengeXp(wallet, challenges) {
  const target = normalizeWallet(wallet);
  if (!target) return 0;
  return (challenges || []).reduce((sum, challenge) => {
    const isCreator =
      normalizeWallet(challenge?.creator_address) === target;
    const isOpponent =
      normalizeWallet(challenge?.opponent_address) === target;
    if (!isCreator && !isOpponent) return sum;
    const progress = isCreator
      ? Number(challenge?.creator_progress) || 0
      : Number(challenge?.opponent_progress) || 0;
    return sum + progress;
  }, 0);
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
  return activity.type === "Run" && Number(activity.distance) >= 5000;
}

function isValidSwim(activity) {
  return activity.type === "Swim" && Number(activity.distance) >= 1000;
}

function isTrackedRun(activity) {
  return activity.type === "Run" && Number(activity.distance) >= MIN_TRACKED_DISTANCE_METERS;
}

function isTrackedSwim(activity) {
  return activity.type === "Swim" && Number(activity.distance) >= MIN_TRACKED_DISTANCE_METERS;
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

    if (isTrackedRun(activity)) counts.run += 1;
    if (isTrackedSwim(activity)) counts.swim += 1;
    if (isValidIron(activity)) counts.iron += 1;
    if (isValidMindfulness(activity)) counts.mindfulness += 1;
  }

  return counts;
}

function filterActivitiesByRange(activities, startAt, endAt) {
  if (!startAt || !endAt) return [];
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return [];
  const graceMs = Math.max(0, ARENA_START_GRACE_MINUTES) * 60 * 1000;
  const startWithGrace = Math.max(0, start - graceMs);
  return (activities || []).filter((activity) => {
    if (!activity) return false;
    const dateValue = getActivityDate(activity);
    if (!dateValue) return false;
    const timestamp = new Date(dateValue).getTime();
    if (Number.isNaN(timestamp)) return false;
    return timestamp >= startWithGrace && timestamp <= end;
  });
}

function checkPerfectWeekBonus(activities, stats) {
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

  const bonuses = Array.isArray(stats?.weeklyBonuses) ? stats.weeklyBonuses : [];
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
    if (stats && typeof stats === "object") {
      stats.weeklyBonuses = bonuses;
    }
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

    if (isTrackedRun(activity)) {
      totalRunDistanceMeters += distance;
    }

    if (isTrackedSwim(activity)) {
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

function checkBadgeUnlock(stats, profile) {
  const badges = {
    sonicBurst: false,
    hydroMaster: false,
    ironProtocol: false,
    zenFocus: false,
    ...(profile?.badges || {})
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

  if (profile) {
    profile.badges = badges;
  }
  return badges;
}

async function fetchBalance(address) {
  const contractAddress = getContractAddress();
  if (!contractAddress) {
    throw new Error("CONTRACT_ADDRESS non configurato");
  }
  const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
  const contract = new ethers.Contract(
    contractAddress,
    CONTRACT_ABI,
    provider
  );
  return contract.balanceOf(address);
}

async function refreshStravaAccessToken(wallet, refreshToken, athleteId) {
  if (!refreshToken) {
    throw new Error("Token Strava mancante");
  }
  const refreshResponse = await axios.post(
    "https://www.strava.com/oauth/token",
    new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }).toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );

  const accessToken = refreshResponse.data?.access_token;
  const newRefreshToken = refreshResponse.data?.refresh_token;
  const expiresAt = refreshResponse.data?.expires_at;
  if (!accessToken) {
    throw new Error("Token Strava non valido");
  }

  const expiresAtIso = Number.isFinite(expiresAt)
    ? new Date(expiresAt * 1000).toISOString()
    : null;
  await upsertStravaToken(wallet, {
    user_id: wallet,
    access_token: accessToken,
    refresh_token: newRefreshToken || refreshToken,
    expires_at: expiresAtIso,
    athlete_id: athleteId ?? null,
    updated_at: new Date().toISOString()
  });

  return accessToken;
}

async function getStravaAccessToken(wallet) {
  const tokens = await fetchStravaToken(wallet);
  if (!tokens || !tokens.refresh_token) {
    throw new Error("Token Strava mancante");
  }
  const expiresAt = tokens.expires_at
    ? new Date(tokens.expires_at).getTime()
    : 0;
  const hasValidAccess =
    tokens.access_token && expiresAt - Date.now() > 60000;
  if (hasValidAccess) {
    return tokens.access_token;
  }
  return refreshStravaAccessToken(wallet, tokens.refresh_token, tokens.athlete_id);
}

async function fetchActivitiesInRange(accessToken, startAt, endAt) {
  const activities = [];
  let page = 1;
  const after = Math.floor(new Date(startAt).getTime() / 1000);
  const before = Math.floor(new Date(endAt).getTime() / 1000);

  while (true) {
    let response;
    try {
      response = await axios.get(
        "https://www.strava.com/api/v3/athlete/activities",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          },
          params: {
            per_page: STRAVA_PER_PAGE,
            page,
            after,
            before
          }
        }
      );
    } catch (error) {
      if (error?.response?.status === 429) {
        throw buildStravaRateLimitError(error);
      }
      throw error;
    }

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

async function fetchRecentActivities(accessToken) {
  const activities = [];
  let page = 1;

  while (true) {
    let response;
    try {
      response = await axios.get(
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
    } catch (error) {
      if (error?.response?.status === 429) {
        throw buildStravaRateLimitError(error);
      }
      throw error;
    }

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
    const activityId = normalizeActivityId(activity?.id);
    if (!activity || !activityId || paidIds.has(activityId)) {
      continue;
    }

    const distanceMeters = activity.distance || 0;
    const elapsedTime = Number(activity.elapsed_time) || 0;
    let reward = 0;
    let mappedType = activity.type;
    let mappedIcon;

    if (isValidRun(activity)) {
      reward = 10;
    }

    if (isValidSwim(activity)) {
      reward = 20;
    }

    if (isValidIron(activity)) {
      reward = 10;
      mappedType = "Iron Protocol";
      mappedIcon = "🏋️";
    }

    if (isValidMindfulness(activity)) {
      reward = 10;
      mappedType = "Mindfulness";
      mappedIcon = "🧘";
    }

    if (reward === 0) {
      continue;
    }

    pendingActivities.push({
      id: activityId,
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

function normalizeArenaType(type) {
  const value = (type || "").toLowerCase();
  if (value.includes("nuoto") || value.includes("swim")) return "Nuoto";
  if (value.includes("palestra") || value.includes("gym")) return "Palestra";
  return "Corsa";
}

function computeArenaProgress(activities, type) {
  const arenaType = normalizeArenaType(type);
  if (!Array.isArray(activities)) return 0;

  if (arenaType === "Palestra") {
    return activities.reduce((count, activity) => {
      if (!activity) return count;
      if (ARENA_GYM_TYPES.has(activity.type)) {
        return count + 1;
      }
      return count;
    }, 0);
  }

  if (arenaType === "Nuoto") {
    const meters = activities.reduce((sum, activity) => {
      if (!activity || activity.type !== "Swim") return sum;
      const distance = Number(activity.distance) || 0;
      if (distance < MIN_TRACKED_DISTANCE_METERS) return sum;
      return sum + distance;
    }, 0);
    return meters;
  }

  const km = activities.reduce((sum, activity) => {
    if (!activity || activity.type !== "Run") return sum;
    const distance = Number(activity.distance) || 0;
    if (distance < MIN_TRACKED_DISTANCE_METERS) return sum;
    return sum + distance / 1000;
  }, 0);
  return km;
}

function isArenaTypeMatch(activityType, targetType) {
  if (!activityType) return false;
  const normalized = String(activityType).toLowerCase();
  const target = normalizeArenaType(targetType).toLowerCase();
  if (target === "palestra") {
    return ARENA_GYM_TYPES.has(activityType) ||
      ARENA_GYM_TYPES.has(String(activityType)) ||
      normalized.includes("workout") ||
      normalized.includes("crossfit") ||
      normalized.includes("weight");
  }
  if (target === "nuoto") {
    return normalized.includes("swim") || normalized.includes("nuoto");
  }
  return normalized.includes("run") || normalized.includes("corsa");
}

function getArenaActivityDelta(activity, arenaType) {
  if (!activity) return 0;
  const activityType = activity.type ?? "";
  if (!isArenaTypeMatch(activityType, arenaType)) return 0;
  const distance = Number(activity.distance) || 0;
  if (normalizeArenaType(arenaType) === "Palestra") {
    return 1;
  }
  if (distance < MIN_TRACKED_DISTANCE_METERS) {
    return 0;
  }
  if (normalizeArenaType(arenaType) === "Nuoto") {
    return distance;
  }
  return distance / 1000;
}

function computeArenaProgressWithFinish(activities, type, goal) {
  const arenaType = normalizeArenaType(type);
  const target = Number(goal) || 0;
  if (!Array.isArray(activities)) {
    return { progress: 0, finishedAt: null };
  }
  if (!Number.isFinite(target) || target <= 0) {
    return { progress: 0, finishedAt: null };
  }
  let progress = 0;
  let finishedAt = null;

  const sorted = activities
    .map((activity) => {
      const dateValue = getActivityDate(activity);
      return {
        activity,
        timestamp: dateValue ? new Date(dateValue).getTime() : 0
      };
    })
    .filter((item) => item.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const item of sorted) {
    const delta = getArenaActivityDelta(item.activity, arenaType);
    if (delta === 0) {
      continue;
    }
    progress += delta;
    if (progress >= target && !finishedAt) {
      finishedAt = new Date(item.timestamp).toISOString();
    }
  }

  return { progress, finishedAt };
}

function normalizeChallengeStatus(status) {
  const value = (status || "").toString().toLowerCase();
  if (!value) return "active";
  if (value.includes("matched")) return "matched";
  if (value.includes("resolved")) return "resolved";
  if (value.includes("claimed") || value.includes("claim")) return "claimed";
  if (value.includes("draw")) return "draw";
  return value;
}

function getChallengeWindow(challenge) {
  const startAt = challenge?.start_at || challenge?.created_at;
  const durationDays =
    Number(challenge?.duration_days) || ARENA_DEFAULT_DURATION_DAYS;
  let endAt = challenge?.end_at;
  if (!endAt && startAt) {
    const startDate = new Date(startAt);
    if (!Number.isNaN(startDate.getTime())) {
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + durationDays);
      endAt = endDate.toISOString();
    }
  }
  return { startAt, endAt, durationDays };
}

async function updateArenaProgress(challenge) {
  const creator = normalizeWallet(challenge.creator_address);
  const opponent = normalizeWallet(challenge.opponent_address);
  if (!creator || !opponent) {
    throw new Error("Wallet sfida non validi");
  }

  const cachedCreator = getCachedArenaProgress(
    creator,
    challenge.type,
    challenge.start_at,
    challenge.end_at
  );
  const cachedOpponent = getCachedArenaProgress(
    opponent,
    challenge.type,
    challenge.start_at,
    challenge.end_at
  );
  if (cachedCreator !== null && cachedOpponent !== null) {
    return {
      creator_progress: cachedCreator,
      opponent_progress: cachedOpponent,
      status: "cached"
    };
  }

  const { startAt, endAt } = getChallengeWindow(challenge);
  if (!startAt) {
    throw new Error("Intervallo sfida non valido");
  }

  const [creatorToken, opponentToken] = await Promise.all([
    fetchStravaToken(creator),
    fetchStravaToken(opponent)
  ]);
  const missingWallets = [];
  const [creatorActivitiesRaw, opponentActivitiesRaw] = await Promise.all([
    loadWalletActivities(creator),
    loadWalletActivities(opponent)
  ]);

  const creatorActivities = filterActivitiesByRange(
    creatorActivitiesRaw,
    startAt,
    endAt
  );
  const opponentActivities = filterActivitiesByRange(
    opponentActivitiesRaw,
    startAt,
    endAt
  );

  const creatorProgress = computeArenaProgress(
    creatorActivities,
    challenge.type
  );
  const opponentProgress = computeArenaProgress(
    opponentActivities,
    challenge.type
  );

  setCachedArenaProgress(
    creator,
    challenge.type,
    challenge.start_at,
    challenge.end_at,
    creatorProgress
  );
  setCachedArenaProgress(
    opponent,
    challenge.type,
    challenge.start_at,
    challenge.end_at,
    opponentProgress
  );

  if (!creatorToken?.refresh_token && creatorActivities.length === 0) {
    missingWallets.push(creator);
  }
  if (!opponentToken?.refresh_token && opponentActivities.length === 0) {
    missingWallets.push(opponent);
  }
  if (!ARENA_TEST_MODE) {
    if (missingWallets.length > 0) {
      return { status: "missing_tokens", missing_wallets: missingWallets };
    }
    if (!creatorToken?.refresh_token && !opponentToken?.refresh_token) {
      return { status: "missing_tokens", missing_wallets: missingWallets };
    }
  }

  const patch = {
    creator_progress: creatorProgress,
    opponent_progress: opponentProgress,
    start_at: startAt,
    end_at: endAt || challenge.end_at
  };

  await updateChallengeById(challenge.id, patch);

  return {
    creator_progress: creatorProgress,
    opponent_progress: opponentProgress,
    status: missingWallets.length > 0 ? "partial" : "updated",
    missing_wallets: missingWallets.length ? missingWallets : undefined
  };
}

async function resolveArenaChallenge(challenge) {
  const creator = normalizeWallet(challenge.creator_address);
  const opponent = normalizeWallet(challenge.opponent_address);
  if (!creator || !opponent) {
    throw new Error("Wallet sfida non validi");
  }

  const status = normalizeChallengeStatus(challenge.status);
  if (status !== "matched") {
    return { status };
  }

  const { startAt, endAt, durationDays } = getChallengeWindow(challenge);
  if (!startAt) {
    throw new Error("Intervallo sfida non valido");
  }
  const rangeEnd = endAt || new Date(Date.now() + durationDays * 86400000).toISOString();

  const cachedCreator = getCachedArenaProgress(
    creator,
    challenge.type,
    startAt,
    endAt
  );
  const cachedOpponent = getCachedArenaProgress(
    opponent,
    challenge.type,
    startAt,
    endAt
  );

  if (cachedCreator !== null && cachedOpponent !== null) {
    return {
      creator_progress: cachedCreator,
      opponent_progress: cachedOpponent,
      status: "cached"
    };
  }

  const [creatorToken, opponentToken] = await Promise.all([
    fetchStravaToken(creator),
    fetchStravaToken(opponent)
  ]);
  const missingWallets = [];
  const [creatorActivitiesRaw, opponentActivitiesRaw] = await Promise.all([
    loadWalletActivities(creator),
    loadWalletActivities(opponent)
  ]);

  const creatorActivities = filterActivitiesByRange(
    creatorActivitiesRaw,
    startAt,
    rangeEnd
  );
  const opponentActivities = filterActivitiesByRange(
    opponentActivitiesRaw,
    startAt,
    rangeEnd
  );

  const creatorResult = computeArenaProgressWithFinish(
    creatorActivities,
    challenge.type,
    challenge.goal
  );
  const opponentResult = computeArenaProgressWithFinish(
    opponentActivities,
    challenge.type,
    challenge.goal
  );
  const creatorProgress = creatorResult.progress;
  const opponentProgress = opponentResult.progress;

  if (!creatorToken?.refresh_token && creatorActivities.length === 0) {
    missingWallets.push(creator);
  }
  if (!opponentToken?.refresh_token && opponentActivities.length === 0) {
    missingWallets.push(opponent);
  }
  if (!ARENA_TEST_MODE) {
    if (missingWallets.length > 0) {
      return { status: "missing_tokens", missing_wallets: missingWallets };
    }
    if (!creatorToken?.refresh_token && !opponentToken?.refresh_token) {
      return { status: "missing_tokens", missing_wallets: missingWallets };
    }
  }

  let statusResult = missingWallets.length > 0 ? "partial" : "updated";
  let winnerAddress = null;
  const creatorFinish = creatorResult.finishedAt
    ? new Date(creatorResult.finishedAt).getTime()
    : null;
  const opponentFinish = opponentResult.finishedAt
    ? new Date(opponentResult.finishedAt).getTime()
    : null;
  if (creatorFinish || opponentFinish) {
    if (creatorFinish && opponentFinish) {
      if (creatorFinish === opponentFinish) {
        statusResult = "draw";
      } else {
        statusResult = "resolved";
        winnerAddress = creatorFinish < opponentFinish ? creator : opponent;
      }
    } else {
      statusResult = "resolved";
      winnerAddress = creatorFinish ? creator : opponent;
    }
  }

  const patch = {
    creator_progress: creatorProgress,
    opponent_progress: opponentProgress,
    start_at: startAt,
    end_at: endAt || rangeEnd
  };
  if (statusResult === "resolved" || statusResult === "draw") {
    patch.status = statusResult;
    patch.winner_address = winnerAddress;
    patch.resolved_at = new Date().toISOString();
  }

  await updateChallengeById(challenge.id, patch);

  return {
    creator_progress: creatorProgress,
    opponent_progress: opponentProgress,
    status: statusResult,
    winner_address: winnerAddress,
    missing_wallets: missingWallets.length ? missingWallets : undefined
  };
}

async function mintArenaReward(amount, recipient) {
  const normalized = Number(amount);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error("Importo non valido");
  }
  const contractAddress = getContractAddress();
  if (!contractAddress) {
    throw new Error("CONTRACT_ADDRESS non configurato");
  }
  const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
  const wallet = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY, provider);
  const contract = new ethers.Contract(
    contractAddress,
    CONTRACT_ABI,
    wallet
  );
  const minterRole = await contract.MINTER_ROLE();
  const isMinter = await contract.hasRole(minterRole, wallet.address);
  if (!isMinter) {
    throw new Error("Server non autorizzato a mintare (MINTER_ROLE mancante)");
  }
  const rounded = Math.round(normalized * 10000) / 10000;
  const tx = await contract.mint(
    recipient,
    ethers.parseUnits(rounded.toString(), 18),
    { gasLimit: 200000n }
  );
  return tx.wait();
}

async function mintReward(totalReward, recipient) {
  const contractAddress = getContractAddress();
  if (!contractAddress) {
    throw new Error("CONTRACT_ADDRESS non configurato");
  }
  const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
  const wallet = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY, provider);
  const contract = new ethers.Contract(
    contractAddress,
    CONTRACT_ABI,
    wallet
  );
  const minterRole = await contract.MINTER_ROLE();
  const isMinter = await contract.hasRole(minterRole, wallet.address);
  if (!isMinter) {
    throw new Error("Server non autorizzato a mintare (MINTER_ROLE mancante)");
  }

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
  deleteStravaToken(wallet)
    .then((removed) => {
      return res.json({ status: removed ? "disconnected" : "not_connected" });
    })
    .catch((err) => {
      console.error("Strava disconnect error:", err);
      return res.status(500).json({ status: "error", message: "Errore interno" });
    });
});

app.get("/activities", (req, res) => {
  const wallet = normalizeWallet(req.query.wallet);
  if (!wallet) {
    return res.status(400).json({ error: "Wallet non valido" });
  }
  loadWalletActivities(wallet)
    .then((activities) => res.json(activities))
    .catch((err) => {
      console.error("Activities error:", err);
      return res.status(500).json({ error: "Errore interno" });
    });
});

app.get("/user/stats", async (req, res) => {
  try {
    const wallet = normalizeWallet(req.query.wallet);
    if (!wallet) {
      return res.status(400).json({ error: "Wallet non valido" });
    }
    const balanceWei = await fetchBalance(wallet);
    const rank = computeRank(balanceWei);
    const activities = await loadWalletActivities(wallet);
    const challengeRows = await fetchChallengesForWallet(wallet);
    const profile = await fetchUserProfile(wallet);
    const unlockedBadges = Array.isArray(profile.stats?.unlockedBadges)
      ? profile.stats.unlockedBadges
      : [];
    const badges = profile.badges && typeof profile.badges === "object" ? profile.badges : {};

    const xpFromChallenges = computeChallengeXp(wallet, challengeRows);
    const xpTotal =
      xpFromChallenges > 0 ? xpFromChallenges : computeXpTotal(activities, profile.stats);
    const currentLevel = Number(profile.level) || 1;
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
        profile.stats.unlockedBadges = unlockedBadges;
      }
    }

    profile.xp = xpTotal;
    await upsertUserProfile(wallet, profile);

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

    const tokens = await fetchStravaToken(wallet);
    if (!tokens || !tokens.refresh_token) {
      return res.status(400).json({
        status: "needs_auth",
        message: "Autorizzazione Strava mancante"
      });
    }
    if (tokens.athlete_id) {
      const boundWallet = await fetchWalletByAthlete(tokens.athlete_id);
      if (boundWallet && boundWallet !== wallet) {
        return res.status(409).json({
          status: "wallet_conflict",
          message: `Questo account Strava è già collegato a un altro wallet (${boundWallet})`
        });
      }
    }

    const accessToken = await getStravaAccessToken(wallet);

    const activities = await fetchRecentActivities(accessToken);
    const walletActivities = await loadWalletActivities(wallet);
    const paidIds = new Set(
      walletActivities
        .map((activity) => normalizeActivityId(activity?.id))
        .filter(Boolean)
    );

    const profile = await fetchUserProfile(wallet);
    const perfectWeek = checkPerfectWeekBonus(activities, profile.stats);

    const { pendingActivities, totalReward } = evaluateActivities(
      activities,
      paidIds
    );
    const totalRewardWithBonus = totalReward + perfectWeek.bonusReward;
    if (totalRewardWithBonus === 0) {
      const stats = computeBadgeStats(activities, profile.stats);
      profile.stats = { ...profile.stats, ...stats };
      checkBadgeUnlock(stats, profile);
      profile.xp = computeXpTotal(activities, profile.stats);
      await upsertUserProfile(wallet, profile);
      return res.json({
        status: "no_new_activities",
        totalReward: 0,
        activities: walletActivities,
        perfectWeekProgress: perfectWeek.completedCount
      });
    }

    await mintReward(totalRewardWithBonus, wallet);

    const updatedActivities = walletActivities.concat(pendingActivities);
    await upsertMintedActivities(wallet, pendingActivities);

    const stats = computeBadgeStats(activities, profile.stats);
    profile.stats = { ...profile.stats, ...stats };
    checkBadgeUnlock(stats, profile);
    profile.xp = computeXpTotal(activities, profile.stats);
    await upsertUserProfile(wallet, profile);

    return res.json({
      status: "minted",
      totalReward: totalRewardWithBonus,
      perfectWeekBonus: perfectWeek.bonusReward,
      perfectWeekProgress: perfectWeek.completedCount,
      validCount: pendingActivities.length,
      activities: updatedActivities
    });
  } catch (err) {
    if (isStravaRateLimitError(err)) {
      return res.status(429).json({
        status: "rate_limited",
        retryAfter: err.retryAfter || 60,
        message: "Limite Strava raggiunto. Riprova tra poco."
      });
    }
    console.error("Strava sync error:", err);
    return res.status(500).json({ status: "error", message: "Errore interno" });
  }
});

app.post("/user/level-up", async (req, res) => {
  try {
    const wallet = normalizeWallet(req.body?.walletAddress || req.query?.wallet);
    if (!wallet) {
      return res.status(400).json({ error: "Wallet non valido" });
    }
    const activities = await loadWalletActivities(wallet);
    const challengeRows = await fetchChallengesForWallet(wallet);
    const profile = await fetchUserProfile(wallet);
    const xpFromChallenges = computeChallengeXp(wallet, challengeRows);
    const xpTotal =
      xpFromChallenges > 0 ? xpFromChallenges : computeXpTotal(activities, profile.stats);
    const currentLevel = Number(profile.level) || 1;
    const baseXp = Math.max(0, (currentLevel - 1) * LEVEL_XP);
    const xpCurrent = Math.max(0, xpTotal - baseXp);
    if (xpCurrent < LEVEL_XP) {
      return res.status(400).json({ error: "XP insufficienti" });
    }
    profile.level = currentLevel + 1;
    profile.xp = xpTotal;
    await upsertUserProfile(wallet, profile);
    return res.json({ level: profile.level });
  } catch (err) {
    console.error("Level up error:", err);
    return res.status(500).json({ error: "Errore interno" });
  }
});

app.post("/arena/resolve", async (req, res) => {
  try {
    const challengeId = req.body?.challengeId;
    if (!challengeId) {
      return res.status(400).json({ error: "ChallengeId mancante" });
    }
    const challenge = await fetchChallengeById(challengeId);
    if (!challenge) {
      return res.status(404).json({ error: "Sfida non trovata" });
    }
    if (challenge.status !== "matched") {
      return res.json({ status: challenge.status });
    }
    const result = await resolveArenaChallenge(challenge);
    if (result?.status === "missing_tokens" || result?.status === "rate_limited") {
      return res.json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error("Arena resolve error:", err);
    const message = err?.message || "Errore interno";
    return res.status(500).json({ error: message });
  }
});

app.post("/arena/progress", async (req, res) => {
  try {
    const challengeId = req.body?.challengeId;
    if (!challengeId) {
      return res.status(400).json({ error: "ChallengeId mancante" });
    }
    const challenge = await fetchChallengeById(challengeId);
    if (!challenge) {
      return res.status(404).json({ error: "Sfida non trovata" });
    }
    if (challenge.status !== "matched") {
      return res.json({ status: challenge.status });
    }
    const progress = await updateArenaProgress(challenge);
    if (
      progress?.status === "missing_tokens" ||
      progress?.status === "rate_limited"
    ) {
      return res.json(progress);
    }
    return res.json({ status: "updated", ...progress });
  } catch (err) {
    console.error("Arena progress error:", err);
    const message = err?.message || "Errore interno";
    return res.status(500).json({ error: message });
  }
});

app.post("/arena/claim", async (req, res) => {
  try {
    const challengeId = req.body?.challengeId;
    const wallet = normalizeWallet(req.body?.walletAddress || req.query?.wallet);
    if (!challengeId) {
      return res.status(400).json({ error: "ChallengeId mancante" });
    }
    if (!wallet) {
      return res.status(400).json({ error: "Wallet non valido" });
    }

    let challenge = await fetchChallengeById(challengeId);
    if (!challenge) {
      return res.status(404).json({ error: "Sfida non trovata" });
    }

    const { endAt } = getChallengeWindow(challenge);
    if (
      (challenge.status === "matched" || challenge.status === "active") &&
      endAt &&
      new Date(endAt).getTime() <= Date.now()
    ) {
      const resolved = await resolveArenaChallenge(challenge);
      challenge = { ...challenge, ...resolved, status: resolved.status };
    }

    const status = challenge.status;
    if (status !== "resolved" && status !== "draw") {
      return res.status(409).json({ error: "Sfida non risolta" });
    }

    const creator = normalizeWallet(challenge.creator_address);
    const opponent = normalizeWallet(challenge.opponent_address);
    if (!creator || !opponent) {
      return res.status(400).json({ error: "Wallet sfida non validi" });
    }

    const isCreator = wallet === creator;
    const isOpponent = wallet === opponent;
    const creatorClaimed = Boolean(challenge.creator_claimed);
    const opponentClaimed = Boolean(challenge.opponent_claimed);

    if (status === "resolved") {
      const winner = normalizeWallet(challenge.winner_address);
      if (!winner || winner !== wallet) {
        return res.status(403).json({ error: "Non sei il vincitore" });
      }
      if ((isCreator && creatorClaimed) || (isOpponent && opponentClaimed)) {
        return res.status(409).json({ error: "Premio gia riscattato" });
      }
    }

    if (status === "draw") {
      if (!isCreator && !isOpponent) {
        return res.status(403).json({ error: "Non sei nella sfida" });
      }
      if ((isCreator && creatorClaimed) || (isOpponent && opponentClaimed)) {
        return res.status(409).json({ error: "Rimborso gia riscattato" });
      }
    }

    const stakeValue = Number(challenge.stake) || 0;
    if (!Number.isFinite(stakeValue) || stakeValue <= 0) {
      return res.status(400).json({ error: "Stake non valido" });
    }

    const payout =
      status === "draw"
        ? stakeValue * ARENA_DRAW_REFUND_RATE
        : stakeValue * 2;

    const receipt = await mintArenaReward(payout, wallet);

    const patch = {};
    if (isCreator) {
      patch.creator_claimed = true;
    }
    if (isOpponent) {
      patch.opponent_claimed = true;
    }
    if (status === "resolved") {
      patch.status = "claimed";
    }
    if (status === "draw") {
      const creatorDone = isCreator ? true : creatorClaimed;
      const opponentDone = isOpponent ? true : opponentClaimed;
      if (creatorDone && opponentDone) {
        patch.status = "claimed";
      }
    }

    await updateChallengeById(challenge.id, patch);

    return res.json({
      status: "claimed",
      payout,
      txHash: receipt?.hash || receipt?.transactionHash || null
    });
  } catch (err) {
    console.error("Arena claim error:", err);
    const message = err?.message || "Errore interno";
    return res.status(500).json({ error: message });
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
    const expiresAt = tokenResponse.data?.expires_at;
    const athleteId = tokenResponse.data?.athlete?.id;
    if (!accessToken) {
      return res.status(502).json({ error: "No access token from Strava" });
    }
    if (refreshToken) {
      if (athleteId) {
        const boundWallet = await fetchWalletByAthlete(athleteId);
        if (boundWallet && boundWallet !== wallet) {
          return res.redirect(
            `${FRONTEND_URL}/?strava_error=wallet_conflict&wallet=${boundWallet}`
          );
        }
      }
      const expiresAtIso = Number.isFinite(expiresAt)
        ? new Date(expiresAt * 1000).toISOString()
        : null;
      await upsertStravaToken(wallet, {
        user_id: wallet,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAtIso,
        athlete_id: athleteId ?? null,
        updated_at: new Date().toISOString()
      });
    }

    const activities = await fetchRecentActivities(accessToken);
    const walletActivities = await loadWalletActivities(wallet);
    const paidIds = new Set(
      walletActivities
        .map((activity) => normalizeActivityId(activity?.id))
        .filter(Boolean)
    );

    const profile = await fetchUserProfile(wallet);
    const perfectWeek = checkPerfectWeekBonus(activities, profile.stats);

    const { pendingActivities, totalReward } = evaluateActivities(
      activities,
      paidIds
    );
    const totalRewardWithBonus = totalReward + perfectWeek.bonusReward;

    if (totalRewardWithBonus === 0) {
      const stats = computeBadgeStats(activities, profile.stats);
      profile.stats = { ...profile.stats, ...stats };
      checkBadgeUnlock(stats, profile);
      profile.xp = computeXpTotal(activities, profile.stats);
      await upsertUserProfile(wallet, profile);
      return res.redirect(`${FRONTEND_URL}/?no_new_activities=true`);
    }

    await mintReward(totalRewardWithBonus, wallet);

    const updatedActivities = walletActivities.concat(pendingActivities);
    await upsertMintedActivities(wallet, pendingActivities);

    const stats = computeBadgeStats(activities, profile.stats);
    profile.stats = { ...profile.stats, ...stats };
    checkBadgeUnlock(stats, profile);
    profile.xp = computeXpTotal(activities, profile.stats);
    await upsertUserProfile(wallet, profile);

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
