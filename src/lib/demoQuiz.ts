import { upsertFullQuiz } from './quizService';
import type { Quiz, Slide, SlideOptions, SlideType, Theme } from '../types/quiz';

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
  options?: SlideOptions;
  accentColor?: string;
  points?: number;
  timerSeconds?: number;
}

/**
 * Ustvari čudovit 16:9 (1920x1080) SVG Data URL za slajd kviza,
 * optimiziran za TV prezentacije in mobilne naprave (PowerPoint / TV stil).
 * Pomembno: Na slajdu NIKOLI ni označen ali izpisan pravilen odgovor!
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
    : 400 - (titleLines.length - 1) * 36;

  const titleFontSize = isIntro ? 64 : isMultipleChoice ? 50 : 54;
  const titleLineHeight = isIntro ? 80 : isMultipleChoice ? 66 : 72;

  let optionsSvg = '';
  if (isMultipleChoice && options) {
    const choices = [
      { key: 'A', text: options.A, color: '#f43f5e', x: 200, y: 640 },
      { key: 'B', text: options.B, color: '#3b82f6', x: 990, y: 640 },
      { key: 'C', text: options.C, color: '#f59e0b', x: 200, y: 790 },
      { key: 'D', text: options.D, color: '#10b981', x: 990, y: 790 },
    ];

    optionsSvg = choices
      .map((c) => {
        const cleanText = c.text.replace(/^[A-D][.):]\s*/i, '');
        return `
      <g transform="translate(${c.x}, ${c.y})">
        <!-- Okvir možnosti -->
        <rect width="730" height="118" rx="22" fill="#1e293b" fill-opacity="0.85" stroke="#334155" stroke-width="2.5"/>
        <rect width="730" height="118" rx="22" fill="none" stroke="${c.color}" stroke-opacity="0.4" stroke-width="1.5"/>
        
        <!-- Oznaka črke A/B/C/D -->
        <rect x="22" y="24" width="70" height="70" rx="18" fill="${c.color}"/>
        <text x="57" y="70" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="34" font-weight="900">${c.key}</text>
        
        <!-- Besedilo možnosti -->
        <text x="114" y="69" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="700">${escapeXml(cleanText)}</text>
      </g>
    `;
      })
      .join('');
  }

  // Sredinski interaktivni element glede na tip slajda
  let centerElementSvg = '';
  if (type === 'theme_intro') {
    centerElementSvg = `
      <g transform="translate(610, 680)">
        <rect width="700" height="110" rx="24" fill="${accentColor}" fill-opacity="0.18" stroke="${accentColor}" stroke-width="2.5"/>
        <text x="350" y="67" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="32" font-weight="900" letter-spacing="2">🃏 VKLOP JOKERJA: 2x TOČKE</text>
      </g>
    `;
  } else if (type === 'open_text') {
    centerElementSvg = `
      <g transform="translate(460, 680)">
        <rect width="1000" height="96" rx="20" fill="#1e293b" fill-opacity="0.85" stroke="${accentColor}" stroke-width="2" stroke-dasharray="8 6"/>
        <text x="500" y="58" text-anchor="middle" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="600">✍️ Vpis odgovora na telefonu tekmovalca...</text>
      </g>
    `;
  } else if (type === 'closest_number') {
    centerElementSvg = `
      <g transform="translate(560, 680)">
        <rect width="800" height="96" rx="20" fill="#1e293b" fill-opacity="0.85" stroke="${accentColor}" stroke-width="2" stroke-dasharray="8 6"/>
        <text x="400" y="58" text-anchor="middle" fill="#c4b5fd" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="700">🔢 Vpis številke (najbližji ugib zmaga!)</text>
      </g>
    `;
  }

  // Podnaslov ali vnosna navodila
  let subtitleSvg = '';
  if (subtitleLines.length > 0) {
    const subStartY = isIntro
      ? 590
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
    <rect x="-350" y="-30" width="700" height="60" rx="30" fill="${accentColor}" fill-opacity="0.18" stroke="${accentColor}" stroke-width="2" stroke-opacity="0.6"/>
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

  <!-- Osrednji interaktivni element (vpis odgovora ali joker) -->
  ${centerElementSvg}

  <!-- Možnosti A / B / C / D (za multiple_choice) -->
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
 * Ustvari celoten preizkusni kviz s 5 tematikami in 20 slajdi ter vsemi pravilnimi odgovori
 * in privlačnimi temnimi neon SVG slajdi ter ga z UPSERT shrani neposredno v Supabase bazo.
 */
export async function createMegaDemoQuiz(hostId: string): Promise<Quiz> {
  const quizId = crypto.randomUUID();
  const theme1Id = crypto.randomUUID();
  const theme2Id = crypto.randomUUID();
  const theme3Id = crypto.randomUUID();
  const theme4Id = crypto.randomUUID();
  const theme5Id = crypto.randomUUID();

  const quiz: Quiz = {
    id: quizId,
    host_id: hostId,
    title: 'Veliki Trivia Kviz (5 Sklopov)',
    max_jokers_per_player: 2,
    created_at: new Date().toISOString(),
  };

  const themes: Theme[] = [
    {
      id: theme1Id,
      quiz_id: quizId,
      title: '1. Sklop: Vesoljski poleti',
      order_index: 0,
    },
    {
      id: theme2Id,
      quiz_id: quizId,
      title: '2. Sklop: Geodezija',
      order_index: 1,
    },
    {
      id: theme3Id,
      quiz_id: quizId,
      title: '3. Sklop: Tehnologija',
      order_index: 2,
    },
    {
      id: theme4Id,
      quiz_id: quizId,
      title: '4. Sklop: 2. svetovna vojna',
      order_index: 3,
    },
    {
      id: theme5Id,
      quiz_id: quizId,
      title: '5. Sklop: Glasba v filmih in serijah',
      order_index: 4,
    },
  ];

  // 1. TEMATIKA: 1. Sklop: Vesoljski poleti
  const theme1Slides: Slide[] = [
    // Slajd 0: theme_intro
    {
      id: crypto.randomUUID(),
      theme_id: theme1Id,
      order_index: 0,
      slide_type: 'theme_intro',
      question_text: '1. SKLOP: VESOLJSKI POLETI — Čas za aktivacijo Jokerja!',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '',
      points: 0,
      timer_seconds: 0,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '1. SKLOP • JOKER KORAK',
        title: 'VESOLJSKI POLETI',
        subtitle: 'Čas za aktivacijo JOKERJA na vaših telefonih za 2x točke!',
        type: 'theme_intro',
        accentColor: '#38bdf8',
      }),
    },
    // Slajd 1: multiple_choice
    {
      id: crypto.randomUUID(),
      theme_id: theme1Id,
      order_index: 1,
      slide_type: 'multiple_choice',
      question_text:
        'Kako se je imenoval lunarni modul misije Apollo 11, s katerim sta Neil Armstrong in Buzz Aldrin leta 1969 pristala na Luni?',
      options: {
        A: 'Columbia',
        B: 'Eagle (Orel)',
        C: 'Challenger',
        D: 'Odyssey',
      },
      correct_answer: 'B) Eagle (Orel)',
      points: 1,
      timer_seconds: 30,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '1. SKLOP • VPRAŠANJE 1/3 (IZBIRNI ODGOVOR)',
        title:
          'Kako se je imenoval lunarni modul misije Apollo 11, s katerim sta Neil Armstrong in Buzz Aldrin leta 1969 pristala na Luni?',
        options: {
          A: 'Columbia',
          B: 'Eagle (Orel)',
          C: 'Challenger',
          D: 'Odyssey',
        },
        type: 'multiple_choice',
        accentColor: '#38bdf8',
        points: 1,
        timerSeconds: 30,
      }),
    },
    // Slajd 2: open_text
    {
      id: crypto.randomUUID(),
      theme_id: theme1Id,
      order_index: 2,
      slide_type: 'open_text',
      question_text:
        'Katera vesoljska sonda, izstreljena leta 1977, je danes najbolj oddaljen človeški predmet v vesolju?',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: 'Voyager 1',
      points: 1,
      timer_seconds: 0,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '1. SKLOP • VPRAŠANJE 2/3 (ODPRTI VNOS)',
        title:
          'Katera vesoljska sonda, izstreljena leta 1977, je danes najbolj oddaljen človeški predmet v vesolju?',
        subtitle: 'Vpišite besedilo odgovora na svojem telefonu',
        type: 'open_text',
        accentColor: '#0ea5e9',
        points: 1,
      }),
    },
    // Slajd 3: closest_number
    {
      id: crypto.randomUUID(),
      theme_id: theme1Id,
      order_index: 3,
      slide_type: 'closest_number',
      question_text:
        'Koliko minut je trajal zgodovinski prvi polet Jurija Gagarina v vesolje leta 1961?',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '108',
      points: 2,
      timer_seconds: 30,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '1. SKLOP • VPRAŠANJE 3/3 (UGANI ŠTEVILKO)',
        title:
          'Koliko minut je trajal zgodovinski prvi polet Jurija Gagarina v vesolje leta 1961?',
        subtitle: 'Vpišite številko na svojem telefonu — najbližji približek prejme 2 točki!',
        type: 'closest_number',
        accentColor: '#818cf8',
        points: 2,
        timerSeconds: 30,
      }),
    },
  ];

  // 2. TEMATIKA: 2. Sklop: Geodezija
  const theme2Slides: Slide[] = [
    // Slajd 0: theme_intro
    {
      id: crypto.randomUUID(),
      theme_id: theme2Id,
      order_index: 0,
      slide_type: 'theme_intro',
      question_text: '2. SKLOP: GEODEZIJA — Čas za aktivacijo Jokerja!',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '',
      points: 0,
      timer_seconds: 0,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '2. SKLOP • JOKER KORAK',
        title: 'GEODEZIJA',
        subtitle: 'Čas za aktivacijo JOKERJA na vaših telefonih za 2x točke!',
        type: 'theme_intro',
        accentColor: '#10b981',
      }),
    },
    // Slajd 1: multiple_choice
    {
      id: crypto.randomUUID(),
      theme_id: theme2Id,
      order_index: 1,
      slide_type: 'multiple_choice',
      question_text:
        'Kako imenujemo fizikalno obliko Zemlje, ki jo določa srednja morska gladina mirujočih oceanov, podaljšana pod celinami?',
      options: {
        A: 'Elipsoid',
        B: 'Geoid',
        C: 'Sferoid',
        D: 'Kartoza',
      },
      correct_answer: 'B) Geoid',
      points: 1,
      timer_seconds: 30,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '2. SKLOP • VPRAŠANJE 1/3 (IZBIRNI ODGOVOR)',
        title:
          'Kako imenujemo fizikalno obliko Zemlje, ki jo določa srednja morska gladina mirujočih oceanov, podaljšana pod celinami?',
        options: {
          A: 'Elipsoid',
          B: 'Geoid',
          C: 'Sferoid',
          D: 'Kartoza',
        },
        type: 'multiple_choice',
        accentColor: '#10b981',
        points: 1,
        timerSeconds: 30,
      }),
    },
    // Slajd 2: open_text
    {
      id: crypto.randomUUID(),
      theme_id: theme2Id,
      order_index: 2,
      slide_type: 'open_text',
      question_text:
        'Kako se imenuje uradni državni koordinatni sistem v Sloveniji (kratica), ki je zamenjal starejši Gauss-Krügerjev sistem D48/GK?',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: 'D96/TM',
      points: 2,
      timer_seconds: 0,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '2. SKLOP • VPRAŠANJE 2/3 (ODPRTI VNOS)',
        title:
          'Kako se imenuje uradni državni koordinatni sistem v Sloveniji (kratica), ki je zamenjal starejši Gauss-Krügerjev sistem D48/GK?',
        subtitle: 'Vpišite besedilo odgovora na svojem telefonu',
        type: 'open_text',
        accentColor: '#059669',
        points: 2,
      }),
    },
    // Slajd 3: closest_number
    {
      id: crypto.randomUUID(),
      theme_id: theme2Id,
      order_index: 3,
      slide_type: 'closest_number',
      question_text:
        'Na kakšni višini nad Zemljo (v kilometrih) krožijo sateliti sistema GPS?',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '20200',
      points: 2,
      timer_seconds: 30,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '2. SKLOP • VPRAŠANJE 3/3 (UGANI ŠTEVILKO)',
        title:
          'Na kakšni višini nad Zemljo (v kilometrih) krožijo sateliti sistema GPS?',
        subtitle: 'Vpišite številko na svojem telefonu — najbližji približek prejme 2 točki!',
        type: 'closest_number',
        accentColor: '#14b8a6',
        points: 2,
        timerSeconds: 30,
      }),
    },
  ];

  // 3. TEMATIKA: 3. Sklop: Tehnologija
  const theme3Slides: Slide[] = [
    // Slajd 0: theme_intro
    {
      id: crypto.randomUUID(),
      theme_id: theme3Id,
      order_index: 0,
      slide_type: 'theme_intro',
      question_text: '3. SKLOP: TEHNOLOGIJA — Čas za aktivacijo Jokerja!',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '',
      points: 0,
      timer_seconds: 0,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '3. SKLOP • JOKER KORAK',
        title: 'TEHNOLOGIJA',
        subtitle: 'Čas za aktivacijo JOKERJA na vaših telefonih za 2x točke!',
        type: 'theme_intro',
        accentColor: '#6366f1',
      }),
    },
    // Slajd 1: multiple_choice
    {
      id: crypto.randomUUID(),
      theme_id: theme3Id,
      order_index: 1,
      slide_type: 'multiple_choice',
      question_text:
        'Kdo je leta 1991 ustvaril jedro operacijskega sistema Linux in kasneje še sistem za nadzor različic Git?',
      options: {
        A: 'Richard Stallman',
        B: 'Ken Thompson',
        C: 'Linus Torvalds',
        D: 'Dennis Ritchie',
      },
      correct_answer: 'C) Linus Torvalds',
      points: 1,
      timer_seconds: 30,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '3. SKLOP • VPRAŠANJE 1/3 (IZBIRNI ODGOVOR)',
        title:
          'Kdo je leta 1991 ustvaril jedro operacijskega sistema Linux in kasneje še sistem za nadzor različic Git?',
        options: {
          A: 'Richard Stallman',
          B: 'Ken Thompson',
          C: 'Linus Torvalds',
          D: 'Dennis Ritchie',
        },
        type: 'multiple_choice',
        accentColor: '#6366f1',
        points: 1,
        timerSeconds: 30,
      }),
    },
    // Slajd 2: open_text
    {
      id: crypto.randomUUID(),
      theme_id: theme3Id,
      order_index: 2,
      slide_type: 'open_text',
      question_text:
        'Kaj pomeni kratica HTTP na začetku spletnih naslovov (polno angleško ime)?',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: 'HyperText Transfer Protocol',
      points: 1,
      timer_seconds: 0,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '3. SKLOP • VPRAŠANJE 2/3 (ODPRTI VNOS)',
        title:
          'Kaj pomeni kratica HTTP na začetku spletnih naslovov (polno angleško ime)?',
        subtitle: 'Vpišite besedilo odgovora na svojem telefonu',
        type: 'open_text',
        accentColor: '#4f46e5',
        points: 1,
      }),
    },
    // Slajd 3: closest_number
    {
      id: crypto.randomUUID(),
      theme_id: theme3Id,
      order_index: 3,
      slide_type: 'closest_number',
      question_text: 'Katerega leta je Steve Jobs predstavil čisto prvi iPhone?',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '2007',
      points: 1,
      timer_seconds: 20,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '3. SKLOP • VPRAŠANJE 3/3 (UGANI ŠTEVILKO)',
        title: 'Katerega leta je Steve Jobs predstavil čisto prvi iPhone?',
        subtitle: 'Vpišite številko na svojem telefonu — najbližji približek prejme 1 točko!',
        type: 'closest_number',
        accentColor: '#7c3aed',
        points: 1,
        timerSeconds: 20,
      }),
    },
  ];

  // 4. TEMATIKA: 4. Sklop: 2. svetovna vojna
  const theme4Slides: Slide[] = [
    // Slajd 0: theme_intro
    {
      id: crypto.randomUUID(),
      theme_id: theme4Id,
      order_index: 0,
      slide_type: 'theme_intro',
      question_text: '4. SKLOP: 2. SVETOVNA VOJNA — Čas za aktivacijo Jokerja!',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '',
      points: 0,
      timer_seconds: 0,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '4. SKLOP • JOKER KORAK',
        title: '2. SVETOVNA VOJNA',
        subtitle: 'Čas za aktivacijo JOKERJA na vaših telefonih za 2x točke!',
        type: 'theme_intro',
        accentColor: '#f43f5e',
      }),
    },
    // Slajd 1: multiple_choice
    {
      id: crypto.randomUUID(),
      theme_id: theme4Id,
      order_index: 1,
      slide_type: 'multiple_choice',
      question_text:
        'Kako se je imenovala zavezniška vojaška operacija izkrcanja v Normandiji 6. junija 1944?',
      options: {
        A: 'Operacija Barbarossa',
        B: 'Operacija Overlord',
        C: 'Operacija Market Garden',
        D: 'Operacija Torch',
      },
      correct_answer: 'B) Operacija Overlord',
      points: 1,
      timer_seconds: 30,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '4. SKLOP • VPRAŠANJE 1/3 (IZBIRNI ODGOVOR)',
        title:
          'Kako se je imenovala zavezniška vojaška operacija izkrcanja v Normandiji 6. junija 1944?',
        options: {
          A: 'Operacija Barbarossa',
          B: 'Operacija Overlord',
          C: 'Operacija Market Garden',
          D: 'Operacija Torch',
        },
        type: 'multiple_choice',
        accentColor: '#f43f5e',
        points: 1,
        timerSeconds: 30,
      }),
    },
    // Slajd 2: open_text
    {
      id: crypto.randomUUID(),
      theme_id: theme4Id,
      order_index: 2,
      slide_type: 'open_text',
      question_text:
        'Katero sovjetsko mesto (današnji Sankt Peterburg) je med vojno preživelo skoraj 900-dnevno nemško obleganje?',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: 'Leningrad',
      points: 1,
      timer_seconds: 0,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '4. SKLOP • VPRAŠANJE 2/3 (ODPRTI VNOS)',
        title:
          'Katero sovjetsko mesto (današnji Sankt Peterburg) je med vojno preživelo skoraj 900-dnevno nemško obleganje?',
        subtitle: 'Vpišite besedilo odgovora na svojem telefonu',
        type: 'open_text',
        accentColor: '#e11d48',
        points: 1,
      }),
    },
    // Slajd 3: closest_number
    {
      id: crypto.randomUUID(),
      theme_id: theme4Id,
      order_index: 3,
      slide_type: 'closest_number',
      question_text:
        'Koliko japonskih letalonosilk je sodelovalo v napadu na Pearl Harbor decembra 1941?',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '6',
      points: 2,
      timer_seconds: 30,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '4. SKLOP • VPRAŠANJE 3/3 (UGANI ŠTEVILKO)',
        title:
          'Koliko japonskih letalonosilk je sodelovalo v napadu na Pearl Harbor decembra 1941?',
        subtitle: 'Vpišite številko na svojem telefonu — najbližji približek prejme 2 točki!',
        type: 'closest_number',
        accentColor: '#fb7185',
        points: 2,
        timerSeconds: 30,
      }),
    },
  ];

  // 5. TEMATIKA: 5. Sklop: Glasba v filmih in serijah
  const theme5Slides: Slide[] = [
    // Slajd 0: theme_intro
    {
      id: crypto.randomUUID(),
      theme_id: theme5Id,
      order_index: 0,
      slide_type: 'theme_intro',
      question_text:
        '5. SKLOP: GLASBA V FILMIH IN SERIJAH — Čas za aktivacijo Jokerja!',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '',
      points: 0,
      timer_seconds: 0,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '5. SKLOP • JOKER KORAK',
        title: 'GLASBA V FILMIH IN SERIJAH',
        subtitle: 'Čas za aktivacijo JOKERJA na vaših telefonih za 2x točke!',
        type: 'theme_intro',
        accentColor: '#ec4899',
      }),
    },
    // Slajd 1: multiple_choice
    {
      id: crypto.randomUUID(),
      theme_id: theme5Id,
      order_index: 1,
      slide_type: 'multiple_choice',
      question_text:
        'Kateri skladatelj je ustvaril glasbo za filme Interstellar, Inception, Gladiator in Dune?',
      options: {
        A: 'John Williams',
        B: 'Ennio Morricone',
        C: 'Hans Zimmer',
        D: 'Howard Shore',
      },
      correct_answer: 'C) Hans Zimmer',
      points: 1,
      timer_seconds: 20,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '5. SKLOP • VPRAŠANJE 1/3 (IZBIRNI ODGOVOR)',
        title:
          'Kateri skladatelj je ustvaril glasbo za filme Interstellar, Inception, Gladiator in Dune?',
        options: {
          A: 'John Williams',
          B: 'Ennio Morricone',
          C: 'Hans Zimmer',
          D: 'Howard Shore',
        },
        type: 'multiple_choice',
        accentColor: '#ec4899',
        points: 1,
        timerSeconds: 20,
      }),
    },
    // Slajd 2: open_text
    {
      id: crypto.randomUUID(),
      theme_id: theme5Id,
      order_index: 2,
      slide_type: 'open_text',
      question_text:
        'Katera pesem pevke Kate Bush iz leta 1985 je ponovno postala svetovni hit zaradi 4. sezone serije Stranger Things?',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: 'Running Up That Hill',
      points: 1,
      timer_seconds: 0,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '5. SKLOP • VPRAŠANJE 2/3 (ODPRTI VNOS)',
        title:
          'Katera pesem pevke Kate Bush iz leta 1985 je ponovno postala svetovni hit zaradi 4. sezone serije Stranger Things?',
        subtitle: 'Vpišite besedilo odgovora na svojem telefonu',
        type: 'open_text',
        accentColor: '#db2777',
        points: 1,
      }),
    },
    // Slajd 3: closest_number
    {
      id: crypto.randomUUID(),
      theme_id: theme5Id,
      order_index: 3,
      slide_type: 'closest_number',
      question_text:
        'Koliko nominacij za oskarja je v svoji karieri zbral legendarni filmski skladatelj John Williams?',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: '54',
      points: 2,
      timer_seconds: 30,
      slide_image_url: generateSlideSvgDataUrl({
        badge: '5. SKLOP • VPRAŠANJE 3/3 (UGANI ŠTEVILKO)',
        title:
          'Koliko nominacij za oskarja je v svoji karieri zbral legendarni filmski skladatelj John Williams?',
        subtitle: 'Vpišite številko na svojem telefonu — najbližji približek prejme 2 točki!',
        type: 'closest_number',
        accentColor: '#f472b6',
        points: 2,
        timerSeconds: 30,
      }),
    },
  ];

  const slidesByTheme: Record<string, Slide[]> = {
    [theme1Id]: theme1Slides,
    [theme2Id]: theme2Slides,
    [theme3Id]: theme3Slides,
    [theme4Id]: theme4Slides,
    [theme5Id]: theme5Slides,
  };

  // Shrani celoten kviz neposredno v Supabase bazo (quizzes, themes, slides) z UPSERT
  await upsertFullQuiz(quiz, themes, slidesByTheme, hostId);

  return quiz;
}
