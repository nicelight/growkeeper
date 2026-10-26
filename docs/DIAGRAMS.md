# GrowKeeper — схемы реализации v0.2.0

Исходники находятся в `diagrams/*.mmd`. Генерация этого документа: `npm run diagrams`. Проверка структуры выполняется в `npm run check`; полноценный Mermaid renderer в этой сборочной среде не запускался.

## 01-architecture

```mermaid
flowchart TD
    User["Пользователь: текст / фото"] --> Chat["ChatGPT + GrowKeeper Skill\nReasoning и Vision"]
    Chat --> MCP["MCP /mcp\nOAuth bearer"]
    User --> Web["Standalone Web UI\nCookie + Origin"]
    Chat --> Widget["Встроенный UI\nwindow.openai bridge"]
    Widget --> MCP
    Web --> API["Web API /api/tools/*"]
    subgraph CF["Cloudflare: один Worker"]
        MCP --> Tools["Единый каталог tools + schemas"]
        API --> Tools
        Tools --> Domain["Доменная логика\nВладелец, связи, версии, переходы"]
        Cron["Cron: каждые 15 минут"] --> Delivery["Optional event dispatcher\nLease + signature + retries"]
    end
    Domain --> DB[("D1: состояние + auth + journal")]
    Domain --> R2[("R2: приватные оригиналы")]
    Delivery --> DB
    Delivery -->|"Только после подписки"| Callback["Проверенный callback ChatGPT"]
    Callback --> Chat
    Tools -->|"Реальные старые и новые изображения"| Chat
    Chat -->|"Короткий ответ + ссылки"| User
```

## 02-photo-processing

```mermaid
sequenceDiagram
    participant U as Пользователь
    participant C as ChatGPT + Skill
    participant W as Worker
    participant D as D1
    participant R as R2
    U->>C: Новая фотография / подпись
    C->>W: ingest_photo(host file reference)
    W->>R: Сохранить оригинал
    W->>D: Pending input + photo metadata
    W-->>C: input_id, photo_id
    C->>W: get_plants + get_photo_images
    W->>R: Прочитать текущий и trusted reference
    W-->>C: Реальные image content blocks
    C->>C: Сопоставить объект, окружение, ракурс
    C->>W: resolve_input(candidate, score, refs, conflicts)
    alt Недостаточная уверенность / противоречие
        W-->>C: needs_confirmation, без привязки
        C->>U: Это растение X или другое?
        U->>C: Уточнение
        C->>W: resolve_input(confirmed)
    else Порог и trusted reference соблюдены
        W->>D: Привязать input + photo к plant
    end
    C->>U: На фото вижу PlantName
    C->>W: get_case_file + get_comparison_set
    W-->>C: Текущие кейсы, journal, отобранные photo IDs
    C->>W: get_photo_images(current + older)
    W-->>C: Изображения с датами / оговорками
    C->>C: Сравнить, не путать факт и гипотезу
    C->>W: add_observation + уточнение гипотез + followup
    W->>D: Проверить и сохранить
    C->>U: Краткий вывод и следующий шаг
```

## 03-plant-resolution

```mermaid
flowchart TD
    A["Input сохранён без plant_id"] --> B{"Есть явное имя или\nподтверждённый ответ на followup?"}
    B -->|Да| C["Проверить принадлежность и контекст"]
    C --> R["RESOLVED: записать plant_id"]
    B -->|Нет| P{"Есть фото?"}
    P -->|Нет| Q["Коротко уточнить растение"]
    P -->|Да| V["ChatGPT смотрит current + trusted references"]
    V --> T{"Score не ниже порога,\nэталон подтверждён,\nнет конфликтов?"}
    T -->|Да| R
    T -->|Нет| Q
    Q --> WAIT["PENDING: исходные данные сохранены"]
    WAIT --> U["Ответ пользователя"]
    U --> N{"Это новый plant?"}
    N -->|Да| NEW["Предложить funny name\nСоздать новый plant с UUID"]
    N -->|Нет| C
    NEW --> C
    R --> SAY["Озвучить PlantName"]
    SAY --> CASE["Загрузить правильный Case File\nТолько затем записывать факты"]
    NOTE["Одно существующее растение\nне доказывает идентичность"] -.-> B
```

## 04-database-domain

