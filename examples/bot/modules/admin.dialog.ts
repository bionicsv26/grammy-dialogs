import { InlineKeyboard } from 'grammy';
import { defineDialog, defineWindow } from '../../../src/core/dialog-manager.js';
import { isUserAdmin } from '../utils/auth.js';
import type { AppTranslationKeys } from '../translations.js';
import { D } from './dialog-ids.js';

export interface AdminState {
  broadcastText?: string;
}

export type AdminWindowId = 'admin_panel' | 'admin_stats' | 'admin_broadcast';

export function createAdminDialog() {
  const win = defineWindow<AdminState, AdminWindowId, AppTranslationKeys>();

  return defineDialog<AdminState, AdminWindowId, AppTranslationKeys>({
    id: D.admin,
    windows: [
      {
        id: 'admin_panel',
        // Guard чистый и внутри своего диалога: просто не пускаем.
        guard: (ctx) => isUserAdmin(ctx.from?.id),
        render: (_ctx, t) => ({
          text: t('admin_panel_text'),
          keyboard: new InlineKeyboard()
            .text(t('btn_stats'), 'open_stats').row()
            .text(t('btn_broadcast'), 'open_broadcast').row()
            .text(t('btn_to_main_menu'), 'main_menu'),
        }),
        actions: {
          main_menu: (ctx, m) => m.done(ctx),
          open_stats: (ctx, m) => m.goTo(ctx, 'admin_stats'),
          open_broadcast: (ctx, m) => m.goTo(ctx, 'admin_broadcast'),
        },
      },

      {
        id: 'admin_stats',
        render: (_ctx, t) => ({
          text: t('admin_stats_title'),
          keyboard: new InlineKeyboard().text(t('btn_back'), 'back_to_admin'),
        }),
        actions: {
          back_to_admin: (ctx, m) => m.goTo(ctx, 'admin_panel'),
        },
      },

      win({
        id: 'admin_broadcast',
        disableBackButton: true,
        render: (_ctx, t) => ({
          text: t('admin_broadcast_title'),
          keyboard: new InlineKeyboard().text(t('btn_cancel_broadcast'), 'cancel_broadcast'),
        }),
        onInput: async (ctx, manager, t, value) => {
          if (!value) return;

          const simulatedCount = 1;
          await ctx.reply(t('broadcast_success', { count: String(simulatedCount) }));
          delete ctx.data.broadcastText;
          await manager.goTo(ctx, 'admin_panel');
        },
        actions: {
          cancel_broadcast: async (ctx, m) => {
            delete ctx.data.broadcastText;
            await m.goTo(ctx, 'admin_panel');
          },
        },
      }),
    ],
  });
}