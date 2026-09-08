# Monet Local — план

Обёртка над llama.cpp с полным набором настроек, менеджером рантаймов
(любой бэкенд, который собирает llama.cpp), библиотекой моделей, честным
калькулятором памяти, бенчмарком, чатом и режимом провайдера для Code Monet.
Electron, один exe.

Дизайн, шрифты и стек — из Code Monet (`github.com/iaa2005/monet`, клон в
`D:\Projects\monet`). Рабочая папка — `D:\Projects\monet-local`.

---

## 0. Зачем, если есть LM Studio

За одну неделю с Qwen3.8-27B на 32 ГБ RAM + Radeon 780M мы упёрлись в то,
чего в LM Studio либо нет, либо оно спрятано:

| проблема | что было | чего не хватало |
|---|---|---|
| ответ 5–6 часов | контекст 262144 по умолчанию, GPU 0, своп | честная оценка «влезет / не влезет» **с причиной** |
| repack удваивает веса в RAM | `0xC0000409` на старте, своп | флага `--no-repack` в LM Studio нет вообще |
| iGPU не тянет контекст > 8k | падение на выделении 549 МБ | понимания, что стенка — GTT, а не KV; `--no-kv-offload` решает |
| MTP «ускоряет» до 1 t/s | Speculative Decoding = MTP включён по умолчанию | замера: на этом железе MTP хуже базы в 17 раз по промпту |
| два `llama-server` дерутся за RAM | 103 МБ свободно, 300k pages/sec | контроля сироток и предупреждения «уже запущен» |
| CLI неудобен для перебора | `run.cmd` с переменными | форма + превью командной строки + A/B бенчмарк |

Monet Local — ровно этот слой: **все ручки llama-server, объяснённые и
посчитанные**, поверх стабильного бинарника, а не вместо него.

---

## 1. Ключевые решения

### D1. `llama-server.exe` как подпроцесс, не Node-биндинги

- llama-server уже умеет всё нужное: OpenAI API, стриминг, `reasoning_content`,
  tools, MCP, spec-decoding, `--list-devices`, `/props`, `/slots`, `/metrics`,
  встроенный web UI как запасной вариант.
- Обновление llama.cpp = подменить zip. Никакой нативной сборки, никакого
  `@electron/rebuild`, никаких ABI-ломающих апдейтов Electron.
- Один процесс обслуживает и наш чат, и Code Monet, и любого
  OpenAI-совместимого клиента — режим провайдера получается бесплатно.
- Цена: управление процессом (старт/стоп/сироты/парсинг логов). Это небольшой,
  хорошо тестируемый модуль.

### D2. Рантаймы — паки, таблица ассетов + «свой пак»

llama.cpp собирает под всё: BLAS, BLIS, CANN, CUDA, HIP, Hexagon, zDNN, MUSA,
Metal, OpenCL, OpenVINO, RPC, SYCL, VirtGPU, Vulkan, WebGPU, ZenDNN. Часть
этого выкладывается готовыми zip в релизах, часть — только из исходников.
Менеджер рантаймов не знает про бэкенды ничего, кроме таблицы:

**Готовые Windows-паки в релизах `ggml-org/llama.cpp` (снято с b10826):**

| пак | ассет | размер | доп. zip |
|---|---|---|---|
| CPU x64 | `llama-<b>-bin-win-cpu-x64.zip` | 17 МБ | — |
| CPU arm64 | `llama-<b>-bin-win-cpu-arm64.zip` | 11 МБ | — |
| Vulkan | `llama-<b>-bin-win-vulkan-x64.zip` | 33 МБ | — |
| CUDA 12.4 | `llama-<b>-bin-win-cuda-12.4-x64.zip` | 242 МБ | `cudart-llama-bin-win-cuda-12.4-x64.zip` 373 МБ |
| CUDA 13.3 | `llama-<b>-bin-win-cuda-13.3-x64.zip` | 142 МБ | `cudart-…-13.3-x64.zip` 372 МБ |
| CUDA 13.4 arm64 | `llama-<b>-bin-win-cuda-13.4-arm64.zip` | 136 МБ | `cudart-…-13.4-arm64.zip` 146 МБ |
| HIP / ROCm 10 | `llama-<b>-bin-win-rocm-10.0-x64.zip` | 232 МБ | драйвер AMD |
| SYCL (Intel GPU) | `llama-<b>-bin-win-sycl-x64.zip` | 114 МБ | oneAPI runtime |
| OpenVINO | `llama-<b>-bin-win-openvino-2026.3.1-x64.zip` | 76 МБ | — |
| OpenCL Adreno | `llama-<b>-bin-win-opencl-adreno-arm64.zip` | 12 МБ | — |

