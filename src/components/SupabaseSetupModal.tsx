import React, { useState } from 'react';
import {
  Check,
  Copy,
  Database,
  ExternalLink,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import {
  cleanSupabaseUrl,
  clearSupabaseConfig,
  getSupabaseConfig,
  saveSupabaseConfig,
} from '../lib/supabase';
import sqlSchemaRaw from '../../supabase_schema.sql?raw';

const QUICK_FIX_SQL = `-- =====================================================================
-- HITER POPRAVEK ZA SUPABASE (delovanje z Gostiteljem IN v načinu Gosta)
-- =====================================================================

-- 1. Odstrani omejitev FOREIGN KEY na auth.users pri tabeli quizzes
ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS quizzes_host_id_fkey;
ALTER TABLE public.quizzes ALTER COLUMN host_id TYPE TEXT USING host_id::TEXT;

-- 2. Izklopi RLS (Row Level Security) na vseh tabelah
ALTER TABLE public.quizzes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.themes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.slides DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.players DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_jokers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers DISABLE ROW LEVEL SECURITY;

-- 3. Dodeli polne pravice za anon in authenticated
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- 4. Nastavi Storage bucket 'slides' na public in odpri politike
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('slides', 'slides', true, 52428800)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 52428800;

DROP POLICY IF EXISTS "Public Access to slides" ON storage.objects;
DROP POLICY IF EXISTS "Allow public uploads to slides" ON storage.objects;
DROP POLICY IF EXISTS "Allow public updates to slides" ON storage.objects;
DROP POLICY IF EXISTS "Allow public deletes from slides" ON storage.objects;

CREATE POLICY "Public Access to slides" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'slides');
CREATE POLICY "Allow public uploads to slides" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'slides');
CREATE POLICY "Allow public updates to slides" ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'slides') WITH CHECK (bucket_id = 'slides');
CREATE POLICY "Allow public deletes from slides" ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'slides');`;

interface SupabaseSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigSaved: () => void;
}

