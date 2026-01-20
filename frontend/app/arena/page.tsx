"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bolt, Swords, Timer, Trophy, UserPlus, X } from "lucide-react";

const rivals = [
  { id: "neo", name: "Neo", level: 7 },
  { id: "mira", name: "Mira", level: 9 },
  { id: "xen", name: "Xen", level: 5 },
  { id: "vex", name: "Vex", level: 11 },
  { id: "sable", name: "Sable", level: 6 }
];

const duels = [
  {
    id: "run-20",
    title: "Corsa 20km",
    you: { name: "Tu", progress: 12, total: 20 },
    rival: { name: "Mira", progress: 15, total: 20 },
    timeLeft: "2 giorni",
    stake: "50 LIFE"
  },
  {
    id: "swim-8",
    title: "Nuoto 8km",
    you: { name: "Tu", progress: 3.4, total: 8 },
    rival: { name: "Vex", progress: 2.8, total: 8 },
    timeLeft: "18 ore",
    stake: "30 LIFE"
  },
  {
    id: "gym-6",
    title: "Palestra 6 sessioni",
    you: { name: "Tu", progress: 4, total: 6 },
    rival: { name: "Neo", progress: 5, total: 6 },
    timeLeft: "4 giorni",
    stake: "70 LIFE"
  }
];

function progressPercent(current: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((current / total) * 100));
}

export default function ArenaPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);

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
            {duels.map((duel) => {
              const youPct = progressPercent(duel.you.progress, duel.you.total);
              const rivalPct = progressPercent(
                duel.rival.progress,
                duel.rival.total
              );

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

                  <div className="mt-5 rounded-full border border-white/10 bg-slate-950/80 p-2">
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
            })}
          </div>
        </section>
      </div>

      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
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
            <p className="mt-3 text-sm text-slate-300">
              Placeholder: seleziona il tipo di sfida, durata/obiettivo e posta
              in gioco.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {["Corsa", "Nuoto", "Palestra"].map((label) => (
                <button
                  key={label}
                  type="button"
                  className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-red-400/50 hover:text-white"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-3">
              <div className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-xs text-slate-300">
                Durata/Obiettivo (es. 20 km / 7 giorni)
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-xs text-slate-300">
                Posta in gioco (es. 50 LIFE)
              </div>
            </div>
            <button
              type="button"
              className="mt-5 w-full rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200"
            >
              Crea Sfida (coming soon)
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
