import { Bot, session } from 'grammy';
import {
  DialogManager,
  type DialogContext,
  type DialogSession,
} from '@bionicsv/grammy-dialogs';
import { createQuizDialog } from './dialogs/quiz.dialog.js';
import { quizTranslations, type QuizKeys } from './translations.js';

type Ctx = DialogContext<Record<string, any>>;

const bot = new Bot<Ctx>(process.env.BOT_TOKEN!);

bot.use(session({
  initial: (): DialogSession => ({ stack: [] }),
}));

const manager = new DialogManager<Record<string, any>, string, QuizKeys>({
  translations: quizTranslations,
  defaultLang: 'ru',
  rootDialogId: 'quiz',
});
manager.registerDialog(createQuizDialog());

bot.command('start', (ctx) => manager.restart(ctx, 'quiz'));
bot.use(manager.middleware());

void bot.start();