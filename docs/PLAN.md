# Monet Local — план

**Только сервер.** Monet Local управляет `llama-server` из llama.cpp: рантаймы
под любой бэкенд, библиотека моделей, все флаги с объяснением и расчётом
памяти, бенчмарк, и наружу — два API: OpenAI-совместимый и
Anthropic-совместимый. Чата нет. Web UI llama.cpp, tools и MCP выключены и
не пробрасываются — сервер не тратит на них ничего.

Все настройки крутятся здесь. Клиент (в первую очередь Code Monet) выбирает
«Monet Local», получает список моделей со всеми данными и ничего не
настраивает.

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
риск). Сервер слушает `127.0.0.1`; режим «доступ по сети» — отдельный
тумблер, при котором API-ключ становится обязательным.

### D2. Один порт наружу: management API + прокси

Клиент видит **одну** точку: `http://127.0.0.1:17171` (порт — предложение,
обсуждаемо; главное — не 8080/1234/11434, чтобы не толкаться с llama.cpp,
LM Studio и Ollama). Внутри:

- Node-сервер в main-процессе на `17171`: `/monet-local/v1/*` — свой API;
  `/v1/*` — reverse-proxy на llama-server (стриминг SSE прозрачно).
- llama-server на `17172`, только localhost, снаружи не виден.

Зачем прокси, а не прямой llama-server:
- один адрес и один ключ для клиента; llama-server можно перезапускать под
  другой моделью, адрес не меняется;
- **JIT-загрузка**: запрос называет модель, которой нет в памяти → прокси
  запускает загрузку и держит запрос до `ready` (как LM Studio), а `/v1/models`
  отдаёт **всю библиотеку**, не только загруженную;
- очередь: пока модель грузится, второй клиент получает честный 503 с
  `Retry-After`, а не таймаут;
- ключ и LAN-режим проверяются в одном месте.

### D3. Рантаймы — таблица ассетов + «свой пак»

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

### D4. Реестр флагов — единственный источник правды

Один TypeScript-реестр (zod) → форма, превью команды, пресеты, валидация,
калькулятор. Уровни `basic` / `advanced` / `expert`. Группы: model, context,
memory, gpu, sampling, reasoning, speculative, server, advanced.
Справочник — `docs/reference/llama-server-help.txt` (735 строк, b10826).

```ts
noKvOffload: {
  flag: '--no-kv-offload', group: 'memory', type: 'bool', default: false,
  label: { en: 'Keep KV cache in system RAM', ru: 'KV-кэш в системной RAM' },
  help:  { en: 'On an iGPU this is what lets context grow past ~8k: the wall is the device buffer limit, not the cache size.',
           ru: 'На iGPU именно это позволяет контексту вырасти за ~8k: стенка — лимит буферов устройства, а не размер кэша.' },
  recommendWhen: (s, hw) => hw.gpu.uma && s.ctxSize > 8192,
},
```

### D5. Модели лежат там, где лежат

Библиотека = список папок + индекс метаданных в userData. Никаких
копирований.

### D6. Один сервер за раз в v1; несколько Monet Local — в Code Monet

Один инстанс llama-server на машину (D2 делает переключение моделей
прозрачным). Несколько машин — это несколько провайдеров «Monet Local» на
стороне Code Monet, каждый со своим адресом.

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
- **Без фона-картин.** `useMonetBackground` не переносится.
- **Бренд — оранжевый:** `oklch(67.1967% 0.201986 42.2057)` = `#f65e00` =
  `hsl(23 100% 48%)`. В `globals.css` Code Monet бренд задаётся одним числом
  `--brand-hue: 211`; здесь `--brand` объявляется напрямую в oklch, а
  `--link`, `--brand-wash`, `--brand-edge` выводятся от него (Tailwind 4 и
  Chromium в Electron 33 понимают oklch и `color-mix()`). Проверить контраст
  ссылки на канве (AA ≥ 4.5:1) — у оранжевого с L 67% это не гарантировано,
  `--link` скорее всего придётся затемнить.
- **Иконка приложения:** `build/icon-source.png` (585×585, из Downloads).
  В M0 — ресайз до 512 и 1024, `build/icon.png` + `build/icon.ico`
  (electron-builder генерирует ico из png ≥ 256).
- **Язык:** en и ru, i18n в каркасе с M0; переключатель в Settings;
  подписи и подсказки флагов — в реестре на обоих языках.

---

## 2. Архитектура

