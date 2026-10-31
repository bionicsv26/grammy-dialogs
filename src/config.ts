import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BOT_TOKEN: z.string().min(1, 'Токен Telegram обязателен'),
  HTTPS_PROXY: z.url('HTTPS_PROXY должен быть валидным URL').default('http://127.0.0.1:3067'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().min(1, 'Пароль Redis обязателен'),
  ADMIN_CHAT_ID: z.coerce.number().default(0),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Ошибка валидации переменных окружения (.env):');
  console.error(JSON.stringify(parsedEnv.error.issues, null, 2));
  process.exit(1);
}

export const config = parsedEnv.data;
export type Config = z.infer<typeof envSchema>;