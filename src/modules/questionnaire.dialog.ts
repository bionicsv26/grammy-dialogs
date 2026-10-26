import { InlineKeyboard } from 'grammy';
import { z } from 'zod';
import { DialogManager } from '../dialog-manager.js';

export function registerQuestionnaireModule(manager: DialogManager): void {
  // 1. Окно приветствия
  manager.register({
    id: 'welcome',
    render: async (ctx) => {
      const keyboard = new InlineKeyboard().text('▶️ Начать анкету', 'to_form');
      return {
        text: '*Добро пожаловать!*\n\nЭто демонстрация мини-библиотеки диалогов на TypeScript и grammY.',
        keyboard,
      };
    },
    actions: {
      to_form: async (ctx, manager) => {
        await manager.goTo(ctx, 'ask_name');
      },
    },
  });

  // 2. Окно ввода имени с валидацией Zod
  manager.register({
    id: 'ask_name',
    render: async (ctx) => {
      const error = ctx.session.data.error;
      delete ctx.session.data.error;

      const keyboard = new InlineKeyboard().text('🔙 Назад', 'welcome');

      let text = '*Шаг 1: Введите ваше имя*\n\n_Имя должно содержать от 2 до 50 символов._';
      if (error) {
        text = `❌ *${error}*\n\n` + text;
      }

      return { text, keyboard };
    },
    inputSchema: z
      .string()
      .min(2, 'Имя слишком короткое (минимум 2 символа)')
      .max(50, 'Имя слишком длинное (максимум 50 символов)'),
    onInput: async (ctx, manager) => {
      ctx.session.data.name = ctx.session.data.validatedInput;
      delete ctx.session.data.validatedInput;
      await manager.goTo(ctx, 'summary');
    },
    actions: {
      welcome: async (ctx, manager) => {
        delete ctx.session.data.error;
        await manager.goTo(ctx, 'welcome');
      },
    },
  });

  // 3. Финальное окно
  manager.register({
    id: 'summary',
    render: async (ctx) => {
      const name = ctx.session.data.name || 'Аноним';
      const keyboard = new InlineKeyboard().text('🔄 Начать заново', 'restart');

      return {
        text: `✅ *Анкета успешно завершена!*\n\nСобранные данные:\n- Имя: ${name}`,
        keyboard,
      };
    },
    actions: {
      restart: async (ctx, manager) => {
        await manager.start(ctx, 'welcome');
      },
    },
  });
}