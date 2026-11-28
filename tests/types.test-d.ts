import { z } from "zod";
import {
  defineDialog,
  defineWindow,
  type DialogContext,
  type DialogManager,
  type TranslationFunction,
} from "../src/core/dialog-manager.js";
import type { TestId, TestKeys, TestState } from "./harness.js";
import { describe, expect, expectTypeOf, it } from "vitest";

declare const manager: DialogManager<TestState, TestId, TestKeys>;
declare const ctx: DialogContext<TestState>;

// 1. Опечатка в цели навигации не компилируется
// @ts-expect-error
manager.goTo(ctx, "formm");

// 2. Опечатка в id окна внутри диалога не компилируется
defineDialog<TestState, TestId, TestKeys>({
  id: "typo",
  entry: "root",
  windows: [
    {
      // @ts-expect-error
      id: "rooot",
      render: () => ({ text: "x" }),
    },
  ],
});

// 3. entry обязан быть окном этого же диалога
defineDialog<TestState, TestId, TestKeys>({
  id: "bad-entry",
  // @ts-expect-error
  entry: "nope",
  windows: [{ id: "root", render: () => ({ text: "x" }) }],
});

// 4. Тип value выводится из inputSchema
const win = defineWindow<TestState, TestId, TestKeys>();
win({
  id: "form",
  inputSchema: z.string(),
  render: () => ({ text: "x" }),
  onInput: (_ctx, _m, _t, value) => {
    const ok: string = value;
    // @ts-expect-error
    const bad: number = value;
    void ok;
    void bad;
  },
});

// 5. ctx.data — состояние диалога, типизировано
declare const dctx: DialogContext<TestState>;
const name: string | undefined = dctx.data.name;
// @ts-expect-error
const wrong: number = dctx.data.name;
void name;
void wrong;

// 6. t() принимает ключи приложения и core, но не произвольные строки
declare const t: TranslationFunction<TestKeys>;
t("root_text");
t("btn_back");
// @ts-expect-error
t("nope_key");

describe("контракт диалога", () => {
  it("startData и result выводятся из контракта", () => {
    defineDialog<
      TestState,
      TestId,
      TestKeys,
      { start: { n: number }; result: { ok: boolean } }
    >({
      id: "typed",
      windows: [
        {
          id: "root",
          render: () => ({ text: "" }),
          onEnter: (_ctx, _m, _t, startData) => {
            expectTypeOf(startData).toEqualTypeOf<{ n: number }>();
            // @ts-expect-error в контракте нет такого поля
            startData.nope;
          },
          onDialogResult: (_ctx, _m, _t, result) => {
            expectTypeOf(result).toEqualTypeOf<{ ok: boolean }>();
            // @ts-expect-error
            result.nope;
          },
        },
      ],
    });
    expect(true).toBe(true);
  });

  it("без контракта значения остаются unknown", () => {
    defineDialog<TestState, TestId, TestKeys>({
      id: "untyped",
      windows: [
        {
          id: "root",
          render: () => ({ text: "" }),
          onEnter: (_ctx, _m, _t, startData) => {
            expectTypeOf(startData).toEqualTypeOf<unknown>();
          },
        },
      ],
    });
    expect(true).toBe(true);
  });
});
