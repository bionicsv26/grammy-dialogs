import 'dotenv/config';
import { Bot, session, InlineKeyboard } from 'grammy';
import { DialogManager, type DialogContext } from './dialog-manager.js';

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN не задан в переменных окружения (.env)');
}

const bot = new Bot<DialogContext>(token);

// 1. Подключаем хранилище сессий grammY (необходимо для работы стейта)
bot.use(
  session({
    initial: (): DialogContext['session'] => ({ data: {} }),
  })
);

const manager = new DialogManager(bot);

// 2. Подключаем middleware диалогов для автоматического перехвата кликов по кнопкам
bot.use(manager.middleware());

// --- Окно 1: Приветствие ---
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

// --- Окно 2: Сбор данных ---
manager.register({
  id: 'ask_name',
  render: async (ctx) => {
    const currentName = ctx.session.data.name || 'еще не указано';
    const keyboard = new InlineKeyboard()
      .text('✍️ Указать имя ("Алексей")', 'set_name')
      .row()
      .text('➡️ Далее к финалу', 'to_summary')
      .row()
      .text('🔙 Назад', 'welcome');

    return {
      text: `*Шаг 1: Ввод данных*\n\nТекущее имя в сессии: *${currentName}*\n\nНажмите кнопку ниже, чтобы сымулировать сохранение данных.`,
      keyboard,
    };
  },
  actions: {
    set_name: async (ctx, manager) => {
      // Сохраняем данные в объект сессии диалога
      ctx.session.data.name = 'Алексей';
      await manager.show(ctx); // Перерисовываем текущее окно с обновленными данными
    },
    to_summary: async (ctx, manager) => {
      await manager.goTo(ctx, 'summary');
    },
    welcome: async (ctx, manager) => {
      await manager.goTo(ctx, 'welcome');
    },
  },
});

// --- Окно 3: Финал ---
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

// 3. Команда старта диалога
bot.command('start', async (ctx) => {
  await manager.start(ctx, 'welcome');
});

// Запуск бота
console.log('Бот запущен и ожидает сообщения...');
bot.start();