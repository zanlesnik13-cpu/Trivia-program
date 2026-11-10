import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Award,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Play,
  RotateCcw,
  Tv,
  Users,
} from 'lucide-react';
import {
  fetchPresentationData,
  subscribeToDemoUpdates,
  updateGameSession,
} from '../lib/quizService';
import { getSupabaseClient } from '../lib/supabase';
import type { GameSessionStatus, PresentationData } from '../types/quiz';

interface HostRemoteControllerProps {
  sessionId: string;
  onExit?: () => void;
  onOpenPresentation?: () => void;
}

export const HostRemoteController: React.FC<HostRemoteControllerProps> = ({
  sessionId,
  onExit,
  onOpenPresentation,
}) => {
  const [data, setData] = useState<PresentationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    loadData();
  }, [sessionId]);

  // Realtime naročnina
  useEffect(() => {
    const supabase = getSupabaseClient();
    let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;

    if (supabase) {
      channel = supabase
        .channel(`host-remote-${sessionId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'game_sessions', filter: `id=eq.${sessionId}` },
          () => loadData()
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'players', filter: `session_id=eq.${sessionId}` },
          () => loadData()
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'player_jokers', filter: `session_id=eq.${sessionId}` },
          () => loadData()
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'answers', filter: `session_id=eq.${sessionId}` },
          () => loadData()
        )
        .subscribe();
    }

    const unsubDemo = subscribeToDemoUpdates((event) => {
      if (!event.sessionId || event.sessionId === sessionId) {
        loadData();
      }
    });

    return () => {
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
      unsubDemo();
    };
  }, [sessionId]);

  const handleUpdateStatus = async (status: GameSessionStatus, extra: Record<string, unknown> = {}) => {
    setActionLoading(true);
    try {
      await updateGameSession(sessionId, { status, ...extra });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri posodobitvi seje.');
    } finally {
      setActionLoading(false);
    }
  };

  // Navigacija po slajdih v temi
  const currentThemeSlides = useMemo(() => {
    if (!data?.currentTheme?.id || !data?.slidesByTheme) return [];
    return data.slidesByTheme[data.currentTheme.id] || [];
  }, [data?.currentTheme?.id, data?.slidesByTheme]);

  const currentSlideIndex = useMemo(() => {
    if (!data?.currentSlide?.id) return -1;
    return currentThemeSlides.findIndex((s) => s.id === data.currentSlide?.id);
  }, [data?.currentSlide?.id, currentThemeSlides]);

  const handleGoToSlide = async (targetIndex: number) => {
    if (targetIndex < 0 || targetIndex >= currentThemeSlides.length || !data) return;
    const targetSlide = currentThemeSlides[targetIndex];
    setActionLoading(true);
    try {
      const maxIndex = Math.max(data.session.max_slide_index_reached, targetIndex);
      await updateGameSession(sessionId, {
        current_slide_id: targetSlide.id,
        max_slide_index_reached: maxIndex,
        timer_started_at: null,
        timer_duration: 0,
      });
      await loadData();
    } finally {
      setActionLoading(false);
    }
  };

  // Začetek časovnika na trenutnem slajdu
  const handleStartTimer = async (seconds?: number) => {
    if (!data?.currentSlide) return;
    const duration = seconds || data.currentSlide.timer_seconds || 30;
    setActionLoading(true);
    try {
      await updateGameSession(sessionId, {
        timer_started_at: new Date().toISOString(),
        timer_duration: duration,
      });
      await loadData();
    } finally {
      setActionLoading(false);
    }
  };

  const handleStopTimer = async () => {
    setActionLoading(true);
    try {
      await updateGameSession(sessionId, {
        timer_started_at: null,
        timer_duration: 0,
      });
      await loadData();
    } finally {
      setActionLoading(false);
    }
  };

  // Prehod na naslednjo tematiko
  const handleNextTheme = async () => {
    if (!data) return;
    const currentThemeIndex = data.themes.findIndex((t) => t.id === data.currentTheme?.id);
    const nextTheme = data.themes[currentThemeIndex + 1];

    if (!nextTheme) {
      await handleUpdateStatus('finished');
      return;
    }

    const nextThemeSlides = data.slidesByTheme[nextTheme.id] || [];
    const firstSlide = nextThemeSlides[0] || null;

    setActionLoading(true);
    try {
      await updateGameSession(sessionId, {
        status: 'theme_intro',
        current_theme_id: nextTheme.id,
        current_slide_id: firstSlide?.id || null,
        max_slide_index_reached: 0,
        timer_started_at: null,
        timer_duration: 0,
      });
      await loadData();
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
        <p className="text-sm font-semibold">Povezovanje z daljincem gostitelja...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-center">
        <p className="text-rose-400 mb-4">Seje ni bilo mogoče naložiti.</p>
        {onExit && (
          <button onClick={onExit} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-sm">
            Nazaj
          </button>
        )}
      </div>
    );
  }

  const { session, quiz, currentTheme, currentSlide, players } = data;
  const currentThemeIndex = data.themes.findIndex((t) => t.id === currentTheme?.id);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col max-w-md mx-auto border-x border-slate-900 shadow-2xl">
      {/* Glava daljinca (mobilno optimizirano) */}
      <header className="p-4 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-xl sticky top-0 z-20 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {onExit && (
            <button
              onClick={onExit}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-100 truncate max-w-[160px]">
                {quiz.title}
              </span>
              <span className="font-mono-code font-bold text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                {session.room_code}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Daljinec za gostitelja</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onOpenPresentation && (
            <button
              onClick={onOpenPresentation}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold hover:bg-indigo-600/30"
              title="Odpri glavni zaslon / prezentacijo"
            >
              <Tv className="w-3.5 h-3.5" />
              <span>Zaslon</span>
            </button>
          )}
        </div>
      </header>

      {/* Telo daljinca */}
      <main className="p-4 flex-1 space-y-4 overflow-y-auto">
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="underline">
              X
            </button>
          </div>
        )}

        {/* Trenutni status seje */}
        <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 uppercase font-semibold">Status seje</span>
            <span className="font-bold uppercase tracking-wider text-emerald-400">
              {session.status}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-300 pt-1 border-t border-slate-800/60">
            <span>Prijavljene ekipe:</span>
            <span className="font-bold text-white flex items-center gap-1">
              <Users className="w-3 h-3 text-indigo-400" />
              {players.length}
            </span>
          </div>
        </div>

        {/* ==================== 1. STATUS: LOBBY ==================== */}
        {session.status === 'lobby' && (
          <div className="space-y-4 pt-2">
            <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-center space-y-2">
              <p className="text-xs text-indigo-200">
                Ekipe se pridružujejo prek kode <strong className="font-mono-code text-white">{session.room_code}</strong>.
              </p>
              <p className="text-[11px] text-slate-400">
                Ko so vsi pripravljeni, kliknite spodnji gumb za začetek prve tematike.
              </p>
            </div>

            <button
              id="host-start-quiz-btn"
              disabled={actionLoading}
              onClick={() => handleUpdateStatus('theme_intro')}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-bold text-base shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>Začni kviz (Uvod v 1. tematiko)</span>
            </button>
          </div>
        )}

        {/* ==================== 2. STATUS: THEME_INTRO ==================== */}
        {session.status === 'theme_intro' && currentTheme && (
          <div className="space-y-4 pt-2">
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-center space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                JOKER KORAK (Dvojne točke)
              </span>
              <h3 className="text-base font-bold text-slate-100">{currentTheme.title}</h3>
              <p className="text-xs text-slate-400">
                Igralci na telefonih izbirajo, ali bodo v tej temi aktivirali Jokerja.
              </p>
            </div>

            <button
              id="host-start-questions-btn"
              disabled={actionLoading}
              onClick={() => handleUpdateStatus('active_theme')}
              className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-base shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <ArrowRight className="w-5 h-5" />
              <span>Začni vprašanja v tej temi</span>
            </button>
          </div>
        )}

        {/* ==================== 3. STATUS: ACTIVE_THEME ==================== */}
        {session.status === 'active_theme' && currentSlide && (
          <div className="space-y-4">
            {/* Informacije o trenutnem slajdu */}
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">
                  Slajd {currentSlideIndex + 1} od {currentThemeSlides.length}
                </span>
                <span className="font-semibold text-indigo-400 uppercase text-[10px]">
                  {currentSlide.slide_type}
                </span>
              </div>

              {currentSlide.slide_image_url ? (
                <div className="aspect-video w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center">
                  <img
                    src={currentSlide.slide_image_url}
                    alt="Slajd"
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <p className="text-xs text-slate-200 font-medium">
                  {currentSlide.question_text || 'Brez vprašanja na slajdu.'}
                </p>
              )}

              {currentSlide.correct_answer && (
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center justify-between">
                  <span>Pravilen odgovor:</span>
                  <span className="font-bold">{currentSlide.correct_answer}</span>
                </div>
              )}
            </div>

            {/* Časovnik nadzor */}
            <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <Clock className="w-4 h-4 text-indigo-400" />
                <span>Časovnik:</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={actionLoading}
                  onClick={() => handleStartTimer(currentSlide.timer_seconds || 30)}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 text-xs font-semibold cursor-pointer"
                >
                  Zaženi ({currentSlide.timer_seconds || 30}s)
                </button>
                <button
                  disabled={actionLoading}
                  onClick={handleStopTimer}
                  className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                  title="Ustavi časovnik"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Krmiljenje slajdov: Prejšnji / Naslednji */}
            <div className="grid grid-cols-2 gap-3">
              <button
                disabled={actionLoading || currentSlideIndex <= 0}
                onClick={() => handleGoToSlide(currentSlideIndex - 1)}
                className="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Prejšnji slajd</span>
              </button>

              {currentSlideIndex < currentThemeSlides.length - 1 ? (
                <button
                  id="host-next-slide-btn"
                  disabled={actionLoading}
                  onClick={() => handleGoToSlide(currentSlideIndex + 1)}
                  className="py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white flex items-center justify-center gap-1 shadow-md shadow-indigo-600/20 cursor-pointer"
                >
                  <span>Naslednji slajd</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  id="host-finish-theme-btn"
                  disabled={actionLoading}
                  onClick={() => handleUpdateStatus('grading_theme')}
                  className="py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-1 shadow-md shadow-amber-500/20 cursor-pointer"
                >
                  <span>Zaključi sklop</span>
                  <Check className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* ==================== 4. STATUS: GRADING_THEME ==================== */}
        {session.status === 'grading_theme' && (
          <div className="space-y-4 pt-2">
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-center space-y-2">
              <h3 className="text-base font-bold text-amber-300">Pregled &amp; Točkovanje odgovorov</h3>
              <p className="text-xs text-slate-400">
                Preglejte odgovore ekip ali neposredno potrdite in prikažite lestvico.
              </p>
            </div>

            <button
              id="host-show-leaderboard-btn"
              disabled={actionLoading}
              onClick={() => handleUpdateStatus('leaderboard')}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-bold text-base shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Award className="w-5 h-5 fill-current" />
              <span>Prikaži lestvico na zaslonu</span>
            </button>
          </div>
        )}

        {/* ==================== 5. STATUS: LEADERBOARD ==================== */}
        {session.status === 'leaderboard' && (
          <div className="space-y-4 pt-2">
            <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-center space-y-1">
              <span className="text-xs font-bold text-indigo-300">Lestvica je prikazana na glavnem zaslonu</span>
              <p className="text-xs text-slate-400">
                Tematika {currentThemeIndex + 1} od {data.themes.length} končana.
              </p>
            </div>

            {currentThemeIndex < data.themes.length - 1 ? (
              <button
                id="host-next-theme-btn"
                disabled={actionLoading}
                onClick={handleNextTheme}
                className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-base shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Nadaljuj na naslednji sklop</span>
                <ArrowRight className="w-5 h-5" />
              </button>
            ) : (
              <button
                id="host-finish-quiz-btn"
                disabled={actionLoading}
                onClick={() => handleUpdateStatus('finished')}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-emerald-500 text-slate-950 font-black text-base shadow-xl flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>🏆 Zaključi kviz &amp; Razglasi zmagovalce</span>
              </button>
            )}
          </div>
        )}

        {/* ==================== 6. STATUS: FINISHED ==================== */}
        {session.status === 'finished' && (
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center mx-auto text-xl">
              🏆
            </div>
            <h3 className="text-lg font-bold text-slate-100">Kviz uspešno zaključen!</h3>
            <p className="text-xs text-slate-400">
              Na glavnem zaslonu je prikazana končna lestvica s konfeti in zmagovalci.
            </p>
          </div>
        )}
      </main>
    </div>
  );
};
