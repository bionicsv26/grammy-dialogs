import { Bot, Context, InlineKeyboard } from 'grammy';

export interface DialogSession {
  currentWindow?: string;
  data: Record<string, any>;
  messageId?: number;
}

export type DialogContext = Context & { session: DialogSession };

export type WindowInputHandler = (ctx: DialogContext, manager: DialogManager) => Promise<void> | void;

export interface WindowConfig {
  id: string;
  render: (ctx: DialogContext) => Promise<WindowRenderResult> | WindowRenderResult;
  actions?: Record<string, WindowActionHandler>;
  onInput?: WindowInputHandler; // Обработчик текстового ввода для окна
}

export type WindowRenderResult = {
  text: string;
  keyboard: InlineKeyboard;
};

export type WindowActionHandler = (ctx: DialogContext, manager: DialogManager) => Promise<void> | void;

export interface WindowConfig {
  id: string;
  render: (ctx: DialogContext) => Promise<WindowRenderResult> | WindowRenderResult;
  actions?: Record<string, WindowActionHandler>;
}

export class DialogManager {
  private windows = new Map<string, WindowConfig>();

  // Принимаем бота в конструкторе
  constructor(private bot: Bot<DialogContext>) { }

  /**
   * Регистрация нового окна в системе диалогов
   */
  register(window: WindowConfig): this {
    this.windows.set(window.id, window);
    return this;
  }

  /**
   * Запуск диалога с указанного окна
   */
  async start(ctx: DialogContext, windowId: string, initialData: Record<string, any> = {}): Promise<void> {
    if (!this.windows.has(windowId)) {
      throw new Error(`Window with id "${windowId}" is not registered.`);
    }
    ctx.session.currentWindow = windowId;
    ctx.session.data = { ...initialData };
    delete ctx.session.messageId;
    await this.show(ctx);
  }

  /**
   * Переход на другое окно внутри текущего диалога
   */
  async goTo(ctx: DialogContext, windowId: string): Promise<void> {
    if (!this.windows.has(windowId)) {
      throw new Error(`Window with id "${windowId}" is not registered.`);
    }
    ctx.session.currentWindow = windowId;
    await this.show(ctx);
  }

  /**
   * Отрисовка текущего окна (редактирование существующего сообщения или отправка нового)
   */
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

  /**
   * Middleware для автоматического перехвата нажатий инлайн-кнопок
   */
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

      // 2. Обработка обычного текстового ввода от пользователя
      if (ctx.message && ctx.message.text && window.onInput) {
        // Пытаемся удалить сообщение пользователя, чтобы чат оставался чистым
        await ctx.deleteMessage().catch(() => { });

        // Вызываем обработчик ввода текущего окна
        await window.onInput(ctx, this);
        return;
      }

      return next();
    };
  }
}