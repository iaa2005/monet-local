# Monet Local — план

**Только сервер.** Monet Local управляет `llama-server` из llama.cpp: рантаймы
под любой бэкенд, библиотека моделей, все флаги с объяснением и расчётом
памяти, бенчмарк, и наружу — два API: OpenAI-совместимый и
Anthropic-совместимый. Чата нет. Web UI llama.cpp, tools и MCP выключены и не
пробрасываются — сервер не тратит на них ничего.

Загрузкой и выгрузкой моделей управляет **только Monet Local**. Клиент (в
первую очередь Code Monet) выбирает «Monet Local», получает список
**загруженных** моделей со всеми данными и ничего не настраивает.

Дизайн и стек — из Code Monet (`github.com/iaa2005/monet`, клон в
`D:\Projects\monet`). Рабочая папка — `D:\Projects\monet-local`.

---

## 0. Зачем, если есть LM Studio

За неделю с Qwen3.8-27B на 32 ГБ RAM + Radeon 780M мы упёрлись в то, чего в
LM Studio либо нет, либо оно спрятано:

| проблема | что было | чего не хватало |
|---|---|---|
| ответ 5–6 часов | контекст 262144 по умолчанию, GPU 0, своп | честная оценка «влезет / не влезет» **с причиной** |
| repack удваивает веса в RAM | `0xC0000409` на старте, своп | флага `--no-repack` в LM Studio нет вообще |
| iGPU не тянет контекст > 8k | падение на выделении 549 МБ | понимания, что стенка — GTT; `--no-kv-offload` решает |
| MTP «ускоряет» до 1 t/s | Speculative Decoding = MTP включён по умолчанию | замера: на этом железе MTP хуже базы в 17 раз |
| два `llama-server` дерутся за RAM | 103 МБ свободно, 300k pages/sec | контроля сироток и предупреждения «уже запущен» |
| CLI неудобен для перебора | `run.cmd` с переменными | форма + превью команды + A/B бенчмарк |

---

## 1. Решения

### D1. `llama-server.exe` как подпроцесс, всегда с `--no-webui`

llama-server уже умеет всё: OpenAI API, **Anthropic Messages API**
(`/v1/messages`, `/v1/messages/count_tokens` — есть в b10826), стриминг,
`reasoning_content`, `--list-devices`, `/props`, `/slots`, `/metrics`.
Обновление llama.cpp = подменить zip. Никакой нативной сборки.

Web UI отключается флагом `--no-webui`. Tools, MCP, `--agent` — не включаются
никогда и в реестр флагов не входят (только через `expert`-строку, на свой
риск).

### D2. Router-режим llama-server — одна «мама», дети по модели

Проверено вживую на b10826 (`D:\Colibri\logs\router.log`): `llama-server`
без `-m`, с `--models-preset <ini>` и `--no-models-autoload`, поднимает
**роутер**, который по команде спавнит дочерний `llama-server --port 0` на
модель, наследуя свои флаги и добавляя флаги из секции INI. Несколько моделей
могут быть загружены одновременно (`--models-max N`).

Что это даёт Monet Local:

- **загрузка/выгрузка — HTTP-команды**, не перезапуск процесса:
  `POST /models/load {"model": id}` → `{"success": true}` (асинхронно, статус
  `loading` → `loaded`), `POST /models/unload {"model": id}` (недогруженную
  принудительно убивает, «exited with status 99»);
- `GET /models` — все известные модели со `status.value`
  (`unloaded | loading | loaded`), `status.args` (точная команда ребёнка),
  `status.preset` (его INI), `architecture.input_modalities` (vision по
  mmproj — сервер определяет сам);
- запрос к незагруженной модели при выключенном autoload — чистый
  `400 {"error": {"message": "model 'X' not found"}}`, никакой магии;
