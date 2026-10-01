---
title: DaVinci Markdown Editor — демонстрационный документ
applies_to: markdown-diagrams
---

# Что умеет DaVinci Markdown Editor

Этот файл — витрина редактора: откройте его и увидите всё, что он умеет, в одном документе.
Он же написан по стилю скилла [`markdown-diagrams`](../skills/markdown-diagrams/SKILL.md), который
лежит в репозитории: схемы не украшение, а способ показать структуру за секунды.

## Обзор

```mermaid
flowchart LR
    MD[Markdown-файл] --> P[Парсер<br/>CommonMark + GFM]
    P --> S[Санитайзер]
    S --> R[Рендер]
    R --> M[Mermaid]
    R --> K[KaTeX]
    R --> C[Shiki]
    M --> PV[Preview]
    K --> PV
    C --> PV
```

Файл проходит через парсер, очистку и только потом попадает в превью: документ считается
недоверенным вводом, поэтому произвольный HTML и скрипты до страницы не доходят.

## Поддерживаемый синтаксис

| Возможность | Синтаксис | Состояние |
|---|---|---|
| Таблицы | `\| a \| b \|` | Готово |
| Списки задач | `- [x] сделано` | Готово |
| Зачёркивание | `~~текст~~` | Готово |
| Сноски | `[^1]` | Готово |
| Диаграммы | ` ```mermaid ` | Готово |
| Формулы | `$E = mc^2$` | Готово |
| Front matter | `---` в начале файла | Готово |

## Списки задач

- [x] CommonMark и GitHub Flavored Markdown
- [x] Mermaid, KaTeX, Shiki
- [x] Ассоциация файлов в ОС
- [x] Экспорт в PDF и самодостаточный HTML
- [ ] Пакет для macOS

## Схема последовательности

```mermaid
sequenceDiagram
    participant U as Пользователь
    participant E as Редактор
    participant D as Диск
    U->>E: Ctrl+S
    E->>D: атомарная запись
    D-->>E: успех
    E-->>U: статус «Сохранено»
```

## Схема состояний

```mermaid
stateDiagram-v2
    [*] --> Чистый
    Чистый --> Изменённый: правка
    Изменённый --> Сохранённый: Ctrl+S
    Сохранённый --> Чистый
    Изменённый --> ВнешнееИзменение: файл правит другая программа
    ВнешнееИзменение --> Чистый: перезагрузить
    ВнешнееИзменение --> Изменённый: оставить свои правки
```

## Код

Подсветка работает для всех языков, которые поставляет Shiki, и подгружается по мере надобности.

```rust
fn write_bytes_atomic(target: &Path, bytes: &[u8]) -> Result<()> {
    let temp = unique_temp_path(target);
    fs::write(&temp, bytes)?;
    fs::rename(&temp, target)?;   // замена одним движением
    Ok(())
}
```

```typescript
const { html, outline } = await renderMarkdown(source, {
  allowRawHtml: true,
  renderMath: true,
  appearance: "dark",
});
```

## Математика

Вероятность коллизии при вставке в таблицу из $n$ записей:

$$
P \approx \frac{n(n-1)}{2 \cdot 62^6}
$$

Строка формул внутри текста: $E = mc^2$, $\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}$.

## Цитата и сноска

> Документ считается недоверенным вводом: превью не исполняет произвольный код.[^sanitize]

[^sanitize]: Очистка идёт по схеме `hast-util-sanitize`, расширенной только там, где Markdown
    действительно нуждается в расширении.

## Диаграмма Ганта

```mermaid
gantt
    title План релиза
    dateFormat YYYY-MM-DD
    section Ядро
    Markdown-движок   :done,    a1, 2026-01-06, 10d
    Mermaid           :done,    a2, after a1, 7d
    section Упаковка
    Windows           :done,    a3, after a2, 5d
    Linux             :active,  a4, after a3, 5d
    macOS             :           a5, after a4, 5d
```

## Круговая диаграмма

```mermaid
pie title Доля кода по языкам
    "TypeScript" : 48
    "Rust" : 34
    "CSS" : 12
    "Прочее" : 6
```

## Итоги

- [x] Открывается двойным кликом как обычный документ
- [x] Обновляется по мере набора текста
- [x] Экспортируется в PDF с настоящим текстом
- [ ] Ждём пакет для macOS
