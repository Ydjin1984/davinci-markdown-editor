/**
 * Starter diagrams offered by Insert → Diagram.
 *
 * These snippets are *document content*, so their labels are written in Russian
 * (the same language as the rest of the sample document). Only the UI label of
 * the menu entry goes through `t()` — see `labelKey`.
 *
 * The flowchart carries the semantic roles from the palette: Mermaid cannot know
 * that a rhombus is a condition or that a cylinder is data, so the template says
 * it with `classDef`/`:::role`. The colours here are the dark DaVinci palette;
 * they are self-contained (each shape is dark, its text is light), so the
 * contrast survives in either application appearance and the author can edit
 * them freely.
 */

import { t, type StringKey } from "@/shared/i18n";
import { templateClassDefs } from "./theme";

export interface DiagramTemplate {
  id: string;
  /** Translation key for the Insert → Diagram menu entry. */
  labelKey: StringKey;
  /**
   * Resolved menu label.
   *
   * Kept as a getter rather than a plain string so a language switch is picked
   * up the next time the menu is built, without changing the call sites that
   * already read `template.label`.
   */
  readonly label: string;
  /** Language used for the syntax of the snippet, shown in the insert menu. */
  hint: string;
  source: string;
}

const FLOWCHART_SOURCE = `flowchart TD
    A["Открыть документ"]:::action --> B{"Формат корректен?"}:::condition
    B -->|Да| C["Построить представление"]:::action
    B -->|Нет| D["Показать ошибку и исходник"]:::error
    C --> E[("Модель документа")]:::data
    E --> F(["Готово к просмотру"]):::success
${templateClassDefs("dark")}`;

interface TemplateSeed {
  id: string;
  hint: string;
  source: string;
}

const SEEDS: TemplateSeed[] = [
  {
    id: "flowchart",
    hint: "flowchart",
    source: FLOWCHART_SOURCE,
  },
  {
    id: "sequence",
    hint: "sequenceDiagram",
    source: `sequenceDiagram
    participant U as Пользователь
    participant E as Редактор
    participant D as Диск
    U->>E: Изменить документ
    E->>E: Обновить просмотр
    U->>E: Сохранить
    E->>D: Записать файл
    D-->>E: Готово`,
  },
  {
    id: "class",
    hint: "classDiagram",
    source: `classDiagram
    class Document {
        +string path
        +string content
        +save() void
    }
    class Editor {
        +open(path) Document
        +render() string
    }
    Editor --> Document : управляет`,
  },
  {
    id: "state",
    hint: "stateDiagram-v2",
    source: `stateDiagram-v2
    [*] --> Clean
    Clean --> Dirty : изменить
    Dirty --> Valid : разобрать
    Dirty --> Invalid : ошибка
    Invalid --> Dirty : исправить
    Valid --> Clean : сохранить`,
  },
  {
    id: "er",
    hint: "erDiagram",
    source: `erDiagram
    DOCUMENT ||--o{ REVISION : содержит
    DOCUMENT ||--o{ DIAGNOSTIC : имеет
    DOCUMENT {
        string path
        string kind
    }
    REVISION {
        int number
        string source
    }
    DIAGNOSTIC {
        int line
        string message
    }`,
  },
  {
    id: "gantt",
    hint: "gantt",
    source: `gantt
    title План выпуска
    dateFormat YYYY-MM-DD
    section Ядро
    Движок Markdown   :done,    a1, 2026-01-06, 10d
    Поддержка Mermaid :active,  a2, after a1, 7d
    section Сборка
    Установщик Windows :        a3, after a2, 5d
    Пакеты Linux       :        a4, after a3, 5d`,
  },
  {
    id: "gitgraph",
    hint: "gitGraph",
    source: `gitGraph
    commit id: "основа"
    branch feature/editor
    commit id: "редактор"
    commit id: "просмотр"
    checkout main
    merge feature/editor
    commit id: "выпуск"`,
  },
  {
    id: "mindmap",
    hint: "mindmap",
    source: `mindmap
  root((DaVinci))
    Документы
      Markdown
      JSON
      XML
    Данные
      CSV
      LOG
    Качество
      Цвет
      Экспорт`,
  },
  {
    id: "timeline",
    hint: "timeline",
    source: `timeline
    title Этапы
    Аудит : Исходники : Примеры
    Рендер : Палитра : Геометрия
    Форматы : Дерево : Таблица : События
    Выпуск : Тесты : Иконки`,
  },
  {
    id: "pie",
    hint: "pie",
    source: `pie title Учебный набор документов
    "Markdown" : 30
    "JSON" : 25
    "CSV" : 20
    "LOG" : 15
    "XML" : 10`,
  },
];

function withLabel(seed: TemplateSeed): DiagramTemplate {
  const labelKey = `insert.diagram.${seed.id}` as StringKey;
  return {
    id: seed.id,
    hint: seed.hint,
    source: seed.source,
    labelKey,
    get label(): string {
      return t(labelKey);
    },
  };
}

export const DIAGRAM_TEMPLATES: DiagramTemplate[] = SEEDS.map(withLabel);

export function fencedDiagram(template: DiagramTemplate): string {
  return `\`\`\`mermaid\n${template.source}\n\`\`\`\n`;
}
