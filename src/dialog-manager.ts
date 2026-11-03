import { Bot, Context, InlineKeyboard } from 'grammy';
import { z } from 'zod';

export interface DialogSession {
  currentWindow?: string;
  data: Record<string, any>;
  messageId?: number;
  [key: string]: any;
}

export type DialogContext = Context & { session: DialogSession };

export type WindowRenderResult = {
  text: string;
  keyboard: InlineKeyboard;
};

export type WindowActionHandler = (ctx: DialogContext, manager: DialogManager) => Promise<void> | void;
export type WindowInputHandler = (ctx: DialogContext, manager: DialogManager) => Promise<void> | void;

export interface WindowConfig {
  id: string;
  render: (ctx: DialogContext) => Promise<WindowRenderResult> | WindowRenderResult;
  actions?: Record<string, WindowActionHandler>;
  onInput?: WindowInputHandler;
  inputSchema?: z.ZodType;
}

export class DialogManager {
  private windows = new Map<string, WindowConfig>();

  constructor(private bot: Bot<DialogContext>) { }

  register(window: WindowConfig): this {
    this.windows.set(window.id, window);
    return this;
  }

  async start(ctx: DialogContext, windowId: string, initialData: Record<string, any> = {}): Promise<void> {
    if (!this.windows.has(windowId)) {
      throw new Error(`Window with id "${windowId}" is not registered.`);
    }
    ctx.session.currentWindow = windowId;
    ctx.session.data = { ...initialData };
    delete ctx.session.messageId;
    await this.show(ctx);
  }

  async goTo(ctx: DialogContext, windowId: string): Promise<void> {
    if (!this.windows.has(windowId)) {
      throw new Error(`Window with id "${windowId}" is not registered.`);
    }
    ctx.session.currentWindow = windowId;
    await this.show(ctx);
  }

  async show(ctx: DialogContext): Promise<void> {
    const windowId = ctx.session.currentWindow;
    if (!windowId) return;

    const window = this.windows.get(windowId);
    if (!window) return;

    const { text, keyboard } = await window.render(ctx);

    if (ctx.session.messageId && ctx.chat) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, ctx.session.messageId, text, {
          reply_markup: keyboard,
          parse_mode: 'Markdown',
        });
        return;
      } catch (error) {
        delete ctx.session.messageId;
      }
    }

    if (ctx.chat) {
      const msg = await ctx.reply(text, {
        reply_markup: keyboard,
        parse_mode: 'Markdown',
      });
      ctx.session.messageId = msg.message_id;
    }
  }

  middleware() {
    return async (ctx: DialogContext, next: () => Promise<void>): Promise<void> => {
      const windowId = ctx.session.currentWindow;
      if (!windowId) {
        return next();
      }

      const window = this.windows.get(windowId);
      if (!window) {
        return next();
      }

      // 1. Обработка нажатий на инлайн-кнопки
      if (ctx.callbackQuery && ctx.callbackQuery.data) {
        const actionKey = ctx.callbackQuery.data;

        // 🌐 УНИВЕРСАЛЬНЫЙ ПЕРЕХВАТЧИК: Возврат в главное меню из любой точки
        if (actionKey === 'global_back_to_menu') {
          try {
            await this.goTo(ctx, 'main_menu'); // Укажите id вашего главного меню
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

      // 2. Обработка обычного текстового ввода с валидацией через Zod
      if (ctx.message && ctx.message.text && (window.inputSchema || window.onInput)) {
        // ⚡ Мгновенно удаляем сообщение пользователя из чата до валидации
        await ctx.deleteMessage().catch(() => { });

        const textInput = ctx.message.text.trim();

        if (window.inputSchema) {
          const parseResult = window.inputSchema.safeParse(textInput);

          if (!parseResult.success) {
            const firstError = parseResult.error.issues[0]?.message || 'Неверный формат данных';
            ctx.session.data.error = firstError;
            await this.show(ctx);
            return;
          }

          // ✅ Успешно прошли валидацию — обязательно очищаем прошлую ошибку!
          delete ctx.session.data.error;
          ctx.session.data.validatedInput = parseResult.data;
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