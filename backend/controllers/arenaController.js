const { normalizeWallet } = require("../services/utils");
const { fetchChallengeById, updateChallengeById } = require("../services/supabaseService");
const { updateArenaProgress, resolveArenaChallenge, getChallengeWindow, ARENA_DRAW_REFUND_RATE } = require("../services/arenaService");
const { mintArenaReward } = require("../services/blockchainService");

async function resolveChallenge(req, res) {
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
}

async function refreshProgress(req, res) {
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
      progress?.status === "partial" ||
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
}

async function claimReward(req, res) {
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
}

module.exports = {
  resolveChallenge,
  refreshProgress,
  claimReward
};