**Не выкладываются под Windows** (CANN, MUSA, Hexagon, zDNN, WebGPU, ZenDNN,
BLAS-варианты) и **Metal** (только macOS) — для них есть **«свой пак»**:
указать любую папку с `llama-server.exe`; менеджер проверит запуск
`--version` и `--list-devices` и добавит её в список наравне с остальными.
Так поддерживается всё, что кто-то собрал, включая собственные сборки с
другими флагами.

**RPC** — не пак, а режим: `ggml-rpc-server.exe` лежит в каждом zip. Флаг
`--rpc host:port,…` у llama-server позволяет выносить слои на другую машину в
сети. В реестре флагов — группа `advanced`, отдельный экран не нужен.

Хранение: `%APPDATA%/monet-local/runtimes/<backend>-<build>/`. Приложение
ставится с **Vulkan + CPU внутри** (50 МБ, работает офлайн с первого
запуска); остальное — по кнопке. Обновление рантайма — отдельно от обновления
приложения; несколько версий одного бэкенда могут жить рядом (откат).

Выбор по умолчанию: `--list-devices` каждого установленного пака; если у
GPU-пака устройств нет — CPU. Пользователь может переопределить, в том числе
на уровне профиля («этот профиль — всегда CUDA 12.4 b10826»).

### D3. Схема настроек — единственный источник правды

Один TypeScript-реестр флагов (zod). Из него генерируются: форма, превью
командной строки, валидация, пресеты, калькулятор памяти, подсказки. Никаких
«ещё один флаг захардкожен в скрипте запуска».

```ts
// src/shared/flags/registry.ts — набросок формы
export const flags = defineFlags({
  ctxSize: {
    flag: '-c', group: 'context', type: 'int', default: 8192,
    min: 512, step: 512,
    label: 'Context length',
    help: 'Tokens the model can see. KV cache grows linearly with it.',
    estimator: 'kv',            // участвует в расчёте памяти
  },
  noKvOffload: {
    flag: '--no-kv-offload', group: 'memory', type: 'bool', default: false,
    label: 'Keep KV cache in system RAM',
    help: 'On iGPU (UMA) this is what lets context grow past ~8k: the wall is the device buffer limit, not the cache size.',
    recommendWhen: (s, hw) => hw.gpu.uma && s.ctxSize > 8192,
  },
  noRepack: {
    flag: '--no-repack', group: 'memory', type: 'bool', default: true,
    help: 'Repack keeps a SIMD-friendly second copy of Q4_K weights in RAM. On tight memory it is the difference between running and swapping.',
  },
  // ~60 флагов, группы: model, context, memory, gpu, sampling, reasoning,
  // speculative, tools, mcp, server, advanced
})
```

Уровни: `basic` / `advanced` / `expert` (сырые доп. аргументы строкой).
Полный справочник: `docs/reference/llama-server-help.txt` (735 строк, снят с
b10826) и `llama-bench-help.txt`. Реестр обязан покрывать всё, что там есть;
неизвестные флаги новой сборки попадают в `expert` автоматически (парсер
`--help` при установке пака — задача M6).

### D4. Нативный чат, встроенный UI как запасной выход

Нативный — потому что брендинг (Bounded, токены Monet) и потому что нужны
свои элементы: t/s на каждом сообщении, блок размышлений, оценка «влезет ли
этот промпт в контекст», tool-call с Allow/Deny. Делается фазами (M3 текст,
M5 tools/MCP). Кнопка «Open llama.cpp UI» остаётся всегда — честный fallback
на случай регрессий.

### D5. Модели лежат там, где лежат

Библиотека = список папок (`D:\Colibri\models`; папки LM Studio — только
чтение) + индекс метаданных в userData. Никаких копирований и «импортов».

### D6. Один сервер за раз в v1

