import { Context, InlineKeyboard, InputFile } from 'grammy';
import type { InputMedia } from 'grammy/types';
import { z } from 'zod';
import { isMessageNotModified } from './telegram-errors.js';
import { escapeForMode, type ParseMode } from './parse-mode.js';

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

// ─── Логгер: ядро не знает про логгер приложения ────────────────────────────
export interface DialogLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const noop = (): void => { };
const noopLogger: DialogLogger = { debug: noop, info: noop, warn: noop, error: noop };

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

// ─── Сессия: стек фреймов ───────────────────────────────────────────────────
export interface DialogFrame {
  dialog: string;
  window: string;
  history: string[];
  data: Record<string, any>;
  startData?: unknown;
}

export interface DialogSession {
  lang?: string;
  messageId?: number;
  messageKind?: 'text' | MediaKind;
  stack: DialogFrame[]; // последний элемент — активный диалог
}

export type DialogContext<
  TState extends Record<string, any> = Record<string, any>
> = Context & {
  session: DialogSession;
  frame: DialogFrame;
  data: TState & { error?: string };
};

// ─── Типы переводов и окон ──────────────────────────────────────────────────
export type TranslationFunction<TKeys extends string = string> = (
  key: TKeys | CoreTranslationKey,
  params?: Record<string, string | number>
) => string;

export type MediaKind = 'photo' | 'document' | 'video' | 'animation';

export type WindowRenderResult =
  | { kind?: 'text'; text: string; keyboard?: InlineKeyboard }
  | { kind: 'photo'; photo: InputFile | string; caption?: string; keyboard?: InlineKeyboard }
  | { kind: 'document'; document: InputFile | string; caption?: string; keyboard?: InlineKeyboard }
  | { kind: 'video'; video: InputFile | string; caption?: string; keyboard?: InlineKeyboard }
  | { kind: 'animation'; animation: InputFile | string; caption?: string; keyboard?: InlineKeyboard };

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
 * «пустить / заблокировать / редиректить». Без сайд-эффектов.
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

/** Вызывается у родительского окна, когда поддиалог завершился через done(). */
export type WindowResultHandler<
  TState extends Record<string, any>,
  TId extends string,
  TKeys extends string = string
> = (
  ctx: DialogContext<TState>,
  manager: DialogManager<TState, TId, TKeys>,
  t: TranslationFunction<TKeys>,
  result: unknown
) => Promise<void> | void;

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
  onDialogResult?: WindowResultHandler<TState, TId, TKeys>;
  formatter?: WindowInputFormatter<TValue>;
  inputSchema?: z.ZodType<TValue>;
  guard?: WindowGuard<TState, TId, TKeys>;
  disableBackButton?: boolean;
}

// ─── Диалог ─────────────────────────────────────────────────────────────────
export interface DialogConfig<
  TState extends Record<string, any>,
  TId extends string,
  TKeys extends string = string
> {
  id: string;
  /** По умолчанию — первое окно массива. */
  entry?: TId | undefined;
  windows: readonly WindowConfig<TState, TId, TKeys, any>[];
}

export function defineDialog<
  TState extends Record<string, any>,
  TId extends string,
  TKeys extends string = string
>(config: DialogConfig<TState, TId, TKeys>): DialogConfig<TState, TId, TKeys> {
  return config;
}

export function defineWindow<
  TState extends Record<string, any>,
  TId extends string,
  TKeys extends string = string
>() {
  return <TValue = string>(
    window: WindowConfig<TState, TId, TKeys, TValue>
  ): WindowConfig<TState, TId, TKeys, TValue> => window;
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
  rootDialogId?: string | undefined;
  parseMode?: ParseMode | undefined;
  maxNavigationDepth?: number | undefined;
  maxHistory?: number | undefined;
  /** Максимальная глубина стека диалогов. По умолчанию 8. */
  maxDialogDepth?: number | undefined;
  /** Логгер ядра. По умолчанию — no-op (библиотека молчит, пока не попросишь). */
  logger?: DialogLogger | undefined;
  /**
 * Определять язык из ctx.from.language_code при первом контакте,
 * если session.lang ещё не задан. По умолчанию true.
 */
  negotiateLanguage?: boolean | undefined;
}

