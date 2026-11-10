import { upsertFullQuiz } from './quizService';
import type { Quiz, Slide, SlideType, Theme } from '../types/quiz';

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text: string, maxCharsPerLine: number = 42): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + (currentLine ? ' ' : '') + word).length <= maxCharsPerLine) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

export interface SlideSvgConfig {
  badge: string;
  title: string;
  subtitle?: string;
  type: SlideType;
  options?: { A: string; B: string; C: string; D: string };
  accentColor?: string;
  points?: number;
  timerSeconds?: number;
}

/**
 * Ustvari čudovit 16:9 (1920x1080) SVG Data URL za slajd kviza,
 * optimiziran za TV prezentacije in mobilne naprave (PowerPoint / TV stil).
 */
export function generateSlideSvgDataUrl(config: SlideSvgConfig): string {
  const {
    badge,
    title,
    subtitle,
    type,
    options,
    accentColor = '#6366f1',
    points,
    timerSeconds,
  } = config;

  const titleLines = wrapText(title, type === 'multiple_choice' ? 44 : 38);
  const subtitleLines = subtitle ? wrapText(subtitle, 50) : [];

  const isIntro = type === 'theme_intro';
  const isMultipleChoice = type === 'multiple_choice';

  // Določi začetno navpično pozicijo naslova
  const titleStartY = isMultipleChoice
    ? 380 - (titleLines.length - 1) * 32
    : isIntro
    ? 440 - (titleLines.length - 1) * 40
    : 420 - (titleLines.length - 1) * 36;

  const titleFontSize = isIntro ? 68 : isMultipleChoice ? 50 : 56;
  const titleLineHeight = isIntro ? 84 : isMultipleChoice ? 66 : 74;

  let optionsSvg = '';
  if (isMultipleChoice && options) {
    const choices = [
      { key: 'A', text: options.A, color: '#f43f5e', x: 200, y: 640 },
      { key: 'B', text: options.B, color: '#3b82f6', x: 990, y: 640 },
      { key: 'C', text: options.C, color: '#f59e0b', x: 200, y: 790 },
      { key: 'D', text: options.D, color: '#10b981', x: 990, y: 790 },
    ];

    optionsSvg = choices
      .map(
        (c) => `
      <g transform="translate(${c.x}, ${c.y})">
        <!-- Okvir možnosti -->
        <rect width="730" height="118" rx="22" fill="#1e293b" fill-opacity="0.85" stroke="#334155" stroke-width="2.5"/>
        <rect width="730" height="118" rx="22" fill="none" stroke="${c.color}" stroke-opacity="0.4" stroke-width="1.5"/>
        
        <!-- Oznaka črke A/B/C/D -->
        <rect x="22" y="24" width="70" height="70" rx="18" fill="${c.color}"/>
        <text x="57" y="70" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="34" font-weight="900">${c.key}</text>
        
        <!-- Besedilo možnosti -->
        <text x="114" y="69" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="700">${escapeXml(c.text)}</text>
      </g>
    `
      )
      .join('');
  }

  // Podnaslov ali vnosna navodila
  let subtitleSvg = '';
  if (subtitleLines.length > 0) {
    const subStartY = isIntro
      ? 600
      : isMultipleChoice
      ? 540
      : titleStartY + titleLines.length * titleLineHeight + 40;

    subtitleSvg = `
      <text text-anchor="middle" x="960" y="${subStartY}" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="500">
        ${subtitleLines
          .map(
            (l, idx) =>
              `<tspan x="960" dy="${idx === 0 ? 0 : 44}">${escapeXml(l)}</tspan>`
          )
          .join('')}
      </text>
    `;
  }

  // Info značke na dnu
  let metaBadgesSvg = '';
  if (points !== undefined && points > 0) {
    metaBadgesSvg += `
      <g transform="translate(1620, 960)">
        <rect x="-10" y="-24" width="160" height="48" rx="14" fill="#10b981" fill-opacity="0.2" stroke="#10b981" stroke-width="1.5"/>
        <text x="70" y="8" text-anchor="middle" fill="#34d399" font-family="system-ui, sans-serif" font-size="20" font-weight="800">${points} ${points === 1 ? 'TOČKA' : 'TOČKI'}</text>
      </g>
    `;
  }
  if (timerSeconds !== undefined && timerSeconds > 0) {
    metaBadgesSvg += `
      <g transform="translate(1420, 960)">
        <rect x="-10" y="-24" width="160" height="48" rx="14" fill="#6366f1" fill-opacity="0.2" stroke="#6366f1" stroke-width="1.5"/>
        <text x="70" y="8" text-anchor="middle" fill="#a5b4fc" font-family="system-ui, sans-serif" font-size="20" font-weight="800">⏱ ${timerSeconds} SEKUND</text>
      </g>
    `;
  }

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#030712"/>
      <stop offset="50%" stop-color="#0b1120"/>
      <stop offset="100%" stop-color="#020617"/>
    </linearGradient>
    <radialGradient id="glowGradient" cx="50%" cy="40%" r="55%">
      <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${accentColor}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Ozadje -->
  <rect width="1920" height="1080" fill="url(#bgGradient)"/>
  <rect width="1920" height="1080" fill="url(#glowGradient)"/>

  <!-- Neon obroba -->
  <rect x="36" y="36" width="1848" height="1008" rx="36" fill="none" stroke="${accentColor}" stroke-width="4" stroke-opacity="0.75"/>
  <rect x="44" y="44" width="1832" height="992" rx="30" fill="none" stroke="${accentColor}" stroke-width="1" stroke-opacity="0.25"/>

  <!-- Zgornja značka sklopa / vprašanja -->
  <g transform="translate(960, 130)">
    <rect x="-310" y="-30" width="620" height="60" rx="30" fill="${accentColor}" fill-opacity="0.18" stroke="${accentColor}" stroke-width="2" stroke-opacity="0.6"/>
    <text text-anchor="middle" y="9" fill="${accentColor}" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="900" letter-spacing="3">${escapeXml(
    badge
  )}</text>
  </g>

  <!-- Glavni naslov / vprašanje -->
  <text text-anchor="middle" x="960" y="${titleStartY}" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="${titleFontSize}" font-weight="800">
    ${titleLines
      .map(
        (line, idx) =>
          `<tspan x="960" dy="${idx === 0 ? 0 : titleLineHeight}">${escapeXml(
            line
          )}</tspan>`
      )
      .join('')}
  </text>

  <!-- Podnaslov -->
  ${subtitleSvg}

  <!-- Možnosti A / B / C / D -->
  ${optionsSvg}

  <!-- Spodnja vrstica z informacijami -->
  <text x="80" y="980" fill="#64748b" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="800" letter-spacing="3">
    QUIZPULSE &bull; PUB KVIZ V ŽIVO
  </text>

  ${metaBadgesSvg}
</svg>
`.trim();

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Ustvari celoten preizkusni kviz z vsemi tipi vprašanj (multiple_choice, open_text, closest_number, theme_intro, info_only)
 * in privlačnimi SVG grafičnimi slajdi ter ga z UPSERT shrani neposredno v Supabase bazo.
 */
export async function createMegaDemoQuiz(hostId: string): Promise<Quiz> {
  const quizId = crypto.randomUUID();
  const theme1Id = crypto.randomUUID();
  const theme2Id = crypto.randomUUID();

  const quiz: Quiz = {
    id: quizId,
    host_id: hostId,
    title: 'Mega Demo Pub Kviz (Test vseh funkcij)',
    max_jokers_per_player: 1,
    created_at: new Date().toISOString(),
  };

  const themes: Theme[] = [
    {
      id: theme1Id,
      quiz_id: quizId,
      title: '1. sklop: Splošno znanje & Geografija',
      order_index: 0,
    },
    {
      id: theme2Id,
      quiz_id: quizId,
      title: '2. sklop: Film, Glasba in Šport',
      order_index: 1,
    },
  ];

  // 1. Tematika: Splošno znanje & Geografija
  const theme1Slides: Slide[] = [
    // Slajd 1: theme_intro
    {
      id: crypto.randomUUID(),
      theme_id: theme1Id,
      order_index: 0,
      slide_type: 'theme_intro',
      question_text: '1. SKLOP: SPLOŠNO ZNANJE - Čas za vklop Jokerja!',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '',
      points: 0,
      timer_seconds: 0,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '1. TEMATIKA • JOKER KORAK',
        title: 'SPLOŠNO ZNANJE & GEOGRAFIJA',
        subtitle: 'Čas za vklop JOKERJA na vaših telefonih za 2x točke!',
        type: 'theme_intro',
        accentColor: '#f59e0b',
      }),
    },
    // Slajd 2: multiple_choice
    {
      id: crypto.randomUUID(),
      theme_id: theme1Id,
      order_index: 1,
      slide_type: 'multiple_choice',
      question_text:
        'Katera država ima največ časovnih pasov na svetu (vključno s čezmorskimi ozemlji)?',
      options: {
        A: 'Rusija',
        B: 'ZDA',
        C: 'Francija',
        D: 'Kitajska',
      },
      correct_answer: 'C',
      points: 1,
      timer_seconds: 30,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '1. SKLOP • VPRAŠANJE 1/3 (IZBIRNI ODGOVOR)',
        title:
          'Katera država ima največ časovnih pasov na svetu (vključno s čezmorskimi ozemlji)?',
        options: {
          A: 'Rusija',
          B: 'ZDA',
          C: 'Francija',
          D: 'Kitajska',
        },
        type: 'multiple_choice',
        accentColor: '#6366f1',
        points: 1,
        timerSeconds: 30,
      }),
    },
    // Slajd 3: open_text
    {
      id: crypto.randomUUID(),
      theme_id: theme1Id,
      order_index: 2,
      slide_type: 'open_text',
      question_text: 'Kako se imenuje najvišji slap v Sloveniji (106 m)?',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: 'Slap Boka',
      points: 1,
      timer_seconds: 0,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '1. SKLOP • VPRAŠANJE 2/3 (ODPRTI VNOS)',
        title: 'Kako se imenuje najvišji slap v Sloveniji (106 m)?',
        subtitle: 'Vpišite besedilo odgovora na svojem telefonu',
        type: 'open_text',
        accentColor: '#10b981',
        points: 1,
      }),
    },
    // Slajd 4: closest_number
    {
      id: crypto.randomUUID(),
      theme_id: theme1Id,
      order_index: 3,
      slide_type: 'closest_number',
      question_text: 'Koliko metrov meri obseg Zemlje ob ekvatorju (v km)?',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '40075',
      points: 2,
      timer_seconds: 30,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '1. SKLOP • VPRAŠANJE 3/3 (UGANI ŠTEVILKO)',
        title: 'Koliko kilometrov meri obseg Zemlje ob ekvatorju (v km)?',
        subtitle: 'Vpišite številko na svojem telefonu — najbližji približek prejme 2 točki!',
        type: 'closest_number',
        accentColor: '#8b5cf6',
        points: 2,
        timerSeconds: 30,
      }),
    },
  ];

  // 2. Tematika: Film, Glasba in Šport
  const theme2Slides: Slide[] = [
    // Slajd 1: theme_intro
    {
      id: crypto.randomUUID(),
      theme_id: theme2Id,
      order_index: 0,
      slide_type: 'theme_intro',
      question_text: '2. SKLOP: FILM, GLASBA IN ŠPORT - Čas za vklop Jokerja!',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '',
      points: 0,
      timer_seconds: 0,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '2. TEMATIKA • JOKER KORAK',
        title: 'FILM, GLASBA IN ŠPORT',
        subtitle: 'Čas za vklop JOKERJA na vaših telefonih za 2x točke!',
        type: 'theme_intro',
        accentColor: '#f59e0b',
      }),
    },
    // Slajd 2: info_only
    {
      id: crypto.randomUUID(),
      theme_id: theme2Id,
      order_index: 1,
      slide_type: 'info_only',
      question_text:
        'Pozorno si oglejte naslednja vprašanja - v tem krogu odločajo malenkosti!',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '',
      points: 0,
      timer_seconds: 0,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '2. SKLOP • VMESNA NAVODILA',
        title: 'POZORNOST IN ZBRANOST!',
        subtitle:
          'Pozorno si oglejte naslednja vprašanja — v tem krogu odločajo malenkosti!',
        type: 'info_only',
        accentColor: '#38bdf8',
      }),
    },
    // Slajd 3: multiple_choice
    {
      id: crypto.randomUUID(),
      theme_id: theme2Id,
      order_index: 2,
      slide_type: 'multiple_choice',
      question_text:
        'Kateri slovenski kolesar je prvi osvojil dirko Tour de France?',
      options: {
        A: 'Primož Roglič',
        B: 'Tadej Pogačar',
        C: 'Matej Mohorič',
        D: 'Jan Tratnik',
      },
      correct_answer: 'B',
      points: 1,
      timer_seconds: 20,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '2. SKLOP • VPRAŠANJE 1/2 (IZBIRNI ODGOVOR)',
        title:
          'Kateri slovenski kolesar je prvi osvojil dirko Tour de France?',
        options: {
          A: 'Primož Roglič',
          B: 'Tadej Pogačar',
          C: 'Matej Mohorič',
          D: 'Jan Tratnik',
        },
        type: 'multiple_choice',
        accentColor: '#6366f1',
        points: 1,
        timerSeconds: 20,
      }),
    },
    // Slajd 4: open_text
    {
      id: crypto.randomUUID(),
      theme_id: theme2Id,
      order_index: 3,
      slide_type: 'open_text',
      question_text:
        'Napišite naslov filma, ki je leta 2020 kot prvi tujejezični film osvojil oskarja za najboljši film.',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: 'Parazit',
      points: 2,
      timer_seconds: 0,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '2. SKLOP • VPRAŠANJE 2/2 (ODPRTI VNOS)',
        title:
          'Napišite naslov filma, ki je leta 2020 kot prvi tujejezični film osvojil oskarja za najboljši film.',
        subtitle: 'Vpišite besedilo odgovora na svojem telefonu',
        type: 'open_text',
        accentColor: '#10b981',
        points: 2,
      }),
    },
  ];

  const slidesByTheme: Record<string, Slide[]> = {
    [theme1Id]: theme1Slides,
    [theme2Id]: theme2Slides,
  };

  // Shrani celoten kviz neposredno v Supabase bazo (quizzes, themes, slides) z UPSERT
  await upsertFullQuiz(quiz, themes, slidesByTheme, hostId);

  return quiz;
}
