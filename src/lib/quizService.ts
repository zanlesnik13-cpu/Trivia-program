import { compressImageBlobToDataUrl } from './pdfConverter';
import { getSupabaseClient } from './supabase';
import type {
  Answer,
  GameSession,
  Player,
  PlayerFullData,
  PlayerJoker,
  PresentationData,
  Quiz,
  QuizWithStats,
  Slide,
  SlideOptions,
  SlideType,
  Theme,
} from '../types/quiz';

const DEMO_STORAGE_KEY = 'trivia_demo_data_v2';
const DEMO_CHANNEL_NAME = 'trivia_demo_broadcast_channel';

// BroadcastChannel za medsebojno komunikacijo med zavihki v Demo načinu
let demoBroadcastChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  demoBroadcastChannel = new BroadcastChannel(DEMO_CHANNEL_NAME);
}

export function subscribeToDemoUpdates(callback: (event: { type: string; sessionId?: string }) => void) {
  if (!demoBroadcastChannel) return () => {};
  const handler = (e: MessageEvent) => {
    if (e.data) callback(e.data);
  };
  demoBroadcastChannel.addEventListener('message', handler);
  return () => {
    demoBroadcastChannel?.removeEventListener('message', handler);
  };
}

function notifyDemoUpdate(type: string, sessionId?: string) {
  if (demoBroadcastChannel) {
    demoBroadcastChannel.postMessage({ type, sessionId });
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('trivia_demo_local_update', { detail: { type, sessionId } }));
  }
}

interface DemoDatabase {
  quizzes: Quiz[];
  themes: Theme[];
  slides: Slide[];
  game_sessions: GameSession[];
  players: Player[];
  player_jokers: PlayerJoker[];
  answers: Answer[];
}

function getInitialDemoDb(): DemoDatabase {
  if (typeof window === 'undefined') {
    return {
      quizzes: [],
      themes: [],
      slides: [],
      game_sessions: [],
      players: [],
      player_jokers: [],
      answers: [],
    };
  }
  const raw = localStorage.getItem(DEMO_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<DemoDatabase>;
      return {
        quizzes: parsed.quizzes || [],
        themes: parsed.themes || [],
        slides: parsed.slides || [],
        game_sessions: parsed.game_sessions || [],
        players: parsed.players || [],
        player_jokers: parsed.player_jokers || [],
        answers: parsed.answers || [],
      };
    } catch {
      // ignore
    }
  }

  const quizId = crypto.randomUUID();
  const theme1Id = crypto.randomUUID();
  const theme2Id = crypto.randomUUID();

  const initial: DemoDatabase = {
    quizzes: [
      {
        id: quizId,
        host_id: 'demo-host',
        title: 'Veliki Petkov Pub Kviz #14',
        max_jokers_per_player: 1,
        created_at: new Date().toISOString(),
      },
    ],
    themes: [
      {
        id: theme1Id,
        quiz_id: quizId,
        title: '1. sklop: Film in Pop Kultura',
        order_index: 0,
      },
      {
        id: theme2Id,
        quiz_id: quizId,
        title: '2. sklop: Zgodovina in Geografija',
        order_index: 1,
      },
    ],
    slides: [
      {
        id: crypto.randomUUID(),
        theme_id: theme1Id,
        order_index: 0,
        slide_image_url: null,
        slide_type: 'theme_intro',
        question_text: '1. sklop: Film in Pop Kultura — Čas za aktivacijo Jokerja na vaših telefonih!',
        options: { A: '', B: '', C: '', D: '' },
        correct_answer: '',
        points: 0,
        timer_seconds: 0,
      },
      {
        id: crypto.randomUUID(),
        theme_id: theme1Id,
        order_index: 1,
        slide_image_url: null,
        slide_type: 'multiple_choice',
        question_text: 'Kateri režiser je posnel filmsko trilogijo Gospodar prstanov?',
        options: {
          A: 'Christopher Nolan',
          B: 'Peter Jackson',
          C: 'Steven Spielberg',
          D: 'Denis Villeneuve',
        },
        correct_answer: 'B',
        points: 1,
        timer_seconds: 30,
      },
      {
        id: crypto.randomUUID(),
        theme_id: theme1Id,
        order_index: 2,
        slide_image_url: null,
        slide_type: 'closest_number',
        question_text: 'Katerega leta je bil v kinematografih prvič predvajan film Matrix?',
        options: { A: '', B: '', C: '', D: '' },
        correct_answer: '1999',
        points: 2,
        timer_seconds: 25,
      },
      {
        id: crypto.randomUUID(),
        theme_id: theme2Id,
        order_index: 0,
        slide_image_url: null,
        slide_type: 'theme_intro',
        question_text: '2. sklop: Zgodovina in Geografija — Čas za aktivacijo Jokerja!',
        options: { A: '', B: '', C: '', D: '' },
        correct_answer: '',
        points: 0,
        timer_seconds: 0,
      },
      {
        id: crypto.randomUUID(),
        theme_id: theme2Id,
        order_index: 1,
        slide_image_url: null,
        slide_type: 'open_text',
        question_text: 'Katero glavno mesto leži ob reki Ljubljanici?',
        options: { A: '', B: '', C: '', D: '' },
        correct_answer: 'Ljubljana',
        points: 1,
        timer_seconds: 30,
      },
    ],
    game_sessions: [],
    players: [],
    player_jokers: [],
    answers: [],
  };

  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

function saveDemoDb(db: DemoDatabase) {
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(db));
}

function normalizeOptions(raw: unknown): SlideOptions {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return {
      A: typeof obj.A === 'string' ? obj.A : '',
      B: typeof obj.B === 'string' ? obj.B : '',
      C: typeof obj.C === 'string' ? obj.C : '',
      D: typeof obj.D === 'string' ? obj.D : '',
    };
  }
  return { A: '', B: '', C: '', D: '' };
}

// -----------------------------------------------------------------------------
// KVIZI & TEMATIKE
// -----------------------------------------------------------------------------

function formatSupabaseError(err: unknown, context: string): Error {
  if (err && typeof err === 'object') {
    const obj = err as { code?: string; message?: string; details?: string; hint?: string };
    const code = obj.code ? ` [${obj.code}]` : '';
    const msg = obj.message || 'Neznana napaka.';
    const details = obj.details ? ` (${obj.details})` : '';

    // Če gre za napako foreign key na quizzes_host_id_fkey ali RLS (42501 / 23503)
    if (obj.code === '23503' && msg.includes('quizzes_host_id_fkey')) {
      return new Error(
        `${context}: Tabela "quizzes" ima še vedno staro omejitev na auth.users. Odprite "SQL Skripta & Supabase" in v Supabase SQL Editorju poženite kratko popravljalno SQL skripto! (${msg})`
      );
    }
    if (obj.code === '42501') {
      return new Error(
        `${context}: Zavrnjen dostop zaradi RLS politik${code}. Odprite "SQL Skripta & Supabase" in v Supabase SQL Editorju poženite kratko popravljalno SQL skripto za izklop RLS! (${msg})`
      );
    }
    return new Error(`${context}${code}: ${msg}${details}`);
  }
  if (err instanceof Error) return err;
  return new Error(`${context}: Neznana napaka.`);
}

function getValidUuidHostId(rawHostId?: string): string {
  if (rawHostId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawHostId)) {
    return rawHostId;
  }
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('guest_host_id');
    if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) {
      return stored;
    }
  }
  const newUuid = crypto.randomUUID();
  if (typeof window !== 'undefined') {
    localStorage.setItem('guest_host_id', newUuid);
  }
  return newUuid;
}

/**
 * Shrani celoten kviz (quizzes), njegove tematike (themes) in vse slajde (slides)
 * z operacijo UPSERT neposredno v Supabase bazo (in posodobi lokalni pomnilnik).
 */
