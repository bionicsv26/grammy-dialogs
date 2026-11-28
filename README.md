# grammy-dialogs

Типобезопасный менеджер диалогов для [grammY](https://grammy.dev), вдохновлённый aiogram-dialog.

- **Диалог** — группа окон со своим состоянием и своим стеком навигации
- **Вложенность**: поддиалог запускается поверх, `done(result)` возвращает результат родителю
- **Типобезопасность**: ID окон проверяются компилятором, тип значения ввода выводится из Zod-схемы
- **i18n** с автоэкранированием подставляемых параметров, HTML по умолчанию
- **Медиа**: фото, документы, видео, анимация — с корректными переходами к тексту и обратно
- Guard'ы, лимиты глубины, валидация `callback_data`, инъекция логгера

## Установка

```bash
npm i @bionicsv/grammy-dialogs grammy zod
```

## Quickstart

Полный компилируемый пример — в [`examples/quickstart`](./examples/quickstart).

```ts
import { Bot, InlineKeyboard, session } from 'grammy';
import { z } from 'zod';
import {
  DialogManager, defineDialog, defineWindow, escapeHtml,
  type DialogContext, type DialogSession,
} from '@bionicsv/grammy-dialogs';

interface FormState { name?: string }
type FormId = 'greet' | 'ask_name' | 'done';
type Ctx = DialogContext<FormState>;

const bot = new Bot<Ctx>(process.env.BOT_TOKEN!);
bot.use(session({ initial: (): DialogSession => ({ stack: [] }) }));

const manager = new DialogManager<FormState, FormId, string>({ rootDialogId: 'form' });
const win = defineWindow<FormState, FormId, string>();

manager.registerDialog(defineDialog<FormState, FormId, string>({
  id: 'form',
  windows: [
    {
      id: 'greet',
      render: () => ({
        text: '<b>Привет!</b>',
        keyboard: new InlineKeyboard().text('Поехали', 'to_name'),
      }),
      actions: { to_name: (ctx, m) => m.goTo(ctx, 'ask_name') },
    },
    win({
      id: 'ask_name',
      render: (ctx) => ({
        text: ctx.data.error ? `❌ ${escapeHtml(ctx.data.error)}\n\nКак тебя зовут?` : 'Как тебя зовут?',
      }),
      inputSchema: z.string().min(2, 'Минимум 2 символа'),
      onInput: async (ctx, m, _t, value) => {
        ctx.data.name = value;      // value: string — выведен из схемы
        await m.goTo(ctx, 'done');
      },
    }),
    { id: 'done', render: (ctx) => ({ text: `Привет, ${escapeHtml(ctx.data.name ?? '')}!` }) },
  ],
}));

bot.command('start', (ctx) => manager.restart(ctx, 'form'));
bot.use(manager.middleware());
void bot.start();
```

## Модель

Сессия хранит **стек фреймов**. Фрейм — это запущенный диалог: его текущее окно, история окон и изолированное состояние.

```ts
ctx.session   // служебное: stack, lang, messageId, messageKind
ctx.frame     // активный фрейм: dialog, window, history, data, startData
ctx.data      // состояние активного диалога (ссылка на frame.data)
```

Состояние разных диалогов не пересекается: `questionnaire.name` и `admin.broadcastText` живут в разных фреймах.

## Навигация

| Метод | Что делает |
|---|---|
| `goTo(ctx, windowId)` | переход внутри активного диалога, пишет историю |
| `goTo(ctx, id, { pushHistory: false })` | переход без записи в историю |
| `goBack(ctx)` | возврат по истории диалога |
| `show(ctx)` | перерисовать текущее окно |
| `startDialog(ctx, dialogId, { startData, entry })` | запустить поддиалог **поверх** текущего |
| `done(ctx, result?)` | завершить поддиалог, вернуть результат родителю |
| `resetDialog(ctx, dialogId)` | очистить стек и начать заново (то же сообщение) |
| `restart(ctx, dialogId)` | то же + снять старую клавиатуру и отправить новое сообщение |

Результат поддиалога получает **родительское окно** через статичный хук:

```ts
{
  id: 'main_menu',
  render: /* ... */,
  onDialogResult: async (ctx, m, _t, result) => {
    if (result === 'completed') await m.goTo(ctx, 'completed');
    else await m.show(ctx);
  },
}
```

Хук объявлен в конфиге окна, а не в сессии, поэтому переживает сериализацию в Redis.

## Окно

```ts
{
  id: 'ask_name',
  render: (ctx, t) => ({ text, keyboard }),   // обязателен
  actions: { /* обработчики inline-кнопок */ },
  onInput: (ctx, m, t, value) => {},          // приём текста
  onEnter: (ctx, m, t) => {},                 // вход в окно: можно менять состояние
  inputSchema: z.string().min(2),             // валидация
  formatter: (raw) => raw.trim(),             // нормализация до валидации
  guard: (ctx) => boolean | windowId,         // доступ / редирект
  onDialogResult: (ctx, m, t, result) => {},  // возврат из поддиалога
  disableBackButton: true,
}
```

Конвейер ввода: `raw → formatter → inputSchema → onInput(value)`. Ошибка форматтера или схемы показывается пользователю и **не сбрасывает** диалог. Чтобы отдать своё сообщение из форматтера, брось `InputValidationError`.

`guard` — **чистый предикат**: без ответов на callback и мутаций. Он вызывается на двух гейтах — перед обработкой ввода/экшена и перед рендером.

`onEnter` вызывается при каждом входе в окно (`goTo`, `goBack`, `startDialog`),
но не при перерисовке через `show`. В отличие от `guard`, ему разрешено менять
состояние — например, инициализировать поля из `startData`. Навигацию из него
делать не следует: для редиректов есть `guard`.

Начальное состояние диалога задаётся в `defineDialog`:
```ts
initialData: () => ({ answers: {} }) // фабрика вызывается на каждый запуск
initialData: { answers: {} } // объект клонируется на каждый запуск
```
## Медиа

```ts
render: () => ({ kind: 'photo', photo: fileIdOrUrl, caption: 'Подпись', keyboard })
```

Поддержаны `photo`, `document`, `video`, `animation`. Переходы:

- текст → текст: `editMessageText`
- медиа → медиа: `editMessageMedia`
- текст ↔ медиа: удаление старого сообщения и отправка нового

`caption` ограничен 1024 символами (о превышении пишется предупреждение в лог).

## i18n и экранирование
При первом контакте язык определяется из `ctx.from.language_code` (`en-US` → `en`),
если для него есть словарь; иначе используется `defaultLang`. Явный выбор пользователя
кнопкой `coreCallbacks.lang(...)` всегда имеет приоритет. Отключается опцией
`negotiateLanguage: false`.
Не задавай `lang` в `initial` — иначе автоопределение не сработает.
Язык проставит ядро: из `language_code`, затем кнопкой пользователя, иначе `defaultLang`.

```ts
new DialogManager({
  translations: { ru: { greeting: 'Привет, {name}!' }, en: { greeting: 'Hi, {name}!' } },
  defaultLang: 'ru',
});
```

`t('greeting', { name })` **сам экранирует** подставляемые значения под текущий `parseMode` (по умолчанию HTML). Разметку в шаблонах пиши HTML: `<b>`, `<i>`, `<code>`.

Если собираешь текст вручную — экранируй сам: `escapeHtml(userInput)`.

Встроенные подписи ядра (`btn_back`, `error_fallback` и др.) уже переведены на ru/en и перекрываются твоим словарём. Смена языка — кнопкой с `coreCallbacks.lang('en')`.

## Встроенные callback'и

```ts
coreCallbacks.back          // назад по истории
coreCallbacks.root          // в rootDialogId
coreCallbacks.lang('en')    // сменить язык
```

Namespace `__dm:` зарезервирован: свои экшены с таким префиксом registration отклонит. Кнопка «Назад» добавляется автоматически, если история непуста и не стоит `disableBackButton`. `callback_data` валидируется на лимит Telegram (1–64 байта UTF-8) и при регистрации, и при рендере.

## Опции менеджера

| Опция | По умолчанию | Назначение |
|---|---|---|
| `logger` | no-op | `{debug,info,warn,error}(message, meta?)` |
| `translations` / `defaultLang` | core ru/en / `'ru'` | словари и запасной язык |
| `rootDialogId` | — | куда ведёт `coreCallbacks.root` |
| `parseMode` | `'HTML'` | `'HTML' \| 'MarkdownV2'` |
| `maxNavigationDepth` | 10 | защита от циклов guard-редиректов |
| `maxDialogDepth` | 8 | предел вложенности диалогов |
| `maxHistory` | 50 | глубина стека окон |
| `onError` | ответ `error_fallback` | обработчик ошибок диалога |

## Testing your dialogs

Диалоги тестируются без сети и без Telegram: все вызовы API перехватываются.

```ts
import { describe, expect, it } from 'vitest';
import { createDialogTest } from '@bionicsv/grammy-dialogs/testing';
import { myDialog } from './my-dialog.js';

it('приводит к экрану приветствия', async () => {
  const t = await createDialogTest({ dialogs: [myDialog], rootDialogId: 'main' });

  await t.sendText('/start');
  expect(t.frame()?.window).toBe('greet');
  expect(t.lastText()).toContain('Привет');

  await t.click('to_name');
  await t.sendText('Анна');
  expect(t.data().name).toBe('Анна');
});
```

Доступно: `calls` / `methods()` / `lastPayload()` / `lastText()` / `lastKeyboard()`,
`session()` / `frame()` / `stack()` / `data()`, `logs`, `reset()`,
`failNextEditNotModified()` и `failNextEdit()` для проверки путей ошибок,
`languageCode` для проверки автоопределения языка, `setup` для своей проводки команд.

## Требования

Сессия должна инициализироваться как `{ stack: [] }`. При конкурентной обработке апдейтов (runner, вебхуки) ставь `sequentialize` **до** session с тем же ключом.

## Development

Репозиторий — npm workspaces: корень это библиотека, `examples/quiz` — отдельный
пакет-потребитель, который линкуется на локальную библиотеку.

```bash
npm install
npm run build        # обязателен: пример резолвит пакет через exports → dist
npm run test:all
```

`examples/bot` входит в корневой проект, `examples/quiz` исключён из корневого
`tsconfig.json` — у него свои зависимости и свой typecheck. Не убирай это
исключение: иначе пример компилируется дважды и получает чужие версии типов.

## Лицензия

ISC