```
клиенты (Code Monet, Claude Code через ANTHROPIC_BASE_URL, curl, …)
        │  http://127.0.0.1:17171   (LAN: http://<host>:17171 + API key)
┌───────▼─────────────────────── main (Node) ───────────────────────────┐
│ ManagementServer  /monet-local/v1/*   info · models · status · load · │
│                   unload · profiles · events (SSE)                    │
│ Proxy             /v1/*  → llama-server:17172  (OpenAI + Anthropic)   │
│                   JIT-load по имени модели, очередь, ключ, LAN-гейт   │
│ RuntimeManager    таблица ассетов, скачать/проверить, свой пак,        │
│                   --list-devices                                       │
│ ModelLibrary      папки, GGUF-метаданные, пары mmproj, индекс          │
│ Downloader        HF: resume, range-параллель, sha256, очередь         │
│ ServerController  spawn llama-server --no-webui, state machine, логи,  │
│                   сироты                                               │
│ Estimator         память из GGUF + профиль + железо → verdict + why    │
│ Bench             llama-bench, история, A/B                            │
│ Settings          профили, app settings, миграции                      │
│ Tray/Autostart    headless-режим                                       │
│ Updater           electron-updater                                     │
└──────────────┬── preload: window.local.* (typed) ─────────────────────┘
               │ ipc
┌──────────────▼── renderer (React, lucide) ────────────────────────────┐
│ stores: runtime · models · server · bench · ui (zustand)              │
│ экраны: Server · Models · Runtimes · Benchmark · Integrations · Settings│
└───────────────────────────────────────────────────────────────────────┘
```

### Management API (`/monet-local/v1`)

| метод | путь | что |
|---|---|---|
| GET | `/info` | `{name, version, machine, llamaBuild, backend, defaults:{port}}` |
| GET | `/models` | вся библиотека: `[{id, path, arch, quant, sizeBytes, ctxMax, kvBytesPerToken, vision, moe, mtp, loaded, defaultProfile, verdict:{fits,reason}}]` |
| GET | `/status` | `{state, model, profile, port, startedAt, lastTimings}` |
| POST | `/load` | `{model, profile?}` → `202`; прогресс — `/events` |
| POST | `/unload` | |
| GET | `/profiles` | профили и их флаги (для отображения в клиенте) |
| GET | `/events` | SSE: `state`, `progress`, `timings` |

`id` модели = стабильный slug из имени файла (`qwen3.8-27b-q4_k_m`), он же
`model` в OpenAI/Anthropic-запросах. `/v1/models` прокси отдаёт те же id.

### Данные

```
%APPDATA%/monet-local/
├── settings.json      папки, тема, язык, порты, LAN, ключ (DPAPI)
├── profiles/*.json    наборы флагов (+ модель, + рантайм)
├── runtimes/<backend>-<build>/
├── index/models.json  кэш GGUF-метаданных (путь+mtime+size)
├── bench/*.json
└── logs/server-*.log
```

### GGUF-ридер (порт `gguf_meta.py`)

Только заголовок. Достаёт: `general.architecture`, `*.block_count`,
`*.context_length`, `*.attention.head_count(_kv)`, `*.attention.key_length /
value_length`, `*.expert_count`, `*.ssm.*` + `*.full_attention_interval`
(гибриды), `*.nextn_predict_layers` (MTP), `general.file_type`, наличие
`blk.N.ffn_*_exps`, `tokenizer.chat_template` (из него — поддержка
`reasoning_effort` / `enable_thinking` для клиента). Пара `mmproj-*.gguf` — по
имени в папке.

### Калькулятор памяти

- веса = размер файла × (`repack ? ~1.3 : 1.0`) для CPU-части;
- KV/токен = `2 · n_kv_heads · head_dim · bytes(cache_type) · n_attn_layers`,
  гибриды: `n_attn_layers = block_count / full_attention_interval`
  (Qwen3.8-27B: 16 из 65 → 64 КБ/токен f16, 16 ГиБ на 262144);
- compute-буферы ≈ 0.6–1.0 ГиБ;
- iGPU (UMA): устройству доступно `выделенное + ~½ RAM`, и это та же RAM —
  потолок вердикта = общая RAM; дискретная GPU: потолок устройства = VRAM;
- вердикт `fits / tight / wont_fit` **с причиной и предложением**.

### ServerController

`idle → starting → ready → stopping → idle`, ветки `failed` (allocation
failed / OutOfDeviceMemory / `0xC0000409` / unknown arch / порт занят) и
`crashed`. Готовность — `listening on` в логе **и** `/health`. Сироты —
скан `llama-server.exe` до старта, tree-kill на выходе, pid-файл. Парсер
`print_timing` → t/s; `model buffer size` → факт распределения памяти рядом с
оценкой.

---

## 3. Экраны

Сайдбар: **Server · Models · Runtimes · Benchmark · Integrations · Settings**.
Справа — панель профиля (группы флагов, вердикт, превью команды), с любого
экрана.

**Server.** Состояние · загруженная модель + профиль · Start/Stop/Restart ·
адрес и ключ · командная строка (копировать) · живой лог с фильтром · факт
памяти GPU/host · слоты · t/s последних запросов.

**Models.** Папки · таблица GGUF (квант, размер, архитектура, dense/MoE,
контекст, vision, MTP, вердикт) · карточка · «загрузить с профилем …» · HF:
поиск → таблица квантов с вердиктом для этого железа → скачать.

**Runtimes.** Установленные паки · релизы · свой пак · устройства · выбор по
умолчанию · «проверить» с крошечной моделью-фикстурой.

**Benchmark.** Модель + два профиля → `llama-bench` (pp/tg) → таблица,
история, дельта. Пресеты: CPU vs GPU, ngl sweep, KV f16 vs q8_0, квант A vs B.

