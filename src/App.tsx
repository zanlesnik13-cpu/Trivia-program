import { useEffect, useState } from 'react';
import {
  Database,
  Home,
  LogOut,
  Smartphone,
  Sparkles,
  Tv,
  UserCheck,
} from 'lucide-react';
import { HostAuth } from './components/HostAuth';
import { HostDashboard } from './components/HostDashboard';
import { HostRemoteController } from './components/HostRemoteController';
import { LandingPage } from './components/LandingPage';
import { PlayerView } from './components/PlayerView';
import { PresentationView } from './components/PresentationView';
import { QuizBuilder } from './components/QuizBuilder';
import { SupabaseSetupModal } from './components/SupabaseSetupModal';
import { getSupabaseClient, getSupabaseConfig } from './lib/supabase';

interface HostUser {
  id: string;
  email: string;
  isDemo?: boolean;
}

type RouteState =
  | { view: 'landing' }
  | { view: 'host_portal' }
  | { view: 'present'; sessionId: string }
  | { view: 'host_remote'; sessionId: string }
  | { view: 'play'; roomCode?: string };

function parseCurrentRoute(): RouteState {
  if (typeof window === 'undefined') return { view: 'landing' };
  const path = window.location.pathname;
  const hash = window.location.hash;

  // 1. Preveri /play ali #/play z morebitnim ?code=XXXX ali #/play?code=XXXX
  if (
    path.startsWith('/play') ||
    hash.startsWith('#/play') ||
    hash.includes('/play')
  ) {
    const urlParams = new URLSearchParams(window.location.search);
    let code = urlParams.get('code') || '';
    if (!code && hash.includes('?')) {
      const hashQuery = hash.split('?')[1];
      const hashParams = new URLSearchParams(hashQuery);
      code = hashParams.get('code') || '';
    }
    return { view: 'play', roomCode: code };
  }

  // 2. Preveri /present/:sessionId ali #/present/:sessionId
  const presentMatch =
    path.match(/\/present\/([^/?#]+)/) || hash.match(/#\/present\/([^/?#]+)/);
  if (presentMatch) {
    return { view: 'present', sessionId: presentMatch[1] };
  }

  // 3. Preveri /host-remote/:sessionId, /remote/:sessionId ali /host/:sessionId (direktni dostop do daljinca brez prijave)
  const hostRemoteMatch =
    path.match(/\/host-remote\/([^/?#]+)/) ||
    hash.match(/#\/host-remote\/([^/?#]+)/) ||
    path.match(/\/remote\/([^/?#]+)/) ||
    hash.match(/#\/remote\/([^/?#]+)/) ||
    path.match(/^\/host\/([^/?#]+)/);
  if (hostRemoteMatch) {
    return { view: 'host_remote', sessionId: hostRemoteMatch[1] };
  }

  // 4. Preveri /host, /dashboard, /login, /admin (portal za gostitelja)
  if (
    path.startsWith('/host') ||
    path.startsWith('/dashboard') ||
    path.startsWith('/login') ||
    path.startsWith('/admin') ||
    hash.includes('/host') ||
    hash.includes('/dashboard') ||
    hash.includes('/login')
  ) {
    return { view: 'host_portal' };
  }

  // 5. Privzeto: vstopna stran (Landing Page) na /
  return { view: 'landing' };
}

export function App() {
  const [hostUser, setHostUser] = useState<HostUser | null>(null);
  const [editingQuizId, setEditingQuizId] = useState<string | null>(null);
  const [showSupabaseModal, setShowSupabaseModal] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [, setConfigVersion] = useState(0);

  const [route, setRoute] = useState<RouteState>(parseCurrentRoute);

  const supabaseConfig = getSupabaseConfig();

  // Poslušaj spremembe URL-ja (popstate)
  useEffect(() => {
    const handlePopState = () => {
      setRoute(parseCurrentRoute());
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handlePopState);
    };
  }, []);

  const navigateTo = (newPath: string) => {
    window.history.pushState({}, '', newPath);
    setRoute(parseCurrentRoute());
  };

  useEffect(() => {
    const checkInitialAuth = async () => {
      setCheckingSession(true);
      const supabase = getSupabaseClient();

      if (supabase) {
        try {
          const { data } = await supabase.auth.getSession();
          if (data.session?.user) {
            setHostUser({
              id: data.session.user.id,
              email: data.session.user.email || 'gostitelj@quizpulse.si',
            });
            setCheckingSession(false);
            return;
          }
        } catch {
          // ignore session error
        }
      }

      // Preveri, ali je uporabnik že vstopil kot Gost (Hiter vstop brez prijave)
      const savedGuestActive = localStorage.getItem('trivia_guest_session_active');
      const savedGuestId = localStorage.getItem('guest_host_id');
      const savedGuestEmail = localStorage.getItem('guest_host_email');
      if (savedGuestActive === 'true' && savedGuestId) {
        setHostUser({
          id: savedGuestId,
          email: savedGuestEmail || 'gost@quizpulse.si',
          isDemo: true,
        });
      }

      setCheckingSession(false);
    };

    checkInitialAuth();
  }, []);

  const handleSignOut = async () => {
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    localStorage.removeItem('trivia_guest_session_active');
    setHostUser(null);
    setEditingQuizId(null);
  };

  // Če je uporabnik na vstopni strani (Landing Page)
  if (route.view === 'landing') {
    return (
      <>
        <LandingPage
          onJoinGame={(code) => navigateTo(`/play?code=${code}`)}
          onOpenHost={() => navigateTo('/host')}
          onOpenSupabaseModal={() => setShowSupabaseModal(true)}
          isHostLoggedIn={Boolean(hostUser)}
          hostEmail={hostUser?.email}
        />
        <SupabaseSetupModal
          isOpen={showSupabaseModal}
          onClose={() => setShowSupabaseModal(false)}
          onConfigSaved={() => setConfigVersion((v) => v + 1)}
        />
      </>
    );
  }

  // Če je uporabnik na pogledu igralca (/play)
  if (route.view === 'play') {
    return (
      <PlayerView
        initialRoomCode={route.roomCode}
        onExit={() => navigateTo('/')}
      />
    );
  }

  // Če je uporabnik na pogledu prezentacije (/present/:sessionId), prikaži čisto platno za projektor
  if (route.view === 'present' && route.sessionId) {
    return (
      <PresentationView
        sessionId={route.sessionId}
        onExit={() => navigateTo('/host')}
      />
    );
  }

  // Če je uporabnik na pogledu daljinca za telefon (/host/:sessionId)
  if (route.view === 'host_remote' && route.sessionId) {
    return (
      <HostRemoteController
        sessionId={route.sessionId}
        onExit={() => navigateTo('/host')}
        onOpenPresentation={() => {
          window.open(`/present/${route.sessionId}`, '_blank');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 relative overflow-x-hidden">
      {/* Ambientni neon sij v ozadju (Indigo & Emerald) */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl" />
        <div className="absolute top-1/4 -right-32 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl" />
      </div>

      {/* Zgornja navigacijska vrstica (Navbar) */}
      <header className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div
            onClick={() => {
              navigateTo('/');
            }}
            className="flex items-center gap-3 cursor-pointer"
            title="Pojdi na vstopno stran"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-600 to-emerald-500 p-[1px] shadow-lg shadow-indigo-500/20">
              <div className="w-full h-full bg-slate-950 rounded-[11px] flex items-center justify-center">
                <Tv className="w-5 h-5 text-indigo-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-slate-100 font-display">
                  QuizPulse <span className="text-emerald-400">Live</span>
                </span>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  Faza 5 &bull; Objava &amp; Vercel
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Nadzorna plošča za gostitelje &bull; Urejanje in vodenje kvizov
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3">
            {/* Gumb za prehod na vstopno stran */}
            <button
              onClick={() => navigateTo('/')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors cursor-pointer"
              title="Nazaj na začetno stran"
            >
              <Home className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden md:inline">Vstopna stran</span>
            </button>

            {/* Gumb za hiter vstop v igro kot igralec (/play) */}
            <button
              id="navbar-play-btn"
              onClick={() => {
                window.open('/play', '_blank');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-all cursor-pointer"
              title="Odpri mobilni vmesnik za igralce v novem zavihku"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Igraj kviz (/play)</span>
              <span className="md:hidden">/play</span>
            </button>

            {/* Gumb za SQL skripto & Supabase povezavo */}
            <button
              id="navbar-supabase-setup-btn"
              onClick={() => setShowSupabaseModal(true)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                supabaseConfig.isConfigured
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                  : 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {supabaseConfig.isConfigured
                  ? 'Supabase Povezan (SQL)'
                  : 'Supabase SQL & Nastavitve'}
              </span>
              <span className="sm:hidden">SQL</span>
            </button>

            {hostUser && (
              <>
                <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300">
                  {hostUser.isDemo ? (
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  <span className="truncate max-w-[180px]">{hostUser.email}</span>
                </div>

                <button
                  id="sign-out-btn"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors cursor-pointer"
                  title="Odjava gostitelja"
                >
                  <LogOut className="w-3.5 h-3.5 text-rose-400" />
                  <span className="hidden sm:inline">Odjava</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Glavna vsebina */}
      <main className="relative z-10">
        {checkingSession ? (
          <div className="py-24 text-center text-sm text-slate-400">
            Preverjanje seje gostitelja...
          </div>
        ) : !hostUser ? (
          <HostAuth
            onAuthenticated={(user) => {
              localStorage.setItem('trivia_guest_session_active', 'true');
              localStorage.setItem('guest_host_id', user.id);
              localStorage.setItem('guest_host_email', user.email);
              setHostUser(user);
            }}
            onOpenSupabaseModal={() => setShowSupabaseModal(true)}
          />
        ) : editingQuizId ? (
          <QuizBuilder
            quizId={editingQuizId}
            onBack={() => setEditingQuizId(null)}
          />
        ) : (
          <HostDashboard
            hostId={hostUser.id}
            hostEmail={hostUser.email}
            onEditQuiz={(quizId) => setEditingQuizId(quizId)}
            onOpenSqlModal={() => setShowSupabaseModal(true)}
            onOpenPresentation={(sessionId) => {
              window.open(`/present/${sessionId}`, '_blank');
            }}
            onOpenRemote={(sessionId) => {
              window.open(`/host-remote/${sessionId}`, '_blank');
            }}
          />
        )}
      </main>

      {/* Modal z natančno SQL skripto in Supabase nastavitvami */}
      <SupabaseSetupModal
        isOpen={showSupabaseModal}
        onClose={() => setShowSupabaseModal(false)}
        onConfigSaved={() => setConfigVersion((v) => v + 1)}
      />
    </div>
  );
}

export default App;
