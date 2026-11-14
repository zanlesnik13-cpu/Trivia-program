import React from 'react';
import type { PlayerFullData, Theme } from '../types/quiz';

interface PlayerResultsReviewProps {
  gameData: PlayerFullData;
  /** Sklopi, ki jih prikažemo (en sklop po krogu ali vsi ob koncu kviza) */
  themes: Theme[];
  title: string;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

export const PlayerResultsReview: React.FC<PlayerResultsReviewProps> = ({
  gameData,
  themes,
  title,
}) => {
  const { slidesByTheme, myAnswers, playerJokers } = gameData;
  const jokerThemes = new Set(playerJokers.map((pj) => pj.theme_id));

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-4 space-y-4">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block px-1">
        {title}
      </span>

      {themes.map((theme) => {
        const questions = (slidesByTheme[theme.id] || []).filter(
          (s) =>
            s.slide_type === 'multiple_choice' ||
            s.slide_type === 'open_text' ||
            s.slide_type === 'closest_number'
        );
        const hasJoker = jokerThemes.has(theme.id);
        const redneTocke = questions.reduce(
          (acc, q) => acc + Number(myAnswers[q.id]?.awarded_points ?? 0),
          0
        );
        const bonusTocke = questions.reduce(
          (acc, q) => acc + Number(myAnswers[q.id]?.bonus_points ?? 0),
          0
        );
        const tockeTeme = (hasJoker ? redneTocke * 2 : redneTocke) + bonusTocke;
        const maxSum = questions.reduce((acc, q) => acc + Number(q.points ?? 0), 0);

        return (
          <div key={theme.id} className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-sm font-bold text-slate-100">{theme.title}</span>
              <span className="text-xs font-mono-code font-bold text-emerald-400 shrink-0">
                {fmt(tockeTeme)} t
                {hasJoker && <span className="text-amber-400"> (🃏 ×2)</span>}
                {bonusTocke > 0 && (
                  <span className="text-amber-300"> (+{fmt(bonusTocke)} ⭐)</span>
                )}
              </span>
            </div>

            {hasJoker && (
              <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-1.5">
                🃏 V tem sklopu si uporabil Jokerja: {fmt(redneTocke)} t → {fmt(redneTocke * 2)} t
                {bonusTocke > 0 ? ` + ${fmt(bonusTocke)} ⭐ bonus = ${fmt(tockeTeme)} t` : ''} (možno{' '}
                {fmt(maxSum)} t rednih brez Jokerja)
              </p>
            )}

            {questions.map((q, idx) => {
              const ans = myAnswers[q.id];
              const pts = Number(ans?.awarded_points ?? 0);
              const bonusPts = Number(ans?.bonus_points ?? 0);
              const good = pts > 0 || bonusPts > 0;
              return (
                <div
                  key={q.id}
                  className={`rounded-2xl border p-3 space-y-1.5 ${
                    good
                      ? 'bg-emerald-500/5 border-emerald-500/30'
                      : 'bg-slate-950/70 border-slate-800'
                  }`}
                >
                  <p className="text-xs font-semibold text-slate-200 leading-snug">
                    {idx + 1}. {q.question_text}
                  </p>
                  <div className="grid grid-cols-1 gap-1 text-[11px]">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Tvoj odgovor:</span>
                      <span className={`font-bold text-right ${good ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {ans?.answer_text
                          ? q.slide_type === 'multiple_choice' && q.options[ans.answer_text as 'A']
                            ? `${ans.answer_text}) ${q.options[ans.answer_text as 'A']}`
                            : ans.answer_text
                          : '— (brez odgovora)'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Pravilen odgovor:</span>
                      <span className="font-bold text-emerald-400 text-right">
                        {q.correct_answer || '—'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-slate-400">Točke:</span>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <span className="font-mono-code font-bold text-slate-100">
                          {fmt(pts)} / {fmt(Number(q.points ?? 0))}
                          {hasJoker && (
                            <span className="text-amber-400"> → {fmt(pts * 2)} (🃏 ×2)</span>
                          )}
                        </span>
                        {bonusPts > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-300 text-[10px] font-bold shadow-sm">
                            ⭐ +{fmt(bonusPts)} bonus (brez 2x Jokerja)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {ans?.host_comment && (
                    <div className="mt-1 text-[11px] text-indigo-200 bg-indigo-500/15 border border-indigo-500/40 rounded-xl px-3 py-2">
                      💬 Komentar gostitelja: {ans.host_comment}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
