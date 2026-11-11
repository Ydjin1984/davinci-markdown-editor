# Mermaid: ортогональные маршруты (ТЗ `DaVinci_Mermaid_Render_TZ.md`)

## Итог

- Mermaid **11.17.2** (lockfile `package-lock.json`, `npm ls mermaid --all` — одна версия).
- Движок: штатный **dagre** плюс **собственный ортогональный роутер** `src/mermaid/route/`.
  `flowchart.curve: "step"` убирает кривые, роутер перестраивает порты, коридоры и подписи.
- **ELK проверен и отклонён.** `@mermaid-js/layout-elk@0.2.3` совместим с Mermaid 11, но меняет
  раскладку так, что «Кэш каталога» и «Profitbase» оказываются на одном уровне, а референс требует
  «Кэш» выше Middleware. Версия `1.0.2` требует `mermaid ^12`. Для `stateDiagram-v2` в 11.17 ELK не
  подключается (`StateDiagramConfig.defaultRenderer` — только `dagre-d3`/`dagre-wrapper`). Пакет
  удалён, `package-lock.json` не изменён.

## Изменённые файлы

| Файл | Что сделано |
|---|---|
| `src/mermaid/renderer.ts` | `RENDER_VERSION` render-2 → **render-4**; `LAYOUT_VERSION` layout-1 → **layout-2**; `LAYOUT_OPTIONS.flowchart = { curve: "step", nodeSpacing: 56, rankSpacing: 76, padding: 16 }`; `mermaidConfig().flowchart` = htmlLabels/useMaxWidth + spread; `improveOrthogonalRoutes(svg)` перед `stripUnsafeMarkup` и кэшированием; единая `DIAGRAM_FONT_FAMILY` из темы |
| `src/mermaid/theme.ts` | `PALETTE_VERSION` davinci-1 → **davinci-2**; `themeCSS`: `rect.label-container { rx/ry: 4px }`, первая строка узла `font-weight: 600`, подписи `400`, рёбра `stroke-width: 1.6px`; экспорт `DIAGRAM_FONT_FAMILY` |
| `src/mermaid/route/geometry.ts` | новый: чистый ортогональный роутер (порты, ромбы-вершины, коридоры, обратные рёбра, петли, коллизии, откат) |
| `src/mermaid/route/svg.ts` | новый: чтение SVG (`g.node`, `data-id`, `data-points`), перенос примечания вправо, расстановка подписей, `viewBox`, fallback |
| `src/dev/fixtures/render-tz.md` | оба исходника ТЗ как приёмочные данные Render Lab |
| `src/dev/renderLab.tsx` | подключение фикстуры |
| `vite.config.ts` | `watch.ignored: "**/*.tmpdir/**"` — атомарная запись файла роняет chokidar (`EBUSY`) |
| `tests/mermaid/route.test.ts` | новый: 10 адресных проверок геометрии |
| `tests/mermaid/renderer.test.ts`, `tests/mermaid/theme.test.ts` | обновлены под новый контракт |

## Как устроен роутер

1. Из готового SVG читаются узлы (`getBBox` + `getCTM`, включая цилиндры/ромбы/примечания) и рёбра
   (`data-id` для flowchart, концы пути для state).
2. Для каждого ребра выбирается пара сторон с учётом направления потока; порты на одной стороне
   смещаются **по направлению ребра** (`±22px`), поэтому две связи из одной грани не сливаются.
3. Ромб получает порт только в свободную вершину; вход «сверху»/«слева» соответствует таблице ТЗ.
4. Обратные рёбра уходят во внешний коридор (для горизонтальных графов — под всеми узлами), встречные
   связи получают разные коридоры и текстовые зоны.
5. Маршрут проверяется на узлы и уже проложенные сегменты; при неустранимой коллизии ребро
   возвращается к пути Mermaid (`failed`), а не угадывается.
