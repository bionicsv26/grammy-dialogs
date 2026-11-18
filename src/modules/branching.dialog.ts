import { InlineKeyboard } from 'grammy';
import {
  DialogManager,
  defineWindows,
  type TranslationFunction,
  type WindowActionHandler,
} from '../dialog-manager.js';
import type { AppTranslationKeys } from '../translations.js';
import type { SharedWindowId } from './shared.js';

export interface BranchingState {
  chosenBranch?: 'tech' | 'design' | 'business';
}

// Единый источник правды для ID окон модуля.
// 'completed' убран — он принадлежит questionnaire.
export const branchingWindowIds = [
  'select_branch',
  'window_tech_step',
  'window_design_step',
  'window_business_step',
] as const;

export type BranchingWindowId = typeof branchingWindowIds[number];

export function createBranchingWindows<
  TState extends BranchingState
>() {
  type Id = BranchingWindowId | SharedWindowId;

  const branchKeyboard = (t: TranslationFunction<AppTranslationKeys>) =>
    new InlineKeyboard()
      .text(t('btn_to_main_menu'), 'global_back_to_menu')
      .row()
      .text(t('btn_finish'), 'finish_flow');

  const branchActions: Record<string, WindowActionHandler<TState, Id, AppTranslationKeys>> = {
    finish_flow: async (ctx, manager) => {
      await manager.goTo(ctx, 'completed');
    },
  };

  return defineWindows<TState, Id, AppTranslationKeys>([
    // 1. Развилка
    {
      id: 'select_branch',
      render: async (_ctx, t) => {
        const keyboard = new InlineKeyboard()
          .text(t('branch_tech_btn'), 'branch_tech')
          .row()
          .text(t('branch_design_btn'), 'branch_design')
          .row()
          .text(t('branch_business_btn'), 'branch_business');

        return { text: t('select_branch_text'), keyboard };
      },
      actions: {
        branch_tech: async (ctx, manager) => {
          ctx.session.data.chosenBranch = 'tech';
          await manager.goTo(ctx, 'window_tech_step');
        },
        branch_design: async (ctx, manager) => {
          ctx.session.data.chosenBranch = 'design';
          await manager.goTo(ctx, 'window_design_step');
        },
        branch_business: async (ctx, manager) => {
          ctx.session.data.chosenBranch = 'business';
          await manager.goTo(ctx, 'window_business_step');
        },
      },
    },

    // 2. Техническая ветка
    {
      id: 'window_tech_step',
      render: async (_ctx, t) => ({
        text: t('tech_step_text'),
        keyboard: branchKeyboard(t),
      }),
      actions: branchActions,
    },

    // 3. Дизайн-ветка
    {
      id: 'window_design_step',
      render: async (_ctx, t) => ({
        text: t('design_step_text'),
        keyboard: branchKeyboard(t),
      }),
      actions: branchActions,
    },

    // 4. Бизнес-ветка
    {
      id: 'window_business_step',
      render: async (_ctx, t) => ({
        text: t('business_step_text'),
        keyboard: branchKeyboard(t),
      }),
      actions: branchActions,
    },
  ]);
}