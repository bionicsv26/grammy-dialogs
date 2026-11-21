import { describe, expect, it } from 'vitest';
import { coreCallbacks, coreTranslations } from '../src/dialog-manager.js';
import { createHarness } from './harness.js';

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
  it('register: дубликат id, reserved namespace и >64 байт отклоняются', async () => {
    const h = await createHarness();
    const w = (id: any, actions?: any) => ({ id, render: () => ({ text: 'x' }), actions });

    expect(() => h.manager.register(w('root'))).toThrow(/already registered/);
    expect(() => h.manager.register(w('dup1', { '__dm:x': () => { } }))).toThrow(/reserved namespace/);
    expect(() => h.manager.register(w('dup2', { ['x'.repeat(65)]: () => { } }))).toThrow(/64 bytes/);
  });
});