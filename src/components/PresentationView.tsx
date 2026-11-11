import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import confetti from 'canvas-confetti';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Crown,
  ExternalLink,
  Eye,
  HelpCircle,
  Layers,
  Loader2,
  Maximize,
  Minimize,
  Radio,
  RefreshCw,
  Smartphone,
  Sparkles,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import {
  addDemoPlayer,
  fetchPresentationData,
  subscribeToDemoUpdates,
} from '../lib/quizService';
import { appendSupabaseConfigToUrl, getSupabaseClient } from '../lib/supabase';
import type { PresentationData } from '../types/quiz';

interface PresentationViewProps {
  sessionId: string;
  onExit?: () => void;
}

const DEMO_NICKNAMES = [
  'Kvizoljubi',
  'Pametnjakoviči',
  'Pivo in Znanje',
  'Krompirjevi Zmagovalci',
  'Einsteinovi Vajenci',
  'Hitri & Drzni',
  'Pub Legende',
  'Vsevedi',
  'Zadnja Miza',
  'Nič Ne Veva',
];

export const PresentationView: React.FC<PresentationViewProps> = ({
  sessionId,
  onExit,
}) => {
  const [data, setData] = useState<PresentationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [addingBot, setAddingBot] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showRemoteQrModal, setShowRemoteQrModal] = useState(false);
  const [copiedRemoteUrl, setCopiedRemoteUrl] = useState(false);

  // Časovnik v živo
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const confettiFiredRef = useRef<string | null>(null);

  // Nalaganje podatkov o seji
  const loadData = async () => {
    try {
      const presData = await fetchPresentationData(sessionId);
      setData(presData);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri nalaganju seje.');
    } finally {
      setLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  useEffect(() => {
    loadData();
  }, [sessionId]);

  // Realtime naročnina na Supabase & Demo BroadcastChannel s stabilnim fallbackom
  useEffect(() => {
    const supabase = getSupabaseClient();
    let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;

    if (supabase) {
      channel = supabase
        .channel(`presentation-${sessionId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'game_sessions', filter: `id=eq.${sessionId}` },
          (payload) => {
            if (payload && payload.new && typeof payload.new === 'object') {
              const updatedSession = payload.new as PresentationData['session'];
              setData((prev) => {
                if (!prev) return prev;
                const nextTheme =
                  prev.themes.find((t) => t.id === updatedSession.current_theme_id) ||
                  prev.currentTheme;
                const nextThemeSlides = nextTheme ? prev.slidesByTheme[nextTheme.id] || [] : [];
                const nextSlide =
                  nextThemeSlides.find((s) => s.id === updatedSession.current_slide_id) ||
                  prev.currentSlide;
                return {
                  ...prev,
                  session: { ...prev.session, ...updatedSession },
                  currentTheme: nextTheme,
                  currentSlide: nextSlide,
                };
              });
            }
            loadData();
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'players', filter: `session_id=eq.${sessionId}` },
          () => {
            loadData();
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'player_jokers', filter: `session_id=eq.${sessionId}` },
          () => {
            loadData();
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'answers', filter: `session_id=eq.${sessionId}` },
          () => {
            loadData();
          }
        )
        .subscribe();
    }

    // Demo način naročnina
    const unsubDemo = subscribeToDemoUpdates((event) => {
      if (!event.sessionId || event.sessionId === sessionId) {
        loadData();
      }
    });

    const localHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.sessionId || detail.sessionId === sessionId) {
        loadData();
      }
    };
    window.addEventListener('trivia_demo_local_update', localHandler);

    // Varnostni fallback ob vrnitvi fokusa ali ponovni povezavi
    const handleRevalidate = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadData();
      }
    };
    window.addEventListener('visibilitychange', handleRevalidate);
    window.addEventListener('focus', handleRevalidate);
    window.addEventListener('online', handleRevalidate);

    // Periodični varnostni heartbeat (vsakih 2.5 sekunde) proti zamrznitvi
    const fallbackPoll = setInterval(() => {
      loadData();
    }, 2500);

    return () => {
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
      unsubDemo();
      window.removeEventListener('trivia_demo_local_update', localHandler);
      window.removeEventListener('visibilitychange', handleRevalidate);
      window.removeEventListener('focus', handleRevalidate);
      window.removeEventListener('online', handleRevalidate);
      clearInterval(fallbackPoll);
    };
  }, [sessionId]);

  // Odštevalnik časa (Timer loop)
  useEffect(() => {
    const session = data?.session;
    if (!session || !session.timer_started_at || !session.timer_duration || session.timer_duration <= 0) {
      setTimeLeft(null);
      return;
    }

    const startTime = new Date(session.timer_started_at).getTime();
    const durationMs = session.timer_duration * 1000;
    const endTime = startTime + durationMs;

    const interval = setInterval(() => {
      const now = Date.now();
      const remainingMs = endTime - now;
      if (remainingMs <= 0) {
        setTimeLeft(0);
        clearInterval(interval);
      } else {
        setTimeLeft(Math.ceil(remainingMs / 1000));
      }
    }, 200);

    const initialRemaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    setTimeLeft(initialRemaining);

    return () => clearInterval(interval);
  }, [data?.session?.timer_started_at, data?.session?.timer_duration]);

  // Konfeti ob preklopu na lestvico ali konec kviza
  useEffect(() => {
    const status = data?.session?.status;
    if (status === 'finished') {
      if (confettiFiredRef.current !== 'finished') {
        confettiFiredRef.current = 'finished';

        const fireFestiveBurst = () => {
          confetti({
            particleCount: 110,
            spread: 90,
            origin: { y: 0.6 },
            colors: ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'],
          });
          setTimeout(() => {
            confetti({
              particleCount: 65,
              angle: 60,
              spread: 60,
              origin: { x: 0, y: 0.7 },
            });
            confetti({
              particleCount: 65,
              angle: 120,
              spread: 60,
              origin: { x: 1, y: 0.7 },
            });
          }, 350);
        };

        fireFestiveBurst();
        const interval = setInterval(fireFestiveBurst, 4500);
        return () => clearInterval(interval);
      }
    } else if (status === 'leaderboard' && confettiFiredRef.current !== 'leaderboard') {
      confettiFiredRef.current = 'leaderboard';
      confetti({
        particleCount: 90,
        spread: 75,
        origin: { y: 0.6 },
        colors: ['#6366f1', '#10b981', '#f59e0b'],
      });
    } else if (status !== 'leaderboard') {
      confettiFiredRef.current = null;
    }
  }, [data?.session?.status]);

  // Celozaslonski način (Fullscreen API)
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
          setIsFullscreen(false);
        }
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Števec oddanih odgovorov na trenutni slajd
  const answersForCurrentSlide = useMemo(() => {
    if (!data?.currentSlide?.id || !data?.answers) return [];
    return data.answers.filter((a) => a.slide_id === data.currentSlide?.id);
  }, [data?.currentSlide?.id, data?.answers]);

  // Igralci, ki so v tej temi vklopili Jokerja
  const jokersForCurrentTheme = useMemo(() => {
    if (!data?.currentTheme?.id || !data?.playerJokers) return new Set<string>();
    return new Set(
      data.playerJokers
        .filter((pj) => pj.theme_id === data.currentTheme?.id)
        .map((pj) => pj.player_id)
    );
  }, [data?.currentTheme?.id, data?.playerJokers]);

  // Dodajanje demo igralca za takojšnje testiranje čakalnice
  const handleAddTestPlayer = async () => {
    if (addingBot || !data?.session?.id) return;
    setAddingBot(true);
    try {
      const existingNames = new Set((data.players || []).map((p) => p.nickname));
      const pool = DEMO_NICKNAMES.filter((n) => !existingNames.has(n));
      const chosen = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : `Ekipa #${(data.players || []).length + 1}`;
      await addDemoPlayer(data.session.id, chosen);
      await loadData();
    } finally {
      setAddingBot(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-400" />
        <p className="text-sm font-semibold tracking-wide">Priprava predstavitvenega zaslona...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border-2 border-rose-500/40 flex items-center justify-center text-rose-400">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-black text-rose-300">Seje v Supabase ni bilo mogoče naložiti</h2>
        <pre className="text-xs sm:text-sm font-mono-code text-rose-100 bg-rose-950/70 border-2 border-rose-500/50 rounded-2xl p-5 max-w-2xl whitespace-pre-wrap text-left">
          {error || 'Seja ni bila najdena v tabeli game_sessions.'}
        </pre>
        {onExit && (
          <button
            onClick={onExit}
            className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold cursor-pointer"
          >
            Nazaj na nadzorno ploščo
          </button>
        )}
      </div>
    );
  }

  const { session, quiz, currentTheme, currentSlide, players } = data;
  const rawPlayerJoinUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/play?code=${session.room_code}`
      : `https://trivia-program.vercel.app/play?code=${session.room_code}`;
  const playerJoinUrl = appendSupabaseConfigToUrl(rawPlayerJoinUrl);

  const rawHostRemoteUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/host-remote/${session.id}`
      : `https://trivia-program.vercel.app/host-remote/${session.id}`;
  const hostRemoteUrl = appendSupabaseConfigToUrl(rawHostRemoteUrl);

  const displayUrl =
    typeof window !== 'undefined' ? `${window.location.host}/play` : 'trivia-program.vercel.app/play';

  const handleCopyRemoteUrl = async () => {
    await navigator.clipboard.writeText(hostRemoteUrl);
    setCopiedRemoteUrl(true);
    setTimeout(() => setCopiedRemoteUrl(false), 2000);
  };

  // Indeks trenutnega slajda v temi
  const themeSlides = currentTheme ? data.slidesByTheme[currentTheme.id] || [] : [];
  const slideIndex = currentSlide ? themeSlides.findIndex((s) => s.id === currentSlide.id) : -1;

  return (
    <div
      ref={containerRef}
      className="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col select-none relative overflow-hidden"
    >
      {/* Ambientni neon sij v ozadju */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-0">
        <div className="absolute -top-32 -left-32 w-[600px] h-[600px] bg-indigo-600/12 rounded-full blur-[130px]" />
        <div className="absolute top-1/3 -right-32 w-[550px] h-[550px] bg-emerald-500/10 rounded-full blur-[130px]" />
        <div className="absolute -bottom-32 left-1/3 w-[550px] h-[550px] bg-violet-600/10 rounded-full blur-[130px]" />
      </div>

      {/* ZGORNJA PREGLEDNA VRSTICA (Discreet Presentation Header) */}
      <header className="relative z-20 flex items-center justify-between px-6 py-4 border-b border-slate-900 bg-slate-950/70 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
            <Radio className="w-5 h-5 animate-pulse text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm sm:text-base font-bold text-slate-100 font-display truncate max-w-[260px] sm:max-w-md">
                {quiz.title}
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                V ŽIVO
              </span>
              <span className="hidden lg:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                ✅ Seja uspešno zapisana v Supabase oblak (Dosegljiva na vseh napravah)
              </span>
            </div>
            {currentTheme && session.status !== 'lobby' && (
              <p className="text-xs text-slate-400">
                {currentTheme.title}
                {slideIndex >= 0 && ` • Slajd ${slideIndex + 1} od ${themeSlides.length}`}
              </p>
            )}
          </div>
        </div>

        {/* Sredinski / Desni indikatorji */}
        <div className="flex items-center gap-2.5 sm:gap-3.5">
          {/* Gumb: Poveži telefon gostitelja (Daljinec) */}
          <button
            id="open-host-remote-qr-header-btn"
            onClick={() => setShowRemoteQrModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/35 text-xs font-semibold transition-all cursor-pointer"
            title="Prikaži QR kodo za telefon gostitelja (Daljinec)"
          >
            <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden md:inline">📱 Poveži telefon gostitelja (Daljinec)</span>
            <span className="md:hidden">📱 Daljinec</span>
          </button>

          {/* 4-mestna koda sobe */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs">
            <span className="text-slate-400 font-medium hidden sm:inline">Koda sobe:</span>
            <span className="font-mono-code font-bold tracking-widest text-emerald-400 text-sm">
              {session.room_code}
            </span>
          </div>

          {/* Števec igralcev */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300">
            <Users className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-bold">{players.length}</span>
            <span className="hidden sm:inline text-slate-400">
              {players.length === 1 ? 'ekipa' : players.length === 2 ? 'ekipi' : 'ekip'}
            </span>
          </div>

          {/* Ročna osvežitev (Fallback) */}
          <button
            onClick={handleManualRefresh}
            className="p-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-colors cursor-pointer"
            title="Ročno osveži podatke seje"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          {/* Gumb za celozaslonski način (Fullscreen) */}
          <button
            id="toggle-fullscreen-btn"
            onClick={toggleFullscreen}
            className="p-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-colors cursor-pointer"
            title={isFullscreen ? 'Izhod iz celozaslonskega načina' : 'Celozaslonski način (Fullscreen)'}
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>

          {onExit && (
            <button
              onClick={onExit}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 cursor-pointer"
            >
              Zapri
            </button>
          )}
        </div>
      </header>

      {/* GLAVNO PLATNO ZA PRIKAZ (glede na session.status) */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 overflow-y-auto">
        {/* ===================================================================
            1. STANJE: LOBBY (Čakalnica pred začetkom)
            =================================================================== */}
        {session.status === 'lobby' && (
          <div className="w-full max-w-5xl flex flex-col items-center justify-center space-y-6 animate-fadeIn">
            {/* Zelen indikator o uspešnem zapisu v Supabase oblak */}
            <div className="px-4 py-2.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs sm:text-sm font-bold flex items-center gap-2 shadow-lg">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                ✅ Seja uspešno zapisana v Supabase oblak (Dosegljiva na vseh napravah)
              </span>
            </div>

            {/* Naslov in navodila */}
            <div className="text-center space-y-2">
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-semibold">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>Pripravite svoje telefone za igro</span>
              </span>
              <h2 className="text-3xl sm:text-5xl font-black tracking-tight text-slate-100 font-display">
                {quiz.title}
              </h2>
              <p className="text-base sm:text-lg text-slate-400 max-w-xl mx-auto">
                Pojdite na <strong className="text-indigo-300 underline font-mono-code">{displayUrl}</strong> in
                vnesite kodo ali skenirajte QR kodo:
              </p>
            </div>

            {/* Osrednja steklena kartica s KODO in QR KODO */}
            <div className="w-full max-w-3xl bg-slate-900/85 backdrop-blur-2xl border border-slate-800/90 rounded-3xl p-6 sm:p-10 shadow-2xl shadow-indigo-950/40 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              {/* Leva stran: Ogromna 4-mestna koda */}
              <div className="flex flex-col items-center md:items-start text-center md:text-left space-y-4">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
                  4-MESTNA KODA ZA VSTOP
                </span>
                <div className="px-6 py-4 rounded-2xl bg-slate-950/90 border border-slate-800 shadow-inner">
                  <span
                    id="presentation-room-code"
                    className="text-6xl sm:text-7xl font-mono-code font-black tracking-widest text-emerald-400 drop-shadow-[0_0_20px_rgba(16,185,129,0.35)]"
                  >
                    {session.room_code}
                  </span>
                </div>
                <div className="space-y-1 text-xs text-slate-400">
                  <p>1. Odprite brskalnik na svojem telefonu.</p>
                  <p>2. Vnesite kodo in izberite ime svoje ekipe.</p>
                  <p>3. Počakajte, da gostitelj začne kviz!</p>
                </div>
              </div>

              {/* Desna stran: Samodejna QR koda */}
              <div className="flex flex-col items-center space-y-3">
                <div className="p-4 rounded-2xl bg-white shadow-2xl shadow-emerald-500/10 border-4 border-slate-800">
                  <QRCodeSVG
                    value={playerJoinUrl}
                    size={200}
                    level="H"
                    includeMargin={false}
                    className="w-44 h-44 sm:w-48 sm:h-48"
                  />
                </div>
                <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Skeniraj s kamero telefona</span>
                </span>
              </div>
            </div>

            {/* Seznam prijavljenih ekip / igralcev v živo */}
            <div className="w-full max-w-4xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 px-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-bold uppercase tracking-wider text-slate-300">
                    Prijavljene ekipe v čakalnici ({players.length})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Gumb za povezavo telefona gostitelja */}
                  <button
                    id="lobby-connect-host-remote-btn"
                    onClick={() => setShowRemoteQrModal(true)}
                    className="text-xs font-semibold text-emerald-300 hover:text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25 px-3 py-1.5 rounded-xl border border-emerald-500/35 transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                    <span>📱 Poveži telefon gostitelja (Daljinec)</span>
                  </button>

                  {/* Pomožni gumb za takojšen preizkus čakalnice */}
                  <button
                    id="demo-add-player-btn"
                    onClick={handleAddTestPlayer}
                    disabled={addingBot}
                    className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 rounded-xl border border-indigo-500/25 transition-all cursor-pointer disabled:opacity-50"
                    title="Doda testno ekipo za vizualni preizkus čakalnice"
                  >
                    {addingBot ? '+ Dodajanje...' : '+ Dodaj testno ekipo'}
                  </button>
                </div>
              </div>

              {players.length === 0 ? (
                <div className="p-8 rounded-2xl bg-slate-900/50 border border-dashed border-slate-800 text-center">
                  <p className="text-sm text-slate-500 font-medium animate-pulse">
                    Čakamo na prve tekmovalce... Skenirajte QR kodo ali vnesite kodo zgoraj!
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2.5 justify-center max-h-48 overflow-y-auto p-2">
                  {players.map((player, idx) => (
                    <div
                      key={player.id}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900/90 border border-slate-800/90 shadow-md text-slate-200 text-sm font-semibold animate-scaleIn hover:border-indigo-500/50 transition-all"
                    >
                      <span className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-400 text-xs flex items-center justify-center font-bold">
                        {idx + 1}
                      </span>
                      <span>{player.nickname}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================================================================
            2. STANJE: THEME_INTRO (Začetek nove tematike - Joker aktivacija!)
            =================================================================== */}
        {session.status === 'theme_intro' && currentTheme && (
          <div className="w-full max-w-5xl flex flex-col items-center justify-center space-y-6 text-center animate-fadeIn">
            {/* Oznaka tematike */}
            <div className="space-y-2">
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-semibold">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                <span>Začetek nove tematike</span>
              </span>
              <h2 className="text-3xl sm:text-6xl font-black text-slate-100 font-display">
                {currentTheme.title}
              </h2>
            </div>

            {/* Predstavitveni slajd teme (če ima naloženo sliko) */}
            {currentSlide?.slide_image_url && (
              <div className="w-full max-w-3xl aspect-video rounded-3xl overflow-hidden border border-slate-800 shadow-2xl bg-slate-950 flex items-center justify-center">
                <img
                  src={currentSlide.slide_image_url}
                  alt={currentTheme.title}
                  className="w-full h-full object-contain"
                />
              </div>
            )}

            {/* MASIVNO OBVESTILO O JOKERJU */}
            <div className="w-full max-w-3xl bg-gradient-to-br from-amber-500/20 via-slate-900/90 to-amber-500/10 backdrop-blur-2xl border-2 border-amber-500/60 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-amber-950/50 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 mx-auto text-3xl shadow-lg shadow-amber-500/20">
                🃏
              </div>
              <div className="space-y-1.5">
                <h3 className="text-2xl sm:text-4xl font-black text-amber-300 tracking-tight">
                  Čas za aktivacijo JOKERJA na vaših telefonih!
                </h3>
                <p className="text-base sm:text-lg font-bold text-emerald-400">
                  Dvojne točke (2x) za vsa pravilna vprašanja v tej tematiki!
                </p>
                <p className="text-xs sm:text-sm text-slate-400 max-w-lg mx-auto">
                  Pozor: Ko gostitelj zažene prvo vprašanje, Jokerja v tej temi ne bo več mogoče vklopiti.
                </p>
              </div>

              {/* Prikaz ekip, ki so že aktivirale Jokerja */}
              <div className="pt-2 border-t border-amber-500/20">
                <span className="text-xs font-semibold text-amber-200 uppercase tracking-wider">
                  Aktivirani Jokerji za ta sklop: {jokersForCurrentTheme.size} / {players.length}
                </span>
                {jokersForCurrentTheme.size > 0 && (
                  <div className="flex flex-wrap gap-2 justify-center mt-2.5">
                    {players
                      .filter((p) => jokersForCurrentTheme.has(p.id))
                      .map((p) => (
                        <span
                          key={p.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs font-bold"
                        >
                          <span>🃏</span>
                          <span>{p.nickname}</span>
                        </span>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            3. STANJE: ACTIVE_THEME (Prikaz slajdov in vprašanj)
            =================================================================== */}
        {session.status === 'active_theme' && currentSlide && (
          <div className="w-full h-full flex-1 flex flex-col items-center justify-center relative animate-fadeIn">
            {/* Animiran odštevalnik časa (Timer) */}
            {session.timer_duration && session.timer_duration > 0 && timeLeft !== null && (
              <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-30 flex items-center gap-2.5 px-4 py-2 rounded-2xl bg-slate-900/90 backdrop-blur-xl border border-slate-800 shadow-2xl">
                <Clock
                  className={`w-5 h-5 ${
                    timeLeft <= 5 ? 'text-rose-400 animate-bounce' : 'text-indigo-400'
                  }`}
                />
                <div className="flex flex-col items-end">
                  <span
                    className={`font-mono-code font-black text-xl sm:text-2xl leading-none ${
                      timeLeft <= 5
                        ? 'text-rose-400 animate-pulse'
                        : timeLeft <= 10
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {timeLeft}s
                  </span>
                  <div className="w-24 bg-slate-800 rounded-full h-1.5 mt-1 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        timeLeft <= 5
                          ? 'bg-rose-500'
                          : timeLeft <= 10
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(0, (timeLeft / (session.timer_duration || 1)) * 100)
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Prikaz vsebine slajda: Slika ali vprašanje */}
            {currentSlide.slide_image_url ? (
              <div className="w-full flex-1 flex items-center justify-center p-2">
                <img
                  src={currentSlide.slide_image_url}
                  alt={currentSlide.question_text || 'Slajd kviza'}
                  className="max-h-[78vh] w-auto max-w-full object-contain rounded-2xl shadow-2xl border border-slate-800/80"
                />
              </div>
            ) : (
              /* Tekstovna kartica, če slika ni naložena */
              <div className="w-full max-w-4xl bg-slate-900/85 backdrop-blur-2xl border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6 text-center">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-semibold">
                  <HelpCircle className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    Vprašanje • {currentSlide.points}{' '}
                    {currentSlide.points === 1 ? 'točka' : 'točke'}
                  </span>
                </div>

                <h3 className="text-2xl sm:text-4xl font-bold text-slate-100 leading-snug">
                  {currentSlide.question_text || 'Vprašanje se bo prikazalo tukaj.'}
                </h3>

                {/* Če je izbirni A/B/C/D tip slajda */}
                {currentSlide.slide_type === 'multiple_choice' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 text-left">
                    {(
                      [
                        { key: 'A', bg: 'bg-rose-500/15 border-rose-500/40 text-rose-300', badge: 'bg-rose-500 text-slate-950' },
                        { key: 'B', bg: 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300', badge: 'bg-indigo-500 text-white' },
                        { key: 'C', bg: 'bg-amber-500/15 border-amber-500/40 text-amber-300', badge: 'bg-amber-500 text-slate-950' },
                        { key: 'D', bg: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300', badge: 'bg-emerald-500 text-slate-950' },
                      ] as const
                    ).map(({ key, bg, badge }) => (
                      <div
                        key={key}
                        className={`flex items-center gap-3.5 p-4 rounded-2xl border ${bg} backdrop-blur-md`}
                      >
                        <span className={`w-9 h-9 rounded-xl font-bold flex items-center justify-center text-sm shadow-md ${badge}`}>
                          {key}
                        </span>
                        <span className="text-base sm:text-lg font-semibold text-slate-100">
                          {currentSlide.options[key] || `Možnost ${key}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Diskreten števec oddanih odgovorov v spodnjem kotu */}
            <div className="absolute bottom-2 left-2 sm:bottom-4 sm:left-4 z-30 flex items-center gap-2 px-4 py-2 rounded-2xl bg-slate-900/90 backdrop-blur-xl border border-slate-800 text-xs sm:text-sm font-semibold shadow-2xl">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-400">Odgovori:</span>
              <span className="text-slate-100 font-bold">
                {answersForCurrentSlide.length} / {players.length}
              </span>
            </div>
          </div>
        )}

        {/* ===================================================================
            4. STANJE: GRADING_THEME (Konec sklopa - Ocenjevanje)
            =================================================================== */}
        {session.status === 'grading_theme' && (
          <div className="w-full max-w-2xl bg-slate-900/85 backdrop-blur-2xl border border-slate-800 rounded-3xl p-8 sm:p-12 text-center space-y-6 shadow-2xl animate-fadeIn">
            <div className="w-20 h-20 rounded-3xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mx-auto shadow-xl">
              <Loader2 className="w-10 h-10 animate-spin text-emerald-400" />
            </div>
            <div className="space-y-2">
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                Konec sklopa
              </span>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 font-display">
                Gostitelj pregleduje odgovore...
              </h2>
              <p className="text-sm sm:text-base text-slate-400 max-w-md mx-auto">
                Oddani odgovori so zaklenjeni. Gostitelj točkuje rezultate, kmalu sledi osvežena lestvica!
              </p>
            </div>
          </div>
        )}

        {/* ===================================================================
            5. STANJE: FINISHED (Slavnostni oder zmagovalcev - Grand Podium)
            =================================================================== */}
        {session.status === 'finished' && (
          <div className="w-full max-w-5xl space-y-10 animate-fadeIn text-center">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 text-sm font-black shadow-lg shadow-amber-500/10">
                <Crown className="w-5 h-5 text-amber-400 animate-bounce" />
                <span>URADNA RAZGLASITEV ZMAGOVALCEV KVIZA</span>
                <Trophy className="w-5 h-5 text-amber-400 animate-bounce" />
              </div>
              <h2 className="text-4xl sm:text-6xl font-black text-slate-100 font-display tracking-tight">
                Čestitke zmagovalcem!
              </h2>
              <p className="text-sm sm:text-base text-slate-400 max-w-xl mx-auto">
                Pub kviz je uspešno zaključen. Hvala vsem ekipam za sodelovanje in izjemen borbeni duh!
              </p>
            </div>

            {/* ODER ZA ZMAGOVALCE (Olympic-style Podium) */}
            <div className="grid grid-cols-3 gap-2 sm:gap-6 items-end pt-6 pb-2 max-w-3xl mx-auto">
              {/* 2. MESTO (Srebro - levo) */}
              <div className="flex flex-col items-center">
                {players[1] ? (
                  <>
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-slate-300/20 border-2 border-slate-300/40 flex items-center justify-center text-slate-200 text-2xl sm:text-3xl font-bold mb-3 shadow-xl shadow-slate-500/10 animate-pulse">
                      🥈
                    </div>
                    <div className="text-center mb-2 px-1">
                      <p className="text-sm sm:text-lg font-black text-slate-100 truncate max-w-[140px] sm:max-w-[200px]">
                        {players[1].nickname}
                      </p>
                      <p className="text-xl sm:text-2xl font-mono-code font-black text-emerald-400">
                        {players[1].total_score} <span className="text-xs font-normal text-slate-400">točk</span>
                      </p>
                    </div>
                    <div className="w-full h-36 sm:h-44 rounded-t-3xl bg-gradient-to-t from-slate-900 to-slate-800/90 border-t-4 border-x border-slate-300/60 shadow-2xl flex flex-col items-center justify-center">
                      <span className="font-display font-black text-3xl sm:text-5xl text-slate-400/40">
                        2
                      </span>
                      <span className="text-[11px] font-bold text-slate-300 uppercase tracking-widest mt-1">
                        Srebro
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-24 rounded-t-2xl bg-slate-900/40 border-t border-slate-800" />
                )}
              </div>

              {/* 1. MESTO (Zlato - sredina, najvišje) */}
              <div className="flex flex-col items-center z-10">
                {players[0] ? (
                  <>
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-gradient-to-br from-amber-400/30 via-amber-500/40 to-amber-600/30 border-2 border-amber-400 flex items-center justify-center text-amber-300 text-3xl sm:text-4xl shadow-2xl shadow-amber-500/40 mb-3 animate-bounce">
                      👑
                    </div>
                    <div className="text-center mb-2 px-1">
                      <span className="inline-block px-3 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] sm:text-xs font-black uppercase tracking-wider mb-1">
                        1. Mesto • Prvaki
                      </span>
                      <p className="text-base sm:text-2xl font-black text-amber-200 truncate max-w-[150px] sm:max-w-[240px]">
                        {players[0].nickname}
                      </p>
                      <p className="text-2xl sm:text-4xl font-mono-code font-black text-emerald-400">
                        {players[0].total_score} <span className="text-xs font-normal text-slate-400">točk</span>
                      </p>
                    </div>
                    <div className="w-full h-48 sm:h-60 rounded-t-3xl bg-gradient-to-t from-amber-950/40 via-slate-900 to-amber-500/20 border-t-4 border-x border-amber-400 shadow-2xl shadow-amber-500/20 flex flex-col items-center justify-center relative overflow-hidden">
                      <div className="absolute inset-0 bg-radial from-amber-400/10 to-transparent pointer-events-none" />
                      <Trophy className="w-8 h-8 sm:w-10 sm:h-10 text-amber-400/80 mb-1" />
                      <span className="font-display font-black text-4xl sm:text-6xl text-amber-400/80">
                        1
                      </span>
                      <span className="text-xs font-black text-amber-300 uppercase tracking-widest mt-1">
                        Zlato
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-32 rounded-t-2xl bg-slate-900/40 border-t border-slate-800" />
                )}
              </div>

              {/* 3. MESTO (Bron - desno) */}
              <div className="flex flex-col items-center">
                {players[2] ? (
                  <>
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-amber-700/20 border-2 border-amber-700/40 flex items-center justify-center text-amber-600 text-2xl sm:text-3xl font-bold mb-3 shadow-xl shadow-amber-900/10 animate-pulse">
                      🥉
                    </div>
                    <div className="text-center mb-2 px-1">
                      <p className="text-sm sm:text-lg font-black text-slate-100 truncate max-w-[140px] sm:max-w-[200px]">
                        {players[2].nickname}
                      </p>
                      <p className="text-xl sm:text-2xl font-mono-code font-black text-emerald-400">
                        {players[2].total_score} <span className="text-xs font-normal text-slate-400">točk</span>
                      </p>
                    </div>
                    <div className="w-full h-28 sm:h-36 rounded-t-3xl bg-gradient-to-t from-slate-900 to-slate-800/80 border-t-4 border-x border-amber-700/60 shadow-2xl flex flex-col items-center justify-center">
                      <span className="font-display font-black text-3xl sm:text-5xl text-amber-700/40">
                        3
                      </span>
                      <span className="text-[11px] font-bold text-amber-600 uppercase tracking-widest mt-1">
                        Bron
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-20 rounded-t-2xl bg-slate-900/40 border-t border-slate-800" />
                )}
              </div>
            </div>

            {/* SEZNAM OSTALIH EKIP (4. MESTO IN NAPREJ) */}
            <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 text-left max-w-3xl mx-auto shadow-2xl">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block pb-3 border-b border-slate-800">
                {players.length > 3
                  ? 'Ostale sodelujoče ekipe (od 4. mesta naprej):'
                  : 'Končna lestvica vseh sodelujočih ekip:'}
              </span>

              <div className="divide-y divide-slate-800/80 pt-2">
                {(players.length > 3 ? players.slice(3) : players).map((player, idx) => {
                  const actualRank = players.length > 3 ? idx + 4 : idx + 1;
                  return (
                    <div
                      key={player.id}
                      className="flex items-center justify-between py-3 px-2 hover:bg-slate-800/30 rounded-xl transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-lg bg-slate-800 text-slate-300 font-mono-code font-bold text-xs flex items-center justify-center">
                          #{actualRank}
                        </span>
                        <span className="text-sm sm:text-base font-semibold text-slate-200">
                          {player.nickname}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 font-mono-code font-bold text-emerald-400 text-sm sm:text-base">
                        <span>{player.total_score}</span>
                        <span className="text-xs text-slate-500 font-sans">točk</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            6. STANJE: LEADERBOARD (Vmesna lestvica po končani temi)
            =================================================================== */}
        {session.status === 'leaderboard' && (
          <div className="w-full max-w-4xl space-y-8 animate-fadeIn text-center">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>Trenutna lestvica po tem sklopu</span>
              </div>
              <h2 className="text-3xl sm:text-5xl font-black text-slate-100 font-display">
                Rezultati ekip
              </h2>
            </div>

            {/* Podium za prva tri mesta */}
            {players.length >= 2 && (
              <div className="grid grid-cols-3 gap-3 sm:gap-6 items-end pt-4 pb-2">
                {/* 2. Mesto */}
                {players[1] && (
                  <div className="flex flex-col items-center space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-slate-300/15 border border-slate-300/30 flex items-center justify-center text-slate-300 font-bold text-lg shadow-lg">
                      🥈
                    </div>
                    <div className="w-full bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 text-center h-32 flex flex-col justify-center">
                      <span className="text-xs text-slate-400">2. mesto</span>
                      <p className="text-sm sm:text-base font-bold text-slate-100 truncate">
                        {players[1].nickname}
                      </p>
                      <p className="text-lg sm:text-xl font-mono-code font-bold text-emerald-400 mt-1">
                        {players[1].total_score} t
                      </p>
                      {jokersForCurrentTheme.has(players[1].id) && (
                        <span className="text-[10px] text-amber-300 font-semibold mt-1">
                          🃏 Joker (2x)
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* 1. Mesto */}
                {players[0] && (
                  <div className="flex flex-col items-center space-y-2">
                    <div className="w-16 h-16 rounded-2xl bg-amber-500/25 border-2 border-amber-500/50 flex items-center justify-center text-amber-300 font-black text-2xl shadow-xl shadow-amber-500/20 animate-bounce">
                      <Crown className="w-8 h-8 text-amber-400" />
                    </div>
                    <div className="w-full bg-gradient-to-b from-amber-500/15 to-slate-900/90 backdrop-blur-xl border-2 border-amber-500/40 rounded-2xl p-4 text-center h-40 flex flex-col justify-center shadow-xl shadow-amber-950/30">
                      <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                        1. mesto 👑
                      </span>
                      <p className="text-base sm:text-xl font-black text-slate-100 truncate mt-0.5">
                        {players[0].nickname}
                      </p>
                      <p className="text-2xl sm:text-3xl font-mono-code font-black text-emerald-400 mt-1">
                        {players[0].total_score} t
                      </p>
                      {jokersForCurrentTheme.has(players[0].id) && (
                        <span className="text-xs text-amber-300 font-bold mt-1">
                          🃏 Joker (2x)
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* 3. Mesto */}
                {players[2] && (
                  <div className="flex flex-col items-center space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-amber-700/20 border border-amber-700/30 flex items-center justify-center text-amber-600 font-bold text-lg shadow-lg">
                      🥉
                    </div>
                    <div className="w-full bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 text-center h-28 flex flex-col justify-center">
                      <span className="text-xs text-slate-400">3. mesto</span>
                      <p className="text-sm sm:text-base font-bold text-slate-100 truncate">
                        {players[2].nickname}
                      </p>
                      <p className="text-lg sm:text-xl font-mono-code font-bold text-emerald-400 mt-1">
                        {players[2].total_score} t
                      </p>
                      {jokersForCurrentTheme.has(players[2].id) && (
                        <span className="text-[10px] text-amber-300 font-semibold mt-1">
                          🃏 Joker (2x)
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Celotna tabela ekip */}
            <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden shadow-2xl text-left">
              <div className="divide-y divide-slate-800/80">
                {players.map((player, idx) => {
                  const usedJoker = jokersForCurrentTheme.has(player.id);
                  return (
                    <div
                      key={player.id}
                      className="flex items-center justify-between px-6 py-3.5 hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-7 h-7 rounded-lg bg-slate-800 text-slate-300 font-bold text-xs flex items-center justify-center font-mono-code">
                          #{idx + 1}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm sm:text-base font-semibold text-slate-100">
                            {player.nickname}
                          </span>
                          {usedJoker && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              🃏 Joker
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-base sm:text-lg font-mono-code font-bold text-emerald-400">
                          {player.total_score}
                        </span>
                        <span className="text-xs text-slate-400">točk</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ===================================================================
          MODAL ZA HITRO POVEZAVO TELEFONA GOSTITELJA (DALJINEC PREK QR KODE)
          =================================================================== */}
      {showRemoteQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="w-full max-w-md bg-slate-900/95 backdrop-blur-xl border border-emerald-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-center animate-scaleIn">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5 text-left">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block">
                    Daljinec za gostitelja
                  </span>
                  <h3 className="text-base font-bold text-slate-100">
                    Povežite svoj telefon
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setShowRemoteQrModal(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                Poskenirajte spodnjo QR kodo s kamero svojega telefona. Odprl se bo mobilni daljinec za sejo{' '}
                <strong className="font-mono-code text-emerald-400">{session.room_code}</strong>{' '}
                brez ponovne prijave!
              </p>

              <div className="inline-block p-4 rounded-2xl bg-white shadow-2xl border-4 border-emerald-500/40 mx-auto">
                <QRCodeSVG
                  value={hostRemoteUrl}
                  size={200}
                  level="H"
                  includeMargin={false}
                />
              </div>

              <div className="pt-1">
                <button
                  onClick={handleCopyRemoteUrl}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  {copiedRemoteUrl ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Povezava skopirana!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Kopiraj direktno povezavo do daljinca</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
              <a
                href={hostRemoteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/25 transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Odpri daljinec v novem zavihku</span>
              </a>
              <button
                onClick={() => setShowRemoteQrModal(false)}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Zapri
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