export async function upsertFullQuiz(
  quiz: Quiz,
  themes: Theme[],
  slidesByTheme: Record<string, Slide[]>,
  hostId?: string
): Promise<void> {
  // 1. Posodobi lokalni pomnilnik (localStorage demo bazo)
  try {
    const db = getInitialDemoDb();
    const qIdx = db.quizzes.findIndex((q) => q.id === quiz.id);
    if (qIdx >= 0) {
      db.quizzes[qIdx] = { ...quiz };
    } else {
      db.quizzes.unshift({ ...quiz });
    }

    const remainingThemes = db.themes.filter((t) => t.quiz_id !== quiz.id);
    db.themes = [...remainingThemes, ...themes];

    const themeIds = new Set(themes.map((t) => t.id));
    const remainingSlides = db.slides.filter((s) => !themeIds.has(s.theme_id));
    const allSlides: Slide[] = [];
    for (const theme of themes) {
      const tSlides = slidesByTheme[theme.id] || [];
      tSlides.forEach((s, idx) => {
        allSlides.push({
          ...s,
          theme_id: theme.id,
          order_index: s.order_index ?? idx,
        });
      });
    }
    db.slides = [...remainingSlides, ...allSlides];
    saveDemoDb(db);
  } catch {
    // ignoriraj morebitne napake pri dostopu do localStorage
  }

  // 2. Če je Supabase konfiguriran, izvedi celovit UPSERT vseh tabel
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const effectiveHostId = getValidUuidHostId(hostId || quiz.host_id);

  // a) Upsert kviza v tabelo quizzes (id, host_id, title, max_jokers_per_player)
  const { error: quizErr } = await supabase.from('quizzes').upsert(
    {
      id: quiz.id,
      host_id: effectiveHostId,
      title: quiz.title,
      max_jokers_per_player: quiz.max_jokers_per_player ?? 1,
    },
    { onConflict: 'id' }
  );

  if (quizErr) {
    throw formatSupabaseError(quizErr, 'Napaka pri shranjevanju kviza v Supabase tabelo quizzes');
  }

  // b) Upsert tematik v tabelo themes (id, quiz_id, title, order_index)
  if (themes.length > 0) {
    const { error: themesErr } = await supabase.from('themes').upsert(
      themes.map((t, idx) => ({
        id: t.id,
        quiz_id: quiz.id,
        title: t.title,
        order_index: t.order_index ?? idx,
      })),
      { onConflict: 'id' }
    );

    if (themesErr) {
      throw formatSupabaseError(themesErr, 'Napaka pri shranjevanju tematik v Supabase tabelo themes');
    }
  }

  // c) Upsert vseh slajdov v tabelo slides (id, theme_id, order_index, slide_image_url, slide_type, question_text, options, correct_answer, points, timer_seconds)
  const allSlidesToUpsert: Slide[] = [];
  for (const theme of themes) {
    const tSlides = slidesByTheme[theme.id] || [];
    tSlides.forEach((s, idx) => {
      allSlidesToUpsert.push({
        ...s,
        theme_id: theme.id,
        order_index: s.order_index ?? idx,
      });
    });
  }

  if (allSlidesToUpsert.length > 0) {
    const { error: slidesErr } = await supabase.from('slides').upsert(
      allSlidesToUpsert.map((s) => ({
        id: s.id,
        theme_id: s.theme_id,
        order_index: s.order_index,
        slide_image_url: s.slide_image_url ?? null,
        slide_type: s.slide_type,
        question_text: s.question_text ?? '',
        options: s.options ?? { A: '', B: '', C: '', D: '' },
        correct_answer: s.correct_answer ?? '',
        points: Number(s.points ?? (s.slide_type === 'theme_intro' || s.slide_type === 'info_only' ? 0 : 1)),
        timer_seconds: Number(s.timer_seconds ?? 0),
      })),
      { onConflict: 'id' }
    );

    if (slidesErr) {
      throw formatSupabaseError(slidesErr, 'Napaka pri shranjevanju slajdov v Supabase tabelo slides');
    }
  }
}

/**
 * Zagotovi, da je celoten kviz (s tematikami in slajdi) prisoten v Supabase bazi,
 * preden se v tabeli game_sessions ustvari nova seja.
 */
export async function ensureQuizSyncedToSupabase(quizId: string, hostId?: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  // 1. Preveri lokalni pomnilnik (kjer je npr. privzeti demo kviz "Veliki Petkov Pub Kviz #14" ali lokalno ustvarjen kviz)
  const db = getInitialDemoDb();
  const localQuiz = db.quizzes.find((q) => q.id === quizId);
  const localThemes = db.themes
    .filter((t) => t.quiz_id === quizId)
    .sort((a, b) => a.order_index - b.order_index);
  const localThemeIds = new Set(localThemes.map((t) => t.id));
  const localSlides = db.slides
    .filter((s) => localThemeIds.has(s.theme_id))
    .sort((a, b) => a.order_index - b.order_index);

  if (localQuiz) {
    const slidesByTheme: Record<string, Slide[]> = {};
    for (const t of localThemes) {
      slidesByTheme[t.id] = localSlides.filter((s) => s.theme_id === t.id);
    }
    // Brezpogojno izvedi upsert kviza, tematik in slajdov v Supabase
    await upsertFullQuiz(localQuiz, localThemes, slidesByTheme, hostId);
    return;
  }

  // 2. Če kviz ni v lokalnem pomnilniku, preveri, ali je že v Supabase bazi
  const { data: existingInDb, error: checkErr } = await supabase
    .from('quizzes')
    .select('id, title')
    .eq('id', quizId)
    .maybeSingle();

  if (checkErr) {
    throw formatSupabaseError(checkErr, 'Napaka pri preverjanju obstoja kviza v Supabase');
  }

  if (!existingInDb) {
    throw new Error(
      `Kviz z ID "${quizId}" ne obstaja v bazi niti v lokalnem pomnilniku. Pred zagonom prosimo shranite kviz.`
    );
  }
}

export async function fetchHostQuizzes(hostId: string): Promise<QuizWithStats[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    return db.quizzes.map((q) => {
      const qThemes = db.themes.filter((t) => t.quiz_id === q.id);
      const themeIds = new Set(qThemes.map((t) => t.id));
      const qSlides = db.slides.filter((s) => themeIds.has(s.theme_id));
      return {
        ...q,
        theme_count: qThemes.length,
        slide_count: qSlides.length,
      };
    });
  }

  // Poskusi prebrati kvize za tega gostitelja (in morebitne z demo-host)
  const { data: quizzes, error } = await supabase
    .from('quizzes')
    .select('*')
    .or(`host_id.eq.${hostId},host_id.eq.demo-host`)
    .order('created_at', { ascending: false });

  if (error) throw formatSupabaseError(error, 'Napaka pri nalaganju kvizov');

  // Preveri lokalno bazo in sinhroniziraj kvize, ki še niso v Supabase bazi
  const db = getInitialDemoDb();
  const existingIds = new Set((quizzes || []).map((q) => q.id));

  for (const lq of db.quizzes) {
    if (!existingIds.has(lq.id)) {
      const lThemes = db.themes.filter((t) => t.quiz_id === lq.id);
      const lSlides = db.slides.filter((s) => lThemes.some((t) => t.id === s.theme_id));
      const sByTheme: Record<string, Slide[]> = {};
      for (const t of lThemes) {
        sByTheme[t.id] = lSlides.filter((s) => s.theme_id === t.id);
      }
      try {
        await upsertFullQuiz(lq, lThemes, sByTheme, hostId);
      } catch (e) {
        console.warn('Samodejna sinhronizacija lokalnega kviza v Supabase ni uspela:', e);
      }
    }
  }

  // Preberi osvežene kvize iz Supabase
  const { data: refreshedQuizzes } = await supabase
    .from('quizzes')
    .select('*')
    .or(`host_id.eq.${hostId},host_id.eq.demo-host`)
    .order('created_at', { ascending: false });

  const finalQuizzes = (refreshedQuizzes && refreshedQuizzes.length > 0) ? refreshedQuizzes : (quizzes || []);

  if (finalQuizzes.length === 0) {
    return db.quizzes.map((q) => {
      const qThemes = db.themes.filter((t) => t.quiz_id === q.id);
      const themeIds = new Set(qThemes.map((t) => t.id));
      const qSlides = db.slides.filter((s) => themeIds.has(s.theme_id));
      return {
        ...q,
        theme_count: qThemes.length,
        slide_count: qSlides.length,
      };
    });
  }

  const quizIds = finalQuizzes.map((q) => q.id);
  const { data: themes } = await supabase
    .from('themes')
    .select('id, quiz_id')
    .in('quiz_id', quizIds);

  const themeList = themes || [];
  const themeIds = themeList.map((t) => t.id);

  let slideList: { id: string; theme_id: string }[] = [];
  if (themeIds.length > 0) {
    const { data: slides } = await supabase
      .from('slides')
      .select('id, theme_id')
      .in('theme_id', themeIds);
    slideList = slides || [];
  }

  return finalQuizzes.map((q) => {
    const qThemes = themeList.filter((t) => t.quiz_id === q.id);
    const qThemeIds = new Set(qThemes.map((t) => t.id));
    const qSlides = slideList.filter((s) => qThemeIds.has(s.theme_id));
    return {
      ...(q as Quiz),
      theme_count: qThemes.length,
      slide_count: qSlides.length,
    };
  });
}

