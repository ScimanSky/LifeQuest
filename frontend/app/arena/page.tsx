"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bolt,
  Swords,
  Timer,
  Trophy,
  UserPlus,
  X
} from "lucide-react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { formatEther, parseAbi, parseEther, type Address } from "viem";
import { supabase } from "../../utils/supabase";

const rivals = [
  { id: "neo", name: "Neo", level: 7 },
  { id: "mira", name: "Mira", level: 9 },
  { id: "xen", name: "Xen", level: 5 },
  { id: "vex", name: "Vex", level: 11 },
  { id: "sable", name: "Sable", level: 6 }
];

const CHALLENGE_DURATION_DAYS = 7;

const LIFE_TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_LIFE_TOKEN_ADDRESS ??
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as Address;
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;
const LIFE_TOKEN_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
]);
type ArenaDuel = {
  id: string;
  title: string;
  type?: string | null;
  unit?: string | null;
  you: { name: string; progress: number; total: number };
  rival: { name: string; progress: number; total: number };
  timeLeft: string;
  stake: string;
};

type ChallengeRow = {
  id?: string;
  title?: string | null;
  type?: string | null;
  goal?: number | string | null;
  unit?: string | null;
  stake?: number | string | null;
  rival?: string | null;
  user_address?: string | null;
  you_progress?: number | string | null;
  rival_progress?: number | string | null;
  duration_days?: number | null;
  created_at?: string | null;
};

function progressPercent(current: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((current / total) * 100));
}

