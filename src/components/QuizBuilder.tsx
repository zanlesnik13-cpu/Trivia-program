import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileUp,
  FolderPlus,
  Hash,
  Image as ImageIcon,
  Info,
  Layers,
  ListChecks,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Trophy,
  Type,
} from 'lucide-react';
import { convertPdfToImages } from '../lib/pdfConverter';
import { formatSloveneDate, roundPoints } from '../lib/questionUtils';
import {
  createSlide,
  createTheme,
  deleteSlide,
  deleteTheme,
  fetchQuizDetails,
  updateSlide,
  updateTheme,
  uploadSlideImage,
  upsertFullQuiz,
} from '../lib/quizService';
import type {
  QuestionPart,
  QuestionPartType,
  Quiz,
  Slide,
  SlideOptions,
  SlideType,
  Theme,
} from '../types/quiz';

interface QuizBuilderProps {
  quizId: string;
  onBack: () => void;
}

const SLIDE_TYPE_META: Record<
  SlideType,
  {
    label: string;
    shortLabel: string;
    description: string;
    badgeClass: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  theme_intro: {
    label: 'Naslovni slajd teme (theme_intro — Joker korak)',
    shortLabel: 'Uvod teme (Joker)',
    description:
      'Predstavitveni slajd teme, preden se prikaže prvo vprašanje. Samo v tem koraku lahko igralci aktivirajo Jokerja za dvojne točke v tej temi!',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    icon: Sparkles,
  },
  info_only: {
    label: 'Samo info slajd (info_only)',
    shortLabel: 'Info slajd',
    description:
      'Slajd z dodatnimi informacijami, pravili ali vmesno razlago (brez oddaje odgovora igralcev).',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    icon: Info,
  },
  multiple_choice: {
    label: 'Izbirni odgovor A / B / C / D (multiple_choice)',
    shortLabel: 'Izbirni A/B/C/D',
    description:
      'Igralci na telefonu izberejo enega izmed štirih možnih odgovorov (A, B, C ali D).',
    badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    icon: ListChecks,
  },
  open_text: {
    label: 'Odprti vnos besedila (open_text)',
    shortLabel: 'Odprti tekst',
    description:
      'Igralci vpišejo prost besedilni odgovor na svoji napravi.',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    icon: Type,
  },
  closest_number: {
    label: 'Ugani številko (closest_number)',
    shortLabel: 'Ugani številko',
    description:
      'Igralci vpišejo številsko vrednost (točke za točen ali najbližji približek).',
    badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    icon: Hash,
  },
  closest_date: {
    label: 'Datum — najbližji pravemu (closest_date)',
    shortLabel: 'Datum',
    description:
      'Igralci izberejo datum (leto, mesec, dan). Pri ocenjevanju se odgovori samodejno razvrstijo od najbližjega datuma (najmanj dni odstopanja) do najbolj oddaljenega!',
    badgeClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    icon: Calendar,
  },
};

