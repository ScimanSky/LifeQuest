const { ethers } = require("ethers");
const { LEVEL_XP, XP_CHALLENGE_STATUSES } = require("../config/constants");
const { normalizeWallet } = require("../services/utils");
const { loadWalletActivities, fetchChallengesForWallet, fetchUserProfile, upsertUserProfile } = require("../services/supabaseService");
const { fetchBalance } = require("../services/blockchainService");
const { computeRank, computeXpTotal, computeChallengeXp } = require("../services/gameLogic");

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
    const challengeRows = await fetchChallengesForWallet(wallet, XP_CHALLENGE_STATUSES);
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
}

async function levelUp(req, res) {
  try {
    const wallet = normalizeWallet(req.body?.walletAddress || req.query?.wallet);
    if (!wallet) {
      return res.status(400).json({ error: "Wallet non valido" });
    }
    const activities = await loadWalletActivities(wallet);
    const challengeRows = await fetchChallengesForWallet(wallet, XP_CHALLENGE_STATUSES);
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
}

module.exports = {
  getActivities,
  getUserStats,
  levelUp
};