**Integrations.** Карточки: **Code Monet** («в Code Monet выберите провайдера
Monet Local — адрес подставится сам»; для другой машины — адрес и ключ с
кнопками копирования), **Anthropic-совместимые клиенты** (`ANTHROPIC_BASE_URL`,
`ANTHROPIC_API_KEY`), **OpenAI-совместимые** (Base URL, key). Тумблер
«доступ по сети» с предупреждением и обязательным ключом.

**Settings.** Папки, тема, язык (en/ru), порты, автозапуск/трей, обновления,
экспорт/импорт профилей.

---

## 4. Часть 2 — изменения в Code Monet (`iaa2005/monet`)

Цель: пользователь выбирает «Monet Local» и больше ничего не настраивает.

1. `src/main/provider/types.ts`: `ProviderKind` += `'monet-local'`.
   Форма провайдера: имя, **Base URL с дефолтом `http://127.0.0.1:17171`**
   (редактируемый — для другой машины), ключ (пусто для localhost). Кнопка
   «Найти на этом компьютере» пробует дефолтный адрес → `/monet-local/v1/info`.
2. `src/main/llm/fetch-models.ts`: для `monet-local` — `/monet-local/v1/models`
   → модели с `contextLength` (ctxMax профиля), `modalities` (`image` при
   mmproj), `supportsEffort` (по шаблону), `maxOutput`; бейджи «loaded» и
   вердикт памяти в списке.
3. Транспорт — существующий `openai-compat-client.ts` (reasoning_content и
   tools уже есть). Выбор незагруженной модели → первый запрос триггерит
   JIT-загрузку через прокси; композер показывает «загружается… N%» по
   `/events`.
4. Несколько провайдеров этого вида — по одному на машину; в списке моделей
   имя провайдера рядом с моделью.
5. `docs/content/configuration/01-providers.md`: раздел «Monet Local».
6. Fallback: если `/monet-local/v1/*` не отвечает, но `/v1/models` есть —
   работать как обычный OpenAI-совместимый провайдер (старая версия Monet
   Local или чужой сервер).

---

## 5. Вехи

**M0 — каркас (1–2 дня).** electron-vite + React + TS + Tailwind 4; перенос
`globals.css` с заменой бренда на оранжевый, Bounded, `components/ui`,
`WindowControls`; lucide; i18n en/ru; иконка → `icon.png`/`icon.ico`; пустые
экраны; `npm run package` → NSIS exe; GitHub Actions на tag. *Готово: exe
ставится, открывает оранжевое окно в стиле Monet на двух языках.*

**M1 — рантаймы и модели (2–3 дня).** RuntimeManager (таблица, скачивание,
свой пак, `--list-devices`); GGUF-ридер; ModelLibrary; экраны Runtimes и
Models (без HF). *Готово: видит `D:\Colibri\models`, показывает архитектуру,
квант, KV на токен.*

**M2 — профили, калькулятор, сервер (3–4 дня).** Реестр флагов; панель
профиля; превью; Estimator; ServerController (`--no-webui`); экран Server;
живая проверка `/v1/chat/completions` **и** `/v1/messages`. *Готово: профиль
«8192 / Vulkan» стартует Qwen3.8-27B и показывает 4.3 t/s; профиль «262144
без nkvo» до запуска говорит «не влезет: KV 16 ГиБ + веса 15.65 > 27.7».*

**M3 — management API и прокси (2–3 дня).** `/monet-local/v1/*`, прокси
`/v1/*` с SSE, JIT-загрузка, очередь/503, ключ, LAN-режим, трей, автозапуск,
экран Integrations. *Готово: Claude Code с `ANTHROPIC_BASE_URL=http://127.0.0.1:17171`
и curl на `/v1/chat/completions` работают; запрос к незагруженной модели
загружает её.*

**M4 — Code Monet (2–3 дня, в репо `monet`).** Provider kind `monet-local`,
форма с дефолтом, discovery, модели с метаданными и вердиктом, прогресс
JIT-загрузки, docs. *Готово: в Code Monet «Add provider → Monet Local →
Save» без единого поля, модели на месте, чат идёт.*

**M5 — бенчмарк и HF-загрузчик (2–3 дня).** llama-bench, история, A/B; HF
поиск/кванты/вердикт, resume, очередь.

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

vitest на чистых модулях (`buildArgs`, GGUF-ридер на заголовках реальных
файлов, Estimator на Приложении A как assert'ах, парсеры логов и устройств,
RuntimeManager, прокси/JIT на фейковом upstream); smoke-пробы в духе monet
(старт/стоп с ~30 МБ фикстурой, `/health`, один запрос по каждому API);
typecheck-gate.

## 8. Осталось решить

1. **Порт** — `17171` устраивает? (Второй, `17172`, внутренний.)
2. **LAN по умолчанию выключен**, ключ обязателен при включении — ок?
3. **JIT-загрузка** — включена по умолчанию, или клиент должен явно жать
   «загрузить» в Monet Local?

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
