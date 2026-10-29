# Каталог MCP / Web API

Оба транспорта используют `src/tools.js`. Ниже точные имена; полные аргументы и аннотации в `tools.schema.json`. Сервер берёт пользователя из проверенной сессии, а не из аргументов инструмента.

| Tool | Режим | Назначение |
|---|---|---|
| `create_collection` | write | Create one matching zone + group for a user-described place or plant set, atomically. Keep unknown physical location explicit. Reuse existing IDs; never substitute a shelf with only a group. Assign individual cards to returned zone. Existing structure repair uses gardening_structure. |
| `gardening_card` | write | Inspect, prepare and apply a compact sourced memory for one card without rewriting history. Check names of card, shelf/zone and group; propose missing names and get approval. Read relevant paginated history; distinguish facts, hypotheses, plans and performed actions. Apply only exact approved plan; concurrent changes reject it. Restore creates a new version, not deletion. |
| `gardening_structure` | write | Inspect structure; if inconsistent offer optimization. After consent ask 1–2 main questions, confirm assumptions and missing names, then prepare a proposal. Apply only the exact user-approved stored plan. Pairs and assignments preserve IDs/history; no deletes, nesting or cross-zone groups. |
| `get_feedback_status` | read | Check whether developer feedback delivery is configured; returns Telegram contact. Read-only. |
| `send_feedback` | write | Send a user-approved short review, wish, suggestion or bug report to developer @dyingseed via Telegram. First show the summary and ask consent. No full conversation, photos, credentials or unrelated private details. Reuse id on retry; uncertain/pending outcomes must not be resent under a new ID. |
| `get_feedback_report` | read | Read status of own feedback report, never resends it. sent means Telegram accepted, not that a human read it. |
| `get_capabilities` | read | Authoritative current GrowKeeper capabilities, limitations, release version and runtime readiness. Use whenever explaining features, checking support for a requested action, deciding how to perform it, or uncertain about plugin abilities. Read-only; not a list of all ChatGPT capabilities. |
| `new_ids` | read | Generate UUIDs for new entities. Reuse an ID when retrying the same create, not a different create. |
| `get_plants` | read | List plants and trusted reference photo IDs. A single existing plant is NOT proof that an incoming image is that plant. |
| `get_settings` | read | Read recognition threshold and timezone. |
| `get_monitoring_status` | read | Read actual subscription readiness, expiry and whether a useful opt-in offer is appropriate. Never reveals callback or signing secrets. |
| `record_monitoring_choice` | write | Record offered only when actually offering monitoring; declined only after user refusal; reset only on user request to reconsider. Record shortcut_offered only after showing the Android home-screen suggestion; it does not mean installation. This does NOT subscribe, unsubscribe or grant consent. |
| `set_settings` | write | Change settings only at the user’s request. Recognition score is heuristic, not a calibrated probability. |
| `create_zone` | write | Create a user-described physical area, e.g. balcony or upper shelf. Flat zones, no invented hierarchy. |
| `update_zone` | write | Rename or describe a known zone; preserve its identity. |
| `assign_plant_zone` | write | Assign an existing plant, bed or group to a user-described zone. clear=true removes only the location link. |
| `name_plant` | write | Name or rename a plant/bed/group without changing its profile or identity. On first photos use one wholesome funny generated name if none chosen by user. Generated names are usable immediately, never proof of visual identity. |
| `record_collection_progress` | write | Record real user activity and onboarding progress. Answer urgent question first; asked only after asking; answered after saving described collection; declined only after refusal. Activity cancels only the pending silence check. user_message_at is the actual user message timestamp, never a background wake. |
| `schedule_collection_checkin` | write | Schedule ONE gentle check-in after 24h silence, 08:00-22:00 user timezone, only after answering immediate question and explicit proactive-care consent plus active subscription. Link the existing plant needing care. Never invent a plant or schedule repeated onboarding nudges. |
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
| `create_followup` | write | Schedule one future question/photo/check. Does not enable ChatGPT notifications by itself. One followup per useful check, not every hypothesis. Inspect returned monitoring.should_offer; if true, offer one consent-based GrowKeeper event subscription. |
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
