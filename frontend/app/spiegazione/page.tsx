import React from "react";
import { ArrowLeft, Zap, Shield, TrendingUp, Activity } from "lucide-react";
import Link from "next/link";

export default function SpiegazionePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-12 font-sans">
      {/* Header con tasto ritorno */}
      <div className="max-w-4xl mx-auto mb-12">
        <Link
          href="/"
          className="inline-flex items-center text-purple-400 hover:text-purple-300 transition-colors mb-6 group"
        >
          <ArrowLeft className="w-5 h-5 mr-2 group-hover:-translate-x-1 transition-transform" />
          Torna alla Dashboard
        </Link>
        <h1 className="text-4xl md:text-6xl font-extrabold bg-gradient-to-r from-purple-500 to-cyan-400 bg-clip-text text-transparent mb-4">
          IL PROTOCOLLO LIFEQUEST
        </h1>
        <p className="text-xl text-slate-400">
          Trasforma la tua disciplina fisica in asset digitali sulla blockchain Polygon.
        </p>
      </div>

      <div className="max-w-4xl mx-auto grid gap-8">
        {/* Sezione: Cos'è il Token LIFE */}
        <section className="bg-slate-900/50 border border-slate-800 p-8 rounded-3xl backdrop-blur-xl shadow-2xl">
          <div className="flex items-center mb-4">
            <Shield className="w-8 h-8 text-cyan-400 mr-4" />
            <h2 className="text-2xl font-bold">Cos'è il Token LIFE?</h2>
          </div>
          <p className="text-slate-300 leading-relaxed">
            Il LIFE è un token Web3 emesso sulla rete <strong>Polygon Amoy</strong>.
            Non è una valuta che si acquista: si forgia esclusivamente attraverso l'azione reale.
            Ogni token nel tuo wallet è la prova immutabile dei tuoi allenamenti e della tua costanza.
          </p>
        </section>

        {/* Sezione: Tabella Missioni Aggiornata */}
        <section className="bg-slate-900/50 border border-slate-800 p-8 rounded-3xl backdrop-blur-xl">
          <div className="flex items-center mb-6">
            <Zap className="w-8 h-8 text-purple-500 mr-4" />
            <h2 className="text-2xl font-bold">Il Ciclo delle Ricompense</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="pb-4">Missione</th>
                  <th className="pb-4">Requisito Strava</th>
                  <th className="pb-4">Premio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                <tr>
                  <td className="py-4 font-semibold">🏃 Corsa (Run)</td>
                  <td className="py-4 text-slate-400">&gt; 1.0 km</td>
                  <td className="py-4 text-cyan-400 font-bold">+50 LIFE</td>
                </tr>
                <tr>
                  <td className="py-4 font-semibold">🏊 Nuoto (Swim)</td>
                  <td className="py-4 text-slate-400">&gt; 250 m</td>
                  <td className="py-4 text-cyan-400 font-bold">+40 LIFE</td>
                </tr>
                <tr>
                  <td className="py-4 font-semibold">🏋️ Iron Protocol (Gym)</td>
                  <td className="py-4 text-slate-400">Weight Training</td>
                  <td className="py-4 text-cyan-400 font-bold">+30 LIFE</td>
                </tr>
                <tr>
                  <td className="py-4 font-semibold">🧘 Mindfulness</td>
                  <td className="py-4 text-slate-400">Yoga / Recupero</td>
                  <td className="py-4 text-cyan-400 font-bold">+10 LIFE</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Sezione: Sistema di Rango e Carriera */}
        <section className="bg-slate-900/50 border border-slate-800 p-8 rounded-3xl backdrop-blur-xl">
          <div className="flex items-center mb-6">
            <TrendingUp className="w-8 h-8 text-purple-400 mr-4" />
            <h2 className="text-2xl font-bold">Sistema di Rango e Carriera</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="pb-4">Rango</th>
                  <th className="pb-4">Soglia LIFE</th>
                  <th className="pb-4">Livelli</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                <tr>
                  <td className="py-4 font-semibold">Neofita</td>
                  <td className="py-4 text-slate-400">0 - 1500</td>
                  <td className="py-4 text-slate-400">Lv 1-5</td>
                </tr>
                <tr>
                  <td className="py-4 font-semibold">Challenger</td>
                  <td className="py-4 text-slate-400">1501 - 5000</td>
                  <td className="py-4 text-slate-400">Lv 6-10</td>
                </tr>
                <tr>
                  <td className="py-4 font-semibold">Elite</td>
                  <td className="py-4 text-slate-400">5001 - 15000</td>
                  <td className="py-4 text-slate-400">Lv 11-20</td>
                </tr>
                <tr>
                  <td className="py-4 font-semibold">Legend</td>
                  <td className="py-4 text-slate-400">15001+</td>
                  <td className="py-4 text-slate-400">Lv 21+</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-6 rounded-2xl border border-cyan-500/20 bg-slate-950/60 p-4">
            <p className="text-slate-300">
              <strong>The Ignition</strong>: Il primo traguardo dell'atleta. Si ottiene al superamento
              dei 1.500 LIFE e segna il passaggio al rango Challenger. Sblocca un bonus estetico ciano
              sulla dashboard.
            </p>
          </div>
        </section>

        {/* Sezione: Livelli ed XP */}
        <section className="grid md:grid-cols-2 gap-8">
          <div className="bg-slate-900/50 border border-slate-800 p-8 rounded-3xl backdrop-blur-xl">
            <div className="flex items-center mb-4">
              <TrendingUp className="w-8 h-8 text-purple-400 mr-4" />
              <h2 className="text-2xl font-bold">Evoluzione XP</h2>
            </div>
            <p className="text-slate-300">
              Ogni token LIFE guadagnato aumenta la tua barra XP. Raggiungi le soglie critiche
              per salire di livello (attualmente sei al <strong>Livello 5</strong>) e sbloccare
              moltiplicatori di ricompensa futuri.
            </p>
          </div>
          <div className="bg-slate-900/50 border border-slate-800 p-8 rounded-3xl backdrop-blur-xl">
            <div className="flex items-center mb-4">
              <Activity className="w-8 h-8 text-cyan-400 mr-4" />
              <h2 className="text-2xl font-bold">Verifica Strava</h2>
            </div>
            <p className="text-slate-300">
              Il sistema utilizza il <strong>Silent Sync</strong>: una volta autorizzato Strava
              la prima volta, il server verificherà i tuoi allenamenti in background senza chiederti più nulla.
            </p>
          </div>
        </section>

        {/* CTA Finale */}
        <div className="text-center py-12">
          <p className="text-slate-500 mb-6 italic">"Domina la tua giornata. Forgia il tuo futuro."</p>
          <Link
            href="/"
            className="px-8 py-4 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full font-bold hover:scale-105 transition-transform shadow-[0_0_20px_rgba(147,51,234,0.3)]"
          >
            Inizia la Sfida Ora
          </Link>
        </div>
      </div>
    </div>
  );
}
