// src/index.ts
import { Bot, session } from 'grammy';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Redis } from 'ioredis';
import { RedisAdapter } from '@grammyjs/storage-redis';
import { config } from './config.js';
import { DialogManager, type DialogContext } from './dialog-manager.js';
import { registerQuestionnaireModule } from './modules/questionnaire.dialog.js';
import { logger } from './logger.js';

const isDev = config.NODE_ENV === 'development';
const clientConfig = isDev && config.HTTPS_PROXY
  ? {
    client: {
      baseFetchConfig: {
        agent: new HttpsProxyAgent(config.HTTPS_PROXY, { keepAlive: true }),
      },
    },
  }
  : {};

const bot = new Bot<DialogContext>(config.BOT_TOKEN, clientConfig);

// Инициализация Redis и сессий
const redisClient = new Redis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
});

const storage = new RedisAdapter({
  instance: redisClient,
});

bot.use(
  session({
    initial: (): DialogContext['session'] => ({ data: {} }),
    storage,
  })
);

// 📊 Продвинутое контекстное логирование с фиксацией пользовательского ввода
bot.use(async (ctx, next) => {
  const updateType = ctx.update ? Object.keys(ctx.update).filter((k) => k !== 'update_id')[0] : 'unknown';
  const userId = ctx.from?.id;
  const username = ctx.from?.username || ctx.from?.first_name || 'Аноним';

  // Контекст текущего диалога из сессии
  const currentWindow = ctx.session?.data?.currentWindow || 'unknown';
  const callbackData = ctx.callbackQuery?.data;
  const userInputText = ctx.message?.text;

  logger.info(`📥 Входящее обновление [${updateType}]`, {
    userId,
    username,
    currentWindow,
    ...(callbackData && { action: callbackData }),
    ...(userInputText && { input: userInputText }), // 📝 Логируем текст, введенный пользователем
  });

  const start = Date.now();
  try {
    await next();
    const duration = Date.now() - start;
    const nextWindow = ctx.session?.data?.currentWindow || 'unknown';

    logger.info(`✅ Успешно обработано`, {
      userId,
      fromWindow: currentWindow,
      toWindow: nextWindow,
      durationMs: duration,
    });
  } catch (error) {
    const duration = Date.now() - start;
    logger.error(`❌ Ошибка при обработке`, {
      userId,
      currentWindow,
      durationMs: duration,
      error,
    });
    throw error;
  }
});

const manager = new DialogManager(bot);
bot.use(manager.middleware());

registerQuestionnaireModule(manager);

bot.command('start', async (ctx) => {
  const isProfileInProgress = ctx.session.data.name || ctx.session.data.currentWindow;

  if (isProfileInProgress && ctx.session.data.currentWindow !== 'welcome' && ctx.session.data.currentWindow !== 'completed') {
    ctx.session.data.previousWindow = ctx.session.data.currentWindow || 'ask_name';
    await manager.start(ctx, 'confirm_restart');
    return;
  }

  ctx.session.data = {};
  await manager.start(ctx, 'welcome');
});

bot.catch((err) => {
  const ctx = err.ctx;
  logger.error(`Глобальная ошибка бота на апдейте ${ctx.update.update_id}:`, {
    error: err.error,
  });
});

logger.info('Бот успешно запущен и подключен к Redis с информативным Winston логированием!');
bot.start();