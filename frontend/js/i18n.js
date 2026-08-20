// i18n.js — интернационализация интерфейса MomentCut (ru / en).
//
// Использование:
//   import { t, getLang, setLang, applyDom, onLangChange } from './i18n.js?v=1';
//   t('key')                       — строка для текущего языка
//   t('key', {name:'x', n:5})      — подстановка {name}/{n}
//   applyDom()                     — применить перевод к статичным элементам ([data-i18n*])
//   setLang('en')                  — сменить язык, переприменить DOM, вызвать колбэки
//   onLangChange(cb)               — подписаться на смену языка (для динамической перерисовки)

const translations = {
  ru: {
    // ---- Общее / приложение ----
    app_title: 'MomentCut — монтаж интересных моментов',

    // ---- Топбар ----
    brand_sub: 'умный монтаж интересных моментов',
    save_project: 'Сохранить проект',
    load_project: 'Загрузить проект',
    how_it_works: 'Как это работает',
    upload_video: 'Загрузить видео',
    lang_switch_title: 'Язык интерфейса',

    // ---- Сайдбар ----
    videos_title: 'Видео',
    cleanup: '🧹 Очистить',
    cleanup_title: 'Убрать все видео из библиотеки. Загруженные через UI удаляются вместе с данными/кешем; видео «с диска» убираются из списка, их файлы на диске остаются.',
    dropzone_title: 'Перетащите видео сюда',
    dropzone_sub: 'или нажмите «Загрузить видео»',
    import_path_ph: 'или путь к видео на диске…',
    import_disk: '📂 С диска',
    import_disk_title: 'Добавить видео по пути без копирования в папку приложения',

    // ---- Панель настроек анализа ----
    sensitivity: 'Строгость отбора',
    audio: '🔊 Аудио',
    scenes: '🎞️ Сцены',
    motion: '🏃 Движение',
    an_engine: 'Анализ',
    an_engine_title: 'Чем анализировать видео (декодирование кадров)',
    an_engine_auto: 'Авто',
    an_engine_gpu: 'GPU',
    an_engine_cpu: 'CPU',
    method: 'Метод',
    method_title: 'Как искать интересные моменты: по сигналам (громкость/сцены/движение) или через ИИ (внешний OpenAI-совместимый API)',
    method_signals: 'Сигналы',
    method_ai: 'ИИ',
    recalculate: '↻ Пересчитать',
    ai_pause: '⏸ Пауза',
    ai_pause_title: 'Приостановить ИИ-анализ между частями ответов ИИ (прогресс сохранится — можно продолжить, даже после перезапуска)',
    ai_resume: '▶ Продолжить',
    ai_resume_title: 'Продолжить ИИ-анализ с места паузы',
    ai_stop: '⏹ Стоп',
    ai_stop_title: 'Отменить ИИ-анализ (сохранённая пауза удаляется)',

    // ---- Настройки ИИ-анализа ----
    ai_settings_title: '🤖 ИИ-анализ (OpenAI-совместимый API)',
    ai_endpoint_label: 'Endpoint chat/completions',
    ai_endpoint_ph: 'https://api.openai.com/v1',
    ai_endpoint_title: 'Базовый адрес API; /chat/completions добавится автоматически. Подходит: OpenAI, OpenRouter, Ollama (http://localhost:11434/v1), LM Studio',
    ai_key_label: 'API-ключ (хранится только в браузере)',
    ai_model_label: 'Модель',
    ai_model_ph: 'gpt-4o-mini',
    ai_input_label: 'Что отправляем ИИ',
    ai_input_title: 'Кадры — картинки с таймкодами. Кадры + речь — ещё и расшифровка (нужна распознанная речь). Только речь — по тексту без картинок.',
    ai_input_frames: 'Кадры (vision)',
    ai_input_frames_speech: 'Кадры + речь',
    ai_input_speech: 'Только речь',
    ai_frames_label: 'Каждый N-й кадр',
    ai_frames_title: 'Число трактуется буквально: написано 10 — уходит каждый 10-й кадр, 15 — каждый 15-й и т.д. Чем меньше число, тем плотнее выборка и выше качество, но больше кадров (токенов/стоимости).',
    ai_chunk_label: 'Секунд за раз',
    ai_chunk_title: 'Видео обрабатывается по фрагментам: кадры первых N секунд отправляются в ИИ, ждём ответ, затем следующие N секунд. Так контекст модели не переполняется. Меньше значение — меньше кадров за запрос, но больше обращений к API.',
    ai_maxseg_label: 'Сколько моментов',
    ai_maxseg_title: 'Сколько всего интересных моментов нужно выбрать (0 — без ограничения). ИИ проставляют score каждому кандидату и оставит N самых важных по всему видео.',
    ai_prompt_label: 'Системный промпт (дополнение)',
    ai_prompt_ph: 'Дополните основной промпт: какие моменты считать интересными…',
    ai_prompt_hint: 'Основной промпт содержит только правила ответа. Сюда впишите, какие моменты искать (например: только сражения и стрельбу, голы, эмоции, важные реплики…).',
    ai_speech_hint: '⚠️ Для способа «Кадры + речь» / «Только речь» сначала распознайте речь кнопкой «🎙 Распознать речь».',

    // ---- Пустое состояние ----
    empty_title: 'Начните с загрузки видео',
    empty_text: 'MomentCut найдёт интересные моменты автоматически:<br>громкие всплески, смену сцен и активное движение.',

    // ---- Плеер ----
    player_resize_title: 'Потяните, чтобы изменить размер окна',
    player_speed_title: 'Скорость воспроизведения',

    // ---- Таймлайн ----
    tl_title: 'Таймлайн интересных моментов',
    tl_scale: 'Масштаб',
    tl_zoom_reset: 'Показать весь ролик',
    tl_zoom_title: 'Приближение таймлайна (по позиции плеера)',

    // ---- Список сегментов ----
    found_moments: 'Найденные моменты',
    add_frame: '+ Кадр',
    add_frame_title: 'Добавить сегмент вокруг текущего кадра',
    clear: 'Очистить',
    clear_title: 'Убрать все сегменты',
    filter_signals_title: 'Показывать моменты, найденные сигнальным анализом (громкость/сцены/движение)',
    filter_ai_title: 'Показывать моменты, выбранные ИИ',
    filter_algorithm: '🔵 Алгоритм',
    filter_ai: '🟣 ИИ',
    seg_empty: 'Анализ ещё не выполнен. Нажмите «Пересчитать».',

    // ---- Поиск по словам / речь ----
    speech_search: '🔍 Поиск по словам',
    transcribe: '🎙 Распознать речь',
    speech_provider: 'Источник распознавания',
    speech_provider_title: 'Локально — faster-whisper на вашем ПК. API — внешний OpenAI-совместимый сервис (свой endpoint и ключ).',
    speech_provider_local: 'Локально (faster-whisper)',
    speech_provider_api: 'Внешний API',
    speech_model: 'Модель распознавания',
    speech_model_title: 'Чем больше модель, тем точнее распознавание, но медленнее и больше памяти. При смене модели предыдущая выгружается.',
    speech_api_endpoint_ph: 'Endpoint: https://…/v1/audio/transcriptions',
    speech_api_key_ph: 'API-ключ',
    speech_api_model_ph: 'Модель API (напр. whisper-1)',
    diarize: '🎭 Разделять по голосам',
    diarize_title: 'Разделять распознанную речь по голосам (кто говорит). Требует pyannote.audio и токена Hugging Face.',
    hf_token_ph: 'Hugging Face токен (hf_…)',
    speakers_min: 'Спикеров: мин',
    speakers_min_title: 'Минимум говорящих (0 = авто)',
    speakers_max: 'макс',
    speakers_max_title: 'Максимум говорящих (0 = авто)',
    speakers_auto_ph: 'авто',
    preview_subs: '🎞️ Субтитры при просмотре',
    speech_query_ph: 'Например: гол, прыжок, победа…',
    search: 'Искать',
    all_words: 'Все слова',
    show_words: 'показать',
    show_words_title: 'Показать/скрыть список распознанных слов',

    // ---- Монтаж ----
    montage: 'Монтаж',
    ms_videos: 'Роликов в сборке',
    ms_segments: 'Моментов',
    ms_duration: 'Итоговая длительность',
    resolution: 'Разрешение',
    res_auto: 'Авто (максимальное)',
    engine: 'Движок обработки',
    engine_opt_auto: 'Гибрид (авто)',
    engine_opt_cpu: 'CPU (программный)',
    engine_opt_nvidia: 'NVIDIA (NVENC)',
    engine_opt_amd: 'AMD (AMF)',
    engine_opt_intel: 'Intel (QSV)',
    format: 'Формат экспорта',
    fmt_mp4: 'MP4 (H.264)',
    fmt_hevc: 'MP4 (HEVC H.265)',
    fmt_webm: 'WebM (VP9)',
    fmt_mkv: 'MKV (H.264)',
    transition: 'Переход между моментами',
    transition_title: 'Что вставить между частями. «Плашка-маркер» вставляет цветной кадр между моментами — удобно находить и вырезать их в другом редакторе.',
    tr_none: 'Без перехода',
    tr_fade: 'Кроссфейд (fade)',
    tr_fadeblack: 'Через чёрный',
    tr_fadewhite: 'Через белый',
    tr_dissolve: 'Растворение',
    tr_wipeleft: 'Шторка влево',
    tr_slideright: 'Сдвиг вправо',
    tr_marker: 'Плашка-маркер (вставка)',
    xfade: 'Длительность перехода',
    xfade_title: 'Сколько секунд длится переход (для плашки-маркера — длительность цветного кадра)',
    xfade_03: '0.3 с',
    xfade_05: '0.5 с',
    xfade_1: '1 с',
    xfade_2: '2 с',
    xfade_3: '3 с',
    marker_color: 'Цвет плашки',
    marker_color_title: 'Цвет вставки-маркера между моментами',
    subs_montage: '🎞️ Субтитры (речь)',
    subs_montage_title: 'Вписать субтитры по распознанной речи прямо в видео',
    quality: 'Качество: CRF',
    crf_title: 'Ниже = лучше качество, больше размер',
    quality_hint: 'Чем ниже CRF, тем качественнее и тяжелее файл',
    mq_empty: 'Включите моменты в сборку — отмечайте их галочками в списке.',
    montage_btn: '✂️ Смонтировать',
    done_title: 'Готово! 🎉',
    download: '⬇ Скачать видео',

    // ---- Справка (модальное окно) ----
    help_quickstart: `
      <summary>🚀 Быстрый старт</summary>
      <ol>
        <li><b>Загрузите</b> видео — кнопкой «Загрузить видео», перетащив файлы в окно, или полем «С диска» (по пути, без копирования).</li>
        <li>Начнётся <b>автоматический анализ</b> (по умолчанию «Сигналы»). Прогресс виден в панели анализа.</li>
        <li>Откройте найденные моменты на <b>таймлайне</b> — клик по сегменту воспроизводит его в плеере.</li>
        <li>Включите нужные моменты в правой панели «Монтаж» и нажмите <b>«✂️ Смонтировать»</b>.</li>
        <li>Скачайте готовый ролик кнопкой <b>«⬇ Скачать видео»</b>.</li>
      </ol>`,
    help_upload: `
      <summary>📥 Загрузка, импорт и библиотека</summary>
      <ul>
        <li>Поддерживаются форматы: MP4, MOV, MKV, AVI, WebM, M4V, TS, FLV, WMV, MPG, MPEG, 3GP.</li>
        <li><b>Импорт «с диска»</b> — впишите путь к файлу и нажмите «📂 С диска»: видео не копируется, читается прямо по пути (бейдж «с диска»). При удалении такой записи исходник на диске сохраняется.</li>
        <li>Загруженные видео, их анализ и распознанная речь <b>сохраняются в кеше</b> (<code>data/cache/</code>) и восстанавливаются после перезапуска сервера.</li>
        <li>Кнопка <b>«🧹 Очистить»</b> убирает из библиотеки все видео: загруженные — вместе с файлами, «с диска» — только записи.</li>
        <li>Кнопка <b>«⌫»</b> у видео в списке очищает его найденные моменты.</li>
      </ul>`,
    help_analysis: `
      <summary>🧠 Анализ моментов (сигналы)</summary>
      <p>Ищет интересные моменты по трём сигналам:</p>
      <ul>
        <li>🔊 <b>аудиоэнергия</b> — крики, аплодисменты, музыкальные всплески;</li>
        <li>🎞️ <b>смена сцен</b> — нарезка и контрастные переходы;</li>
        <li>🏃 <b>движение</b> — активные/динамичные сцены.</li>
      </ul>
      <p>Движок: <b>Авто / GPU (NVDEC) / CPU</b> — результаты одинаковые, на GPU анализ быстрее. <b>Строгость отбора</b> задаёт порог: выше — меньше, но «интереснее» моментов. Кнопка «↻ Пересчитать» запускает анализ заново.</p>`,
    help_ai: `
      <summary>🤖 ИИ-анализ</summary>
      <p>В панели анализа выберите <b>Метод: ИИ</b> — моменты ищет внешняя модель через OpenAI-совместимый API (OpenAI, OpenRouter, Ollama, LM Studio…).</p>
      <ul>
        <li><b>Endpoint</b> — адрес API (базовый; <code>/chat/completions</code> добавится автоматически), <b>API-ключ</b> и <b>модель</b>.</li>
        <li><b>Что отправляем</b>: кадры (каждый N-й), кадры + распознанная речь, или только речь.</li>
        <li><b>Секунд за раз</b> — видео обрабатывается по фрагментам, чтобы не переполнять контекст модели.</li>
        <li><b>Системный промпт (дополнение)</b> — сюда впишите, какие моменты считать интересными (базовые правила уже встроены).</li>
        <li><b>Сколько моментов</b> — ограничение числа итоговых моментов (0 = без лимита).</li>
        <li>Поддерживается <b>пауза/продолжение/стоп</b> — прогресс сохраняется и после перезапуска.</li>
        <li>Если сигнальный анализ уже есть, ИИ-моменты <b>дополняют</b> его. Фильтры «🔵 Алгоритм» / «🟣 ИИ» включают/выключают источники.</li>
      </ul>`,
    help_timeline: `
      <summary>✏️ Таймлайн и редактирование</summary>
      <ul>
        <li><b>Зум</b>: ползунок «Масштаб» (до ×40) и колёсико мыши над таймлайном (центрируется под курсором); «⤢» — показать весь ролик.</li>
        <li><b>Границы</b> сегментов можно двигать и растягивать прямо на таймлайне; время редактируется и в списке.</li>
        <li><b>Галочки</b> в списке найденных и в очереди монтажа включают/выключают момент без удаления.</li>
        <li><b>«+ Кадр»</b> добавляет момент вокруг текущей позиции плеера; <b>«Очистить»</b> убирает все моменты.</li>
        <li><b>«⬇»</b> у сегмента скачивает его отдельным файлом с текущими настройками экспорта.</li>
        <li>Окно плеера растягивается за нижнюю ручку; скорость воспроизведения — 0.3×–4×.</li>
      </ul>`,
    help_speech: `
      <summary>🗣 Распознавание речи и поиск</summary>
      <p>Кнопка <b>«🎙 Распознать речь»</b> в панели «Поиск по словам»:</p>
      <ul>
        <li><b>Локально</b> — faster-whisper на вашем ПК (модели tiny…large-v3; при смене модели предыдущая выгружается). При наличии NVIDIA GPU речь распознаётся на видеокарте.</li>
        <li><b>Внешний API</b> — свой OpenAI-совместимый endpoint <code>/audio/transcriptions</code>, ключ и модель (настройки хранятся в браузере).</li>
        <li>После распознавания слова появляются <b>метками на таймлайне</b> (наведение — слово и время, клик — перемотка), а в панели — <b>поиск по словам</b> и список всех слов.</li>
        <li>Найденный фрагмент добавляется в монтаж кнопкой <b>«＋»</b>.</li>
        <li>Чекбокс <b>«Субтитры при просмотре»</b> показывает распознанную речь поверх видео в плеере.</li>
      </ul>`,
    help_diarization: `
      <summary>🎭 Разделение по голосам (диаризация)</summary>
      <ul>
        <li>Включите <b>«🎭 Разделять по голосам»</b> перед распознаванием — реплики разных говорящих получат метки «Спикер 1…», цвета на таймлайне и префиксы в субтитрах.</li>
        <li>Требуется <b>токен Hugging Face</b> (поле рядом; хранится только в браузере) и <b>pyannote.audio</b> (есть в requirements.txt).</li>
        <li>Первый запуск скачивает закрытые модели с Hugging Face — нужно принять условия (см. README, шаг 5).</li>
        <li>При наличии NVIDIA GPU диаризация ускоряется CUDA-сборкой torch (см. README).</li>
      </ul>`,
    help_montage: `
      <summary>✂️ Монтаж и экспорт</summary>
      <ul>
        <li><b>Разрешение</b>: авто (максимальное) или фиксированное от 480p до 4K.</li>
        <li><b>Движок</b>: Гибрид (авто) / CPU / NVIDIA (NVENC) / AMD (AMF) / Intel (QSV). Если аппаратный кодер недоступен — автоматический фолбэк на CPU.</li>
        <li><b>Формат</b>: MP4 (H.264), MP4 (HEVC), WebM (VP9), MKV. <b>Качество</b> — CRF: ниже = лучше и тяжелее.</li>
        <li><b>Переход</b> между моментами: без перехода, кроссфейд, через чёрный/белый, растворение, шторка влево, сдвиг вправо или <b>плашка-маркер</b> (цветная вставка — удобно вырезать моменты в другом редакторе). Длительность — 0.3–3 с.</li>
        <li><b>Субтитры (речь)</b> — вшивают распознанную речь прямо в кадр (кириллица поддерживается). Требуется предварительное распознавание.</li>
      </ul>`,
    help_projects: `
      <summary>💾 Проекты</summary>
      <ul>
        <li>Кнопка <b>«💾»</b> в верхней панели сохраняет проект в JSON (видео, моменты, распознанную речь), <b>«📂»</b> — загружает его.</li>
        <li>Проект ссылается на файлы в <code>data/uploads/</code> — для переноса на другой компьютер перенесите и эти файлы (или добавьте видео «с диска» по пути).</li>
      </ul>`,
    help_privacy: `
      <summary>🔒 Приватность</summary>
      <p>Сигнальный анализ и локальное распознавание речи выполняются <b>на вашем компьютере</b>; видео не отправляются никуда. В интернет уходят только:</p>
      <ul>
        <li>запросы к указанным вами API (ИИ-анализ, внешнее распознавание);</li>
        <li>скачивание моделей (whisper, диаризация) при первом запуске.</li>
      </ul>
      <p>API-ключи и токен Hugging Face хранятся <b>только в браузере</b> (localStorage) и передаются на сервер лишь на время запроса — в кеш и проекты они не попадают.</p>`,
    help_close: '✕',
    help_title: 'Справка MomentCut',

    // ---- Динамические строки JS ----
    err_connect: 'Не удалось связаться с сервером: {msg}',
    hint_speech: 'Речь',
    hint_diarization: 'Диаризация',
    engine_available: 'Доступно',
    engine_cpu_only: 'Доступен только CPU',
    unavailable: 'недоступно',
    import_added: '«{name}» добавлен — файл не копировался',
    err_add_video: 'Не удалось добавить видео: {msg}',
    not_video: '«{name}» — это не видео',
    uploading: 'Загрузка «{name}»…',
    uploaded: '«{name}» загружен ({size})',
    err_upload: 'Не удалось загрузить «{name}»: {msg}',
    err_resume: 'Не удалось продолжить: {msg}',
    err_start_analysis: 'Ошибка запуска анализа: {msg}',
    analysis_paused_toast: 'ИИ-анализ на паузе — прогресс сохранён, можно продолжить',
    err_pause: 'Не удалось поставить на паузу: {msg}',
    analysis_cancelled: 'Анализ отменён',
    err_stop: 'Не удалось остановить: {msg}',
    ai_analysis_cancelled: 'ИИ-анализ отменён',
    err_cancel: 'Не удалось отменить: {msg}',
    ai_viewed: 'просмотрено {pos}/{dur}',
    ai_moments_count: 'моментов: {n}',
    ai_paused_status: '⏸ ИИ-анализ на паузе: <b>{pct}%</b>{det}',
    ai_running_status: '<span class="spin">◌</span> ИИ-анализ <b>{pct}%</b>{det}',
    analyzing: 'Анализ…',
    analysis_error: 'Ошибка анализа',
    moments_with_ai: '{n} моментов ({ai} ИИ)',
    moments: '{n} моментов',
    analysis_not_done: 'Анализ ещё не выполнен',
    analysis_progress_status: 'Анализ… {pct}%{det}',
    analysis_ready: 'Анализ готов: найдено моментов — {n}',
    err_analysis: 'Ошибка анализа: {msg}',
    err_montage: 'Ошибка монтажа: {msg}',
    transcribing: 'Распознавание…',
    err_transcribe: 'Ошибка распознавания',
    err_transcribe_msg: 'Ошибка распознавания: {msg}',
    speech_ready: 'Речь распознана — можно искать по словам',
    from_disk: 'с диска',
    from_disk_title: 'Файл не копировался в папку приложения (читается по пути) — при удалении записи исходник сохранится',
    speakers_badge: '🎭 спикеры: {n}',
    speakers_badge_title: 'Речь разделена по голосам (диаризация)',
    ai_paused_sidebar: '⏸ ИИ-анализ на паузе ({pct}%){det}',
    err_prefix: 'Ошибка: {msg}',
    clear_moments_title: 'Очистить найденные моменты этого видео',
    remove_video_title: 'Удалить видео',
    err_delete: 'Не удалось удалить: {msg}',
    confirm_cleanup: 'Убрать все видео из библиотеки?\n\nЗагруженные через UI видео будут удалены вместе с данными и кешем.\nВидео «с диска» будут убраны из списка, но их файлы на диске останутся.',
    library_cleared: 'Библиотека очищена: убрано видео — {n}',
    list_empty: 'Список уже пуст',
    err_cleanup: 'Не удалось очистить: {msg}',
    transcribing_speech: 'Распознавание речи…',
    lang_suffix: ' · язык: {lang}',
    words_recognized: 'Распознано слов: {n}{lang}.',
    words_recognized_speakers: 'Распознано слов: {n}{lang} · 🎭 спикеров: {s}. Цвет слов на таймлайне — говорящий.',
    words_recognized_diar_err: 'Распознано слов: {n}{lang} · ⚠ разделение по голосам не выполнено: {err}',
    words_recognized_diar_on: 'Распознано слов: {n}{lang} · включено разделение по голосам — нажмите «🎙 Распознать речь», чтобы разметить спикеров.',
    speech_status_hint: '{msg} Введите слово для поиска.',
    no_speech_status: 'Речь не распознана. Нажмите «🎙 Распознать речь» (модель скачается при первом запуске).',
    diar_hint_pyannote: '⚠ Не установлен pyannote.audio: pip install pyannote.audio torch torchaudio',
    diar_hint_token: 'Нужен токен Hugging Face (huggingface.co/settings/tokens) и принятые условия модели pyannote/speaker-diarization-3.1',
    err_hf_token: 'Для разделения по голосам укажите токен Hugging Face (поле в панели распознавания)',
    err_start_transcribe: 'Не удалось запустить распознавание: {msg}',
    searching: 'Поиск…',
    err_search: 'Ошибка поиска',
    err_search_msg: 'Ошибка поиска: {msg}',
    word_not_found: 'Слово «{q}» не найдено.',
    found_count: 'Найдено: {n}',
    watch: 'Посмотреть',
    word_badge: 'Слово «{w}»: {time}',
    add_to_moments: 'Добавить в моменты',
    added_word: 'Добавлено: «{w}» в {time}',
    speech_recognized_meta: '{dur} · речь распознана',
    no_analysis_meta: '{dur} · нет анализа',
    tl_meta_moments: '{dur} · {n} моментов',
    seg_not_found: 'Интересные моменты не найдены. Попробуйте снизить строгость отбора.',
    include_in_montage: 'Включить в монтаж',
    start_time: 'Начало (м:сс)',
    end_time: 'Конец (м:сс)',
    ai_src: 'ИИ',
    alg_src: 'АЛГ',
    ai_reason: 'ИИ: {reason}',
    signal_found: 'Найден сигнальным анализом',
    interest_score: 'Оценка интересности',
    watch_moment: 'Посмотреть момент',
    download_moment: 'Скачать этот момент отдельным файлом',
    delete_moment: 'Удалить момент',
    moment_badge: 'Момент {i}: {start}–{end}',
    moment_added: 'Момент добавлен — отрегулируйте границы',
    moments_cleared: 'Моменты очищены',
    open_in_player: 'Открыть в плеере',
    toggle_in_montage: 'Включить/выключить момент в монтаже',
    assembly_badge: 'Сборка: {start}–{end}',
    downloading_moment: 'Скачивание момента {i}…',
    err_start_download: 'Не удалось запустить скачивание: {msg}',
    preparing: 'Подготовка…',
    err_start_montage: 'Не удалось запустить монтаж: {msg}',
    moment_downloaded: 'Момент {i} скачан ({time})',
    mr_meta: '{n} моментов · {time}{engine}',
    montage_ready: 'Монтаж готов!',
    project_saved: 'Проект сохранён ({n} видео)',
    err_save_project: 'Не удалось сохранить проект: {msg}',
    err_bad_project: 'Некорректный файл проекта',
    project_loaded: 'Проект загружен: {n} видео',
    project_failed_count: ', {n} не найдено',
    err_load_project: 'Не удалось загрузить проект: {msg}',

    // ---- Таймлайн (canvas) ----
    tl_no_data: 'Нет данных анализа',
    tl_do_analysis: 'Выполните анализ, чтобы увидеть интересные моменты',
    tl_words: '▍слова',

    // ---- API ----
    err_status: 'Ошибка {status}',
    err_bad_response: 'Некорректный ответ сервера',
    err_network_upload: 'Сетевая ошибка при загрузке',

    // ---- Единицы размера ----
    unit_b: 'Б',
    unit_kb: 'КБ',
    unit_mb: 'МБ',
    unit_gb: 'ГБ',
  },

  en: {
    // ---- General / app ----
    app_title: 'MomentCut — smart video highlights editor',

    // ---- Topbar ----
    brand_sub: 'smart editing of interesting moments',
    save_project: 'Save project',
    load_project: 'Load project',
    how_it_works: 'How it works',
    upload_video: 'Upload video',
    lang_switch_title: 'Interface language',

    // ---- Sidebar ----
    videos_title: 'Videos',
    cleanup: '🧹 Clear',
    cleanup_title: 'Remove all videos from the library. Videos uploaded through the UI are deleted together with data/cache; "from disk" videos are removed from the list, their files on disk remain.',
    dropzone_title: 'Drop videos here',
    dropzone_sub: 'or click "Upload video"',
    import_path_ph: 'or path to a video on disk…',
    import_disk: '📂 From disk',
    import_disk_title: 'Add video by path without copying to the app folder',

    // ---- Analysis settings bar ----
    sensitivity: 'Selection strictness',
    audio: '🔊 Audio',
    scenes: '🎞️ Scenes',
    motion: '🏃 Motion',
    an_engine: 'Analysis',
    an_engine_title: 'How to decode video frames for analysis',
    an_engine_auto: 'Auto',
    an_engine_gpu: 'GPU',
    an_engine_cpu: 'CPU',
    method: 'Method',
    method_title: 'How to find interesting moments: by signals (loudness/scenes/motion) or via AI (external OpenAI-compatible API)',
    method_signals: 'Signals',
    method_ai: 'AI',
    recalculate: '↻ Recalculate',
    ai_pause: '⏸ Pause',
    ai_pause_title: 'Pause AI analysis between AI response parts (progress is saved — you can continue, even after a restart)',
    ai_resume: '▶ Resume',
    ai_resume_title: 'Resume AI analysis from the pause point',
    ai_stop: '⏹ Stop',
    ai_stop_title: 'Cancel AI analysis (the saved pause is deleted)',

    // ---- AI analysis settings ----
    ai_settings_title: '🤖 AI analysis (OpenAI-compatible API)',
    ai_endpoint_label: 'Endpoint chat/completions',
    ai_endpoint_ph: 'https://api.openai.com/v1',
    ai_endpoint_title: 'Base API address; /chat/completions is appended automatically. Suitable: OpenAI, OpenRouter, Ollama (http://localhost:11434/v1), LM Studio',
    ai_key_label: 'API key (stored only in the browser)',
    ai_model_label: 'Model',
    ai_model_ph: 'gpt-4o-mini',
    ai_input_label: 'What we send to AI',
    ai_input_title: 'Frames — images with timestamps. Frames + speech — also the transcript (requires recognized speech). Speech only — by text without images.',
    ai_input_frames: 'Frames (vision)',
    ai_input_frames_speech: 'Frames + speech',
    ai_input_speech: 'Speech only',
    ai_frames_label: 'Every Nth frame',
    ai_frames_title: 'The number is taken literally: enter 10 — every 10th frame is sent, 15 — every 15th, etc. The smaller the number, the denser the sampling and the higher the quality, but more frames (tokens/cost).',
    ai_chunk_label: 'Seconds at a time',
    ai_chunk_title: 'The video is processed in chunks: frames of the first N seconds are sent to AI, we wait for the answer, then the next N seconds. This keeps the model context from overflowing. Smaller value — fewer frames per request, but more API calls.',
    ai_maxseg_label: 'How many moments',
    ai_maxseg_title: 'Total number of interesting moments to select (0 — no limit). AI assigns a score to each candidate and keeps the N most important across the whole video.',
    ai_prompt_label: 'System prompt (addition)',
    ai_prompt_ph: 'Extend the main prompt: which moments to consider interesting…',
    ai_prompt_hint: 'The main prompt contains only response rules. Write here which moments to look for (e.g.: only fights and shooting, goals, emotions, important lines…).',
    ai_speech_hint: '⚠️ For "Frames + speech" / "Speech only" modes, first transcribe the speech with the "🎙 Transcribe speech" button.',

    // ---- Empty state ----
    empty_title: 'Start by uploading a video',
    empty_text: 'MomentCut finds interesting moments automatically:<br>loud spikes, scene changes and active motion.',

    // ---- Player ----
    player_resize_title: 'Drag to resize the window',
    player_speed_title: 'Playback speed',

    // ---- Timeline ----
    tl_title: 'Timeline of interesting moments',
    tl_scale: 'Zoom',
    tl_zoom_reset: 'Show entire video',
    tl_zoom_title: 'Timeline zoom (around player position)',

    // ---- Segments list ----
    found_moments: 'Found moments',
    add_frame: '+ Frame',
    add_frame_title: 'Add a segment around the current frame',
    clear: 'Clear',
    clear_title: 'Remove all segments',
    filter_signals_title: 'Show moments found by signal analysis (loudness/scenes/motion)',
    filter_ai_title: 'Show moments selected by AI',
    filter_algorithm: '🔵 Algorithm',
    filter_ai: '🟣 AI',
    seg_empty: 'Analysis has not been run yet. Click "Recalculate".',

    // ---- Speech / word search ----
    speech_search: '🔍 Search by words',
    transcribe: '🎙 Transcribe speech',
    speech_provider: 'Recognition source',
    speech_provider_title: 'Local — faster-whisper on your PC. API — external OpenAI-compatible service (your own endpoint and key).',
    speech_provider_local: 'Local (faster-whisper)',
    speech_provider_api: 'External API',
    speech_model: 'Recognition model',
    speech_model_title: 'The larger the model, the more accurate the recognition, but slower and more memory. When switching models the previous one is unloaded.',
    speech_api_endpoint_ph: 'Endpoint: https://…/v1/audio/transcriptions',
    speech_api_key_ph: 'API key',
    speech_api_model_ph: 'API model (e.g. whisper-1)',
    diarize: '🎭 Split by voices',
    diarize_title: 'Split recognized speech by voices (who is speaking). Requires pyannote.audio and a Hugging Face token.',
    hf_token_ph: 'Hugging Face token (hf_…)',
    speakers_min: 'Speakers: min',
    speakers_min_title: 'Minimum number of speakers (0 = auto)',
    speakers_max: 'max',
    speakers_max_title: 'Maximum number of speakers (0 = auto)',
    speakers_auto_ph: 'auto',
    preview_subs: '🎞️ Subtitles while previewing',
    speech_query_ph: 'e.g. goal, jump, win…',
    search: 'Search',
    all_words: 'All words',
    show_words: 'show',
    show_words_title: 'Show/hide the list of recognized words',

    // ---- Montage ----
    montage: 'Montage',
    ms_videos: 'Clips in montage',
    ms_segments: 'Moments',
    ms_duration: 'Final duration',
    resolution: 'Resolution',
    res_auto: 'Auto (maximum)',
    engine: 'Processing engine',
    engine_opt_auto: 'Hybrid (auto)',
    engine_opt_cpu: 'CPU (software)',
    engine_opt_nvidia: 'NVIDIA (NVENC)',
    engine_opt_amd: 'AMD (AMF)',
    engine_opt_intel: 'Intel (QSV)',
    format: 'Export format',
    fmt_mp4: 'MP4 (H.264)',
    fmt_hevc: 'MP4 (HEVC H.265)',
    fmt_webm: 'WebM (VP9)',
    fmt_mkv: 'MKV (H.264)',
    transition: 'Transition between moments',
    transition_title: 'What to insert between parts. "Marker plaque" inserts a colored frame between moments — handy for finding and cutting them in another editor.',
    tr_none: 'No transition',
    tr_fade: 'Crossfade (fade)',
    tr_fadeblack: 'Through black',
    tr_fadewhite: 'Through white',
    tr_dissolve: 'Dissolve',
    tr_wipeleft: 'Wipe left',
    tr_slideright: 'Slide right',
    tr_marker: 'Marker plaque (insert)',
    xfade: 'Transition duration',
    xfade_title: 'How many seconds the transition lasts (for marker plaque — the colored frame duration)',
    xfade_03: '0.3 s',
    xfade_05: '0.5 s',
    xfade_1: '1 s',
    xfade_2: '2 s',
    xfade_3: '3 s',
    marker_color: 'Marker color',
    marker_color_title: 'Color of the marker insert between moments',
    subs_montage: '🎞️ Subtitles (speech)',
    subs_montage_title: 'Burn subtitles from recognized speech directly into the video',
    quality: 'Quality: CRF',
    crf_title: 'Lower = better quality, larger size',
    quality_hint: 'The lower the CRF, the better and heavier the file',
    mq_empty: 'Include moments in the montage — tick them in the list.',
    montage_btn: '✂️ Build montage',
    done_title: 'Done! 🎉',
    download: '⬇ Download video',

    // ---- Help (modal) ----
    help_quickstart: `
      <summary>🚀 Quick start</summary>
      <ol>
        <li><b>Upload</b> a video — via the "Upload video" button, by dragging files into the window, or the "From disk" field (by path, without copying).</li>
        <li><b>Automatic analysis</b> starts (default "Signals"). Progress is shown in the analysis bar.</li>
        <li>Open the found moments on the <b>timeline</b> — clicking a segment plays it in the player.</li>
        <li>Tick the moments you need in the right "Montage" panel and click <b>"✂️ Build montage"</b>.</li>
        <li>Download the finished clip with the <b>"⬇ Download video"</b> button.</li>
      </ol>`,
    help_upload: `
      <summary>📥 Upload, import and library</summary>
      <ul>
        <li>Supported formats: MP4, MOV, MKV, AVI, WebM, M4V, TS, FLV, WMV, MPG, MPEG, 3GP.</li>
        <li><b>Import "from disk"</b> — enter the file path and click "📂 From disk": the video is not copied, it is read directly by path ("from disk" badge). Deleting such a record keeps the source on disk.</li>
        <li>Uploaded videos, their analysis and recognized speech are <b>saved in the cache</b> (<code>data/cache/</code>) and restored after a server restart.</li>
        <li>The <b>"🧹 Clear"</b> button removes all videos from the library: uploaded ones — together with files, "from disk" — records only.</li>
        <li>The <b>"⌫"</b> button next to a video in the list clears its found moments.</li>
      </ul>`,
    help_analysis: `
      <summary>🧠 Moment analysis (signals)</summary>
      <p>Finds interesting moments by three signals:</p>
      <ul>
        <li>🔊 <b>audio energy</b> — shouts, applause, music spikes;</li>
        <li>🎞️ <b>scene changes</b> — cuts and contrasting transitions;</li>
        <li>🏃 <b>motion</b> — active/dynamic scenes.</li>
      </ul>
      <p>Engine: <b>Auto / GPU (NVDEC) / CPU</b> — results are identical, GPU analysis is faster. <b>Selection strictness</b> sets the threshold: higher — fewer but "more interesting" moments. The "↻ Recalculate" button reruns the analysis.</p>`,
    help_ai: `
      <summary>🤖 AI analysis</summary>
      <p>In the analysis bar choose <b>Method: AI</b> — moments are found by an external model via an OpenAI-compatible API (OpenAI, OpenRouter, Ollama, LM Studio…).</p>
      <ul>
        <li><b>Endpoint</b> — API address (base; <code>/chat/completions</code> is appended automatically), <b>API key</b> and <b>model</b>.</li>
        <li><b>What we send</b>: frames (every Nth), frames + recognized speech, or speech only.</li>
        <li><b>Seconds at a time</b> — the video is processed in chunks so the model context is not overfilled.</li>
        <li><b>System prompt (addition)</b> — write here which moments to consider interesting (base rules are already built in).</li>
        <li><b>How many moments</b> — limit on the final number of moments (0 = no limit).</li>
        <li><b>Pause/resume/stop</b> are supported — progress is saved even after a restart.</li>
        <li>If signal analysis already exists, AI moments <b>complement</b> it. The "🔵 Algorithm" / "🟣 AI" filters toggle sources.</li>
      </ul>`,
    help_timeline: `
      <summary>✏️ Timeline and editing</summary>
      <ul>
        <li><b>Zoom</b>: the "Zoom" slider (up to ×40) and the mouse wheel over the timeline (centers under the cursor); "⤢" shows the entire clip.</li>
        <li><b>Segment edges</b> can be moved and stretched right on the timeline; times are also editable in the list.</li>
        <li><b>Checkboxes</b> in the found list and in the montage queue enable/disable a moment without deleting it.</li>
        <li><b>"+ Frame"</b> adds a moment around the current player position; <b>"Clear"</b> removes all moments.</li>
        <li><b>"⬇"</b> next to a segment downloads it as a separate file with the current export settings.</li>
        <li>The player window stretches by the bottom handle; playback speed — 0.3×–4×.</li>
      </ul>`,
    help_speech: `
      <summary>🗣 Speech recognition and search</summary>
      <p>The <b>"🎙 Transcribe speech"</b> button in the "Search by words" panel:</p>
      <ul>
        <li><b>Local</b> — faster-whisper on your PC (models tiny…large-v3; the previous model is unloaded when switching). With an NVIDIA GPU speech is recognized on the graphics card.</li>
        <li><b>External API</b> — your own OpenAI-compatible endpoint <code>/audio/transcriptions</code>, key and model (settings stored in the browser).</li>
        <li>After recognition, words appear as <b>timeline markers</b> (hover — word and time, click — seek), and the panel gets <b>word search</b> and the list of all words.</li>
        <li>The found fragment is added to the montage with the <b>"＋"</b> button.</li>
        <li>The <b>"Subtitles while previewing"</b> checkbox shows recognized speech over the video in the player.</li>
      </ul>`,
    help_diarization: `
      <summary>🎭 Speaker separation (diarization)</summary>
      <ul>
        <li>Enable <b>"🎭 Split by voices"</b> before recognition — utterances of different speakers get "Speaker 1…" labels, timeline colors and subtitle prefixes.</li>
        <li>Requires a <b>Hugging Face token</b> (the field nearby; stored only in the browser) and <b>pyannote.audio</b> (in requirements.txt).</li>
        <li>The first run downloads gated models from Hugging Face — you must accept the terms (see README, step 5).</li>
        <li>With an NVIDIA GPU diarization is accelerated by a CUDA torch build (see README).</li>
      </ul>`,
    help_montage: `
      <summary>✂️ Montage and export</summary>
      <ul>
        <li><b>Resolution</b>: auto (maximum) or fixed from 480p to 4K.</li>
        <li><b>Engine</b>: Hybrid (auto) / CPU / NVIDIA (NVENC) / AMD (AMF) / Intel (QSV). If a hardware encoder is unavailable — automatic CPU fallback.</li>
        <li><b>Format</b>: MP4 (H.264), MP4 (HEVC), WebM (VP9), MKV. <b>Quality</b> — CRF: lower = better and heavier.</li>
        <li><b>Transition</b> between moments: none, crossfade, through black/white, dissolve, wipe left, slide right or <b>marker plaque</b> (colored insert — handy for cutting moments in another editor). Duration — 0.3–3 s.</li>
        <li><b>Subtitles (speech)</b> — burn recognized speech directly into the frame (Cyrillic is supported). Requires prior recognition.</li>
      </ul>`,
    help_projects: `
      <summary>💾 Projects</summary>
      <ul>
        <li>The <b>"💾"</b> button in the top bar saves the project to JSON (videos, moments, recognized speech), <b>"📂"</b> loads it.</li>
        <li>The project references files in <code>data/uploads/</code> — to move to another computer transfer those files too (or add videos "from disk" by path).</li>
      </ul>`,
    help_privacy: `
      <summary>🔒 Privacy</summary>
      <p>Signal analysis and local speech recognition run <b>on your computer</b>; videos are not sent anywhere. Only the following goes online:</p>
      <ul>
        <li>requests to the APIs you specify (AI analysis, external recognition);</li>
        <li>model downloads (whisper, diarization) on first run.</li>
      </ul>
      <p>API keys and the Hugging Face token are stored <b>only in the browser</b> (localStorage) and are sent to the server only for the duration of a request — they never end up in the cache or projects.</p>`,
    help_close: '✕',
    help_title: 'MomentCut Help',

    // ---- Dynamic JS strings ----
    err_connect: 'Could not reach the server: {msg}',
    hint_speech: 'Speech',
    hint_diarization: 'Diarization',
    engine_available: 'Available',
    engine_cpu_only: 'CPU only',
    unavailable: 'unavailable',
    import_added: '«{name}» added — file was not copied',
    err_add_video: 'Could not add video: {msg}',
    not_video: '«{name}» is not a video',
    uploading: 'Uploading «{name}»…',
    uploaded: '«{name}» uploaded ({size})',
    err_upload: 'Could not upload «{name}»: {msg}',
    err_resume: 'Could not resume: {msg}',
    err_start_analysis: 'Error starting analysis: {msg}',
    analysis_paused_toast: 'AI analysis paused — progress is saved, you can resume',
    err_pause: 'Could not pause: {msg}',
    analysis_cancelled: 'Analysis cancelled',
    err_stop: 'Could not stop: {msg}',
    ai_analysis_cancelled: 'AI analysis cancelled',
    err_cancel: 'Could not cancel: {msg}',
    ai_viewed: 'viewed {pos}/{dur}',
    ai_moments_count: 'moments: {n}',
    ai_paused_status: '⏸ AI analysis paused: <b>{pct}%</b>{det}',
    ai_running_status: '<span class="spin">◌</span> AI analysis <b>{pct}%</b>{det}',
    analyzing: 'Analyzing…',
    analysis_error: 'Analysis error',
    moments_with_ai: '{n} moments ({ai} AI)',
    moments: '{n} moments',
    analysis_not_done: 'Analysis has not been run yet',
    analysis_progress_status: 'Analyzing… {pct}%{det}',
    analysis_ready: 'Analysis ready: found moments — {n}',
    err_analysis: 'Analysis error: {msg}',
    err_montage: 'Montage error: {msg}',
    transcribing: 'Transcribing…',
    err_transcribe: 'Recognition error',
    err_transcribe_msg: 'Recognition error: {msg}',
    speech_ready: 'Speech recognized — you can search by words',
    from_disk: 'from disk',
    from_disk_title: 'File was not copied to the app folder (read by path) — deleting the record keeps the source',
    speakers_badge: '🎭 speakers: {n}',
    speakers_badge_title: 'Speech split by voices (diarization)',
    ai_paused_sidebar: '⏸ AI analysis paused ({pct}%){det}',
    err_prefix: 'Error: {msg}',
    clear_moments_title: 'Clear found moments of this video',
    remove_video_title: 'Delete video',
    err_delete: 'Could not delete: {msg}',
    confirm_cleanup: 'Remove all videos from the library?\n\nVideos uploaded through the UI will be deleted together with data and cache.\n"From disk" videos will be removed from the list, but their files on disk will remain.',
    library_cleared: 'Library cleared: removed videos — {n}',
    list_empty: 'The list is already empty',
    err_cleanup: 'Could not clear: {msg}',
    transcribing_speech: 'Transcribing speech…',
    lang_suffix: ' · language: {lang}',
    words_recognized: 'Words recognized: {n}{lang}.',
    words_recognized_speakers: 'Words recognized: {n}{lang} · 🎭 speakers: {s}. Word color on the timeline is the speaker.',
    words_recognized_diar_err: 'Words recognized: {n}{lang} · ⚠ speaker separation failed: {err}',
    words_recognized_diar_on: 'Words recognized: {n}{lang} · speaker separation is enabled — press "🎙 Transcribe speech" to label speakers.',
    speech_status_hint: '{msg} Type a word to search.',
    no_speech_status: 'Speech is not recognized. Press "🎙 Transcribe speech" (the model is downloaded on first run).',
    diar_hint_pyannote: '⚠ pyannote.audio is not installed: pip install pyannote.audio torch torchaudio',
    diar_hint_token: 'A Hugging Face token (huggingface.co/settings/tokens) and accepted terms for pyannote/speaker-diarization-3.1 are required',
    err_hf_token: 'To split by voices provide a Hugging Face token (the field in the recognition panel)',
    err_start_transcribe: 'Could not start recognition: {msg}',
    searching: 'Searching…',
    err_search: 'Search error',
    err_search_msg: 'Search error: {msg}',
    word_not_found: 'Word «{q}» not found.',
    found_count: 'Found: {n}',
    watch: 'Watch',
    word_badge: 'Word «{w}»: {time}',
    add_to_moments: 'Add to moments',
    added_word: 'Added: «{w}» at {time}',
    speech_recognized_meta: '{dur} · speech recognized',
    no_analysis_meta: '{dur} · no analysis',
    tl_meta_moments: '{dur} · {n} moments',
    seg_not_found: 'No interesting moments found. Try lowering the selection strictness.',
    include_in_montage: 'Include in montage',
    start_time: 'Start (m:ss)',
    end_time: 'End (m:ss)',
    ai_src: 'AI',
    alg_src: 'ALG',
    ai_reason: 'AI: {reason}',
    signal_found: 'Found by signal analysis',
    interest_score: 'Interest score',
    watch_moment: 'Watch moment',
    download_moment: 'Download this moment as a separate file',
    delete_moment: 'Delete moment',
    moment_badge: 'Moment {i}: {start}–{end}',
    moment_added: 'Moment added — adjust the boundaries',
    moments_cleared: 'Moments cleared',
    open_in_player: 'Open in player',
    toggle_in_montage: 'Toggle moment in montage',
    assembly_badge: 'Montage: {start}–{end}',
    downloading_moment: 'Downloading moment {i}…',
    err_start_download: 'Could not start download: {msg}',
    preparing: 'Preparing…',
    err_start_montage: 'Could not start montage: {msg}',
    moment_downloaded: 'Moment {i} downloaded ({time})',
    mr_meta: '{n} moments · {time}{engine}',
    montage_ready: 'Montage ready!',
    project_saved: 'Project saved ({n} videos)',
    err_save_project: 'Could not save project: {msg}',
    err_bad_project: 'Invalid project file',
    project_loaded: 'Project loaded: {n} videos',
    project_failed_count: ', {n} not found',
    err_load_project: 'Could not load project: {msg}',

    // ---- Timeline (canvas) ----
    tl_no_data: 'No analysis data',
    tl_do_analysis: 'Run analysis to see interesting moments',
    tl_words: '▍words',

    // ---- API ----
    err_status: 'Error {status}',
    err_bad_response: 'Invalid server response',
    err_network_upload: 'Network error during upload',

    // ---- Size units ----
    unit_b: 'B',
    unit_kb: 'KB',
    unit_mb: 'MB',
    unit_gb: 'GB',
  },
};

