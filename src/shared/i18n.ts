/**
 * The app speaks English and Russian.
 *
 * One flat dictionary keyed by a dotted string, with `en` as the type: a key
 * missing from `ru` is a compile error, not a blank label at runtime. Flag
 * labels and help text live in the flag registry instead (they are per-flag
 * data, not chrome), but they use the same `Localized` shape.
 */

export type Locale = 'en' | 'ru'
export const LOCALES: Locale[] = ['en', 'ru']

/** A string that exists in both languages — the shape flag help also uses. */
export interface Localized {
  en: string
  ru: string
}

export const en = {
  'app.name': 'Monet Local',
  'app.tagline': 'Local model server for Code Monet',

  'nav.server': 'Server',
  'nav.models': 'Models',
  'nav.runtimes': 'Runtimes',
  'nav.benchmark': 'Benchmark',
  'nav.integrations': 'Integrations',
  'nav.settings': 'Settings',

  'server.title': 'Server',
  'server.blurb':
    'Start llama.cpp, load models, watch what they actually cost in memory.',
  'models.title': 'Models',
  'models.blurb':
    'Your GGUF folders, what each file is, and whether it fits this machine.',
  'runtimes.title': 'Runtimes',
  'runtimes.blurb':
    'llama.cpp builds — Vulkan, CUDA, ROCm, CPU, or a folder of your own.',
  'benchmark.title': 'Benchmark',
  'benchmark.blurb': 'Run two profiles against each other and keep the numbers.',
  'integrations.title': 'Integrations',
  'integrations.blurb':
    'Connect Code Monet, Claude Code, or anything that speaks OpenAI or Anthropic.',
  'settings.title': 'Settings',
  'settings.blurb': 'Model folders, appearance, language, ports.',

  'settings.appearance': 'Appearance',
  'settings.theme': 'Theme',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.theme.system': 'System',
  'settings.language': 'Language',

  'common.soon': 'Coming in a later milestone.',
  'window.minimize': 'Minimize',
  'window.maximize': 'Maximize',
  'window.restore': 'Restore',
  'window.close': 'Close',
} as const

export type StringKey = keyof typeof en

export const ru: Record<StringKey, string> = {
  'app.name': 'Monet Local',
  'app.tagline': 'Локальный сервер моделей для Code Monet',

  'nav.server': 'Сервер',
  'nav.models': 'Модели',
  'nav.runtimes': 'Рантаймы',
  'nav.benchmark': 'Бенчмарк',
  'nav.integrations': 'Интеграции',
  'nav.settings': 'Настройки',

  'server.title': 'Сервер',
  'server.blurb':
    'Запуск llama.cpp, загрузка моделей и честная картина расхода памяти.',
  'models.title': 'Модели',
  'models.blurb':
    'Ваши папки с GGUF: что за файл, и влезет ли он в эту машину.',
  'runtimes.title': 'Рантаймы',
  'runtimes.blurb':
    'Сборки llama.cpp — Vulkan, CUDA, ROCm, CPU или своя папка.',
  'benchmark.title': 'Бенчмарк',
  'benchmark.blurb': 'Сравнение двух профилей с сохранением результатов.',
  'integrations.title': 'Интеграции',
  'integrations.blurb':
    'Подключение Code Monet, Claude Code и всего, что понимает OpenAI или Anthropic.',
  'settings.title': 'Настройки',
  'settings.blurb': 'Папки моделей, оформление, язык, порты.',

  'settings.appearance': 'Оформление',
  'settings.theme': 'Тема',
  'settings.theme.light': 'Светлая',
  'settings.theme.dark': 'Тёмная',
  'settings.theme.system': 'Системная',
  'settings.language': 'Язык',

  'common.soon': 'Появится в одной из следующих вех.',
  'window.minimize': 'Свернуть',
  'window.maximize': 'Развернуть',
  'window.restore': 'Восстановить',
  'window.close': 'Закрыть',
}

const dictionaries: Record<Locale, Record<StringKey, string>> = { en, ru }

export function translate(locale: Locale, key: StringKey): string {
  return dictionaries[locale][key]
}

/** Pick the language for a fresh install from the OS locale. */
export function localeFromSystem(tag: string | undefined): Locale {
  return tag?.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}
