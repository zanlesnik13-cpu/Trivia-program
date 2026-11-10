import { createClient, SupabaseClient } from '@supabase/supabase-js';

const STORAGE_URL_KEY = 'https://nwpftuydshsguorxlkie.supabase.co';
const STORAGE_ANON_KEY = 'sb_publishable_0We5ATxLgWOT3yuorwoUZQ_ICO-SY5N';

/**
 * Privzeta Supabase baza za aplikacijo (hardcoded fallback, če .env ali localStorage nista nastavljena).
 */
export const DEFAULT_SUPABASE_URL = 'https://nwpftuydshsguorxlkie.supabase.co';
export const DEFAULT_SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '';

/**
 * Samodejno očisti Supabase URL:
 * 1. Če uporabnik skopira povezavo iz Supabase Dashboarda:
 *    https://supabase.com/dashboard/project/<project_ref>...
 *    izlušči <project_ref> in jo pretvori v https://<project_ref>.supabase.co.
 * 2. Če URL že vsebuje domeno .supabase.co (ali katerokoli drugo), a ima na koncu
 *    dodatno pot (npr. /rest/v1, /auth/v1 ali končno poševnico /),
 *    ohrani samo origin (protokol + domena + vrata).
 */
export function cleanSupabaseUrl(rawUrl: string | undefined | null): string {
  if (!rawUrl) return '';
  let trimmed = rawUrl.trim();
  if (!trimmed) return '';

  // Odstrani morebitne narekovaje okoli niza
  trimmed = trimmed.replace(/^["']+|["']+$/g, '');

  // Dodaj protokol https://, če manjka
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    trimmed = `https://${trimmed}`;
  }

  // Preveri, če je uporabnik skopiral URL nadzorne plošče:
  // npr. https://supabase.com/dashboard/project/abcdefghijk/editor...
  const dashboardMatch = trimmed.match(
    /supabase\.com\/dashboard\/project\/([a-zA-Z0-9_-]+)/i
  );
  if (dashboardMatch && dashboardMatch[1]) {
    const projectRef = dashboardMatch[1];
    return `https://${projectRef}.supabase.co`;
  }

  // Če gre za standarden URL, ohrani samo origin (brez /rest/v1, /auth/v1 ali /)
  try {
    const parsed = new URL(trimmed);
    return parsed.origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

export function cleanSupabaseAnonKey(rawKey: string | undefined | null): string {
  if (!rawKey) return '';
  return rawKey.trim().replace(/^["']+|["']+$/g, '');
}

export function getSupabaseConfig() {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  let localUrl = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_URL_KEY) : null;
  let localKey = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_ANON_KEY) : null;

  // Če uporabnik odpre povezavo prek QR kode na drugi napravi (npr. telefon),
  // ki ima v URL-ju parametra ?su_url=...&su_key=..., ju samodejno preberi in shrani v localStorage!
  if (typeof window !== 'undefined') {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      let urlParam = searchParams.get('su_url');
      let keyParam = searchParams.get('su_key');

      if ((!urlParam || !keyParam) && window.location.hash.includes('?')) {
        const hashQuery = window.location.hash.split('?')[1];
        const hashParams = new URLSearchParams(hashQuery);
        urlParam = urlParam || hashParams.get('su_url');
        keyParam = keyParam || hashParams.get('su_key');
      }

      if (urlParam && keyParam) {
        const cleanedU = cleanSupabaseUrl(urlParam);
        const cleanedK = cleanSupabaseAnonKey(keyParam);
        if (cleanedU && cleanedK) {
          localStorage.setItem(STORAGE_URL_KEY, cleanedU);
          localStorage.setItem(STORAGE_ANON_KEY, cleanedK);
          localUrl = cleanedU;
          localKey = cleanedK;
        }
      }
    } catch {
      // ignore URL parsing errors
    }
  }

  const rawUrl = localUrl || envUrl || DEFAULT_SUPABASE_URL;
  const rawKey = localKey || envKey || DEFAULT_SUPABASE_ANON_KEY;

  let url = cleanSupabaseUrl(rawUrl);
  if (!url || url.includes('your-project-id')) {
    url = DEFAULT_SUPABASE_URL;
  }
  let anonKey = cleanSupabaseAnonKey(rawKey);
  if (anonKey === 'your-supabase-anon-key') {
    anonKey = DEFAULT_SUPABASE_ANON_KEY;
  }

  const isConfigured = Boolean(
    url &&
      anonKey &&
      url.startsWith('http') &&
      !url.includes('your-project-id') &&
      anonKey !== 'your-supabase-anon-key'
  );

  return { url, anonKey, isConfigured };
}

/**
 * Doda su_url in su_key v URL, če na napravi uporabljamo ročno vpisano Supabase povezavo
 * (da bo telefon ob skeniranju QR kode takoj povezan na isto Supabase bazo!).
 */
export function appendSupabaseConfigToUrl(baseUrl: string): string {
  const { url, anonKey, isConfigured } = getSupabaseConfig();
  const envUrl = cleanSupabaseUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined);
  const envKey = cleanSupabaseAnonKey(import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

  // Če že obstajata identična envUrl in envKey iz Vercela, URL-ja ne podaljšujemo po nepotrebnem,
  // sicer pa varno pripnemo su_url in su_key, da 100% deluje na vseh napravah!
  if (!isConfigured) return baseUrl;
  if (envUrl === url && envKey === anonKey) return baseUrl;

  try {
    const parsed = new URL(baseUrl);
    parsed.searchParams.set('su_url', url);
    parsed.searchParams.set('su_key', anonKey);
    return parsed.toString();
  } catch {
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}su_url=${encodeURIComponent(url)}&su_key=${encodeURIComponent(anonKey)}`;
  }
}

export function saveSupabaseConfig(url: string, anonKey: string) {
  const cleanedUrl = cleanSupabaseUrl(url);
  const cleanedKey = cleanSupabaseAnonKey(anonKey);
  localStorage.setItem(STORAGE_URL_KEY, cleanedUrl);
  localStorage.setItem(STORAGE_ANON_KEY, cleanedKey);
  cachedClient = null;
  cachedClientUrl = '';
  cachedClientKey = '';
}

export function clearSupabaseConfig() {
  localStorage.removeItem(STORAGE_URL_KEY);
  localStorage.removeItem(STORAGE_ANON_KEY);
  cachedClient = null;
  cachedClientUrl = '';
  cachedClientKey = '';
}

let cachedClient: SupabaseClient | null = null;
let cachedClientUrl = '';
let cachedClientKey = '';

export function getSupabaseClient(): SupabaseClient | null {
  const { url, anonKey, isConfigured } = getSupabaseConfig();
  if (!isConfigured) {
    return null;
  }

  if (!cachedClient || cachedClientUrl !== url || cachedClientKey !== anonKey) {
    cachedClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
    cachedClientUrl = url;
    cachedClientKey = anonKey;
  }
  return cachedClient;
}

export function requireSupabaseClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error(
      'Supabase baza ni povezana! Večnapravna igra zahteva aktivno Supabase povezavo (VITE_SUPABASE_URL in VITE_SUPABASE_ANON_KEY). Kliknite na gumb "Supabase SQL & Nastavitve" v zgornjem meniju in vnesite URL ter Anon Key svoje Supabase baze.'
    );
  }
  return client;
}


