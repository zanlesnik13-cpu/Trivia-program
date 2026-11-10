# Trivia-program — QuizPulse Live (Pub Kviz v Živo)

Moderna, vizualno privlačna spletna aplikacija za vodenje pub kviza v živo (**Live Trivia App**), zgrajena z **React (Vite + TypeScript)**, **Tailwind CSS**, **Lucide Icons**, **pdfjs-dist** in **Supabase** (Auth, Database, Storage in Realtime).

## Faza 1 — Kaj je vključeno?
1. **Celotna Supabase SQL shema ([`supabase_schema.sql`](file:///home/antigravity/zanlesnik13-cpu/Trivia-program/supabase_schema.sql))**:
   - Tabele: `quizzes`, `themes`, `slides`, `game_sessions`, `players`, `player_jokers`, `answers`.
   - Izklopljene RLS omejitve na tabelah in dodeljene pravice (`GRANT ALL`) za takojšnje delovanje brez napak z dovoljenji.
   - Samodejna vzpostavitev Supabase Storage bucketa `slides` z javnimi politikami za nalaganje in prikazovanje slik/PDF slajdov.
   - Vključena Realtime publikacija za `game_sessions`, `players`, `player_jokers` in `answers`.
2. **Avtentikacija in nadzorna plošča gostitelja ([`HostAuth.tsx`](file:///home/antigravity/zanlesnik13-cpu/Trivia-program/src/components/HostAuth.tsx), [`HostDashboard.tsx`](file:///home/antigravity/zanlesnik13-cpu/Trivia-program/src/components/HostDashboard.tsx))**:
   - Prijava in registracija prek Supabase Auth (e-pošta in geslo) + vgrajen takojšnji Demo način za preizkus brez nastavljenih ključev.
   - Pregled vseh kvizov gostitelja, ustvarjanje kviza, brisanje in gumb **"Zaženi kviz v živo"** (ustvari zapis v `game_sessions` s 4-mestno kodo sobe).
3. **Urejevalnik kviza in PDF pretvornik ([`QuizBuilder.tsx`](file:///home/antigravity/zanlesnik13-cpu/Trivia-program/src/components/QuizBuilder.tsx), [`pdfConverter.ts`](file:///home/antigravity/zanlesnik13-cpu/Trivia-program/src/lib/pdfConverter.ts))**:
   - Nastavitev naslova kviza in števila Jokerjev na igralca (`max_jokers_per_player`).
   - Ustvarjanje in urejanje tematik/sklopov (vsaka nova tematika se samodejno začne z uvodnim `theme_intro` slajdom za aktivacijo Jokerja).
   - Nalaganje **PDF predstavitve** (`pdfjs-dist` v brskalniku vsako stran PDF-ja pretvori v sliko in jo naloži v Supabase Storage bucket `slides`) ali posameznih slik.
   - Nastavitve za vsak slajd: tip slajda (`theme_intro`, `info_only`, `multiple_choice`, `open_text`, `closest_number`), besedilo vprašanja, možni odgovori A/B/C/D, pravilen odgovor, točke in časovnik.

## Namestitev in zagon
```bash
npm install
npm run dev
```

Za povezavo s Supabase projektom kopirajte vsebino datoteke [`supabase_schema.sql`](file:///home/antigravity/zanlesnik13-cpu/Trivia-program/supabase_schema.sql) v **Supabase SQL Editor**, nato pa vnesite `VITE_SUPABASE_URL` in `VITE_SUPABASE_ANON_KEY` v `.env.local` ali neposredno v aplikaciji prek gumba **"Supabase SQL & Nastavitve"** v zgornji vrstici.
