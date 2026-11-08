import { Bot, Context, InlineKeyboard } from 'grammy';
import { z } from 'zod';
import { logger } from './logger.js';

export interface DialogSession<
  TState extends Record<string, any> = Record<string, any>,
  TId extends string = string
> {
  currentWindow?: TId;
  history?: string[]; // 👈 Стек истории переходов
  data: TState & { error?: string; validatedInput?: any };
  messageId?: number;
}

export type DialogContext<
  TState extends Record<string, any> = Record<string, any>,
  TId extends string = string
> = Context & {
  session: DialogSession<TState, TId>;
};

export type WindowRenderResult = {
  text: string;
  keyboard?: InlineKeyboard;
};

export type WindowActionHandler<TState extends Record<string, any>, TId extends string> = (
  ctx: DialogContext<TState, TId>,
  manager: DialogManager<TState, TId>
) => Promise<void> | void;

export type WindowInputHandler<TState extends Record<string, any>, TId extends string> = (
  ctx: DialogContext<TState, TId>,
  manager: DialogManager<TState, TId>
) => Promise<void> | void;

// 🛡️ Тип для защитных функций (Guards)
export type WindowGuard<TState extends Record<string, any>, TId extends string> = (
  ctx: DialogContext<TState, TId>,
  manager: DialogManager<TState, TId>
) => Promise<boolean | TId> | boolean | TId;

// 🪄 Тип для кастомного форматтера ввода
export type WindowInputFormatter = (rawInput: string) => any;

export interface WindowConfig<TState extends Record<string, any>, TId extends string> {
  id: TId;
  render: (
    ctx: DialogContext<TState, TId>
  ) => Promise<WindowRenderResult> | WindowRenderResult;
  actions?: Record<string, WindowActionHandler<TState, TId>>;
  onInput?: WindowInputHandler<TState, TId>;
  formatter?: WindowInputFormatter; // 🪄 Опциональный форматтер
  inputSchema?: z.ZodType;
  guard?: WindowGuard<TState, TId>; // 🛡️ Защита окна
  disableBackButton?: boolean; // 👈 Флаг отключения авто-кнопки Назад для конкретного окна
}

export class DialogManager<
  TState extends Record<string, any> = Record<string, any>,
  TId extends string = string
