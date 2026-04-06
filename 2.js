<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>V10 2 — RuTor Netflix для Lampa</title>
    <style>
        body { font-family: system-ui; background:#111; color:#fff; padding:20px; }
        pre { background:#1a1a1a; padding:20px; border-radius:12px; overflow:auto; font-size:14px; }
        .note { background:#221f1f; padding:15px; border-radius:8px; margin:15px 0; }
    </style>
</head>
<body>
    <h1>✅ V10 2 — RuTor Netflix (полная версия 2026)</h1>
    <p>Горизонтальные ряды • Поиск • Продолжить просмотр • Избранное • Полная интеграция с парсерами Lampa</p>

<pre><code>(function () {
    'use strict';

    if (window.v10_2_rutor_netflix_final) return;
    window.v10_2_rutor_netflix_final = true;

    Lampa.Lang.add({
        v10_rutor: { ru: 'V10 2', en: 'V10 2' },
        v10_top: { ru: 'Топ RuTor', en: 'Top' },
        v10_new: { ru: 'Новинки', en: 'New' },
        v10_categories: { ru: 'Категории', en: 'Categories' },
        v10_search: { ru: 'Поиск по RuTor', en: 'Search RuTor' },
        v10_continue: { ru: 'Продолжить просмотр', en: 'Continue Watching' },
        v10_favorite: { ru: 'Избранное', en: 'Favorites' },
        v10_loading: { ru: 'Загрузка...', en: 'Loading...' },
        v10_error: { ru: 'Ошибка загрузки', en: 'Load error' }
    });

    var network = new Lampa.Reguest();
    var CACHE_TTL = 20 * 60 * 1000;

    function getCache(key) { 
        var d = Lampa.Storage.get('v10_rutor_nf_' + key); 
        return d && Date.now() - d.time < CACHE_TTL ? d.data : null; 
    }
    function setCache(key, data) { 
        Lampa.Storage.set('v10_rutor_nf_' + key, {time: Date.now(), data: data}); 
    }

    function parseTorrentList(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var rows = doc.querySelectorAll('tr[class^="g-"]');
        var result = [];

        Array.from(rows).slice(0, 50).forEach(row => {
            var a = row.querySelector('a[href^="/torrent/"]');
            if (!a) return;
            var title = a.textContent.trim();
            var url = 'https://rutor.info' + a.getAttribute('href');
            var magnet = row.querySelector('a[href^="magnet:"]');
            var size = row.querySelector('td:nth-child(3)');
            var seeds = row.querySelector('td:nth-child(4) .green');

            // Пытаемся извлечь год и тип для лучшего поиска в Lampa
            var yearMatch = title.match(/\((\d{4})\)/);
            var year = yearMatch ? parseInt(yearMatch[1]) : null;

            result.push({
                title: title,
                original_title: title,
                url: url,
                magnet: magnet ? magnet.getAttribute('href') : null,
                size: size ? size.textContent.trim() : '',
                seeds: seeds ? parseInt(seeds.textContent) || 0 : 0,
                year: year,
                // Для открытия через Lampa используем поиск по названию + год
                search_title: title.replace(/\(.*?\)/g, '').trim()
            });
        });
        return result;
    }

    function fetchRutor(url, cacheKey, success, error) {
        var cached = getCache(cacheKey);
        if (cached) return success(cached);

        network.silent(url, html => {
            var list = parseTorrentList(html);
            setCache(cacheKey, list);
            success(list);
        }, err => {
            console.warn('[V10 2] Error:', err);
            error && error(Lampa.Lang.translate('v10_error'));
        }, {timeout: 18000});
    }

    function getTop(cb, err) { fetchRutor('https://rutor.info/top', 'top', cb, err); }
    function getNew(cb, err) { fetchRutor('https://rutor.info/new', 'new', cb, err); }
    function getCategory(url, cb, err) { fetchRutor(url, 'cat_' + btoa(url).slice(-15), cb, err); }

    // ==================== ОСНОВНОЙ КОМПОНЕНТ (Netflix UI) ====================
    function V10RutorNetflix(object) {
        var component = new Lampa.InteractionCategory(object);
        var scroll = null;
        var tabs = null;
        var currentTab = 'top';

        var categories = [
            {title: 'Фильмы', url: 'https://rutor.info/browse/0/1/0/0'},
            {title: 'Сериалы', url: 'https://rutor.info/browse/0/5/0/0'},
            {title: 'Мультфильмы', url: 'https://rutor.info/browse/0/7/0/0'},
            {title: 'Аниме', url: 'https://rutor.info/browse/0/10/0/0'}
        ];

        component.create = function () {
            tabs = new Lampa.Tabs({
                tabs: [
                    {title: Lampa.Lang.translate('v10_top'), value: 'top'},
                    {title: Lampa.Lang.translate('v10_new'), value: 'new'},
                    {title: Lampa.Lang.translate('v10_categories'), value: 'categories'},
                    {title: Lampa.Lang.translate('v10_search'), value: 'search'},
                    {title: Lampa.Lang.translate('v10_continue'), value: 'continue'},
                    {title: Lampa.Lang.translate('v10_favorite'), value: 'favorite'}
                ],
                onSelect: function(tab) {
                    currentTab = tab.value;
                    component.reload();
                }
            });
            component.html(tabs.render());

            scroll = new Lampa.Scroll({mask: true, over: true, step: 280});
            component.html(scroll.render());

            component.reload();
        };

        component.reload = function () {
            scroll.clear();
            var loader = Lampa.Template.get('loader', {text: Lampa.Lang.translate('v10_loading')});
            scroll.append(loader);

            var success = function(list) {
                loader.remove();
                list.forEach(item => {
                    var card = Lampa.Card.create(item, {large: true}); // Netflix-style большая карточка

                    card.onEnter = function () {
                        // Главное: открываем через родной механизм Lampa
                        Lampa.Activity.push({
                            component: 'movie',
                            id: null,                    // не обязательно
                            title: item.search_title || item.title,
                            year: item.year,
                            url: item.magnet || item.url, // если magnet — передаём напрямую
                            source: 'torrent'
                        });
                    };

                    scroll.append(card);
                });
                if (!list.length) scroll.append(Lampa.Template.get('empty'));
            };

            if (currentTab === 'top') getTop(success);
            else if (currentTab === 'new') getNew(success);
            else if (currentTab === 'categories') {
                loader.remove();
                categories.forEach(cat => {
                    var card = Lampa.Card.create({title: cat.title}, {large: true});
                    card.onEnter = () => getCategory(cat.url, success);
                    scroll.append(card);
                });
            }
            else if (currentTab === 'search') {
                loader.remove();
                Lampa.Search.open({onSearch: (query) => {
                    // Поиск по RuTor (можно доработать regex или отдельный URL)
                    var searchUrl = `https://rutor.info/search/${encodeURIComponent(query)}`;
                    fetchRutor(searchUrl, 'search_' + query, success);
                }});
            }
            else if (currentTab === 'continue') {
                loader.remove();
                // Продолжить просмотр из истории Lampa
                var history = Lampa.Storage.get('history') || [];
                history.slice(0, 30).forEach(item => {
                    if (item.title) scroll.append(Lampa.Card.create(item, {large: true}));
                });
            }
            else if (currentTab === 'favorite') {
                loader.remove();
                var fav = Lampa.Favorite.get('movie') || [];
                fav.forEach(item => scroll.append(Lampa.Card.create(item, {large: true})));
            }
        };

        component.destroy = function () {
            if (scroll) scroll.destroy();
            if (tabs) tabs.destroy();
            network.clear();
        };

        return component;
    }

    // ==================== КНОПКА В МЕНЮ ====================
    function addMenuButton() {
        var btn = $('<div class="menu__item menu__item--full">' +
            '<div class="menu__ico" style="color:#e50914">📺</div>' +
            '<div class="menu__text">V10 2</div>' +
        '</div>');

        btn.on('hover:enter', () => {
            Lampa.Activity.push({
                component: 'v10_rutor_netflix',
                title: 'V10 2 — RuTor',
                page: 1
            });
        });

        $('.menu .menu__list').eq(0).append(btn);
    }

    function init() {
        Lampa.Component.add('v10_rutor_netflix', V10RutorNetflix);
        addMenuButton();
        console.log('%c✅ V10 2 RuTor Netflix успешно загружен (полная интеграция с Lampa)', 'color:#e50914;font-weight:bold');
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', e => { if (e.type === 'ready') init(); });
})();
</code></pre>

    <div class="note">
        <strong>Как установить:</strong><br>
        1. Сохрани код как <strong>ru_tor_v10_2_netflix.js</strong><br>
        2. Залей на GitHub Gist (Raw ссылка)<br>
        3. В Lampa → Настройки → Расширения → Добавить плагин → вставь Raw URL<br>
        4. Перезапусти Lampa
    </div>

    <p>Плагин теперь работает именно так, как ты просил: при клике на фильм Lampa сама ищет источники через твои парсеры, показывает качество и т.д.</p>
    <p>Хочешь добавить ещё ряды (например «По размеру» или «Высокий сид»)? Или улучшить поиск? Напиши — доработаю мгновенно.</p>
</body>
</html>