```mermaid
erDiagram
    USERS ||--o{ PLANTS : owns
    USERS ||--o{ INPUTS : owns
    USERS ||--o| USER_SETTINGS : configures
    PLANTS o|--o{ INPUTS : resolves
    INPUTS ||--o| PHOTOS : carries
    PLANTS o|--o{ PHOTOS : identifies
    PLANTS ||--o{ ISSUES : tracks
    PLANTS ||--o{ OBSERVATIONS : records
    ISSUES o|--o{ OBSERVATIONS : groups
    ISSUES ||--o{ HYPOTHESES : investigates
    ISSUES ||--o{ EXPERIMENTS : tests
    HYPOTHESES o|--o{ EXPERIMENTS : motivates
    PLANTS ||--o{ FOLLOWUPS : schedules
    ISSUES o|--o{ FOLLOWUPS : links
    EXPERIMENTS o|--o{ FOLLOWUPS : evaluates
    PLANTS ||--o{ JOURNAL_ENTRIES : remembers
    ISSUES o|--o| JOURNAL_ENTRIES : concludes_once
    OBSERVATIONS }o..o{ PHOTOS : photo_ids_json
    HYPOTHESES }o..o{ OBSERVATIONS : observation_ids_json
    USERS {
        text id PK
        text display_name
        boolean active
    }
    USER_SETTINGS {
        text user_id PK,FK
        real recognition_threshold
        text timezone
    }
    PLANTS {
        text id PK
        text user_id FK
        text display_name
        text kind
        boolean name_confirmed
        integer version
        boolean deleting
    }
    INPUTS {
        text id PK
        text user_id FK
        text plant_id FK
        text text
        text status
        text resolution_method
        real recognition_score
    }
    PHOTOS {
        text id PK
        text input_id FK,UK
        text plant_id FK
        text r2_key UK
        text sha256
        text captured_at
        text received_at
        text view_tag
        text area_tag
        boolean is_reference
    }
    OBSERVATIONS {
        integer seq PK
        text id UK
        text plant_id FK
        text issue_id FK
        text source
        text text
        text photo_ids_json
        text caveats
    }
    ISSUES {
        integer seq PK
        text id UK
        text plant_id FK
        text title
        text status
        text outcome
        integer version
        text closure_key
        text result_observed_at
    }
    HYPOTHESES {
        integer seq PK
        text id UK
        text issue_id FK
        text status
        text reasoning
        text conclusion
        text observation_ids_json
        integer version
    }
    EXPERIMENTS {
        integer seq PK
        text id UK
        text issue_id FK
        text hypothesis_id FK
        text change_text
        text success_criteria
        text status
        text started_at
        text evaluate_at
        integer version
    }
    FOLLOWUPS {
        integer seq PK
        text id UK
        text plant_id FK
        text issue_id FK
        text experiment_id FK
        text due_at
        text status
        text lease_until
        integer attempts
        text last_error
    }
    JOURNAL_ENTRIES {
        integer seq PK
        text id UK
        text plant_id FK
        text issue_id FK,UK
        text entry_type
        text summary
        text outcome
        real duration_days
        real time_to_result_days
    }
```

## 05-case-and-experiment-states

```mermaid
stateDiagram-v2
    state "Issue" as ISSUE {
        [*] --> OPEN
        OPEN --> OPEN: новые факты / пересмотр гипотез
        OPEN --> RESOLVED: наблюдаемый результат + согласие
        OPEN --> CLOSED_NO_RESULT: NO_IMPROVEMENT или UNKNOWN + согласие
        RESOLVED --> [*]
        CLOSED_NO_RESULT --> [*]
    }
    state "Experiment" as EXPERIMENT {
        [*] --> PLANNED
        PLANNED --> ACTIVE: пользователь выполнил изменение
        PLANNED --> CANCELLED: отказ / закрытие Issue
        ACTIVE --> COMPLETED: зафиксирован результат проверки
        ACTIVE --> CANCELLED: прекращение / закрытие Issue
        COMPLETED --> [*]
        CANCELLED --> [*]
    }
    note right of RESOLVED
        Результат не доказывает причину.
        Issue и гипотеза не одно и то же.
    end note
    note right of ACTIVE
        Не более одного ACTIVE на plant.
        started_at — фактическое время.
    end note
```

## 06-atomic-journal

