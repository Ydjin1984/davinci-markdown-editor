# ТЗ: рендер Mermaid — два исходника

Схемы из `DaVinci_Mermaid_Render_TZ.md` §4. Используются Render Lab для приёмки
геометрии, маршрутов и подписей.

## A. Интеграция Goodland

```mermaid
flowchart LR
    U["Goodland<br/>витрина + менеджер"] --> API["Middleware<br/>/api/external/*"]
    API --> CACHE["Кэш каталога<br/>TTL: не определён"]
    CACHE --> PB[("Profitbase<br/>объекты, цены, доступность")]
    API --> PB
    API --> AMO[("amoCRM<br/>контакты, сделки")]
    PB -.-> Q{"Кто источник истины<br/>о резерве?"}
    AMO -.-> Q
    Q -.-> API
    API --> LOG["Логи<br/>маскирование ПДн: не определено"]
    classDef gap fill:#3a1d1d,stroke:#e05252,color:#ffd7d7
    class Q,CACHE,LOG gap
```

## B. Состояния резерва

```mermaid
stateDiagram-v2
    [*] --> free
    free --> reserved : create fixation
    reserved --> sold : сделка или оплата
    reserved --> free : cancel или истечение срока
    reserved --> reserved : extend
    free --> unavailable : снято с продажи
    unavailable --> free : возврат в продажу
    sold --> [*]
    note right of reserved : Кто владеет переходом — Profitbase, amoCRM или middleware? Не определено
```