export async function createQuiz(
  hostId: string,
  title: string,
  maxJokersPerPlayer: number
): Promise<Quiz> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const newQuiz: Quiz = {
      id: crypto.randomUUID(),
      host_id: hostId,
      title,
      max_jokers_per_player: maxJokersPerPlayer,
      created_at: new Date().toISOString(),
    };
    const defaultThemeId = crypto.randomUUID();
    const defaultTheme: Theme = {
      id: defaultThemeId,
      quiz_id: newQuiz.id,
      title: '1. sklop: Splošno znanje',
      order_index: 0,
    };
    const introSlide: Slide = {
      id: crypto.randomUUID(),
      theme_id: defaultThemeId,
      order_index: 0,
      slide_image_url: null,
      slide_type: 'theme_intro',
      question_text: '1. sklop: Splošno znanje (Predstavitveni slajd teme - Igralci lahko vklopijo Jokerja)',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '',
      points: 0,
      timer_seconds: 0,
    };
    db.quizzes.unshift(newQuiz);
    db.themes.push(defaultTheme);
    db.slides.push(introSlide);
    saveDemoDb(db);
    return newQuiz;
  }

  const { data: quiz, error } = await supabase
    .from('quizzes')
    .insert({
      host_id: hostId,
      title,
      max_jokers_per_player: maxJokersPerPlayer,
    })
    .select('*')
    .single();

  if (error) throw formatSupabaseError(error, 'Napaka pri ustvarjanju kviza v Supabase');

  const { data: theme, error: themeErr } = await supabase
    .from('themes')
    .insert({
      quiz_id: quiz.id,
      title: '1. sklop: Uvodna tema',
      order_index: 0,
    })
    .select('*')
    .single();

  if (themeErr) throw formatSupabaseError(themeErr, 'Napaka pri ustvarjanju uvodne tematike');

  if (theme) {
    const { error: slideErr } = await supabase.from('slides').insert({
      theme_id: theme.id,
      order_index: 0,
      slide_type: 'theme_intro',
      question_text: '1. sklop: Uvodna tema — Pred začetkom sklopa lahko aktivirate Jokerja za dvojne točke!',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '',
      points: 0,
      timer_seconds: 0,
    });
    if (slideErr) throw formatSupabaseError(slideErr, 'Napaka pri ustvarjanju uvodnega slajda');
  }

  return quiz as Quiz;
}

export async function updateQuizMeta(
  quizId: string,
  updates: { title?: string; max_jokers_per_player?: number }
): Promise<Quiz> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const idx = db.quizzes.findIndex((q) => q.id === quizId);
    if (idx === -1) throw new Error('Kviz ne obstaja.');
    db.quizzes[idx] = { ...db.quizzes[idx], ...updates };
    saveDemoDb(db);
    return db.quizzes[idx];
  }

  const { data, error } = await supabase
    .from('quizzes')
    .update(updates)
    .eq('id', quizId)
    .select('*')
    .single();

  if (error) throw formatSupabaseError(error, 'Napaka pri shranjevanju nastavitev kviza');
  return data as Quiz;
}

export async function deleteQuiz(quizId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const themeIds = new Set(db.themes.filter((t) => t.quiz_id === quizId).map((t) => t.id));
    db.slides = db.slides.filter((s) => !themeIds.has(s.theme_id));
    db.themes = db.themes.filter((t) => t.quiz_id !== quizId);
    db.quizzes = db.quizzes.filter((q) => q.id !== quizId);
    saveDemoDb(db);
    return;
  }

  const { error } = await supabase.from('quizzes').delete().eq('id', quizId);
  if (error) throw formatSupabaseError(error, 'Napaka pri brisanju kviza');
}

export async function fetchQuizDetails(quizId: string): Promise<{
  quiz: Quiz;
  themes: Theme[];
  slidesByTheme: Record<string, Slide[]>;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const quiz = db.quizzes.find((q) => q.id === quizId);
    if (!quiz) throw new Error('Kviz ni bil najden.');
    const themes = db.themes
      .filter((t) => t.quiz_id === quizId)
      .sort((a, b) => a.order_index - b.order_index);
    const slidesByTheme: Record<string, Slide[]> = {};
    for (const theme of themes) {
      slidesByTheme[theme.id] = db.slides
        .filter((s) => s.theme_id === theme.id)
        .sort((a, b) => a.order_index - b.order_index)
        .map((s) => ({
          ...s,
          options: normalizeOptions(s.options),
          points: Number(s.points ?? 1),
          timer_seconds: Number(s.timer_seconds ?? 0),
        }));
    }
    return { quiz, themes, slidesByTheme };
  }

  const { data: quiz, error: quizErr } = await supabase
    .from('quizzes')
    .select('*')
    .eq('id', quizId)
    .maybeSingle();

  if (quizErr || !quiz) {
    const db = getInitialDemoDb();
    const localQuiz = db.quizzes.find((q) => q.id === quizId);
    if (localQuiz) {
      const themes = db.themes
        .filter((t) => t.quiz_id === quizId)
        .sort((a, b) => a.order_index - b.order_index);
      const slidesByTheme: Record<string, Slide[]> = {};
      for (const theme of themes) {
        slidesByTheme[theme.id] = db.slides
          .filter((s) => s.theme_id === theme.id)
          .sort((a, b) => a.order_index - b.order_index)
          .map((s) => ({
            ...s,
            options: normalizeOptions(s.options),
            points: Number(s.points ?? 1),
            timer_seconds: Number(s.timer_seconds ?? 0),
          }));
      }
      try {
        await upsertFullQuiz(localQuiz, themes, slidesByTheme);
      } catch (e) {
        console.warn('Sinhronizacija lokalnega kviza v Supabase ni uspela:', e);
      }
      return { quiz: localQuiz, themes, slidesByTheme };
    }
    throw formatSupabaseError(quizErr || new Error('Kviz ni bil najden.'), 'Napaka pri branju kviza');
  }

  const { data: themesData, error: themesErr } = await supabase
    .from('themes')
    .select('*')
    .eq('quiz_id', quizId)
    .order('order_index', { ascending: true });

  if (themesErr) throw formatSupabaseError(themesErr, 'Napaka pri branju tematik');
  const themes = (themesData || []) as Theme[];

  const slidesByTheme: Record<string, Slide[]> = {};
  for (const t of themes) {
    slidesByTheme[t.id] = [];
  }

  if (themes.length > 0) {
    const themeIds = themes.map((t) => t.id);
    const { data: slidesData, error: slidesErr } = await supabase
      .from('slides')
      .select('*')
      .in('theme_id', themeIds)
      .order('order_index', { ascending: true });

    if (slidesErr) throw formatSupabaseError(slidesErr, 'Napaka pri branju slajdov');

    for (const rawSlide of slidesData || []) {
      const slide: Slide = {
        id: rawSlide.id,
        theme_id: rawSlide.theme_id,
        order_index: rawSlide.order_index,
        slide_image_url: rawSlide.slide_image_url,
        slide_type: rawSlide.slide_type as SlideType,
        question_text: rawSlide.question_text || '',
        options: normalizeOptions(rawSlide.options),
        correct_answer: rawSlide.correct_answer || '',
        points: Number(rawSlide.points ?? 1),
        timer_seconds: Number(rawSlide.timer_seconds ?? 0),
      };
      if (!slidesByTheme[slide.theme_id]) {
        slidesByTheme[slide.theme_id] = [];
      }
      slidesByTheme[slide.theme_id].push(slide);
    }
  }

  return { quiz: quiz as Quiz, themes, slidesByTheme };
}

export async function createTheme(
  quizId: string,
  title: string,
  orderIndex: number
): Promise<{ theme: Theme; introSlide: Slide }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const theme: Theme = {
      id: crypto.randomUUID(),
      quiz_id: quizId,
      title,
      order_index: orderIndex,
    };
    const introSlide: Slide = {
      id: crypto.randomUUID(),
      theme_id: theme.id,
      order_index: 0,
      slide_image_url: null,
      slide_type: 'theme_intro',
      question_text: `${title} — Tukaj lahko igralci aktivirajo Jokerja za dvojne točke v tej temi!`,
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '',
      points: 0,
      timer_seconds: 0,
    };
    db.themes.push(theme);
    db.slides.push(introSlide);
    saveDemoDb(db);
    return { theme, introSlide };
  }

  const { data: themeData, error: themeErr } = await supabase
    .from('themes')
    .insert({
      quiz_id: quizId,
      title,
      order_index: orderIndex,
    })
    .select('*')
    .single();

  if (themeErr) throw formatSupabaseError(themeErr, 'Napaka pri dodajanju tematike');

  const { data: slideData, error: slideErr } = await supabase
    .from('slides')
    .insert({
      theme_id: themeData.id,
      order_index: 0,
      slide_type: 'theme_intro',
      question_text: `${title} — Pred začetkom sklopa lahko aktivirate Jokerja za dvojne točke!`,
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '',
      points: 0,
      timer_seconds: 0,
    })
    .select('*')
    .single();

  if (slideErr) throw formatSupabaseError(slideErr, 'Napaka pri dodajanju uvodnega slajda teme');

  return {
    theme: themeData as Theme,
    introSlide: {
      ...(slideData as Slide),
      options: normalizeOptions(slideData.options),
    },
  };
}

