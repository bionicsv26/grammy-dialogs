// src/index.ts
import { Bot, session } from 'grammy';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Redis } from 'ioredis';
import { RedisAdapter } from '@grammyjs/storage-redis';
import { config } from './config.js';
import { DialogManager, type DialogContext } from './dialog-manager.js';
import { registerQuestionnaireModule } from './modules/questionnaire.dialog.js';
import { logger } from './logger.js'; // ✅ Импортируем наш логгер

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

// Middleware логирования через Winston
bot.use(async (ctx, next) => {
  const updateType = ctx.update ? Object.keys(ctx.update).filter((k) => k !== 'update_id')[0] : 'unknown';
  const userId = ctx.from?.id;
  const username = ctx.from?.username || ctx.from?.first_name || 'Аноним';

  logger.info(`📥 Входящее обновление [${updateType}]`, { userId, username });

  const start = Date.now();
  try {
    await next();
    const duration = Date.now() - start;
    logger.info(`✅ Обновление успешно обработано`, { userId, durationMs: duration });
  } catch (error) {
    const duration = Date.now() - start;
    logger.error(`❌ Ошибка при обработке обновления`, { userId, durationMs: duration, error });
    throw error;
  }
});

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

const manager = new DialogManager(bot);
bot.use(manager.middleware());

registerQuestionnaireModule(manager);

bot.command('start', async (ctx) => {
  await manager.start(ctx, 'welcome');
});

// Глобальный обработчик ошибок
bot.catch((err) => {
  const ctx = err.ctx;
  logger.error(`Глобальная ошибка бота на апдейте ${ctx.update.update_id}:`, {
    error: err.error,
  });
});

logger.info('Бот успешно запущен и подключен к Redis с Winston логированием!');
bot.start();