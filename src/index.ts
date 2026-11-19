import { Bot, session } from 'grammy';
import { sequentialize } from '@grammyjs/runner';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Redis } from 'ioredis';
import { RedisAdapter } from '@grammyjs/storage-redis';
import {
  DialogManager,
  type DialogContext,
  type DialogSession,
} from './dialog-manager.js';
import { translations, type AppTranslationKeys } from './translations.js';
import { config } from './config.js';
import { logger } from './logger.js';
import {
  createCoreWindows,
  type CoreState,
  type CoreWindowId,
} from './modules/core.dialog.js';
import {
  createQuestionnaireWindows,
  type QuestionnaireState,
  type QuestionnaireWindowId,
} from './modules/questionnaire.dialog.js';
import {
  createBranchingWindows,
  type BranchingState,
  type BranchingWindowId,
} from './modules/branching.dialog.js';

// 1. Единые типы приложения
export type AppState = CoreState & QuestionnaireState & BranchingState;
export type AppWindowId = CoreWindowId | QuestionnaireWindowId | BranchingWindowId;
export type AppContext = DialogContext<AppState>;

// 2. Бот (с прокси в режиме разработки)
const isDev = config.NODE_ENV === 'development';
const clientConfig =
  isDev && config.HTTPS_PROXY
    ? {
      client: {
        baseFetchConfig: {
          agent: new HttpsProxyAgent(config.HTTPS_PROXY, { keepAlive: true }),
        },
      },
    }
    : {};

const bot = new Bot<AppContext>(config.BOT_TOKEN, clientConfig);

// 3. Redis и сессии (первыми!)
let shuttingDown = false;

const redisClient = new Redis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
  // Namespace ключей: разные боты и окружения на одном Redis не пересекаются.
  keyPrefix: config.REDIS_KEY_PREFIX,
  // Политика fail-fast: при обрыве команды не висят в offline-очереди,
  // а сразу падают в обработку ошибок. Если нужно «молча ждать реконнекта» —
  // убери эти две строки.
  enableOfflineQueue: false,
  maxRetriesPerRequest: 2,
});

// ioredis эмитит 'error' только при наличии слушателя — без него ошибки невидимы.
redisClient.on('error', (error: Error) => {
  logger.error('Redis: ошибка соединения', { error });
});
redisClient.on('ready', () => {
  logger.info('Redis: соединение готово');
});
redisClient.on('reconnecting', (delay: number) => {
  logger.warn('Redis: переподключение', { delayMs: delay });
});
redisClient.on('end', () => {
  if (!shuttingDown) logger.warn('Redis: соединение закрыто');
});

const storage = new RedisAdapter({
  instance: redisClient,
  ttl: 60 * 60 * 24, // 24 часа (секунды; обновляется при каждой записи сессии)
});

// Ключ вычисляется ДО появления ctx.session — тип контекста без session.
const sessionKey = (ctx: Omit<AppContext, 'session'>): string | undefined =>
  ctx.chat?.id.toString();

// Сериализация апдейтов по чату: защита read-modify-write сессии.
// ДОЛЖНА стоять до session — иначе не защищает её.
bot.use(sequentialize((ctx) => sessionKey(ctx) ?? 'no-chat'));

bot.use(
  session({
    getSessionKey: sessionKey,
    initial: (): DialogSession<AppState> => ({
      data: {} as DialogSession<AppState>['data'],
      lang: 'ru',
    }),
    storage,
  })
);

// 4. Контекстное логирование (после сессий)
bot.use(async (ctx, next) => {
  const updateType = ctx.update
    ? Object.keys(ctx.update).filter((k) => k !== 'update_id')[0]
    : 'unknown';
  const userId = ctx.from?.id;
  const username = ctx.from?.username || ctx.from?.first_name || 'Аноним';
  const currentWindow = ctx.session?.currentWindow || 'unknown';
  const callbackData = ctx.callbackQuery?.data;
  const userInputText = ctx.message?.text;

  logger.info(`📥 Входящее обновление [${updateType}]`, {
    userId,
    username,
    currentWindow,
    ...(callbackData && { action: callbackData }),
    ...(userInputText && { input: userInputText }),
  });

  const start = Date.now();
  try {
    await next();
    logger.info(`✅ Успешно обработано`, {
      userId,
      fromWindow: currentWindow,
      toWindow: ctx.session?.currentWindow || 'unknown',
      durationMs: Date.now() - start,
    });
  } catch (error) {
    logger.error(`❌ Ошибка при обработке`, {
      userId,
      currentWindow,
      durationMs: Date.now() - start,
      error,
    });
    throw error;
  }
});

// 5. DialogManager с i18n (parseMode по умолчанию HTML)
const manager = new DialogManager<AppState, AppWindowId, AppTranslationKeys>(bot, {
  translations,
  defaultLang: 'ru',
  rootWindowId: 'main_menu',
  onError: async (error, ctx) => {
    logger.error(`Unhandled error in dialog flow`, { error, userId: ctx.from?.id });
    delete ctx.session.data.error;
    ctx.session.currentWindow = 'main_menu';
    ctx.session.history = [];
    await manager.show(ctx);
  },
});

// 6. Окна диалогов (типобезопасная композиция, без кастов менеджера)
manager
  .registerAll(createCoreWindows<AppState>())
  .registerAll(createQuestionnaireWindows<AppState>())
  .registerAll(createBranchingWindows<AppState>());

// 7. Команда /start (до middleware менеджера)
bot.command('start', async (ctx) => {
  const current = ctx.session.currentWindow;

  if (!current || current === 'main_menu' || current === 'completed') {
    await manager.start(ctx, 'main_menu');
    return;
  }

  if (current === 'confirm_restart') {
    await manager.show(ctx);
    return;
  }

  // goTo, а не start: start() обнуляет data и history
  ctx.session.data.previousWindow = current;
  await manager.goTo(ctx, 'confirm_restart');
});

// 8. Middleware менеджера диалогов
bot.use(manager.middleware());

// 9. Глобальный обработчик ошибок. Без него grammY останавливает polling
bot.catch((err) => {
  logger.error(`Глобальная ошибка бота на апдейте ${err.ctx.update.update_id}:`, {
    error: err.error,
  });
});

// 10. Graceful shutdown
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return; // повторный Ctrl+C не запускает остановку дважды
  shuttingDown = true;
  logger.info(`Получен ${signal}, останавливаюсь...`);

  // Страховка: если остановка зависла, не держим процесс вечно.
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown завис, принудительный выход');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    // Сначала перестаём принимать апдейты, потом закрываем хранилище.
    await bot.stop();
    await redisClient.quit();
    logger.info('Бот остановлен, Redis-соединение закрыто');
    process.exit(0);
  } catch (error) {
    logger.error('Ошибка при остановке', { error });
    process.exit(1);
  }
};

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

// 11. Запуск. Ошибка старта (например, нет сети до Telegram) попадёт в лог
bot
  .start({
    // Только те типы, которые реально обрабатываем.
    // Добавишь обработчик другого типа — допиши его сюда, иначе он не сработает.
    allowed_updates: ['message', 'callback_query'],
    onStart: (botInfo) => {
      logger.info(`🤖 Bot @${botInfo.username} successfully started and ready for requests!`);
    },
  })
  .catch(async (error) => {
    logger.error('Не удалось запустить бота', { error });
    await redisClient.quit().catch(() => { });
    process.exit(1);
  });