export async function updateTheme(
  themeId: string,
  updates: { title?: string; order_index?: number }
): Promise<Theme> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const idx = db.themes.findIndex((t) => t.id === themeId);
    if (idx === -1) throw new Error('Tematika ne obstaja.');
    db.themes[idx] = { ...db.themes[idx], ...updates };
    saveDemoDb(db);
    return db.themes[idx];
  }

  const { data, error } = await supabase
    .from('themes')
    .update(updates)
    .eq('id', themeId)
    .select('*')
    .single();

  if (error) throw formatSupabaseError(error, 'Napaka pri shranjevanju tematike');
  return data as Theme;
}

export async function deleteTheme(themeId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    db.slides = db.slides.filter((s) => s.theme_id !== themeId);
    db.themes = db.themes.filter((t) => t.id !== themeId);
    saveDemoDb(db);
    return;
  }

  const { error } = await supabase.from('themes').delete().eq('id', themeId);
  if (error) throw formatSupabaseError(error, 'Napaka pri brisanju tematike');
}

export async function createSlide(
  themeId: string,
  payload: Partial<Omit<Slide, 'id' | 'theme_id'>> & { order_index: number }
): Promise<Slide> {
  const defaultSlide: Omit<Slide, 'id'> = {
    theme_id: themeId,
    order_index: payload.order_index,
    slide_image_url: payload.slide_image_url ?? null,
    slide_type: payload.slide_type ?? 'multiple_choice',
    question_text: payload.question_text ?? '',
    options: payload.options ?? { A: '', B: '', C: '', D: '' },
    correct_answer: payload.correct_answer ?? '',
    points: payload.points ?? (payload.slide_type === 'theme_intro' || payload.slide_type === 'info_only' ? 0 : 1),
    timer_seconds: payload.timer_seconds ?? 0,
  };

  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const newSlide: Slide = {
      id: crypto.randomUUID(),
      ...defaultSlide,
    };
    db.slides.push(newSlide);
    saveDemoDb(db);
    return newSlide;
  }

  const { data, error } = await supabase
    .from('slides')
    .insert(defaultSlide)
    .select('*')
    .single();

  if (error) throw formatSupabaseError(error, 'Napaka pri ustvarjanju slajda');
  return {
    ...(data as Slide),
    options: normalizeOptions(data.options),
    points: Number(data.points ?? 1),
    timer_seconds: Number(data.timer_seconds ?? 0),
  };
}

export async function updateSlide(
  slideId: string,
  updates: Partial<Omit<Slide, 'id' | 'theme_id'>>
): Promise<Slide> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const idx = db.slides.findIndex((s) => s.id === slideId);
    if (idx === -1) throw new Error('Slajd ne obstaja.');
    db.slides[idx] = { ...db.slides[idx], ...updates };
    saveDemoDb(db);
    return db.slides[idx];
  }

  const { data, error } = await supabase
    .from('slides')
    .update(updates)
    .eq('id', slideId)
    .select('*')
    .single();

  if (error) throw formatSupabaseError(error, 'Napaka pri shranjevanju slajda');
  return {
    ...(data as Slide),
    options: normalizeOptions(data.options),
    points: Number(data.points ?? 1),
    timer_seconds: Number(data.timer_seconds ?? 0),
  };
}

export async function deleteSlide(slideId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    db.slides = db.slides.filter((s) => s.id !== slideId);
    saveDemoDb(db);
    return;
  }

  const { error } = await supabase.from('slides').delete().eq('id', slideId);
  if (error) throw formatSupabaseError(error, 'Napaka pri brisanju slajda');
}

/**
 * Naloži sliko slajda v Supabase Storage bucket 'slides'.
 * Če Supabase ni povezan ali če nalaganje v Storage bucket spodleti (npr. zaradi manjkajočega bucketa ali RLS politik),
 * sliko samodejno stisne v optimiziran JPEG Base64 data URL (kvaliteta 0.7, max širina 1280px)
 * in jo vrne za neposredno shranjevanje v polje `slide_image_url`, da nalaganje 100% deluje!
 */
export async function uploadSlideImage(
  quizId: string,
  themeId: string,
  blob: Blob,
  fileName: string
): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return await compressImageBlobToDataUrl(blob, 1280, 0.7);
  }

  try {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${quizId}/${themeId}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from('slides')
      .upload(filePath, blob, {
        contentType: blob.type || 'image/jpeg',
        upsert: true,
      });

    if (uploadError) {
      // Če nalaganje v Storage bucket 'slides' spodleti, uporabi stisnjen Base64 data URL fallback
      return await compressImageBlobToDataUrl(blob, 1280, 0.7);
    }

    const { data } = supabase.storage.from('slides').getPublicUrl(filePath);
    if (data?.publicUrl) {
      return data.publicUrl;
    }
    return await compressImageBlobToDataUrl(blob, 1280, 0.7);
  } catch {
    return await compressImageBlobToDataUrl(blob, 1280, 0.7);
  }
}

// -----------------------------------------------------------------------------
// LIVE GAME SESSIONS, PRESENTATION & CONTROLLER
// -----------------------------------------------------------------------------

export interface ActiveGameSessionWithQuiz {
  session: GameSession;
  quizTitle: string;
  playerCount: number;
}

/**
 * Ustvari novo živo sejo s 4-mestno številčno kodo ('room_code') in statusom 'lobby'.
 */
export async function createLiveGameSession(quizId: string, hostId?: string): Promise<GameSession> {
  const generateNumericRoomCode = () => {
    // 4-mestna številčna koda med 1000 in 9999
    return String(Math.floor(1000 + Math.random() * 9000));
  };

  const supabase = getSupabaseClient();

  if (!supabase) {
    const db = getInitialDemoDb();
    const themes = db.themes
      .filter((t) => t.quiz_id === quizId)
      .sort((a, b) => a.order_index - b.order_index);
    const firstTheme = themes[0] || null;
    const firstSlide = firstTheme
      ? db.slides
          .filter((s) => s.theme_id === firstTheme.id)
          .sort((a, b) => a.order_index - b.order_index)[0] || null
      : null;

    let roomCode = generateNumericRoomCode();
    const existingCodes = new Set(db.game_sessions.map((s) => s.room_code));
    for (let i = 0; i < 10; i++) {
      if (!existingCodes.has(roomCode)) break;
      roomCode = generateNumericRoomCode();
    }

    const session: GameSession = {
      id: crypto.randomUUID(),
      quiz_id: quizId,
      room_code: roomCode,
      status: 'lobby',
      current_theme_id: firstTheme?.id || null,
      current_slide_id: firstSlide?.id || null,
      max_slide_index_reached: 0,
      timer_started_at: null,
      timer_duration: 0,
      created_at: new Date().toISOString(),
    };
    db.game_sessions.unshift(session);
    saveDemoDb(db);
    notifyDemoUpdate('SESSION_CREATED', session.id);
    return session;
  }

  // 1. ZAGOTOVI, DA JE CELOTEN KVIZ (S TEMATIKAMI IN SLAJDI) ZAPISAN V SUPABASE (UPSERT)
  // Tako se napaka 23503 foreign key constraint nikoli ne more zgoditi!
  await ensureQuizSyncedToSupabase(quizId, hostId);

  const { data: themes, error: themeError } = await supabase
    .from('themes')
    .select('id, order_index')
    .eq('quiz_id', quizId)
    .order('order_index', { ascending: true })
    .limit(1);

  if (themeError) {
    throw new Error(
      `Supabase napaka pri branju tematik (${themeError.code || 'UNKNOWN'}): ${themeError.message}`
    );
  }

  const firstThemeId = themes && themes.length > 0 ? themes[0].id : null;
  let firstSlideId: string | null = null;

  if (firstThemeId) {
    const { data: slides, error: slideError } = await supabase
      .from('slides')
      .select('id, order_index')
      .eq('theme_id', firstThemeId)
      .order('order_index', { ascending: true })
      .limit(1);

    if (slideError) {
      throw new Error(
        `Supabase napaka pri branju slajdov (${slideError.code || 'UNKNOWN'}): ${slideError.message}`
      );
    }

    if (slides && slides.length > 0) {
      firstSlideId = slides[0].id;
    }
  }

  let lastError: { code?: string; message?: string; details?: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const roomCode = generateNumericRoomCode();
    const { data, error } = await supabase
      .from('game_sessions')
      .insert({
        quiz_id: quizId,
        room_code: roomCode,
        status: 'lobby',
        current_theme_id: firstThemeId,
        current_slide_id: firstSlideId,
        max_slide_index_reached: 0,
        timer_started_at: null,
        timer_duration: 0,
      })
      .select('*')
      .single();

    if (!error && data) {
      return data as GameSession;
    }

    lastError = error;
    // Če gre za podvojeno room_code (23505), poskusi znova z novo naključno 4-mestno kodo
    if (error && error.code === '23505') {
      continue;
    }
    break;
  }

  const errMsg = lastError
    ? `Supabase napaka pri ustvarjanju seje (${lastError.code || 'ERROR'}): ${lastError.message}${
        lastError.details ? ` — ${lastError.details}` : ''
      }`
    : 'Neznana napaka pri ustvarjanju seje v tabeli game_sessions.';
  throw new Error(errMsg);
}

