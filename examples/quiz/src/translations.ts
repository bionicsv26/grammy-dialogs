export const quizTranslations = {
  ru: {
    welcome_text:
      '<b>Квиз «Три вопроса»</b>\n\n' +
      'Отвечай на вопросы с картинками, в конце увидишь результат. ' +
      'Можно будет изменить любой ответ.\n\nНажми «Начать».',
    btn_start: 'Начать',
    q1_text: 'Какое из этих животных — млекопитающее?',
    q2_text: 'Столица Австралии?',
    q3_text: 'Какой океан самый большой?',
    summary_title: '<b>Твои ответы</b>',
    summary_empty: 'Пока нет ответов.',
    btn_edit: 'Изменить',
    btn_submit: 'Завершить квиз',
    result_title: '<b>Результат</b>',
    result_score: 'Правильных: {correct} из {total}',
    btn_restart: 'Начать заново',
    btn_to_menu: 'В меню',
    confirm_text: 'Точно начать квиз заново? Текущие ответы пропадут.',
    btn_confirm_restart: 'Да, начать заново',
    btn_cancel: 'Отмена',
    // core-переводы можно не задавать — возьмутся из ядра
  },
  en: {
    welcome_text:
      '<b>Three-question quiz</b>\n\n' +
      'Answer questions with pictures, see the result at the end. ' +
      'You can change any answer later.\n\nPress Start.',
    btn_start: 'Start',
    q1_text: 'Which of these animals is a mammal?',
    q2_text: 'Capital of Australia?',
    q3_text: 'Which ocean is the largest?',
    summary_title: '<b>Your answers</b>',
    summary_empty: 'No answers yet.',
    btn_edit: 'Edit',
    btn_submit: 'Finish quiz',
    result_title: '<b>Result</b>',
    result_score: 'Correct: {correct} of {total}',
    btn_restart: 'Restart',
    btn_to_menu: 'Back to menu',
    confirm_text: 'Restart the quiz? Your answers will be lost.',
    btn_confirm_restart: 'Yes, restart',
    btn_cancel: 'Cancel',
  },
} as const;

export type QuizKeys = keyof typeof quizTranslations.ru;