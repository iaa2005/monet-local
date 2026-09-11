/**
 * Every llama.cpp knob Monet Local exposes, with the reason it exists.
 *
 * Not all 200 of them: the ones that change whether a model runs, how fast,
 * and how much memory it costs — plus an escape hatch for the rest. The help
 * text is the product. `docs/reference/llama-server-help.txt` is the full
 * `--help` for anything not here.
 *
 * Flags NOT in this registry, deliberately: `--webui`, `--tools`,
 * `--mcp-servers-config`, `--agent`. Monet Local is a server; the router
 * always runs with `--no-webui` and nothing else. Anyone who wants them can
 * put them in `extraArgs`, at their own risk.
 */

import type { Registry } from './types.js'

/** Context sizes worth offering; the estimator is what says which are sane. */
const CONTEXT_STEPS = [
  2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144,
]

/**
 * Marks are the values worth one click, NOT the only legal ones — the whole
 * point of the slider beside them is that everything between is reachable.
 * Each list is filtered to the flag's real range before it is drawn, so a
 * machine with eight threads never offers sixteen.
 */
const BATCH_STEPS = [128, 256, 512, 1024, 2048, 4096, 8192]
const UBATCH_STEPS = [16, 32, 64, 128, 256, 512, 1024, 2048]
const COUNT_STEPS = [1, 2, 4, 8, 16, 32, 64]
const LAYER_STEPS = [0, 8, 16, 24, 32, 48, 64, 96, 128]

const KV_TYPES = [
  { value: 'f16', label: 'f16' },
  { value: 'bf16', label: 'bf16' },
  { value: 'q8_0', label: 'q8_0' },
  { value: 'q5_1', label: 'q5_1' },
  { value: 'q5_0', label: 'q5_0' },
  { value: 'q4_1', label: 'q4_1' },
  { value: 'q4_0', label: 'q4_0' },
  { value: 'iq4_nl', label: 'iq4_nl' },
]

