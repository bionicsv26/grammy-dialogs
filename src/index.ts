import { Bot, session, InlineKeyboard } from 'grammy';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { config } from './config.js';
import { DialogManager, type DialogContext } from './dialog-manager.js';

const isDev = config.NODE_ENV === 'development';

// Настраиваем прокси-агент для разработки, если он задан в конфиге
const clientConfig = isDev && config.HTTPS_PROXY
  ? {
    client: {
      baseFetchConfig: {
        agent: new HttpsProxyAgent(config.HTTPS_PROXY, { keepAlive: true }),
      },
    },
  }
  : {};

// Инициализируем бота с переданными настройками клиента
const bot = new Bot<DialogContext>(config.BOT_TOKEN, clientConfig);

if (isDev && config.HTTPS_PROXY) {
  console.log('🌐 Режим разработки, прокси для Telegram:', config.HTTPS_PROXY);
}

// 1. Подключаем хранилище сессий grammY (необходимо для работы стейта)
bot.use(
  session({
    initial: (): DialogContext['session'] => ({ data: {} }),
  })
);

const manager = new DialogManager(bot);

// 2. Подключаем middleware диалогов для автоматического перехвата кликов по инлайн-кнопкам
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

// --- Окно с вводом текста ---
manager.register({
  id: 'ask_name',
  render: async (ctx) => {
    const currentName = ctx.session.data.name || 'еще не указано';
    const keyboard = new InlineKeyboard().text('🔙 Назад', 'welcome');

    return {
      text: `*Шаг 1: Введите ваше имя*\n\nТекущее значение: *${currentName}*\n\n_Просто отправьте текст следующим сообщением в чат._`,
      keyboard,
    };
  },
  // Обрабатываем текст, который пользователь написал в чат
  onInput: async (ctx, manager) => {
    const text = ctx.message?.text?.trim();
    if (text) {
      ctx.session.data.name = text; // Сохраняем имя в сессию
      await manager.goTo(ctx, 'summary'); // Переходим к финалу
    }
  },
  actions: {
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