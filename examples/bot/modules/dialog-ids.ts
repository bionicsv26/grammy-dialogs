/** Идентификаторы диалогов: опечатка ловится обращением к свойству. */
export const D = {
  core: 'core',
  questionnaire: 'questionnaire',
  branching: 'branching',
  admin: 'admin',
} as const;

/** Результаты поддиалогов, которые понимает родитель. */
export const R = {
  completed: 'completed',
} as const;