import { InlineKeyboard } from 'grammy';
import { defineDialog, coreCallbacks, type DialogFrame } from '../dialog-manager.js';
import { isUserAdmin } from '../utils/auth.js';
import type { AppTranslationKeys } from '../translations.js';

export interface CoreState {
  /** Saved-фрейм для возврата из confirm_restart. Уйдёт в подшаге 3.1b (вложенность). */
  savedFrame?: DialogFrame;
}

export const coreWindowIds = [
  'main_menu', 'completed', 'confirm_restart', 'settings_lang',
] as const;
export type CoreWindowId = typeof coreWindowIds[number];

export function createCoreDialog() {
  return defineDialog<CoreState, CoreWindowId, AppTranslationKeys>({
    id: 'core',
    entry: 'main_menu',
    windows: [
      {
        id: 'main_menu',
        disableBackButton: true,
        render: (ctx, t) => {
          const keyboard = new InlineKeyboard()
            .text(t('btn_start_form'), 'to_form')
            .row()
            .text(t('btn_select_branch'), 'proceed_to_branches')
            .row()
            .text(t('btn_settings_lang'), 'open_settings_lang');

          if (isUserAdmin(ctx.from?.id)) {
            keyboard.row().text(t('btn_admin_panel'), 'open_admin');
          }

          return { text: t('main_menu_text'), keyboard };
        },
        actions: {
          to_form: (ctx, m) => m.startDialog(ctx, 'questionnaire'),
          proceed_to_branches: (ctx, m) => m.startDialog(ctx, 'branching'),
          open_settings_lang: (ctx, m) => m.goTo(ctx, 'settings_lang'),
          open_admin: async (ctx, m, t) => {
            if (!isUserAdmin(ctx.from?.id)) {
              await ctx
                .answerCallbackQuery({ text: t('no_admin_access'), show_alert: true })
                .catch(() => { });
              return;
            }
            await m.startDialog(ctx, 'admin');
          },
        },
      },

      {
        id: 'completed',
        disableBackButton: true,
        render: (_ctx, t) => ({
          text: t('completed_text'),
          keyboard: new InlineKeyboard().text(t('btn_fill_again'), 'restart'),
        }),
        actions: {
          restart: (ctx, m) => m.restart(ctx, 'core'),
        },
      },

      {
        id: 'confirm_restart',
        disableBackButton: true,
        render: (_ctx, t) => ({
          text: t('confirm_restart_text'),
          keyboard: new InlineKeyboard()
            .text(t('btn_confirm_restart'), 'do_restart')
            .row()
            .text(t('btn_continue_filling'), 'cancel_restart')
            .row()
            .text(t('btn_to_main_menu'), coreCallbacks.root),
        }),
        actions: {
          do_restart: (ctx, m) => m.restart(ctx, 'core'),
          cancel_restart: async (ctx, m) => {
            const saved = ctx.data.savedFrame;
            if (saved) {
              // Возвращаем сохранённый фрейм целиком (окно + история + состояние).
              ctx.session.stack = [saved];
              await m.show(ctx);
            } else {
              await m.startDialog(ctx, 'core');
            }
          },
        },
      },

      {
        id: 'settings_lang',
        render: (ctx, t) => {
          const currentLang = ctx.session.lang || 'ru';
          const keyboard = new InlineKeyboard()
            .text(
              currentLang === 'ru' ? '🇷🇺 Русский (актив.)' : '🇷🇺 Русский',
              coreCallbacks.lang('ru')
            )
            .text(
              currentLang === 'en' ? '🇬🇧 English (act.)' : '🇬🇧 English',
              coreCallbacks.lang('en')
            )
            .row()
            .text(t('btn_to_main_menu'), coreCallbacks.root);

          return { text: t('settings_lang_title'), keyboard };
        },
      },
    ],
  });
}