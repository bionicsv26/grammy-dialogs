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

// ✅ Инициализируем клиент Redis и адаптер хранилища grammY
const redisClient = new Redis(config.REDIS_URL);
const storage = new RedisAdapter({
  instance: redisClient,
});

// Подключаем сессии с использованием Redis-хранилища
bot.use(
  session({
    initial: (): DialogContext['session'] => ({ data: {} }),
    storage, // Сессии теперь сохраняются в Redis!
  })
);

const manager = new DialogManager(bot);
bot.use(manager.middleware());

// Регистрируем модуль анкеты
registerQuestionnaireModule(manager);

bot.command('start', async (ctx) => {
  await manager.start(ctx, 'welcome');
});

console.log('Бот запущен с хранением сессий в Redis...');
bot.start();