`ServerController` спроектирован под несколько инстансов (порт, профиль,
процесс), но UI v1 показывает один. Второй — предупреждение «уже запущен» и
кнопка «остановить старый».

### D7. Windows-first, кроссплатформенно по коду

Пути, имена ассетов, парсер `--list-devices` — через слой `platform/`.
macOS (Metal) и Linux ассеты у llama.cpp есть; включим, когда будет на чём
проверить.

### D8. Стек = Code Monet

Electron 33 · electron-vite 2 · React 19 · TypeScript 5.6 · Tailwind 4 ·
shadcn/react + radix-ui · zustand · zod · lucide + hugeicons (@iconify) ·
electron-builder 25 (NSIS) · electron-updater (GitHub Releases).

Из monet копируются как есть: `styles/globals.css` (токены, обе темы,
`--brand-hue`, радиусы, шрифтовые стеки), `fonts/Bounded-Variable.ttf`,
`components/ui/*`, `WindowControls.tsx` (frameless-окно), `icons/` (резолвер
hugeicons), `useMonetBackground.ts` (картины — по тумблеру).

---

## 2. Архитектура

```
┌─ renderer (React) ─────────────────────────────────────────────────┐
│ stores: runtime · models · server · chat · bench · ui (zustand)     │
│ chat → fetch http://127.0.0.1:<port>/v1/chat/completions (SSE)      │
│        напрямую, как это делает Code Monet; main не проксирует      │
└──────────────┬── preload: window.local.* (typed, по неймспейсам) ───┘
               │ ipc
┌─ main ───────▼──────────────────────────────────────────────────────┐
│ RuntimeManager   таблица ассетов, скачать/проверить, --list-devices  │
│ ModelLibrary     папки, GGUF-метаданные, пары mmproj, индекс          │
│ Downloader       HF: resume, range-параллель, sha256, очередь         │
│ ServerController spawn llama-server, state machine, логи, сироты     │
│ Estimator        память из GGUF + профиль + железо → verdict + why    │
│ Bench            llama-bench, история, A/B                            │
│ Settings         профили (JSON), app settings, миграции               │
│ Tray/Autostart   headless-режим провайдера                            │
│ Updater          electron-updater ← GitHub Releases iaa2005/monet-local│
└─────────────────────────────────────────────────────────────────────┘
```

### Данные

```
%APPDATA%/monet-local/
├── settings.json          папки моделей, тема, язык, порт по умолчанию
├── profiles/*.json        именованные наборы флагов (+ модель, + рантайм)
├── runtimes/<backend>-<build>/   распакованные zip llama.cpp / свои паки
├── index/models.json      кэш GGUF-метаданных (ключ: путь+mtime+size)
├── chats/<id>.json        история чатов
├── bench/*.json           результаты llama-bench
└── logs/server-*.log      stdout/stderr каждого запуска
```

### GGUF-ридер (порт `gguf_meta.py` из этой сессии)

Читает только заголовок (KV-пары и таблицу тензоров, без данных). Достаёт:
`general.architecture`, `*.block_count`, `*.context_length`,
`*.attention.head_count(_kv)`, `*.attention.key_length / value_length`,
`*.expert_count` (MoE), `*.ssm.*` и `*.full_attention_interval` (гибрид
DeltaNet + attention), `*.nextn_predict_layers` (MTP-голова), `general.file_type`
(квант), число тензоров, наличие `blk.N.ffn_*_exps` (MoE по тензорам),
размер файла, `tokenizer.chat_template` (для превью и списка
`reasoning_effort`). Пара `mmproj-*.gguf` — по имени в той же папке.

### Калькулятор памяти (то, чего нет у LM Studio)

Формулы, проверенные на этой машине:

- **веса** = размер файла (mmap) × `repack ? ~1.3 : 1.0` для CPU-части;
- **KV на токен** = `2 · n_kv_heads · head_dim · bytes(cache_type) · n_attn_layers`,
  где для гибридов `n_attn_layers = block_count / full_attention_interval`
  (Qwen3.8-27B: 16 из 65 → 64 КБ/токен в f16, 16 ГиБ на 262144);
- **compute-буферы** ≈ 0.6–1.0 ГиБ (растут с `-ub`, `-b`, контекстом);
- **iGPU (UMA)**: доступно устройству = выделенное BIOS + ~½ RAM (780M:
  4 + 14 = 18.3 ГБ, совпало с `--list-devices`); и это **та же RAM**, не
  добавка — потолок для вердикта всё равно общая RAM;
