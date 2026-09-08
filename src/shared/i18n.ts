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
  'common.add': 'Add',
  'common.remove': 'Remove',
  'common.refresh': 'Refresh',
  'common.use': 'Use',
  'common.inUse': 'In use',
  'common.loading': 'Loading…',
  'common.error': 'Something went wrong',
  'common.readOnly': 'read-only',
  'common.none': 'Nothing here yet',

  'runtimes.installed': 'Installed',
  'runtimes.available': 'Available from llama.cpp',
  'runtimes.checkReleases': 'Check for builds',
  'runtimes.addCustom': 'Add your own folder',
  'runtimes.addCustomHint':
    'Any folder with llama-server in it — your own build, or a backend with no published Windows package.',
  'runtimes.install': 'Install',
  'runtimes.installing': 'Installing…',
  'runtimes.devices': 'Devices',
  'runtimes.noDevices': 'No GPU found — this pack would run on the CPU',
  'runtimes.untested': 'untested',
  'runtimes.untestedHint':
    'Nobody has run this pack on real hardware yet. Tell us how it goes.',
  'runtimes.empty':
    'No runtime installed yet. Add one below, or point at a folder you already have.',
  'runtimes.uma': 'shares system RAM',

  'models.folders': 'Folders',
  'models.addFolder': 'Add folder',
  'models.addFolderReadOnly': 'Add read-only',
  'models.empty': 'No models yet. Add the folder your .gguf files live in.',
  'models.count': 'models',
  'models.quant': 'Quant',
  'models.size': 'Size',
  'models.arch': 'Architecture',
  'models.context': 'Context',
  'models.kvPerToken': 'KV / token',
  'models.moe': 'MoE',
  'models.dense': 'dense',
  'models.vision': 'vision',
  'models.mtp': 'MTP head',
  'models.failures': 'Could not read',
  'server.start': 'Start',
  'server.stop': 'Stop',
  'server.state.stopped': 'Stopped',
  'server.state.starting': 'Starting…',
  'server.state.ready': 'Running',
  'server.state.stopping': 'Stopping…',
  'server.state.failed': 'Failed',
  'server.address': 'Address',
  'server.loaded': 'Loaded',
  'server.load': 'Load',
  'server.unload': 'Unload',
  'server.noRuntime': 'Install a runtime first.',
  'server.noModels': 'Add a model folder first.',
  'server.strays':
    'llama-server is already running outside Monet Local. Two of them will fight over the same memory.',
  'server.killStray': 'Stop it',
  'server.command': 'Command',
  'server.profile': 'Profile',

  'verdict.fits': 'Fits',
  'verdict.tight': 'Tight',
  'verdict.wont_fit': 'Will not fit',
  'verdict.weights': 'Weights',
  'verdict.kv': 'KV cache',
  'verdict.compute': 'Compute buffers',
  'verdict.total': 'Total',
  'verdict.headroom': 'Headroom',
  'verdict.deviceUse': 'On the GPU',

  'finding.exceeds-ram': 'Over the RAM budget by',
  'finding.exceeds-device': 'Over what the GPU will allocate, by',
  'finding.repack-cost': 'Repacking adds a second copy of the weights:',
  'finding.kv-dominates': 'The cache costs more than the weights:',
  'finding.tight': 'Almost nothing to spare:',
  'finding.no-geometry':
    'This header carries no head counts, so the cache cannot be estimated.',

  'fix.lower-context': 'Lower the context',
  'fix.enable-no-kv-offload': 'Move the KV cache to system RAM',
  'fix.quantise-kv': 'Quantise the KV cache',
  'fix.enable-no-repack': 'Turn off weight repacking',
  'fix.smaller-quant': 'Use a smaller quantisation',
  'fix.lower-ubatch': 'Lower the physical batch size',
  'fix.disable-mlock': 'Stop locking the model in RAM',

  'flags.level.basic': 'Basic',
  'flags.level.advanced': 'Advanced',
  'flags.level.expert': 'Expert',
  'flags.recommended': 'recommended here',
  'flags.group.model': 'Model',
  'flags.group.context': 'Context',
  'flags.group.memory': 'Memory',
  'flags.group.gpu': 'GPU',
  'flags.group.sampling': 'Sampling',
  'flags.group.reasoning': 'Reasoning',
  'flags.group.speculative': 'Speculative decoding',
  'flags.group.server': 'Server',
  'flags.group.advanced': 'Advanced',
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
  'common.add': 'Добавить',
  'common.remove': 'Убрать',
  'common.refresh': 'Обновить',
  'common.use': 'Выбрать',
  'common.inUse': 'Используется',
  'common.loading': 'Загрузка…',
  'common.error': 'Что-то пошло не так',
  'common.readOnly': 'только чтение',
  'common.none': 'Пока пусто',

  'runtimes.installed': 'Установленные',
  'runtimes.available': 'Доступные из llama.cpp',
  'runtimes.checkReleases': 'Проверить сборки',
  'runtimes.addCustom': 'Указать свою папку',
  'runtimes.addCustomHint':
    'Любая папка с llama-server: своя сборка или бэкенд, для которого нет готового пакета под Windows.',
  'runtimes.install': 'Установить',
  'runtimes.installing': 'Устанавливаю…',
  'runtimes.devices': 'Устройства',
  'runtimes.noDevices': 'Видеокарта не найдена — этот пак будет считать на CPU',
  'runtimes.untested': 'не проверено',
  'runtimes.untestedHint':
    'Этот пак ещё никто не запускал на реальном железе. Расскажите, как пойдёт.',
  'runtimes.empty':
    'Рантайм ещё не установлен. Добавьте ниже или укажите папку, которая уже есть.',
  'runtimes.uma': 'общая с системой память',

  'models.folders': 'Папки',
  'models.addFolder': 'Добавить папку',
  'models.addFolderReadOnly': 'Только для чтения',
  'models.empty': 'Моделей пока нет. Добавьте папку, где лежат ваши .gguf.',
  'models.count': 'моделей',
  'models.quant': 'Квант',
  'models.size': 'Размер',
  'models.arch': 'Архитектура',
  'models.context': 'Контекст',
  'models.kvPerToken': 'KV / токен',
  'models.moe': 'MoE',
  'models.dense': 'плотная',
  'models.vision': 'картинки',
  'models.mtp': 'MTP-голова',
  'models.failures': 'Не удалось прочитать',
  'server.start': 'Запустить',
  'server.stop': 'Остановить',
  'server.state.stopped': 'Остановлен',
  'server.state.starting': 'Запускается…',
  'server.state.ready': 'Работает',
  'server.state.stopping': 'Останавливается…',
  'server.state.failed': 'Не запустился',
  'server.address': 'Адрес',
  'server.loaded': 'Загружено',
  'server.load': 'Загрузить',
  'server.unload': 'Выгрузить',
  'server.noRuntime': 'Сначала установите рантайм.',
  'server.noModels': 'Сначала добавьте папку с моделями.',
  'server.strays':
    'llama-server уже запущен вне Monet Local.Два процесса будут драться за одну память.',
  'server.killStray': 'Остановить его',
  'server.command': 'Команда',
  'server.profile': 'Профиль',

  'verdict.fits': 'Влезает',
  'verdict.tight': 'Впритык',
  'verdict.wont_fit': 'Не влезет',
  'verdict.weights': 'Веса',
  'verdict.kv': 'KV-кэш',
  'verdict.compute': 'Вычислительные буферы',
  'verdict.total': 'Итого',
  'verdict.headroom': 'Запас',
  'verdict.deviceUse': 'На видеокарте',

  'finding.exceeds-ram': 'Превышение бюджета RAM на',
  'finding.exceeds-device': 'Больше, чем выделит видеокарта, на',
  'finding.repack-cost': 'Переупаковка добавляет вторую копию весов:',
  'finding.kv-dominates': 'Кэш стоит больше самих весов:',
  'finding.tight': 'Запаса почти не остаётся:',
  'finding.no-geometry':
    'В заголовке нет числа голов, поэтому кэш посчитать нельзя.',

  'fix.lower-context': 'Уменьшить контекст',
  'fix.enable-no-kv-offload': 'Перенести KV-кэш в системную память',
  'fix.quantise-kv': 'Квантовать KV-кэш',
  'fix.enable-no-repack': 'Отключить переупаковку весов',
  'fix.smaller-quant': 'Взять квант поменьше',
  'fix.lower-ubatch': 'Уменьшить физический размер пакета',
  'fix.disable-mlock': 'Не закреплять модель в памяти',

  'flags.level.basic': 'Основное',
  'flags.level.advanced': 'Продвинутое',
  'flags.level.expert': 'Экспертное',
  'flags.recommended': 'рекомендуется здесь',
  'flags.group.model': 'Модель',
  'flags.group.context': 'Контекст',
  'flags.group.memory': 'Память',
  'flags.group.gpu': 'Видеокарта',
  'flags.group.sampling': 'Сэмплирование',
  'flags.group.reasoning': 'Размышления',
  'flags.group.speculative': 'Спекулятивное декодирование',
  'flags.group.server': 'Сервер',
  'flags.group.advanced': 'Дополнительно',
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
