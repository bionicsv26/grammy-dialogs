import { InlineKeyboard } from 'grammy';
import { DialogManager } from '../dialog-manager.js';

export function registerBranchingModule(manager: DialogManager): void {

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
        text: '📂 **Меню выбора ветки**\n\nВыберите направление, по которому хотите продолжить работу:',
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

  // 2. Ветка 1: Техническая цепочка
  manager.register({
    id: 'window_tech_step',
    render: async () => {
      const keyboard = new InlineKeyboard()
        .text('⬅️ Назад к выбору', 'back_to_menu')
        .row()
        .text('🏠 В главное меню', 'global_back_to_menu')
        .row()
        .text('✅ Завершить', 'finish_flow');

      return {
        text: '⚙️ **Техническая ветка**\n\nЗдесь настраивается архитектура, бэкенд на NestJS, базы данных и Docker.',
        keyboard,
      };
    },
    actions: {
      back_to_menu: async (ctx, manager) => {
        await manager.goTo(ctx, 'select_branch');
      },
      finish_flow: async (ctx, manager) => {
        await manager.goTo(ctx, 'completed');
      },
    },
  });

  // 3. Ветка 2: Дизайн цепочка
  manager.register({
    id: 'window_design_step',
    render: async () => {
      const keyboard = new InlineKeyboard()
        .text('⬅️ Назад к выбору', 'back_to_menu')
        .row()
        .text('🏠 В главное меню', 'global_back_to_menu')
        .row()
        .text('✅ Завершить', 'finish_flow');

      return {
        text: '🎨 **Дизайн-ветка**\n\nЗдесь прорабатываются макеты в Figma, цвета, шрифты и пользовательский опыт.',
        keyboard,
      };
    },
    actions: {
      back_to_menu: async (ctx, manager) => {
        await manager.goTo(ctx, 'select_branch');
      },
      finish_flow: async (ctx, manager) => {
        await manager.goTo(ctx, 'completed');
      },
    },
  });

  // 4. Ветка 3: Бизнес цепочка
  manager.register({
    id: 'window_business_step',
    render: async () => {
      const keyboard = new InlineKeyboard()
        .text('⬅️ Назад к выбору', 'back_to_menu')
        .row()
        .text('🏠 В главное меню', 'global_back_to_menu')
        .row()
        .text('✅ Завершить', 'finish_flow');

      return {
        text: '📊 **Бизнес-ветка**\n\nЗдесь анализируются метрики, юнит-экономика, гипотезы и монетизация.',
        keyboard,
      };
    },
    actions: {
      back_to_menu: async (ctx, manager) => {
        await manager.goTo(ctx, 'select_branch');
      },
      finish_flow: async (ctx, manager) => {
        await manager.goTo(ctx, 'completed');
      },
    },
  });
}