type AnyWindowConfig = WindowConfig<any, any, any, any>;
type AnyErrorHandler = (
  error: unknown,
  ctx: DialogContext<any>,
  manager: DialogManager<any, any, any>
) => Promise<void> | void;

interface RegisteredDialog {
  entry: string;
  windows: Map<string, AnyWindowConfig>;
}

type RenderContent =
  | { kind: 'text'; text: string }
  | { kind: MediaKind; file: InputFile | string; caption?: string | undefined };

function toContent(r: WindowRenderResult): RenderContent {
  if (r.kind === undefined || r.kind === 'text') {
    return { kind: 'text', text: r.text };
  }
  switch (r.kind) {
    case 'photo':
      return { kind: 'photo', file: r.photo, caption: r.caption };
    case 'document':
      return { kind: 'document', file: r.document, caption: r.caption };
    case 'video':
      return { kind: 'video', file: r.video, caption: r.caption };
    case 'animation':
      return { kind: 'animation', file: r.animation, caption: r.caption };
    default:
      throw new Error(`Unsupported render result kind`);
  }
}

function toInputMedia(
  c: { kind: MediaKind; file: InputFile | string; caption?: string | undefined },
  parseMode: ParseMode
): InputMedia {
  const common = {
    media: c.file,
    parse_mode: parseMode,
    ...(c.caption !== undefined && { caption: c.caption }),
  };
  switch (c.kind) {
    case 'photo': return { type: 'photo', ...common };
    case 'document': return { type: 'document', ...common };
    case 'video': return { type: 'video', ...common };
    case 'animation': return { type: 'animation', ...common };
  }
}

// ─── Менеджер диалогов ──────────────────────────────────────────────────────
export class DialogManager<
  TState extends Record<string, any> = Record<string, any>,
  TId extends string = string,
  TKeys extends string = string