export const FLAGS: Registry = {
  // ── context ────────────────────────────────────────────────────────────
  ctxSize: {
    cli: '--ctx-size',
    ini: 'c',
    group: 'context',
    level: 'basic',
    type: 'int',
    default: 8192,
    min: 512,
    max: 1_048_576,
    step: 256,
    scale: CONTEXT_STEPS,
    label: { en: 'Context length', ru: 'Длина контекста' },
    help: {
      en: 'How much the model can see at once. The KV cache grows linearly with it, and that cache is usually what decides whether a model fits.',
      ru: 'Сколько модель видит за раз. KV-кэш растёт линейно от этого числа, и обычно именно он решает, влезет модель или нет.',
    },
  },

  // ── memory ─────────────────────────────────────────────────────────────
  noRepack: {
    cli: '--no-repack',
    ini: 'repack',
    negated: true,
    group: 'memory',
    level: 'basic',
    type: 'bool',
    default: true,
    label: { en: 'Skip weight repacking', ru: 'Без переупаковки весов' },
    help: {
      en: 'llama.cpp rewrites Q4_K weights into a SIMD-friendly layout and keeps that SECOND copy in RAM. On a machine with little to spare it is the difference between running and swapping — it turned a working 27B into a 400-second stall with no tokens at all.',
      ru: 'llama.cpp переписывает веса Q4_K в SIMD-дружественный вид и держит в памяти ВТОРУЮ копию. Когда памяти в обрез, это разница между работой и свопом: рабочая 27B превращалась в 400 секунд простоя без единого токена.',
    },
  },
  noKvOffload: {
    cli: '--no-kv-offload',
    ini: 'kv-offload',
    negated: true,
    group: 'memory',
    level: 'basic',
    type: 'bool',
    default: false,
    label: {
      en: 'Keep the KV cache in system RAM',
      ru: 'KV-кэш в системной памяти',
    },
    help: {
      en: 'On an integrated GPU this is what lets context go past ~8k. The wall is not the cache size — quantising it does not help — it is that the weights plus the compute buffers already fill the shared pool. Measured on a 27B here, it costs FOUR FIFTHS of the generation speed (3.6 → 0.7 tokens a second): every layer’s attention then runs on the CPU against a cache the GPU cannot reach. A smaller context with the cache on the GPU is almost always the better trade. Costs roughly a quarter of the generation speed.',
      ru: 'На встроенной видеокарте именно это позволяет контексту вырасти за ~8k. Стенка не в размере кэша — квантование не помогает — а в том, что веса и вычислительные буферы уже занимают общий пул. Стоит примерно четверти скорости генерации.',
    },
    recommendWhen: (p, hw) =>
      hw.devices.some((d) => d.uma) && Number(p['ctxSize'] ?? 0) > 8192,
  },
  cacheTypeK: {
    cli: '--cache-type-k',
    ini: 'cache-type-k',
    group: 'memory',
    level: 'advanced',
    type: 'enum',
    options: KV_TYPES,
    label: { en: 'K cache type', ru: 'Тип K-кэша' },
    help: {
      en: 'Quantising the keys halves the cache at q8_0 and quarters it at q4_0. Keys are the more precision-sensitive half — drop them last.',
      ru: 'Квантование ключей уменьшает кэш вдвое при q8_0 и вчетверо при q4_0. Ключи чувствительнее к точности — ужимайте их в последнюю очередь.',
    },
  },
  cacheTypeV: {
    cli: '--cache-type-v',
    ini: 'cache-type-v',
    group: 'memory',
    level: 'advanced',
    type: 'enum',
    options: KV_TYPES,
    label: { en: 'V cache type', ru: 'Тип V-кэша' },
    help: {
      en: 'Values tolerate q4_0 better than keys do, so K at q8_0 with V at q4_0 is the usual compromise when a long context will not otherwise fit.',
      ru: 'Значения переносят q4_0 лучше ключей, поэтому K в q8_0 и V в q4_0 — обычный компромисс, когда длинный контекст иначе не влезает.',
    },
  },
  mlock: {
    cli: '--mlock',
    ini: 'mlock',
    group: 'memory',
    level: 'advanced',
    type: 'bool',
    default: false,
    label: { en: 'Lock the model in RAM', ru: 'Закрепить модель в памяти' },
    help: {
      en: 'Forbids the OS from paging the weights out. Sounds like a speed-up and behaves like a trap when memory is tight: nothing can be evicted, so everything else swaps instead.',
      ru: 'Запрещает системе вытеснять веса. Выглядит как ускорение, а при нехватке памяти работает как ловушка: вытеснять нечего, и в своп уходит всё остальное.',
    },
  },
  noMmap: {
    cli: '--no-mmap',
    ini: 'mmap',
    negated: true,
    group: 'memory',
    level: 'advanced',
    type: 'bool',
    default: false,
    label: { en: 'Read the model instead of mapping it', ru: 'Читать модель вместо mmap' },
    help: {
      en: 'Memory-mapping lets the OS drop pages it needs back. Turning it off loads every byte up front — slower to start and less forgiving, occasionally faster once warm.',
      ru: 'Отображение в память позволяет системе выгружать страницы и подгружать заново. Без него всё читается заранее: старт дольше, запаса меньше, иногда быстрее после прогрева.',
    },
  },

  // ── gpu ────────────────────────────────────────────────────────────────
  device: {
    cli: '--device',
    ini: 'device',
    group: 'gpu',
    level: 'basic',
    type: 'enum',
    options: [
      { value: 'none', label: 'CPU only' },
    ],
    label: { en: 'Compute device', ru: 'Устройство расчёта' },
    help: {
      en: 'Empty means let llama.cpp choose. `none` is how you say CPU only — and it is the ONLY way to say it. Setting "layers on the GPU" to 0 looks equivalent and is not: on a Vulkan build the backend stays selected with nothing offloaded, and on a hybrid model that path aborts the process outright (exit 0xC0000409, no message).',
      ru: 'Пусто — пусть llama.cpp выбирает сам. `none` означает «только процессор», и это ЕДИНСТВЕННЫЙ способ так сказать. Поставить «слоёв на видеокарте» = 0 выглядит тем же самым, но им не является: в сборке с Vulkan бэкенд остаётся выбранным, слои не выгружены, и на гибридной модели процесс просто падает (код 0xC0000409, без сообщения).',
    },
    visibleWhen: (_p, hw) => hw.devices.length > 0,
  },
  nGpuLayers: {
    cli: '--n-gpu-layers',
    ini: 'n-gpu-layers',
    group: 'gpu',
    level: 'basic',
    type: 'int',
    min: 0,
    max: 999,
    step: 1,
    scale: LAYER_STEPS,
    label: { en: 'Layers on the GPU', ru: 'Слоёв на видеокарте' },
    help: {
      en: 'Left empty, llama.cpp fits as many as it thinks will hold. Setting it by hand is how you find out the hard way that the last few layers had no room: the server refuses to start rather than falling back. To run on the CPU, use the device setting above — 0 here is not the same thing and can crash the process.',
      ru: 'Если оставить пустым, llama.cpp сам подберёт, сколько поместится. Задавать вручную — верный способ узнать, что последним слоям места не хватило: сервер откажется стартовать, а не отступит. Чтобы считать на процессоре, используйте настройку устройства выше: 0 здесь — не то же самое и может уронить процесс.',
    },
    visibleWhen: (_p, hw) => hw.devices.length > 0,
  },
  mainGpu: {
    cli: '--main-gpu',
    ini: 'main-gpu',
    group: 'gpu',
    level: 'advanced',
    type: 'int',
    min: 0,
    label: { en: 'Primary GPU', ru: 'Основная видеокарта' },
    help: {
      en: 'Which device holds the small tensors that are not split.',
      ru: 'На какой карте лежат мелкие тензоры, которые не делятся.',
    },
    visibleWhen: (_p, hw) => hw.devices.length > 1,
  },
  splitMode: {
    cli: '--split-mode',
    ini: 'split-mode',
    group: 'gpu',
    level: 'advanced',
    type: 'enum',
    options: [
      { value: 'none', label: 'none' },
      { value: 'layer', label: 'layer' },
      { value: 'row', label: 'row' },
    ],
    label: { en: 'Split across GPUs', ru: 'Деление между картами' },
    help: {
      en: 'How a model spans several cards: by layer (default, least traffic) or by row (more parallel, more chatter).',
      ru: 'Как модель делится между картами: по слоям (по умолчанию, меньше обмена) или по строкам (больше параллелизма и трафика).',
    },
    visibleWhen: (_p, hw) => hw.devices.length > 1,
  },
  tensorSplit: {
    cli: '--tensor-split',
    ini: 'tensor-split',
    group: 'gpu',
    level: 'advanced',
    type: 'string',
    placeholder: '3,1',
    label: { en: 'Proportions per GPU', ru: 'Доли между картами' },
    help: {
      en: 'Comma-separated weights, one per device — "3,1" gives the first card three quarters. Match them to VRAM, not to core count.',
      ru: 'Веса через запятую, по одному на устройство: «3,1» отдаёт первой карте три четверти. Соотносите с объёмом памяти, а не с числом ядер.',
    },
    visibleWhen: (_p, hw) => hw.devices.length > 1,
  },
  flashAttn: {
    cli: '--flash-attn',
    ini: 'flash-attn',
    group: 'gpu',
    level: 'advanced',
    type: 'enum',
    options: [
      { value: 'auto', label: 'auto' },
      { value: 'on', label: 'on' },
      { value: 'off', label: 'off' },
    ],
    label: { en: 'Flash attention', ru: 'Flash attention' },
    help: {
      en: 'A cheaper attention kernel. Required before the KV cache can be quantised, which is why the long-context profile turns it on explicitly.',
      ru: 'Более дешёвое ядро внимания. Без него нельзя квантовать KV-кэш — поэтому в профиле с длинным контекстом оно включено явно.',
    },
  },

  // ── model ──────────────────────────────────────────────────────────────
  mmproj: {
    cli: '--mmproj',
    ini: 'mmproj',
    group: 'model',
    level: 'basic',
    type: 'string',
    label: { en: 'Vision projector', ru: 'Проектор для картинок' },
    help: {
      en: 'The mmproj file that lets the model see images. Filled in automatically when one sits beside the model.',
      ru: 'Файл mmproj, дающий модели зрение. Подставляется сам, если лежит рядом с моделью.',
    },
  },
  noMmprojOffload: {
    cli: '--no-mmproj-offload',
    ini: 'mmproj-offload',
    negated: true,
    group: 'model',
    level: 'advanced',
    type: 'bool',
    default: false,
    label: { en: 'Keep the projector on the CPU', ru: 'Проектор на CPU' },
    help: {
      en: 'The layer fitter does not count the projector, so on a tight GPU it is allocated last and there is no room: the server dies on start with an out-of-device-memory abort. This puts it on the CPU — a couple of seconds per image, no change to text speed.',
      ru: 'Подборщик слоёв не учитывает проектор: на тесной видеокарте он выделяется последним, места нет, и сервер падает при старте. Этот ключ считает его на CPU — пара секунд на картинку, скорость текста не меняется.',
    },
    recommendWhen: (p) => typeof p['mmproj'] === 'string' && !!p['mmproj'],
  },

  // ── reasoning ──────────────────────────────────────────────────────────
  reasoningEffort: {
    cli: '--reasoning-effort',
    ini: 'reasoning-effort',
    group: 'reasoning',
    level: 'basic',
    type: 'enum',
    options: [
      { value: 'low', label: 'low' },
      { value: 'medium', label: 'medium' },
      { value: 'high', label: 'high' },
      { value: 'xhigh', label: 'xhigh' },
    ],
    label: { en: 'Reasoning effort', ru: 'Глубина размышлений' },
    help: {
      en: 'How long the model thinks before answering. It does not change tokens per second — it changes how many of them go into thinking. Qwen3.8 defaults to xhigh, where hundreds of tokens can pass before the answer starts.',
      ru: 'Сколько модель думает перед ответом. Скорость в токенах не меняется — меняется, сколько их уходит на размышление. У Qwen3.8 по умолчанию xhigh: до начала ответа могут пройти сотни токенов.',
    },
  },
  reasoningFormat: {
    cli: '--reasoning-format',
    ini: 'reasoning-format',
    group: 'reasoning',
    level: 'advanced',
    type: 'enum',
    options: [
      { value: 'auto', label: 'auto' },
      { value: 'deepseek', label: 'deepseek' },
      { value: 'none', label: 'none' },
    ],
    label: { en: 'Where thoughts go', ru: 'Куда попадают размышления' },
    help: {
      en: '`deepseek` puts them in `reasoning_content`, which is what a client can collapse. `none` leaves them inline in the answer.',
      ru: '`deepseek` кладёт их в `reasoning_content`, который клиент умеет сворачивать. `none` оставляет их прямо в ответе.',
    },
  },

  // ── sampling ───────────────────────────────────────────────────────────
  temp: {
    cli: '--temp',
    ini: 'temp',
    group: 'sampling',
    level: 'basic',
    type: 'string',
    placeholder: '1.0',
    label: { en: 'Temperature', ru: 'Температура' },
    help: {
      en: 'Left empty, the model\'s own recommendation from its GGUF is used. Override only if you know the model.',
      ru: 'Если пусто, берётся рекомендация самой модели из GGUF. Меняйте, только если знаете модель.',
    },
  },
  topK: {
    cli: '--top-k',
    ini: 'top-k',
    group: 'sampling',
    level: 'advanced',
    type: 'int',
    min: 0,
    label: { en: 'Top-K', ru: 'Top-K' },
    help: {
      en: 'Consider only the K most likely tokens.',
      ru: 'Рассматривать только K самых вероятных токенов.',
    },
  },
  topP: {
    cli: '--top-p',
    ini: 'top-p',
    group: 'sampling',
    level: 'advanced',
    type: 'string',
    placeholder: '0.95',
    label: { en: 'Top-P', ru: 'Top-P' },
    help: {
      en: 'Consider the smallest set of tokens whose probabilities sum to P.',
      ru: 'Рассматривать наименьший набор токенов, чьи вероятности в сумме дают P.',
    },
  },
  nPredict: {
    cli: '--n-predict',
    ini: 'n-predict',
    group: 'sampling',
    level: 'basic',
    type: 'int',
    default: 4096,
    min: -1,
    label: { en: 'Answer limit', ru: 'Предел ответа' },
    help: {
      en: 'Most tokens one answer may use. Too low and a thinking model runs out mid-thought, before it has said anything.',
      ru: 'Максимум токенов на один ответ. Слишком мало — и думающая модель обрывается посреди размышления, не сказав ничего.',
    },
  },

  // ── speculative ────────────────────────────────────────────────────────
  specType: {
    cli: '--spec-type',
    ini: 'spec-type',
    group: 'speculative',
    level: 'expert',
    type: 'enum',
    options: [
      { value: 'none', label: 'none' },
      { value: 'ngram-mod', label: 'ngram-mod' },
      { value: 'draft-mtp', label: 'draft-mtp' },
      { value: 'draft-simple', label: 'draft-simple' },
    ],
    label: { en: 'Speculative decoding', ru: 'Спекулятивное декодирование' },
    help: {
      en: 'Guess several tokens and verify them in one pass; the output is exactly what the model would have written unaided. Measured on a 27B here with the KV cache on the GPU: draft-mtp (the model’s own prediction head) 3.6 → 5.8 tokens a second at 82% acceptance, the best lever there is on a dense model; a DFlash2 drafter 4.1; ngram-mod no change. Auto turns on draft-mtp for any model that carries the head. It fails to start only when the device is already full — move the projector or the cache first, not the other way round.',
      ru: 'Угадать несколько токенов и проверить за один проход; вывод ровно тот, что модель написала бы сама. Измерено на 27B здесь с KV-кэшем на видеокарте: draft-mtp (собственная голова предсказания модели) 3.6 → 5.8 токенов в секунду при 82% принятия — лучший рычаг для плотной модели; драфтер DFlash2 — 4.1; ngram-mod — без изменений. Авто включает draft-mtp для любой модели с такой головой. Не стартует только когда устройство уже заполнено — сначала уберите проектор или кэш, а не наоборот.',
    },
  },

  specDraftNMax: {
    cli: '--spec-draft-n-max',
    ini: 'spec-draft-n-max',
    group: 'speculative',
    level: 'expert',
    type: 'int',
    // No default on purpose: the flag only matters with a spec-type, and a
    // registry default would put it on every command line.
    min: 1,
    max: 16,
    step: 1,
    label: { en: 'Draft length', ru: 'Длина черновика' },
    help: {
      en: 'Tokens guessed per verification. On an integrated GPU the verification pass is not free, so shorter wins: measured on a 27B here, draft-mtp gave 6.8 tokens a second at 2, 5.8 at the default 3; a DFlash2 drafter 6.7 at 3 and 4.1 at 7.',
      ru: 'Сколько токенов угадывать на одну проверку. На встроенной видеокарте проверка не бесплатна, поэтому короче — лучше: на 27B здесь draft-mtp дал 6.8 токенов в секунду при 2 и 5.8 при стандартных 3; драфтер DFlash2 — 6.7 при 3 и 4.1 при 7.',
    },
  },

  // ── server ─────────────────────────────────────────────────────────────
  threads: {
    cli: '--threads',
    ini: 'threads',
    group: 'server',
    level: 'basic',
    type: 'int',
    min: 1,
    max: 64,
    step: 1,
    scale: COUNT_STEPS,
    label: { en: 'CPU threads', ru: 'Потоков CPU' },
    help: {
      en: 'Physical cores is the right answer; hyper-threads usually cost more than they add.',
      ru: 'Правильный ответ — число физических ядер; гипертрединг обычно отнимает больше, чем даёт.',
    },
  },
  batchSize: {
    cli: '--batch-size',
    ini: 'b',
    group: 'server',
    level: 'advanced',
    type: 'int',
    min: 32,
    max: 8192,
    step: 32,
    scale: BATCH_STEPS,
    label: { en: 'Batch size', ru: 'Размер пакета' },
    help: {
      en: 'Tokens submitted per prompt-processing step. Bigger is faster and needs a bigger compute buffer.',
      ru: 'Сколько токенов уходит за один шаг обработки промпта. Больше — быстрее и требует большего буфера.',
    },
  },
  ubatchSize: {
    cli: '--ubatch-size',
    ini: 'ub',
    group: 'server',
    level: 'advanced',
    type: 'int',
    default: 256,
    min: 16,
    max: 2048,
    step: 16,
    scale: UBATCH_STEPS,
    label: { en: 'Physical batch size', ru: 'Физический размер пакета' },
    help: {
      en: 'How much of a batch is computed at once. The compute buffer scales with this, so lowering it is the cheapest way to claw back device memory.',
      ru: 'Сколько из пакета считается за раз. Вычислительный буфер растёт вместе с этим числом, поэтому уменьшить его — самый дешёвый способ вернуть память устройства.',
    },
  },
  parallel: {
    cli: '--parallel',
    ini: 'np',
    group: 'server',
    level: 'advanced',
    type: 'int',
    default: 1,
    min: 1,
    max: 16,
    step: 1,
    scale: COUNT_STEPS,
    label: { en: 'Concurrent requests', ru: 'Параллельных запросов' },
    help: {
      en: 'Slots served at once. The context is DIVIDED between them: four slots on a 262144 context give each conversation 65536, while the memory bill stays at the full number.',
      ru: 'Сколько запросов обслуживается одновременно. Контекст ДЕЛИТСЯ между ними: четыре слота при 262144 дают каждому чату 65536, а память расходуется на полное число.',
    },
  },

  // ── advanced ───────────────────────────────────────────────────────────
  rpc: {
    cli: '--rpc',
    ini: 'rpc',
    group: 'advanced',
    level: 'expert',
    type: 'string',
    placeholder: 'host:50052',
    label: { en: 'Remote layers (RPC)', ru: 'Слои на другой машине (RPC)' },
    help: {
      en: 'Run some layers on another computer with ggml-rpc-server, which ships inside every pack. Only worth it over a fast local network.',
      ru: 'Считать часть слоёв на другом компьютере через ggml-rpc-server, который лежит в каждом паке. Имеет смысл только по быстрой локальной сети.',
    },
  },
  extraArgs: {
    cli: '',
    group: 'advanced',
    level: 'expert',
    type: 'string',
    placeholder: '--some-flag value',
    label: { en: 'Extra arguments', ru: 'Дополнительные аргументы' },
    help: {
      en: 'Appended verbatim. Everything llama.cpp accepts and this form does not offer — see docs/reference/llama-server-help.txt. Unvalidated, so a typo here shows up as a server that will not start.',
      ru: 'Добавляется как есть. Всё, что llama.cpp принимает, а эта форма не предлагает — см. docs/reference/llama-server-help.txt. Не проверяется: опечатка обернётся сервером, который не стартует.',
    },
  },
}

export const FLAG_IDS = Object.keys(FLAGS)

export const GROUP_ORDER = [
  'model',
  'context',
  'memory',
  'gpu',
  'reasoning',
  'sampling',
  'speculative',
  'server',
  'advanced',
] as const
