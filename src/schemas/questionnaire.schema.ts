import { z } from 'zod';

export const AVAILABLE_INTERESTS = [
  { id: 'ts', label: 'TypeScript' },
  { id: 'node', label: 'Node.js' },
  { id: 'redis', label: 'Redis' },
  { id: 'vue', label: 'Vue 3' },
] as const;

const interestIds = AVAILABLE_INTERESTS.map((item) => item.id) as [
  (typeof AVAILABLE_INTERESTS)[number]['id'],
  ...(typeof AVAILABLE_INTERESTS)[number]['id'][]
];

export const nameSchema = z
  .string()
  .min(2, 'Имя слишком короткое (минимум 2 символа)')
  .max(50, 'Имя слишком длинное (максимум 50 символов)');

export const interestsSchema = z
  .array(z.enum(interestIds))
  .min(1, 'Выберите хотя бы одну технологию')
  .max(4, 'Можно выбрать максимум 4 технологии');