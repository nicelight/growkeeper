import {VERSION} from './version.js';
import {monitoringStatus} from './monitoring.js';
export const FEATURES=[
 {id:'collection',description:'Карточки растений, грядок и групп; имена, профили и история.',tools:['get_plants','create_plant','update_plant','name_plant']},
 {id:'zones',description:'Плоские физические зоны, привязка растения/грядки/группы к одной зоне. Управление через чат.',tools:['create_zone','update_zone','assign_plant_zone'],limitations:['Нет вложенного дерева стеллажей и полок; группа не содержит дочерние карточки.']},
 {id:'photos',description:'Приватный фотоархив, реальные изображения для сравнения и подтверждённые эталоны.',tools:['ingest_photo','label_photo','get_photo_images','get_comparison_set'],limitations:['Импорт зависит от передачи файла хостом; JPEG/PNG/WebP до 10 MiB.']},
 {id:'identity',description:'Привязка сообщения/фото к объекту с уточнением при неопределённости.',tools:['record_input','resolve_input','correct_input'],limitations:['Визуальные выводы делает ChatGPT; оценка сходства не калиброванная вероятность.']},
 {id:'care_cases',description:'Наблюдения, проблемы, гипотезы, эксперименты и оценка результата по истории.',tools:['get_case_file','add_observation','create_issue','save_hypothesis','create_experiment','update_experiment','close_issue'],requires:['Подтверждение пользователя перед отметкой выполненного действия и согласие на закрытие проблемы.'],limitations:['Не гарантирует диагноз или причинность; сервер не запускает отдельную ИИ-модель.']},
 {id:'journal',description:'Долговременный дневник и поиск истории, независимые от сохранности чата.',tools:['add_journal_note','list_records','get_entity'],limitations:['Поиск текстовый, не семантический; старые записи читаются постранично.']},
 {id:'followups',description:'Отдельные проверки состояния и напоминания через одну подписку GrowKeeper.',tools:['create_followup','update_followup','get_due_followups','get_monitoring_status'],requires:['Согласие пользователя и поддерживаемая активная подписка хоста.'],limitations:['Worker сам не подписывает ChatGPT. Отправка не означает выполнение проверки. Подписка сама не создаёт план ухода. Возможны задержки и повторы доставки.']},
 {id:'onboarding',description:'Знакомство с коллекцией после помощи; одно мягкое обращение после 24 часов тишины.',tools:['record_collection_progress','schedule_collection_checkin'],requires:['Для самостоятельного обращения нужны согласие, активная подписка и реальный объект ухода.'],limitations:['Базовое окно 08:00–22:00 по часовому поясу пользователя. Worker видит только записанную инструментами активность, хост проверяет свежий чат.']},
 {id:'shortcut',description:'Разовая подсказка по добавлению чата на главный экран Android после активации мониторинга.',tools:['record_monitoring_choice'],limitations:['Не создаёт ярлык и не закрепляет чат автоматически; интерфейс зависит от версии приложения.']},
 {id:'ui',description:'Встроенный журнал, фотографии, карточки и настройки.',tools:['open_growkeeper','get_settings','set_settings'],limitations:['Доступность виджета зависит от хоста. Отдельного редактора зон в UI пока нет.']}
];
export async function getCapabilities(store,catalog){
 return {product:'GrowKeeper',version:VERSION,scope:'Только возможности этого плагина, не всего ChatGPT или устройства.',
  features:FEATURES,tool_catalog:catalog.map(t=>({name:t.name,read_only:!!t.readOnly,surface:t.appOnly?'app_only':'model_and_app'})),
  runtime:{monitoring:await monitoringStatus(store)},
  unsupported:['Управление насосами, светом и другим оборудованием','Непрерывное наблюдение без новых фото или данных','Автоматическое закрепление чата/установка ярлыка','Скрытое чтение всей переписки ChatGPT или сообщений других чатов','Вложенная иерархия зон и членство отдельных карточек в группе'],
  interpretation:'Сверяй возможности и ограничения перед обещанием. Реализация на сервере не означает наличие инструмента в текущем хосте. Если инструмента нет в доступном наборе, не выдумывай вызов и сообщи о несовпадении. Не выполняй изменения при ответе на справочный вопрос.'};
}
