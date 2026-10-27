import { InlineKeyboard } from 'grammy';
import { z } from 'zod';
import { DialogManager } from '../dialog-manager.js';

// Список доступных вариантов для выбора
const AVAILABLE_INTERESTS = [
  { id: 'ts', label: 'TypeScript' },
  { id: 'node', label: 'Node.js' },
  { id: 'redis', label: 'Redis' },
  { id: 'vue', label: 'Vue 3' },
];

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

      let text = '*Шаг 1: Введите ваше имя*\n\n_Имя должно содержать от 2 до 30 символов._';
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
      // После ввода имени переходим к выбору интересов (чекбоксам)
      await manager.goTo(ctx, 'ask_interests');
    },
    actions: {
      welcome: async (ctx, manager) => {
        delete ctx.session.data.error;
        await manager.goTo(ctx, 'welcome');
      },
    },
  });

  // 3. 🆕 Окно с выбором нескольких вариантов (чекбоксы)
  manager.register({
    id: 'ask_interests',
    render: async (ctx) => {
      // Инициализируем массив выбранных опций в сессии, если его еще нет
      if (!Array.isArray(ctx.session.data.interests)) {
        ctx.session.data.interests = [];
      }
      const selected: string[] = ctx.session.data.interests;

      const keyboard = new InlineKeyboard();

      // Динамически строим кнопки для каждой опции
      AVAILABLE_INTERESTS.forEach((item) => {
        const isSelected = selected.includes(item.id);
        const icon = isSelected ? '✅' : '⬜️';
        keyboard.text(`${icon} ${item.label}`, `toggle_${item.id}`).row();
      });

      // Кнопки управления
      keyboard.text('➡️ Подтвердить', 'confirm_interests').row();
      keyboard.text('🔙 Назад', 'ask_name');

      return {
        text: '*Шаг 2: Выберите интересные вам технологии*\n\n_Нажимайте на пункты, чтобы отметить их, затем нажмите «Подтвердить»._',
        keyboard,
      };
    },
    actions: {
      // Автоматически генерируем обработчики для переключения каждой опции
      ...Object.fromEntries(
        AVAILABLE_INTERESTS.map((item) => [
          `toggle_${item.id}`,
          async (ctx, manager) => {
            if (!Array.isArray(ctx.session.data.interests)) {
              ctx.session.data.interests = [];
            }
            const selected: string[] = ctx.session.data.interests;
            const index = selected.indexOf(item.id);

            if (index > -1) {
              selected.splice(index, 1); // Убираем из выбранных
            } else {
              selected.push(item.id); // Добавляем в выбранные
            }

            // Перерисовываем текущее окно, чтобы обновить галочки на клавиатуре
            await manager.show(ctx);
          },
        ])
      ),
      // Кнопка подтверждения выбора
      confirm_interests: async (ctx, manager) => {
        const selected = ctx.session.data.interests || [];
        if (selected.length === 0) {
          await ctx.answerCallbackQuery({
            text: '⚠️ Пожалуйста, выберите хотя бы один вариант!',
            show_alert: true,
          });
          return;
        }
        await manager.goTo(ctx, 'summary');
      },
      ask_name: async (ctx, manager) => {
        await manager.goTo(ctx, 'ask_name');
      },
    },
  });

  // 4. Финальное окно
  manager.register({
    id: 'summary',
    render: async (ctx) => {
      const name = ctx.session.data.name || 'Аноним';
      const interestIds = ctx.session.data.interests || [];

      // Превращаем ID обратно в читаемые названия
      const interestLabels = interestIds
        .map((id: string) => AVAILABLE_INTERESTS.find((i) => i.id === id)?.label)
        .filter(Boolean)
        .join(', ');

      const keyboard = new InlineKeyboard().text('🔄 Начать заново', 'restart');

      return {
        text: `✅ *Анкета успешно завершена!*\n\nСобранные данные:\n- Имя: ${name}\n- Технологии: ${interestLabels || 'Не выбрано'}`,
        keyboard,
      };
    },
    actions: {
      restart: async (ctx, manager) => {
        delete ctx.session.data.interests;
        delete ctx.session.data.name;
        await manager.start(ctx, 'welcome');
      },
    },
  });
}