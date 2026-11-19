export const translations = {
  ru: {
    // Системные и общие кнопки
    btn_back: '⬅️ Назад',
    btn_to_main_menu: '🏠 В главное меню',
    btn_cancel: '🔙 Отмена',
    btn_save_changes: '💾 Сохранить изменения',
    btn_confirm: '➡️ Подтвердить',
    btn_fill_again: '🔄 Заполнить заново',
    btn_restart: '🔄 Начать заново',
    btn_finish: '✅ Завершить',
    language_changed: 'Язык успешно изменен!',
    action_not_available: 'Действие недоступно',
    invalid_format: 'Неверный формат данных',
    error_fallback: '⚠️ Что-то пошло не так. Попробуйте позже или введите /start.',

    // Главное меню
    main_menu_text: '*Добро пожаловать!*\n\nЭто демонстрация мини-библиотеки диалогов на TypeScript и grammY.',
    btn_start_form: '▶️ Начать анкету',
    btn_select_branch: '🔀 Выбор направления',
    btn_settings_lang: '🌐 Выбрать язык / Language',
    btn_admin_panel: '🔐 Админ-панель',

    // Настройки языка
    settings_lang_title: '🌐 *Настройки языка / Language Settings*\n\nВыберите удобный язык интерфейса:',

    // Окно 1: Имя
    ask_name_text: '*Шаг 1: Введите ваше имя*\n\n_Имя должно содержать от 2 до 50 символов._',

    // Окно 2: Технологии
    ask_interests_text: '*Шаг 2: Выберите интересные вам технологии*\n\n_Отметьте от 1 до 4 вариантов._',
    btn_back_to_preview: '🔙 Назад к предпросмотру',
    invalid_selection: 'Выберите от 1 до 4 технологий',
    tech_ts: 'TypeScript',
    tech_node: 'Node.js',
    tech_redis: 'Redis',
    tech_vue: 'Vue 3',

    // Окно 3: Предпросмотр (Summary)
    summary_text: '📋 *Предпросмотр анкеты*\n\nПроверьте данные:\n\n👤 *Имя:* {name}\n💻 *Технологии:* {interests}',
    btn_edit_name: '✏️ Изменить имя',
    btn_edit_interests: '✏️ Изменить технологии',
    btn_confirm_all: '✅ Всё верно, подтвердить',
    anonymous: 'Аноним',
    none_selected: 'Не выбрано',
    hidden: 'скрыт',

    // Окно 4: Завершение и перезапуск
    completed_text: '🎉 *Спасибо! Ваша анкета успешно сохранена.*',
    confirm_restart_text: '⚠️ *У вас есть незавершенная анкета!*\n\nЕсли вы начнете заново, все введенные данные будут потеряны. Вы уверены?',
    btn_confirm_restart: '⚠️ Да, сбросить и начать заново',
    btn_continue_filling: '🔙 Продолжить заполнение',

    // Админка
    admin_panel_text: '🔐 *Панель администратора*\n\nДобро пожаловать, босс! Здесь отображается управление системой.',
    no_admin_access: '⚠️ У вас нет доступа к этому разделу',
    admin_stats_title: '📊 *Статистика системы*\n\n👥 Всего пользователей: *1*\n📝 Заполнено анкет: *1*\n⚡️ Статус Redis: *Активен*',
    admin_broadcast_title: '📢 *Рассылка сообщений*\n\nОтправьте текст сообщения, которое хотите разослать всем пользователям:',
    btn_stats: '📈 Статистика',
    btn_broadcast: '📢 Сделать рассылку',
    btn_cancel_broadcast: '❌ Отменить рассылку',
    broadcast_success: '✅ Рассылка успешно завершена! Отправлено: {count}',
    broadcast_cancelled: '🚫 Рассылка отменена.',

    // Модуль веток (Branching)
    select_branch_text: '📂 *Меню выбора ветки*\n\nВыберите направление, по которому хотите продолжить работу:',
    branch_tech_btn: '🚀 Вариант 1: Технический стек',
    branch_design_btn: '🎨 Вариант 2: Дизайн и UI/UX',
    branch_business_btn: '📊 Вариант 3: Аналитика и Бизнес',
    tech_step_text: '⚙️ *Техническая ветка*\n\nЗдесь настраивается архитектура, бэкенд на NestJS, базы данных и Docker.',
    design_step_text: '🎨 *Дизайн-ветка*\n\nЗдесь прорабатываются макеты в Figma, цвета, шрифты и пользовательский опыт.',
    business_step_text: '📊 *Бизнес-ветка*\n\nЗдесь анализируются метрики, юнит-экономика, гипотезы и монетизация.',
  },

  en: {
    // System & General Buttons
    btn_back: '⬅️ Back',
    btn_to_main_menu: '🏠 Main Menu',
    btn_cancel: '🔙 Cancel',
    btn_save_changes: '💾 Save changes',
    btn_confirm: '➡️ Confirm',
    btn_fill_again: '🔄 Fill again',
    btn_restart: '🔄 Start over',
    btn_finish: '✅ Finish',
    language_changed: 'Language successfully changed!',
    action_not_available: 'Action not available',
    invalid_format: 'Invalid data format',
    error_fallback: '⚠️ Something went wrong. Try again later or send /start.',

    // Main Menu
    main_menu_text: '*Welcome!*\n\nThis is a demonstration of the dialog mini-library built with TypeScript & grammY.',
    btn_start_form: '▶️ Start Questionnaire',
    btn_select_branch: '🔀 Select Branch',
    btn_settings_lang: '🌐 Language / Язык',
    btn_admin_panel: '🔐 Admin Panel',

    // Language Settings
    settings_lang_title: '🌐 *Language Settings*\n\nPlease select your preferred language:',

    // Step 1: Name
    ask_name_text: '*Step 1: Enter your name*\n\n_Name must be between 2 and 50 characters._',

    // Step 2: Technologies
    ask_interests_text: '*Step 2: Select your tech stack*\n\n_Choose between 1 and 4 options._',
    btn_back_to_preview: '🔙 Back to preview',
    invalid_selection: 'Select between 1 and 4 technologies',
    tech_ts: 'TypeScript',
    tech_node: 'Node.js',
    tech_redis: 'Redis',
    tech_vue: 'Vue 3',

    // Step 3: Summary
    summary_text: '📋 *Questionnaire Preview*\n\nPlease review your information:\n\n👤 *Name:* {name}\n💻 *Tech Stack:* {interests}',
    btn_edit_name: '✏️ Edit Name',
    btn_edit_interests: '✏️ Edit Technologies',
    btn_confirm_all: '✅ Looks good, confirm',
    anonymous: 'Anonymous',
    none_selected: 'None selected',
    hidden: 'hidden',

    // Step 4: Completion & Restart
    completed_text: '🎉 *Thank you! Your questionnaire has been saved.*',
    confirm_restart_text: '⚠️ *You have an unfinished questionnaire!*\n\nIf you restart, all entered data will be lost. Are you sure?',
    btn_confirm_restart: '⚠️ Yes, reset and start over',
    btn_continue_filling: '🔙 Continue filling',

    // Admin Panel
    admin_panel_text: '🔐 *Admin Panel*\n\nWelcome back, boss! System controls are listed here.',
    no_admin_access: '⚠️ You do not have access to this section',
    admin_stats_title: '📊 *System Statistics*\n\n👥 Total Users: *1*\n📝 Completed Questionnaires: *1*\n⚡️ Redis Status: *Active*',
    admin_broadcast_title: '📢 *Broadcast Messages*\n\nSend the text message you want to broadcast to all users:',
    btn_stats: '📈 Statistics',
    btn_broadcast: '📢 Create Broadcast',
    btn_cancel_broadcast: '❌ Cancel Broadcast',
    broadcast_success: '✅ Broadcast completed successfully! Sent to: {count}',
    broadcast_cancelled: '🚫 Broadcast cancelled.',

    // Branching Module
    select_branch_text: '📂 *Branch Selection Menu*\n\nChoose the domain you want to proceed with:',
    branch_tech_btn: '🚀 Option 1: Tech Stack',
    branch_design_btn: '🎨 Option 2: Design & UI/UX',
    branch_business_btn: '📊 Option 3: Analytics & Business',
    tech_step_text: '⚙️ *Tech Branch*\n\nArchitecture, NestJS backend, databases, and Docker are configured here.',
    design_step_text: '🎨 *Design Branch*\n\nFigma layouts, colors, typography, and UX design are developed here.',
    business_step_text: '📊 *Business Branch*\n\nMetrics, unit economics, hypotheses, and monetization strategy are analyzed here.',
  },
} as const;

export type AppTranslationKeys = keyof typeof translations.ru;