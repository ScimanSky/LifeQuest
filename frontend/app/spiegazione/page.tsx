import Link from "next/link";
import {
  ArrowLeft,
  BadgePercent,
  Coins,
  Crown,
  Flame,
  Layers,
  ShoppingBag,
  Sparkles,
  Zap
} from "lucide-react";

const earnCards = [
  {
    title: "Corsa (Run)",
    rate: "10 LIFE / sessione",
    description: "Minimo 5 km per validare la ricompensa.",
    icon: "🏃",
    accent: "from-purple-500/20 to-cyan-500/20",
    ring: "ring-purple-400/40"
  },
  {
    title: "Nuoto (Swim)",
    rate: "20 LIFE / sessione",
    description: "Minimo 1 km per validare la ricompensa.",
    icon: "🏊",
    accent: "from-cyan-500/20 to-emerald-500/20",
    ring: "ring-cyan-400/40"
  },
  {
    title: "Workout & Yoga",
    rate: "10 LIFE / sessione",
    description: "Include Iron Protocol, CrossFit e Mindfulness.",
    icon: "🏋️",
    accent: "from-fuchsia-500/20 to-purple-500/20",
    ring: "ring-fuchsia-400/40"
  }
];

const loopSteps = [
  {
    label: "Step A",
    title: "Allenati e accumula LIFE base",
    description:
      "Ogni attività validata su Strava genera LIFE che finiscono nel tuo wallet.",
    icon: Flame
  },
  {
    label: "Step B",
    title: "Sali di Livello (Brucia LIFE)",
    description:
      "Spendere LIFE per avanzare sblocca moltiplicatori, badge e premi VIP.",
    icon: Sparkles
  },
  {
    label: "Step C",
    title: "Spendi nello Shop",
    description:
      "Trasforma LIFE in premi reali e benefici esclusivi della community.",
    icon: ShoppingBag
  }
];

const levelRows = [
  {
    tier: "Rookie",
    level: "Lv 1-4",
    multiplier: "1.0x",
    access: "Solo Sticker",
    icon: Layers
  },
  {
    tier: "Challenger",
    level: "Lv 5-9",
    multiplier: "1.2x",
    access: "Sconti Store (-20%)",
    icon: BadgePercent
  },
  {
    tier: "Elite",
    level: "Lv 10+",
    multiplier: "1.5x",
    access: "Gift Card & NFT Rari",
    icon: Crown
  }
];

export default function SpiegazionePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.15),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(34,211,238,0.12),transparent_55%)]" />

      <div className="relative mx-auto w-full max-w-6xl px-6 py-12 md:px-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 transition hover:text-cyan-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Torna alla Dashboard
        </Link>

        <header className="mt-8 rounded-3xl border border-white/10 bg-slate-900/50 p-8 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.4em] text-slate-400">
            <Coins className="h-4 w-4 text-cyan-300" />
            Tokenomics & Game Rules
          </div>
          <h1 className="mt-4 text-3xl font-bold text-white md:text-5xl">
            L&apos;Economia di LifeQuest
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-300 md:text-lg">
            Trasforma il sudore in valore. Ecco come funziona il ciclo economico
            che rende LIFE una risorsa reale e meritocratica.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-200">
              <Zap className="h-4 w-4" />
              Earn → Level → Spend
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-purple-400/40 bg-purple-500/10 px-4 py-2 text-xs font-semibold text-purple-200">
              Supply sostenuta da sforzo reale
            </span>
          </div>
        </header>

        <section className="mt-12">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-white">GUADAGNA (Earn)</h2>
            <span className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Rate ufficiali
            </span>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {earnCards.map((card) => (
              <div
                key={card.title}
                className={`group relative overflow-hidden rounded-3xl border border-white/10 bg-slate-900/40 p-6 shadow-[0_0_30px_rgba(15,23,42,0.6)] transition-all duration-300 hover:-translate-y-1 hover:border-cyan-400/40`}
              >
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${card.accent} opacity-0 transition-opacity duration-300 group-hover:opacity-100`}
                />
                <div
                  className={`relative flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950/70 text-2xl ring-1 ${card.ring}`}
                >
                  {card.icon}
                </div>
                <h3 className="relative mt-4 text-lg font-semibold text-white">
                  {card.title}
                </h3>
                <p className="relative mt-2 text-sm text-slate-300">
                  {card.rate}
                </p>
                <p className="relative mt-3 text-xs text-slate-400">
                  {card.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-white">IL CICLO (Core Loop)</h2>
            <span className="text-xs uppercase tracking-[0.3em] text-slate-400">
              3 step chiari
            </span>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {loopSteps.map((step) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.label}
                  className="rounded-3xl border border-white/10 bg-slate-900/40 p-6 shadow-2xl transition-all duration-300 hover:-translate-y-1 hover:border-purple-400/40"
                >
                  <div className="flex items-center gap-3 text-xs uppercase tracking-[0.3em] text-slate-400">
                    <span className="rounded-full border border-white/10 bg-slate-950/60 px-3 py-1">
                      {step.label}
                    </span>
                    <Icon className="h-4 w-4 text-purple-300" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-white">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-sm text-slate-300">
                    {step.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-14">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-white">TABELLA LIVELLI</h2>
            <span className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Incentivo a spendere
            </span>
          </div>
          <div className="mt-6 overflow-hidden rounded-3xl border border-white/10 bg-slate-900/40 shadow-2xl">
            <div className="grid grid-cols-4 gap-4 border-b border-white/10 bg-slate-950/40 px-6 py-4 text-xs uppercase tracking-[0.3em] text-slate-400">
              <span>Tier</span>
              <span>Livelli</span>
              <span>Moltiplicatore</span>
              <span>Accesso</span>
            </div>
            <div className="divide-y divide-white/10">
              {levelRows.map((row) => {
                const Icon = row.icon;
                return (
                  <div
                    key={row.tier}
                    className="grid grid-cols-4 items-center gap-4 px-6 py-5 text-sm text-slate-200 transition hover:bg-slate-900/60"
                  >
                    <span className="flex items-center gap-3 font-semibold text-white">
                      <Icon className="h-4 w-4 text-cyan-300" />
                      {row.tier}
                    </span>
                    <span className="text-slate-300">{row.level}</span>
                    <span className="font-mono text-cyan-200">{row.multiplier}</span>
                    <span className="text-slate-300">{row.access}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-6 rounded-2xl border border-purple-400/20 bg-purple-500/10 p-5 text-sm text-slate-200">
            Salire di livello richiede LIFE, ma sblocca ricompense che aumentano
            il valore percepito e la velocita di earning.
          </div>
        </section>

        <section className="mt-14 rounded-3xl border border-white/10 bg-slate-900/50 p-8 text-center shadow-2xl">
          <h2 className="text-2xl font-semibold text-white">Pronto a partire?</h2>
          <p className="mt-3 text-sm text-slate-300">
            Ogni sessione e un investimento nel tuo progresso. Entra nel ciclo
            di LifeQuest e fai crescere il tuo valore.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-gradient-to-r from-purple-600 to-cyan-400 px-8 py-3 text-sm font-semibold text-slate-950 shadow-[0_0_25px_rgba(34,211,238,0.4)] transition hover:scale-[1.03]"
          >
            Inizia la Missione
          </Link>
        </section>
      </div>
    </div>
  );
}
