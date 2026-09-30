/** Starter diagrams offered by Insert → Diagram. */

export interface DiagramTemplate {
  id: string;
  label: string;
  /** Language used for the syntax of the snippet, shown in the insert menu. */
  hint: string;
  source: string;
}

export const DIAGRAM_TEMPLATES: DiagramTemplate[] = [
  {
    id: "flowchart",
    label: "Flowchart",
    hint: "flowchart",
    source: `flowchart LR
    Client --> API
    API --> Database`,
  },
  {
    id: "sequence",
    label: "Sequence Diagram",
    hint: "sequenceDiagram",
    source: `sequenceDiagram
    participant User
    participant Editor
    participant Disk
    User->>Editor: Type a character
    Editor->>Editor: Update preview
    User->>Editor: Ctrl+S
    Editor->>Disk: Write file
    Disk-->>Editor: OK`,
  },
  {
    id: "class",
    label: "Class Diagram",
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
    Editor --> Document : manages`,
  },
  {
    id: "state",
    label: "State Diagram",
    hint: "stateDiagram-v2",
    source: `stateDiagram-v2
    [*] --> Clean
    Clean --> Dirty : edit
    Dirty --> Saved : save
    Saved --> Clean
    Dirty --> [*] : discard`,
  },
  {
    id: "er",
    label: "Entity Relationship",
    hint: "erDiagram",
    source: `erDiagram
    DOCUMENT ||--o{ REVISION : has
    DOCUMENT {
        string path
        string encoding
    }
    REVISION {
        int id
        datetime created_at
    }`,
  },
  {
    id: "gantt",
    label: "Gantt",
    hint: "gantt",
    source: `gantt
    title Release plan
    dateFormat YYYY-MM-DD
    section Core
    Markdown engine   :done,    a1, 2026-01-06, 10d
    Mermaid support   :active,  a2, after a1, 7d
    section Packaging
    Windows installer :         a3, after a2, 5d
    Linux packages    :         a4, after a3, 5d`,
  },
  {
    id: "gitgraph",
    label: "Git Graph",
    hint: "gitGraph",
    source: `gitGraph
    commit id: "init"
    branch feature/editor
    commit id: "codemirror"
    commit id: "preview"
    checkout main
    merge feature/editor
    commit id: "release"`,
  },
  {
    id: "mindmap",
    label: "Mindmap",
    hint: "mindmap",
    source: `mindmap
  root((DaVinci))
    Editor
      CodeMirror
      Keybindings
    Preview
      GFM
      Mermaid
      KaTeX`,
  },
  {
    id: "timeline",
    label: "Timeline",
    hint: "timeline",
    source: `timeline
    title Roadmap
    2026 Q1 : Markdown engine
            : Mermaid
    2026 Q2 : Packaging
            : OS integration`,
  },
  {
    id: "pie",
    label: "Pie Chart",
    hint: "pie",
    source: `pie title Supported platforms
    "Windows" : 45
    "Linux" : 45
    "macOS" : 10`,
  },
];

export function fencedDiagram(template: DiagramTemplate): string {
  return `\`\`\`mermaid\n${template.source}\n\`\`\`\n`;
}
