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

        // Создаем функциональный компонент страницы по правилам архитектуры Lampa
        function Component(object) {
            var network = new Lampa.Reguest(); // Используем встроенную обертку запросов Lampa
            var scroll  = new Lampa.Scroll({ mask: true, overscroll: true });
            var items   = [];
            var activeRow = 0;
            var html    = $('<div></div>');
            var body    = $('<div class="category-full"></div>');

            this.create = function () {
                var self = this;
                
                // Инициализируем базовый контейнер скролла
                html.append(scroll.render());
                scroll.append(body);

                // Запускаем последовательную загрузку категорий
                this.load();

                return this;
            };

            this.load = function () {
                var self = this;
                var loadedCount = 0;

                CATEGORIES.forEach(function (cat, index) {
                    var rowHtml = $('<div class="explore-row info-currenly" style="margin-bottom: 25px;"><div class="explore-row__title" style="font-size: 1.5em; margin: 10px 20px; font-weight: bold; color: #fff;">' + cat.title + '</div></div>');
                    var rowScroll = new Lampa.Scroll({ horizontal: true, mask: true });
                    var rowBody = $('<div class="card-inline-cards"></div>');

                    rowScroll.append(rowBody);
                    rowHtml.append(rowScroll.render());
                    body.append(rowHtml);

                    // Делаем HTTP-запрос к нашему CORS-прокси Cloudflare Worker
                    network.silent(WORKER_URL + '?cat=' + cat.id, function (json) {
                        if (json && json.results && json.results.length > 0) {
                            json.results.forEach(function (data) {
                                // Подготовка данных карточки под стандарт Lampa
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
                                
                                // Логика обработки клика/выбора на старых ТВ (ОК на пульте)
                                card.onSelect = function () {
                                    // Вызываем глобальный встроенный поиск Lampa для нахождения раздач и онлайн-просмотра
                                    Lampa.Activity.push({
                                        url: '',
                                        title: cardData.title,
                                        component: 'search',
                                        search: cardData.title,
                                        page: 1
                                    });
                                };

                                // Прокидываем события фокуса для корректного управления с пульта ДУ
                                card.onFocus = function (target) {
                                    scroll.update(rowHtml, 'vertical');
                                    rowScroll.update(card.render(), 'horizontal');
                                };

                                rowBody.append(card.render());
                                items.push(card);
                            });

                            loadedCount++;
                            if (loadedCount === 1) {
                                // Навешиваем навигацию Lampa.Navigator, как только отрисовался первый ряд
                                self.pages();
                            }
                        }
                    }, function () {
                        // Обработка ошибки загрузки ряда
                        rowBody.append('<div class="explore-row__error" style="padding: 20px; color: #aaa;">Не удалось загрузить данные категории</div>');
                    });
                });
            };

            // Привязка элементов к общему навигатору Lampa (D-Pad пульта)
            this.pages = function () {
                if (window.explore_lines_init) return;
                window.explore_lines_init = true;

                Lampa.Background.immediately('');
                
                // Передаем управление контейнером встроенному диспетчеру фокуса Lampa
                Lampa.Navigator.set({
                    id: 'detective_collections_page',
                    render: html,
                    parent: this.object,
                    onBack: function () {
                        Lampa.Activity.onBack();
                    }
                });
            };

            // Метод вызывается платформой при фокусе на вкладке плагина
            this.start = function () {
                Lampa.Navigator.focus('detective_collections_page');
            };

            this.render = function () {
                return html;
            };

            // Обязательный метод деструктора для предотвращения утечек памяти на WebOS/Tizen
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

        // Интегрируем плагин в левое меню (Каталог) Lampa
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') {
                // Создаем пункт меню "Детективы 2026"
                var menu_item = $('<div class="menu__item selector" data-action="detective_pack">' +
                    '<span class="menu__text">Детективы 2026</span>' +
                    '</div>');

                // Обработка клика по пункту меню
                menu_item.on('hover:enter', function () {
                    Lampa.Activity.push({
                        title: 'Детективы 2026',
                        component: 'detective_collections', // Вызов нашего зарегистрированного компонента
                        page: 1
                    });
                });

                // Вставляем пункт меню в левую панель Lampa перед разделом "Закладки"
                $('.menu .menu__list').find('[data-action="bookmark"]').before(menu_item);
            }
        });

        // Регистрация кастомного компонента в фабрике компонентов Lampa
        Lampa.Component.add('detective_collections', Component);
    });
})();
