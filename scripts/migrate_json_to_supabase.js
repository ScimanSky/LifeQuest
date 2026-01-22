/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const dotenv = require("dotenv");

dotenv.config();
dotenv.config({ path: path.join(__dirname, "..", "backend", ".env") });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const DATABASE_PATH = path.join(__dirname, "..", "backend", "database.json");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

if (!fs.existsSync(DATABASE_PATH)) {
  console.error(`database.json not found at ${DATABASE_PATH}`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function normalizeProfile(entry) {
  const badges = entry?.badges && typeof entry.badges === "object"
    ? entry.badges
    : {};
  const stats = entry?.stats && typeof entry.stats === "object"
    ? entry.stats
    : {};

  return {
    level: Number(entry?.level) || 1,
    xp: Number(entry?.xp) || 0,
    badges,
    stats: {
      ...stats,
      weeklyBonuses: Array.isArray(entry?.weeklyBonuses)
        ? entry.weeklyBonuses
        : [],
      unlockedBadges: Array.isArray(entry?.unlockedBadges)
        ? entry.unlockedBadges
        : []
    }
  };
}

async function main() {
  const raw = fs.readFileSync(DATABASE_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const wallets = parsed?.wallets && typeof parsed.wallets === "object"
    ? parsed.wallets
    : {};

  const entries = Object.entries(wallets);
  if (entries.length === 0) {
    console.log("Nessun wallet da migrare.");
    return;
  }

  for (const [userId, entry] of entries) {
    if (!userId || userId === "__legacy") continue;
    const profile = normalizeProfile(entry);
    const payload = {
      user_id: userId,
      level: profile.level,
      xp: profile.xp,
      badges: profile.badges,
      stats: profile.stats,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from("user_profiles")
      .upsert(payload, { onConflict: "user_id" });

    if (error) {
      console.error(`❌ Errore migrazione ${userId}:`, error.message);
    } else {
      console.log(`✅ Migrato ${userId}`);
    }
  }
}

main().catch((err) => {
  console.error("Errore migrazione:", err);
  process.exit(1);
});
