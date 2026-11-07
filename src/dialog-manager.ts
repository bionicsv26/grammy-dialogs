import { Bot, Context, InlineKeyboard } from 'grammy';
import { z } from 'zod';

export interface DialogSession<
  TState extends Record<string, any> = Record<string, any>,
  TId extends string = string
> {
  currentWindow?: TId;
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

  async start(
    ctx: DialogContext<TState, TId>,
    windowId: TId,
    initialData: Partial<TState> = {}
  ): Promise<void> {
    if (!this.windows.has(windowId)) {
      throw new Error(`Window with id "${windowId}" is not registered.`);
    }
    ctx.session.currentWindow = windowId;
    ctx.session.data = { ...initialData } as DialogSession<TState, TId>['data'];
    delete ctx.session.messageId;
    await this.show(ctx);
  }

  async goTo(ctx: DialogContext<TState, TId>, windowId: TId): Promise<void> {
    if (!this.windows.has(windowId)) {
      throw new Error(`Window with id "${windowId}" is not registered.`);
    }
    ctx.session.currentWindow = windowId;
    await this.show(ctx);
  }

  async show(ctx: DialogContext<TState, TId>): Promise<void> {
    const windowId = ctx.session.currentWindow;
    if (!windowId) return;

    const window = this.windows.get(windowId);
    if (!window) return;

    // 🛡️ Проверяем Guard перед рендером
    if (window.guard) {
      const guardResult = await window.guard(ctx, this);
      if (guardResult === false) {
        return; // Галерея/окно заблокированы гардом
      }
      if (typeof guardResult === 'string' && guardResult !== windowId) {
        await this.goTo(ctx, guardResult as TId);
        return;
      }
    }

    const { text, keyboard } = await window.render(ctx);

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
          return;
        }
        if (typeof guardResult === 'string' && guardResult !== windowId) {
          await this.goTo(ctx, guardResult as TId);
          return;
        }
      }

      // 1. Обработка нажатий на инлайн-кнопки
      if (ctx.callbackQuery && ctx.callbackQuery.data) {
        const actionKey = ctx.callbackQuery.data;

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

        const actionHandler = window.actions?.[actionKey];

        if (!actionHandler) {
          await ctx.answerCallbackQuery({ text: 'Действие недоступно' }).catch(() => { });
          return next();
        }

        try {
          await actionHandler(ctx, this);
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
          await window.onInput(ctx, this);
        }
        return;
      }

      return next();
    };
  }
}