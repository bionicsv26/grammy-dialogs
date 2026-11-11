/**
 * 🛡️ Экранирует специальные символы Markdown в динамическом тексте для безопасной отправки в Telegram.
 */
export function escapeMarkdown(text: string): string {
	return text.replace(/[_*`\[\]]/g, '\\$&');
}