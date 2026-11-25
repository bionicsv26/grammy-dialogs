import { Bot, GrammyError, session } from 'grammy';
import type { Chat, Message, Update, User, UserFromGetMe } from 'grammy/types';
import {
  DialogManager,
  type DialogConfig,
  type DialogContext,
  type DialogFrame,
  type DialogLogger,
  type DialogManagerOptions,
  type DialogSession,
} from './dialog-manager.js';

export interface ApiCall {
  method: string;
  payload: any;
}

export interface LogRecord {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  meta?: Record<string, unknown>;
}

export interface DialogTestOptions<TState extends Record<string, any>> {
  dialogs?: readonly DialogConfig<any, any, any>[] | undefined;
  managerOptions?: DialogManagerOptions<TState, string, string> | undefined;
  /** Если задан и не передан setup — ставится /start → restart(rootDialogId). */
  rootDialogId?: string | undefined;
  /** Значение ctx.from.language_code для проверки negotiation. */
  languageCode?: string | undefined;
  chatId?: number | undefined;
  /** Своя проводка: команды и middleware ДО manager.middleware(). */
  setup?:
  | ((
    bot: Bot<DialogContext<TState>>,
    manager: DialogManager<TState, string, string>
  ) => void | Promise<void>)
  | undefined;
}

export interface DialogTest<TState extends Record<string, any>> {
  bot: Bot<DialogContext<TState>>;
  manager: DialogManager<TState, string, string>;
  calls: ApiCall[];
  logs: LogRecord[];
  sendText(text: string): Promise<void>;
  click(data: string): Promise<void>;
  session(): DialogSession | undefined;
  frame(): DialogFrame | undefined;
  stack(): DialogFrame[];
  data(): TState & { error?: string };
  reset(): void;
  methods(): string[];
  lastPayload(method: string): any;
  /** text или caption последнего отправленного/отредактированного сообщения. */
  lastText(): string | undefined;
  /** Ряды inline-клавиатуры последнего сообщения с разметкой. */
  lastKeyboard(): any[][] | undefined;
  failNextEditNotModified(): void;
  failNextEdit(description?: string): void;
}

const now = () => Math.floor(Date.now() / 1000);

const privateChat = (id: number): Chat.PrivateChat => ({
  id, type: 'private', first_name: 'Tester',
});

const BOT_USER = {
  id: 42, is_bot: true, first_name: 'Test', username: 'test_bot',
} as unknown as UserFromGetMe;

const NOT_MODIFIED =
  'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message';

/**
 * Тестовый бот без сети: все вызовы Telegram API перехватываются и записываются.
 * Сессия — в памяти, инициализируется как { stack: [] }.
 */
export async function createDialogTest<
  TState extends Record<string, any> = Record<string, any>
>(options: DialogTestOptions<TState> = {}): Promise<DialogTest<TState>> {
  const calls: ApiCall[] = [];
  const logs: LogRecord[] = [];
  let messageId = 1000;
  let updateId = 0;
  let failEdit: string | null = null;
  let captured: DialogSession | undefined;

  const chatId = options.chatId ?? 100;
  const bot = new Bot<DialogContext<TState>>('123456:TEST-TOKEN-abcdefghijklmnopqrstuvwxyz');

  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    const ok = (result: unknown) => ({ ok: true, result }) as any;

    switch (method) {
      case 'getMe':
        return ok(BOT_USER);

      case 'sendMessage':
      case 'sendPhoto':
      case 'sendDocument':
      case 'sendVideo':
      case 'sendAnimation': {
        const p = payload as any;
        return ok({
          message_id: ++messageId,
          date: now(),
          chat: privateChat(Number(p.chat_id)),
        } as Message);
      }

      case 'editMessageText':
      case 'editMessageMedia':
        if (failEdit !== null) {
          const description = failEdit;
          failEdit = null;
          throw new GrammyError(
            `Call to '${method}' failed!`,
            { ok: false, error_code: 400, description },
            method,
            payload as Record<string, unknown>
          );
        }
        return ok(true);

      default:
        return ok(true);
    }
  });

  await bot.init();

  bot.use(session({ initial: (): DialogSession => ({ stack: [] }) }));
  bot.use(async (ctx, next) => { captured = ctx.session; await next(); });

  const push = (level: LogRecord['level']) =>
    (message: string, meta?: Record<string, unknown>) => {
      logs.push({ level, message, ...(meta && { meta }) });
    };
  const spyLogger: DialogLogger = {
    debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error'),
  };

  const manager = new DialogManager<TState, string, string>({
    ...options.managerOptions,
    logger: options.managerOptions?.logger ?? spyLogger,
    ...(options.rootDialogId !== undefined && { rootDialogId: options.rootDialogId }),
  });

  for (const d of options.dialogs ?? []) manager.registerDialog(d);

  if (options.setup) {
    await options.setup(bot, manager);
  } else if (options.rootDialogId !== undefined) {
    const root = options.rootDialogId;
    bot.command('start', (ctx) => manager.restart(ctx, root));
  }

  bot.use(manager.middleware());

  const from: User = {
    id: chatId,
    is_bot: false,
    first_name: 'Tester',
    ...(options.languageCode && { language_code: options.languageCode }),
  };

  const sendText = (text: string) => {
    // Telegram всегда присылает entities для команд; grammY матчит по ним.
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
    sendText, click, frame,
    session: () => captured,
    stack: () => captured?.stack ?? [],
    data: () => (frame()?.data ?? {}) as TState & { error?: string },
    reset: () => { calls.length = 0; logs.length = 0; },
    methods: () => calls.map((c) => c.method),
    lastPayload: (method: string) =>
      [...calls].reverse().find((c) => c.method === method)?.payload,
    lastText: () => {
      for (let i = calls.length - 1; i >= 0; i--) {
        const p: any = calls[i]?.payload;
        if (typeof p?.text === 'string') return p.text;
        if (typeof p?.caption === 'string') return p.caption;
        if (typeof p?.media?.caption === 'string') return p.media.caption;
      }
      return undefined;
    },
    lastKeyboard: () => {
      for (let i = calls.length - 1; i >= 0; i--) {
        const p: any = calls[i]?.payload;
        if (p?.reply_markup?.inline_keyboard) return p.reply_markup.inline_keyboard;
      }
      return undefined;
    },
    failNextEditNotModified: () => { failEdit = NOT_MODIFIED; },
    failNextEdit: (description = 'Bad Request: message to edit not found') => {
      failEdit = description;
    },
  };
}