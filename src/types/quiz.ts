export type SlideType =
  | 'theme_intro'
  | 'info_only'
  | 'multiple_choice'
  | 'open_text'
  | 'closest_number';

export type GameSessionStatus =
  | 'lobby'
  | 'theme_intro'
  | 'active_theme'
  | 'grading_theme'
  | 'leaderboard'
  | 'finished';

export interface SlideOptions {
  A: string;
  B: string;
  C: string;
  D: string;
}

export interface Quiz {
  id: string;
  host_id: string;
  title: string;
  max_jokers_per_player: number;
  created_at: string;
}

export interface Theme {
  id: string;
  quiz_id: string;
  title: string;
  order_index: number;
}

export interface Slide {
  id: string;
  theme_id: string;
  order_index: number;
  slide_image_url: string | null;
  slide_type: SlideType;
  question_text: string;
  options: SlideOptions;
  correct_answer: string;
  points: number;
  timer_seconds: number;
}

export interface GameSession {
  id: string;
  quiz_id: string;
  room_code: string;
  status: GameSessionStatus;
  current_theme_id: string | null;
  current_slide_id: string | null;
  max_slide_index_reached: number;
  timer_started_at: string | null;
  timer_duration: number | null;
  created_at?: string;
}

export interface Player {
  id: string;
  session_id: string;
  nickname: string;
  reconnect_token: string;
  total_score: number;
  jokers_remaining: number;
  created_at?: string;
}

export interface PlayerJoker {
  id: string;
  session_id: string;
  player_id: string;
  theme_id: string;
  created_at?: string;
}

export interface Answer {
  id: string;
  session_id: string;
  player_id: string;
  theme_id: string;
  slide_id: string;
  answer_text: string;
  is_correct: boolean;
  awarded_points: number;
  graded: boolean;
  created_at?: string;
}

export interface QuizWithStats extends Quiz {
  theme_count: number;
  slide_count: number;
}

export interface PresentationData {
  session: GameSession;
  quiz: Quiz;
  themes: Theme[];
  slidesByTheme: Record<string, Slide[]>;
  currentTheme: Theme | null;
  currentSlide: Slide | null;
  players: Player[];
  playerJokers: PlayerJoker[];
  answers: Answer[];
}

export interface PlayerFullData {
  player: Player;
  session: GameSession;
  quiz: Quiz;
  themes: Theme[];
  slidesByTheme: Record<string, Slide[]>;
  currentTheme: Theme | null;
  currentSlide: Slide | null;
  playerJokers: PlayerJoker[];
  myAnswers: Record<string, Answer>;
  leaderboard: Array<{ id: string; nickname: string; total_score: number; rank: number }>;
}
