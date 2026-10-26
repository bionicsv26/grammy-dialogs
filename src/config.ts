import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BOT_TOKEN: z.string().min(1, 'Токен Telegram обязателен'),
  HTTPS_PROXY: z.url('HTTPS_PROXY должен быть валидным URL').default('http://127.0.0.1:3067'),
  REDIS_URL: z.url().default('redis://127.0.0.1:6379'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Ошибка валидации переменных окружения (.env):');
  console.error(JSON.stringify(parsedEnv.error.format(), null, 2));
  process.exit(1);
}

export const config = parsedEnv.data;
export type Config = z.infer<typeof envSchema>;