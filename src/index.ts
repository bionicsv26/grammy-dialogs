import { Bot, session } from 'grammy';
import { HttpsProxyAgent } from 'https-proxy-agent';
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

bot.use(
  session({
    initial: (): DialogContext['session'] => ({ data: {} }),
  })
);

const manager = new DialogManager(bot);
bot.use(manager.middleware());

// Регистрируем весь логический модуль целиком одной строкой
registerQuestionnaireModule(manager);

bot.command('start', async (ctx) => {
  await manager.start(ctx, 'welcome');
});

console.log('Бот запущен и ожидает сообщения...');
bot.start();