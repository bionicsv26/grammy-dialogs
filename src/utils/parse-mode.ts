export type ParseMode = 'HTML' | 'MarkdownV2';

/** Для текстового содержимого HTML достаточно &, <, >. */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** MarkdownV2 требует экранирования служебных символов обратным слэшем. */
export function escapeMarkdownV2(value: string): string {
    return value.replace(/([\\_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

export function escapeForMode(value: string, mode: ParseMode): string {
    return mode === 'HTML' ? escapeHtml(value) : escapeMarkdownV2(value);
}