- **INI-пресет = профиль Monet Local.** Ключи = имена CLI-флагов без дефисов
  (`n-gpu-layers = 8`, `c = 8192`, булевы — `repack = 0`, `webui = 0`),
  секция `[*]` — общие, `[<model-id>]` — на модель; служебные:
  `load-on-startup`, `stop-timeout`. Monet Local **генерирует INI из
  профилей**, `--models-dir` не используется: его эвристика считает папку
  одной моделью и на `Qwen3.8-27B-GGUF\` выбрала Q6_K (22 ГБ) — ровно ту,
  что не влезает.

Роутер живёт всё время работы Monet Local; смена набора моделей/профилей —
перезапись INI и перезапуск роутера (детей нет — это секунда). Сироты
контролируются на двух уровнях: роутер и дети.

Запасной режим `single`: если router-режим сломается в новой сборке, тот же
`ServerController` умеет обычный `llama-server -m … --port 17172` на одну
модель. Переключатель в Settings → Advanced.

### D3. Один порт наружу: management API + прокси

Клиент видит **одну** точку: `http://127.0.0.1:17171`. Внутри:

- Node-сервер в main на `17171`: `/monet-local/v1/*` — свой API;
  `/v1/*` — reverse-proxy на роутер (`17172`, только localhost), SSE
  прозрачно.
- Прокси **фильтрует `/v1/models` до `status = loaded`** — стандартный клиент
  видит только то, чем можно пользоваться. Полный список со статусами —
  в `/monet-local/v1/models`.
- Никакой JIT-загрузки: запрос к незагруженной модели пробрасывает `400` от
  роутера как есть, плюс заголовок `X-Monet-Local-Hint: load it in Monet Local`.
- Ключ и режим доступа по сети проверяются здесь.

Зачем прокси, а не голый роутер: один адрес и ключ на всё, `/v1/models`
только с рабочими моделями, сетевой гейт в одном месте, и наш API рядом —
клиенту не нужно знать про два порта.

**Доступ по сети** («LAN»): по умолчанию `17171` слушает только
`127.0.0.1` — этот компьютер. Тумблер «Доступ по сети» переводит на
`0.0.0.0` — тогда Monet Local на этом ПК виден другим машинам в домашней/
офисной сети по `http://<ip-этого-пк>:17171`. Это и есть сценарий «несколько
Monet Local с разных компов» в Code Monet. При включении API-ключ становится
обязательным, иначе любой в той же сети гоняет вашу модель.

### D4. Рантаймы — таблица ассетов + «свой пак»

llama.cpp собирает под всё (BLAS, BLIS, CANN, CUDA, HIP, Hexagon, zDNN, MUSA,
Metal, OpenCL, OpenVINO, RPC, SYCL, VirtGPU, Vulkan, WebGPU, ZenDNN). Менеджер
знает про бэкенд только строку таблицы: `zip + (опц.) второй zip + имя exe +
парсер --list-devices`.

Готовые Windows-паки в релизах `ggml-org/llama.cpp` (b10826):

| пак | ассет | размер | доп. |
|---|---|---|---|
| CPU x64 / arm64 | `llama-<b>-bin-win-cpu-{x64,arm64}.zip` | 17 / 11 МБ | — |
| Vulkan | `llama-<b>-bin-win-vulkan-x64.zip` | 33 МБ | — |
| CUDA 12.4 | `llama-<b>-bin-win-cuda-12.4-x64.zip` | 242 МБ | `cudart-…-12.4-x64.zip` 373 МБ |
| CUDA 13.3 | `llama-<b>-bin-win-cuda-13.3-x64.zip` | 142 МБ | `cudart-…-13.3-x64.zip` 372 МБ |
| CUDA 13.4 arm64 | `llama-<b>-bin-win-cuda-13.4-arm64.zip` | 136 МБ | `cudart-…-13.4-arm64.zip` |
| HIP / ROCm 10 | `llama-<b>-bin-win-rocm-10.0-x64.zip` | 232 МБ | драйвер AMD |
| SYCL | `llama-<b>-bin-win-sycl-x64.zip` | 114 МБ | oneAPI runtime |
| OpenVINO | `llama-<b>-bin-win-openvino-2026.3.1-x64.zip` | 76 МБ | — |
| OpenCL Adreno | `llama-<b>-bin-win-opencl-adreno-arm64.zip` | 12 МБ | — |

