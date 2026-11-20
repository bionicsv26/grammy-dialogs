export type TextLoggingPolicy = 'off' | 'preview' | 'full';

const PREVIEW_LENGTH = 12;

export interface TextLogInfo {
  length: number;
  preview?: string;
  text?: string;
}

/**
 * Описывает пользовательский текст для лога согласно политике приватности.
 * 'off' — только длина; 'preview' — первые символы (всё ещё PII!);
 * 'full' — текст целиком (осознанный opt-in для отладки).
 */
export function describeText(
  text: string | undefined,
  policy: TextLoggingPolicy
): TextLogInfo | undefined {
  if (text === undefined) return undefined;

  const info: TextLogInfo = { length: text.length };

  if (policy === 'preview') {
    info.preview =
      text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
  } else if (policy === 'full') {
    info.text = text;
  }

  return info;
}