- **дискретная GPU**: потолок устройства = VRAM; хост — RAM;
- **вердикт**: `fits` / `tight` (< 2 ГБ запаса) / `wont_fit`, всегда с
  формулировкой причины и с предложением (снизить контекст, включить
  `--no-kv-offload`, квантовать KV, взять квант поменьше).

Железо снимается один раз: RAM (`os.totalmem`), GPU через `--list-devices`
выбранного рантайма, UMA-признак — из строки Vulkan (`uma: 1`).

### ServerController

```
idle → starting → ready → stopping → idle
          │            └→ crashed (код выхода, последняя ошибка из лога)
          └→ failed  (allocation of size N failed / OutOfDeviceMemory /
                      exit 0xC0000409 / unknown architecture / port busy)
```

- Готовность — по строке `listening on` в stderr **и** `GET /health` = ok.
- Сироты: перед стартом сканировать процессы `llama-server.exe`; на выходе
  приложения — tree-kill; pid-файл на случай падения самого приложения.
- Парсер логов: `print_timing` → t/s промпта/генерации, `n_gen`; строки
  `model buffer size` → фактическое распределение GPU/host — показывать в UI
  рядом с оценкой (оценка vs факт — так калькулятор калибруется).
- Команда всегда собирается из реестра флагов; превью в UI — та же функция
  `buildArgs(profile)`. Что видишь, то и запускается.

### Чат

- SSE напрямую из renderer; `reasoning_content` → сворачиваемый блок;
  `timings` из ответа → бейдж «prompt 27.8 t/s · gen 3.3 t/s · 250 tok».
- `chat_template_kwargs`: `reasoning_effort` (у Qwen3.8 — low/medium/xhigh;
  список берётся из шаблона модели), `enable_thinking`.
- Картинки → `image_url` (data:) при наличии mmproj в профиле.
- Tools (M5): `GET /tools` → определения в запрос; исполняет сервер;
  подтверждение Allow/Deny — через `/v1/chat/completions/control` (маршрут
  есть в b10826; протокол уточнить по исходникам web UI llama.cpp).
  MCP — редактор JSON в формате Cursor, передаётся через
  `--mcp-servers-config`. `exec_shell_command` по умолчанию **выключен**,
  включение — с предупреждением; `--tools-runtime docker:` как опция.

### Режим провайдера (для Code Monet)

- Профиль «Provider»: `--alias`, `--api-key`, порт, `-np`, headless-старт в
  трей, автозапуск с Windows.
- Карточка «Подключить к Code Monet»: Base URL / key / model name с кнопками
  копирования. Code Monet уже умеет OpenAI-совместимый провайдер с
  `reasoning_content`, tools и «Load models from this endpoint» — на его
  стороне ничего специального не нужно.
- Позже: deep link `codemonet://add-provider?…` — только если понадобится.

---

## 3. Экраны

Сайдбар слева (как в Code Monet): **Chat · Models · Server · Runtimes ·
Benchmark · Settings**. Справа — панель настроек профиля, доступная с любого
экрана (как у LM Studio, но полная).

**Chat.** Список чатов · сообщения · композер с выбором профиля/модели,
reasoning effort, вложения · бейджи t/s · индикатор заполнения контекста.

**Models.** Папки · таблица GGUF (имя, квант, размер, архитектура, MoE/dense,
контекст, vision, MTP) · карточка модели с метаданными · вкладка HF-поиска:
репозиторий → таблица квантов с размером и **вердиктом калькулятора для
текущего железа** → скачать (resume, параллельные range-запросы, sha256).

**Server.** Статус · Start/Stop/Restart · командная строка (копировать) ·
живой лог с фильтром · факт распределения памяти · слоты · «Open llama.cpp UI».

**Runtimes.** Установленные паки с версиями · доступные в релизах · «свой
пак» · устройства (`--list-devices`) · выбор по умолчанию · «проверить»
(запуск с крошечной моделью-фикстурой).

**Benchmark.** Модель + два профиля → `llama-bench` (pp/tg) → таблица,
история, дельта. Пресеты «CPU vs GPU», «ngl sweep», «KV f16 vs q8_0»,
«квант A vs квант B».

