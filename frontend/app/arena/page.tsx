"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bolt,
  Swords,
  Timer,
  Trophy,
  X
} from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useBalance,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract
} from "wagmi";
import { formatEther, parseAbi, parseEther, type Address } from "viem";
import { polygonAmoy } from "viem/chains";
import { supabase } from "../../utils/supabase";

const CHALLENGE_DURATION_DAYS = 7;
const CHALLENGE_DURATION_OPTIONS = ["1", "2", "3", "4", "5", "6", "7"];
const ARENA_POLL_INTERVAL_MS = 60000;
const ARENA_POLLING_ENABLED = false;
const ARENA_ARCHIVE_AFTER_DAYS = 1;
const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const EXPECTED_CHAIN_ID = polygonAmoy.id;
const MIN_GAS_WEI = parseEther("0.005");

const LIFE_TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_LIFE_TOKEN_ADDRESS ??
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as Address;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;
const OWNER_ADDRESS = (process.env.NEXT_PUBLIC_OWNER_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as Address;
const LIFE_TOKEN_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)"
]);
type ArenaDuel = {
  id: string;
  title: string;
  type?: string | null;
  unit?: string | null;
  status?: string | null;
  creatorAddress?: string | null;
  opponentAddress?: string | null;
  winnerAddress?: string | null;
  creatorClaimed?: boolean;
  opponentClaimed?: boolean;
  creatorProgress: number;
  opponentProgress: number;
  durationDays: number;
  startAt?: string | null;
  endAt?: string | null;
  resolvedAt?: string | null;
  you: { name: string; progress: number; total: number };
  rival: { name: string; progress: number; total: number };
  timeLeft: string;
  stake: string;
  stakeValue: number;
};

type ChallengeRow = {
  id?: string;
  creator_address?: string | null;
  opponent_name?: string | null;
  opponent_address?: string | null;
  type?: string | null;
  goal?: number | string | null;
  stake?: number | string | null;
  status?: string | null;
  duration_days?: number | string | null;
  start_at?: string | null;
  end_at?: string | null;
  winner_address?: string | null;
  creator_progress?: number | string | null;
  opponent_progress?: number | string | null;
  creator_claimed?: boolean | null;
  opponent_claimed?: boolean | null;
  created_at?: string | null;
  resolved_at?: string | null;
};

function progressPercent(current: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((current / total) * 100));
}

function formatTimeLeft(endAt?: string | null, fallbackDays = CHALLENGE_DURATION_DAYS) {
  if (!endAt) return `${fallbackDays} giorni`;
  const end = new Date(endAt);
  if (Number.isNaN(end.getTime())) return `${fallbackDays} giorni`;
  const diffMs = end.getTime() - Date.now();
  if (diffMs <= 0) return "Scaduta";
  const hours = Math.ceil(diffMs / (1000 * 60 * 60));
  if (hours < 24) return `${hours} ore`;
  const days = Math.ceil(hours / 24);
  return `${days} giorni`;
}

function resolveDuelType(duel: { type?: string | null; title: string }) {
  if (duel.type) return duel.type;
  const title = duel.title.toLowerCase();
  if (title.includes("nuoto")) return "Nuoto";
  if (title.includes("palestra") || title.includes("gym")) return "Palestra";
  return "Corsa";
}

function formatShortAddress(address?: string | null) {
  if (!address) return "Avversario";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function buildDuelFromRow(row: ChallengeRow): ArenaDuel {
  const type = row.type ?? "Corsa";
  const goalValue = Number(row.goal) || 1;
  const unit = type === "Palestra" ? "sessioni" : type === "Nuoto" ? "metri" : "km";
  const title = `${type} ${goalValue} ${unit}`;
  const stakeValue = Number(row.stake) || 0;
  const durationDays = Number(row.duration_days) || CHALLENGE_DURATION_DAYS;
  const startAt = row.start_at ?? row.created_at ?? null;
  let endAt = row.end_at ?? null;
  if (!endAt && startAt) {
    const startDate = new Date(startAt);
    if (!Number.isNaN(startDate.getTime())) {
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + durationDays);
      endAt = endDate.toISOString();
    }
  }
  const creatorProgress = Number(row.creator_progress) || 0;
  const opponentProgress = Number(row.opponent_progress) || 0;
  const resolvedAt = row.resolved_at ?? null;
  return {
    id: row.id ?? `${type}-${Date.now()}`,
    title,
    type,
    unit,
    status: row.status ?? "active",
    creatorAddress: row.creator_address ?? null,
    opponentAddress: row.opponent_address ?? null,
    winnerAddress: row.winner_address ?? null,
    creatorClaimed: Boolean(row.creator_claimed),
    opponentClaimed: Boolean(row.opponent_claimed),
    creatorProgress,
    opponentProgress,
    durationDays,
    startAt,
    endAt,
    resolvedAt,
    you: { name: "Tu", progress: 0, total: goalValue },
    rival: {
      name: row.opponent_name || formatShortAddress(row.opponent_address),
      progress: 0,
      total: goalValue
    },
    timeLeft: formatTimeLeft(endAt, durationDays),
    stake: `${stakeValue} LIFE`,
    stakeValue
  };
}

function formatGapLabel(type: string, gap: number, unit?: string | null) {
  if (!Number.isFinite(gap)) return "0";
  const sign = gap > 0 ? "+" : gap < 0 ? "-" : "";
  const abs = Math.abs(gap);

  if (type === "Palestra" || unit === "sessioni") {
    const value = Math.round(abs);
    return `${sign}${value} sessioni`;
  }

  if (type === "Nuoto" || unit === "metri") {
    const meters = Math.round(abs);
    return `${sign}${meters} m`;
  }

  if (abs < 1) {
    const meters = Math.round(abs * 1000);
    return `${sign}${meters} m`;
  }

  const value = abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(1);
  return `${sign}${value} km`;
}

