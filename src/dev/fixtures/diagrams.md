# Примеры Mermaid

Исходники для проверки на установленной версии Mermaid. Автоматическое выполнение в этом комплекте не проводилось.

## Цветной процесс

```mermaid
flowchart TD
    A["Открыть документ"]:::action --> B{"Формат корректен?"}:::condition
    B -->|Да| C["Построить представление"]:::action
    B -->|Нет| D["Показать ошибку и исходник"]:::error
    C --> E[("Модель документа")]:::data
    E --> F(["Готово к просмотру"]):::success
    classDef action fill:#152D48,stroke:#60A5FA,color:#F1F5F9,stroke-width:2px
    classDef condition fill:#3C2E12,stroke:#FBBF24,color:#F1F5F9,stroke-width:2px
    classDef success fill:#12382C,stroke:#34D399,color:#F1F5F9,stroke-width:2px
    classDef error fill:#431E28,stroke:#FB7185,color:#F1F5F9,stroke-width:2px
    classDef data fill:#30214A,stroke:#A78BFA,color:#F1F5F9,stroke-width:2px
```

## Повтор схемы — проверка уникальных ID

```mermaid
flowchart TD
    A["Открыть документ"]:::action --> B{"Формат корректен?"}:::condition
    B -->|Да| C["Построить представление"]:::action
    B -->|Нет| D["Показать ошибку и исходник"]:::error
    C --> E[("Модель документа")]:::data
    E --> F(["Готово к просмотру"]):::success
    classDef action fill:#152D48,stroke:#60A5FA,color:#F1F5F9,stroke-width:2px
    classDef condition fill:#3C2E12,stroke:#FBBF24,color:#F1F5F9,stroke-width:2px
    classDef success fill:#12382C,stroke:#34D399,color:#F1F5F9,stroke-width:2px
    classDef error fill:#431E28,stroke:#FB7185,color:#F1F5F9,stroke-width:2px
    classDef data fill:#30214A,stroke:#A78BFA,color:#F1F5F9,stroke-width:2px
```

## Последовательность

```mermaid
sequenceDiagram
    participant U as Пользователь
    participant E as Редактор
    participant P as Парсер
    participant V as Просмотр
    U->>E: Изменить документ
    E->>P: Исходник и ревизия
    alt Корректные данные
      P-->>E: Модель
      E->>V: Обновить текущую ревизию
    else Ошибка
      P-->>E: Диагностика
      E->>V: Показать строку ошибки
    end
    Note over E,V: Старый результат не публикуется
```

## Классы

```mermaid
classDiagram
    class Document {
      +string source
      +int revision
      +save()
    }
    class Parser {
      +parse()
    }
    class Preview {
      +render()
    }
    Document --> Parser : source
    Parser --> Preview : model
```

## Состояния

```mermaid
stateDiagram-v2
    [*] --> Clean
    Clean --> Dirty : Изменить
    Dirty --> Parsing : Разобрать
    Parsing --> Valid : Успех
    Parsing --> Invalid : Ошибка
    Invalid --> Dirty : Исправить
    Valid --> Clean : Сохранить
```

## Связи данных

```mermaid
erDiagram
    DOCUMENT ||--o{ REVISION : contains
    DOCUMENT ||--o{ DIAGNOSTIC : has
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
    }
```

## План

```mermaid
gantt
    title Развитие просмотра
    dateFormat YYYY-MM-DD
    section Рендер
    Палитра :done, a, 2026-11-09, 2d
    Геометрия :active, b, after a, 2d
    section Форматы
    JSON и XML :c, after b, 3d
    CSV и LOG :d, after c, 3d
```

## Ветки

```mermaid
gitGraph
    commit id: "base"
    branch render
    checkout render
    commit id: "palette"
    commit id: "tests"
    checkout main
    merge render
    commit id: "release"
```

## Карта

```mermaid
mindmap
  root((DaVinci))
    Документы
      MD
      JSON
      XML
    Данные
      CSV
      LOG
    Качество
      Цвет
      Экспорт
```

## Этапы

```mermaid
timeline
    title Этапы
    Аудит : Исходники : Примеры
    Рендер : Палитра : Геометрия
    Форматы : Дерево : Таблица : События
    Выпуск : Тесты : Иконки
```

## Распределение

```mermaid
pie title Учебный набор документов
    "MD" : 30
    "JSON" : 25
    "CSV" : 20
    "LOG" : 15
    "XML" : 10
```