import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Award,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  Eye,
  Hash,
  ListChecks,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Tv,
  Type,
  Users,
  X,
} from 'lucide-react';
import {
  addDemoPlayer,
  autoPreGradeTheme,
  confirmThemeGradesAndShowLeaderboard,
  fetchPresentationData,
  submitDemoAnswer,
  subscribeToDemoUpdates,
  togglePlayerJoker,
  updateGameSession,
  upsertGradedAnswer,
} from '../lib/quizService';
import { getSupabaseClient } from '../lib/supabase';
import type { Answer, GameSessionStatus, PresentationData, Slide } from '../types/quiz';

interface HostRemoteControllerProps {
  sessionId: string;
  onExit?: () => void;
  onOpenPresentation?: () => void;
}

const DEMO_NICKNAMES = [
  'Kvizoljubi',
  'Pametnjakoviči',
  'Pivo in Znanje',
  'Einsteinovi Vajenci',
  'Zadnja Miza',
];

export const HostRemoteController: React.FC<HostRemoteControllerProps> = ({
  sessionId,
  onExit,
  onOpenPresentation,
}) => {
  const [data, setData] = useState<PresentationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const commentDrafts = useRef<Record<string, string>>({});
  const [customExtend, setCustomExtend] = useState('');
  const [customExtendUnit, setCustomExtendUnit] = useState<'sec' | 'min'>('sec');
  const [refreshing, setRefreshing] = useState(false);

  // Beležimo, za katero temo smo že sprožili avtomatsko pred-ocenjevanje v tem pogledu
  const preGradedThemeRef = useRef<string | null>(null);

  const loadData = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error(
          'Supabase baza ni povezana na tej napravi! Skenirajte QR kodo za daljinec z nadzorne plošče ali iz glavnega zaslona.'
        );
      }

      // Eksplicitno preberi sejo direktno iz Supabase baze
      const { data: sessionRow, error: sessionErr } = await supabase
        .from('game_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (sessionErr || !sessionRow) {
        const msg = sessionErr
          ? `${sessionErr.message}${sessionErr.details ? ` (${sessionErr.details})` : ''}${sessionErr.hint ? ` — ${sessionErr.hint}` : ''}`
          : 'Seja v tabeli game_sessions ne obstaja.';
        throw new Error(`Seja v Supabase bazi ni bila najdena (ID: ${sessionId}):\n${msg}`);
      }

      const presData = await fetchPresentationData(sessionId);
      setData(presData);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri nalaganju seje iz Supabase.');
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

  // Realtime naročnina na Supabase in Demo BroadcastChannel s stabilnim fallbackom
  useEffect(() => {
    const supabase = getSupabaseClient();
    let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;

    if (supabase) {
      channel = supabase
        .channel(`host-remote-${sessionId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'game_sessions', filter: `id=eq.${sessionId}` },
          (payload) => {
            if (payload && payload.new && typeof payload.new === 'object') {
              const updatedSession = payload.new as PresentationData['session'];
              setData((prev) =>
                prev ? { ...prev, session: { ...prev.session, ...updatedSession } } : prev
              );
            }
            loadData();
          }
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

    // Periodični varnostni heartbeat (vsake 3 sekunde) proti zamrznitvi
    const fallbackPoll = setInterval(() => {
      loadData();
    }, 3000);

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

  // Odštevalnik časa (Timer na telefonu gostitelja)
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
      const remainingMs = endTime - Date.now();
      if (remainingMs <= 0) {
        setTimeLeft(0);
        clearInterval(interval);
      } else {
        setTimeLeft(Math.ceil(remainingMs / 1000));
      }
    }, 200);

    setTimeLeft(Math.max(0, Math.ceil((endTime - Date.now()) / 1000)));
    return () => clearInterval(interval);
  }, [data?.session?.timer_started_at, data?.session?.timer_duration]);

  // Če je seja v stanju 'grading_theme', poskrbi za avtomatsko pred-ocenjevanje neocenjenih odgovorov
  useEffect(() => {
    const runPreGradeIfNeeded = async () => {
      if (
        data?.session?.status === 'grading_theme' &&
        data.currentTheme &&
        preGradedThemeRef.current !== data.currentTheme.id
      ) {
        preGradedThemeRef.current = data.currentTheme.id;
        const themeSlides = data.slidesByTheme[data.currentTheme.id] || [];
        const themeAnswers = data.answers.filter((a) => a.theme_id === data.currentTheme?.id);
        await autoPreGradeTheme(sessionId, data.currentTheme.id, themeSlides, themeAnswers);
        await loadData();
      } else if (data?.session?.status !== 'grading_theme') {
        preGradedThemeRef.current = null;
      }
    };
    runPreGradeIfNeeded();
  }, [data?.session?.status, data?.currentTheme?.id]);

  // Seznam slajdov trenutne teme
  const currentThemeSlides = useMemo(() => {
    if (!data?.currentTheme?.id || !data?.slidesByTheme) return [];
    return data.slidesByTheme[data.currentTheme.id] || [];
  }, [data?.currentTheme?.id, data?.slidesByTheme]);

  const currentSlideIndex = useMemo(() => {
    if (!data?.currentSlide?.id) return -1;
    return currentThemeSlides.findIndex((s) => s.id === data.currentSlide?.id);
  }, [data?.currentSlide?.id, currentThemeSlides]);

  // Odgovori na trenutni slajd
  const answersForCurrentSlide = useMemo(() => {
    if (!data?.currentSlide?.id || !data?.answers) return [];
    return data.answers.filter((a) => a.slide_id === data.currentSlide?.id);
  }, [data?.currentSlide?.id, data?.answers]);

  // Igralci, ki so v trenutni temi aktivirali Jokerja
  const jokersForCurrentTheme = useMemo(() => {
    if (!data?.currentTheme?.id || !data?.playerJokers) return new Set<string>();
    return new Set(
      data.playerJokers
        .filter((pj) => pj.theme_id === data.currentTheme?.id)
        .map((pj) => pj.player_id)
    );
  }, [data?.currentTheme?.id, data?.playerJokers]);

  // ---------------------------------------------------------------------------
  // AKCIJE DALJINSKEGA UPRAVLJALNIKA
  // ---------------------------------------------------------------------------

  // 1. Iz Lobbyja -> Začni 1. tematiko (theme_intro)
  const handleStartFirstTheme = async () => {
    if (!data) return;
    const firstTheme = data.themes[0] || null;
    const firstThemeSlides = firstTheme ? data.slidesByTheme[firstTheme.id] || [] : [];
    const introSlide =
      firstThemeSlides.find((s) => s.slide_type === 'theme_intro') ||
      firstThemeSlides[0] ||
      null;

    setActionLoading(true);
    try {
      await updateGameSession(sessionId, {
        status: 'theme_intro',
        current_theme_id: firstTheme?.id || null,
        current_slide_id: introSlide?.id || null,
        max_slide_index_reached: 0,
        timer_started_at: null,
        timer_duration: 0,
      });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri začetku tematike.');
    } finally {
      setActionLoading(false);
    }
  };

  // 2. Iz theme_intro -> Začni z vprašanji tematike (active_theme)
  const handleStartThemeQuestions = async () => {
    if (!data || !data.currentTheme) return;
    const slides = data.slidesByTheme[data.currentTheme.id] || [];
    // Če je 1. slajd tipa 'theme_intro' in obstaja naslednji slajd, odpri 1. vprašanje, sicer 1. slajd
    const firstQuestionIndex =
      slides.length > 1 && slides[0].slide_type === 'theme_intro' ? 1 : 0;
    const targetSlide = slides[firstQuestionIndex] || slides[0] || null;

    setActionLoading(true);
    try {
      await updateGameSession(sessionId, {
        status: 'active_theme',
        current_slide_id: targetSlide?.id || null,
        max_slide_index_reached: firstQuestionIndex,
        timer_started_at: null,
        timer_duration: 0,
      });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri prehodu na vprašanja.');
    } finally {
      setActionLoading(false);
    }
  };

  // 3. Premik na prejšnji ali naslednji slajd v active_theme
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri menjavi slajda.');
    } finally {
      setActionLoading(false);
    }
  };

  // 4. Nadzor časovnika (Sproži 30s, Sproži 60s, privzeti timer slajda ali Ustavi timer)
  const handleTriggerTimer = async (seconds: number) => {
    setActionLoading(true);
    try {
      await updateGameSession(sessionId, {
        timer_started_at: new Date().toISOString(),
        timer_duration: seconds,
      });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri vklopu časovnika.');
    } finally {
      setActionLoading(false);
    }
  };

  // Podaljšanje časovnika v živo (tudi če teče ali je pravkar potekel)
  const handleExtendTimer = async (addSeconds: number) => {
    if (!Number.isFinite(addSeconds) || addSeconds <= 0) return;
    const sec = Math.round(addSeconds);
    setActionLoading(true);
    try {
      const sess = data?.session;
      const running =
        sess?.timer_started_at &&
        sess.timer_duration &&
        sess.timer_duration > 0 &&
        new Date(sess.timer_started_at).getTime() + sess.timer_duration * 1000 > Date.now();
      if (running && sess) {
        await updateGameSession(sessionId, {
          timer_duration: (sess.timer_duration || 0) + sec,
        });
      } else {
        await updateGameSession(sessionId, {
          timer_started_at: new Date().toISOString(),
          timer_duration: sec,
        });
      }
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri podaljšanju časovnika.');
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri ustavitvi časovnika.');
    } finally {
      setActionLoading(false);
    }
  };

  // 5. Zaključi tematiko in oceni odgovore (prehod v 'grading_theme' + avtomatsko pred-ocenjevanje)
  const handleFinishThemeAndGrade = async () => {
    if (!data || !data.currentTheme) return;
    setActionLoading(true);
    try {
      const themeSlides = data.slidesByTheme[data.currentTheme.id] || [];
      const themeAnswers = data.answers.filter((a) => a.theme_id === data.currentTheme?.id);

      await autoPreGradeTheme(sessionId, data.currentTheme.id, themeSlides, themeAnswers);
      preGradedThemeRef.current = data.currentTheme.id;

      await updateGameSession(sessionId, {
        status: 'grading_theme',
        timer_started_at: null,
        timer_duration: 0,
      });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri prehodu na ocenjevanje.');
    } finally {
      setActionLoading(false);
    }
  };

  // 6. Ročno ocenjevanje posameznega odgovora igralca na telefonu gostitelja
  const handleGradeAnswer = async (
    playerId: string,
    slide: Slide,
    existingAnswer: Answer | undefined,
    isCorrect: boolean,
    awardedPoints: number,
    hostComment?: string
  ) => {
    if (!data?.currentTheme) return;
    const safePoints = Math.max(0, Number.isNaN(awardedPoints) ? 0 : awardedPoints);
    const ansText = existingAnswer?.answer_text ?? '';

    // Optimistična posodobitev v UI za takojšnjo odzivnost na telefonu
    setData((prev) => {
      if (!prev) return prev;
      const idx = prev.answers.findIndex(
        (a) => a.player_id === playerId && a.slide_id === slide.id
      );
      const updatedAns: Answer = {
        id: idx >= 0 ? prev.answers[idx].id : `temp-${playerId}-${slide.id}`,
        session_id: sessionId,
        player_id: playerId,
        theme_id: prev.currentTheme!.id,
        slide_id: slide.id,
        answer_text: ansText,
        is_correct: isCorrect,
        awarded_points: safePoints,
        graded: true,
        host_comment:
          hostComment !== undefined
            ? hostComment
            : idx >= 0
            ? prev.answers[idx].host_comment
            : undefined,
      };
      const nextAnswers = [...prev.answers];
      if (idx >= 0) {
        nextAnswers[idx] = updatedAns;
      } else {
        nextAnswers.push(updatedAns);
      }
      return { ...prev, answers: nextAnswers };
    });

    try {
      await upsertGradedAnswer(
        sessionId,
        playerId,
        data.currentTheme.id,
        slide.id,
        ansText,
        isCorrect,
        safePoints,
        hostComment
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri shranjevanju ocene.');
      await loadData();
    }
  };

  // 7. Potrdi točke (z upoštevanjem 2x Jokerja!) in prikaži lestvico
  const handleConfirmGradesAndLeaderboard = async () => {
    setActionLoading(true);
    try {
      // Shrani še neshranjene komentarje gostitelja
      for (const [key, text] of Object.entries(commentDrafts.current)) {
        const [pid, sid] = key.split(':');
        const slide = (data?.slidesByTheme?.[data.currentTheme?.id ?? ''] || []).find(
          (sl) => sl.id === sid
        );
        const ans = data?.answers.find((a) => a.player_id === pid && a.slide_id === sid);
        if (slide && (ans?.host_comment ?? '') !== text) {
          await handleGradeAnswer(
            pid,
            slide,
            ans,
            Boolean(ans?.is_correct),
            Number(ans?.awarded_points ?? 0),
            text
          );
        }
      }
      commentDrafts.current = {};
      await confirmThemeGradesAndShowLeaderboard(sessionId);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri potrditvi točk in lestvice.');
    } finally {
      setActionLoading(false);
    }
  };

  // 8. Nadaljuj na naslednjo tematiko ali zaključi kviz
  const handleNextThemeOrFinish = async (forceFinish: boolean = false) => {
    if (!data) return;
    const currentThemeIndex = data.themes.findIndex((t) => t.id === data.currentTheme?.id);
    const nextTheme = data.themes[currentThemeIndex + 1];

    if (forceFinish || !nextTheme) {
      setActionLoading(true);
      try {
        await updateGameSession(sessionId, {
          status: 'finished',
          timer_started_at: null,
          timer_duration: 0,
        });
        await loadData();
      } finally {
        setActionLoading(false);
      }
      return;
    }

    const nextSlides = data.slidesByTheme[nextTheme.id] || [];
    const introSlide =
      nextSlides.find((s) => s.slide_type === 'theme_intro') || nextSlides[0] || null;

    setActionLoading(true);
    try {
      await updateGameSession(sessionId, {
        status: 'theme_intro',
        current_theme_id: nextTheme.id,
        current_slide_id: introSlide?.id || null,
        max_slide_index_reached: 0,
        timer_started_at: null,
        timer_duration: 0,
      });
      await loadData();
    } finally {
      setActionLoading(false);
    }
  };

  // Pomožne funkcije za hitro simulacijo igralcev/odgovorov med testiranjem
  const handleAddDemoPlayer = async () => {
    if (!data) return;
    const existing = new Set(data.players.map((p) => p.nickname));
    const available = DEMO_NICKNAMES.filter((n) => !existing.has(n));
    const name =
      available[0] || `Ekipa #${data.players.length + 1}`;
    await addDemoPlayer(sessionId, name);
    await loadData();
  };

  const handleSimulateAnswersForSlide = async () => {
    if (!data || !data.currentTheme || !data.currentSlide) return;
    const slide = data.currentSlide;
    for (let i = 0; i < data.players.length; i++) {
      const p = data.players[i];
      let sampleAnswer = '';
      if (slide.slide_type === 'multiple_choice') {
        const choices = ['A', 'B', 'C', 'D'];
        sampleAnswer = i === 0 && slide.correct_answer ? slide.correct_answer : choices[i % 4];
      } else if (slide.slide_type === 'closest_number') {
        const base = parseFloat(slide.correct_answer || '1999') || 1999;
        sampleAnswer = String(base + (i === 0 ? 1 : (i + 1) * 4));
      } else {
        sampleAnswer =
          i === 0 && slide.correct_answer ? slide.correct_answer : `Odgovor ekipe ${p.nickname}`;
      }
      await submitDemoAnswer(
        sessionId,
        p.id,
        data.currentTheme.id,
        slide.id,
        sampleAnswer
      );
    }
    await loadData();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3 px-4">
        <Loader2 className="w-9 h-9 animate-spin text-emerald-400" />
        <p className="text-sm font-semibold">Nalaganje daljinca za gostitelja...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border-2 border-rose-500/50 flex items-center justify-center text-rose-400">
          <AlertCircle className="w-9 h-9" />
        </div>
        <h2 className="text-xl font-black text-rose-300">Seje v Supabase ni bilo mogoče naložiti</h2>
        <pre className="text-xs sm:text-sm font-mono-code text-rose-100 bg-rose-950/80 border-2 border-rose-500/50 rounded-2xl p-4 max-w-lg whitespace-pre-wrap text-left leading-relaxed">
          {error || 'Seje ni bilo mogoče naložiti iz tabele game_sessions.'}
        </pre>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={handleManualRefresh}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold cursor-pointer"
          >
            Poskusi znova
          </button>
          {onExit && (
            <button
              onClick={onExit}
              className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold cursor-pointer"
            >
              Nazaj na nadzorno ploščo
            </button>
          )}
        </div>
      </div>
    );
  }

  const { session, quiz, currentTheme, currentSlide, players, answers } = data;
  const currentThemeIndex = data.themes.findIndex((t) => t.id === currentTheme?.id);

  // Vprašalni slajdi trenutne tematike za pogled ocenjevanja (grading_theme)
  const gradableSlides = currentThemeSlides.filter(
    (s) =>
      s.slide_type === 'multiple_choice' ||
      s.slide_type === 'open_text' ||
      s.slide_type === 'closest_number'
  );

  const STATUS_LABELS: Record<GameSessionStatus, { label: string; color: string }> = {
    lobby: { label: 'Čakalnica (Lobby)', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' },
    theme_intro: { label: 'Joker Uvod Teme', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
    active_theme: { label: 'Vprašanja v teku', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
    grading_theme: { label: 'Ocenjevanje sklopa', color: 'bg-violet-500/20 text-violet-300 border-violet-500/40' },
    leaderboard: { label: 'Lestvica na zaslonu', color: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
    finished: { label: 'Kviz zaključen', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col max-w-lg mx-auto border-x border-slate-900/90 shadow-2xl select-none">
      {/* ZGORNJA VRSTICA DALJINCA (Sticky Mobile Header) */}
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-xl border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {onExit && (
            <button
              id="remote-back-btn"
              onClick={onExit}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 transition-colors cursor-pointer shrink-0"
              title="Nazaj na nadzorno ploščo"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-sm text-slate-100 truncate">
                {quiz.title}
              </h1>
              <span className="font-mono-code font-bold text-xs px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                {session.room_code}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className={`inline-flex items-center px-2 py-0.2 rounded-md text-[10px] font-bold border ${
                  STATUS_LABELS[session.status].color
                }`}
              >
                {STATUS_LABELS[session.status].label}
              </span>
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <Users className="w-3 h-3 text-indigo-400" />
                {players.length}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleManualRefresh}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="Ročno osveži stanje kviza"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          {onOpenPresentation && (
            <button
              id="remote-open-projector-btn"
              onClick={onOpenPresentation}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold cursor-pointer"
            >
              <Tv className="w-4 h-4" />
              <span>Projektor</span>
            </button>
          )}
        </div>
      </header>

      {/* GLAVNA VSEBINA DALJINCA */}
      <main className="flex-1 p-4 space-y-4 overflow-y-auto pb-10">
        {error && (
          <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-2">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="p-1 text-rose-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ===================================================================
            1. STANJE: LOBBY (Čakalnica pred začetkom)
            =================================================================== */}
        {session.status === 'lobby' && (
          <div className="space-y-4">
            {/* Kartica s kodo in številom prijavljenih igralcev */}
            <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-5 text-center space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                4-Mestna koda za vstop igralcev
              </span>
              <div className="text-5xl font-mono-code font-black tracking-widest text-emerald-400">
                {session.room_code}
              </div>
              <p className="text-xs text-slate-400">
                Igralci se prijavljajo prek QR kode na glavnem zaslonu ali na{' '}
                <code className="text-indigo-300">/play?code={session.room_code}</code>
              </p>
            </div>

            {/* Seznam prijavljenih igralcev */}
            <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-sm font-bold text-slate-200">
                    Prijavljeni igralci ({players.length})
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={handleAddDemoPlayer}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-indigo-300 border border-slate-700 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Test igralec</span>
                </button>
              </div>

              {players.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
                  Čakanje na prijavo prvih igralcev...
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto">
                  {players.map((p, idx) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-semibold text-slate-200"
                    >
                      <span className="text-indigo-400 font-mono-code font-bold">
                        #{idx + 1}
                      </span>
                      <span>{p.nickname}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Velik gumb: Začni 1. tematiko */}
            <button
              id="remote-start-first-theme-btn"
              disabled={actionLoading}
              onClick={handleStartFirstTheme}
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-base shadow-xl shadow-emerald-500/25 flex items-center justify-center gap-2.5 transition-all active:scale-[0.99] cursor-pointer disabled:opacity-50"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>Začni 1. tematiko</span>
            </button>
          </div>
        )}

        {/* ===================================================================
            2. STANJE: THEME_INTRO (Igralci aktivirajo Jokerja)
            =================================================================== */}
        {session.status === 'theme_intro' && currentTheme && (
          <div className="space-y-4">
            <div className="bg-slate-900/80 backdrop-blur-xl border border-amber-500/40 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-xs font-bold">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Tematika {currentThemeIndex + 1} od {data.themes.length}</span>
                </span>
                <span className="text-xs text-slate-400 font-semibold">
                  Joker korak (2x točke)
                </span>
              </div>

              <h2 className="text-xl font-bold text-slate-100">
                {currentTheme.title}
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Na glavnem zaslonu je prikazan uvod v tematiko. Igralci lahko samo v tem
                koraku na svojih telefonih aktivirajo <strong>Jokerja</strong> za dvojne točke!
              </p>
            </div>

            {/* Seznam igralcev in status aktivacije Jokerja v živo */}
            <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                  Kdo je aktiviral Jokerja ({jokersForCurrentTheme.size} / {players.length})
                </h3>
                <span className="text-[11px] text-slate-500">
                  Klik na ekipo preklopi Jokerja
                </span>
              </div>

              {players.length === 0 ? (
                <p className="text-xs text-slate-500 py-3 text-center">
                  V tej igri še ni prijavljenih igralcev.
                </p>
              ) : (
                <div className="space-y-2">
                  {players.map((p) => {
                    const hasJoker = jokersForCurrentTheme.has(p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={async () => {
                          await togglePlayerJoker(sessionId, p.id, currentTheme.id);
                          await loadData();
                        }}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                          hasJoker
                            ? 'bg-amber-500/15 border-amber-500/50 text-amber-200'
                            : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-base">{hasJoker ? '🃏' : '⚪'}</span>
                          <span className="text-sm font-semibold">{p.nickname}</span>
                        </div>
                        <span
                          className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                            hasJoker
                              ? 'bg-amber-500 text-slate-950'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {hasJoker ? 'JOKER AKTIVEN (2x)' : 'Brez Jokerja'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Velik gumb: Začni z vprašanji tematike */}
            <button
              id="remote-start-theme-questions-btn"
              disabled={actionLoading}
              onClick={handleStartThemeQuestions}
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-black text-base shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2.5 transition-all active:scale-[0.99] cursor-pointer disabled:opacity-50"
            >
              <span>Začni z vprašanji tematike</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* ===================================================================
            3. STANJE: ACTIVE_THEME (Nadzor slajdov, časovnika in odgovorov v živo)
            =================================================================== */}
        {session.status === 'active_theme' && currentSlide && (
          <div className="space-y-4">
            {/* Zgornji podatki o slajdu + majhen predogled + pravilen odgovor */}
            <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-xs font-bold font-mono-code">
                  Slajd {currentSlideIndex + 1} / {currentThemeSlides.length}
                </span>
                <span className="text-xs font-semibold text-slate-400">
                  Točke: <strong className="text-emerald-400">{currentSlide.points} t</strong>
                </span>
              </div>

              {/* Majhen predogled trenutnega slajda */}
              {currentSlide.slide_image_url && (
                <div className="w-full h-36 rounded-xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center">
                  <img
                    src={currentSlide.slide_image_url}
                    alt={`Slajd ${currentSlideIndex + 1}`}
                    className="w-full h-full object-contain"
                  />
                </div>
              )}

              {/* Besedilo vprašanja */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Vprašanje na slajdu
                </span>
                <p className="text-sm font-semibold text-slate-100 leading-snug">
                  {currentSlide.question_text || (
                    <span className="italic text-slate-400">
                      Vprašanje je prikazano na sliki slajda
                    </span>
                  )}
                </p>
              </div>

              {/* Možni odgovori, če je multiple_choice */}
              {currentSlide.slide_type === 'multiple_choice' && (
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {(['A', 'B', 'C', 'D'] as const).map((optKey) => {
                    const isRight =
                      currentSlide.correct_answer === optKey ||
                      Boolean(currentSlide.correct_answer?.trim().toUpperCase().startsWith(optKey));
                    return (
                      <div
                        key={optKey}
                        className={`px-2.5 py-1.5 rounded-lg border truncate ${
                          isRight
                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-bold'
                            : 'bg-slate-950/70 border-slate-800 text-slate-400'
                        }`}
                      >
                        <span className="font-mono-code mr-1">{optKey}:</span>
                        <span>{currentSlide.options[optKey] || '—'}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pravilen odgovor (viden SAMO gostitelju na telefonu!) */}
              {currentSlide.slide_type !== 'theme_intro' &&
                currentSlide.slide_type !== 'info_only' && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-emerald-300">
                      <Eye className="w-4 h-4 shrink-0 text-emerald-400" />
                      <span>Pravilen odgovor (samo za vas):</span>
                    </div>
                    <span className="text-sm font-mono-code font-black text-emerald-400">
                      {currentSlide.correct_answer || 'Ni določen'}
                    </span>
                  </div>
                )}
            </div>

            {/* Števec oddanih odgovorov na trenutni slajd v živo */}
            <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-200">
                    Oddani odgovori na ta slajd
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Ocenjevanje sledi ob zaključku sklopa
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-mono-code font-black text-emerald-400">
                  {answersForCurrentSlide.length} / {players.length}
                </span>
                {players.length > 0 &&
                  answersForCurrentSlide.length < players.length && (
                    <button
                      type="button"
                      onClick={handleSimulateAnswersForSlide}
                      className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-indigo-300 border border-slate-700 cursor-pointer"
                      title="Simuliraj odgovore igralcev za test ocenjevanja"
                    >
                      + Test odgovori
                    </button>
                  )}
              </div>
            </div>

            {/* Nadzor časovnika (Hitri gumbi: 30s, 60s, privzeti in Ustavi) */}
            <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300">
                  <Clock className="w-4 h-4 text-indigo-400" />
                  <span>Nadzor časovnika (Timer)</span>
                </div>
                {timeLeft !== null && session.timer_duration && session.timer_duration > 0 ? (
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-mono-code font-black ${
                      timeLeft <= 5
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    }`}
                  >
                    Odštevanje: {timeLeft}s
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">Časovnik miruje</span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  id="remote-timer-30s-btn"
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleTriggerTimer(30)}
                  className="py-3 px-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-200 font-bold text-xs flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-all cursor-pointer"
                >
                  <span>Sproži 30s</span>
                  <span className="text-[10px] text-indigo-400">timer</span>
                </button>

                <button
                  id="remote-timer-60s-btn"
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleTriggerTimer(60)}
                  className="py-3 px-2 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-200 font-bold text-xs flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-all cursor-pointer"
                >
                  <span>Sproži 60s</span>
                  <span className="text-[10px] text-violet-400">timer</span>
                </button>

                <button
                  id="remote-timer-stop-btn"
                  type="button"
                  disabled={actionLoading}
                  onClick={handleStopTimer}
                  className="py-3 px-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 font-bold text-xs flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-all cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Ustavi timer</span>
                </button>
              </div>

              {/* Podaljšanje časa v živo */}
              <div className="pt-2 border-t border-slate-800 space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Podaljšaj čas
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: '+15s', sec: 15 },
                    { label: '+30s', sec: 30 },
                    { label: '+1 min', sec: 60 },
                  ].map((b) => (
                    <button
                      key={b.label}
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleExtendTimer(b.sec)}
                      className="py-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 font-bold text-xs active:scale-95 transition-all cursor-pointer"
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="remote-extend-custom-input"
                    type="number"
                    min={1}
                    value={customExtend}
                    onChange={(e) => setCustomExtend(e.target.value)}
                    placeholder="Število"
                    className="w-20 px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
                  />
                  <select
                    value={customExtendUnit}
                    onChange={(e) => setCustomExtendUnit(e.target.value as 'sec' | 'min')}
                    className="px-2 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs"
                  >
                    <option value="sec">sekund</option>
                    <option value="min">minut</option>
                  </select>
                  <button
                    id="remote-extend-custom-btn"
                    type="button"
                    disabled={actionLoading || !customExtend}
                    onClick={() => {
                      const n = parseFloat(customExtend);
                      handleExtendTimer(customExtendUnit === 'min' ? n * 60 : n);
                      setCustomExtend('');
                    }}
                    className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    Dodaj čas
                  </button>
                </div>
              </div>
            </div>

            {/* Velika navigacijska gumba: Prejšnji slajd / Naslednji slajd */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                id="remote-prev-slide-btn"
                type="button"
                disabled={actionLoading || currentSlideIndex <= 0}
                onClick={() => handleGoToSlide(currentSlideIndex - 1)}
                className="py-4 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 disabled:opacity-35 text-slate-200 font-bold text-sm flex items-center justify-center gap-1.5 border border-slate-700 active:scale-[0.98] transition-all cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5" />
                <span>Prejšnji slajd</span>
              </button>

              <button
                id="remote-next-slide-btn"
                type="button"
                disabled={actionLoading || currentSlideIndex >= currentThemeSlides.length - 1}
                onClick={() => handleGoToSlide(currentSlideIndex + 1)}
                className="py-4 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-35 text-white font-bold text-sm flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/25 active:scale-[0.98] transition-all cursor-pointer"
              >
                <span>Naslednji slajd</span>
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* Ko je gostitelj na zadnjem slajdu tematike: Zaključi tematiko in oceni odgovore */}
            {currentSlideIndex === currentThemeSlides.length - 1 && (
              <div className="pt-2">
                <button
                  id="remote-finish-theme-grade-btn"
                  type="button"
                  disabled={actionLoading}
                  onClick={handleFinishThemeAndGrade}
                  className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-amber-500 to-emerald-500 hover:from-amber-400 hover:to-emerald-400 text-slate-950 font-black text-base shadow-xl shadow-emerald-500/25 flex items-center justify-center gap-2 transition-all active:scale-[0.99] cursor-pointer"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Zaključi tematiko in oceni odgovore</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ===================================================================
            4. STANJE: GRADING_THEME (Avtomatsko + Ročno ocenjevanje odgovorov)
            =================================================================== */}
        {session.status === 'grading_theme' && currentTheme && (
          <div className="space-y-5">
            {/* Glava ocenjevanja */}
            <div className="bg-slate-900/80 backdrop-blur-xl border border-violet-500/40 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-violet-300">
                  Ocenjevanje odgovorov • {currentTheme.title}
                </span>
                <span className="text-[11px] font-semibold text-emerald-400">
                  Avto pred-ocenjeno ✓
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Izbirni (<code className="text-indigo-300">multiple_choice</code>) in najbližji
                številski odgovori (<code className="text-indigo-300">closest_number</code>) so
                samodejno pred-ocenjeni. Preverite ali prilagodite točke vsakega tekmovalca.
              </p>
            </div>

            {/* Seznam vseh vprašanj v trenutni temi */}
            {gradableSlides.length === 0 ? (
              <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
                V tej tematiki ni ocenjevalnih vprašanj.
              </div>
            ) : (
              <div className="space-y-4">
                {gradableSlides.map((slide, qIdx) => {
                  const maxPts = Number(slide.points ?? 1);
                  const halfPts = Math.round((maxPts / 2) * 100) / 100;
                  const slideAnswers = answers.filter((a) => a.slide_id === slide.id);

                  // Če je closest_number, izračunamo najmanjšo razliko za prikaz ob odgovoru
                  const targetNum =
                    slide.slide_type === 'closest_number'
                      ? parseFloat((slide.correct_answer || '').replace(',', '.'))
                      : NaN;

                  return (
                    <div
                      key={slide.id}
                      className="bg-slate-900/85 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 space-y-3.5 shadow-lg"
                    >
                      {/* Naslov vprašanja in pravilen odgovor */}
                      <div className="space-y-1.5 pb-2.5 border-b border-slate-800">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-indigo-400">
                            {slide.slide_type === 'multiple_choice' && (
                              <ListChecks className="w-3.5 h-3.5" />
                            )}
                            {slide.slide_type === 'open_text' && (
                              <Type className="w-3.5 h-3.5" />
                            )}
                            {slide.slide_type === 'closest_number' && (
                              <Hash className="w-3.5 h-3.5" />
                            )}
                            <span>
                              Vprašanje #{qIdx + 1} ({maxPts} t)
                            </span>
                          </span>
                          <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs font-mono-code font-bold text-emerald-300">
                            Pravilno: {slide.correct_answer || '—'}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-slate-100">
                          {slide.question_text || `Slajd #${slide.order_index + 1}`}
                        </p>
                      </div>

                      {/* Seznam vseh tekmovalcev in njihovih odgovorov */}
                      {players.length === 0 ? (
                        <p className="text-xs text-slate-500 italic">
                          Ni prijavljenih tekmovalcev.
                        </p>
                      ) : (
                        <div className="space-y-2.5">
                          {players.map((player) => {
                            const ans = slideAnswers.find(
                              (a) => a.player_id === player.id
                            );
                            const isCorrect = Boolean(ans?.is_correct);
                            const awarded = Number(ans?.awarded_points ?? 0);
                            const usedJoker = jokersForCurrentTheme.has(player.id);

                            // Izračun razlike za closest_number
                            let diffLabel: string | null = null;
                            if (
                              slide.slide_type === 'closest_number' &&
                              !Number.isNaN(targetNum) &&
                              ans?.answer_text
                            ) {
                              const playerVal = parseFloat(
                                ans.answer_text.trim().replace(',', '.')
                              );
                              if (!Number.isNaN(playerVal)) {
                                const diff =
                                  Math.round(Math.abs(playerVal - targetNum) * 100) /
                                  100;
                                diffLabel = `Δ = ${diff}`;
                              }
                            }

                            return (
                              <div
                                key={player.id}
                                className={`p-3 rounded-xl border transition-all space-y-2.5 ${
                                  isCorrect
                                    ? 'bg-emerald-500/10 border-emerald-500/40'
                                    : 'bg-slate-950/80 border-slate-800'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs font-bold text-slate-200 truncate">
                                        {player.nickname}
                                      </span>
                                      {usedJoker && (
                                        <span
                                          className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold"
                                          title="Igralec ima v tej temi aktiviranega Jokerja (2x ob končnem seštevku teme)"
                                        >
                                          🃏 2x
                                        </span>
                                      )}
                                      {diffLabel && (
                                        <span className="px-1.5 py-0.2 rounded bg-violet-500/20 text-violet-300 text-[10px] font-mono-code font-semibold">
                                          {diffLabel}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-sm font-mono-code font-bold text-white mt-0.5 break-words">
                                      {ans?.answer_text ? (
                                        ans.answer_text
                                      ) : (
                                        <span className="text-xs italic text-slate-500 font-sans font-normal">
                                          Brez oddanega odgovora
                                        </span>
                                      )}
                                    </p>
                                  </div>

                                  {/* Hiter preklopnik: Zelena kljukica (Pravilno) / Rdeč križec (Napačno) */}
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleGradeAnswer(
                                          player.id,
                                          slide,
                                          ans,
                                          true,
                                          maxPts
                                        )
                                      }
                                      className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                                        isCorrect
                                          ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30 font-bold'
                                          : 'bg-slate-800 text-slate-400 hover:text-emerald-400'
                                      }`}
                                      title="Označi kot pravilno"
                                    >
                                      <Check className="w-5 h-5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleGradeAnswer(
                                          player.id,
                                          slide,
                                          ans,
                                          false,
                                          0
                                        )
                                      }
                                      className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                                        !isCorrect && awarded === 0
                                          ? 'bg-rose-500 text-white shadow-md shadow-rose-500/30 font-bold'
                                          : 'bg-slate-800 text-slate-400 hover:text-rose-400'
                                      }`}
                                      title="Označi kot napačno (0 točk)"
                                    >
                                      <X className="w-5 h-5" />
                                    </button>
                                  </div>
                                </div>

                                {/* Hitri gumbi za točke (0, polovične 0.5, polne točke) + poljubni vnos */}
                                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-800/70">
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleGradeAnswer(player.id, slide, ans, false, 0)
                                      }
                                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                        awarded === 0
                                          ? 'bg-rose-500/30 text-rose-200 border border-rose-500/50'
                                          : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                                      }`}
                                    >
                                      0
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleGradeAnswer(
                                          player.id,
                                          slide,
                                          ans,
                                          true,
                                          halfPts
                                        )
                                      }
                                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                        awarded === halfPts && halfPts > 0
                                          ? 'bg-amber-500/30 text-amber-200 border border-amber-500/50'
                                          : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                                      }`}
                                    >
                                      +{halfPts}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleGradeAnswer(
                                          player.id,
                                          slide,
                                          ans,
                                          true,
                                          maxPts
                                        )
                                      }
                                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                        awarded === maxPts && maxPts > 0
                                          ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-500/50'
                                          : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                                      }`}
                                    >
                                      +{maxPts}
                                    </button>
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] text-slate-400">Točke:</span>
                                    <input
                                      type="number"
                                      step="0.5"
                                      min={0}
                                      value={awarded}
                                      onChange={(e) => {
                                        const val = parseFloat(e.target.value || '0');
                                        handleGradeAnswer(
                                          player.id,
                                          slide,
                                          ans,
                                          val > 0,
                                          val
                                        );
                                      }}
                                      className="w-16 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-right font-mono-code font-bold text-xs text-emerald-400 focus:outline-none focus:border-indigo-500"
                                    />
                                  </div>
                                </div>
                                <input
                                  type="text"
                                  key={`${player.id}-${slide.id}`}
                                  defaultValue={
                                    commentDrafts.current[`${player.id}:${slide.id}`] ??
                                    ans?.host_comment ??
                                    ''
                                  }
                                  onChange={(e) => {
                                    commentDrafts.current[`${player.id}:${slide.id}`] = e.target.value;
                                  }}
                                  onBlur={(e) => {
                                    delete commentDrafts.current[`${player.id}:${slide.id}`];
                                    if ((ans?.host_comment ?? '') !== e.target.value) {
                                      handleGradeAnswer(
                                        player.id,
                                        slide,
                                        ans,
                                        isCorrect,
                                        awarded,
                                        e.target.value
                                      );
                                    }
                                  }}
                                  placeholder="Opcijski komentar / obrazložitev točkovanja (npr. 'Pol točke za delni odgovor' ali 'Zmanjkala letnica')"
                                  className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Povzetek točk trenutne tematike z upoštevanim 2x JOKERJEM */}
            {players.length > 0 && (
              <div className="bg-slate-900/90 border border-amber-500/30 rounded-2xl p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                    Predogled izračuna teme (vključno z 2x Jokerjem)
                  </span>
                </div>
                <div className="space-y-1.5">
                  {players.map((p) => {
                    const rawThemeSum = gradableSlides.reduce((acc, sl) => {
                      const ansForSlide = answers.find(
                        (a) => a.player_id === p.id && a.slide_id === sl.id
                      );
                      return acc + Number(ansForSlide?.awarded_points ?? 0);
                    }, 0);
                    const hasJoker = jokersForCurrentTheme.has(p.id);
                    const finalThemePts = hasJoker ? rawThemeSum * 2 : rawThemeSum;

                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between text-xs py-1 border-b border-slate-800/60 last:border-none"
                      >
                        <span className="text-slate-200 font-medium flex items-center gap-1.5">
                          <span>{p.nickname}</span>
                          {hasJoker && (
                            <span className="text-[10px] font-bold text-amber-300">
                              (🃏 Joker 2x)
                            </span>
                          )}
                        </span>
                        <span className="font-mono-code font-bold text-emerald-400">
                          {hasJoker
                            ? `${rawThemeSum} × 2 = +${finalThemePts} t`
                            : `+${finalThemePts} t`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Velik gumb: Potrdi točke in prikaži lestvico */}
            <button
              id="remote-confirm-grades-leaderboard-btn"
              type="button"
              disabled={actionLoading}
              onClick={handleConfirmGradesAndLeaderboard}
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-base shadow-xl shadow-emerald-500/25 flex items-center justify-center gap-2 transition-all active:scale-[0.99] cursor-pointer disabled:opacity-50"
            >
              <Award className="w-5 h-5" />
              <span>Potrdi točke in prikaži lestvico</span>
            </button>
          </div>
        )}

        {/* ===================================================================
            5. STANJE: LEADERBOARD in FINISHED (Lestvica in prehod naprej)
            =================================================================== */}
        {(session.status === 'leaderboard' || session.status === 'finished') && (
          <div className="space-y-4">
            <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-5 text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
                <Crown className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-slate-100">
                {session.status === 'finished'
                  ? 'Kviz je zaključen — Končni rezultati'
                  : 'Lestvica je prikazana na glavnem zaslonu'}
              </h2>
              <p className="text-xs text-slate-400">
                {session.status === 'finished'
                  ? 'Čestitke zmagovalcem!'
                  : `Zaključena tematika ${currentThemeIndex + 1} od ${data.themes.length}.`}
              </p>
            </div>

            {/* Pregled trenutnih točk na telefonu gostitelja */}
            <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl divide-y divide-slate-800/80 overflow-hidden">
              {players.map((p, idx) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between px-4 py-3 text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 font-mono-code font-bold flex items-center justify-center">
                      #{idx + 1}
                    </span>
                    <span className="font-semibold text-slate-100">{p.nickname}</span>
                    {jokersForCurrentTheme.has(p.id) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">
                        🃏 2x
                      </span>
                    )}
                  </div>
                  <span className="font-mono-code font-bold text-sm text-emerald-400">
                    {p.total_score} t
                  </span>
                </div>
              ))}
            </div>

            {session.status === 'leaderboard' && (
              <div className="space-y-3 pt-2">
                {currentThemeIndex < data.themes.length - 1 ? (
                  <button
                    id="remote-next-theme-btn"
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleNextThemeOrFinish(false)}
                    className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-black text-base shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Nadaljuj na naslednjo tematiko</span>
                    <ArrowRight className="w-5 h-5" />
                  </button>
                ) : (
                  <button
                    id="remote-finish-quiz-final-btn"
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleNextThemeOrFinish(true)}
                    className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-amber-500 to-emerald-500 hover:from-amber-400 hover:to-emerald-400 text-slate-950 font-black text-base shadow-xl flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Crown className="w-5 h-5" />
                    <span>Zaključi kviz - Končni rezultati</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
