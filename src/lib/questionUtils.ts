import type { QuestionPart, Slide, SlideOptions } from '../types/quiz';

/**
 * Zaokroži točke na 2 decimalni mesti (za korake po 0.25)
 */
export function roundPoints(val: number | string | null | undefined): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

/**
 * Pretvori ISO datum ('YYYY-MM-DD') v slovenski format 'DD. MM. YYYY'.
 * Če ni veljaven YYYY-MM-DD datum, vrne izvirni niz.
 */
export function formatSloveneDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return trimmed;
  const [, year, month, day] = match;
  return `${day}. ${month}. ${year}`;
}

function extractChoicePrefixLetter(val: string): string | null {
  const upper = val.trim().toUpperCase();
  if (/^[A-D]$/.test(upper)) return upper;
  const match = /^([A-D])\s*[).:\s-]/.exec(upper);
  return match ? match[1] : null;
}

/**
 * Varno primerja odgovor ali pravilno možnost pri vprašanju z izbiro (A / B / C / D),
 * tako da prepozna "A", "a", "A) Besedilo", "A. Besedilo", NE pa napačno besede "Avstrija" za črko "A".
 */
export function isMultipleChoiceMatch(
  valueA: string | null | undefined,
  valueB: string | null | undefined
): boolean {
  const normA = (valueA || '').trim().toUpperCase();
  const normB = (valueB || '').trim().toUpperCase();
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  const letterA = extractChoicePrefixLetter(normA);
  const letterB = extractChoicePrefixLetter(normB);
  if (letterA && letterB) {
    return letterA === letterB;
  }
  return false;
}

/**
 * Pretvori YYYY-MM-DD v UTC milisekunde opolnoči. Vrne null, če datum ni veljaven (npr. 2026-02-31).
 */
export function parseIsoDateToUtcMs(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = Date.UTC(year, month - 1, day);
  if (Number.isNaN(utc)) return null;
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return utc;
}

/**
 * Izračuna absolutno razliko v dnevih med dvema datumoma ('YYYY-MM-DD').
 * Vrne null, če kateri izmed datumov ni veljaven.
 */
export function calculateDateDiffDays(
  dateStrA: string | null | undefined,
  dateStrB: string | null | undefined
): number | null {
  const utcA = parseIsoDateToUtcMs(dateStrA);
  const utcB = parseIsoDateToUtcMs(dateStrB);
  if (utcA === null || utcB === null) return null;
  return Math.round(Math.abs(utcA - utcB) / 86400000);
}

/**
 * Oblikuje oznako odstopanja v dnevih v slovenščini.
 */
export function formatDaysDeviationLabel(diffDays: number): string {
  if (diffDays === 0) return '🎯 Točen datum! (0 dni)';
  if (diffDays === 1) return 'Odstopanje: 1 dan';
  if (diffDays === 2) return 'Odstopanje: 2 dni';
  return `Odstopanje: ${diffDays} dni`;
}

/**
 * Preveri, ali ima slajd večdelno vprašanje (vsaj 1 del v question_parts).
 */
export function isMultiPartSlide(slide: Slide | null | undefined): boolean {
  return Boolean(slide?.question_parts && Array.isArray(slide.question_parts) && slide.question_parts.length > 0);
}

/**
 * Normalizira polje options na QuestionPart v SlideOptions objekt { A, B, C, D }
 * ter polje 4 nizov [optA, optB, optC, optD].
 */
export function getPartOptionsMap(part: QuestionPart): SlideOptions {
  const opts = part.options || [];
  return {
    A: opts[0] ?? '',
    B: opts[1] ?? '',
    C: opts[2] ?? '',
    D: opts[3] ?? '',
  };
}

export interface ParsedMultiPartAnswer {
  values: Record<string, string>;
  partScores: Record<string, number>;
}

/**
 * Razčleni JSON niz v answers.answer_text za večdelno vprašanje.
 * Ohranja tudi morebitne ocenjene točke po delih v ključu `__part_scores`.
 */
export function parseMultiPartAnswer(answerText: string | null | undefined): ParsedMultiPartAnswer {
  if (!answerText || !answerText.trim()) {
    return { values: {}, partScores: {} };
  }
  try {
    const parsed = JSON.parse(answerText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const values: Record<string, string> = {};
      const partScores: Record<string, number> = {};

      for (const [key, val] of Object.entries(parsed)) {
        if (key === '__part_scores' && val && typeof val === 'object' && !Array.isArray(val)) {
          for (const [pId, scoreVal] of Object.entries(val as Record<string, unknown>)) {
            const num = Number(scoreVal);
            if (Number.isFinite(num)) {
              partScores[pId] = roundPoints(num);
            }
          }
        } else if (val !== null && val !== undefined) {
          values[key] = String(val);
        }
      }
      return { values, partScores };
    }
  } catch {
    // Fallback če odgovor ni veljaven JSON
  }
  return { values: {}, partScores: {} };
}

/**
 * Pretvori odgovore po delih (in opcijske točke po delih) nazaj v JSON niz za answers.answer_text.
 */
export function serializeMultiPartAnswer(
  values: Record<string, string>,
  partScores?: Record<string, number>
): string {
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (k !== '__part_scores') {
      payload[k] = v ?? '';
    }
  }
  if (partScores && Object.keys(partScores).length > 0) {
    const cleanedScores: Record<string, number> = {};
    for (const [k, v] of Object.entries(partScores)) {
      cleanedScores[k] = roundPoints(v);
    }
    payload.__part_scores = cleanedScores;
  }
  return JSON.stringify(payload);
}

/**
 * Preveri, ali je igralec pri večdelnem vprašanju izpolnil vsaj en del.
 */
export function hasAnyMultiPartValue(answerText: string | null | undefined): boolean {
  const { values } = parseMultiPartAnswer(answerText);
  return Object.values(values).some((v) => v && v.trim().length > 0);
}

/**
 * Vrne vsoto rednih točk slajda (brez bonus delov, ki imajo is_bonus === true).
 */
export function getSlideRegularPointsSum(slide: Slide | null | undefined): number {
  if (!slide) return 0;
  if (isMultiPartSlide(slide) && slide.question_parts) {
    return roundPoints(
      slide.question_parts
        .filter((p) => !p.is_bonus)
        .reduce((acc, p) => acc + Number(p.points ?? 0), 0)
    );
  }
  return roundPoints(Number(slide.points ?? 0));
}

/**
 * Vrne vsoto vnaprej določenih bonus točk slajda (deli z is_bonus === true).
 */
export function getSlideBonusPointsSum(slide: Slide | null | undefined): number {
  if (!slide || !isMultiPartSlide(slide) || !slide.question_parts) return 0;
  return roundPoints(
    slide.question_parts
      .filter((p) => Boolean(p.is_bonus))
      .reduce((acc, p) => acc + Number(p.points ?? 0), 0)
  );
}

/**
 * Preveri, ali ima slajd kakšen bonus del vprašanja (is_bonus === true).
 */
export function hasBonusQuestionPart(slide: Slide | null | undefined): boolean {
  if (!slide || !isMultiPartSlide(slide) || !slide.question_parts) return false;
  return slide.question_parts.some((p) => Boolean(p.is_bonus));
}
