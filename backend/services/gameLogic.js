const { ethers } = require("ethers");
const {
  WEEKLY_GOALS,
  LEVEL_XP,
  IRON_PROTOCOL_TYPES,
  MINDFULNESS_TYPES,
  MINDFULNESS_MIN_SECONDS,
  MIN_TRACKED_DISTANCE_METERS,
  RUN_REWARD_DISTANCE_METERS,
  SWIM_REWARD_DISTANCE_METERS,
  RUN_REWARD,
  SWIM_REWARD,
  IRON_REWARD,
  MINDFULNESS_REWARD
} = require("../config/constants");
const { normalizeWallet } = require("./utils");

function createDefaultUserProfile() {
  return {
    level: 1,
    xp: 0,
    badges: {
      sonicBurst: false,
      hydroMaster: false,
      ironProtocol: false,
      zenFocus: false,
      bet: false
    },
    stats: {
      gymSessions: 0,
      zenSessions: 0,
      weeklyBonuses: [],
      unlockedBadges: []
    }
  };
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
  const xpPerLevel = BigInt(LEVEL_XP);
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
  return activity.type === "Run" && Number(activity.distance) >= RUN_REWARD_DISTANCE_METERS;
}

function isValidSwim(activity) {
  return activity.type === "Swim" && Number(activity.distance) >= SWIM_REWARD_DISTANCE_METERS;
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

function evaluateActivities(activities, paidIds) {
  const pendingActivities = [];
  let totalReward = 0;

  for (const activity of activities) {
    const activityId = String(activity?.id ?? "").trim();
    if (!activity || !activityId || paidIds.has(activityId)) {
      continue;
    }

    const distanceMeters = activity.distance || 0;
    const elapsedTime = Number(activity.elapsed_time) || 0;
    let reward = 0;
    let mappedType = activity.type;
    let mappedIcon;

    if (isValidRun(activity)) {
      reward = RUN_REWARD;
    }

    if (isValidSwim(activity)) {
      reward = SWIM_REWARD;
    }

    if (isValidIron(activity)) {
      reward = IRON_REWARD;
      mappedType = "Iron Protocol";
      mappedIcon = "🏋️";
    }

    if (isValidMindfulness(activity)) {
      reward = MINDFULNESS_REWARD;
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

module.exports = {
  createDefaultUserProfile,
  computeRank,
  computeXpMissing,
  computeXpTotal,
  getWeekBounds,
  isValidRun,
  isValidSwim,
  isTrackedRun,
  isTrackedSwim,
  isValidIron,
  isValidMindfulness,
  getActivityDate,
  computeWeeklyGoalCounts,
  checkPerfectWeekBonus,
  computeBadgeStats,
  checkBadgeUnlock,
  evaluateActivities,
  computeChallengeXp
};
