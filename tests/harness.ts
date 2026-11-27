import { InlineKeyboard } from 'grammy';
import { z } from 'zod';
import {
  defineDialog,
  defineWindow,
  InputValidationError,
  type CoreTranslationKey,
  type DialogConfig,
  type DialogContext,
  type DialogLogger,
  type DialogManager,
} from '../src/core/index.js';
import { createDialogTest } from '../src/core/testing.js';

export interface TestState {
  name?: string;
  hits?: number;
}

export type TestId =
  | 'root' | 'form' | 'confirm' | 'guarded' | 'target'
  | 'cycle_a' | 'cycle_b' | 'blocked' | 'pic';

export type TestKeys =
  | 'root_text' | 'form_text' | 'confirm_text' | 'guarded_text' | 'target_text'
  | 'cycle_a_text' | 'cycle_b_text' | 'blocked_text' | 'hello_text' | 'pic_text'
  | 'btn_next' | 'btn_guard' | 'btn_noop' | 'btn_cycle' | 'btn_blocked';

export type TestCtx = DialogContext<TestState>;

export const testTranslations: Record<string, Partial<Record<TestKeys | CoreTranslationKey, string>>> = {
  ru: {
    root_text: 'Корень', form_text: 'Форма', confirm_text: 'Готово: {name}',
    guarded_text: 'Защищено', target_text: 'Цель',
    cycle_a_text: 'Цикл A', cycle_b_text: 'Цикл B', blocked_text: 'Закрыто',
    hello_text: 'Другой диалог', pic_text: 'Картинка',
    btn_next: 'Дальше', btn_guard: 'В защищённое', btn_noop: 'Обновить',
    btn_cycle: 'В цикл', btn_blocked: 'В закрытое',
    // btn_back НАМЕРЕННО отсутствует — проверяем core-дефолт
  },
  en: {
    root_text: 'Root', form_text: 'Form', confirm_text: 'Done: {name}',
    guarded_text: 'Guarded', target_text: 'Target',
    cycle_a_text: 'Cycle A', cycle_b_text: 'Cycle B', blocked_text: 'Blocked',
    hello_text: 'Other dialog', pic_text: 'Picture',
    btn_next: 'Next', btn_guard: 'To guarded', btn_noop: 'Refresh',
    btn_cycle: 'To cycle', btn_blocked: 'To blocked',
  },
};

