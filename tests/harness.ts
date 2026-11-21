import { Bot, GrammyError, InlineKeyboard, session } from 'grammy';
import type { Chat, Message, Update, User, UserFromGetMe } from 'grammy/types';
import { z } from 'zod';
import {
  DialogManager,
  defineDialog,
  defineWindow,
  InputValidationError,
  type CoreTranslationKey,
  type DialogConfig,
  type DialogContext,
  type DialogSession,
  type DialogLogger,
} from '../src/dialog-manager.js';

export interface TestState {
  name?: string;
}

export type TestId =
  | 'root' | 'form' | 'confirm' | 'guarded' | 'target' | 'cycle_a' | 'cycle_b' | 'blocked';

export type TestKeys =
  | 'root_text' | 'form_text' | 'confirm_text' | 'guarded_text' | 'target_text'
  | 'cycle_a_text' | 'cycle_b_text' | 'blocked_text' | 'hello_text'
  | 'btn_next' | 'btn_guard' | 'btn_noop' | 'btn_cycle' | 'btn_blocked';

export type TestCtx = DialogContext<TestState>;

export const testTranslations: Record<string, Partial<Record<TestKeys | CoreTranslationKey, string>>> = {
  ru: {
    root_text: 'Корень', form_text: 'Форма', confirm_text: 'Готово: {name}',
    guarded_text: 'Защищено', target_text: 'Цель',
    cycle_a_text: 'Цикл A', cycle_b_text: 'Цикл B', blocked_text: 'Закрыто',
    hello_text: 'Другой диалог',
    btn_next: 'Дальше', btn_guard: 'В защищённое', btn_noop: 'Обновить',
    btn_cycle: 'В цикл', btn_blocked: 'В закрытое',
    // btn_back НАМЕРЕННО отсутствует — проверяем core-дефолт
  },
  en: {
    root_text: 'Root', form_text: 'Form', confirm_text: 'Done: {name}',
    guarded_text: 'Guarded', target_text: 'Target',
    cycle_a_text: 'Cycle A', cycle_b_text: 'Cycle B', blocked_text: 'Blocked',
    hello_text: 'Other dialog',
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
          alert: async (ctx) => {
            await ctx.answerCallbackQuery({ text: 'ALERT', show_alert: true });
          },
          finish_root: (ctx, m) => m.done(ctx),
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

  return [main, other];
}

export interface ApiCall { method: string; payload: any }

const now = () => Math.floor(Date.now() / 1000);

const privateChat = (id: number): Chat.PrivateChat => ({
  id, type: 'private', first_name: 'Tester',
});

const BOT_USER = {
  id: 42, is_bot: true, first_name: 'Test', username: 'test_bot',
} as unknown as UserFromGetMe;

export async function createHarness(
  dialogs: readonly DialogConfig<any, any, any>[] = baseDialogs(),
  options: {
    logger?: DialogLogger;
    rootDialogId?: string;
    translations?: typeof testTranslations;
    maxNavigationDepth?: number;
    maxHistory?: number;
    maxDialogDepth?: number;
    onError?: (
      error: unknown,
      ctx: TestCtx,
      manager: DialogManager<TestState, TestId, TestKeys>
    ) => void | Promise<void>;
  } = {}
) {
  const calls: ApiCall[] = [];
  let messageId = 1000;
  let failEditNotModified = false;
  let captured: DialogSession | undefined;

  const bot = new Bot<TestCtx>('123456:TEST-TOKEN-abcdefghijklmnopqrstuvwxyz');

  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    const ok = (result: unknown) => ({ ok: true, result }) as any;

    switch (method) {
      case 'getMe':
        return ok(BOT_USER);
      case 'sendMessage': {
        const p = payload as any;
        const msg = {
          message_id: ++messageId,
          date: now(),
          chat: privateChat(Number(p.chat_id)),
          text: p.text,
        } as Message;
        return ok(msg);
      }
      case 'editMessageText':
        if (failEditNotModified) {
          failEditNotModified = false;
          throw new GrammyError(
            "Call to 'editMessageText' failed!",
            {
              ok: false,
              error_code: 400,
              description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
            },
            'editMessageText',
            payload as Record<string, unknown>
          );
        }
        return ok(true);
      default:
        return ok(true);
    }
  });

  await bot.init();

  bot.use(session({
    initial: (): DialogSession => ({ stack: [], lang: 'ru' }),
  }));
  bot.use(async (ctx, next) => { captured = ctx.session; await next(); });
  const logs: { level: string; message: string; meta?: Record<string, unknown> }[] = [];
  const push = (level: string) => (message: string, meta?: Record<string, unknown>) => {
    logs.push({ level, message, ...(meta && { meta }) });
  };
  const spyLogger: DialogLogger = {
    debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error'),
  };

  const manager = new DialogManager<TestState, TestId, TestKeys>({
    logger: options.logger ?? spyLogger,
    translations: options.translations ?? testTranslations,
    defaultLang: 'ru',
    rootDialogId: options.rootDialogId ?? 'main',
    maxNavigationDepth: options.maxNavigationDepth,
    maxHistory: options.maxHistory,
    maxDialogDepth: options.maxDialogDepth,
    onError: options.onError,
  });
  for (const d of dialogs) manager.registerDialog(d);

  bot.command('start', (ctx) => manager.restart(ctx, options.rootDialogId ?? 'main'));
  bot.use(manager.middleware());

  const chatId = 100;
  const from: User = { id: chatId, is_bot: false, first_name: 'Tester' };
  let updateId = 0;

  const sendText = (text: string) => {
    const entities = text.startsWith('/')
      ? [{
        type: 'bot_command' as const,
        offset: 0,
        length: (text.split(/[\s@]/)[0] ?? text).length,
      }]
      : undefined;

    return bot.handleUpdate({
      update_id: ++updateId,
      message: {
        message_id: ++messageId,
        date: now(),
        chat: privateChat(chatId),
        from,
        text,
        ...(entities && { entities }),
      },
    } as Update);
  };

  const click = (data: string) =>
    bot.handleUpdate({
      update_id: ++updateId,
      callback_query: {
        id: `cq${updateId}`,
        from,
        chat_instance: 'ci',
        data,
        message: {
          message_id: captured?.messageId ?? 1000,
          date: now(),
          chat: privateChat(chatId),
          from: BOT_USER,
          text: 'prev',
        },
      },
    } as Update);

  const frame = () => {
    const stack = captured?.stack;
    return stack && stack.length > 0 ? stack[stack.length - 1] : undefined;
  };

  return {
    bot, manager, calls, logs,
    frame,
    stack: () => captured?.stack ?? [],
    // Адаптер под прежние ассерты: «текущее окно / история / данные»
    session: () => {
      const f = frame();
      return {
        currentWindow: f?.window,
        history: f?.history,
        data: (f?.data ?? {}) as TestState & { error?: string },
        lang: captured?.lang,
        messageId: captured?.messageId,
      };
    },
    sendText, click,
    reset: () => { calls.length = 0; },
    failNextEditNotModified: () => { failEditNotModified = true; },
    methods: () => calls.map((c) => c.method),
    lastPayload: (method: string) => [...calls].reverse().find((c) => c.method === method)?.payload,
  };
}