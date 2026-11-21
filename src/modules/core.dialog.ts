import { InlineKeyboard } from 'grammy';
import { defineDialog, coreCallbacks } from '../dialog-manager.js';
import { isUserAdmin } from '../utils/auth.js';
import type { AppTranslationKeys } from '../translations.js';
import { D, R } from './dialog-ids.js';

export type CoreWindowId = 'main_menu' | 'completed' | 'confirm_restart' | 'settings_lang';

export function createCoreDialog() {
  return defineDialog<Record<string, any>, CoreWindowId, AppTranslationKeys>({
    id: D.core,
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
        onDialogResult: async (ctx, m, _t, result) => {
          if (result === R.completed) await m.goTo(ctx, 'completed');
          else await m.show(ctx);
        },
        actions: {
          to_form: (ctx, m) => m.startDialog(ctx, D.questionnaire),
          proceed_to_branches: (ctx, m) => m.startDialog(ctx, D.branching),
          open_settings_lang: (ctx, m) => m.goTo(ctx, 'settings_lang'),
          open_admin: async (ctx, m, t) => {
            if (!isUserAdmin(ctx.from?.id)) {
              await ctx
                .answerCallbackQuery({ text: t('no_admin_access'), show_alert: true })
                .catch(() => { });
              return;
            }
            await m.startDialog(ctx, D.admin);
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
          restart: (ctx, m) => m.restart(ctx, D.core),
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
          do_restart: (ctx, m) => m.restart(ctx, D.core),
          cancel_restart: (ctx, m) => m.done(ctx),
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