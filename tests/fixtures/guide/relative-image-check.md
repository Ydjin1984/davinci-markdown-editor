# Проверка относительных путей

Документ лежит в `tests/fixtures/guide/`, изображения — на уровень выше и на два уровня выше.
Это обычная раскладка репозитория, где страница документации ссылается на общую папку с картинками.

## Same directory — `./local.png`

![Локальная](./local.png)

## One level up — `../images/architecture.png`

![На уровень выше](../images/architecture.png)

## Two levels up — `../../fixtures/images/architecture.png`

![На два уровня выше](../../fixtures/images/architecture.png)

## Missing file — must explain itself

![Отсутствующий](./does-not-exist.png)

## Outside every allowed folder — must explain itself

![Вне доступа](../../../../Windows/win.ini)

## Non-image target — must explain itself

![Не картинка](../math-check.md)
