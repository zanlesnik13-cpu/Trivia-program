import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle,
  Calendar,
  Check,
  Copy,
  Edit3,
  ExternalLink,
  FolderKanban,
  Layers,
  Loader2,
  Play,
  Plus,
  QrCode,
  Radio,
  RefreshCw,
  Smartphone,
  Sparkles,
  StopCircle,
  Trash2,
  Tv,
  Users,
  X,
} from 'lucide-react';
import {
  type ActiveGameSessionWithQuiz,
  closeGameSession,
  createLiveGameSession,
  createMegaDemoQuiz,
  createQuiz,
  deleteQuiz,
  fetchHostActiveSessions,
  fetchHostQuizzes,
} from '../lib/quizService';
import { appendSupabaseConfigToUrl, getSupabaseConfig } from '../lib/supabase';
import type { GameSession, QuizWithStats } from '../types/quiz';

interface HostDashboardProps {
  hostId: string;
  hostEmail: string;
  onEditQuiz: (quizId: string) => void;
  onOpenSqlModal: () => void;
  onOpenPresentation: (sessionId: string) => void;
  onOpenRemote: (sessionId: string) => void;
}

const SESSION_STATUS_LABELS: Record<GameSession['status'], string> = {
  lobby: 'Čakalnica (Lobby)',
  theme_intro: 'Uvod v tematiko (Joker)',
  active_theme: 'Vprašanja v teku',
  grading_theme: 'Ocenjevanje sklopa',
  leaderboard: 'Lestvica rezultatov',
  finished: 'Zaključeno',
};

