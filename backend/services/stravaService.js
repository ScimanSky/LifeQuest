const axios = require("axios");
const {
  STRAVA_AFTER_TIMESTAMP,
  STRAVA_PER_PAGE
} = require("../config/constants");
const {
  STRAVA_REDIRECT_URI,
  FRONTEND_URL
} = require("../config/env");
const {
  fetchStravaToken,
  fetchWalletByAthlete,
  upsertStravaToken
} = require("./supabaseService");

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

async function exchangeStravaToken(code, wallet) {
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
    throw new Error("No access token from Strava");
  }

  if (refreshToken) {
    if (athleteId) {
      const boundWallet = await fetchWalletByAthlete(athleteId);
      if (boundWallet && boundWallet !== wallet) {
        return {
          accessToken,
          redirect: `${FRONTEND_URL}/?strava_error=wallet_conflict&wallet=${boundWallet}`
        };
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

  return { accessToken };
}

module.exports = {
  buildStravaAuthUrl,
  buildStravaRateLimitError,
  isStravaRateLimitError,
  getStravaAccessToken,
  fetchActivitiesInRange,
  fetchRecentActivities,
  exchangeStravaToken
};