```mermaid
sequenceDiagram
    participant C as ChatGPT / пользователь
    participant W as close_issue
    participant D as D1 batch transaction
    C->>W: issue_id, expected_version, request_id, outcome, refs
    W->>D: Перечитать Issue и связанные записи
    D-->>W: Факты, попытки, планы, гипотезы
    W->>W: Проверить подтверждение, evidence и даты
    alt Наблюдений результата нет
        W->>W: Разрешён UNKNOWN, не NO_IMPROVEMENT
    end
    W->>W: Сформировать итог и два интервала времени
    W->>D: BEGIN batch
    D->>D: Conditional close Issue + closure_key
    D->>D: INSERT unique ISSUE_OUTCOME
    D->>D: ACTIVE hypotheses → INCONCLUSIVE
    D->>D: Незавершённые experiments/followups → CANCELLED
    alt Любой statement завершился ошибкой
        D->>D: ROLLBACK всей batch
        D-->>W: Ошибка, Issue не закрыт
    else Успех
        D->>D: COMMIT
        D-->>W: Issue + Journal
        W-->>C: Итог с постоянными ссылками
    end
    C->>W: Повтор того же request_id
    W->>D: Найти уже созданный результат
    W-->>C: Тот же Journal, без дубликата
```

## 07-native-followups

```mermaid
sequenceDiagram
    participant U as Пользователь
    participant H as ChatGPT host
    participant W as Worker
    participant D as D1
    participant T as Cron
    U->>H: Явно включить монитор GrowKeeper
    H->>W: events/subscribe + callback + signing secret
    W->>H: Подписанный verification challenge
    H-->>W: 2xx + echo challenge
    W->>D: Одна зашифрованная subscription с expiry
    W-->>H: subscription ID + refreshBefore
    T->>W: Каждые 15 минут
    W->>D: Due PENDING + active subscription + lease
    D-->>W: Контекст plant/followup
    W->>H: Signed event с постоянным eventId
    alt Callback вернул 2xx
        W->>D: NOTIFIED, освободить lease
        H->>U: Краткий запрос наблюдения
    else Transient failure
        W->>D: PENDING + backoff + attempts
    else 410 или 413
        W->>D: Удалить subscription, прекратить доставку
    end
    U->>H: Фото / ответ
    H->>W: Обработать факт; update_followup DONE
    U->>H: Остановить мониторинг
    H->>W: events/unsubscribe по исходной identity
    W->>D: Удалить subscription
```

## 08-oauth

```mermaid
sequenceDiagram
    participant H as ChatGPT OAuth client
    participant B as Browser
    participant W as GrowKeeper Worker
    participant D as D1
    H->>W: Protected-resource / AS discovery
    H->>B: authorize(client_id, redirect, resource, S256 challenge, state)
    B->>W: Вход личным ключом в веб-форме
    W->>D: Проверить hash и active user
    W-->>B: HttpOnly browser cookie
    B->>W: Явное согласие на OAuth
    W->>D: Одноразовый code hash + challenge
    W-->>H: redirect(code, state, iss)
    H->>W: token(code, verifier, resource)
    W->>D: Атомарно употребить code
    W-->>H: access token + refresh token
    H->>W: /mcp с bearer
    W->>D: Проверить user, scope, resource, expires
    W-->>H: Только данные этого пользователя
    H->>W: Refresh
    W->>D: Rotate access и refresh hashes
    H->>W: Revoke
    W->>D: Отозвать session и monitor subscription
```

## 09-auth-storage

```mermaid
erDiagram
    USERS ||--o{ AUTH_SESSIONS : authenticates
    USERS ||--o{ OAUTH_CODES : authorizes
    USERS ||--o| SUBSCRIPTIONS : opts_into
    USERS {
        text id PK
        text login_key_hash UK
        boolean active
    }
    AUTH_SESSIONS {
        text id PK
        text user_id FK
        text kind
        text token_hash UK
        text refresh_hash UK
        text client_id
        text resource
        text scope
        text expires_at
        text refresh_expires_at
    }
    OAUTH_CODES {
        text hash PK
        text user_id FK
        text client_id
        text redirect_uri
        text challenge
        text resource
        text scope
        text expires_at
    }
    SUBSCRIPTIONS {
        text id PK
        text user_id FK,UK
        text callback_url
        text secret_cipher
        text previous_secret_cipher
        text previous_secret_until
        text expires_at
        text verified_at
    }
```

