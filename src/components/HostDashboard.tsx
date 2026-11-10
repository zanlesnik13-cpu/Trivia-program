import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Copy,
  Check,
  Edit3,
  FolderKanban,
  Layers,
  Play,
  Plus,
  Radio,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  createLiveGameSession,
  createQuiz,
  deleteQuiz,
  fetchHostQuizzes,
} from '../lib/quizService';
import type { GameSession, QuizWithStats } from '../types/quiz';

interface HostDashboardProps {
  hostId: string;
  hostEmail: string;
  onEditQuiz: (quizId: string) => void;
  onOpenSqlModal: () => void;
}

export const HostDashboard: React.FC<HostDashboardProps> = ({
  hostId,
  hostEmail,
  onEditQuiz,
  onOpenSqlModal,
}) => {
  const [quizzes, setQuizzes] = useState<QuizWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal za nov kviz
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newMaxJokers, setNewMaxJokers] = useState(1);
  const [creating, setCreating] = useState(false);

  // Modal ob zagonu kviza v živo
  const [activeLiveSession, setActiveLiveSession] = useState<{
    session: GameSession;
    quizTitle: string;
  } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const loadQuizzes = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchHostQuizzes(hostId);
      setQuizzes(list);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Napaka pri nalaganju kvizov.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQuizzes();
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
      setError(
        err instanceof Error ? err.message : 'Napaka pri ustvarjanju kviza.'
      );
    } finally {
      setCreating(false);
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
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Napaka pri brisanju kviza.'
      );
    }
  };

  const handleLaunchLive = async (quiz: QuizWithStats) => {
    try {
      const session = await createLiveGameSession(quiz.id);
      setActiveLiveSession({ session, quizTitle: quiz.title });
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Napaka pri zagonu kviza v živo.'
      );
    }
  };

  const handleCopyRoomCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
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
            id="open-sql-schema-dashboard-btn"
            onClick={onOpenSqlModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700/80 transition-all cursor-pointer"
          >
            <span>SQL Skripta &amp; Supabase</span>
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

      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-xs underline hover:text-white"
          >
            Skrij
          </button>
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
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Ustvari prvi kviz</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {quizzes.map((quiz) => (
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
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Zaženi kviz v živo</span>
                </button>
              </div>
            </div>
          ))}
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

      {/* Modal ob kliku na "Zaženi kviz v živo" */}
      {activeLiveSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="w-full max-w-lg bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto">
              <Radio className="w-7 h-7 animate-pulse" />
            </div>

            <div className="space-y-1.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                Seja v živo ustvarjena (Status: {activeLiveSession.session.status})
              </span>
              <h3 className="text-2xl font-bold text-slate-100">
                {activeLiveSession.quizTitle}
              </h3>
              <p className="text-xs text-slate-400">
                Zapis v tabeli <code className="text-indigo-300">game_sessions</code> je pripravljen
                s 4-mestno kodo sobe:
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col items-center gap-3">
              <span className="text-xs uppercase tracking-widest text-slate-400 font-semibold">
                4-MESTNA KODA SOBE (ROOM CODE)
              </span>
              <div className="flex items-center gap-3">
                <span className="text-4xl sm:text-5xl font-bold font-mono-code tracking-widest text-emerald-400">
                  {activeLiveSession.session.room_code}
                </span>
                <button
                  onClick={() =>
                    handleCopyRoomCode(activeLiveSession.session.room_code)
                  }
                  className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
                  title="Kopiraj kodo sobe"
                >
                  {copiedCode ? (
                    <Check className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <Copy className="w-5 h-5" />
                  )}
                </button>
              </div>
              <p className="text-xs text-slate-400">
                ID seje: <code className="text-slate-400">{activeLiveSession.session.id}</code>
              </p>
            </div>

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setActiveLiveSession(null)}
                className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 cursor-pointer"
              >
                V redu, zapri
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
