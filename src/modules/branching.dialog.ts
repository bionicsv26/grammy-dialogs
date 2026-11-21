import { InlineKeyboard } from 'grammy';
import {
  defineDialog,
  coreCallbacks,
  type TranslationFunction,
  type WindowActionHandler,
} from '../dialog-manager.js';
import type { AppTranslationKeys } from '../translations.js';

export interface BranchingState {
  chosenBranch?: 'tech' | 'design' | 'business';
}

export const branchingWindowIds = [
  'select_branch', 'window_tech_step', 'window_design_step', 'window_business_step',
] as const;
export type BranchingWindowId = typeof branchingWindowIds[number];

export function createBranchingDialog() {
  type Id = BranchingWindowId;

  const branchKeyboard = (t: TranslationFunction<AppTranslationKeys>) =>
    new InlineKeyboard()
      .text(t('btn_to_main_menu'), coreCallbacks.root)
      .row()
      .text(t('btn_finish'), 'finish_flow');

  const branchActions: Record<string, WindowActionHandler<BranchingState, Id, AppTranslationKeys>> = {
    finish_flow: (ctx, m) => m.done(ctx, 'completed'),
  };

  return defineDialog<BranchingState, Id, AppTranslationKeys>({
    id: 'branching',
    entry: 'select_branch',
    windows: [
      {
        id: 'select_branch',
        render: (_ctx, t) => ({
          text: t('select_branch_text'),
          keyboard: new InlineKeyboard()
            .text(t('branch_tech_btn'), 'branch_tech')
            .row()
            .text(t('branch_design_btn'), 'branch_design')
            .row()
            .text(t('branch_business_btn'), 'branch_business'),
        }),
        actions: {
          branch_tech: async (ctx, m) => {
            ctx.data.chosenBranch = 'tech';
            await m.goTo(ctx, 'window_tech_step');
          },
          branch_design: async (ctx, m) => {
            ctx.data.chosenBranch = 'design';
            await m.goTo(ctx, 'window_design_step');
          },
          branch_business: async (ctx, m) => {
            ctx.data.chosenBranch = 'business';
            await m.goTo(ctx, 'window_business_step');
          },
        },
      },
      {
        id: 'window_tech_step',
        render: (_ctx, t) => ({ text: t('tech_step_text'), keyboard: branchKeyboard(t) }),
        actions: branchActions,
      },
      {
        id: 'window_design_step',
        render: (_ctx, t) => ({ text: t('design_step_text'), keyboard: branchKeyboard(t) }),
        actions: branchActions,
      },
      {
        id: 'window_business_step',
        render: (_ctx, t) => ({ text: t('business_step_text'), keyboard: branchKeyboard(t) }),
        actions: branchActions,
      },
    ],
  });
}