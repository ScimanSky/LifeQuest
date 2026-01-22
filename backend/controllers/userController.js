const { ethers } = require("ethers");
const {
  LEVEL_XP,
  XP_CHALLENGE_STATUSES,
  INVESTOR_TARGET,
  INVESTOR_XP_BONUS
} = require("../config/constants");
const { normalizeWallet } = require("../services/utils");
const { loadWalletActivities, fetchChallengesForWallet, fetchUserProfile, upsertUserProfile } = require("../services/supabaseService");
const { fetchBalance } = require("../services/blockchainService");
const { computeRank, computeXpTotal, computeChallengeXp } = require("../services/gameLogic");

function computeInvestorProgress(challenges) {
  return (challenges || []).reduce((sum, row) => {
    if (row?.status === "cancelled") return sum;
    const stakeValue = Number(row?.stake);
    if (!Number.isFinite(stakeValue)) return sum;
    return sum + stakeValue;
  }, 0);
}

async function getActivities(req, res) {
  const wallet = normalizeWallet(req.query.wallet);
  if (!wallet) {
    return res.status(400).json({ error: "Wallet non valido" });
  }
  try {
    const activities = await loadWalletActivities(wallet);
    return res.json(activities);
  } catch (err) {
    console.error("Activities error:", err);
    return res.status(500).json({ error: "Errore interno" });
  }
}

async function getUserStats(req, res) {
  try {
    const wallet = normalizeWallet(req.query.wallet);
    if (!wallet) {
      return res.status(400).json({ error: "Wallet non valido" });
    }
    const balanceWei = await fetchBalance(wallet);
    const rank = computeRank(balanceWei);
    const activities = await loadWalletActivities(wallet);
    const allChallenges = await fetchChallengesForWallet(wallet);
    const challengeRows = Array.isArray(allChallenges)
      ? allChallenges.filter((row) =>
          XP_CHALLENGE_STATUSES.includes(String(row?.status || "").toLowerCase())
        )
      : [];
    const profile = await fetchUserProfile(wallet);
    const investorProgress = computeInvestorProgress(allChallenges);
    const investorUnlocked = investorProgress >= INVESTOR_TARGET;

    const unlockedBadges = Array.isArray(profile.stats?.unlockedBadges)
      ? profile.stats.unlockedBadges
      : [];
    let badges = profile.badges && typeof profile.badges === "object" ? profile.badges : {};

    const xpFromChallenges = computeChallengeXp(wallet, challengeRows);
    const baseXp =
      xpFromChallenges > 0 ? xpFromChallenges : computeXpTotal(activities, profile.stats);
    const xpTotal = baseXp + (investorUnlocked ? INVESTOR_XP_BONUS : 0);
    const currentLevel = Number(profile.level) || 1;
    const baseXpThreshold = Math.max(0, (currentLevel - 1) * LEVEL_XP);
    const xpCurrentRaw = Math.max(0, xpTotal - baseXpThreshold);
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

    if (investorUnlocked) {
      profile.badges = {
        ...(profile.badges || {}),
        bet: true
      };
      badges = profile.badges;
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
}

async function levelUp(req, res) {
  try {
    const wallet = normalizeWallet(req.body?.walletAddress || req.query?.wallet);
    if (!wallet) {
      return res.status(400).json({ error: "Wallet non valido" });
    }
    const activities = await loadWalletActivities(wallet);
    const allChallenges = await fetchChallengesForWallet(wallet);
    const challengeRows = Array.isArray(allChallenges)
      ? allChallenges.filter((row) =>
          XP_CHALLENGE_STATUSES.includes(String(row?.status || "").toLowerCase())
        )
      : [];
    const profile = await fetchUserProfile(wallet);
    const investorProgress = computeInvestorProgress(allChallenges);
    const investorUnlocked = investorProgress >= INVESTOR_TARGET;
    const xpFromChallenges = computeChallengeXp(wallet, challengeRows);
    const baseXp =
      xpFromChallenges > 0 ? xpFromChallenges : computeXpTotal(activities, profile.stats);
    const xpTotal = baseXp + (investorUnlocked ? INVESTOR_XP_BONUS : 0);
    const currentLevel = Number(profile.level) || 1;
    const baseXpThreshold = Math.max(0, (currentLevel - 1) * LEVEL_XP);
    const xpCurrent = Math.max(0, xpTotal - baseXpThreshold);
    if (xpCurrent < LEVEL_XP) {
      return res.status(400).json({ error: "XP insufficienti" });
    }
    if (investorUnlocked) {
      profile.badges = {
        ...(profile.badges || {}),
        bet: true
      };
    }
    profile.level = currentLevel + 1;
    profile.xp = xpTotal;
    await upsertUserProfile(wallet, profile);
    return res.json({ level: profile.level });
  } catch (err) {
    console.error("Level up error:", err);
    return res.status(500).json({ error: "Errore interno" });
  }
}

module.exports = {
  getActivities,
  getUserStats,
  levelUp
};
