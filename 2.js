/**
 * V10 v2 Plugin для Lampa TV
 * Категории с rutor.info через TorrServer прокси
 * Версия 1.0
 */

(function() {
    'use strict';

    // ---------- КОНФИГУРАЦИЯ ----------
    var BASE_URL = 'https://rutor.info';
    var CATEGORIES = [
        { name: 'Топ торренты за 24 часа', path: '/top' },
        { name: 'Зарубежные фильмы', path: '/films/foreign/' },
        { name: 'Наши фильмы', path: '/films/russian/' },
        { name: 'Зарубежные сериалы', path: '/series/foreign/' },
        { name: 'Наши сериалы', path: '/series/russian/' },
        { name: 'Телевизор', path: '/tv/' }
    ];

    // Определяем TorrServer URL
    var TS_URL = null;
    function getTsUrl() {
        if (TS_URL) return TS_URL;
        if (typeof TorrServer !== 'undefined' && TorrServer.url) TS_URL = TorrServer.url;
        else if (typeof tsUrl !== 'undefined') TS_URL = window.tsUrl;
        else if (typeof Lampa !== 'undefined' && Lampa.TorrServer && Lampa.TorrServer.url) TS_URL = Lampa.TorrServer.url;
        if (!TS_URL) TS_URL = 'http://localhost:8090';
        return TS_URL;
    }

    // Запрос через прокси TorrServer (основной метод для обхода CORS и блокировок)
    function requestViaTorrentProxy(url, callback) {
        var ts = getTsUrl();
        var proxyUrl = ts + '/proxy/' + encodeURIComponent(url);
        // Если прокси не работает, пробуем прямой запрос (но обычно CORS)
        fetch(proxyUrl)
            .then(function(response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.text();
            })
            .then(function(html) {
                callback(null, html);
            })
            .catch(function(error) {
                console.warn('Proxy failed, trying direct:', error);
                fetch(url)
                    .then(function(res) {
                        if (!res.ok) throw new Error('Direct HTTP ' + res.status);
                        return res.text();
                    })
                    .then(function(html) {
                        callback(null, html);
                    })
                    .catch(function(err) {
                        callback(err, null);
                    });
            });
    }

    // Парсинг HTML rutor (максимально простой и надёжный)
    function parseRutorHtml(html) {
        var items = [];
        // Создаём временный DOM
        var div = document.createElement('div');
        div.innerHTML = html;
        var table = div.querySelector('#index');
        if (!table) return items;
        var rows = table.querySelectorAll('tr.tr1, tr.tr2');
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var titleCell = row.querySelector('td.td-t');
            if (!titleCell) continue;
            var titleLink = titleCell.querySelector('a');
            if (!titleLink) continue;
            var title = titleLink.textContent.trim().replace(/\s+/g, ' ');
            // Поиск magnet-ссылки
            var magnet = null;
            var magnetLink = row.querySelector('a.downgif[href^="magnet:"]');
            if (!magnetLink) magnetLink = row.querySelector('a[href^="magnet:"]');
            if (magnetLink) magnet = magnetLink.getAttribute('href');
            if (!magnet) continue;
            // Размер и сидеры
            var sizeCell = row.querySelector('td.td-size');
            var size = sizeCell ? sizeCell.textContent.trim() : '';
            var seedersCell = row.querySelector('td.td-s');
            var seeders = seedersCell ? seedersCell.textContent.trim() : '0';
            var leechersCell = row.querySelector('td.td-l');
            var leechers = leechersCell ? leechersCell.textContent.trim() : '0';
            // Постер (если есть)
            var poster = null;
            var img = titleCell.querySelector('img');
            if (img && img.src) {
                var posterUrl = img.src;
                if (posterUrl.indexOf('http') !== 0) posterUrl = BASE_URL + posterUrl;
                poster = posterUrl;
            }
            items.push({
                title: title,
                magnet: magnet,
                size: size,
                seeders: seeders,
                leechers: leechers,
                description: size + ' | S:' + seeders + ' L:' + leechers,
                poster: poster
            });
        }
        return items;
    }

    // Загрузка категории (одна страница)
    function loadCategory(category, page, callback) {
        var url = BASE_URL + category.path;
        if (page > 1) {
            url += (url.indexOf('?') === -1 ? '?' : '&') + 'page=' + page;
        }
        requestViaTorrentProxy(url, function(err, html) {
            if (err) {
                console.error('Load error:', err);
                callback(err, null);
                return;
            }
            var items = parseRutorHtml(html);
            callback(null, items);
        });
    }

    // Воспроизведение через TorrServer
    function playTorrent(magnet, title) {
        if (!magnet) {
            Lampa.Notification.show('Нет magnet-ссылки');
            return;
        }
        var ts = getTsUrl();
        if (!ts) {
            Lampa.Notification.show('TorrServer не настроен');
            return;
        }
        // Добавляем торрент в TorrServer
        var addUrl = ts + '/torrent/add?magnet=' + encodeURIComponent(magnet);
        fetch(addUrl, { method: 'POST' })
            .then(function() {
                // Получаем поток
                var streamUrl = ts + '/stream?magnet=' + encodeURIComponent(magnet);
                if (typeof Lampa !== 'undefined' && Lampa.Player) {
                    Lampa.Player.play({ file: streamUrl, title: title });
                } else {
                    window.location.href = streamUrl;
                }
            })
            .catch(function(err) {
                console.error('TorrServer add error', err);
                Lampa.Notification.show('Ошибка добавления в TorrServer');
            });
    }

    // Отображение каталога с пагинацией
    function showCatalog(category, page, itemsSoFar, activity) {
        var currentPage = page || 1;
        var allItems = itemsSoFar || [];
        loadCategory(category, currentPage, function(err, newItems) {
            if (err || !newItems.length) {
                Lampa.Notification.close();
                if (allItems.length === 0) {
                    Lampa.Notification.show('Нет торрентов в этой категории');
                } else if (!newItems.length) {
                    Lampa.Notification.show('Больше страниц нет');
                }
                return;
            }
            allItems = allItems.concat(newItems);
            // Преобразуем в формат Lampa.Catalog
            var catalogItems = allItems.map(function(item) {
                return {
                    title: item.title,
                    description: item.description,
                    poster: item.poster,
                    rating: item.seeders,
                    action: function() { playTorrent(item.magnet, item.title); }
                };
            });
            var catalogData = {
                title: category.name,
                component: 'catalog',
                type: 'movie',
                items: catalogItems,
                more: {
                    title: 'Загрузить ещё',
                    action: function() {
                        showCatalog(category, currentPage + 1, allItems, activity);
                    }
                }
            };
            if (activity) {
                activity.setData(catalogData);
            } else {
                var newActivity = new Lampa.Activity({
                    title: category.name,
                    component: 'catalog',
                    data: catalogData
                });
                newActivity.open();
            }
        });
    }

    // Показать список категорий
    function showCategories() {
        var listItems = CATEGORIES.map(function(cat) {
            return {
                title: cat.name,
                description: 'Нажмите для просмотра',
                action: function() {
                    showCatalog(cat, 1, [], null);
                }
            };
        });
        var activity = new Lampa.Activity({
            title: 'V10 v2 — Категории',
            component: 'list',
            data: listItems
        });
        activity.open();
    }

    // ---------- ДОБАВЛЕНИЕ КНОПКИ В ЛЕВОЕ МЕНЮ ----------
    function addMenuButton() {
        if (typeof Lampa === 'undefined' || !Lampa.Menu) {
            console.warn('Lampa.Menu не доступен');
            return false;
        }
        try {
            Lampa.Menu.add({
                title: 'V10 v2',
                icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="24px" height="24px"><path d="M0 0h24v24H0z" fill="none"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
                action: showCategories
            });
            if (Lampa.Menu.update) Lampa.Menu.update();
            console.log('[V10 v2] Кнопка добавлена');
            return true;
        } catch(e) {
            console.error('[V10 v2] Ошибка добавления кнопки', e);
            return false;
        }
    }

    // ---------- ИНИЦИАЛИЗАЦИЯ ----------
    function init() {
        if (typeof Lampa !== 'undefined' && Lampa.Listener) {
            Lampa.Listener.follow('ready', addMenuButton);
            if (Lampa.Component && Lampa.Component.isReady) addMenuButton();
        } else {
            document.addEventListener('lampa:ready', addMenuButton);
            setTimeout(addMenuButton, 2000);
        }
    }

    init();
})();