Чего в релизах под Windows нет (CANN, MUSA, Hexagon, WebGPU, ZenDNN,
BLAS-варианты, Metal) — **«свой пак»**: указать папку с `llama-server.exe`;
приложение проверит `--version` и `--list-devices` и добавит наравне с
остальными. **RPC** — режим, не пак: `ggml-rpc-server.exe` лежит в каждом
zip, флаг `--rpc host:port` в группе `advanced`.

В exe едут **Vulkan + CPU** (50 МБ, первый запуск офлайн); остальное — по
кнопке. Несколько версий одного бэкенда живут рядом (откат).

### D5. Реестр флагов — единственный источник правды

Один TypeScript-реестр (zod) → форма, превью INI-секции и команды ребёнка,
пресеты, валидация, калькулятор. Уровни `basic` / `advanced` / `expert`.
Группы: model, context, memory, gpu, sampling, reasoning, speculative, server,
advanced. Справочник — `docs/reference/llama-server-help.txt` (b10826).

```ts
noKvOffload: {
  flag: '--no-kv-offload', ini: 'kv-offload = 0',
  group: 'memory', type: 'bool', default: false,
  label: { en: 'Keep KV cache in system RAM', ru: 'KV-кэш в системной RAM' },
  help:  { en: 'On an iGPU this is what lets context grow past ~8k: the wall is the device buffer limit, not the cache size.',
           ru: 'На iGPU именно это позволяет контексту вырасти за ~8k: стенка — лимит буферов устройства, а не размер кэша.' },
  recommendWhen: (s, hw) => hw.gpu.uma && s.ctxSize > 8192,
},
```

### D6. Модели лежат там, где лежат; загрузки — отдельно

Библиотека = список папок + индекс метаданных в userData. Никаких
копирований. **Загрузки идут в `%APPDATA%/monet-local/downloads/*.part`** и
переезжают в папку моделей только целиком: роутер подхватил недокачанный
`IQ4_XS.gguf` из `D:\Colibri\models` как модель и попытался грузить.

### D7. Windows-first, кроссплатформенно по коду

### D8. Стек и дизайн = Code Monet, с отличиями

Electron 33 · electron-vite 2 · React 19 · TypeScript 5.6 · Tailwind 4 ·
shadcn/react + radix-ui · zustand · zod · electron-builder 25 (NSIS) ·
electron-updater (GitHub Releases `iaa2005/monet-local`).

Копируется как есть: `globals.css` (токены, обе темы, радиусы, шрифтовые
стеки), `fonts/Bounded-Variable.ttf`, `components/ui/*`,
`WindowControls.tsx`, dev/typecheck-скрипты.

Отличия от Code Monet:
- **Иконки — только lucide-react.** Без hugeicons/@iconify.
- **Без фона-картин.**
- **Бренд — оранжевый:** `oklch(67.1967% 0.201986 42.2057)` = `#f65e00` =
  `hsl(23 100% 48%)`. `--brand` объявляется напрямую в oklch, производные
  (`--link`, `--brand-wash`, `--brand-edge`) — через `color-mix()`. Проверить
  контраст ссылки на светлой канве (AA ≥ 4.5:1); `--link` скорее всего
  придётся затемнить.
- **Иконка приложения:** `build/icon-source.png` (585×585). В M0 — ресайз до
  512/1024, `build/icon.png` + `build/icon.ico`.
- **Язык:** en и ru, i18n с M0; подписи и подсказки флагов — в реестре на
  обоих языках.

---

## 2. Архитектура

