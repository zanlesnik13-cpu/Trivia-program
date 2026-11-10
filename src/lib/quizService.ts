import { getSupabaseClient } from './supabase';
import type {
  GameSession,
  Quiz,
  QuizWithStats,
  Slide,
  SlideOptions,
  SlideType,
  Theme,
} from '../types/quiz';

const DEMO_STORAGE_KEY = 'trivia_demo_data_v1';

interface DemoDatabase {
  quizzes: Quiz[];
  themes: Theme[];
  slides: Slide[];
  game_sessions: GameSession[];
}

function getInitialDemoDb(): DemoDatabase {
  if (typeof window === 'undefined') {
    return { quizzes: [], themes: [], slides: [], game_sessions: [] };
  }
  const raw = localStorage.getItem(DEMO_STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as DemoDatabase;
    } catch {
      // ignore invalid json
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
        question_text: '1. sklop: Film in Pop Kultura — Tukaj lahko aktivirate svojega Jokerja za dvojne točke v tej temi!',
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

  const { data: quizzes, error } = await supabase
    .from('quizzes')
    .select('*')
    .eq('host_id', hostId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  if (!quizzes || quizzes.length === 0) return [];

  const quizIds = quizzes.map((q) => q.id);
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

  return quizzes.map((q) => {
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

  if (error) throw error;

  // Samodejno ustvari 1. tematiko in začetni 'theme_intro' slajd za Jokerja
  const { data: theme } = await supabase
    .from('themes')
    .insert({
      quiz_id: quiz.id,
      title: '1. sklop: Uvodna tema',
      order_index: 0,
    })
    .select('*')
    .single();

  if (theme) {
    await supabase.from('slides').insert({
      theme_id: theme.id,
      order_index: 0,
      slide_type: 'theme_intro',
      question_text: '1. sklop: Uvodna tema — Pred začetkom sklopa lahko aktivirate Jokerja za dvojne točke!',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '',
      points: 0,
      timer_seconds: 0,
    });
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

  if (error) throw error;
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
  if (error) throw error;
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
    .single();

  if (quizErr || !quiz) throw quizErr || new Error('Kviz ni bil najden.');

  const { data: themesData, error: themesErr } = await supabase
    .from('themes')
    .select('*')
    .eq('quiz_id', quizId)
    .order('order_index', { ascending: true });

  if (themesErr) throw themesErr;
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

    if (slidesErr) throw slidesErr;

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

  if (themeErr) throw themeErr;

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

  if (slideErr) throw slideErr;

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

  if (error) throw error;
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
  if (error) throw error;
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

  if (error) throw error;
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

  if (error) throw error;
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
  if (error) throw error;
}

export async function uploadSlideImage(
  quizId: string,
  themeId: string,
  blob: Blob,
  fileName: string
): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    // V Demo načinu pretvorimo sliko v Data URL za takojšnji predogled
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Napaka pri branju slike.'));
      reader.readAsDataURL(blob);
    });
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `${quizId}/${themeId}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from('slides')
    .upload(filePath, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from('slides').getPublicUrl(filePath);
  return data.publicUrl;
}

export async function createLiveGameSession(quizId: string): Promise<GameSession> {
  const generateRoomCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const supabase = getSupabaseClient();
  const roomCode = generateRoomCode();

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
    return session;
  }

  const { data: themes } = await supabase
    .from('themes')
    .select('id, order_index')
    .eq('quiz_id', quizId)
    .order('order_index', { ascending: true })
    .limit(1);

  const firstThemeId = themes && themes.length > 0 ? themes[0].id : null;
  let firstSlideId: string | null = null;

  if (firstThemeId) {
    const { data: slides } = await supabase
      .from('slides')
      .select('id, order_index')
      .eq('theme_id', firstThemeId)
      .order('order_index', { ascending: true })
      .limit(1);
    if (slides && slides.length > 0) {
      firstSlideId = slides[0].id;
    }
  }

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

  if (error) throw error;
  return data as GameSession;
}