function buildMissingTokenMessage(
  missingWallets: string[],
  address?: string,
  isPartial?: boolean
) {
  if (!missingWallets.length) {
    return "Collega Strava per aggiornare i progressi.";
  }
  const normalized = address ? address.toLowerCase() : null;
  const missingSelf = normalized
    ? missingWallets.some(
        (wallet) => wallet?.toLowerCase?.() === normalized
      )
    : false;
  const missingOthers = normalized
    ? missingWallets.filter(
        (wallet) => wallet?.toLowerCase?.() !== normalized
      )
    : missingWallets;
  if (missingSelf && missingOthers.length) {
    return isPartial
      ? "Modalita test: solo un wallet aggiorna i progressi."
      : "Tu e l'avversario dovete collegare Strava.";
  }
  if (missingSelf) {
    return isPartial
      ? "Modalita test: i tuoi progressi non sono conteggiati."
      : "Collega Strava per far aggiornare i progressi.";
  }
  if (missingOthers.length) {
    return isPartial
      ? "Modalita test: progressi avversario non disponibili."
      : "Avversario non ha collegato Strava.";
  }
  return "Strava non collegato per aggiornare i progressi.";
}

function buildRateLimitMessage(retryAfter?: number) {
  const candidate = retryAfter ?? 60;
  const safeRetry = Number.isFinite(candidate) ? candidate : 60;
  const seconds = Math.max(10, safeRetry);
  return `Limite Strava raggiunto. Riprova tra ${seconds}s.`;
}

function useClaimConfetti() {
  const [showConfetti, setShowConfetti] = useState(false);
  const [seed, setSeed] = useState(0);
  const timerRef = useRef<number | null>(null);

  const trigger = useCallback((duration = 2000) => {
    setSeed((prev) => prev + 1);
    setShowConfetti(true);
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setShowConfetti(false);
    }, duration);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { showConfetti, seed, trigger };
}

function parseNumericInput(value: string) {
  const cleaned = value.replace(/[^\d.,-]/g, "").replace(",", ".");
  return Number(cleaned);
}

function getTxErrorMessage(error: unknown) {
  const message =
    (error as { shortMessage?: string; message?: string })?.shortMessage ??
    (error as { message?: string })?.message ??
    "";
  const normalized = message.toLowerCase();

  if (normalized.includes("user rejected") || normalized.includes("denied")) {
    return "Transazione rifiutata in MetaMask.";
  }
  if (normalized.includes("insufficient funds")) {
    return "MATIC insufficiente per pagare il gas.";
  }
  if (normalized.includes("nonce too low")) {
    return "Hai una transazione in attesa. Apri MetaMask e annulla o accelera.";
  }
  if (normalized.includes("replacement transaction underpriced")) {
    return "Transazione già in corso. Attendi o accelera la precedente.";
  }
  if (normalized.includes("execution reverted")) {
    return "Transazione rifiutata dal contratto. Controlla saldo LIFE o rete.";
  }
  if (normalized.includes("transfer amount exceeds balance")) {
    return "Saldo LIFE insufficiente.";
  }
  if (normalized.includes("internal json-rpc error")) {
    return "Errore RPC. Controlla rete Amoy e saldo MATIC.";
  }

  return "Errore transazione. Riprova tra poco.";
}

