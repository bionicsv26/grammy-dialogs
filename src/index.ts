import { Bot, session } from 'grammy';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Redis } from 'ioredis';
import { RedisAdapter } from '@grammyjs/storage-redis';
import { config } from './config.js';
import { DialogManager, type DialogContext } from './dialog-manager.js';
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
import { logger } from './logger.js';

// 1. Объединяем состояние и ID окон со всех модулей
export type AppState = QuestionnaireState & BranchingState;
export type AppWindowId = QuestionnaireWindowId | BranchingWindowId;
export type AppContext = DialogContext<AppState, AppWindowId>;

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

// 2. Redis и сессии
const redisClient = new Redis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
});

const storage = new RedisAdapter({
  instance: redisClient,
  ttl: 60 * 60 * 24, // Время жизни сессии в секундах (здесь: 24 часа)
});

bot.use(
  session({
    initial: (): AppContext['session'] => ({ data: {} }),
    storage,
  })
);

// 3. Контекстное логирование (после сессий)
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
    const nextWindow = ctx.session?.currentWindow || 'unknown';

    logger.info(`✅ Успешно обработано`, {
      userId,
      fromWindow: currentWindow,
      toWindow: nextWindow,
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

// 4. DialogManager и модули
const manager = new DialogManager<AppState, AppWindowId>(bot);
bot.use(manager.middleware());

registerQuestionnaireModule(manager);
registerBranchingModule(manager);

// Перехват /start с защитой от случайного сброса
bot.command('start', async (ctx) => {
  const current = ctx.session.currentWindow;

  // Нет активного диалога, либо он на «безопасном» окне, можно сразу сбрасывать
  if (!current || current === 'main_menu' || current === 'completed') {
    await manager.start(ctx, 'main_menu');
    return;
  }

  // Повторный /start на окне подтверждения: просто показываем его снова
  if (current === 'confirm_restart') {
    await manager.show(ctx);
    return;
  }

  // Запоминаем окно и показываем подтверждение. Именно goTo, а не start:
  // start() обнуляет ctx.session.data и стёрла бы введённые данные.
  ctx.session.data.previousWindow = current;
  await manager.goTo(ctx, 'confirm_restart');
});

bot.catch((err) => {
  const ctx = err.ctx;
  logger.error(`Глобальная ошибка бота на апдейте ${ctx.update.update_id}:`, {
    error: err.error,
  });
});

logger.info('Бот успешно запущен!');
bot.start();