import { InlineKeyboard } from "grammy";
import {
  defineDialog,
  defineWindow,
  type WindowActionHandler,
} from "@bionicsv/grammy-dialogs";
import type { QuizKeys } from "../translations.js";

// ─── Модель ─────────────────────────────────────────────────────────────────
interface Question {
  id: string;
  image: string;
  textKey: QuizKeys;
  options: { id: string; label: string; correct: boolean }[];
}

const QUESTIONS: readonly Question[] = [
  {
    id: "q1",
    image: "https://picsum.photos/seed/mammal/800/400",
    textKey: "q1_text",
    options: [
      { id: "a", label: "Кенгуру", correct: true },
      { id: "b", label: "Крокодил", correct: false },
      { id: "c", label: "Орёл", correct: false },
    ],
  },
  {
    id: "q2",
    image: "https://picsum.photos/seed/canberra/800/400",
    textKey: "q2_text",
    options: [
      { id: "a", label: "Сидней", correct: false },
      { id: "b", label: "Канберра", correct: true },
      { id: "c", label: "Мельбурн", correct: false },
    ],
  },
  {
    id: "q3",
    image: "https://picsum.photos/seed/pacific/800/400",
    textKey: "q3_text",
    options: [
      { id: "a", label: "Атлантический", correct: false },
      { id: "b", label: "Индийский", correct: false },
      { id: "c", label: "Тихий", correct: true },
    ],
  },
];

// ─── Типы ───────────────────────────────────────────────────────────────────
interface QuizState {
  answers: Record<string, string>;
  step?: number;
}

type QuizId = "welcome" | "question" | "summary" | "result" | "confirm";

/** Результаты разных окон одного диалога — размеченное объединение. */
type QuizResult =
  | { kind: "answer"; step: number; answer: string }
  | { kind: "restart" };

type Action = WindowActionHandler<QuizState, QuizId, QuizKeys>;

// ─── Диалог ─────────────────────────────────────────────────────────────────
export function createQuizDialog() {
  const win = defineWindow<
    QuizState,
    QuizId,
    QuizKeys,
    {
      start: { step: number };
      result: QuizResult | undefined;
    }
  >();

  const answerActions: Record<string, Action> = {};
  for (const optId of new Set(
    QUESTIONS.flatMap((q) => q.options.map((o) => o.id)),
  )) {
    answerActions[`answer_${optId}`] = async (ctx, m) => {
      const step = ctx.data.step ?? 0;
      await m.done(ctx, {
        kind: "answer",
        step,
        answer: optId,
      } satisfies QuizResult);
    };
  }

  const editActions: Record<string, Action> = {};
  QUESTIONS.forEach((_, i) => {
    editActions[`edit_${i}`] = (ctx, m) =>
      m.startDialog(ctx, "quiz", { entry: "question", startData: { step: i } });
  });

  return defineDialog<
    QuizState,
    QuizId,
    QuizKeys,
    {
      start: { step: number };
      result: QuizResult | undefined;
    }
  >({
    id: "quiz",
    initialData: () => ({ answers: {} }),
    windows: [
      {
        id: "welcome",
        disableBackButton: true,
        render: (_ctx, t) => ({
          text: t("welcome_text"),
          keyboard: new InlineKeyboard().text(t("btn_start"), "start"),
        }),
        actions: {
          start: (ctx, m) =>
            m.startDialog(ctx, "quiz", {
              entry: "question",
              startData: { step: 0 },
            }),
        },
        onDialogResult: (ctx, m, _t, result) => {
          if (result?.kind !== "answer") return m.show(ctx);

          ctx.data.answers[QUESTIONS[result.step].id] = result.answer;
          const nextStep = result.step + 1;
          if (nextStep < QUESTIONS.length) {
            return m.startDialog(ctx, "quiz", {
              entry: "question",
              startData: { step: nextStep },
            });
          }
          return m.goTo(ctx, "summary");
        },
      },

      win({
        id: "question",
        onEnter: (ctx, _m, _t, startData) => {
          ctx.data.step = startData.step;
        },
        render: (ctx, t) => {
          const q = QUESTIONS[ctx.data.step ?? 0];

          const keyboard = new InlineKeyboard();
          for (const opt of q.options) {
            keyboard.text(opt.label, `answer_${opt.id}`).row();
          }

          return {
            kind: "photo",
            photo: q.image,
            caption: t(q.textKey),
            keyboard,
          };
        },
        actions: answerActions,
      }),

      {
        id: "summary",
        disableBackButton: true,
        render: (ctx, t) => {
          const keyboard = new InlineKeyboard();

          QUESTIONS.forEach((q, i) => {
            const picked = ctx.data.answers[q.id];
            const label = picked
              ? (q.options.find((o) => o.id === picked)?.label ?? picked)
              : "—";
            keyboard
              .text(`${i + 1}. ${t(q.textKey)}: ${label}`, "noop")
              .text(t("btn_edit"), `edit_${i}`)
              .row();
          });

          keyboard.text(t("btn_submit"), "submit");
          return { text: t("summary_title"), keyboard };
        },
        actions: {
          noop: (ctx, m) => m.show(ctx),
          ...editActions,
          submit: (ctx, m) => m.goTo(ctx, "result"),
        },
        onDialogResult: async (ctx, m, _t, result) => {
          if (result?.kind === "answer") {
            ctx.data.answers[QUESTIONS[result.step].id] = result.answer;
          }
          await m.show(ctx);
        },
      },

      {
        id: "result",
        disableBackButton: true,
        render: (ctx, t) => {
          const correct = QUESTIONS.filter((q) => {
            const picked = ctx.data.answers[q.id];
            return picked && q.options.find((o) => o.id === picked)?.correct;
          }).length;

          return {
            text: `${t("result_title")}\n\n${t("result_score", {
              correct: String(correct),
              total: String(QUESTIONS.length),
            })}`,
            keyboard: new InlineKeyboard()
              .text(t("btn_restart"), "restart")
              .row()
              .text(t("btn_to_menu"), "to_menu"),
          };
        },
        actions: {
          restart: (ctx, m) => m.startDialog(ctx, "quiz", { entry: "confirm" }),
          to_menu: (ctx, m) => m.done(ctx),
        },
        onDialogResult: async (ctx, m, _t, result) => {
          if (result?.kind === "restart") {
            await m.restart(ctx, "quiz");
            return;
          }
          await m.show(ctx);
        },
      },

      {
        id: "confirm",
        disableBackButton: true,
        render: (_ctx, t) => ({
          text: t("confirm_text"),
          keyboard: new InlineKeyboard()
            .text(t("btn_confirm_restart"), "do_restart")
            .row()
            .text(t("btn_cancel"), "cancel"),
        }),
        actions: {
          do_restart: (ctx, m) =>
            m.done(ctx, { kind: "restart" } satisfies QuizResult),
          cancel: (ctx, m) => m.done(ctx),
        },
      },
    ],
  });
}

export { QUESTIONS };