**Settings.** Папки моделей, тема (light/dark, Monet-фон), язык (ru/en), порт
по умолчанию, автозапуск, обновления, экспорт/импорт профилей.

Панель профиля: группы Model · Context · Memory · GPU · Sampling · Reasoning ·
Speculative · Tools & MCP · Server · Advanced. Каждый флаг: подпись,
подсказка «зачем», текущее значение, «рекомендуется» при срабатывании
`recommendWhen`. Внизу — вердикт калькулятора и превью команды.

---

## 4. Вехи

**M0 — каркас (1–2 дня).** electron-vite + React + TS + Tailwind 4; перенос
`globals.css`, шрифта Bounded, `components/ui`, `WindowControls`, иконок;
пустые экраны с навигацией; i18n-каркас (ru/en); `npm run package` → NSIS
exe; GitHub Actions собирает exe на каждый tag. *Готово, когда exe ставится и
открывает окно в стиле Monet.*

**M1 — рантаймы и модели (2–3 дня).** RuntimeManager (таблица ассетов,
скачивание, распаковка, «свой пак», `--list-devices`); GGUF-ридер;
ModelLibrary с индексом; экраны Runtimes и Models (без HF). *Готово, когда
приложение видит `D:\Colibri\models` и показывает архитектуру/квант/KV на
токен.*

**M2 — профили и сервер (3–4 дня).** Реестр флагов; панель профиля; превью
команды; Estimator; ServerController с парсером логов; экран Server.
*Готово, когда профиль «8192 / Vulkan» стартует Qwen3.8-27B и UI показывает
4.3 t/s из логов, а профиль «262144 без --no-kv-offload» ещё до запуска
говорит «не влезет: KV 16 ГиБ + веса 15.65 > 27.7».*

**M3 — чат (2–3 дня).** SSE-стриминг, reasoning-блок, t/s-бейджи, история,
`reasoning_effort`, картинки при mmproj. *Готово, когда можно жить в нём
вместо web UI llama.cpp.*

**M4 — провайдер и бенчмарк (2 дня).** Профиль Provider, трей, автозапуск,
карточка Code Monet; экран Benchmark на llama-bench с историей.

**M5 — tools и MCP (2–3 дня).** `/tools`, Allow/Deny, рабочая папка,
MCP-конфиг, tools-runtime. *Готово, когда «прочитай calc.py и найди баг»
проходит в нашем чате, как прошло во встроенном UI.*

**M6 — HF-загрузчик и полировка (2–3 дня).** Поиск, таблица квантов с
вердиктом, resume, очередь; парсер `--help` для новых флагов; локализация;
electron-updater; README с GIF; первый релиз `v0.1.0`.

Оценки — для одного агента, без ожидания скачиваний.

---

## 5. Бэкенды без железа (CUDA, ROCm, SYCL, …)

Проверить нельзя, значит — сделать так, чтобы нечему было ломаться
специфично для бэкенда:

1. Вся логика рантайма бэкенд-агностична: пак = zip + (опционально) зависимый
   zip + имя exe + парсер `--list-devices`. Бэкенды отличаются только строками
   в таблице ассетов.
2. Флаги GPU (`-ngl`, `-sm`, `-ts`, `-mg`, `--device`) — в реестре с
   `visibleWhen: hw.devices.length > 0`; multi-GPU поля — при `> 1`. На
   Vulkan-машине они проверяются тем же кодом.
3. `--list-devices` парсится по regex, устойчивому к форматам
   (`Vulkan0: AMD Radeon 780M Graphics (18287 MiB, 17373 MiB free)` /
   `CUDA0: NVIDIA … (24564 MiB, …)` / `SYCL0: …`); фикстуры — в тестах.
4. Юнит-тесты RuntimeManager — на записанном JSON релиза
   (`docs/reference/release-b10826.json`), без сети.
5. В UI у непроверенного пака бейдж «untested» и ссылка «сообщить» до первого
   подтверждения от пользователя с таким железом.
6. Estimator для дискретной GPU: `available = VRAM`; признак — `uma: 0` в
   строке устройства.

---

## 6. Тесты