export function baseDialogs(): readonly DialogConfig<any, any, any>[] {
  const win = defineWindow<TestState, TestId, TestKeys>();

  const main = defineDialog<TestState, TestId, TestKeys>({
    id: 'main',
    windows: [
      {
        id: 'root',
        render: (_ctx, t) => ({
          text: t('root_text'),
          keyboard: new InlineKeyboard()
            .text(t('btn_next'), 'next')
            .row()
            .text(t('btn_guard'), 'to_guarded')
            .row()
            .text(t('btn_cycle'), 'to_cycle')
            .text(t('btn_blocked'), 'to_blocked'),
        }),
        onDialogResult: async (ctx, m, _t, result) => {
          if (result === 'finish') await m.goTo(ctx, 'target');
          else await m.show(ctx);
        },
        actions: {
          next: (ctx, m) => m.goTo(ctx, 'form'),
          to_guarded: (ctx, m) => m.goTo(ctx, 'guarded'),
          to_cycle: (ctx, m) => m.goTo(ctx, 'cycle_a'),
          to_blocked: (ctx, m) => m.goTo(ctx, 'blocked'),
          refresh: (ctx, m) => m.goTo(ctx, 'root'),
          to_other: (ctx, m) => m.startDialog(ctx, 'other'),
          to_pic: (ctx, m) => m.goTo(ctx, 'pic'),
          finish_root: (ctx, m) => m.done(ctx),
          alert: async (ctx) => {
            await ctx.answerCallbackQuery({ text: 'ALERT', show_alert: true });
          },
          to_seeded: (ctx, m) => m.startDialog(ctx, 'seeded'),
          to_seeded_data: (ctx, m) =>
            m.startDialog(ctx, 'seeded', { startData: { name: 'fromStart' } }),
        },
      },
      win({
        id: 'form',
        render: (ctx, t) => ({
          text: ctx.data.error ? `ERR: ${ctx.data.error}` : t('form_text'),
        }),
        formatter: (text) => {
          if (text === 'boom') throw new Error('technical detail');
          if (text === 'bad') throw new InputValidationError('Своя ошибка');
          return text;
        },
        inputSchema: z.string().min(2, 'too short').max(10, 'too long'),
        onInput: (ctx, m, _t, value) => {
          ctx.data.name = value;
          return m.goTo(ctx, 'confirm');
        },
        actions: {
          noop: (ctx, m) => m.show(ctx),
          to_target: (ctx, m) => m.goTo(ctx, 'target'),
        },
      }),
      {
        id: 'confirm',
        render: (ctx, t) => ({ text: t('confirm_text', { name: ctx.data.name ?? '' }) }),
        actions: { open_other: (ctx, m) => m.startDialog(ctx, 'other') },
      },
      {
        id: 'guarded',
        guard: () => 'target' as const,
        render: (_ctx, t) => ({ text: t('guarded_text') }),
      },
      {
        id: 'target',
        render: (_ctx, t) => ({ text: t('target_text') }),
        actions: { to_form: (ctx, m) => m.goTo(ctx, 'form') },
      },
      {
        id: 'cycle_a',
        guard: () => 'cycle_b' as const,
        render: (_ctx, t) => ({ text: t('cycle_a_text') }),
      },
      {
        id: 'cycle_b',
        guard: () => 'cycle_a' as const,
        render: (_ctx, t) => ({ text: t('cycle_b_text') }),
      },
      {
        id: 'blocked',
        guard: () => false,
        render: (_ctx, t) => ({ text: t('blocked_text') }),
        actions: { should_not_run: (ctx) => { ctx.data.name = 'HACKED'; } },
      },
      {
        id: 'pic',
        render: (ctx, t) => ({
          kind: 'photo' as const,
          photo: 'photo-file-id',
          caption: ctx.data.name === 'swapped' ? `${t('pic_text')} 2` : t('pic_text'),
        }),
        actions: {
          swap: (ctx, m) => { ctx.data.name = 'swapped'; return m.show(ctx); },
          noop: (ctx, m) => m.show(ctx),
          to_root: (ctx, m) => m.goTo(ctx, 'root'),
        },
      },
    ],
  });

  const other = defineDialog<TestState, 'hello', TestKeys>({
    id: 'other',
    windows: [
      {
        id: 'hello',
        render: (ctx, t) => ({ text: `${t('hello_text')}: ${ctx.data.name ?? 'empty'}` }),
        actions: {
          set_name: (ctx, m) => { ctx.data.name = 'OTHER'; return m.show(ctx); },
          back_to_main: (ctx, m) => m.done(ctx),
          finish: (ctx, m) => m.done(ctx, 'finish'),
          deeper: (ctx, m) => m.startDialog(ctx, 'other'),
          record: (ctx, m) => { ctx.data.name = ctx.frame.dialog; return m.show(ctx); },
        },
      },
    ],
  });

  const seeded = defineDialog<TestState, 'seed_home' | 'seed_other', TestKeys>({
    id: 'seeded',
    initialData: { name: 'init', hits: 0 },
    windows: [
      {
        id: 'seed_home',
        onEnter: (ctx) => {
          ctx.data.hits = (ctx.data.hits ?? 0) + 1;
          const sd = ctx.frame.startData as { name?: string } | undefined;
          if (sd?.name) ctx.data.name = sd.name;
        },
        render: (ctx) => ({ text: `seed:${ctx.data.name ?? ''}:${ctx.data.hits ?? 0}` }),
        actions: {
          again: (ctx, m) => m.show(ctx),
          to_other: (ctx, m) => m.goTo(ctx, 'seed_other'),
          nest: (ctx, m) => m.startDialog(ctx, 'seeded'),
        },
      },
      {
        id: 'seed_other',
        render: () => ({ text: 'seed-other' }),
        actions: { back: (ctx, m) => m.goBack(ctx) },
      },
    ],
  });

  return [main, other, seeded];
}

export async function createHarness(
  dialogs: readonly DialogConfig<any, any, any>[] = baseDialogs(),
  options: {
    rootDialogId?: string;
    translations?: typeof testTranslations;
    maxNavigationDepth?: number;
    maxHistory?: number;
    maxDialogDepth?: number;
    languageCode?: string;
    negotiateLanguage?: boolean;
    logger?: DialogLogger;
    onError?: (
      error: unknown,
      ctx: TestCtx,
      manager: DialogManager<TestState, string, string>
    ) => void | Promise<void>;
  } = {}
) {
  const t = await createDialogTest<TestState>({
    dialogs,
    rootDialogId: options.rootDialogId ?? 'main',
    languageCode: options.languageCode,
    managerOptions: {
      translations: options.translations ?? testTranslations,
      defaultLang: 'ru',
      maxNavigationDepth: options.maxNavigationDepth,
      maxHistory: options.maxHistory,
      maxDialogDepth: options.maxDialogDepth,
      negotiateLanguage: options.negotiateLanguage,
      logger: options.logger,
      onError: options.onError,
    },
  });

  return {
    ...t,
    // Адаптер под прежние ассерты: «текущее окно / история / данные».
    session: () => {
      const f = t.frame();
      const s = t.session();
      return {
        currentWindow: f?.window,
        history: f?.history,
        data: (f?.data ?? {}) as TestState & { error?: string },
        lang: s?.lang,
        messageId: s?.messageId,
        messageKind: s?.messageKind,
      };
    },
  };
}