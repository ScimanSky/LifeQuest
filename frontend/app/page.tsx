"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Toaster, toast } from "react-hot-toast";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt
} from "wagmi";
import { formatEther, parseAbi, parseEther, type Address } from "viem";
import {
  Trophy,
  Activity,
  Droplet,
  Dumbbell,
  Leaf,
  Zap,
  Lock,
  CheckCircle,
  UserRound,
  BarChart3
} from "lucide-react";

const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const STRAVA_AUTH_URL = `${BACKEND_BASE_URL}/strava/auth`;
const STRAVA_SYNC_URL = `${BACKEND_BASE_URL}/strava/sync`;
const STRAVA_DISCONNECT_URL = `${BACKEND_BASE_URL}/strava/disconnect`;
const ACTIVITIES_URL = `${BACKEND_BASE_URL}/activities`;
const USER_STATS_URL = `${BACKEND_BASE_URL}/user/stats`;
const LEVEL_UP_URL = `${BACKEND_BASE_URL}/user/level-up`;
const SEEN_BADGES_KEY = "lifequest:seen-badges";
const STRAVA_SYNCED_KEY = "lifequest:strava-synced";
const BALANCE_REFRESH_KEY = "lifequest:balance-refresh";
const ACTIVITIES_PREVIEW_LIMIT = 4;
const LEVEL_XP = 2000;
const LEVEL_UP_COST = 500;
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;
const LIFE_TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_LIFE_TOKEN_ADDRESS ??
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as Address;
const LIFE_TOKEN_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)"
]);

type ActivityItem = {
  id?: number | string;
  type: string;
  distance: number;
  duration?: number;
  elapsed_time?: number;
  reward: number;
  date?: string;
  icon?: string;
};

type UserBadge = {
  id: string;
  name: string;
  icon: string;
};

type UserStats = {
  balance: string;
  rank: string;
  xpMissing: string;
  level?: number;
  xpCurrent?: string;
  nextLevelXp?: string;
  xpTotal?: string;
  unlockedBadges: UserBadge[];
  badges?: Record<string, boolean>;
};

type BadgeTone = "neutral" | "success" | "warning" | "error";

type StatusBadgeProps = {
  label: string;
  tone?: BadgeTone;
};

const IRON_PROTOCOL_TYPES = new Set([
  "WeightTraining",
  "Workout",
  "Crossfit",
  "StrengthTraining",
  "Iron Protocol"
]);
const MINDFULNESS_TYPES = new Set(["Yoga", "Meditation", "Mindfulness"]);
const WEEKLY_GOALS = {
  run: 2,
  swim: 2,
  iron: 3,
  mindfulness: 2
};

function getRankByLevel(level: number) {
  if (level <= 5) return "NEOFITA (Lv 1-5)";
  if (level <= 10) return "CHALLENGER (Lv 6-10)";
  if (level <= 20) return "ELITE (Lv 11-20)";
  return "LEGEND (Lv 21+)";
}

function playSuccessSound() {
  if (typeof window === "undefined") return;
  const AudioContext =
    window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof window.AudioContext }).webkitAudioContext;
  if (!AudioContext) return;

  try {
    const context = new AudioContext();
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    gain.connect(context.destination);

    const osc1 = context.createOscillator();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.18);
    osc1.connect(gain);

    const osc2 = context.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1760, now + 0.08);
    osc2.connect(gain);

    osc1.start(now);
    osc2.start(now + 0.08);
    osc1.stop(now + 0.6);
    osc2.stop(now + 0.6);

    window.setTimeout(() => {
      context.close().catch(() => undefined);
    }, 700);
  } catch {
    // Ignore audio errors to keep UX smooth.
  }
}

function formatDistance(distance: number) {
  if (distance >= 1000) {
    const km = distance / 1000;
    const precision = Number.isInteger(km) ? 0 : 1;
    return `${km.toFixed(precision)}km`;
  }

  return `${Math.round(distance)}m`;
}

function formatDuration(seconds?: number) {
  const safeSeconds = Number(seconds) || 0;
  const minutes = Math.max(1, Math.floor(safeSeconds / 60));
  return `${minutes} min`;
}

function getActivityDisplay(activity: ActivityItem) {
  const isIronProtocol = IRON_PROTOCOL_TYPES.has(activity.type);
  const isMindfulness = MINDFULNESS_TYPES.has(activity.type);
  const label = isIronProtocol
    ? "Iron Protocol"
    : isMindfulness
      ? "Mindfulness"
      : activity.type === "Run"
        ? "Corsa"
        : activity.type === "Swim"
          ? "Nuoto"
          : "Attivita";
  const detail = isIronProtocol
    ? formatDuration(activity.duration ?? activity.elapsed_time)
    : formatDistance(activity.distance);
  return { label, detail };
}

function formatActivityType(type: string) {
  if (type === "Iron Protocol") return "Gym";
  if (type === "Run") return "Run";
  if (type === "Swim") return "Swim";
  if (IRON_PROTOCOL_TYPES.has(type)) return "Gym";
  if (MINDFULNESS_TYPES.has(type)) return "Mindfulness";
  return type;
}

function activityIcon(type: string) {
  if (type === "Iron Protocol") return "🏋️";
  if (type === "Run") return "🏃";
  if (type === "Swim") return "🏊";
  if (IRON_PROTOCOL_TYPES.has(type)) return "🏋️";
  if (MINDFULNESS_TYPES.has(type)) return "🧘";
  return "🏅";
}

