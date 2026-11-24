# grammy-dialogs

Type-safe dialog manager for [grammY](https://grammy.dev), inspired by aiogram-dialog.

- Диалог = группа окон со **своим состоянием** и своим стеком навигации
- Вложенные диалоги и возврат результата через `done(result)`
- Типобезопасные ID окон, i18n с автоэкранированием параметров, HTML по умолчанию
- Валидация ввода через Zod, guard'ы, лимиты глубины и callback_data

## Install

```bash
npm i @bionicsv/grammy-dialogs grammy zod
```

## Quickstart

```ts
import { Bot, session } from 'grammy';
import { DialogManager, defineDialog, type DialogContext, type DialogSession } from '@bionicsv/grammy-dialogs';

type Ctx = DialogContext<{ name?: string }>;
const bot = new Bot<Ctx>(process.env.BOT_TOKEN!);

bot.use(session({ initial: (): DialogSession => ({ stack: [], lang: 'ru' }) }));

const manager = new DialogManager({ rootDialogId: 'main' });

manager.registerDialog(defineDialog<{ name?: string }, 'hello' | 'ask', string>({
  id: 'main',
  windows: [
    { id: 'hello', render: () => ({ text: 'Привет!' }) },
  ],
}));

bot.command('start', (ctx) => manager.restart(ctx, 'main'));
bot.use(manager.middleware());
bot.start();
```

Полный пример — в [`examples/bot`](./examples/bot).