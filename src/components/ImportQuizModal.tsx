import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardCopy,
  FileText,
  FileUp,
  Layers,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  importQuizFromPdfAndJson,
  type ImportQuizProgress,
  type ImportQuizResult,
  parseImportQuizJson,
} from '../lib/quizService';

interface ImportQuizModalProps {
  hostId: string;
  onClose: () => void;
  onImportSuccess: (result: ImportQuizResult) => Promise<void> | void;
}

const EXAMPLE_QUIZ_JSON = `{
  "title": "Moj Veliki Pub Kviz",
  "max_jokers_per_player": 2,
  "themes": [
    {
      "title": "1. Sklop: Zgodovina in Geografija",
      "slides": [
        {
          "page_index": 0,
          "slide_type": "info_only",
          "question_text": "Dobrodošli na kvizu! Pravila igre.",
          "points": 0,
          "timer_seconds": 0
        },
        {
          "page_index": 1,
          "slide_type": "theme_intro",
          "question_text": "1. Sklop: Zgodovina in Geografija — Čas za aktivacijo Jokerja!",
          "points": 0,
          "timer_seconds": 0
        },
        {
          "page_index": 2,
          "slide_type": "multiple_choice",
          "question_text": "Katero je glavno mesto Avstralije?",
          "options": {
            "A": "Sydney",
            "B": "Melbourne",
            "C": "Canberra",
            "D": "Perth"
          },
          "correct_answer": "C",
          "points": 1,
          "timer_seconds": 30
        },
        {
          "page_index": 3,
          "slide_type": "closest_date",
          "question_text": "Kdaj je Slovenija razglasila samostojnost?",
          "correct_answer": "1991-06-25",
          "points": 1,
          "timer_seconds": 35
        },
        {
          "page_index": 4,
          "slide_type": "open_text",
          "question_text": "Naštejte glavnega igralca in režiserja ter ocenite letnico filma.",
          "points": 2,
          "timer_seconds": 45,
          "question_parts": [
            {
              "id": "part-1",
              "label": "a) Ime režiserja",
              "type": "open_text",
              "correct_answer": "Christopher Nolan",
              "points": 1,
              "is_bonus": false
            },
            {
              "id": "part-2",
              "label": "b) Leto izida filma",
              "type": "closest_number",
              "correct_answer": "2010",
              "points": 1,
              "is_bonus": false
            },
            {
              "id": "part-bonus",
              "label": "⭐ BONUS: Ime glavnega lika",
              "type": "open_text",
              "correct_answer": "Dom Cobb",
              "points": 0.5,
              "is_bonus": true
            }
          ]
        }
      ]
    }
  ]
}`;

const AI_PROMPT_AND_SCHEMA = `Pripravi mi veljaven JSON za uvoz mojega kviza v aplikacijo QuizPulse na podlagi priloženega PDF dokumenta (ali seznama vprašanj in odgovorov).

PRAVILA ZA PRIPRAVO JSON DATOTEKE:
1. Vrni IZKLJUČNO veljaven JSON objekt po spodnji shemi (brez odvečnega besedila okoli).
2. Polje "page_index" je indeks strani v PDF datoteki, kjer se štetje začne z 0 (1. stran PDF-ja = 0, 2. stran = 1, 3. stran = 2 itd.).
3. Dovoljene vrednosti za "slide_type":
   - "info_only": informativni / naslovni slajd ali slajd s pravili (points: 0, timer_seconds: 0)
   - "theme_intro": uvodni slajd posamezne tematike, na katerem igralci lahko aktivirajo Jokerja (points: 0, timer_seconds: 0)
   - "multiple_choice": vprašanje z izbiro A, B, C, D ("options": { "A": "...", "B": "...", "C": "...", "D": "..." }, "correct_answer": "A" ali "B" ali "C" ali "D")
   - "open_text": odprti tekstovni odgovor ("correct_answer": "besedilo pravilnega odgovora")
   - "closest_number": najbližje število ("correct_answer": "1999")
   - "closest_date": najbližji datum v ISO obliki YYYY-MM-DD ("correct_answer": "1991-06-25")
4. "points": število rednih točk za vprašanje (npr. 1, 0.5, 0.25; 0 za info_only in theme_intro).
5. "timer_seconds": čas v sekundah za odgovor (0 = brez časovnika, sicer npr. 30, 45).
6. "question_parts" (OPCIJSKO — uporabi samo, če ima en slajd več delnih vprašanj ali bonus podvprašanje):
   - Vsak del ima: "id" (unikaten niz npr. "part-1"), "label" (oznaka npr. "a) Država"), "type" ("multiple_choice" | "open_text" | "closest_number" | "closest_date"), "correct_answer", "points", in opcijsko "is_bonus": true/false.
   - Če je "type": "multiple_choice", dodaj še "options": ["Možnost A", "Možnost B", "Možnost C", "Možnost D"].
   - Če je "is_bonus": true, se te točke prištejejo posebej in jih Joker (2x) NE podvoji.

PRIMER VELJAVNE JSON SHEME:
${EXAMPLE_QUIZ_JSON}

Zdaj pa na podlagi mojih slajdov in vprašanj spodaj zgeneriraj ustrezen JSON:
[SEM PRILEPI SVOJA VPRAŠANJA IN PRAVILNE ODGOVORE ALI PRILOŽI PDF]`;