export const QuizBuilder: React.FC<QuizBuilderProps> = ({ quizId, onBack }) => {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [slidesByTheme, setSlidesByTheme] = useState<Record<string, Slide[]>>({});
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingQuizMeta, setSavingQuizMeta] = useState(false);
  const [savingSlide, setSavingSlide] = useState(false);
  const [addingSlide, setAddingSlide] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stanje za PDF / Slikovno nalaganje
  const [uploadStatus, setUploadStatus] = useState<{
    active: boolean;
    message: string;
    current: number;
    total: number;
  }>({ active: false, message: '', current: 0, total: 0 });

  // Dodajanje nove tematike
  const [newThemeTitle, setNewThemeTitle] = useState('');
  const [addingTheme, setAddingTheme] = useState(false);

  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const imagesInputRef = useRef<HTMLInputElement | null>(null);
  const singleSlideImageInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = (msg: string) => {
    setSaveToast(msg);
    setTimeout(() => {
      setSaveToast((curr) => (curr === msg ? null : curr));
    }, 2800);
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchQuizDetails(quizId);
        setQuiz(data.quiz);
        setThemes(data.themes);
        setSlidesByTheme(data.slidesByTheme);

        if (data.themes.length > 0) {
          const firstThemeId = data.themes[0].id;
          setSelectedThemeId(firstThemeId);
          const firstSlides = data.slidesByTheme[firstThemeId] || [];
          if (firstSlides.length > 0) {
            setSelectedSlideId(firstSlides[0].id);
          }
        }
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : 'Napaka pri nalaganju kviza.'
        );
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [quizId]);

  const currentTheme = themes.find((t) => t.id === selectedThemeId) || null;
  const currentSlides = selectedThemeId ? slidesByTheme[selectedThemeId] || [] : [];
  const currentSlide =
    currentSlides.find((s) => s.id === selectedSlideId) || currentSlides[0] || null;

  // Shrani celoten kviz, vse tematike in vse slajde z UPSERT neposredno v Supabase bazo (in lokalno)
  const handleSaveFullQuiz = async () => {
    if (!quiz) return;
    setSavingQuizMeta(true);
    setError(null);
    try {
      // 1. Pripravi ažurno stanje slajdov (vključno s trenutno urejanim slajdom v formi)
      const currentSlidesMap: Record<string, Slide[]> = { ...slidesByTheme };
      if (currentTheme && currentSlide) {
        currentSlidesMap[currentTheme.id] = (currentSlidesMap[currentTheme.id] || []).map((s) =>
          s.id === currentSlide.id ? currentSlide : s
        );
      }

      // 2. Shrani kviz, vse tematike in vse slajde z UPSERT v Supabase bazo
      await upsertFullQuiz(quiz, themes, currentSlidesMap);
      setSlidesByTheme(currentSlidesMap);
      showToast('Kviz, vse tematike in slajdi so uspešno shranjeni v bazo!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Napaka pri shranjevanju kviza.';
      setError(msg);
      window.alert(`Napaka pri shranjevanju kviza:\n${msg}`);
    } finally {
      setSavingQuizMeta(false);
    }
  };

  // Dodaj novo tematiko
  const handleAddTheme = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quiz) return;
    const defaultTitle =
      newThemeTitle.trim() || `${themes.length + 1}. sklop: Nova tematika`;

    setAddingTheme(true);
    setError(null);
    try {
      const { theme, introSlide } = await createTheme(
        quiz.id,
        defaultTitle,
        themes.length
      );
      const nextThemes = [...themes, theme];
      const nextSlidesMap = {
        ...slidesByTheme,
        [theme.id]: [introSlide],
      };
      setThemes(nextThemes);
      setSlidesByTheme(nextSlidesMap);
      setSelectedThemeId(theme.id);
      setSelectedSlideId(introSlide.id);
      setNewThemeTitle('');
      await upsertFullQuiz(quiz, nextThemes, nextSlidesMap);
      showToast(`Dodana tematika "${theme.title}" z začetnim Joker slajdom.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Napaka pri ustvarjanju tematike.';
      setError(msg);
      window.alert(`Napaka pri dodajanju tematike:\n${msg}`);
    } finally {
      setAddingTheme(false);
    }
  };

  // Posodobi naslov izbrane tematike
  const handleUpdateThemeTitle = async (newTitle: string) => {
    if (!currentTheme) return;
    setThemes((prev) =>
      prev.map((t) => (t.id === currentTheme.id ? { ...t, title: newTitle } : t))
    );
    try {
      await updateTheme(currentTheme.id, { title: newTitle });
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Napaka pri posodobitvi tematike.'
      );
    }
  };

  // Izbriši tematiko
  const handleDeleteTheme = async (theme: Theme) => {
    if (themes.length <= 1) {
      setError('Kviz mora vsebovati vsaj eno tematiko.');
      return;
    }
    const ok = window.confirm(
      `Ali res želite izbrisati tematiko "${theme.title}" in vse slajde v njej?`
    );
    if (!ok) return;

    try {
      await deleteTheme(theme.id);
      const remaining = themes.filter((t) => t.id !== theme.id);
      setThemes(remaining);
      setSlidesByTheme((prev) => {
        const copy = { ...prev };
        delete copy[theme.id];
        return copy;
      });
      if (selectedThemeId === theme.id && remaining.length > 0) {
        const nextTheme = remaining[0];
        setSelectedThemeId(nextTheme.id);
        const nextSlides = slidesByTheme[nextTheme.id] || [];
        setSelectedSlideId(nextSlides[0]?.id || null);
      }
      showToast('Tematika izbrisana.');
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Napaka pri brisanju tematike.'
      );
    }
  };

  // Dodaj nov prazen slajd v trenutno tematiko
  const handleAddBlankSlide = async (type: SlideType = 'multiple_choice') => {
    if (!currentTheme || addingSlide || !quiz) return;
    setAddingSlide(true);
    setError(null);
    try {
      // Pred dodajanjem novega slajda samodejno shrani trenutno urejan slajd
      if (currentSlide) {
        await updateSlide(currentSlide.id, {
          slide_type: currentSlide.slide_type,
          question_text: currentSlide.question_text,
          options: currentSlide.options,
          correct_answer: currentSlide.correct_answer,
          points: currentSlide.points,
          timer_seconds: currentSlide.timer_seconds,
          slide_image_url: currentSlide.slide_image_url,
          order_index: currentSlide.order_index,
        });
      }

      const nextIndex = currentSlides.length;
      const created = await createSlide(currentTheme.id, {
        order_index: nextIndex,
        slide_type: type,
        question_text:
          type === 'theme_intro'
            ? `${currentTheme.title} — Aktivirajte Jokerja za dvojne točke v tej temi!`
            : '',
        points: type === 'theme_intro' || type === 'info_only' ? 0 : 1,
        timer_seconds: type === 'theme_intro' || type === 'info_only' ? 0 : 30,
      });

      const nextSlides = [...(slidesByTheme[currentTheme.id] || []), created];
      const nextSlidesMap = {
        ...slidesByTheme,
        [currentTheme.id]: nextSlides,
      };
      setSlidesByTheme(nextSlidesMap);
      setSelectedSlideId(created.id);
      await upsertFullQuiz(quiz, themes, nextSlidesMap);
      showToast('Nov slajd dodan v tematiko.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Napaka pri dodajanju slajda.';
      setError(msg);
      window.alert(`Napaka pri dodajanju slajda:\n${msg}`);
    } finally {
      setAddingSlide(false);
    }
  };

  // Naloži PDF datoteko in vsako stran pretvori v slajd ter naloži v Supabase Storage bucket 'slides'
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !quiz || !currentTheme) return;
    e.target.value = '';

    setError(null);
    setUploadStatus({
      active: true,
      message: 'Branje in pretvorba PDF strani v slike (pdfjs-dist)...',
      current: 0,
      total: 1,
    });

    try {
      const renderedPages = await convertPdfToImages(
        file,
        (curr, total) => {
          setUploadStatus({
            active: true,
            message: `Pretvarjanje PDF strani ${curr} od ${total} v sliko...`,
            current: curr,
            total,
          });
        },
        'image/jpeg'
      );

      const existingSlides = [...(slidesByTheme[currentTheme.id] || [])];
      const hasIntroAlready = existingSlides.some(
        (s) => s.slide_type === 'theme_intro'
      );
      const createdSlides: Slide[] = [];

      // Če v tematiki že obstaja prazen uvodni slajd (brez slike), lahko 1. stran PDF-ja pripnemo nanj
      let startPageIdx = 0;
      if (
        existingSlides.length === 1 &&
        existingSlides[0].slide_type === 'theme_intro' &&
        !existingSlides[0].slide_image_url &&
        renderedPages.length > 0
      ) {
        setUploadStatus({
          active: true,
          message: `Nalaganje strani 1 od ${renderedPages.length} v Storage 'slides'...`,
          current: 1,
          total: renderedPages.length,
        });
        const firstPage = renderedPages[0];
        const publicUrl = await uploadSlideImage(
          quiz.id,
          currentTheme.id,
          firstPage.blob,
          `page_${firstPage.pageNumber}.jpg`
        );
        const updatedIntro = await updateSlide(existingSlides[0].id, {
          slide_image_url: publicUrl,
        });
        existingSlides[0] = updatedIntro;
        startPageIdx = 1;
      }

      for (let i = startPageIdx; i < renderedPages.length; i++) {
        const page = renderedPages[i];
        setUploadStatus({
          active: true,
          message: `Nalaganje strani ${i + 1} od ${renderedPages.length} v Supabase Storage 'slides'...`,
          current: i + 1,
          total: renderedPages.length,
        });

        const publicUrl = await uploadSlideImage(
          quiz.id,
          currentTheme.id,
          page.blob,
          `page_${page.pageNumber}.jpg`
        );

        const isFirstIntro = !hasIntroAlready && i === 0;
        const slideType: SlideType = isFirstIntro
          ? 'theme_intro'
          : 'multiple_choice';

        const newSlide = await createSlide(currentTheme.id, {
          order_index: existingSlides.length + createdSlides.length,
          slide_image_url: publicUrl,
          slide_type: slideType,
          question_text: isFirstIntro
            ? `${currentTheme.title} — Naslovni slajd teme (Igralci izberejo Jokerja)`
            : '',
          points: isFirstIntro ? 0 : 1,
          timer_seconds: isFirstIntro ? 0 : 30,
        });

        createdSlides.push(newSlide);
      }

      const finalSlides = [...existingSlides, ...createdSlides];
      const nextSlidesMap = {
        ...slidesByTheme,
        [currentTheme.id]: finalSlides,
      };
      setSlidesByTheme(nextSlidesMap);

      if (finalSlides.length > 0) {
        setSelectedSlideId(
          createdSlides[0]?.id || finalSlides[0].id
        );
      }

      await upsertFullQuiz(quiz, themes, nextSlidesMap);

      showToast(
        `Uspešno uvoženih ${renderedPages.length} strani iz PDF datoteke!`
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Napaka pri pretvorbi ali nalaganju PDF datoteke.';
      setError(msg);
      window.alert(`Napaka pri uvozu PDF slajdov:\n${msg}`);
    } finally {
      setUploadStatus({ active: false, message: '', current: 0, total: 0 });
    }
  };

  // Naloži eno ali več posameznih slik v tematiko
  const handleImagesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !quiz || !currentTheme) return;
    const fileArray = Array.from(files);
    e.target.value = '';

    setError(null);
    setUploadStatus({
      active: true,
      message: 'Nalaganje izbranih slik v Supabase Storage...',
      current: 0,
      total: fileArray.length,
    });

    try {
      const existingSlides = [...(slidesByTheme[currentTheme.id] || [])];
      const createdSlides: Slide[] = [];

      for (let i = 0; i < fileArray.length; i++) {
        const imgFile = fileArray[i];
        setUploadStatus({
          active: true,
          message: `Nalaganje slike ${i + 1} od ${fileArray.length} (${imgFile.name})...`,
          current: i + 1,
          total: fileArray.length,
        });

        const publicUrl = await uploadSlideImage(
          quiz.id,
          currentTheme.id,
          imgFile,
          imgFile.name
        );

        const newSlide = await createSlide(currentTheme.id, {
          order_index: existingSlides.length + createdSlides.length,
          slide_image_url: publicUrl,
          slide_type: 'multiple_choice',
          question_text: '',
          points: 1,
          timer_seconds: 30,
        });

        createdSlides.push(newSlide);
      }

      const finalSlides = [...existingSlides, ...createdSlides];
      const nextSlidesMap = {
        ...slidesByTheme,
        [currentTheme.id]: finalSlides,
      };
      setSlidesByTheme(nextSlidesMap);
      if (createdSlides.length > 0) {
        setSelectedSlideId(createdSlides[0].id);
      }

      await upsertFullQuiz(quiz, themes, nextSlidesMap);
      showToast(`Uspešno dodanih ${createdSlides.length} slikovnih slajdov!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Napaka pri nalaganju slik.';
      setError(msg);
      window.alert(`Napaka pri nalaganju slik:\n${msg}`);
    } finally {
      setUploadStatus({ active: false, message: '', current: 0, total: 0 });
    }
  };

  // Zamenjaj sliko samo za trenutno izbrani slajd
  const handleSingleSlideImageReplace = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !quiz || !currentTheme || !currentSlide) return;
    e.target.value = '';

    setUploadStatus({
      active: true,
      message: 'Nalaganje slike slajda...',
      current: 1,
      total: 1,
    });

    try {
      const publicUrl = await uploadSlideImage(
        quiz.id,
        currentTheme.id,
        file,
        file.name
      );
      const updated = await updateSlide(currentSlide.id, {
        slide_image_url: publicUrl,
      });
      const nextSlidesMap = {
        ...slidesByTheme,
        [currentTheme.id]: (slidesByTheme[currentTheme.id] || []).map((s) =>
          s.id === updated.id ? updated : s
        ),
      };
      setSlidesByTheme(nextSlidesMap);
      await upsertFullQuiz(quiz, themes, nextSlidesMap);
      showToast('Slika slajda posodobljena.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Napaka pri menjavi slike slajda.';
      setError(msg);
      window.alert(`Napaka pri menjavi slike:\n${msg}`);
    } finally {
      setUploadStatus({ active: false, message: '', current: 0, total: 0 });
    }
  };

  // Lokalna sprememba polja na slajdu
  const updateLocalSlideField = <K extends keyof Slide>(
    field: K,
    value: Slide[K]
  ) => {
    if (!currentTheme || !currentSlide) return;
    setSlidesByTheme((prev) => ({
      ...prev,
      [currentTheme.id]: (prev[currentTheme.id] || []).map((s) =>
        s.id === currentSlide.id ? { ...s, [field]: value } : s
      ),
    }));
  };

  const updateLocalSlideOption = (key: keyof SlideOptions, val: string) => {
    if (!currentSlide) return;
    const nextOptions: SlideOptions = {
      ...currentSlide.options,
      [key]: val,
    };
    updateLocalSlideField('options', nextOptions);
  };

  // Posodobi polje question_parts in samodejno preračunaj redne točke slajda (brez bonus delov, ki ne štejejo v 2x Joker)
  const updateLocalQuestionParts = (nextParts: QuestionPart[] | null) => {
    if (!currentTheme || !currentSlide) return;
    const cleaned = nextParts && nextParts.length > 0 ? nextParts : null;
    const regularSumPoints = cleaned
      ? roundPoints(
          cleaned
            .filter((p) => !p.is_bonus)
            .reduce((acc, p) => acc + Number(p.points || 0), 0)
        )
      : currentSlide.points;
    setSlidesByTheme((prev) => ({
      ...prev,
      [currentTheme.id]: (prev[currentTheme.id] || []).map((s) =>
        s.id === currentSlide.id
          ? {
              ...s,
              question_parts: cleaned,
              points: cleaned ? regularSumPoints : s.points,
            }
          : s
      ),
    }));
  };

  // Dodaj nov del vprašanja ali bonus vprašanje (če je trenutno klasično enodelno vprašanje, ustvari Del 1 iz trenutnih nastavitev + novi del)
  const handleAddQuestionPart = (isBonus: boolean = false) => {
    if (!currentSlide) return;
    const existing = currentSlide.question_parts || [];
    if (existing.length === 0) {
      const firstType: QuestionPartType =
        currentSlide.slide_type === 'multiple_choice' ||
        currentSlide.slide_type === 'open_text' ||
        currentSlide.slide_type === 'closest_number' ||
        currentSlide.slide_type === 'closest_date'
          ? currentSlide.slide_type
          : 'open_text';
      const part1: QuestionPart = {
        id: crypto.randomUUID(),
        label: isBonus ? 'Glavno vprašanje' : 'Del 1',
        type: firstType,
        ...(firstType === 'multiple_choice'
          ? {
              options: [
                currentSlide.options?.A || '',
                currentSlide.options?.B || '',
                currentSlide.options?.C || '',
                currentSlide.options?.D || '',
              ],
            }
          : {}),
        correct_answer: currentSlide.correct_answer || '',
        points: roundPoints(currentSlide.points || 1),
        is_bonus: false,
      };
      const part2: QuestionPart = {
        id: crypto.randomUUID(),
        label: isBonus ? 'Bonus vprašanje' : 'Del 2',
        type: 'open_text',
        correct_answer: '',
        points: isBonus ? 0.5 : 1,
        is_bonus: isBonus,
      };
      updateLocalQuestionParts([part1, part2]);
    } else {
      const regularCount = existing.filter((p) => !p.is_bonus).length;
      const bonusCount = existing.filter((p) => Boolean(p.is_bonus)).length;
      const nextPart: QuestionPart = {
        id: crypto.randomUUID(),
        label: isBonus
          ? bonusCount === 0
            ? 'Bonus vprašanje'
            : `Bonus vprašanje ${bonusCount + 1}`
          : `Del ${regularCount + 1}`,
        type: 'open_text',
        correct_answer: '',
        points: isBonus ? 0.5 : 1,
        is_bonus: isBonus,
      };
      updateLocalQuestionParts([...existing, nextPart]);
    }
  };

  const handleUpdateQuestionPart = (partId: string, patch: Partial<QuestionPart>) => {
    if (!currentSlide || !currentSlide.question_parts) return;
    const nextParts = currentSlide.question_parts.map((p) => {
      if (p.id !== partId) return p;
      const updated: QuestionPart = { ...p, ...patch };
      if (patch.type === 'multiple_choice' && !updated.options) {
        updated.options = ['', '', '', ''];
      }
      return updated;
    });
    updateLocalQuestionParts(nextParts);
  };

  const handleRemoveQuestionPart = (partId: string) => {
    if (!currentSlide || !currentSlide.question_parts) return;
    const remaining = currentSlide.question_parts.filter((p) => p.id !== partId);
    if (remaining.length <= 1) {
      // Če ostane le še 1 redni del (brez bonus lastnosti), preklopimo nazaj na klasično enodelno vprašanje
      if (remaining.length === 1 && !remaining[0].is_bonus) {
        const last = remaining[0];
        if (!currentTheme) return;
        setSlidesByTheme((prev) => ({
          ...prev,
          [currentTheme.id]: (prev[currentTheme.id] || []).map((s) =>
            s.id === currentSlide.id
              ? {
                  ...s,
                  slide_type: last.type,
                  correct_answer: last.correct_answer,
                  points: roundPoints(last.points || 1),
                  options:
                    last.type === 'multiple_choice' && last.options
                      ? {
                          A: last.options[0] || '',
                          B: last.options[1] || '',
                          C: last.options[2] || '',
                          D: last.options[3] || '',
                        }
                      : s.options,
                  question_parts: null,
                }
              : s
          ),
        }));
        return;
      }
      if (remaining.length === 0) {
        updateLocalQuestionParts(null);
        return;
      }
    }
    updateLocalQuestionParts(remaining);
  };

  // Shrani izbrani slajd in celoten kviz z UPSERT v Supabase bazo
  const handleSaveCurrentSlide = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!currentTheme || !currentSlide || !quiz) return;
    setSavingSlide(true);
    setError(null);
    try {
      const nextSlidesMap: Record<string, Slide[]> = {
        ...slidesByTheme,
        [currentTheme.id]: (slidesByTheme[currentTheme.id] || []).map((s) =>
          s.id === currentSlide.id ? currentSlide : s
        ),
      };

      await upsertFullQuiz(quiz, themes, nextSlidesMap);
      setSlidesByTheme(nextSlidesMap);
      showToast('Slajd in kviz uspešno shranjena v bazo.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Napaka pri shranjevanju slajda.';
      setError(msg);
      window.alert(`Napaka pri shranjevanju slajda:\n${msg}`);
    } finally {
      setSavingSlide(false);
    }
  };

  // Premik slajda gor/dol
  const handleMoveSlide = async (slideIndex: number, direction: 'up' | 'down') => {
    if (!currentTheme) return;
    const list = [...currentSlides];
    const targetIndex = direction === 'up' ? slideIndex - 1 : slideIndex + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;

    const temp = list[slideIndex];
    list[slideIndex] = list[targetIndex];
    list[targetIndex] = temp;

    const reindexed = list.map((s, idx) => ({ ...s, order_index: idx }));
    setSlidesByTheme((prev) => ({
      ...prev,
      [currentTheme.id]: reindexed,
    }));

    try {
      await Promise.all([
        updateSlide(reindexed[slideIndex].id, {
          order_index: reindexed[slideIndex].order_index,
        }),
        updateSlide(reindexed[targetIndex].id, {
          order_index: reindexed[targetIndex].order_index,
        }),
      ]);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Napaka pri premikanju slajda.'
      );
    }
  };

  // Brisanje slajda
  const handleDeleteSlide = async (slide: Slide) => {
    if (!currentTheme) return;
    const ok = window.confirm('Ali želite odstraniti ta slajd iz tematike?');
    if (!ok) return;

    try {
      await deleteSlide(slide.id);
      const remaining = currentSlides
        .filter((s) => s.id !== slide.id)
        .map((s, idx) => ({ ...s, order_index: idx }));

      setSlidesByTheme((prev) => ({
        ...prev,
        [currentTheme.id]: remaining,
      }));
      if (selectedSlideId === slide.id) {
        setSelectedSlideId(remaining[0]?.id || null);
      }
      showToast('Slajd odstranjen.');
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Napaka pri brisanju slajda.'
      );
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 flex flex-col items-center justify-center gap-3 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        <p className="text-sm font-medium">Nalaganje urejevalnika kviza...</p>
      </div>
    );
  }

  if (!quiz) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center space-y-4">
        <p className="text-rose-400">Kviz ni bil najden.</p>
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-sm"
        >
          Nazaj na nadzorno ploščo
        </button>
      </div>
    );
  }

  const hasIntroSlideInCurrentTheme = currentSlides.some(
    (s) => s.slide_type === 'theme_intro'
  );

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Zgornja vrstica urejevalnika kviza */}
      <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 flex-1">
          <button
            id="back-to-dashboard-btn"
            onClick={async () => {
              if (quiz) {
                try {
                  const currentSlidesMap: Record<string, Slide[]> = { ...slidesByTheme };
                  if (currentTheme && currentSlide) {
                    currentSlidesMap[currentTheme.id] = (currentSlidesMap[currentTheme.id] || []).map((s) =>
                      s.id === currentSlide.id ? currentSlide : s
                    );
                  }
                  await upsertFullQuiz(quiz, themes, currentSlidesMap);
                } catch {
                  // nadaljuj nazaj
                }
              }
              onBack();
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-slate-800 text-slate-200 border border-slate-700/80 transition-colors self-start sm:self-auto cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Moji kvizi</span>
          </button>

          <div className="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
            <div className="sm:col-span-8">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Naslov kviza
              </label>
              <input
                id="quiz-builder-title-input"
                type="text"
                value={quiz.title}
                onChange={(e) => setQuiz({ ...quiz, title: e.target.value })}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-950/90 border border-slate-800 text-slate-100 font-semibold text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="sm:col-span-4">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Max Jokerjev / igralca
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="quiz-builder-jokers-input"
                  type="number"
                  min={0}
                  max={10}
                  value={quiz.max_jokers_per_player}
                  onChange={(e) =>
                    setQuiz({
                      ...quiz,
                      max_jokers_per_player: Math.max(
                        0,
                        parseInt(e.target.value || '0', 10)
                      ),
                    })
                  }
                  className="w-24 px-3 py-2 rounded-xl bg-slate-950/90 border border-slate-800 text-emerald-400 font-bold text-sm focus:outline-none focus:border-indigo-500"
                />
                <button
                  id="save-quiz-meta-btn"
                  onClick={handleSaveFullQuiz}
                  disabled={savingQuizMeta}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
                >
                  {savingQuizMeta ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>{savingQuizMeta ? 'Shranjevanje v bazo...' : 'Shrani kviz'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {saveToast && (
          <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{saveToast}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="underline hover:text-white"
          >
            Zapri
          </button>
        </div>
      )}

      {/* Napredek pretvorbe PDF-ja ali nalaganja slik */}
      {uploadStatus.active && (
        <div className="bg-indigo-950/60 backdrop-blur-xl border border-indigo-500/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-indigo-100">
                {uploadStatus.message}
              </p>
              <p className="text-xs text-indigo-300">
                Vsaka stran se samodejno pretvori v sliko in shrani v Supabase Storage bucket{' '}
                <code>slides</code> (oz. stisnjeno sliko v bazi).
              </p>
            </div>
          </div>
          <div className="w-full sm:w-56 bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800">
            <div
              className="bg-gradient-to-r from-indigo-500 to-emerald-400 h-full transition-all duration-300"
              style={{
                width: `${Math.round(
                  (uploadStatus.current / Math.max(1, uploadStatus.total)) * 100
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Glavna 3-stopenjska postavitev: 1. Tematike, 2. Slajdi v temi + PDF uvoz, 3. Urejevalnik izbranega slajda */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEVI STOLPEC: Tematike / Sklopi (3 cols) */}
        <div className="lg:col-span-3 bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
              1. Tematike (Sklopi)
            </h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
              {themes.length}
            </span>
          </div>

          <div className="space-y-2">
            {themes.map((theme, idx) => {
              const isSelected = theme.id === selectedThemeId;
              const tSlides = slidesByTheme[theme.id] || [];
              const hasIntro = tSlides.some((s) => s.slide_type === 'theme_intro');

              return (
                <div
                  key={theme.id}
                  onClick={() => {
                    setSelectedThemeId(theme.id);
                    const firstS = (slidesByTheme[theme.id] || [])[0];
                    setSelectedSlideId(firstS?.id || null);
                  }}
                  className={`group p-3 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600/15 border-indigo-500/60 shadow-lg shadow-indigo-950/40'
                      : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono-code font-bold text-indigo-400">
                          #{idx + 1}
                        </span>
                        <p className="text-sm font-semibold text-slate-100 truncate">
                          {theme.title}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                        <span>{tSlides.length} slajdov</span>
                        {hasIntro && (
                          <span className="inline-flex items-center gap-1 text-amber-300 font-medium">
                            <Sparkles className="w-3 h-3" />
                            Joker intro
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTheme(theme);
                      }}
                      title="Izbriši tematiko"
                      className="opacity-70 group-hover:opacity-100 p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Obrazec za dodajanje nove tematike */}
          <form
            onSubmit={handleAddTheme}
            className="pt-3 border-t border-slate-800/80 space-y-2.5"
          >
            <label className="block text-xs font-semibold text-slate-400">
              Dodaj nov sklop / tematiko
            </label>
            <input
              id="new-theme-title-input"
              type="text"
              value={newThemeTitle}
              onChange={(e) => setNewThemeTitle(e.target.value)}
              placeholder={`npr. ${themes.length + 1}. sklop: Šport`}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
            <button
              id="add-theme-btn"
              type="submit"
              disabled={addingTheme}
              className="w-full py-2.5 px-3 rounded-xl text-xs font-semibold bg-indigo-600/20 hover:bg-indigo-600/30 disabled:opacity-60 text-indigo-300 border border-indigo-500/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              {addingTheme ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FolderPlus className="w-3.5 h-3.5" />
              )}
              <span>{addingTheme ? 'Dodajanje...' : 'Dodaj tematiko'}</span>
            </button>
          </form>
        </div>

        {/* SREDNJI STOLPEC: Slajdi v izbrani tematiki & PDF / Slikovni uvoz (4 cols) */}
        <div className="lg:col-span-4 bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 space-y-4">
          {currentTheme ? (
            <>
              {/* Urejanje imena trenutne tematike */}
              <div className="space-y-2 pb-3 border-b border-slate-800/80">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Ime izbrane tematike
                </label>
                <input
                  id="current-theme-title-input"
                  type="text"
                  value={currentTheme.title}
                  onChange={(e) => handleUpdateThemeTitle(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-semibold text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Gumba za uvoz PDF predstavitve ali posameznih slik */}
              <div className="space-y-2">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Uvozi slajde v to tematiko (Supabase Storage &apos;slides&apos;)
                </span>
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    ref={pdfInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={handlePdfUpload}
                    className="hidden"
                  />
                  <button
                    id="upload-pdf-slides-btn"
                    type="button"
                    onClick={() => pdfInputRef.current?.click()}
                    disabled={uploadStatus.active}
                    className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/40 text-indigo-200 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <FileSpreadsheet className="w-5 h-5 text-indigo-400" />
                    <span className="text-xs font-semibold">Naloži PDF sklop</span>
                    <span className="text-[10px] text-slate-400">
                      Samodejni razrez strani
                    </span>
                  </button>

                  <input
                    ref={imagesInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImagesUpload}
                    className="hidden"
                  />
                  <button
                    id="upload-images-slides-btn"
                    type="button"
                    onClick={() => imagesInputRef.current?.click()}
                    disabled={uploadStatus.active}
                    className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-200 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <ImageIcon className="w-5 h-5 text-emerald-400" />
                    <span className="text-xs font-semibold">Naloži slike</span>
                    <span className="text-[10px] text-slate-400">
                      PNG / JPG slajdi
                    </span>
                  </button>
                </div>
              </div>

              {/* Opozorilo za Jokerja, če tematika nima 'theme_intro' slajda */}
              {!hasIntroSlideInCurrentTheme && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between gap-2">
                  <span>
                    Ta tematika še nima naslovnega <code>theme_intro</code> slajda za
                    vklop Jokerja!
                  </span>
                  <button
                    type="button"
                    disabled={addingSlide}
                    onClick={() => handleAddBlankSlide('theme_intro')}
                    className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold cursor-pointer"
                  >
                    + Dodaj Intro
                  </button>
                </div>
              )}

              {/* Seznam slajdov v trenutni tematiki */}
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {currentSlides.map((slide, idx) => {
                  const meta = SLIDE_TYPE_META[slide.slide_type] || SLIDE_TYPE_META.multiple_choice;
                  const Icon = meta.icon;
                  const isSelected = currentSlide?.id === slide.id;
                  const hasParts = Boolean(
                    slide.question_parts && slide.question_parts.length > 0
                  );

                  return (
                    <div
                      key={slide.id}
                      onClick={() => setSelectedSlideId(slide.id)}
                      className={`p-2.5 rounded-xl border transition-all flex items-center gap-3 cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-600/20 border-indigo-500 shadow-md'
                          : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      {/* Sličica slajda */}
                      <div className="w-20 h-12 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center relative">
                        {slide.slide_image_url ? (
                          <img
                            src={slide.slide_image_url}
                            alt={`Slajd ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Icon className="w-5 h-5 text-slate-600" />
                        )}
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.2 rounded bg-slate-950/85 text-[10px] font-mono-code font-bold text-slate-300">
                          #{idx + 1}
                        </span>
                      </div>

                      {/* Podatki o slajdu */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {hasParts ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30">
                              <Layers className="w-3 h-3" />
                              <span>Večdelno ({slide.question_parts!.length} deli)</span>
                            </span>
                          ) : (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${meta.badgeClass}`}
                            >
                              <Icon className="w-3 h-3" />
                              <span>{meta.shortLabel}</span>
                            </span>
                          )}
                          {slide.slide_type !== 'theme_intro' &&
                            slide.slide_type !== 'info_only' && (
                              <span className="text-[10px] text-emerald-400 font-semibold">
                                {roundPoints(slide.points)} t
                              </span>
                            )}
                          {slide.question_parts?.some((p) => p.is_bonus) && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold">
                              ⭐ Bonus
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-300 truncate">
                          {slide.question_text || (
                            <span className="italic text-slate-500">
                              Vprašanje je na sliki slajda
                            </span>
                          )}
                        </p>
                      </div>

                      {/* Premik gor/dol in izbris */}
                      <div
                        className="flex flex-col items-center gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveSlide(idx, 'up')}
                          className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-25"
                          title="Premakni gor"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === currentSlides.length - 1}
                          onClick={() => handleMoveSlide(idx, 'down')}
                          className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-25"
                          title="Premakni dol"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Ročno dodajanje slajda */}
              <div className="pt-2 border-t border-slate-800/80 flex gap-2">
                <button
                  id="add-blank-slide-btn"
                  type="button"
                  disabled={addingSlide}
                  onClick={() => handleAddBlankSlide('multiple_choice')}
                  className="flex-1 py-2.5 px-3 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-slate-200 border border-slate-700 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  {addingSlide ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  ) : (
                    <Plus className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  <span>{addingSlide ? 'Dodajanje slajda...' : 'Dodaj prazen slajd'}</span>
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-400">
              Izberite ali ustvarite tematiko na levi strani.
            </p>
          )}
        </div>

        {/* DESNI STOLPEC: Podrobne nastavitve izbranega slajda (5 cols) */}
        <div className="lg:col-span-5 bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-6">
          {currentSlide ? (
            <form onSubmit={handleSaveCurrentSlide} className="space-y-5">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800">
                <div>
                  <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                    Slajd #{currentSlide.order_index + 1} v sklopu
                  </span>
                  <h3 className="text-lg font-bold text-slate-100">
                    Nastavitve slajda in odgovorov
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDeleteSlide(currentSlide)}
                    className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                    title="Izbriši ta slajd"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button
                    id="save-slide-settings-btn"
                    type="submit"
                    disabled={savingSlide}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
                  >
                    {savingSlide ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>{savingSlide ? 'Shranjevanje...' : 'Shrani slajd'}</span>
                  </button>
                </div>
              </div>

              {/* Predogled slike slajda in menjava slike */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Vizualni predogled slajda
                  </label>
                  <input
                    ref={singleSlideImageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleSingleSlideImageReplace}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => singleSlideImageInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer"
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    <span>
                      {currentSlide.slide_image_url
                        ? 'Zamenjaj sliko slajda'
                        : 'Naloži sliko slajda'}
                    </span>
                  </button>
                </div>

                <div className="aspect-video w-full rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center relative">
                  {currentSlide.slide_image_url ? (
                    <img
                      src={currentSlide.slide_image_url}
                      alt="Slajd predogled"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="text-center p-6 space-y-2">
                      <ImageIcon className="w-8 h-8 text-slate-600 mx-auto" />
                      <p className="text-xs text-slate-400 font-medium">
                        Slajd nima naložene slike (prikazano bo besedilo vprašanja spodaj)
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Naložite PDF sklop na sredini ali kliknite &ldquo;Naloži sliko slajda&rdquo;.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Izbira tipa slajda */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Tip slajda (slide_type)
                </label>
                <select
                  id="slide-type-select"
                  value={currentSlide.slide_type}
                  onChange={(e) => {
                    const nextType = e.target.value as SlideType;
                    updateLocalSlideField('slide_type', nextType);
                    if (nextType === 'theme_intro' || nextType === 'info_only') {
                      updateLocalSlideField('points', 0);
                      updateLocalQuestionParts(null);
                    } else if (currentSlide.points === 0) {
                      updateLocalSlideField('points', 1);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm font-semibold text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  {(Object.keys(SLIDE_TYPE_META) as SlideType[]).map((t) => (
                    <option key={t} value={t}>
                      {SLIDE_TYPE_META[t].label}
                    </option>
                  ))}
                </select>

                <div
                  className={`p-3 rounded-xl border text-xs leading-relaxed ${
                    (SLIDE_TYPE_META[currentSlide.slide_type] || SLIDE_TYPE_META.multiple_choice).badgeClass
                  }`}
                >
                  {(SLIDE_TYPE_META[currentSlide.slide_type] || SLIDE_TYPE_META.multiple_choice).description}
                </div>
              </div>

              {/* Besedilo vprašanja (opcijsko, če je že na slajdu) */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Besedilo vprašanja / opomba (opcijsko, če je že na slajdu)
                </label>
                <textarea
                  id="slide-question-text-input"
                  rows={2}
                  value={currentSlide.question_text}
                  onChange={(e) =>
                    updateLocalSlideField('question_text', e.target.value)
                  }
                  placeholder="Vpišite vprašanje ali pustite prazno, če je vprašanje že na sliki PDF slajda..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Če slajd NI theme_intro ali info_only: klasični odgovor ALI večdelno vprašanje */}
              {currentSlide.slide_type !== 'theme_intro' &&
                currentSlide.slide_type !== 'info_only' && (
                  <>
                    {/* Če slajd NIMA večdelnih vprašanj, prikaži klasično polje za odgovor */}
                    {(!currentSlide.question_parts ||
                      currentSlide.question_parts.length === 0) && (
                      <>
                        {currentSlide.slide_type === 'multiple_choice' && (
                          <div className="space-y-3 p-4 rounded-2xl bg-slate-950/70 border border-slate-800">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
                                Možni odgovori (A / B / C / D) &amp; Pravilen odgovor
                              </span>
                              <span className="text-[11px] text-slate-400">
                                Kliknite črko za označitev pravilnega
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {(['A', 'B', 'C', 'D'] as const).map((letter) => {
                                const isCorrect =
                                  currentSlide.correct_answer === letter ||
                                  Boolean(
                                    currentSlide.correct_answer
                                      ?.trim()
                                      .toUpperCase()
                                      .startsWith(letter)
                                  );
                                return (
                                  <div
                                    key={letter}
                                    className={`flex items-center gap-2 p-2 rounded-xl border transition-all ${
                                      isCorrect
                                        ? 'bg-emerald-500/15 border-emerald-500/50'
                                        : 'bg-slate-900/90 border-slate-800'
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateLocalSlideField('correct_answer', letter)
                                      }
                                      className={`w-8 h-8 rounded-lg font-bold text-xs flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                                        isCorrect
                                          ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30'
                                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                      }`}
                                      title={`Označi ${letter} kot pravilen odgovor`}
                                    >
                                      {isCorrect ? <Check className="w-4 h-4" /> : letter}
                                    </button>
                                    <input
                                      type="text"
                                      value={currentSlide.options[letter] || ''}
                                      onChange={(e) =>
                                        updateLocalSlideOption(letter, e.target.value)
                                      }
                                      placeholder={`Odgovor ${letter} (opcijsko)`}
                                      className="w-full bg-transparent text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {currentSlide.slide_type === 'open_text' && (
                          <div>
                            <label className="block text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-1.5">
                              Pravilen odgovor (besedilo)
                            </label>
                            <input
                              id="slide-correct-open-text-input"
                              type="text"
                              value={currentSlide.correct_answer}
                              onChange={(e) =>
                                updateLocalSlideField('correct_answer', e.target.value)
                              }
                              placeholder="npr. Ljubljana"
                              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                            />
                          </div>
                        )}

                        {currentSlide.slide_type === 'closest_number' && (
                          <div>
                            <label className="block text-xs font-semibold uppercase tracking-wider text-violet-400 mb-1.5">
                              Pravilna številka (closest_number)
                            </label>
                            <input
                              id="slide-correct-number-input"
                              type="number"
                              step="any"
                              value={currentSlide.correct_answer}
                              onChange={(e) =>
                                updateLocalSlideField('correct_answer', e.target.value)
                              }
                              placeholder="npr. 1999"
                              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono-code text-slate-100 placeholder-slate-600 focus:outline-none focus:border-violet-500"
                            />
                          </div>
                        )}

                        {currentSlide.slide_type === 'closest_date' && (
                          <div className="space-y-1.5">
                            <label className="block text-xs font-semibold uppercase tracking-wider text-cyan-400">
                              Pravilen datum (closest_date)
                            </label>
                            <input
                              id="slide-correct-date-input"
                              type="date"
                              value={currentSlide.correct_answer}
                              onChange={(e) =>
                                updateLocalSlideField('correct_answer', e.target.value)
                              }
                              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono-code text-slate-100 focus:outline-none focus:border-cyan-500"
                            />
                            {currentSlide.correct_answer && (
                              <p className="text-xs text-cyan-300 font-semibold">
                                📅 Izbrani ciljni datum: {formatSloveneDate(currentSlide.correct_answer)}
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    )}

                    {/* VEČDELNA VPRAŠANJA IN BONUS VPRAŠANJA (question_parts) */}
                    <div className="space-y-3 pt-2 border-t border-slate-800/80">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <Layers className="w-4 h-4 text-fuchsia-400" />
                          <span className="text-xs font-bold uppercase tracking-wider text-fuchsia-300">
                            Podvprašanja &amp; ⭐ Bonus vprašanje na slajdu
                          </span>
                        </div>
                        {currentSlide.question_parts &&
                          currentSlide.question_parts.length > 0 && (
                            <button
                              type="button"
                              onClick={() => updateLocalQuestionParts(null)}
                              className="text-[11px] text-slate-400 hover:text-rose-400 underline cursor-pointer"
                            >
                              Preklopi nazaj na enodelno vprašanje
                            </button>
                          )}
                      </div>

                      {currentSlide.question_parts &&
                        currentSlide.question_parts.length > 0 && (
                          <div className="space-y-3">
                            {currentSlide.question_parts.map((part, pIdx) => {
                              const partOpts = part.options || ['', '', '', ''];
                              const isBonusPart = Boolean(part.is_bonus);
                              return (
                                <div
                                  key={part.id}
                                  className={`p-3.5 rounded-2xl space-y-3 border transition-all ${
                                    isBonusPart
                                      ? 'bg-amber-500/10 border-amber-500/50 shadow-md shadow-amber-950/30'
                                      : 'bg-slate-950/90 border-fuchsia-500/30'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span
                                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${
                                          isBonusPart
                                            ? 'bg-amber-500 text-slate-950 border-amber-400'
                                            : 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30'
                                        }`}
                                      >
                                        {isBonusPart
                                          ? '⭐ BONUS VPRAŠANJE'
                                          : `Del #${pIdx + 1}`}
                                      </span>
                                      <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-200 cursor-pointer select-none px-2 py-0.5 rounded-lg bg-slate-900/90 border border-amber-500/30 hover:border-amber-400">
                                        <input
                                          type="checkbox"
                                          checked={isBonusPart}
                                          onChange={(e) => {
                                            const checked = e.target.checked;
                                            handleUpdateQuestionPart(part.id, {
                                              is_bonus: checked,
                                              label:
                                                checked &&
                                                (!part.label ||
                                                  part.label.startsWith('Del '))
                                                  ? 'Bonus vprašanje'
                                                  : !checked &&
                                                    part.label === 'Bonus vprašanje'
                                                  ? `Del ${pIdx + 1}`
                                                  : part.label,
                                            });
                                          }}
                                          className="rounded border-amber-500 text-amber-500 focus:ring-amber-500 cursor-pointer"
                                        />
                                        <span>
                                          ⭐ Bonus vprašanje (točke se ne podvojijo z Jokerjem)
                                        </span>
                                      </label>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveQuestionPart(part.id)}
                                      className="inline-flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      <span>Odstrani del</span>
                                    </button>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                                    <div className="sm:col-span-5">
                                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                                        {isBonusPart
                                          ? 'Besedilo / oznaka bonus vprašanja'
                                          : 'Oznaka / podvprašanje'}
                                      </label>
                                      <input
                                        type="text"
                                        value={part.label}
                                        onChange={(e) =>
                                          handleUpdateQuestionPart(part.id, {
                                            label: e.target.value,
                                          })
                                        }
                                        placeholder={
                                          isBonusPart
                                            ? 'npr. Bonus: Kdo je zložil glasbo?'
                                            : `npr. Del ${pIdx + 1}: Ime dogodka`
                                        }
                                        className={`w-full px-3 py-2 rounded-xl bg-slate-900 border text-xs font-semibold text-slate-100 focus:outline-none ${
                                          isBonusPart
                                            ? 'border-amber-500/40 focus:border-amber-400'
                                            : 'border-slate-800 focus:border-fuchsia-500'
                                        }`}
                                      />
                                    </div>

                                    <div className="sm:col-span-4">
                                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                                        Tip odgovora
                                      </label>
                                      <select
                                        value={part.type}
                                        onChange={(e) =>
                                          handleUpdateQuestionPart(part.id, {
                                            type: e.target.value as QuestionPartType,
                                          })
                                        }
                                        className="w-full px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-100 focus:outline-none focus:border-fuchsia-500"
                                      >
                                        <option value="open_text">Odprto besedilo</option>
                                        <option value="multiple_choice">Izbirni A/B/C/D</option>
                                        <option value="closest_number">Številka (najbližji)</option>
                                        <option value="closest_date">Datum (najbližji)</option>
                                      </select>
                                    </div>

                                    <div className="sm:col-span-3">
                                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                                        {isBonusPart ? '⭐ Bonus točke' : 'Točke za ta del'}
                                      </label>
                                      <input
                                        type="number"
                                        min={0}
                                        step="0.25"
                                        value={part.points}
                                        onChange={(e) =>
                                          handleUpdateQuestionPart(part.id, {
                                            points: Math.max(
                                              0,
                                              roundPoints(parseFloat(e.target.value || '0'))
                                            ),
                                          })
                                        }
                                        className={`w-full px-2.5 py-2 rounded-xl bg-slate-900 border text-xs font-bold focus:outline-none ${
                                          isBonusPart
                                            ? 'border-amber-500/40 text-amber-300 focus:border-amber-400'
                                            : 'border-slate-800 text-emerald-400 focus:border-fuchsia-500'
                                        }`}
                                      />
                                    </div>
                                  </div>

                                  {part.type === 'multiple_choice' && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                      {(['A', 'B', 'C', 'D'] as const).map((letter, lIdx) => {
                                        const isCorr =
                                          part.correct_answer.trim().toUpperCase() === letter;
                                        return (
                                          <div
                                            key={letter}
                                            className={`flex items-center gap-2 p-2 rounded-xl border ${
                                              isCorr
                                                ? 'bg-emerald-500/15 border-emerald-500/50'
                                                : 'bg-slate-900 border-slate-800'
                                            }`}
                                          >
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleUpdateQuestionPart(part.id, {
                                                  correct_answer: letter,
                                                })
                                              }
                                              className={`w-7 h-7 rounded-lg font-bold text-xs flex items-center justify-center shrink-0 cursor-pointer ${
                                                isCorr
                                                  ? 'bg-emerald-500 text-slate-950'
                                                  : 'bg-slate-800 text-slate-300'
                                              }`}
                                            >
                                              {isCorr ? <Check className="w-3.5 h-3.5" /> : letter}
                                            </button>
                                            <input
                                              type="text"
                                              value={partOpts[lIdx] || ''}
                                              onChange={(e) => {
                                                const nextOpts = [
                                                  partOpts[0] || '',
                                                  partOpts[1] || '',
                                                  partOpts[2] || '',
                                                  partOpts[3] || '',
                                                ];
                                                nextOpts[lIdx] = e.target.value;
                                                handleUpdateQuestionPart(part.id, {
                                                  options: nextOpts,
                                                });
                                              }}
                                              placeholder={`Možnost ${letter}`}
                                              className="w-full bg-transparent text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
                                            />
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {part.type === 'open_text' && (
                                    <div>
                                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-emerald-400 mb-1">
                                        Pravilen odgovor za {part.label || `Del #${pIdx + 1}`}
                                      </label>
                                      <input
                                        type="text"
                                        value={part.correct_answer}
                                        onChange={(e) =>
                                          handleUpdateQuestionPart(part.id, {
                                            correct_answer: e.target.value,
                                          })
                                        }
                                        placeholder="Vpišite pravilen besedilni odgovor..."
                                        className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                                      />
                                    </div>
                                  )}

                                  {part.type === 'closest_number' && (
                                    <div>
                                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-violet-400 mb-1">
                                        Pravilna številka za {part.label || `Del #${pIdx + 1}`}
                                      </label>
                                      <input
                                        type="number"
                                        step="any"
                                        value={part.correct_answer}
                                        onChange={(e) =>
                                          handleUpdateQuestionPart(part.id, {
                                            correct_answer: e.target.value,
                                          })
                                        }
                                        placeholder="npr. 1991"
                                        className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono-code text-slate-100 focus:outline-none focus:border-violet-500"
                                      />
                                    </div>
                                  )}

                                  {part.type === 'closest_date' && (
                                    <div className="space-y-1">
                                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
                                        Pravilen datum za {part.label || `Del #${pIdx + 1}`}
                                      </label>
                                      <input
                                        type="date"
                                        value={part.correct_answer}
                                        onChange={(e) =>
                                          handleUpdateQuestionPart(part.id, {
                                            correct_answer: e.target.value,
                                          })
                                        }
                                        className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono-code text-slate-100 focus:outline-none focus:border-cyan-500"
                                      />
                                      {part.correct_answer && (
                                        <p className="text-[11px] text-cyan-300 font-semibold">
                                          📅 Izbrano: {formatSloveneDate(part.correct_answer)}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <button
                          id="add-question-part-btn"
                          type="button"
                          onClick={() => handleAddQuestionPart(false)}
                          className="w-full py-2.5 px-3 rounded-xl text-xs font-semibold bg-fuchsia-500/15 hover:bg-fuchsia-500/25 text-fuchsia-200 border border-fuchsia-500/35 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                        >
                          <Plus className="w-4 h-4 text-fuchsia-300 shrink-0" />
                          <span>+ Dodaj dodaten del vprašanja (podvprašanje)</span>
                        </button>

                        <button
                          id="add-bonus-question-part-btn"
                          type="button"
                          onClick={() => handleAddQuestionPart(true)}
                          className="w-full py-2.5 px-3 rounded-xl text-xs font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/50 flex items-center justify-center gap-1.5 shadow-md shadow-amber-950/30 transition-all cursor-pointer"
                        >
                          <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
                          <span>+ ⭐ Dodaj bonus vprašanje (ne šteje v 2x Joker)</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}

              {/* Točke in časovnik */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Trophy className="w-3.5 h-3.5 text-emerald-400" />
                    <span>
                      {currentSlide.question_parts &&
                      currentSlide.question_parts.length > 0
                        ? 'Redne točke slajda (brez bonus vprašanja)'
                        : 'Točke za pravilen odgovor'}
                    </span>
                  </label>
                  <input
                    id="slide-points-input"
                    type="number"
                    min={0}
                    step="0.25"
                    disabled={Boolean(
                      currentSlide.question_parts &&
                        currentSlide.question_parts.length > 0
                    )}
                    value={currentSlide.points}
                    onChange={(e) =>
                      updateLocalSlideField(
                        'points',
                        Math.max(0, roundPoints(parseFloat(e.target.value || '0')))
                      )
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm font-bold text-emerald-400 disabled:opacity-70 focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-[11px] text-slate-500">
                    Korak 0.25 točke. Ob aktiviranem Jokerju v tej temi se podvojijo (2x) samo redne točke, ⭐ bonus vprašanje pa ne.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Časovnik (v sekundah)</span>
                  </label>
                  <input
                    id="slide-timer-input"
                    type="number"
                    min={0}
                    max={600}
                    value={currentSlide.timer_seconds}
                    onChange={(e) =>
                      updateLocalSlideField(
                        'timer_seconds',
                        Math.max(0, parseInt(e.target.value || '0', 10))
                      )
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm font-bold text-indigo-300 focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-[11px] text-slate-500">
                    0 = brez časovne omejitve (ročno menjavanje gostitelja).
                  </p>
                </div>
              </div>
            </form>
          ) : (
            <div className="py-12 text-center space-y-3">
              <p className="text-sm text-slate-400">
                V tej tematiki še ni slajdov. Naložite PDF datoteko ali dodajte slajd.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