function formatTimeLeft(createdAt?: string | null, durationDays = CHALLENGE_DURATION_DAYS) {
  if (!createdAt) return `${durationDays} giorni`;
  const start = new Date(createdAt);
  if (Number.isNaN(start.getTime())) return `${durationDays} giorni`;
  const end = new Date(start);
  end.setDate(start.getDate() + durationDays);
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

function buildDuelFromRow(row: ChallengeRow): ArenaDuel {
  const type = row.type ?? "Corsa";
  const goalValue = Number(row.goal) || 1;
  const unit = row.unit ?? (type === "Palestra" ? "sessioni" : "km");
  const title = row.title ?? `${type} ${goalValue} ${unit}`;
  const stakeValue = Number(row.stake) || 0;
  const youProgress = Number(row.you_progress) || 0;
  const rivalProgress = Number(row.rival_progress) || 0;
  return {
    id: row.id ?? `${type}-${Date.now()}`,
    title,
    type,
    unit,
    you: { name: "Tu", progress: youProgress, total: goalValue },
    rival: { name: row.rival ?? "Avversario", progress: rivalProgress, total: goalValue },
    timeLeft: formatTimeLeft(row.created_at, row.duration_days ?? CHALLENGE_DURATION_DAYS),
    stake: `${stakeValue} LIFE`
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

export default function ArenaPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [challengeType, setChallengeType] = useState("Corsa");
  const [challengeGoal, setChallengeGoal] = useState("");
  const [challengeStake, setChallengeStake] = useState("");
  const [challengeRival, setChallengeRival] = useState(rivals[0]?.name ?? "");
  const [challenges, setChallenges] = useState<ArenaDuel[]>([]);
  const [isChallengesLoading, setIsChallengesLoading] = useState(true);
  const [challengesError, setChallengesError] = useState<string | null>(null);
  const [isSavingChallenge, setIsSavingChallenge] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { address, isConnected } = useAccount();
  const {
    data: burnTxHash,
    isPending: isBurnPending,
    writeContract
  } = useWriteContract();
  const {
    isLoading: isBurnConfirming,
    isSuccess: isBurnSuccess
  } = useWaitForTransactionReceipt({
    hash: burnTxHash,
    query: {
      enabled: Boolean(burnTxHash)
    }
  });
  const { data: lifeBalance } = useReadContract({
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
  const pendingChallengeRef = useRef<{
    type: string;
    goal: string;
    stake: number;
    rival: string;
    unit: string;
  } | null>(null);

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

  const challengeConfig = useMemo(() => {
    if (challengeType === "Nuoto") {
      return {
        unit: "metri",
        chips: ["500", "1000", "2000"]
      };
    }
    if (challengeType === "Palestra") {
      return {
        unit: "sessioni",
        chips: ["3", "5", "10"]
      };
    }
    return {
      unit: "km",
      chips: ["5", "10", "21"]
    };
  }, [challengeType]);

  const stakeValue = Number(challengeStake);
  const isChallengeValid = useMemo(() => {
    return (
      challengeRival.trim().length > 0 &&
      challengeGoal.trim().length > 2 &&
      isConnected &&
      lifeBalanceValue !== null &&
      Number.isFinite(stakeValue) &&
      stakeValue > 0 &&
      stakeValue <= lifeBalanceValue
    );
  }, [challengeGoal, challengeRival, isConnected, lifeBalanceValue, stakeValue]);
  const isBurning = isBurnPending || isBurnConfirming;
  const createLabel = isBurnPending
    ? "Waiting validation..."
    : isBurnConfirming
      ? "Conferma on-chain..."
      : isSavingChallenge
        ? "Salvataggio..."
        : "Crea Sfida";

  const handleCreateChallenge = () => {
    if (!isChallengeValid) return;

    const payload = {
      type: challengeType,
      goal: challengeGoal.trim(),
      stake: stakeValue,
      rival: challengeRival,
      unit: challengeConfig.unit
    };
    pendingChallengeRef.current = payload;
    writeContract({
      address: LIFE_TOKEN_ADDRESS,
      abi: LIFE_TOKEN_ABI,
      functionName: "transfer",
      args: [BURN_ADDRESS, parseEther(payload.stake.toString())]
    });
  };

  useEffect(() => {
    if (!isBurnSuccess || !pendingChallengeRef.current) return;
    const payload = pendingChallengeRef.current;
    pendingChallengeRef.current = null;

    const saveChallenge = async () => {
      setIsSavingChallenge(true);
      setSaveError(null);
      const insertPayload = {
        title: `${payload.type} ${payload.goal} ${payload.unit}`,
        type: payload.type,
        goal: Number(payload.goal),
        unit: payload.unit,
        stake: payload.stake,
        rival: payload.rival,
        user_address: address ?? null
      };
      const { error } = await supabase.from("challenges").insert(insertPayload);
      if (error) {
        setSaveError("Errore nel salvataggio della sfida.");
        setIsSavingChallenge(false);
        return;
      }
      await fetchChallenges();
      setIsSavingChallenge(false);
      setIsModalOpen(false);
      setChallengeGoal("");
      setChallengeStake("");
    };

    void saveChallenge();
  }, [address, fetchChallenges, isBurnSuccess]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.18),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(14,165,233,0.12),transparent_55%)]" />

      <div className="relative mx-auto w-full max-w-6xl px-6 py-12 md:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 transition hover:text-cyan-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Torna alla Dashboard
          </Link>
          <div className="inline-flex items-center gap-2 rounded-full border border-red-400/40 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-200">
            <Bolt className="h-4 w-4" />
            Arena 1vs1
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
            <h2 className="text-xl font-semibold text-white">Rivali</h2>
            <span className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Amici
            </span>
          </div>
          <div className="mt-5 flex items-center gap-4 overflow-x-auto pb-2">
            {rivals.map((rival) => (
              <div
                key={rival.id}
                className="flex min-w-[110px] flex-col items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-5 text-center shadow-lg"
              >
                <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-red-500/50 to-purple-500/40 text-lg font-bold text-white shadow-[0_0_18px_rgba(239,68,68,0.5)]">
                  {rival.name.slice(0, 2).toUpperCase()}
                  <span className="absolute inset-0 rounded-full ring-2 ring-red-400/40" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{rival.name}</p>
                  <p className="text-xs text-slate-400">Lv. {rival.level}</p>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="flex min-w-[110px] flex-col items-center gap-3 rounded-2xl border border-dashed border-cyan-400/50 bg-slate-900/30 px-4 py-5 text-center text-cyan-200 transition hover:border-cyan-300 hover:text-cyan-100"
            >
              <UserPlus className="h-6 w-6" />
              <span className="text-xs font-semibold">Aggiungi</span>
            </button>
          </div>
        </section>

        <section className="mt-12">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-white">Sfide Attive</h2>
            <span className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Active Duels
            </span>
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
            ) : challenges.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6 text-sm text-slate-300">
                Nessuna sfida attiva al momento. Crea la prima per iniziare!
              </div>
            ) : (
              challenges.map((duel) => {
                const youPct = progressPercent(duel.you.progress, duel.you.total);
                const rivalPct = progressPercent(
                  duel.rival.progress,
                  duel.rival.total
                );
                const duelType = resolveDuelType(duel);
                const gapValue = duel.you.progress - duel.rival.progress;
                const gapLabel = formatGapLabel(duelType, gapValue, duel.unit);
                const status =
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
                const showStravaLink = duelType === "Corsa" || duelType === "Nuoto";

                return (
                  <div
                    key={duel.id}
                    className="rounded-3xl border border-white/10 bg-slate-900/50 p-6 shadow-2xl"
                  >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        Sfida
                      </p>
                      <h3 className="mt-1 text-lg font-semibold text-white">
                        {duel.title}
                      </h3>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200">
                      <Trophy className="h-4 w-4" />
                      Scommetti {duel.stake}
                    </div>
                  </div>

                  <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
                    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                        {duel.you.name}
                      </p>
                      <p className="mt-2 text-lg font-semibold text-cyan-200">
                        {duel.you.progress}/{duel.you.total}
                      </p>
                      <p className="text-xs text-slate-400">Progresso</p>
                      {showStravaLink ? (
                        <a
                          href="https://www.strava.com/record"
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex text-xs font-semibold text-cyan-200 transition hover:text-cyan-100"
                        >
                          Apri Strava per registrare
                        </a>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-center text-sm font-semibold text-red-200">
                      VS
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                        {duel.rival.name}
                      </p>
                      <p className="mt-2 text-lg font-semibold text-red-200">
                        {duel.rival.progress}/{duel.rival.total}
                      </p>
                      <p className="text-xs text-slate-400">Progresso</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${status.tone}`}
                    >
                      {status.label}
                    </span>
                    <span className="text-xs font-semibold text-slate-200">
                      Distacco {gapLabel}
                    </span>
                  </div>

                  <div className="mt-3 rounded-full border border-white/10 bg-slate-950/80 p-2">
                    <div className="relative flex h-3 overflow-hidden rounded-full bg-slate-800/80">
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
            <div className="mt-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                Scegli Rivale
              </p>
              <div className="mt-3 flex items-center gap-3 overflow-x-auto pb-2">
                {rivals.map((rival) => (
                  <button
                    key={`modal-${rival.id}`}
                    type="button"
                    onClick={() => setChallengeRival(rival.name)}
                    className={`flex min-w-[110px] flex-col items-center gap-2 rounded-2xl border px-3 py-3 text-xs transition ${
                      challengeRival === rival.name
                        ? "border-red-400/70 bg-red-500/10 text-white"
                        : "border-white/10 bg-slate-950/60 text-slate-300 hover:border-red-400/40 hover:text-white"
                    }`}
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-red-500/50 to-purple-500/40 text-sm font-bold">
                      {rival.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="text-[11px]">{rival.name}</span>
                  </button>
                ))}
              </div>
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
                Durata/Obiettivo ({challengeConfig.unit})
                <input
                  value={challengeGoal}
                  onChange={(event) => setChallengeGoal(event.target.value)}
                  placeholder={`Es. ${challengeConfig.chips[0]} ${challengeConfig.unit}`}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-red-400/60"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {challengeConfig.chips.map((chip) => (
                  <button
                    key={`chip-${chip}`}
                    type="button"
                    onClick={() => setChallengeGoal(chip)}
                    className="rounded-full border border-white/10 bg-slate-950/60 px-3 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-red-400/50 hover:text-white"
                  >
                    {chip} {challengeConfig.unit}
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
              disabled={!isChallengeValid || isBurning || isSavingChallenge}
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
