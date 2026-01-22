const { normalizeWallet, normalizeActivityId } = require("../services/utils");
const { fetchStravaToken, fetchWalletByAthlete, upsertMintedActivities, loadWalletActivities, fetchUserProfile, upsertUserProfile } = require("../services/supabaseService");
const { mintReward } = require("../services/blockchainService");
const {
  buildStravaAuthUrl,
  getStravaAccessToken,
  fetchRecentActivities,
  isStravaRateLimitError,
  exchangeStravaToken
} = require("../services/stravaService");
const { checkPerfectWeekBonus, computeBadgeStats, checkBadgeUnlock, computeXpTotal, evaluateActivities } = require("../services/gameLogic");
const { FRONTEND_URL } = require("../config/env");

async function stravaAuth(req, res) {
  const wallet = normalizeWallet(req.query.wallet);
  if (!wallet) {
    return res.status(400).json({ error: "Wallet non valido" });
  }
  const url = buildStravaAuthUrl(wallet);
  return res.redirect(url);
}

async function stravaDisconnect(req, res) {
  const wallet = normalizeWallet(req.body?.walletAddress || req.query?.wallet);
  if (!wallet) {
    return res.status(400).json({ status: "error", message: "Wallet non valido" });
  }
  const { deleteStravaToken } = require("../services/supabaseService");
  deleteStravaToken(wallet)
    .then((removed) => {
      return res.json({ status: removed ? "disconnected" : "not_connected" });
    })
    .catch((err) => {
      console.error("Strava disconnect error:", err);
      return res.status(500).json({ status: "error", message: "Errore interno" });
    });
}

async function stravaSync(req, res) {
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
}

async function stravaCallback(req, res) {
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

    const exchange = await exchangeStravaToken(code, wallet);
    if (exchange.redirect) {
      return res.redirect(exchange.redirect);
    }

    const accessToken = exchange.accessToken;
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
}

module.exports = {
  stravaAuth,
  stravaDisconnect,
  stravaSync,
  stravaCallback
};