/**
 * Vrne vse aktivne (še nezaključene) seje gostitelja skupaj z imenom kviza in številom igralcev.
 */
export async function fetchHostActiveSessions(
  hostId: string
): Promise<ActiveGameSessionWithQuiz[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const hostQuizMap = new Map<string, string>();
    for (const q of db.quizzes) {
      hostQuizMap.set(q.id, q.title);
    }

    return db.game_sessions
      .filter((s) => s.status !== 'finished' && hostQuizMap.has(s.quiz_id))
      .map((session) => ({
        session,
        quizTitle: hostQuizMap.get(session.quiz_id) || 'Kviz v živo',
        playerCount: db.players.filter((p) => p.session_id === session.id).length,
      }));
  }

  const { data: quizzes, error: qErr } = await supabase
    .from('quizzes')
    .select('id, title')
    .eq('host_id', hostId);

  if (qErr || !quizzes || quizzes.length === 0) {
    return [];
  }

  const quizTitleMap = new Map<string, string>();
  const quizIds: string[] = [];
  for (const q of quizzes) {
    quizTitleMap.set(q.id, q.title);
    quizIds.push(q.id);
  }

  const { data: sessions, error: sErr } = await supabase
    .from('game_sessions')
    .select('*')
    .in('quiz_id', quizIds)
    .neq('status', 'finished')
    .order('created_at', { ascending: false })
    .limit(12);

  if (sErr || !sessions || sessions.length === 0) {
    return [];
  }

  const sessionIds = sessions.map((s) => s.id);
  const { data: playersData } = await supabase
    .from('players')
    .select('id, session_id')
    .in('session_id', sessionIds);

  const playerCountBySession: Record<string, number> = {};
  for (const p of playersData || []) {
    playerCountBySession[p.session_id] = (playerCountBySession[p.session_id] || 0) + 1;
  }

  return (sessions as GameSession[]).map((session) => ({
    session,
    quizTitle: quizTitleMap.get(session.quiz_id) || 'Kviz v živo',
    playerCount: playerCountBySession[session.id] || 0,
  }));
}

/**
 * Zaključi aktivno sejo (postavi status na 'finished').
 */
export async function closeGameSession(sessionId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const idx = db.game_sessions.findIndex((s) => s.id === sessionId);
    if (idx !== -1) {
      db.game_sessions[idx] = { ...db.game_sessions[idx], status: 'finished' };
      saveDemoDb(db);
      notifyDemoUpdate('SESSION_FINISHED', sessionId);
    }
    return;
  }

  const { error } = await supabase
    .from('game_sessions')
    .update({ status: 'finished' })
    .eq('id', sessionId);

  if (error) {
    throw new Error(`Napaka pri zaključevanju seje: ${error.message}`);
  }
}

export async function fetchGameSession(sessionId: string): Promise<GameSession | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    return db.game_sessions.find((s) => s.id === sessionId) || null;
  }

  const { data, error } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (error) return null;
  return data as GameSession;
}

export async function fetchPresentationData(sessionId: string): Promise<PresentationData> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const session = db.game_sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error('Seja ne obstaja.');

    const quiz = db.quizzes.find((q) => q.id === session.quiz_id);
    if (!quiz) throw new Error('Kviz te seje ne obstaja.');

    const themes = db.themes
      .filter((t) => t.quiz_id === quiz.id)
      .sort((a, b) => a.order_index - b.order_index);

    const slidesByTheme: Record<string, Slide[]> = {};
    for (const t of themes) {
      slidesByTheme[t.id] = db.slides
        .filter((s) => s.theme_id === t.id)
        .sort((a, b) => a.order_index - b.order_index)
        .map((s) => ({
          ...s,
          options: normalizeOptions(s.options),
          points: Number(s.points ?? 1),
          timer_seconds: Number(s.timer_seconds ?? 0),
        }));
    }

    const currentTheme = themes.find((t) => t.id === session.current_theme_id) || themes[0] || null;
    const currentThemeSlides = currentTheme ? slidesByTheme[currentTheme.id] || [] : [];
    const currentSlide =
      currentThemeSlides.find((s) => s.id === session.current_slide_id) ||
      currentThemeSlides[0] ||
      null;

    const players = db.players
      .filter((p) => p.session_id === sessionId)
      .sort((a, b) => b.total_score - a.total_score);

    const playerJokers = db.player_jokers.filter((pj) => pj.session_id === sessionId);
    const answers = db.answers.filter((a) => a.session_id === sessionId);

    return {
      session,
      quiz,
      themes,
      slidesByTheme,
      currentTheme,
      currentSlide,
      players,
      playerJokers,
      answers,
    };
  }

  // Supabase klic
  const { data: session, error: sErr } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (sErr || !session) throw sErr || new Error('Seja ni bila najdena.');

  const { data: quiz, error: qErr } = await supabase
    .from('quizzes')
    .select('*')
    .eq('id', session.quiz_id)
    .single();

  if (qErr || !quiz) throw qErr || new Error('Kviz ni bil najden.');

  const { data: themesData, error: tErr } = await supabase
    .from('themes')
    .select('*')
    .eq('quiz_id', quiz.id)
    .order('order_index', { ascending: true });

  if (tErr) throw tErr;
  const themes = (themesData || []) as Theme[];

  const slidesByTheme: Record<string, Slide[]> = {};
  for (const t of themes) {
    slidesByTheme[t.id] = [];
  }

  if (themes.length > 0) {
    const themeIds = themes.map((t) => t.id);
    const { data: slidesData } = await supabase
      .from('slides')
      .select('*')
      .in('theme_id', themeIds)
      .order('order_index', { ascending: true });

    for (const raw of slidesData || []) {
      const slide: Slide = {
        id: raw.id,
        theme_id: raw.theme_id,
        order_index: raw.order_index,
        slide_image_url: raw.slide_image_url,
        slide_type: raw.slide_type as SlideType,
        question_text: raw.question_text || '',
        options: normalizeOptions(raw.options),
        correct_answer: raw.correct_answer || '',
        points: Number(raw.points ?? 1),
        timer_seconds: Number(raw.timer_seconds ?? 0),
      };
      if (!slidesByTheme[slide.theme_id]) slidesByTheme[slide.theme_id] = [];
      slidesByTheme[slide.theme_id].push(slide);
    }
  }

  const currentTheme = themes.find((t) => t.id === session.current_theme_id) || themes[0] || null;
  const currentThemeSlides = currentTheme ? slidesByTheme[currentTheme.id] || [] : [];
  const currentSlide =
    currentThemeSlides.find((s) => s.id === session.current_slide_id) ||
    currentThemeSlides[0] ||
    null;

  const { data: playersData } = await supabase
    .from('players')
    .select('*')
    .eq('session_id', sessionId)
    .order('total_score', { ascending: false });

  const { data: jokersData } = await supabase
    .from('player_jokers')
    .select('*')
    .eq('session_id', sessionId);

  const { data: answersData } = await supabase
    .from('answers')
    .select('*')
    .eq('session_id', sessionId);

  return {
    session: session as GameSession,
    quiz: quiz as Quiz,
    themes,
    slidesByTheme,
    currentTheme,
    currentSlide,
    players: (playersData || []) as Player[],
    playerJokers: (jokersData || []) as PlayerJoker[],
    answers: (answersData || []) as Answer[],
  };
}

