import { InlineKeyboard } from 'grammy';
import { DialogManager } from '../dialog-manager.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  AVAILABLE_INTERESTS,
  nameSchema,
  createInterestsSchema
} from '../schemas/questionnaire.schema.js';

export function registerQuestionnaireModule(manager: DialogManager): void {
  // 1. Окно приветствия (Главное меню)
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
    inputSchema: nameSchema,
    onInput: async (ctx, manager) => {
      ctx.session.data.name = ctx.session.data.validatedInput;
      delete ctx.session.data.validatedInput;

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
        const parseResult = createInterestsSchema(1, 4).safeParse(selected);

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
      edit_name: async (ctx, manager) => {
        ctx.session.data.returnTo = 'summary';
        await manager.goTo(ctx, 'ask_name');
      },
      edit_interests: async (ctx, manager) => {
        ctx.session.data.returnTo = 'summary';
        await manager.goTo(ctx, 'ask_interests');
      },
      confirm_all: async (ctx, manager) => {
        const adminChatId = config.ADMIN_CHAT_ID;

        if (adminChatId) {
          try {
            const name = ctx.session.data.name || 'Аноним';
            const interestIdsList = ctx.session.data.interests || [];

            // Превращаем ID технологий в человекочитаемые метки
            const interestLabels = interestIdsList
              .map((id: string) => AVAILABLE_INTERESTS.find((i) => i.id === id)?.label)
              .filter(Boolean)
              .join(', ');

            const userId = ctx.from?.id;
            const username = ctx.from?.username ? `@${ctx.from.username}` : 'скрыт';

            // Формируем сообщение для администратора
            const adminMessage =
              `🚨 *Новая заполненная анкета!*\n\n` +
              `👤 *Имя:* ${name}\n` +
              `🔗 *Пользователь:* ${username} (ID: \`${userId}\`)\n` +
              `💻 *Технологии:* ${interestLabels || 'Не выбрано'}\n` +
              `📅 *Дата:* ${new Date().toLocaleString('ru-RU')}`;

            // Отправляем сообщение в админ-чат
            await ctx.api.sendMessage(adminChatId, adminMessage, {
              parse_mode: 'Markdown',
            });

            logger.info(`📤 Анкета успешно отправлена администратору в чат ${adminChatId}`, { userId });
          } catch (error) {
            logger.error(`❌ Ошибка при отправке анкеты администратору`, { error });
          }
        } else {
          logger.warn(`⚠️ ADMIN_CHAT_ID не настроен в конфигурации. Уведомление не отправлено.`);
        }

        // Переходим на финальное окно благодарности
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

  // Окно подтверждения сброса при отправке /start
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
        ctx.session.data = {};
        await manager.start(ctx, 'main_menu');
      },
      cancel_restart: async (ctx, manager) => {
        const prevWindow = ctx.session.data.previousWindow || 'summary';
        await manager.goTo(ctx, prevWindow);
      },
    },
  });
}