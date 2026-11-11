import { Bot, Context, InlineKeyboard } from 'grammy';
import { z } from 'zod';
import { logger } from './logger.js';

export interface DialogSession<
  TState extends Record<string, any> = Record<string, any>,
  TId extends string = string
> {
  currentWindow?: TId;
  history?: string[]; // Стек истории переходов
  lang?: string; // Язык пользователя (например, 'ru', 'en')
  data: TState & { error?: string; validatedInput?: any };
  messageId?: number;
}

export type DialogContext<
  TState extends Record<string, any> = Record<string, any>,
  TId extends string = string
> = Context & {
  session: DialogSession<TState, TId>;
};

// 🌐 Функция перевода с поддержкой строгой типизации ключей (TKeys)
export type TranslationFunction<TKeys extends string = string> = (
  key: TKeys,
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
  ctx: DialogContext<TState, TId>,
  manager: DialogManager<TState, TId, TKeys>,
  t: TranslationFunction<TKeys>
) => Promise<void> | void;

export type WindowInputHandler<
  TState extends Record<string, any>,
  TId extends string,
  TKeys extends string = string
> = (
  ctx: DialogContext<TState, TId>,
  manager: DialogManager<TState, TId, TKeys>,
  t: TranslationFunction<TKeys>
) => Promise<void> | void;

// 🛡️ Тип для защитных функций (Guards)
export type WindowGuard<
  TState extends Record<string, any>,
  TId extends string,
  TKeys extends string = string
> = (
  ctx: DialogContext<TState, TId>,
  manager: DialogManager<TState, TId, TKeys>,
  t: TranslationFunction<TKeys>
) => Promise<boolean | TId> | boolean | TId;

// 🪄 Тип для кастомного форматтера ввода
export type WindowInputFormatter = (rawInput: string) => any;

export interface WindowConfig<
  TState extends Record<string, any>,
  TId extends string,
  TKeys extends string = string
> {
  id: TId;
  render: (
    ctx: DialogContext<TState, TId>,
    t: TranslationFunction<TKeys>
  ) => Promise<WindowRenderResult> | WindowRenderResult;
  actions?: Record<string, WindowActionHandler<TState, TId, TKeys>>;
  onInput?: WindowInputHandler<TState, TId, TKeys>;
  formatter?: WindowInputFormatter;
  inputSchema?: z.ZodType;
  guard?: WindowGuard<TState, TId, TKeys>;
  disableBackButton?: boolean;
}

// ⚙️ Опции конфигурации DialogManager (включая i18n)
export interface DialogManagerOptions<
  TState extends Record<string, any>,
  TId extends string,
  TKeys extends string = string
> {
  onError?: (
    error: unknown,
    ctx: DialogContext<TState, TId>,
    manager: DialogManager<TState, TId, TKeys>
  ) => Promise<void> | void;
  translations?: Record<string, Record<string, string>>;
  defaultLang?: string;
}

export class DialogManager<
  TState extends Record<string, any> = Record<string, any>,
  TId extends string = string,
  TKeys extends string = string
