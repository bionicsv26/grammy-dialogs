import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/** Пустая строка в .env означает «не задано», а не валидное значение. */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  BOT_TOKEN: z
    .string()
    .trim()
    .min(1, 'BOT_TOKEN обязателен')
    .regex(/^\d+:[A-Za-z0-9_-]+$/, 'BOT_TOKEN должен иметь вид 123456:ABC-DEF...'),

  // Без дефолта: личный адрес прокси не должен быть зашит в код.
  HTTPS_PROXY: z.preprocess(
    emptyToUndefined,
    z
      .url('HTTPS_PROXY должен быть валидным URL')
      .refine(
        (v) => /^https?:\/\//i.test(v),
        'HTTPS_PROXY должен начинаться с http:// или https://'
      )
      .optional()
  ),

  REDIS_HOST: z.preprocess(emptyToUndefined, z.string().min(1).default('localhost')),
  REDIS_PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(65535).default(6379)
  ),
  // Локальный Redis часто без пароля — не заставляем его выдумывать.
  REDIS_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  REDIS_KEY_PREFIX: z.preprocess(emptyToUndefined, z.string().min(1).default('tgbot:')),

  // 0 = уведомления выключены; отрицательные ID (супергруппы) допустимы.
  ADMIN_CHAT_ID: z.preprocess(emptyToUndefined, z.coerce.number().int().default(0)),

  ADMIN_USER_IDS: z
    .string()
    .default('')
    .transform((val) => val.trim())
    .refine((val) => val === '' || /^\d+(\s*,\s*\d+)*$/.test(val), {
      message: 'ADMIN_USER_IDS: пустая строка или список целых чисел через запятую (123,456)',
    })
    .transform((val) => (val === '' ? [] : val.split(',').map((part) => Number(part.trim()))))
    .refine((ids) => ids.every((id) => Number.isSafeInteger(id) && id > 0), {
      message: 'ADMIN_USER_IDS: каждый ID должен быть положительным целым числом',
    }),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Ошибка валидации переменных окружения (.env):');
  for (const issue of parsedEnv.error.issues) {
    const path = issue.path.join('.') || '(root)';
    console.error(`  • ${path}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsedEnv.data;
export type Config = z.infer<typeof envSchema>;