import { Bot, session } from 'grammy';
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
  registerQuestionnaireModule,
  type QuestionnaireState,
  type QuestionnaireWindowId,
} from './modules/questionnaire.dialog.js';
import {
  registerBranchingModule,
  type BranchingState,
  type BranchingWindowId,
} from './modules/branching.dialog.js';

// 1. Единые типы приложения
export type AppState = QuestionnaireState & BranchingState;
export type AppWindowId = QuestionnaireWindowId | BranchingWindowId;
export type AppContext = DialogContext<AppState, AppWindowId>;

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
const redisClient = new Redis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
});

const storage = new RedisAdapter({
  instance: redisClient,
  ttl: 60 * 60 * 24, // 24 часа
});

bot.use(
  session({
    initial: (): DialogSession<AppState, AppWindowId> => ({
      data: {} as DialogSession<AppState, AppWindowId>['data'],
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

// 5. DialogManager с i18n
const manager = new DialogManager<AppState, AppWindowId, AppTranslationKeys>(bot, {
  translations,
  defaultLang: 'ru',
  onError: async (error, ctx) => {
    logger.error(`Unhandled error in dialog flow`, { error, userId: ctx.from?.id });
    delete ctx.session.data.error;
    ctx.session.currentWindow = 'main_menu';
    ctx.session.history = [];
    await manager.show(ctx);
  },
});

// 6. Модули диалогов
registerQuestionnaireModule(manager);
registerBranchingModule(manager);

// 7. Команда /start (до middleware менеджера, чтобы команда не попадала в обработку ввода)
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

// 10. Запуск. Ошибка старта (например, нет сети до Telegram) попадёт в лог
bot
  .start({
    onStart: (botInfo) => {
      logger.info(`🤖 Bot @${botInfo.username} successfully started and ready for requests!`);
    },
  })
  .catch((error) => {
    logger.error(`Не удалось запустить бота`, { error });
    process.exit(1);
  });