export async function updateGameSession(
  sessionId: string,
  updates: Partial<Omit<GameSession, 'id' | 'room_code' | 'quiz_id'>>
): Promise<GameSession> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const idx = db.game_sessions.findIndex((s) => s.id === sessionId);
    if (idx === -1) throw new Error('Seja ne obstaja.');
    db.game_sessions[idx] = { ...db.game_sessions[idx], ...updates };
    saveDemoDb(db);
    notifyDemoUpdate('SESSION_UPDATED', sessionId);
    return db.game_sessions[idx];
  }

  const { data, error } = await supabase
    .from('game_sessions')
    .update(updates)
    .eq('id', sessionId)
    .select('*')
    .single();

  if (error) throw error;
  return data as GameSession;
}

export async function addDemoPlayer(
  sessionId: string,
  nickname: string
): Promise<Player> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const newPlayer: Player = {
      id: crypto.randomUUID(),
      session_id: sessionId,
      nickname,
      reconnect_token: crypto.randomUUID(),
      total_score: 0,
      jokers_remaining: 1,
      created_at: new Date().toISOString(),
    };
    db.players.push(newPlayer);
    saveDemoDb(db);
    notifyDemoUpdate('PLAYERS_UPDATED', sessionId);
    return newPlayer;
  }

  const { data, error } = await supabase
    .from('players')
    .insert({
      session_id: sessionId,
      nickname,
      total_score: 0,
      jokers_remaining: 1,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as Player;
}

export async function togglePlayerJoker(
  sessionId: string,
  playerId: string,
  themeId: string
): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const idx = db.player_jokers.findIndex(
      (pj) => pj.session_id === sessionId && pj.player_id === playerId && pj.theme_id === themeId
    );
    let active = false;
    if (idx >= 0) {
      db.player_jokers.splice(idx, 1);
      active = false;
    } else {
      db.player_jokers.push({
        id: crypto.randomUUID(),
        session_id: sessionId,
        player_id: playerId,
        theme_id: themeId,
        created_at: new Date().toISOString(),
      });
      active = true;
    }
    saveDemoDb(db);
    notifyDemoUpdate('JOKER_UPDATED', sessionId);
    return active;
  }

  const { data: existing } = await supabase
    .from('player_jokers')
    .select('id')
    .eq('session_id', sessionId)
    .eq('player_id', playerId)
    .eq('theme_id', themeId)
    .maybeSingle();

  if (existing) {
    await supabase.from('player_jokers').delete().eq('id', existing.id);
    return false;
  } else {
    await supabase.from('player_jokers').insert({
      session_id: sessionId,
      player_id: playerId,
      theme_id: themeId,
    });
    return true;
  }
}

export async function submitDemoAnswer(
  sessionId: string,
  playerId: string,
  themeId: string,
  slideId: string,
  answerText: string,
  isCorrect: boolean = false,
  awardedPoints: number = 0
): Promise<Answer> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const existingIdx = db.answers.findIndex(
      (a) => a.session_id === sessionId && a.player_id === playerId && a.slide_id === slideId
    );
    const ans: Answer = {
      id: existingIdx >= 0 ? db.answers[existingIdx].id : crypto.randomUUID(),
      session_id: sessionId,
      player_id: playerId,
      theme_id: themeId,
      slide_id: slideId,
      answer_text: answerText,
      is_correct: isCorrect,
      awarded_points: awardedPoints,
      graded: false,
      created_at: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      db.answers[existingIdx] = ans;
    } else {
      db.answers.push(ans);
    }
    saveDemoDb(db);
    notifyDemoUpdate('ANSWERS_UPDATED', sessionId);
    return ans;
  }

  const { data, error } = await supabase
    .from('answers')
    .upsert(
      {
        session_id: sessionId,
        player_id: playerId,
        theme_id: themeId,
        slide_id: slideId,
        answer_text: answerText,
        is_correct: isCorrect,
        awarded_points: awardedPoints,
        graded: false,
      },
      { onConflict: 'session_id,player_id,slide_id' }
    )
    .select('*')
    .single();

  if (error) throw error;
  return data as Answer;
}

/**
 * Posodobi ali ustvari ocenjen odgovor za določenega igralca na določenem slajdu.
 */
export async function upsertGradedAnswer(
  sessionId: string,
  playerId: string,
  themeId: string,
  slideId: string,
  answerText: string,
  isCorrect: boolean,
  awardedPoints: number
): Promise<Answer> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const existingIdx = db.answers.findIndex(
      (a) => a.session_id === sessionId && a.player_id === playerId && a.slide_id === slideId
    );
    const ans: Answer = {
      id: existingIdx >= 0 ? db.answers[existingIdx].id : crypto.randomUUID(),
      session_id: sessionId,
      player_id: playerId,
      theme_id: themeId,
      slide_id: slideId,
      answer_text: answerText,
      is_correct: isCorrect,
      awarded_points: Number(awardedPoints),
      graded: true,
      created_at: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      db.answers[existingIdx] = ans;
    } else {
      db.answers.push(ans);
    }
    saveDemoDb(db);
    notifyDemoUpdate('ANSWERS_UPDATED', sessionId);
    return ans;
  }

  const { data, error } = await supabase
    .from('answers')
    .upsert(
      {
        session_id: sessionId,
        player_id: playerId,
        theme_id: themeId,
        slide_id: slideId,
        answer_text: answerText,
        is_correct: isCorrect,
        awarded_points: Number(awardedPoints),
        graded: true,
      },
      { onConflict: 'session_id,player_id,slide_id' }
    )
    .select('*')
    .single();

  if (error) throw error;
  return data as Answer;
}

/**
 * Avtomatsko pred-oceni vse oddane odgovore za dano tematiko:
 * - multiple_choice: primerja answer_text === correct_answer
 * - closest_number: izračuna |odgovor_igralca - correct_answer| in označi najbližjega (ali več ob izenačenju) kot pravilnega
 * - open_text: če še ni ocenjen, preveri ujemanje besedila (brez velikih/malih črk)
 */
export async function autoPreGradeTheme(
  sessionId: string,
  themeId: string,
  slides: Slide[],
  existingAnswers: Answer[]
): Promise<void> {
  const questionSlides = slides.filter(
    (s) =>
      s.slide_type === 'multiple_choice' ||
      s.slide_type === 'closest_number' ||
      s.slide_type === 'open_text'
  );

  const updatesToSave: Array<{
    playerId: string;
    slideId: string;
    answerText: string;
    isCorrect: boolean;
    awardedPoints: number;
  }> = [];

  for (const slide of questionSlides) {
    const slideAnswers = existingAnswers.filter((a) => a.slide_id === slide.id);
    if (slideAnswers.length === 0) continue;

    const correctRaw = (slide.correct_answer || '').trim();
    const maxPts = Number(slide.points ?? 1);

    if (slide.slide_type === 'multiple_choice') {
      for (const ans of slideAnswers) {
        if (ans.graded) continue;
        const isMatch =
          correctRaw !== '' &&
          ans.answer_text.trim().toUpperCase() === correctRaw.toUpperCase();
        updatesToSave.push({
          playerId: ans.player_id,
          slideId: slide.id,
          answerText: ans.answer_text,
          isCorrect: isMatch,
          awardedPoints: isMatch ? maxPts : 0,
        });
      }
    } else if (slide.slide_type === 'closest_number') {
      const targetNum = parseFloat(correctRaw.replace(',', '.'));
      if (!Number.isNaN(targetNum)) {
        // Izračunaj absolutno razliko |odgovor_igralca - correct_answer| za vse veljavne številske odgovore
        const diffs: Array<{ ans: Answer; diff: number }> = [];
        for (const ans of slideAnswers) {
          const val = parseFloat(ans.answer_text.trim().replace(',', '.'));
          if (!Number.isNaN(val)) {
            diffs.push({ ans, diff: Math.abs(val - targetNum) });
          } else if (!ans.graded) {
            updatesToSave.push({
              playerId: ans.player_id,
              slideId: slide.id,
              answerText: ans.answer_text,
              isCorrect: false,
              awardedPoints: 0,
            });
          }
        }

        if (diffs.length > 0) {
          const minDiff = Math.min(...diffs.map((d) => d.diff));
          for (const { ans, diff } of diffs) {
            if (ans.graded) continue;
            const isWinner = Math.abs(diff - minDiff) < 1e-9;
            updatesToSave.push({
              playerId: ans.player_id,
              slideId: slide.id,
              answerText: ans.answer_text,
              isCorrect: isWinner,
              awardedPoints: isWinner ? maxPts : 0,
            });
          }
        }
      }
    } else if (slide.slide_type === 'open_text') {
      for (const ans of slideAnswers) {
        if (ans.graded) continue;
        const isExact =
          correctRaw !== '' &&
          ans.answer_text.trim().toLowerCase() === correctRaw.toLowerCase();
        updatesToSave.push({
          playerId: ans.player_id,
          slideId: slide.id,
          answerText: ans.answer_text,
          isCorrect: isExact,
          awardedPoints: isExact ? maxPts : 0,
        });
      }
    }
  }

  for (const item of updatesToSave) {
    await upsertGradedAnswer(
      sessionId,
      item.playerId,
      themeId,
      item.slideId,
      item.answerText,
      item.isCorrect,
      item.awardedPoints
    );
  }
}

