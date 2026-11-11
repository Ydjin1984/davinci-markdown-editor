# Clustered flowcharts (Mermaid subgraph)

Two diagrams from the customer document where clusters are drawn by Mermaid
itself. The orthogonal router must leave them exactly as rendered.

## 3.2. Two clusters with a dashed separator

```mermaid
flowchart TB
    subgraph PEREPISKA["Что следует из переписки"]
        direction LR
        P1[("CRM №1<br/>квартиры")] -->|"статусы и квартиры"| PS["Сайт"]
        PS -->|"лиды"| P2[("amoCRM")]
    end
    subgraph TZ["Что написано в ТЗ"]
        direction LR
        T1[("CRM = amoCRM<br/>и квартиры, и лиды")] <-->|"чтение каталога<br/>запись заявок"| TS["Сайт"]
    end
    PEREPISKA ~~~ TZ
    classDef bad fill:#3a1d1d,stroke:#e05252,color:#ffd7d7
    class T1 bad
```

## 3.3. Four clusters, one per configuration

```mermaid
flowchart TB
    subgraph I1["И1. Всё в одной amoCRM"]
        direction TB
        A1["Квартиры: каталог или воронка"] --> A2["Сайт"] --> A3["Лиды: amoCRM"]
    end
    subgraph I2["И2. Две разные системы"]
        direction TB
        B1[("CRM №1<br/>квартиры")] --> B2["Сайт"] --> B3[("amoCRM<br/>лиды")]
    end
    subgraph I3["И3. Два портала amoCRM"]
        direction TB
        C1[("Портал 1<br/>квартиры")] --> C2["Сайт"] --> C3[("Портал 2<br/>лиды")]
    end
    subgraph I4["И4. Внешняя система продаж"]
        direction TB
        D1[("Profitbase / MACRO / 1С<br/>шахматка")] --> D2["Сайт"] --> D3[("amoCRM<br/>лиды")]
    end
    classDef ask fill:#1c2f3f,stroke:#4a9eda,color:#d6ecff
    class A1,B1,C1,D1 ask
```