```
клиенты (Code Monet, Claude Code через ANTHROPIC_BASE_URL, curl, …)
        │  http://127.0.0.1:17171   (сеть: http://<host>:17171 + ключ)
┌───────▼─────────────────────── main (Node) ───────────────────────────┐
│ ManagementServer  /monet-local/v1/*  info · models · status · events   │
│ Proxy             /v1/* → роутер:17172; /v1/models только loaded       │
│                   ключ, сетевой гейт                                   │
│ RouterController  генерирует INI из профилей, держит роутер, load/     │
│                   unload через его HTTP, следит за детьми, сироты       │
│ RuntimeManager    таблица ассетов, скачать/проверить, свой пак,         │
│                   --list-devices                                        │
│ ModelLibrary      папки, GGUF-метаданные, пары mmproj, индекс, slug-id  │
│ Downloader        HF: resume, range-параллель, sha256, .part → переезд  │
│ Estimator         память из GGUF + профиль + железо → verdict + why     │
│ Bench             llama-bench, история, A/B                             │
│ Settings          профили, app settings, миграции                       │
│ Tray/Autostart    headless-режим                                        │
│ Updater           electron-updater                                      │
└──────────────┬── preload: window.local.* (typed) ──────────────────────┘
               │ ipc
┌──────────────▼── renderer (React, lucide) ─────────────────────────────┐
│ stores: runtime · models · server · bench · ui (zustand)               │
│ экраны: Server · Models · Runtimes · Benchmark · Integrations · Settings│
└────────────────────────────────────────────────────────────────────────┘
```

### Management API (`/monet-local/v1`) — только чтение снаружи

Загрузка/выгрузка через HTTP **не** выставляется: управлять моделями можно
только из окна Monet Local. Клиентам — статус и данные.

| метод | путь | что |
|---|---|---|
| GET | `/info` | `{name, version, machine, llamaBuild, backend, capabilities:{openai, anthropic}}` |
| GET | `/models` | вся библиотека: `[{id, path, arch, quant, sizeBytes, ctxMax, kvBytesPerToken, vision, moe, mtp, status: unloaded\|loading\|loaded, profile, verdict:{fits, reason}}]` |
| GET | `/status` | `{routerState, loaded:[id], lastTimings}` |
| GET | `/events` | SSE: `models-changed`, `status`, `timings` — чтобы клиент не опрашивал |

`id` модели = стабильный slug из имени файла (`qwen3.8-27b-q4_k_m`), он же
`model` в OpenAI/Anthropic-запросах и имя секции в INI.

### Данные

```
%APPDATA%/monet-local/
├── settings.json      папки, тема, язык, порты, сеть, ключ (DPAPI)
├── profiles/*.json    наборы флагов (+ модель, + рантайм)
├── router/models.ini  сгенерировано из профилей, не редактировать руками
├── runtimes/<backend>-<build>/
├── downloads/*.part   незавершённые загрузки
├── index/models.json  кэш GGUF-метаданных (путь+mtime+size)
├── bench/*.json
└── logs/router-*.log, child-<id>-*.log
```

### GGUF-ридер (порт `gguf_meta.py`)

Только заголовок. Достаёт: `general.architecture`, `*.block_count`,
`*.context_length`, `*.attention.head_count(_kv)`, `*.attention.key_length /
value_length`, `*.expert_count`, `*.ssm.*` + `*.full_attention_interval`
(гибриды), `*.nextn_predict_layers` (MTP), `general.file_type`, наличие
`blk.N.ffn_*_exps`, `tokenizer.chat_template` (из него — поддержка
`reasoning_effort` / `enable_thinking` для клиента). Пара `mmproj-*.gguf` — по
имени в папке; в INI ребёнка — `mmproj = <path>` и `mmproj-offload = 0`
(проверено: проектор поверх весов на iGPU не влезает).

### Калькулятор памяти

- веса = размер файла × (`repack ? ~1.3 : 1.0`) для CPU-части;
- KV/токен = `2 · n_kv_heads · head_dim · bytes(cache_type) · n_attn_layers`,
  гибриды: `n_attn_layers = block_count / full_attention_interval`
  (Qwen3.8-27B: 16 из 65 → 64 КБ/токен f16, 16 ГиБ на 262144);
- compute-буферы ≈ 0.6–1.0 ГиБ;
- iGPU (UMA): устройству доступно `выделенное + ~½ RAM`, и это та же RAM —
  потолок вердикта = общая RAM; дискретная GPU: потолок устройства = VRAM;