/**
 * Potrdi ocene za tematiko, izračuna skupne točke vseh igralcev (upošteva 2x Joker za vsako temo!)
 * in prestavi status seje v 'leaderboard'.
 */
export async function confirmThemeGradesAndShowLeaderboard(
  sessionId: string
): Promise<void> {
  const presData = await fetchPresentationData(sessionId);
  const { players, answers, playerJokers } = presData;

  // Zgradi množico Jokerjev: ključ `${player_id}_${theme_id}`
  const jokerSet = new Set(
    playerJokers.map((pj) => `${pj.player_id}_${pj.theme_id}`)
  );

  // Za vsakega igralca izračunamo točke po vseh tematikah:
  // Če je v določeni temi uporabil Jokerja, se vsota točk tiste teme pomnoži z 2!
  const newScoresByPlayer: Record<string, number> = {};
  for (const p of players) {
    newScoresByPlayer[p.id] = 0;
  }

  // Grupiraj odgovore po igralcu in temi
  const playerThemeSums: Record<string, Record<string, number>> = {};
  for (const ans of answers) {
    const pts = Number(ans.awarded_points ?? 0);
    if (!playerThemeSums[ans.player_id]) {
      playerThemeSums[ans.player_id] = {};
    }
    playerThemeSums[ans.player_id][ans.theme_id] =
      (playerThemeSums[ans.player_id][ans.theme_id] || 0) + pts;
  }

  for (const player of players) {
    const themeSums = playerThemeSums[player.id] || {};
    let total = 0;
    for (const [tId, themeSum] of Object.entries(themeSums)) {
      const hasJoker = jokerSet.has(`${player.id}_${tId}`);
      total += hasJoker ? themeSum * 2 : themeSum;
    }
    newScoresByPlayer[player.id] = Math.round(total * 100) / 100;
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    for (const p of db.players) {
      if (p.session_id === sessionId && newScoresByPlayer[p.id] !== undefined) {
        p.total_score = newScoresByPlayer[p.id];
      }
    }
    for (const a of db.answers) {
      if (a.session_id === sessionId) {
        a.graded = true;
      }
    }
    const sIdx = db.game_sessions.findIndex((s) => s.id === sessionId);
    if (sIdx >= 0) {
      db.game_sessions[sIdx].status = 'leaderboard';
      db.game_sessions[sIdx].timer_started_at = null;
      db.game_sessions[sIdx].timer_duration = 0;
    }
    saveDemoDb(db);
    notifyDemoUpdate('LEADERBOARD_UPDATED', sessionId);
    return;
  }

  // Posodobi total_score za vsakega igralca v Supabase
  await Promise.all(
    players.map((p) =>
      supabase
        .from('players')
        .update({ total_score: newScoresByPlayer[p.id] ?? 0 })
        .eq('id', p.id)
    )
  );

  // Prestavi status seje v 'leaderboard'
  await supabase
    .from('game_sessions')
    .update({
      status: 'leaderboard',
      timer_started_at: null,
      timer_duration: 0,
    })
    .eq('id', sessionId);
}

// -----------------------------------------------------------------------------
// FAZA 4: PLAYER VIEW FUNCTIONS (/play)
// -----------------------------------------------------------------------------

/**
 * Poišče aktivno sejo glede na 4-mestno kodo sobe.
 */
export async function findSessionByRoomCode(roomCode: string): Promise<GameSession | null> {
  const cleanCode = roomCode.trim().toUpperCase();
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    return db.game_sessions.find((s) => s.room_code.toUpperCase() === cleanCode) || null;
  }

  const { data, error } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('room_code', cleanCode)
    .maybeSingle();

  if (error || !data) return null;
  return data as GameSession;
}

/**
 * Registracija/vstop tekmovalca v sejo. Ustvari nov `reconnect_token` in nastavi `jokers_remaining` glede na kviz.
 */
export async function joinSessionAsPlayer(sessionId: string, nickname: string): Promise<Player> {
  const cleanNick = nickname.trim() || 'Neznani tekmovalec';
  const reconnectToken = crypto.randomUUID();
  const supabase = getSupabaseClient();

  if (!supabase) {
    const db = getInitialDemoDb();
    const session = db.game_sessions.find((s) => s.id === sessionId);
    const quiz = session ? db.quizzes.find((q) => q.id === session.quiz_id) : null;
    const initialJokers = quiz ? quiz.max_jokers_per_player : 1;

    const newPlayer: Player = {
      id: crypto.randomUUID(),
      session_id: sessionId,
      nickname: cleanNick,
      reconnect_token: reconnectToken,
      total_score: 0,
      jokers_remaining: initialJokers,
      created_at: new Date().toISOString(),
    };
    db.players.push(newPlayer);
    saveDemoDb(db);
    notifyDemoUpdate('PLAYERS_UPDATED', sessionId);
    return newPlayer;
  }

  // Preberi začetno število Jokerjev iz kviza
  let initialJokers = 1;
  const { data: sData } = await supabase
    .from('game_sessions')
    .select('quiz_id')
    .eq('id', sessionId)
    .single();

  if (sData?.quiz_id) {
    const { data: qData } = await supabase
      .from('quizzes')
      .select('max_jokers_per_player')
      .eq('id', sData.quiz_id)
      .single();
    if (qData?.max_jokers_per_player !== undefined) {
      initialJokers = qData.max_jokers_per_player;
    }
  }

  const { data: created, error } = await supabase
    .from('players')
    .insert({
      session_id: sessionId,
      nickname: cleanNick,
      reconnect_token: reconnectToken,
      total_score: 0,
      jokers_remaining: initialJokers,
    })
    .select('*')
    .single();

  if (error || !created) throw error || new Error('Napaka pri vstopu v igro.');
  return created as Player;
}

/**
 * Reconnect mehanizem: Preveri obstoječi token v localStorage in vrne igralca brez ponovnega vpisa.
 */
export async function reconnectPlayer(
  sessionId: string,
  playerId: string,
  reconnectToken: string
): Promise<Player | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const p = db.players.find(
      (pl) =>
        pl.id === playerId &&
        pl.session_id === sessionId &&
        pl.reconnect_token === reconnectToken
    );
    return p || null;
  }

  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .eq('session_id', sessionId)
    .eq('reconnect_token', reconnectToken)
    .maybeSingle();

  if (error || !data) return null;
  return data as Player;
}

export type { PlayerFullData };

/**
 * Naloži vse podatke za igralca (trenutni slajd, dovoljeni odprti slajdi znotraj teme, odgovori in lestvica).
 */
