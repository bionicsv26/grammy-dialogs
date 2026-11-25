import { Bot, InlineKeyboard, session } from 'grammy';
import { z } from 'zod';
import {
  DialogManager,
  defineDialog,
  defineWindow,
  escapeHtml,
  type DialogContext,
  type DialogSession,
} from '../../src/core/index.js';

interface FormState {
  name?: string;
}
type FormId = 'greet' | 'ask_name' | 'done';
type Ctx = DialogContext<FormState>;

const bot = new Bot<Ctx>(process.env.BOT_TOKEN!);

bot.use(session({ initial: (): DialogSession => ({ stack: [] }) }));

const manager = new DialogManager<FormState, FormId, string>({ rootDialogId: 'form' });
const win = defineWindow<FormState, FormId, string>();

manager.registerDialog(
  defineDialog<FormState, FormId, string>({
    id: 'form',
    windows: [
      {
        id: 'greet',
        render: () => ({
          text: '<b>Привет!</b> Нажми кнопку, чтобы представиться.',
          keyboard: new InlineKeyboard().text('Поехали', 'to_name'),
        }),
        actions: {
          to_name: (ctx, m) => m.goTo(ctx, 'ask_name'),
        },
      },
      win({
        id: 'ask_name',
        render: (ctx) => ({
          text: ctx.data.error
            ? `❌ ${escapeHtml(ctx.data.error)}\n\nКак тебя зовут?`
            : 'Как тебя зовут?',
        }),
        inputSchema: z.string().min(2, 'Минимум 2 символа'),
        onInput: async (ctx, m, _t, value) => {
          ctx.data.name = value;
          await m.goTo(ctx, 'done');
        },
      }),
      {
        id: 'done',
        render: (ctx) => ({
          text: `Приятно познакомиться, ${escapeHtml(ctx.data.name ?? 'незнакомец')}!`,
        }),
      },
    ],
  })
);

bot.command('start', (ctx) => manager.restart(ctx, 'form'));
bot.use(manager.middleware());

void bot.start();