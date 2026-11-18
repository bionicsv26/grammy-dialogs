import { InlineKeyboard } from 'grammy';
import {
  DialogManager,
  type DialogContext,
  type WindowActionHandler,
} from '../dialog-manager.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  AVAILABLE_INTERESTS,
  nameSchema,
  createInterestsSchema,
} from '../schemas/questionnaire.schema.js';
import { isUserAdmin } from '../utils/auth.js';
import { escapeMarkdown } from '../utils/markdown.js';
import type { AppTranslationKeys } from '../translations.js';

// 1. Состояние и ID окон этого модуля
export interface QuestionnaireState {
  name?: string;
  interests?: string[];
  returnTo?: QuestionnaireWindowId;
  previousWindow?: string;
  error?: string;
  validatedInput?: any;
  broadcastText?: string;
}

export type QuestionnaireWindowId =
  | 'main_menu'
  | 'ask_name'
  | 'ask_interests'
  | 'summary'
  | 'completed'
  | 'confirm_restart'
  | 'select_branch'
  | 'admin_panel'
  | 'admin_stats'
  | 'admin_broadcast'
  | 'settings_lang';

type QManager = DialogManager<QuestionnaireState, QuestionnaireWindowId>;
type QCtx = DialogContext<QuestionnaireState, QuestionnaireWindowId>;

export function registerQuestionnaireModule<
  TState extends QuestionnaireState,
  TId extends string,
  TKeys extends string = string
