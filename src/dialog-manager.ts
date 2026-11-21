import { Bot, Context, InlineKeyboard } from 'grammy';
import { z } from 'zod';
import { logger } from './logger.js';
import { isMessageNotModified } from './utils/telegram-errors.js';
import { escapeForMode, type ParseMode } from './utils/parse-mode.js';

// ─── Встроенные core-переводы ядра ──────────────────────────────────────────
const coreRu = {
  btn_back: '⬅️ Назад',
  language_changed: 'Язык изменён',
  action_not_available: 'Это действие сейчас недоступно',
  invalid_format: 'Неверный формат ввода',
  error_fallback: '⚠️ Что-то пошло не так. Попробуйте позже или введите /start.',
} as const;

export type CoreTranslationKey = keyof typeof coreRu;

const coreEn: Record<CoreTranslationKey, string> = {
  btn_back: '⬅️ Back',
  language_changed: 'Language changed',
  action_not_available: 'This action is not available right now',
  invalid_format: 'Invalid input format',
  error_fallback: '⚠️ Something went wrong. Try again later or send /start.',
};

export const coreTranslations: Record<'ru' | 'en', Record<CoreTranslationKey, string>> = {
  ru: coreRu,
  en: coreEn,
};

// ─── Зарезервированный namespace core-callback'ов ───────────────────────────
export const CALLBACK_NAMESPACE = '__dm';
const CALLBACK_PREFIX = `${CALLBACK_NAMESPACE}:`;
const LANG_PREFIX = `${CALLBACK_NAMESPACE}:lang:`;

export const coreCallbacks = {
  back: `${CALLBACK_NAMESPACE}:back`,
  root: `${CALLBACK_NAMESPACE}:root`,
  lang: (lang: string) => `${LANG_PREFIX}${lang}`,
} as const;

const CALLBACK_DATA_MAX_BYTES = 64;
const textEncoder = new TextEncoder();

function assertValidCallbackData(data: string, context: string): void {
  const bytes = textEncoder.encode(data).length;
  if (bytes === 0 || bytes > CALLBACK_DATA_MAX_BYTES) {
    throw new Error(
      `callback_data for ${context} must be 1-${CALLBACK_DATA_MAX_BYTES} bytes (UTF-8), got ${bytes}: "${data}"`
    );
  }
}

// ─── Сессия и контекст ──────────────────────────────────────────────────────
export interface DialogSession<
  TState extends Record<string, any> = Record<string, any>
> {
  // Осознанно string, а не TId: сессия приходит из Redis как JSON,
  // литеральный тип здесь не гарантирован runtime. TId-безопасность
  // живёт на границах методов (goTo/start/register).
  currentWindow?: string;
  history?: string[];
  lang?: string;
  data: TState & { error?: string };
  messageId?: number;
}

export type DialogContext<
  TState extends Record<string, any> = Record<string, any>
> = Context & {
  session: DialogSession<TState>;
};

// ─── Типы переводов и окон ──────────────────────────────────────────────────
export type TranslationFunction<TKeys extends string = string> = (
  key: TKeys | CoreTranslationKey,
  params?: Record<string, string | number>
) => string;

export type WindowRenderResult = {
  text: string;
  keyboard?: InlineKeyboard;
};

export type WindowActionHandler<
  TState extends Record<string, any>,
  TId extends string,
  TKeys extends string = string
> = (
  ctx: DialogContext<TState>,
  manager: DialogManager<TState, TId, TKeys>,
  t: TranslationFunction<TKeys>
) => Promise<void> | void;

export type WindowInputHandler<
  TState extends Record<string, any>,
  TId extends string,
  TKeys extends string = string,
  TValue = string
> = (
  ctx: DialogContext<TState>,
  manager: DialogManager<TState, TId, TKeys>,
  t: TranslationFunction<TKeys>,
  value: TValue
) => Promise<void> | void;

/**
 * Guard — чистый предикат доступа: читает состояние и решает
 * «пустить / заблокировать / редиректить». Без сайд-эффектов
 * (ответов на callback, отправки сообщений, мутаций сессии):
 * вызывается на двух гейтах — перед обработкой ввода/экшена и перед рендером.
 */