- **vitest** на чистых модулях: `buildArgs`, GGUF-ридер (фикстуры — заголовки
  реальных файлов, первые 2 МБ), Estimator (таблица кейсов из Приложения A —
  измеренные факты как assert'ы), парсер логов, парсер `--list-devices`,
  RuntimeManager на записанном релизе.
- **smoke-пробы** в духе monet (`scripts/*-probe.ts`): старт/стоп сервера с
  крошечной моделью-фикстурой (~30 МБ GGUF из HF, качается один раз в
  `out-fixtures/`), `/health`, один запрос, парсинг t/s.
- **typecheck** как gate (`scripts/typecheck.mjs` из monet, без долга).

---

## 7. Открытые вопросы (обсудить до M0)

1. **Чат: нативный с M3 или сначала встроенный UI llama.cpp в `<webview>`?**
   Рекомендация — нативный, встроенный как кнопка-fallback.
2. **Рантаймы в exe:** Vulkan + CPU внутри (50 МБ) или всё по требованию?
   Рекомендация — внутри, чтобы первый запуск работал офлайн.
3. **Брендинг:** тот же `--brand-hue: 211` или свой оттенок, чтобы в панели
   задач отличать от Code Monet? Иконка?
4. **Интеграция с Code Monet в v1:** карточка с полями (рекомендация) или
   сразу deep link?
5. **Несколько серверов одновременно** — точно вне v1?
6. **Язык интерфейса по умолчанию:** ru или en? (i18n закладываем в M0.)

---

## Приложение A. Измерено на этой машине

Ryzen 7 7840HS · 2×16 ГБ DDR5-5600 · Radeon 780M (UMA, 4 ГБ выделено, 18.3 ГБ
видит Vulkan) · Windows 10 · llama.cpp b10826 Vulkan.
Модель: Qwen3.8-27B Q4_K_M, 16.81 ГБ, плотная гибридная (65 слоёв, 16 — полное
внимание, 49 — DeltaNet), 24 головы / 4 KV, head_dim 256, MTP-голова есть,
контекст 262144.

| конфигурация | prompt t/s | gen t/s | вывод |
|---|---|---|---|
| CPU (`-dev none`), 8192 | 4.7 | 2.8 | база без GPU |
| Vulkan, 8192, KV на GPU | 49.2 | **4.48** (bench) / 4.31 (сервер) | лучший профиль |
| Vulkan, 16384…131072, KV на GPU | — | FAIL | стенка GTT, не KV |
| Vulkan, 32768, `--no-kv-offload` | — | OK, 8.2 ГБ свободно | — |
| Vulkan, 262144, nkvo, K q8_0 / V q4_0 | 27.8 | 3.32 | полный контекст живёт |
| repack включён (по умолчанию) | — | своп, 0 токенов | `--no-repack` обязателен |
| `--spec-type draft-mtp` на GPU | — | не стартует | +1 ГБ в GTT нет |
| `--spec-type draft-mtp` + nkvo | **1.40** | — | в 17× хуже базы |
| `--spec-type ngram-mod` | 25.5 | 4.39 | +2.5%, шум |
| mmproj на GPU поверх весов | — | OutOfDeviceMemory | `--no-mmproj-offload` |

Потолок генерации ≈ 4.3 t/s = полоса DDR5 (~90 ГБ/с) / 16 ГБ весов на токен;
ускоряет только меньше байт на токен (квант) — не больше RAM.

## Приложение B. Что скопировать из monet и откуда

| что | откуда (`D:\Projects\monet\desktop\`) |
|---|---|
| токены и обе темы, шрифтовые стеки | `src/renderer/styles/globals.css` |
| шрифт Bounded | `src/renderer/fonts/Bounded-Variable.ttf` |
| shadcn-компоненты | `src/renderer/components/ui/*` |
| frameless-окно | `src/renderer/components/WindowControls.tsx`, `src/main/app/main-window.ts` |
| иконки hugeicons | `src/renderer/components/icons/*`, `scripts/build-hugeicons-subset.mjs` |
| фон-картины | `src/renderer/components/useMonetBackground.ts` |
| dev/typecheck скрипты | `scripts/dev-quiet.mjs`, `scripts/typecheck.mjs` |
| сборка | `electron-builder.yml`, `electron.vite.config.ts` (без vendor-магии) |
| контракт провайдера (совместимость) | `src/main/llm/openai-compat-client.ts`, `src/main/provider/types.ts` |
