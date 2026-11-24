import { GrammyError } from 'grammy';

/**
 * Telegram отвечает 400, если новый контент (текст + parse_mode + клавиатура)
 * полностью совпадает с текущим. Это не ошибка: сообщение уже актуально.
 */
export function isMessageNotModified(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    error.description.includes('message is not modified')
  );
}