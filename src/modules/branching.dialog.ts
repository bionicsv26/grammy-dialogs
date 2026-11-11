import { InlineKeyboard } from 'grammy';
import { DialogManager, type WindowActionHandler } from '../dialog-manager.js';

// 1. Состояние, которое добавляет этот модуль
export interface BranchingState {
  chosenBranch?: 'tech' | 'design' | 'business';
}

// 2. ID окон, которые регистрирует этот модуль
export type BranchingWindowId =
  | 'select_branch'
  | 'window_tech_step'
  | 'window_design_step'
  | 'window_business_step'
  | 'completed';

type BManager = DialogManager<BranchingState, BranchingWindowId>;

export function registerBranchingModule<
  TState extends BranchingState,
  TId extends string,
  TKeys extends string = string
>(appManager: DialogManager<TState, TId, TKeys>): void {
  const manager = appManager as unknown as BManager;

  // Универсальная клавиатура для веток с учетом i18n
  const branchKeyboard = (t: (key: string) => string) =>
    new InlineKeyboard()
      .text(t('btn_to_main_menu'), 'global_back_to_menu')
      .row()
      .text(t('btn_finish'), 'finish_flow');

  const branchActions: Record<string, WindowActionHandler<BranchingState, BranchingWindowId>> = {
    finish_flow: async (ctx, manager) => { await manager.goTo(ctx, 'completed'); },
  };

  // 1. Главное окно развилки
  manager.register({
    id: 'select_branch',
    render: async (_ctx, t) => {
      const keyboard = new InlineKeyboard()
        .text(t('branch_tech_btn'), 'branch_tech')
        .row()
        .text(t('branch_design_btn'), 'branch_design')
        .row()
        .text(t('branch_business_btn'), 'branch_business');

      return {
        text: t('select_branch_text'),
        keyboard,
      };
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
  });

  // 2. Ветка 1: Техническая
  manager.register({
    id: 'window_tech_step',
    render: async (_ctx, t) => ({
      text: t('tech_step_text'),
      keyboard: branchKeyboard(t),
    }),
    actions: branchActions,
  });

  // 3. Ветка 2: Дизайн
  manager.register({
    id: 'window_design_step',
    render: async (_ctx, t) => ({
      text: t('design_step_text'),
      keyboard: branchKeyboard(t),
    }),
    actions: branchActions,
  });

  // 4. Ветка 3: Бизнес
  manager.register({
    id: 'window_business_step',
    render: async (_ctx, t) => ({
      text: t('business_step_text'),
      keyboard: branchKeyboard(t),
    }),
    actions: branchActions,
  });
}