export const SupabaseSetupModal: React.FC<SupabaseSetupModalProps> = ({
  isOpen,
  onClose,
  onConfigSaved,
}) => {
  const currentConfig = getSupabaseConfig();
  const [url, setUrl] = useState(currentConfig.url);
  const [anonKey, setAnonKey] = useState(currentConfig.anonKey);
  const [activeTab, setActiveTab] = useState<'sql' | 'connection'>('sql');
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedFixSql, setCopiedFixSql] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  if (!isOpen) return null;

  const handleCopySql = async () => {
    await navigator.clipboard.writeText(sqlSchemaRaw);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  const handleCopyFixSql = async () => {
    await navigator.clipboard.writeText(QUICK_FIX_SQL);
    setCopiedFixSql(true);
    setTimeout(() => setCopiedFixSql(false), 2500);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedUrl = cleanSupabaseUrl(url);
    saveSupabaseConfig(cleanedUrl, anonKey);
    const cleaned = getSupabaseConfig();
    setUrl(cleaned.url);
    setAnonKey(cleaned.anonKey);
    setSavedNotice(true);
    setTimeout(() => {
      setSavedNotice(false);
      onConfigSaved();
      onClose();
    }, 600);
  };

  const handleClear = () => {
    clearSupabaseConfig();
    const cfg = getSupabaseConfig();
    setUrl(cfg.url);
    setAnonKey(cfg.anonKey);
    onConfigSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl shadow-indigo-950/50 overflow-hidden">
        {/* Glava modala */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">
                Supabase Baza &amp; SQL Skripta
              </h2>
              <p className="text-xs text-slate-400">
                Kopirajte popravljalno ali celotno SQL skripto za Supabase SQL Editor
              </p>
            </div>
          </div>
          <button
            id="close-supabase-modal-btn"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Zavihki */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-6 pt-3 gap-2">
          <button
            id="tab-sql-schema-btn"
            onClick={() => setActiveTab('sql')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-xl border-b-2 transition-all ${
              activeTab === 'sql'
                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>1. SQL Skripta &amp; Popravek Dovoljenj</span>
          </button>
          <button
            id="tab-supabase-keys-btn"
            onClick={() => setActiveTab('connection')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-xl border-b-2 transition-all ${
              activeTab === 'connection'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <span>2. Povezava s Supabase (URL &amp; Anon Key)</span>
          </button>
        </div>

        {/* Vsebina */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {activeTab === 'sql' ? (
            <div className="space-y-5">
              {/* Hiter popravek za obstoječo bazo */}
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-emerald-300">
                      ⚡ Hiter popravek za obstoječo bazo (delovanje tudi v načinu Gosta!)
                    </p>
                    <p className="text-xs text-slate-300">
                      Če ste tabele že ustvarili, poženite to kratko skripto v Supabase SQL Editorju. Odstrani omejitev <code className="text-emerald-300">auth.users</code> na <code className="text-emerald-300">quizzes.host_id</code>, izklopi RLS in odpre Storage dovoljenja.
                    </p>
                  </div>
                  <button
                    id="copy-quick-fix-sql-btn"
                    onClick={handleCopyFixSql}
                    className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
                  >
                    {copiedFixSql ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Popravek skopiran!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Kopiraj kratko popravljalno SQL skripto</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="text-[11px] font-mono-code text-emerald-200/90 bg-slate-950/90 border border-slate-800 rounded-xl p-3 overflow-x-auto max-h-40">
                  {QUICK_FIX_SQL}
                </pre>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-indigo-200">
                    Celotna SQL shema (za novo postavitev ali posodobitev)
                  </p>
                  <p className="text-xs text-slate-300">
                    Ustvari vse tabele (<code className="text-indigo-300">quizzes</code>,{' '}
                    <code className="text-indigo-300">themes</code>,{' '}
                    <code className="text-indigo-300">slides</code>,{' '}
                    <code className="text-indigo-300">game_sessions</code>,{' '}
                    <code className="text-indigo-300">players</code>,{' '}
                    <code className="text-indigo-300">player_jokers</code>,{' '}
                    <code className="text-indigo-300">answers</code>), vklopi Realtime ter ustvari
                    Storage bucket <code className="text-emerald-300">slides</code>.
                  </p>
                </div>
                <button
                  id="copy-sql-script-btn"
                  onClick={handleCopySql}
                  className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all cursor-pointer"
                >
                  {copiedSql ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-300" />
                      <span>Skopirano v odložišče!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Kopiraj celotno SQL skripto</span>
                    </>
                  )}
                </button>
              </div>

              <div className="relative rounded-2xl bg-slate-950 border border-slate-800 p-4 overflow-x-auto max-h-[320px]">
                <pre className="text-xs font-mono-code text-slate-300 leading-relaxed">
                  {sqlSchemaRaw}
                </pre>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-5">
              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Kako povezati vaš Supabase projekt?</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  V nadzorni plošči Supabase odprite{' '}
                  <strong className="text-slate-200">Project Settings &rarr; API</strong> in
                  skopirajte <strong className="text-slate-200">Project URL</strong> ter{' '}
                  <strong className="text-slate-200">anon / public</strong> ključ. Podatki se
                  shranijo v vaš brskalnik (ali v <code className="text-indigo-300">.env.local</code>
                  ), tako da lahko aplikacijo takoj uporabljate v živo.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Supabase Project URL
                  </label>
                  <input
                    id="supabase-url-input"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onBlur={() => url && setUrl(cleanSupabaseUrl(url))}
                    placeholder="https://xyzcompany.supabase.co"
                    className="w-full px-4 py-3 rounded-xl bg-slate-950/90 border border-slate-800 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm font-mono-code"
                  />
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    ✨ <strong>Samodejno čiščenje:</strong> Če skopirate povezavo iz Supabase Dashboarda ali URL s potjo <code className="text-indigo-300">/rest/v1</code>, bo aplikacija samodejno izluščila čisti <code className="text-emerald-300">https://&lt;id&gt;.supabase.co</code>.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Supabase Anon / Public Key
                  </label>
                  <textarea
                    id="supabase-anon-key-input"
                    rows={3}
                    value={anonKey}
                    onChange={(e) => setAnonKey(e.target.value)}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    className="w-full px-4 py-3 rounded-xl bg-slate-950/90 border border-slate-800 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm font-mono-code"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  id="reset-demo-mode-btn"
                  type="button"
                  onClick={handleClear}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Ponastavi na lokalni Demo način</span>
                </button>

                <div className="flex items-center gap-3">
                  <a
                    href="https://supabase.com/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300"
                  >
                    <span>Odpri Supabase Dashboard</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    id="save-supabase-config-btn"
                    type="submit"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
                  >
                    {savedNotice ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Shranjeno!</span>
                      </>
                    ) : (
                      <span>Shrani in poveži Supabase</span>
                    )}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
