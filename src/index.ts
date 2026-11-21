import { Bot, session } from 'grammy';
import { sequentialize } from '@grammyjs/runner';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Redis } from 'ioredis';
import { RedisAdapter } from '@grammyjs/storage-redis';
import {
  DialogManager,
  type DialogContext,
  type DialogFrame,
  type DialogSession,
} from './dialog-manager.js';
import { translations, type AppTranslationKeys } from './translations.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { describeText } from './utils/log-privacy.js';
import { createCoreDialog, type CoreState } from './modules/core.dialog.js';
import { createQuestionnaireDialog } from './modules/questionnaire.dialog.js';
import { createBranchingDialog } from './modules/branching.dialog.js';
import { createAdminDialog } from './modules/admin.dialog.js';

// 1. Типы приложения: глобального состояния больше нет — оно у диалогов.
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
  keyPrefix: config.REDIS_KEY_PREFIX,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 2,
});

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

const sessionKey = (ctx: Omit<AppContext, 'session' | 'data'>): string | undefined =>
  ctx.chat?.id.toString();

bot.use(sequentialize((ctx) => sessionKey(ctx) ?? 'no-chat'));

bot.use(
  session({
    getSessionKey: sessionKey,
    initial: (): DialogSession => ({ stack: [], lang: 'ru' }),
    storage,
  })
);

// 4. Контекстное логирование
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
const manager = new DialogManager<Record<string, any>, string, AppTranslationKeys>(bot, {
  translations,
  defaultLang: 'ru',
  rootDialogId: 'core',
  onError: async (error, ctx) => {
    logger.error(`Unhandled error in dialog flow`, { error, userId: ctx.from?.id });
    await manager.restart(ctx, 'core');
  },
});

// 6. Регистрация диалогов
manager
  .registerDialog(createCoreDialog())
  .registerDialog(createQuestionnaireDialog())
  .registerDialog(createBranchingDialog())
  .registerDialog(createAdminDialog());

// 7. /start
bot.command('start', async (ctx) => {
  const frame = manager.getFrame(ctx);
  const inCore = frame?.dialog === 'core';

  if (!frame || (inCore && (frame.window === 'main_menu' || frame.window === 'completed'))) {
    await manager.restart(ctx, 'core');
    return;
  }

  if (inCore && frame.window === 'confirm_restart') {
    await manager.show(ctx);
    return;
  }

  // Сохраняем фрейм целиком, чтобы вернуть окно + историю + состояние.
  // В подшаге 3.1b это заменит вложенность (startDialog поверх + done).
  const saved = JSON.parse(JSON.stringify(frame)) as DialogFrame;
  await manager.startDialog(ctx, 'core');
  (ctx.data as CoreState).savedFrame = saved;
  await manager.goTo(ctx, 'confirm_restart');
});

// 8. Middleware менеджера
bot.use(manager.middleware());

// 9. Глобальный обработчик ошибок
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