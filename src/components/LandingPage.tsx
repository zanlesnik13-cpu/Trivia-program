import React, { useState } from 'react';
import {
  ArrowRight,
  Database,
  FileUp,
  Flame,
  Gamepad2,
  LogIn,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tv,
  Zap,
} from 'lucide-react';

interface LandingPageProps {
  onJoinGame: (roomCode: string) => void;
  onOpenHost: () => void;
  onOpenSupabaseModal: () => void;
  isHostLoggedIn: boolean;
  hostEmail?: string;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onJoinGame,
  onOpenHost,
  onOpenSupabaseModal,
  isHostLoggedIn,
  hostEmail,
}) => {
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = roomCode.trim().toUpperCase();
    if (!clean) {
      setError('Vnesi 4-mestno kodo sobe.');
      return;
    }
    if (clean.length !== 4) {
      setError('Koda sobe mora imeti natanko 4 znake.');
      return;
    }
    setError(null);
    onJoinGame(clean);
  };

  return (
    <div className="relative min-h-screen text-slate-100 flex flex-col justify-between overflow-hidden">
      {/* Ambientna neon osvetlitev v ozadju */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px]" />
        <div className="absolute top-1/3 -right-32 w-[550px] h-[550px] bg-emerald-500/15 rounded-full blur-[140px]" />
        <div className="absolute -bottom-32 left-1/4 w-[600px] h-[600px] bg-violet-600/15 rounded-full blur-[140px]" />
      </div>

      {/* Zgornja vrstica z logotipom in hitrim preklopom */}
      <header className="relative z-10 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-600 to-emerald-500 p-[1px] shadow-lg shadow-indigo-500/25">
            <div className="w-full h-full bg-slate-950 rounded-[15px] flex items-center justify-center">
              <Tv className="w-5 h-5 text-indigo-400" />
            </div>
          </div>
          <div>
            <span className="font-bold text-lg tracking-tight text-slate-100 font-display">
              QuizPulse <span className="text-emerald-400">Live</span>
            </span>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Moderna platforma za pub kvize v živo
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 sm:gap-3">
          <button
            onClick={onOpenSupabaseModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-semibold bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors cursor-pointer"
            title="Nastavitve Supabase povezave"
          >
            <Database className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Supabase</span>
          </button>

          <button
            id="landing-host-btn"
            onClick={onOpenHost}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-600/25 border border-indigo-400/30 transition-all cursor-pointer"
            title={hostEmail ? `Prijavljen kot ${hostEmail}` : 'Prijava za gostitelja'}
          >
            <LogIn className="w-4 h-4" />
            <span>
              {isHostLoggedIn
                ? hostEmail
                  ? `Host (${hostEmail.split('@')[0]})`
                  : 'Host Nadzorna plošča'
                : 'Prijava za gostitelja'}
            </span>
          </button>
        </div>
      </header>

      {/* Osrednji del: Hero vstopna kartica za igralce */}
      <main className="relative z-10 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-16 flex flex-col items-center text-center">
        {/* Značka na vrhu */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs sm:text-sm font-semibold mb-6 shadow-inner">
          <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
          <span>Kahoot / Jackbox stil &bull; Supabase Realtime &bull; Brez registracije</span>
        </div>

        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black text-slate-100 tracking-tight font-display max-w-4xl leading-[1.1]">
          Vodenje in igranje <br className="hidden sm:block" />
          <span className="bg-gradient-to-r from-indigo-400 via-violet-300 to-emerald-400 bg-clip-text text-transparent">
            pub kviza v živo
          </span>
        </h1>

        <p className="mt-4 sm:mt-6 text-base sm:text-lg text-slate-400 max-w-2xl leading-relaxed">
          Glavni zaslon za projektor, mobilni daljinec za gostitelja z avtomatskim točkovanjem ter hitra igra za tekmovalce z Jokerji za dvojne točke!
        </p>

        {/* VELIKA OSREDNJA KARTICA ZA TEKMOVALCE */}
        <div className="w-full max-w-md mt-10 bg-slate-900/80 backdrop-blur-2xl border-2 border-indigo-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-indigo-950/60 relative">
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-indigo-600 to-emerald-600 text-white text-[11px] font-bold uppercase tracking-wider shadow-md">
            🎮 Za tekmovalce in ekipe
          </div>

          <div className="space-y-4 pt-2">
            <div>
              <h2 className="text-2xl font-bold text-slate-100 font-display">
                Pridruži se kvizu
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Vpiši 4-mestno kodo sobe, ki jo vidiš na glavnem zaslonu ali platnu.
              </p>
            </div>

            <form onSubmit={handleJoinSubmit} className="space-y-4">
              <div>
                <input
                  id="landing-room-code-input"
                  type="text"
                  maxLength={4}
                  value={roomCode}
                  onChange={(e) => {
                    setRoomCode(e.target.value.toUpperCase());
                    setError(null);
                  }}
                  placeholder="KODA (npr. 8421)"
                  className="w-full h-16 rounded-2xl bg-slate-950/90 border-2 border-slate-700 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20 text-center font-mono-code font-black text-2xl sm:text-3xl tracking-[0.3em] uppercase text-emerald-300 placeholder:text-slate-600 placeholder:tracking-normal placeholder:font-normal placeholder:text-base outline-none transition-all shadow-inner"
                  autoComplete="off"
                  autoFocus
                />
                {error && (
                  <p className="text-xs font-semibold text-rose-400 mt-2">
                    {error}
                  </p>
                )}
              </div>

              <button
                id="landing-join-submit-btn"
                type="submit"
                className="w-full h-14 rounded-2xl font-bold text-base bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 transition-all transform active:scale-95 cursor-pointer"
              >
                <Gamepad2 className="w-5 h-5" />
                <span>Vstopi v igro</span>
                <ArrowRight className="w-4 h-4 ml-1" />
              </button>
            </form>

            <div className="pt-2 flex items-center justify-center gap-2 text-xs text-slate-400">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Samodejna ponovna povezava (Reconnect) ob izgubi interneta</span>
            </div>
          </div>
        </div>

        {/* LOČEN DEL ZA GOSTITELJE */}
        <div className="w-full max-w-md mt-6 p-4 rounded-2xl bg-slate-900/50 border border-slate-800/80 backdrop-blur-md flex items-center justify-between gap-4">
          <div className="text-left">
            <span className="text-xs font-bold text-slate-300 block">
              Organiziraš kviz?
            </span>
            <p className="text-[11px] text-slate-400">
              Ustvarjaj vprašanja, uvozi PDF ali zaženi sejo.
            </p>
          </div>

          <button
            onClick={onOpenHost}
            className="shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/30 transition-all cursor-pointer flex items-center gap-1.5"
          >
            <span>{isHostLoggedIn ? 'Nadzorna plošča' : 'Prijava gostitelja'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* PREDSTAVITEV GLAVNIH ZMOGLJIVOSTI (Feature Grid) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-16 w-full text-left">
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md space-y-2">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Zap className="w-5 h-5 text-indigo-400" />
            </div>
            <h3 className="font-bold text-sm text-slate-100">
              Supabase Realtime
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Trenutna sinhronizacija slajdov, časovnika in odgovorov med vsemi napravami brez zamikov.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md space-y-2">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Flame className="w-5 h-5 text-amber-400" />
            </div>
            <h3 className="font-bold text-sm text-slate-100">
              Jokerji za 2x Točke
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Taktika za igralce: ob uvodu v posamezno tematiko lahko aktivirajo Jokerja za podvojene točke.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md space-y-2">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Smartphone className="w-5 h-5 text-emerald-400" />
            </div>
            <h3 className="font-bold text-sm text-slate-100">
              Mobilni Daljinec
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Gostitelj z eno roko menja slajde, sproža časovnike in potrjuje avtomatsko ali ročno točkovanje.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md space-y-2">
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-400">
              <FileUp className="w-5 h-5 text-violet-400" />
            </div>
            <h3 className="font-bold text-sm text-slate-100">
              Uvoz PDF Predstavitev
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Naloži PowerPoint ali Canva PDF in aplikacija samodejno ustvari slajde visoke ločljivosti.
            </p>
          </div>
        </div>
      </main>

      {/* Noga strani */}
      <footer className="relative z-10 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
        <div>
          QuizPulse Live &bull; Ustvarjeno za pub kvize, šole in dogodke v živo.
        </div>
        <div className="flex items-center gap-4">
          <span>React 19 &bull; Vite &bull; Tailwind CSS &bull; Supabase</span>
        </div>
      </footer>
    </div>
  );
};
