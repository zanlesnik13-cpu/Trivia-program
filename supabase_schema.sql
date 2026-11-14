-- =============================================================================
-- LIVE TRIVIA APP (PUB KVIZ V ŽIVO) - SUPABASE SQL SHEMA & POPRAVEK DOVOLJENJ
-- Kopirajte in zaženite to celotno skripto v Supabase SQL Editorju.
-- Skripta ustvari vse tabele (ali popravi obstoječe), odstrani omejitev
-- na auth.users (tako da deluje tudi Hiter vstop / Gost!), izklopi RLS
-- ter uredi Storage bucket 'slides' z javnimi dovoljenji.
-- =============================================================================

-- 0. Omogoči UUID razširitev
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Tabela: quizzes (Kvizi)
-- Opomba: host_id je TEXT (brez REFERENCES auth.users), da deluje tako s Supabase Auth kot v načinu Gosta!
CREATE TABLE IF NOT EXISTS public.quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id TEXT NOT NULL,
    title TEXT NOT NULL,
    max_jokers_per_player INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Če je bila tabela quizzes ustvarjena prej z omejitvijo FOREIGN KEY na auth.users, jo varno odstranimo:
ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS quizzes_host_id_fkey;
ALTER TABLE public.quizzes ALTER COLUMN host_id TYPE TEXT USING host_id::TEXT;

-- 2. Tabela: themes (Tematike / Sklopi)
CREATE TABLE IF NOT EXISTS public.themes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0
);

-- 3. Tabela: slides (Slajdi znotraj tematike)
-- Tipi slajdov: 'theme_intro', 'info_only', 'multiple_choice', 'open_text', 'closest_number'
-- Pomembno glede Jokerja: Vsaka tematika se začne s 'theme_intro', kjer lahko igralci aktivirajo Jokerja za dvojne točke v tej temi.
CREATE TABLE IF NOT EXISTS public.slides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_id UUID NOT NULL REFERENCES public.themes(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL DEFAULT 0,
    slide_image_url TEXT,
    slide_type TEXT NOT NULL DEFAULT 'multiple_choice' CHECK (
        slide_type IN ('theme_intro', 'info_only', 'multiple_choice', 'open_text', 'closest_number')
    ),
    question_text TEXT DEFAULT '',
    options JSONB DEFAULT '{"A": "", "B": "", "C": "", "D": ""}'::jsonb,
    correct_answer TEXT DEFAULT '',
    points NUMERIC NOT NULL DEFAULT 1,
    timer_seconds INTEGER NOT NULL DEFAULT 0
);

-- 4. Tabela: game_sessions (Aktivne igre v živo)
-- Statusi: 'lobby', 'theme_intro', 'active_theme', 'grading_theme', 'leaderboard', 'finished'
CREATE TABLE IF NOT EXISTS public.game_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
    room_code VARCHAR(4) NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'lobby' CHECK (
        status IN ('lobby', 'theme_intro', 'active_theme', 'grading_theme', 'leaderboard', 'finished')
    ),
    current_theme_id UUID REFERENCES public.themes(id) ON DELETE SET NULL,
    current_slide_id UUID REFERENCES public.slides(id) ON DELETE SET NULL,
    max_slide_index_reached INTEGER NOT NULL DEFAULT 0,
    timer_started_at TIMESTAMPTZ,
    timer_duration INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Tabela: players (Igralci v posamezni igri)