export const HostDashboard: React.FC<HostDashboardProps> = ({
  hostId,
  hostEmail,
  onEditQuiz,
  onOpenSqlModal,
  onOpenPresentation,
  onOpenRemote,
}) => {
  const [quizzes, setQuizzes] = useState<QuizWithStats[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveGameSessionWithQuiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [launchingQuizId, setLaunchingQuizId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Modal za nov kviz
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newMaxJokers, setNewMaxJokers] = useState(1);
  const [creating, setCreating] = useState(false);
  const [creatingDemo, setCreatingDemo] = useState(false);

  // Modal ob zagonu kviza v živo (izbira naprave: Računalnik/TV ali Telefon Daljinec)
  const [activeLiveSession, setActiveLiveSession] = useState<{
    session: GameSession;
    quizTitle: string;
  } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedRemoteLink, setCopiedRemoteLink] = useState(false);

  const supabaseConfig = getSupabaseConfig();

  const loadDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [quizList, sessionList] = await Promise.all([
        fetchHostQuizzes(hostId),
        fetchHostActiveSessions(hostId),
      ]);
      setQuizzes(quizList);
      setActiveSessions(sessionList);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Napaka pri nalaganju podatkov nadzorne plošče.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [hostId]);

  const handleCreateQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const created = await createQuiz(hostId, newTitle.trim(), newMaxJokers);
      setShowCreateModal(false);
      setNewTitle('');
      setNewMaxJokers(1);
      onEditQuiz(created.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Napaka pri ustvarjanju kviza.';
      setError(msg);
      window.alert(`Napaka pri ustvarjanju kviza:\n${msg}`);
    } finally {
      setCreating(false);
    }
  };

  const handleCreateDemoQuiz = async () => {
    if (creatingDemo) return;
    setCreatingDemo(true);
    setError(null);
    try {
      const demoQuiz = await createMegaDemoQuiz(hostId);
      await loadDashboardData();
      window.alert(
        `🎉 Demo kviz "${demoQuiz.title}" je bil uspešno ustvarjen in naložen v Supabase bazo!\n\nVsebuje 2 tematiki in 8 profesionalno oblikovanih SVG slajdov (z Joker uvodom, izbirnimi vprašanji A-B-C-D, odprtimi vprašanji in ugibanjem številk).\n\nLahko ga takoj zaženete v živo s klikom na "Zaženi v živo" ali pa si ga ogledate z "Uredi kviz".`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Napaka pri ustvarjanju demo kviza.';
      setError(msg);
      window.alert(`Napaka pri ustvarjanju demo kviza:\n${msg}`);
    } finally {
      setCreatingDemo(false);
    }
  };

  const handleDeleteQuiz = async (quiz: QuizWithStats) => {
    const confirmed = window.confirm(
      `Ali res želite izbrisati kviz "${quiz.title}" in vse pripadajoče tematike ter slajde?`
    );
    if (!confirmed) return;

    try {
      await deleteQuiz(quiz.id);
      setQuizzes((prev) => prev.filter((q) => q.id !== quiz.id));
      setActiveSessions((prev) => prev.filter((s) => s.session.quiz_id !== quiz.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Napaka pri brisanju kviza.';
      setError(msg);
    }
  };

  const handleLaunchLive = async (quiz: QuizWithStats) => {
    if (launchingQuizId) return;
    setLaunchingQuizId(quiz.id);
    setError(null);
    try {
      const session = await createLiveGameSession(quiz.id, hostId);
      // Osveži seznam aktivnih sej in odpri pojavno okno (Modal) za izbiro naprave (BREZ samodejne preusmeritve)
      setActiveSessions((prev) => [
        { session, quizTitle: quiz.title, playerCount: 0 },
        ...prev.filter((item) => item.session.id !== session.id),
      ]);
      setActiveLiveSession({ session, quizTitle: quiz.title });
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Prišlo je do neznane napake pri ustvarjanju seje v tabeli game_sessions.';
      setError(msg);
      window.alert(`Napaka pri zagonu kviza v živo:\n\n${msg}`);
    } finally {
      setLaunchingQuizId(null);
    }
  };

  const handleCloseActiveSession = async (sessionId: string, quizTitle: string) => {
    const confirmed = window.confirm(
      `Ali res želite zaključiti aktivno sejo za kviz "${quizTitle}"?`
    );
    if (!confirmed) return;

    try {
      await closeGameSession(sessionId);
      setActiveSessions((prev) => prev.filter((item) => item.session.id !== sessionId));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Napaka pri zaključevanju seje.';
      setError(msg);
      window.alert(msg);
    }
  };

  const handleCopyRoomCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyPlayerLink = async (code: string) => {
    const base =
      typeof window !== 'undefined'
        ? `${window.location.origin}/play?code=${code}`
        : `https://trivia-program.vercel.app/play?code=${code}`;
    const link = appendSupabaseConfigToUrl(base);
    await navigator.clipboard.writeText(link);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyRemoteLink = async (sessionId: string) => {
    const link = getHostRemoteUrl(sessionId);
    await navigator.clipboard.writeText(link);
    setCopiedRemoteLink(true);
    setTimeout(() => setCopiedRemoteLink(false), 2000);
  };

  const getHostRemoteUrl = (sessionId: string) => {
    const base =
      typeof window !== 'undefined'
        ? `${window.location.origin}/host-remote/${sessionId}`
        : `https://trivia-program.vercel.app/host-remote/${sessionId}`;
    return appendSupabaseConfigToUrl(base);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Zgornji pozdravni pas */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-400">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>Nadzorna plošča gostitelja &bull; {hostEmail}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-100">
            Moji Pub Kvizi
          </h1>
          <p className="text-sm text-slate-400">
            Upravljajte svoje kvize, urejajte tematike in PDF slajde ter zaženite sobo v živo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={loadDashboardData}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-medium bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-all cursor-pointer"
            title="Osveži seznam kvizov in aktivnih sej"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
            <span className="hidden sm:inline">Osveži</span>
          </button>

          <button
            id="open-sql-schema-dashboard-btn"
            onClick={onOpenSqlModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700/80 transition-all cursor-pointer"
          >
            <span>SQL Skripta &amp; Supabase</span>
          </button>

          <button
            id="create-demo-quiz-btn"
            onClick={handleCreateDemoQuiz}
            disabled={creatingDemo}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 hover:border-emerald-500/60 transition-all cursor-pointer disabled:opacity-60"
            title="Ustvari pripravljen Mega Demo Kviz z 2 tematikama in 8 vprašanji za testiranje vseh funkcij"
          >
            {creatingDemo ? (
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
            ) : (
              <Sparkles className="w-4 h-4 text-emerald-400" />
            )}
            <span>{creatingDemo ? 'Nalagam demo...' : '🎲 Ustvari Demo Kviz za testiranje'}</span>
          </button>

          <button
            id="create-new-quiz-btn"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Ustvari nov kviz</span>
          </button>
        </div>
      </div>

      {/* Opozorilo, če Supabase ni povezan */}
      {!supabaseConfig.isConfigured && (
        <div className="p-5 rounded-2xl bg-rose-500/15 border-2 border-rose-500/50 text-rose-200 text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold text-rose-300 block text-base mb-1">
                ⚠️ Supabase baza NI povezana!
              </strong>
              Večnapravna igra (računalnik + telefon) zahteva delujočo Supabase bazo, saj je lokalni pomnilnik izklopljen. Kliknite na{' '}
              <strong>&ldquo;Nastavi Supabase&rdquo;</strong> in vnesite URL ter Anon Key svoje Supabase baze.
            </div>
          </div>
          <button
            onClick={onOpenSqlModal}
            className="px-4 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold text-xs shrink-0 cursor-pointer shadow-lg"
          >
            Nastavi Supabase
          </button>
        </div>
      )}

      {/* Velik rdeč okvir za prikaz točne Supabase napake (message + details + hint) */}
      {error && (
        <div className="p-6 rounded-2xl bg-rose-950/90 border-2 border-rose-500 text-rose-100 shadow-2xl shadow-rose-950/60 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-7 h-7 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <h3 className="text-base sm:text-lg font-black text-rose-300 uppercase tracking-wide">
                  🚨 Napaka pri komunikaciji s Supabase bazo (Postopek ustavljen)
                </h3>
                <pre className="text-xs sm:text-sm font-mono-code whitespace-pre-wrap text-rose-100 bg-slate-950/80 border border-rose-500/40 rounded-xl p-4 leading-relaxed">
                  {error}
                </pre>
              </div>
            </div>
            <button
              onClick={() => setError(null)}
              className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-xs font-bold text-rose-200 shrink-0 cursor-pointer"
            >
              Zapri
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1 pl-10">
            <button
              onClick={onOpenSqlModal}
              className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold text-xs cursor-pointer shadow-md"
            >
              Odpri SQL Skripto &amp; Supabase Nastavitve
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          AKTIVNE SEJE V TEKU (Gostitelj se lahko kadarkoli vrne v odprto igro)
          ===================================================================== */}
      {activeSessions.length > 0 && (
        <div className="bg-slate-900/85 backdrop-blur-xl border border-emerald-500/30 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
              <h2 className="text-lg font-bold text-slate-100">
                Aktivne seje v teku ({activeSessions.length})
              </h2>
            </div>
            <span className="text-xs text-slate-400">
              Izberite aktivno igro za odpiranje zaslona ali QR kode za telefon
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeSessions.map(({ session, quizTitle, playerCount }) => (
              <div
                key={session.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-emerald-500/40 transition-all"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono-code font-black text-sm">
                      Koda: {session.room_code}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-semibold">
                      {SESSION_STATUS_LABELS[session.status] || session.status}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                      <Users className="w-3.5 h-3.5 text-indigo-400" />
                      {playerCount} {playerCount === 1 ? 'ekipa' : 'ekip'}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-100">{quizTitle}</h3>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setActiveLiveSession({ session, quizTitle })}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 cursor-pointer"
                    title="Prikaži QR kodo za telefon in možnosti zaslona"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Poveži napravi / QR</span>
                  </button>

                  <button
                    onClick={() => onOpenPresentation(session.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
                    title="Odpri Glavni Zaslon (Prezentacija)"
                  >
                    <Tv className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Zaslon</span>
                  </button>

                  <button
                    onClick={() => onOpenRemote(session.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
                    title="Odpri Daljinec za gostitelja"
                  >
                    <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Daljinec</span>
                  </button>

                  <button
                    onClick={() => handleCloseActiveSession(session.id, quizTitle)}
                    className="p-2 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                    title="Zaključi to sejo"
                  >
                    <StopCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Seznam kvizov */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-56 rounded-2xl bg-slate-900/60 border border-slate-800/80 animate-pulse p-6"
            />
          ))}
        </div>
      ) : quizzes.length === 0 ? (
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-12 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mx-auto">
            <FolderKanban className="w-7 h-7" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="text-xl font-bold text-slate-100">
              Nimate še ustvarjenega kviza
            </h2>
            <p className="text-sm text-slate-400">
              Ustvarite svoj prvi pub kviz, dodajte sklope (tematike), pretvorite PDF predstavitve v
              slajde in določite točke ter Jokerje.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Ustvari nov kviz</span>
            </button>
            <button
              id="create-demo-quiz-empty-btn"
              onClick={handleCreateDemoQuiz}
              disabled={creatingDemo}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 hover:border-emerald-500/60 transition-all cursor-pointer disabled:opacity-60"
            >
              {creatingDemo ? (
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              ) : (
                <Sparkles className="w-4 h-4 text-emerald-400" />
              )}
              <span>🎲 Ustvari Demo Kviz za testiranje</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {quizzes.map((quiz) => {
            const isLaunching = launchingQuizId === quiz.id;
            return (
              <div
                key={quiz.id}
                className="group relative flex flex-col justify-between bg-slate-900/80 backdrop-blur-xl border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-6 shadow-xl transition-all duration-200 hover:-translate-y-0.5"
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      <span>
                        {quiz.max_jokers_per_player}{' '}
                        {quiz.max_jokers_per_player === 1 ? 'Joker' : 'Jokerji'} / igralca
                      </span>
                    </div>
                    <button
                      id={`delete-quiz-${quiz.id}`}
                      onClick={() => handleDeleteQuiz(quiz)}
                      title="Izbriši kviz"
                      className="p-2 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div>
                    <h2 className="text-xl font-bold text-slate-100 group-hover:text-indigo-300 transition-colors line-clamp-2">
                      {quiz.title}
                    </h2>
                    <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      <span>
                        Ustvarjeno:{' '}
                        {new Date(quiz.created_at).toLocaleDateString('sl-SI', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Statistika tematike / slajdi */}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
                      <div className="text-xs text-slate-400 flex items-center gap-1.5">
                        <FolderKanban className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Tematike</span>
                      </div>
                      <p className="text-lg font-bold text-slate-100 mt-0.5">
                        {quiz.theme_count}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
                      <div className="text-xs text-slate-400 flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Slajdi skupaj</span>
                      </div>
                      <p className="text-lg font-bold text-slate-100 mt-0.5">
                        {quiz.slide_count}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Akcijska gumba */}
                <div className="grid grid-cols-2 gap-3 pt-6 mt-6 border-t border-slate-800/80">
                  <button
                    id={`edit-quiz-${quiz.id}`}
                    onClick={() => onEditQuiz(quiz.id)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 transition-all cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Uredi kviz</span>
                  </button>
                  <button
                    id={`launch-quiz-${quiz.id}`}
                    onClick={() => handleLaunchLive(quiz)}
                    disabled={isLaunching}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
                  >
                    {isLaunching ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Zaganjam...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Zaženi kviz v živo</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal za ustvarjanje novega kviza */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="w-full max-w-md bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-100">
                Ustvari nov Pub Kviz
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateQuiz} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Naslov kviza
                </label>
                <input
                  id="new-quiz-title-input"
                  type="text"
                  required
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="npr. Sredin Pub Kviz v Klubu — Oktober"
                  className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Število Jokerjev na igralca (dvojne točke v izbrani temi)
                </label>
                <input
                  id="new-quiz-jokers-input"
                  type="number"
                  min={0}
                  max={10}
                  required
                  value={newMaxJokers}
                  onChange={(e) =>
                    setNewMaxJokers(Math.max(0, parseInt(e.target.value || '0', 10)))
                  }
                  className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500 text-sm"
                />
                <p className="text-xs text-slate-400 mt-1.5">
                  Igralci lahko Jokerja vklopijo samo na začetnem{' '}
                  <code className="text-indigo-300">theme_intro</code> slajdu posamezne tematike.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 bg-slate-800/60"
                >
                  Prekliči
                </button>
                <button
                  id="confirm-create-quiz-btn"
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 cursor-pointer"
                >
                  {creating ? 'Ustvarjanje...' : 'Ustvari in odpri urejevalnik'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          POJAVNO OKNO (MODAL) ZA IZBIRO NAPRAVE OB ZAGONU KVIZA V ŽIVO
          ===================================================================== */}
      {activeLiveSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto">
          <div className="w-full max-w-3xl bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 my-auto">
            {/* Glava Modala */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Radio className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                    Seja v živo ustvarjena • Koda sobe: {activeLiveSession.session.room_code}
                  </span>
                  <h3 className="text-lg sm:text-xl font-bold text-slate-100">
                    {activeLiveSession.quizTitle}
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setActiveLiveSession(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Zelen indikator o uspešnem zapisu v Supabase oblak */}
            <div className="px-4 py-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs sm:text-sm font-bold flex items-center gap-2.5 shadow-inner">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                ✅ Seja uspešno zapisana v Supabase oblak (Dosegljiva na vseh napravah)
              </span>
            </div>

            {/* Koda sobe za tekmovalce */}
            <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                  <span className="text-[10px] uppercase tracking-widest text-slate-400 block font-bold">
                    Koda za igralce
                  </span>
                  <span className="text-3xl font-black font-mono-code tracking-widest text-emerald-400">
                    {activeLiveSession.session.room_code}
                  </span>
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold text-slate-200">
                    Tekmovalci se pridružijo na <code className="text-indigo-300">/play</code>
                  </p>
                  <p className="text-[11px] text-slate-400">
                    QR koda za tekmovalce se prikaže na Glavnem zaslonu (Prezentaciji).
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopyRoomCode(activeLiveSession.session.room_code)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                >
                  {copiedCode ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Koda skopirana</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Kopiraj kodo</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleCopyPlayerLink(activeLiveSession.session.room_code)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Skopirano!</span>
                    </>
                  ) : (
                    <>
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Povezava za igralce</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* DVE JASNI MOŽNOSTI ZA GOSTITELJA: 1. RAČUNALNIK / TV  in  2. TELEFON GOSTITELJA (QR + Gumb) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* MOŽNOST A: ZA RAČUNALNIK / TV / PROJEKTOR */}
              <div className="flex flex-col justify-between p-6 rounded-2xl bg-gradient-to-b from-indigo-950/60 to-slate-950/90 border border-indigo-500/40 shadow-xl space-y-5">
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs font-bold">
                    <Tv className="w-3.5 h-3.5" />
                    <span>1. ZA RAČUNALNIK / TV / PROJEKTOR</span>
                  </div>
                  <h4 className="text-lg font-bold text-slate-100">
                    Glavni zaslon (Prezentacija)
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Odprite ta pogled na prenosniku, tablici ali TV zaslonu, ki je obrnjen proti
                    tekmovalcem. Na njem se v živo prikazujejo QR koda za vstop, slajdi, časovnik in lestvica.
                  </p>
                </div>

                <div className="space-y-2.5 pt-2">
                  <button
                    id="open-presentation-screen-btn"
                    onClick={() => {
                      const sId = activeLiveSession.session.id;
                      onOpenPresentation(sId);
                    }}
                    className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-sm shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <Tv className="w-4 h-4" />
                    <span>Odpri Glavni Zaslon (Prezentacija)</span>
                  </button>

                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/present/${activeLiveSession.session.id}`;
                      window.open(url, '_blank', 'noopener,noreferrer');
                    }}
                    className="w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Odpri Prezentacijo v novem zavihku</span>
                  </button>
                </div>
              </div>

              {/* MOŽNOST B: ZA TELEFON GOSTITELJA (QR KODA + DIREKTNI DOSTOP BREZ PRIJAVE) */}
              <div className="flex flex-col justify-between p-6 rounded-2xl bg-gradient-to-b from-emerald-950/50 to-slate-950/90 border border-emerald-500/40 shadow-xl space-y-4">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold">
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>2. ZA TELEFON GOSTITELJA (DALJINEC)</span>
                  </div>
                  <h4 className="text-lg font-bold text-slate-100">
                    Skeniraj QR kodo s telefonom
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Poskenirajte QR kodo s kamero telefona. Odprl se bo mobilni daljinec{' '}
                    <strong className="text-emerald-300">brez zahtevane prijave</strong> za prestavljanje slajdov in ocenjevanje!
                  </p>
                </div>

                {/* QR Koda za /host-remote/:sessionId */}
                <div className="flex flex-col items-center justify-center py-2">
                  <div className="p-3.5 rounded-2xl bg-white shadow-xl border-4 border-emerald-500/30">
                    <QRCodeSVG
                      value={getHostRemoteUrl(activeLiveSession.session.id)}
                      size={156}
                      level="H"
                      includeMargin={false}
                    />
                  </div>
                  <button
                    onClick={() => handleCopyRemoteLink(activeLiveSession.session.id)}
                    className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
                  >
                    {copiedRemoteLink ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Povezava do daljinca skopirana!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Kopiraj povezavo za daljinec (/host-remote/...)</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="space-y-2">
                  <button
                    id="open-host-remote-btn"
                    onClick={() => {
                      const sId = activeLiveSession.session.id;
                      onOpenRemote(sId);
                    }}
                    className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>Odpri Daljinec tukaj</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

