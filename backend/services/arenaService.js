const {
  ARENA_DEFAULT_DURATION_DAYS,
  ARENA_DRAW_REFUND_RATE,
  ARENA_PROGRESS_CACHE_MS,
  ARENA_GYM_TYPES,
  MIN_TRACKED_DISTANCE_METERS
} = require("../config/constants");
const { ARENA_TEST_MODE, ARENA_START_GRACE_MINUTES } = require("../config/env");
const { fetchStravaToken, loadWalletActivities, updateChallengeById } = require("./supabaseService");
const { getActivityDate } = require("./gameLogic");
const { normalizeWallet } = require("./utils");

const arenaProgressCache = new Map();

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

function normalizeArenaType(type) {
  const value = (type || "").toLowerCase();
  if (value.includes("nuoto") || value.includes("swim")) return "Nuoto";
  if (value.includes("palestra") || value.includes("gym")) return "Palestra";
  return "Corsa";
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

  if ((challenge.status || "").toLowerCase() !== "matched") {
    return { status: challenge.status };
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

  let status = missingWallets.length > 0 ? "partial" : "updated";
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
        status = "draw";
      } else {
        status = "resolved";
        winnerAddress = creatorFinish < opponentFinish ? creator : opponent;
      }
    } else {
      status = "resolved";
      winnerAddress = creatorFinish ? creator : opponent;
    }
  }

  const patch = {
    creator_progress: creatorProgress,
    opponent_progress: opponentProgress,
    start_at: startAt,
    end_at: endAt || rangeEnd
  };
  if (status === "resolved" || status === "draw") {
    patch.status = status;
    patch.winner_address = winnerAddress;
    patch.resolved_at = new Date().toISOString();
  }

  await updateChallengeById(challenge.id, patch);

  return {
    creator_progress: creatorProgress,
    opponent_progress: opponentProgress,
    status,
    winner_address: winnerAddress,
    missing_wallets: missingWallets.length ? missingWallets : undefined
  };
}

module.exports = {
  normalizeArenaType,
  computeArenaProgress,
  computeArenaProgressWithFinish,
  getChallengeWindow,
  updateArenaProgress,
  resolveArenaChallenge,
  ARENA_DRAW_REFUND_RATE
};
