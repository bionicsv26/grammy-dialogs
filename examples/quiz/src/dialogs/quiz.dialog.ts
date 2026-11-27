import { InlineKeyboard } from 'grammy';
import {
  defineDialog,
  defineWindow,
  type WindowActionHandler,
} from '@bionicsv/grammy-dialogs';
import type { QuizKeys } from '../translations.js';

// ─── Модель ─────────────────────────────────────────────────────────────────
interface Question {
  id: string;
  /** URL или file_id. В проде лучше file_id: Telegram не скачивает каждый раз. */
  image: string;
  textKey: QuizKeys;
  options: { id: string; label: string; correct: boolean }[];
}

const QUESTIONS: readonly Question[] = [
  {
    id: 'q1',
    image: 'https://picsum.photos/seed/mammal/800/400',
    textKey: 'q1_text',
    options: [
      { id: 'a', label: 'Кенгуру', correct: true },
      { id: 'b', label: 'Крокодил', correct: false },
      { id: 'c', label: 'Орёл', correct: false },
    ],
  },
  {
    id: 'q2',
    image: 'https://picsum.photos/seed/canberra/800/400',
    textKey: 'q2_text',
    options: [
      { id: 'a', label: 'Сидней', correct: false },
      { id: 'b', label: 'Канберра', correct: true },
      { id: 'c', label: 'Мельбурн', correct: false },
    ],
  },
  {
    id: 'q3',
    image: 'https://picsum.photos/seed/pacific/800/400',
    textKey: 'q3_text',
    options: [
      { id: 'a', label: 'Атлантический', correct: false },
      { id: 'b', label: 'Индийский', correct: false },
      { id: 'c', label: 'Тихий', correct: true },
    ],
  },
];

// ─── Типы ───────────────────────────────────────────────────────────────────
interface QuizState {
  answers: Record<string, string>; // questionId -> option.id
  step?: number;                   // только для окна question
}

type QuizId = 'welcome' | 'question' | 'summary' | 'result' | 'confirm';
type QuestionResult = { step: number; answer: string };
type Action = WindowActionHandler<QuizState, QuizId, QuizKeys>;

// ─── Диалог ─────────────────────────────────────────────────────────────────
export function createQuizDialog() {
  const win = defineWindow<QuizState, QuizId, QuizKeys>();

  // Один набор экшенов на все вопросы: обработчик читает текущий step.
  const answerActions: Record<string, Action> = {};
  for (const optId of new Set(QUESTIONS.flatMap((q) => q.options.map((o) => o.id)))) {
    answerActions[`answer_${optId}`] = async (ctx, m) => {
      const step = ctx.data.step ?? 0;
      await m.done(ctx, { step, answer: optId } satisfies QuestionResult);
    };
  }

  const editActions: Record<string, Action> = {};
  QUESTIONS.forEach((_, i) => {
    editActions[`edit_${i}`] = (ctx, m) =>
      m.startDialog(ctx, 'quiz', { entry: 'question', startData: { step: i } });
  });

  return defineDialog<QuizState, QuizId, QuizKeys>({
    id: 'quiz',
    initialData: () => ({ answers: {} }),
    windows: [
      // ── welcome ─────────────────────────────────────────────────────────
      {
        id: 'welcome',
        disableBackButton: true,
        render: (_ctx, t) => ({
          text: t('welcome_text'),
          keyboard: new InlineKeyboard().text(t('btn_start'), 'start'),
        }),
        actions: {
          start: (ctx, m) =>
            m.startDialog(ctx, 'quiz', { entry: 'question', startData: { step: 0 } }),
        },
        onDialogResult: (ctx, m, _t, result) => {
          const r = result as QuestionResult;
          ctx.data.answers[QUESTIONS[r.step].id] = r.answer;

          const nextStep = r.step + 1;
          if (nextStep < QUESTIONS.length) {
            return m.startDialog(ctx, 'quiz', {
              entry: 'question',
              startData: { step: nextStep },
            });
          }
          return m.goTo(ctx, 'summary');
        },
      },

      // ── question (запускается поверх welcome/summary) ───────────────────
      win({
        id: 'question',
        onEnter: (ctx) => {
          const sd = ctx.frame.startData as { step?: number } | undefined;
          if (typeof sd?.step === 'number') ctx.data.step = sd.step;
        },
        render: (ctx, t) => {
          const q = QUESTIONS[ctx.data.step ?? 0];

          const keyboard = new InlineKeyboard();
          for (const opt of q.options) {
            keyboard.text(opt.label, `answer_${opt.id}`).row();
          }

          return { kind: 'photo', photo: q.image, caption: t(q.textKey), keyboard };
        },
        actions: answerActions,
      }),

      // ── summary ─────────────────────────────────────────────────────────
      {
        id: 'summary',
        disableBackButton: true,
        render: (ctx, t) => {
          const keyboard = new InlineKeyboard();

          QUESTIONS.forEach((q, i) => {
            const picked = ctx.data.answers[q.id];
            const label = picked
              ? q.options.find((o) => o.id === picked)?.label ?? picked
              : '—';
            keyboard
              .text(`${i + 1}. ${t(q.textKey)}: ${label}`, 'noop')
              .text(t('btn_edit'), `edit_${i}`)
              .row();
          });

          keyboard.text(t('btn_submit'), 'submit');
          return { text: t('summary_title'), keyboard };
        },
        actions: {
          noop: (ctx, m) => m.show(ctx),
          ...editActions,
          submit: (ctx, m) => m.goTo(ctx, 'result'),
        },
        onDialogResult: async (ctx, m, _t, result) => {
          const r = result as QuestionResult;
          ctx.data.answers[QUESTIONS[r.step].id] = r.answer;
          await m.show(ctx);
        },
      },

      // ── result ──────────────────────────────────────────────────────────
      {
        id: 'result',
        disableBackButton: true,
        render: (ctx, t) => {
          const correct = QUESTIONS.filter((q) => {
            const picked = ctx.data.answers[q.id];
            return picked && q.options.find((o) => o.id === picked)?.correct;
          }).length;

          return {
            text: `${t('result_title')}\n\n${t('result_score', {
              correct: String(correct),
              total: String(QUESTIONS.length),
            })}`,
            keyboard: new InlineKeyboard()
              .text(t('btn_restart'), 'restart')
              .row()
              .text(t('btn_to_menu'), 'to_menu'),
          };
        },
        actions: {
          restart: (ctx, m) => m.startDialog(ctx, 'quiz', { entry: 'confirm' }),
          to_menu: (ctx, m) => m.done(ctx, 'to_menu'),
        },
        onDialogResult: async (ctx, m, _t, result) => {
          if (result === 'restart') {
            await m.restart(ctx, 'quiz');
            return;
          }
          await m.show(ctx);
        },
      },

      // ── confirm (вложенный запуск поверх result) ────────────────────────
      {
        id: 'confirm',
        disableBackButton: true,
        render: (_ctx, t) => ({
          text: t('confirm_text'),
          keyboard: new InlineKeyboard()
            .text(t('btn_confirm_restart'), 'do_restart')
            .row()
            .text(t('btn_cancel'), 'cancel'),
        }),
        actions: {
          do_restart: (ctx, m) => m.done(ctx, 'restart'),
          cancel: (ctx, m) => m.done(ctx),
        },
      },
    ],
  });
}

export { QUESTIONS };