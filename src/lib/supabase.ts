import { createClient, SupabaseClient } from '@supabase/supabase-js';

const STORAGE_URL_KEY = 'trivia_supabase_url';
const STORAGE_ANON_KEY = 'trivia_supabase_anon_key';

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

  const localUrl = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_URL_KEY) : null;
  const localKey = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_ANON_KEY) : null;

  const rawUrl = localUrl || envUrl || '';
  const rawKey = localKey || envKey || '';

  const url = cleanSupabaseUrl(rawUrl);
  const anonKey = cleanSupabaseAnonKey(rawKey);

  const isConfigured = Boolean(
    url &&
      anonKey &&
      url.startsWith('http') &&
      !url.includes('your-project-id')
  );

  return { url, anonKey, isConfigured };
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

