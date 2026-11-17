import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PlayerResultsReview } from './PlayerResultsReview';
import confetti from 'canvas-confetti';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Info,
  Layers,
  Loader2,
  Lock,
  LogOut,
  Radio,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react';
import {
  formatSloveneDate,
  hasAnyMultiPartValue,
  isMultiPartSlide,
  parseMultiPartAnswer,
  roundPoints,
  serializeMultiPartAnswer,
} from '../lib/questionUtils';
import {
  fetchPlayerGameData,
  findSessionByRoomCode,
  joinSessionAsPlayer,
  playerActivateJoker,
  reconnectPlayer,
  savePlayerAnswer,
  savePlayerAnswerKeepalive,
  subscribeToDemoUpdates,
} from '../lib/quizService';
import { getSupabaseClient } from '../lib/supabase';
import type { Answer, PlayerFullData, PlayerJoker, Slide } from '../types/quiz';

const LOCAL_STORAGE_KEY = 'trivia_player_session_v1';

interface StoredPlayerSession {
  sessionId: string;
  playerId: string;
  reconnectToken: string;
  roomCode: string;
}

interface PlayerViewProps {
  initialRoomCode?: string;
  onExit?: () => void;
}

export const PlayerView: React.FC<PlayerViewProps> = ({
  initialRoomCode = '',
  onExit,
}) => {
  // Stanje prijave / vstopa
  const [roomCodeInput, setRoomCodeInput] = useState(initialRoomCode);
  const [nicknameInput, setNicknameInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Stanje igralca v igri
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [gameData, setGameData] = useState<PlayerFullData | null>(null);
  const [loadingGame, setLoadingGame] = useState(true);

  // Navigacija po slajdih trenutne teme (igralec lahko izbere katerikoli slajd <= max_slide_index_reached)
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);

  // Ločeno lokalno stanje osnutkov odgovorov po ID-ju slajda (drafts[slide.id] oz. drafts[`${slide.id}:${part.id}`])
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  type AutoSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
  const [autoSaveStatusBySlide, setAutoSaveStatusBySlide] = useState<Record<string, AutoSaveStatus>>({});
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);

  // Časovnik v živo
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Joker aktivacija
  const [activatingJoker, setActivatingJoker] = useState(false);

  // Sledenje zadnjemu videnemu current_slide_id in current_theme_id iz game_sessions ter sinhroni ref-i za auto-save
  const lastSeenSlideIdRef = useRef<string | null>(null);
  const lastSeenThemeIdRef = useRef<string | null>(null);
  const prevStatusRef = useRef<string | null>(null);
  const draftsRef = useRef<Record<string, string>>({});
  const gameDataRef = useRef<PlayerFullData | null>(null);
  const selectedSlideIdRef = useRef<string | null>(null);
  const timeLeftRef = useRef<number | null>(null);
  const debounceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const dirtySlidesRef = useRef<Record<string, Slide>>({});
  const lastConfirmedTextRef = useRef<Record<string, string>>({});
  const inFlightSaveCountRef = useRef<Record<string, number>>({});
  const lastLocalSaveTimestampRef = useRef<Record<string, number>>({});
  const pendingKeepalivePayloadRef = useRef<Record<string, { slide: Slide; serialized: string }>>({});
  const unverifiedKeepaliveSlidesRef = useRef<Record<string, { slide: Slide; text: string }>>({});
  const saveNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTimerExpiredSlideIdRef = useRef<string | null>(null);

  // Ohrani ref-e vedno sinhrone s stanjem
  useEffect(() => {
    gameDataRef.current = gameData;
  }, [gameData]);

  useEffect(() => {
    selectedSlideIdRef.current = selectedSlideId;
  }, [selectedSlideId]);

  const setSlideAutoSaveStatus = (slideId: string, status: AutoSaveStatus) => {
    setAutoSaveStatusBySlide((prev) =>
      prev[slideId] === status ? prev : { ...prev, [slideId]: status }
    );
  };

  // Izračuna končni niz (JSON za večdelna vprašanja ali navaden niz) iz osnutkov
  const computeSerializedSlideAnswer = (
    slide: Slide,
    draftsMap: Record<string, string>,
    savedAnswersMap: Record<string, Answer>
  ): string => {
    if (isMultiPartSlide(slide) && slide.question_parts) {
      const savedValues = parseMultiPartAnswer(savedAnswersMap[slide.id]?.answer_text).values;
      const map: Record<string, string> = {};
      for (const part of slide.question_parts) {
        const compositeKey = `${slide.id}:${part.id}`;
        const rawVal =
          draftsMap[compositeKey] !== undefined
            ? draftsMap[compositeKey]
            : savedValues[part.id] ?? '';
        map[part.id] = rawVal.trim();
      }
      const serialized = serializeMultiPartAnswer(map);
      return hasAnyMultiPartValue(serialized) ? serialized : '';
    }
    const rawSingle =
      draftsMap[slide.id] !== undefined
        ? draftsMap[slide.id]
        : savedAnswersMap[slide.id]?.answer_text ?? '';
    return rawSingle.trim();
  };

  // Poišče definicijo slajda znotraj trenutno naloženih tematik
  const findSlideById = (slideId: string, data: PlayerFullData | null): Slide | null => {
    if (!data?.slidesByTheme) return null;
    for (const list of Object.values(data.slidesByTheme)) {
      const found = list.find((s) => s.id === slideId);
      if (found) return found;
    }
    return null;
  };

  // Prenesi shranjene odgovore iz baze v lokalne osnutke SAMO takrat, ko je drafts[key] === undefined
  const seedDraftsFromSavedAnswers = (savedAnswers: Record<string, Answer>) => {
    setDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [sId, ans] of Object.entries(savedAnswers)) {
        if (ans?.answer_text !== undefined) {
          if (next[sId] === undefined) {
            next[sId] = ans.answer_text;
            changed = true;
          }
          // Če gre za večdelni JSON odgovor, napolni tudi ključe `${sId}:${partId}` samo če še niso nastavljeni
          const { values } = parseMultiPartAnswer(ans.answer_text);
          for (const [partId, partVal] of Object.entries(values)) {
            const compositeKey = `${sId}:${partId}`;
            if (next[compositeKey] === undefined) {
              next[compositeKey] = partVal;
              changed = true;
            }
          }
        }
      }
      if (changed) {
        draftsRef.current = next;
        return next;
      }
      return prev;
    });

    // Posodobi referenco potrjenih vrednosti za slajde, ki nimajo aktivnega shranjevanja ali neshranjenih sprememb
    for (const [sId, ans] of Object.entries(savedAnswers)) {
      if (
        ans?.answer_text !== undefined &&
        !dirtySlidesRef.current[sId] &&
        (inFlightSaveCountRef.current[sId] || 0) === 0
      ) {
        lastConfirmedTextRef.current[sId] = ans.answer_text;
      }
    }
  };

  // Izvede dejanski zapis v Supabase tabelo answers (brez spreminjanja vnosnih osnutkov!)
  const performSaveForSlide = async (
    slide: Slide,
    cleanVal: string,
    options?: { showManualNotice?: boolean }
  ) => {
    const dataNow = gameDataRef.current;
    if (!dataNow) return;

    const slideId = slide.id;
    const themeId = slide.theme_id || dataNow.currentTheme?.id || dataNow.session.current_theme_id;
    if (!themeId) return;

    const sessionId = dataNow.session.id;
    const playerId = dataNow.player.id;

    inFlightSaveCountRef.current[slideId] = (inFlightSaveCountRef.current[slideId] || 0) + 1;
    lastLocalSaveTimestampRef.current[slideId] = Date.now();
    pendingKeepalivePayloadRef.current[slideId] = { slide, serialized: cleanVal };
    setSlideAutoSaveStatus(slideId, 'saving');

    // Optimistična posodobitev myAnswers (nikoli ne spreminja drafts!)
    setGameData((prev: PlayerFullData | null) => {
      if (!prev) return prev;
      const existing = prev.myAnswers[slideId];
      const optimisticAns: Answer = {
        id: existing?.id || `local-${slideId}`,
        session_id: prev.session.id,
        player_id: prev.player.id,
        theme_id: themeId,
        slide_id: slideId,
        answer_text: cleanVal,
        is_correct: false,
        awarded_points: 0,
        bonus_points: 0,
        graded: false,
      };
      const updated = {
        ...prev,
        myAnswers: { ...prev.myAnswers, [slideId]: optimisticAns },
      };
      gameDataRef.current = updated;
      return updated;
    });

    try {
      const savedAns = await savePlayerAnswer(
        sessionId,
        playerId,
        themeId,
        slideId,
        cleanVal
      );

      lastConfirmedTextRef.current[slideId] = savedAns.answer_text;
      lastLocalSaveTimestampRef.current[slideId] = Date.now();
      delete unverifiedKeepaliveSlidesRef.current[slideId];

      if (pendingKeepalivePayloadRef.current[slideId]?.serialized === cleanVal) {
        delete pendingKeepalivePayloadRef.current[slideId];
      }

      setGameData((prev: PlayerFullData | null) => {
        if (!prev) return prev;
        // Če je medtem uporabnik že začel shranjevati novejšo vrednost, obdrži novejšo v stanju
        const currentPending = pendingKeepalivePayloadRef.current[slideId];
        if (currentPending && currentPending.serialized !== savedAns.answer_text) {
          return prev;
        }
        const updated = {
          ...prev,
          myAnswers: { ...prev.myAnswers, [slideId]: savedAns },
        };
        gameDataRef.current = updated;
        return updated;
      });

      if (options?.showManualNotice) {
        setSaveSuccessNotice(true);
        if (saveNoticeTimeoutRef.current) clearTimeout(saveNoticeTimeoutRef.current);
        saveNoticeTimeoutRef.current = setTimeout(() => setSaveSuccessNotice(false), 2000);
      }
    } catch (err: unknown) {
      // Ob napaki vrni v umazane slajde, da se lahko ob naslednjem poskusu shrani
      dirtySlidesRef.current[slideId] = slide;
      setSlideAutoSaveStatus(slideId, 'error');
      if (options?.showManualNotice) {
        alert(err instanceof Error ? err.message : 'Napaka pri shranjevanju odgovora.');
      }
      return;
    } finally {
      inFlightSaveCountRef.current[slideId] = Math.max(
        0,
        (inFlightSaveCountRef.current[slideId] || 1) - 1
      );
      if (
        !dirtySlidesRef.current[slideId] &&
        inFlightSaveCountRef.current[slideId] === 0
      ) {
        setSlideAutoSaveStatus(slideId, 'saved');
      }
    }
  };

  // Takojšnje praznjenje čakajočega osnutka za določen slajd
  const flushSlideById = async (
    slideId: string,
    options?: { keepalive?: boolean; forceManual?: boolean }
  ) => {
    if (debounceTimersRef.current[slideId]) {
      clearTimeout(debounceTimersRef.current[slideId]);
      delete debounceTimersRef.current[slideId];
    }

    const dataNow = gameDataRef.current;
    if (!dataNow) return;

    const slide =
      dirtySlidesRef.current[slideId] ||
      pendingKeepalivePayloadRef.current[slideId]?.slide ||
      findSlideById(slideId, dataNow);
    if (!slide) {
      delete dirtySlidesRef.current[slideId];
      return;
    }

    const serialized = computeSerializedSlideAnswer(slide, draftsRef.current, dataNow.myAnswers);
    const prevConfirmed =
      lastConfirmedTextRef.current[slideId] ?? dataNow.myAnswers[slideId]?.answer_text ?? '';

    delete dirtySlidesRef.current[slideId];

    if (!serialized && !prevConfirmed) {
      if ((inFlightSaveCountRef.current[slideId] || 0) === 0) {
        setSlideAutoSaveStatus(slideId, 'idle');
      }
      return;
    }

    if (serialized === prevConfirmed && !options?.forceManual && !pendingKeepalivePayloadRef.current[slideId]) {
      if ((inFlightSaveCountRef.current[slideId] || 0) === 0) {
        setSlideAutoSaveStatus(slideId, 'saved');
      }
      return;
    }

    if (options?.keepalive) {
      if (unverifiedKeepaliveSlidesRef.current[slideId]?.text === serialized) {
        delete pendingKeepalivePayloadRef.current[slideId];
        return;
      }
      const themeId =
        slide.theme_id || dataNow.currentTheme?.id || dataNow.session.current_theme_id;
      if (!themeId) return;
      const knownId = dataNow.myAnswers[slideId]?.id;
      savePlayerAnswerKeepalive(
        dataNow.session.id,
        dataNow.player.id,
        themeId,
        slideId,
        serialized,
        knownId
      );
      unverifiedKeepaliveSlidesRef.current[slideId] = { slide, text: serialized };
      lastLocalSaveTimestampRef.current[slideId] = Date.now();
      delete pendingKeepalivePayloadRef.current[slideId];
      setSlideAutoSaveStatus(slideId, 'saved');
      return;
    }

    await performSaveForSlide(slide, serialized, {
      showManualNotice: Boolean(options?.forceManual),
    });
  };

  // Takoj shrani vse neshranjene/čakajoče osnutke (npr. ob menjavi slajda, izteku časa, zaključku sklopa ali zaprtju)
  const flushAllDirtySlides = async (options?: { keepalive?: boolean }) => {
    const slideIds = new Set<string>([
      ...Object.keys(debounceTimersRef.current),
      ...Object.keys(dirtySlidesRef.current),
      ...Object.keys(unverifiedKeepaliveSlidesRef.current),
      ...(options?.keepalive ? Object.keys(pendingKeepalivePayloadRef.current) : []),
    ]);

    if (slideIds.size === 0) return;

    await Promise.all(
      Array.from(slideIds).map((sId) => flushSlideById(sId, { keepalive: options?.keepalive }))
    );
  };

  // Posodobitev vnosa in sprožitev samodejnega shranjevanja (800 ms debounce ali takojšnje za MC/datum)
  const handleDraftValueChange = (
    slide: Slide,
    draftKey: string,
    newValue: string,
    saveMode: 'debounce' | 'immediate'
  ) => {
    const nextDrafts = { ...draftsRef.current, [draftKey]: newValue };
    draftsRef.current = nextDrafts;
    setDrafts((prev) => ({ ...prev, [draftKey]: newValue }));

    const dataNow = gameDataRef.current;
    if (!dataNow || !dataNow.currentTheme) return;
    if (dataNow.session.status !== 'active_theme') return;
    if (
      timeLeftRef.current !== null &&
      timeLeftRef.current <= 0 &&
      slide.id === dataNow.session.current_slide_id
    ) {
      return;
    }

    delete unverifiedKeepaliveSlidesRef.current[slide.id];

    const serialized = computeSerializedSlideAnswer(slide, nextDrafts, dataNow.myAnswers);
    const prevConfirmed =
      lastConfirmedTextRef.current[slide.id] ?? dataNow.myAnswers[slide.id]?.answer_text ?? '';

    if (!serialized && !prevConfirmed) {
      if (debounceTimersRef.current[slide.id]) {
        clearTimeout(debounceTimersRef.current[slide.id]);
        delete debounceTimersRef.current[slide.id];
      }
      delete dirtySlidesRef.current[slide.id];
      if ((inFlightSaveCountRef.current[slide.id] || 0) === 0) {
        setSlideAutoSaveStatus(slide.id, 'idle');
      }
      return;
    }

    dirtySlidesRef.current[slide.id] = slide;

    if (saveMode === 'immediate') {
      if (debounceTimersRef.current[slide.id]) {
        clearTimeout(debounceTimersRef.current[slide.id]);
        delete debounceTimersRef.current[slide.id];
      }
      void flushSlideById(slide.id);
      return;
    }

    setSlideAutoSaveStatus(slide.id, 'pending');
    if (debounceTimersRef.current[slide.id]) {
      clearTimeout(debounceTimersRef.current[slide.id]);
    }
    debounceTimersRef.current[slide.id] = setTimeout(() => {
      delete debounceTimersRef.current[slide.id];
      void flushSlideById(slide.id);
    }, 800);
  };

  // 1. Reconnect mehanizem ob zagonu: preveri localStorage
  useEffect(() => {
    const attemptReconnect = async () => {
      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as StoredPlayerSession;
          const urlRoomCode = initialRoomCode?.trim() || '';
          const isDifferentRoomInUrl =
            urlRoomCode.length > 0 && parsed.roomCode && parsed.roomCode !== urlRoomCode;

          if (!isDifferentRoomInUrl && parsed.sessionId && parsed.playerId && parsed.reconnectToken) {
            const reconnected = await reconnectPlayer(
              parsed.sessionId,
              parsed.playerId,
              parsed.reconnectToken
            );
            if (reconnected) {
              setActiveSessionId(parsed.sessionId);
              setActivePlayerId(parsed.playerId);
              const fullData = await fetchPlayerGameData(parsed.sessionId, parsed.playerId);
              gameDataRef.current = fullData;
              setGameData(fullData);
              seedDraftsFromSavedAnswers(fullData.myAnswers);
              lastSeenSlideIdRef.current = fullData.session.current_slide_id;
              lastSeenThemeIdRef.current = fullData.session.current_theme_id;
              prevStatusRef.current = fullData.session.status;
              selectedSlideIdRef.current = fullData.session.current_slide_id;
              setSelectedSlideId(fullData.session.current_slide_id);
              setLoadingGame(false);
              return;
            }
          }
        }
      } catch {
        // ignore parse error
      }
      setLoadingGame(false);
    };

    attemptReconnect();
  }, [initialRoomCode]);

  const [refreshing, setRefreshing] = useState(false);

  // 2. Osveževanje podatkov o igralcu (brez prepisovanja aktivnega tipkanja!)
  const refreshPlayerData = async () => {
    if (!activeSessionId || !activePlayerId) return;
    const fetchStartedAt = Date.now();
    try {
      const full = await fetchPlayerGameData(activeSessionId, activePlayerId);

      // Preden preklopimo na nov slajd ali zaključimo sklop, takoj shranimo morebitne čakajoče osnutke!
      const newHostSlideId = full.session.current_slide_id;
      const newHostThemeId = full.session.current_theme_id;
      const hostSlideOrThemeChanged =
        Boolean(newHostSlideId) &&
        (newHostSlideId !== lastSeenSlideIdRef.current ||
          newHostThemeId !== lastSeenThemeIdRef.current);
      const leavingActiveTheme =
        prevStatusRef.current === 'active_theme' && full.session.status !== 'active_theme';

      if (hostSlideOrThemeChanged || leavingActiveTheme) {
        void flushAllDirtySlides();
      }

      setGameData((prev) => {
        const mergedMyAnswers: Record<string, Answer> = { ...full.myAnswers };
        if (prev) {
          for (const [sId, prevAns] of Object.entries(prev.myAnswers)) {
            const isSavingNow = (inFlightSaveCountRef.current[sId] || 0) > 0;
            const savedLocallyRecently =
              (lastLocalSaveTimestampRef.current[sId] || 0) >= fetchStartedAt - 150;
            if (isSavingNow || savedLocallyRecently || dirtySlidesRef.current[sId]) {
              mergedMyAnswers[sId] = prevAns;
            }
          }
        }
        const nextFull: PlayerFullData = {
          ...full,
          myAnswers: mergedMyAnswers,
        };
        gameDataRef.current = nextFull;
        return nextFull;
      });

      // Napolni osnutke SAMO za slajde, kjer je drafts[slideId] === undefined
      seedDraftsFromSavedAnswers(full.myAnswers);

      // Preveri morebitne keepalive zahteve ob preklopu/zaklepu zaslona: če niso v bazi, jih takoj ponovi
      for (const [sId, pending] of Object.entries(unverifiedKeepaliveSlidesRef.current)) {
        const dbVal = (full.myAnswers[sId]?.answer_text ?? '').trim();
        if (dbVal === pending.text) {
          delete unverifiedKeepaliveSlidesRef.current[sId];
          lastConfirmedTextRef.current[sId] = dbVal;
        } else if ((inFlightSaveCountRef.current[sId] || 0) === 0) {
          delete unverifiedKeepaliveSlidesRef.current[sId];
          dirtySlidesRef.current[sId] = pending.slide;
          void flushSlideById(sId);
        }
      }

      // Samodejno preklopi na nov slajd SAMO takrat, ko se current_slide_id (ali current_theme_id)
      // v game_sessions dejansko spremeni na nov ID!
      if (hostSlideOrThemeChanged && newHostSlideId) {
        lastSeenSlideIdRef.current = newHostSlideId;
        lastSeenThemeIdRef.current = newHostThemeId;
        selectedSlideIdRef.current = newHostSlideId;
        setSelectedSlideId(newHostSlideId);
      }

      // Konfeti ob prehodu v leaderboard ali finished
      if (
        (full.session.status === 'leaderboard' || full.session.status === 'finished') &&
        prevStatusRef.current !== full.session.status
      ) {
        confetti({
          particleCount: full.session.status === 'finished' ? 100 : 70,
          spread: 80,
          origin: { y: 0.6 },
        });
      }
      prevStatusRef.current = full.session.status;
    } catch {
      // ignore refresh error
    }
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshPlayerData();
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  // 3. Realtime naročnina na Supabase & Demo BroadcastChannel s stabilnim fallbackom
  useEffect(() => {
    if (!activeSessionId || !activePlayerId) return;

    const supabase = getSupabaseClient();
    let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;

    if (supabase) {
      channel = supabase
        .channel(`player-${activeSessionId}-${activePlayerId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'game_sessions', filter: `id=eq.${activeSessionId}` },
          (payload) => {
            if (payload.new && typeof payload.new === 'object') {
              const updatedSession = payload.new as Partial<PlayerFullData['session']>;
              const hostSlideOrThemeChanged = Boolean(
                updatedSession.current_slide_id &&
                  (updatedSession.current_slide_id !== lastSeenSlideIdRef.current ||
                    updatedSession.current_theme_id !== lastSeenThemeIdRef.current)
              );
              const leavingActiveTheme =
                prevStatusRef.current === 'active_theme' &&
                updatedSession.status !== undefined &&
                updatedSession.status !== 'active_theme';

              // Takojšnje shranjevanje neshranjenih osnutkov pred zaklepanjem ali menjavo slajda!
              if (hostSlideOrThemeChanged || leavingActiveTheme) {
                void flushAllDirtySlides();
              }

              setGameData((prev) => {
                if (!prev) return prev;
                const next = {
                  ...prev,
                  session: { ...prev.session, ...updatedSession },
                };
                gameDataRef.current = next;
                return next;
              });

              if (hostSlideOrThemeChanged && updatedSession.current_slide_id) {
                lastSeenSlideIdRef.current = updatedSession.current_slide_id;
                if (updatedSession.current_theme_id !== undefined) {
                  lastSeenThemeIdRef.current = updatedSession.current_theme_id;
                }
                selectedSlideIdRef.current = updatedSession.current_slide_id;
                setSelectedSlideId(updatedSession.current_slide_id);
              }
            }
            refreshPlayerData();
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'players', filter: `id=eq.${activePlayerId}` },
          () => refreshPlayerData()
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'player_jokers', filter: `session_id=eq.${activeSessionId}` },
          () => refreshPlayerData()
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'answers', filter: `session_id=eq.${activeSessionId}` },
          () => refreshPlayerData()
        )
        .subscribe();
    }

    const unsubDemo = subscribeToDemoUpdates((event) => {
      if (!event.sessionId || event.sessionId === activeSessionId) {
        refreshPlayerData();
      }
    });

    const localHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.sessionId || detail.sessionId === activeSessionId) {
        refreshPlayerData();
      }
    };
    window.addEventListener('trivia_demo_local_update', localHandler);

    // Ob zapiranju ali zaklepanju zaslona takoj pošlji čakajoče osnutke; ob vrnitvi pa osveži
    const handleVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') {
        void flushAllDirtySlides({ keepalive: true });
      } else if (document.visibilityState === 'visible') {
        void refreshPlayerData();
      }
    };
    const handleFocus = () => {
      void refreshPlayerData();
    };
    const handleOnline = () => {
      const failedSlideIds = Object.keys(dirtySlidesRef.current).filter(
        (sId) => !debounceTimersRef.current[sId] && (inFlightSaveCountRef.current[sId] || 0) === 0
      );
      if (failedSlideIds.length > 0) {
        void Promise.all(failedSlideIds.map((sId) => flushSlideById(sId)));
      }
      void refreshPlayerData();
    };
    const handlePageUnload = () => {
      void flushAllDirtySlides({ keepalive: true });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);
    window.addEventListener('pagehide', handlePageUnload);
    window.addEventListener('beforeunload', handlePageUnload);

    // Periodični varnostni heartbeat (vsakih 2.5 sekund) proti zamrznitvi
    const fallbackPoll = setInterval(() => {
      refreshPlayerData();
    }, 2500);

    return () => {
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
      unsubDemo();
      window.removeEventListener('trivia_demo_local_update', localHandler);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('pagehide', handlePageUnload);
      window.removeEventListener('beforeunload', handlePageUnload);
      clearInterval(fallbackPoll);
      Object.values(debounceTimersRef.current).forEach((t) => clearTimeout(t));
      debounceTimersRef.current = {};
    };
  }, [activeSessionId, activePlayerId]);

  // 4. Odštevalnik časa (Timer loop) - vedno računa iz timer_started_at in timer_duration
  useEffect(() => {
    const session = gameData?.session;
    if (!session || !session.timer_started_at || !session.timer_duration || session.timer_duration <= 0) {
      timeLeftRef.current = null;
      prevTimerExpiredSlideIdRef.current = null;
      setTimeLeft(null);
      return;
    }

    const startTime = new Date(session.timer_started_at).getTime();
    const durationMs = session.timer_duration * 1000;
    const endTime = startTime + durationMs;

    const tick = () => {
      const remainingMs = endTime - Date.now();
      if (remainingMs <= 0) {
        timeLeftRef.current = 0;
        // Preden se polje zaklene zaradi izteka časa, takoj shrani zadnji vnos v bazo!
        if (prevTimerExpiredSlideIdRef.current !== session.current_slide_id) {
          prevTimerExpiredSlideIdRef.current = session.current_slide_id;
          void flushAllDirtySlides();
        }
        setTimeLeft(0);
        return false;
      } else {
        const secs = Math.ceil(remainingMs / 1000);
        timeLeftRef.current = secs;
        prevTimerExpiredSlideIdRef.current = null;
        setTimeLeft(secs);
        return true;
      }
    };

    const keepRunning = tick();
    if (!keepRunning) return;

    const interval = setInterval(() => {
      const stillRunning = tick();
      if (!stillRunning) {
        clearInterval(interval);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [gameData?.session?.timer_started_at, gameData?.session?.timer_duration, gameData?.session?.current_slide_id]);

  // Slajdi trenutne tematike
  const currentThemeSlides: Slide[] = useMemo(() => {
    if (!gameData?.currentTheme?.id || !gameData?.slidesByTheme) return [];
    return gameData.slidesByTheme[gameData.currentTheme.id] || [];
  }, [gameData?.currentTheme?.id, gameData?.slidesByTheme]);

  // Najvišji doseženi indeks v temi, ki ga je gostitelj že odprl
  const maxAllowedIndex = useMemo(() => {
    if (!gameData?.session) return 0;
    return Math.min(
      currentThemeSlides.length - 1,
      Math.max(0, gameData.session.max_slide_index_reached)
    );
  }, [gameData?.session?.max_slide_index_reached, currentThemeSlides.length]);

  // Trenutno izbrani slajd tekmovalca (lahko se poljubno vrača na slajde <= maxAllowedIndex)
  const currentViewingSlide = useMemo(() => {
    if (!selectedSlideId) {
      return currentThemeSlides[0] || null;
    }
    return (
      currentThemeSlides.find((s: Slide) => s.id === selectedSlideId) ||
      currentThemeSlides[0] ||
      null
    );
  }, [selectedSlideId, currentThemeSlides]);

  const viewingSlideIndex = useMemo(() => {
    if (!currentViewingSlide) return 0;
    return currentThemeSlides.findIndex((s: Slide) => s.id === currentViewingSlide.id);
  }, [currentViewingSlide, currentThemeSlides]);

  // Ali ima igralec v tej temi že aktiviranega Jokerja?
  const hasJokerInCurrentTheme = useMemo(() => {
    if (!gameData?.currentTheme?.id || !gameData?.playerJokers) return false;
    return gameData.playerJokers.some((pj: PlayerJoker) => pj.theme_id === gameData.currentTheme?.id);
  }, [gameData?.currentTheme?.id, gameData?.playerJokers]);

  // Ali je časovnik potekel za trenutni slajd gostitelja?
  const isTimerExpiredOnCurrentHostSlide = useMemo(() => {
    if (timeLeft !== null && timeLeft <= 0) {
      return currentViewingSlide?.id === gameData?.session?.current_slide_id;
    }
    return false;
  }, [timeLeft, currentViewingSlide?.id, gameData?.session?.current_slide_id]);

  // ---------------------------------------------------------------------------
  // AKCIJE TEKMOVALCA
  // ---------------------------------------------------------------------------

  // Vstop v igro (Prijava)
  const handleJoinGame = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);

    const code = roomCodeInput.trim();
    const cleanNick = nicknameInput.trim();

    if (!code || code.length < 4) {
      setJoinError('Prosimo, vnesite veljavno 4-mestno kodo sobe.');
      return;
    }

    if (!cleanNick) {
      setJoinError('Prosimo, vnesite svoje ime ali vzdevek ekipe.');
      return;
    }

    setJoining(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setJoinError(
          'Supabase baza ni povezana na tej napravi! Skenirajte QR kodo z glavnega zaslona, ki samodejno prenese povezavo.'
        );
        return;
      }

      // Poišči najnovejšo sejo v Supabase po 4-mestni kodi
      const session = await findSessionByRoomCode(code);
      if (!session) {
        setJoinError(
          `Soba s kodo "${code}" ni bila najdena v Supabase tabeli game_sessions. Preverite kodo na glavnem zaslonu.`
        );
        return;
      }

      if (session.status === 'finished') {
        setJoinError('Ta kviz je že zaključen.');
        return;
      }

      // Če ima naprava v localStorage že shranjen veljaven reconnect_token za to sejo,
      // obnovi obstoječega igralca, da nikoli ne ustvari podvojenega zapisa v tabeli players.
      let player = null;
      try {
        const existingRaw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (existingRaw) {
          const parsed = JSON.parse(existingRaw) as StoredPlayerSession;
          if (parsed.sessionId === session.id && parsed.playerId && parsed.reconnectToken) {
            player = await reconnectPlayer(session.id, parsed.playerId, parsed.reconnectToken);
          }
        }
      } catch {
        // ignore parse error
      }

      if (!player) {
        player = await joinSessionAsPlayer(session.id, cleanNick);
      }

      // Shrani v localStorage za odpornost na prekinitev / reload
      const stored: StoredPlayerSession = {
        sessionId: session.id,
        playerId: player.id,
        reconnectToken: player.reconnect_token,
        roomCode: session.room_code,
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));

      setActiveSessionId(session.id);
      setActivePlayerId(player.id);

      const fullData = await fetchPlayerGameData(session.id, player.id);
      gameDataRef.current = fullData;
      setGameData(fullData);
      seedDraftsFromSavedAnswers(fullData.myAnswers);
      lastSeenSlideIdRef.current = fullData.session.current_slide_id;
      lastSeenThemeIdRef.current = fullData.session.current_theme_id;
      prevStatusRef.current = fullData.session.status;
      selectedSlideIdRef.current = fullData.session.current_slide_id;
      setSelectedSlideId(fullData.session.current_slide_id);
    } catch (err: unknown) {
      setJoinError(err instanceof Error ? err.message : 'Napaka pri vstopu v igro.');
    } finally {
      setJoining(false);
    }
  };

  // Zapusti igro / Počisti shranjeno sejo
  const handleLeaveGame = () => {
    const ok = window.confirm('Ali res želite zapustiti igro in se odjaviti?');
    if (!ok) return;

    Object.values(debounceTimersRef.current).forEach((t) => clearTimeout(t));
    debounceTimersRef.current = {};
    dirtySlidesRef.current = {};
    pendingKeepalivePayloadRef.current = {};
    unverifiedKeepaliveSlidesRef.current = {};
    lastConfirmedTextRef.current = {};
    inFlightSaveCountRef.current = {};
    draftsRef.current = {};

    localStorage.removeItem(LOCAL_STORAGE_KEY);
    setActiveSessionId(null);
    setActivePlayerId(null);
    gameDataRef.current = null;
    setGameData(null);
    setDrafts({});
    setAutoSaveStatusBySlide({});
    lastSeenSlideIdRef.current = null;
    lastSeenThemeIdRef.current = null;
    selectedSlideIdRef.current = null;
    setRoomCodeInput('');
    setNicknameInput('');
    if (onExit) onExit();
  };

  // Ročni preklop na izbrani pretekli slajd (s takojšnjim shranjevanjem prejšnjega osnutka)
  const handleSelectSlide = (targetSlideId: string) => {
    if (currentViewingSlide && currentViewingSlide.id !== targetSlideId) {
      void flushSlideById(currentViewingSlide.id);
    }
    selectedSlideIdRef.current = targetSlideId;
    setSelectedSlideId(targetSlideId);
  };

  // Aktivacija Jokerja (samo v 'theme_intro')
  const handleActivateJoker = async () => {
    if (!gameData || !gameData.currentTheme || activatingJoker) return;
    if (gameData.player.jokers_remaining <= 0 || hasJokerInCurrentTheme) return;

    setActivatingJoker(true);
    try {
      const res = await playerActivateJoker(
        gameData.session.id,
        gameData.player.id,
        gameData.currentTheme.id
      );
      if (res.success) {
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.7 },
          colors: ['#f59e0b', '#fbbf24', '#10b981'],
        });
      }
      await refreshPlayerData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Napaka pri vklopu Jokerja.');
    } finally {
      setActivatingJoker(false);
    }
  };

  // Ročna potrditev odgovora (takoj shrani brez čakanja na debounce)
  const handleManualSaveSlide = async (explicitSlide?: Slide) => {
    const targetSlide = explicitSlide || currentViewingSlide;
    if (!gameData || !gameData.currentTheme || !targetSlide) return;
    if (gameData.session.status !== 'active_theme' || isTimerExpiredOnCurrentHostSlide) return;

    dirtySlidesRef.current[targetSlide.id] = targetSlide;
    await flushSlideById(targetSlide.id, { forceManual: true });
  };

  // Značka s statusom samodejnega shranjevanja poleg gumba Shrani odgovor
  const renderAutoSaveBadge = (slide: Slide, extraCompact: boolean = false) => {
    const status = autoSaveStatusBySlide[slide.id] || 'idle';
    const savedAns = gameData?.myAnswers[slide.id]?.answer_text;
    const hasSavedInDb = isMultiPartSlide(slide)
      ? hasAnyMultiPartValue(savedAns)
      : Boolean(savedAns);

    if (status === 'saving' || status === 'pending') {
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 font-semibold shrink-0 ${
            extraCompact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-2 text-xs'
          }`}
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
          <span>💾 Shranjujem...</span>
        </span>
      );
    }

    if (status === 'error') {
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 font-semibold shrink-0 ${
            extraCompact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-2 text-xs'
          }`}
        >
          <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          <span>Napaka shranjevanja</span>
        </span>
      );
    }

    if (status === 'saved' || hasSavedInDb) {
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-semibold shrink-0 ${
            extraCompact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-2 text-xs'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>✅ Samodejno shranjeno</span>
        </span>
      );
    }

    return null;
  };

  // ===========================================================================
  // 1. ZASLON ZA VSTOP V IGRO (Če igralec še ni v igri)
  // ===========================================================================
  if (loadingGame) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3 px-4">
        <Loader2 className="w-9 h-9 animate-spin text-emerald-400" />
        <p className="text-sm font-semibold">Preverjanje povezave s kvizom...</p>
      </div>
    );
  }

  if (!activeSessionId || !gameData) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden select-none">
        {/* Ambientni neon sij */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden z-0">
          <div className="absolute -top-32 -left-32 w-80 h-80 bg-indigo-600/15 rounded-full blur-3xl" />
          <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-emerald-500/15 rounded-full blur-3xl" />
        </div>

        <div className="w-full max-w-sm relative z-10 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-600 to-emerald-500 p-[1px] mx-auto shadow-xl shadow-indigo-500/20">
              <div className="w-full h-full bg-slate-950 rounded-[15px] flex items-center justify-center">
                <Radio className="w-7 h-7 text-emerald-400 animate-pulse" />
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black font-display tracking-tight text-slate-100">
              QuizPulse <span className="text-emerald-400">Live</span>
            </h1>
            <p className="text-xs text-slate-400">
              Vnesite kodo sobe z glavnega zaslona in ime svoje ekipe za vstop v kviz.
            </p>
          </div>

          <div className="bg-slate-900/85 backdrop-blur-2xl border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
            {joinError && (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2 leading-relaxed">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{joinError}</span>
              </div>
            )}

            <form onSubmit={handleJoinGame} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  4-Mestna koda sobe
                </label>
                <input
                  id="player-room-code-input"
                  type="text"
                  maxLength={4}
                  required
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                  placeholder="npr. 7419"
                  className="w-full px-4 py-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-emerald-400 font-mono-code font-black text-2xl text-center tracking-widest focus:outline-none focus:border-emerald-500 uppercase placeholder-slate-700"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Ime ekipe / tvoj vzdevek
                </label>
                <input
                  id="player-nickname-input"
                  type="text"
                  required
                  maxLength={25}
                  value={nicknameInput}
                  onChange={(e) => setNicknameInput(e.target.value)}
                  placeholder="npr. Hitri &amp; Drzni"
                  className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-800 text-slate-100 font-bold text-sm focus:outline-none focus:border-indigo-500 placeholder-slate-600"
                />
              </div>

              <button
                id="player-join-btn"
                type="submit"
                disabled={joining}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-base shadow-xl shadow-emerald-500/25 transition-all active:scale-[0.99] cursor-pointer disabled:opacity-50"
              >
                {joining ? 'Povezovanje...' : 'Pridruži se kvizu'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // 2. GLAVNI ZASLON IGRALCA V IGRI (glede na session.status)
  // ===========================================================================
  const { session, quiz, player, currentTheme, leaderboard } = gameData;
  const myCurrentAnswer = currentViewingSlide ? gameData.myAnswers[currentViewingSlide.id] : undefined;
  const activeSlideId = currentViewingSlide?.id || '';
  const currentDraft =
    drafts[activeSlideId] !== undefined
      ? drafts[activeSlideId]
      : myCurrentAnswer?.answer_text ?? '';

  // Igralčeva uvrstitev na lestvici
  const myLeaderboardRank =
    leaderboard.find((l: { id: string; rank: number }) => l.id === player.id)?.rank || 1;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col max-w-md mx-auto border-x border-slate-900/90 shadow-2xl relative">
      {/* GLAVA TEKMOVALCA (Zgornji bar s statusom, vzdevkom in Jokerji) */}
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-xl border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-500 p-[1px] shrink-0">
            <div className="w-full h-full bg-slate-950 rounded-[11px] flex items-center justify-center font-bold text-xs text-emerald-400">
              {player.nickname.slice(0, 2).toUpperCase()}
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm text-slate-100 truncate">
                {player.nickname}
              </span>
              {hasJokerInCurrentTheme && (
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                  🃏 2x
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 truncate">
              {quiz.title} • {session.room_code}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Števec preostalih Jokerjev */}
          <div
            className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold border ${
              player.jokers_remaining > 0
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-slate-800/80 border-slate-700 text-slate-500'
            }`}
            title="Preostali Jokerji na voljo"
          >
            <span>🃏</span>
            <span>{player.jokers_remaining}</span>
          </div>

          <button
            onClick={handleManualRefresh}
            className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
            title="Ročno osveži stanje"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          <button
            onClick={handleLeaveGame}
            className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
            title="Zapusti igro"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* VSEBINA ZASLONA ZA TEKMOVALCA */}
      <main className="flex-1 p-4 space-y-4 overflow-y-auto pb-8">
        {/* ===================================================================
            A. STANJE: LOBBY (Čakalnica na začetek kviza)
            =================================================================== */}
        {session.status === 'lobby' && (
          <div className="space-y-5 pt-4 text-center animate-fadeIn">
            <div className="w-16 h-16 rounded-3xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto shadow-xl">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <div className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                Povezan v igro
              </span>
              <h2 className="text-2xl font-black text-slate-100">
                Uspešno si v igri, {player.nickname}!
              </h2>
              <p className="text-sm text-slate-400 max-w-xs mx-auto">
                Počakaj, da gostitelj začne 1. tematiko na glavnem zaslonu...
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2 text-left">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Tvoji Jokerji na voljo:</span>
                <span className="font-bold text-amber-300 flex items-center gap-1">
                  <span>🃏</span>
                  <span>{player.jokers_remaining} Joker</span>
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed pt-1 border-t border-slate-800/80">
                Pred začetkom vsakega sklopa boš lahko aktiviral Jokerja za dvojne točke (2x).
              </p>
            </div>
          </div>
        )}

        {/* ===================================================================
            B. STANJE: THEME_INTRO (Aktivacija Jokerja pred vprašanji)
            =================================================================== */}
        {session.status === 'theme_intro' && currentTheme && (
          <div className="space-y-5 pt-2 animate-fadeIn">
            <div className="bg-slate-900/80 backdrop-blur-xl border border-amber-500/40 rounded-3xl p-5 text-center space-y-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-xs font-bold">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Uvod v nov sklop</span>
              </span>
              <h2 className="text-2xl font-black text-slate-100">
                {currentTheme.title}
              </h2>
              <p className="text-xs text-slate-400">
                Spremljaj uvodni slajd na glavnem zaslonu.
              </p>
            </div>

            {/* KARTICA JOKERJA */}
            <div className="bg-gradient-to-b from-amber-500/15 via-slate-900/90 to-slate-950 border-2 border-amber-500/50 rounded-3xl p-6 text-center space-y-4 shadow-xl shadow-amber-950/40">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 text-3xl mx-auto shadow-lg">
                🃏
              </div>

              <div className="space-y-1">
                <h3 className="text-lg font-black text-amber-300">
                  {hasJokerInCurrentTheme
                    ? 'Joker aktiviran za to temo! 🔥'
                    : 'Aktiviraj Jokerja za dvojne točke (2x)'}
                </h3>
                <p className="text-xs text-slate-300">
                  {hasJokerInCurrentTheme
                    ? 'Za vsa pravilna vprašanja v tej temi prejmeš dvojne točke!'
                    : `Imaš še ${player.jokers_remaining} ${
                        player.jokers_remaining === 1 ? 'Joker' : 'Jokerja'
                      }. Ga želiš izkoristiti tukaj?`}
                </p>
              </div>

              {!hasJokerInCurrentTheme ? (
                player.jokers_remaining > 0 ? (
                  <button
                    id="player-activate-joker-btn"
                    disabled={activatingJoker}
                    onClick={handleActivateJoker}
                    className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 hover:from-amber-400 hover:to-yellow-300 text-slate-950 font-black text-base shadow-xl shadow-amber-500/30 transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
                  >
                    {activatingJoker
                      ? 'Aktiviranje...'
                      : 'AKTIVIRAJ JOKERJA (2x TOČKE)'}
                  </button>
                ) : (
                  <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-500">
                    Vse svoje Jokerje si že porabil v prejšnjih temah.
                  </div>
                )
              ) : (
                <div className="p-3 rounded-2xl bg-amber-500/20 border border-amber-500/50 text-amber-200 text-xs font-bold flex items-center justify-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Dvojne točke za ta sklop so potrjene!</span>
                </div>
              )}

              <p className="text-[11px] text-slate-500 pt-1">
                Pozor: Ko gostitelj zažene prvo vprašanje, Jokerja za to temo ni več mogoče vklopiti.
              </p>
            </div>
          </div>
        )}

        {/* ===================================================================
            C. STANJE: ACTIVE_THEME (Reševanje vprašanj + prosto vračanje nazaj)
            =================================================================== */}
        {session.status === 'active_theme' && currentTheme && currentViewingSlide && (
          <div className="space-y-4 animate-fadeIn">
            {/* VRSTICA S ŠTEVILKAMI VPRAŠANJ (Prosto vračanje do max_slide_index_reached) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs px-1">
                <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                  Vprašanja v temi (klikni za skok nazaj):
                </span>
                <span className="font-mono-code font-bold text-indigo-400 text-[11px]">
                  Odprto do #{maxAllowedIndex + 1}
                </span>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1.5 pt-0.5 no-scrollbar">
                {currentThemeSlides.map((slide: Slide, idx: number) => {
                  const isLocked = idx > maxAllowedIndex;
                  const isCurrentViewing = currentViewingSlide.id === slide.id;
                  const isHostCurrent = session.current_slide_id === slide.id;
                  const savedAnsText = gameData.myAnswers[slide.id]?.answer_text;
                  const hasAnswered = isMultiPartSlide(slide)
                    ? hasAnyMultiPartValue(savedAnsText)
                    : Boolean(savedAnsText);

                  return (
                    <button
                      key={slide.id}
                      type="button"
                      disabled={isLocked}
                      onClick={() => handleSelectSlide(slide.id)}
                      className={`relative min-w-[44px] h-11 rounded-xl font-mono-code font-bold text-xs flex flex-col items-center justify-center transition-all cursor-pointer ${
                        isLocked
                          ? 'bg-slate-900/40 border border-slate-800 text-slate-600 cursor-not-allowed opacity-40'
                          : isCurrentViewing
                          ? 'bg-indigo-600 text-white border-2 border-indigo-400 shadow-lg shadow-indigo-600/30 scale-105'
                          : hasAnswered
                          ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                      title={
                        isLocked
                          ? 'Vprašanje še ni odprto s strani gostitelja'
                          : `Pojdi na vprašanje #${idx + 1}`
                      }
                    >
                      <span>{idx + 1}</span>
                      {hasAnswered && !isCurrentViewing && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      )}
                      {isHostCurrent && !isCurrentViewing && (
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping absolute -top-1 -right-1" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ČASOVNIK (Če teče za trenutni gostiteljev slajd) */}
            {session.timer_duration && session.timer_duration > 0 && timeLeft !== null && (
              <div className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-between shadow-md">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                  <Clock
                    className={`w-4 h-4 ${
                      timeLeft <= 5 ? 'text-rose-400 animate-bounce' : 'text-indigo-400'
                    }`}
                  />
                  <span>Čas za odgovor:</span>
                </div>
                <span
                  className={`font-mono-code font-black text-lg ${
                    timeLeft <= 5
                      ? 'text-rose-400 animate-pulse'
                      : timeLeft <= 10
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {timeLeft}s
                </span>
              </div>
            )}

            {/* VSEBINA VPRAŠANJA (samo če slajd NI info_only ali theme_intro) */}
            {currentViewingSlide.slide_type !== 'info_only' &&
              currentViewingSlide.slide_type !== 'theme_intro' && (
                <div className="bg-slate-900/85 backdrop-blur-xl border border-slate-800 rounded-3xl p-5 space-y-3 shadow-xl">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-xs font-bold font-mono-code">
                      Slajd {viewingSlideIndex + 1} od {currentThemeSlides.length}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-emerald-400">
                        {roundPoints(currentViewingSlide.points)}{' '}
                        {roundPoints(currentViewingSlide.points) === 1 ? 'točka' : 'točke'}
                        {hasJokerInCurrentTheme && ' (2x Joker!)'}
                      </span>
                      {currentViewingSlide.question_parts?.some((p) => p.is_bonus) && (
                        <span className="px-2 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-[10px] font-bold text-amber-300">
                          ⭐ +Bonus
                        </span>
                      )}
                    </div>
                  </div>

                  {currentViewingSlide.question_text ? (
                    <p className="text-base font-bold text-slate-100 leading-snug">
                      {currentViewingSlide.question_text}
                    </p>
                  ) : (
                    <p className="text-xs italic text-slate-400">
                      Vprašanje je prikazano na glavnem zaslonu / sliki slajda.
                    </p>
                  )}
                </div>
              )}

            {/* VNOS ODGOVORA GLEDE NA TIP SLAJDA (ali večdelno / bonus vprašanje) */}
            {isTimerExpiredOnCurrentHostSlide ? (
              <div className="p-5 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-center space-y-2">
                <Lock className="w-6 h-6 text-rose-400 mx-auto" />
                <p className="text-sm font-bold text-rose-200">Čas za odgovor je potekel!</p>
                <p className="text-xs text-slate-400">
                  Oddani odgovor je zaklenjen.
                </p>
                <div className="flex justify-center pt-1">
                  {renderAutoSaveBadge(currentViewingSlide, true)}
                </div>
              </div>
            ) : currentViewingSlide.slide_type === 'info_only' ||
              currentViewingSlide.slide_type === 'theme_intro' ? (
              <div className="p-6 rounded-3xl bg-slate-900/85 border border-sky-500/30 text-center space-y-2.5 shadow-xl">
                <div className="w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 mx-auto">
                  <Info className="w-6 h-6" />
                </div>
                <p className="text-base font-black text-slate-100">
                  Spremljaj glavni zaslon
                </p>
                {currentViewingSlide.question_text && (
                  <p className="text-xs font-semibold text-indigo-300">
                    {currentViewingSlide.question_text}
                  </p>
                )}
                <p className="text-xs text-slate-400">
                  Na tem slajdu ni vnosa odgovora. Počakaj, da gostitelj nadaljuje na naslednji slajd.
                </p>
              </div>
            ) : isMultiPartSlide(currentViewingSlide) && currentViewingSlide.question_parts ? (
              /* VEČDELNO VPRAŠANJE IN/ALI ⭐ BONUS VPRAŠANJE (question_parts) */
              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-fuchsia-300">
                    <Layers className="w-3.5 h-3.5 text-fuchsia-400" />
                    <span>
                      {currentViewingSlide.question_parts.some((p) => p.is_bonus)
                        ? 'Vprašanje + ⭐ Bonus vprašanje'
                        : `Večdelno vprašanje (${currentViewingSlide.question_parts.length} deli)`}
                    </span>
                  </span>
                </div>

                {(() => {
                  const savedValues = parseMultiPartAnswer(myCurrentAnswer?.answer_text).values;
                  const getPartDraft = (partId: string) => {
                    const key = `${currentViewingSlide.id}:${partId}`;
                    return drafts[key] !== undefined ? drafts[key] : savedValues[partId] ?? '';
                  };

                  const buildFullMultiPartJson = () => {
                    const map: Record<string, string> = {};
                    for (const p of currentViewingSlide.question_parts || []) {
                      map[p.id] = getPartDraft(p.id).trim();
                    }
                    return serializeMultiPartAnswer(map);
                  };

                  const canManualSaveMultiPart =
                    hasAnyMultiPartValue(buildFullMultiPartJson()) ||
                    hasAnyMultiPartValue(myCurrentAnswer?.answer_text);

                  return (
                    <>
                      {currentViewingSlide.question_parts.map((part, pIdx) => {
                        const partDraft = getPartDraft(part.id);
                        const partInputKey = `${currentViewingSlide.id}:${part.id}`;
                        const partOpts = part.options || ['', '', '', ''];
                        const isBonusPart = Boolean(part.is_bonus);

                        return (
                          <div
                            key={partInputKey}
                            className={`rounded-3xl p-4 space-y-3 shadow-md transition-all ${
                              isBonusPart
                                ? 'bg-gradient-to-b from-amber-500/20 via-slate-900/95 to-slate-950 border-2 border-amber-400/60 shadow-amber-950/40'
                                : 'bg-slate-900/85 border border-slate-800'
                            }`}
                          >
                            {isBonusPart && (
                              <div className="flex items-center justify-between gap-2 pb-1 border-b border-amber-500/30">
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black uppercase tracking-wider">
                                  ⭐ BONUS VPRAŠANJE
                                </span>
                                <span className="text-[10px] font-semibold text-amber-200/90">
                                  Ne podvoji se z Jokerjem
                                </span>
                              </div>
                            )}

                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`text-xs font-bold ${
                                  isBonusPart ? 'text-amber-200 text-sm' : 'text-fuchsia-300'
                                }`}
                              >
                                {part.label ||
                                  (isBonusPart ? 'Bonus vprašanje' : `Del ${pIdx + 1}`)}
                              </span>
                              <span
                                className={`text-[11px] font-mono-code font-bold shrink-0 ${
                                  isBonusPart ? 'text-amber-300' : 'text-emerald-400'
                                }`}
                              >
                                {isBonusPart
                                  ? `+${roundPoints(part.points)} ⭐`
                                  : `${roundPoints(part.points)} t`}
                              </span>
                            </div>

                            {part.type === 'multiple_choice' ? (
                              <div className="grid grid-cols-2 gap-2.5">
                                {(
                                  [
                                    { key: 'A', idx: 0, bg: 'bg-rose-500', hover: 'hover:bg-rose-400', border: 'border-rose-400' },
                                    { key: 'B', idx: 1, bg: 'bg-indigo-600', hover: 'hover:bg-indigo-500', border: 'border-indigo-400' },
                                    { key: 'C', idx: 2, bg: 'bg-amber-500', hover: 'hover:bg-amber-400', border: 'border-amber-400' },
                                    { key: 'D', idx: 3, bg: 'bg-emerald-500', hover: 'hover:bg-emerald-400', border: 'border-emerald-400' },
                                  ] as const
                                ).map(({ key, idx, bg, hover, border }) => {
                                  const isSelected = partDraft.trim().toUpperCase() === key;
                                  const optText = partOpts[idx];
                                  return (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={() =>
                                        handleDraftValueChange(
                                          currentViewingSlide,
                                          partInputKey,
                                          key,
                                          'immediate'
                                        )
                                      }
                                      className={`min-h-[60px] p-3 rounded-2xl flex flex-col justify-between text-left transition-all active:scale-95 cursor-pointer border-2 ${
                                        isSelected
                                          ? `${bg} text-white ${border} shadow-lg`
                                          : `bg-slate-950/90 text-slate-200 border-slate-800 ${hover}`
                                      }`}
                                    >
                                      <div className="flex items-center justify-between w-full">
                                        <span className="font-mono-code font-black text-base">
                                          {key}
                                        </span>
                                        {isSelected && <Check className="w-4 h-4 text-white" />}
                                      </div>
                                      <span className="text-[11px] font-semibold truncate w-full mt-0.5">
                                        {optText || `Možnost ${key}`}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : part.type === 'closest_number' ? (
                              <input
                                key={partInputKey}
                                type="number"
                                step="any"
                                inputMode="decimal"
                                value={partDraft}
                                onChange={(e) =>
                                  handleDraftValueChange(
                                    currentViewingSlide,
                                    partInputKey,
                                    e.target.value,
                                    'debounce'
                                  )
                                }
                                placeholder="Vpiši številko..."
                                className="w-full px-3.5 py-3 rounded-2xl bg-slate-950 border border-slate-800 text-violet-300 font-mono-code font-bold text-lg text-center focus:outline-none focus:border-violet-500"
                              />
                            ) : part.type === 'closest_date' ? (
                              <div className="space-y-1.5">
                                <input
                                  key={partInputKey}
                                  type="date"
                                  value={partDraft}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    const isCompleteDate = /^\d{4}-\d{2}-\d{2}$/.test(val);
                                    handleDraftValueChange(
                                      currentViewingSlide,
                                      partInputKey,
                                      val,
                                      isCompleteDate ? 'immediate' : 'debounce'
                                    );
                                  }}
                                  className="w-full px-3.5 py-3 rounded-2xl bg-slate-950 border border-slate-800 text-cyan-300 font-mono-code font-bold text-base text-center focus:outline-none focus:border-cyan-500"
                                />
                                {partDraft && (
                                  <p className="text-xs font-bold text-cyan-300 text-center">
                                    📅 Izbrano: {formatSloveneDate(partDraft)}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <input
                                key={partInputKey}
                                type="text"
                                value={partDraft}
                                onChange={(e) =>
                                  handleDraftValueChange(
                                    currentViewingSlide,
                                    partInputKey,
                                    e.target.value,
                                    'debounce'
                                  )
                                }
                                placeholder={
                                  isBonusPart
                                    ? 'Vpiši odgovor na bonus vprašanje...'
                                    : 'Vpiši odgovor...'
                                }
                                className={`w-full px-3.5 py-3 rounded-2xl bg-slate-950 border text-slate-100 font-semibold text-sm focus:outline-none ${
                                  isBonusPart
                                    ? 'border-amber-500/40 focus:border-amber-400'
                                    : 'border-slate-800 focus:border-emerald-500'
                                }`}
                              />
                            )}
                          </div>
                        );
                      })}

                      <div className="flex flex-wrap items-center justify-between gap-2.5">
                        <button
                          type="button"
                          disabled={!canManualSaveMultiPart}
                          onClick={() => {
                            void handleManualSaveSlide(currentViewingSlide);
                          }}
                          className="flex-1 min-w-[175px] py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-sm shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          <Send className="w-4 h-4 shrink-0" />
                          <span>Shrani vse odgovore</span>
                        </button>
                        {renderAutoSaveBadge(currentViewingSlide)}
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : currentViewingSlide.slide_type === 'multiple_choice' ? (
              /* A / B / C / D Veliki barvni gumbi */
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Izberi odgovor (klik takoj shrani):
                  </span>
                  {renderAutoSaveBadge(currentViewingSlide, true)}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      { key: 'A', bg: 'bg-rose-500', hover: 'hover:bg-rose-400', border: 'border-rose-400' },
                      { key: 'B', bg: 'bg-indigo-600', hover: 'hover:bg-indigo-500', border: 'border-indigo-400' },
                      { key: 'C', bg: 'bg-amber-500', hover: 'hover:bg-amber-400', border: 'border-amber-400' },
                      { key: 'D', bg: 'bg-emerald-500', hover: 'hover:bg-emerald-400', border: 'border-emerald-400' },
                    ] as const
                  ).map(({ key, bg, hover, border }) => {
                    const isSelected = currentDraft.trim().toUpperCase() === key;
                    const optionText = currentViewingSlide.options[key];

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() =>
                          handleDraftValueChange(
                            currentViewingSlide,
                            currentViewingSlide.id,
                            key,
                            'immediate'
                          )
                        }
                        className={`min-h-[74px] p-3.5 rounded-2xl flex flex-col justify-between text-left transition-all active:scale-95 cursor-pointer border-2 ${
                          isSelected
                            ? `${bg} text-white ${border} shadow-lg ring-4 ring-white/20 scale-102`
                            : `bg-slate-900/90 text-slate-200 border-slate-800 ${hover}`
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="font-mono-code font-black text-lg">
                            {key}
                          </span>
                          {isSelected && <Check className="w-5 h-5 text-white" />}
                        </div>
                        <span className="text-xs font-semibold truncate w-full mt-1">
                          {optionText || `Možnost ${key}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : currentViewingSlide.slide_type === 'closest_number' ? (
              /* Ugani številko (closest_number) */
              <div className="bg-slate-900/85 border border-slate-800 rounded-3xl p-5 space-y-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Vpiši številko (najbližji dobi točke)
                  </label>
                  <input
                    key={currentViewingSlide.id}
                    id="player-number-answer-input"
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={currentDraft}
                    onChange={(e) =>
                      handleDraftValueChange(
                        currentViewingSlide,
                        currentViewingSlide.id,
                        e.target.value,
                        'debounce'
                      )
                    }
                    placeholder="npr. 1999"
                    className="w-full px-4 py-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-violet-400 font-mono-code font-bold text-xl text-center focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <button
                    type="button"
                    disabled={!currentDraft.trim() && !myCurrentAnswer?.answer_text}
                    onClick={() => {
                      void handleManualSaveSlide(currentViewingSlide);
                    }}
                    className="flex-1 min-w-[165px] py-3.5 px-4 rounded-2xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm shadow-lg shadow-violet-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-4 h-4 shrink-0" />
                    <span>Shrani številko</span>
                  </button>
                  {renderAutoSaveBadge(currentViewingSlide)}
                </div>
              </div>
            ) : currentViewingSlide.slide_type === 'closest_date' ? (
              /* Ugani datum (closest_date) */
              <div className="bg-slate-900/85 border border-slate-800 rounded-3xl p-5 space-y-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-cyan-400">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Izberi datum (najbližji datum zmaga!)</span>
                  </label>
                  <input
                    key={currentViewingSlide.id}
                    id="player-date-answer-input"
                    type="date"
                    value={currentDraft}
                    onChange={(e) => {
                      const val = e.target.value;
                      const isCompleteDate = /^\d{4}-\d{2}-\d{2}$/.test(val);
                      handleDraftValueChange(
                        currentViewingSlide,
                        currentViewingSlide.id,
                        val,
                        isCompleteDate ? 'immediate' : 'debounce'
                      );
                    }}
                    className="w-full px-4 py-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-cyan-300 font-mono-code font-bold text-lg text-center focus:outline-none focus:border-cyan-500"
                  />
                  {currentDraft && (
                    <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-center">
                      <span className="text-xs font-bold text-cyan-300">
                        Izbrano: {formatSloveneDate(currentDraft)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <button
                    type="button"
                    disabled={!currentDraft.trim() && !myCurrentAnswer?.answer_text}
                    onClick={() => {
                      void handleManualSaveSlide(currentViewingSlide);
                    }}
                    className="flex-1 min-w-[165px] py-3.5 px-4 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-4 h-4 shrink-0" />
                    <span>Shrani datum</span>
                  </button>
                  {renderAutoSaveBadge(currentViewingSlide)}
                </div>
              </div>
            ) : (
              /* Odprto besedilo (open_text) */
              <div className="bg-slate-900/85 border border-slate-800 rounded-3xl p-5 space-y-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Tvoj besedilni odgovor
                  </label>
                  <textarea
                    key={currentViewingSlide.id}
                    id="player-text-answer-input"
                    rows={2}
                    value={currentDraft}
                    onChange={(e) =>
                      handleDraftValueChange(
                        currentViewingSlide,
                        currentViewingSlide.id,
                        e.target.value,
                        'debounce'
                      )
                    }
                    placeholder="Vpiši svoj odgovor tukaj..."
                    className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-800 text-slate-100 font-semibold text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <button
                    type="button"
                    disabled={!currentDraft.trim() && !myCurrentAnswer?.answer_text}
                    onClick={() => {
                      void handleManualSaveSlide(currentViewingSlide);
                    }}
                    className="flex-1 min-w-[165px] py-3.5 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-4 h-4 shrink-0" />
                    <span>Shrani odgovor</span>
                  </button>
                  {renderAutoSaveBadge(currentViewingSlide)}
                </div>
              </div>
            )}

            {/* Obvestilo o shranjenem odgovoru */}
            {saveSuccessNotice && (
              <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center justify-center gap-2 animate-scaleIn">
                <CheckCircle2 className="w-4 h-4" />
                <span>Odgovor uspešno shranjen! Lahko ga kadarkoli popraviš.</span>
              </div>
            )}

            {/* Prikaz trenutno shranjenega odgovora */}
            {myCurrentAnswer?.answer_text && !saveSuccessNotice && (
              <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 text-xs space-y-1.5 text-slate-300">
                {isMultiPartSlide(currentViewingSlide) && currentViewingSlide.question_parts ? (
                  <>
                    <span className="text-[11px] font-semibold text-slate-400 block">
                      Tvoji shranjeni odgovori:
                    </span>
                    <div className="space-y-1">
                      {currentViewingSlide.question_parts.map((part, pIdx) => {
                        const savedMap = parseMultiPartAnswer(myCurrentAnswer.answer_text).values;
                        const val = savedMap[part.id] || '';
                        const formatted =
                          part.type === 'closest_date' && val
                            ? formatSloveneDate(val)
                            : val || '—';
                        return (
                          <div key={part.id} className="flex items-center justify-between gap-2">
                            <span
                              className={`truncate ${
                                part.is_bonus ? 'text-amber-300 font-semibold' : 'text-slate-400'
                              }`}
                            >
                              {part.is_bonus ? '⭐ ' : ''}
                              {part.label || (part.is_bonus ? 'Bonus vprašanje' : `Del ${pIdx + 1}`)}:
                            </span>
                            <span
                              className={`font-mono-code font-bold ${
                                part.is_bonus ? 'text-amber-300' : 'text-emerald-400'
                              }`}
                            >
                              {formatted}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between">
                    <span>Tvoj shranjen odgovor:</span>
                    <span className="font-mono-code font-bold text-emerald-400">
                      {currentViewingSlide.slide_type === 'closest_date'
                        ? formatSloveneDate(myCurrentAnswer.answer_text)
                        : myCurrentAnswer.answer_text}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===================================================================
            D. STANJE: GRADING_THEME (Ocenjevanje gostitelja)
            =================================================================== */}
        {session.status === 'grading_theme' && currentTheme && (
          <div className="space-y-4 animate-fadeIn">
            <div className="bg-slate-900/85 backdrop-blur-xl border border-violet-500/40 rounded-3xl p-6 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-400 mx-auto">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-black text-slate-100">
                  Tematika je zaključena!
                </h3>
                <p className="text-xs text-slate-400 max-w-xs mx-auto">
                  Gostitelj pregleduje odgovore. Kmalu sledi osvežena lestvica!
                </p>
              </div>
            </div>

            {/* Pregled oddanih odgovorov tekmovalca v tej temi */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-4 space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block px-1">
                Tvoji oddani odgovori v tem sklopu:
              </span>
              <div className="space-y-2">
                {currentThemeSlides
                  .filter(
                    (s: Slide) =>
                      isMultiPartSlide(s) ||
                      s.slide_type === 'multiple_choice' ||
                      s.slide_type === 'open_text' ||
                      s.slide_type === 'closest_number' ||
                      s.slide_type === 'closest_date'
                  )
                  .map((slide: Slide, idx: number) => {
                    const ans = gameData.myAnswers[slide.id];
                    const multiPart = isMultiPartSlide(slide) && slide.question_parts;
                    const parsedMulti = multiPart
                      ? parseMultiPartAnswer(ans?.answer_text).values
                      : null;
                    return (
                      <div
                        key={slide.id}
                        className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800/80 space-y-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-300 font-semibold truncate max-w-[200px]">
                            #{idx + 1}. {slide.question_text || `Vprašanje ${idx + 1}`}
                          </span>
                          {!multiPart && (
                            <span className="font-mono-code font-bold text-emerald-400">
                              {ans?.answer_text
                                ? slide.slide_type === 'closest_date'
                                  ? formatSloveneDate(ans.answer_text)
                                  : ans.answer_text
                                : '—'}
                            </span>
                          )}
                        </div>
                        {multiPart && slide.question_parts && (
                          <div className="pl-2 space-y-1 border-l-2 border-fuchsia-500/30">
                            {slide.question_parts.map((part, pIdx) => {
                              const rawVal = parsedMulti?.[part.id] || '';
                              const displayVal = rawVal
                                ? part.type === 'closest_date'
                                  ? formatSloveneDate(rawVal)
                                  : rawVal
                                : '—';
                              return (
                                <div
                                  key={part.id}
                                  className="flex items-center justify-between text-[11px]"
                                >
                                  <span
                                    className={
                                      part.is_bonus
                                        ? 'text-amber-300 font-semibold'
                                        : 'text-slate-400'
                                    }
                                  >
                                    {part.is_bonus ? '⭐ ' : ''}
                                    {part.label ||
                                      (part.is_bonus ? 'Bonus vprašanje' : `Del ${pIdx + 1}`)}
                                    :
                                  </span>
                                  <span
                                    className={`font-mono-code font-bold ${
                                      part.is_bonus ? 'text-amber-300' : 'text-emerald-400'
                                    }`}
                                  >
                                    {displayVal}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            E. STANJE: LEADERBOARD in FINISHED (Lestvica in uvrstitev)
            =================================================================== */}
        {(session.status === 'leaderboard' || session.status === 'finished') && (
          <div className="space-y-5 animate-fadeIn">
            {/* Kartica z uvrstitvijo tekmovalca */}
            <div
              className={`bg-gradient-to-b ${
                session.status === 'finished'
                  ? 'from-amber-500/20 via-slate-900/90 to-slate-950 border-2 border-amber-500/50'
                  : 'from-indigo-500/15 via-slate-900/90 to-slate-950 border-2 border-indigo-500/40'
              } rounded-3xl p-6 text-center space-y-3 shadow-2xl`}
            >
              <div
                className={`w-16 h-16 rounded-2xl ${
                  session.status === 'finished' && myLeaderboardRank <= 3
                    ? 'bg-amber-500/30 border-2 border-amber-400 text-3xl animate-bounce'
                    : 'bg-amber-500/20 border border-amber-500/40 text-2xl'
                } flex items-center justify-center text-amber-300 mx-auto shadow-lg`}
              >
                {myLeaderboardRank === 1
                  ? '👑'
                  : myLeaderboardRank === 2
                  ? '🥈'
                  : myLeaderboardRank === 3
                  ? '🥉'
                  : '🏆'}
              </div>

              <div className="space-y-1">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  {session.status === 'finished'
                    ? '🎉 Kviz je zaključen!'
                    : 'Trenutna uvrstitev'}
                </span>
                <h3 className="text-2xl font-black text-slate-100">
                  {session.status === 'finished'
                    ? `Osvojil si ${myLeaderboardRank}. mesto!`
                    : `Trenutno si na ${myLeaderboardRank}. mestu!`}
                </h3>
                <div className="text-3xl font-mono-code font-black text-emerald-400 pt-1">
                  {player.total_score} točk
                </div>

                {session.status === 'finished' && (
                  <p className="text-xs text-slate-300 pt-3 border-t border-slate-800/80 mt-3 leading-relaxed">
                    Iskrena hvala za sodelovanje in napeto igro! Upamo, da ste uživali. 🙌✨
                  </p>
                )}
              </div>
            </div>

            {/* Pregled rezultatov in komentarjev gostitelja */}
            {session.status === 'leaderboard' && currentTheme && (
              <PlayerResultsReview
                gameData={gameData}
                themes={[currentTheme]}
                title="Tvoji rezultati v tem sklopu"
              />
            )}
            {session.status === 'finished' && (
              <PlayerResultsReview
                gameData={gameData}
                themes={gameData.themes}
                title="Pregled vseh tvojih odgovorov po sklopih"
              />
            )}

            {/* Lestvica ekip */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-4 space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block px-1">
                Lestvica vseh ekip:
              </span>

              <div className="divide-y divide-slate-800/80">
                {leaderboard.map(
                  (item: { id: string; nickname: string; total_score: number; rank: number }) => {
                  const isMe = item.id === player.id;
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between py-2.5 px-3 rounded-xl transition-all ${
                        isMe
                          ? 'bg-indigo-600/20 border border-indigo-500/40 font-bold text-white'
                          : 'text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 font-mono-code font-bold text-xs flex items-center justify-center">
                          #{item.rank}
                        </span>
                        <span className="text-xs truncate max-w-[170px]">
                          {item.nickname} {isMe && '(TI)'}
                        </span>
                      </div>
                      <span className="font-mono-code font-bold text-xs text-emerald-400">
                        {item.total_score} t
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
