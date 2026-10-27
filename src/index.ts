// src/index.ts
import { Bot, session } from 'grammy';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Redis } from 'ioredis';
import { RedisAdapter } from '@grammyjs/storage-redis';
import { config } from './config.js';
import { DialogManager, type DialogContext } from './dialog-manager.js';
import { registerQuestionnaireModule } from './modules/questionnaire.dialog.js';

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

// 1. Логирование входящих обновлений и времени их обработки
bot.use(async (ctx, next) => {
  const updateType = ctx.update ? Object.keys(ctx.update).filter((k) => k !== 'update_id')[0] : 'unknown';
  const userId = ctx.from?.id;
  const username = ctx.from?.username || ctx.from?.first_name || 'Аноним';

  console.log(`[LOG] 📥 Обновление [${updateType}] от пользователя @${username} (ID: ${userId})`);

  const start = Date.now();
  try {
    await next();
    const duration = Date.now() - start;
    console.log(`[LOG] ✅ Успешно обработано за ${duration}ms`);
  } catch (error) {
    const duration = Date.now() - start;
    console.error(`[LOG] ❌ Ошибка при обработке за ${duration}ms:`, error);
    throw error; // Пробрасываем ошибку дальше в bot.catch
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

// Регистрируем модуль анкеты
registerQuestionnaireModule(manager);

bot.command('start', async (ctx) => {
  await manager.start(ctx, 'welcome');
});

// 2. Глобальный обработчик ошибок бота
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[ERROR] Ошибка при обработке апдейта ${ctx.update.update_id}:`);
  console.error(err.error);
});

console.log('Бот успешно запущен и подключен к Redis с логированием!');
bot.start();