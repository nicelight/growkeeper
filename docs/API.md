# Каталог MCP / Web API

Оба транспорта используют `src/tools.js`. Ниже точные имена; полные аргументы и аннотации в `tools.schema.json`. Сервер берёт пользователя из проверенной сессии, а не из аргументов инструмента.

| Tool | Режим | Назначение |
|---|---|---|
| `new_ids` | read | Generate UUIDs for new entities. Reuse an ID when retrying the same create, not a different create. |
| `get_plants` | read | List plants and trusted reference photo IDs. A single existing plant is NOT proof that an incoming image is that plant. |
| `get_settings` | read | Read recognition threshold and timezone. |
| `set_settings` | write | Change settings only at the user’s request. Recognition score is heuristic, not a calibrated probability. |
| `create_plant` | write | Create a plant/bed/group. Offer one funny name; mark name_confirmed only when accepted. Reuse id on retry. |
| `update_plant` | write | Rename a plant or edit its profile after user direction. Supply the version from the current entity. |
| `record_input` | write | Persist unassigned text before resolving its plant. One logical subject per input; split a message about different plants. |
| `get_pending_inputs` | read | Read unresolved text/photo inputs; never ask the user to re-upload a stored image. |
| `resolve_input` | write | Bind input to plant. For visual matching first view current and trusted reference pixels. Pass heuristic score and conflicts. Below threshold stays pending. Always repeat the returned plant announcement. Do not fake user confirmation. |
| `correct_input` | write | Correct mistaken plant assignment after user confirmation, before observations depend on it. Processed history cannot be silently moved. |
| `ingest_photo` | write | Import the actual ChatGPT file into private R2. Each photo has a separate pending input. Never invent a download_url. JPEG/PNG/WebP, maximum 10 MiB. captured_at only if known; otherwise omit. |
| `label_photo` | write | Store observable view/area and description. A diagnosis is not a photo fact. Only user-confirmed identity may become a trusted reference. |
| `get_photo_images` | read | Return actual image pixels as MCP image content, up to 4 images / 16 MiB total. MUST use before visual identity or historical comparison; URLs/descriptions alone are not vision. |
| `get_photo_urls` | read / UI | Short-lived private photo URLs for the UI. These are not a substitute for get_photo_images when comparing in the model. |
| `get_comparison_set` | read | Select at most 3 older comparable photos for this plant: latest, before experiment, near issue opening/baseline. Then get_photo_images with selected IDs plus current. Do not infer recovery from different framing/light. |
| `add_observation` | write | Record a dated fact, user statement or visual comparison with photo IDs and caveats. No diagnoses as facts. Input must already belong to this plant; comparisons need >=2 distinct photo IDs. |
| `create_issue` | write | Create a new problem only after checking the existing case file and journal for the same issue. opened_at is first observed detection, not necessarily today. |
| `save_hypothesis` | write | Create/update a tentative explanation. Facts stay in observations. Non-ACTIVE states require a conclusion; evidence must reference observations of this plant. Update requires expected_version. |
| `create_experiment` | write | Create a PLANNED experiment, not an action already performed. Define one change, success criteria and evaluation time. Start separately after user reports making the change. |
| `update_experiment` | write | Start with user confirmation and actual started_at, or complete/cancel with result. Only one active experiment per plant. Completion is not proof of a causal hypothesis. |
| `create_followup` | write | Schedule one future question/photo/check. Does not enable ChatGPT notifications by itself. One followup per useful check, not every hypothesis. |
| `update_followup` | write | After the requested observation is actually processed mark DONE; CANCELLED stops it. PENDING + due_at reschedules. Sending a request is not completion. |
| `get_due_followups` | read | Read due work. No due work means no proactive message. Reading does not acknowledge delivery. Use one opted-in host monitor or events, not both. |
| `claim_followup` | write | For an enabled scheduled host, claim a due followup before sending. Lease prevents simultaneous cron/host delivery. Never claim merely for browsing. |
| `ack_followup` | write | After delivering the request, acknowledge its claim. Marks NOTIFIED, never DONE. Retry after expired lease can duplicate a notification; never promise exactly-once delivery. |
| `add_journal_note` | write | Add a durable NOTE or MILESTONE. ISSUE_OUTCOME is generated transactionally by close_issue, not manually. |
| `close_issue` | write | Close with user agreement after reloading current issue version. UNKNOWN for insufficient evidence; NO_IMPROVEMENT requires actual observations; RESOLVED requires evidence + result_observed_at. This atomically writes the journal and stops related followups. Do not claim failed treatment merely because data is missing. |
| `get_case_file` | read | Read compact working state, recent photos and long-term journal for one plant. Truncation is explicit; use list_records for older history. Continue existing hypotheses, do not restart every day. |
| `list_records` | read | Read paginated plant history. Journal search is a simple substring, not semantic/vector search. Follow next_offset; do not mistake one page for the whole history. |
| `get_entity` | read | Read a specific entity including its stable authenticated HTTPS link and version. |
| `delete_plant` | write / UI | Permanently delete a plant and its photos/history. Destructive: require explicit request and exact plant name. Retry resumes incomplete object deletion. |
| `open_growkeeper` | read | Open the interactive GrowKeeper journal/settings UI. Optionally focus an existing entity. Other data tools do not render widgets. |

## Ответ

`structuredContent = {ok:true,data:{...}}`; при ошибке — `{ok:false,error:{code,message,request_id?}}`, MCP `isError:true`. Фотографии дополнительно возвращаются как `content: image` с реальными байтами. Только `open_growkeeper` привязывает render resource.

## Web API

`POST /api/tools/<name>`: те же аргументы, JSON, browser session cookie и точный Origin. `POST /api/upload?id=<UUID>&caption=...`: binary JPEG/PNG/WebP. API не принимает `user_id` клиента и не использует OAuth bearer вместо cookie. MCP по `/mcp`, напротив, требует bearer OAuth.