CREATE TABLE IF NOT EXISTS public.players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.game_sessions(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL,
    reconnect_token UUID NOT NULL DEFAULT gen_random_uuid(),
    total_score NUMERIC NOT NULL DEFAULT 0,
    jokers_remaining INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Tabela: player_jokers (Beleženje aktiviranih Jokerjev po tematikah)
-- Beleži, v kateri temi je igralec aktiviral jokerja (samo med 'theme_intro' stanjem).
CREATE TABLE IF NOT EXISTS public.player_jokers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.game_sessions(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    theme_id UUID NOT NULL REFERENCES public.themes(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(session_id, player_id, theme_id)
);

-- 7. Tabela: answers (Odgovori igralcev na posamezne slajde)
CREATE TABLE IF NOT EXISTS public.answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.game_sessions(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    theme_id UUID NOT NULL REFERENCES public.themes(id) ON DELETE CASCADE,
    slide_id UUID NOT NULL REFERENCES public.slides(id) ON DELETE CASCADE,
    answer_text TEXT NOT NULL DEFAULT '',
    is_correct BOOLEAN DEFAULT FALSE,
    awarded_points NUMERIC DEFAULT 0,
    bonus_points NUMERIC DEFAULT 0,
    graded BOOLEAN NOT NULL DEFAULT FALSE,
    host_comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(session_id, player_id, slide_id)
);

-- =============================================================================
-- INDEKSI ZA HITRO DELOVANJE
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_quizzes_host_id ON public.quizzes(host_id);
CREATE INDEX IF NOT EXISTS idx_themes_quiz_id ON public.themes(quiz_id, order_index);
CREATE INDEX IF NOT EXISTS idx_slides_theme_id ON public.slides(theme_id, order_index);
CREATE INDEX IF NOT EXISTS idx_game_sessions_room_code ON public.game_sessions(room_code);
CREATE INDEX IF NOT EXISTS idx_players_session_id ON public.players(session_id);
CREATE INDEX IF NOT EXISTS idx_player_jokers_lookup ON public.player_jokers(session_id, player_id, theme_id);
CREATE INDEX IF NOT EXISTS idx_answers_session_theme ON public.answers(session_id, theme_id);
CREATE INDEX IF NOT EXISTS idx_answers_slide_player ON public.answers(slide_id, player_id);

-- =============================================================================
-- IZKLOP RLS (Row Level Security) IN DOVOLJENJA ZA BREZHIBNO DELOVANJE
-- =============================================================================
ALTER TABLE public.quizzes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.themes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.slides DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.players DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_jokers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers DISABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- =============================================================================
-- SUPABASE REALTIME NASTAVITVE
-- =============================================================================
ALTER TABLE public.quizzes REPLICA IDENTITY FULL;
ALTER TABLE public.themes REPLICA IDENTITY FULL;
ALTER TABLE public.slides REPLICA IDENTITY FULL;
ALTER TABLE public.game_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.players REPLICA IDENTITY FULL;
ALTER TABLE public.player_jokers REPLICA IDENTITY FULL;
ALTER TABLE public.answers REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'game_sessions'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.game_sessions;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'players'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.players;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'player_jokers'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.player_jokers;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'answers'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.answers;
    END IF;
END $$;

-- =============================================================================
-- SUPABASE STORAGE BUCKET 'slides' IN POLITIKE ZA NALAGANJE SLIK / PDF SLAJDOV
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'slides',
    'slides',
    true,
    52428800, -- 50 MB
    ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

-- Odstrani morebitne stare politike na storage.objects za 'slides'
DROP POLICY IF EXISTS "Public Access to slides" ON storage.objects;
DROP POLICY IF EXISTS "Allow public uploads to slides" ON storage.objects;
DROP POLICY IF EXISTS "Allow public updates to slides" ON storage.objects;
DROP POLICY IF EXISTS "Allow public deletes from slides" ON storage.objects;

-- Ustvari odprte politike za bucket 'slides' za anon in authenticated (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "Public Access to slides"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'slides');

CREATE POLICY "Allow public uploads to slides"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'slides');

CREATE POLICY "Allow public updates to slides"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'slides')
WITH CHECK (bucket_id = 'slides');

CREATE POLICY "Allow public deletes from slides"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id = 'slides');


-- Opcijski komentar gostitelja in bonus točke pri ocenjevanju (za nadgradnjo obstoječe tabele answers)
ALTER TABLE public.answers ADD COLUMN IF NOT EXISTS host_comment TEXT;
ALTER TABLE public.answers ADD COLUMN IF NOT EXISTS bonus_points NUMERIC DEFAULT 0;