export const ImportQuizModal: React.FC<ImportQuizModalProps> = ({
  hostId,
  onClose,
  onImportSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<'import' | 'guide'>('import');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportQuizProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedAiPrompt, setCopiedAiPrompt] = useState(false);
  const [copiedJsonOnly, setCopiedJsonOnly] = useState(false);

  const jsonPreview = useMemo(() => {
    if (!jsonText.trim()) return null;
    try {
      const parsed = parseImportQuizJson(jsonText);
      return { ok: true as const, parsed };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : 'Neveljaven JSON',
      };
    }
  }, [jsonText]);

  const handleCopyAiPrompt = async () => {
    await navigator.clipboard.writeText(AI_PROMPT_AND_SCHEMA);
    setCopiedAiPrompt(true);
    setTimeout(() => setCopiedAiPrompt(false), 2500);
  };

  const handleCopyJsonOnly = async () => {
    await navigator.clipboard.writeText(EXAMPLE_QUIZ_JSON);
    setCopiedJsonOnly(true);
    setTimeout(() => setCopiedJsonOnly(false), 2500);
  };

  const handleUseExampleJson = () => {
    setJsonText(EXAMPLE_QUIZ_JSON);
    setActiveTab('import');
    setError(null);
  };

  const handlePdfSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setError(null);
    if (file && !file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Prosimo, izberite veljavno PDF datoteko (.pdf).');
      return;
    }
    setPdfFile(file);
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (importing) return;
    setError(null);

    if (!pdfFile) {
      setError('Najprej izberite PDF datoteko s slajdi predstavitve.');
      return;
    }
    if (!jsonText.trim()) {
      setError('Prilepite JSON konfiguracijo kviza v spodnje besedilno polje.');
      return;
    }

    setImporting(true);
    setProgress({
      message: 'Priprava in preverjanje JSON sheme...',
      current: 0,
      total: 1,
    });

    try {
      const result = await importQuizFromPdfAndJson(hostId, pdfFile, jsonText, (p) => {
        setProgress(p);
      });
      await onImportSuccess(result);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Prišlo je do neznane napake pri uvozu kviza.';
      setError(msg);
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-4xl bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[92vh]">
        {/* Glava modala */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between gap-4 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
              <FileUp className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg sm:text-xl font-bold text-slate-100 truncate">
                📥 Uvozi kviz (PDF + JSON)
              </h3>
              <p className="text-xs text-slate-400">
                Uvozite celotno predstavitev iz PDF-ja in JSON konfiguracijo neposredno v vaš zasebni račun.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={importing}
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Zavihka */}
        <div className="px-6 pt-4 border-b border-slate-800 flex flex-wrap items-center gap-2 bg-slate-950/40 shrink-0">
          <button
            type="button"
            id="import-tab-form"
            onClick={() => setActiveTab('import')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs sm:text-sm font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === 'import'
                ? 'border-sky-400 text-sky-300 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Uvoz kviza</span>
          </button>

          <button
            type="button"
            id="import-tab-guide"
            onClick={() => setActiveTab('guide')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs sm:text-sm font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === 'guide'
                ? 'border-emerald-400 text-emerald-300 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>📋 Navodila &amp; Predloga za AI pomočnika</span>
          </button>
        </div>

        {/* Telo modala */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {activeTab === 'import' ? (
            <form onSubmit={handleImportSubmit} className="space-y-5">
              {/* 1. Izbira PDF datoteke */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    1. PDF datoteka s slajdi predstavitve
                  </label>
                  <span className="text-[11px] text-slate-400">
                    1. stran PDF-ja ima v JSON-u <code className="text-sky-300">page_index: 0</code>
                  </span>
                </div>

                <label
                  htmlFor="import-quiz-pdf-input"
                  className={`flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl border-2 border-dashed transition-all cursor-pointer ${
                    pdfFile
                      ? 'bg-emerald-500/10 border-emerald-500/50'
                      : 'bg-slate-950/70 border-slate-700 hover:border-sky-500/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        pdfFile
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-100 truncate">
                        {pdfFile ? pdfFile.name : 'Kliknite za izbiro PDF datoteke (.pdf)'}
                      </p>
                      <p className="text-xs text-slate-400">
                        {pdfFile
                          ? `Velikost: ${(pdfFile.size / (1024 * 1024)).toFixed(2)} MB • Pripravljeno za pretvorbo v slike`
                          : 'Vse strani PDF-ja se pretvorijo v slike in naložijo v vaš kviz'}
                      </p>
                    </div>
                  </div>
                  <span className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 shrink-0">
                    {pdfFile ? 'Zamenjaj PDF' : 'Izberi PDF'}
                  </span>
                  <input
                    id="import-quiz-pdf-input"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={handlePdfSelect}
                    disabled={importing}
                    className="hidden"
                  />
                </label>
              </div>

              {/* 2. JSON konfiguracija */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="import-quiz-json-textarea"
                    className="text-xs font-bold uppercase tracking-wider text-slate-300"
                  >
                    2. JSON konfiguracija kviza (tematike, tipi slajdov, pravilni odgovori)
                  </label>
                  <button
                    type="button"
                    onClick={() => setActiveTab('guide')}
                    className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 cursor-pointer"
                  >
                    Potrebujete predlogo? Odpri navodila &amp; prompt za AI &rarr;
                  </button>
                </div>

                <textarea
                  id="import-quiz-json-textarea"
                  rows={11}
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    if (error) setError(null);
                  }}
                  disabled={importing}
                  placeholder={`Prilepite JSON konfiguracijo kviza tukaj...\n{\n  "title": "Moj Pub Kviz",\n  "max_jokers_per_player": 2,\n  "themes": [ ... ]\n}`}
                  className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-800 focus:border-sky-500 focus:outline-none text-xs sm:text-sm font-mono-code text-slate-100 placeholder-slate-600 leading-relaxed"
                />

                {/* Predogled validacije JSON-a v živo */}
                {jsonPreview && (
                  <div
                    className={`px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 border ${
                      jsonPreview.ok
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    }`}
                  >
                    {jsonPreview.ok ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>
                          Veljaven JSON: <strong>{jsonPreview.parsed.title}</strong> &bull;{' '}
                          {jsonPreview.parsed.themes.length} tematik &bull;{' '}
                          {jsonPreview.parsed.totalSlides} slajdov (najvišji{' '}
                          <code>page_index</code>: {jsonPreview.parsed.maxPageIndex}, jokerji:{' '}
                          {jsonPreview.parsed.max_jokers_per_player})
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>{jsonPreview.error}</span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Napredek uvoza */}
              {importing && progress && (
                <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-sky-200">
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                      {progress.message}
                    </span>
                    <span className="font-mono-code">
                      {progress.current}/{progress.total}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-300"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round((progress.current / Math.max(1, progress.total)) * 100)
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Napaka pri uvozu */}
              {error && (
                <div className="p-4 rounded-2xl bg-rose-950/80 border border-rose-500/50 text-rose-200 text-xs sm:text-sm flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <pre className="whitespace-pre-wrap font-mono-code leading-relaxed flex-1">
                    {error}
                  </pre>
                </div>
              )}

              {/* Akcijski gumbi */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
                <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Kviz bo shranjen izključno v vaš osebni račun.</span>
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={importing}
                    onClick={onClose}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 bg-slate-800/60 cursor-pointer disabled:opacity-40"
                  >
                    Prekliči
                  </button>
                  <button
                    id="confirm-import-quiz-btn"
                    type="submit"
                    disabled={importing}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-gradient-to-r from-sky-500 to-emerald-500 hover:from-sky-400 hover:to-emerald-400 text-slate-950 shadow-lg shadow-sky-500/20 transition-all cursor-pointer disabled:opacity-60"
                  >
                    {importing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Uvažam kviz...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Uvozi in shrani v moj račun</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            /* ZAVIHEK B: Navodila & Predloga za AI pomočnika */
            <div className="space-y-5">
              {/* Hitri akciji za kopiranje */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/60 to-sky-950/60 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-emerald-300">
                    Pripravite JSON v 10 sekundah z AI pomočnikom (Gemini / ChatGPT / Claude)
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Kliknite gumb za kopiranje, prilepite besedilo svojemu AI pomočniku skupaj z vašim PDF-jem
                    ali vprašanji, nato pa dobljeni JSON prilepite v zavihek <strong>Uvoz kviza</strong>.
                  </p>
                </div>
                <button
                  id="copy-ai-prompt-schema-btn"
                  type="button"
                  onClick={handleCopyAiPrompt}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs sm:text-sm font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20 transition-all shrink-0 cursor-pointer"
                >
                  {copiedAiPrompt ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Skopirano v odložišče!</span>
                    </>
                  ) : (
                    <>
                      <ClipboardCopy className="w-4 h-4" />
                      <span>📋 Kopiraj JSON shemo in prompt za AI</span>
                    </>
                  )}
                </button>
              </div>

              {/* Razlaga polj */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <h5 className="font-bold text-slate-100 uppercase tracking-wider text-[11px]">
                    Osnovna polja slajda
                  </h5>
                  <ul className="space-y-1.5 text-slate-300">
                    <li>
                      <code className="text-sky-300 font-bold">page_index</code> — zaporedna stran v PDF-ju
                      (<strong>1. stran = 0</strong>, 2. stran = 1, 3. stran = 2 …).
                    </li>
                    <li>
                      <code className="text-sky-300 font-bold">slide_type</code> — tip slajda:
                      <div className="mt-1 flex flex-wrap gap-1">
                        {[
                          'info_only',
                          'theme_intro',
                          'multiple_choice',
                          'open_text',
                          'closest_number',
                          'closest_date',
                        ].map((t) => (
                          <code
                            key={t}
                            className="px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300 text-[11px]"
                          >
                            {t}
                          </code>
                        ))}
                      </div>
                    </li>
                    <li>
                      <code className="text-sky-300 font-bold">points</code> — redne točke (npr.{' '}
                      <code>1</code>, <code>0.5</code>, <code>0.25</code>; pri <code>info_only</code> in{' '}
                      <code>theme_intro</code> nastavite <code>0</code>).
                    </li>
                    <li>
                      <code className="text-sky-300 font-bold">timer_seconds</code> — čas za odgovor v
                      sekundah (<code>0</code> = brez časovnika).
                    </li>
                  </ul>
                </div>

                <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <h5 className="font-bold text-slate-100 uppercase tracking-wider text-[11px]">
                    Večdelna &amp; Bonus vprašanja (question_parts)
                  </h5>
                  <ul className="space-y-1.5 text-slate-300">
                    <li>
                      Če ima slajd več podvprašanj (npr. a), b) in bonus), dodajte polje{' '}
                      <code className="text-emerald-300 font-bold">question_parts</code> (seznam delov).
                    </li>
                    <li>
                      Vsak del ima <code className="text-indigo-300">id</code>,{' '}
                      <code className="text-indigo-300">label</code>,{' '}
                      <code className="text-indigo-300">type</code> (<code>multiple_choice</code>,{' '}
                      <code>open_text</code>, <code>closest_number</code>, <code>closest_date</code>),{' '}
                      <code className="text-indigo-300">correct_answer</code> in{' '}
                      <code className="text-indigo-300">points</code>.
                    </li>
                    <li>
                      Za bonus podvprašanje dodajte{' '}
                      <code className="text-amber-300 font-bold">"is_bonus": true</code> — te točke se
                      prištejejo posebej in jih Joker (2x) <strong>ne podvoji</strong>!
                    </li>
                    <li>
                      Za datumsko vprašanje (<code className="text-indigo-300">closest_date</code>) v{' '}
                      <code>correct_answer</code> zapišite obliko <code>YYYY-MM-DD</code>.
                    </li>
                  </ul>
                </div>
              </div>

              {/* Celoten primer JSON sheme */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Celoten primer veljavne JSON sheme
                  </h5>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleUseExampleJson}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-xs font-semibold cursor-pointer"
                    >
                      Vstavi primer v uvoz
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyJsonOnly}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                    >
                      {copiedJsonOnly ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Skopirano!</span>
                        </>
                      ) : (
                        <>
                          <ClipboardCopy className="w-3.5 h-3.5" />
                          <span>Kopiraj predlogo</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <pre className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-[11px] sm:text-xs font-mono-code text-slate-200 overflow-x-auto max-h-72 leading-relaxed">
                  {EXAMPLE_QUIZ_JSON}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
