import { InlineKeyboard } from 'grammy';
import { z } from 'zod';
import { DialogManager } from '../dialog-manager.js';

const AVAILABLE_INTERESTS = [
  { id: 'ts', label: 'TypeScript' },
  { id: 'node', label: 'Node.js' },
  { id: 'redis', label: 'Redis' },
  { id: 'vue', label: 'Vue 3' },
] as const;

const interestIds = AVAILABLE_INTERESTS.map((item) => item.id) as [
  (typeof AVAILABLE_INTERESTS)[number]['id'],
  ...(typeof AVAILABLE_INTERESTS)[number]['id'][]
];

const interestsSchema = z
  .array(z.enum(interestIds))
  .min(1, 'Выберите хотя бы одну технологию')
  .max(4, 'Можно выбрать максимум 4 технологии');

export function registerQuestionnaireModule(manager: DialogManager): void {
  // 1. Окно приветствия
  manager.register({
    id: 'main_menu',
    render: async (ctx) => {
      const keyboard = new InlineKeyboard()
        .text('▶️ Начать анкету', 'to_form')
        .row()
        .text('🔀 Выбор направления', 'proceed_to_branches');
      return {
        text: '*Добро пожаловать!*\n\nЭто демонстрация мини-библиотеки диалогов на TypeScript и grammY.',
        keyboard,
      };
    },
    actions: {
      to_form: async (ctx, manager) => {
        await manager.goTo(ctx, 'ask_name');
      },
      proceed_to_branches: async (ctx, manager) => {
        await manager.goTo(ctx, 'select_branch');
      },
    },
  });

  // 2. Окно ввода имени
  manager.register({
    id: 'ask_name',
    render: async (ctx) => {
      const error = ctx.session.data.error;
      delete ctx.session.data.error;

      // 🔍 Проверяем, редактирует ли пользователь данные из summary
      const isEditing = ctx.session.data.returnTo === 'summary';
      const backAction = isEditing ? 'cancel_edit_name' : 'main_menu';
      const backLabel = isEditing ? '🔙 Отмена' : '🔙 Назад';

      const keyboard = new InlineKeyboard().text(backLabel, backAction);

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

      // 🔄 Проверяем, куда нужно вернуться после ввода
      const returnTo = ctx.session.data.returnTo;
      delete ctx.session.data.returnTo;

      await manager.goTo(ctx, returnTo || 'ask_interests');
    },
    actions: {
      main_menu: async (ctx, manager) => {
        delete ctx.session.data.error;
        await manager.goTo(ctx, 'main_menu');
      },
      cancel_edit_name: async (ctx, manager) => {
        delete ctx.session.data.returnTo;
        delete ctx.session.data.error;
        await manager.goTo(ctx, 'summary');
      },
    },
  });

  // 3. Окно с выбором технологий (чекбоксы)
  manager.register({
    id: 'ask_interests',
    render: async (ctx) => {
      if (!Array.isArray(ctx.session.data.interests)) {
        ctx.session.data.interests = [];
      }
      const selected: string[] = ctx.session.data.interests;
      const isEditing = ctx.session.data.returnTo === 'summary';

      const keyboard = new InlineKeyboard();

      AVAILABLE_INTERESTS.forEach((item) => {
        const isSelected = selected.includes(item.id);
        const icon = isSelected ? '✅' : '⬜️';
        keyboard.text(`${icon} ${item.label}`, `toggle_${item.id}`).row();
      });

      const confirmLabel = isEditing ? '💾 Сохранить изменения' : '➡️ Подтвердить';
      const backAction = isEditing ? 'cancel_edit_interests' : 'ask_name';
      const backLabel = isEditing ? '🔙 Назад к предпросмотру' : '🔙 Назад';

      keyboard.text(confirmLabel, 'confirm_interests').row();
      keyboard.text(backLabel, backAction);

      return {
        text: '*Шаг 2: Выберите интересные вам технологии*\n\n_Отметьте от 1 до 4 вариантов._',
        keyboard,
      };
    },
    actions: {
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
              selected.splice(index, 1);
            } else {
              selected.push(item.id);
            }

            await manager.show(ctx);
          },
        ])
      ),
      confirm_interests: async (ctx, manager) => {
        const selected = ctx.session.data.interests || [];
        const parseResult = interestsSchema.safeParse(selected);

        if (!parseResult.success) {
          const errorMessage = parseResult.error.issues[0]?.message || 'Неверный выбор';
          await ctx.answerCallbackQuery({
            text: `⚠️ ${errorMessage}`,
            show_alert: true,
          }).catch(() => { });
          return;
        }

        const returnTo = ctx.session.data.returnTo;
        delete ctx.session.data.returnTo;

        await manager.goTo(ctx, returnTo || 'summary');
      },
      ask_name: async (ctx, manager) => {
        await manager.goTo(ctx, 'ask_name');
      },
      cancel_edit_interests: async (ctx, manager) => {
        delete ctx.session.data.returnTo;
        await manager.goTo(ctx, 'summary');
      },
    },
  });

  // 4. Окно предпросмотра (Summary)
  manager.register({
    id: 'summary',
    render: async (ctx) => {
      const name = ctx.session.data.name || 'Аноним';
      const interestIdsList = ctx.session.data.interests || [];

      const interestLabels = interestIdsList
        .map((id: string) => AVAILABLE_INTERESTS.find((i) => i.id === id)?.label)
        .filter(Boolean)
        .join(', ');

      const keyboard = new InlineKeyboard()
        .text('✏️ Изменить имя', 'edit_name').row()
        .text('✏️ Изменить технологии', 'edit_interests').row()
        .text('✅ Всё верно, подтвердить', 'confirm_all').row()
        .text('🔄 Начать заново', 'restart');

      return {
        text: `📋 *Предпросмотр анкеты*\n\nПроверьте данные:\n\n👤 *Имя:* ${name}\n💻 *Технологии:* ${interestLabels || 'Не выбрано'}`,
        keyboard,
      };
    },
    actions: {
      // 🎯 Устанавливаем флаг возврата перед переходом на шаг
      edit_name: async (ctx, manager) => {
        ctx.session.data.returnTo = 'summary';
        await manager.goTo(ctx, 'ask_name');
      },
      edit_interests: async (ctx, manager) => {
        ctx.session.data.returnTo = 'summary';
        await manager.goTo(ctx, 'ask_interests');
      },
      confirm_all: async (ctx, manager) => {
        await manager.goTo(ctx, 'completed');
      },
      restart: async (ctx, manager) => {
        delete ctx.session.data.interests;
        delete ctx.session.data.name;
        delete ctx.session.data.returnTo;
        await manager.start(ctx, 'main_menu');
      },
    },
  });

  // 5. Финальное окно
  manager.register({
    id: 'completed',
    render: async (ctx) => {
      const keyboard = new InlineKeyboard()
        .text('🔄 Заполнить заново', 'restart');
      return {
        text: '🎉 *Спасибо! Ваша анкета успешно сохранена.*',
        keyboard,
      };
    },
    actions: {
      restart: async (ctx, manager) => {
        delete ctx.session.data.interests;
        delete ctx.session.data.name;
        delete ctx.session.data.returnTo;
        await manager.start(ctx, 'main_menu');
      },
    },
  });

  // 🆕 Окно подтверждения сброса при отправке /start
  manager.register({
    id: 'confirm_restart',
    render: async (ctx) => {
      const keyboard = new InlineKeyboard()
        .text('⚠️ Да, сбросить и начать заново', 'do_restart')
        .row()
        .text('🔙 Продолжить заполнение', 'cancel_restart')
        .row()
        .text('🏠 В главное меню', 'global_back_to_menu');

      return {
        text: '⚠️ *У вас есть незавершенная анкета!*\n\nЕсли вы начнете заново, все введенные данные будут потеряны. Вы уверены?',
        keyboard,
      };
    },
    actions: {
      do_restart: async (ctx, manager) => {
        // Полностью очищаем данные сессии и запускаем приветствие
        ctx.session.data = {};
        await manager.start(ctx, 'main_menu');
      },
      cancel_restart: async (ctx, manager) => {
        // Пытаемся вернуть пользователя туда, где он был, или на summary
        const prevWindow = ctx.session.data.previousWindow || 'summary';
        await manager.goTo(ctx, prevWindow);
      },
    },
  });
}