- **несколько загруженных моделей суммируются** — вердикт для «загрузить ещё
  и эту» считается от уже занятого;
- вердикт `fits / tight / wont_fit` **с причиной и предложением**.

### RouterController

`stopped → starting → ready → stopping`, ветки `failed` / `crashed`. Для
каждой модели — `unloaded → loading → loaded` из `GET /models` роутера
(опрос 1 с во время загрузки + `/events` наружу). Готовность роутера —
`listening on` в логе **и** `/health`. Готовность модели — `status = loaded`
**и** первый `/v1/models` с ней. Сироты — скан `llama-server.exe` до старта,
tree-kill роутера с детьми на выходе, pid-файлы. Парсер логов детей:
`print_timing` → t/s; `model buffer size` → факт памяти рядом с оценкой;
`allocation of size N failed` / `OutOfDeviceMemory` / `0xC0000409` → причина
провала в UI.

---

## 3. Экраны

Сайдбар: **Server · Models · Runtimes · Benchmark · Integrations · Settings**.
Справа — панель профиля (группы флагов, вердикт, превью INI-секции и команды),
с любого экрана.

**Server.** Состояние роутера · список загруженных моделей (профиль, память
факт/оценка, t/s последних запросов, кнопка «выгрузить») · адрес и ключ ·
живой лог с фильтром по ребёнку · слоты.

**Models.** Папки · таблица GGUF (квант, размер, архитектура, dense/MoE,
контекст, vision, MTP, вердикт, статус) · карточка · **«Загрузить с профилем …»**
/ «Выгрузить» · вкладка **Hugging Face**: поиск → репозиторий → таблица
GGUF-файлов с размером и **вердиктом калькулятора для этого железа** →
скачать в выбранную папку (очередь, скорость/ETA, пауза, докачка после
обрыва range-запросами, sha256 по метаданным HF, предложение забрать
`mmproj-*.gguf` вместе с моделью; gated-репозитории — через HF-токен из
Settings).

**Runtimes.** Установленные паки · релизы · свой пак · устройства · выбор по
умолчанию · «проверить» с крошечной моделью-фикстурой.

**Benchmark.** Модель + два профиля → `llama-bench` (pp/tg) → таблица,
история, дельта. Пресеты: CPU vs GPU, ngl sweep, KV f16 vs q8_0, квант A vs B.

**Integrations.** Карточки: **Code Monet** («выберите провайдера Monet Local —
адрес подставится сам»; для другой машины — адрес и ключ с копированием),
**Anthropic-совместимые клиенты** (`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`),
**OpenAI-совместимые** (Base URL, key). Тумблер «Доступ по сети» с
объяснением и обязательным ключом.

**Settings.** Папки моделей (список; одна помечена как папка загрузок по
умолчанию; папки LM Studio можно подключить только для чтения), HF-токен для
gated-репозиториев, тема, язык (en/ru), порты, автозапуск/трей, обновления,
экспорт/импорт профилей, Advanced: режим `router | single`, `--models-max`.

---

## 4. Часть 2 — изменения в Code Monet (`iaa2005/monet`)

Цель: пользователь выбирает «Monet Local» и больше ничего не настраивает.
Список моделей у такого провайдера **живой**: что загружено в Monet Local
сейчас — то и есть. Этого в Code Monet ещё не было; вводится флаг вида
провайдера.

1. `src/main/provider/types.ts`: `ProviderKind` += `'monet-local'`; у
   вида — `dynamicModels: true` (список не хранится как истина, а
   обновляется с сервера).
2. Форма провайдера: имя, **Base URL с дефолтом `http://127.0.0.1:17171`**
   (редактируемый — для другой машины в сети), ключ (пусто для localhost).
   Кнопка «Найти на этом компьютере» → `/monet-local/v1/info`.