> {
  private windows = new Map<TId, WindowConfig<TState, TId>>();

  constructor(private bot: Bot<DialogContext<TState, TId>>) { }

  register(window: WindowConfig<TState, TId>): this {
    this.windows.set(window.id, window);
    return this;
  }

  // 🪄 Хелпер для добавления кнопки «Назад» к любой инлайн-клавиатуре
  static appendBackButton(keyboard: InlineKeyboard, text: string = '⬅️ Назад'): InlineKeyboard {
    return keyboard.row().text(text, 'global_back');
  }

  async start(
    ctx: DialogContext<TState, TId>,
    windowId: TId,
    initialData: Partial<TState> = {}
  ): Promise<void> {
    if (!this.windows.has(windowId)) {
      throw new Error(`Window with id "${windowId}" is not registered.`);
    }

    logger.info(`Starting dialog at window`, { userId: ctx.from?.id, windowId });

    ctx.session.currentWindow = windowId;
    ctx.session.data = { ...initialData } as DialogSession<TState, TId>['data'];
    delete ctx.session.messageId;
    ctx.session.history = []; // Очищаем историю при старте
    await this.show(ctx);
  }

  // 🧭 Переход с сохранением истории
  async goTo(ctx: DialogContext<TState, TId>, windowId: TId): Promise<void> {
    if (!this.windows.has(windowId)) {
      logger.error(`Attempted to navigate to unregistered window`, { userId: ctx.from?.id, targetWindow: windowId });
      throw new Error(`Window with id "${windowId}" is not registered.`);
    }

    const currentWindow = ctx.session.currentWindow;

    // Если переходим на то же самое окно, ничего не делаем
    if (currentWindow === windowId) return;

    // Инициализируем историю, если её не было
    if (!ctx.session.history) {
      ctx.session.history = [];
    }

    // Сохраняем текущее окно в историю перед переходом
    if (currentWindow) {
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
  }

  // ⬅️ Возврат на предыдущее окно из стека
  async goBack(ctx: DialogContext<TState, TId>): Promise<void> {
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
  }

  async show(ctx: DialogContext<TState, TId>): Promise<void> {
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

    // 🛡️ Проверяем Guard перед рендером
    if (window.guard) {
      const guardResult = await window.guard(ctx, this);
      if (guardResult === false) {
        logger.warn(`Window guard blocked access (render halted)`, { userId, windowId });
        return; // Галерея/окно заблокированы гардом
      }
      if (typeof guardResult === 'string' && guardResult !== windowId) {
        logger.info(`Window guard redirected user`, { userId, fromWindow: windowId, toWindow: guardResult });
        await this.goTo(ctx, guardResult as TId);
        return;
      }
    }

    const rendered = await window.render(ctx);
    const text = rendered.text;
    let keyboard = rendered.keyboard;

    // 🪄 Автоматически добавляем кнопку «Назад» с учетом исключений
    const isMainOrCompleted = windowId === 'main_menu' || windowId === 'completed' || windowId === 'confirm_restart';
    if (
      keyboard &&
      ctx.session.history &&
      ctx.session.history.length > 0 &&
      !isMainOrCompleted &&
      !window.disableBackButton
    ) {
      keyboard = DialogManager.appendBackButton(keyboard);
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
  }

  middleware() {
    return async (
      ctx: DialogContext<TState, TId>,
      next: () => Promise<void>
    ): Promise<void> => {
      const userId = ctx.from?.id;
      const windowId = ctx.session.currentWindow;
      if (!windowId) {
        return next();
      }

      const window = this.windows.get(windowId);
      if (!window) {
        return next();
      }

      // 🛡️ Проверяем Guard на уровне middleware перед обработкой кликов или ввода
      if (window.guard) {
        const guardResult = await window.guard(ctx, this);
        if (guardResult === false) {
          logger.warn(`Window guard blocked middleware action`, { userId, windowId });
          return;
        }
        if (typeof guardResult === 'string' && guardResult !== windowId) {
          logger.info(`Window guard redirected user in middleware`, { userId, fromWindow: windowId, toWindow: guardResult });
          await this.goTo(ctx, guardResult as TId);
          return;
        }
      }

      // 1. Обработка нажатий на инлайн-кнопки
      if (ctx.callbackQuery && ctx.callbackQuery.data) {
        const actionKey = ctx.callbackQuery.data;

        logger.debug(`User triggered action`, { userId, windowId, actionKey });

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
          await ctx.answerCallbackQuery({ text: 'Действие недоступно' }).catch(() => { });
          return next();
        }

        try {
          await actionHandler(ctx, this);
        } catch (error) {
          logger.error(`Error occurred while executing action handler`, {
            userId,
            windowId,
            actionKey,
            error,
          });
          throw error;
        } finally {
          if (!ctx.callbackQuery.inline_message_id) {
            await ctx.answerCallbackQuery().catch(() => { });
          }
        }
        return;
      }

      // 2. Обработка обычного текстового ввода с форматтером и валидацией через Zod
      if (ctx.message && ctx.message.text && (window.inputSchema || window.onInput || window.formatter)) {
        await ctx.deleteMessage().catch(() => { });

        const rawInput = ctx.message.text.trim();

        // 🪄 Шаг 1: Применяем кастомный форматтер, если он задан
        const formattedInput = window.formatter ? window.formatter(rawInput) : rawInput;

        // 🪄 Шаг 2: Валидируем уже отформатированные данные через Zod
        if (window.inputSchema) {
          const parseResult = window.inputSchema.safeParse(formattedInput);

          if (!parseResult.success) {
            const firstError = parseResult.error.issues[0]?.message || 'Неверный формат данных';

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
          // Если схемы нет, но есть форматтер — передаем отформатированный результат в validatedInput
          ctx.session.data.validatedInput = formattedInput;
        }

        if (window.onInput) {
          try {
            await window.onInput(ctx, this);
          } catch (error) {
            logger.error(`Error occurred while executing onInput handler`, {
              userId,
              windowId,
              error,
            });
            throw error;
          }
        }
        return;
      }

      return next();
    };
  }
}