// Текущий язык (сохранён в localStorage; по умолчанию ru — исходный интерфейс).
let currentLang = 'ru';
try {
  const saved = localStorage.getItem('mc_lang');
  if (saved === 'en') currentLang = 'en';
} catch { /* ignore */ }

const listeners = [];

export function getLang() { return currentLang; }

// Перевод по ключу с подстановкой {var}.
export function t(key, vars) {
  const dict = translations[currentLang] || translations.ru;
  let s = dict[key] ?? translations.ru[key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.split(`{${k}}`).join(String(vars[k]));
    }
  }
  return s;
}

// Подписка на смену языка (для перерисовки динамического контента).
export function onLangChange(cb) { listeners.push(cb); }

// Применяет перевод к статичным элементам DOM:
//   [data-i18n]            → textContent
//   [data-i18n-html]       → innerHTML
//   [data-i18n-placeholder]→ placeholder
//   [data-i18n-title]      → title
export function applyDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  document.documentElement.lang = currentLang;
  document.title = t('app_title');
}

// Сменить язык: сохранить, переприменить DOM, уведомить подписчиков.
export function setLang(lang) {
  if (lang !== 'ru' && lang !== 'en') return;
  currentLang = lang;
  try { localStorage.setItem('mc_lang', lang); } catch { /* ignore */ }
  applyDom();
  for (const cb of listeners) { try { cb(); } catch { /* ignore */ } }
}

// Модули ES выполняются после парсинга DOM — применяем перевод сразу при загрузке.
applyDom();
