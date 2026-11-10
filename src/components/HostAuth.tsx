import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Lock,
  LogIn,
  Mail,
  Sparkles,
  UserPlus,
  Zap,
} from 'lucide-react';
import { getSupabaseClient, getSupabaseConfig } from '../lib/supabase';

interface HostAuthProps {
  onAuthenticated: (user: { id: string; email: string; isDemo?: boolean }) => void;
  onOpenSupabaseModal: () => void;
}

const GUEST_HOST_ID_KEY = 'guest_host_id';
const GUEST_HOST_EMAIL_KEY = 'guest_host_email';

export function getOrCreateGuestHostId(): string {
  if (typeof window === 'undefined') return '00000000-0000-4000-8000-000000000001';
  const existing = localStorage.getItem(GUEST_HOST_ID_KEY);
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (existing && uuidRegex.test(existing)) {
    return existing;
  }
  const generated = crypto.randomUUID();
  localStorage.setItem(GUEST_HOST_ID_KEY, generated);
  return generated;
}

export const HostAuth: React.FC<HostAuthProps> = ({
  onAuthenticated,
  onOpenSupabaseModal,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const { isConfigured } = getSupabaseConfig();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!email.trim() || !password.trim()) {
      setError('Prosimo, vnesite e-poštni naslov in geslo.');
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      // Če Supabase še ni povezan, prijavimo gostitelja s stalnim veljavnim UUID-jem
      const guestUuid = getOrCreateGuestHostId();
      localStorage.setItem(GUEST_HOST_EMAIL_KEY, email.trim());
      onAuthenticated({
        id: guestUuid,
        email: email.trim(),
        isDemo: true,
      });
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const { data, error: signInErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (signInErr) {
          const lower = signInErr.message?.toLowerCase() || '';
          if (lower.includes('invalid path')) {
            throw new Error(
              'Napačen URL Supabase baze (vsebuje neveljavno pot). Preverite, da je URL oblike https://<projekt>.supabase.co in ne povezava do nadzorne plošče.'
            );
          }
          if (lower.includes('email not confirmed')) {
            // Če ima uporabnik v Supabase še vklopljeno potrditev e-pošte, ga vseeno spustimo v nadzorno ploščo z determinističnim ali gostujočim UUID-jem
            const guestUuid = getOrCreateGuestHostId();
            localStorage.setItem(GUEST_HOST_EMAIL_KEY, email.trim());
            onAuthenticated({
              id: guestUuid,
              email: email.trim(),
              isDemo: true,
            });
            return;
          }
          if (lower.includes('invalid login credentials')) {
            throw new Error(
              'Napačen e-poštni naslov ali geslo. Če še nimate računa, izberite zavihek "Registracija" ali kliknite "⚡ Hiter vstop brez prijave (Gost)".'
            );
          }
          throw signInErr;
        }

        if (data.user) {
          onAuthenticated({
            id: data.user.id,
            email: data.user.email || email.trim(),
          });
        }
      } else {
        const redirectUrl =
          typeof window !== 'undefined'
            ? `${window.location.origin}/host`
            : undefined;

        const { data, error: signUpErr } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: redirectUrl ? { emailRedirectTo: redirectUrl } : undefined,
        });

        if (signUpErr) {
          const lower = signUpErr.message?.toLowerCase() || '';
          if (lower.includes('invalid path')) {
            throw new Error(
              'Napačen URL Supabase baze (vsebuje neveljavno pot). Preverite, da je URL oblike https://<projekt>.supabase.co in ne povezava do nadzorne plošče.'
            );
          }
          throw signUpErr;
        }

        // Če Supabase vrne uporabnika (tudi brez potrjene seje), ga takoj spusti v nadzorno ploščo!
        if (data.user) {
          localStorage.setItem(GUEST_HOST_ID_KEY, data.user.id);
          localStorage.setItem(GUEST_HOST_EMAIL_KEY, data.user.email || email.trim());
          onAuthenticated({
            id: data.user.id,
            email: data.user.email || email.trim(),
          });
          return;
        }

        setSuccessMsg(
          'Registracija uspešna! Lahko se prijavite ali uporabite gumb za hiter vstop spodaj.'
        );
        setMode('login');
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Prišlo je do napake pri avtentikaciji.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoLogin = () => {
    const guestUuid = getOrCreateGuestHostId();
    const guestEmail = email.trim() || localStorage.getItem(GUEST_HOST_EMAIL_KEY) || 'gost@quizpulse.si';
    localStorage.setItem(GUEST_HOST_EMAIL_KEY, guestEmail);
    onAuthenticated({
      id: guestUuid,
      email: guestEmail,
      isDemo: true,
    });
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        {/* Zgornji naslov */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>QuizPulse Live &bull; Host Studio</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-100">
            Vodenje pub kviza v živo
          </h1>
          <p className="text-sm text-slate-400">
            Prijavite se v nadzorno ploščo gostitelja, ustvarite sklope, naložite PDF slajde in
            zaženite interaktivni kviz.
          </p>
        </div>

        {/* Glavna steklena kartica (Glassmorphism) */}
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-indigo-950/30 space-y-6">
          {/* Preklop Prijava / Registracija */}
          <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-950/90 border border-slate-800/80">
            <button
              id="auth-mode-login-btn"
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                mode === 'login'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LogIn className="w-4 h-4" />
              <span>Prijava</span>
            </button>
            <button
              id="auth-mode-register-btn"
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                mode === 'register'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              <span>Registracija</span>
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs leading-relaxed">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs leading-relaxed">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="host-email-input"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2"
              >
                E-poštni naslov gostitelja
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="host-email-input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ime.priimek@klub.si"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-950/90 border border-slate-800 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm transition-all"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="host-password-input"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2"
              >
                Geslo
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="host-password-input"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-950/90 border border-slate-800 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm transition-all"
                />
              </div>
            </div>

            <button
              id="host-auth-submit-btn"
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl font-semibold text-sm bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <span>Preverjanje...</span>
              ) : mode === 'login' ? (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Prijavi se kot gostitelj</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>Ustvari račun gostitelja</span>
                </>
              )}
            </button>
          </form>

          {/* Ločilna črta z "ALI" */}
          <div className="relative flex items-center justify-center my-1">
            <div className="border-t border-slate-800 w-full" />
            <span className="bg-slate-900 px-3 text-[11px] uppercase tracking-wider text-slate-500 font-bold shrink-0">
              ali
            </span>
            <div className="border-t border-slate-800 w-full" />
          </div>

          {/* Gumb za hiter vstop brez prijave (vedno na voljo) */}
          <div className="space-y-2">
            <button
              id="quick-demo-login-btn"
              type="button"
              onClick={handleQuickDemoLogin}
              className="w-full py-3 px-4 rounded-xl text-xs sm:text-sm font-bold bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 hover:text-emerald-200 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/10 transition-all cursor-pointer group"
            >
              <Zap className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
              <span>⚡ Hiter vstop brez prijave (Demo / Lokalni gostitelj)</span>
            </button>
            <p className="text-[11px] text-center text-slate-400 leading-tight">
              Takojšen vstop v nadzorno ploščo za ustvarjanje kvizov in vodenje seje tudi brez registracije.
            </p>
          </div>

          {/* Status Supabase povezave & Nastavitve */}
          <div className="pt-4 border-t border-slate-800/80 space-y-3">
            {!isConfigured ? (
              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/90 flex items-center justify-between">
                <span className="text-xs font-medium text-amber-300 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5" />
                  Supabase ključa še nista nastavljena
                </span>
                <button
                  id="open-supabase-setup-from-auth-btn"
                  type="button"
                  onClick={onOpenSupabaseModal}
                  className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                >
                  Nastavi &amp; SQL
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Povezano s Supabase Auth
                </span>
                <button
                  type="button"
                  onClick={onOpenSupabaseModal}
                  className="text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                >
                  SQL Skripta &amp; Nastavitve
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