function getWeekBounds(reference: Date) {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const diffToMonday = (day + 6) % 7;
  start.setDate(start.getDate() - diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  const toneClasses: Record<BadgeTone, string> = {
    neutral: "border-slate-700/70 bg-slate-800/50 text-slate-200",
    success: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
    warning: "border-amber-500/40 bg-amber-500/15 text-amber-200",
    error: "border-rose-500/40 bg-rose-500/15 text-rose-200"
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold font-mono ${toneClasses[tone]}`}
    >
      {label}
    </span>
  );
}

function HomeContent() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<"synced" | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasSyncedStrava, setHasSyncedStrava] = useState(false);
  const [activeFilter, setActiveFilter] = useState<
    "run" | "swim" | "iron" | "mindfulness" | null
  >(null);
  const [showAllActivities, setShowAllActivities] = useState(false);
  const [isWalletCollapsed, setIsWalletCollapsed] = useState(false);
  const [currentLevel, setCurrentLevel] = useState(1);
  const [showLevelUpGlow, setShowLevelUpGlow] = useState(false);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [confettiSeed, setConfettiSeed] = useState(0);
  const confettiTimerRef = useRef<number | null>(null);
  const [showPerfectWeekOverlay, setShowPerfectWeekOverlay] = useState(false);
  const [perfectWeekReward, setPerfectWeekReward] = useState(200);
  const perfectWeekTimerRef = useRef<number | null>(null);
  const [showPerfectWeekFlash, setShowPerfectWeekFlash] = useState(false);
  const perfectWeekFlashTimerRef = useRef<number | null>(null);
  const perfectWeekPrevRef = useRef<boolean | null>(null);
  const levelUpGlowTimerRef = useRef<number | null>(null);
  const previousWalletRef = useRef<string | null>(null);
  const searchParams = useSearchParams();
  const { address, isConnected } = useAccount();
  const walletAddress = address ?? null;
  const isWalletConnected = isConnected;
  const isDisconnected = !isWalletConnected;
  const showStravaSync = isWalletConnected && !hasSyncedStrava;
  const { data: lifeBalance, refetch: refetchLifeBalance } = useReadContract({
    address: LIFE_TOKEN_ADDRESS,
    abi: LIFE_TOKEN_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address)
    }
  });
  const {
    data: levelUpTxHash,
    isPending: isLevelUpPending,
    writeContract
  } = useWriteContract();
  const {
    data: mintTxHash,
    isPending: isMintPending,
    writeContract: writeMintContract
  } = useWriteContract();
  const { isLoading: isLevelUpConfirming, isSuccess: isLevelUpSuccess } =
    useWaitForTransactionReceipt({
      hash: levelUpTxHash,
      query: {
        enabled: Boolean(levelUpTxHash)
      }
    });
  const { isLoading: isMintConfirming, isSuccess: isMintSuccess } =
    useWaitForTransactionReceipt({
      hash: mintTxHash,
      query: {
        enabled: Boolean(mintTxHash)
      }
    });
  const lifeBalanceFormatted = useMemo(() => {
    if (!address || lifeBalance === undefined) return "—";
    return formatEther(lifeBalance);
  }, [address, lifeBalance]);
  const lifeBalanceValue = useMemo(() => {
    if (!address || lifeBalance === undefined) return null;
    const parsed = Number(formatEther(lifeBalance));
    return Number.isFinite(parsed) ? parsed : null;
  }, [address, lifeBalance]);
  const formatRewardShare = useCallback(
    (reward: number) => {
      if (!lifeBalanceValue || lifeBalanceValue <= 0 || reward <= 0) return null;
      const percent = (reward / lifeBalanceValue) * 100;
      const precision = percent >= 10 ? 0 : percent >= 1 ? 1 : 2;
      return `${percent.toFixed(precision)}%`;
    },
    [lifeBalanceValue]
  );
  const xpCurrent = useMemo(() => {
    if (!userStats?.xpCurrent) return 0;
    const parsed = Number(userStats.xpCurrent);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [userStats?.xpCurrent]);
  const nextLevelXp = useMemo(() => {
    if (!userStats?.nextLevelXp) return LEVEL_XP;
    const parsed = Number(userStats.nextLevelXp);
    return Number.isFinite(parsed) ? parsed : LEVEL_XP;
  }, [userStats?.nextLevelXp]);
  const levelProgress = useMemo(() => {
    if (!nextLevelXp) return 0;
    return Math.min(100, Math.round((xpCurrent / nextLevelXp) * 100));
  }, [nextLevelXp, xpCurrent]);
  const isNearGoal = levelProgress >= 90;
  const levelRank = useMemo(
    () => getRankByLevel(currentLevel),
    [currentLevel]
  );
  const hasEnoughBalance =
    Boolean(isWalletConnected && lifeBalanceValue !== null) &&
    (lifeBalanceValue as number) >= LEVEL_UP_COST;
  const hasEnoughXp = xpCurrent >= nextLevelXp;
  const canLevelUp = Boolean(isWalletConnected && hasEnoughBalance && hasEnoughXp);
  const isLevelingUp = isLevelUpPending || isLevelUpConfirming;
  const levelUpLabel = isLevelUpPending
    ? "Waiting validation..."
    : isLevelUpConfirming
      ? "Conferma on-chain..."
      : !hasEnoughBalance
        ? "Saldo insufficiente"
        : !hasEnoughXp
          ? "XP insufficienti"
          : `Level Up (${LEVEL_UP_COST} LIFE)`;
  const adminMintLabel = isMintPending
    ? "Waiting validation..."
    : isMintConfirming
      ? "Conferma on-chain..."
      : "Admin Mint";

  const handleLevelUp = useCallback(() => {
    if (!address || !canLevelUp || isLevelingUp) return;
    writeContract({
      address: LIFE_TOKEN_ADDRESS,
      abi: LIFE_TOKEN_ABI,
      functionName: "transfer",
      args: [BURN_ADDRESS, parseEther(LEVEL_UP_COST.toString())]
    });
  }, [address, canLevelUp, isLevelingUp, writeContract]);

  const isMinting = isMintPending || isMintConfirming;
  const handleAdminMint = useCallback(() => {
    if (!address || isMinting) return;
    toast("Minting 1000 LIFE...", {
      style: {
        background: "#0f172a",
        color: "#e2e8f0",
        border: "1px solid rgba(148, 163, 184, 0.4)"
      }
    });
    writeMintContract({
      address: LIFE_TOKEN_ADDRESS,
      abi: LIFE_TOKEN_ABI,
      functionName: "mint",
      args: [address, parseEther("1000")]
    });
  }, [address, isMinting, writeMintContract]);

  const triggerConfettiBurst = useCallback((duration = 1800) => {
    setConfettiSeed((prev) => prev + 1);
    setShowConfetti(true);

    if (confettiTimerRef.current) {
      window.clearTimeout(confettiTimerRef.current);
    }
    confettiTimerRef.current = window.setTimeout(() => {
      setShowConfetti(false);
    }, duration);
  }, []);

  const triggerPerfectWeekCelebration = useCallback(
    (reward: number) => {
      setPerfectWeekReward(reward);
      setShowPerfectWeekOverlay(true);
      setShowPerfectWeekFlash(true);

    if (typeof window !== "undefined") {
      const confetti = (window as any).confetti;
      if (typeof confetti === "function") {
        confetti({
          particleCount: 140,
          spread: 90,
          origin: { y: 0.6 }
        });
        confetti({
          particleCount: 90,
          spread: 120,
          origin: { y: 0.3 }
        });
      } else {
        triggerConfettiBurst(2200);
      }
    }

    if (perfectWeekTimerRef.current) {
      window.clearTimeout(perfectWeekTimerRef.current);
    }
    perfectWeekTimerRef.current = window.setTimeout(() => {
      setShowPerfectWeekOverlay(false);
    }, 2400);

    if (perfectWeekFlashTimerRef.current) {
      window.clearTimeout(perfectWeekFlashTimerRef.current);
    }
    perfectWeekFlashTimerRef.current = window.setTimeout(() => {
      setShowPerfectWeekFlash(false);
    }, 500);
  },
    [triggerConfettiBurst]
  );

  const markStravaSynced = (address?: string | null) => {
    setHasSyncedStrava(true);
    if (typeof window === "undefined") return;
    if (!address) {
      window.localStorage.setItem(STRAVA_SYNCED_KEY, "true");
      return;
    }
    const key = `${STRAVA_SYNCED_KEY}:${address.toLowerCase()}`;
    window.localStorage.setItem(key, "true");
  };

  const disconnectStravaForWallet = async (wallet?: string | null) => {
    if (!wallet) return;
    try {
      await fetch(STRAVA_DISCONNECT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ walletAddress: wallet })
      });
    } catch {
      // Best-effort cleanup; ignore failures.
    }
  };

  const refreshStats = async () => {
    try {
      if (!walletAddress) {
        setUserStats(null);
        return;
      }
      const response = await fetch(
        `${USER_STATS_URL}?wallet=${encodeURIComponent(walletAddress)}`
      );
      if (!response.ok) {
        throw new Error("Impossibile caricare i dati utente.");
      }
      const data = (await response.json()) as UserStats;
      setUserStats(data);
    } catch (err) {
      setUserStats(null);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const loadActivities = async () => {
      try {
        if (!walletAddress) {
          if (isMounted) {
            setActivities([]);
            setLoadError(null);
            setIsLoading(false);
          }
          return;
        }
        const response = await fetch(
          `${ACTIVITIES_URL}?wallet=${encodeURIComponent(walletAddress)}`
        );
        if (!response.ok) {
          throw new Error("Impossibile caricare lo storico attività.");
        }
        const data = await response.json();
        if (!isMounted) return;
        setActivities(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!isMounted) return;
        setLoadError("Impossibile caricare lo storico attività.");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadActivities();
    void refreshStats();

    return () => {
      isMounted = false;
    };
  }, [walletAddress]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const nextWallet = walletAddress?.toLowerCase() ?? null;
    const prevWallet = previousWalletRef.current;
    if (prevWallet && prevWallet !== nextWallet) {
      window.localStorage.removeItem(`${STRAVA_SYNCED_KEY}:${prevWallet}`);
      if (nextWallet) {
        window.localStorage.removeItem(`${STRAVA_SYNCED_KEY}:${nextWallet}`);
      }
      window.localStorage.removeItem(STRAVA_SYNCED_KEY);
      void disconnectStravaForWallet(prevWallet);
    }
    if (!nextWallet && prevWallet) {
      window.localStorage.removeItem(`${STRAVA_SYNCED_KEY}:${prevWallet}`);
      window.localStorage.removeItem(STRAVA_SYNCED_KEY);
      void disconnectStravaForWallet(prevWallet);
    }
    previousWalletRef.current = nextWallet;
  }, [walletAddress]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!walletAddress) {
      setHasSyncedStrava(false);
      return;
    }

    const key = `${STRAVA_SYNCED_KEY}:${walletAddress.toLowerCase()}`;
    const stored = window.localStorage.getItem(key);
    const fallback = window.localStorage.getItem(STRAVA_SYNCED_KEY) === "true";
    const synced = stored === "true" || fallback;
    setHasSyncedStrava(synced);
    if (synced && stored !== "true") {
      window.localStorage.setItem(key, "true");
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!userStats?.level) return;
    const parsed = Number(userStats.level);
    if (Number.isFinite(parsed) && parsed > 0) {
      setCurrentLevel(parsed);
    }
  }, [userStats?.level]);

  useEffect(() => {
    if (!userStats || typeof window === "undefined") {
      return;
    }

    const ignitionUnlocked = userStats.unlockedBadges?.some((badge) => badge.id === "ignition");
    const currentBadges: Record<string, boolean> = {
      ignition: Boolean(ignitionUnlocked),
      sonicBurst: Boolean(userStats.badges?.sonicBurst),
      hydroMaster: Boolean(userStats.badges?.hydroMaster),
      ironProtocol: Boolean(userStats.badges?.ironProtocol),
      zenFocus: Boolean(userStats.badges?.zenFocus)
    };

    const unlockedIds = Object.entries(currentBadges)
      .filter(([, unlocked]) => unlocked)
      .map(([id]) => id);

    const stored = window.localStorage.getItem(SEEN_BADGES_KEY);
    if (!stored) {
      window.localStorage.setItem(SEEN_BADGES_KEY, JSON.stringify(unlockedIds));
      return;
    }
    let storedBadges: string[] = [];
    try {
      const parsed = JSON.parse(stored);
      storedBadges = Array.isArray(parsed) ? parsed : [];
    } catch {
      storedBadges = [];
    }
    const seen = new Set<string>(storedBadges);
    const newlyUnlocked = unlockedIds.filter((id) => !seen.has(id));

    if (newlyUnlocked.length > 0) {
      triggerConfettiBurst();
      playSuccessSound();
      newlyUnlocked.forEach((id) => seen.add(id));
      window.localStorage.setItem(SEEN_BADGES_KEY, JSON.stringify([...seen]));
    }
  }, [userStats, triggerConfettiBurst]);

  useEffect(() => {
    return () => {
      if (confettiTimerRef.current) {
        window.clearTimeout(confettiTimerRef.current);
      }
      if (perfectWeekTimerRef.current) {
        window.clearTimeout(perfectWeekTimerRef.current);
      }
      if (perfectWeekFlashTimerRef.current) {
        window.clearTimeout(perfectWeekFlashTimerRef.current);
      }
      if (levelUpGlowTimerRef.current) {
        window.clearTimeout(levelUpGlowTimerRef.current);
      }
    };
  }, []);

  const refreshActivities = async () => {
    try {
      setIsLoading(true);
      if (!walletAddress) {
        setActivities([]);
        setLoadError(null);
        return null;
      }
      const response = await fetch(
        `${ACTIVITIES_URL}?wallet=${encodeURIComponent(walletAddress)}`
      );
      if (!response.ok) {
        throw new Error("Impossibile caricare lo storico attività.");
      }
      const data = await response.json();
      const list = Array.isArray(data) ? data : [];
      setActivities(list);
      setLoadError(null);
      return list as ActivityItem[];
    } catch (err) {
      setLoadError("Impossibile caricare lo storico attività.");
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const handleSync = async () => {
    if (isSyncing) return;
    if (!walletAddress) {
      toast.error("Connetti il wallet per sincronizzare Strava.", {
        style: {
          background: "#0f172a",
          color: "#fecdd3",
          border: "1px solid rgba(244, 63, 94, 0.4)"
        }
      });
      return;
    }
    setIsSyncing(true);
    setLoadError(null);
    setSyncNotice(null);

    try {
      const response = await fetch(STRAVA_SYNC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ walletAddress })
      });
      const data = await response.json();

      if (!response.ok) {
        if (data?.status === "wallet_conflict") {
          toast.error(data?.message || "Account Strava già collegato.", {
            style: {
              background: "#0f172a",
              color: "#fecdd3",
              border: "1px solid rgba(244, 63, 94, 0.4)"
            }
          });
          return;
        }
        if (data?.status === "rate_limited") {
          const retryAfter = Number(data?.retryAfter ?? 60);
          const waitSeconds = Number.isFinite(retryAfter) ? retryAfter : 60;
          const message = `Limite Strava raggiunto. Riprova tra ${waitSeconds}s.`;
          toast.error(message, {
            style: {
              background: "#0f172a",
              color: "#fecdd3",
              border: "1px solid rgba(244, 63, 94, 0.4)"
            }
          });
          setLoadError(message);
          return;
        }
        if (data?.status === "needs_auth") {
          toast("Collega Strava per continuare la sincronizzazione.", {
            icon: "🔗",
            style: {
              background: "#0f172a",
              color: "#e2e8f0",
              border: "1px solid rgba(148, 163, 184, 0.4)"
            }
          });
          window.location.href = `${STRAVA_AUTH_URL}?wallet=${walletAddress}`;
          return;
        }
        throw new Error(data?.message || "Errore di sincronizzazione.");
      }

      if (data?.status === "minted") {
        const reward = data?.totalReward ?? 0;
        toast.success(`Successo! +${reward} LIFE`, {
          style: {
            background: "#0f172a",
            color: "#e2e8f0",
            border: "1px solid rgba(34, 211, 238, 0.4)"
          },
          iconTheme: {
            primary: "#22d3ee",
            secondary: "#0f172a"
          }
        });
        const previousIds = new Set(
          activities.map((activity) => activity.id ?? `${activity.type}-${activity.date}`)
        );
        let updated: ActivityItem[] | null = null;
        if (Array.isArray(data?.activities)) {
          setActivities(data.activities);
          setLoadError(null);
          updated = data.activities as ActivityItem[];
        } else {
          updated = await refreshActivities();
        }
        await refreshStats();
        if (updated) {
          const today = new Date();
          const isSameDay = (date?: string) => {
            if (!date) return false;
            const parsed = new Date(date);
            if (Number.isNaN(parsed.getTime())) return false;
            return (
              parsed.getFullYear() === today.getFullYear() &&
              parsed.getMonth() === today.getMonth() &&
              parsed.getDate() === today.getDate()
            );
          };
          const ironFound = updated.some(
            (activity) =>
              IRON_PROTOCOL_TYPES.has(activity.type) &&
              isSameDay(activity.date) &&
              !previousIds.has(activity.id ?? `${activity.type}-${activity.date}`)
          );
          if (ironFound) {
            toast.success("Sessione Iron Protocol rilevata! +10 LIFE guadagnati", {
              style: {
                background: "#0f172a",
                color: "#e2e8f0",
                border: "1px solid rgba(217, 70, 239, 0.5)"
              },
              icon: "🏋️"
            });
          }
        }
        if (data?.perfectWeekBonus) {
          triggerPerfectWeekCelebration(Number(data.perfectWeekBonus));
        }
        markStravaSynced(walletAddress);
        return;
      }

      setSyncNotice("synced");
      if (Array.isArray(data?.activities)) {
        setActivities(data.activities);
        setLoadError(null);
      } else {
        await refreshActivities();
      }
      await refreshStats();
      markStravaSynced(walletAddress);
      toast("Tutto sincronizzato!", {
        icon: "✅",
        style: {
          background: "#0f172a",
          color: "#fde68a",
          border: "1px solid rgba(251, 191, 36, 0.5)"
        }
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Errore di sincronizzazione.";
      setLoadError(message);
      toast.error(message, {
        style: {
          background: "#0f172a",
          color: "#fecdd3",
          border: "1px solid rgba(244, 63, 94, 0.4)"
        }
      });
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let startY = 0;
    let isPulling = false;
    let shouldTrigger = false;
    const threshold = 80;

    const onTouchStart = (event: TouchEvent) => {
      if (!isWalletConnected || isSyncing) return;
      if (window.scrollY > 0) return;
      startY = event.touches[0]?.clientY ?? 0;
      isPulling = true;
      shouldTrigger = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!isPulling) return;
      const currentY = event.touches[0]?.clientY ?? 0;
      if (currentY - startY > threshold) {
        shouldTrigger = true;
      }
    };

    const onTouchEnd = () => {
      if (!isPulling) return;
      if (shouldTrigger) {
        void handleSync();
      }
      isPulling = false;
      shouldTrigger = false;
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [handleSync, isSyncing, isWalletConnected]);

  useEffect(() => {
    const minted = searchParams.get("minted") === "true";
    const noNewActivities = searchParams.get("no_new_activities") === "true";
    const stravaError = searchParams.get("strava_error");
    const conflictWallet = searchParams.get("wallet");

    if (minted) {
      setSyncNotice(null);
      toast.success("Successo! +130 LIFE", {
        style: {
          background: "#0f172a",
          color: "#e2e8f0",
          border: "1px solid rgba(34, 211, 238, 0.4)"
        },
        iconTheme: {
          primary: "#22d3ee",
          secondary: "#0f172a"
        }
      });
    }

    if (noNewActivities) {
      setSyncNotice("synced");
      toast("Sei già aggiornato! Torna ad allenarti per guadagnare di più", {
        icon: "⚡",
        style: {
          background: "#0f172a",
          color: "#fde68a",
          border: "1px solid rgba(251, 191, 36, 0.5)"
        }
      });
    }

    if (stravaError === "wallet_conflict") {
      const message = conflictWallet
        ? `Questo account Strava è già collegato a un altro wallet (${conflictWallet})`
        : "Questo account Strava è già collegato a un altro wallet.";
      toast.error(message, {
        style: {
          background: "#0f172a",
          color: "#fecdd3",
          border: "1px solid rgba(244, 63, 94, 0.4)"
        }
      });
    }

    if (minted || noNewActivities) {
      markStravaSynced(walletAddress);
    }
    if (minted || noNewActivities || stravaError) {
      const url = new URL(window.location.href);
      url.searchParams.delete("minted");
      url.searchParams.delete("no_new_activities");
      url.searchParams.delete("strava_error");
      url.searchParams.delete("wallet");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams, walletAddress]);

  useEffect(() => {
    if (!isWalletConnected) {
      setSyncNotice(null);
    }
  }, [isWalletConnected]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: StorageEvent) => {
      if (event.key !== BALANCE_REFRESH_KEY) return;
      void refetchLifeBalance();
    };
    window.addEventListener("storage", handler);
    const stored = window.localStorage.getItem(BALANCE_REFRESH_KEY);
    if (stored) {
      void refetchLifeBalance();
    }
    return () => {
      window.removeEventListener("storage", handler);
    };
  }, [refetchLifeBalance]);

  const weekBounds = useMemo(() => {
    const { start, end } = getWeekBounds(new Date());
    return { startTime: start.getTime(), endTime: end.getTime() };
  }, []);

  const weeklyCounts = useMemo(() => {
    let run = 0;
    let swim = 0;
    let iron = 0;
    let mindfulness = 0;

    for (const activity of activities) {
      if (!activity?.date) continue;
      const timestamp = new Date(activity.date).getTime();
      if (Number.isNaN(timestamp)) continue;
      if (timestamp < weekBounds.startTime || timestamp >= weekBounds.endTime) {
        continue;
      }

      if (activity.type === "Run") run += 1;
      if (activity.type === "Swim") swim += 1;
      if (IRON_PROTOCOL_TYPES.has(activity.type)) iron += 1;
      if (MINDFULNESS_TYPES.has(activity.type)) mindfulness += 1;
    }

    return { run, swim, iron, mindfulness };
  }, [activities, weekBounds]);
  const weeklyTotals = useMemo(() => {
    let runDistance = 0;
    let swimDistance = 0;
    let totalDistance = 0;

    for (const activity of activities) {
      if (!activity?.date) continue;
      const timestamp = new Date(activity.date).getTime();
      if (Number.isNaN(timestamp)) continue;
      if (timestamp < weekBounds.startTime || timestamp >= weekBounds.endTime) {
        continue;
      }

      const distance = Number(activity.distance) || 0;
      if (activity.type === "Run") {
        runDistance += distance;
        totalDistance += distance;
      }
      if (activity.type === "Swim") {
        swimDistance += distance;
        totalDistance += distance;
      }
    }

    return { runDistance, swimDistance, totalDistance };
  }, [activities, weekBounds]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth < 1024) {
      setIsWalletCollapsed(true);
    }
  }, []);

  useEffect(() => {
    if (!isLevelUpSuccess) return;
    const syncLevel = async () => {
      try {
        if (walletAddress) {
          const response = await fetch(LEVEL_UP_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ walletAddress })
          });
          if (response.ok) {
            const data = await response.json();
            if (data?.level) {
              setCurrentLevel(Number(data.level));
            }
          }
        }
      } catch {
        // Ignore sync failures; UI will refresh on next stats fetch.
      }
      triggerConfettiBurst(1800);
      setShowLevelUpGlow(true);
      void refetchLifeBalance();
      void refreshStats();
      toast.success("Level Up!", {
        style: {
          background: "#0f172a",
          color: "#e2e8f0",
          border: "1px solid rgba(34, 211, 238, 0.4)"
        }
      });
      if (levelUpGlowTimerRef.current) {
        window.clearTimeout(levelUpGlowTimerRef.current);
      }
      levelUpGlowTimerRef.current = window.setTimeout(() => {
        setShowLevelUpGlow(false);
      }, 1600);
    };

    void syncLevel();
  }, [isLevelUpSuccess, refetchLifeBalance, refreshStats, triggerConfettiBurst, walletAddress]);

  useEffect(() => {
    if (!isMintSuccess) return;
    void refetchLifeBalance();
    toast.success("Fatto!", {
      style: {
        background: "#0f172a",
        color: "#e2e8f0",
        border: "1px solid rgba(34, 211, 238, 0.4)"
      }
    });
  }, [isMintSuccess, refetchLifeBalance]);

  const weeklySparkline = useMemo(() => {
    const days: string[] = [];
    const dayIndex = new Map<string, number>();
    const today = new Date();
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate()
      ).padStart(2, "0")}`;
      dayIndex.set(key, days.length);
      days.push(key);
    }

    const series = {
      run: Array(7).fill(0),
      swim: Array(7).fill(0),
      iron: Array(7).fill(0),
      mindfulness: Array(7).fill(0)
    };

    for (const activity of activities) {
      const dateValue = activity.date;
      if (!dateValue) continue;
      const parsed = new Date(dateValue);
      if (Number.isNaN(parsed.getTime())) continue;
      parsed.setHours(0, 0, 0, 0);
      const key = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(
        parsed.getDate()
      ).padStart(2, "0")}`;
      const index = dayIndex.get(key);
      if (index === undefined) continue;

      if (activity.type === "Run") series.run[index] += 1;
      if (activity.type === "Swim") series.swim[index] += 1;
      if (IRON_PROTOCOL_TYPES.has(activity.type)) series.iron[index] += 1;
      if (MINDFULNESS_TYPES.has(activity.type)) series.mindfulness[index] += 1;
    }

    return series;
  }, [activities]);
  const weeklyActivityTotals = useMemo(() => {
    const length = weeklySparkline.run.length;
    return Array.from({ length }, (_, index) =>
      weeklySparkline.run[index] +
      weeklySparkline.swim[index] +
      weeklySparkline.iron[index] +
      weeklySparkline.mindfulness[index]
    );
  }, [weeklySparkline]);
  const weeklyActivityMax = useMemo(
    () => Math.max(1, ...weeklyActivityTotals),
    [weeklyActivityTotals]
  );

  const perfectWeekCompletedCount = useMemo(() => {
    let completed = 0;
    if (weeklyCounts.run >= WEEKLY_GOALS.run) completed += 1;
    if (weeklyCounts.swim >= WEEKLY_GOALS.swim) completed += 1;
    if (weeklyCounts.iron >= WEEKLY_GOALS.iron) completed += 1;
    if (weeklyCounts.mindfulness >= WEEKLY_GOALS.mindfulness) completed += 1;
    return completed;
  }, [weeklyCounts]);
  const perfectWeekComplete = perfectWeekCompletedCount === 4;

  useEffect(() => {
    if (!isWalletConnected) {
      perfectWeekPrevRef.current = null;
      return;
    }
    if (perfectWeekPrevRef.current === null) {
      perfectWeekPrevRef.current = perfectWeekComplete;
      return;
    }
    if (!perfectWeekPrevRef.current && perfectWeekComplete) {
      triggerPerfectWeekCelebration(200);
    }
    perfectWeekPrevRef.current = perfectWeekComplete;
  }, [isWalletConnected, perfectWeekComplete, triggerPerfectWeekCelebration]);

  const visibleActivities = useMemo(() => {
    if (!activeFilter) return activities;
    if (activeFilter === "run") {
      return activities.filter((activity) => activity.type === "Run");
    }
    if (activeFilter === "swim") {
      return activities.filter((activity) => activity.type === "Swim");
    }
    if (activeFilter === "iron") {
      return activities.filter((activity) => IRON_PROTOCOL_TYPES.has(activity.type));
    }
    return activities.filter((activity) => MINDFULNESS_TYPES.has(activity.type));
  }, [activities, activeFilter]);
  const hasMoreActivities = visibleActivities.length > ACTIVITIES_PREVIEW_LIMIT;
  const isActivitiesExpanded = showAllActivities && hasMoreActivities;
  const activityPreview = useMemo(() => {
    if (isActivitiesExpanded) return visibleActivities;
    return visibleActivities.slice(0, ACTIVITIES_PREVIEW_LIMIT);
  }, [isActivitiesExpanded, visibleActivities]);
  const ignitionUnlocked = Boolean(
    userStats?.unlockedBadges?.some((badge) => badge.id === "ignition")
  );
  const unlockedSpecialBadges = userStats?.badges ?? {};
  const derivedBadgeUnlocks = useMemo(() => {
    let totalRunDistance = 0;
    let swimSessions = 0;
    let ironSessions = 0;
    let hasLongRun = false;

    for (const activity of activities) {
      if (activity.type === "Run") {
        totalRunDistance += Number(activity.distance) || 0;
        if (Number(activity.distance) >= 10000) {
          hasLongRun = true;
        }
      }
      if (activity.type === "Swim") {
        swimSessions += 1;
      }
      if (IRON_PROTOCOL_TYPES.has(activity.type)) {
        ironSessions += 1;
      }
    }

    return {
      sonicBurst: hasLongRun || totalRunDistance / 1000 >= 50,
      hydroMaster: swimSessions >= 10,
      ironProtocol: ironSessions >= 5
    };
  }, [activities]);
  const resolvedBadgeUnlocks = {
    sonicBurst: Boolean(unlockedSpecialBadges.sonicBurst || derivedBadgeUnlocks.sonicBurst),
    hydroMaster: Boolean(unlockedSpecialBadges.hydroMaster || derivedBadgeUnlocks.hydroMaster),
    ironProtocol: Boolean(unlockedSpecialBadges.ironProtocol || derivedBadgeUnlocks.ironProtocol),
    zenFocus: Boolean(unlockedSpecialBadges.zenFocus)
  };
  const trophyBadges = [
    {
      id: "sonicBurst",
      name: "Sonic Burst",
      requirement: "Totale corsa 50 km",
      image: "/badges/badge-run.png",
      glow: "shadow-[0_0_18px_rgba(251,146,60,0.55)]"
    },
    {
      id: "hydroMaster",
      name: "Hydro Master",
      requirement: "10 sessioni nuoto",
      image: "/badges/badge-swim.png",
      glow: "shadow-[0_0_18px_rgba(56,189,248,0.35)]"
    },
    {
      id: "ironProtocol",
      name: "Iron Protocol",
      requirement: "5 sessioni palestra",
      image: "/badges/badge-gym.png",
      glow: "shadow-[0_0_18px_rgba(168,85,247,0.35)]"
    },
    {
      id: "zenFocus",
      name: "Zen Focus",
      requirement: "5 sessioni mindfulness",
      image: "/badges/badge-zen.png",
      glow: "shadow-[0_0_18px_rgba(45,212,191,0.35)]"
    }
  ];

  return (
    <main
      className={`relative min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 overflow-y-auto lg:h-screen lg:max-h-screen ${
        isActivitiesExpanded ? "lg:overflow-y-auto" : "lg:overflow-hidden"
      }`}
    >
      <Toaster position="top-right" />
      {showConfetti ? <ConfettiBurst seed={confettiSeed} /> : null}
      {showPerfectWeekOverlay ? (
        <PerfectWeekOverlay reward={perfectWeekReward} />
      ) : null}
      {showPerfectWeekFlash ? (
        <div className="pointer-events-none fixed inset-0 z-40 bg-fuchsia-500/20 animate-pulse" />
      ) : null}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_55%)]" />
      <div className="relative z-10 min-h-full max-w-[1400px] mx-auto flex flex-col gap-4 lg:h-full">
        <header
          className={`flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between ${
            isDisconnected ? "grayscale-[0.25] saturate-75" : ""
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-purple-600/90 rotate-12 flex items-center justify-center shadow-[0_0_18px_rgba(168,85,247,0.6)]">
              <Trophy className="h-5 w-5 -rotate-12 text-white" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">LifeQuest</p>
              <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/arena"
              className="inline-flex items-center rounded-full border border-red-400/40 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-200 transition hover:border-red-300/70 hover:text-red-100"
            >
              Arena
            </Link>
            <Link
              href="/spiegazione"
              className="inline-flex items-center rounded-full border border-cyan-400/40 px-4 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/70 hover:text-cyan-50"
            >
              Guida LifeQuest
            </Link>
          </div>
        </header>

        <div className="relative rounded-3xl border border-white/10 bg-slate-900/40 p-3 shadow-2xl backdrop-blur-xl sm:p-4">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_55%)]" />
          <div className="pointer-events-none absolute -top-24 right-10 h-40 w-40 rounded-full bg-amber-400/10 blur-3xl" />
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              I Tuoi Trofei
            </p>
            <span className="text-[11px] text-slate-400">Bacheca</span>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory sm:gap-3 sm:pb-3">
            {trophyBadges.map((badge) => {
              const unlocked = Boolean(
                resolvedBadgeUnlocks[badge.id as keyof typeof resolvedBadgeUnlocks]
              );
              return (
                <div
                  key={badge.id}
                  className={`group relative min-w-[140px] snap-start overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 p-2.5 text-center transition-all duration-500 sm:min-w-[160px] sm:p-3 ${
                    unlocked
                      ? "hover:-translate-y-0.5 hover:shadow-[0_0_28px_rgba(251,146,60,0.45)]"
                      : "opacity-90"
                  }`}
                >
                  <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(56,189,248,0.08),transparent)] opacity-0 transition-opacity duration-700 group-hover:opacity-100" />
                  {unlocked ? (
                    <span className="pointer-events-none absolute inset-0 lifequest-trophy-shine" />
                  ) : null}
                  {unlocked ? (
                    <span className="pointer-events-none absolute -top-8 -right-8 h-20 w-20 rounded-full bg-amber-400/20 blur-2xl" />
                  ) : null}
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950/70 ring-1 ring-white/5 sm:h-16 sm:w-16">
                    <img
                      src={badge.image}
                      alt={badge.name}
                      className={`h-10 w-10 sm:h-12 sm:w-12 ${
                        unlocked
                          ? `opacity-100 ${badge.glow} group-hover:shadow-[0_0_18px_rgba(251,146,60,0.6)]`
                          : "opacity-40 grayscale"
                      }`}
                      loading="lazy"
                    />
                  </div>
                  <p className="mt-2 text-xs font-semibold text-white sm:mt-3 sm:text-sm">
                    {badge.name}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400 sm:text-[11px]">
                    {unlocked ? "Sbloccato" : badge.requirement}
                  </p>
                  {unlocked ? (
                    <span className="mt-2 inline-flex items-center justify-center rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-semibold text-amber-200 sm:text-[10px]">
                      Trophy
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:flex-1 lg:min-h-0">
          <aside className="col-span-12 lg:col-span-3 flex flex-col gap-4 lg:min-h-0">
            <div
              className={`flex items-center justify-between ${
                isDisconnected ? "grayscale-[0.3] saturate-75" : ""
              }`}
            >
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">STATUS</p>
              <StatusBadge
                label={isWalletConnected ? "Connesso" : "Disconnesso"}
                tone={isWalletConnected ? "success" : "warning"}
              />
            </div>

            <div
              className={`w-full rounded-3xl border border-white/10 bg-slate-900/40 p-5 shadow-2xl backdrop-blur-xl transition-all duration-500 ${
                isDisconnected ? "grayscale-[0.6] saturate-50 opacity-80" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Wallet</p>
                <button
                  type="button"
                  onClick={() => setIsWalletCollapsed((prev) => !prev)}
                  className="text-[11px] font-semibold text-slate-300 transition hover:text-white"
                >
                  {isWalletCollapsed ? "Mostra dettagli" : "Riduci"}
                </button>
              </div>
              <div className="mt-4 flex flex-col gap-4">
                <ConnectButton.Custom>
                  {({
                    account,
                    chain,
                    mounted,
                    openAccountModal,
                    openChainModal,
                    openConnectModal
                  }) => {
                    const ready = mounted;
                    const connected = ready && account && chain;

                    return (
                      <div
                        aria-hidden={!ready}
                        style={
                          !ready
                            ? {
                                opacity: 0,
                                pointerEvents: "none",
                                userSelect: "none"
                              }
                            : undefined
                        }
                      >
                        {!connected ? (
                          <button
                            type="button"
                            onClick={openConnectModal}
                            className="inline-flex w-full items-center justify-center rounded-xl border border-cyan-400/40 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/70 hover:text-cyan-50"
                          >
                            Connetti Wallet
                          </button>
                        ) : chain?.unsupported ? (
                          <button
                            type="button"
                            onClick={openChainModal}
                            className="inline-flex w-full items-center justify-center rounded-xl border border-amber-400/60 px-4 py-3 text-sm font-semibold text-amber-100 transition hover:border-amber-300/80 hover:text-amber-50"
                          >
                            Wrong Network
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={openAccountModal}
                            className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-white/20"
                          >
                            {account?.displayName}
                          </button>
                        )}
                      </div>
                    );
                  }}
                </ConnectButton.Custom>
                {isWalletCollapsed ? (
                  <div className="flex items-center justify-between rounded-xl border border-cyan-400/30 bg-slate-900/50 px-4 py-3 text-sm text-slate-200">
                    <span className="text-xs uppercase tracking-[0.2em] text-cyan-300">
                      Saldo LIFE
                    </span>
                    <span className="font-mono text-white">{lifeBalanceFormatted} LIFE</span>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-cyan-400/40 bg-slate-900/60 p-4 shadow-[0_0_24px_rgba(34,211,238,0.35)]">
                    <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">
                      Saldo LIFE
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-white font-mono">
                      {lifeBalanceFormatted} LIFE
                    </p>
                  </div>
                )}
                {isWalletConnected ? (
                  <button
                    type="button"
                    onClick={handleSync}
                    disabled={isSyncing}
                    className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      showStravaSync
                        ? "bg-purple-500 text-white shadow-[0_0_18px_rgba(168,85,247,0.6)] hover:bg-purple-400"
                        : "bg-cyan-400 text-slate-900 shadow-[0_0_18px_rgba(34,211,238,0.45)] hover:bg-cyan-300"
                    }`}
                  >
                    {isSyncing ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Sincronizzazione...
                      </>
                    ) : (
                      <>
                        ↻ {showStravaSync ? "Sincronizza Strava" : "Aggiorna Strava"}
                      </>
                    )}
                  </button>
                ) : (
                  <p className="text-xs text-slate-300">
                    Connetti il wallet per sincronizzare Strava.
                  </p>
                )}
                {isWalletConnected ? (
                  <button
                    type="button"
                    onClick={handleAdminMint}
                    disabled={isMinting}
                    className="self-end rounded-full border border-slate-700/70 bg-slate-950/60 px-3 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500/70 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    ⚙️ {adminMintLabel}
                  </button>
                ) : null}
              </div>
            </div>

            {isWalletConnected ? (
              <>
                <div
                  className={`rounded-3xl bg-slate-900/40 backdrop-blur-xl border border-white/10 shadow-2xl p-4 transition-all duration-500 ${
                    showLevelUpGlow
                      ? "ring-2 ring-amber-400/60 shadow-[0_0_30px_rgba(251,191,36,0.4)]"
                      : ""
                  }`}
                >
                  <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">Livello</p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <h2 className="text-xl font-semibold text-white">
                      Livello <span className="font-mono">{currentLevel}</span>
                    </h2>
                    <span className="rounded-full border border-white/10 bg-slate-900/60 px-3 py-1 text-[11px] font-semibold text-slate-200">
                      {levelRank}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    XP{" "}
                    <span className="font-mono text-slate-100">{xpCurrent}</span>{" "}
                    / <span className="font-mono">{nextLevelXp}</span>
                  </p>
                  <div
                    className={`mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-800/80 ${
                      isNearGoal ? "ring-1 ring-cyan-400/50 animate-pulse" : ""
                    }`}
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-purple-500 via-cyan-400 to-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.7)]"
                      style={{ width: `${levelProgress}%` }}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      Obiettivo: <span className="font-mono">{nextLevelXp}</span> XP
                    </span>
                    <span className="font-mono">{levelProgress}%</span>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">
                    Mancano{" "}
                    <span className="font-mono text-slate-200">
                      {Math.max(0, nextLevelXp - xpCurrent)}
                    </span>{" "}
                    XP al prossimo livello
                  </p>
                  {isWalletConnected ? (
                    <button
                      type="button"
                      onClick={handleLevelUp}
                      disabled={!canLevelUp || isLevelingUp}
                      className={`mt-4 flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        canLevelUp && !isLevelingUp
                          ? "border border-cyan-400/50 bg-cyan-500/10 text-cyan-100 hover:border-cyan-300/70 hover:text-cyan-50"
                          : "border border-slate-700/70 bg-slate-900/60 text-slate-400"
                      }`}
                    >
                      {levelUpLabel}
                    </button>
                  ) : null}

                  <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3 transition-all duration-500">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                        ignitionUnlocked ? "bg-cyan-500/20 text-cyan-200" : "bg-slate-800/60 text-slate-500"
                      }`}
                    >
                      {ignitionUnlocked ? <Zap className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">The Ignition</p>
                      <p className="text-xs text-slate-400">
                        {ignitionUnlocked ? "Sbloccato" : "Bloccato"}
                      </p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-3xl bg-slate-900/40 backdrop-blur-xl border border-white/10 shadow-2xl p-4 transition-all duration-500 grayscale-[0.3] saturate-75">
                <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">
                  Preview Scheda Giocatore
                </p>
                <div className="mt-4 flex items-center gap-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900/60 text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.25)]">
                    <UserRound className="h-7 w-7" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Unknown Hero</p>
                    <p className="text-xs text-slate-400">Profilo non attivato</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3">
                  {[
                    {
                      label: "Missioni e ranking settimanali",
                      icon: Trophy
                    },
                    {
                      label: "Bonus Perfect Week +200 LIFE",
                      icon: Zap
                    },
                    {
                      label: "Statistiche on-chain live",
                      icon: BarChart3
                    }
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.label}
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-200"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-200">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span>{item.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </aside>

          <section className="col-span-12 lg:col-span-5 flex flex-col gap-4 lg:min-h-0">
            <div
              className={`rounded-3xl bg-slate-900/40 backdrop-blur-xl border border-white/10 shadow-2xl p-5 flex flex-col min-h-0 transition-all duration-500 ${
                isDisconnected ? "grayscale-[0.3] saturate-75" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-purple-500">MISSIONI</p>
                  <h2 className="text-xl font-semibold text-white">Obiettivi Settimanali</h2>
                </div>
                <StatusBadge label="4 Obiettivi" tone="neutral" />
              </div>

              {isWalletConnected ? (
                <>
                  {perfectWeekComplete ? (
                    <div className="mt-4 rounded-2xl border border-amber-400/50 bg-amber-500/10 px-4 py-3 text-center text-sm font-semibold text-amber-200 shadow-[0_0_18px_rgba(251,191,36,0.35)]">
                      PERFECT WEEK RAGGIUNTA! +200 LIFE
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 transition-all duration-500">
                      <div className="flex items-center justify-between text-[11px] text-slate-300">
                        <span className="uppercase tracking-[0.2em] text-slate-400">
                          Progressi Settimana Perfetta
                        </span>
                        <span className="font-mono text-cyan-200">
                          {perfectWeekCompletedCount}/4
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-purple-500 via-cyan-400 to-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.6)]"
                          style={{ width: `${(perfectWeekCompletedCount / 4) * 100}%` }}
                        />
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        {Array.from({ length: 4 }).map((_, index) => (
                          <span
                            key={`perfect-week-${index}`}
                            className={`h-2 w-2 rounded-full transition ${
                              index < perfectWeekCompletedCount
                                ? "bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
                                : "bg-slate-700"
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <MissionCard
                      icon={<Activity className="h-8 w-8 text-purple-500" />}
                      title="Corsa"
                      description="Run su Strava sopra 5 km."
                      reward="10"
                      hideReward={!isWalletConnected}
                      current={weeklyCounts.run}
                      target={WEEKLY_GOALS.run}
                      status={
                        weeklyCounts.run >= WEEKLY_GOALS.run
                          ? "Obiettivo raggiunto"
                          : `${weeklyCounts.run}/${WEEKLY_GOALS.run} questa settimana`
                      }
                      isComplete={weeklyCounts.run >= WEEKLY_GOALS.run}
                      isActive={activeFilter === "run"}
                      className="w-full"
                      sparkline={weeklySparkline.run}
                      onClick={() =>
                        setActiveFilter((prev) => (prev === "run" ? null : "run"))
                      }
                    />
                    <MissionCard
                      icon={<Droplet className="h-8 w-8 text-cyan-400" />}
                      title="Nuoto"
                      description="Swim su Strava sopra 1 km."
                      reward="20"
                      hideReward={!isWalletConnected}
                      current={weeklyCounts.swim}
                      target={WEEKLY_GOALS.swim}
                      status={
                        weeklyCounts.swim >= WEEKLY_GOALS.swim
                          ? "Obiettivo raggiunto"
                          : `${weeklyCounts.swim}/${WEEKLY_GOALS.swim} questa settimana`
                      }
                      isComplete={weeklyCounts.swim >= WEEKLY_GOALS.swim}
                      isActive={activeFilter === "swim"}
                      className="w-full"
                      sparkline={weeklySparkline.swim}
                      onClick={() =>
                        setActiveFilter((prev) => (prev === "swim" ? null : "swim"))
                      }
                    />
                    <MissionCard
                      icon={<Dumbbell className="h-8 w-8 text-purple-400" />}
                      title="Iron Protocol"
                      description="Sessione palestra su Strava."
                      reward="10"
                      hideReward={!isWalletConnected}
                      current={weeklyCounts.iron}
                      target={WEEKLY_GOALS.iron}
                      status={
                        weeklyCounts.iron >= WEEKLY_GOALS.iron
                          ? "Obiettivo raggiunto"
                          : `${weeklyCounts.iron}/${WEEKLY_GOALS.iron} questa settimana`
                      }
                      isComplete={weeklyCounts.iron >= WEEKLY_GOALS.iron}
                      isActive={activeFilter === "iron"}
                      className="w-full"
                      sparkline={weeklySparkline.iron}
                      onClick={() =>
                        setActiveFilter((prev) => (prev === "iron" ? null : "iron"))
                      }
                    />
                    <MissionCard
                      icon={<Leaf className="h-8 w-8 text-emerald-400" />}
                      title="Mindfulness"
                      description="Yoga o recupero guidato."
                      reward="10"
                      hideReward={!isWalletConnected}
                      current={weeklyCounts.mindfulness}
                      target={WEEKLY_GOALS.mindfulness}
                      status={
                        weeklyCounts.mindfulness >= WEEKLY_GOALS.mindfulness
                          ? "Obiettivo raggiunto"
                          : `${weeklyCounts.mindfulness}/${WEEKLY_GOALS.mindfulness} questa settimana`
                      }
                      isComplete={weeklyCounts.mindfulness >= WEEKLY_GOALS.mindfulness}
                      isActive={activeFilter === "mindfulness"}
                      className="w-full"
                      sparkline={weeklySparkline.mindfulness}
                      onClick={() =>
                        setActiveFilter((prev) =>
                          prev === "mindfulness" ? null : "mindfulness"
                        )
                      }
                    />
                  </div>
                </>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {[
                    {
                      title: "Corsa",
                      reward: "+10 LIFE",
                      accent: "text-purple-400"
                    },
                    {
                      title: "Nuoto",
                      reward: "+20 LIFE",
                      accent: "text-cyan-300"
                    },
                    {
                      title: "Iron Protocol",
                      reward: "+10 LIFE",
                      accent: "text-fuchsia-300"
                    },
                    {
                      title: "Mindfulness",
                      reward: "+10 LIFE",
                      accent: "text-emerald-300"
                    }
                  ].map((item) => (
                    <div
                      key={item.title}
                      className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60 p-4 transition-all duration-500"
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent" />
                      <p className={`text-sm font-semibold ${item.accent}`}>{item.title}</p>
                      <p className="mt-1 text-xs text-slate-400">Obiettivo settimanale</p>
                      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80">
                        <div className="h-full w-1/4 rounded-full bg-slate-600/70" />
                      </div>
                      <div className="mt-2 text-[11px] text-slate-500 font-mono">0/0</div>
                      <div className="mt-3 rounded-full border border-white/10 bg-slate-900/60 px-3 py-1 text-[10px] font-semibold text-slate-300">
                        {item.reward}
                      </div>
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/30 backdrop-blur-md">
                        <Lock className="h-5 w-5 text-fuchsia-200 animate-pulse drop-shadow-[0_0_12px_rgba(217,70,239,0.8)]" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="col-span-12 lg:col-span-4 flex flex-col gap-4 lg:min-h-0">
            <div
              className={`rounded-3xl bg-slate-900/40 backdrop-blur-xl border border-white/10 shadow-2xl p-5 flex flex-col flex-1 lg:min-h-0 transition-all duration-500 ${
                isDisconnected ? "grayscale-[0.3] saturate-75" : ""
              } ${isActivitiesExpanded ? "" : "lg:h-full"}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">LOG ATTIVITA</p>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-white">Cronologia</h2>
                    {isWalletConnected &&
                    !isLoading &&
                    !loadError &&
                    (activities.length === 0 || syncNotice === "synced") ? (
                      <CheckCircle className="h-4 w-4 text-emerald-300 drop-shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-200">
                    Questa settimana: {weeklyCounts.run} corse, {weeklyCounts.swim} nuoti,
                    {" "}
                    {formatDistance(weeklyTotals.totalDistance)} totali
                  </p>
                  <div className="mt-3 flex items-end gap-1">
                    {weeklyActivityTotals.map((value, index) => {
                      const height = Math.max(
                        8,
                        Math.round((value / weeklyActivityMax) * 32)
                      );
                      return (
                        <span
                          key={`week-activity-${index}`}
                          className="flex h-8 w-2 items-end"
                        >
                          <span
                            className={`w-full rounded-full ${
                              value > 0 ? "bg-cyan-300/80" : "bg-slate-700/70"
                            }`}
                            style={{ height: `${height}px` }}
                          />
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge label="Run + Swim + Iron + Mind" tone="neutral" />
                  {activeFilter ? (
                    <button
                      type="button"
                      onClick={() => setActiveFilter(null)}
                      className="inline-flex items-center rounded-full border border-cyan-400/40 px-3 py-1 text-[11px] font-semibold text-cyan-100 transition hover:border-cyan-300/70 hover:text-cyan-50"
                    >
                      Reset filtro
                    </button>
                  ) : null}
                </div>
              </div>

              {!isWalletConnected ? (
                <div className="relative mt-4 flex-1 min-h-0">
                  <div className="space-y-3 blur-sm opacity-50">
                    {(activities.length > 0 ? activities.slice(0, 6) : Array.from({ length: 6 }).map((_, index) => ({
                      id: `ghost-${index}`,
                      type: "Run",
                      distance: 5200,
                      reward: 0
                    }))).map((activity) => {
                      const display = getActivityDisplay(activity as ActivityItem);
                      return (
                        <div
                          key={activity.id as string}
                          className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-slate-900/40 backdrop-blur-xl p-4 shadow-2xl transition-all duration-500"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <span className="text-lg">{activityIcon(activity.type)}</span>
                              <span className="text-sm text-slate-100">
                                {display.label}{" "}
                                <span className="font-mono text-slate-200">
                                  {display.detail}
                                </span>
                              </span>
                            </div>
                            <StatusBadge label={formatActivityType(activity.type)} tone="neutral" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="rounded-3xl border border-white/10 bg-slate-950/70 px-5 py-4 text-center text-sm text-slate-200 shadow-2xl">
                      Sblocca la tua storia atletica. Connetti il wallet per visualizzare i tuoi successi on-chain.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex flex-col">
                  <div className="space-y-3">
                    {isLoading ? (
                      <StatusBadge label="Caricamento attività..." tone="neutral" />
                    ) : loadError ? (
                      <StatusBadge label={loadError} tone="error" />
                  ) : visibleActivities.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-5 text-center">
                      <div className="text-3xl">🏁</div>
                      <p className="mt-3 text-sm font-semibold text-white">
                        {activeFilter
                          ? "Nessuna attività per questo filtro."
                          : "Sei pronto a iniziare?"}
                      </p>
                      <p className="mt-2 text-xs text-slate-300">
                        Completa un allenamento su Strava e torna qui per vedere i
                        tuoi progressi.
                      </p>
                    </div>
                  ) : (
                    activityPreview.map((activity) => {
                      const display = getActivityDisplay(activity);
                      const rewardShare = formatRewardShare(activity.reward ?? 0);
                      return (
                          <div
                            key={activity.id ?? `${activity.type}-${activity.date}`}
                            className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-slate-900/40 backdrop-blur-xl p-4 shadow-2xl transition-all duration-500"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <span className="text-lg">{activityIcon(activity.type)}</span>
                                <span className="text-sm text-slate-100">
                                  {display.label}{" "}
                                  <span className="font-mono text-slate-200">
                                    {display.detail}
                                  </span>
                                {isWalletConnected ? (
                                  <span className="font-mono text-cyan-200">
                                    {" "}
                                    +{activity.reward ?? 0} LIFE
                                  {rewardShare ? (
                                    <span className="ml-2 text-[11px] text-slate-200">
                                      ({rewardShare})
                                    </span>
                                  ) : null}
                                  </span>
                                ) : null}
                                </span>
                              </div>
                              <div className="hidden sm:inline-flex">
                                <StatusBadge
                                  label={formatActivityType(activity.type)}
                                  tone="neutral"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {!isLoading && !loadError && hasMoreActivities ? (
                    <button
                      type="button"
                      onClick={() => setShowAllActivities((prev) => !prev)}
                      className="mt-4 inline-flex items-center justify-center rounded-full border border-cyan-400/40 px-4 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/70 hover:text-cyan-50"
                    >
                      {isActivitiesExpanded ? "Nascondi" : "Mostra di piu"}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        </section>
        <style jsx global>{`
          @keyframes lifequestShine {
            0% {
              transform: translateX(-120%);
              opacity: 0;
            }
            25% {
              opacity: 0.6;
            }
            55% {
              transform: translateX(120%);
              opacity: 0;
            }
            100% {
              transform: translateX(120%);
              opacity: 0;
            }
          }
          .lifequest-trophy-shine {
            background: linear-gradient(
              120deg,
              transparent 0%,
              rgba(56, 189, 248, 0.18) 45%,
              transparent 70%
            );
            animation: lifequestShine 6s ease-in-out infinite;
          }
        `}</style>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div>Caricamento...</div>}>
      <HomeContent />
    </Suspense>
  );
}

function MissionCard({
  icon,
  title,
  description,
  reward,
  hideReward,
  status,
  current,
  target,
  isComplete,
  isActive,
  onClick,
  sparkline,
  className
}: {
  icon: ReactNode;
  title: string;
  description: string;
  reward: string;
  hideReward: boolean;
  status?: string;
  current?: number;
  target?: number;
  isComplete?: boolean;
  isActive?: boolean;
  onClick?: () => void;
  sparkline?: number[];
  className?: string;
}) {
  const safeCurrent = Math.max(0, current ?? 0);
  const safeTarget = Math.max(1, target ?? 1);
  const normalizedProgress = Math.min(safeCurrent, safeTarget);
  const isCompleted = Boolean(isComplete);
  const sparklineMax = sparkline ? Math.max(1, ...sparkline) : 1;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full overflow-hidden rounded-2xl border bg-slate-900/40 backdrop-blur-xl border-white/10 shadow-2xl p-5 text-left transition-all duration-500 ${
        isCompleted
          ? "border-cyan-400/70 bg-cyan-500/10 shadow-[0_0_25px_rgba(34,211,238,0.35)]"
          : isActive
            ? "border-cyan-400/50"
            : "border-white/10"
      } hover:-translate-y-0.5 hover:scale-[1.02] hover:border-purple-500/40 ${className ?? ""}`}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-purple-500/70 via-cyan-400/70 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      {isCompleted ? (
        <span className="pointer-events-none absolute inset-0 rounded-2xl bg-cyan-400/5 animate-pulse" />
      ) : null}
      <span className="pointer-events-none absolute -top-8 right-6 h-20 w-20 rounded-full bg-cyan-500/10 blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-1 transform group-hover:scale-105 transition-transform">{icon}</div>
          <div>
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            {sparkline ? (
              <div className="mt-2 flex items-end gap-1">
                {sparkline.map((value, index) => {
                  const height = Math.max(2, Math.round((value / sparklineMax) * 12));
                  return (
                    <span
                      key={`${title}-spark-${index}`}
                      className="w-1 rounded-full bg-cyan-400/80 shadow-[0_0_6px_rgba(34,211,238,0.5)]"
                      style={{ height }}
                    />
                  );
                })}
              </div>
            ) : null}
            <p className="mt-1 text-xs text-slate-400">{description}</p>
            {status ? (
              <span className="mt-2 inline-flex rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-300 font-mono">
                {status}
              </span>
            ) : null}
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest">Premio</span>
          {hideReward ? (
            <span className="mt-1 block text-xs text-slate-400">Connetti il wallet</span>
          ) : (
            <span className="mt-1 block text-sm font-bold text-purple-300 font-mono">
              +{reward} LIFE
            </span>
          )}
        </div>
      </div>

      {!hideReward ? (
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-1">
            {Array.from({ length: safeTarget }).map((_, index) => (
              <span
                key={`${title}-dot-${index}`}
                className={`h-1.5 w-1.5 rounded-full ${
                  index < normalizedProgress
                    ? "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
                    : "bg-slate-700/80"
                }`}
              />
            ))}
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            {normalizedProgress}/{safeTarget}
          </span>
        </div>
      ) : null}
    </button>
  );
}

function ConfettiBurst({ seed }: { seed: number }) {
  const pieces = useMemo(() => {
    const colors = ["#22d3ee", "#a855f7", "#38bdf8", "#f472b6", "#facc15"];
    return Array.from({ length: 28 }, (_, index) => {
      const size = 6 + Math.random() * 6;
      return {
        id: `${seed}-${index}`,
        left: Math.random() * 100,
        delay: Math.random() * 0.2,
        duration: 1.2 + Math.random() * 0.6,
        size,
        drift: (Math.random() - 0.5) * 240,
        color: colors[index % colors.length]
      };
    });
  }, [seed]);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className="confetti-piece absolute top-0 rounded-sm"
          style={{
            left: `${piece.left}%`,
            width: `${piece.size}px`,
            height: `${piece.size * 0.6}px`,
            backgroundColor: piece.color,
            animationDuration: `${piece.duration}s`,
            animationDelay: `${piece.delay}s`,
            ["--drift" as any]: `${piece.drift}px`
          }}
        />
      ))}
      <style jsx>{`
        .confetti-piece {
          opacity: 0;
          animation-name: confetti-fall;
          animation-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
          animation-fill-mode: forwards;
          filter: drop-shadow(0 0 6px rgba(34, 211, 238, 0.5));
        }

        @keyframes confetti-fall {
          0% {
            transform: translate3d(0, -20px, 0) rotate(0deg);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          100% {
            transform: translate3d(var(--drift), 110vh, 0) rotate(720deg);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

function PerfectWeekOverlay({ reward }: { reward: number }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-6 backdrop-blur-sm">
      <div className="relative max-w-md rounded-3xl border border-amber-400/50 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-8 text-center shadow-[0_0_35px_rgba(251,191,36,0.35)]">
        <div className="absolute -top-6 left-1/2 h-12 w-12 -translate-x-1/2 rounded-full bg-amber-400/20 blur-xl" />
        <p className="text-xs uppercase tracking-[0.3em] text-amber-200">Perfect Week</p>
        <h3 className="mt-3 text-2xl font-bold text-amber-100">
          MISSIONE SETTIMANALE COMPIUTA:{" "}
          <span className="font-mono text-amber-200">+{reward} LIFE</span>
        </h3>
        <p className="mt-2 text-sm text-amber-200">
          Bonus speciale sbloccato
        </p>
        <div className="mt-4 rounded-full border border-amber-400/40 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-100 font-mono">
          BONUS PERFETTO
        </div>
      </div>
    </div>
  );
}
