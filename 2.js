(function () {
    'use strict';

    // Регистрируем плагин внутри экосистемы Lampa
    Lampa.Plugins.add('detective_collections', function () {
        
        // ССЫЛКА НА ВАШ СЕРВЕР CLOUDFLARE WORKER
        // Замените этот URL на адрес вашего развернутого воркера!
        var WORKER_URL = 'https://lampa-parser.mail-internetx.workers.dev/';

        // Конфигурация категорий (рядов) на экране
        var CATEGORIES = [
            { id: '1', title: 'Топ раздач (Kinozal)' },
            { id: '2', title: 'Новинки кино (Film.ru)' },
            { id: '3', title: 'Детективы 2026 года (Mail.ru)' },
            { id: '4', title: 'Зарубежные детективные сериалы (Film.ru)' },
            { id: '5', title: 'Русские детективные сериалы (Mail.ru)' }
        ];

        // Создаем функциональный компонент страницы
        function Component(object) {
            var network = new Lampa.Reguest();
            var scroll  = new Lampa.Scroll({ mask: true, overscroll: true });
            var items   = [];
            var html    = $('<div></div>');
            var body    = $('<div class="category-full"></div>');

            this.create = function () {
                html.append(scroll.render());
                scroll.append(body);
                this.load();
                return this;
            };

            this.load = function () {
                var self = this;
                var loadedCount = 0;

                CATEGORIES.forEach(function (cat) {
                    var rowHtml = $('<div class="explore-row info-currenly" style="margin-bottom: 25px;"><div class="explore-row__title" style="font-size: 1.5em; margin: 10px 20px; font-weight: bold; color: #fff;">' + cat.title + '</div></div>');
                    var rowScroll = new Lampa.Scroll({ horizontal: true, mask: true });
                    var rowBody = $('<div class="card-inline-cards"></div>');

                    rowScroll.append(rowBody);
                    rowHtml.append(rowScroll.render());
                    body.append(rowHtml);

                    network.silent(WORKER_URL + '?cat=' + cat.id, function (json) {
                        if (json && json.results && json.results.length > 0) {
                            json.results.forEach(function (data) {
                                var cardData = {
                                    id: data.id,
                                    title: data.title,
                                    original_title: data.original_title || '',
                                    img: data.img || 'img/no_poster.png',
                                    year: data.year || 2026,
                                    vote_average: data.vote_average || 0
                                };

                                var card = new Lampa.Card(cardData, {
                                    card_small: true,
                                    card_category: true
                                });
                                
                                card.create();
                                
                                card.onSelect = function () {
                                    Lampa.Activity.push({
                                        url: '',
                                        title: cardData.title,
                                        component: 'search',
                                        search: cardData.title,
                                        page: 1
                                    });
                                };

                                card.onFocus = function () {
                                    scroll.update(rowHtml, 'vertical');
                                    rowScroll.update(card.render(), 'horizontal');
                                };

                                rowBody.append(card.render());
                                items.push(card);
                            });

                            loadedCount++;
                            if (loadedCount === 1) {
                                self.pages();
                            }
                        }
                    }, function () {
                        rowBody.append('<div class="explore-row__error" style="padding: 20px; color: #aaa;">Не удалось загрузить данные категории</div>');
                    });
                });
            };

            this.pages = function () {
                if (window.explore_lines_init) return;
                window.explore_lines_init = true;

                Lampa.Background.immediately('');
                
                Lampa.Navigator.set({
                    id: 'detective_collections_page',
                    render: html,
                    parent: this.object,
                    onBack: function () {
                        Lampa.Activity.onBack();
                    }
                });
            };

            this.start = function () {
                Lampa.Navigator.focus('detective_collections_page');
            };

            this.render = function () {
                return html;
            };

            this.destroy = function () {
                network.clear();
                scroll.destroy();
                if (items) {
                    items.forEach(function (item) {
                        if (item.destroy) item.destroy();
                    });
                }
                items = null;
                html.remove();
                body.remove();
                window.explore_lines_init = false;
            };
        }

        // Регистрируем компонент страницы в системе
        Lampa.Component.add('detective_collections', Component);

        // Функция гарантированного внедрения кнопки в меню
        function injectMenuButton() {
            // Проверяем, нет ли уже этой кнопки, чтобы избежать дублирования
            if ($('.menu__list [data-action="detective_pack"]').length > 0) return;

            var menuList = $('.menu .menu__list');
            if (menuList.length > 0) {
                // Создаем элемент меню по официальному шаблону Lampa
                var menu_item = $('<div class="menu__item selector" data-action="detective_pack">' +
                    '<span class="menu__text">Детективы 2026</span>' +
                    '</div>');

                // Используем универсальный обработрчик клика/энтера для Smart TV
                menu_item.on('click hover:enter', function (e) {
                    e.preventDefault();
                    
                    // Закрываем меню (полезно на мобильных и некоторых интерфейсах ТВ)
                    if (Lampa.Menu && Lampa.Menu.close) Lampa.Menu.close();

                    Lampa.Activity.push({
                        title: 'Детективы 2026',
                        component: 'detective_collections',
                        page: 1
                    });
                });

                // Находим кнопку "Закладки" или "Фильмы", чтобы встать рядом
                var anchor = menuList.find('[data-action="bookmark"]');
                if (anchor.length === 0) anchor = menuList.find('[data-action="movie"]');
                
                if (anchor.length > 0) {
                    anchor.before(menu_item);
                } else {
                    menuList.append(menu_item); // Если ничего не нашли, просто кидаем в конец
                }

                // Перезапускаем навигацию меню, чтобы Lampa увидела новый селектор пульта
                if (Lampa.Menu && Lampa.Menu.update) Lampa.Menu.update();
            }
        }

        // Попытка №1: Срабатывает при старте приложения
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') {
                injectMenuButton();
            }
        });

        // Попытка №2: Страховка для медленных ТВ (WebOS/Tizen), если DOM меню формируется позже
        var timerCount = 0;
        var menuTimer = setInterval(function () {
            timerCount++;
            if ($('.menu .menu__list').length > 0) {
                injectMenuButton();
                clearInterval(menuTimer);
            }
            if (timerCount > 30) clearInterval(menuTimer); // Защита от вечного цикла (15 секунд)
        }, 500);
    });
})();