> {
  private windows = new Map<TId, WindowConfig<TState, TId, TKeys>>();
  private errorHandler?: DialogManagerOptions<TState, TId, TKeys>['onError'];
  private translations: Record<string, Record<string, string>>;
  private defaultLang: string;

  // Контексты, для которых ошибка уже обрабатывается (защита от рекурсии)
  private handlingError = new WeakSet<object>();

  constructor(
    private bot: Bot<DialogContext<TState, TId>>,
    options?: DialogManagerOptions<TState, TId, TKeys>
  ) {
    this.errorHandler = options?.onError;
    this.translations = options?.translations ?? {};
    this.defaultLang = options?.defaultLang ?? 'ru';
  }

  register(window: WindowConfig<TState, TId, TKeys>): this {
    this.windows.set(window.id, window);
    return this;
  }

  // 🌐 Получение функции перевода для текущего пользователя
  public getTranslator(ctx: DialogContext<TState, TId>): TranslationFunction<TKeys> {
    const lang = ctx.session.lang ?? this.defaultLang;

    return (key: TKeys, params?: Record<string, string | number>): string => {
      const text =
        this.translations[lang]?.[key] ??
        this.translations[this.defaultLang]?.[key];

      if (text === undefined) {
        logger.warn(`Translation key not found`, { lang, key });
        return key;
      }

      let result = text;
      if (params) {
        for (const [paramKey, val] of Object.entries(params)) {
          result = result.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(val));
        }
      }
      return result;
    };
  }

  // 🌐 Изменение языка и мгновенная перерисовка окна
  async setLanguage(ctx: DialogContext<TState, TId>, lang: string): Promise<void> {
    ctx.session.lang = lang;
    logger.info(`User changed language`, { userId: ctx.from?.id, lang });
    await this.show(ctx);
  }

  // 🪄 Хелпер для добавления кнопки «Назад» к любой инлайн-клавиатуре
  static appendBackButton(keyboard: InlineKeyboard, text: string = '⬅️ Назад'): InlineKeyboard {
    return keyboard.row().text(text, 'global_back');
  }

  // 🛡️ Централизованный обработчик ошибок
  private async handleError(error: unknown, ctx: DialogContext<TState, TId>): Promise<void> {
    logger.error(`DialogManager execution error`, {
      userId: ctx.from?.id,
      currentWindow: ctx.session.currentWindow,
      error,
    });

    // Защита от рекурсии: ошибка внутри обработки ошибки не должна запускать её снова
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

      // Дефолтный фоллбек, если кастомный onError не передан или упал
      await ctx
        .reply('⚠️ Что-то пошло не так. Попробуйте позже или введите /start.')
        .catch(() => { });
    } finally {
      this.handlingError.delete(ctx);
    }
  }

  async start(
    ctx: DialogContext<TState, TId>,
    windowId: TId,
    initialData: Partial<TState> = {}
  ): Promise<void> {
    try {
      if (!this.windows.has(windowId)) {
        throw new Error(`Window with id "${windowId}" is not registered.`);
      }

      logger.info(`Starting dialog at window`, { userId: ctx.from?.id, windowId });

      ctx.session.currentWindow = windowId;
      ctx.session.data = { ...initialData } as DialogSession<TState, TId>['data'];
      delete ctx.session.messageId;
      ctx.session.history = []; // Очищаем историю при старте
      await this.show(ctx);
    } catch (error) {
      await this.handleError(error, ctx);
    }
  }

  // 🧭 Переход с сохранением истории
  async goTo(ctx: DialogContext<TState, TId>, windowId: TId): Promise<void> {
    try {
      if (!this.windows.has(windowId)) {
        logger.error(`Attempted to navigate to unregistered window`, {
          userId: ctx.from?.id,
          targetWindow: windowId,
        });
        throw new Error(`Window with id "${windowId}" is not registered.`);
      }

      const currentWindow = ctx.session.currentWindow;

      if (currentWindow === windowId) return;

      if (!ctx.session.history) {
        ctx.session.history = [];
      }

      // Переход в главное меню начинает навигацию заново, старая история не нужна
      if (windowId === 'main_menu') {
        ctx.session.history = [];
      } else if (currentWindow) {
        ctx.session.history.push(currentWindow);
      }

      logger.info(`User navigated to window`, {
        userId: ctx.from?.id,
        fromWindow: currentWindow || 'none',
        toWindow: windowId,
        historyDepth: ctx.session.history.length,
      });

      ctx.session.currentWindow = windowId;
      await this.show(ctx);
    } catch (error) {
      await this.handleError(error, ctx);
    }
  }

  // ⬅️ Возврат на предыдущее окно из стека
  async goBack(ctx: DialogContext<TState, TId>): Promise<void> {
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

      ctx.session.currentWindow = previousWindow;
      await this.show(ctx);
    } catch (error) {
      await this.handleError(error, ctx);
    }
  }

  async show(ctx: DialogContext<TState, TId>): Promise<void> {
    try {
      const userId = ctx.from?.id;
      const windowId = ctx.session.currentWindow;
      if (!windowId) {
        logger.warn(`Attempted to show window, but currentWindow is not set`, { userId });
        return;
      }

      const window = this.windows.get(windowId);
      if (!window) {
        logger.error(`Window not found in registry during show`, { userId, windowId });
        return;
      }

      const t = this.getTranslator(ctx);

      // 🛡️ Проверяем Guard перед рендером
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
          await this.goTo(ctx, guardResult as TId);
          return;
        }
      }

      const rendered = await window.render(ctx, t);
      const text = rendered.text;
      let keyboard = rendered.keyboard;

      // 🪄 Автоматически добавляем кнопку «Назад» с учетом исключений и локализации
      const isMainOrCompleted =
        windowId === 'main_menu' || windowId === 'completed' || windowId === 'confirm_restart';
      if (
        keyboard &&
        ctx.session.history &&
        ctx.session.history.length > 0 &&
        !isMainOrCompleted &&
        !window.disableBackButton
      ) {
        keyboard = DialogManager.appendBackButton(
          keyboard,
          (t as TranslationFunction)('btn_back')
        );
      }

      const otherOptions: { parse_mode: 'Markdown'; reply_markup?: InlineKeyboard } = {
        parse_mode: 'Markdown',
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
      ctx: DialogContext<TState, TId>,
      next: () => Promise<void>
    ): Promise<void> => {
      try {
        const userId = ctx.from?.id;
        const windowId = ctx.session.currentWindow;
        if (!windowId) {
          return next();
        }

        const window = this.windows.get(windowId);
        if (!window) {
          return next();
        }

        const t = this.getTranslator(ctx);

        // 🛡️ Проверяем Guard на уровне middleware перед обработкой кликов или ввода
        if (window.guard) {
          const guardResult = await window.guard(ctx, this, t);
          if (guardResult === false) {
            logger.warn(`Window guard blocked middleware action`, { userId, windowId });
            // Снимаем «часики» с нажатой кнопки
            if (ctx.callbackQuery) {
              await ctx.answerCallbackQuery().catch(() => { });
            }
            return;
          }
          if (typeof guardResult === 'string' && guardResult !== windowId) {
            logger.info(`Window guard redirected user in middleware`, {
              userId,
              fromWindow: windowId,
              toWindow: guardResult,
            });
            await this.goTo(ctx, guardResult as TId);
            return;
          }
        }

        // 1. Обработка нажатий на инлайн-кнопки
        if (ctx.callbackQuery && ctx.callbackQuery.data) {
          const actionKey = ctx.callbackQuery.data;

          logger.debug(`User triggered action`, { userId, windowId, actionKey });

          // 🌐 Перехват смены языка (формат: lang_ru, lang_en и т.д.)
          if (actionKey.startsWith('lang_')) {
            const newLang = actionKey.replace('lang_', '');
            try {
              await this.setLanguage(ctx, newLang);
            } finally {
              if (!ctx.callbackQuery.inline_message_id) {
                await ctx
                  .answerCallbackQuery({
                    text: (this.getTranslator(ctx) as TranslationFunction)('language_changed'),
                  })
                  .catch(() => { });
              }
            }
            return;
          }

          if (actionKey === 'global_back_to_menu') {
            try {
              await this.goTo(ctx, 'main_menu' as TId);
            } finally {
              if (!ctx.callbackQuery.inline_message_id) {
                await ctx.answerCallbackQuery().catch(() => { });
              }
            }
            return;
          }

          if (actionKey === 'global_back') {
            try {
              await this.goBack(ctx);
            } finally {
              if (!ctx.callbackQuery.inline_message_id) {
                await ctx.answerCallbackQuery().catch(() => { });
              }
            }
            return;
          }

          const actionHandler = window.actions?.[actionKey];

          if (!actionHandler) {
            logger.warn(`Action handler not found`, { userId, windowId, actionKey });
            await ctx
              .answerCallbackQuery({ text: (t as TranslationFunction)('action_not_available') })
              .catch(() => { });
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
            if (!ctx.callbackQuery.inline_message_id) {
              await ctx.answerCallbackQuery().catch(() => { });
            }
          }
          return;
        }

        // 2. Обработка обычного текстового ввода с форматтером и валидацией через Zod
        if (
          ctx.message &&
          ctx.message.text &&
          (window.inputSchema || window.onInput || window.formatter)
        ) {
          // Команды (/start и т.д.) не считаются вводом, отдаём их дальше
          if (ctx.message.text.startsWith('/')) {
            return next();
          }

          await ctx.deleteMessage().catch(() => { });

          const rawInput = ctx.message.text.trim();
          const formattedInput = window.formatter ? window.formatter(rawInput) : rawInput;

          if (window.inputSchema) {
            const parseResult = window.inputSchema.safeParse(formattedInput);

            if (!parseResult.success) {
              const firstError =
                parseResult.error.issues[0]?.message ||
                (t as TranslationFunction)('invalid_format');

              logger.warn(`Window input validation failed`, {
                userId,
                windowId,
                error: firstError,
                rawInput,
              });

              ctx.session.data.error = firstError;
              await this.show(ctx);
              return;
            }

            delete ctx.session.data.error;
            ctx.session.data.validatedInput = parseResult.data;
          } else {
            ctx.session.data.validatedInput = formattedInput;
          }

          if (window.onInput) {
            try {
              await window.onInput(ctx, this, t);
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