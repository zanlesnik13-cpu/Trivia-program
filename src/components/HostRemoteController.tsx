import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Award,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  Eye,
  Hash,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  Minus,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Tv,
  Type,
  Unlock,
  Users,
  X,
} from 'lucide-react';
import {
  calculateDateDiffDays,
  formatDaysDeviationLabel,
  formatSloveneDate,
  isMultiPartSlide,
  parseMultiPartAnswer,
  roundPoints,
  serializeMultiPartAnswer,
} from '../lib/questionUtils';
import {
  addDemoPlayer,
  autoPreGradeTheme,
  confirmThemeGradesAndShowLeaderboard,
  fetchPresentationData,
  normalizeGameSession,
  normalizeLockedSlideIds,
  normalizeSlideTimers,
  submitDemoAnswer,
  subscribeToDemoUpdates,
  togglePlayerJoker,
  updateGameSession,
  upsertGradedAnswer,
} from '../lib/quizService';
import { getSupabaseClient } from '../lib/supabase';
import type {
  Answer,
  GameSessionStatus,
  PresentationData,
  Slide,
  SlideTimerState,
} from '../types/quiz';

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
              const updatedSession = payload.new as Partial<PresentationData['session']>;
              setData((prev) => {
                if (!prev) return prev;
                const mergedSession = normalizeGameSession({
                  ...prev.session,
                  ...updatedSession,
                });
                const nextTheme =
                  prev.themes.find((t) => t.id === mergedSession.current_theme_id) ||
                  prev.currentTheme;
                const nextThemeSlides = nextTheme ? prev.slidesByTheme[nextTheme.id] || [] : [];
                const nextSlide =
                  nextThemeSlides.find((s) => s.id === mergedSession.current_slide_id) ||
                  prev.currentSlide;
                return {
                  ...prev,
                  session: mergedSession,
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

  // Efektivni časovnik za trenutni slajd (vedno upošteva trajni zapis slide_timers[slide.id] z fallbackom)
  const activeSlideTimerEntry = useMemo(() => {
    const slide = data?.currentSlide;
    const sess = data?.session;
    if (
      !slide ||
      !sess ||
      slide.slide_type === 'info_only' ||
      slide.slide_type === 'theme_intro'
    ) {
      return null;
    }
    const perSlide = sess.slide_timers?.[slide.id];
    if (perSlide && perSlide.started_at && Number(perSlide.duration) > 0) {
      return { startedAt: perSlide.started_at, duration: Number(perSlide.duration) };
    }
    if (sess.timer_started_at && Number(sess.timer_duration) > 0) {
      return { startedAt: sess.timer_started_at, duration: Number(sess.timer_duration) };
    }
    return null;
  }, [
    data?.currentSlide,
    data?.session?.slide_timers,
    data?.session?.timer_started_at,
    data?.session?.timer_duration,
  ]);

  // Odštevalnik časa (Timer na telefonu gostitelja)
  useEffect(() => {
    if (!activeSlideTimerEntry) {
      setTimeLeft(null);
      return;
    }

    const startTime = new Date(activeSlideTimerEntry.startedAt).getTime();
    const durationMs = activeSlideTimerEntry.duration * 1000;
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
  }, [activeSlideTimerEntry?.startedAt, activeSlideTimerEntry?.duration]);

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

  // Pripravi posodobitev časovnika ob odprtju slajda:
  // Če ima slajd že svoj zapis v slide_timers, ga NE prepiše (ohrani preostali čas ali stanje izteka).
  // Če se slajd s timer_seconds > 0 odpre PRVIČ, samodejno zapiše { started_at, duration } v slide_timers.
  const buildSlideTimerPatch = (
    targetSlide: Slide | null,
    existingTimersRaw?: Record<string, SlideTimerState>
  ): {
    timer_started_at: string | null;
    timer_duration: number;
    slide_timers?: Record<string, SlideTimerState>;
  } => {
    const existingTimers = normalizeSlideTimers(existingTimersRaw);
    if (
      !targetSlide ||
      targetSlide.slide_type === 'theme_intro' ||
      targetSlide.slide_type === 'info_only'
    ) {
      return {
        timer_started_at: null,
        timer_duration: 0,
      };
    }

    const existingEntry = existingTimers[targetSlide.id];
    if (existingEntry && existingEntry.duration > 0) {
      return {
        timer_started_at: existingEntry.started_at,
        timer_duration: existingEntry.duration,
      };
    }

    const defaultSecs = Math.round(Number(targetSlide.timer_seconds ?? 0));
    if (defaultSecs > 0) {
      const nowIso = new Date().toISOString();
      return {
        timer_started_at: nowIso,
        timer_duration: defaultSecs,
        slide_timers: {
          ...existingTimers,
          [targetSlide.id]: {
            started_at: nowIso,
            duration: defaultSecs,
          },
        },
      };
    }

    return {
      timer_started_at: null,
      timer_duration: 0,
    };
  };

  // 1. Iz Lobbyja -> Začni 1. tematiko (vedno prični pri 1. slajdu po order_index = 0!)
  const handleStartFirstTheme = async () => {
    if (!data) return;
    const firstTheme = data.themes[0] || null;
    const firstThemeSlides = firstTheme ? data.slidesByTheme[firstTheme.id] || [] : [];
    const firstSlide = firstThemeSlides[0] || null;
    const initialStatus: GameSessionStatus =
      firstSlide?.slide_type === 'theme_intro' ? 'theme_intro' : 'active_theme';

    setActionLoading(true);
    try {
      const timerPatch = buildSlideTimerPatch(firstSlide, data.session.slide_timers);
      await updateGameSession(sessionId, {
        status: initialStatus,
        current_theme_id: firstTheme?.id || null,
        current_slide_id: firstSlide?.id || null,
        max_slide_index_reached: 0,
        ...timerPatch,
      });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri začetku tematike.');
    } finally {
      setActionLoading(false);
    }
  };

  // 2. Iz theme_intro -> Naprej na naslednji slajd v tematiki (ali zaključi tematiko, če je to zadnji slajd)
  const handleStartThemeQuestions = async () => {
    if (!data || !data.currentTheme) return;
    const slides = data.slidesByTheme[data.currentTheme.id] || [];
    const nextIndex = currentSlideIndex >= 0 ? currentSlideIndex + 1 : 0;

    if (nextIndex >= slides.length) {
      await handleFinishThemeAndGrade();
      return;
    }

    await handleGoToSlide(nextIndex);
  };

  // 3. Premik na prejšnji ali naslednji slajd (avtomatsko preklopi med 'theme_intro' in 'active_theme' glede na slide_type)
  const handleGoToSlide = async (targetIndex: number) => {
    if (targetIndex < 0 || targetIndex >= currentThemeSlides.length || !data) return;
    const targetSlide = currentThemeSlides[targetIndex];
    const nextStatus: GameSessionStatus =
      targetSlide.slide_type === 'theme_intro' ? 'theme_intro' : 'active_theme';

    setActionLoading(true);
    try {
      const maxIndex = Math.max(data.session.max_slide_index_reached, targetIndex);
      const timerPatch = buildSlideTimerPatch(targetSlide, data.session.slide_timers);
      await updateGameSession(sessionId, {
        status: nextStatus,
        current_slide_id: targetSlide.id,
        max_slide_index_reached: maxIndex,
        ...timerPatch,
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
      const nowIso = new Date().toISOString();
      const curSlide = data?.currentSlide;
      const existingTimers = normalizeSlideTimers(data?.session?.slide_timers);
      const nextSlideTimers =
        curSlide && curSlide.slide_type !== 'info_only' && curSlide.slide_type !== 'theme_intro'
          ? { ...existingTimers, [curSlide.id]: { started_at: nowIso, duration: seconds } }
          : existingTimers;

      await updateGameSession(sessionId, {
        timer_started_at: nowIso,
        timer_duration: seconds,
        slide_timers: nextSlideTimers,
      });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri vklopu časovnika.');
    } finally {
      setActionLoading(false);
    }
  };

  // Podaljšanje časovnika v živo (tudi če teče ali je že potekel — posodobi tudi slide_timers[slide.id])
  const handleExtendTimer = async (addSeconds: number) => {
    if (!Number.isFinite(addSeconds) || addSeconds <= 0) return;
    const sec = Math.round(addSeconds);
    setActionLoading(true);
    try {
      const sess = data?.session;
      const curSlide = data?.currentSlide;
      const existingTimers = normalizeSlideTimers(sess?.slide_timers);
      const perSlide = curSlide ? existingTimers[curSlide.id] : undefined;

      const baseStartedAt = perSlide?.started_at || sess?.timer_started_at || null;
      const baseDuration =
        perSlide && perSlide.duration > 0
          ? perSlide.duration
          : sess?.timer_duration && sess.timer_duration > 0
          ? sess.timer_duration
          : 0;

      const running =
        Boolean(baseStartedAt) &&
        baseDuration > 0 &&
        new Date(baseStartedAt!).getTime() + baseDuration * 1000 > Date.now();

      const nextStartedAt = running && baseStartedAt ? baseStartedAt : new Date().toISOString();
      const nextDuration = running ? baseDuration + sec : sec;

      const nextSlideTimers =
        curSlide && curSlide.slide_type !== 'info_only' && curSlide.slide_type !== 'theme_intro'
          ? {
              ...existingTimers,
              [curSlide.id]: { started_at: nextStartedAt, duration: nextDuration },
            }
          : existingTimers;

      await updateGameSession(sessionId, {
        timer_started_at: nextStartedAt,
        timer_duration: nextDuration,
        slide_timers: nextSlideTimers,
      });
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
      const curSlide = data?.currentSlide;
      const existingTimers = normalizeSlideTimers(data?.session?.slide_timers);
      const nextSlideTimers = { ...existingTimers };
      if (curSlide?.id) {
        delete nextSlideTimers[curSlide.id];
      }

      await updateGameSession(sessionId, {
        timer_started_at: null,
        timer_duration: 0,
        slide_timers: nextSlideTimers,
      });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri ustavitvi časovnika.');
    } finally {
      setActionLoading(false);
    }
  };

  // 4b. Nadzor zaklepanja vračanja nazaj za igralce (locked_slide_ids)
  const handleToggleSlideLock = async (targetSlideId: string) => {
    if (!data) return;
    setActionLoading(true);
    try {
      const currentLocked = normalizeLockedSlideIds(data.session.locked_slide_ids);
      const isCurrentlyLocked = currentLocked.includes(targetSlideId);
      const nextLocked = isCurrentlyLocked
        ? currentLocked.filter((id) => id !== targetSlideId)
        : [...currentLocked, targetSlideId];

      await updateGameSession(sessionId, {
        locked_slide_ids: nextLocked,
      });
      await loadData();
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Napaka pri preklopu zaklepanja vračanja nazaj.'
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleLockAllPriorThemeQuestions = async (slideIdsToLock: string[]) => {
    if (!data || slideIdsToLock.length === 0) return;
    setActionLoading(true);
    try {
      const currentLocked = normalizeLockedSlideIds(data.session.locked_slide_ids);
      const nextLocked = Array.from(new Set([...currentLocked, ...slideIdsToLock]));

      await updateGameSession(sessionId, {
        locked_slide_ids: nextLocked,
      });
      await loadData();
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Napaka pri zaklepanju dosedanjih vprašanj.'
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnlockAllThemeQuestions = async (slideIdsToUnlock: string[]) => {
    if (!data || slideIdsToUnlock.length === 0) return;
    setActionLoading(true);
    try {
      const removeSet = new Set(slideIdsToUnlock);
      const currentLocked = normalizeLockedSlideIds(data.session.locked_slide_ids);
      const nextLocked = currentLocked.filter((id) => !removeSet.has(id));

      await updateGameSession(sessionId, {
        locked_slide_ids: nextLocked,
      });
      await loadData();
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Napaka pri odklepanju vprašanj v sklopu.'
      );
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

  // 6. Ročno ocenjevanje posameznega odgovora igralca na telefonu gostitelja (vključno z bonus_points in večdelnimi vprašanji)
  const handleGradeAnswer = async (
    playerId: string,
    slide: Slide,
    existingAnswer: Answer | undefined,
    isCorrect: boolean,
    awardedPoints: number,
    hostComment?: string,
    bonusPoints?: number,
    overrideAnswerText?: string
  ) => {
    if (!data?.currentTheme) return;
    const safePoints = roundPoints(
      Math.max(0, Number.isNaN(awardedPoints) ? 0 : awardedPoints)
    );
    const currentBonus = roundPoints(Number(existingAnswer?.bonus_points ?? 0));
    const safeBonus =
      bonusPoints !== undefined
        ? roundPoints(Math.max(0, Number.isNaN(bonusPoints) ? 0 : bonusPoints))
        : currentBonus;
    const ansText =
      overrideAnswerText !== undefined
        ? overrideAnswerText
        : existingAnswer?.answer_text ?? '';

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
        bonus_points: safeBonus,
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
        hostComment,
        safeBonus
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri shranjevanju ocene.');
      await loadData();
    }
  };

  // Ocenjevanje posameznega podvprašanja pri večdelnem slajdu (question_parts — redni deli gredo v awarded_points, is_bonus deli gredo v bonus_points)
  const handleGradeQuestionPart = async (
    playerId: string,
    slide: Slide,
    existingAnswer: Answer | undefined,
    partId: string,
    newPartPoints: number
  ) => {
    const parts = slide.question_parts || [];
    if (parts.length === 0) return;

    const parsed = parseMultiPartAnswer(existingAnswer?.answer_text);
    const nextPartScores: Record<string, number> = { ...parsed.partScores };
    const safePartPts = roundPoints(
      Math.max(0, Number.isNaN(newPartPoints) ? 0 : newPartPoints)
    );
    nextPartScores[partId] = safePartPts;

    const regularParts = parts.filter((p) => !p.is_bonus);
    const bonusParts = parts.filter((p) => Boolean(p.is_bonus));

    const totalRegularAwarded = roundPoints(
      regularParts.reduce((sum, p) => sum + roundPoints(Number(nextPartScores[p.id] ?? 0)), 0)
    );
    const totalBonusAwarded = roundPoints(
      bonusParts.reduce((sum, p) => sum + roundPoints(Number(nextPartScores[p.id] ?? 0)), 0)
    );
    const updatedAnswerText = serializeMultiPartAnswer(parsed.values, nextPartScores);

    await handleGradeAnswer(
      playerId,
      slide,
      existingAnswer,
      totalRegularAwarded > 0 || totalBonusAwarded > 0,
      totalRegularAwarded,
      undefined,
      bonusParts.length > 0 ? totalBonusAwarded : undefined,
      updatedAnswerText
    );
  };

  // 7. Potrdi točke (z upoštevanjem 2x Jokerja za redne točke + bonus_points brez podvajanja!) in prikaži lestvico
  const handleConfirmGradesAndLeaderboard = async () => {
    setActionLoading(true);
    try {
      // Shrani še neshranjene komentarje gostitelja in aktualne bonus_points
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
            text,
            Number(ans?.bonus_points ?? 0)
          );
        }
      }
      commentDrafts.current = {};

      // Poskrbi, da so vsi spremenjeni bonus_points v trenutni temi zapisani v tabelo answers
      if (data?.currentTheme) {
        const curSlides = data.slidesByTheme[data.currentTheme.id] || [];
        const slideSet = new Set(curSlides.map((s) => s.id));
        const bonusAnswers = data.answers.filter(
          (a) => slideSet.has(a.slide_id) && Number(a.bonus_points ?? 0) > 0
        );
        for (const ans of bonusAnswers) {
          const sl = curSlides.find((s) => s.id === ans.slide_id);
          if (sl) {
            await upsertGradedAnswer(
              sessionId,
              ans.player_id,
              data.currentTheme.id,
              sl.id,
              ans.answer_text ?? '',
              Boolean(ans.is_correct),
              roundPoints(Number(ans.awarded_points ?? 0)),
              ans.host_comment ?? undefined,
              roundPoints(Number(ans.bonus_points ?? 0))
            );
          }
        }
      }

      await confirmThemeGradesAndShowLeaderboard(sessionId);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Napaka pri potrditvi točk in lestvice.');
    } finally {
      setActionLoading(false);
    }
  };

  // 8. Nadaljuj na naslednjo tematiko ali zaključi kviz (vedno začni pri 1. slajdu po order_index = 0!)
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
    const firstSlide = nextSlides[0] || null;
    const nextStatus: GameSessionStatus =
      firstSlide?.slide_type === 'theme_intro' ? 'theme_intro' : 'active_theme';

    setActionLoading(true);
    try {
      const timerPatch = buildSlideTimerPatch(firstSlide, data.session.slide_timers);
      await updateGameSession(sessionId, {
        status: nextStatus,
        current_theme_id: nextTheme.id,
        current_slide_id: firstSlide?.id || null,
        max_slide_index_reached: 0,
        ...timerPatch,
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
      if (isMultiPartSlide(slide)) {
        const partMap: Record<string, string> = {};
        (slide.question_parts || []).forEach((part) => {
          if (part.type === 'multiple_choice') {
            const choices = ['A', 'B', 'C', 'D'];
            partMap[part.id] =
              i === 0 && part.correct_answer ? part.correct_answer : choices[i % 4];
          } else if (part.type === 'closest_number') {
            const base = parseFloat(part.correct_answer || '100') || 100;
            partMap[part.id] = String(base + (i === 0 ? 0 : (i + 1) * 3));
          } else if (part.type === 'closest_date') {
            const baseDate = part.correct_answer || '1991-06-25';
            if (i === 0) {
              partMap[part.id] = baseDate;
            } else {
              const d = new Date(`${baseDate}T00:00:00Z`);
              d.setUTCDate(d.getUTCDate() + i * 5);
              partMap[part.id] = d.toISOString().slice(0, 10);
            }
          } else {
            partMap[part.id] =
              i === 0 && part.correct_answer
                ? part.correct_answer
                : `Odgovor (${p.nickname})`;
          }
        });
        sampleAnswer = serializeMultiPartAnswer(partMap);
      } else if (slide.slide_type === 'multiple_choice') {
        const choices = ['A', 'B', 'C', 'D'];
        sampleAnswer = i === 0 && slide.correct_answer ? slide.correct_answer : choices[i % 4];
      } else if (slide.slide_type === 'closest_number') {
        const base = parseFloat(slide.correct_answer || '1999') || 1999;
        sampleAnswer = String(base + (i === 0 ? 1 : (i + 1) * 4));
      } else if (slide.slide_type === 'closest_date') {
        const baseDate = slide.correct_answer || '1991-06-25';
        if (i === 0) {
          sampleAnswer = baseDate;
        } else {
          const d = new Date(`${baseDate}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + i * 7);
          sampleAnswer = d.toISOString().slice(0, 10);
        }
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
      isMultiPartSlide(s) ||
      s.slide_type === 'multiple_choice' ||
      s.slide_type === 'open_text' ||
      s.slide_type === 'closest_number' ||
      s.slide_type === 'closest_date'
  );

  const lockedSlideIdSet = new Set(normalizeLockedSlideIds(session.locked_slide_ids));
  const normalizedSlideTimers = normalizeSlideTimers(session.slide_timers);
  const highestOpenedIndex = Math.min(
    currentThemeSlides.length - 1,
    Math.max(0, session.max_slide_index_reached, currentSlideIndex)
  );
  const openedThemeQuestionSlides = currentThemeSlides
    .map((slide, idx) => ({ slide, idx }))
    .filter(
      ({ slide, idx }) =>
        idx <= highestOpenedIndex &&
        slide.slide_type !== 'info_only' &&
        slide.slide_type !== 'theme_intro'
    );
  const priorOpenedQuestionSlideIds = openedThemeQuestionSlides
    .filter(({ slide }) => slide.id !== currentSlide?.id)
    .map(({ slide }) => slide.id);
  const allOpenedQuestionSlideIds = openedThemeQuestionSlides.map(({ slide }) => slide.id);
  const isCurrentSlideLocked = currentSlide ? lockedSlideIdSet.has(currentSlide.id) : false;

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
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-xs font-bold">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Tematika {currentThemeIndex + 1} od {data.themes.length}</span>
                </span>
                <div className="flex items-center gap-2">
                  {currentThemeSlides.length > 0 && (
                    <span className="px-2 py-0.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono-code font-bold text-slate-300">
                      Slajd {Math.max(1, currentSlideIndex + 1)} / {currentThemeSlides.length}
                    </span>
                  )}
                  <span className="text-xs text-amber-300 font-semibold">
                    🃏 Joker korak (2x točke)
                  </span>
                </div>
              </div>

              {currentSlide?.slide_image_url && (
                <div className="w-full h-36 rounded-xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center">
                  <img
                    src={currentSlide.slide_image_url}
                    alt={`Slajd ${currentSlideIndex + 1}`}
                    className="w-full h-full object-contain"
                  />
                </div>
              )}

              <h2 className="text-xl font-bold text-slate-100">
                {currentTheme.title}
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Na glavnem zaslonu je prikazan uvod v tematiko. Igralci lahko v tem
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

            {/* Navigacija iz theme_intro: Prejšnji slajd (če je pred Jokerjem npr. info_only naslovnica) + Naprej na naslednji slajd */}
            <div className={`grid gap-3 ${currentSlideIndex > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {currentSlideIndex > 0 && (
                <button
                  id="remote-prev-from-intro-btn"
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleGoToSlide(currentSlideIndex - 1)}
                  className="py-4 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 disabled:opacity-35 text-slate-200 font-bold text-sm flex items-center justify-center gap-1.5 border border-slate-700 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <ChevronLeft className="w-5 h-5" />
                  <span>Prejšnji slajd</span>
                </button>
              )}

              <button
                id="remote-start-theme-questions-btn"
                type="button"
                disabled={actionLoading}
                onClick={handleStartThemeQuestions}
                className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-black text-base shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2.5 transition-all active:scale-[0.99] cursor-pointer disabled:opacity-50"
              >
                <span>
                  {currentSlideIndex < currentThemeSlides.length - 1
                    ? 'Začni z vprašanji tematike'
                    : 'Zaključi tematiko in oceni'}
                </span>
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
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
                {currentSlide.slide_type === 'info_only' ? (
                  <span className="px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-xs font-bold text-cyan-300">
                    Info / Naslovni slajd (brez odgovora)
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-slate-400">
                    Točke: <strong className="text-emerald-400">{currentSlide.points} t</strong>
                  </span>
                )}
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

              {/* Besedilo vprašanja ali info slajda */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {currentSlide.slide_type === 'info_only'
                    ? 'Besedilo / naslov na slajdu'
                    : 'Vprašanje na slajdu'}
                </span>
                <p className="text-sm font-semibold text-slate-100 leading-snug">
                  {currentSlide.question_text || (
                    <span className="italic text-slate-400">
                      Vsebina je prikazana na sliki slajda
                    </span>
                  )}
                </p>
              </div>

              {/* Možni odgovori, če je klasičen multiple_choice */}
              {!isMultiPartSlide(currentSlide) &&
                currentSlide.slide_type === 'multiple_choice' && (
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    {(['A', 'B', 'C', 'D'] as const).map((optKey) => {
                      const isRight =
                        currentSlide.correct_answer === optKey ||
                        Boolean(
                          currentSlide.correct_answer?.trim().toUpperCase().startsWith(optKey)
                        );
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

              {/* Podvprašanja in pravilni odgovori, če je večdelno vprašanje */}
              {isMultiPartSlide(currentSlide) ? (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                    <Layers className="w-4 h-4 shrink-0 text-emerald-400" />
                    <span>
                      Večdelno vprašanje ({currentSlide.question_parts?.length || 0} delov) —
                      Pravilni odgovori:
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {(currentSlide.question_parts || []).map((part, pIdx) => {
                      const isBonus = Boolean(part.is_bonus);
                      return (
                        <div
                          key={part.id}
                          className={`flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-lg border ${
                            isBonus
                              ? 'bg-amber-950/40 border-amber-500/40'
                              : 'bg-slate-950/70 border-slate-800'
                          }`}
                        >
                          <span className="text-slate-200 font-semibold truncate flex items-center gap-1.5">
                            {isBonus && (
                              <span className="px-1.5 py-0.2 rounded bg-amber-400 text-slate-950 text-[9px] font-black uppercase shrink-0">
                                ⭐ BONUS
                              </span>
                            )}
                            <span>{part.label || `Del ${pIdx + 1}`}</span>
                            <span
                              className={`text-[10px] ${
                                isBonus ? 'text-amber-300 font-bold' : 'text-slate-400'
                              }`}
                            >
                              ({part.points} t{isBonus ? ' brez 2x' : ''})
                            </span>
                          </span>
                          <span className="font-mono-code font-black text-emerald-400 shrink-0">
                            {part.type === 'closest_date'
                              ? formatSloveneDate(part.correct_answer)
                              : part.correct_answer || '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Pravilen odgovor (viden SAMO gostitelju na telefonu!) */
                currentSlide.slide_type !== 'theme_intro' &&
                currentSlide.slide_type !== 'info_only' && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-emerald-300">
                      <Eye className="w-4 h-4 shrink-0 text-emerald-400" />
                      <span>Pravilen odgovor (samo za vas):</span>
                    </div>
                    <span className="text-sm font-mono-code font-black text-emerald-400">
                      {currentSlide.slide_type === 'closest_date'
                        ? formatSloveneDate(currentSlide.correct_answer)
                        : currentSlide.correct_answer || 'Ni določen'}
                    </span>
                  </div>
                )
              )}
            </div>

            {/* Števec oddanih odgovorov na trenutni slajd v živo (prikaži samo, če ni info_only) */}
            {currentSlide.slide_type !== 'info_only' &&
              currentSlide.slide_type !== 'theme_intro' && (
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
              )}

            {/* Nadzor časovnika (Hitri gumbi: 30s, 60s, privzeti in Ustavi) */}
            {currentSlide.slide_type !== 'info_only' &&
              currentSlide.slide_type !== 'theme_intro' && (
                <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300">
                      <Clock className="w-4 h-4 text-indigo-400" />
                      <span>Nadzor časovnika (Timer)</span>
                    </div>
                    {timeLeft !== null && activeSlideTimerEntry ? (
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-mono-code font-black ${
                          timeLeft <= 0
                            ? 'bg-rose-500/25 text-rose-200 border border-rose-500/50 animate-pulse'
                            : timeLeft <= 5
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        }`}
                      >
                        {timeLeft <= 0 ? '⏱️ Čas potekel (0s)' : `Odštevanje: ${timeLeft}s`}
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
              )}

            {/* Nadzor zaklepanja vračanja nazaj za igralce (locked_slide_ids) */}
            {openedThemeQuestionSlides.length > 0 && (
              <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300">
                    {isCurrentSlideLocked ? (
                      <Lock className="w-4 h-4 text-rose-400" />
                    ) : (
                      <Unlock className="w-4 h-4 text-emerald-400" />
                    )}
                    <span>Nadzor vračanja nazaj</span>
                  </div>
                  <span className="text-[11px] font-mono-code text-slate-400">
                    Zaklenjeno:{' '}
                    <strong className="text-amber-300">
                      {
                        openedThemeQuestionSlides.filter(({ slide }) =>
                          lockedSlideIdSet.has(slide.id)
                        ).length
                      }
                      /{openedThemeQuestionSlides.length}
                    </strong>
                  </span>
                </div>

                {/* Stikalo za trenutni slajd */}
                {currentSlide.slide_type !== 'info_only' &&
                  currentSlide.slide_type !== 'theme_intro' && (
                    <button
                      id="remote-toggle-current-slide-lock-btn"
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleToggleSlideLock(currentSlide.id)}
                      className={`w-full py-3 px-4 rounded-xl border font-bold text-xs flex items-center justify-between transition-all active:scale-[0.99] cursor-pointer disabled:opacity-50 ${
                        isCurrentSlideLocked
                          ? 'bg-rose-500/20 hover:bg-rose-500/30 border-rose-500/45 text-rose-200'
                          : 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/35 text-emerald-200'
                      }`}
                    >
                      <span>
                        {isCurrentSlideLocked
                          ? '🔒 Zaklenjeno za vračanje'
                          : '🔓 Dovoljeno vračanje nazaj'}
                      </span>
                      <span className="text-[10px] opacity-80">
                        {isCurrentSlideLocked ? 'Klikni za odklep' : 'Trenutno vprašanje'}
                      </span>
                    </button>
                  )}

                {/* Gumb za zaklep vseh dosedanjih (prejšnjih) vprašanj v sklopu + hiter odklep */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    id="remote-lock-all-prior-questions-btn"
                    type="button"
                    disabled={
                      actionLoading ||
                      priorOpenedQuestionSlideIds.length === 0 ||
                      priorOpenedQuestionSlideIds.every((id) => lockedSlideIdSet.has(id))
                    }
                    onClick={() => handleLockAllPriorThemeQuestions(priorOpenedQuestionSlideIds)}
                    className="flex-1 min-w-[200px] py-2.5 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-200 font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-[0.99] cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    <span>🔒 Zakleni vsa dosedanja vprašanja v sklopu</span>
                  </button>

                  {openedThemeQuestionSlides.some(({ slide }) =>
                    lockedSlideIdSet.has(slide.id)
                  ) && (
                    <button
                      id="remote-unlock-all-theme-questions-btn"
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleUnlockAllThemeQuestions(allOpenedQuestionSlideIds)}
                      className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs cursor-pointer disabled:opacity-45"
                    >
                      🔓 Odkleni vsa
                    </button>
                  )}
                </div>

                {/* Hiter seznam že odprtih vprašanj v sklopu */}
                <div className="space-y-1.5 pt-2 border-t border-slate-800">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Odprta vprašanja v tem sklopu
                  </span>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                    {openedThemeQuestionSlides.map(({ slide, idx }) => {
                      const isLocked = lockedSlideIdSet.has(slide.id);
                      const isCur = slide.id === currentSlide.id;
                      const timerEntry = normalizedSlideTimers[slide.id];
                      const isTimerDone =
                        Boolean(timerEntry) &&
                        Date.now() >=
                          new Date(timerEntry.started_at).getTime() + timerEntry.duration * 1000;

                      return (
                        <div
                          key={slide.id}
                          className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl border text-xs ${
                            isCur
                              ? 'bg-indigo-500/10 border-indigo-500/35'
                              : 'bg-slate-950/70 border-slate-800'
                          }`}
                        >
                          <div className="min-w-0 flex items-center gap-1.5">
                            <span className="font-mono-code font-bold text-indigo-300 shrink-0">
                              #{idx + 1}
                            </span>
                            <span className="text-slate-200 truncate">
                              {slide.question_text || `Vprašanje ${idx + 1}`}
                            </span>
                            {isCur && (
                              <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 text-[9px] font-bold shrink-0">
                                Trenutni
                              </span>
                            )}
                            {isTimerDone && (
                              <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 text-[9px] font-bold shrink-0">
                                ⏱️ Potekel
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            disabled={actionLoading}
                            onClick={() => handleToggleSlideLock(slide.id)}
                            className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold shrink-0 transition-colors cursor-pointer disabled:opacity-45 ${
                              isLocked
                                ? 'bg-rose-500/20 hover:bg-rose-500/30 border-rose-500/40 text-rose-200'
                                : 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/35 text-emerald-200'
                            }`}
                          >
                            {isLocked
                              ? '🔒 Zaklenjeno za vračanje'
                              : '🔓 Dovoljeno vračanje nazaj'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

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
                Izbirni (<code className="text-indigo-300">multiple_choice</code>), najbližje
                število (<code className="text-indigo-300">closest_number</code>) in najbližji
                datum (<code className="text-indigo-300">closest_date</code> — samodejno
                razvrščeno od najbližjega do najbolj oddaljenega) so samodejno pred-ocenjeni.
                Točke lahko prilagajate po korakih <strong className="text-slate-200">0.25</strong>.
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
                  const multiPart = isMultiPartSlide(slide);
                  const parts = slide.question_parts || [];
                  const regularParts = parts.filter((p) => !p.is_bonus);
                  const bonusParts = parts.filter((p) => Boolean(p.is_bonus));
                  const maxPts = roundPoints(
                    multiPart
                      ? regularParts.reduce((sum, p) => sum + Number(p.points ?? 1), 0)
                      : Number(slide.points ?? 1)
                  );
                  const maxBonusFromParts = roundPoints(
                    bonusParts.reduce((sum, p) => sum + Number(p.points ?? 0.5), 0)
                  );
                  const slideAnswers = answers.filter((a) => a.slide_id === slide.id);

                  // Če je closest_number, izračunamo najmanjšo razliko za prikaz ob odgovoru
                  const targetNum =
                    !multiPart && slide.slide_type === 'closest_number'
                      ? parseFloat((slide.correct_answer || '').replace(',', '.'))
                      : NaN;

                  // Samodejna razvrstitev tekmovalcev pri closest_date (od najmanjšega odstopanja v dneh do največjega)
                  const datePartForSorting = multiPart
                    ? parts.find((p) => p.type === 'closest_date')
                    : undefined;
                  const shouldSortByDate =
                    (!multiPart && slide.slide_type === 'closest_date') ||
                    Boolean(datePartForSorting);

                  const sortedPlayersForSlide = shouldSortByDate
                    ? [...players].sort((pA, pB) => {
                        const ansA = slideAnswers.find((a) => a.player_id === pA.id);
                        const ansB = slideAnswers.find((a) => a.player_id === pB.id);
                        let diffA: number | null = null;
                        let diffB: number | null = null;

                        if (!multiPart && slide.slide_type === 'closest_date') {
                          diffA = calculateDateDiffDays(ansA?.answer_text, slide.correct_answer);
                          diffB = calculateDateDiffDays(ansB?.answer_text, slide.correct_answer);
                        } else if (datePartForSorting) {
                          const parsedA = parseMultiPartAnswer(ansA?.answer_text);
                          const parsedB = parseMultiPartAnswer(ansB?.answer_text);
                          diffA = calculateDateDiffDays(
                            parsedA.values[datePartForSorting.id],
                            datePartForSorting.correct_answer
                          );
                          diffB = calculateDateDiffDays(
                            parsedB.values[datePartForSorting.id],
                            datePartForSorting.correct_answer
                          );
                        }

                        if (diffA === null && diffB === null) return 0;
                        if (diffA === null) return 1;
                        if (diffB === null) return -1;
                        return diffA - diffB;
                      })
                    : players;

                  // Hitri gumbi za enodelno vprašanje (koraki po 0.25)
                  const quickPointButtons = Array.from(
                    new Set(
                      [0, 0.25, 0.5, 0.75, 1, maxPts].map((v) => roundPoints(v))
                    )
                  ).sort((a, b) => a - b);

                  return (
                    <div
                      key={slide.id}
                      className="bg-slate-900/85 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 space-y-3.5 shadow-lg"
                    >
                      {/* Naslov vprašanja in pravilen odgovor */}
                      <div className="space-y-1.5 pb-2.5 border-b border-slate-800">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 flex-wrap">
                            {multiPart ? (
                              <Layers className="w-3.5 h-3.5 text-indigo-400" />
                            ) : (
                              <>
                                {slide.slide_type === 'multiple_choice' && (
                                  <ListChecks className="w-3.5 h-3.5" />
                                )}
                                {slide.slide_type === 'open_text' && (
                                  <Type className="w-3.5 h-3.5" />
                                )}
                                {slide.slide_type === 'closest_number' && (
                                  <Hash className="w-3.5 h-3.5" />
                                )}
                                {slide.slide_type === 'closest_date' && (
                                  <Calendar className="w-3.5 h-3.5 text-amber-400" />
                                )}
                              </>
                            )}
                            <span>
                              Vprašanje #{qIdx + 1} ({maxPts} t rednih
                              {maxBonusFromParts > 0 ? ` + ⭐ ${maxBonusFromParts} t bonus` : ''})
                              {multiPart ? ` • ${parts.length} delov` : ''}
                            </span>
                          </span>
                          {!multiPart && (
                            <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs font-mono-code font-bold text-emerald-300">
                              Pravilno:{' '}
                              {slide.slide_type === 'closest_date'
                                ? formatSloveneDate(slide.correct_answer)
                                : slide.correct_answer || '—'}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-slate-100">
                          {slide.question_text || `Slajd #${slide.order_index + 1}`}
                        </p>
                        {shouldSortByDate && (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-[11px] font-semibold text-amber-200">
                            <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span>
                              Seznam je samodejno razvrščen od najbližjega datuma (zgoraj) do
                              najbolj oddaljenega (spodaj).
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Seznam vseh tekmovalcev in njihovih odgovorov */}
                      {sortedPlayersForSlide.length === 0 ? (
                        <p className="text-xs text-slate-500 italic">
                          Ni prijavljenih tekmovalcev.
                        </p>
                      ) : (
                        <div className="space-y-2.5">
                          {sortedPlayersForSlide.map((player, sortRankIdx) => {
                            const ans = slideAnswers.find(
                              (a) => a.player_id === player.id
                            );
                            const isCorrect = Boolean(ans?.is_correct);
                            const awarded = roundPoints(Number(ans?.awarded_points ?? 0));
                            const bonusPts = roundPoints(Number(ans?.bonus_points ?? 0));
                            const usedJoker = jokersForCurrentTheme.has(player.id);

                            // Izračun razlike za closest_number ali closest_date (enodelno vprašanje)
                            let diffLabel: string | null = null;
                            let isExactDateMatch = false;
                            if (
                              !multiPart &&
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
                            } else if (
                              !multiPart &&
                              slide.slide_type === 'closest_date' &&
                              ans?.answer_text
                            ) {
                              const diffDays = calculateDateDiffDays(
                                ans.answer_text,
                                slide.correct_answer
                              );
                              if (diffDays !== null) {
                                diffLabel = formatDaysDeviationLabel(diffDays);
                                isExactDateMatch = diffDays === 0;
                              }
                            }

                            const parsedMulti = multiPart
                              ? parseMultiPartAnswer(ans?.answer_text)
                              : null;

                            return (
                              <div
                                key={player.id}
                                className={`p-3 rounded-xl border transition-all space-y-2.5 ${
                                  isCorrect || awarded > 0 || bonusPts > 0
                                    ? 'bg-emerald-500/10 border-emerald-500/40'
                                    : 'bg-slate-950/80 border-slate-800'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {shouldSortByDate && (
                                        <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono-code text-[10px] font-bold">
                                          #{sortRankIdx + 1}
                                        </span>
                                      )}
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
                                      {bonusPts > 0 && (
                                        <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-400/50 text-[10px] font-bold">
                                          ⭐ +{bonusPts} bonus (brez 2x)
                                        </span>
                                      )}
                                      {diffLabel && (
                                        <span
                                          className={`px-2 py-0.5 rounded-md text-[10px] font-mono-code font-bold border ${
                                            isExactDateMatch
                                              ? 'bg-emerald-500/25 text-emerald-200 border-emerald-400/50'
                                              : 'bg-violet-500/20 text-violet-200 border-violet-500/40'
                                          }`}
                                        >
                                          {diffLabel}
                                        </span>
                                      )}
                                    </div>

                                    {/* Prikaz odgovora za ENODELNO vprašanje */}
                                    {!multiPart && (
                                      <p className="text-sm font-mono-code font-bold text-white mt-0.5 break-words">
                                        {ans?.answer_text ? (
                                          slide.slide_type === 'closest_date' ? (
                                            formatSloveneDate(ans.answer_text)
                                          ) : (
                                            ans.answer_text
                                          )
                                        ) : (
                                          <span className="text-xs italic text-slate-500 font-sans font-normal">
                                            Brez oddanega odgovora
                                          </span>
                                        )}
                                      </p>
                                    )}
                                  </div>

                                  {/* Hiter preklopnik: Zelena kljukica (Vse pravilno) / Rdeč križec (Napačno - 0 t) */}
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (multiPart && parsedMulti) {
                                          const fullPartScores: Record<string, number> = {};
                                          parts.forEach((p) => {
                                            fullPartScores[p.id] = roundPoints(
                                              Number(p.points ?? (p.is_bonus ? 0.5 : 1))
                                            );
                                          });
                                          handleGradeAnswer(
                                            player.id,
                                            slide,
                                            ans,
                                            true,
                                            maxPts,
                                            undefined,
                                            bonusParts.length > 0 ? maxBonusFromParts : undefined,
                                            serializeMultiPartAnswer(
                                              parsedMulti.values,
                                              fullPartScores
                                            )
                                          );
                                        } else {
                                          handleGradeAnswer(
                                            player.id,
                                            slide,
                                            ans,
                                            true,
                                            maxPts
                                          );
                                        }
                                      }}
                                      className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                                        awarded === maxPts &&
                                        (maxPts > 0 || (maxBonusFromParts > 0 && bonusPts === maxBonusFromParts))
                                          ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30 font-bold'
                                          : 'bg-slate-800 text-slate-400 hover:text-emerald-400'
                                      }`}
                                      title="Podeli polne točke"
                                    >
                                      <Check className="w-5 h-5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (multiPart && parsedMulti) {
                                          const zeroPartScores: Record<string, number> = {};
                                          parts.forEach((p) => {
                                            zeroPartScores[p.id] = 0;
                                          });
                                          handleGradeAnswer(
                                            player.id,
                                            slide,
                                            ans,
                                            false,
                                            0,
                                            undefined,
                                            bonusParts.length > 0 ? 0 : undefined,
                                            serializeMultiPartAnswer(
                                              parsedMulti.values,
                                              zeroPartScores
                                            )
                                          );
                                        } else {
                                          handleGradeAnswer(
                                            player.id,
                                            slide,
                                            ans,
                                            false,
                                            0
                                          );
                                        }
                                      }}
                                      className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                                        !isCorrect && awarded === 0 && bonusPts === 0
                                          ? 'bg-rose-500 text-white shadow-md shadow-rose-500/30 font-bold'
                                          : 'bg-slate-800 text-slate-400 hover:text-rose-400'
                                      }`}
                                      title="Označi kot napačno (0 točk)"
                                    >
                                      <X className="w-5 h-5" />
                                    </button>
                                  </div>
                                </div>

                                {/* VEČDELNO VPRAŠANJE: Ločeno ocenjevanje vsakega podvprašanja in bonus vprašanja */}
                                {multiPart && parsedMulti && (
                                  <div className="space-y-2 pt-1.5 border-t border-slate-800/80">
                                    {parts.map((part, pIdx) => {
                                      const isBonus = Boolean(part.is_bonus);
                                      const rawVal = parsedMulti.values[part.id] ?? '';
                                      const partMaxPts = roundPoints(
                                        Number(part.points ?? (isBonus ? 0.5 : 1))
                                      );
                                      const currentPartScore = roundPoints(
                                        Number(parsedMulti.partScores[part.id] ?? 0)
                                      );

                                      let partDiffBadge: string | null = null;
                                      let partExactDate = false;
                                      if (part.type === 'closest_date' && rawVal) {
                                        const dDays = calculateDateDiffDays(
                                          rawVal,
                                          part.correct_answer
                                        );
                                        if (dDays !== null) {
                                          partDiffBadge = formatDaysDeviationLabel(dDays);
                                          partExactDate = dDays === 0;
                                        }
                                      } else if (part.type === 'closest_number' && rawVal) {
                                        const tNum = parseFloat(
                                          (part.correct_answer || '').replace(',', '.')
                                        );
                                        const pNum = parseFloat(rawVal.trim().replace(',', '.'));
                                        if (!Number.isNaN(tNum) && !Number.isNaN(pNum)) {
                                          const diff =
                                            Math.round(Math.abs(pNum - tNum) * 100) / 100;
                                          partDiffBadge = `Δ = ${diff}`;
                                        }
                                      }

                                      const partQuickButtons = Array.from(
                                        new Set(
                                          [0, 0.25, 0.5, 0.75, 1, partMaxPts].map((v) =>
                                            roundPoints(v)
                                          )
                                        )
                                      ).sort((a, b) => a - b);

                                      return (
                                        <div
                                          key={part.id}
                                          className={`p-2.5 rounded-xl border space-y-2 ${
                                            isBonus
                                              ? 'bg-amber-950/35 border-amber-400/50'
                                              : 'bg-slate-900/90 border-slate-800'
                                          }`}
                                        >
                                          <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                              <div className="flex items-center gap-1.5 flex-wrap">
                                                {isBonus && (
                                                  <span className="px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 text-[9px] font-black uppercase tracking-wider">
                                                    ⭐ Bonus vprašanje (ne šteje v 2x Joker)
                                                  </span>
                                                )}
                                                <span
                                                  className={`text-[11px] font-bold ${
                                                    isBonus ? 'text-amber-200' : 'text-indigo-300'
                                                  }`}
                                                >
                                                  {part.label || `Del ${pIdx + 1}`} ({partMaxPts}{' '}
                                                  t{isBonus ? ' ⭐' : ''})
                                                </span>
                                                <span className="text-[10px] font-mono-code text-emerald-300/90 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/25">
                                                  Pravilno:{' '}
                                                  {part.type === 'closest_date'
                                                    ? formatSloveneDate(part.correct_answer)
                                                    : part.correct_answer || '—'}
                                                </span>
                                                {partDiffBadge && (
                                                  <span
                                                    className={`px-1.5 py-0.2 rounded text-[10px] font-mono-code font-bold border ${
                                                      partExactDate
                                                        ? 'bg-emerald-500/25 text-emerald-200 border-emerald-400/50'
                                                        : 'bg-violet-500/20 text-violet-200 border-violet-500/40'
                                                    }`}
                                                  >
                                                    {partDiffBadge}
                                                  </span>
                                                )}
                                              </div>
                                              <p className="text-xs font-mono-code font-bold text-white mt-1 break-words">
                                                {rawVal ? (
                                                  part.type === 'closest_date' ? (
                                                    formatSloveneDate(rawVal)
                                                  ) : (
                                                    rawVal
                                                  )
                                                ) : (
                                                  <span className="italic text-slate-500 font-sans font-normal">
                                                    Brez odgovora
                                                  </span>
                                                )}
                                              </p>
                                            </div>
                                          </div>

                                          {/* Hitri gumbi za del vprašanja (korak 0.25) */}
                                          <div className="flex items-center justify-between gap-2 flex-wrap">
                                            <div className="flex items-center gap-1 flex-wrap">
                                              {partQuickButtons.map((ptsVal) => (
                                                <button
                                                  key={ptsVal}
                                                  type="button"
                                                  onClick={() =>
                                                    handleGradeQuestionPart(
                                                      player.id,
                                                      slide,
                                                      ans,
                                                      part.id,
                                                      ptsVal
                                                    )
                                                  }
                                                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                                                    currentPartScore === ptsVal
                                                      ? ptsVal === 0
                                                        ? 'bg-rose-500/30 text-rose-200 border border-rose-500/50'
                                                        : ptsVal >= partMaxPts
                                                        ? isBonus
                                                          ? 'bg-amber-400 text-slate-950 shadow-sm'
                                                          : 'bg-emerald-500 text-slate-950 shadow-sm'
                                                        : 'bg-amber-500/30 text-amber-200 border border-amber-500/50'
                                                      : 'bg-slate-950 text-slate-400 hover:bg-slate-800 border border-slate-800'
                                                  }`}
                                                >
                                                  {ptsVal === 0
                                                    ? '0'
                                                    : `+${ptsVal}${isBonus ? ' ⭐' : ''}`}
                                                </button>
                                              ))}
                                            </div>

                                            <div className="flex items-center gap-1">
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleGradeQuestionPart(
                                                    player.id,
                                                    slide,
                                                    ans,
                                                    part.id,
                                                    Math.max(0, roundPoints(currentPartScore - 0.25))
                                                  )
                                                }
                                                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-300 cursor-pointer"
                                                title="-0.25 točke"
                                              >
                                                -0.25
                                              </button>
                                              <input
                                                type="number"
                                                step="0.25"
                                                min={0}
                                                value={currentPartScore}
                                                onChange={(e) => {
                                                  const val = parseFloat(e.target.value || '0');
                                                  handleGradeQuestionPart(
                                                    player.id,
                                                    slide,
                                                    ans,
                                                    part.id,
                                                    val
                                                  );
                                                }}
                                                className={`w-14 px-1.5 py-0.5 rounded-lg bg-slate-950 border text-right font-mono-code font-bold text-xs focus:outline-none ${
                                                  isBonus
                                                    ? 'border-amber-500/50 text-amber-300 focus:border-amber-400'
                                                    : 'border-slate-700 text-emerald-400 focus:border-indigo-500'
                                                }`}
                                              />
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleGradeQuestionPart(
                                                    player.id,
                                                    slide,
                                                    ans,
                                                    part.id,
                                                    roundPoints(currentPartScore + 0.25)
                                                  )
                                                }
                                                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-emerald-300 cursor-pointer"
                                                title="+0.25 točke"
                                              >
                                                +0.25
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {/* Hitri gumbi za skupne točke slajda (koraki po 0.25: 0, 0.25, 0.5, 0.75, 1, max) + poljubni vnos */}
                                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-800/70 flex-wrap">
                                  <div className="flex items-center gap-1 flex-wrap">
                                    {quickPointButtons.map((ptsVal) => (
                                      <button
                                        key={ptsVal}
                                        type="button"
                                        onClick={() =>
                                          handleGradeAnswer(
                                            player.id,
                                            slide,
                                            ans,
                                            ptsVal > 0,
                                            ptsVal
                                          )
                                        }
                                        className={`px-2 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                          awarded === ptsVal
                                            ? ptsVal === 0
                                              ? 'bg-rose-500/30 text-rose-200 border border-rose-500/50'
                                              : ptsVal >= maxPts
                                              ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-500/50'
                                              : 'bg-amber-500/30 text-amber-200 border border-amber-500/50'
                                            : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                                        }`}
                                      >
                                        {ptsVal === 0 ? '0' : `+${ptsVal}`}
                                      </button>
                                    ))}
                                  </div>

                                  <div className="flex items-center gap-1">
                                    <span className="text-[11px] text-slate-400 mr-0.5">
                                      Skupaj:
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nextVal = Math.max(0, roundPoints(awarded - 0.25));
                                        handleGradeAnswer(
                                          player.id,
                                          slide,
                                          ans,
                                          nextVal > 0,
                                          nextVal
                                        );
                                      }}
                                      className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                                      title="Odštej 0.25 točke"
                                    >
                                      <Minus className="w-3.5 h-3.5" />
                                    </button>
                                    <input
                                      type="number"
                                      step="0.25"
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
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nextVal = roundPoints(awarded + 0.25);
                                        handleGradeAnswer(
                                          player.id,
                                          slide,
                                          ans,
                                          nextVal > 0,
                                          nextVal
                                        );
                                      }}
                                      className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 cursor-pointer"
                                      title="Prištej 0.25 točke"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                {/* Razdelek za Bonus točke (ne štejejo v 2x Joker) — korak 0.25 */}
                                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-1.5">
                                  <span className="block text-[10px] font-bold text-amber-300">
                                    ⭐ Bonus točke (ne štejejo v 2x Joker)
                                  </span>
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-1 flex-wrap">
                                      {[
                                        { label: '0', val: 0 },
                                        { label: '+0.25', val: 0.25 },
                                        { label: '+0.5', val: 0.5 },
                                        { label: '+0.75', val: 0.75 },
                                        { label: '+1', val: 1 },
                                      ].map((btn) => (
                                        <button
                                          key={btn.label}
                                          type="button"
                                          onClick={() =>
                                            handleGradeAnswer(
                                              player.id,
                                              slide,
                                              ans,
                                              isCorrect,
                                              awarded,
                                              undefined,
                                              btn.val
                                            )
                                          }
                                          className={`px-2 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                            bonusPts === btn.val && (btn.val > 0 || bonusPts === 0)
                                              ? btn.val === 0
                                                ? 'bg-slate-800 text-slate-200 border border-slate-600'
                                                : 'bg-amber-500 text-slate-950 shadow-sm'
                                              : 'bg-slate-900 text-amber-200/80 hover:bg-slate-800 border border-amber-500/20'
                                          }`}
                                        >
                                          {btn.label}
                                        </button>
                                      ))}
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[11px] text-amber-200/80">Bonus:</span>
                                      <input
                                        type="number"
                                        step="0.25"
                                        min="0"
                                        value={bonusPts}
                                        onChange={(e) => {
                                          const rawVal = parseFloat(e.target.value || '0');
                                          const safeBonusVal = roundPoints(
                                            Math.max(0, Number.isNaN(rawVal) ? 0 : rawVal)
                                          );
                                          handleGradeAnswer(
                                            player.id,
                                            slide,
                                            ans,
                                            isCorrect,
                                            awarded,
                                            undefined,
                                            safeBonusVal
                                          );
                                        }}
                                        className="w-16 px-2 py-1 rounded-lg bg-slate-950 border border-amber-500/40 text-right font-mono-code font-bold text-xs text-amber-300 focus:outline-none focus:border-amber-400"
                                      />
                                    </div>
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
                                        e.target.value,
                                        bonusPts
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

            {/* Povzetek točk trenutne tematike z upoštevanim 2x JOKERJEM in bonus točkami */}
            {players.length > 0 && (
              <div className="bg-slate-900/90 border border-amber-500/30 rounded-2xl p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                    Predogled izračuna teme (2x Joker + ⭐ Bonus)
                  </span>
                </div>
                <div className="space-y-1.5">
                  {players.map((p) => {
                    const redneTocke = roundPoints(
                      gradableSlides.reduce((acc, sl) => {
                        const ansForSlide = answers.find(
                          (a) => a.player_id === p.id && a.slide_id === sl.id
                        );
                        return acc + Number(ansForSlide?.awarded_points ?? 0);
                      }, 0)
                    );
                    const bonusTocke = roundPoints(
                      gradableSlides.reduce((acc, sl) => {
                        const ansForSlide = answers.find(
                          (a) => a.player_id === p.id && a.slide_id === sl.id
                        );
                        return acc + Number(ansForSlide?.bonus_points ?? 0);
                      }, 0)
                    );
                    const hasJoker = jokersForCurrentTheme.has(p.id);
                    const tockeTeme = roundPoints(
                      (hasJoker ? redneTocke * 2 : redneTocke) + bonusTocke
                    );

                    let formulaText = `+${tockeTeme} t`;
                    if (hasJoker && bonusTocke > 0) {
                      formulaText = `(${redneTocke} × 2) + ${bonusTocke} ⭐ = +${tockeTeme} t`;
                    } else if (hasJoker) {
                      formulaText = `${redneTocke} × 2 = +${tockeTeme} t`;
                    } else if (bonusTocke > 0) {
                      formulaText = `${redneTocke} + ${bonusTocke} ⭐ = +${tockeTeme} t`;
                    }

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
                          {bonusTocke > 0 && (
                            <span className="text-[10px] font-bold text-amber-300">
                              (⭐ +{bonusTocke})
                            </span>
                          )}
                        </span>
                        <span className="font-mono-code font-bold text-emerald-400">
                          {formulaText}
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
