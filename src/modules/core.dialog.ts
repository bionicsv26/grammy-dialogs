import { InlineKeyboard } from 'grammy';
import { defineWindows, coreCallbacks } from '../dialog-manager.js';
import { isUserAdmin } from '../utils/auth.js';
import type { AppTranslationKeys } from '../translations.js';
import type { QuestionnaireWindowId } from './questionnaire.dialog.js';
import type { BranchingWindowId } from './branching.dialog.js';

export interface CoreState {
  previousWindow?: string;
}

export const coreWindowIds = [
  'main_menu',
  'completed',
  'confirm_restart',
  'settings_lang',
] as const;

export type CoreWindowId = typeof coreWindowIds[number];

export function createCoreWindows<TState extends CoreState>() {
  // main_menu — точка композиции: знает ID фич-модулей.
  type Id = CoreWindowId | QuestionnaireWindowId | BranchingWindowId;

  return defineWindows<TState, Id, AppTranslationKeys>([
    // Главное меню
    {
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

        return { text: t('main_menu_text'), keyboard };
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
    },

    // Финальное окно
    {
      id: 'completed',
      disableBackButton: true,
      render: async (_ctx, t) => {
        const keyboard = new InlineKeyboard().text(t('btn_fill_again'), 'restart');
        return { text: t('completed_text'), keyboard };
      },
      actions: {
        restart: async (ctx, manager) => {
          await manager.start(ctx, 'main_menu');
        },
      },
    },

    // Подтверждение сброса при /start
    {
      id: 'confirm_restart',
      disableBackButton: true,
      render: async (_ctx, t) => {
        const keyboard = new InlineKeyboard()
          .text(t('btn_confirm_restart'), 'do_restart')
          .row()
          .text(t('btn_continue_filling'), 'cancel_restart')
          .row()
          .text(t('btn_to_main_menu'), coreCallbacks.root);

        return { text: t('confirm_restart_text'), keyboard };
      },
      actions: {
        do_restart: async (ctx, manager) => {
          await manager.start(ctx, 'main_menu');
        },
        cancel_restart: async (ctx, manager) => {
          // Фоллбек на корень, а не на 'summary' (core не знает фич).
          const prevWindow = (ctx.session.data.previousWindow ?? 'main_menu') as Id;
          delete ctx.session.data.previousWindow;
          await manager.goTo(ctx, prevWindow);
        },
      },
    },

    // Настройки языка
    {
      id: 'settings_lang',
      render: async (ctx, t) => {
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
  ]);
}