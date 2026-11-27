import { describe, expect, it } from 'vitest';
import { createDialogTest } from '@bionicsv/grammy-dialogs/testing';
import { createQuizDialog } from '../src/dialogs/quiz.dialog.js';
import { quizTranslations } from '../src/translations.js';

async function setup() {
  return createDialogTest({
    dialogs: [createQuizDialog()],
    rootDialogId: 'quiz',
    managerOptions: {
      translations: quizTranslations,
      defaultLang: 'ru',
    },
  });
}

describe('quiz example', () => {
  it('стартует на welcome', async () => {
    const t = await setup();
    await t.sendText('/start');

    expect(t.frame()?.window).toBe('welcome');
    expect(t.lastText()).toContain('Квиз');
  });

  it('проходит все три вопроса до summary', async () => {
    const t = await setup();
    await t.sendText('/start');

    await t.click('start');       // welcome -> question(q1)
    expect(t.frame()?.dialog).toBe('quiz');
    expect(t.session()?.messageKind).toBe('photo');

    await t.click('answer_a');    // done -> welcome (next q2)
    await t.click('answer_b');    // done -> welcome (next q3)
    await t.click('answer_c');    // done -> welcome -> summary

    expect(t.frame()?.window).toBe('summary');
    expect(t.data().answers).toEqual({ q1: 'a', q2: 'b', q3: 'c' });
  });

  it('summary → изменить ответ → вложенный question → summary', async () => {
    const t = await setup();
    await t.sendText('/start');
    await t.click('start');
    await t.click('answer_a');
    await t.click('answer_b');
    await t.click('answer_c');

    expect(t.frame()?.window).toBe('summary');
    const stackBefore = t.stack().length;

    await t.click('edit_1');      // startDialog question (step=1)
    expect(t.stack().length).toBe(stackBefore + 1);
    expect(t.frame()?.window).toBe('question');

    await t.click('answer_a');    // done -> back to summary
    expect(t.stack().length).toBe(stackBefore);
    expect(t.frame()?.window).toBe('summary');
    expect(t.data().answers.q2).toBe('a');
  });

  it('result → restart → confirm → restart очищает состояние', async () => {
    const t = await setup();
    await t.sendText('/start');
    await t.click('start');
    await t.click('answer_a');
    await t.click('answer_b');
    await t.click('answer_c');
    await t.click('submit');

    expect(t.frame()?.window).toBe('result');
    expect(t.lastText()).toContain('3 из 3');

    await t.click('restart');
    expect(t.frame()?.window).toBe('confirm');

    await t.click('do_restart');
    expect(t.frame()?.window).toBe('welcome');
    expect(t.data().answers).toEqual({});
  });

  it('confirm → cancel возвращает в result', async () => {
    const t = await setup();
    await t.sendText('/start');
    await t.click('start');
    await t.click('answer_a');
    await t.click('answer_b');
    await t.click('answer_c');
    await t.click('submit');
    await t.click('restart');
    await t.click('cancel');

    expect(t.frame()?.window).toBe('result');
  });

  it('вопрос — фото, summary — текст: медиа-переходы корректны', async () => {
    const t = await setup();
    await t.sendText('/start');
    await t.click('start');

    expect(t.session()?.messageKind).toBe('photo');

    await t.click('answer_a');
    await t.click('answer_b');
    await t.click('answer_c');

    expect(t.session()?.messageKind).toBe('text');
    expect(t.methods()).toContain('deleteMessage'); // photo -> text = замена
  });
});