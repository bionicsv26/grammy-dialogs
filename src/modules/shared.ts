/**
 * Минимальный общий контракт ID для кросс-модульных переходов:
 * - questionnaire ссылается на 'select_branch' (владеет branching);
 * - branching ссылается на 'completed' (владеет questionnaire).
 *
 * Временное решение для шага 2.2. Владение окнами, зависимости модулей
 * и проверка дубликатов при регистрации будут формализованы в шаге 2.3.
 */
export type SharedWindowId = 'completed' | 'select_branch';