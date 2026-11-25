import { describe, expect, it } from 'vitest';
import { InlineKeyboard } from 'grammy';
import { defineDialog } from '../src/core/index.js';
import { createDialogTest } from '../src/core/testing.js';

interface S { name?: string }

const dialog = defineDialog<S, 'home' | 'pic', string>({
  id: 'main',
  windows: [
    {
      id: 'home',
      render: () => ({
        text: 'Home',
        keyboard: new InlineKeyboard().text('Go', 'go'),
      }),
      actions: {
        go: (ctx, m) => m.goTo(ctx, 'pic'),
        refresh: (ctx, m) => m.goTo(ctx, 'home'),
      },
    },
    {
      id: 'pic',
      render: () => ({ kind: 'photo' as const, photo: 'file-id', caption: 'Pic' }),
    },
  ],
});

describe('testing API', () => {
  it('базовый сценарий без сети', async () => {
    const t = await createDialogTest<S>({ dialogs: [dialog], rootDialogId: 'main' });
    await t.sendText('/start');

    expect(t.frame()?.window).toBe('home');
    expect(t.lastText()).toBe('Home');
    expect(t.methods()).toContain('sendMessage');
  });

  it('lastKeyboard отдаёт ряды кнопок', async () => {
    const t = await createDialogTest<S>({ dialogs: [dialog], rootDialogId: 'main' });
    await t.sendText('/start');

    const flat = (t.lastKeyboard() ?? []).flat();
    expect(flat.some((b: any) => b.callback_data === 'go')).toBe(true);
  });

  it('lastText берёт caption у медиа', async () => {
    const t = await createDialogTest<S>({ dialogs: [dialog], rootDialogId: 'main' });
    await t.sendText('/start');
    await t.click('go');

    expect(t.lastText()).toBe('Pic');
    expect(t.session()?.messageKind).toBe('photo');
  });

  it('failNextEdit: обычная ошибка редактирования приводит к отправке нового', async () => {
    const t = await createDialogTest<S>({ dialogs: [dialog], rootDialogId: 'main' });
    await t.sendText('/start');
    t.reset();

    t.failNextEdit();
    await t.click('refresh');

    expect(t.methods()).toContain('editMessageText');
    expect(t.methods()).toContain('sendMessage');
  });

  it('setup позволяет задать свою проводку команд', async () => {
    const t = await createDialogTest<S>({
      dialogs: [dialog],
      setup: (bot, manager) => {
        bot.command('go', (ctx) => manager.restart(ctx, 'main'));
      },
    });
    await t.sendText('/go');

    expect(t.frame()?.window).toBe('home');
  });
});