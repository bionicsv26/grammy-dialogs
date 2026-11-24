import { InlineKeyboard } from 'grammy';
import {
  defineDialog,
  defineWindow,
  type DialogContext,
  type WindowActionHandler,
} from '../../../src/core/dialog-manager.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  AVAILABLE_INTERESTS,
  nameSchema,
  createInterestsSchema,
} from '../schemas/questionnaire.schema.js';
import { escapeHtml } from '../../../src/core/parse-mode.js';
import type { AppTranslationKeys } from '../translations.js';
import { D, R } from './dialog-ids.js';

export interface QuestionnaireState {
  name?: string;
  interests?: string[];
  error?: string;
}

export type QuestionnaireWindowId = 'ask_name' | 'ask_interests' | 'summary';

/** Адрес возврата берём из стека истории, а не из состояния. */
const cameFromSummary = (ctx: DialogContext<QuestionnaireState>): boolean => {
  const h = ctx.frame.history;
  return h[h.length - 1] === 'summary';
};

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
    id: D.questionnaire,
    windows: [
      win({
        id: 'ask_name',
        disableBackButton: true,
        render: (ctx, t) => {
          const error = ctx.data.error;
          const isEditing = cameFromSummary(ctx);

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
        onInput: async (ctx, m, _t, value) => {
          ctx.data.name = value;
          if (cameFromSummary(ctx)) await m.goBack(ctx);
          else await m.goTo(ctx, 'ask_interests');
        },
        actions: {
          main_menu: (ctx, m) => m.done(ctx),
          cancel_edit_name: (ctx, m) => m.goBack(ctx),
        },
      }),

      {
        id: 'ask_interests',
        disableBackButton: true,
        render: (ctx, t) => {
          if (!Array.isArray(ctx.data.interests)) ctx.data.interests = [];
          const selected: string[] = ctx.data.interests;
          const isEditing = cameFromSummary(ctx);

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

            if (cameFromSummary(ctx)) await manager.goBack(ctx);
            else await manager.goTo(ctx, 'summary');
          },
          ask_name: (ctx, m) => m.goTo(ctx, 'ask_name'),
          cancel_edit_interests: (ctx, m) => m.goBack(ctx),
        },
      },

      {
        id: 'summary',
        guard: (ctx) => (ctx.data.name ? true : 'ask_name'),
        render: (ctx, t) => {
          const name = ctx.data.name || t('anonymous');

          const interestLabels = (ctx.data.interests ?? [])
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
          edit_name: (ctx, m) => m.goTo(ctx, 'ask_name'),
          edit_interests: (ctx, m) => m.goTo(ctx, 'ask_interests'),
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

            await manager.done(ctx, R.completed);
          },
          restart: (ctx, m) => m.restart(ctx, D.core),
        },
      },
    ],
  });
}