> {
  private log: DialogLogger;
  private dialogs = new Map<string, RegisteredDialog>();
  private errorHandler: AnyErrorHandler | undefined;
  private translations: Record<string, Record<string, string>>;
  private defaultLang: string;
  private rootDialogId: string | undefined;
  private parseMode: ParseMode;
  private maxNavigationDepth: number;
  private maxHistory: number;
  private maxDialogDepth: number;
  private navDepth = new WeakMap<object, number>();
  private handlingError = new WeakSet<object>();
  private negotiateLanguage: boolean;

  constructor(options?: DialogManagerOptions<TState, TId, TKeys>) {
    this.log = options?.logger ?? noopLogger;
    this.errorHandler = options?.onError;
    this.defaultLang = options?.defaultLang ?? 'ru';
    this.rootDialogId = options?.rootDialogId;
    this.parseMode = options?.parseMode ?? 'HTML';
    this.maxNavigationDepth = options?.maxNavigationDepth ?? 10;
    this.maxHistory = Math.max(0, options?.maxHistory ?? 50);
    this.maxDialogDepth = Math.max(1, options?.maxDialogDepth ?? 8);
    this.negotiateLanguage = options?.negotiateLanguage ?? true;

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

  registerDialog<TS extends Record<string, any>, TI extends string>(
    dialog: DialogConfig<TS, TI, TKeys>
  ): this {
    if (this.dialogs.has(dialog.id)) {
      throw new Error(`Dialog "${dialog.id}" is already registered.`);
    }

    const windows = new Map<string, AnyWindowConfig>();
    for (const w of dialog.windows) {
      if (windows.has(w.id)) {
        throw new Error(`Window "${w.id}" is already registered in dialog "${dialog.id}".`);
      }
      for (const actionKey of Object.keys(w.actions ?? {})) {
        if (actionKey.startsWith(CALLBACK_PREFIX)) {
          throw new Error(
            `Action key "${actionKey}" in window "${w.id}" uses the reserved namespace "${CALLBACK_PREFIX}".`
          );
        }
        assertValidCallbackData(actionKey, `action "${actionKey}" in window "${w.id}"`);
      }
      windows.set(w.id, w as AnyWindowConfig);
    }

    const first = dialog.windows[0];
    if (!first) {
      throw new Error(`Dialog "${dialog.id}" has no windows.`);
    }
    const entry = dialog.entry ?? first.id;
    if (!windows.has(entry)) {
      throw new Error(`Entry window "${entry}" is not defined in dialog "${dialog.id}".`);
    }

    this.dialogs.set(dialog.id, { entry, windows });
    return this;
  }

  public getFrame(ctx: DialogContext<any>): DialogFrame | undefined {
    const stack = ctx.session?.stack;
    if (!stack || stack.length === 0) return undefined;
    return stack[stack.length - 1];
  }

  /** ID зарегистрированных диалогов — для стартовой диагностики. */
  public registeredDialogIds(): string[] {
    return [...this.dialogs.keys()];
  }

  /** Привязывает контекст к сессии: язык и активный фрейм. */
  private bind(ctx: DialogContext<any>): DialogFrame | undefined {
    this.ensureLanguage(ctx);
    const frame = this.getFrame(ctx);
    if (frame) {
      ctx.frame = frame;
      ctx.data = frame.data;
    }
    return frame;
  }

  private resolveWindow(frame: DialogFrame): AnyWindowConfig | undefined {
    return this.dialogs.get(frame.dialog)?.windows.get(frame.window);
  }

  public getTranslator(ctx: DialogContext<TState>): TranslationFunction<TKeys> {
    const lang = ctx.session.lang ?? this.defaultLang;

    return (key: TKeys | CoreTranslationKey, params?: Record<string, string | number>): string => {
      const text =
        this.translations[lang]?.[key] ??
        this.translations[this.defaultLang]?.[key];

      if (text === undefined) {
        this.log.warn(`Translation key not found`, { lang, key });
        return key;
      }
      if (!params) return text;

      return text.replace(/\{(\w+)\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name)
          ? escapeForMode(String(params[name]), this.parseMode)
          : match
      );
    };
  }

  /**
 * Первый контакт: берём язык из Telegram, если для него есть словарь.
 * Явный выбор пользователя (session.lang) всегда важнее.
 */
  private ensureLanguage(ctx: DialogContext<TState>): void {
    if (!this.negotiateLanguage || ctx.session.lang) return;

    const raw = ctx.from?.language_code;
    if (!raw) return;

    const base = raw.split('-')[0]?.toLowerCase(); // en-US → en
    if (base && this.translations[base]) {
      ctx.session.lang = base;
      this.log.info(`Language negotiated from Telegram`, {
        userId: ctx.from?.id, lang: base,
      });
    }
    // Нет словаря — оставляем lang незаданным, сработает defaultLang.
  }

  async setLanguage(ctx: DialogContext<TState>, lang: string): Promise<void> {
    ctx.session.lang = lang;
    this.log.info(`User changed language`, { userId: ctx.from?.id, lang });
    await this.show(ctx);
  }

  static appendBackButton(
    keyboard: InlineKeyboard,
    text: string = coreTranslations.en.btn_back
  ): InlineKeyboard {
    const result = keyboard.clone();
    const rows = result.inline_keyboard;
    const lastRow = rows[rows.length - 1];

    if (lastRow && lastRow.length === 0) {
      result.text(text, coreCallbacks.back);
    } else {
      result.row().text(text, coreCallbacks.back);
    }
    return result;
  }

  private async answerCallback(
    ctx: DialogContext<TState>,
    other?: Parameters<DialogContext<TState>['answerCallbackQuery']>[0]
  ): Promise<void> {
    if (!ctx.callbackQuery || ctx.callbackQuery.inline_message_id) return;
    await ctx.answerCallbackQuery(other).catch(() => { });
  }

  private async sendContent(
    ctx: DialogContext<TState>,
    content: RenderContent,
    other: { parse_mode: ParseMode; reply_markup?: InlineKeyboard }
  ) {
    if (content.kind === 'text') return ctx.reply(content.text, other);

    const mediaOther = {
      ...other,
      ...(content.caption !== undefined && { caption: content.caption }),
    };
    switch (content.kind) {
      case 'photo': return ctx.replyWithPhoto(content.file, mediaOther);
      case 'document': return ctx.replyWithDocument(content.file, mediaOther);
      case 'video': return ctx.replyWithVideo(content.file, mediaOther);
      case 'animation': return ctx.replyWithAnimation(content.file, mediaOther);
    }
  }

  private async handleError(error: unknown, ctx: DialogContext<TState>): Promise<void> {
    const frame = this.getFrame(ctx);
    this.log.error(`DialogManager execution error`, {
      userId: ctx.from?.id,
      dialog: frame?.dialog,
      window: frame?.window,
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
          this.log.error(`Error occurred inside custom onError handler`, { handlerError });
        }
      }
      await ctx.reply(this.getTranslator(ctx)('error_fallback')).catch(() => { });
    } finally {
      this.handlingError.delete(ctx);
    }
  }

  /** Кладёт фрейм поддиалога ПОВЕРХ текущего. Сообщение редактируется на месте. */
  async startDialog(
    ctx: DialogContext<TState>,
    dialogId: string,
    options: { startData?: unknown; entry?: string } = {}
  ): Promise<void> {
    try {
      const dialog = this.dialogs.get(dialogId);
      if (!dialog) throw new Error(`Dialog "${dialogId}" is not registered.`);

      const entry = options.entry ?? dialog.entry;
      if (!dialog.windows.has(entry)) {
        throw new Error(`Entry window "${entry}" is not defined in dialog "${dialogId}".`);
      }

      if (!ctx.session.stack) ctx.session.stack = [];
      const stack = ctx.session.stack;

      if (stack.length >= this.maxDialogDepth) {
        throw new Error(
          `Dialog stack depth limit (${this.maxDialogDepth}) exceeded when starting "${dialogId}".`
        );
      }

      this.log.info(`Starting dialog`, {
        userId: ctx.from?.id, dialogId, entry, depth: stack.length + 1,
      });

      stack.push({
        dialog: dialogId,
        window: entry,
        history: [],
        data: {},
        ...(options.startData !== undefined && { startData: options.startData }),
      });
      this.bind(ctx);
      await this.show(ctx);
    } catch (error) {
      await this.handleError(error, ctx);
    }
  }

  /** Завершает активный поддиалог и возвращает результат родительскому окну. */
  async done(ctx: DialogContext<TState>, result?: unknown): Promise<void> {
    try {
      const stack = ctx.session.stack;
      if (!stack || stack.length === 0) {
        this.log.warn(`Attempted to finish dialog, but stack is empty`, { userId: ctx.from?.id });
        return;
      }

      const finished = stack.pop();
      this.log.info(`Dialog finished`, {
        userId: ctx.from?.id, dialog: finished?.dialog, remaining: stack.length,
      });

      if (stack.length === 0) {
        if (this.rootDialogId !== undefined) {
          await this.resetDialog(ctx, this.rootDialogId);
        }
        return;
      }

      const frame = this.bind(ctx);
      if (!frame) return;

      delete ctx.data.error;

      const window = this.resolveWindow(frame);
      if (!window) return;

      const t = this.getTranslator(ctx);
      if (window.onDialogResult) {
        await window.onDialogResult(ctx, this, t, result);
      } else {
        await this.show(ctx);
      }
    } catch (error) {
      await this.handleError(error, ctx);
    }
  }

  /** Очищает стек и стартует диалог заново, редактируя текущее сообщение. */
  async resetDialog(
    ctx: DialogContext<TState>,
    dialogId: string,
    options: { startData?: unknown; entry?: string } = {}
  ): Promise<void> {
    ctx.session.stack = [];
    await this.startDialog(ctx, dialogId, options);
  }

  /** Полный сброс: снимает старую клавиатуру и шлёт новое сообщение. */
  async restart(
    ctx: DialogContext<TState>,
    dialogId: string,
    options: { startData?: unknown; entry?: string } = {}
  ): Promise<void> {
    try {
      if (ctx.session.messageId && ctx.chat) {
        await ctx.api
          .editMessageReplyMarkup(ctx.chat.id, ctx.session.messageId, {
            reply_markup: { inline_keyboard: [] },
          })
          .catch(() => { });
      }
      delete ctx.session.messageId;
      delete ctx.session.messageKind;
      await this.resetDialog(ctx, dialogId, options);
    } catch (error) {
      await this.handleError(error, ctx);
    }
  }

  async goTo(
    ctx: DialogContext<TState>,
    windowId: TId,
    options: { pushHistory?: boolean } = {}
  ): Promise<void> {
    const depth = this.navDepth.get(ctx) ?? 0;
    this.navDepth.set(ctx, depth + 1);
    try {
      if (depth >= this.maxNavigationDepth) {
        throw new Error(
          `Navigation depth limit (${this.maxNavigationDepth}) exceeded at window "${windowId}". ` +
          `Possible guard redirect cycle.`
        );
      }

      const frame = this.bind(ctx);
      if (!frame) throw new Error(`No active dialog to navigate in.`);

      const dialog = this.dialogs.get(frame.dialog);
      if (!dialog?.windows.has(windowId)) {
        throw new Error(`Window "${windowId}" is not registered in dialog "${frame.dialog}".`);
      }

      if (frame.window === windowId) {
        await this.show(ctx);
        return;
      }

      if (options.pushHistory !== false) {
        frame.history.push(frame.window);
        if (frame.history.length > this.maxHistory) {
          frame.history.splice(0, frame.history.length - this.maxHistory);
        }
      }

      delete ctx.data.error;

      this.log.info(`User navigated to window`, {
        userId: ctx.from?.id,
        dialog: frame.dialog,
        fromWindow: frame.window,
        toWindow: windowId,
        historyDepth: frame.history.length,
      });

      frame.window = windowId;
      await this.show(ctx);
    } catch (error) {
      await this.handleError(error, ctx);
    } finally {
      this.navDepth.set(ctx, depth);
    }
  }

  async goBack(ctx: DialogContext<TState>): Promise<void> {
    try {
      const frame = this.bind(ctx);
      if (!frame || frame.history.length === 0) {
        this.log.warn(`Attempted to go back, but history is empty`, { userId: ctx.from?.id });
        return;
      }

      const previousWindow = frame.history.pop() as TId;
      delete ctx.data.error;
      frame.window = previousWindow;
      await this.show(ctx);
    } catch (error) {
      await this.handleError(error, ctx);
    }
  }

  async show(ctx: DialogContext<TState>): Promise<void> {
    try {
      const userId = ctx.from?.id;
      const frame = this.bind(ctx);
      if (!frame) {
        this.log.warn(`Attempted to show window, but no active dialog`, { userId });
        return;
      }

      const window = this.resolveWindow(frame);
      if (!window) {
        this.log.error(`Window not found in registry during show`, {
          userId, dialog: frame.dialog, windowId: frame.window,
        });
        return;
      }

      const t = this.getTranslator(ctx);

      if (window.guard) {
        const guardResult = await window.guard(ctx, this, t);
        if (guardResult === false) {
          this.log.warn(`Window guard blocked access (render halted)`, { userId, windowId: frame.window });
          return;
        }
        if (typeof guardResult === 'string' && guardResult !== frame.window) {
          await this.goTo(ctx, guardResult as TId, { pushHistory: false });
          return;
        }
      }

      const rendered = await window.render(ctx, t);
      const content = toContent(rendered);
      let keyboard = rendered.keyboard;

      const shouldShowBack = frame.history.length > 0 && !window.disableBackButton;
      if (shouldShowBack) {
        keyboard = DialogManager.appendBackButton(
          keyboard ?? new InlineKeyboard(),
          t('btn_back')
        );
      }

      if (keyboard) {
        for (const row of keyboard.inline_keyboard) {
          for (const button of row) {
            if ('callback_data' in button && typeof button.callback_data === 'string') {
              assertValidCallbackData(button.callback_data, `button in window "${frame.window}"`);
            }
          }
        }
      }

      if (content.kind !== 'text' && content.caption && content.caption.length > 1024) {
        this.log.warn(`Media caption exceeds Telegram limit`, {
          windowId: frame.window, length: content.caption.length,
        });
      }

      const otherOptions: { parse_mode: ParseMode; reply_markup?: InlineKeyboard } = {
        parse_mode: this.parseMode,
      };
      if (keyboard) otherOptions.reply_markup = keyboard;

      const prevId = ctx.session.messageId;
      const prevKind = ctx.session.messageKind ?? 'text';
      // Текст и медиа редактируются по-разному; переход между ними — только заменой.
      const sameFamily = (content.kind === 'text') === (prevKind === 'text');

      if (prevId !== undefined && ctx.chat && sameFamily) {
        try {
          if (content.kind === 'text') {
            await ctx.api.editMessageText(ctx.chat.id, prevId, content.text, otherOptions);
          } else {
            await ctx.api.editMessageMedia(
              ctx.chat.id,
              prevId,
              toInputMedia(content, this.parseMode),
              keyboard ? { reply_markup: keyboard } : {}
            );
            ctx.session.messageKind = content.kind;
          }
          return;
        } catch (error) {
          if (isMessageNotModified(error)) {
            this.log.debug(`Message is already up to date`, { userId, windowId: frame.window });
            return;
          }
          this.log.debug(`Failed to edit message, sending a new one`, { userId, error });
          delete ctx.session.messageId;
          delete ctx.session.messageKind;
        }
      } else if (prevId !== undefined && ctx.chat) {
        await ctx.api.deleteMessage(ctx.chat.id, prevId).catch(() => { });
        delete ctx.session.messageId;
        delete ctx.session.messageKind;
      }

      if (ctx.chat) {
        const msg = await this.sendContent(ctx, content, otherOptions);
        ctx.session.messageId = msg.message_id;
        ctx.session.messageKind = content.kind;
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

        if (!ctx.session) return next();

        if (ctx.callbackQuery) {
          const original = ctx.answerCallbackQuery.bind(ctx);
          let answered = false;
          ctx.answerCallbackQuery = async (other?: Parameters<typeof original>[0]) => {
            if (answered) return true;
            const result = await original(other);
            answered = true;
            return result;
          };
        }

        const frame = this.bind(ctx);
        if (!frame) return next();

        const window = this.resolveWindow(frame);
        if (!window) return next();

        const t = this.getTranslator(ctx);

        if (window.guard) {
          const guardResult = await window.guard(ctx, this, t);
          if (guardResult === false) {
            this.log.warn(`Window guard blocked middleware action`, { userId, windowId: frame.window });
            await this.answerCallback(ctx);
            return;
          }
          if (typeof guardResult === 'string' && guardResult !== frame.window) {
            await this.goTo(ctx, guardResult as TId, { pushHistory: false });
            return;
          }
        }

        // 1. Инлайн-кнопки
        if (ctx.callbackQuery && ctx.callbackQuery.data) {
          const actionKey = ctx.callbackQuery.data;
          this.log.debug(`User triggered action`, { userId, dialog: frame.dialog, windowId: frame.window, actionKey });

          if (actionKey === coreCallbacks.back) {
            try { await this.goBack(ctx); }
            finally { await this.answerCallback(ctx); }
            return;
          }

          if (actionKey === coreCallbacks.root && this.rootDialogId !== undefined) {
            try { await this.resetDialog(ctx, this.rootDialogId); }
            finally { await this.answerCallback(ctx); }
            return;
          }

          if (actionKey.startsWith(LANG_PREFIX)) {
            const newLang = actionKey.slice(LANG_PREFIX.length);
            try { await this.setLanguage(ctx, newLang); }
            finally {
              await this.answerCallback(ctx, {
                text: this.getTranslator(ctx)('language_changed'),
              });
            }
            return;
          }

          const actionHandler = window.actions?.[actionKey];

          if (!actionHandler) {
            this.log.warn(`Action handler not found`, { userId, windowId: frame.window, actionKey });
            await this.answerCallback(ctx, { text: t('action_not_available') });
            return next();
          }

          try {
            await actionHandler(ctx, this, t);
          } catch (error) {
            this.log.error(`Error occurred while executing action handler`, {
              userId, windowId: frame.window, actionKey, error,
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
          if (ctx.message.text.startsWith('/')) return next();

          await ctx.deleteMessage().catch(() => { });

          const rawInput = ctx.message.text.trim();
          let value: unknown = rawInput;

          if (window.formatter) {
            try {
              value = window.formatter(rawInput);
            } catch (error) {
              const userMessage =
                error instanceof InputValidationError ? error.message : t('invalid_format');

              this.log.warn(`Window input formatter failed`, {
                userId, windowId: frame.window, inputLength: rawInput.length, error,
              });

              ctx.data.error = userMessage;
              await this.show(ctx);
              return;
            }
          }

          if (window.inputSchema) {
            const parseResult = window.inputSchema.safeParse(value);

            if (!parseResult.success) {
              const firstError = parseResult.error.issues[0]?.message || t('invalid_format');

              this.log.warn(`Window input validation failed`, {
                userId, windowId: frame.window, error: firstError, inputLength: rawInput.length,
              });

              ctx.data.error = firstError;
              await this.show(ctx);
              return;
            }

            value = parseResult.data;
          }

          delete ctx.data.error;

          if (window.onInput) {
            try {
              await window.onInput(ctx, this, t, value);
            } catch (error) {
              this.log.error(`Error occurred while executing onInput handler`, {
                userId, windowId: frame.window, error,
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