3. `src/main/llm/fetch-models.ts`: для `monet-local` — `/monet-local/v1/models`,
   в список попадают только `status = loaded`; поля: `contextLength`
   (ctxMax профиля), `modalities` (`image` при vision), `supportsEffort` (по
   шаблону), `maxOutput`. Обновление: при открытии выбора модели, перед
   отправкой (кэш 5 с) и по `/events` (`models-changed`) — подписка живёт,
   пока провайдер выбран.
4. Если выбранная в чате модель выгружена в Monet Local — не падать в
   отправке, а показать «модель не загружена в Monet Local» с кнопкой
   «обновить список». Если сервер недоступен — провайдер помечается офлайн,
   последний список остаётся в сером.
5. Транспорт — существующий `openai-compat-client.ts` (reasoning_content и
   tools уже есть).
6. Несколько провайдеров этого вида — по одному на машину; в списке моделей
   имя провайдера рядом с моделью.
7. `docs/content/configuration/01-providers.md`: раздел «Monet Local».
8. Fallback: `/monet-local/v1/*` не отвечает, но `/v1/models` есть → обычный
   OpenAI-совместимый провайдер (старая версия или чужой сервер).

---

## 5. Вехи

**M0 — каркас (1–2 дня).** electron-vite + React + TS + Tailwind 4; перенос
`globals.css` с заменой бренда на оранжевый, Bounded, `components/ui`,
`WindowControls`; lucide; i18n en/ru; иконка → `icon.png`/`icon.ico`; пустые
экраны; `npm run package` → NSIS exe; GitHub Actions на tag. *Готово: exe
ставится, открывает оранжевое окно в стиле Monet на двух языках.*

**M1 — рантаймы и модели (2–3 дня).** RuntimeManager (таблица, скачивание,
свой пак, `--list-devices`); GGUF-ридер; ModelLibrary со slug-id; экраны
Runtimes и Models (без HF). *Готово: видит `D:\Colibri\models`, показывает
архитектуру, квант, KV на токен.*

**M2 — профили, калькулятор, роутер (3–4 дня).** Реестр флагов; панель
профиля; генерация INI; Estimator; RouterController (`--no-webui`,
`--no-models-autoload`); load/unload из UI; экран Server; живая проверка
`/v1/chat/completions` **и** `/v1/messages` через роутер. *Готово: профиль
«8192 / Vulkan» грузит Qwen3.8-27B и показывает 4.3 t/s; профиль «262144 без
nkvo» до загрузки говорит «не влезет: KV 16 ГиБ + веса 15.65 > 27.7».*

**M3 — management API и прокси (2 дня).** `/monet-local/v1/*`, `/events`,
прокси `/v1/*` с SSE и фильтром `loaded`, ключ, доступ по сети, трей,
автозапуск, экран Integrations. *Готово: Claude Code с
`ANTHROPIC_BASE_URL=http://127.0.0.1:17171` и curl на `/v1/chat/completions`
работают; `/v1/models` показывает только загруженные.*

**M4 — Code Monet (2–3 дня, в репо `monet`).** Provider kind `monet-local` с
`dynamicModels`, форма с дефолтом, discovery, живой список, офлайн-состояние,
docs. *Готово: «Add provider → Monet Local → Save» без единого поля, модели
появляются и исчезают вслед за Monet Local, чат идёт.*

**M5 — бенчмарк и HF-загрузчик (2–3 дня).** llama-bench, история, A/B; HF
поиск/кванты/вердикт, `.part` + переезд, очередь.

**M6 — полировка и релиз (1–2 дня).** updater, парсер `--help` новых сборок,
README с GIF, `v0.1.0`.

---

## 6. Бэкенды без железа

1. Логика рантайма бэкенд-агностична; бэкенд = строка таблицы.
2. GPU-флаги видны по `hw.devices.length`, multi-GPU (`-sm`, `-ts`, `-mg`) —
   при `> 1`; проверяются на Vulkan тем же кодом.
3. `--list-devices` — regex с фикстурами `Vulkan0: … (18287 MiB, …)`,
   `CUDA0: NVIDIA … (24564 MiB, …)`, `SYCL0: …`.
