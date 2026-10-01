/**
 * Minimal string table.
 *
 * Every user-visible string goes through `t()` so a second language is a data
 * change rather than a refactor. A missing translation falls back to English
 * rather than showing a key, which keeps the UI readable at all times.
 */

type Language = "en" | "ru";

interface Entry {
  en: string;
  ru?: string;
}

const STRINGS = {
  "app.name": { en: "DaVinci Markdown Editor" },
  "app.untitled": { en: "Untitled" },

  "menu.file": { en: "File", ru: "Файл" },
  "menu.edit": { en: "Edit", ru: "Правка" },
  "menu.view": { en: "View", ru: "Вид" },
  "menu.insert": { en: "Insert", ru: "Вставка" },
  "menu.tools": { en: "Tools", ru: "Инструменты" },
  "menu.help": { en: "Help", ru: "Справка" },

  "file.new": { en: "New File", ru: "Новый файл" },
  "file.open": { en: "Open File…", ru: "Открыть файл…" },
  "file.openFolder": { en: "Open Folder…", ru: "Открыть папку…" },
  "file.openRecent": { en: "Open Recent", ru: "Недавние" },
  "file.save": { en: "Save", ru: "Сохранить" },
  "file.saveAs": { en: "Save As…", ru: "Сохранить как…" },
  "file.saveAll": { en: "Save All", ru: "Сохранить все" },
  "file.closeTab": { en: "Close", ru: "Закрыть" },
  "file.closeOthers": { en: "Close Others", ru: "Закрыть остальные" },
  "file.closeAll": { en: "Close All", ru: "Закрыть все" },
  "file.reopenClosed": { en: "Reopen Closed Tab", ru: "Вернуть закрытую вкладку" },
  "file.exit": { en: "Exit", ru: "Выход" },
  "file.noRecent": { en: "No recent files", ru: "Нет недавних файлов" },
  "file.clearRecent": { en: "Clear Recent", ru: "Очистить список" },

  "edit.undo": { en: "Undo", ru: "Отменить" },
  "edit.redo": { en: "Redo", ru: "Повторить" },
  "edit.cut": { en: "Cut", ru: "Вырезать" },
  "edit.copy": { en: "Copy", ru: "Копировать" },
  "edit.paste": { en: "Paste", ru: "Вставить" },
  "edit.find": { en: "Find", ru: "Найти" },
  "edit.replace": { en: "Replace", ru: "Заменить" },
  "edit.selectAll": { en: "Select All", ru: "Выделить всё" },

  "view.editor": { en: "Editor", ru: "Редактор" },
  "view.preview": { en: "Preview", ru: "Просмотр" },
  "view.split": { en: "Split View", ru: "Разделить" },
  "view.splitHorizontal": { en: "Split Horizontally", ru: "Разделить по горизонтали" },
  "view.splitVertical": { en: "Split Vertically", ru: "Разделить по вертикали" },
  "view.togglePreview": { en: "Toggle Preview", ru: "Переключить просмотр" },
  "view.explorer": { en: "Explorer", ru: "Проводник" },
  "view.outline": { en: "Outline", ru: "Структура" },
  "view.wordWrap": { en: "Word Wrap", ru: "Перенос строк" },
  "view.zoomIn": { en: "Zoom In", ru: "Увеличить" },
  "view.zoomOut": { en: "Zoom Out", ru: "Уменьшить" },
  "view.zoomReset": { en: "Reset Zoom", ru: "Сбросить масштаб" },
  "view.syncScroll": { en: "Synchronized Scroll", ru: "Синхронная прокрутка" },

  "insert.link": { en: "Link", ru: "Ссылка" },
  "insert.image": { en: "Image", ru: "Изображение" },
  "insert.table": { en: "Table", ru: "Таблица" },
  "insert.codeBlock": { en: "Code Block", ru: "Блок кода" },
  "insert.taskList": { en: "Task List", ru: "Список задач" },
  "insert.diagram": { en: "Diagram", ru: "Диаграмма" },
  "insert.blockquote": { en: "Blockquote", ru: "Цитата" },
  "insert.horizontalRule": { en: "Horizontal Rule", ru: "Горизонтальная линия" },

  "tools.settings": { en: "Settings", ru: "Настройки" },
  "tools.copyHtml": { en: "Copy Rendered HTML", ru: "Копировать HTML" },
  "tools.exportHtml": { en: "Export as HTML…", ru: "Экспорт в HTML…" },
  "tools.exportPdf": { en: "Export as PDF…", ru: "Экспорт в PDF…" },
  "tools.exportPdfHint": {
    en: "Opens the system print dialog — choose “Save as PDF” there.",
    ru: "Откроется системный диалог печати — выберите в нём «Сохранить как PDF».",
  },
  "tools.exportGroup": { en: "Export", ru: "Экспорт" },
  "tools.revealInExplorer": { en: "Reveal in File Manager", ru: "Показать в проводнике" },
  "tools.wordCount": { en: "Word Count", ru: "Статистика" },
  "tools.assetRoots": { en: "Preview Asset Access…", ru: "Доступ просмотра к файлам…" },

  "help.about": { en: "About", ru: "О программе" },
  "help.keyboard": { en: "Keyboard Shortcuts", ru: "Горячие клавиши" },

  "tab.close": { en: "Close Tab", ru: "Закрыть вкладку" },
  "tab.closeOthers": { en: "Close Other Tabs", ru: "Закрыть другие" },
  "tab.closeAll": { en: "Close All Tabs", ru: "Закрыть все" },
  "tab.copyPath": { en: "Copy Path", ru: "Копировать путь" },

  "explorer.title": { en: "Explorer", ru: "Проводник" },
  "explorer.openFolder": { en: "Open Folder", ru: "Открыть папку" },
  "explorer.noFolder": { en: "No folder is open.", ru: "Папка не открыта." },
  "explorer.empty": { en: "This folder is empty.", ru: "Папка пуста." },
  "explorer.newFile": { en: "New File", ru: "Новый файл" },
  "explorer.newFolder": { en: "New Folder", ru: "Новая папка" },
  "explorer.rename": { en: "Rename", ru: "Переименовать" },
  "explorer.delete": { en: "Delete", ru: "Удалить" },
  "explorer.refresh": { en: "Refresh", ru: "Обновить" },
  "explorer.reveal": { en: "Reveal in File Manager", ru: "Показать в проводнике" },
  "explorer.collapseAll": { en: "Collapse All", ru: "Свернуть всё" },
  "explorer.closeFolder": { en: "Close Folder", ru: "Закрыть папку" },

  "outline.title": { en: "Outline", ru: "Структура" },
  "outline.empty": { en: "No headings in this document.", ru: "В документе нет заголовков." },

  "status.line": { en: "Ln {line}, Col {col}", ru: "Стр {line}, Стлб {col}" },
  "status.selection": { en: "{count} selected", ru: "Выделено {count}" },
  "status.saved": { en: "Saved", ru: "Сохранено" },
  "status.modified": { en: "Modified", ru: "Изменено" },
  "status.readOnly": { en: "Read-only", ru: "Только чтение" },
  "status.externalChange": { en: "Changed on disk", ru: "Изменён на диске" },
  "status.words": { en: "{words} words", ru: "{words} слов" },
  "status.noDocument": { en: "No document", ru: "Нет документа" },

  "dialog.unsavedTitle": { en: "Unsaved Changes", ru: "Несохранённые изменения" },
  "dialog.unsavedBody": {
    en: "“{name}” has unsaved changes. Save before closing?",
    ru: "В «{name}» есть несохранённые изменения. Сохранить перед закрытием?",
  },
  "dialog.unsavedQuitBody": {
    en: "{count} document(s) have unsaved changes. Save before quitting?",
    ru: "В {count} документ(ах) есть несохранённые изменения. Сохранить перед выходом?",
  },
  "dialog.dontSave": { en: "Don't Save", ru: "Не сохранять" },
  "dialog.save": { en: "Save", ru: "Сохранить" },
  "dialog.cancel": { en: "Cancel", ru: "Отмена" },
  "dialog.deleteTitle": { en: "Delete", ru: "Удаление" },
  "dialog.deleteBody": {
    en: "Move “{name}” to the trash?",
    ru: "Переместить «{name}» в корзину?",
  },
  "dialog.deleteBodyFolder": {
    en: "Move “{name}” and everything inside it to the trash?",
    ru: "Переместить «{name}» и всё содержимое в корзину?",
  },
  "dialog.externalTitle": { en: "File Changed on Disk", ru: "Файл изменён на диске" },
  "dialog.externalBody": {
    en: "“{name}” was modified by another program.",
    ru: "«{name}» был изменён другой программой.",
  },
  "dialog.reload": { en: "Reload", ru: "Перезагрузить" },
  "dialog.keepLocal": { en: "Keep Local Changes", ru: "Оставить мои изменения" },
  "dialog.deletePermanently": { en: "Delete Permanently", ru: "Удалить безвозвратно" },
  "dialog.closeFolderTitle": { en: "Close Folder", ru: "Закрыть папку" },

  "settings.title": { en: "Settings", ru: "Настройки" },
  "settings.category.editor": { en: "Editor", ru: "Редактор" },
  "settings.category.preview": { en: "Preview", ru: "Просмотр" },
  "settings.category.files": { en: "Files", ru: "Файлы" },
  "settings.category.application": { en: "Application", ru: "Приложение" },
  "settings.fontFamily": { en: "Font family", ru: "Шрифт" },
  "settings.fontSize": { en: "Font size", ru: "Размер шрифта" },
  "settings.lineHeight": { en: "Line height", ru: "Высота строки" },
  "settings.tabSize": { en: "Tab size", ru: "Размер табуляции" },
  "settings.insertSpaces": { en: "Insert spaces", ru: "Вставлять пробелы" },
  "settings.wordWrap": { en: "Word wrap", ru: "Перенос строк" },
  "settings.lineNumbers": { en: "Line numbers", ru: "Номера строк" },
  "settings.highlightActiveLine": { en: "Highlight active line", ru: "Подсветка активной строки" },
  "settings.bracketMatching": { en: "Bracket matching", ru: "Сопоставление скобок" },
  "settings.codeFolding": { en: "Code folding", ru: "Свёртывание кода" },
  "settings.showWhitespace": { en: "Show whitespace", ru: "Показывать пробелы" },
  "settings.autosave": { en: "Autosave", ru: "Автосохранение" },
  "settings.autosaveDelay": { en: "Autosave delay (ms)", ru: "Задержка автосохранения (мс)" },
  "settings.autosaveOnBlur": {
    en: "Autosave when the window loses focus",
    ru: "Сохранять при потере фокуса",
  },
  "settings.previewTheme": { en: "Preview theme", ru: "Тема просмотра" },
  "settings.syncScroll": { en: "Synchronized scroll", ru: "Синхронная прокрутка" },
  "settings.mermaidTheme": { en: "Mermaid theme", ru: "Тема Mermaid" },
  "settings.codeTheme": { en: "Code theme", ru: "Тема кода" },
  "settings.rawHtml": { en: "Render raw HTML (sanitized)", ru: "Разрешить HTML (с очисткой)" },
  "settings.renderMath": { en: "Render math with KaTeX", ru: "Формулы KaTeX" },
  "settings.lineWrapCode": { en: "Wrap long code lines", ru: "Переносить длинные строки кода" },
  "settings.openExternalLinks": { en: "Open links in the system browser", ru: "Открывать ссылки в браузере" },
  "settings.headingAnchors": { en: "Show heading anchor links", ru: "Ссылки-якоря у заголовков" },
  "settings.restoreSession": { en: "Restore the previous session", ru: "Восстанавливать сессию" },
  "settings.externalChange": { en: "When a file changes on disk", ru: "При изменении файла на диске" },
  "settings.externalAsk": { en: "Ask", ru: "Спрашивать" },
  "settings.externalReload": { en: "Reload automatically", ru: "Перезагружать" },
  "settings.externalKeep": { en: "Keep my version", ru: "Оставить мою версию" },
  "settings.defaultEol": { en: "Default line endings", ru: "Концы строк по умолчанию" },
  "settings.defaultEncoding": { en: "Default encoding", ru: "Кодировка по умолчанию" },
  "settings.showIgnored": {
    en: "Show ignored files (node_modules, .git)",
    ru: "Показывать игнорируемые файлы",
  },
  "settings.confirmDelete": { en: "Confirm before deleting", ru: "Подтверждать удаление" },
  "settings.appTheme": { en: "Application theme", ru: "Тема приложения" },
  "settings.language": { en: "Language", ru: "Язык" },
  "settings.zoom": { en: "Interface zoom", ru: "Масштаб интерфейса" },
  "settings.telemetry": { en: "Telemetry (always off)", ru: "Телеметрия (всегда выключена)" },
  "settings.reset": { en: "Reset to Defaults", ru: "Сбросить настройки" },
  "settings.resetConfirm": {
    en: "Reset every setting to its default value?",
    ru: "Сбросить все настройки к значениям по умолчанию?",
  },
  "settings.languageSystem": { en: "System", ru: "Системный" },
  "settings.themeSystem": { en: "System", ru: "Системная" },
  "settings.themeLight": { en: "Light", ru: "Светлая" },
  "settings.themeDark": { en: "Dark", ru: "Тёмная" },

  "error.openTitle": { en: "Could not open file", ru: "Не удалось открыть файл" },
  "error.saveTitle": { en: "Could not save file", ru: "Не удалось сохранить файл" },
  "error.openFolderTitle": { en: "Could not open folder", ru: "Не удалось открыть папку" },
  "error.genericTitle": { en: "Something went wrong", ru: "Что-то пошло не так" },
  "error.conflictTitle": { en: "File Changed on Disk", ru: "Файл изменён на диске" },
  "error.conflictBody": {
    en: "“{name}” changed since it was loaded. Saving now would discard those changes.",
    ru: "«{name}» изменился после загрузки. Сохранение перезапишет эти изменения.",
  },
  "error.saveACopy": { en: "Save As…", ru: "Сохранить как…" },
  "error.overwrite": { en: "Overwrite", ru: "Перезаписать" },
  "error.crashTitle": {
    en: "The interface hit an unexpected error",
    ru: "Интерфейс столкнулся с непредвиденной ошибкой",
  },
  "error.crashBody": {
    en: "Your unsaved documents are still in memory. Reload the interface to continue; you will be offered to restore them.",
    ru: "Несохранённые документы остались в памяти. Перезагрузите интерфейс, чтобы продолжить; вам будет предложено их восстановить.",
  },
  "error.reload": { en: "Reload Interface", ru: "Перезагрузить интерфейс" },

  "preview.empty": { en: "Nothing to preview yet.", ru: "Пока нечего просматривать." },
  "preview.noDocument": {
    en: "Open a Markdown file to see its preview.",
    ru: "Откройте Markdown-файл, чтобы увидеть просмотр.",
  },
  "editor.noDocument": { en: "No document is open.", ru: "Документ не открыт." },
  "editor.readOnlyBanner": {
    en: "This file is read-only. Use Save As to keep your changes.",
    ru: "Файл доступен только для чтения. Используйте «Сохранить как».",
  },

  "mermaid.error": { en: "Mermaid render error", ru: "Ошибка отрисовки Mermaid" },
  "mermaid.line": { en: "Line {line}", ru: "Строка {line}" },
  "mermaid.copySvg": { en: "Copy as SVG", ru: "Копировать SVG" },
  "mermaid.exportSvg": { en: "Export as SVG…", ru: "Экспорт в SVG…" },
  "mermaid.zoomIn": { en: "Zoom in", ru: "Увеличить" },
  "mermaid.zoomOut": { en: "Zoom out", ru: "Уменьшить" },
  "mermaid.fit": { en: "Fit to view", ru: "Вписать в окно" },
  "mermaid.reset": { en: "Reset zoom", ru: "Сбросить масштаб" },
  "mermaid.rendering": { en: "Rendering diagram…", ru: "Отрисовка диаграммы…" },

  "code.copy": { en: "Copy", ru: "Копировать" },
  "code.copied": { en: "Copied", ru: "Скопировано" },

  "math.error": { en: "Math error", ru: "Ошибка формулы" },

  "image.failedTitle": { en: "Image could not be displayed", ru: "Не удалось показать изображение" },
  "image.failedBody": {
    en: "The file exists but could not be read.",
    ru: "Файл существует, но не читается.",
  },
  "image.missingTitle": { en: "Image not found", ru: "Изображение не найдено" },
  "image.missingBody": { en: "No file exists at this path.", ru: "По этому пути файла нет." },
  "image.blockedTitle": {
    en: "Image is outside the folders the preview may read",
    ru: "Изображение вне папок, доступных просмотру",
  },
  "image.blockedBody": {
    en: "The preview reads the folder of each open document, its parent folders, and the open workspace.",
    ru: "Просмотр читает папку каждого открытого документа, её родительские папки и открытую рабочую папку.",
  },
  "image.unsupportedTitle": { en: "Unsupported file type", ru: "Неподдерживаемый тип файла" },
  "image.unsupportedBody": {
    en: "The preview only inlines images, fonts and media.",
    ru: "Просмотр показывает только изображения, шрифты и медиа.",
  },

  "toast.saved": { en: "Saved {name}", ru: "Сохранено: {name}" },
  "toast.copied": { en: "Copied to clipboard", ru: "Скопировано в буфер" },
  "toast.copyFailed": { en: "Could not access the clipboard", ru: "Нет доступа к буферу обмена" },
  "toast.exported": { en: "Exported {name}", ru: "Экспортировано: {name}" },
  "toast.tabClosed": { en: "Closed {name}", ru: "Закрыто: {name}" },
  "toast.undo": { en: "Undo", ru: "Отменить" },

  "about.version": { en: "Version {version}", ru: "Версия {version}" },
  "about.runtime": { en: "Runtime", ru: "Среда" },
  "about.configDir": { en: "Settings folder", ru: "Папка настроек" },
  "about.close": { en: "Close", ru: "Закрыть" },

  "shortcut.open": { en: "Open", ru: "Открыть" },
  "shortcut.openFolder": { en: "Open Folder", ru: "Открыть папку" },
  "shortcut.save": { en: "Save", ru: "Сохранить" },
  "shortcut.saveAs": { en: "Save As", ru: "Сохранить как" },
  "shortcut.new": { en: "New", ru: "Новый" },
  "shortcut.find": { en: "Find", ru: "Найти" },
  "shortcut.replace": { en: "Replace", ru: "Заменить" },
  "shortcut.bold": { en: "Bold", ru: "Жирный" },
  "shortcut.italic": { en: "Italic", ru: "Курсив" },
  "shortcut.undo": { en: "Undo", ru: "Отменить" },
  "shortcut.redo": { en: "Redo", ru: "Повторить" },
  "shortcut.closeTab": { en: "Close tab", ru: "Закрыть вкладку" },
  "shortcut.settings": { en: "Settings", ru: "Настройки" },

  "common.ok": { en: "OK" },
  "common.cancel": { en: "Cancel", ru: "Отмена" },
  "common.apply": { en: "Apply", ru: "Применить" },
  "common.name": { en: "Name", ru: "Имя" },
  "common.rename": { en: "Rename", ru: "Переименовать" },
  "common.create": { en: "Create", ru: "Создать" },

  "about.publisher": { en: "DaVinci Cyber Engineering", ru: "DaVinci Cyber Engineering" },
  "about.tagline": { en: "Secure · Analyze · Engineer · Build", ru: "Secure · Analyze · Engineer · Build" },
  "about.contact": { en: "Contact", ru: "Связаться" },
  "about.website": { en: "Website", ru: "Сайт" },
  "about.email": { en: "Email", ru: "Почта" },
  "about.donate": { en: "Support the project", ru: "Поддержать проект" },
  "about.donateNote": {
    en: "Donations are voluntary and do not buy support, features or licences.",
    ru: "Донат добровольный и не даёт прав на поддержку, функции или лицензию.",
  },
  "about.network": { en: "Network", ru: "Сеть" },
  "about.address": { en: "Address", ru: "Адрес" },
  "about.scanHint": {
    en: "Scan with a TRON wallet to send USDT (TRC20).",
    ru: "Отсканируйте в TRON-кошельке, чтобы отправить USDT (TRC20).",
  },
  "about.copyAddress": { en: "Copy address", ru: "Копировать адрес" },
  "about.openWebsite": { en: "Open website", ru: "Открыть сайт" },
  "about.sendEmail": { en: "Send email", ru: "Написать письмо" },
  "about.qrAlt": { en: "TRC20 donation address QR code", ru: "QR-код адреса для доната TRC20" },
  "about.license": { en: "Licensed under the MIT licence.", ru: "Лицензия MIT." },
} as const satisfies Record<string, Entry>;

export type StringKey = keyof typeof STRINGS;

let current: Language = "en";

/** `system` resolves through the browser's UI language. */
export function resolveLanguage(preference: string): Language {
  if (preference === "ru" || preference === "en") return preference;
  const detected = typeof navigator !== "undefined" ? navigator.language : "en";
  return detected.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function setLanguage(language: Language): void {
  current = language;
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
  }
}

export function getLanguage(): Language {
  return current;
}

/** Translate a key, substituting `{name}` style placeholders. */
export function t(key: StringKey, params?: Record<string, string | number>): string {
  const entry: Entry | undefined = STRINGS[key];
  const template = (current === "ru" ? entry?.ru : undefined) ?? entry?.en ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