export async function fetchPlayerGameData(
  sessionId: string,
  playerId: string
): Promise<PlayerFullData> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    const db = getInitialDemoDb();
    const player = db.players.find((p) => p.id === playerId);
    const session = db.game_sessions.find((s) => s.id === sessionId);
    if (!player || !session) throw new Error('Seja ali igralec ne obstaja.');

    const quiz = db.quizzes.find((q) => q.id === session.quiz_id);
    if (!quiz) throw new Error('Kviz ne obstaja.');

    const themes = db.themes
      .filter((t) => t.quiz_id === quiz.id)
      .sort((a, b) => a.order_index - b.order_index);

    const slidesByTheme: Record<string, Slide[]> = {};
    for (const t of themes) {
      slidesByTheme[t.id] = db.slides
        .filter((s) => s.theme_id === t.id)
        .sort((a, b) => a.order_index - b.order_index)
        .map((s) => ({
          ...s,
          options: normalizeOptions(s.options),
          points: Number(s.points ?? 1),
          timer_seconds: Number(s.timer_seconds ?? 0),
        }));
    }

    const currentTheme = themes.find((t) => t.id === session.current_theme_id) || themes[0] || null;
    const currentThemeSlides = currentTheme ? slidesByTheme[currentTheme.id] || [] : [];
    const currentSlide =
      currentThemeSlides.find((s) => s.id === session.current_slide_id) ||
      currentThemeSlides[0] ||
      null;

    const playerJokers = db.player_jokers.filter(
      (pj) => pj.session_id === sessionId && pj.player_id === playerId
    );

    const myAnswersList = db.answers.filter(
      (a) => a.session_id === sessionId && a.player_id === playerId
    );
    const myAnswers: Record<string, Answer> = {};
    for (const a of myAnswersList) {
      myAnswers[a.slide_id] = a;
    }

    const sortedPlayers = [...db.players.filter((p) => p.session_id === sessionId)].sort(
      (a, b) => b.total_score - a.total_score
    );
    const leaderboard = sortedPlayers.map((p, idx) => ({
      id: p.id,
      nickname: p.nickname,
      total_score: p.total_score,
      rank: idx + 1,
    }));

    return {
      player,
      session,
      quiz,
      themes,
      slidesByTheme,
      currentTheme,
      currentSlide,
      playerJokers,
      myAnswers,
      leaderboard,
    };
  }

  // Supabase klici
  const { data: player, error: pErr } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .single();

  if (pErr || !player) throw pErr || new Error('Igralec ni bil najden.');

  const { data: session, error: sErr } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (sErr || !session) throw sErr || new Error('Seja ni bila najdena.');

  const { data: quiz, error: qErr } = await supabase
    .from('quizzes')
    .select('*')
    .eq('id', session.quiz_id)
    .single();

  if (qErr || !quiz) throw qErr || new Error('Kviz ni bil najden.');

  const { data: themesData } = await supabase
    .from('themes')
    .select('*')
    .eq('quiz_id', quiz.id)
    .order('order_index', { ascending: true });

  const themes = (themesData || []) as Theme[];
  const slidesByTheme: Record<string, Slide[]> = {};
  for (const t of themes) {
    slidesByTheme[t.id] = [];
  }

  if (themes.length > 0) {
    const themeIds = themes.map((t) => t.id);
    const { data: slidesData } = await supabase
      .from('slides')
      .select('*')
      .in('theme_id', themeIds)
      .order('order_index', { ascending: true });

    for (const raw of slidesData || []) {
      const slide: Slide = {
        id: raw.id,
        theme_id: raw.theme_id,
        order_index: raw.order_index,
        slide_image_url: raw.slide_image_url,
        slide_type: raw.slide_type as SlideType,
        question_text: raw.question_text || '',
        options: normalizeOptions(raw.options),
        correct_answer: raw.correct_answer || '',
        points: Number(raw.points ?? 1),
        timer_seconds: Number(raw.timer_seconds ?? 0),
      };
      if (!slidesByTheme[slide.theme_id]) slidesByTheme[slide.theme_id] = [];
      slidesByTheme[slide.theme_id].push(slide);
    }
  }

  const currentTheme = themes.find((t) => t.id === session.current_theme_id) || themes[0] || null;
  const currentThemeSlides = currentTheme ? slidesByTheme[currentTheme.id] || [] : [];
  const currentSlide =
    currentThemeSlides.find((s) => s.id === session.current_slide_id) ||
    currentThemeSlides[0] ||
    null;

  const { data: playerJokersData } = await supabase
    .from('player_jokers')
    .select('*')
    .eq('session_id', sessionId)
    .eq('player_id', playerId);

  const { data: myAnswersData } = await supabase
    .from('answers')
    .select('*')
    .eq('session_id', sessionId)
    .eq('player_id', playerId);

  const myAnswers: Record<string, Answer> = {};
  for (const a of myAnswersData || []) {
    myAnswers[a.slide_id] = a as Answer;
  }

  const { data: allPlayersData } = await supabase
    .from('players')
    .select('id, nickname, total_score')
    .eq('session_id', sessionId)
    .order('total_score', { ascending: false });

  const leaderboard = (allPlayersData || []).map((p, idx) => ({
    id: p.id,
    nickname: p.nickname,
    total_score: Number(p.total_score ?? 0),
    rank: idx + 1,
  }));

  return {
    player: player as Player,
    session: session as GameSession,
    quiz: quiz as Quiz,
    themes,
    slidesByTheme,
    currentTheme,
    currentSlide,
    playerJokers: (playerJokersData || []) as PlayerJoker[],
    myAnswers,
    leaderboard,
  };
}

/**
 * Aktivacija Jokerja s strani tekmovalca (samo v stanju 'theme_intro').
 * Zmanjša jokers_remaining za 1 in doda zapis v player_jokers.
 */
export async function playerActivateJoker(
  sessionId: string,
  playerId: string,
  themeId: string
): Promise<{ success: boolean; jokersRemaining: number }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const db = getInitialDemoDb();
    const player = db.players.find((p) => p.id === playerId);
    if (!player) return { success: false, jokersRemaining: 0 };

    const alreadyUsed = db.player_jokers.some(
      (pj) => pj.session_id === sessionId && pj.player_id === playerId && pj.theme_id === themeId
    );
    if (alreadyUsed) {
      return { success: true, jokersRemaining: player.jokers_remaining };
    }

    if (player.jokers_remaining <= 0) {
      return { success: false, jokersRemaining: 0 };
    }

    player.jokers_remaining -= 1;
    db.player_jokers.push({
      id: crypto.randomUUID(),
      session_id: sessionId,
      player_id: playerId,
      theme_id: themeId,
      created_at: new Date().toISOString(),
    });
    saveDemoDb(db);
    notifyDemoUpdate('JOKER_UPDATED', sessionId);
    return { success: true, jokersRemaining: player.jokers_remaining };
  }

  // Preveri obstoj Jokerja za to temo
  const { data: existing } = await supabase
    .from('player_jokers')
    .select('id')
    .eq('session_id', sessionId)
    .eq('player_id', playerId)
    .eq('theme_id', themeId)
    .maybeSingle();

  if (existing) {
    const { data: pData } = await supabase
      .from('players')
      .select('jokers_remaining')
      .eq('id', playerId)
      .single();
    return { success: true, jokersRemaining: pData?.jokers_remaining ?? 0 };
  }

  // Pridobi preostalo število Jokerjev
  const { data: p } = await supabase
    .from('players')
    .select('jokers_remaining')
    .eq('id', playerId)
    .single();

  const remaining = p?.jokers_remaining ?? 0;
  if (remaining <= 0) {
    return { success: false, jokersRemaining: 0 };
  }

  // Ustvari zapis v player_jokers in zmanjšaj jokers_remaining
  await supabase.from('player_jokers').insert({
    session_id: sessionId,
    player_id: playerId,
    theme_id: themeId,
  });

  const nextRemaining = remaining - 1;
  await supabase
    .from('players')
    .update({ jokers_remaining: nextRemaining })
    .eq('id', playerId);

  return { success: true, jokersRemaining: nextRemaining };
}

/**
 * Tekmovalec odda ali popravi svoj odgovor na trenutni ali pretekli slajd.
 */
export async function savePlayerAnswer(
  sessionId: string,
  playerId: string,
  themeId: string,
  slideId: string,
  answerText: string
): Promise<Answer> {
  const cleanAns = answerText.trim();
  const supabase = getSupabaseClient();

  if (!supabase) {
    const db = getInitialDemoDb();
    const existingIdx = db.answers.findIndex(
      (a) => a.session_id === sessionId && a.player_id === playerId && a.slide_id === slideId
    );
    const ans: Answer = {
      id: existingIdx >= 0 ? db.answers[existingIdx].id : crypto.randomUUID(),
      session_id: sessionId,
      player_id: playerId,
      theme_id: themeId,
      slide_id: slideId,
      answer_text: cleanAns,
      is_correct: false,
      awarded_points: 0,
      graded: false,
      created_at: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      db.answers[existingIdx] = ans;
    } else {
      db.answers.push(ans);
    }
    saveDemoDb(db);
    notifyDemoUpdate('ANSWERS_UPDATED', sessionId);
    return ans;
  }

  const { data, error } = await supabase
    .from('answers')
    .upsert(
      {
        session_id: sessionId,
        player_id: playerId,
        theme_id: themeId,
        slide_id: slideId,
        answer_text: cleanAns,
        graded: false,
      },
      { onConflict: 'session_id,player_id,slide_id' }
    )
    .select('*')
    .single();

  if (error || !data) throw error || new Error('Napaka pri shranjevanju odgovora.');
  return data as Answer;
}