>(appManager: DialogManager<TState, TId, TKeys>): void {
  const manager = appManager as unknown as QManager;

  // 1. Окно приветствия (Главное меню)
  manager.register({
    id: 'main_menu',
    disableBackButton: true,
    render: async (ctx, t) => {
      const keyboard = new InlineKeyboard()
        .text(t('btn_start_form'), 'to_form')
        .row()
        .text(t('btn_select_branch'), 'proceed_to_branches')
        .row()
        .text(t('btn_settings_lang'), 'open_settings_lang');

      if (isUserAdmin(ctx.from?.id)) {
        keyboard.row().text(t('btn_admin_panel'), 'open_admin');
      }

      return {
        text: t('main_menu_text'),
        keyboard,
      };
    },
    actions: {
      to_form: async (ctx, manager) => {
        await manager.goTo(ctx, 'ask_name');
      },
      proceed_to_branches: async (ctx, manager) => {
        await manager.goTo(ctx, 'select_branch');
      },
      open_admin: async (ctx, manager) => {
        await manager.goTo(ctx, 'admin_panel');
      },
      open_settings_lang: async (ctx, manager) => {
        await manager.goTo(ctx, 'settings_lang');
      },
    },
  });

  // 2. Окно ввода имени
  manager.register({
    id: 'ask_name',
    disableBackButton: true,
    render: async (ctx, t) => {
      const error = ctx.session.data.error;
      delete ctx.session.data.error;

      const isEditing = ctx.session.data.returnTo === 'summary';
      const backAction = isEditing ? 'cancel_edit_name' : 'main_menu';
      const backLabel = isEditing ? t('btn_cancel') : t('btn_back');

      const keyboard = new InlineKeyboard().text(backLabel, backAction);

      let text = t('ask_name_text');
      if (error) {
        text = `❌ *${escapeMarkdown(error)}*\n\n` + text;
      }

      return { text, keyboard };
    },
    formatter: (text) => text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/(^|\s)\S/g, l => l.toUpperCase()),
    inputSchema: nameSchema,
    onInput: async (ctx, manager) => {
      ctx.session.data.name = ctx.session.data.validatedInput;
      delete ctx.session.data.validatedInput;

      const returnTo = ctx.session.data.returnTo;
      delete ctx.session.data.returnTo;

      await manager.goTo(ctx, returnTo ?? 'ask_interests');
    },
    actions: {
      main_menu: async (ctx, manager) => {
        delete ctx.session.data.error;
        await manager.goTo(ctx, 'main_menu');
      },
      cancel_edit_name: async (ctx, manager) => {
        delete ctx.session.data.returnTo;
        delete ctx.session.data.error;
        await manager.goTo(ctx, 'summary');
      },
    },
  });

  // 3. Окно с выбором технологий (переключатели)
  const toggleActions: Record<
    string,
    WindowActionHandler<QuestionnaireState, QuestionnaireWindowId>
  > = Object.fromEntries(
    AVAILABLE_INTERESTS.map(
      (item): [string, WindowActionHandler<QuestionnaireState, QuestionnaireWindowId>] => [
        `toggle_${item.id}`,
        async (ctx: QCtx, manager: QManager) => {
          if (!Array.isArray(ctx.session.data.interests)) {
            ctx.session.data.interests = [];
          }
          const selected: string[] = ctx.session.data.interests;
          const index = selected.indexOf(item.id);

          if (index > -1) {
            selected.splice(index, 1);
          } else {
            selected.push(item.id);
          }

          await manager.show(ctx);
        },
      ]
    )
  );

  manager.register({
    id: 'ask_interests',
    disableBackButton: true,
    render: async (ctx, t) => {
      if (!Array.isArray(ctx.session.data.interests)) {
        ctx.session.data.interests = [];
      }
      const selected: string[] = ctx.session.data.interests;
      const isEditing = ctx.session.data.returnTo === 'summary';

      const keyboard = new InlineKeyboard();

      AVAILABLE_INTERESTS.forEach((item) => {
        const isSelected = selected.includes(item.id);
        const icon = isSelected ? '✅' : '⬜️';
        const key = `tech_${item.id}` as AppTranslationKeys;
        const translated = t(key);
        const label = translated !== key ? translated : item.label;
        keyboard.text(`${icon} ${label}`, `toggle_${item.id}`).row();
      });

      const confirmLabel = isEditing ? t('btn_save_changes') : t('btn_confirm');
      const backAction = isEditing ? 'cancel_edit_interests' : 'ask_name';
      const backLabel = isEditing ? t('btn_back_to_preview') : t('btn_back');

      keyboard.text(confirmLabel, 'confirm_interests').row();
      keyboard.text(backLabel, backAction);

      return {
        text: t('ask_interests_text'),
        keyboard,
      };
    },
    actions: {
      ...toggleActions,
      confirm_interests: async (ctx, manager, t) => {
        const selected = ctx.session.data.interests ?? [];
        const parseResult = createInterestsSchema(1, 4).safeParse(selected);

        if (!parseResult.success) {
          const errorMessage = parseResult.error.issues[0]?.message || t('invalid_selection');
          await ctx
            .answerCallbackQuery({
              text: `⚠️ ${errorMessage}`,
              show_alert: true,
            })
            .catch(() => { });
          return;
        }

        const returnTo = ctx.session.data.returnTo;
        delete ctx.session.data.returnTo;

        await manager.goTo(ctx, returnTo ?? 'summary');
      },
      ask_name: async (ctx, manager) => {
        await manager.goTo(ctx, 'ask_name');
      },
      cancel_edit_interests: async (ctx, manager) => {
        delete ctx.session.data.returnTo;
        await manager.goTo(ctx, 'summary');
      },
    },
  });

  // 4. Окно предпросмотра (Summary)
  manager.register({
    id: 'summary',
    guard: async (ctx) => {
      if (!ctx.session.data.name) {
        return 'ask_name';
      }
      return true;
    },
    render: async (ctx, t) => {
      const rawName = ctx.session.data.name || t('anonymous');
      const name = escapeMarkdown(rawName);
      const interestIdsList = ctx.session.data.interests ?? [];

      const interestLabels = interestIdsList
        .map((id) => {
          const key = `tech_${id}` as AppTranslationKeys;
          const translated = t(key);
          const fallback = AVAILABLE_INTERESTS.find((i) => i.id === id)?.label;
          return translated !== key ? translated : escapeMarkdown(fallback || id);
        })
        .filter(Boolean)
        .join(', ');

      const keyboard = new InlineKeyboard()
        .text(t('btn_edit_name'), 'edit_name').row()
        .text(t('btn_edit_interests'), 'edit_interests').row()
        .text(t('btn_confirm_all'), 'confirm_all').row()
        .text(t('btn_restart'), 'restart');

      const text = t('summary_text', {
        name,
        interests: interestLabels || t('none_selected'),
      });

      return { text, keyboard };
    },
    actions: {
      edit_name: async (ctx, manager) => {
        ctx.session.data.returnTo = 'summary';
        await manager.goTo(ctx, 'ask_name');
      },
      edit_interests: async (ctx, manager) => {
        ctx.session.data.returnTo = 'summary';
        await manager.goTo(ctx, 'ask_interests');
      },
      confirm_all: async (ctx, manager, t) => {
        const adminChatId = config.ADMIN_CHAT_ID;

        if (adminChatId) {
          try {
            const rawName = ctx.session.data.name || t('anonymous');
            const name = escapeMarkdown(rawName);
            const interestIdsList = ctx.session.data.interests ?? [];

            const interestLabels = interestIdsList
              .map((id) => {
                const key = `tech_${id}` as AppTranslationKeys;
                const translated = t(key);
                const fallback = AVAILABLE_INTERESTS.find((i) => i.id === id)?.label;
                return translated !== key ? translated : escapeMarkdown(fallback || id);
              })
              .filter(Boolean)
              .join(', ');

            const userId = ctx.from?.id;
            const rawUsername = ctx.from?.username ? `@${ctx.from.username}` : t('hidden');
            const username = escapeMarkdown(rawUsername);

            const adminMessage =
              `🚨 *Новая заполненная анкета!*\n\n` +
              `👤 *Имя:* ${name}\n` +
              `🔗 *Пользователь:* ${username} (ID: \`${userId}\`)\n` +
              `💻 *Технологии:* ${interestLabels || t('none_selected')}\n` +
              `📅 *Дата:* ${new Date().toLocaleString('ru-RU')}`;

            await ctx.api.sendMessage(adminChatId, adminMessage, {
              parse_mode: 'Markdown',
            });

            logger.info(`📤 Анкета успешно отправлена администратору в чат ${adminChatId}`, { userId });
          } catch (error) {
            logger.error(`❌ Ошибка при отправке анкеты администратору`, { error });
          }
        } else {
          logger.warn(`⚠️ ADMIN_CHAT_ID не настроен в конфигурации. Уведомление не отправлено.`);
        }

        await manager.goTo(ctx, 'completed');
      },
      restart: async (ctx, manager) => {
        await manager.start(ctx, 'main_menu');
      },
    },
  });

  // 5. Финальное окно
  manager.register({
    id: 'completed',
    disableBackButton: true,
    render: async (_ctx, t) => {
      const keyboard = new InlineKeyboard().text(t('btn_fill_again'), 'restart');
      return {
        text: t('completed_text'),
        keyboard,
      };
    },
    actions: {
      restart: async (ctx, manager) => {
        await manager.start(ctx, 'main_menu');
      },
    },
  });

  // 6. Окно подтверждения сброса при отправке /start
  manager.register({
    id: 'confirm_restart',
    disableBackButton: true,
    render: async (_ctx, t) => {
      const keyboard = new InlineKeyboard()
        .text(t('btn_confirm_restart'), 'do_restart')
        .row()
        .text(t('btn_continue_filling'), 'cancel_restart')
        .row()
        .text(t('btn_to_main_menu'), 'global_back_to_menu');

      return {
        text: t('confirm_restart_text'),
        keyboard,
      };
    },
    actions: {
      do_restart: async (ctx, manager) => {
        await manager.start(ctx, 'main_menu');
      },
      cancel_restart: async (ctx, manager) => {
        const prevWindow = (ctx.session.data.previousWindow ?? 'summary') as QuestionnaireWindowId;
        delete ctx.session.data.previousWindow;
        await manager.goTo(ctx, prevWindow);
      },
    },
  });

  // 7. Окно админ-панели
  manager.register({
    id: 'admin_panel',
    guard: async (ctx, _manager, t) => {
      if (!isUserAdmin(ctx.from?.id)) {
        await ctx
          .answerCallbackQuery({
            text: t('no_admin_access'),
            show_alert: true,
          })
          .catch(() => { });
        return 'main_menu';
      }
      return true;
    },
    render: async (_ctx, t) => {
      const keyboard = new InlineKeyboard()
        .text(t('btn_stats'), 'open_stats').row()
        .text(t('btn_broadcast'), 'open_broadcast').row()
        .text(t('btn_to_main_menu'), 'main_menu');
      return {
        text: t('admin_panel_text'),
        keyboard,
      };
    },
    actions: {
      main_menu: async (ctx, manager) => {
        await manager.goTo(ctx, 'main_menu');
      },
      open_stats: async (ctx, manager) => {
        await manager.goTo(ctx, 'admin_stats');
      },
      open_broadcast: async (ctx, manager) => {
        await manager.goTo(ctx, 'admin_broadcast');
      },
    },
  });

  // Окно статистики
  manager.register({
    id: 'admin_stats',
    render: async (_ctx, t) => {
      const keyboard = new InlineKeyboard().text(t('btn_back'), 'back_to_admin');
      return {
        text: t('admin_stats_title'),
        keyboard,
      };
    },
    actions: {
      back_to_admin: async (ctx, manager) => {
        await manager.goTo(ctx, 'admin_panel');
      },
    },
  });

  // Окно ввода рассылки
  manager.register({
    id: 'admin_broadcast',
    disableBackButton: true,
    render: async (_ctx, t) => {
      const keyboard = new InlineKeyboard().text(t('btn_cancel_broadcast'), 'cancel_broadcast');
      return {
        text: t('admin_broadcast_title'),
        keyboard,
      };
    },
    // Перехватываем обычный текстовый ввод от администратора
    onInput: async (ctx, manager, t) => {
      const textToBroadcast = ctx.msg?.text;
      if (!textToBroadcast) return;

      // Здесь в будущем можно пройтись по списку всех ID пользователей из БД/Redis
      // И выполнить ctx.api.sendMessage(userId, textToBroadcast)
      const simulatedCount = 1;

      await ctx.reply(t('broadcast_success', { count: String(simulatedCount) }));
      delete ctx.session.data.broadcastText;
      await manager.goTo(ctx, 'admin_panel');
    },
    actions: {
      cancel_broadcast: async (ctx, manager) => {
        delete ctx.session.data.broadcastText;
        await manager.goTo(ctx, 'admin_panel');
      },
    },
  });

  // Окно настроек языка
  manager.register({
    id: 'settings_lang',
    render: async (ctx, t) => {
      const currentLang = ctx.session.lang || 'ru';

      const keyboard = new InlineKeyboard()
        .text(currentLang === 'ru' ? '🇷🇺 Русский (актив.)' : '🇷🇺 Русский', 'lang_ru')
        .text(currentLang === 'en' ? '🇬🇧 English (act.)' : '🇬🇧 English', 'lang_en')
        .row()
        .text(t('btn_to_main_menu'), 'global_back_to_menu');

      return {
        text: t('settings_lang_title'),
        keyboard
      };
    },
  });
}