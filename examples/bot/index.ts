import { Bot, session } from 'grammy';
import { sequentialize } from '@grammyjs/runner';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Redis } from 'ioredis';
import { RedisAdapter } from '@grammyjs/storage-redis';
import {
  DialogManager,
  type DialogContext,
  type DialogSession,
} from '../../src/core/dialog-manager.js';
import { translations, type AppTranslationKeys } from './translations.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { describeText } from './utils/log-privacy.js';
import { D } from './modules/dialog-ids.js';
import { createCoreDialog } from './modules/core.dialog.js';
import { createQuestionnaireDialog } from './modules/questionnaire.dialog.js';
import { createBranchingDialog } from './modules/branching.dialog.js';
import { createAdminDialog } from './modules/admin.dialog.js';

// 1. Типы приложения: глобального состояния нет — оно принадлежит диалогам.
export type AppContext = DialogContext<Record<string, any>>;

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

// 3. Redis и сессии
let shuttingDown = false;

const redisClient = new Redis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
  // Namespace ключей: разные боты и окружения на одном Redis не пересекаются.
  keyPrefix: config.REDIS_KEY_PREFIX,
  // Fail-fast: при обрыве команды не висят в offline-очереди.
  enableOfflineQueue: false,
  maxRetriesPerRequest: 2,
});

// ioredis эмитит 'error' только при наличии слушателя — без него ошибки невидимы.
redisClient.on('error', (error: Error) => {
  logger.error('Redis: ошибка соединения', { error });
});
redisClient.on('ready', () => logger.info('Redis: соединение готово'));
redisClient.on('reconnecting', (delay: number) => {
  logger.warn('Redis: переподключение', { delayMs: delay });
});
redisClient.on('end', () => {
  if (!shuttingDown) logger.warn('Redis: соединение закрыто');
});

const storage = new RedisAdapter({ instance: redisClient, ttl: 60 * 60 * 24 });

// Ключ сессии и ключ сериализации обязаны совпадать.
// Минимальный структурный тип: не зависит от состава контекста и вычисляется
// до появления ctx.session / ctx.data / ctx.frame.
const sessionKey = (ctx: { chat?: { id: number } | undefined }): string | undefined =>
  ctx.chat?.id.toString();

// Сериализация апдейтов по чату: защита read-modify-write сессии. ДО session.
bot.use(sequentialize((ctx) => sessionKey(ctx) ?? 'no-chat'));

bot.use(
  session({
    getSessionKey: sessionKey,
    initial: (): DialogSession => ({ stack: [], lang: 'ru' }),
    storage,
  })
);

// 4. Контекстное логирование (после сессий)
bot.use(async (ctx, next) => {
  const updateType = ctx.update
    ? Object.keys(ctx.update).filter((k) => k !== 'update_id')[0]
    : 'unknown';
  const userId = ctx.from?.id;
  const stack = ctx.session?.stack ?? [];
  const frame = stack[stack.length - 1];
  const currentWindow = frame ? `${frame.dialog}/${frame.window}` : 'unknown';
  const callbackData = ctx.callbackQuery?.data;
  const inputInfo = describeText(ctx.message?.text, config.LOG_USER_TEXT);

  logger.info(`📥 Входящее обновление [${updateType}]`, {
    userId,
    ...(config.LOG_USER_TEXT === 'full' && {
      username: ctx.from?.username ?? ctx.from?.first_name,
    }),
    currentWindow,
    ...(callbackData && { action: callbackData }),
    ...(inputInfo && { input: inputInfo }),
  });

  const start = Date.now();
  try {
    await next();
    const after = ctx.session?.stack ?? [];
    const f = after[after.length - 1];
    logger.info(`✅ Успешно обработано`, {
      userId,
      fromWindow: currentWindow,
      toWindow: f ? `${f.dialog}/${f.window}` : 'unknown',
      durationMs: Date.now() - start,
    });
  } catch (error) {
    logger.error(`❌ Ошибка при обработке`, {
      userId, currentWindow, durationMs: Date.now() - start, error,
    });
    throw error;
  }
});

// 5. Менеджер диалогов
const manager = new DialogManager<Record<string, any>, string, AppTranslationKeys>({
  logger,
  translations,
  defaultLang: 'ru',
  rootDialogId: D.core,
  onError: async (error, ctx) => {
    logger.error(`Unhandled error in dialog flow`, { error, userId: ctx.from?.id });
    await manager.restart(ctx, D.core);
  },
});

// 6. Регистрация диалогов
manager
  .registerDialog(createCoreDialog())
  .registerDialog(createQuestionnaireDialog())
  .registerDialog(createBranchingDialog())
  .registerDialog(createAdminDialog());

const registered = new Set(manager.registeredDialogIds());
for (const id of Object.values(D)) {
  if (!registered.has(id)) {
    throw new Error(`Dialog "${id}" is declared in D but not registered`);
  }
}
logger.info(`Диалоги зарегистрированы`, { dialogs: [...registered] });

// 7. /start (до middleware менеджера)
bot.command('start', async (ctx) => {
  const frame = manager.getFrame(ctx);
  const inCore = frame?.dialog === D.core;

  if (!frame || (inCore && (frame.window === 'main_menu' || frame.window === 'completed'))) {
    await manager.restart(ctx, D.core);
    return;
  }

  if (inCore && frame.window === 'confirm_restart') {
    await manager.show(ctx);
    return;
  }

  // Кладём подтверждение ПОВЕРХ текущего диалога — его фрейм сохранится сам,
  // а «Продолжить заполнение» сделает done() и вернёт окно + историю + данные.
  await manager.startDialog(ctx, D.core, { entry: 'confirm_restart' });
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
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Получен ${signal}, останавливаюсь...`);

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

// 11. Запуск
bot
  .start({
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