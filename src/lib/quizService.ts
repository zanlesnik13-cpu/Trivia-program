import { compressImageBlobToDataUrl } from './pdfConverter';
import { generateSlideSvgDataUrl } from './demoQuiz';
import { requireSupabaseClient } from './supabase';
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(val: string | undefined | null): boolean {
  if (!val || typeof val !== 'string') return false;
  return UUID_REGEX.test(val.trim());
}

export function ensureValidUuid(val?: string | null): string {
  if (val && isValidUuid(val)) {
    return val.trim();
  }
  return crypto.randomUUID();
}

export function getValidUuidHostId(rawHostId?: string): string {
  if (rawHostId && isValidUuid(rawHostId)) {
    return rawHostId.trim();
  }
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('guest_host_id');
    if (stored && isValidUuid(stored)) {
      return stored.trim();
    }
  }
  const newUuid = crypto.randomUUID();
  if (typeof window !== 'undefined') {
    localStorage.setItem('guest_host_id', newUuid);
  }
  return newUuid;
}

// Ohranjamo prazno naročnino zaradi kompatibilnosti uvozov v komponentah
export function subscribeToDemoUpdates(_callback: (event: { type: string; sessionId?: string }) => void) {
  return () => {};
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

/**
 * Izpiše podrobno Supabase napako z vsemi zahtevanimi polji:
 * error.message + error.details + error.hint + error.code
 */
export function formatSupabaseError(err: unknown, context: string): Error {
  if (err && typeof err === 'object') {
    const obj = err as { code?: string; message?: string; details?: string; hint?: string };
    const codeStr = obj.code ? `[Koda: ${obj.code}] ` : '';
    const msgStr = obj.message || 'Neznana Supabase napaka.';
    const detailsStr = obj.details ? `\n• Podrobnosti (details): ${obj.details}` : '';
    const hintStr = obj.hint ? `\n• Namig (hint): ${obj.hint}` : '';

    let extraHelp = '';
    if (obj.code === '23503' && msgStr.includes('quizzes_host_id_fkey')) {
      extraHelp =
        '\n• REŠITEV: Tabela "quizzes" ima še vedno staro omejitev FOREIGN KEY na auth.users. Odprite "SQL Skripta & Supabase" v zgornjem meniju in v Supabase SQL Editorju poženite kratko popravljalno SQL skripto!';
    } else if (obj.code === '42501') {
      extraHelp =
        '\n• REŠITEV: Dostop zavrnjen zaradi RLS politik (Row Level Security). Odprite "SQL Skripta & Supabase" in v Supabase SQL Editorju poženite kratko popravljalno SQL skripto za izklop RLS!';
    } else if (obj.code === '22P02') {
      extraHelp =
        '\n• REŠITEV: Neveljaven UUID format v enem izmed ID polj (invalid input syntax for type uuid).';
    }

    return new Error(`${context}\n• Napaka (message): ${codeStr}${msgStr}${detailsStr}${hintStr}${extraHelp}`);
  }
  if (err instanceof Error) return err;
  return new Error(`${context}: Neznana napaka pri komunikaciji s Supabase.`);
}

// -----------------------------------------------------------------------------
// KVIZI, TEMATIKE IN SLAJDI (100% SUPABASE BREZ LOCALSTORAGE FALLBACKA)
// -----------------------------------------------------------------------------

/**
 * Shrani celoten kviz (quizzes), njegove tematike (themes) in vse slajde (slides)
 * z operacijo UPSERT neposredno v Supabase bazo.
 * Vsi ID-ji so zagotovljeno veljavni UUID-ji, poslani so samo stolpci iz SQL sheme.
 */
export async function upsertFullQuiz(
  quiz: Quiz,
  themes: Theme[],
  slidesByTheme: Record<string, Slide[]>,
  hostId?: string
): Promise<Quiz> {
  const supabase = requireSupabaseClient();

  const validQuizId = ensureValidUuid(quiz.id);
  const effectiveHostId = getValidUuidHostId(hostId || quiz.host_id);

  // 1. Upsert v tabelo quizzes — SAMO stolpci iz SQL sheme: id, host_id, title, max_jokers_per_player
  const { data: savedQuiz, error: quizErr } = await supabase
    .from('quizzes')
    .upsert(
      {
        id: validQuizId,
        host_id: effectiveHostId,
        title: (quiz.title || 'Moj Pub Kviz').trim(),
        max_jokers_per_player: Number(quiz.max_jokers_per_player ?? 1),
      },
      { onConflict: 'id' }
    )
    .select('*')
    .single();

  if (quizErr || !savedQuiz) {
    throw formatSupabaseError(quizErr, 'KORAK 1 SPODLETEL — Zapis v tabelo "quizzes"');
  }

  // Pripravi preslikavo starih theme.id v veljavne UUID-je
  const themeIdMap = new Map<string, string>();
  const cleanThemesPayload = themes.map((t, idx) => {
    const cleanThemeId = ensureValidUuid(t.id);
    themeIdMap.set(t.id, cleanThemeId);
    return {
      id: cleanThemeId,
      quiz_id: validQuizId,
      title: (t.title || `${idx + 1}. sklop`).trim(),
      order_index: typeof t.order_index === 'number' ? t.order_index : idx,
    };
  });

  // 2. Upsert v tabelo themes — SAMO stolpci iz SQL sheme: id, quiz_id, title, order_index
  if (cleanThemesPayload.length > 0) {
    const { error: themesErr } = await supabase
      .from('themes')
      .upsert(cleanThemesPayload, { onConflict: 'id' });

    if (themesErr) {
      throw formatSupabaseError(themesErr, 'KORAK 2 SPODLETEL — Zapis tematik v tabelo "themes"');
    }
  }

  // 3. Upsert v tabelo slides — SAMO stolpci iz SQL sheme:
  // id, theme_id, order_index, slide_image_url, slide_type, question_text, options, correct_answer, points, timer_seconds
  const cleanSlidesPayload: Array<{
    id: string;
    theme_id: string;
    order_index: number;
    slide_image_url: string | null;
    slide_type: SlideType;
    question_text: string;
    options: SlideOptions;
    correct_answer: string;
    points: number;
    timer_seconds: number;
  }> = [];

  for (const theme of themes) {
    const cleanThemeId = themeIdMap.get(theme.id) || ensureValidUuid(theme.id);
    const tSlides = slidesByTheme[theme.id] || [];
    tSlides.forEach((s, idx) => {
      const cleanSlideId = ensureValidUuid(s.id);
      const slideType: SlideType = s.slide_type || 'multiple_choice';
      cleanSlidesPayload.push({
        id: cleanSlideId,
        theme_id: cleanThemeId,
        order_index: typeof s.order_index === 'number' ? s.order_index : idx,
        slide_image_url: s.slide_image_url ?? null,
        slide_type: slideType,
        question_text: s.question_text ?? '',
        options: normalizeOptions(s.options),
        correct_answer: s.correct_answer ?? '',
        points: Number(
          s.points ?? (slideType === 'theme_intro' || slideType === 'info_only' ? 0 : 1)
        ),
        timer_seconds: Number(s.timer_seconds ?? 0),
      });
    });
  }

  if (cleanSlidesPayload.length > 0) {
    const { error: slidesErr } = await supabase
      .from('slides')
      .upsert(cleanSlidesPayload, { onConflict: 'id' });

    if (slidesErr) {
      throw formatSupabaseError(slidesErr, 'KORAK 3 SPODLETEL — Zapis slajdov v tabelo "slides"');
    }
  }

  return savedQuiz as Quiz;
}

/**
 * Preveri, da je kviz s tematikami in slajdi dejansko zapisan v Supabase bazi,
 * preden se v tabeli game_sessions ustvari nova seja.
 */
export async function ensureQuizSyncedToSupabase(quizId: string, _hostId?: string): Promise<void> {
  const supabase = requireSupabaseClient();

  if (!isValidUuid(quizId)) {
    throw new Error(
      `Neveljaven UUID format za quiz_id ("${quizId}"). Prosimo, ustvarite nov kviz ali kliknite "🎲 Ustvari Demo Kviz za testiranje".`
    );
  }

  const { data: existingQuiz, error: checkErr } = await supabase
    .from('quizzes')
    .select('id, title')
    .eq('id', quizId)
    .maybeSingle();

  if (checkErr) {
    throw formatSupabaseError(checkErr, 'KORAK 1 SPODLETEL — Preverjanje kviza v tabeli "quizzes"');
  }

  if (!existingQuiz) {
    throw new Error(
      `Kviz z ID-jem "${quizId}" ne obstaja v Supabase tabeli "quizzes"! Kliknite "🎲 Ustvari Demo Kviz za testiranje" ali ustvarite nov kviz, da se zapiše v Supabase.`
    );
  }

  // Poskrbi tudi, da imajo vsi slajdi tega kviza v Supabase lepo generirano SVG sliko, če še nimajo svoje slike
  const { data: themesData, error: themesErr } = await supabase
    .from('themes')
    .select('*')
    .eq('quiz_id', quizId)
    .order('order_index', { ascending: true });

  if (themesErr) {
    throw formatSupabaseError(themesErr, 'KORAK 2 SPODLETEL — Preverjanje tematik v tabeli "themes"');
  }

  const themes = (themesData || []) as Theme[];
  if (themes.length === 0) {
    throw new Error(
      `Kviz "${existingQuiz.title}" nima nobene tematike v tabeli "themes". Odprite "Uredi kviz" in dodajte vsaj eno tematiko.`
    );
  }

  const themeIds = themes.map((t) => t.id);
  const { data: slidesData, error: slidesErr } = await supabase
    .from('slides')
    .select('*')
    .in('theme_id', themeIds)
    .order('order_index', { ascending: true });

  if (slidesErr) {
    throw formatSupabaseError(slidesErr, 'KORAK 3 SPODLETEL — Preverjanje slajdov v tabeli "slides"');
  }

  const slides = (slidesData || []) as Slide[];
  const slidesMissingImages = slides.filter((s) => !s.slide_image_url);
  if (slidesMissingImages.length > 0) {
    const themeMap = new Map(themes.map((t) => [t.id, t]));
    for (const s of slidesMissingImages) {
      const t = themeMap.get(s.theme_id);
      const isIntro = s.slide_type === 'theme_intro';
      const imgUrl = generateSlideSvgDataUrl({
        badge: isIntro
          ? `${(t?.title || 'TEMATIKA').toUpperCase()} • JOKER`
          : `VPRAŠANJE #${s.order_index + 1}`,
        title: s.question_text || (isIntro ? t?.title || 'Uvod v sklop' : `Vprašanje #${s.order_index + 1}`),
        type: s.slide_type,
        options: s.slide_type === 'multiple_choice' ? normalizeOptions(s.options) : undefined,
        points: Number(s.points ?? 1),
        timerSeconds: Number(s.timer_seconds ?? 0),
        accentColor: isIntro ? '#f59e0b' : '#6366f1',
      });

      const { error: updErr } = await supabase
        .from('slides')
        .update({ slide_image_url: imgUrl })
        .eq('id', s.id);

      if (updErr) {
        throw formatSupabaseError(updErr, 'Napaka pri posodabljanju grafike slajda v tabeli "slides"');
      }
    }
  }
}

export async function fetchHostQuizzes(_hostId: string): Promise<QuizWithStats[]> {
  const supabase = requireSupabaseClient();

  // Preberi vse kvize v Supabase bazi (tako za trenutnega gostitelja kot za gostujoči/demo način)
  const { data: quizzes, error } = await supabase
    .from('quizzes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw formatSupabaseError(error, 'Napaka pri branju tabele "quizzes" iz Supabase');
  }

  const finalQuizzes = (quizzes || []) as Quiz[];
  if (finalQuizzes.length === 0) {
    return [];
  }

  const quizIds = finalQuizzes.map((q) => q.id);
  const { data: themes, error: tErr } = await supabase
    .from('themes')
    .select('id, quiz_id')
    .in('quiz_id', quizIds);

  if (tErr) {
    throw formatSupabaseError(tErr, 'Napaka pri branju tabele "themes" iz Supabase');
  }

  const themeList = themes || [];
  const themeIds = themeList.map((t) => t.id);

  let slideList: { id: string; theme_id: string }[] = [];
  if (themeIds.length > 0) {
    const { data: slides, error: sErr } = await supabase
      .from('slides')
      .select('id, theme_id')
      .in('theme_id', themeIds);

    if (sErr) {
      throw formatSupabaseError(sErr, 'Napaka pri branju tabele "slides" iz Supabase');
    }
    slideList = slides || [];
  }

  return finalQuizzes.map((q) => {
    const qThemes = themeList.filter((t) => t.quiz_id === q.id);
    const qThemeIds = new Set(qThemes.map((t) => t.id));
    const qSlides = slideList.filter((s) => qThemeIds.has(s.theme_id));
    return {
      ...q,
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
  const supabase = requireSupabaseClient();
  const effectiveHostId = getValidUuidHostId(hostId);
  const quizId = crypto.randomUUID();
  const themeId = crypto.randomUUID();
  const slideId = crypto.randomUUID();

  // 1. Zapis v quizzes (samo veljavni stolpci)
  const { data: quiz, error } = await supabase
    .from('quizzes')
    .insert({
      id: quizId,
      host_id: effectiveHostId,
      title: title.trim(),
      max_jokers_per_player: Number(maxJokersPerPlayer ?? 1),
    })
    .select('*')
    .single();

  if (error || !quiz) {
    throw formatSupabaseError(error, 'Napaka pri ustvarjanju kviza v tabeli "quizzes"');
  }

  // 2. Zapis uvodne tematike v themes (samo veljavni stolpci)
  const { data: theme, error: themeErr } = await supabase
    .from('themes')
    .insert({
      id: themeId,
      quiz_id: quiz.id,
      title: '1. sklop: Uvodna tema',
      order_index: 0,
    })
    .select('*')
    .single();

  if (themeErr || !theme) {
    throw formatSupabaseError(themeErr, 'Napaka pri ustvarjanju uvodne tematike v tabeli "themes"');
  }

  // 3. Zapis uvodnega slajda v slides (samo veljavni stolpci)
  const introSvg = generateSlideSvgDataUrl({
    badge: '1. SKLOP • JOKER KORAK',
    title: '1. SKLOP: UVODNA TEMA',
    subtitle: 'Pred začetkom sklopa lahko na telefonu aktivirate Jokerja za 2x točke!',
    type: 'theme_intro',
    accentColor: '#f59e0b',
  });

  const { error: slideErr } = await supabase.from('slides').insert({
    id: slideId,
    theme_id: theme.id,
    order_index: 0,
    slide_image_url: introSvg,
    slide_type: 'theme_intro',
    question_text: '1. sklop: Uvodna tema — Pred začetkom sklopa lahko aktivirate Jokerja za dvojne točke!',
    options: { A: '', B: '', C: '', D: '' },
    correct_answer: '',
    points: 0,
    timer_seconds: 0,
  });

  if (slideErr) {
    throw formatSupabaseError(slideErr, 'Napaka pri ustvarjanju uvodnega slajda v tabeli "slides"');
  }

  return quiz as Quiz;
}

export async function updateQuizMeta(
  quizId: string,
  updates: { title?: string; max_jokers_per_player?: number }
): Promise<Quiz> {
  const supabase = requireSupabaseClient();

  const cleanUpdates: Record<string, unknown> = {};
  if (updates.title !== undefined) cleanUpdates.title = updates.title.trim();
  if (updates.max_jokers_per_player !== undefined) {
    cleanUpdates.max_jokers_per_player = Number(updates.max_jokers_per_player);
  }

  const { data, error } = await supabase
    .from('quizzes')
    .update(cleanUpdates)
    .eq('id', quizId)
    .select('*')
    .single();

  if (error || !data) {
    throw formatSupabaseError(error, 'Napaka pri posodabljanju kviza v tabeli "quizzes"');
  }
  return data as Quiz;
}

export async function deleteQuiz(quizId: string): Promise<void> {
  const supabase = requireSupabaseClient();
  const { error } = await supabase.from('quizzes').delete().eq('id', quizId);
  if (error) {
    throw formatSupabaseError(error, 'Napaka pri brisanju kviza iz tabele "quizzes"');
  }
}

export async function fetchQuizDetails(quizId: string): Promise<{
  quiz: Quiz;
  themes: Theme[];
  slidesByTheme: Record<string, Slide[]>;
}> {
  const supabase = requireSupabaseClient();

  const { data: quiz, error: quizErr } = await supabase
    .from('quizzes')
    .select('*')
    .eq('id', quizId)
    .single();

  if (quizErr || !quiz) {
    throw formatSupabaseError(quizErr, `Kviz z ID "${quizId}" ni bil najden v Supabase tabeli "quizzes"`);
  }

  const { data: themesData, error: themesErr } = await supabase
    .from('themes')
    .select('*')
    .eq('quiz_id', quizId)
    .order('order_index', { ascending: true });

  if (themesErr) {
    throw formatSupabaseError(themesErr, 'Napaka pri branju tematik iz tabele "themes"');
  }
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

    if (slidesErr) {
      throw formatSupabaseError(slidesErr, 'Napaka pri branju slajdov iz tabele "slides"');
    }

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
  const supabase = requireSupabaseClient();
  const themeId = crypto.randomUUID();
  const slideId = crypto.randomUUID();

  const { data: themeData, error: themeErr } = await supabase
    .from('themes')
    .insert({
      id: themeId,
      quiz_id: quizId,
      title: title.trim(),
      order_index: orderIndex,
    })
    .select('*')
    .single();

  if (themeErr || !themeData) {
    throw formatSupabaseError(themeErr, 'Napaka pri dodajanju tematike v tabelo "themes"');
  }

  const introSvg = generateSlideSvgDataUrl({
    badge: `${title.toUpperCase()} • JOKER`,
    title: title.toUpperCase(),
    subtitle: 'Pred začetkom sklopa lahko aktivirate Jokerja za dvojne točke!',
    type: 'theme_intro',
    accentColor: '#f59e0b',
  });

  const { data: slideData, error: slideErr } = await supabase
    .from('slides')
    .insert({
      id: slideId,
      theme_id: themeData.id,
      order_index: 0,
      slide_image_url: introSvg,
      slide_type: 'theme_intro',
      question_text: `${title} — Pred začetkom sklopa lahko aktivirate Jokerja za dvojne točke!`,
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '',
      points: 0,
      timer_seconds: 0,
    })
    .select('*')
    .single();

  if (slideErr || !slideData) {
    throw formatSupabaseError(slideErr, 'Napaka pri dodajanju uvodnega slajda v tabelo "slides"');
  }

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
  const supabase = requireSupabaseClient();

  const cleanUpdates: Record<string, unknown> = {};
  if (updates.title !== undefined) cleanUpdates.title = updates.title.trim();
  if (updates.order_index !== undefined) cleanUpdates.order_index = Number(updates.order_index);

  const { data, error } = await supabase
    .from('themes')
    .update(cleanUpdates)
    .eq('id', themeId)
    .select('*')
    .single();

  if (error || !data) {
    throw formatSupabaseError(error, 'Napaka pri posodabljanju tematike v tabeli "themes"');
  }
  return data as Theme;
}

export async function deleteTheme(themeId: string): Promise<void> {
  const supabase = requireSupabaseClient();
  const { error } = await supabase.from('themes').delete().eq('id', themeId);
  if (error) {
    throw formatSupabaseError(error, 'Napaka pri brisanju tematike iz tabele "themes"');
  }
}

export async function createSlide(
  themeId: string,
  payload: Partial<Omit<Slide, 'id' | 'theme_id'>> & { order_index: number }
): Promise<Slide> {
  const supabase = requireSupabaseClient();
  const slideId = crypto.randomUUID();
  const slideType: SlideType = payload.slide_type ?? 'multiple_choice';

  const defaultSlide = {
    id: slideId,
    theme_id: themeId,
    order_index: Number(payload.order_index ?? 0),
    slide_image_url: payload.slide_image_url ?? null,
    slide_type: slideType,
    question_text: payload.question_text ?? '',
    options: normalizeOptions(payload.options),
    correct_answer: payload.correct_answer ?? '',
    points: Number(
      payload.points ?? (slideType === 'theme_intro' || slideType === 'info_only' ? 0 : 1)
    ),
    timer_seconds: Number(payload.timer_seconds ?? 0),
  };

  const { data, error } = await supabase
    .from('slides')
    .insert(defaultSlide)
    .select('*')
    .single();

  if (error || !data) {
    throw formatSupabaseError(error, 'Napaka pri ustvarjanju slajda v tabeli "slides"');
  }
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
  const supabase = requireSupabaseClient();

  // Pošlji SAMO stolpce, ki dejansko obstajajo v tabeli slides
  const cleanUpdates: Record<string, unknown> = {};
  if (updates.order_index !== undefined) cleanUpdates.order_index = Number(updates.order_index);
  if (updates.slide_image_url !== undefined) cleanUpdates.slide_image_url = updates.slide_image_url;
  if (updates.slide_type !== undefined) cleanUpdates.slide_type = updates.slide_type;
  if (updates.question_text !== undefined) cleanUpdates.question_text = updates.question_text;
  if (updates.options !== undefined) cleanUpdates.options = normalizeOptions(updates.options);
  if (updates.correct_answer !== undefined) cleanUpdates.correct_answer = updates.correct_answer;
  if (updates.points !== undefined) cleanUpdates.points = Number(updates.points);
  if (updates.timer_seconds !== undefined) cleanUpdates.timer_seconds = Number(updates.timer_seconds);

  const { data, error } = await supabase
    .from('slides')
    .update(cleanUpdates)
    .eq('id', slideId)
    .select('*')
    .single();

  if (error || !data) {
    throw formatSupabaseError(error, 'Napaka pri shranjevanju slajda v tabelo "slides"');
  }
  return {
    ...(data as Slide),
    options: normalizeOptions(data.options),
    points: Number(data.points ?? 1),
    timer_seconds: Number(data.timer_seconds ?? 0),
  };
}

export async function deleteSlide(slideId: string): Promise<void> {
  const supabase = requireSupabaseClient();
  const { error } = await supabase.from('slides').delete().eq('id', slideId);
  if (error) {
    throw formatSupabaseError(error, 'Napaka pri brisanju slajda iz tabele "slides"');
  }
}

/**
 * Naloži sliko slajda v Supabase Storage bucket 'slides'.
 * Če nalaganje v Storage bucket spodleti, sliko stisne v JPEG Data URL, ki se shrani v `slide_image_url` v Supabase bazi!
 */
export async function uploadSlideImage(
  quizId: string,
  themeId: string,
  blob: Blob,
  fileName: string
): Promise<string> {
  const supabase = requireSupabaseClient();

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
// LIVE GAME SESSIONS, PRESENTATION & CONTROLLER (100% SUPABASE)
// -----------------------------------------------------------------------------

export interface ActiveGameSessionWithQuiz {
  session: GameSession;
  quizTitle: string;
  playerCount: number;
}

/**
 * Ustvari novo živo sejo v Supabase tabeli `game_sessions` s 4-mestno številčno kodo ('room_code') in statusom 'lobby'.
 * Če katerikoli korak vrne napako, se postopek USTAVI in vrže podrobno Supabase napako (message + details + hint).
 */
export async function createLiveGameSession(quizId: string, hostId?: string): Promise<GameSession> {
  const supabase = requireSupabaseClient();

  const generateNumericRoomCode = () => {
    return String(Math.floor(1000 + Math.random() * 9000));
  };

  // KORAK 1: Preveri, da so kviz, tematike in slajdi 100% zapisani v Supabase
  await ensureQuizSyncedToSupabase(quizId, hostId);

  // KORAK 2: Preberi 1. tematiko kviza iz Supabase
  const { data: themes, error: themeError } = await supabase
    .from('themes')
    .select('id, order_index')
    .eq('quiz_id', quizId)
    .order('order_index', { ascending: true })
    .limit(1);

  if (themeError) {
    throw formatSupabaseError(themeError, 'KORAK 2 SPODLETEL — Branje 1. tematike iz tabele "themes"');
  }

  const firstThemeId = themes && themes.length > 0 ? themes[0].id : null;
  let firstSlideId: string | null = null;

  // KORAK 3: Preberi 1. slajd prve tematike iz Supabase
  if (firstThemeId) {
    const { data: slides, error: slideError } = await supabase
      .from('slides')
      .select('id, order_index')
      .eq('theme_id', firstThemeId)
      .order('order_index', { ascending: true })
      .limit(1);

    if (slideError) {
      throw formatSupabaseError(slideError, 'KORAK 3 SPODLETEL — Branje 1. slajda iz tabele "slides"');
    }

    if (slides && slides.length > 0) {
      firstSlideId = slides[0].id;
    }
  }

  // KORAK 4: Vstavi novo sejo v tabelo game_sessions z unikatnim UUID in 4-mestnim room_code
  // Pošljemo SAMO stolpce iz SQL sheme: id, quiz_id, room_code, status, current_theme_id, current_slide_id, max_slide_index_reached, timer_started_at, timer_duration
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const sessionId = crypto.randomUUID();
    const roomCode = generateNumericRoomCode();

    const { data, error } = await supabase
      .from('game_sessions')
      .insert({
        id: sessionId,
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
    const errCode = (error as { code?: string } | null)?.code;
    // Če gre za podvojeno room_code (23505), poskusi znova z novo naključno 4-mestno kodo
    if (errCode === '23505') {
      continue;
    }
    break;
  }

  throw formatSupabaseError(lastError, 'KORAK 4 SPODLETEL — Ustvarjanje seje v tabeli "game_sessions"');
}

/**
 * Vrne vse aktivne (še nezaključene) seje iz Supabase skupaj z imenom kviza in številom igralcev.
 */
export async function fetchHostActiveSessions(
  _hostId: string
): Promise<ActiveGameSessionWithQuiz[]> {
  const supabase = requireSupabaseClient();

  const { data: quizzes, error: qErr } = await supabase
    .from('quizzes')
    .select('id, title');

  if (qErr) {
    throw formatSupabaseError(qErr, 'Napaka pri branju kvizov za aktivne seje');
  }

  if (!quizzes || quizzes.length === 0) {
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

  if (sErr) {
    throw formatSupabaseError(sErr, 'Napaka pri branju aktivnih sej iz tabele "game_sessions"');
  }

  if (!sessions || sessions.length === 0) {
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
  const supabase = requireSupabaseClient();

  const { error } = await supabase
    .from('game_sessions')
    .update({ status: 'finished' })
    .eq('id', sessionId);

  if (error) {
    throw formatSupabaseError(error, 'Napaka pri zaključevanju seje v tabeli "game_sessions"');
  }
}

export async function fetchGameSession(sessionId: string): Promise<GameSession | null> {
  const supabase = requireSupabaseClient();

  const { data, error } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (error || !data) return null;
  return data as GameSession;
}

/**
 * Naloži vse podatke o seji direktno iz Supabase baze za `/present/:sessionId` in `/host-remote/:sessionId`.
 */
export async function fetchPresentationData(sessionId: string): Promise<PresentationData> {
  const supabase = requireSupabaseClient();

  // 1. Preberi sejo direktno iz Supabase: supabase.from('game_sessions').select('*').eq('id', sessionId).single()
  const { data: session, error: sErr } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (sErr || !session) {
    throw formatSupabaseError(
      sErr || new Error(`Seja z ID "${sessionId}" ne obstaja v Supabase tabeli game_sessions.`),
      'Seja v Supabase bazi ni bila najdena'
    );
  }

  // 2. Preberi kviz
  const { data: quiz, error: qErr } = await supabase
    .from('quizzes')
    .select('*')
    .eq('id', session.quiz_id)
    .single();

  if (qErr || !quiz) {
    throw formatSupabaseError(
      qErr || new Error(`Kviz z ID "${session.quiz_id}" ne obstaja v tabeli quizzes.`),
      'Kviz te seje v Supabase bazi ni bil najden'
    );
  }

  // 3. Preberi tematike
  const { data: themesData, error: tErr } = await supabase
    .from('themes')
    .select('*')
    .eq('quiz_id', quiz.id)
    .order('order_index', { ascending: true });

  if (tErr) {
    throw formatSupabaseError(tErr, 'Napaka pri branju tematik seje iz Supabase');
  }
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

    if (slidesErr) {
      throw formatSupabaseError(slidesErr, 'Napaka pri branju slajdov seje iz Supabase');
    }

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
  const supabase = requireSupabaseClient();

  const { data, error } = await supabase
    .from('game_sessions')
    .update(updates)
    .eq('id', sessionId)
    .select('*')
    .single();

  if (error || !data) {
    throw formatSupabaseError(error, 'Napaka pri posodabljanju seje v tabeli "game_sessions"');
  }
  return data as GameSession;
}

export async function addDemoPlayer(
  sessionId: string,
  nickname: string
): Promise<Player> {
  const supabase = requireSupabaseClient();

  const { data, error } = await supabase
    .from('players')
    .insert({
      id: crypto.randomUUID(),
      session_id: sessionId,
      nickname: nickname.trim(),
      reconnect_token: crypto.randomUUID(),
      total_score: 0,
      jokers_remaining: 1,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw formatSupabaseError(error, 'Napaka pri dodajanju igralca v tabelo "players"');
  }
  return data as Player;
}

export async function togglePlayerJoker(
  sessionId: string,
  playerId: string,
  themeId: string
): Promise<boolean> {
  const supabase = requireSupabaseClient();

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
    const { error } = await supabase.from('player_jokers').insert({
      id: crypto.randomUUID(),
      session_id: sessionId,
      player_id: playerId,
      theme_id: themeId,
    });
    if (error) {
      throw formatSupabaseError(error, 'Napaka pri vklopu Jokerja v tabeli "player_jokers"');
    }
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
  const supabase = requireSupabaseClient();

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
        graded: false,
      },
      { onConflict: 'session_id,player_id,slide_id' }
    )
    .select('*')
    .single();

  if (error || !data) {
    throw formatSupabaseError(error, 'Napaka pri oddaji odgovora v tabelo "answers"');
  }
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
  const supabase = requireSupabaseClient();

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

  if (error || !data) {
    throw formatSupabaseError(error, 'Napaka pri ocenjevanju odgovora v tabeli "answers"');
  }
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
        const normAns = ans.answer_text.trim().toUpperCase();
        const normCorrect = correctRaw.toUpperCase();
        const isMatch =
          correctRaw !== '' &&
          (normAns === normCorrect ||
            normCorrect.startsWith(normAns) ||
            normAns.startsWith(normCorrect));
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
  const supabase = requireSupabaseClient();
  const presData = await fetchPresentationData(sessionId);
  const { players, answers, playerJokers } = presData;

  const jokerSet = new Set(
    playerJokers.map((pj) => `${pj.player_id}_${pj.theme_id}`)
  );

  const newScoresByPlayer: Record<string, number> = {};
  for (const p of players) {
    newScoresByPlayer[p.id] = 0;
  }

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
  const { error } = await supabase
    .from('game_sessions')
    .update({
      status: 'leaderboard',
      timer_started_at: null,
      timer_duration: 0,
    })
    .eq('id', sessionId);

  if (error) {
    throw formatSupabaseError(error, 'Napaka pri preklopu seje na lestvico v tabeli "game_sessions"');
  }
}

// -----------------------------------------------------------------------------
// PLAYER VIEW FUNCTIONS (/play) - 100% SUPABASE
// -----------------------------------------------------------------------------

/**
 * Poišče aktivno sejo v Supabase glede na 4-mestno kodo sobe:
 * supabase.from('game_sessions').select('*').eq('room_code', code.trim()).single()
 */
export async function findSessionByRoomCode(roomCode: string): Promise<GameSession | null> {
  const supabase = requireSupabaseClient();
  const cleanCode = roomCode.trim();

  const { data, error } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('room_code', cleanCode)
    .single();

  if (error || !data) return null;
  return data as GameSession;
}

/**
 * Registracija/vstop tekmovalca v sejo. Ustvari nov `reconnect_token` (UUID) in `id` (UUID).
 */
export async function joinSessionAsPlayer(sessionId: string, nickname: string): Promise<Player> {
  const supabase = requireSupabaseClient();
  const cleanNick = nickname.trim() || 'Neznani tekmovalec';
  const playerId = crypto.randomUUID();
  const reconnectToken = crypto.randomUUID();

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
      initialJokers = Number(qData.max_jokers_per_player);
    }
  }

  const { data: created, error } = await supabase
    .from('players')
    .insert({
      id: playerId,
      session_id: sessionId,
      nickname: cleanNick,
      reconnect_token: reconnectToken,
      total_score: 0,
      jokers_remaining: initialJokers,
    })
    .select('*')
    .single();

  if (error || !created) {
    throw formatSupabaseError(error, 'Napaka pri vpisu igralca v Supabase tabelo "players"');
  }
  return created as Player;
}

/**
 * Reconnect mehanizem: Preveri obstoječi token v localStorage in prebere igralca iz Supabase.
 */
export async function reconnectPlayer(
  sessionId: string,
  playerId: string,
  reconnectToken: string
): Promise<Player | null> {
  const supabase = requireSupabaseClient();

  if (!isValidUuid(sessionId) || !isValidUuid(playerId) || !isValidUuid(reconnectToken)) {
    return null;
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
 * Naloži vse podatke za igralca iz Supabase.
 */
export async function fetchPlayerGameData(
  sessionId: string,
  playerId: string
): Promise<PlayerFullData> {
  const supabase = requireSupabaseClient();

  const { data: player, error: pErr } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .single();

  if (pErr || !player) {
    throw formatSupabaseError(pErr, 'Igralec v Supabase bazi ni bil najden');
  }

  const { data: session, error: sErr } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (sErr || !session) {
    throw formatSupabaseError(sErr, 'Seja v Supabase bazi ni bila najdena');
  }

  const { data: quiz, error: qErr } = await supabase
    .from('quizzes')
    .select('*')
    .eq('id', session.quiz_id)
    .single();

  if (qErr || !quiz) {
    throw formatSupabaseError(qErr, 'Kviz v Supabase bazi ni bil najden');
  }

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
 */
export async function playerActivateJoker(
  sessionId: string,
  playerId: string,
  themeId: string
): Promise<{ success: boolean; jokersRemaining: number }> {
  const supabase = requireSupabaseClient();

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

  const { data: p } = await supabase
    .from('players')
    .select('jokers_remaining')
    .eq('id', playerId)
    .single();

  const remaining = p?.jokers_remaining ?? 0;
  if (remaining <= 0) {
    return { success: false, jokersRemaining: 0 };
  }

  const { error: insErr } = await supabase.from('player_jokers').insert({
    id: crypto.randomUUID(),
    session_id: sessionId,
    player_id: playerId,
    theme_id: themeId,
  });

  if (insErr) {
    throw formatSupabaseError(insErr, 'Napaka pri aktivaciji Jokerja v tabeli "player_jokers"');
  }

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
  const supabase = requireSupabaseClient();
  const cleanAns = answerText.trim();

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

  if (error || !data) {
    throw formatSupabaseError(error, 'Napaka pri shranjevanju odgovora v tabelo "answers"');
  }
  return data as Answer;
}

export { createMegaDemoQuiz, generateSlideSvgDataUrl } from './demoQuiz';
