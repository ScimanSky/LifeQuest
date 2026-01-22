const { createClient } = require("@supabase/supabase-js");
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
} = require("../config/env");
const { normalizeActivityId } = require("./utils");
const { createDefaultUserProfile } = require("./gameLogic");

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      })
    : null;

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

async function fetchChallengesForWallet(wallet, statusList) {
  return withSupabase(
    async () => {
      let query = supabase
        .from("challenges")
        .select(
          "id,creator_address,opponent_address,creator_progress,opponent_progress,status,stake"
        )
        .or(`creator_address.eq.${wallet},opponent_address.eq.${wallet}`);
      if (Array.isArray(statusList) && statusList.length) {
        query = query.in("status", statusList);
      }
      const { data, error } = await query;
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    [],
    "fetchChallengesForWallet"
  );
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

module.exports = {
  fetchChallengeById,
  updateChallengeById,
  fetchStravaToken,
  fetchWalletByAthlete,
  upsertStravaToken,
  deleteStravaToken,
  fetchMintedActivities,
  upsertMintedActivities,
  loadWalletActivities,
  fetchChallengesForWallet,
  fetchUserProfile,
  upsertUserProfile
};