6. Подпись ставится рядом с длиннейшим сегментом своего ребра (сверху/снизу, справа/слева), сдвигается
   вдоль сегмента при коллизии; подписи не касаются чужих линий, узлов и друг друга.
7. `viewBox`/`width`/`height` пересчитываются по узлам, путям и подписям.

## Приёмка (ТЗ §5)

| Проверка | Результат |
|---|---|
| Flowchart A | 7 фигур, 9 стрелок, из них 3 пунктирные; `classDef gap` применён к `Q`, `CACHE`, `LOG` |
| State B | 4 состояния, 8 переходов, 6 подписей; примечание справа от `reserved`, соединитель пунктирный без наконечника |
| Геометрия | независимый анализатор: 0 наклонных сегментов, 0 пересечений, 0 общих отрезков, 0 попаданий в узлы, 0 подписей на линиях/подписях |
| SVG | A: 29 341 B, B: 42 780 B; `xmlns` + `viewBox`, **без `foreignObject`**, 16 `<text>`, пунктир и маркеры (9/8); открыт автономно в Chrome |
| Регрессия | `npm run test` — 361 тест, 21 файл; `lint`, `typecheck`, `format:check` — чисто; `npm run build` — успех |

### Маршруты схемы A

| Связь | Маршрут (SVG `d`) |
|---|---|
| Goodland → Middleware | `M227.8,260.79H303.8` — прямая |
| Middleware → Кэш | `M409.93,225.49V21.3H565` — верхний выход, вход слева |
| Кэш → Profitbase | `M762.98,65.3H948.53V96.96` — верхний обход, вход сверху |
| Middleware → Profitbase | `M472.05,238.79H838.43V130.05H862.43` — правый порт, вход слева |
| Middleware → amoCRM | `M472.05,282.79H831.93V371.93H855.93` — отдельный правый порт |
| Profitbase → Q | `M990.62,174.05H1186.54V237` — пунктир в верхнюю вершину ромба |
| amoCRM → Q | `M997.12,349.93H1073.62` — горизонтальный пунктир в левую вершину |
| Q → Middleware | `M1186.54,462.86V490.86H365.93V296.09` — из нижней вершины по нижнему коридору, вход снизу |
| Middleware → Логи | `M431.93,225.49V156.7H548.05` — второй верхний выход |

### Схема B

`free` сверху, `reserved` слева, `unavailable` справа, `sold` под `reserved` (раскладка dagre
сохранена). `extend` — прямоугольная петля справа от `reserved`. Встречные переходы
`free↔reserved` и `free↔unavailable` идут разными маршрутами и не пересекаются. Примечание
перенесено вправо от `reserved` (ниже петли), соединитель — пунктир без наконечника.

## Скриншоты и экспорт

- `docs/screenshots/mermaid/flowchart-dark.png`
- `docs/screenshots/mermaid/flowchart-light.png`
- `docs/screenshots/mermaid/state-dark.png`
- `docs/screenshots/mermaid/state-light.png`
- `docs/screenshots/mermaid/flowchart-narrow.png` — узкое окно 600 px, fit 0.35, ничего не обрезано
- `docs/screenshots/mermaid/flowchart-standalone.svg`, `state-standalone.svg` — автономный экспорт

## Ограничения

- Подпись `extend` остаётся на месте, вычисленном Mermaid: петля 28×20 px, а подпись 52 px не
  помещается в её сегмент. Она не пересекает другие линии и подписи.
- Роутер применяется только к `flowchart*` и `stateDiagram*`; остальные типы (sequence, class, gantt,
  gitGraph, mindmap, timeline, pie, er) не затрагиваются.
- При неузнаваемой структуре (неизвестный тип, нет `data-id`/`data-points`, нет DOM) возвращается
  исходный SVG Mermaid — это и есть откат, а не «примерный» результат.
- В светлой теме авторский `classDef` из документа сохраняет свои тёмные заливки — приоритет
  авторских стилей зафиксирован ТЗ.
