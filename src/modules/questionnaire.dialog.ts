import { InlineKeyboard } from 'grammy';
import { defineWindows, defineWindow, type WindowActionHandler } from '../dialog-manager.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  AVAILABLE_INTERESTS,
  nameSchema,
  createInterestsSchema,
} from '../schemas/questionnaire.schema.js';
import { isUserAdmin } from '../utils/auth.js';
import { escapeHtml } from '../utils/parse-mode.js';
import type { AppTranslationKeys } from '../translations.js';
import type { CoreWindowId } from './core.dialog.js';

export interface QuestionnaireState {
  name?: string;
  interests?: string[];
  returnTo?: QuestionnaireWindowId;
  error?: string;
  broadcastText?: string;
}

export const questionnaireWindowIds = [
  'ask_name',
  'ask_interests',
  'summary',
  'admin_panel',
  'admin_stats',
  'admin_broadcast',
] as const;

export type QuestionnaireWindowId = typeof questionnaireWindowIds[number];

export function createQuestionnaireWindows<TState extends QuestionnaireState>() {
  type Id = QuestionnaireWindowId | CoreWindowId;
  const win = defineWindow<TState, Id, AppTranslationKeys>();

  const toggleActions: Record<string, WindowActionHandler<TState, Id, AppTranslationKeys>> =
    Object.fromEntries(
      AVAILABLE_INTERESTS.map(
        (item): [string, WindowActionHandler<TState, Id, AppTranslationKeys>] => [
          `toggle_${item.id}`,
          async (ctx, manager) => {
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

  return defineWindows<TState, Id, AppTranslationKeys>([
    // Ввод имени (TValue выводится из nameSchema → string)
    win({
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
          text = `❌ <b>${escapeHtml(error)}</b>\n\n` + text;
        }

        return { text, keyboard };
      },
      formatter: (text) =>
        text
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .replace(/(^|\s)\S/g, (l) => l.toUpperCase()),
      inputSchema: nameSchema,
      onInput: async (ctx, manager, _t, value) => {
        ctx.session.data.name = value; // value: string

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
    }),

    // Выбор технологий (ввода нет — inline)
    {
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

        return { text: t('ask_interests_text'), keyboard };
      },
      actions: {
        ...toggleActions,
        confirm_interests: async (ctx, manager, t) => {
          const selected = ctx.session.data.interests ?? [];
          const parseResult = createInterestsSchema(1, 4).safeParse(selected);

          if (!parseResult.success) {
            const errorMessage = parseResult.error.issues[0]?.message || t('invalid_selection');
            await ctx
              .answerCallbackQuery({ text: `⚠️ ${errorMessage}`, show_alert: true })
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
    },

    // Предпросмотр
    {
      id: 'summary',
      guard: async (ctx) => {
        if (!ctx.session.data.name) {
          return 'ask_name';
        }
        return true;
      },
      render: async (ctx, t) => {
        const name = ctx.session.data.name || t('anonymous');
        const interestIdsList = ctx.session.data.interests ?? [];

        const interestLabels = interestIdsList
          .map((id) => {
            const key = `tech_${id}` as AppTranslationKeys;
            const translated = t(key);
            const fallback = AVAILABLE_INTERESTS.find((i) => i.id === id)?.label;
            return translated !== key ? translated : (fallback || id);
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
              const name = escapeHtml(rawName);
              const interestIdsList = ctx.session.data.interests ?? [];

              const interestLabels = interestIdsList
                .map((id) => {
                  const key = `tech_${id}` as AppTranslationKeys;
                  const translated = t(key);
                  const fallback = AVAILABLE_INTERESTS.find((i) => i.id === id)?.label;
                  return translated !== key ? translated : escapeHtml(fallback || id);
                })
                .filter(Boolean)
                .join(', ');

              const userId = ctx.from?.id;
              const rawUsername = ctx.from?.username ? `@${ctx.from.username}` : t('hidden');
              const username = escapeHtml(rawUsername);

              const adminMessage =
                `🚨 <b>Новая заполненная анкета!</b>\n\n` +
                `👤 <b>Имя:</b> ${name}\n` +
                `🔗 <b>Пользователь:</b> ${username} (ID: <code>${userId}</code>)\n` +
                `💻 <b>Технологии:</b> ${interestLabels || t('none_selected')}\n` +
                `📅 <b>Дата:</b> ${new Date().toLocaleString('ru-RU')}`;

              await ctx.api.sendMessage(adminChatId, adminMessage, { parse_mode: 'HTML' });

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
    },

    // Админ-панель
    {
      id: 'admin_panel',
      guard: async (ctx, _manager, t) => {
        if (!isUserAdmin(ctx.from?.id)) {
          await ctx
            .answerCallbackQuery({ text: t('no_admin_access'), show_alert: true })
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
        return { text: t('admin_panel_text'), keyboard };
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
    },

    // Статистика
    {
      id: 'admin_stats',
      render: async (_ctx, t) => {
        const keyboard = new InlineKeyboard().text(t('btn_back'), 'back_to_admin');
        return { text: t('admin_stats_title'), keyboard };
      },
      actions: {
        back_to_admin: async (ctx, manager) => {
          await manager.goTo(ctx, 'admin_panel');
        },
      },
    },

    // Ввод рассылки (схемы нет → TValue = string по умолчанию)
    win({
      id: 'admin_broadcast',
      disableBackButton: true,
      render: async (_ctx, t) => {
        const keyboard = new InlineKeyboard().text(t('btn_cancel_broadcast'), 'cancel_broadcast');
        return { text: t('admin_broadcast_title'), keyboard };
      },
      onInput: async (ctx, manager, t, value) => {
        const textToBroadcast = value; // value: string
        if (!textToBroadcast) return;

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
    }),
  ]);
}