export type WindowGuard<
  TState extends Record<string, any>,
  TId extends string,
  TKeys extends string = string
> = (
  ctx: DialogContext<TState>,
  manager: DialogManager<TState, TId, TKeys>,
  t: TranslationFunction<TKeys>
) => Promise<boolean | TId> | boolean | TId;

export type WindowInputFormatter<TValue = string> = (rawInput: string) => TValue;

/** Бросай из formatter, чтобы показать пользователю своё сообщение об ошибке. */
export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputValidationError';
  }
}

export interface WindowConfig<
  TState extends Record<string, any>,
  TId extends string,
  TKeys extends string = string,
  TValue = string
> {
  id: TId;
  render: (
    ctx: DialogContext<TState>,
    t: TranslationFunction<TKeys>
  ) => Promise<WindowRenderResult> | WindowRenderResult;
  actions?: Record<string, WindowActionHandler<TState, TId, TKeys>>;
  onInput?: WindowInputHandler<TState, TId, TKeys, TValue>;
  formatter?: WindowInputFormatter<TValue>;
  inputSchema?: z.ZodType<TValue>;
  guard?: WindowGuard<TState, TId, TKeys>;
  disableBackButton?: boolean;
}

export interface DialogManagerOptions<
  TState extends Record<string, any> = Record<string, any>,
  TId extends string = string,
  TKeys extends string = string
> {
  onError?:
  | ((
    error: unknown,
    ctx: DialogContext<TState>,
    manager: DialogManager<TState, TId, TKeys>
  ) => Promise<void> | void)
  | undefined;
  translations?:
  | Record<string, Partial<Record<TKeys | CoreTranslationKey, string>>>
  | undefined;
  defaultLang?: string | undefined;
  /**
   * Корень навигации: переход в это окно очищает историю,
   * встроенный экшен coreCallbacks.root ведёт сюда.
   * Если не задан — спецобработка отключена.
   */
  rootWindowId?: TId | undefined;
  /** Режим разметки сообщений. По умолчанию HTML. */
  parseMode?: ParseMode | undefined;
  /** Лимит вложенных переходов на один апдейт (защита от циклов guard-редиректов). */
  maxNavigationDepth?: number | undefined;
  /** Максимальная глубина стека истории (старые записи вытесняются). По умолчанию 50. */
  maxHistory?: number | undefined;
}

/** Внутреннее стирание дженериков на границе хранения/коллекции. */
type AnyWindowConfig = WindowConfig<any, any, any, any>;
type AnyErrorHandler = (
  error: unknown,
  ctx: DialogContext<any>,
  manager: DialogManager<any, any, any>
) => Promise<void> | void;

/** Коллекция окон модуля (TValue стёрт до any — окна гетерогенны). */
export function defineWindows<
  TState extends Record<string, any>,
  TId extends string,
  TKeys extends string = string
>(
  windows: readonly WindowConfig<TState, TId, TKeys, any>[]
): readonly WindowConfig<TState, TId, TKeys, any>[] {
  return windows;
}

/**
 * Каррированный хелпер: фиксирует контекст модуля (TState/TId/TKeys),
 * а TValue выводит из inputSchema конкретного окна.
 * Оборачивай окна с вводом: win({ id, inputSchema, onInput, ... }).
 */
export function defineWindow<
  TState extends Record<string, any>,
  TId extends string,
  TKeys extends string = string
>() {
  return <TValue = string>(
    window: WindowConfig<TState, TId, TKeys, TValue>
  ): WindowConfig<TState, TId, TKeys, TValue> => window;
}

// ─── Менеджер диалогов ──────────────────────────────────────────────────────
export class DialogManager<
  TState extends Record<string, any> = Record<string, any>,
  TId extends string = string,
  TKeys extends string = string
