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
  TId extends string
>(appManager: DialogManager<TState, TId>): void {
  const manager = appManager as unknown as BManager;

  // Клавиатура у всех трёх веток одинаковая
  const branchKeyboard = () =>
    new InlineKeyboard()
      .text('🏠 В главное меню', 'global_back_to_menu')
      .row()
      .text('✅ Завершить', 'finish_flow');

  const branchActions: Record<string, WindowActionHandler<BranchingState, BranchingWindowId>> = {
    finish_flow: async (ctx, manager) => { await manager.goTo(ctx, 'completed'); },
  };

  // 1. Главное окно развилки
  manager.register({
    id: 'select_branch',
    render: async () => {
      const keyboard = new InlineKeyboard()
        .text('🚀 Вариант 1: Технический стек', 'branch_tech')
        .row()
        .text('🎨 Вариант 2: Дизайн и UI/UX', 'branch_design')
        .row()
        .text('📊 Вариант 3: Аналитика и Бизнес', 'branch_business');

      return {
        text: '📂 *Меню выбора ветки*\n\nВыберите направление, по которому хотите продолжить работу:',
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
    render: async () => ({
      text: '⚙️ *Техническая ветка*\n\nЗдесь настраивается архитектура, бэкенд на NestJS, базы данных и Docker.',
      keyboard: branchKeyboard(),
    }),
    actions: branchActions,
  });

  // 3. Ветка 2: Дизайн
  manager.register({
    id: 'window_design_step',
    render: async () => ({
      text: '🎨 *Дизайн-ветка*\n\nЗдесь прорабатываются макеты в Figma, цвета, шрифты и пользовательский опыт.',
      keyboard: branchKeyboard(),
    }),
    actions: branchActions,
  });

  // 4. Ветка 3: Бизнес
  manager.register({
    id: 'window_business_step',
    render: async () => ({
      text: '📊 *Бизнес-ветка*\n\nЗдесь анализируются метрики, юнит-экономика, гипотезы и монетизация.',
      keyboard: branchKeyboard(),
    }),
    actions: branchActions,
  });
}