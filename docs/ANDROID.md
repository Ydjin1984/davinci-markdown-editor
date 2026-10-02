# Android-сборка: план и устройство

Статус: собирается и проверяется на эмуляторе (Android 15, x86_64). Цель — из того же
кода собрать Android-приложение (Tauri 2 mobile), оставив только то, что нужно на
телефоне.

## Что остаётся на Android

| Возможность | Решение |
|---|---|
| Открытие markdown-файла | системный выбор файла (SAF, `ACTION_OPEN_DOCUMENT`), права сохраняются между запусками |
| **Показ отрендеренного документа по умолчанию** | всегда: GFM, Mermaid, KaTeX, подсветка кода — тот же конвейер, что на десктопе |
| Переключение на исходник | только в меню, вложенный пункт «Ещё → Исходный текст»; на экране по умолчанию его нет |
| Экспорт в PDF | системный диалог печати Android → «Сохранить как PDF» (печатается тот же WebView, тот же `print.css`) |
| Экспорт в HTML | самостоятельный файл (стили, шрифты KaTeX, диаграммы внутри) через `ACTION_CREATE_DOCUMENT` |
| Сохранение документа | запись назад в тот же `content://` URI |

## Что убирается на Android

- Проводник (Explorer), структура документа (Outline), вкладки (TabBar) — на телефоне не нужны.
- Многопанельный режим и перетаскивание разделителя: экран один — предпросмотр.
- Строка состояния десктопа.
- Работа с папками/рабочим пространством, «показать в проводнике», корзина, слежение за файлами (watcher).
- Одиночный экземпляр приложения (single-instance), CLI-аргументы, консольный вывод.
- Диалоги настроек — на Android не показываются (значения по умолчанию подходят).

Код десктопа при этом не удаляется: всё, что не нужно Android, отключается
`#[cfg(desktop)]` / `#[cfg(target_os = "android")]` и проверкой платформы во фронтенде.
Windows/Linux/macOS-сборки продолжают работать из того же репозитория.

## Как это устроено

### Две оболочки, один редактор

Фронтенд спрашивает `isMobile` (`src/shared/platform.ts`: user agent плюс `?mobile=1`
для отладки в браузере) и от этого зависит только оболочка:

| | Десктоп | Android |
|---|---|---|
| Верх | строка меню, вкладки | одна полоса: имя файла, «открыть», «☰» |
| Раскладка по умолчанию | `settings.view.layout` | всегда предпросмотр |
| Исходник | переключатель в панели редактора | «☰ → Ещё → Исходный текст» |
| Обвязка | проводник, структура, строка состояния | нет |
| Пустой экран | пустой «Untitled» | «Документ не открыт» + кнопка «Открыть файл…» |

`src/app/MobileMenu.tsx` — эта полоса и меню; `src/app/mobileDocuments.ts` — открытие
документа (закрыть предыдущий, спросив о несохранённом, затем открыть новый).

### Файлы: `content://` вместо путей

На Android файл — это не путь, а URI от системного диалога (SAF). Rust-команды
`read_document`, `write_document`, `write_export_file`, `stat_file` определяют
`content://` и уходят в Kotlin-плагин (`ContentResolver`), остальной код приложения
(store, вкладки, «грязный» флаг, экспорт) не меняется: для него URI — это просто
строка `path`.

### Печать PDF

У Android нет `window.print()`. Kotlin-плагин вызывает `PrintManager` с
`WebView.createPrintDocumentAdapter()`: печатается тот же WebView, поэтому
работает `@media print` из `print.css`, а в системном диалоге есть «Сохранить как PDF».

### Плагин `davinci-mobile`

`gen/android/app/src/main/java/io/davinci/markdown/MobilePlugin.kt`:

| Команда | Назначение |
|---|---|
| `pickDocument` | `ACTION_OPEN_DOCUMENT`, возвращает `{uri, name}`, берёт persistable-право |
| `pickSaveFile` | `ACTION_CREATE_DOCUMENT` (Save As, экспорт HTML) |
| `readText` | чтение `content://` через `ContentResolver` |
| `writeText` | запись в существующий `content://` |
| `printPage` | системная печать → PDF |
| `takeLaunchUri` | документ, с которым приложение запустили (`acceptLaunchIntent` из `MainActivity`) |

Rust-сторона (`src-tauri/src/mobile.rs`) регистрирует плагин и оборачивает команды.
Файл, открытый из файлового менеджера уже запущенным приложением, приходит событием
`android://open-uri` (`onNewIntent`).

### Что лежит в репозитории

`src-tauri/gen/android/` **не** в `.gitignore`: в нём живёт всё перечисленное выше
(плагин, манифест с intent-фильтрами, иконки), и без него сборка из свежего клона
не воспроизводится. Игнорируется только генерируемое: `build/`, `.gradle/`, `.so`,
`assets/`, `generated/` — за это отвечают `.gitignore` внутри самого проекта
(они созданы шаблоном Tauri). `tauri.settings.gradle` содержит абсолютные пути к
cargo-реестру и пересоздаётся при каждой сборке.

## Сборка

Тулчейн (всё на диске `E:`):

| Компонент | Путь |
|---|---|
| JDK 17 (Temurin) | `E:\Android\jdk-17.0.20.1+1` |
| Android SDK (`ANDROID_HOME`) | `E:\Android\Sdk` |
| NDK 27.2.12479018 | `E:\Android\Sdk\ndk\27.2.12479018` |
| AVD (эмулятор) | `E:\Android\avd` |
| Gradle-кэш | `E:\Android\gradle` |

Кроме платформы и build-tools из `app/build.gradle.kts` (`compileSdk = 37`), ничего
доустанавливать не нужно — остальное подтягивает Gradle:

```bash
sdkmanager "platforms;android-37.0" "build-tools;37.0.0"
```

```bash
export JAVA_HOME="E:/Android/jdk-17.0.20.1+1"
export ANDROID_HOME="E:/Android/Sdk"
export ANDROID_SDK_ROOT="E:/Android/Sdk"
export NDK_HOME="E:/Android/Sdk/ndk/27.2.12479018"
export GRADLE_USER_HOME="E:/Android/gradle"     # кэш Gradle — тоже на E:
export ANDROID_AVD_HOME="E:/Android/avd"

npx tauri android init                                   # один раз (в репозитории уже есть)
npx tauri android build --apk --debug --target x86_64    # APK для эмулятора
npx tauri android build --apk --target aarch64           # APK для телефона
npx tauri android build --apk --target universal         # один на всё
```

Артефакты: `src-tauri/gen/android/app/build/outputs/apk/universal/<profile>/` —
`app-universal-debug.apk` или `app-universal-release.apk` (в APK попадает только
выбранная `--target` архитектура).

Подписанный release-APK потребует `keystore.properties` в `gen/android` (файл в
`.gitignore`, ключ и пароль лежат вне репозитория).

### Иконки

Фирменные иконки уже сгенерированы и лежат в `src-tauri/icons/android/`. После
пересоздания Android-проекта (`tauri android init --force`) их нужно скопировать
в проект:

```bash
cp -r src-tauri/icons/android/* src-tauri/gen/android/app/src/main/res/
```

## Проверка

1. Эмулятор: `emulator -avd davinci -no-snapshot -no-audio -gpu swiftshader_indirect`.
2. Установка: `adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.
3. Запуск: `adb shell am start -n io.davinci.markdown/.MainActivity`.
4. Открыть файл через меню → виден отрендеренный документ (заголовки, таблицы, код, формулы, диаграмма).
5. «Ещё → Исходный текст» → редактор; назад → снова рендер.
6. «Экспорт → PDF» → в системном диалоге «Сохранить как PDF» → файл в Downloads.
7. «Экспорт → HTML» → файл сохраняется, открывается в браузере эмулятора как самостоятельная страница.
8. Поворот экрана и возврат в приложение: документ на месте, ничего не переспрашивается.