4. Тесты RuntimeManager — на `docs/reference/release-b10826.json`, без сети.
5. Бейдж «untested» у пака до подтверждения пользователем с таким железом.
6. Estimator: дискретная GPU → потолок VRAM (`uma: 0`).

## 7. Тесты

vitest на чистых модулях (`buildIni`/`buildArgs`, GGUF-ридер на заголовках
реальных файлов, Estimator на Приложении A как assert'ах, парсеры логов и
устройств, RuntimeManager, прокси-фильтр `/v1/models` на записанном ответе
роутера из `docs/reference/router-models-b10826.json`); smoke-пробы в духе
monet (роутер + load/unload крошечной фикстуры, `/health`, один запрос по
каждому API); typecheck-gate.

## 8. Решено

- Порт `17171` (роутер внутри на `17172`).
- Доступ по сети выключен по умолчанию; при включении ключ обязателен.
- Без JIT: загрузкой управляет только Monet Local; клиенты видят живой
  список загруженных.

---

## Приложение A. Измерено на этой машине

Ryzen 7 7840HS · 2×16 ГБ DDR5-5600 · Radeon 780M (UMA, 4 ГБ выделено, 18.3 ГБ
видит Vulkan) · Windows 10 · llama.cpp b10826 Vulkan. Qwen3.8-27B Q4_K_M,
16.81 ГБ, плотная гибридная (65 слоёв, 16 полного внимания, 49 DeltaNet),
24 головы / 4 KV, head_dim 256, MTP-голова есть, контекст 262144.

| конфигурация | prompt t/s | gen t/s | вывод |
|---|---|---|---|
| CPU (`-dev none`), 8192 | 4.7 | 2.8 | база без GPU |
| Vulkan, 8192, KV на GPU | 49.2 | **4.48** / 4.31 | лучший профиль |
| Vulkan, 16384…131072, KV на GPU | — | FAIL | стенка GTT, не KV |
| Vulkan, 32768, `--no-kv-offload` | — | OK, 8.2 ГБ свободно | — |
| Vulkan, 262144, nkvo, K q8_0 / V q4_0 | 27.8 | 3.32 | полный контекст живёт |
| repack включён | — | своп | `--no-repack` обязателен |
| `--spec-type draft-mtp` на GPU | — | не стартует | +1 ГБ в GTT нет |
| `--spec-type draft-mtp` + nkvo | **1.40** | — | в 17× хуже базы |
| `--spec-type ngram-mod` | 25.5 | 4.39 | шум |
| mmproj на GPU поверх весов | — | OutOfDeviceMemory | `--no-mmproj-offload` |

Router-режим b10826: `POST /models/load` / `/models/unload` с `{"model": id}`
→ `{"success": true}`; `GET /models` со `status.value`, `status.args`,
`status.preset`; незагруженная при `--no-models-autoload` → `400 model not
found`; дети — `llama-server --port 0` с унаследованными флагами.

Потолок генерации ≈ 4.3 t/s = полоса DDR5 (~90 ГБ/с) / 16 ГБ весов на токен.

## Приложение B. Что брать из monet (`D:\Projects\monet\desktop\`)

| что | откуда |
|---|---|
| токены, темы, шрифтовые стеки | `src/renderer/styles/globals.css` (бренд заменить) |
| шрифт Bounded | `src/renderer/fonts/Bounded-Variable.ttf` |
| shadcn-компоненты | `src/renderer/components/ui/*` |
| frameless-окно | `src/renderer/components/WindowControls.tsx`, `src/main/app/main-window.ts` |
| dev/typecheck | `scripts/dev-quiet.mjs`, `scripts/typecheck.mjs` |
| сборка | `electron-builder.yml`, `electron.vite.config.ts` (без vendor-магии) |
| контракт провайдера (для M4) | `src/main/provider/types.ts`, `src/main/llm/fetch-models.ts`, `src/main/llm/openai-compat-client.ts`, `src/renderer/components/providers/ProviderSettings.tsx` |
