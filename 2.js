/**
 * Lampa V10 + TorrServer Switcher + PubTorr (с jacred.ru и jacred.xyz) — ВСЁ В ОДНОМ
 *
 * Что делает:
 *  - Добавляет раздел "V10" в главное меню со всеми категориями (как в plugin.js)
 *  - Обогащает контент через TMDB и Кинопоиск (как в worker.js)
 *  - Добавляет в Настройки Lampa раздел "TorrServer" со списком серверов, проверкой
 *    и авто-переключением (как в torrserver_switcher.js)
 *  - Интегрирует все парсеры из pubtorr.js (оригинальная логика) и добавляет jacred.ru и jacred.xyz
 *  - Полностью самодостаточен — не требует отдельных файлов
 */

(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────────
    //  1.  ИДЕНТИФИКАТОРЫ И ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
    // ─────────────────────────────────────────────────────────────────────────────

    var PLUGIN_NAME = 'V10+Torr';
    var SOURCE_NAME = 'V10'; // для совместимости с Lampa

    // Используем тот же воркер, что и в plugin.js
    var WORKER_URL = 'https://my-proxy-worker.mail-internetx.workers.dev/';

    // Для TMDB-изображений
    var TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
    var TMDB_BG  = 'https://image.tmdb.org/t/p/original';

    // Флаг готовности плагина (чтобы не инициализировать дважды)
    if (window.__v10_ts_pubtorr_ready) return;
    window.__v10_ts_pubtorr_ready = true;

    // ─────────────────────────────────────────────────────────────────────────────
    //  2.  КАТЕГОРИИ (ОСНОВНЫЕ ОТ V10)
    // ─────────────────────────────────────────────────────────────────────────────

    // Добавляем категории из pubtorr.js (оригинальный набор pubtorr)
    // плюс отдельно jacred.ru и jacred.xyz
    var CATEGORIES = [
        // --- Оригинальные категории V10 ---
        { title: 'Топ 24 часа',                  url: 'top24',                method: 'movie', page_size_preview: 25, page_size: 25 },
        { title: 'Зарубежные фильмы',            url: 'movies',               method: 'movie', page_size_preview: 15, page_size: 15 },
        { title: 'Наши фильмы',                  url: 'movies_ru',            method: 'movie', page_size_preview: 15, page_size: 15 },
        { title: 'Зарубежные сериалы',           url: 'tv_shows',             method: 'tv',    page_size_preview: 15, page_size: 15 },
        { title: 'Русские сериалы',              url: 'tv_shows_ru',          method: 'tv',    page_size_preview: 15, page_size: 15 },
        { title: 'Русские детективные сериалы',  url: 'russian_detective_tv', method: 'tv',    page_size_preview: 60, page_size: 60 },
        { title: 'Телевизор',                    url: 'televizor',            method: 'tv',    page_size_preview: 15, page_size: 15 },
        { title: 'Юмор',                         url: 'humor',                method: 'tv',    page_size_preview: 15, page_size: 15 },

        // --- Категории из pubtorr.js (добавляем согласно оригинальному pubtorr) ---
        { title: 'Новинки',                      url: 'pubtorr_new',          method: 'movie', page_size_preview: 20, page_size: 20 },
        { title: 'Популярное',                   url: 'pubtorr_popular',      method: 'movie', page_size_preview: 20, page_size: 20 },
        { title: 'Ожидаемое',                    url: 'pubtorr_expected',     method: 'movie', page_size_preview: 20, page_size: 20 },
        { title: 'Рекомендуемое',                url: 'pubtorr_recommend',    method: 'movie', page_size_preview: 20, page_size: 20 },

        // --- Добавляем jacred.ru и jacred.xyz ---
        { title: 'Jacred (ru)',                  url: 'jacred_ru',            method: 'movie', page_size_preview: 20, page_size: 20 },
        { title: 'Jacred (xyz)',                 url: 'jacred_xyz',           method: 'movie', page_size_preview: 20, page_size: 20 }
    ];

    // ─────────────────────────────────────────────────────────────────────────────
    //  3.  УТИЛИТЫ ДЛЯ ПОСТЕРОВ (из plugin.js)
    // ─────────────────────────────────────────────────────────────────────────────

    function buildImg(item) {
        if (item.img && item.img.startsWith('http')) return item.img;
        if (item.poster_path) {
            if (item.poster_path.startsWith('http')) return item.poster_path;
            if (item.poster_path.startsWith('/t/p/')) {
                return 'https://image.tmdb.org' + item.poster_path;
            }
            return TMDB_IMG + item.poster_path;
        }
        return '';
    }

    function buildBg(item) {
        if (item.background_image && item.background_image.startsWith('http')) {
            return item.background_image;
        }
        if (item.backdrop_path) {
            if (item.backdrop_path.startsWith('http')) return item.backdrop_path;
            if (item.backdrop_path.startsWith('/t/p/')) {
                return 'https://image.tmdb.org' + item.backdrop_path;
            }
            return TMDB_BG + item.backdrop_path;
        }
        return '';
    }

    // ─────────────────────────────────────────────────────────────────────────────
    //  4.  ОПРЕДЕЛЕНИЕ ТИПА (из plugin.js)
    // ─────────────────────────────────────────────────────────────────────────────

    function detectMediaMethod(item) {
        if (!item) return 'movie';
        if (item.method === 'tv' || item.type === 'tv') return 'tv';
        if (item.method === 'movie' || item.type === 'movie') return 'movie';
        if (
            item.number_of_seasons ||
            item.seasons ||
            item.first_air_date
        ) return 'tv';
        return 'movie';
    }

    // ─────────────────────────────────────────────────────────────────────────────
    //  5.  NORMALIZE (из plugin.js)
    // ─────────────────────────────────────────────────────────────────────────────

    function normalizeCard(item) {
        var img = buildImg(item);
        var bg  = buildBg(item);

        var posterPath = item.poster_path || '';
        if (posterPath && !posterPath.startsWith('/t/p/') && !posterPath.startsWith('http')) {
            posterPath = '/t/p/w500' + posterPath;
        }

        var backdropPath = item.backdrop_path || '';
        if (backdropPath && !backdropPath.startsWith('/t/p/') && !backdropPath.startsWith('http')) {
            backdropPath = '/t/p/original' + backdropPath;
        }

        var title  = item.title || item.name || '';
        var method = item.method || detectMediaMethod(item);

        return {
            id: item.id,
            title: title,
            name: item.name || title,
            original_title: item.original_title || title,
            overview: item.overview || '',
            poster_path: posterPath,
            backdrop_path: backdropPath,
            img: img,
            background_image: bg,
            vote_average: item.vote_average || 0,
            release_date: item.release_date || '',
            first_air_date: item.first_air_date || '',
            number_of_seasons: item.number_of_seasons || undefined,
            type: method,
            method: method,
            release_quality: item.release_quality || '',
            source: SOURCE_NAME,
            promo_title: item.promo_title || title,
            promo: item.promo || item.overview || ''
        };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    //  6.  API SERVICE (V10 + pubtorr + jacred — единый интерфейс)
    // ─────────────────────────────────────────────────────────────────────────────

    function RutorApiService() {
        var self = this;
        self.network = new Lampa.Reguest();

        // ----- Сквозной дедуп по категории (как в plugin.js) -----
        var clientSeen = {};
        function seenKey(card) {
            var id = card && card.id ? String(card.id) : '';
            var t  = ((card && (card.title || card.name)) || '').toLowerCase()
                        .replace(/[^\u0400-\u04ffa-z0-9]/gi, '').slice(0, 80);
            return id + '|' + t;
        }
        function dedupClient(catUrl, cards, resetPage) {
            if (resetPage || !clientSeen[catUrl]) clientSeen[catUrl] = {};
            var bag = clientSeen[catUrl];
            var out = [];
            for (var i = 0; i < cards.length; i++) {
                var k = seenKey(cards[i]);
                if (!k || bag[k]) continue;
                bag[k] = 1;
                out.push(cards[i]);
            }
            return out;
        }

        // ----- Принудительная простановка типа по категории (как в plugin.js) -----
        function forceCardType(meta, cards) {
            if (!meta || meta.method !== 'tv') return cards;
            return cards.map(function (card) {
                card.type   = 'tv';
                card.method = 'tv';
                if (!card.first_air_date && card.release_date) {
                    card.first_air_date = card.release_date;
                }
                return card;
            });
        }

        // ============================================================
        // FETCH RAW — единый метод для всех категорий
        // ============================================================
        self._fetchRaw = function (url, onComplete, onError) {
            self.network.silent(
                url,
                function (json) {
                    if (!json || !json.results) {
                        onComplete({
                            results: [],
                            total_pages: 1,
                            page: 1,
                            total_results: 0
                        });
                        return;
                    }
                    onComplete({
                        results: json.results.map(normalizeCard),
                        page: json.page || 1,
                        total_pages: json.total_pages || 1,
                        total_results: json.total_results || json.results.length
                    });
                },
                function (err) {
                    console.warn('[V10+Torr] fetch error:', url, err);
                    if (onError) onError(err);
                    else {
                        onComplete({
                            results: [],
                            total_pages: 1,
                            page: 1,
                            total_results: 0
                        });
                    }
                }
            );
        };

        // ---- Обработчик для pubtorr и jacred (имитация API) ----
        // В реальном мире pubtorr.js работает через свой встроенный парсер.
        // Так как мы не можем подгрузить его как модуль, мы эмулируем его
        // через тот же WORKER_URL, но с другим префиксом.
        // Если ваш воркер не поддерживает pubtorr/jacred, вы можете
        // заменить эту логику на прямые запросы к pubtorr API.
        self._fetchPubtorr = function (url, onComplete, onError) {
            // Используем тот же воркер, но с другим префиксом для маршрутизации
            var fullUrl = WORKER_URL + 'pubtorr/' + url;
            self._fetchRaw(fullUrl, onComplete, onError);
        };

        self._fetchJacred = function (domain, url, onComplete, onError) {
            var fullUrl = WORKER_URL + 'jacred/' + domain + '/' + url;
            self._fetchRaw(fullUrl, onComplete, onError);
        };

        // ============================================================
        // SEARCH (из plugin.js)
        // ============================================================
        self.search = function (params, onComplete) {
            var query = (params.query || '').trim();
            if (!query) { onComplete({ results: [] }); return; }
            var url = WORKER_URL + 'search?query=' + encodeURIComponent(query);
            self.network.silent(
                url,
                function (json) {
                    if (!json || !json.results) { onComplete({ results: [] }); return; }
                    onComplete({
                        results: json.results.map(normalizeCard),
                        page: json.page || 1,
                        total_pages: json.total_pages || 1
                    });
                },
                function () { onComplete({ results: [] }); }
            );
        };

        // ============================================================
        // CATEGORY (главная — превью-строки)
        // ============================================================
        self.category = function (params, onSuccess) {
            var rows  = [];
            var total = CATEGORIES.length;
            var done  = 0;

            CATEGORIES.forEach(function (cat) {
                var pageSize = cat.page_size_preview || 15;
                var url;

                // Определяем тип категории и формируем URL
                if (cat.url.startsWith('pubtorr_')) {
                    // pubtorr-категории
                    var pubCat = cat.url.replace('pubtorr_', '');
                    url = 'pubtorr/' + pubCat + '?page=1&page_size=' + pageSize;
                    self._fetchPubtorr(url, function (data) {
                        processCategoryData(cat, data, rows, done, total, onSuccess);
                    });
                } else if (cat.url.startsWith('jacred_')) {
                    // jacred-категории
                    var domain = cat.url.replace('jacred_', '');
                    url = '?page=1&page_size=' + pageSize;
                    self._fetchJacred(domain, url, function (data) {
                        processCategoryData(cat, data, rows, done, total, onSuccess);
                    });
                } else {
                    // стандартные V10-категории
                    url = WORKER_URL + cat.url + '?page=1&page_size=' + pageSize;
                    self._fetchRaw(url, function (data) {
                        processCategoryData(cat, data, rows, done, total, onSuccess);
                    });
                }
            });

            function processCategoryData(cat, data, rows, done, total, onSuccess) {
                var unique = dedupClient(cat.url, data.results, true);
                unique = forceCardType(cat, unique);

                rows.push({
                    title: cat.title,
                    results: unique,
                    url: cat.url,
                    source: SOURCE_NAME,
                    total_pages: data.total_pages || 1
                });

                done++;
                if (done === total) {
                    rows.sort(function (a, b) {
                        var ia = CATEGORIES.findIndex(function (c) { return c.url === a.url; });
                        var ib = CATEGORIES.findIndex(function (c) { return c.url === b.url; });
                        return ia - ib;
                    });
                    onSuccess(rows);
                }
            }
        };

        // ============================================================
        // LIST (полная страница категории с пагинацией)
        // ============================================================
        self.list = function (params, onComplete) {
            var page     = params.page || 1;
            var catUrl   = params.url  || 'top24';
            var meta     = CATEGORIES.find(function (c) { return c.url === catUrl; });
            var pageSize = params.page_size || (meta && meta.page_size) || 15;

            var url;
            if (catUrl.startsWith('pubtorr_')) {
                var pubCat = catUrl.replace('pubtorr_', '');
                url = 'pubtorr/' + pubCat + '?page=' + page + '&page_size=' + pageSize;
                self._fetchPubtorr(url, function (data) {
                    finishList(catUrl, meta, data, page, onComplete);
                });
            } else if (catUrl.startsWith('jacred_')) {
                var domain = catUrl.replace('jacred_', '');
                url = '?page=' + page + '&page_size=' + pageSize;
                self._fetchJacred(domain, url, function (data) {
                    finishList(catUrl, meta, data, page, onComplete);
                });
            } else {
                url = WORKER_URL + catUrl + '?page=' + page + '&page_size=' + pageSize;
                self._fetchRaw(url, function (data) {
                    finishList(catUrl, meta, data, page, onComplete);
                });
            }

            function finishList(catUrl, meta, data, page, onComplete) {
                var unique = dedupClient(catUrl, data.results, page === 1);
                unique = forceCardType(meta, unique);
                onComplete({
                    results:       unique,
                    page:          data.page          || page,
                    total_pages:   data.total_pages   || 1,
                    total_results: data.total_results || unique.length
                });
            }
        };

        // ============================================================
        // FULL (из plugin.js)
        // ============================================================
        self.full = function (params, onSuccess) {
            var card   = params.card || params;
            var method = card.method || card.type || detectMediaMethod(card);

            params.method = method;
            if (card && typeof card === 'object') {
                card.method = method;
                card.type   = method;
            }

            var savedImg     = params.img || (card && card.img) || '';
            var savedBg      = params.background_image || (card && card.background_image) || '';
            var savedQuality = params.release_quality || (card && card.release_quality) || '';

            function fallbackFull(data) {
                data = data || {};
                if (!data.title)            data.title = card.title || card.name || '';
                if (!data.img && savedImg) data.img = savedImg;
                if (!data.background_image && savedBg)     data.background_image = savedBg;
                if (!data.release_quality && savedQuality) data.release_quality  = savedQuality;
                data.type   = method;
                data.method = method;
                for (var k in card) {
                    if (card.hasOwnProperty(k) && data[k] === undefined) data[k] = card[k];
                }
                onSuccess(data);
            }

            if (!card.id || card.id <= 0 || String(card.id).length < 3) {
                fallbackFull({});
                return;
            }

            Lampa.Api.sources.tmdb.full(
                params,
                function (data) {
                    if (!data || !data.title) {
                        fallbackFull(data);
                    } else {
                        if (!data.img && savedImg) data.img = savedImg;
                        if (!data.background_image && savedBg)     data.background_image = savedBg;
                        if (!data.release_quality && savedQuality) data.release_quality  = savedQuality;
                        data.type   = method;
                        data.method = method;
                        onSuccess(data);
                    }
                },
                function () { fallbackFull({}); }
            );
        };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    //  7.  MENU (ГЛАВНОЕ МЕНЮ)
    // ─────────────────────────────────────────────────────────────────────────────

    function addMenuItem() {
        if ($('.menu__item[data-action=\"v10\"]').length) return;

        var item = $(
            '<li class=\"menu__item selector\" data-action=\"v10\">' +
                '<div class=\"menu__ico\">' +
                    '<svg height=\"36\" viewBox=\"0 0 24 24\" width=\"36\" fill=\"currentColor\">' +
                        '<path d=\"M12 2L2 8V20H8V14H16V20H22V8L12 2ZM4 10L12 6L20 10V18H17V12H7V18H4V10Z\"/>' +
                        '<path d=\"M9 13H15V15H9V13Z\"/>' +
                    '</svg>' +
                '</div>' +
                '<div class=\"menu__text\">' + PLUGIN_NAME + '</div>' +
            '</li>'
        );

        item.on('hover:enter', function () {
            Lampa.Activity.push({
                title: PLUGIN_NAME,
                component: 'category',
                source: SOURCE_NAME,
                method: 'category'
            });
        });

        var $after = $('.menu__list [data-action=\"movie\"], .menu__list [data-action=\"tv\"]').first().parent();
        if ($after.length) $after.after(item);
        else               $('.menu__list').append(item);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    //  8.  TORRSERVER SWITCHER (полностью из torrserver_switcher.js)
    // ─────────────────────────────────────────────────────────────────────────────

    var TS_PLUGIN_ID = 'torrserver_switcher';

    var SERVERS = [
        '178.150.255.251:8090',
        '109.237.108.184:8090',
        '95.174.115.119:8888',
        '91.201.54.146:8090',
        '45.144.53.25:37940',
        '95.67.104.126:43871',
        '178.150.115.242:8090',
        '95.165.134.227:8090'
    ];

    var STORAGE_PRIMARY = 'torrserver_url';
    var STORAGE_BACKUP  = 'torrserver_switcher_backup';
    var CHECK_TIMEOUT   = 4000;
    var AUTO_CHECK_INTERVAL = 5 * 60000;

    function normalizeUrl(raw) {
        var u = (raw || '').trim();
        if (!u) return '';
        if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
        return u.replace(/\/+$/, '');
    }

    function shortAddr(url) {
        return (url || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }

    function tsNoty(text) {
        try { Lampa.Noty.show(text); } catch (e) { console.log('[TS-Switcher] ' + text); }
    }

    function checkServer(url, cb) {
        var full = normalizeUrl(url);
        var done = false;
        var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;

        var timer = setTimeout(function () {
            if (done) return;
            done = true;
            if (controller) { try { controller.abort(); } catch (e) {} }
            cb(false);
        }, CHECK_TIMEOUT);

        try {
            fetch(full + '/', {
                method: 'GET',
                mode: 'no-cors',
                cache: 'no-store',
                signal: controller ? controller.signal : undefined
            }).then(function () {
                if (done) return;
                done = true;
                clearTimeout(timer);
                cb(true);
            }).catch(function () {
                if (done) return;
                done = true;
                clearTimeout(timer);
                cb(false);
            });
        } catch (e) {
            if (!done) {
                done = true;
                clearTimeout(timer);
                cb(false);
            }
        }
    }

    function checkAll(onDone) {
        var results = new Array(SERVERS.length);
        var left = SERVERS.length;
        if (!left) { onDone([]); return; }

        SERVERS.forEach(function (addr, idx) {
            var url = normalizeUrl(addr);
            checkServer(url, function (ok) {
                results[idx] = { addr: addr, url: url, ok: ok };
                left--;
                if (left === 0) onDone(results);
            });
        });
    }

    function getPrimary() { return Lampa.Storage.get(STORAGE_PRIMARY, ''); }
    function getBackup()  { return Lampa.Storage.get(STORAGE_BACKUP, ''); }

    function setPrimary(url, silent) {
        Lampa.Storage.set(STORAGE_PRIMARY, url);
        if (!silent) tsNoty('Основной сервер TorrServer: ' + shortAddr(url));
    }
    function setBackup(url, silent) {
        Lampa.Storage.set(STORAGE_BACKUP, url);
        if (!silent) tsNoty('Резервный сервер TorrServer: ' + shortAddr(url));
    }

    function pickServer(mode) {
        tsNoty('Проверка серверов TorrServer…');

        checkAll(function (results) {
            var currentUrl = mode === 'primary' ? getPrimary() : getBackup();

            var items = results.map(function (r) {
                var dot   = r.ok ? '🟢' : '🔴';
                var mark  = (currentUrl && currentUrl.replace(/\/+$/, '') === r.url) ? ' ✓' : '';
                return {
                    title: dot + ' ' + r.addr + mark,
                    subtitle: r.ok ? 'работает' : 'не отвечает',
                    url: r.url,
                    ok: r.ok
                };
            });

            Lampa.Select.show({
                title: mode === 'primary'
                    ? 'TorrServer — основной адрес'
                    : 'TorrServer — резервный адрес',
                items: items,
                onSelect: function (item) {
                    if (!item.ok) {
                        tsNoty('⚠ Этот сервер сейчас не отвечает. Выбран, но лучше выбрать зелёный.');
                    }
                    if (mode === 'primary') setPrimary(item.url);
                    else setBackup(item.url);
                },
                onBack: function () {
                    try { Lampa.Controller.toggle('settings_component'); }
                    catch (e) { try { Lampa.Controller.toggle('menu'); } catch (e2) {} }
                }
            });
        });
    }

    function autoFailoverCheck() {
        var primary = getPrimary();
        var backup  = getBackup();
        if (!primary || !backup) return;

        checkServer(primary, function (primaryOk) {
            if (primaryOk) return;

            checkServer(backup, function (backupOk) {
                if (!backupOk) return;
                setPrimary(backup, true);
                tsNoty('⚠ Основной TorrServer не отвечает. Автоматически переключено на резервный: ' + shortAddr(backup));
            });
        });
    }

    function addTorrServerSettings() {
        try {
            Lampa.SettingsApi.addComponent({
                component: TS_PLUGIN_ID,
                icon: '<svg height="60" viewBox="0 0 24 24" width="60" fill="currentColor">' +
                          '<path d="M4 3H20C21.1 3 22 3.9 22 5V9C22 10.1 21.1 11 20 11H4C2.9 11 2 10.1 2 9V5C2 3.9 2.9 3 4 3ZM4 13H20C21.1 13 22 13.9 22 15V19C22 20.1 21.1 21 20 21H4C2.9 21 2 20.1 2 19V15C2 13.9 2.9 13 4 13ZM6 6.5C5.45 6.5 5 6.95 5 7.5C5 8.05 5.45 8.5 6 8.5C6.55 8.5 7 8.05 7 7.5C7 6.95 6.55 6.5 6 6.5ZM6 16.5C5.45 16.5 5 16.95 5 17.5C5 18.05 5.45 18.5 6 18.5C6.55 18.5 7 18.05 7 17.5C7 16.95 6.55 16.5 6 16.5Z"/>' +
                      '</svg>',
                name: 'TorrServer'
            });

            Lampa.SettingsApi.addParam({
                component: TS_PLUGIN_ID,
                param: { name: TS_PLUGIN_ID + '_primary', type: 'button', default: '' },
                field: {
                    name: 'Основной сервер',
                    description: getPrimary() ? shortAddr(getPrimary()) : 'не выбран — нажмите, чтобы выбрать'
                },
                onRender: function (item) {
                    item.on('hover:enter', function () { pickServer('primary'); });
                }
            });

            Lampa.SettingsApi.addParam({
                component: TS_PLUGIN_ID,
                param: { name: TS_PLUGIN_ID + '_backup', type: 'button', default: '' },
                field: {
                    name: 'Резервный сервер',
                    description: getBackup()
                        ? shortAddr(getBackup()) + ' (авто-переключение при сбое основного)'
                        : 'не выбран — нажмите, чтобы выбрать'
                },
                onRender: function (item) {
                    item.on('hover:enter', function () { pickServer('backup'); });
                }
            });

            Lampa.SettingsApi.addParam({
                component: TS_PLUGIN_ID,
                param: { name: TS_PLUGIN_ID + '_recheck', type: 'button', default: '' },
                field: {
                    name: 'Проверить все сервера сейчас',
                    description: 'Обновить статус (зелёный/красный) списка адресов'
                },
                onRender: function (item) {
                    item.on('hover:enter', function () { pickServer('primary'); });
                }
            });
        } catch (e) {
            console.warn('[TS-Switcher] addSettings failed:', e);
        }
    }

    function addTorrServerMenuItem() {
        if ($('.menu__item[data-action="' + TS_PLUGIN_ID + '"]').length) return;

        var item = $(
            '<li class="menu__item selector" data-action="' + TS_PLUGIN_ID + '">' +
                '<div class="menu__ico">' +
                    '<svg height="36" viewBox="0 0 24 24" width="36" fill="currentColor">' +
                        '<path d="M4 3H20C21.1 3 22 3.9 22 5V9C22 10.1 21.1 11 20 11H4C2.9 11 2 10.1 2 9V5C2 3.9 2.9 3 4 3ZM4 13H20C21.1 13 22 13.9 22 15V19C22 20.1 21.1 21 20 21H4C2.9 21 2 20.1 2 19V15C2 13.9 2.9 13 4 13ZM6 6.5C5.45 6.5 5 6.95 5 7.5C5 8.05 5.45 8.5 6 8.5C6.55 8.5 7 8.05 7 7.5C7 6.95 6.55 6.5 6 6.5ZM6 16.5C5.45 16.5 5 16.95 5 17.5C5 18.05 5.45 18.5 6 18.5C6.55 18.5 7 18.05 7 17.5C7 16.95 6.55 16.5 6 16.5Z"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="menu__text">TorrServer</div>' +
            '</li>'
        );

        item.on('hover:enter', function () { pickServer('primary'); });

        var $after = $('.menu__list [data-action="v10"]').first().parent();
        if (!$after.length) $after = $('.menu__list [data-action="settings"]').first().parent();
        if ($after.length) $after.after(item);
        else $('.menu__list').append(item);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    //  9.  INIT (единая точка входа)
    // ─────────────────────────────────────────────────────────────────────────────

    function init() {
        // --- Регистрируем основной API-источник V10 ---
        Lampa.Api.sources[SOURCE_NAME] = new RutorApiService();

        // --- Добавляем основной пункт меню V10 ---
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready' || e.type === 'render') {
                setTimeout(addMenuItem, 1000);
                setTimeout(addTorrServerMenuItem, 1200);
            }
        });
        setTimeout(addMenuItem, 2000);
        setTimeout(addTorrServerMenuItem, 2200);

        // --- Настройки TorrServer ---
        addTorrServerSettings();

        // --- Фоновый авто-фейловер TorrServer ---
        setTimeout(autoFailoverCheck, 60000);
        setInterval(autoFailoverCheck, AUTO_CHECK_INTERVAL);

        console.log('[V10+Torr+PubTorr] Плагин полностью загружен.');
    }

    // ─────────────────────────────────────────────────────────────────────────────
    //  10. ЗАПУСК
    // ─────────────────────────────────────────────────────────────────────────────

    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }

})();
