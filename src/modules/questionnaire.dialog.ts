import { InlineKeyboard } from 'grammy';
import { defineDialog, defineWindow, type WindowActionHandler } from '../dialog-manager.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  AVAILABLE_INTERESTS,
  nameSchema,
  createInterestsSchema,
} from '../schemas/questionnaire.schema.js';
import { escapeHtml } from '../utils/parse-mode.js';
import type { AppTranslationKeys } from '../translations.js';

export interface QuestionnaireState {
  name?: string;
  interests?: string[];
  returnTo?: QuestionnaireWindowId;
  error?: string;
}

export const questionnaireWindowIds = ['ask_name', 'ask_interests', 'summary'] as const;
export type QuestionnaireWindowId = typeof questionnaireWindowIds[number];

export function createQuestionnaireDialog() {
  type Id = QuestionnaireWindowId;
  const win = defineWindow<QuestionnaireState, Id, AppTranslationKeys>();

  const toggleActions: Record<string, WindowActionHandler<QuestionnaireState, Id, AppTranslationKeys>> =
    Object.fromEntries(
      AVAILABLE_INTERESTS.map(
        (item): [string, WindowActionHandler<QuestionnaireState, Id, AppTranslationKeys>] => [
          `toggle_${item.id}`,
          async (ctx, manager) => {
            if (!Array.isArray(ctx.data.interests)) ctx.data.interests = [];
            const selected: string[] = ctx.data.interests;
            const index = selected.indexOf(item.id);

            if (index > -1) selected.splice(index, 1);
            else selected.push(item.id);

            await manager.show(ctx);
          },
        ]
      )
    );

  return defineDialog<QuestionnaireState, Id, AppTranslationKeys>({
    id: 'questionnaire',
    entry: 'ask_name',
    windows: [
      win({
        id: 'ask_name',
        disableBackButton: true,
        render: (ctx, t) => {
          const error = ctx.data.error;

          const isEditing = ctx.data.returnTo === 'summary';
          const backAction = isEditing ? 'cancel_edit_name' : 'main_menu';
          const backLabel = isEditing ? t('btn_cancel') : t('btn_back');

          const keyboard = new InlineKeyboard().text(backLabel, backAction);

          let text = t('ask_name_text');
          if (error) text = `❌ <b>${escapeHtml(error)}</b>\n\n` + text;

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
          ctx.data.name = value;

          const returnTo = ctx.data.returnTo;
          delete ctx.data.returnTo;

          await manager.goTo(ctx, returnTo ?? 'ask_interests');
        },
        actions: {
          main_menu: (ctx, m) => m.done(ctx),
          cancel_edit_name: async (ctx, m) => {
            delete ctx.data.returnTo;
            await m.goTo(ctx, 'summary');
          },
        },
      }),

      {
        id: 'ask_interests',
        disableBackButton: true,
        render: (ctx, t) => {
          if (!Array.isArray(ctx.data.interests)) ctx.data.interests = [];
          const selected: string[] = ctx.data.interests;
          const isEditing = ctx.data.returnTo === 'summary';

          const keyboard = new InlineKeyboard();

          AVAILABLE_INTERESTS.forEach((item) => {
            const icon = selected.includes(item.id) ? '✅' : '⬜️';
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
            const selected = ctx.data.interests ?? [];
            const parseResult = createInterestsSchema(1, 4).safeParse(selected);

            if (!parseResult.success) {
              const errorMessage = parseResult.error.issues[0]?.message || t('invalid_selection');
              await ctx
                .answerCallbackQuery({ text: `⚠️ ${errorMessage}`, show_alert: true })
                .catch(() => { });
              return;
            }

            const returnTo = ctx.data.returnTo;
            delete ctx.data.returnTo;

            await manager.goTo(ctx, returnTo ?? 'summary');
          },
          ask_name: (ctx, m) => m.goTo(ctx, 'ask_name'),
          cancel_edit_interests: async (ctx, m) => {
            delete ctx.data.returnTo;
            await m.goTo(ctx, 'summary');
          },
        },
      },

      {
        id: 'summary',
        guard: (ctx) => (ctx.data.name ? true : 'ask_name'),
        render: (ctx, t) => {
          const name = ctx.data.name || t('anonymous');
          const interestIdsList = ctx.data.interests ?? [];

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
          edit_name: async (ctx, m) => {
            ctx.data.returnTo = 'summary';
            await m.goTo(ctx, 'ask_name');
          },
          edit_interests: async (ctx, m) => {
            ctx.data.returnTo = 'summary';
            await m.goTo(ctx, 'ask_interests');
          },
          confirm_all: async (ctx, manager, t) => {
            const adminChatId = config.ADMIN_CHAT_ID;

            if (adminChatId) {
              try {
                const name = escapeHtml(ctx.data.name || t('anonymous'));
                const interestLabels = (ctx.data.interests ?? [])
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
                  `📅 <b>Дата:</b> ${new Date().toLocaleString('ru-RU', { timeZone: config.TIME_ZONE })}`;

                await ctx.api.sendMessage(adminChatId, adminMessage, { parse_mode: 'HTML' });
                logger.info(`📤 Анкета отправлена администратору в чат ${adminChatId}`, { userId });
              } catch (error) {
                logger.error(`❌ Ошибка при отправке анкеты администратору`, { error });
              }
            } else {
              logger.warn(`⚠️ ADMIN_CHAT_ID не настроен. Уведомление не отправлено.`);
            }

            await manager.done(ctx, 'completed');
          },
          restart: (ctx, m) => m.restart(ctx, 'core'),
        },
      },
    ],
  });
}