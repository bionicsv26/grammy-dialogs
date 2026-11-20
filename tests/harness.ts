import { Bot, GrammyError, InlineKeyboard, session } from 'grammy';
import type { Chat, Message, Update, User, UserFromGetMe } from 'grammy/types';
import { z } from 'zod';
import {
  DialogManager,
  defineWindow,
  defineWindows,
  type CoreTranslationKey,
  type DialogContext,
  type DialogSession,
  type WindowConfig,
} from '../src/dialog-manager.js';

export interface TestState {
  name?: string;
}

export const testIds = [
  'root', 'form', 'confirm', 'guarded', 'target', 'cycle_a', 'cycle_b', 'blocked',
] as const;
export type TestId = (typeof testIds)[number];

export type TestKeys =
  | 'root_text' | 'form_text' | 'confirm_text' | 'guarded_text' | 'target_text'
  | 'cycle_a_text' | 'cycle_b_text' | 'blocked_text'
  | 'btn_next' | 'btn_guard' | 'btn_noop' | 'btn_cycle' | 'btn_blocked';

export type TestCtx = DialogContext<TestState>;

export const testTranslations: Record<string, Partial<Record<TestKeys | CoreTranslationKey, string>>> = {
  ru: {
    root_text: 'Корень', form_text: 'Форма', confirm_text: 'Готово: {name}',
    guarded_text: 'Защищено', target_text: 'Цель',
    btn_next: 'Дальше', btn_guard: 'В защищённое', btn_noop: 'Обновить',
    // btn_back НАМЕРЕННО отсутствует — проверяем core-дефолт
    cycle_a_text: 'Цикл A', cycle_b_text: 'Цикл B', blocked_text: 'Закрыто',
    btn_cycle: 'В цикл', btn_blocked: 'В закрытое',
  },
  en: {
    root_text: 'Root', form_text: 'Form', confirm_text: 'Done: {name}',
    guarded_text: 'Guarded', target_text: 'Target',
    btn_next: 'Next', btn_guard: 'To guarded', btn_noop: 'Refresh',
    cycle_a_text: 'Cycle A', cycle_b_text: 'Cycle B', blocked_text: 'Blocked',
    btn_cycle: 'To cycle', btn_blocked: 'To blocked',
  },
};

export function baseWindows(): readonly WindowConfig<TestState, TestId, TestKeys, any>[] {
  const win = defineWindow<TestState, TestId, TestKeys>();

  return defineWindows<TestState, TestId, TestKeys>([
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
      actions: {
        next: (ctx, m) => m.goTo(ctx, 'form'),
        to_guarded: (ctx, m) => m.goTo(ctx, 'guarded'),
        to_cycle: (ctx, m) => m.goTo(ctx, 'cycle_a'),
        to_blocked: (ctx, m) => m.goTo(ctx, 'blocked'),
      },
    },
    win({
      id: 'form',
      // Без клавиатуры — проверяем авто-добавление «Назад»
      render: (ctx, t) => ({
        text: ctx.session.data.error ? `ERR: ${ctx.session.data.error}` : t('form_text'),
      }),
      inputSchema: z.string().min(2, 'too short'),
      onInput: (ctx, m, _t, value) => {
        ctx.session.data.name = value;
        return m.goTo(ctx, 'confirm');
      },
      actions: { noop: (ctx, m) => m.show(ctx) },
    }),
    {
      id: 'confirm',
      render: (ctx, t) => ({ text: t('confirm_text', { name: ctx.session.data.name ?? '' }) }),
    },
    {
      id: 'guarded',
      guard: () => 'target' as const,
      render: (_ctx, t) => ({ text: t('guarded_text') }),
    },
    {
      id: 'target',
      render: (_ctx, t) => ({ text: t('target_text') }),
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
      actions: {
        should_not_run: (ctx) => { ctx.session.data.name = 'HACKED'; },
      },
    },
  ]);
}

export interface ApiCall { method: string; payload: any }

const now = () => Math.floor(Date.now() / 1000);

// PrivateChat в актуальных типах требует first_name.
const privateChat = (id: number): Chat.PrivateChat => ({
  id,
  type: 'private',
  first_name: 'Tester',
});

// Стаб: grammY читает из botInfo только id/username/is_bot/first_name.
// Полный набор полей зависит от версии Bot API types — не дублируем его.
const BOT_USER = {
  id: 42,
  is_bot: true,
  first_name: 'Test',
  username: 'test_bot',
} as unknown as UserFromGetMe;

export async function createHarness(
  windows: readonly WindowConfig<TestState, TestId, TestKeys, any>[] = baseWindows(),
  options: {
    rootWindowId?: TestId;
    translations?: typeof testTranslations;
    maxNavigationDepth?: number;
    onError?: (error: unknown, ctx: TestCtx, manager: DialogManager<TestState, TestId, TestKeys>) => void | Promise<void>;
  } = {}
) {
  const calls: ApiCall[] = [];
  let messageId = 1000;
  let failEditNotModified = false;
  let captured: DialogSession<TestState> | undefined;

  const bot = new Bot<TestCtx>('123456:TEST-TOKEN-abcdefghijklmnopqrstuvwxyz');

  // Перехватываем ВСЕ вызовы API — сети нет.
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
    initial: (): DialogSession<TestState> => ({ data: {}, lang: 'ru' }),
  }));
  bot.use(async (ctx, next) => { captured = ctx.session; await next(); });

  const manager = new DialogManager<TestState, TestId, TestKeys>(bot, {
    translations: options.translations ?? testTranslations,
    defaultLang: 'ru',
    rootWindowId: options.rootWindowId ?? 'root',
    maxNavigationDepth: options.maxNavigationDepth,
    onError: options.onError,
  });
  manager.registerAll(windows);

  bot.command('start', (ctx) => manager.start(ctx, 'root'));
  bot.use(manager.middleware());

  const chatId = 100;
  const from: User = { id: chatId, is_bot: false, first_name: 'Tester' };
  let updateId = 0;

  const sendText = (text: string) => {
    // Telegram всегда присылает entities для команд;
    // grammY матчит bot.command именно по ним, а не по префиксу текста.
    const entities = text.startsWith('/')
      ? [{
        type: 'bot_command' as const,
        offset: 0,
        length: (text.split(/[\s@]/)[0] ?? text).length, // '/start@my_bot payload' → '/start'
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

  return {
    bot, manager, calls,
    session: () => captured,
    sendText, click,
    reset: () => { calls.length = 0; },
    failNextEditNotModified: () => { failEditNotModified = true; },
    methods: () => calls.map((c) => c.method),
    lastPayload: (method: string) => [...calls].reverse().find((c) => c.method === method)?.payload,
  };
}