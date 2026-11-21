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