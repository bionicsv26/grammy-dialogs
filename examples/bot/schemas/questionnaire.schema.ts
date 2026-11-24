import { validators } from './common.validators.js';

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

export const nameSchema = validators.name(2, 50);

export const createInterestsSchema = (min = 1, max = 4) =>
  validators.selection(interestIds, min, max);