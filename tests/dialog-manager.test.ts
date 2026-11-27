import { describe, expect, it } from 'vitest';
import { coreCallbacks, coreTranslations, defineDialog } from '../src/core/dialog-manager.js';
import { createHarness, type TestKeys, type TestState } from './harness.js';

describe('DialogManager', () => {
  // ─── Навигация и рендер ───────────────────────────────────────────────────
  it('start: рендерит корень и бутстрапит сессию', async () => {
    const h = await createHarness();
    await h.sendText('/start');

    expect(h.session()?.currentWindow).toBe('root');
    expect(h.session()?.history).toEqual([]);
    expect(h.session()?.messageId).toBeDefined();
    expect(h.methods().filter((m) => m === 'sendMessage')).toHaveLength(1);
  });

  it('start: снимает клавиатуру прошлого сообщения', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    const first = h.session()?.messageId;
    h.reset();

    await h.sendText('/start');

    const strip = h.calls.find((c) => c.method === 'editMessageReplyMarkup');
    expect(strip?.payload).toMatchObject({
      message_id: first,
      reply_markup: { inline_keyboard: [] },
    });
    expect(h.methods()).toContain('sendMessage');
    expect(h.session()?.messageId).not.toBe(first);
  });

  it('goTo: редактирует то же сообщение и пишет историю', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    h.reset();

    await h.click('next');

    expect(h.session()?.currentWindow).toBe('form');
    expect(h.session()?.history).toEqual(['root']);
    expect(h.methods()).toContain('editMessageText');
    expect(h.methods()).not.toContain('sendMessage');
  });

  it('goTo в то же окно перерисовывает, а не игнорируется', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    h.reset();

    await h.click('refresh');

    expect(h.session()?.currentWindow).toBe('root');
    expect(h.session()?.history).toEqual([]);
    expect(h.methods()).toContain('editMessageText');
  });

  it('back: авто-кнопка на окне без клавиатуры + возврат по __dm:back', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('next');

    const markup = h.lastPayload('editMessageText').reply_markup;
    const flat = markup.inline_keyboard.flat();
    expect(flat.some((b: any) => b.callback_data === coreCallbacks.back)).toBe(true);
    // core-дефолт перевода, которого нет в словаре приложения
    expect(flat.find((b: any) => b.callback_data === coreCallbacks.back).text)
      .toBe(coreTranslations.ru.btn_back);

    await h.click(coreCallbacks.back);
    expect(h.session()?.currentWindow).toBe('root');
    expect(h.session()?.history).toEqual([]);
  });

  it('maxHistory: старые записи вытесняются', async () => {
    const h = await createHarness(undefined, { maxHistory: 2 });
    await h.sendText('/start');
    await h.click('next');      // form,   ['root']
    await h.click('to_target'); // target, ['root','form']
    await h.click('to_form');   // form,   ['root','form','target'] → обрезка

    expect(h.session()?.history).toEqual(['form', 'target']);
  });

  it('not-modified: не отправляет дубль сообщения', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('next');
    const before = h.session()?.messageId;
    h.reset();

    h.failNextEditNotModified();
    await h.click('noop');

    expect(h.methods()).toContain('editMessageText');
    expect(h.methods()).not.toContain('sendMessage');
    expect(h.session()?.messageId).toBe(before);
  });

  // ─── Guard'ы ──────────────────────────────────────────────────────────────
  it('guard: редиректит на другое окно', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('to_guarded');

    expect(h.session()?.currentWindow).toBe('target');
  });

  it('guard-редирект не засоряет историю и не ломает «Назад»', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('to_guarded');

    expect(h.session()?.currentWindow).toBe('target');
    expect(h.session()?.history).toEqual(['root']); // 'guarded' в стек не попал

    await h.click(coreCallbacks.back);
    expect(h.session()?.currentWindow).toBe('root');
  });

  it('цикл guard-редиректов ограничен и уходит в onError, а не зависает', async () => {
    const errors: unknown[] = [];
    const h = await createHarness(undefined, {
      maxNavigationDepth: 3,
      onError: (error) => { errors.push(error); },
    });

    await h.sendText('/start');
    await h.click('to_cycle');

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/Navigation depth limit/i);
  });

  it('guard=false блокирует экшен: хендлер не выполняется', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('to_blocked'); // currentWindow станет 'blocked', рендера не будет

    expect(h.session()?.currentWindow).toBe('blocked');
    h.reset();

    await h.click('should_not_run');

    expect(h.session()?.data.name).toBeUndefined();
    expect(h.calls.filter((c) => c.method === 'answerCallbackQuery')).toHaveLength(1);
    expect(h.methods()).not.toContain('editMessageText');
  });

  // ─── Ввод ─────────────────────────────────────────────────────────────────
  it('input: невалидный ввод не переключает окно, валидный — типизирован и экранирован', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('next');

    await h.sendText('a');
    expect(h.session()?.currentWindow).toBe('form');
    expect(h.session()?.data.error).toBe('too short');

    await h.sendText('A<&>');
    expect(h.session()?.currentWindow).toBe('confirm');
    expect(h.session()?.data.name).toBe('A<&>');
    expect(h.lastPayload('editMessageText').text).toContain('A&lt;&amp;&gt;');
  });

  it('formatter: обычное исключение = ошибка валидации, а не сброс диалога', async () => {
    const errors: unknown[] = [];
    const h = await createHarness(undefined, { onError: (e) => { errors.push(e); } });
    await h.sendText('/start');
    await h.click('next');
    h.reset();

    await h.sendText('boom');

    expect(h.session()?.currentWindow).toBe('form');
    expect(h.session()?.data.error).toBe(coreTranslations.ru.invalid_format);
    expect(h.methods()).not.toContain('sendMessage');
    expect(errors).toHaveLength(0);
  });

  it('formatter: InputValidationError отдаёт своё сообщение', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('next');

    await h.sendText('bad');

    expect(h.session()?.currentWindow).toBe('form');
    expect(h.session()?.data.error).toBe('Своя ошибка');
  });

  it('ошибка ввода: живёт при перерисовке, очищается при уходе с окна', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('next');
    await h.sendText('a');

    await h.click('noop'); // перерисовка того же окна
    expect(h.lastPayload('editMessageText').text).toContain('ERR: too short');

    await h.click('to_target'); // уходим с окна
    expect(h.session()?.data.error).toBeUndefined();
  });

  // ─── i18n ─────────────────────────────────────────────────────────────────
  it('i18n: смена языка через __dm:lang:en перерисовывает окно', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    expect(h.lastPayload('sendMessage').text).toBe('Корень');

    await h.click(coreCallbacks.lang('en'));
    expect(h.session()?.lang).toBe('en');
    expect(h.lastPayload('editMessageText').text).toBe('Root');
  });

  // ─── Callback query ───────────────────────────────────────────────────────
  it('answer-once: явный ответ хендлера не дублируется из finally', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    h.reset();

    await h.click('alert');

    const answers = h.calls.filter((c) => c.method === 'answerCallbackQuery');
    expect(answers).toHaveLength(1);
    expect(answers[0]?.payload).toMatchObject({ text: 'ALERT', show_alert: true });
  });

  it('answer-once: обычный экшен отвечает ровно один раз', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    h.reset();

    await h.click('next');

    expect(h.calls.filter((c) => c.method === 'answerCallbackQuery')).toHaveLength(1);
  });

  // ─── Регистрация окон ─────────────────────────────────────────────────────
  it('registerDialog: дубликаты, reserved namespace, >64 байт и битый entry отклоняются', async () => {
    const h = await createHarness();
    const w = (id: any, actions?: any) => ({ id, render: () => ({ text: 'x' }), actions });
    const d = (id: string, entry: any, windows: any[]) => ({ id, entry, windows });

    expect(() => h.manager.registerDialog(d('main', 'root', [w('root')]) as any))
      .toThrow(/Dialog "main" is already registered/);

    expect(() => h.manager.registerDialog(d('dup', 'a', [w('a'), w('a')]) as any))
      .toThrow(/Window "a" is already registered/);

    expect(() => h.manager.registerDialog(d('ns', 'a', [w('a', { '__dm:x': () => { } })]) as any))
      .toThrow(/reserved namespace/);

    expect(() => h.manager.registerDialog(d('len', 'a', [w('a', { ['x'.repeat(65)]: () => { } })]) as any))
      .toThrow(/64 bytes/);

    expect(() => h.manager.registerDialog(d('entry', 'missing', [w('a')]) as any))
      .toThrow(/Entry window "missing"/);
  });

  // ─── Диалоги ──────────────────────────────────────────────────────────────
  it('startDialog: кладёт фрейм поверх, обнуляя историю и состояние', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('next');
    await h.sendText('Anna');
    expect(h.frame()?.data.name).toBe('Anna');

    await h.click(coreCallbacks.back); // confirm → form
    await h.click(coreCallbacks.back); // form → root
    await h.click('to_other');

    expect(h.frame()?.dialog).toBe('other');
    expect(h.frame()?.window).toBe('hello');
    expect(h.frame()?.history).toEqual([]);
    expect(h.frame()?.data.name).toBeUndefined();
  });

  it('состояние изолировано между диалогами', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('to_other');
    await h.click('set_name');

    expect(h.frame()?.data.name).toBe('OTHER');

    await h.click('back_to_main');
    expect(h.frame()?.dialog).toBe('main');
    expect(h.frame()?.data.name).toBeUndefined();
  });

  it('неизвестный диалог уходит в onError', async () => {
    const errors: unknown[] = [];
    const h = await createHarness(undefined, { onError: (e) => { errors.push(e); } });
    await h.sendText('/start');

    // root-кнопка ведёт в диалог, которого нет
    const bad = await createHarness(undefined, {
      rootDialogId: 'missing',
      onError: (e) => { errors.push(e); },
    });
    await bad.sendText('/start');
    await bad.click(coreCallbacks.root);

    expect(errors.length).toBeGreaterThan(0);
    expect(String(errors[0])).toMatch(/is not registered/);
  });

  it('вложенность: done возвращает родителя с его окном, историей и данными', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('next');
    await h.sendText('Anna');      // main/confirm, data.name = Anna
    await h.click('open_other');   // push other

    expect(h.stack()).toHaveLength(2);
    expect(h.frame()?.dialog).toBe('other');

    await h.click('set_name');
    expect(h.frame()?.data.name).toBe('OTHER');

    await h.click('back_to_main'); // done()

    expect(h.stack()).toHaveLength(1);
    expect(h.frame()?.window).toBe('confirm');
    expect(h.frame()?.data.name).toBe('Anna');
    expect(h.frame()?.history).toEqual(['root', 'form']);
  });

  it('done(result): вызывает onDialogResult родительского окна', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('to_other');
    await h.click('finish');

    expect(h.frame()?.dialog).toBe('main');
    expect(h.frame()?.window).toBe('target');
  });

  it('лимит глубины стека диалогов', async () => {
    const errors: unknown[] = [];
    const h = await createHarness(undefined, {
      maxDialogDepth: 2,
      onError: (e) => { errors.push(e); },
    });

    await h.sendText('/start'); // 1
    await h.click('to_other');  // 2
    await h.click('deeper');    // превышение

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/stack depth limit/i);
  });

  it('done без родителя уходит в корневой диалог', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('finish_root');

    expect(h.stack()).toHaveLength(1);
    expect(h.frame()?.dialog).toBe('main');
    expect(h.frame()?.window).toBe('root');
  });

  it('entry по умолчанию — первое окно', async () => {
    const d = defineDialog<TestState, 'a' | 'b', TestKeys>({
      id: 'noentry',
      windows: [
        { id: 'a', render: () => ({ text: 'A' }) },
        { id: 'b', render: () => ({ text: 'B' }) },
      ],
    });
    const h = await createHarness([d], { rootDialogId: 'noentry' });
    await h.sendText('/start');

    expect(h.frame()?.dialog).toBe('noentry');
    expect(h.frame()?.window).toBe('a');
  });

  it('диалог без окон отклоняется', async () => {
    const h = await createHarness();
    expect(() => h.manager.registerDialog({ id: 'empty', windows: [] } as any))
      .toThrow(/has no windows/);
  });

  it('ctx.frame указывает на активный фрейм', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('to_other');
    await h.click('record');

    expect(h.frame()?.data.name).toBe('other');
  });

  it('логгер инъектируется: события ядра попадают в переданный логгер', async () => {
    const h = await createHarness();
    await h.sendText('/start');

    expect(h.logs.some((l) => l.message.includes('Starting dialog'))).toBe(true);
  });

  it('лог валидации содержит длину ввода, а не сам текст', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('next');
    await h.sendText('secret-name');

    const rec = h.logs.find((l) => l.message.includes('input validation failed'));
    expect(rec?.meta?.inputLength).toBe('secret-name'.length);
    expect(rec?.meta).not.toHaveProperty('rawInput');
    expect(JSON.stringify(rec?.meta)).not.toContain('secret-name');
  });

  // ─── Медиа ────────────────────────────────────────────────────────────────
  it('text → photo: заменяет сообщение и запоминает тип', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    h.reset();

    await h.click('to_pic');

    expect(h.methods()).toContain('deleteMessage');
    expect(h.methods()).toContain('sendPhoto');
    expect(h.methods()).not.toContain('editMessageText');
    expect(h.session()?.messageKind).toBe('photo');
  });

  it('photo → photo: редактируется на месте через editMessageMedia', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('to_pic');
    const before = h.session()?.messageId;
    h.reset();

    await h.click('swap');

    expect(h.methods()).toContain('editMessageMedia');
    expect(h.methods()).not.toContain('sendPhoto');
    expect(h.methods()).not.toContain('deleteMessage');
    expect(h.session()?.messageId).toBe(before);
  });

  it('photo → text: снова замена с удалением', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('to_pic');
    h.reset();

    await h.click('to_root');

    expect(h.methods()).toContain('deleteMessage');
    expect(h.methods()).toContain('sendMessage');
    expect(h.session()?.messageKind).toBe('text');
  });

  it('not-modified на медиа не плодит дублей', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('to_pic');
    const before = h.session()?.messageId;
    h.reset();

    h.failNextEditNotModified();
    await h.click('noop');

    expect(h.methods()).toContain('editMessageMedia');
    expect(h.methods()).not.toContain('sendPhoto');
    expect(h.session()?.messageId).toBe(before);
  });

  // ───Negotiation языка ─────────────────────────────────────────────────────
  it('язык определяется из language_code при первом контакте', async () => {
    const h = await createHarness(undefined, { languageCode: 'en-US' });
    await h.sendText('/start');

    expect(h.session()?.lang).toBe('en');
    expect(h.lastPayload('sendMessage').text).toBe('Root');
  });

  it('неизвестный язык откатывается к defaultLang', async () => {
    const h = await createHarness(undefined, { languageCode: 'fr' });
    await h.sendText('/start');

    expect(h.session()?.lang).toBeUndefined();
    expect(h.lastPayload('sendMessage').text).toBe('Корень');
  });

  it('явный выбор языка важнее language_code', async () => {
    const h = await createHarness(undefined, { languageCode: 'en-US' });
    await h.sendText('/start');
    expect(h.session()?.lang).toBe('en');

    await h.click(coreCallbacks.lang('ru'));
    expect(h.session()?.lang).toBe('ru');
    expect(h.lastPayload('editMessageText').text).toBe('Корень');

    await h.click('next');
    expect(h.lastPayload('editMessageText').text).toBe('Форма');
  });

  it('negotiateLanguage: false отключает автоопределение', async () => {
    const h = await createHarness(undefined, {
      languageCode: 'en-US',
      negotiateLanguage: false,
    });
    await h.sendText('/start');

    expect(h.session()?.lang).toBeUndefined();
    expect(h.lastPayload('sendMessage').text).toBe('Корень');
  });

  // ─── Начальное состояние и вход в окно ────────────────────────────────────
  it('initialData: состояние инициализируется при старте', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('to_seeded');

    expect(h.frame()?.data.name).toBe('init');
    expect(h.frame()?.data.hits).toBe(1); // onEnter отработал
  });

  it('initialData: каждый запуск получает свою копию', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('to_seeded');

    h.frame()!.data.name = 'changed';
    await h.click('nest');

    expect(h.stack()).toHaveLength(3);
    expect(h.frame()?.data.name).toBe('init');
    expect(h.stack()[1]?.data.name).toBe('changed');
  });

  it('onEnter: не вызывается при перерисовке', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('to_seeded');
    expect(h.frame()?.data.hits).toBe(1);

    await h.click('again');
    expect(h.frame()?.data.hits).toBe(1);

    await h.click('to_other');
    await h.click('back');
    expect(h.frame()?.data.hits).toBe(2); // повторный вход — вызывается
  });

  it('onEnter: видит startData', async () => {
    const h = await createHarness();
    await h.sendText('/start');
    await h.click('to_seeded_data');

    expect(h.frame()?.data.name).toBe('fromStart');
  });
});