> {
  // Приватные поля намеренно не зависят от TState/TId/TKeys,
  // чтобы разные инстанциации класса были структурно совместимы.
  private windows = new Map<string, AnyWindowConfig>();
  private errorHandler: AnyErrorHandler | undefined;
  private translations: Record<string, Record<string, string>>;
  private defaultLang: string;
  private rootWindowId: string | undefined;
  private parseMode: ParseMode;
  private maxNavigationDepth: number;
  private maxHistory: number;
  private navDepth = new WeakMap<object, number>();
  private handlingError = new WeakSet<object>();
  private bot: Bot<any>;

  constructor(
    bot: Bot<DialogContext<TState>>,
    options?: DialogManagerOptions<TState, TId, TKeys>
  ) {
    this.bot = bot;
    this.errorHandler = options?.onError;
    this.defaultLang = options?.defaultLang ?? 'ru';
    this.rootWindowId = options?.rootWindowId;
    this.parseMode = options?.parseMode ?? 'HTML';
    this.maxNavigationDepth = options?.maxNavigationDepth ?? 10;
    this.maxHistory = Math.max(0, options?.maxHistory ?? 50);

    // Core-дефолты как база; пользовательские переводы перекрывают их.
    const merged: Record<string, Record<string, string>> = {};
    for (const [lang, dict] of Object.entries(coreTranslations)) {
      merged[lang] = { ...dict };
    }
    const userTranslations = options?.translations;
    if (userTranslations) {
      for (const [lang, dict] of Object.entries(userTranslations)) {
        const target = (merged[lang] ??= {});
        for (const [key, value] of Object.entries(dict)) {
          if (typeof value === 'string') target[key] = value;
        }
      }
    }
    this.translations = merged;
  }

  register<TValue = string>(window: WindowConfig<TState, TId, TKeys, TValue>): this {
    if (this.windows.has(window.id)) {
      throw new Error(
        `Window with id "${window.id}" is already registered. ` +
        `Each window must be owned by exactly one module.`
      );
    }
    for (const actionKey of Object.keys(window.actions ?? {})) {
      if (actionKey.startsWith(CALLBACK_PREFIX)) {
        throw new Error(
          `Action key "${actionKey}" in window "${window.id}" uses the reserved namespace "${CALLBACK_PREFIX}".`
        );
      }
      assertValidCallbackData(actionKey, `action "${actionKey}" in window "${window.id}"`);
    }
    this.windows.set(window.id, window as AnyWindowConfig);
    return this;
  }

  registerAll(windows: readonly WindowConfig<TState, TId, TKeys, any>[]): this {
    for (const w of windows) this.register(w);
    return this;
  }

  public getTranslator(ctx: DialogContext<TState>): TranslationFunction<TKeys> {
    const lang = ctx.session.lang ?? this.defaultLang;

    return (key: TKeys | CoreTranslationKey, params?: Record<string, string | number>): string => {
      const text =
        this.translations[lang]?.[key] ??
        this.translations[this.defaultLang]?.[key];

      if (text === undefined) {
        logger.warn(`Translation key not found`, { lang, key });
        return key;
      }

      if (!params) return text;

      // Один проход: значение вставляется литерально (без $-паттернов),
      // не пересканируется, RegExp из ключей не строится; параметры
      // экранируются под текущий parse_mode.
      return text.replace(/\{(\w+)\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name)
          ? escapeForMode(String(params[name]), this.parseMode)
          : match
      );
    };
  }

  async setLanguage(ctx: DialogContext<TState>, lang: string): Promise<void> {
    ctx.session.lang = lang;
    logger.info(`User changed language`, { userId: ctx.from?.id, lang });
    await this.show(ctx);
  }

  // Не мутирует переданную клавиатуру: клонируем и добавляем «Назад».
  static appendBackButton(
    keyboard: InlineKeyboard,
    text: string = coreTranslations.en.btn_back
  ): InlineKeyboard {
    const result = keyboard.clone();
    const rows = result.inline_keyboard;
    const lastRow = rows[rows.length - 1];

    if (lastRow && lastRow.length === 0) {
      // Пустая клавиатура (new InlineKeyboard() = [[]]) — заполняем
      // существующий ряд, чтобы не отправлять пустой ряд в разметке.
      result.text(text, coreCallbacks.back);
    } else {
      result.row().text(text, coreCallbacks.back);
    }
    return result;
  }

  /** Единая точка ответа на callback: inline пропускаем, ошибки глотаем. */
  private async answerCallback(
    ctx: DialogContext<TState>,
    other?: Parameters<DialogContext<TState>['answerCallbackQuery']>[0]
  ): Promise<void> {
    if (!ctx.callbackQuery || ctx.callbackQuery.inline_message_id) return;
    await ctx.answerCallbackQuery(other).catch(() => { });
  }

  private async handleError(error: unknown, ctx: DialogContext<TState>): Promise<void> {
    logger.error(`DialogManager execution error`, {
      userId: ctx.from?.id,
      currentWindow: ctx.session.currentWindow,
      error,
    });

    if (this.handlingError.has(ctx)) return;
    this.handlingError.add(ctx);

    try {
      if (this.errorHandler) {
        try {
          await this.errorHandler(error, ctx, this);
          return;
        } catch (handlerError) {
          logger.error(`Error occurred inside custom onError handler`, { handlerError });
        }
      }

      await ctx
        .reply(this.getTranslator(ctx)('error_fallback'))
        .catch(() => { });
    } finally {
      this.handlingError.delete(ctx);
    }
  }

  async start(
    ctx: DialogContext<TState>,
    windowId: TId,
    initialData: Partial<TState> = {}
  ): Promise<void> {
    try {
      if (!this.windows.has(windowId)) {
        throw new Error(`Window with id "${windowId}" is not registered.`);
      }

      logger.info(`Starting dialog at window`, { userId: ctx.from?.id, windowId });

      // Снимаем клавиатуру прошлого сообщения: иначе его кнопки останутся
      // активными и будут «стрелять» в контексте нового диалога.
      if (ctx.session.messageId && ctx.chat) {
        await ctx.api
          .editMessageReplyMarkup(ctx.chat.id, ctx.session.messageId, {
            reply_markup: { inline_keyboard: [] },
          })
          .catch(() => { });
      }

      ctx.session.currentWindow = windowId;
      ctx.session.data = { ...initialData } as DialogSession<TState>['data'];
      delete ctx.session.messageId;
      ctx.session.history = [];
      await this.show(ctx);
    } catch (error) {
      await this.handleError(error, ctx);
    }
  }

  async goTo(
    ctx: DialogContext<TState>,
    windowId: TId,
    options: { pushHistory?: boolean } = {}
  ): Promise<void> {
    // Глубина считается на апдейт (ctx живёт ровно один апдейт).
    const depth = this.navDepth.get(ctx) ?? 0;
    this.navDepth.set(ctx, depth + 1);
    try {
      if (depth >= this.maxNavigationDepth) {
        throw new Error(
          `Navigation depth limit (${this.maxNavigationDepth}) exceeded at window "${windowId}". ` +
          `Possible guard redirect cycle.`
        );
      }

      if (!this.windows.has(windowId)) {
        logger.error(`Attempted to navigate to unregistered window`, {
          userId: ctx.from?.id,
          targetWindow: windowId,
        });
        throw new Error(`Window with id "${windowId}" is not registered.`);
      }

      const currentWindow = ctx.session.currentWindow;

      // Переход в то же окно = перерисовка (например, экшен «обновить»).
      if (currentWindow === windowId) {
        await this.show(ctx);
        return;
      }

      if (!ctx.session.history) {
        ctx.session.history = [];
      }

      // Переход в корень навигации начинает её заново.
      if (windowId === this.rootWindowId) {
        ctx.session.history = [];
      } else if (options.pushHistory !== false && currentWindow) {
        ctx.session.history.push(currentWindow);
        if (ctx.session.history.length > this.maxHistory) {
          ctx.session.history.splice(0, ctx.session.history.length - this.maxHistory);
        }
      }

      // Уходим с окна — его ошибка ввода больше не актуальна.
      delete ctx.session.data.error;

      logger.info(`User navigated to window`, {
        userId: ctx.from?.id,
        fromWindow: currentWindow,
        toWindow: windowId,
        historyDepth: ctx.session.history.length,
      });

      ctx.session.currentWindow = windowId;
      await this.show(ctx);
    } catch (error) {
      await this.handleError(error, ctx);
    } finally {
      this.navDepth.set(ctx, depth);
    }
  }

  async goBack(ctx: DialogContext<TState>): Promise<void> {
    try {
      if (!ctx.session.history || ctx.session.history.length === 0) {
        logger.warn(`Attempted to go back, but history is empty`, { userId: ctx.from?.id });
        return;
      }

      const previousWindow = ctx.session.history.pop() as TId;

      logger.info(`User went back`, {
        userId: ctx.from?.id,
        toWindow: previousWindow,
        remainingHistory: ctx.session.history.length,
      });

      delete ctx.session.data.error;
      ctx.session.currentWindow = previousWindow;
      await this.show(ctx);
    } catch (error) {
      await this.handleError(error, ctx);
    }
  }

  async show(ctx: DialogContext<TState>): Promise<void> {
    try {
      const userId = ctx.from?.id;
      const windowId = ctx.session.currentWindow;
      if (!windowId) {
        logger.warn(`Attempted to show window, but currentWindow is not set`, { userId });
        return;
      }

      const window = this.windows.get(windowId) as
        | WindowConfig<TState, TId, TKeys, any>
        | undefined;
      if (!window) {
        logger.error(`Window not found in registry during show`, { userId, windowId });
        return;
      }

      const t = this.getTranslator(ctx);

      if (window.guard) {
        const guardResult = await window.guard(ctx, this, t);
        if (guardResult === false) {
          logger.warn(`Window guard blocked access (render halted)`, { userId, windowId });
          return;
        }
        if (typeof guardResult === 'string' && guardResult !== windowId) {
          logger.info(`Window guard redirected user`, {
            userId,
            fromWindow: windowId,
            toWindow: guardResult,
          });
          await this.goTo(ctx, guardResult, { pushHistory: false });
          return;
        }
      }

      const rendered = await window.render(ctx, t);
      const text = rendered.text;
      let keyboard = rendered.keyboard;

      const shouldShowBack =
        !!ctx.session.history?.length &&
        !window.disableBackButton;

      if (shouldShowBack) {
        keyboard = DialogManager.appendBackButton(
          keyboard ?? new InlineKeyboard(),
          t('btn_back')
        );
      }

      // Лимит Telegram на callback_data кнопок (1–64 байта UTF-8).
      if (keyboard) {
        for (const row of keyboard.inline_keyboard) {
          for (const button of row) {
            if ('callback_data' in button && typeof button.callback_data === 'string') {
              assertValidCallbackData(button.callback_data, `button in window "${windowId}"`);
            }
          }
        }
      }

      const otherOptions: { parse_mode: ParseMode; reply_markup?: InlineKeyboard } = {
        parse_mode: this.parseMode,
      };
      if (keyboard) {
        otherOptions.reply_markup = keyboard;
      }

      if (ctx.session.messageId && ctx.chat) {
        try {
          await ctx.api.editMessageText(
            ctx.chat.id,
            ctx.session.messageId,
            text,
            otherOptions
          );
          return;
        } catch (error) {
          // Контент уже актуален — ничего не делаем и НЕ трогаем messageId.
          if (isMessageNotModified(error)) {
            logger.debug(`Message is already up to date`, { userId, windowId });
            return;
          }
          logger.debug(`Failed to edit message, sending a new one`, { userId, error });
          delete ctx.session.messageId;
        }
      }

      if (ctx.chat) {
        const msg = await ctx.reply(text, otherOptions);
        ctx.session.messageId = msg.message_id;
      }
    } catch (error) {
      await this.handleError(error, ctx);
    }
  }

  middleware() {
    return async (
      ctx: DialogContext<TState>,
      next: () => Promise<void>
    ): Promise<void> => {
      try {
        const userId = ctx.from?.id;

        // Апдейты без чата (например, inline-callback) не имеют сессии.
        if (!ctx.session) {
          return next();
        }

        // Telegram принимает ответ на callback query только один раз.
        // Оборачиваем метод, чтобы повторные ответы (хендлер + finally)
        // не превращались в лишние вызовы API.
        if (ctx.callbackQuery) {
          const original = ctx.answerCallbackQuery.bind(ctx);
          let answered = false;
          ctx.answerCallbackQuery = async (other?: Parameters<typeof original>[0]) => {
            if (answered) return true;
            const result = await original(other);
            answered = true; // помечаем только после успеха
            return result;
          };
        }

        const windowId = ctx.session.currentWindow;
        if (!windowId) {
          return next();
        }

        const window = this.windows.get(windowId) as
          | WindowConfig<TState, TId, TKeys, any>
          | undefined;
        if (!window) {
          return next();
        }

        const t = this.getTranslator(ctx);

        if (window.guard) {
          const guardResult = await window.guard(ctx, this, t);
          if (guardResult === false) {
            logger.warn(`Window guard blocked middleware action`, { userId, windowId });
            await this.answerCallback(ctx);
            return;
          }
          if (typeof guardResult === 'string' && guardResult !== windowId) {
            logger.info(`Window guard redirected user in middleware`, {
              userId,
              fromWindow: windowId,
              toWindow: guardResult,
            });
            await this.goTo(ctx, guardResult, { pushHistory: false });
            return;
          }
        }

        // 1. Инлайн-кнопки
        if (ctx.callbackQuery && ctx.callbackQuery.data) {
          const actionKey = ctx.callbackQuery.data;

          logger.debug(`User triggered action`, { userId, windowId, actionKey });

          if (actionKey === coreCallbacks.back) {
            try {
              await this.goBack(ctx);
            } finally {
              await this.answerCallback(ctx);
            }
            return;
          }

          if (actionKey === coreCallbacks.root && this.rootWindowId !== undefined) {
            try {
              await this.goTo(ctx, this.rootWindowId as TId);
            } finally {
              await this.answerCallback(ctx);
            }
            return;
          }

          if (actionKey.startsWith(LANG_PREFIX)) {
            const newLang = actionKey.slice(LANG_PREFIX.length);
            try {
              await this.setLanguage(ctx, newLang);
            } finally {
              await this.answerCallback(ctx, {
                text: this.getTranslator(ctx)('language_changed'),
              });
            }
            return;
          }

          const actionHandler = window.actions?.[actionKey];

          if (!actionHandler) {
            logger.warn(`Action handler not found`, { userId, windowId, actionKey });
            await this.answerCallback(ctx, { text: t('action_not_available') });
            return next();
          }

          try {
            await actionHandler(ctx, this, t);
          } catch (error) {
            logger.error(`Error occurred while executing action handler`, {
              userId,
              windowId,
              actionKey,
              error,
            });
            await this.handleError(error, ctx);
          } finally {
            await this.answerCallback(ctx);
          }
          return;
        }

        // 2. Текстовый ввод: raw → formatter → schema → value → onInput
        if (
          ctx.message &&
          ctx.message.text &&
          (window.inputSchema || window.onInput || window.formatter)
        ) {
          if (ctx.message.text.startsWith('/')) {
            return next();
          }

          await ctx.deleteMessage().catch(() => { });

          const rawInput = ctx.message.text.trim();
          let value: unknown = rawInput;

          if (window.formatter) {
            try {
              value = window.formatter(rawInput);
            } catch (error) {
              const userMessage =
                error instanceof InputValidationError
                  ? error.message
                  : t('invalid_format');

              logger.warn(`Window input formatter failed`, {
                userId,
                windowId,
                inputLength: rawInput.length,
                error,
              });

              ctx.session.data.error = userMessage;
              await this.show(ctx);
              return;
            }
          }

          if (window.inputSchema) {
            const parseResult = window.inputSchema.safeParse(value);

            if (!parseResult.success) {
              const firstError =
                parseResult.error.issues[0]?.message || t('invalid_format');

              logger.warn(`Window input validation failed`, {
                userId,
                windowId,
                error: firstError,
                inputLength: rawInput.length,
              });

              ctx.session.data.error = firstError;
              await this.show(ctx);
              return;
            }

            value = parseResult.data;
          }

          // Ввод принят — очищаем прошлую ошибку (в обоих путях).
          delete ctx.session.data.error;

          if (window.onInput) {
            try {
              await window.onInput(ctx, this, t, value);
            } catch (error) {
              logger.error(`Error occurred while executing onInput handler`, {
                userId,
                windowId,
                error,
              });
              await this.handleError(error, ctx);
            }
          }
          return;
        }

        return next();
      } catch (error) {
        await this.handleError(error, ctx);
      }
    };
  }
}