export default function ArenaPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [challengeType, setChallengeType] = useState("Corsa");
  const [challengeGoal, setChallengeGoal] = useState("");
  const [challengeStake, setChallengeStake] = useState("");
  const [challengeDuration, setChallengeDuration] = useState("7");
  const [challenges, setChallenges] = useState<ArenaDuel[]>([]);
  const [isChallengesLoading, setIsChallengesLoading] = useState(true);
  const [challengesError, setChallengesError] = useState<string | null>(null);
  const [isSavingChallenge, setIsSavingChallenge] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [acceptingChallengeId, setAcceptingChallengeId] = useState<string | null>(null);
  const [acceptStage, setAcceptStage] = useState<"transferring" | "updating" | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [claimingChallengeId, setClaimingChallengeId] = useState<string | null>(null);
  const [claimStage, setClaimStage] = useState<"claiming" | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [refreshingChallengeId, setRefreshingChallengeId] = useState<string | null>(null);
  const lastProgressSyncRef = useRef(0);
  const [arenaWarnings, setArenaWarnings] = useState<Record<string, string>>({});
  const {
    showConfetti: showClaimConfetti,
    seed: claimConfettiSeed,
    trigger: triggerClaimConfetti
  } = useClaimConfetti();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { data: nativeBalance } = useBalance({
    address,
    query: {
      enabled: Boolean(address)
    }
  });
  const { data: lifeBalance, refetch: refetchLifeBalance } = useReadContract({
    address: LIFE_TOKEN_ADDRESS,
    abi: LIFE_TOKEN_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address)
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
  const fetchChallenges = useCallback(async () => {
    setIsChallengesLoading(true);
    setChallengesError(null);
    const { data, error } = await supabase
      .from("challenges")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      setChallengesError("Errore nel caricamento delle sfide.");
      setChallenges([]);
    } else {
      const list = Array.isArray(data) ? data.map((row) => buildDuelFromRow(row)) : [];
      setChallenges(list);
    }
    setIsChallengesLoading(false);
  }, []);

  useEffect(() => {
    void fetchChallenges();
  }, [fetchChallenges]);

  const visibleChallenges = useMemo(() => {
    if (!challenges.length) return [];
    const archiveAfterMs = ARENA_ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();
    return challenges.filter((duel) => {
      const status = duel.status ?? "active";
      if (!["resolved", "draw", "claimed"].includes(status)) return true;
      const anchor = duel.resolvedAt || duel.endAt;
      if (!anchor) return true;
      const timestamp = new Date(anchor).getTime();
      if (Number.isNaN(timestamp)) return true;
      return now - timestamp < archiveAfterMs;
    });
  }, [challenges]);

  const arenaRecap = useMemo(() => {
    if (!address) return null;
    const addressLower = address.toLowerCase();
    let wins = 0;
    let losses = 0;
    let draws = 0;
    let total = 0;
    for (const duel of challenges) {
      const isCreator = duel.creatorAddress?.toLowerCase() === addressLower;
      const isOpponent = duel.opponentAddress?.toLowerCase() === addressLower;
      if (!isCreator && !isOpponent) continue;
      const status = duel.status ?? "active";
      if (status === "draw") {
        draws += 1;
        total += 1;
        continue;
      }
      if (status === "resolved" || status === "claimed") {
        const winner =
          duel.winnerAddress?.toLowerCase() === addressLower;
        if (winner) {
          wins += 1;
        } else {
          losses += 1;
        }
        total += 1;
      }
    }
    return { wins, losses, draws, total };
  }, [address, challenges]);

  const resolveExpiredChallenge = useCallback(
    async (duel: ArenaDuel) => {
      if (!BACKEND_BASE_URL) return;
      if (duel.status !== "matched") return;
      if (!duel.endAt) return;
      const endTime = new Date(duel.endAt).getTime();
      if (Number.isNaN(endTime) || endTime > Date.now()) return;
      try {
        const response = await fetch(`${BACKEND_BASE_URL}/arena/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challengeId: duel.id })
        });
        const data = await response.json();
        if (
          data?.status === "missing_tokens" ||
          data?.status === "partial" ||
          data?.status === "rate_limited"
        ) {
          const missing = Array.isArray(data.missing_wallets)
            ? data.missing_wallets
            : [];
          const rateMessage =
            data?.status === "rate_limited"
              ? buildRateLimitMessage(data?.retry_after)
              : null;
          setArenaWarnings((prev) => ({
            ...prev,
            [duel.id]:
              rateMessage ??
              buildMissingTokenMessage(
                missing,
                address,
                data?.status === "partial"
              )
          }));
        } else {
          setArenaWarnings((prev) => {
            if (!prev[duel.id]) return prev;
            const { [duel.id]: _, ...rest } = prev;
            return rest;
          });
        }
      } catch (error) {
        console.error("Errore risoluzione sfida:", error);
      }
    },
    [address]
  );

  const updateChallengeProgress = useCallback(async (duel: ArenaDuel) => {
    if (!BACKEND_BASE_URL) return;
    if (duel.status !== "matched") return;
    if (!duel.startAt) return;
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/arena/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: duel.id })
      });
      const data = await response.json();
      if (
        data?.status === "missing_tokens" ||
        data?.status === "partial" ||
        data?.status === "rate_limited"
      ) {
        const missing = Array.isArray(data.missing_wallets)
          ? data.missing_wallets
          : [];
        const rateMessage =
          data?.status === "rate_limited"
            ? buildRateLimitMessage(data?.retry_after)
            : null;
        setArenaWarnings((prev) => ({
          ...prev,
          [duel.id]:
            rateMessage ??
            buildMissingTokenMessage(
              missing,
              address,
              data?.status === "partial"
            )
        }));
      } else {
        setArenaWarnings((prev) => {
          if (!prev[duel.id]) return prev;
          const { [duel.id]: _, ...rest } = prev;
          return rest;
        });
      }
    } catch (error) {
      console.error("Errore aggiornamento progressi:", error);
    }
  }, [address]);

  const handleRefreshProgress = useCallback(
    async (duel: ArenaDuel) => {
      setRefreshingChallengeId(duel.id);
      await updateChallengeProgress(duel);
      await fetchChallenges();
      setRefreshingChallengeId(null);
    },
    [fetchChallenges, updateChallengeProgress]
  );

  useEffect(() => {
    if (!ARENA_POLLING_ENABLED) return;
    if (!challenges.length) return;
    const expired = challenges.filter(
      (duel) =>
        duel.status === "matched" &&
        duel.endAt &&
        new Date(duel.endAt).getTime() <= Date.now()
    );
    if (!expired.length) return;
    void Promise.all(expired.map(resolveExpiredChallenge)).then(fetchChallenges);
  }, [challenges, fetchChallenges, resolveExpiredChallenge]);

  useEffect(() => {
    if (!ARENA_POLLING_ENABLED) return;
    if (!challenges.length) return;
    const active = challenges.filter(
      (duel) => duel.status === "matched" && duel.startAt
    );
    if (!active.length) return;
    const now = Date.now();
    if (now - lastProgressSyncRef.current < ARENA_POLL_INTERVAL_MS) return;
    lastProgressSyncRef.current = now;
    void Promise.all(active.map(updateChallengeProgress)).then(fetchChallenges);
  }, [challenges, fetchChallenges, updateChallengeProgress]);

  useEffect(() => {
    if (!ARENA_POLLING_ENABLED) return;
    if (typeof window === "undefined") return;
    if (!BACKEND_BASE_URL) return;
    if (!challenges.length) return;
    const resolving = challenges.filter((duel) => {
      if (duel.status !== "matched" || !duel.endAt) return false;
      const endTime = new Date(duel.endAt).getTime();
      return !Number.isNaN(endTime) && endTime <= Date.now();
    });
    const active = challenges.filter(
      (duel) => duel.status === "matched" && duel.startAt
    );
    if (!resolving.length && !active.length) return;

    const intervalId = window.setInterval(() => {
      const tasks = [
        ...resolving.map(resolveExpiredChallenge),
        ...active.map(updateChallengeProgress)
      ];
      void Promise.all(tasks).then(fetchChallenges);
    }, ARENA_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [challenges, fetchChallenges, resolveExpiredChallenge, updateChallengeProgress]);

  const challengeConfig = useMemo(() => {
    if (challengeType === "Nuoto") {
      return {
        unit: "metri",
        chips: [
          { value: "500" },
          { value: "1000" },
          { value: "2000" },
          { value: "2500" },
          { value: "3000" },
          { value: "3500" },
          { value: "4000" }
        ]
      };
    }
    if (challengeType === "Palestra") {
      return {
        unit: "sessioni",
        chips: [{ value: "3" }, { value: "5" }, { value: "10" }]
      };
    }
    return {
      unit: "km",
      chips: [
        { value: "5" },
        { value: "10" },
        { value: "15" },
        { value: "20" },
        { value: "42.2", label: "Maratona" }
      ]
    };
  }, [challengeType]);
  const selectedGoalChip = useMemo(() => {
    if (!challengeConfig.chips.length) return null;
    return (
      challengeConfig.chips.find((chip) => chip.value === challengeGoal) ??
      challengeConfig.chips[0]
    );
  }, [challengeConfig, challengeGoal]);
  const goalDisplay = selectedGoalChip
    ? selectedGoalChip.label
      ? `${selectedGoalChip.label} (${selectedGoalChip.value})`
      : `${selectedGoalChip.value}`
    : "";
  const durationLabel = challengeDuration;

  useEffect(() => {
    if (!challengeConfig.chips.length) return;
    const values = challengeConfig.chips.map((chip) => chip.value);
    if (values.includes(challengeGoal)) return;
    setChallengeGoal(challengeConfig.chips[0].value);
  }, [challengeConfig, challengeGoal]);

  const stakeValue = parseNumericInput(challengeStake);
  const goalValue = parseNumericInput(challengeGoal);
  const durationValue = parseNumericInput(challengeDuration);
  const isChallengeValid = useMemo(() => {
    return (
      Number.isFinite(goalValue) &&
      goalValue > 0 &&
      Number.isFinite(durationValue) &&
      durationValue > 0 &&
      isConnected &&
      lifeBalanceValue !== null &&
      Number.isFinite(stakeValue) &&
      stakeValue > 0 &&
      stakeValue <= lifeBalanceValue
    );
  }, [
    goalValue,
    durationValue,
    isConnected,
    lifeBalanceValue,
    stakeValue
  ]);
  const isBurning = isTransferring;
  const createLabel = isApproving
    ? "Approvo LIFE..."
    : isTransferring
      ? "Creo Sfida..."
      : isSavingChallenge
        ? "Salvataggio..."
        : "Crea Sfida";

  const handleCreateChallenge = useCallback(async () => {
    // 1. Controlli preliminari
    if (!isChallengeValid || !address || !publicClient) return;
    setSaveError(null);
    if (chainId && chainId !== EXPECTED_CHAIN_ID) {
      setSaveError("Rete non corretta. Passa a Polygon Amoy.");
      try {
        await switchChainAsync({ chainId: EXPECTED_CHAIN_ID });
      } catch (error) {
        console.error("Errore switch network:", error);
      }
      return;
    }
    if (nativeBalance && nativeBalance.value < MIN_GAS_WEI) {
      setSaveError("MATIC insufficiente per il gas.");
      return;
    }

    // 2. Pulizia dati (Risolve errore 400 Supabase)
    const goalValue = parseNumericInput(challengeGoal);
    const stakeValue = parseNumericInput(challengeStake);
    const durationValue = parseNumericInput(challengeDuration);

    if (!Number.isFinite(goalValue) || goalValue <= 0) {
      setSaveError("Obiettivo non valido.");
      return;
    }
    if (!Number.isFinite(durationValue) || durationValue <= 0) {
      setSaveError("Durata non valida.");
      return;
    }
    if (!Number.isFinite(stakeValue) || stakeValue <= 0) {
      setSaveError("Stake non valido.");
      return;
    }

    // Conversione per Blockchain
    const stakeWei = parseEther(stakeValue.toString());
    const rpcChainId = await publicClient.getChainId();
    if (rpcChainId !== EXPECTED_CHAIN_ID) {
      setSaveError("RPC non su Amoy. Cambia RPC e riprova.");
      return;
    }
    const onchainBalance = await publicClient.readContract({
      address: LIFE_TOKEN_ADDRESS,
      abi: LIFE_TOKEN_ABI,
      functionName: "balanceOf",
      args: [address]
    });
    if (onchainBalance < stakeWei) {
      setSaveError("Saldo LIFE insufficiente.");
      return;
    }

    try {
      // 3. Trasferimento Blockchain (Semplificato: niente approve)
      setIsTransferring(true);

      // NOTA: per scalare il saldo inviamo al burn address.
      const destinationAddress = BURN_ADDRESS;

      const { request } = await publicClient.simulateContract({
        address: LIFE_TOKEN_ADDRESS,
        abi: LIFE_TOKEN_ABI,
        functionName: "transfer",
        args: [destinationAddress, stakeWei],
        account: address
      });
      const transferHash = await writeContractAsync(request);

      await publicClient.waitForTransactionReceipt({ hash: transferHash });
      setIsTransferring(false);

      // 4. Salvataggio su Supabase
      setIsSavingChallenge(true);

      const insertPayload = {
        creator_address: address, // Corretto: corrisponde al DB
        opponent_name: null,
        type: challengeType,
        goal: goalValue, // Corretto: Numero
        stake: stakeValue, // Corretto: Numero
        duration_days: durationValue,
        status: "active"
      };

      console.log("Dati finali per DB:", insertPayload);

      const { error } = await supabase.from("challenges").insert([insertPayload]);

      if (error) {
        console.error("Errore Supabase:", error);
        throw new Error("Salvataggio DB fallito");
      }

      // 5. Successo!
      setIsSavingChallenge(false);
      setIsModalOpen(false);
      // Ricarica per mostrare la nuova sfida
      window.location.reload();
    } catch (error) {
      console.error("Errore Creazione:", error);
      setSaveError(getTxErrorMessage(error));
      setIsApproving(false);
      setIsTransferring(false);
      setIsSavingChallenge(false);
    }
  }, [
    address,
    chainId,
    challengeGoal,
    challengeDuration,
    challengeStake,
    challengeType,
    isChallengeValid,
    nativeBalance,
    publicClient,
    switchChainAsync,
    writeContractAsync
    // Rimosso refetchAllowance e allowanceValue perche non servono piu
  ]);

  const handleAcceptChallenge = useCallback(
    async (duel: ArenaDuel) => {
      if (!address || !publicClient) return;
      if (duel.status !== "active") return;
      if (duel.creatorAddress?.toLowerCase() === address.toLowerCase()) return;
      if (chainId && chainId !== EXPECTED_CHAIN_ID) {
        setAcceptError("Rete non corretta. Passa a Polygon Amoy.");
        try {
          await switchChainAsync({ chainId: EXPECTED_CHAIN_ID });
        } catch (error) {
          console.error("Errore switch network:", error);
        }
        return;
      }
      if (nativeBalance && nativeBalance.value < MIN_GAS_WEI) {
        setAcceptError("MATIC insufficiente per il gas.");
        return;
      }

      const stakeValue = duel.stakeValue;
      if (!Number.isFinite(stakeValue) || stakeValue <= 0) {
        setAcceptError("Stake non valido.");
        return;
      }
      const stakeWei = parseEther(stakeValue.toString());
      const rpcChainId = await publicClient.getChainId();
      if (rpcChainId !== EXPECTED_CHAIN_ID) {
        setAcceptError("RPC non su Amoy. Cambia RPC e riprova.");
        return;
      }
      const onchainBalance = await publicClient.readContract({
        address: LIFE_TOKEN_ADDRESS,
        abi: LIFE_TOKEN_ABI,
        functionName: "balanceOf",
        args: [address]
      });
      if (onchainBalance < stakeWei) {
        setAcceptError("Saldo LIFE insufficiente.");
        return;
      }

      setAcceptError(null);
      setAcceptingChallengeId(duel.id);

      try {
        setAcceptStage("transferring");
        const { request } = await publicClient.simulateContract({
          address: LIFE_TOKEN_ADDRESS,
          abi: LIFE_TOKEN_ABI,
          functionName: "transfer",
          args: [BURN_ADDRESS, stakeWei],
          account: address
        });
        const transferHash = await writeContractAsync(request);
        await publicClient.waitForTransactionReceipt({ hash: transferHash });

        setAcceptStage("updating");
        const startAt = new Date();
        const endAt = new Date(startAt);
        endAt.setDate(startAt.getDate() + (duel.durationDays || CHALLENGE_DURATION_DAYS));
        const { data, error } = await supabase
          .from("challenges")
          .update({
            status: "matched",
            opponent_address: address,
            start_at: startAt.toISOString(),
            end_at: endAt.toISOString()
          })
          .eq("id", duel.id)
          .eq("status", "active")
          .select("id");
        if (error) {
          console.error(error);
          setAcceptError("Errore aggiornamento sfida.");
          return;
        }
        if (!data || data.length === 0) {
          setAcceptError("Sfida già accettata da un altro utente.");
          return;
        }

        await fetchChallenges();
        await refetchLifeBalance();
        if (typeof window !== "undefined") {
          window.localStorage.setItem("lifequest:balance-refresh", Date.now().toString());
        }
      } catch (error) {
        console.error(error);
        setAcceptError(getTxErrorMessage(error));
      } finally {
        setAcceptStage(null);
        setAcceptingChallengeId(null);
      }
    },
    [
      address,
      chainId,
      fetchChallenges,
      nativeBalance,
      publicClient,
      refetchLifeBalance,
      switchChainAsync,
      writeContractAsync
    ]
  );

  const handleClaimChallenge = useCallback(
    async (duel: ArenaDuel) => {
      if (!address) return;
      if (!BACKEND_BASE_URL) {
        setClaimError("Backend non configurato.");
        return;
      }
      setClaimError(null);
      setClaimingChallengeId(duel.id);
      setClaimStage("claiming");
      try {
        const response = await fetch(`${BACKEND_BASE_URL}/arena/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challengeId: duel.id,
            walletAddress: address
          })
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || "Errore claim.");
        }
        if (duel.status === "resolved") {
          triggerClaimConfetti();
        }
        await fetchChallenges();
        await refetchLifeBalance();
        if (typeof window !== "undefined") {
          window.localStorage.setItem("lifequest:balance-refresh", Date.now().toString());
        }
      } catch (error) {
        console.error(error);
        const message =
          (error as { message?: string })?.message ?? "Errore claim.";
        setClaimError(message);
      } finally {
        setClaimStage(null);
        setClaimingChallengeId(null);
      }
    },
    [address, fetchChallenges, refetchLifeBalance]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.18),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(14,165,233,0.12),transparent_55%)]" />
      {showClaimConfetti ? <ConfettiBurst seed={claimConfettiSeed} /> : null}

      <div className="relative mx-auto w-full max-w-6xl px-6 py-12 md:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 transition hover:text-cyan-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Torna alla Dashboard
          </Link>
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-red-400/40 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-200">
              <Bolt className="h-4 w-4" />
              Arena 1vs1
            </div>
            <div className="scale-[0.9]">
              <ConnectButton />
            </div>
          </div>
        </div>

        <header className="mt-8 rounded-3xl border border-white/10 bg-slate-900/50 p-8 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.4em] text-slate-400">
            <Swords className="h-4 w-4 text-red-300" />
            Arena
          </div>
          <h1 className="mt-4 text-3xl font-bold text-white md:text-5xl">
            Entra in Arena. Vinci con il sudore.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-300 md:text-lg">
            Sfida altri atleti in duelli 1vs1. Ogni km conta, ogni sessione sposta
            la bilancia. Solo uno avra la gloria.
          </p>
        </header>

        <section className="mt-12">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-white">Sfide Attive</h2>
            <span className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Active Duels
            </span>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/40 px-4 py-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                Recap Arena
              </p>
              <p className="text-sm font-semibold text-slate-100">
                {arenaRecap ? `${arenaRecap.total} sfide giocate` : "Collega il wallet per il recap"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-emerald-200">
                Vittorie {arenaRecap ? arenaRecap.wins : "—"}
              </span>
              <span className="rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-rose-200">
                Sconfitte {arenaRecap ? arenaRecap.losses : "—"}
              </span>
              <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-amber-200">
                Pareggi {arenaRecap ? arenaRecap.draws : "—"}
              </span>
            </div>
          </div>
          <div className="mt-6 grid gap-5">
            {isChallengesLoading ? (
              <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6 text-sm text-slate-300">
                Caricamento sfide...
              </div>
            ) : challengesError ? (
              <div className="rounded-3xl border border-rose-400/40 bg-rose-500/10 p-6 text-sm text-rose-200">
                {challengesError}
              </div>
            ) : visibleChallenges.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6 text-sm text-slate-300">
                Nessuna sfida attiva al momento. Crea la prima per iniziare!
              </div>
            ) : (
              visibleChallenges.map((duel) => {
                const viewerIsCreator =
                  Boolean(address && duel.creatorAddress) &&
                  duel.creatorAddress?.toLowerCase() ===
                    (address?.toLowerCase() ?? "");
                const youProgress =
                  viewerIsCreator || !address
                    ? duel.creatorProgress
                    : duel.opponentProgress;
                const rivalProgress =
                  viewerIsCreator || !address
                    ? duel.opponentProgress
                    : duel.creatorProgress;
                const totalGoal = duel.you.total;
                const youProgressCapped = Math.min(youProgress, totalGoal);
                const rivalProgressCapped = Math.min(rivalProgress, totalGoal);
                const youPct = progressPercent(youProgressCapped, totalGoal);
                const rivalPct = progressPercent(rivalProgressCapped, totalGoal);
                const duelType = resolveDuelType(duel);
                const gapValue = youProgressCapped - rivalProgressCapped;
                const gapLabel = formatGapLabel(duelType, gapValue, duel.unit);
                const isCreator = viewerIsCreator;
                const isOpponent =
                  Boolean(address && duel.opponentAddress) &&
                  duel.opponentAddress?.toLowerCase() ===
                    (address?.toLowerCase() ?? "");
                const isParticipant = isCreator || isOpponent;
                const isWinner =
                  Boolean(address && duel.winnerAddress) &&
                  duel.winnerAddress?.toLowerCase() ===
                    (address?.toLowerCase() ?? "");
                const isDraw = duel.status === "draw";
                const progressBadge =
                  youPct > rivalPct
                    ? {
                        label: "Stai Vincendo! 🏆",
                        tone: "border-emerald-400/60 bg-emerald-500/15 text-emerald-200"
                      }
                    : youPct < rivalPct
                      ? {
                          label: "Recupera! 🔥",
                          tone: "border-rose-400/60 bg-rose-500/15 text-rose-200"
                        }
                      : {
                          label: "Testa a testa",
                          tone: "border-slate-600/70 bg-slate-700/40 text-slate-200"
                        };
                const isResolved =
                  duel.status === "resolved" ||
                  duel.status === "claimed" ||
                  isDraw;
                const resultBadge = isResolved
                  ? isDraw
                    ? {
                        label: "Pareggio 🤝",
                        tone: "border-amber-400/60 bg-amber-500/15 text-amber-200"
                      }
                    : isWinner
                      ? {
                          label: "Complimenti! Hai vinto la sfida 🏆",
                          tone:
                            "border-emerald-400/70 bg-emerald-500/20 text-emerald-200"
                        }
                      : isParticipant
                        ? {
                            label: "Sfida persa",
                            tone:
                              "border-rose-400/60 bg-rose-500/15 text-rose-200"
                          }
                        : {
                            label: "Sfida conclusa",
                            tone:
                              "border-slate-600/70 bg-slate-700/40 text-slate-200"
                          }
                  : null;
                const badge = resultBadge ?? progressBadge;
                const rivalName = isCreator
                  ? duel.rival.name
                  : formatShortAddress(duel.creatorAddress);
                const canAccept =
                  isConnected && !isCreator && duel.status === "active";
                const isAccepting = acceptingChallengeId === duel.id;
                const acceptLabel =
                  acceptStage === "transferring" && isAccepting
                    ? "Invio LIFE..."
                    : acceptStage === "updating" && isAccepting
                      ? "Entro in Arena..."
                      : "Accetta";
                const canRefresh = duel.status === "matched";
                const isRefreshing = refreshingChallengeId === duel.id;
                const statusLabel =
                  duel.status === "resolved"
                    ? "Conclusa"
                    : duel.status === "draw"
                      ? "Pareggio"
                      : duel.status === "claimed"
                        ? "Claim completato"
                        : duel.status === "matched"
                          ? "In corso"
                          : "Aperta";
                const statusTone =
                  duel.status === "resolved"
                    ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-200"
                    : duel.status === "draw"
                      ? "border-amber-400/60 bg-amber-500/15 text-amber-200"
                      : duel.status === "claimed"
                        ? "border-indigo-400/60 bg-indigo-500/15 text-indigo-200"
                        : duel.status === "matched"
                          ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
                          : "border-slate-600/70 bg-slate-700/40 text-slate-200";
                const statusText =
                  duel.status === "resolved"
                    ? "Conclusa, premi disponibili"
                    : duel.status === "draw"
                      ? "Pareggio, rimborso disponibile"
                      : duel.status === "claimed"
                        ? "Premio riscattato"
                        : duel.status === "matched"
                          ? "Sfida attiva"
                          : "Sfida aperta";
                const endTimestamp = duel.endAt
                  ? new Date(duel.endAt).getTime()
                  : null;
                const isExpired =
                  typeof endTimestamp === "number" &&
                  !Number.isNaN(endTimestamp) &&
                  endTimestamp <= Date.now();
                const isResolving =
                  duel.status === "matched" && Boolean(isExpired);
                const warningMessage = arenaWarnings[duel.id];
                const hasClaimed = isCreator
                  ? duel.creatorClaimed
                  : isOpponent
                    ? duel.opponentClaimed
                    : false;
                const canClaim =
                  isConnected &&
                  !hasClaimed &&
                  ((duel.status === "resolved" && isWinner) ||
                    (duel.status === "draw" && (isCreator || isOpponent)));
                const isClaiming = claimingChallengeId === duel.id;
                const claimLabel =
                  claimStage === "claiming" && isClaiming
                    ? "Claim in corso..."
                    : duel.status === "draw"
                      ? "Rimborso 85%"
                      : "Claim premio";

                return (
                  <div
                    key={duel.id}
                    className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-slate-900/50 p-3 shadow-[0_20px_50px_rgba(15,23,42,0.6)] transition hover:-translate-y-0.5 hover:border-cyan-400/40 hover:shadow-[0_25px_60px_rgba(14,165,233,0.18)]"
                  >
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.12),transparent_55%)]" />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        Sfida
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-white">
                        {duel.title}
                      </h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusTone}`}
                      >
                        {statusLabel}
                      </span>
                      <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200">
                        <Trophy className="h-4 w-4" />
                        Scommetti {duel.stake}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
                    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                        {duel.you.name}
                      </p>
                      <p className="mt-1 text-base font-semibold text-cyan-200">
                        {youProgressCapped}/{totalGoal}
                      </p>
                      <p className="text-xs text-slate-400">Progresso</p>
                    </div>

                    <div className="flex items-center justify-center text-sm font-semibold text-red-200">
                      VS
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                        {rivalName}
                      </p>
                      <p className="mt-1 text-base font-semibold text-red-200">
                        {rivalProgressCapped}/{totalGoal}
                      </p>
                      <p className="text-xs text-slate-400">Progresso</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${badge.tone}`}
                    >
                      {badge.label}
                    </span>
                    <span className="text-xs font-semibold text-slate-200">
                      Distacco {gapLabel}
                    </span>
                  </div>

                  <div className="mt-3 rounded-full border border-white/10 bg-slate-950/80 p-2">
                    <div className="relative flex h-2.5 overflow-hidden rounded-full bg-slate-800/80">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-400 to-cyan-200"
                        style={{ width: `${youPct}%` }}
                      />
                      <div
                        className="h-full bg-gradient-to-l from-red-500 to-red-300"
                        style={{ width: `${rivalPct}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
                      <span>Tu: {youPct}%</span>
                      <span>Avversario: {rivalPct}%</span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2 text-xs text-slate-300">
                    <Timer className="h-4 w-4 text-cyan-200" />
                    Tempo rimasto: {duel.timeLeft}
                  </div>
                  {isResolving ? (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-200">
                      <Timer className="h-3 w-3" />
                      In attesa di risoluzione automatica...
                    </div>
                  ) : null}
                  {warningMessage ? (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-200">
                      <Timer className="h-3 w-3" />
                      {warningMessage}
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs uppercase tracking-[0.3em] text-slate-400">
                      {statusText}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {canRefresh ? (
                        <button
                          type="button"
                          onClick={() => handleRefreshProgress(duel)}
                          disabled={isRefreshing}
                          className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                            !isRefreshing
                              ? "border border-cyan-400/50 bg-cyan-500/10 text-cyan-200 hover:border-cyan-300/70 hover:text-cyan-100"
                              : "border border-slate-700/60 bg-slate-900/60 text-slate-500 cursor-not-allowed"
                          }`}
                        >
                          {isRefreshing ? "Aggiorno..." : "Aggiorna progressi"}
                        </button>
                      ) : null}
                      {duel.status === "active" ? (
                        <button
                          type="button"
                          onClick={() => handleAcceptChallenge(duel)}
                          disabled={!canAccept || isAccepting}
                          className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                            canAccept && !isAccepting
                              ? "border border-red-400/50 bg-red-500/10 text-red-200 hover:border-red-300/70 hover:text-red-100"
                              : "border border-slate-700/60 bg-slate-900/60 text-slate-500 cursor-not-allowed"
                          }`}
                        >
                          {isConnected ? acceptLabel : "Connetti wallet"}
                        </button>
                      ) : null}
                    </div>
                    {duel.status === "resolved" || duel.status === "draw" ? (
                      <button
                        type="button"
                        onClick={() => handleClaimChallenge(duel)}
                        disabled={!canClaim || isClaiming}
                        className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                          canClaim && !isClaiming
                            ? "border border-emerald-400/60 bg-emerald-500/15 text-emerald-200 hover:border-emerald-300/80 hover:text-emerald-100"
                            : "border border-slate-700/60 bg-slate-900/60 text-slate-500 cursor-not-allowed"
                        }`}
                      >
                        {isConnected ? claimLabel : "Connetti wallet"}
                      </button>
                    ) : null}
                  </div>
                  {acceptError && isAccepting ? (
                    <div className="mt-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
                      {acceptError}
                    </div>
                  ) : null}
                  {claimError && isClaiming ? (
                    <div className="mt-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
                      {claimError}
                    </div>
                  ) : null}
                </div>
              );
            })
            )}
          </div>
        </section>
      </div>

      <button
        type="button"
        onClick={() => {
          setSaveError(null);
          setIsModalOpen(true);
        }}
        className="fixed bottom-6 right-6 z-20 flex items-center gap-2 rounded-full bg-gradient-to-r from-red-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_25px_rgba(239,68,68,0.5)] transition hover:scale-105"
      >
        ⚔️ Nuova Sfida
      </button>

      {isModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-6">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900/90 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Nuova Sfida</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-full border border-white/10 p-2 text-slate-300 transition hover:text-white"
                aria-label="Chiudi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {["Corsa", "Nuoto", "Palestra"].map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setChallengeType(label)}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    challengeType === label
                      ? "border-red-400/70 bg-red-500/20 text-white"
                      : "border-white/10 bg-slate-950/60 text-slate-200 hover:border-red-400/50 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-3">
              <label className="text-xs text-slate-300">
                Durata sfida (giorni)
                <div className="mt-2 flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
                  <span className="font-mono">{durationLabel}</span>
                  <span className="text-xs text-slate-400">
                    {challengeDuration === "1" ? "giorno" : "giorni"}
                  </span>
                </div>
              </label>
              <div className="flex flex-wrap gap-2">
                {CHALLENGE_DURATION_OPTIONS.map((option) => (
                  <button
                    key={`duration-${option}`}
                    type="button"
                    onClick={() => setChallengeDuration(option)}
                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                      challengeDuration === option
                        ? "border-red-400/70 bg-red-500/20 text-white"
                        : "border-white/10 bg-slate-950/60 text-slate-200 hover:border-red-400/50 hover:text-white"
                    }`}
                  >
                    {option} {option === "1" ? "giorno" : "giorni"}
                  </button>
                ))}
              </div>
              <label className="text-xs text-slate-300">
                Obiettivo ({challengeConfig.unit})
                <div className="mt-2 flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
                  <span className="font-mono">{goalDisplay}</span>
                  <span className="text-xs text-slate-400">
                    {challengeConfig.unit}
                  </span>
                </div>
              </label>
              <div className="flex flex-wrap gap-2">
                {challengeConfig.chips.map((chip) => (
                  <button
                    key={`chip-${chip.value}`}
                    type="button"
                    onClick={() => setChallengeGoal(chip.value)}
                    className="rounded-full border border-white/10 bg-slate-950/60 px-3 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-red-400/50 hover:text-white"
                  >
                    {chip.label
                      ? `${chip.label} (${chip.value} ${challengeConfig.unit})`
                      : `${chip.value} ${challengeConfig.unit}`}
                  </button>
                ))}
              </div>
              <label className="text-xs text-slate-300">
                Posta in gioco (LIFE)
                <input
                  type="number"
                  min="1"
                  value={challengeStake}
                  onChange={(event) => setChallengeStake(event.target.value)}
                  placeholder="Es. 50"
                  className={`mt-2 w-full rounded-xl border bg-slate-950/60 px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-red-400/60 ${
                    lifeBalanceValue !== null && stakeValue > lifeBalanceValue
                      ? "border-rose-400/70"
                      : "border-white/10"
                  }`}
                />
                {isConnected ? (
                  <p className="mt-2 text-[11px] text-emerald-200">
                    Saldo disponibile: {lifeBalanceFormatted} LIFE
                  </p>
                ) : (
                  <p className="mt-2 text-[11px] text-slate-400">
                    Connetti il wallet per scommettere.
                  </p>
                )}
              </label>
            </div>
            {saveError ? (
              <div className="mt-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
                {saveError}
              </div>
            ) : null}
            <button
              type="button"
              disabled={!isChallengeValid || isBurning || isApproving || isSavingChallenge}
              onClick={handleCreateChallenge}
              className="mt-5 w-full rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createLabel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
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
