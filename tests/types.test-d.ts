import { z } from 'zod';
import {
  defineWindow, defineWindows,
  type DialogContext, type DialogManager, type TranslationFunction,
} from '../src/dialog-manager.js';
import type { TestId, TestKeys, TestState } from './harness.js';

declare const manager: DialogManager<TestState, TestId, TestKeys>;
declare const ctx: DialogContext<TestState>;

// 1. Опечатка в цели навигации не компилируется
// @ts-expect-error
manager.goTo(ctx, 'formm');

// 2. Опечатка в id окна не компилируется
defineWindows<TestState, TestId, TestKeys>([
  {
    // @ts-expect-error
    id: 'rooot',
    render: () => ({ text: 'x' }),
  },
]);

// 3. Тип value выводится из inputSchema
const win = defineWindow<TestState, TestId, TestKeys>();
win({
  id: 'form',
  inputSchema: z.string(),
  render: () => ({ text: 'x' }),
  onInput: (_ctx, _m, _t, value) => {
    const ok: string = value;
    // @ts-expect-error
    const bad: number = value;
    void ok; void bad;
  },
});

// 4. t() принимает ключи приложения и core, но не произвольные строки
declare const t: TranslationFunction<TestKeys>;
t('root_text');
t('btn_back');
// @ts-expect-error
t('nope_key');