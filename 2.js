/**
 * Lampa plugin.js (V10) — v5 "all-in-one + Lumio"
 *
 * Состав:
 *  1) Источник каталога V10 (rutor-воркер) — категории, пагинация,
 *     дедупликация, корректное определение типа карточек (movie/tv).
 *  2) TorrServer Switcher — выбор основного/резервного TorrServer из
 *     списка с живой проверкой (🟢/🔴) и авто-failover раз в 5 минут.
 *  3) Каталог парсеров (по мотивам LME PubTorr) — выбор Jackett/Prowlarr
 *     парсера из списка с проверкой доступности и записью в штатные
 *     ключи Lampa (jackett_url / jackett_key / parser_torrent_type).
 *  4) Lumio (бывший plugin2, v1.26.0) — онлайн-просмотр через Lampac:
 *     кнопка на карточке, выбор источника/озвучки/серии, RCH.
 *
 * Всё работает в одном файле, ставится как один плагин.
 * ВАЖНО: если отдельно установлен старый plugin2 (Lumio) — удалите его
 * из списка плагинов, иначе будет работать только тот, что загрузился первым.
 */
(function () {
    'use strict';

    if (window.v10_all_in_one_ready) return;
    window.v10_all_in_one_ready = true;

    var SOURCE_NAME = 'V10_21';
    var WORKER_URL  = 'https://my-proxy-worker.mail-internetx.workers.dev/';

    var TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
    var TMDB_BG  = 'https://image.tmdb.org/t/p/original';

    // ================================================================
    //  НАСТРОЙКИ ПЛАГИНА
    // ================================================================
    var CONFIG = {
        // Включить модуль онлайн-просмотра Lumio
        lumio: true,
        // Анонимная статистика Lumio (uid + счётчики) → beta.mitsu.tv.
        // В исходном plugin2 была включена, здесь по умолчанию ВЫКЛЮЧЕНА.
        lumioTelemetry: false,
        // Разрешить серверу RCH (beta.mitsu.tv) выполнять присланный JS через eval().
        // Нужно некоторым провайдерам Lampac; если не нужно — поставьте false.
        lumioRemoteEval: true,
        // Подробный лог в консоль
        debug: false
    };

    // ================================================================
    //  КАТЕГОРИИ
    // ================================================================
    var CATEGORIES = [
        { title: 'Топ 24 часа',                  url: 'top24',                method: 'movie', page_size_preview: 25, page_size: 25 },
        { title: 'Зарубежные фильмы',            url: 'movies',               method: 'movie', page_size_preview: 15, page_size: 15 },
        { title: 'Наши фильмы',                  url: 'movies_ru',            method: 'movie', page_size_preview: 15, page_size: 15 },
        { title: 'Зарубежные сериалы',           url: 'tv_shows',             method: 'tv',    page_size_preview: 15, page_size: 15 },
        { title: 'Русские сериалы',              url: 'tv_shows_ru',          method: 'tv',    page_size_preview: 15, page_size: 15 },
        { title: 'Русские детективные сериалы',  url: 'russian_detective_tv', method: 'tv',    page_size_preview: 60, page_size: 60 },
        { title: 'Телевизор',                    url: 'televizor',            method: 'tv',    page_size_preview: 15, page_size: 15 },
        { title: 'Юмор',                         url: 'humor',                method: 'tv',    page_size_preview: 15, page_size: 15 }
    ];

    // ================================================================
    //  ОБЩИЕ УТИЛИТЫ
    // ================================================================
    function noty(text) {
        try { Lampa.Noty.show(text); } catch (e) { console.log('[V10] ' + text); }
    }

    function log() {
        if (CONFIG.debug && window.console && console.log) console.log.apply(console, arguments);
    }

    // Выполнить функцию так, чтобы сбой одного модуля не ронял остальные
    function safe(name, fn) {
        try { fn(); } catch (e) { console.error('[V10] модуль «' + name + '» не запустился:', e); }
    }

    // Запомнить/вернуть активный контроллер (для корректного возврата после Select)
    function captureController() {
        try {
            var c = Lampa.Controller.enabled();
            return (c && c.name) ? c.name : '';
        } catch (e) { return ''; }
    }
    function restoreController(name) {
        try { Lampa.Controller.toggle(name || 'menu'); }
        catch (e) { try { Lampa.Controller.toggle('menu'); } catch (e2) {} }
    }

    // Обновить строку description у кнопки в открытых настройках
    function setSettingsDescr(paramName, text) {
        try {
            var el = $('.settings-param[data-name="' + paramName + '"] .settings-param__descr');
            if (!el.length) return;
            var inner = el.find('div').first();
            if (inner.length) inner.text(text); else el.text(text);
        } catch (e) {}
    }

    // ================================================================
    //  УТИЛИТЫ ДЛЯ ПОСТЕРОВ
    // ================================================================
    function buildImg(item) {
        if (item.img && item.img.indexOf('http') === 0) return item.img;
        if (item.poster_path) {
            if (item.poster_path.indexOf('http') === 0) return item.poster_path;
            if (item.poster_path.indexOf('/t/p/') === 0) return 'https://image.tmdb.org' + item.poster_path;
            return TMDB_IMG + item.poster_path;
        }
        return '';
    }

    function buildBg(item) {
        if (item.background_image && item.background_image.indexOf('http') === 0) return item.background_image;
        if (item.backdrop_path) {
            if (item.backdrop_path.indexOf('http') === 0) return item.backdrop_path;
            if (item.backdrop_path.indexOf('/t/p/') === 0) return 'https://image.tmdb.org' + item.backdrop_path;
            return TMDB_BG + item.backdrop_path;
        }
        return '';
    }

    // ================================================================
    //  ОПРЕДЕЛЕНИЕ ТИПА
    // ================================================================
    function detectMediaMethod(item) {
        if (!item) return 'movie';
        if (item.method === 'tv'    || item.type === 'tv')    return 'tv';
        if (item.method === 'movie' || item.type === 'movie') return 'movie';
        if (item.number_of_seasons || item.seasons || item.first_air_date) return 'tv';
        return 'movie';
    }

    // ================================================================
    //  NORMALIZE
    //  Важно: поле `name` выставляем ТОЛЬКО сериалам. Lampa (и Lumio)
    //  определяют «сериал» по наличию `name`, поэтому раньше фильмы
    //  с `name` открывались как сериалы.
    // ================================================================
    function normalizeCard(item) {
        var img = buildImg(item);
        var bg  = buildBg(item);

        var posterPath = item.poster_path || '';
        if (posterPath && posterPath.indexOf('/t/p/') !== 0 && posterPath.indexOf('http') !== 0) {
            posterPath = '/t/p/w500' + posterPath;
        }

        var backdropPath = item.backdrop_path || '';
        if (backdropPath && backdropPath.indexOf('/t/p/') !== 0 && backdropPath.indexOf('http') !== 0) {
            backdropPath = '/t/p/original' + backdropPath;
        }

        var title  = item.title || item.name || '';
        var method = item.method || detectMediaMethod(item);
        var isTv   = method === 'tv';

        return {
            id: item.id,
            title: title,
            name: isTv ? (item.name || title) : undefined,
            original_title: item.original_title || title,
            overview: item.overview || '',
            poster_path: posterPath,
            backdrop_path: backdropPath,
            img: img,
            background_image: bg,
            vote_average: item.vote_average || 0,
            release_date: item.release_date || '',
            first_air_date: isTv ? (item.first_air_date || item.release_date || '') : '',
            number_of_seasons: isTv ? (item.number_of_seasons || undefined) : undefined,
            type: method,
            method: method,
            release_quality: item.release_quality || '',
            source: SOURCE_NAME,
            promo_title: item.promo_title || title,
            promo: item.promo || item.overview || '',
            genres: item.genres_list || item.genres || [],
            vote_count: item.vote_count_kp || item.vote_count_imdb || item.vote_count || 0,
            episodes_total: item.episodes_total || undefined,
            status: item.status || ''
        };
    }

    // ================================================================
    //  API SERVICE
    // ================================================================
    function RutorApiService() {
        var self = this;
        self.network = new Lampa.Reguest();
        try { self.network.timeout(15000); } catch (e) {}

        var clientSeen = {};
        var rawCache   = {};
        var RAW_TTL    = 3 * 60 * 1000;

        function seenKey(card) {
            var id = card && card.id ? String(card.id) : '';
            var t  = ((card && (card.title || card.name)) || '').toLowerCase()
                        .replace(/[^\u0400-\u04ffa-z0-9]/gi, '').slice(0, 80);
            return (id || t) ? (id + '|' + t) : '';
        }

        function dedupClient(catUrl, cards, resetPage) {
            if (resetPage || !clientSeen[catUrl]) clientSeen[catUrl] = {};
            var bag = clientSeen[catUrl];
            var out = [];
            for (var i = 0; i < cards.length; i++) {
                var k = seenKey(cards[i]);
                if (!k) { out.push(cards[i]); continue; }
                if (bag[k]) continue;
                bag[k] = 1;
                out.push(cards[i]);
            }
            return out;
        }

        function forceCardType(meta, cards) {
            if (!meta || meta.method !== 'tv') return cards;
            return cards.map(function (card) {
                card.type   = 'tv';
                card.method = 'tv';
                if (!card.name) card.name = card.title;
                if (!card.first_air_date && card.release_date) card.first_air_date = card.release_date;
                return card;
            });
        }

        function emptyPage() {
            return { results: [], total_pages: 1, page: 1, total_results: 0 };
        }

        function parseResults(json) {
            if (!json || !json.results || !json.results.map) return emptyPage();
            return {
                results: json.results.map(normalizeCard),
                page: json.page || 1,
                total_pages: json.total_pages || 1,
                total_results: json.total_results || json.results.length
            };
        }

        // ---------------- FETCH RAW (кэш 3 мин + 1 повтор при ошибке) ----------------
        self._fetchRaw = function (url, onComplete, onError) {
            var cached = rawCache[url];
            if (cached && (Date.now() - cached.t) < RAW_TTL) {
                onComplete(parseResults(cached.json));
                return;
            }

            var attempt = 0;
            function run() {
                self.network.silent(
                    url,
                    function (json) {
                        if (json && json.results && json.results.length) {
                            if (Object.keys(rawCache).length > 60) rawCache = {};
                            rawCache[url] = { t: Date.now(), json: json };
                        }
                        onComplete(parseResults(json));
                    },
                    function (err) {
                        if (attempt < 1) {
                            attempt++;
                            setTimeout(run, 800);
                            return;
                        }
                        console.warn('[V10] fetch error:', url, err);
                        if (onError) onError(err);
                        else onComplete(emptyPage());
                    }
                );
            }
            run();
        };

        // ---------------- SEARCH ----------------
        self.search = function (params, onComplete) {
            var query = (params.query || '').trim();
            if (!query) { onComplete({ results: [] }); return; }
            var url = WORKER_URL + 'search?query=' + encodeURIComponent(query);
            self._fetchRaw(
                url,
                function (data) {
                    onComplete({
                        results: dedupClient('search', data.results, true),
                        page: data.page,
                        total_pages: data.total_pages
                    });
                },
                function () { onComplete({ results: [] }); }
            );
        };

        // ---------------- CATEGORY ----------------
        self.category = function (params, onSuccess, onError) {
            var rows = new Array(CATEGORIES.length);
            var left = CATEGORIES.length;

            function finish() {
                var out = rows.filter(Boolean);
                if (out.length) onSuccess(out);
                else if (onError) onError();
                else onSuccess([]);
            }

            CATEGORIES.forEach(function (cat, idx) {
                var pageSize = cat.page_size_preview || 15;
                var url = WORKER_URL + cat.url + '?page=1&page_size=' + pageSize;

                self._fetchRaw(url, function (data) {
                    var unique = forceCardType(cat, dedupClient(cat.url, data.results, true));

                    rows[idx] = unique.length ? {
                        title: cat.title,
                        results: unique,
                        url: cat.url,
                        source: SOURCE_NAME,
                        total_pages: data.total_pages || 1
                    } : null;

                    left--;
                    if (left === 0) finish();
                });
            });
        };

        // ---------------- LIST ----------------
        self.list = function (params, onComplete) {
            var page   = params.page || 1;
            var catUrl = params.url  || 'top24';

            var meta = null;
            CATEGORIES.forEach(function (c) { if (c.url === catUrl) meta = c; });
            var pageSize = params.page_size || (meta && meta.page_size) || 15;

            var url = WORKER_URL + catUrl + '?page=' + page + '&page_size=' + pageSize;

            self._fetchRaw(
                url,
                function (data) {
                    var unique = forceCardType(meta, dedupClient(catUrl, data.results, page === 1));
                    onComplete({
                        results:       unique,
                        page:          data.page        || page,
                        total_pages:   data.total_pages || 1,
                        total_results: data.total_results || unique.length
                    });
                },
                function () {
                    onComplete({ results: [], page: page, total_pages: 1, total_results: 0 });
                }
            );
        };

        // ---------------- FULL ----------------
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

            function restoreSaved(data) {
                if (!data.img && savedImg) data.img = savedImg;
                if (!data.background_image && savedBg)     data.background_image = savedBg;
                if (!data.release_quality && savedQuality) data.release_quality  = savedQuality;
                data.type   = method;
                data.method = method;
            }

            function fallbackFull(data) {
                data = data || {};
                if (!data.title) data.title = card.title || card.name || '';
                restoreSaved(data);
                for (var k in card) {
                    if (Object.prototype.hasOwnProperty.call(card, k) && data[k] === undefined) data[k] = card[k];
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
                    if (!data || !data.title) fallbackFull(data);
                    else {
                        restoreSaved(data);
                        onSuccess(data);
                    }
                },
                function () { fallbackFull({}); }
            );
        };
    }

    // ================================================================
    // ================================================================
    //  МОДУЛЬ 2. TORRSERVER SWITCHER
    // ================================================================
    // ================================================================
    var TS = (function () {
        var COMPONENT = 'torrserver_switcher';

        var SERVERS = [
            '178.150.255.251:8090',
            '109.237.108.184:8090',
            '95.174.115.119:8888',
            '91.201.54.146:8090',
            '85.113.39.177:8090',
            '95.67.104.126:43871',
            '178.141.254.11:8090',
            '212.92.250.83:8090',
            '195.189.63.152:8090'
        ];

        var STORAGE_PRIMARY = 'torrserver_url';
        var STORAGE_BACKUP  = 'torrserver_switcher_backup';

        var CHECK_TIMEOUT       = 4000;
        var AUTO_CHECK_INTERVAL = 5 * 60000;

        var autoTimer = null;
        var picking   = false;

        function normalizeUrl(raw) {
            var u = (raw || '').trim();
            if (!u) return '';
            if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
            return u.replace(/\/+$/, '');
        }

        function sameUrl(a, b) {
            return !!a && !!b && normalizeUrl(a).toLowerCase() === normalizeUrl(b).toLowerCase();
        }

        function shortAddr(url) {
            return (url || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
        }

        function nowMs() {
            return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        }

        // Проверка через /echo — стандартный health-endpoint TorrServer.
        // Сначала обычный CORS-запрос (даёт точный статус). Если сервер жив, но
        // не отдаёт CORS-заголовки — повторяем в no-cors: «непрозрачный» ответ
        // тоже означает, что сервер доступен по сети.
        function ping(rawUrl, cb) {
            var full  = normalizeUrl(rawUrl) + '/echo';
            var start = nowMs();
            var done  = false;
            var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var timer;

            function finish(ok) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                cb({ ok: !!ok, ms: ok ? Math.round(nowMs() - start) : 0 });
            }

            timer = setTimeout(function () {
                if (controller) { try { controller.abort(); } catch (e) {} }
                finish(false);
            }, CHECK_TIMEOUT);

            function attempt(mode) {
                try {
                    fetch(full, {
                        method: 'GET',
                        cache: 'no-store',
                        mode: mode,
                        signal: controller ? controller.signal : undefined
                    }).then(function (res) {
                        if (mode === 'no-cors' || res.type === 'opaque') { finish(true); return; }
                        finish(res.ok || res.status === 200);
                    })['catch'](function () {
                        if (done) return;
                        if (mode === 'cors') attempt('no-cors');
                        else finish(false);
                    });
                } catch (e) {
                    finish(false);
                }
            }

            attempt('cors');
        }

        function formatMs(ms) {
            return ms > 0 ? '~' + ms + ' мс' : '';
        }

        function checkAll(onDone) {
            var results = new Array(SERVERS.length);
            var left = SERVERS.length;
            if (!left) { onDone([]); return; }

            SERVERS.forEach(function (addr, idx) {
                ping(addr, function (res) {
                    results[idx] = { addr: addr, url: normalizeUrl(addr), ok: res.ok, ms: res.ms };
                    left--;
                    if (left === 0) onDone(results);
                });
            });
        }

        function getPrimary() { return Lampa.Storage.get(STORAGE_PRIMARY, ''); }
        function getBackup()  { return Lampa.Storage.get(STORAGE_BACKUP, ''); }

        function primaryDescr() { return getPrimary() ? shortAddr(getPrimary()) : 'не выбран — нажмите, чтобы выбрать'; }
        function backupDescr()  { return getBackup()  ? shortAddr(getBackup())  : 'не выбран — используется при отказе основного'; }

        function refreshDescr() {
            setSettingsDescr(COMPONENT + '_primary', primaryDescr());
            setSettingsDescr(COMPONENT + '_backup',  backupDescr());
        }

        function setPrimary(url, silent) {
            Lampa.Storage.set(STORAGE_PRIMARY, url);
            if (!silent) noty('Основной сервер TorrServer: ' + shortAddr(url));
            refreshDescr();
        }
        function setBackup(url, silent) {
            Lampa.Storage.set(STORAGE_BACKUP, url);
            if (!silent) noty('Резервный сервер TorrServer: ' + shortAddr(url));
            refreshDescr();
        }

        function pickServer(mode) {
            if (picking) return;
            picking = true;

            var returnTo = captureController();
            noty('Проверка серверов TorrServer…');

            checkAll(function (results) {
                picking = false;

                var currentUrl = mode === 'primary' ? getPrimary() : getBackup();

                var sorted = results.slice().sort(function (a, b) {
                    if (a.ok !== b.ok) return a.ok ? -1 : 1;
                    return (a.ms || 9e9) - (b.ms || 9e9);
                });

                var items = sorted.map(function (r) {
                    var dot   = r.ok ? '🟢' : '🔴';
                    var mark  = sameUrl(currentUrl, r.url) ? ' ✓' : '';
                    var speed = r.ok ? formatMs(r.ms) : '';
                    return {
                        title: dot + ' ' + r.addr + (speed ? ' (' + speed + ')' : '') + mark,
                        subtitle: r.ok ? 'работает' : 'не отвечает',
                        url: r.url,
                        ok: r.ok
                    };
                });

                Lampa.Select.show({
                    title: mode === 'primary' ? 'TorrServer — основной адрес' : 'TorrServer — резервный адрес',
                    items: items,
                    onSelect: function (item) {
                        if (!item.ok) noty('⚠ Этот сервер сейчас не отвечает. Выбран, но лучше выбрать зелёный.');
                        if (mode === 'primary') setPrimary(item.url);
                        else setBackup(item.url);
                    },
                    onBack: function () { restoreController(returnTo); }
                });
            });
        }

        // Авто-переключение: основной не отвечает (2 проверки подряд) → резервный
        function autoFailoverCheck() {
            var primary = getPrimary();
            var backup  = getBackup();
            if (!primary || !backup || sameUrl(primary, backup)) return;

            function tryFailover() {
                ping(primary, function (p) {
                    if (p.ok) return;
                    ping(backup, function (b) {
                        if (!b.ok) return;
                        // за время проверок пользователь мог поменять сервер вручную
                        if (!sameUrl(getPrimary(), primary)) return;
                        setPrimary(backup, true);
                        noty('⚠ Основной TorrServer не отвечает. Переключено на резервный: ' + shortAddr(backup));
                    });
                });
            }

            ping(primary, function (first) {
                if (first.ok) return;
                // одиночный таймаут ≠ отказ — перепроверяем через 3 секунды
                setTimeout(tryFailover, 3000);
            });
        }

        function addSettings() {
            try {
                Lampa.SettingsApi.addComponent({
                    component: COMPONENT,
                    icon: '<svg height="60" viewBox="0 0 24 24" width="60" fill="currentColor">' +
                              '<path d="M4 3H20C21.1 3 22 3.9 22 5V9C22 10.1 21.1 11 20 11H4C2.9 11 2 10.1 2 9V5C2 3.9 2.9 3 4 3ZM4 13H20C21.1 13 22 13.9 22 15V19C22 20.1 21.1 21 20 21H4C2.9 21 2 20.1 2 19V15C2 13.9 2.9 13 4 13ZM6 6.5C5.45 6.5 5 6.95 5 7.5C5 8.05 5.45 8.5 6 8.5C6.55 8.5 7 8.05 7 7.5C7 6.95 6.55 6.5 6 6.5ZM6 16.5C5.45 16.5 5 16.95 5 17.5C5 18.05 5.45 18.5 6 18.5C6.55 18.5 7 18.05 7 17.5C7 16.95 6.55 16.5 6 16.5Z"/>' +
                          '</svg>',
                    name: 'TorrServer'
                });

                Lampa.SettingsApi.addParam({
                    component: COMPONENT,
                    param: { name: COMPONENT + '_primary', type: 'button', default: '' },
                    field: { name: 'Основной сервер', description: primaryDescr() },
                    onRender: function (item) {
                        item.on('hover:enter', function () { pickServer('primary'); });
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: COMPONENT,
                    param: { name: COMPONENT + '_backup', type: 'button', default: '' },
                    field: { name: 'Резервный сервер', description: backupDescr() },
                    onRender: function (item) {
                        item.on('hover:enter', function () { pickServer('backup'); });
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: COMPONENT,
                    param: { name: COMPONENT + '_recheck', type: 'button', default: '' },
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

        function init() {
            addSettings();
            setTimeout(autoFailoverCheck, 60000);
            if (autoTimer) clearInterval(autoTimer);
            autoTimer = setInterval(autoFailoverCheck, AUTO_CHECK_INTERVAL);
        }

        return { init: init, pick: pickServer };
    })();

    // ================================================================
    // ================================================================
    //  МОДУЛЬ 3. КАТАЛОГ ПАРСЕРОВ
    // ================================================================
    // ================================================================
    var PARSERS = (function () {
        var COMPONENT   = 'v10_parsers';
        var STORAGE_KEY = 'v10_selected_parser';
        var NO_PARSER   = 'no_parser';
        var CHECK_TIMEOUT = 5000;

        var LIST = [
            { id: 'lampa_app',           name: 'Lampa.app',    settings: { url: 'lampa.app',            key: '',        parser_torrent_type: 'jackett' } },
            { id: 'jacred_viewbox_dev',  name: 'Viewbox',      settings: { url: 'jacred.viewbox.dev',   key: 'viewbox', parser_torrent_type: 'jackett' } },
            { id: 'unknown',             name: 'Unknown',      settings: { url: '188.119.113.252:9117', key: '1',       parser_torrent_type: 'jackett' } },
            { id: 'trs_my_to',           name: 'Trs.my.to',    settings: { url: 'trs.my.to:9118',       key: '',        parser_torrent_type: 'jackett' } },
            { id: 'jacred_my_to',        name: 'Jacred.my.to', settings: { url: 'jacred.my.to',         key: '',        parser_torrent_type: 'jackett' } },
            { id: 'jacred',              name: 'Jac.red',      settings: { url: 'jac.red',              key: '',        parser_torrent_type: 'jackett' } },
            { id: 'jacred_su',           name: 'JacRed.su',    settings: { url: 'jacred.su',            key: '',        parser_torrent_type: 'jackett' } },
            { id: 'jac_red_ru',          name: 'jac-red.ru',   settings: { url: 'jac-red.ru',           key: '',        parser_torrent_type: 'jackett' } }
        ];

        var cache = {};
        var TTL = 10 * 60 * 1000;

        function protocol() {
            if (Lampa.Utils && typeof Lampa.Utils.protocol === 'function') return Lampa.Utils.protocol();
            return location.protocol === 'https:' ? 'https://' : 'http://';
        }

        function healthUrl(parser) {
            if (!parser || !parser.settings || !parser.settings.url) return '';
            var s    = parser.settings;
            var type = s.parser_torrent_type || 'jackett';
            var pre  = /^https?:\/\//.test(s.url) ? '' : protocol();
            // Jackett: /api/v2.0/indexers/status:healthy/results/torznab
            // Prowlarr: /api/v1/health
            var base = type === 'prowlarr'
                ? '/api/v1/health'
                : '/api/v2.0/indexers/status:healthy/results/torznab';
            return pre + s.url + base + '?apikey=' + encodeURIComponent(s.key || '');
        }

        function getById(id) {
            var found = null;
            LIST.forEach(function (p) { if (p.id === id) found = p; });
            return found;
        }

        function getSelectedId() { return Lampa.Storage.get(STORAGE_KEY, NO_PARSER); }

        function currentName() {
            var p = getById(getSelectedId());
            return p ? p.name : 'Не выбран';
        }

        function selectDescr() {
            return 'Текущий выбор: ' + currentName() + ' (всего ' + LIST.length + ')';
        }

        function applySelected(id) {
            var parserId = id || getSelectedId();
            var parser   = getById(parserId);
            if (!parser || !parser.settings) return false;

            var s    = parser.settings;
            var type = s.parser_torrent_type || 'jackett';

            Lampa.Storage.set(type === 'prowlarr' ? 'prowlarr_url' : 'jackett_url', s.url);
            Lampa.Storage.set(type === 'prowlarr' ? 'prowlarr_key' : 'jackett_key', s.key || '');
            Lampa.Storage.set('parser_torrent_type', type);
            Lampa.Storage.set('parser_use', true);
            return true;
        }

        // 200 → ok; 401/403 → ключ; остальные 4xx → сервер жив (ok);
        // 0 / 5xx / таймаут → недоступен
        function classify(status) {
            if (status === 200) return 'ok';
            if (status === 401 || status === 403) return 'auth';
            if (status >= 400 && status < 500) return 'ok';
            return 'network';
        }

        function checkOne(parser, cb) {
            var url = healthUrl(parser);
            if (!url) { cb('unknown'); return; }

            var key = parser.id + '::' + url;
            var c   = cache[key];
            if (c && Date.now() < c.expires) { cb(c.status); return; }

            function done(st) {
                if (st !== 'network') cache[key] = { status: st, expires: Date.now() + TTL };
                cb(st);
            }

            $.ajax({
                url: url,
                method: 'GET',
                dataType: 'text',
                timeout: CHECK_TIMEOUT,
                success: function (resp, textStatus, xhr) { done(classify(xhr ? xhr.status : 200)); },
                error: function (xhr) { done(classify(xhr ? xhr.status : 0)); }
            });
        }

        function checkAll(cb) {
            var res  = {};
            var left = LIST.length;
            if (!left) { cb(res); return; }
            LIST.forEach(function (p) {
                checkOne(p, function (st) {
                    res[p.id] = st;
                    left--;
                    if (left === 0) cb(res);
                });
            });
        }

        function statusIcon(st) {
            if (st === 'ok')   return '🟢';
            if (st === 'auth') return '🟡';
            return '🔴';
        }
        function statusText(st) {
            if (st === 'ok')   return 'Доступен';
            if (st === 'auth') return 'Ошибка ключа';
            return 'Недоступен';
        }

        var opening = false;

        function openCatalog(force, returnTo) {
            if (opening) return;
            opening = true;
            if (force) cache = {};
            if (returnTo === undefined) returnTo = captureController();
            noty('Проверка парсеров…');

            checkAll(function (statuses) {
                opening = false;
                var selected = getSelectedId();

                var items = LIST.map(function (p) {
                    var st = statuses[p.id] || 'unknown';
                    return {
                        title: statusIcon(st) + ' ' + p.name + (selected === p.id ? ' ✓' : ''),
                        subtitle: statusText(st) + ' · ' + p.settings.url,
                        parser: p
                    };
                });

                items.push({ title: '⚪ Не использовать парсер', subtitle: 'Отключить парсер', parser: null });
                items.push({ title: '↻ Обновить проверку', subtitle: 'Сбросить кэш и проверить заново', refresh: true });

                Lampa.Select.show({
                    title: 'Каталог парсеров',
                    items: items,
                    onSelect: function (item) {
                        if (item.refresh) { openCatalog(true, returnTo); return; }

                        if (!item.parser) {
                            Lampa.Storage.set(STORAGE_KEY, NO_PARSER);
                            Lampa.Storage.set('parser_use', false);
                            noty('Парсер отключён');
                            setSettingsDescr(COMPONENT + '_select', selectDescr());
                            return;
                        }

                        Lampa.Storage.set(STORAGE_KEY, item.parser.id);
                        applySelected(item.parser.id);
                        noty('Парсер выбран: ' + item.parser.name);
                        setSettingsDescr(COMPONENT + '_select', selectDescr());
                    },
                    onBack: function () { restoreController(returnTo); }
                });
            });
        }

        function addSettings() {
            try {
                Lampa.SettingsApi.addComponent({
                    component: COMPONENT,
                    icon: '<svg height="60" viewBox="0 0 24 24" width="60" fill="currentColor">' +
                              '<path d="M12 2L2 7L12 12L22 7L12 2ZM2 12L12 17L22 12M2 17L12 22L22 17"/>' +
                          '</svg>',
                    name: 'Каталог парсеров'
                });

                Lampa.SettingsApi.addParam({
                    component: COMPONENT,
                    param: { name: COMPONENT + '_select', type: 'button', default: '' },
                    field: { name: 'Выбрать парсер', description: selectDescr() },
                    onRender: function (item) {
                        item.on('hover:enter', function () { openCatalog(false); });
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: COMPONENT,
                    param: { name: COMPONENT + '_refresh', type: 'button', default: '' },
                    field: {
                        name: 'Обновить проверку',
                        description: 'Сбросить кэш статусов и проверить парсеры заново'
                    },
                    onRender: function (item) {
                        item.on('hover:enter', function () { openCatalog(true); });
                    }
                });
            } catch (e) {
                console.warn('[V10 parsers] addSettings failed:', e);
            }
        }

        function init() {
            addSettings();
            if (getSelectedId() !== NO_PARSER) applySelected();
        }

        return { init: init, open: openCatalog, current: currentName };
    })();

    // ================================================================
    // ================================================================
    //  МОДУЛЬ 4. LUMIO (бывший plugin2 v1.26.0) — онлайн-просмотр
    //  Код исходного плагина перенесён 1:1 и завёрнут в initLumio().
    //  Изменения относительно оригинала помечены «[V10]».
    // ================================================================
    // ================================================================
    var LUMIO = {
        ready: false,
        version: '1.26.0',
        clearCache: function () {}
    };

    function initLumio() {
    if (window.nexus_online_plugin_started) return;
    window.nexus_online_plugin_started = true;

    var NEXUS_VERSION   = '1.26.0';
    var NEXUS_COMPONENT = 'nexusonline';
    var NEXUS_TITLE     = 'Lumio';
    window.nexusLumioVersion = NEXUS_VERSION;
    var NEXUS_LOGO_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABgAAAAQACAMAAAAQr2JwAAAC01BMVEVHcExob2lyfXd9qqmdmYk9s9DKk1dAp8PAi1YpoMOjdVQgmL3vjiRtXGEkiK7bfC5cRkswZIYWmcD3hxK2TB7hZBTxdwsMaZSKSjsVVHs9NUH1hg+0WzcZRWjl+PH77bf79WP+6VCa+Pz+4WL90ZXuz7n+0njE2t2h5O9t+//6w5jPy8fouaf4sH/nqI3Ar7PJnJGIc3r/3Uf/10T+0V39wnL/yjZI///+xTz+wzL/vzH/vEBZ6//+tV3/ujAv+f/+tED/ti5h3fz/sy//sDJ10fH+rUL/rTP8qFD/qjaTwdn+qD5/xub3o17+pTr9o0Ak7P/6oEj8oEDunWb0nVX6nUP4nEuascb2mUjzmFAm3v7kmG4W5P/rl1vwlU/sk1M8zPDdlGnnklkl1PoT2//kkFvTknHej13Xj2PIkXjbjF8R1P5BwOQly/TYimbSjGNXtNUsxe0Sz/ull5nKjGnPiWe8jnyzkIVCuNzMhmvAi29np8MQyfhZrMuJmqjEiGkvu+WikY/EhG9xoLgRxfVGsNQfv+2Uk5i7h2+0iXWmjISsiXm8gnAQv/IstOFxmrAeuemHkp2zhHFYosJHqM21gXN6laaVjIwzrtmrhHWkhnqdiIEPuu5cnLmvfnOHjJNGosc1qNOdg36Sh4V5j50StOkhrt+nfnaYhH5rkqdhla+fgHhHncKHh4sTsOU2os0iqdmQgoChe3d6iZRVlbRti5xHmLwTq+CFgoaXe3pijaM0ncgko9N6g4yHfoONe30UptxIk7VXjaiPd3wzmMMknc5ug5EWotdKjq56fYdjhJgXntODd4A8kLczk75XhJ1KiKgllcYamc1te4t3d4Q9i7FgfZJ5coEtjbsjkMEYlMkyirZLgaA/g6hgd41scoY2ha9TepYZjcIohrQfibtDe584fqUtga5fbodVcY9IdZgeg7UjfK4wdqNMbI08bpUzcZwtRp/XAAAA73RSTlMAAQIECRAVHyg9R2t6eqOyusDEyuHl6evs7+719Pb6+/z9/Pz8/P38/f39/fz9/f39/f7+/v7+/v7+//7+/v7+/v7+//7+/v/+//7+/v7//v7+//7+//7+//7+/v/////+//7+///+///+/v/+/v7//v7+/v/+/v/+/v/+///+//7+/v7///7+//////7//v7+/v///v7+//7+/////v7//v7+//7///7//v7+/v///v7+/v/+//7///7//v7//v7////+/v7////+///+//////7//v7///7+/v/////+/v7////+///+/v/+/v7+/jTP/PkAAQOCSURBVHja7N1BdtswDEBBffb+d+42L7EdJxZlKprZtvVLBIAEIaneuJRcAuCx/Lyr64gPy/VZ0ph8MdrmSnIAaEYAmGnYYgAAG7ZWkPPm/1C/WP9B/oOSAQAAYOupg1aOfg7MH7Tzv0jUAQBgXTnEAQB4D4DbEkX4JHcOQZcAAFo+AICrN1JDt7d/HHtfnngPAEc/AIB1OpqhSUPrDoDl3xN++D4A9csMbclPeFG6BKQ6AAA6LOBXsjxYzr/9iGHGBAAA5j+3jUywAAAbtvcAZPpUQ/X63awygPoFAAAAnpyAZtjrl9v38/N9AADuhQPwtuU27wEA4IiBcHnCD1H0kzJD9hdQv0ghACsDAMBBOva7Oo0Jl5yst9jFSzgd8wAVj8hylPw8jyXu29aP/qS26bI+AYBGE89lr6wz3wNotfrNSiP/RR30b5xDUg6wJYFKAsC2wPoH7CHfEF9AxQNYzm/LzUMAAO8BIIqcTyaCcHm5BADYkkAlIe7AqWUhsJzv/fnZfgAA4J7x957sT3+PQ5+4gLwFHSiiaGOQn4D6BQAAAODnWu7/2MzkHvEF9QjAOrK9oOkQE4Qe5NtV/XMJPKcJL8n6D+4ZA4AjDwCAezO8rDc1xGnoAQB9L5zZ0KADAHpurSCieFtWGkQF1BcAAABwQpkemAGZMSF5ALBngKewVC8AoCnQgSKKVhpEBdQvANiSAAA0WBxqeM8AAAB4T8udIyoAYMP2BDn3JIrIckD9AgAAAM723JU7UQAAgPcAAADA2xyONogKoH4BAAAAzGh8HwAAAHhsSDsPAGB6jBm9fEPUwcAIAAAAWEpmeaeUuGB6D4AdBni+vlKkAIA+X2QQRTmFjAAAAAAAMGMFwI4BMhGU3d6ybAAA+J9++WI4MDgaWGUAqyoAtiQAANAQ/0IaegDAhA+UEgDY2BAuT+iivkB+gvoCAAAAYDdj/c/PnSgAANyPPYlcAwBAX2R6jPqyEvCcZA8AAFpBAACtFL5vAGQKAMD+mtpIpUsDAPAeACajeH4fAGwZAAAAsN6dnHwfAIARKwDX2QCyuQAAmB4jinBsfubQCd/mf+4YsIokHAAAALgH4MgPYL1FrgAHyJIBAGB6jIYerDIAAACGBwDAWpr8L9KGAACAuZ/fAACwYYsMnrMGqwyoXwCwJSHyAACPeE4fAADYSxM/p0yCAQAbtifIEUWs/4D6RQoBWE8AADRYXO49gGSo/BR3ACzzMFMz/7byBQBw2MJ7APJZVAD1ixQCsJ4AALZ6V5314pV7GHgPAAD+s3cHq60CUQCGa1JkCEIXQjezOcOBPICKeCsJhopzZUCpINzdff+3aJR20U13LY39P0keIGfmzDnjDAG4B0CLCiIGACD9ExlwDwDgP6sBVnfmLwAAAACA5g8AaYD4AgAAgJKMkhIAmQkAOEEOlh0wPhn/AAAAlJQAAAAAb3LYwwUNGwAAAL6rJIs4WQYAANgD4h4AvlbE7GU8/2ARIxT4MhHzBbQAAADgt9rd7fkRABoG/Aq7fRzHJjbGxPe7u1XE8GG+g/hi4/YmSa2dp8G3z+d2mK1Nk8TQAgDARhfm3fp9f0jt8JQ7Jx9o2f97TAyx/VzEqAJwo0xqJ186cSLinDp9J6uit2lCIwBQamJz56YPdviTrblfVTPNskzzvHjztgpoNT/ERJFMA6KCDdkn9pKLOHGqWV5WVVUvTk3d1HVVXKkeVUVEp9Qwj5i/ALbiwV6cOJflRVnVje97H0IYwjBO8zS9jF3XNHVR6PKIaPeftwGUlABuXbTscyRz6URcllfnS7tkf+973/Uh9OFqHIdpnMbQnariWBxVVeT0eCBfAMCNi4x9ciIur87P3vu2bZdP17XdVQjh7/qM4eWVfTtWbRgGwgBMm5LBBDIUvGSIi4sfIE0CabCJkLBOiFZcsE279P0fozrFyQN0KW7/TxLeJXN3OuOez1Qfd9uqkk7QMc/+XJP8DgUxAPwns0f7IuH/0GhrtNYS/OOQ8O9a728pIBAR9xyoHlNA6XM0ggAApivrY/n/tNkrpY2WZU6mNVbCf0oAFGeQETGx8DEFlFVZrMvzco5SGf8BAL7awDQt7KYoNvtDo7XSerwBXC4AzieBfEgrMDMRRz3Vu6qSFLBdLbCHiCeA44IpnkxuU/kv4V8pLdV/1NrW2dQAar0PMkMIxDKiQdZwTQFFnc/xH8BP3eN9BpwK/JbVa/r4q1L4N/qkL9W/tc61zl9QiJMCE8uijjnOgccUUKzLryU2EgBgWuar/a3815HRJrLWOGed8+KdfAgcJwUeDXHwMHx8DjReAnZ5hs0EAJiMh1nWp/a/lP9No9QY/a00/0chrlT3J/J8466j7iplgOf1N3vn9xrHleVxZJtggo0CmZiAQyQRKQ/G9nQkHGwvYzDdjNIISXR1VVFFU91UQ3dL+7B6kKab+E1vO8v+DfO67/sP7L+23++5p65ayewyjn5YQ76fe+6tfhiG4Faf7z3n3HNrbX3/q4eKR4VQNkn801z5/JTp/zfw//D+oNn//3mvC/aIJf/N9dM4mQBKse6npExDJWBt7bvRqn4VH889/aqFEJ8A8/87bzvv32EAHv/Zhbnzd1j89eQPHimMA/RSaEC/LPddAta/HykPJIQQ/zz+/12H2R9TAPp/Wtj+H/hNQHsoAITcz+F+LyhA7hpABSChGLy2tvbTlw/076r9vBDi7td/t+n/d+n/QdsyQLwAiAqw1z3wBBChAtDz27LP5cL599MUQcBPryAB332HPJCaAoTQnkDc7W9m5cHTHeT/4f/p/oMEWP4/BAAHCAFcAQ7M/0diABDpQwFS5oFesRTw6slDfYtC6O9T3PXz/9tvd9ue//cMECvA9P2YB0sRAIknQJn953T6XMoh8kDQAErA/qp+X/r9CiHuLqsHuPr/bbf97l2sAFMAQJcJoL2DA9hhoNeQ9nIOhABO1awlFGAfUcCrTVwO8f2/qhgshBB3ldXuxvrOG+R+XADc//MEUCwBE6sA0/I8HgCCRfff78PwoV/xE/NAm5sIAv70lYrBQghxF3nw8Ok28j/v37+l/ydtYOkfjD1YzP8fHvx0UQH2DFBapk5VYaEGVBxV1f+Tnwf6fvJIOaDr//9fUY5J6PsVV+Xpm/UN3P68lP8hnZAA8leA2SlQPwHUuH+sqStAWZr77zcawCAA5k0BCAK+/Ez/zkIIcdf4cnd9fQe+/208AuoVgG6XAQAGt/8mA40CpEwC9QpL/+QxBqg4+pweBlQuAZvra5vp6u9xQ4Zxc9zTfk8oCBBX7wDbfhMCAGLuH3SpALgFwhXgwAUgkMPSHEYNKDDo+31JqQGwPgYU4MWrZ99vIg+0qWKwEHL/+mbu2Asgf0QCCAHAhQAAEwC6/9AATN+PBfQSBgA0c/853b9TwSo6/RSzj8nPgwoK0OSBVh/oWxRCd0mJO8ODjK//bVMAqACdxv/7EaA9UwArAHNaBiiH5bYUvbQMo6Lz9xjAPD8WDHtSAjYpAZsTBQH6fQkh7gyrP/IG6BgAtEGsAOzBsP+Hwf3vHSaHh0mS8OwPSWGFjZKjrCgCtL7XAsigX43HIQjYZB7olU6ECiHEnbkDaANXgCIAsAFcAOwM0C4VwAMAmkcA1gZgEyOlAngGyP1+ahkgjEG/3x+Q/v6rZ5AA5oHGq5IAIYS4GwHAhgcA/hKY9vsmBPAaAGEBgPQ4rACQMQDAKLEsZYHMnH5YBoOqrgd9BAGvLAjY/Plz5Wh014TQ9ys+PU/XmwAAtpQBapJAhJv/pYuA8pwzCEDq3r/C4nv/1D0/8z+DCoNPKAAlYNOuie5/dV+/RyGE+MQ86noPGCbcP0YUgO6fGwE4oPf3CCChAmDwAGgOyjQ18/IvjfQ5adSAwaDu14OBnwjdRBDwb7om+hpYkb4IbTrEFXiyvbHNI0DxCghOvwco+n/MxN0/BcAKABCB2AQMw6ycFKMJAXzUfc8DWTGYEvDiK3UGCyF0QvfTsYISMN8C06b/ZxYIrh8DKxWg6QE4OPAasJUAksSbwNIsLYrUKgAAS1Wm1QUDnxSAmt4fK5Z9KwXwvfHVFYvBK6oBCHFDXmZFf5+/C1bf8QwoBcBAANDpUAWsAuA3QdtFEE6vB2tOgfbg93Nu/gsLAqqq9N0/Jqg5OZD/qZkGguHDC+SBNk0Cfn6kMF2/LyHEpwLXgO68br+/1AKMxQMAHgEF7AIglgDKzP8XEIBeWeRlUS6lgGCXGdisIQIDe1oQ0HcJQB5o9aG+AiGE+CTb0AfWBLB8C1DY/nsNAApg/t8igB5nL7ESMCiZA8JC18+lKjFA6q6/zwiAnn88qDz9A/CkBKgYLIQQn5aVzxNkgLwBjMD9B/xdwIwAmhaABNbzAKBX5mWRcxZDfEzh/BvvP66WqTHp+jHDAPW0HjAGCMXgbx7qiIXuchFC3D5fvlvf+fGdYddAc/sP8z5g+n/aQdMDliU9kOVGyiOgHGnpClBedv0clvup3f1zgVEBGgngHaGr9/VFCCHEbfOEJQBvAfMEEIgCcNA9sBDAAoAEEwFAFjJAaUEByIMAgPQX7n85AKhdA+I6mNZTnAfyIGDzZ90Qp/28EOKWuccSwJt4CxwCgF3b/8czQCgAYIZboL0CnGXWAlAUee6nf7hUWKthNbqsAbQaxmVQR5sOMOpp/8WzJg+k64GEENqt3S7sAmAJILaBxRIA6O6Z94exBgz3DwnILATwGnBepGVRAr8IaFgtMQ6zxmISEBlwMQGY1hcSUD/StyjElbmnfwLxD/M57oF4Ha4B8ibgTnuX/p+DZ4BAKAAkHEnGCKC5DLqwGkBpk+4/HVclnb5T08ZjGJw+JlYMGD3/lBIABlQAqwU8++ahVF/6IoS4Nef06O36tgmAZ4BYAN5dvgbiALgCABSBM5AzAUQrywJjyCIw1iokgMY2zJoIgBLAJUIBoE3PLAgI1eDBF8oDCSHEbbG6s779L+2mB8BTQLttzC4lwA8AUQLo/hO+DtLbAEqMIrfkzzAdlpWfAx25AjDtww/1eFCT6rLzjwbQGewKsPbzY30lQghxOzzZ2dh+1/YIwOiEe+CItwFAAJj+oQb0WAXOs+YIaFGwCjzEwJq6+3dMAwYhAVRzxvz/FMZhtKbT4+nLi2LwN5+pBnCzrOi/S5VGIZqrQHfet3/1JrDo/t3/w/lzBgWAAHDvD8uLkqdBq9AEgDAAjMdjrnhygeuvMJeJ7t+WASXgrJGArbW1vygIEEKI2+DJxvpOGwLQEAWga+x1WQFwsgQ0h4CKlAXgvHQKawPzCGBM4/T8P+DDmbIJgIPe3zmeDl56UwCKwWoK0HZPCHEbArCx06EAxADAa8DR/7MEYPmfsP9nABAUoMTEClLYMPj/0ch9fzXhc1KPJzEGmHHxBJDTcjs+tjwQDwSxGKzOYCG0KdAJ3ZvmHgTgx46lgNqXM0CxBuwBQGKNYH4ICPD8f8EyQEmGXKpy5AVgLLRxTasn41ntHGFOOTlgMQCgBAwoASEI+Nvn+n3J0wj1AYhbiAA67AOzHoAYAlABrASAAecPEtLLQKgBFFgKuv90iBkPAcUU0ARzzE/1bFLXWKMEmPM/iv7/2CKAEAS8fEYgAS//8EBeVQghbpD7FgF0/Awo6IAYAMD7A+7+QZYlSdZz/+8hQF6UKUWgKvweCI4QA4zxsAIAn3D+MEyuR7BpHd2/Lce0mAeyYvB/qhgshBA3yMoT3ATR5k0QlxUA1gXm/wNJlvBdAFkoAfD4J4AO0PvbGFoXMAZWDqb+sYxD8v+IBrD6/j+6/xZX+v8W1tYg9gRMv9E7g4UQivlvjPsUgI4fAo1V4BgBXHoTWAINyBgDFFQAqwDA/Q8LHgAqvQYc8/8YoEYCiIMcwTCnQQKALcdhwP+3KAH40LI00BYl4G8KApRjEkLcaATQ8dugYxHYSgBg10vAAHt/OwQEo/svysJTQFYCoPeH+x/S8YPKNGBiYzypwcwjACzc/2PgAVwCWmE9DrRePEcUQAnY/G+dCJVHF0LcCCvLEQDvgos1gJgCim8CyygBlgHq2SFQkBapHQCKIQAEYAQB8ECgribjeoIRckA+pzEHVPv5Hw6CRwsDvHzphYC11h90PdD/y4oERgjxG4EAvN6NF0EsHwIC4QhQcghcAcLLwDALpn8KGP0/G4FZAUYXQPD/I68FTDz948XfKSbXmu6f052/WQwA8Jy3Xj6nBDzbWttSHkgICbZO6N4ED0IEQKL/90bgGACQjPcAZTCMIuMZUHp/znRolwENS/aAQQKaeyCY/am5zGYTZIBIjQGj5+dCYgTgrn+BOT+mUQI2UQvgidDP9C3K0+hfU9+KuG7uxRRQ6APoYPohoF36f78HFMbNf5I0bQD0/7A0SACjgOFwaF0AVgGouIQmsNlkVhNz/Xy49z/CBUAwDwAAVjI3GVjgExQAUAL+XUGAEELczCmgth8Covvf7SxHAIckIYdJeBcYRuECUGIZFvD8LAKMmATyAjDhDRBBAqAAR14BDoM1YNjR5RSQscCc4zEHFgRsPWMp4NkPD/VdaaMvhLhW7j/dWH/dbl4IAzrxMrh4DJTeH2tGej1WAAovAZiVKbf/1XBUAZMAGhdmgCYzdn8BTwHVU+PI1rPo/yMt+P0wPA2EA6FbkICW3hUjhBDXu7VjJ3C7SQFRApZrAH4VXGKngFgECBThDgjYMC2HWEfDERa4/+j7wylQ1oA5Z34KlBpgNApwbBpwmUUY89aitTj2YvCWNQX8TjbEK6phCCFuhafWCQxiH8BuwO4CDX0AibUBsAPARCAvQh9AnpZ58y4wvwiUEUDVBAE1xoQVYIw6+H1aEwCcsAhwTCAC0fnPsbbMFpYJCkGAVQKef608kBBCXBsriABet6kAHgJYAqgbT4F6H4CVAACXvFd4HxhIh3xQBIZDfx0wmOBhOjBjFYACcBQGjRrA1YrAHH8vApgvkAKaL0AjAcwD/VV5IOXnhRDXxlMIgB8D9QrARRdYOAYaKsB4LO3/c6sA+MsgKwx8sHvgjMoH2gA4ZrPG83Oh/6edLQUAUQTmjAHswYFCANZFK0gAFWDrB3QG610BQght167lGCgFoP2L90F2eQbUFMDPAMV7gEie2S1AoGAZADakhTOgMM4JbTKZjGdWBQ4l4LDzNztBBshE4Az+H3xwAbCxwEAJAIYAgLPVes4joV4M1reov2f9a/7frOhbF/8wT/06aBAiANCFBngE4ALApdc0AWQZQgBz/k0MMIIADEMbcDwFNMHmf1zXM8CbgDDIlMN8/xnNTgCZBnzA4N5/bs5/Tg2g72/B+GQQYFEAgwD5ASH+Liv6ExIfxS/eB9AJF0H/qg2gd9hjBcC8PzNAYetfFlhDF1iJk0DVcBR2/9XMDgFZCWCGVuB4/J8qcMIPXgNm9ufXAYBN0wALAXAc6D8WIQjY8iBAAiBJEkJcjwC0ly6DXg4BqAAHHgH0mgRQkRWARYBhUAAY3wXTNAJDA6z2G9L/UIAaduTQ9ZvzN/cPYgBwPMeE35/D3PMvWmZOrAR8u/bDYzkmIYS4FgHwQ0BeA4j+PygADwBxMgVEEShyDLp+4m0AsGoExhdMMGY8AwS8AtDk/09OzqZHngKC9/+AcWxzzsHtv48FtKAVxuninEHA8y2TgOfsDL6nPgBt6IUQ1xEBxCrwxdtgvAh8mMCsBpwn4X3AoLkHwkWAncDhfZBgNq6YBgpXAc0YAcQAIAxKQMgAcdA+mOfHJMe+/ceTnwKt88UpJQBBAJsCFl/ckysTQogrcC9GAO0AL4LrxpsgvArMCIAJIM7cLgO13I8xZP4fa2gDq8ZkgmeNMsDEugCoAfH4D87/0KwBAFABYgjgAYBJwNybAPggp8Eu8kBbPzxWDQD/a70PQAhx9RoA6UAA4l2gDABAQhgDGHkBK6wNbOg2NEbNKaCZHwRF/h+D0P27BGCxE6BnJ2fUgOj9sc7nDAOANYLZoDH/w5XzdHF62kIayIvBX+udwUJIsPU+gCsJwOt4DLRDQh8YLPaBYWaHWZJnBs8AYdjen5NLOWIVYEwBYPoHYzIGbAIgngOi92cFYMoJ/385BLC9vy8LqwNj4gM59WGGIMBKAd9u/RclYEW/L3kaoW9FXLkG0CGN+9/bW74NOjN6vXgMNMImYHYBAG8EqzEnvAkuXAQ0O5p5AeDEJOCM7v+M5vl/DAQAmFjmDry+zwglAHa+sGKwdwbrTQFCCHHVTmArAIfXAXSBBwBeADbLM+8DaFJAngMCWEZDLwFPaJyzCQZrAB4AnFgO6AzPE0sBOR8+QAG8ANDgGSBOx/f/LgIvWQxWHkhbSiHE1SKAdY8A2qDJAMVToCEAyHAUKHOK3IoAnv8vrAZgL4PhYAQAwosAwrtgeAoURAkITQCAjxgA0PwUEJemBmzmtM5jKgiVgD82J0IVBAghxG8/BYSXwkMCOk0GqNMlyyUAkIEeI4B4CNQkwO4BGvn+H8bEfzULVYAZRj2OJQDmf/gAy2eA6Pq5/8fkMBYwjMsRAIgRgBeDgwScfv1QG24h9JcoPpr4Uvg28Bqwu39/GQDIYOb8e1gKI5wAtWmvAzPGxgxzggeYzGINYGqpHzsBesIEkEtA3P+jExiDRAW4DPoAOM7PT89PuZ4iCHjuQcAXygMJIcRveil8O7YBhAzQnrcBRAHgINH9FzECsBCg9HOg48CEZpt/TCoAoQR4AIAQIB4Asggg+P9fBwAYxqlPLD6gAst5oP95rG2XNoJCiI8/Brobi8CxD/hyGxhmr5cVGfA+YFDA9QcFqOylkKBa8v+z8YQ1AMAeAGNKO5ma+3cJgOsHx3zMYQ2xBBw5d+9/7oHAciWAxeA/6rXxQkiw9c18dATwBhFAG9YB7AMGsQZsPQBZAvwIEEIAbwSD/7cBKkwvAYAZxoRVYOIpIOZ/YBjc/sOiAgCKwNzqAMtngNwM1n+xLOWBzrkuScC3a6ePH+j3JYT+PsXHRQCeAoptYHtoAohXwZnr98kUUHwj2EUKaDSCBMQEUDwFFKhDCcAl4AjL2V9iE5jt/UEsAcDI4q/R90fo/GGLc67nPqICsC/sf9m7etY2giCKsXGMUAhB5UFyKkIKB0x0EFBpVITDcCGCCDW2cWGdSZNmc4JrwlVCd/8ivyd9/o7nzcyOr5XcWfN2dq+P4vdm5u3H54H/ng6HS4BjlwpABcDeg4wFACEeAqNAC4hvgjMLmEALcC0toGu7BRSPwVMg/Y8e8C+RgAAb+CF6wHUdrP+DpWJspQXUQQM65X4MLACYX3aDNioBn7QI8DeDnU8cDv9L3fUkMA3C1/ggMEUBfNMekNwFt1hiAtoC6u8DtRYQBEDOAZQUBLUA0PrBAPdL+0dugfhT12j+9Nl/vWUHQPm/NQVQB4A7QDIQPTP4/d+3zlcOh+OgcHK6H/8f6W2g9hQARr8CEA/4hx0DM/4HzAS+vcXUXUC2ERT3QADSAVrBAsAMIgGiADVQYVYIVYB1hQ5QZ/l/GzWg0UVcAOV/wMzgd+f/B54Qe0Lv/26Og/gpjwdvkqTIL4tkePqMB2Fm9h6w8P9VrADmgJwDWCDMA5bsH+AVhwAwgLLkq4BKwr0pACQgPKyC3QGxCtz9UQc48v+WuJ8CLrDSf4to4oABQJPpv1cDbEgCPpyLBHgfyOFwHAKGo3w6GacpRZrlo7M9BEQEoGcC5yQBRR4FQFxgwhwGMOZSXgOQe6C1AOhXAGIA8Le8e7KAOf0P1AGyU2A1fYz+ifytAlhjdjSADgpgGsDpvy7G/4KLi2gGf/z3+sizE09lPcN1vGgMk+k4HY8nWZZNWAYuRyd7VQCzmZQA8hKAoGDEXaDyFiRiqecA0PnX5P9G9gBpAXCv20DvSAY4/S9/gv4p0AWKlwBZC6gnAcr/Qv9qAHdWAdAHawP09gFRbFABbLQI0D7QK//v4XD6d7zYX+Z4kExTIv8vjIxAEjC5Otu9AsAuIEA9gDzeBAfMAc7/v0sDaCEKcCMnAGSiAmAHmCuAEoPIHwvA/C/0z/3/3yEY/Qdhf8zYAJIdoFWsAFobTUuTgY9C6R/xyN77//pdHWmeMZAmNGlagW6kFVI2EKkB9Q8jmQSMHRwTO/4Sp32xFTsYgYkAC2QI4Mju4YvJpRMwvnGDwSDAOF4DBhaIjbEMDsIwCogQhASkW+rRzu5qZvaHkaL+Yf6GfT1Vz7s49xqS3A+BYOY8Vee8P0EjjdRcnjpVT9U5LCUBDgH7PsbJ4GP6H3Jnmk8xjun/1j/7+MJpF57+Fc7+cP+5gF15wFe+Mv8vRuoCSugxMFYlAGMVAKB/cDGreoDat2DAmogAvgk6u4A8BVBzYHEHEDlAgTmAVgKYiBjA2vqPW93/g6f9U7A/Cxft5w79s90V9uNIAv7D3ysC/D1JwH/rk8H9v/eOjs8k/nrlzK+cDuVD/eefC2bNiiyAQtCyaUWAyV1A4n8lAMtAbCuax2CW6/hfXUCu/mgX96+5Yk1qwDC/ZwCwtglIESBiAB73QHP6Jwdo6z9wP2ur+R//2VAC+hkhQNzPVqgMgC1qQNrvow7092QBGgq4q18T3UNAR8dnsfh/DvQP959//mxWIAMAYeHUaekAMyIALKgHgQXO/3jCbwHrMqBIATAlAE0H0OVa7gIKRP//2rwHtNWAof14CrLgi4DM/xMT7T1wW8NgfxZmCbgSAG0y2N8CgEPAj0kC4H/8y1/+D7/7q16w6ejo+AzhWKo/i+j5OVfkP1v8r+UQMJMq0Ll//bnp4DRdBucMwCkA/K8V9F+jwJYALhbW4KtB9YC6BYhJYE+ARRuo54AJAboImgkA3QMkN/ujAZj+swY0YQvun6j6j9TfNOh/KmD9Muhfu5MAhIAv3/W7LxDjju0H4n6g7/9mOj4TODaO/3H4txkqBWUR6AvTfBEsbgNVAtA+BlBtoBoCEP9nE2i9BmABOO+BuEL0L1QGYPZndwKQt4A2b8En/dc1oAgALgH9R6008b8LQM4Bfja5+kMGIM5nSxkAZ5MSQAwgBJx58K/6UEBHDyIdnxH6R/z18R8YbQSgCHTOKaNcB/3+GEDQP5svA4X+E5A/HuApSIvAvgh6NaupAKkHKL4hATsAgA1aDgHQ/7glYOTfSgBiDIzzv4r/W3X6twYM8+NGGwTk2F0s/Yg4UErA/04d6At/5jIQ49bT+3/f/3vv6OgwWhx3yrJzvjJz1vmzGvbHARtycLYCnfaF6WUA5y+arwhQN8GZ/sfGWDUGxmeV74IGLv3oA//nVdASAdaCq8OVALgAJKj2f43rPz7/Zw4AJqL+gyMDSADGt+Ip/8r5FRUgL+MuGR/2oH42Fs1ASgNIAhQCzkQK2P2l/lxYR0fH0Z6eHfPF087l+K+6D5hbIWBqCjD7lOllAOcv4i6ICACOAEuXhQQwhrv8Ay5OF1bjUQCyAAz1swARAFMGgBAQLwHgwLcAyQyzP4D9nQGoBMTaujUHwLZG7ScB7dMD5BKQ+b+qQEH8EQTM/hEHHALUEfq7v+xJdsf/MsWbGb3I9JlEVH9mQv5H8D8OoiFUA2GnnzrNLiAFAOAMQClAjYEpAgzQOwAsoNKP20AtAWu5AATY1zYZwA14vgNZkAKMuwDkAeAJbZR/VP93/48LQECkH1sTAh6C6isF8MJ/DP9nBFAMIAn48e++0Iu4HR0dRylmUP1ZeTq9nxfOT/afi0P+LEeASgFcA5qOBrBEAaBKQNZ/HQGAav+A3WPAvgs6MdwDlOf/ABlAsj9WXaBMArsPqCpAgS2s6gKa2MqaUAFoIH8h24DwyfTPcgbgEOB5MDkRwCGAMhD9QP/pS8f2v6Iekjo6jubW/9kXXjjXEP/HKvKH/oGuhLjwi9MUgReY/6F/zwFTBhrDVpQG4OpPToKtoQRU1wCp/OM5gJgBpvTjMTDzf46AQf1GVYBwtYBC/HwnnADwv5L/t1YGAPfLAJvP/uwlALAFfoxB/zhWESCGAqgD9efCOjo6jkrQ+k/1B95XACjMNioEOAM494vTmQQmA8geUM8BmP+B+R9PDcAaMKjTv6AAIPav0z9LG5FAFaB1dREQOjAbcP3HmCAE2IYx4K2ifyH2JgF4SOYokI5x9s8EwAUg/K4MAYjBkQP8/ZnUgf63LgZ3fOREiG9P/To+UXwhWv9N/vrMtk1WgWdFDsAowDnTmAULDaDughaW1hQwGYAlAN8DzXICYObPLtDLSgRW9b9wjcwKgCQAPDDeZAD/uIXjvzxEYCzO/1kAip1lCYBvcT9RQMzvw7/xY++i/vihEOAykJKAM3/3V70O1NHRcXThlEWn6/iv8s+FmGH6L/4/1ykAN0PP/OtpZAAuAYn+nQB4Dlg1oFYDvhjUg2DOAPwawBV1EYQDAN2gU4cA4uiv3fQ/SACYqB8U/6v4wwKlATQSQKQAd/Flw+TuAvpxOMyPSwVgA99XCDgzxODv/7cv9ENaPwh2dBw9+IvTzqX6P9f8z8KMFAHaWWD8HALAKdPUAOr478eA3QSEtz1ANQa85mInAEjBmQCwx01wGQD8FKQ86R/ev0b0b/ZPk2cKoMM/e0wBQ/84PaB4owATAbQecvFfG4ZjRwDuZ8sMQJ9oB3IdqCcBHR0dR81x7YsrKemcK/6XF2bj5v8mB3AJ6PRTppUBnL9gkTSARaBJAEAzB+x3AFY2c2DQP1vgirC6BqIA/aMAxAzARtG/+b/GAMY1AgD7WwUAkgBkIn4tI0PAQ04A2CgC+fTvzbAQ7A04CcipsDO5HOK/djG4o7NMx9GBU+afDv/PvhBw8sebCFDs30QAB4BpagCL/BpMZAAlAUgBcAOQfNX7EoCfgvRbYNwFRBYQ8P0PJQCzOQDUFEDVf2oObAvUj7MYAiYJgP8jBWjYH+63BOweIG0KAw37B+f7hzMANsNKwJlKAr7Urwfq6Oj49OO40+ZS/pk1l5saChUEZjclIFaIwLNGyQCYAwgNGPLnPbA2AozlRXAXKwNYVddAsFa7/b9eg7cI4PYfI9ifpQCQqBAw7iAw0TQB0QJKCuAKkHMARwDsISUALCxEYDG/11SkBIwZTgKqH+i/9pcCOjo6Pv3l//M5/8/mmoYhARhW8L/pf4oGMHP6GkC+BxAJgDSA0oBXSAOou+AK+RAA9785Coj8PQY2TIDxgf7D10kD2CBvM4C6B0Inf3kgqj+6CcIKAF9QAnCyvwpAmQLA/uQAOLhP/uMwnf7vu+s+fsoSJQaTBSAG/0/eDO5iQEdHx6e++7OO/6Z/DO4HJQF8RA3gXAaBpQGUCgD7L1UHUM2BRQrgRlDdBDQMALPj8L81YETgCgBJ/xaBkQDa0/94KsBgwm/ByLZicf7HTP7mf47//7QzQ4D8Ln1M/4X7piYA92GFigBkAX/PZPB/7klAR9cAOj7V53/xP6d/oz3+NxlAXQWkBWZOWwMgALgGVFdBlAa8MgPACncAxU0QmEXgK9b4/H+ZFQBsQOi/7JIA6vxf8i8LDwkY3AL7y9UD5DGARgPYGRWgPP8DcT+rzv5F/z7y34cH+SsH+KAQcKbKQN/5n10M7ujo+PSe/8/l5k/z/1yWe0Bx0X87CGDMQgJQAJg5nQBwGgEA+s+r4EoDwIGbgIwMABaBqw8U/sdlwkD+ngIwNAdmtBqwr4K2AAy2ogBMaAa4pX+O/iQALJeAiADRApT670OYcZ+dpSiQIcAxoCLA9xUBUgz+6ZeO60eyfqTs6PiUtv+fPpPzP5ZI9mdhwCFg6l1w54+QAczy+b+agFhghR6EzB4gUBlAvgUTI8A4liKwNQBPAOeOewpME2AF8/9PYgpgAoj/owK0NRuAMJO/d+whJwGi/4fk7gAy+dvwOP1D/2yY0YaAUgLO/P9O7H9nHb0G1PHp+zczg/P/TG5/SFQOkIaDoQLESvqXjTQItiBQc2B4oCpAGgHTJJigCODzP9DWTgFYA14H/a8b6F81oKnnf0SAkgDeV4DxmgEr7OT8L+oPF/dLA8ZDAdBPWL804IoCrgKx2As/xZwEUAcKMbj/UXZ8xnBM/z/B0Y9Tzz8d/l90YcGlnyM0gPOrD0hNoC4BjRAAsgSUEPl7DKzGAIgBCR3/MZD0n9yfInDV/7XWuQW0EQBu0ZIZRf5xDdyEBADZ5ALQTh//dfrHTP0yXGwfm4kfh/LrY+JvY0AlASoDffnFk/rfWkdHx6cLp8z9ysxz5nJPP5jvPMCo2yDE/rENV8GNkgHMcACgCJSXQS9rB8F8Dyi2im1AdIEm+dckcPQAOQJw+uf8rwgAnAG0GK+3IPEtSf84WxSAcKwpAaEAkASI/W2QPwj617bbEUDLJvYX/Yc/CO9rmf6VBHwns4CoA53Q/9w6Ojo+RfjLRdn/Mz9dUSC4f36VgGB+vwlTg2BNF9Cpo94F5HsgTP8lAlcByINgdfy/rNg/PfjfJSDrv3iTAFT5B2zJCTCB8j8BQGj6f3bC/VqY6D9RdR8+xf4yHLj8EyoAJuL3ts0RAGQd6ExnAdtO6hMBHR0dnx6cxvzXXKhfYDfmYvPZGhW4RGAf/z0HcOqM6QUAXwbq12CWjg1doGMrgQcAClYAZOEEAGcAHgOD+rMLFP7Hhar/a3cM2KI1qf7zjzr7WwLYyfnf7E8YSBlgKP9rFf3fxyb6twGFADvcr4WzwfxauRMCKgn4zyf0smlHR8enBKfQADRb3I/L4mvM1QrUXUDNcwAjZgAXLhAqAfA9EDUGxjL3RwIgCcDy7xrrv8JQAYL5tUH968z/aAB1AQQwJrBKAWD/raDpAdoZxZ+o/bNNSgHuyn13bpUAwPhm/4b/H4T52xAQ209x6kCVBHz/S10M7ujo+FTgCytpABLrJ/8bSfzs7VVA7Xtg2EfMAEAFgNKAoX+WR4CFfA64EQCAr4LGmhFgNwFtuMb8Hz4lBAS2Yv9xqP/grJ3Z/oMKsHPnQxEBQIi/jgEsYTfuCOBPQ/9pD8qqCQi3UQeqCHDmsycd09vyOnojaMefH6fNVAFIEP9r5zMlBWivA00RwHMAI2QAc5bMrwTAF0FEBADuAsW5C3SNC0DCat8AwZb0f7no3wlAKgA6/0/OAG7RwoHkXzSADAGSgPMWiCoB7WT+V9tDLNjfbg1ArvO/6X93KQB8iv5j6fwvD9vWBgGhVQK+815PAjqf9H9dHX/2Dt0vLvrKObNE+3J/DbeBtilA+xyA2kBHCgALBPE/y+d/rOH/VVjKv44B8L/fAsbAWq32Fgi2G9oKkDB+iwxUDIgRsK0yoR0CqBiAALyzVOC7Yu3WB+7Hmto/qxIA1oO47EHtOKvov6IAZSACgOtAJ32+/4VODzM6c3X+7/jTK8BcAE0HqLhfyGO/4VeBj3gRsgLA6F1A0P/SEAFCBB5TCag0YK+6B8IjAGtyCEANQCoBZf2HAQDPgEUFyBHgFtk4a+gAEv8ntuJbqwak8z/2UJrrP8ZdjfzbSAAIwdob+q8wYAstYBs/KgLISwkQvnzWC30yuKOj48+J47544VfOnbtA1zM7B3AKwIp9bphLQHg7COY5gOlmAIvmif8tAOD1HnBNgYFVkn/F/4F6CDg2UAoALqzLCAAIARYA2tN/mwCI//EUgB/5GQ52ugLE8hSABYDd4Y4Bov62/tOGADqA8vyP4WFEAWcAkD/b5CTgO1/qHaEdHR1/Lvh2tqB6awByY266llUA07+RbaDnTDsDEP3j1QWkOeC6DDpmwNjA6kYFuMwS8NADirsJCKxL/ncIaC8BrQbQCejfTaBHloBQflUAkhJs+Zdl9temKpCNoz8xYCooAD1YAjDu77YHt23LCIDLhDYEnPXTL/VcuqNXjzr+TDjmi/O/MnPuQPylAyT/e2e1AQDzIDAYIQP4agYAz4F5DmBsbOD/SgJWa2E1BwD5h8P9TQ8QdgOb2f+Ii6D9DtgWNqwO/9UB6hkAoHP/TlxtoIFqAbICoO0+acBsbf0HPKgYwAeY/EsHzgiAAX9jMnhIAv79+H65Z0dHx58vATD9ewSAbWoKYMD+4b4MupkDGPU2ULB0mUtAfg7gYlk9BCAFQO7Df9MFGgmANQCXgBIbBgnADvmL/lEBBIcAFAC3AD1iCWDnTko/+ENWgHGTv1MAiB/+x+SGaz9sD8pKBs6dT9A/7hxAdSBw6/e/850zv+PrgXbpmuhjOlN2dHR80vjLJV+ZOXvBgjr/x6dlfzYrAHJQGjAaQGUAx0xXBF5ECuBBYHzMXaAWAfwSmPi/RAAnAL4IIgOA20Al/Qp8mtfAgvwLW6IN1PSPJ/9bAWbZHqrjfyUBon5nAPdJBMAVCRrA/i4A8X0wSJ8N50fRP8tQDLhVSQD8fxb+5TP//YR+nO/oSV7HJw9eATsHCbg0gIoBheZFGETgvAzaGK0EpEfhQb0GELACEAEA0AgqBSAsEEf/UoAb/k/iB/USWCUA41UAsrkBCEzkJRDAGYAcvrcCXB1Au6H/qPxbAI40oFKAB3PHIwbgAYsA2/AqAG2brAL89NZIAoY60K3/o3eEdnT67/ik5wCOO41b4Ba46l8dQOxF/VhJwNkDhPsiiBECwDEKADr+m/+X5l3Q7gJN/gepAa9WH5DngKsN1CMA+RjMOvwaD4HB/xtcAwJSf1mWgKMGFCGgVYDxRywBiPhtUxMA9t0y9F9AHGjxIJZOECgJeJvc/P/TbaC4f/jcGiFAOQBGEvDW7+kIndGZoDPNp/j/mjP6tMZRCyRgKkBRAkprRYC57XXQHgRrS0CjZwCWgBOOAG4BqjmARD0F4AkwDQFcfkXQP079xw2gLGDy35hDAMZEcj8bKAVY9L/1EV8CIePwn+S/k/VPSf0Yfh/n/yYDSH/C5M9HFltimxMARQFKQI4C7fEf/q8kIHAWYvD/e3w/v3X0FKDjE8SMU6gAXbjIrT/++OsQANpR4PYy6FmjBoDKAPwesF6DSTT3AK0Ga/CsAbn4w1obfnUTAW5oZoC1NlQJCLTvAPj8XwmAC0DR/Sl7yCpwWwIS6Ydj0ftv+i88WO7SjxMAZwA6/kcc8Pm/cKvsO4SATAJ4M7i/FdPR0fFJ9wDNX+QRsAXseG6tAMBeEaAdAyMCzGIOYIQMQDKwm0DVBqQWoLoJKLFq9WqonziQ9O8IwO4WUKOq/9fINxb/jxf/uwN0S5sBlAJMAID+Of3ziRDAMnbL0X+D+sX+3or5n4D1ters7w+8H7sWCBGADACfTP9ZB1IEsBJw1r+dmGWyPh3W0dHxCWDl6TPVlS/K91rAzhcvtHNgTgGsAeOjzAEsSfrHQY0Br8SFtgZECuAZgCwB+S3gtVhqAFH/rwQAiyagcUkAeFMC2tLWgDwDrBYg3ORvNxwBfP4fJIBY2BOYT/8KAu4BFcz8IQFr3zbgpw2S/TFAHchSAGKw6kDH9gJBR//32/EJ4C9oAlVXfhD+gioBLWgmgufKW/6v5wCwUTMAVYAWvB8AVjRXgTZvAeOWgNe0TwHT/4ODeAnyBtwBoJkDG2/0X2yi7gE1LABjQf8CMcBzYKb/OP6zYH4+OF/sSPkXE/zZZvqPH4AEAPbHqgZUnUC48J0hBJAE3NafC+vo6PjEnoJEA0YDcB8QzL9AW7WCxmfukZPAQtD/6CJw9ADB/8BDYMbFBtwvGUDwMwBaa8HVygIC62IKAFxT18DVYzAuAMnaKbAE9C/+H1pA4f3g/xa7Wfc9NAgAUD+WAjB4Qmb+tykEbMsQoI+vgXAIwET+pv6qAQVucxIQYvC3//sJn+oj2Yx+3uvo+IzgixeePnOOnmeB5+Pk780B4IOfBHMRaFaowOePdBmcA4DgACA0/B87zK/lAED7j/uAovwTOUAWgK6RA+31DDwlIF8CBP8DtuYeCHE/S+wfEcDsr22Pvh4BiIWD6v+B/HEMytfGMioB8AcHD2YfKN7gVi1Z4kYiwFmRBJz15TNu7EMBHb0G1PEJ4JS5p8+ciwTgETDccA5QKnDQv6wtAcH+I2kA56v8TwQoCQBUBFhVCUBaVIB0E2hdBC0JeC0G8h1gENvGSADM/2CLBYDQfw3Tf7SAylwBSvbHpigAAqQP/fv4X/SvXfT/xBNNC2gRvxMBPJEiMDZVBDYcAlwHeu2E/t9Xx1GD/sD1UYtTZp9+TgaAC+0Bi8I1BoC3GrAxYhcQIrCbgBbVe8BEgJIAVq1MCUAZADWgy90ECtwGejVeBSAxf53+ZcK4pwC2bNHWJgCBR7L+TxJQFaC0In/M226qQBkDKgREBEjSf4IIkN9ClX+m8D/blAQAJwIUvtOEgO/++/H9/NbR0fGxYsap5ysAWAOg+s9eUnB7FcQHZgA4EWC0NtD2Pci6Bkio9h8cEaCmgF38SXMXKE8B3EAJaN0NoN6B2egMoK4Awkz/21sRWBlAkD/QXj1AeyoDGKo/96WlPzFIAFH8UTA4kv5jN/8X4HwW3s4B4PQBNUnAWfhZZ3z5yy+cdGwPAB29mNTxceI0AsDsRVkCgvsxkL/jLRhHgRoFBpKA5U4AZo1SAlqwYAnQNRBLVQDyFMBK3A8BrFmZ/A+qCSiqPyyqP1aA4yngOPxv0GeDMwC/BanzP5bsnxpwCQCi/5SA3QM6if73wf5hwN0/LNM/KwTg4H12oB9F/9B+meHzP84q9s/dcBIACAHYGRKD+38OHR0dH3MAmLvIcwBCJAHtfRBDCDBm+0I48X9oAA4AM6Y3BzA/FYAqAOFjQwpgrF6NEwQqAcgOoJgCHiRgoPN/wezvJtAtDgFmf/i/akDwP2HAAnDxfwvHgEoAtOEWALS5/POEK0DGM6wq/7BaFP03KgC7cSPtQLdlHQijDnTjyV0M7ujH9o6POQNwAFjgIbBKBNpBMCPYH2QNCBl41kiDYIvmVw8oOcCY4AxgZRWAMgOoLlDRv4tAay0AKABYAnAGsHHQAMbrFYAk/4oAQf44X0pA2QDkEODaj/bdNpeAnALA+l4wv7gfmPoL2zA8DDcs/+K7Bgngfp//Wcb3FQNuow4E/Wcd6KxDJx7X/3vs6Oj4eANA3QBh+vccWGHuB4wCewxstACwYHgLbKk1ALDSGUAh2N8agENAPQTJBqQBQ/0b2xGwHAOuDIAY0F4EF4D68xlIcgD2EoAdAvY5AtzF8vmfTy64P5t/+IYGzIb78L+N9UwQfxsBXAAy+e/CmjbQBjdq3Xbbd7+rEIATAr57siaDP10hYEY/UnZ0fDZw2rmUgJaI8U39Rj0Ow5cfjgD1KnyJwNwHNO0AwOTBktQA/By80MwBuwMoCkB1/g/Q/uNrIIR18D/1H2cALMDG8R8NeDzo3/2fxtbtW7fuiB7QVADqEtA8/stwd4DKWg04vwANwPQfC5Mbz8D5bOyxDYD801MEuJXv/ZhF4ClR4MYbv/Pds5ACwJfPOOPGk2b0okJH/9fV8TF06FoDaKTfjAN8mhtBsfY2IMFdoLNGmwOIALBIj0FaA6guoHoLEvoX/7dNQGsxuF/LqAqQ3wHYyOFfSAUAJwOoGOAMwP3/Wzn+x+nfIaDIfx9m/scFc79KQEoAcK0HrQLX6R+H/IP5WdUIKuyqJlBCgBOAUgBaqAYUIeC73812oC9j/3ZC/zvuTPOpfg+g/9s6ijMABwAT/oKmE+hCu1AaAA6S/y0Cj14C4vjvOeBBAhb9+/ifEaDpAbIMXPUfV4DqErjEuFuA1P8vlAK8Y2Lo/wQ7QwLmUxUg+D8h3s8SEJalHxwL5o8N9k/eZ8e9cfaH/2PnM2BXbNA+v0T/9l159r9/8vEfT/suISChJODznVU7Ojo+lgAwRyWg8lx1/J9XEcD8j4cCYBl4xElgMgAhJOB6Cwwf3gJYw5qiAPgSINzHf1bxP8b5P3GLLCfA+Ey04CVIBGBE4HwGwOqvNtz6b+xOAAxK/84BIgDgzgDKIH3M8m+QPzte9R+sEoBbcRWA7icATIX5HxAByAFATwI6Ojo+lsPdqQSA2Ut0H7Sgj5xEoFIA2dx5FgGAn4ScHRnArNEygDmLFi7J9yBDAsCbCpAVAPO/Q0A2AEH9CgJGXQMB+Y9D/xs34GoBdROoDv9aW4L5Vf3fgSkA/AwfBGBnACkBUAHCd+9mEKDBE54ACLO78lPkD9ixZ4L5MQeCZ3+qfRfWJgCYgoCsuP+2Jgbc2kYAxOAb/wdi8DF95r6jo+NPl9vPiAxgUfA/S3ANaGgF0prHmjupBlSDYKO2gS4KBSAyAOi/moBWkAGI/UsCvlxLSP7Pe6Cv4PSPr8sh4MoAXP/B8x44kEHAUAlI/E/x55Fif5AXwGE1BOYakI//kQDENkSAOv4/g/PRL7H/NrZtgz27DWjfhWNB/43JbyULcBAoDeC2WzGCwG0RAr59ZrYDnfHGiUdPDWhGrzF1nuk4GnBqBgCVe0z9DgJY3g/NavkfP98aAD66CBznfzWBOgBUD1B7DwTwYzBZAWok4GtiCGCd6X8jy/0/dADxCQ1gwsb5f8dWbRkAAPTPAlkC2oMG7ACwmwhABgD7G0+kY9KA8coAago4wgDOZvIHFQVYKgG1zI+7Bwjc780pQIjAEQFAKQGMhV3334/vf68dHR0fhwhcnaBi/1KBAT+OUIHPxzIDwEa5DnqJ4DGwyY+BJf3rErgKAOL/mgBjuf7vKWANAbj/c2MNgY2b/zUEvL1GgFUFGso/bEYOgO1h2yevDtDCQdM/xC8z+fvgL4f87ZkBiPPz6+IPnqxfdusu5F9c3I8l8+Oif0vBDgEuBCkJ2H/ysf1I2dHR8aeeA2hO/vkRtIv/51EEqkbQpg3UEWCUDCAFAAJAJQBm/7gLDub3FFi1AJn+m/o/JaBUgFX9JwOwACDzHLCmv1gZAZwAkAGo/uPjv8v/pACc/rXUBBrnfwzPux9KA9b5H0gBToP04X99cdO/z/3sfDCxv1bOf7Hv2qWiz677oX8WHjHgNoeADAKRBlQI+PagBHz7v3QxuKMH7I4/1b8ZdwFV8YedTYD6AfuCagJqMwA/BzByCQj2dwUICRj6rxBQ10BjVgCEIQGoAtDVUoAjAdio9p9x1oaNUQIapwSUPaBbME+Amf41BQb/Y74DCOQQmHx3pAF7YP59kzXgKPr4KxOewZ5IAYD6P3hGnsd/V4D4ZQVAltwv+o9GoPvv1w/IX5Yf8z8qACHAzUCTI8AZ1/XrgTo+hSwzo8eXo1gDWCK+b2fALrQMXJfBkQQ0w8BzsgSUFaBZowUASwDuAYL6WUgAVgBE/0byP7i6cgAKQDcwBBBTABujBAToBCIO5EtgVgBa9dcFoK1B/7ixRxlAqr8syv+46L/RAGwu/wuQvrZq/OETX1zHfxzDWTKxf1v+dxSA8hvDnQBgyf63YTiwEqBbos9648T+31dHR8efBKfNUgBY5OoPO0ueC2gOwOBVmNnuA5UOPCtqQCMGgIUqAGUG0CrAJQEQANip/8iHl+AFdmGdVWC3AG0cDw0A+lcGkF2gqQGArWmWgKkAVQTw+R88hO2LJqDq/2kCANR/kC+4L/g/ljuA2LEIBRaACQBsz+prDUAb3nA/6/5bd2F8rAJbA4b+KwjkEiIJOAM/44zr3jm+lxQ6Ojr+RBqAbgNdcKHZnzX5RiA2aQCGCkAsj4KN3gXENUBLSQGOvAkiikDwv9pAL8fwGgOeTP/vjwFvrAZQ3QGUCgD83yQAsD/rET6wf3v85/yvfY98T5z+9+0Oa9k/7f3zfy4xPkuG59oG4tyfGgAuAUC8v83kz+4fEQPC7r//NheBTP7gRjztiDrQWY+d2Amyo6Pjo6PmACz4ugoEYqsC0Ny0dg5gFj5yCcgFIFwVoDEqQE0JaHV2AVkBzgyAIYDSAFQByufgqwlofLgG2iEACTiKQM4APANWBaCCR8CUBezT+d8JwBQFIFYlAFYACAJZ9ucD9ecCz+b8l030/6w2uen//uwCKhEY9o8ooBwgY4AB+7PYJyUBiMH/1/H9IdaOjo4/TQawKN8DKG8l4WEOAE/MntN2AYHR2kCXCsuE7ALyTRDm/zVaon+2egxGZ/+1vgROfoPgJyBZ0f6zwdfABfe3/J9QD2iByg8FIJY7gNQChDsBmCIAYKCZAUt7xgoA2CY39fPRwkCVf/Lof6u2XfrG8d+buP9+sz+7mF9LFrhuUhLw8MnH9UJJRy/+dXwkHHNqloCy5dMpAJbwPwoBGLgEhJ8vGRiciwQwagBwE+hSd4E6A8gmIOAEYAr/ewbgGs0A4B4DFvkLsP942hY/BCnA/ziId2CaBGBP+EOlAMD/FIHcA2SY/JvT/4O5+eQf9B/fbZMFYBsloGfF/6L/JH1+8BHj8zX/38b3tggBfB0CbkyvCACuywhwhpKAs/af2P8T7ejo+JNcBgesAeBAP2sczO8BVADAzveN0KMMgs10AIghMI+BsTwHEDfBOQCArACtjSZQQ+KvWoCK/hF/BXbpv1rOALaH/KvqjwtAR4wAgIdk2jj4Rw0IDxy876CP/wfvKwnY+q81gKb9H2zDRPosmduAsvzPwuIHtL8Lg/vlIDqAYH65s4CqAGnn2yoBigDg2yf3yeCOjo6Rj2t1F5BIvy4CleGm/wWpAQBHANz0PwsfcRBsWV0DxGNgdIHKhPYhMAUAXFACcDVu/sevQQZwBHANaBxPQP/AGUC9Aua3IBUAKgOA+GsADAkg2j+njgAcdAbgvUKA7EFLv1q2zAF2if617QLbwgD0H9ovv1IAkOGwfn5ubcv/9kkpwE3XDREghgJO6n/gHZ8CVpnRk8ujWgNY4qt/tCoUGPyoLlAc5CAwDka6DfSrpxMArACs8GvATQuQZwBKA77Cb0G6/qP2n6shfmnAhIDhETC2JH9fA+0EYIcF4Eca/sd3Pq3jP+Uf6QBDBAgNwAqA73/AsSPJXxoAcBJQGgCMH77NIgCW3O8E4H6Wi/9EAuFW878yAGkAMqEyAJtwU8SA675dIeCMs/ae0P+76+joGBHOABYF7bOqDUiGhzisHKBEADAHGVj+EeYAltIDuszPwWgOzPA9cHkPKG5c4R7QdVPvgQa6Bdrsz4oGoHEPAbgE5Ckw+F/YaTgDCFP9vyTgjAERAjj+VwZw0PRfTUC4y/9gW/izbBECvOD+ZzFrwCBCgKi/ekCBqv+xzP4P3PpAkwNggM1K8HURAUAmATf2JKCjo+MjZgCm/gW4UReDZgRgZQIwJ0QAAPuzRggAf/tVAsCSyADGrAE0KQBYY4j6Xf8JcPyn/KMUgIdgiAFuAsKUAdT5f7zeAt5RDaApALCsATwt/n/oaUJATYGJ+1MBKA2ABfFD/y1c/GEzHvT3WdV/SvtlZ7EpDBj3Y/it2u+3CiDel7PJ8MKdsH8FgcJ1TgIsBp/92Im9I7Sjo+MjTAJb9MX4AG9OCObNdx9oZQC6DSIygMAoGUDdBJRjYE4AahJYcP1HEjAi8CAApAZABej6ugnaAoBegjT9s1T9jxLQhOkfjyHgOv2zJffL94E9u8E+kz+GBqwAgDf07w+INiBrALg2AgCIvh920b8TgEYDAK4AGQoDnPqdAcgfMPtD/nzF/3dmBeg6dkcApwGIwT/Q9UDH9t6+jv7vt2PESWCf//GpXUD6VTIwQWC2r4NTKygYsQS0bNFSVABXgJwAwP5ySQCm/5oBWyuI/q0BZPl/XSQAG+PwnwoAzK8g4PpPCcBJ/6x4BOBxzv9Pw/5N/Z+l/h8cS/b39sTBoP/YmurPg2wu/fgL9+f53yEAy9M/v03+zgDSbpUUUAd/vkX+OOBzo4MA7K+tEgCHAEcAcE+fDO7o6BghcHsQzA9B+i5Q7dUEWjKwU4A5koGh/+gDGqkERABoHoNpEoCVHgM2YP/06AHNCTAchAZsCSATgFvYsvzTtACp9jORl8DhgitAe9KAij8KAXhWf9gPlgZ8MBQANnN/7XA+S3jQ9I87A0jizyAgrxmA3Orw7zZQAeJnsceKEHBnnP3h/Ttjj3UT5hAQUsC3FACEbx0+4RP8q+nRpqPjM3gVRJ77Bf9yWNA3+H8YBUMFJgL4XeARuoDIABQAgv21PAbmeyAG/Zd1BRYdQO/fARQzwKJ/coANlgB0AYTcF4GCugMO7DD9MwOG1QxYVX+IANkC5BQg8ETEgCoBtQIA7vafSgJyBgwL3s8Y4BSglQBk+graKwF44P4H+ORPbFAAFASAEwBWFICC/9mUBNRQwA/e+HzPxDs6OkZ4DyCbgDD/kLOB1ACkA4PmQrjsAtIgABghAPgiIMgfmyIBr64WIMifxZ4VIGnAWr4ELjUAKkCYkOyv8r/Wduu/NQHWjIH5/F9jYEH/Vf7nc/Bg0P8R1R/vsob9n00jBhhB/EQAs3/lAGmxTcVtOAb5yyH+Byj/34mrCkQaAP3f5D5QmSYCABHgG/C/gBjc/9o7/gB6/37HB2oAbv1P5q//4ZcBpAG0bUDwv3TgWSoCjdgFhADgDAD+B8X/ayYHgIb+BVp/rk7+N6IAFPovkAQAYggA34pD/qyB/H/G9jj0/zTUDywBIP5qCLhKQLA/G58IAcaLsV58xtzPMkoDAJ4D2DWYfvMpiPhj1Sc4/wE+qMAQv1OALAHJYX4WhkcJSC7+56MQ8APKQMoBhB+82yeDO7oA3DEdnDrLcwCmfpZhGSB+XUgWAGoSTJhDEWjkDEAKMFb8n/TvOTBCwOWArSTgq4cEILY2AVAIMBQBQF0F7Qvg+HAF3NYsAQnwf9hDFQL0EkzFgFYBsADQwjEAh/eL/UkAiv7LMQeAtgRU5F8I5vcQQPWAymD9+N4YScBNGQOcAQxKwLe+Ffz/DZKAm04+rv9Fd3R0TCcDmMkcAH1AWHP8rwjAmudXYeZiagJNFSDfBMPOPeec6XcBEQCsAaxoukAFXwIUInDWgEoEyDsgLAJbAh738X94BiDoH3P9f0eTAbQVIGg/AffHINi+4n6cjQzACYDxoms/6v3kazzrBiBRv7/mflshG4BqBCARxX85P/iyZA/A+cH7D9ypHe7HblIIkMkjBuBOAogBGQV+E0MBM47tkwEdHR1/OH07rckAPggODKjA8/weQA4CyGfNnhUqwChtoEvqIjjzf0kA8RAMfkQT6LpoAMVZG29opgDiDbANmQDISwTO9h/TfyQAj1sAjhTAGUCovzUE5vZP0T8LE/eXQ/zhhhuASgLAk/1xffFCowGwhIoBOFtT/4H9nQHowy43/7sGhLUh4CxSAGG9xOBjj+1/2h0dHX/MIJjnACoC8PXuRqALtQLzFALg/hSBIwUgBIw2CLZ0jAxghZtAwaqLL8azC7SGAEBsKgG5AfTqmAIw4P/UgH0FKLhFLvqH/13/MZwBpP6LCbtZ7gLa7QQAZPk/qz9aJv8g/he1s6z+svvob5j5WezpLfmzjEoAHg0dwOQfG5wfGy7qdwjIDABX+YcfSgMCP/gBZaBvEAEC9/TLITo6Ov4oHJMaQEP9DTwJhlMEmhf0n3AQIANQABhpECwk4CwBWQFmCZMeAlvbtoFC/Zh2s78zgLz+R+YmIGy7QoA7QDX/JU/+ZwSs2n+0s6kDFOTxnyXuJwVgVQLwDB4/qv6feDZNh3/XgY4o/xf2uvrPJjyKhQg8WMQAu+kfzlcM0Jf9pjtvEv9nBiD+DwsQAr51xjfOOjvqQK+c0JXFjo6OadwFFDw/FUn+fJQC4JSBaAKakzdCpwygEDBqAFjqAlApAL4Gor0Ezj1AHgNG/m3O/74HFBACzP71DqRP/zgG/8P9rLYCBPtT+1cCkOUfFuyPw//47rb/J4KAeoC0nmn5P3eo3/DJ3wsL7HUCsPf+XXvvF8T+5n38Nll8WXc+gN02nP71iw8O3lcAhs91DgBkAd9QEhAh4LqTuwTQ8clhRg/Yn1oc84cygHgQxilAg+oH1U/1gmYFKBtBWXEbEAoArUAjBQBhrL0FYhVLqGsgPAEQ5jFgj4DFFRCsUgDStsgExYDtWydM/6UA5zUQSf+GEgDfAypL8Rc/mPV/PlH8waB+3wFUIcDV/yoB5SVw2AsKAWFGGwPwvaJ/LXCbw8Btj0YYcAUo6P8BCQC4UOUfNhbUHwsDVQciBJyBs/36+N502NHnADr+mAzg/CXF+IuK/1kYrvpPzgFUCJidg2Bw/ygZwN9GBgDGSgPOCADWtAEAAZgYUF2guPifhbkHCIj73QAq7seF7XUFNEEg6V8Gkv59BxCfHAIGA/VrC+7HowL0YiYASgFebI//TQTIbVdspv5Ypv7gfjG/vPCAykBu/kkNAMecASTxV/0Hv5EiEFsC/peZ/rFMAs7OLOD2rgR09MDc8UfNATgDWOSPowGfEoNZUQDC3AWkLVTg2aNlANA/8CUQEQEUAhr+vwKL838lAPEMsAWAjTr/uwRU5X+9BDw8BTAIwLjL/2xP1xSwsa/O/54DOJjmCyC0u/BvFXiyApBel8CZ/5P6XxD9s4P7UwDQcgYA9WMhAOvon0kAJlgCLvp3BlASQNZ+gOm/QoAiQNWBrvt/Pt//ujs6On4vTjs/2kAXtTkAm7/z08gA5g8pABD544jA7gI6Z/qTwGMyZwDL4yLoVatWvT8IHID75SxrwCBSAMM3Qd8St4CyqP9jeGYAOQLA2gr34y4AyRgCS/7Xeqi9BJQdxOEfd/sPi7M/6xlg/k/iZ2GGC0CwfhhfJwCif629YUQCuB9/QOT/KNSvEJCbTv/4nQVGAUT+VIAiByhcN0UDcARgLAz+x8D6kz53TG8I7ejo+FDMOLUCQGK+yd8IZVgLETgqQFYA4lkw14BGmQQeqykwsDIDQEkAlzcpQMQA3gIz/aeRAODQP+4RYPqAGgFAAWDHQP9NBpApwIB91n8xnBXsz8Jhfwy3AJznfzzCwMvPlPqbewH+Jwo4BQgcYgX/IwCL/J0AiP612AgBoHpAcevAYn6jSkA++htNBHAIIAKcRQw4mxjwrZO5ubMXCDo6On5/BmDG58PCnQYEOPuzzSMCVAaARx8oKrCCwEh3AaEBWwRevnJV6L/tTUA1BIaBqz0GBvejAfsSiI01BbBF+i8e9O/HgEHzEAxmCbg6gGTMAWT5H3cHKKYKkN0DAC8OGgBoEwDDv6z/vvBCJAGsSgEwzX81CQAm+jf3u/9HDqz8mvfBjfKbqgTk+g8uMywDRB3obJTgiAD/0q+G6Ojo+KMCgDdWmwHkRyWg+aEByH0p9Kw5sysD+NtpZAAzmwCwfLgImlUZQFMBwuB/UHcAsXwLUL4FgAKMKQD4ITCWS0Dm/0oAhBIA6ilg3QMky+I/q87/pn92Fv0/WKEU4CJ/eRF/bCZ/PFpAs/UHL1PvTwyDUQpi4T7946Z/939ieHPw92byx72lEgD9n631yvH9ON/R0fF7A8CSNgGQ4Ya6gCoE6EZQiwCowOeTAcyZdf6caWcABABmAOo1YOAm0HoKrLkHtL0I7obr9QwY2OgQkCKwBwAsAkP+UQBqX4HJFODxnAJrCkCIwHkRqMeACQIlAWAuAMXwLzufCgJN6ae+L2COAO0WIeD+rP54i/O/6j+wP8wPfPbPMeBWBDD/u/rT1oDaClCxP5uTAIUA5oJP6H/jHb3G1//NfNgcQAQAUT6LDWcr/jf355Mw86kA4YF8EgYVeNoZwIxTZn513vsFoFQAfA9EmwF4Boxt3dqcAfAlcL4EiGUJWNxvBWAisV01oGoAiq3ugRsuAHIMgP9BmwCY/g+2TaDB+2xtBai8+J8coDn+44eg/lB/+UL8yf02hQDxP7sR18CFTaV/lsxoi0AF8z9wBBAIAutP7EzT8TFjRv+3dTTfBTQrRGAtvKF/fef7Irh5C/JFANbcOViowJz+R8wA4H+hxoCrBxQk++MRAbT8FpjpXwkA9L+xXoOsCTAd/rf4LeCaAcshYKm/TzsDMCB/oXqA9gX9G3X8x+L432gAL+du8i/+jw4gmXDIa28uqN9HfwsAD8hb9ncBCGtLQHB/fPXTMeD2PPg3CcD669b/QNt6BYH12A+urDIQ/aAn9qtBOzo6PgjHVgYAFhkL2qagwLx8GxL2Tx14Nq7b4OJFgOllADMcAMz/6gFdNXQAuQeoLQFdLTf/Y4SArP+4BWhDTQGr/OMMQAGAIbAdlQA0IaAKQFhdBJoKgAfAXP5n4eJ/nNM/KzB8Tf/5Bbu0SAJK/GWJ+g9l/ydtQOb+OPvzg61SAF8CjRX318nfEkAjANwu5o9ffG8nADgKiP0rD7iECCDwUMyJ/aDf0dHxIYNgM2ctMePzMf8DtkK+DI8KXIMAc+bGhaD47GnOARxTASAEgBXmf9bqJgNYy4rD/xUeAgbZ/8nSBNgNfgp43OqvMGHs2OEpYJj/Z5C/UT2g+Qh8YHeug0oAcL5R/XlRW5Z/3PqpLc7+bM++bPHXqBYgqB/eZx3CcIvA1H72RgoA+SMFJ/uHANCi6J8VeDjp39vUEHC76D8B9ev8L/YnBiSuvPIbUQICTx3/uT4O0NEDbceHZQAuAXkZjgELF8zD/CoMIaAuBJ2jBIDPKF1AK+Iq6OYhgDYFAI0EbA1YFSDcE2A343oMUod/dYHKgeo/8vYhmJ1YkD/bUP/ZJ/cFEMn/4n6zPxs23ALE2d/8L7yMAUIA9uzrVf6RSQEG4v1c+N4IAfiuiAHQ/6NsqQAQBMJa3Kll+q8QIO7HHob673ENiI1ddjv0j2uLFAA3riwd4Ff9rciOHkc6PuQqCDIAH/+rEBSftgw0jwwg+X9eigAuAk3/KogZDIIRAGIE2E8BqAGorQCJ/HUNBEAA9ktgtAC1E2D1FDwhAEykBIDFQzDSgNs74AgAuCOAyB9nGxTgkIDlZn/VfcgC2If6j/aq/ysDaKv/1QFk8feQTF/PACACP+oUAO6XQ/zaZEX8Q/n/Mcz8H8SvL+xvxOE/NQDoPytAMjzoHxOuxC+pCPCv/VqIjo6OI3Bs3AW0bCD8agKyQ/5886MIECUgHKQKzHUQs0fJAEoBZgzs4sIaIUbA1noOYF2+BYaDIQAQAXIIzPSPs7FPGL4GqO3+kQLctoDiu4dLINT96QbQ3dX/4/o/nvV/rZeh//RnCQJF/i7+c/rPxckfw33+v98G8afX8R8Y1fzzWJ3/b9KHLYs/bPdUBQjipwTEF5j7Qwluc4ArqQJVBPgv/QDX0dFxBCoAAFWC5Hw9DyxfmCowd0KrGUgVIB4FkM3JZ8Gm3wV0DhmAFYBAsX9mAO4BWotfjXkIwO0/sW2YfAsE8BVAOCMAuC8C3ekCkPVfmYs/bAoB++RYZQAA4m/smbSXYwF2dN9JCUBbAfL5H+izN80SQJb/cbifD1vD/t5xuD9TAI79rPyFCbfLMgTw5VMZAPRv5td+ZQaAygG+cXLP+Dt6DajjyAzAXUA4W4BPysJapv+4FLrehAGOAMjA084AzvnqvBVxDZAVgHwIst6Db0tAKgCtnZwAiP5dAEoJGBP9azU9QEH/sL+5Pz57nm56gET7DgBWgAUqPwfxqP+L/4HV36L/7ABFAMBfMP/vGvRfLImfnWX+Z1EDgvoBm3pABxMeawpAD1cLEPTv6j9O+R/L6v/tt98uGTgzAKjfp3+qP5j8h84AmirQD0/63IzOBB0fD47pf1VHK0491xpA1n/Y/cFTA9aeKnC8CxAq8Bws6F9zACMEgDnif3eAagwY+l9NDAA1A4ZD/5gTAGODE4BxGcgKEMzPvt0TYE4AdmYC8Hhy/86ngTMALLE7XK+AtfV/GTHACoDVXxyTRwvQ61UAYsMcAkoAyPL/IXF/pgA1/yWY+4v+OfI/oN0awMMymJ+iz8O2DAK34679xPkfXy+D/yH/igBmf6EiwO1dCO7o6GgxY5gEXrIIsOXHWCATnATMRwUARIHKALDpBgCXgFbEEEBpAEQAQsD7EWBtnf/rGghigMr/KQGM0wHE8hWgTADI4hK4eAsMDB1AeDWBOgPYZxP9h0kFmKQBRwbAEv3b2w5QNvC6j//sUfxnx1z9Z4GSAKIByLAA0GgAj7n4g5cA7PFfPqEA34NB/6774PrKPQZWLUA45M9yELjoG2efFxHg1/3vvaOj48hJ4DlLlygELDD980PfJXzAQkQA14CkAc83/csA/D9nlPcAogdouR4CIAcgBVjtp8D8FnxNAA8C8HAFEAGAleTv1yBN/8n/YMdETAGAn5n9mQHzHaCmf7zegTf3V/3/oEyHf+MZ/OVUf/XBoH+cFCAr/1rYLgwE/x/ae0gRQPteeRWAcAP6dwrAsZ8Ni8O/zv653aPK/z2RBNyp6g+L0z9I7Zev6R8vAWA99kNqQFC//JJvsTwQdl5/I6yjo6MFGcCsr5IBiPUXwviVBORWQsAS8T+LWbAmB5AG7AxgugEAEXj5WJSA/BQkNaCmCTQyAF8ChEUAuD46gLIENK4AkLAEvN1Pwcf5fweuGyDwmAF4/Ok8/2MC9F8toAcdBHz6TwWgGkDxF1P+hfvdAdp0AKXJzf6sQ4gAQf6KAVC/6Z8fPv+zWgXgMTzsTq3HhiBwE4vtJr6if5YVYPy6MH8iBLgAxIL+sSYDUA7Qi0AdHR0fmgG47Ydyv37lAgutBww5ACJANIJqzZnnJGD6g2AOADkFQAKwytUf87/oP0EAWBcJwDUeAubsz8Y+vhHzCICgo38sTPTvKWCsaj/VBArrs4wSgBNwf/G/AfFjTgGeZdPpvwpAxf94CQB7MUvBMuAKUMHk/+hjlgBU/of4mxwgev+p+ygLCPa/J+v/5n72Yn9W4gfghxEDkvov+cElV2KXXORe0JP7n3tHR4fhDMAaAG4swTwOFuzPNzAfJTgzADpBMehfKcAIGYA1AF6CwVbWDHApALQA+RmAdawSAHT/MxFgnD00AKDn4CdiAJilDADL1+D9AliNAOCFfQAFwBmAr4AI/rcIDCwAP/GyKkCNCgz3s0IDDuqPzy6f/tkoAAXrxxfk4X9vS/4u/+93/8/D+kYMqAKQTv941P7Z2XAO/xj0Lx/4PyXgMpV/yAB8/r8EUyCwDLD++N5k0dHR0SBKQMvyqC/mj1iAAf/DBewLPQyMxyzAvDkWgcGoASATAKD2zyEC1DXQ62JL/dcRgAAAYP+bXQBS/d8loAlcBSCNAQMrwJjgs78V4EoBdmMeAks80aQA4JlBAcCz/g/1s7v+/8Lrdf6H/SsFSA0gWkC1i/7hf5auAfIAsBKACgHYwwz/agAgzv9J/3da+JUSkPTv878W7L/+dg8BgNjE/vC/rZqAMgeA/89DBfiX/vfe0dFx5BwAxC/Vd6HJn4UviH+yUDJAPQuT74IxC1CtoKOUgOapA2i5AoAlgNWY+X+oAa3LFlC3AG0cXoFnbYz+n7wJzvzvChD0n09BZgbgFlCYXxmAQ8C+gtifEpDxojXgxBNif+xlUAKAYoCgPdifZUD98kOw/yGTP5s1AFz03wLyx5P+tdQG6voPDv2n3aOF4bcDhYA0ZQHriQNsSf9Sf8ukACe+5SLQeTEM0FWAjo8DM/ocwFGdAbgHCI8QIGdjj39WbUA5DhCTYPNIAoCygJEyAOh/eT4FExkAEaACACj6jxJQ2wO0cXwDSYD4H8shgAmZ+3+25i1A6gGqAWCrvyUAy9p7QJUDlADA4R/HHAJkQwh4VpYbOQAagEtApQDjHgDeK8fAo7jMcPGfJfrH78Sxh/XJCGD+1+mfZYP8h/LP7SL+9fpdh39sOP/D/vQAlQYAIgXIItDh/gff0dFRONYBIGh/Id8wJwH6LsSIACEDzNfxfwGtoNEHCggB1gBmTjsAoACs0DVweHMPRF0B5BGwyUMA43KK/wL7FiSAIQFIBXgQAGoGIBIAHOavCFBA/8XaGWCs7QDF3PrpEeBi/0gAQLF/GBkA/B9JwF6WL4GYRP+s/aoB+fgfmxIAhACIP+xhtYA+fA+0Hyf/kgASkD8eAgC/MCPJH+63AICL+mOrFGDz5/uRsqOjY4oGsCQ4n234LtQ/SaQKTCowf77O/8oAcGUAKgGxxRzA3047AGgGzPS/uiTgNZSAUv/VWicU/+Pif08BQ/5+Bn6Len92sLZWBQjsBM0bYCzTP+4JgKk1oNQAAr4H+mVNgAEx/8ss7PUYAqb+rxQgYO5HAWbB+8AVICvAFQKC/FX+ebQKQPidYY8hBLj+cw/m2k+4ftxeEvB62XXeA1n9Wc9KJwUwRP4sIBGA1RuBOjo6pswBLI2zftC/NicEigP846XsC1MFxjQMHPwvg//xUQLAyhUqAqn8g0cAGO4BqpfgcwYAJwBgG4UNQwco6q/g8/92lX/45C0QUgCi/p/sz9oTDvbhgjuAsGJ/LVklAY0GgOUMsCIAqPpPAerHMwPAIf5SAFr2h/a16wv77xf/Q/yPif0fxh9zCgD/PyzmL7tdGYBxnajf/I8bP8QyAVARSAZ8/hcuyiLQk/1lmI6esHW0GcDXyACi6L8wIoBNv4FaQjGof2EMg4n9HQEsAYwSAOapArTcbwGvaoYA3ASkDMD0z2YNWOqvIgDwCHBIwNszAbAEAPfL6xq4PWyu/bQKgNm/FICif7cA6ewfW7K/iJ+NXfUfdwFV/QfwPYTtzSngNgV4NJdDgHtAOf2zPAAG7UcKkOQPbsKYAcBp/mdr6z919HcQcP+P/IfB/XJnAGgA8L8MRCvoGZee2P/kOzo6JmkAy8z3chAi8NK8CAInBCzEIgOYr2lgtQGJ/aH/UQfBqP9EE5C7gDIDuFxI/q+HYHz+zwqQOkAtAdzC8kXQrv7nBADwUzDm/7CnmwAw4GCs3ZUB4E+Y/o2XZSDoP5+BsQYA97MN1J/tP1hs4n7D9J9Q3QeH/6MAlAIA6i9GCMAVCTwEDOen354/+NxurJer95O9OfyL/DFAAah6gOD+JgU4G3/lcx8V/Yn5jo7PmgZg7hf4ZjBgTxV4CWt4FwAdIO4DwudYBB4hAFxAAMBiBmwVIwCJSgDWKQTkCJjW9VwD4YfAKP7L6yV4PApAGHvzEEzqv1ix/wHo/8Celv3BPnmNABTi+J8DABggAFD+t5n9i//dAKrl8z/wj1YChveh//3M/9rwiAF4RAFA8Qf9V4f/oH+on1++AqKhfxa4zud/xn+JAcKVbgPKLiDcIaBqQHf3P/mOqeiHgv/lu4CiA2hRLlzf/LGAn6ECL6xG0Pl5GZBFYDDCHAABQJ78vzrp31MAuggO3q9b4HgMkhCgG4CkAQf9VwQoCWBr9v/scAAApQD7GciSgKsCFFshyv81ApZruP0Nez1U4BgBdg9Q8X+GAMg/fKD+Xcn9jQJgDRjb7/oPpI+FAmD91wUgIgDEb/7XD1eAcLhfvn5zjX816i8uq/o/VvjmeaoBXXRC/6Pv6BpAR70H4BLQAjO+4GzA90KI/ReqGZQSEM/CiP2xefN8HegIGcDXyACEnAHQYwBTxoDX1jXQ8P/1fgyA8j8+vAPG+R+vd4ARAKIFqFpAQV0AZ7zkClAlAFqtAiBYAsj6vzXgugA0zTPAhrg/BYCIADC/kUPADgD75ei++1X8YTkHyNo//rATANhf9f8qASkCtOf/qvw36m8B7m8rQNUC1MrA/U7Qjh4yOoxjUwSu9p/Y26+UYba6DwgRQI2geRsELkxXBP5aZADcA1RzAKZ/JwBAA2BrJzeBZgIwPrwELHMFKMr/TgB8EZy7gCwATJWAD4ar/o8bdQt0lYDqHrhIANiHFqBmBPhQ+i5bNIGyCqL/w8PpXwd/jwBA/bgugcCESgCiAoRFAsDJX7HA9K+FG7dXAPD53+yPC20C0AaA5/sffUdHB/CbwAQA1XpYVPuXmvnVGRrkry5Q5QfqBMIiCQBz40JQkF1AM6cVAJgD4PhPF2iw/+oQgJsIAPWrC8gK8DXcBK3jvyfA2EDR/5ZQACD/CVV/mgIQgPnxnS37J1z8eZW9ZX9Wqb95+tfS0R/n6J9WAjB4DfpPP5So5p9GAc4QgCkC7N//2H5Rv5YTgDz88wVUf2IKGGTpBw8rAXjzZlN/qwALV8aWQaD43w4upQakCLD+uF6w7egH8Y7JGYBnv5L6p1SDcF8I5LsgsDlYJgDzpq0BfC1EYAKA2B8jApj/iQA5BOAGUNX/fRW0r4AYWoC2GJSAQvxlRQZgBfiRuAXoafF/sf+B368A4IZjAB4JwOsYGYDJP+v/r/v8z7LFFRDOAdoQcNj0n/6AjCCAKwTUBIBxTxo5AOwfGoAWu7E+AsB63FtL/ywZ3o6B5XZpiADg7EtO6P/Vd3R0lAbgABBCsBIAdr7xWRSzYPpfuhI0VAAczMUqBBAARigBkQDkINgwBgDWXoExASAVwPWfa+omaBWADJ3+wz0DAPNPuP+TrekBFaoHqASAVz0BYPgVmEIe/Z+pFlBmf8X+nv+VEQPe8vgX3J/yL/AQAKstAYn/Tf+P7X/sUbYs/7Mo/WPAZaDUf50CBP/jrgBthv7ZTP2FRgAQ8bMqA7gK9seMS7MGdF6fBOjo6JicASxyCID0Gyx0RhCzwIoAQCFAScA8sz8YIQOgBJQFoDWrdBVoMwOAR/VHKvAN2LqsAAE/BMnxP9kf5B1ALv6znADgj/sSCGQAkz9bmwC4CFT8jyUgfrYIAXgIAKr/UP/XVwWgVgAI+j+UC+zFgvjr/J8W6i+beB8xGPAr8HCbAOCKAUX/oBKAzSy4Hxft6yu09C8z/4OriAFXFftjF0UGcPbJvWzQ0YtJHYkqAeXRf9FSNtZQCFrkH3kd3KKF8yUEABQAIgA7JaBZIwSA5eL/KAGBdgx4LRD9y1L/vd4PATcZwBaQIUDd/zA/2B70nxLw448/Qv2nlX+L/y0Bq/yPGyZ/I0cAnABk+ccKgB8BYHcEwCwAeAQYDxx2Ayh+OI//LEWA6gAFGgEolP7r+r8r/00JaL3O/3InAW0FqIo/+lYLEPyvTbjokksvPS9SgKf6f68dHT0wtxmAq/5D/ac+C50IoAeTAnD2pwiEzY8CkDFSCWj5xaucAmQCYAWYp8CA7wHVQ5BhG/USAOb2f2wQALbjmG4AVRwYjv++CEgasHDAAvBL+4RX4X9FgMKLdtf+bZkA4K8/k/SfDvljFoAHy/6f9L34YQvAQf7uAXXxXwUg484jFQCWDMD6sbUZQB7/wR1ifpasLQDhhauoAOFXOQOQnacIcMb6z83oB82O/m+lAzgDiJ4ftqUuAgX3s3DyAd0HV1dCUwMylAKMKALPIQO4mACgdwCyCQg4A5h8CdwN11zjApAlYNF/jgAA3wC0gwDgBAD6l/EMvPkfaAS4eoCS/WNvIkB7/McFdhWAXP2Ri/nZDZj/taD/xC5xfyUAlQWI+334T/pn4SUAU/c3zP4+/5v/C5txHf9L++WH9rb//0dXglIAKgG4Cu6XXYoKzLtgVx7X/+o7esjoaDKAZSL9pSy2siEiZH9ozgNHDjA/Z8FKBBi1BNQMgZn/pQCscwNo9H9ingGoBqBqAaIFdIsCAPzvETDCQKYAYA9W5398H56A+l91+f/NoP83SwHw4T++A7L64x4gJQCVAQT7a9uFlQKQCQDLAsCkDqDH8P0+/oOH8ab8j8mdAchju9chIARg7A6YH7DV8d824KrMADAO/zjmPtDzzrjk+P5fX0dHB3AGMCb2X8jmCBAbQUGf+GcLFy6F/+eRB6QG4PN/JAAjZAB/dwEtQALsnwkABv9TA7IEXBmAsFFwAhD8P54SAPeA1g1AWf8x/T/++CQF4EDQPwUg4VU3gFoDftEJQEUAlgtAJn9t4AX5UP9/C/rX8R94F/PnHtRP+Sfc9O8EAIf+2doO0GR+wK7Tv/mfdS+2mRXsL+qnBTRBCGC5APQj7Er8SlIArSoAQf9yh4CLMgM4+5v9MoiOjo5JGkCyfmDZ0qXLIgD4n+RGfID+HQHoAcJLCBghAORz8DEC4B5QawAeA1tnCZj6z7qUgDdOHgKri0DF/vEMPDYgZgD2YJD/UAKqEPBqZAANXkx72wHAIwDAQwAhAYj/04xKAFh1+ucjHIb62TA3gOLMf4n6WdaAH5a36q8MN+6NBOBe5wGbZesxkf8dbJM0AFifhasExHYVLvq3i/+rDeiMHgA6OjoMB4Ao/EcGsAzmJwKAJTgWOgDMvySfhZlXbaCif/lHCQApAbgAZAkA+jeuzwQgXwJIDXhLicD5FBgZAIjy/w7fAqoW0PYKuKR+PgG/ApAh4E3qP9pfxIHJHzMQgEv/dfnfISC4v+n/aQpAGOzPLyJAlYCEYH9vjgCEgKecAYj6WSCFXyIAKx32h/xxNhH/sDIBgP3h/uD/a10Cwq+K8r8TgEvVBvRNicA9A+jo6JiiAcDzgL2YH1fxX/+Aj7qAUILZ8zoIYa5F4JEDQDaB1hRA8n9dAaF1w8bh/L+xKkBbSgKA/iMDyABQNaDHIwDUG/Cg2P+lg9UCxHqzmQFuJQAc+BpotYCqAuQhMPAa7gSgnQCre4DM/G7+GWpA1H8yAzD5y5rqv91wCODkz2LH1ssxpQDQPhvuCtCPoH7c1H+tPgoAOBmAj/+UgJwBnNg1gI6ODuAMYIU5X7WfZfos48cgAwf4oVmwlADYPAo2zxrAV6cbAFatTP63Alwa8BVDE5D5vzSAcfcA4cn+UoC3WwKA95sZMMhfGcDTLv+49HPAbaBx+MdN/oQBdlx42yUg0z/9P+4AjQoQsALgFiCX/4P52Xz+x+L6hzf47N+7P8pAwBWgBhUCnrrnqXsyDNQI2L33pACA5w/V/+XQv/yHZAAOASL/H0UBCLs20gDqPykA5/k/6f/SSy/qGUBHb+rp+MAMIFp+gvxj1/I/ki/kN/Qfb4O1KvCoJSDoX5ZPwegpeJeAqgJ0zTXaXQGafA00CPrPl8AG/VdbjQAIUn8PRPvnS0n9VgBeVQqAQf3B/tibxf5tAeh1eQjAbBYAXsv6PxbsTxAwoH/sDbd/wv1IwHvh//1uAuXozyok92tFCSgCwPvlf0zHf1ZYXgMR9A8o/2N44kd4kj+4VhmAnBCQLUDmf3DRJV0E7uj83/FBcwDJ/7gigHaWNn3ijqCFVIEAEWDhvIXzh1agOWD0LqD2Mfi6CvpqAPPjTABkF2hKwBtC/sXGqwAkAcDln8Tj+RJYVYD21SMAfAgDCMBmfxaQBFAFoOr+9A77KwOg/VOGa72FvZZjYG4DemEvmzuASgGQAHx4/36f/h0C2gagjAHPZwRw+b/JAWB9H/3ZKgGA/bP0f4dqQGzB/0n+7Nfq8B9BAPIPDaChf/a8De6i4/tffUdHB3AGsIIIICzD9OHrn84GgO6FlgyMzZvUCDpSCWh5TAG7AqQMoDTgKgD5EiA8LgIVtuC3TB4Cnsg7QAs7nQGUBICp/OMC0Ku4BQAcQ//F8IDIHxsEYGcAFQIg/xoCDvpnGdC/M4DDSf58Vf13/d8KgFHzv84ASADIAEoAUA5QlR8lAvfy2ewMYBNHf6i/hgB+FDUgDIj94+sYAPFfohX0f5FF4Et6AOjo6GjnAOD4PP3LHAH4FhYCpOAEKUAzCsz2tXOmPwimW0BX40oB8vyfj0FevTZvgYb/k/03UgK6OZ+CKf03NYAJWdwAoSZQ079qQKJ/SQAY/M9KUAmC/9UB5CQA2m+mgN9+GYf8C+L/qv+I/PHXWG/l+Z/yD17034gAav1RFYgEwPDhX8v78w/jz0P/oQEoBrAFVP7XCkMFxkIDlkkCuIMa0KYfblIaIIj7QwS+9lod/mH+a50BXBozwE4AZJkBbO7PAXR0dLQawFJDGnBFgPpnuSsGhA4cAWCBA8CIg2DZBQoUAMz/VyACVwJwPQWgjTLcBaAtmG6ByBkwEgACgKaA0YCBQ8DjTIHlEADY5zsgxP1DCpDc7zFgK8BWAGymfy1qQB4BeytDQAYBrDTgJgTA/ockAe9V7efw4RwDMFoJ4PmsAAFFAEz8r1UQ99/L0tFf/J+A/QkCMD+GkwJsqhQgFQC4P8KAe0BJAYgBFQJSA7i3/9V39Op9x5QMAHgH+UNuoAID8T9Y0CQBEQDO+er0H4RBA3YJyBkA7O8xgBB/awggJQBwi+i/JgCS/2MKgAzAeJr6T2YAT9c7wEH8Zn8sEgCXf95U8QcLvO0E4O0SgDFPATcZQDhLx39Tf8q/hw4fYlMGAFQEwq0BD9X/VyB/Oad/CQDmf4g/HdwrAz79w/92kFNgm6j9i/kzDngMmPYfPDOAa5P+2c39wf6VAfQ3ITs6OgxrAK78C+7/cR6QWBgrS0DOANhM/6O9CEYCIP6XpQDMXlMA15ABXK8u0CgCeQbA819sQAKw34JsJ4DzHYBqAgoBwH2gFQCqAwjo9N+e/3Hj9TRA7d+WMSDP/1MqQBgOgv+j/R+TJ//LX2lTgKB/KwDB/WwJ6v/OAFL8JQUQ1mPUf0BoAKwqAanzU4ZD+1di4FLCwKWgzv/WgM87uR8QOzo6Eg4AhWV4IH6VNBy3AakfyCpAwXMAIwQASQBrAlYAIgGoCWBtOvuzWgXA7E8S4AKQE4CdsekdgJ2VAFAACnuJAKAWIAz+pwj0ZuQAIQGw4Xn+xxQC2F+vEJAKAO7av9mfBADzAFic/9/gZ3QAEQJU/D+sveAI8HwYh38ZQeApjwFgwlNKAMgAPAUg5lcgEP2z7vA1cHcoAfjRepd/FAEsAAT1s1UGcCkOgv8vcgJw0Qm9NNHR0dFqAGJ6cz0+tmxsbOkY8wClBFsKgP91K5wiAC6MqgHEEEBJACEAsNb6KXjI3wgJICpAfggM+teawJQB6CLoAY/j4n8/BnyA8k+UgMz+LNlBLFOAFxUDagKsLf/jaWJ/8JZCgPs/2TBwqPAGIQC8cZilwr9K/zifkoArAbAA7PK/HN7HcgOwv8v/9/rwTx5QAoDL/5A/2JTlH+UAmQFkAEjyD/pv4QDww893cu3o4brjCA2ATSjWH75jrgLB/Y0IMA8X/6cGMEIAaDMAXwQKfA/0MALW3ALhAYBbMgPQDNj2HVsxV39wKcBPZwbgCADr2+F+FtRvBcBXAFUCAPvn+b8KQCUAgLewcM7+9kOytgQE+0cGkCEAZwNNA+gravxR/YdPRYAQAYznpAC4EWgzQcDsL2QBCM/aD9S/SZvYH+7HMfp/wJUsNwGZ+WXATUD9b76jo2PKHMCyZHzM4Ef+U7KBwpJqBGUl5iwkAEw/A6AE5AzgyCkw2N+XgIINfgyyKkDbWUoAtm/fsV1jwFkBqluAhD2pALgNyPSPowA39M8e3O8EAA8J+L3XHQLwGAF4iyCgJiA3ALkC1Jz+WQwA4EDyb1sCsgTA/ko7BRAx4KnSgDG+Yv4SgTMFyBBQFSCPf3H0twDMxvGfAhB+1bXi/bYFiCvgKgbA/8LZD/c/+o6OjiYDmDc2tixzgIQ4X4Ug6wBj76cBBWcA8P8F8xQAvjrdALA60LwFzFIJaF0gJoDzGRgtQRLwP3sGTD1AmEbAxP/5CrDr/yBHAFT8cQdQnf9ZTIEF8+Nv4sMQAKf/96D/IH+VfliGij9vvfaW2J8FSgK2BpACwBsY3M/K9p+G/tmzAwh7iiwA4/ifh/8SAEz/8H/Rv+APISDO/4oBm+B/LHYLwEH/Iv+EFYAi/6YJ9KKT+t98R0dH4pgMAMH6S/PQz3dsGRgDkQF4AUnBIv/0ARegAcwcpQTkClDdA5evAasDaN1G1/9TAw74CgiHAOg/m0Bd/X/6EZaQQwAH4vxfzf9heBWAYgQsq/9vuv/z7eR+AgGbQwDHf5kiAAlA1n5U/cHz+I9ZBZYdRgPw+R9jn6IBpARcRaCYAYD/o/jzHN8ndf7HYf97LQKzeQZgcwUA5QDB/3hIANC/x8DAlTUB0PSA0gM0SAD9j76jo6PNACgBBTwCPJY6sL76Bf1bBmAZjgAXjC4Crw4oA7iMApCnwHwTqNgfF8bF//h4FYAwsNVDANkDSu1HywUggfq/cwDch38pwBkBcJ3+2Yy3PQHwXhV/jCj/F/3jbEH/bgIy+TMBxg/JwFX6GT6v7H/lMTybgPCgf3KAygDC8Kj+OwVQAiAvAQAFQLYJARiD9kMHCPaXAgxIAZL/KwMw/bdNoGf/pv/Jd3R0GMdmAIDqsaz7aEH5Y/rqnwCnAKkD42CeTLhgtABgBcAlIMg/RGC/BKkOUHeB4nn+rwwA/rcCUD2gj0cI0BBYSQAHcNG/HfpneQbMBu1jb8YO+VcGwGrrP5kAqAcUCVjlf7bgf5X+o/vTx/83VAAC+1sR+BWd/k3/4n4NgLn+r03cL+fwP8i/gc1awLibBADn+E8AIAKI+rXJs/4P/asJKOEUIKnfEoCnAHoFqKOjo+AAsMzPAATxKwJgYn42yJ+tTQGcAbRtoF8dKQPIi+CkAOBg3VoCABgugbhZd0BgVQHajk8E+29l+R4g+B/iZwFiQL4EgPZrg/jTYH9PAcTJ/80w3wKEvYdpywSAhQDM9y0igJRftjDhEA7E/trE/nkLhCWA0gDaDOD5jAAeA4P7tbIAdC8DAKr/COyc/1v6dw/oHUoCCAFJ/1IBcGUAgavw5H6FgUuxpv6DuwK0qVeAOjo6KgP4W2cA4vjifRY/2EX/YFlTAsKHCHCBzv+skTIAwBhwBAAXgEAlAHEJnFtAlQLUEMBEisDZAQTcBIoG8LSugDiQx38kgH05AQZeygHgfTr/twlAHP5xNp//36sbIIy3lACQAYj+Wcn91gDePQQyC3gjBQDM5/+2AOT6vyUAF4BSAsY9AEAECNzuBCCtkAIAPUCu/8P8qgNZACAB0Cpcil9SGnCaK0D/2v/kO/ocQMeUSeCxFIHF/Hn+F+/HRynAJBWYzW2gspE1gDWuAFUPaPL/oABs9AzAzeM3j4PKAGB/oAAAeAwmC0Cw/07QdIDmLRAEADzqP5jgayB8+o8Q4Gsg3mtvANWC+6v+4w4gXMs9QISAvS4BJf+3JSDA9or8leB/DPZ3CxDH/+dzAgBH/31SGYB2zPxv5h/4ny3of9NQAWLPS4AEWD81gEtcAWoTANlF5+UYcH8MpqOTf0fhGJeAxkT2QsUAEAnAcv3zxfxaXDdDszwJcAG+kOugp1ECmlEBAPgaCCUA1QPEJRAuASkBaApAGQAyAnD6x10AwnZy/k/+91OQB1z/YQI46P/gMAWc9I8n/QN2JwDRAPRemwHgUoFF++yZALCVBBAtoGJ/Fs4UQDK/d7eAugcU+o8VNwA9XwowtZ8SAIwMAD+X+usI4PpPKMCbNnH050fMALv+U/NfrCoAmfwjAYgu0KeO7azS0dFRyBLQihB6J2FFfggAyzMUgMVZAzIuyEtBFQC+Ol0N4HtB/5fB/U4ASgK2BICL/sMrAGy3AAz/g+oBfVzkvxOD/Q8k/e87YPn31ewCMsT/tAAV/WN5BRAuBSCo/+Xf6uPy/1s4KQCOWQCwDPxuRACd/9kg/5CBLQD8msUe538b3I8DQgB4akgBUgOOAMDH9O8eoLtF/az1of+uh//viAwAuALkCCDP8o8+zgCq/jNIwN84qTNrRw+4HVO7gHTw9zL1+7NU38UKA4sjB1iMLVy8ELQZwNdGuAoCAYDzf2BtRABPgfkWiATsH/iJO4CS/nUJBIj6zy8iAugVSMKAcEAaQIjAkQG4A+ggS/xvCRiXZQjgo+N/KgB8zf4ZAnAigEs/oDKApH+4H+NzGCMECEMG8EooABkCiv9DAWBPCRin/181oLoHaAgBP/fR3x+3AAX/w/24m0CzDYgSUDK/1iVNBpAasKeA7z2u/8V3dHQ0bDxHASCrPgb5gLFcv4L/xxarGUjsnzpAPQ12gTOA0bqAmAEAV5QEgKEB1wwAAkBzC0TSP57PQPolgMdBXgHEOsAlQNEBSgKQEUC8H+ug/U0iQPD/23gEAMr/b7sH9D1IX+u3Iv8wjQBjfKgBWQMG1n99DUREAPwwDvPHyT/gCBACgMpAlgA4/LOANQBVgSgFNfy/Gb87mF9f13+AFGBRvxf8bw0AZ13CDhoNAPp3D+g3z/5G7wHt6OhocJy7gKr6X1iBBZazFtc0gELAYleA4H8QAWCkLqDLpAA4AVgXzwG7ApTYcLMkYCM7gFwBgv6z/rPj8SgCSQB43BUggACwp66AtgaMC2r/yREwn//xlwkE1QL6siJAQtUfi8CvpQRguAcoD/+xm/zr/F8FoOB/t/+4+oNz8g93+edJFtw/WQL4edD/3VECulvlHwD7b6L/v3CtRGC3gOJOAdpLoNmAE4DNx/WSREf/N9bR4FRlACsH0sc5/6cZy/HlY8sXh0gA+wf955q3WEUglYBGywAu90VwPv+vTfoH7gHaIP43+7NQAEz/mQD4FiDRv+FrgOQhAKj4/9JLUfzHsTdx8CLm4//LWkAhQPV/3OzvHiB3geJF/u+I/s3/MQbmHlC3gf46qD+3V6oCJNfZP2eAn8cA1Z+nnswJACcAAPJX/b8kACD69xCAzPz/Q88Ag+oA9e4IkBnAN4cEoPNJR0fHpDmACgDt0d9ex38+S/miAMhSBHAWcMHiOV+bOb0A8PUQgREBxP5WAHwNBBiugcaoAaUCMJSAfAeQW4AUAWIAAAscgP8B20tVAsKS/kGEAOxNFYBc/5cGnPSPvVfnf5eAUgFwDuAA8E40gb4bEeDwG4D9MAj2h/4Dr2CPpQYsf+X5SgGk/2YGIMD+ygHyGqDQgB0DTP93aBf95/lfqxGAXQCK+k8d/9sUAKsE4OfHdVbt6OG644MmgYP5KwUoAYAP5L+YvaaBcY7/GPRfGcDp0w4A9ADlCAAhwE/BmP+vT/63ANy2AE2EbQ/9NzOAx50BGAeiCYj6z57MAFz50ebzvzuAqgkIh/8tAhf5/zaqP9pE/40C/A70/xqLLMC1H61qAAIpAWC4e4DcBJraL5sHANiw5+B9nG2gf/RfHP7HmQCOQBASQLC/XMUfXwPtAIBXBjB1BMAtoBed+Llj+997Rw8BHR+WAazICICL/1csH9MX8meNOQHAkAGExe4EWjxtEfjroQGscRtoMwOArxueAcaGEtAWjJug6wag7dZ/BYnAOQAQO8gakCfA0rL+I4/jfxaAmgwgJYCq//w2yj9WAKae/+F+efI/nlmAQoB7gH4d1M8n+R/o6M+Koz879F8CMAbxewLM9F9TYHH035wCAK4EQFMArv6Dpv7TlH74GikAOwH41TGfO7bzSUdHx9Q5gJU+9LOb/PlEJrCc3/D/YokAIJtB4X5nAJgCwPTfA1i+pkpAwzVAfgsmNeBx1gZqP2ALLvrfjsP/LGcALGUAT/sOCJb6fwASsMAMgMjfEoAl4BwDe1vqr0DxnwCQ+m9kAKwMAcH+VgCwwDtyiwDvvhv0vzfIvyTgaAJ6JSMASYD7f6oCBO1rfz8EPPlUtIASAp5rWkBVAbo7zSWgzZtAVP9xRwBW0r/WEQWgqv8A8f9v+i1AHR0dhnFcZgAroPzKAmD8FdpXiP05/+NsQOyP4YMOrOsgFk+rC4ij3d/kJLAeA7ssBsHM/34PfqMjwM03lwQcsACMg19EBvCL0oD3aCkChABwgPKPzD2gB8X9Vf/nAQCcLe09dYEW/8P82jwDzGXQwAmA6f8dJgD8GIDEXyKAUCEgJGAxP7sO/yy2pH+2pzBFAAw8pwTgORSAyAHYovoj+s8SkDIAJwJgk+AEAIspgNIAAqZ/vOX/87Czzzux/7F39ISt40MyAEElH7gf4o80gI2fwf3kAPyiCLSYCADxZwoA/18gJXiUOQAyAF8EBCIAWAKul8CS/n8itwQgOABkBiD+j0vgDmAaAgYxBCAQBJoCkKOAhwAyAWCp/acKQM0MQIoAgs//71QJiO0N7F1tTH8pAZA7BIQCwOE/zRFA9B8ru39YwBMAcf6nCoQlXAC6+24EYCo/vgiO+o+HAI7IACaVgHDDEwC+BvTJ/t9oR0fHFBw7tQQE7YPl+hlpQUYEsb9SADwyAEJAFYGsAYxyGVxqwHUPnC8Cgv8p/udT8D9xBqAakG8AnRgEgF9glIAs/w49oC+pAiQFQBUgq8DB/SL/V/0OTNC/tlSAqwJUGjDkn94IAGi/77wTIkC2AOHQP0vMX3glNWDcEoAFYKAboHE2yN8ZACFAGQBgkwDA6d8FoOR+ljqAZGoAwpP5tXsGoBkBAI0IDP07AbjyBO596n/uHT0J6JiELAHFKT/Jn827yv/8AikDi/5dA4L7HQLQAEa6CyglYCvA60z/IC4CvVkZQDWAIgDnFLDP/54BC69LoNlyCkwVINF/rKoBwf06/+cYcLA/e74CXxrwe84AUgFggewCpffHQwAKAjUEgFMDwgB7nv8Pm//3a3MLaKYAwKf/h60AxAxAFIBwNvhfAoACgFIAyF/OVxkAXi2gcH9sbQ/QFAUATwFY/P/NPgPc0em/48O6gFbGvFfWfuB8uQ/+MjwjgFOAxUH+5v+F054D+BsHACkAmQBUDNiYF8GNy+Q/wXwPxEQ8AuAEAAdx/vctoCoCWQA+kC8B1OkfvInhKQFgYn+YH+rH3osEoA7/ngEA2moI7B0ZGQAloEoAAodxYPqP3h8ceAZA5G88Ja8WIN4BzhrQcxUBCAEysb/8DhBpwCa8BAAA7x9ZAAryZ1UFyAIAOLmf/js+RhzT48jRrAFcQAkoij4i+hXCGF+RPps+ucP+wN2gAPpPH2US+PKQAOohmLoINDKA9hpoDGgCbEgAtkoCfoRFBQh4AODpqP7zDnAqAASAlv9TAmYpAXD9H7yMewYAS/ZnRwGQBZL/XQKC+1979x32N941+ysDwCsEoAH/WuSPWf/FPAKW3J/7c1r3QP7POQHwBICvAQJsHgFrFGDzP6ghMKyVf3O7qM7/rLOf75fAdZ7p/yft+JAM4IKLVy4HIv2VK4alCBDb8lXLwWKtMZmoP9w5wOILyABmTu89ADIAvwWQAaCuAYqXgD0AoAX/U///55wCMP2XBBBvwQgWgcEe6j/7sgkoCkAvHRxugVYciBKQW4BwXoEhBFgFdvmnyB+PKQBc7T+YPjkDjGcBCGsVgF9jnv/K3UPAloBLBAZMgMlVAkryZ6cApBAA9UsErgwAKAcoBfhaB4Ci/zYBKIj/PQJ2x+c/N6PzSUdHxxGIAADdZ8M/cNl/paIB3wZjWQXiZmiQYQD2X7h4uhnA33xdAWDNZWt0EdzUDCACwM0SgSUBIAD4GiALAIbon+UEIPp/ogf0JVzUn+xvHFTxB2e5CRTyT0D8FICqB5RlBfi3bxmvCezZAvrOu++ywf8kAIWq/8tJAGD+ghIA3AIAXiEgSkDPwf+hARgUf3DIv2X/mALOIeAqARXa8r+gT5b/q/5z7/H9z7yjo+MD3wOY83doAFZ7WfFdKYv/DVYl+0cSIA0AWAiIWYARSkAKAB4Dq8fg13kMTBUgzQC7A0gC8KAB72h6QH+RAUAhwGf/7AJlBMwicCsBBPljgbfrHjiPgMlLAX5LFSDO/xYAWO+81WQA0L9ygBABwGGZQ4AzAOh/CAGPwf9pBtRvPKcEICWAezFnAHiEANhfI2Bx8t9893p9gJuAmgygFYDbFMADwBkANvdnIDt6wtbxYRnA1wgAwfDGCrE//yS9sDg/qQEYqv/EHMAoGQD07wDgWyA0BabHAJQBYEQAuP8nkQDkEADln8Av6vwPsv7vDCBbgKB/8T+e1z+kDWPAFgDAe2QAeEYAiF8+8L/gEADvAzbK/3H+x1oF2Nwv0wb/pwRcISBRJ3++9/Dh+P9cKMDWAIDZPwSAVH8NWoAaDeDaBqUATKH/SgDWd/7v6Oj4YBynAHCB6j2u+DdRABdW6eMYYBtj1STA4pEygDWXUQJKEdiXQLCYARBE/gYBQBrAlrwF1ED/TZQCDPYMKvAB0X+8BfzS1BIQcA9QJQCWgKsDVBPACgH40AOUKcA7OKjjfw0Ah9cUMPZKAe6XtwGgqj/aowEIqwRg890//7npnwSgAP0LNQTcsH+ipX8XgJwA/PzEftzr6ElAx+/JABZe7CIPgYBt5cpV/OKj3xECVlEGMuB+rEAQGFUDYA4gJWDTP7g+NeD3L4GuAhCA/63/kgKE0QWaU8AJDYHtow00MQgALE7+GB9g9of8HQHCsgUI++1b8soA3skIgPkaUB3/EQI0Bqw3wNjkTQLwijQAnfzZRf6Y0RT/cdWAnnwqLgGNBIBFBID/lQHIzf+b4pv0LxM+IAGYHAC+WQnAL/v5v6PTf8fvzQDmVb3f5X/5KvO/USkA++JKAEIFvgD+n3YGcLn4XwUgHAkgcP266zcC0b9DAOwPtmMaA67zf5K/bwJ1AuAK0JFNoFX9Pxi7eoAEuD8mAKQAv1cTYELRv4fAogSk9S4WPUBYKwBXFSiuAC08Npn9of9fwvy+BpocwBEA6lfx/8nNbHEHUOQAdygJANUCNEUBvspjwM4A2mfgrf+q/vOrzv8dHztv9yHzoz4DgOjN9nwzCfA/WAX4fG/58n8IHdhWMeCCETOAywElIF8EXS1AkQAgAQv/HBMASgNCAqg7gNwA6nvgVP7fQ+UnMgDdAnEgFYAp9K8MwAlAZQCDAlwJAM7xXwu4BfStLP/EGAAG9eNGTgDz8fl/vySA1ACej42dZf0XLwWYDAAJ4DkSAI8AKwZg0QIa/G8N+IgKEGC7yrvpvwkALf8/eXw/v3V0dHwYZhxLAPh6zQGsxGJfJeqH/IkB7PrZSMHifuMCQsBoXUCXaw6sboIO+q+bQG/O+g/7PzsBADwD4BFgHPLH2wqQ6F8ZwHAFBB78j2Pwv1E9oO/hQw+oWoDM/wgA8L+RI8DJ/2xAh38VgDB3ATUyMAFAKYBvAQWt/sveCAB4jIFxD1zwP8bu4o8jgA//H9gDVDNgUx+B/2bx/9nffK73f3Z0dPwezGAS+OvKAFaJ+NnhfCgfZ2M3luPkAHD/Pyx2HvAPDgGjZwCXwf+BTADg/3V+CiaO/60E4AzA90CTAdAGCvvjA/0n+++Tg6YBFJcl3sbfxpUCUAB6+/VoAMJCAMCRAFoF4N9eY7P8++5rb0gACBG4HQOoFiAlAHn+N/vjMpD1H5zNOQB4UvwftX/8SRWAfg75A8gfT+qfqgCY/LXqGUghdti/yv9Xndz/vDs6Ov7AJPDffX0h9f5gf+2EAJ382YTl3ikB4QG4f3mbAYzWBVRvgQGRfzMEIAGgWoAIAVMkYBz+x5kCsAQAXsLwfXxp/wEVAMKEeAmmEgAigKs/OBb8HwqwHYj9BSnA0QQq7g+r8z/s34QAYoAjQGUAFQEwUf8vYwYgK0C6CBQBIDIAcK/4P2QA+B8XNsk3JTwH7AgAhhcgSwJu+P/Kzv8dXQPu+AMgAFQJCOIX2bPkgE+lA+B7kQPY+PnRMgDfA+EmUKAWIMGvAGyhAIS5BDTRtoA+DvtLAW753zPA2jwEYPp39d+wBKAE4O2g/xoDg/3VBYpB/2Z/NIC0d4kC6v8pAbgiQLUAuQQ0UH+1gRpP/RKv83+2gOoxGNF/GgmAC0DAEsAmrRgDBrENj0CytbcATT3/P3li/8+yo6PjD2UADgB0fmYaABQGMKDdH8sA/yCD/rGk/wwAXxshA8gKkCOAUoCNrgBB//+sbUvTBJoKAPTPBv1n+QfPK0Dle9opMPN/OhKwVg4B40MK8B7wDEBUgPISCCzxb6xhAOCQ+Z/Tv47/jgEc/vHSfxv6x9jxI0eAcbp/now5sHuxLP8rAJAAYKAagDYBdheAcJ//Tf5T+d/g+uffnNCPex09Cej4I7qA0ABWeeTL9H8xnxbfW/W97xECyACsAeNWAUbPACQBWAH2RXDVBAr0CoAbgKIGNCQAj2QGQADQXdClAb+0pwRg0z+rroF2CLAGILgBSClASMChALAIALKk/3c0BhAi8LvOAFABsLYEFCGgFAC9BuYQoDXgl089/0s2qj9hOv4/yYYCwMoC0Ga8FOAaAigNwPxfCYAV4LoD2tO/fgD4kn894XPH9r/tjk7//d8M6/eguoBcBHLtvyV/PJOA6AW1Qf44mHYGMMMBwE2gagPN+g9WY2Bb9AxAjgBPHQOLIQDwCxKAzAD2xCsAuUBEANO/2d/Ii0DdAlQJAJZTAJ4AM/uzaANNASAbQN8x+w8dQPi/JP07AOBV+/fXLaB4XQON3UMDKNWfpxQAlAIIMQYWQ8AuADkAtPRfAsCRGQD0X/z/85M7+/f/3j/Z/19n9PhyNGsAone8Wn+0WfwdMoDl/GSBIH92PiQAI4vAzgBSAmAGzEMA4zgRwHAJyPSflwBVCaiaQF/CKwF4VSb3HXBtC5D5XwqAEwAs7wH9LWjkX/X/wP/skQFIBOApAAD7Dz1Av/YIgOVfHf8rAsgSv9IWPUDKAADFH9z3wOFZ/mdDAPY7AIbIvyLAZP5ntf2fDf1/81cn9sGcjo4O44/IAEz6xsUXtxkA5h8hA2P4YiLARywBBf9fzVonbBymADwEvGWYATYiAPyfjxAEZH4Kpu0BihSgMoCpU8Aq/rsHyPAdcDbYv5qAWP82qMB1DRwZAOSPFf//CxmAcoDDBAIHgaYFKDUAhwCO/2jAQf6pATD+pQqQXPUfHf7vJQj4Doi6CWiT0UaAdgTgUoeAlv8v+b+P/9yMHgA6Ojr+uPcAFABWVucPPyfR/2o2HPpXFgBgfhyQAOAjBgBfBUoEyAzg+goAov8QAHgHBv6vpwCkAQNdAm399xf5DqTbP/+TuR9v2L/F21UBAmzJ//Jif9M//g4uAzr+OwF4Q4YDyB/qD0vE+R9vW4B+U4NgkQO4/z82FYGqA0jY3HYAFf+z1yVAk5+BrGuA2vLPj07sf9MdHR1/HI6LOYBKAFqsri9JgMKAIoDKQKL/zAD4XGANYNoBwPxPAMhr4JAA/BaMHgLOCQBnAPD//0EDkBQAAgAeCgDuBGCfyj8s41UZMP+zgbdZxf9Y3gOU/E/93xEg3SIA7O8ZsFQA3s3zP5bs7/4fRQH5fvM/+M0rvyoR+Ffov5aACQD5DsBT9+Zd0JkCBDZjyf8+/U+tAAmtAmD6n8z/F/36+F4v7ejomEZB/uuLQwM4kv2/5/4f+D9P/+Afvgf98wGL5USA0UtAbQYQLwGAcUsA40jAwf9bdlgCEPmzoP8YAWslgJfslQCY/3G3/9gxoRIAWQgAKQI3KQA2SMDB/my0gMoNqB+zBiD6bwWAdOKAQPVHk8BOAJL7nxsKQDUDkNV/XCaY+sGRCYBR9H9e8P8dJ3X1t6OjYxoZwAUWgXHjYnmu1Tj2PccBsgAZ9F/DACOXgC4bMoC17gFNDTguAvqJWoD+f/auGLWtKAhCnBPkEL5CbhBSOqBC/wQJ6RJw4QsEFxGEgAtDSKHCFgiMSyUY8wuLSIEfS8W/T2ZmR8tDVhEp7Zvd/dIJZt/u7L53/hUZ4IIpIDtAGgBy+7+cAc0KIC4Cgi03l0AISf/FCoBuAvL5H+ECQPTfL2gk/95rAHELXBftHyM2gHX4N3INmK0fRErAPPzHBgCvAEUGuAL3QweAfTNG9LIBlBvAxQwQDdjif+PlyS2G/5/Vkb+Kiop/BRIAK4ASov2hmB+kT/pvYGB/AsyPYAqwCvBfIjAfgnwb7wC81xKAJQAPAKUATFzj8B8SwJTtf3g8BTaDFwOgMMMzQJkCZOJ/sb9P/48I8z8jt4D73i0gbQAQ5H9ZPgXmCoB2VyjAre8BBVo6D/8QApQCAOz/CqT/0IBHsM0OmFzsX1QARraAnvA/hn8+vDiq0z8VdQ+gYr8KQItgiYbG47+++Ij7GyeAN7CBUoB2AWDSAI4PSAAqAMoM4DUwCgAkf8TnoH8XAKT/MQuA6YQpQChGQMsUsBT/L7cGQPlHcP+H4REgPwbj9n8PlwDcB/9rBaB76KQBZw0wX4v+52tEKAAWAMD9bXuLNNBaANAQKOPGIrB2gIVUgEew3AIg2P038iGYLf4vl79OftWr/yv2Rn0PoE4BsQWUInADE/HLwPyDBj4A/APuh1MHCBEAdlgF4A4Q2D+fAoOfnWkLODJAzgAJbP+T/pkAxiwB3AF6yv6E2d/4nTvAVn/xDe6PAPsTC3i/6heybiMB/KFzAkhRrgHQHuZzj4DSBPZ/Wg+BhgrgGSDiSisAX/IeCOGTWkDZASo1AMYODXhL/f24fl5PYRUVFfvhiC2gV8Ps9/vcP1QqAPQZ0FwCKDQJOnitaaDDKoDGbwHw/G8J4FQSgCqAmAA9F/nTL7+rBBhrBWyq+R/RvzC7h8+Ee9D/jilQrwBsdYBE/T9XjzD6Arbq8ZUE3ME7pQAJAGB+RLEFwAWAtXKARYA7hegfBQC5X2lAA0CaAELEDjBC7R+3gJADfPiHJ/0XN0Dws0sC1vHfCvBNvfqtoqJif1gEDjSyoYifvyoAELZiDEjOPQAYK4DjfSsA8H88Bska4B3O/3Cc/0+1BKYekPj/AiH6v0YFcDkdw+IVgB+TyV/2vu436/PKdgzNyclErU6rSq2O5jLKBRoQlcrdROf23CBVci8G3hjGuP7AVV5EhCu9FhIjFKFc0BGKhHQyqnxRCbhAyqHcEHQIWJNQyzEksQ0+GGNqvsw50/R/mLXWs97N43dGo75OCHa6197PY3cu5gtY+2Pt/fyqGSBj2o8ASQKuCwCT/0J0gIwvJABoDQBg/u8CAPR/GwaoAPjMMoBbQFgCm0UEmLMAANcrEK4BmPdP8oj/ZdgCZgeIcAtI4P6vnwFyAfAOj+Dmjy49A2co/3f7Bw5w9yuf/kkkEl3LNlslAsfYpysAsP7fi/kVAuhgf3hgN414o90C+uH6NIDhURi3AMbglQYAswQQQ6Dvc/5fJQC4/zI1YPI/0n+aaoCPOlpAH82b/x0CQgGg/0tx5/9u/0gDuK0ZIPy4aUj/vYnLawAeAppl+wc6sBtAgAoAGNlfM0DI/idxUAK4AhCwB8A50FgCUAUAGdgBwBpAXQB4ACi+BMO3f2jCB99LjTCRanJi/VNAfy/2dwGAzF8BQLQv/tfPiv7hPF4GWL8ITAVYGjAFANE/JQA/AnH6NPJ/CcAqALgDoAFQ3GB+KcDC1atif0sAVQPIiO4P3R0gQdQfW2CcAKoqAOb/cLA/rcDkH2vAMOf/7v/oXGAEACbdAcLRI3CACwC9AgQw/2+HALioH6ejAvCHAPwtYJq6/3CdX8zkhx8TiUT3iAqA/O8WECuAwv76Tx09oOB/mgdBFQB+2l0FsN0VQMn/RzUBdEgBQB8DeFYBTLACAP2fO4cpIPR/FAHU+/mt+f9DeMcO8DSOBkCNBdF/XQHEEOgXuGCqAMj9KgKU++MQon9rwHA3gMj++hQM6Z8XqF8xYEYSANifAoAmQJX/8ztgwf5aArMEQO6nBCyc6KR/Jf+4Iv/3E0BO/n+G7v/RfPkzkal74itVAHv04o/G/0n8NRQC+tgBCv4PHYB4wxVAtwFA/C8BeHgE3R9/DV4dIEvA2gErEgCABQBtALABdJkBwAoAngCCBfsDbgDB5mMCaKHw/0JdATAGgPtdAEQIuA1oBPSmYfq/Wef/YP9ZUD+PVIDC/wIigEKA/FIxhAGvgflDkHwF1AGAGjBhDQBet4CoAbgAgJP/rf4iBnD3azKHPxOJxFetACT8qgQIxO994H5cUQGEFkywAnj9p+uoADwERJQZUEsAVABM/qe1AyD6x9EGgPo/6v7wCJH+QwRm8o8T/X/iU1YAHRqAZ4CY+eOHtsBobP7gEjwD9BkOx3+ET2izMDg0AFA/NQDBDSDOgE5Niv0jBAgfxENwMAP8HxpAxwyoH4ED4kuQQnT/NfzzVqb/iY2ALVkAbOopIJJ/NfgZvZ828/fu+XkfWb9XlxSAeA/oK1UAwyOgf0oAwjG1gN7VFKifgZtgAJhQBeAGkDpAYn9dHP4sHwG2/lvO/EfB/7QFeM3+whfFiH/xAoADgOmfsAKA5L9SAaj/gvjhRuwBz+BMTV2oCwAoAM7/owekFQDRv/aAC044AgheAybqHQAO/4T4u3fqlVzBSSQSX7UC2LdHS1+dqCoAOK3PQWA3vRaBf7r+FpA04IKiABwvj0CcRAnQloDPnX/fLSBFAJO/1wBiBjQUgHoHAE4TFuo9YKb+9yABewaIISDSf3SAYMJnGgLqGAJl/k/69zKYQwDYH6D4C+7HQQy4JGgFWDilAkD0D6/yf171Cli1BFbn/6J/OPAO0v/v5N/gRCKxfvxNCQDWfI19vvrgPDR3gBwDdveqDCDUAnq9qwDw2va+8jV45f8AuL9IwH4H+r2TagJNTLzPEkBLAOJ/DH+C/ml0TYFaAAD9g/tpyv/ZAYIvwKgAAKwB4PoSgBADoL5v07wFDNykOwAYCAPs/nwG+scU0CxuMP9suwZg/g+bnMIIKLJ/nslYBFMHKDQAgY9AnIkIYAHA/A839/P8Ej9wFfp3AfDmD3L4J5FIfB0VQMi9gX379uwvYaCPgQBx4OeIATTyv3x3726hWw1giwNASACYAWoiAMAdACABEx4CPacSgCIwAoCegbh8/neXr7WHQEsLaFoH3G+oBbQQRcDCArpA4P/PWQG0IeLX7QAg4v8Cx/wv3LkZ9K/snyKA3NyP9N+Yuc4Q4D0AG/YAznoOiPP/SP/ZBPrglBSA+hUgIdaAjxoKAGL/Kv3n8M+JV7/eEY4cEcnRmvzz/QuuAOr+zz64DngfZmcNoOxfB9k/IoBbQK+/3m0F8EbfAW4BAyMjoyPeAcMMkAMAuz805P/s/6MBBCP9Y/+LG2BWAK6hAEAFcFUiwNVp5P50aMBwzQCV/B8VALEAq+lf7gJATaAYAsJ90xFA7I9LPSByv6AdALtigCRgvwU3ySLgAu8L1SIw03/jDBARQDhh+q+HQL3/FQKAuv8wDv8M/O/87ksikfjK6IkAsCYEwNro29e3f08f4AjQpxCgHpDxPx0Auq4A9CWYkab4v0UNuMU14JMYAiX7YwbI/A8JmFD2/zsecj8g/pcKPA370AIALkSA+dgBkAhsDeBzSwBRAdyDBGD+9wRo5P9GtQZGb48A8RW4WdM/YBEAxqfgwP8UACgFaAjUS8A4ZwxtAZ/pLABCBCD/e/wz+F9Q++cMX/7JFDiRSHxVWATuyP/36YD49+zbD+oX+2McCLdDAN0toO4rAAWAA/4WpIeA1AE6Xh6CA/3HCgD9PDQASQBQAJj5X8ZLQG4AsQAoD8BRB4CV9s9H9QpYVAA4IQAUoxu3adwElgbsRbA7fAioZn8dOI7egYYLV3gIjYECFygEXLqgCKA9sLPs/uiY/UMEjh2AzodAAzH9Q/4f+MFLyfyJ/ONKfA1/MltCBK7Tf97I/IsOzF/6AM8A9e6BSQGAE71vrKMC6B3US3BEVABlD1gaMNJ/RIEJ7wCcwzkfCjD4v42rlgA+qgWAeX4KABIwTOm/Wj++6ncgaIa3wFQAGGT/UgHc+cwoGoD8OgwaAMxg+39GCgD4H9RPA/vznJW5AKB5CkhbYNVD0Gs/BRzzP+J/5f44/OzXq/kvLrHB0JN/Hzd3BWAFmDk/jjQASQDEfvd/cCMEOArQrQKsfwrIQ0B6BxQ4VjpA0oCd/rsFdM7vQLMDVHYArpn/tQU8Xbo/7RJgGvxvoP/vV0Bx9CP6/27/wwX3f3DU/+G1ZgZoFvy/qCEgGCKACoAAl8BmtAMgAQB2aRLwFhjoP74EI2f2X1UAgTX5vxTgXyr9N//r3f+XEEJz+j+RSHyNGkCB1d/9TP77+vbt36MgsB8Xwcy/T+YY0K4AdnVVAfSoAnD+3yTGCIUAAAqwNGDl/+dgoH+owGj/wBEB1AJyCKAEzAAgI/VPuwM0jxgA7q+3wEz/cOPeF/e+MFwCoAa46RDg/r+aQO4A0cn/dm0B1BHAr0BcQAxQC0gywNlYBCD0CpBaQAoAbQT9ewWsEoF/yfRfUPo/hfR/a36BKZFIfP0awP79e2D78AuEX/X+96v/I5RZUMYBwPzfaw1g1+vrqQD4Digl4EMhAqsAeFcSMB+BxhrAOYUAPwSE9P+yW0DR/8Ep/R9NAEUDiB0g3CZ+bwEvwMz9cErALAJCAoAbigBLN++wAQQTmP3j0HhdpwVmyhrYFBUAVABTqgBwyhIA4CGgM7DyECitXgHggQLgFQAXABz+3PtM/X1n8aX8C5tIJJ5HBeAYAAf770P+DyACHEAkoPfuIfmrDYSfoH81gawBrK8FhBnQ5iFLAMf8ENBxDYFqA+C0H4JW/l8pwJoCwgAQvcwAIfdHDaAGEAeAYgRIuT8O1V+pAJ93bgGEBAyv+N+LwNVb0LM40n7bXSDS/xxOgd8BxUHuT2gJAC76pwIQTaCYAjXqh4CO1mOgAIZ/3mzT/5tTr6ZGmEg1OfGcKoA+ZP7aACvUvw+nKAAHYGL/Pb19P+8F+7sMsBS8/fVd3e8BUADwGvAh7oHpIVDQ/3EPAU1QAzgHE/9LAsYWgGOA+j9XaRQBptUAUg0AcwEA9peZ/83+1QwQ2/8oAeBC5P/+Fgzzf1lowFwBaz8EB5vTW6BEvAQ9oxBgEQDuLWBPgQb9nwL388CBagR07acg3f03/+Pht0z/E4nE1wpPAYH2Nf7TxwoAdUAfTA4gGigICIoDSv/7rAJrD2BdLSCFAFcAx1rA8bIF4EfgtAB8ThWA1oD1HbBrCADXtAFGXPUSMKn/Q78CxAAQD0H8/pn4qzLAY6D3Sgww+Xe0gMD/S64AvAV8h+zvVWAVAbM412tQAZjRFvAUmJ9+SQFA8B6wn4Ewgv9pMQIaO8D6BqS7P/r446VXM0lLZOqeeB4VwP4yAYTOD91wFED6Dzf32xUDhN2sANYTACgCawKI/A/yH1MFwIfgKAH7U8AcAIUCYID7ASsAH17jDpimgJz661L/x/QPBcAvQMA+B/1XO2D3ovkTHaBl0z8PuN97AJ/FHoB2AIr9H9B/HQJUAEgDjghwCTEAl0dAz9LP1PT/Hz8DdLQaAkX6bzD9/05+9TeR9J/oFlv+TA1gHw0VAEoAh4ADe/pM/wRuwRGgV2c33FNA3QYAFgCOAIf0ClBpAh0D/fMV0NOeAfIOQCkAfisFQAUADVHAQ6DSgHmU/ftLMLEETAP906kCg/txKAHbXQDUWLpd+j+gf4nAszLl/jTPgAZmEAFA/6oAXABcwh2fAoBZA3YTyBpwHQHiESBda+j/zclX8y9yYgPz9paML5u7AthHCYD8D3Puz95PiQDi/17+6IVJAMYvUQBQBO6+AhjVxwD0DkQJAADoHzsA5UuQfAVC7R/yv/Bb7P86/YcEoFeApAFL/qXBGQBKATAvASB2gD8vDaCCe9UacCf/36QtMfmnmf+tASMImP8/WVMAIPmfuS7+VwHgBQDc+FErAHCB7G+4AVTMIaCT/0+w+9+T/76SdxOJ5/IYHMVf5PvAvgP7DzAC4ID6ebkDxCtACQBGIABsX2cA0BbAIT8E53eAjoP+OQU6Afp39o9DoP9znh0g0z/sqgsAiMDRAao+BmYBmPY5XD9E/zIwv7tAy+R/nsL/hAWANv0vsgEEkwDA6zp+RvIvXAGY/1+xAAzu5xRoDAERnfxvkP9jCaBAL//gkP73zr36V9n+SSQSzysA7N6/bx/FXyX/coSBAzx98LX0rxIAbuyG4b9D9y2g0eFh5v+H9ClIsn+ZAkIJwAgA+n9PGjDYH0UAcLnUAFEAIABYAiD928D9834GQntgRQDGVb4CsCC3ABzZP0PAivnfEjCtFABB/58gAgDSf+fI/rNz12Hu/5RnIADPgIL7XQB8oB0AHrV/iPohoOoRuBgDehuz/3vb6f/b+dXHRCLxfAMA5/8PhPx7ACb6hwEWAnB6+xoOAbjF/ztcAXT9Gij4fzgqAL4Dd6zll+D0ITDNAPG4AOAKGIzcf1kSgEdAYdMFkgEAcL9cHSC/AOciQFD6zzXgQv/LMKX/y5UAgCbQ0pI0ABgiwOIn7P9I/kUIwDUXOwAzdIQA8H9owOR+LYIJigFERf/xKRi4oQBAAeCXe0v7502s/u6die5/J/J7ANkryv89E19TBcBFX6f/CgB20T9A/m/0NRgLGiUC9DZwiO0IAOupAMD+I3wHtKkCgP0foGyBTWAFbMICAL8F6QhA+gdCBCb7u/8j54Xcnx0gSQALCzH/DyAE4DgEeA/43rJiQC0BLFEABv+jArgTD8Ex+ceR+ouDBQBcHv+xCDxD/ueZlAbcNkLpv1APAcUmsCuAtgSAz75H9//MD17Kf1yJROL5BgD2/vc4+7eT9OEwonGgH7+K/uGMAYoAHgR6/fXXuq4ARodRAxyKAIAVABw0gLwGUJ6BcP/HD4HGE0Akfx2HAM+BVs9AAAvwdgWAW82fB1EDgPzd/qevaAlgBcl/LQKXJbBF0D+6QNUMEH4w/XcDiO4PAQDYAiNcAUzyUwAeAup4Bs6oh0CPwqX+wjX7P/PKxkz3MiQlEt+qAIBvvjj352X6Nxq6+ooDuEj+FgJ27F5fBWAJ2Aow6B8HAcAtIEBvAKkGENwBcgEg6jf/l+6/ngHVAphsYZ7MD9NF2ncIKCNAMf+5LLtNA7QCtrTkIVD1f+CzLgAUAeY+mUP2D69FYCkA2AOGUQRQ6u9bU0COAFUF0DEDakT7Zy8e/zz1g6356Fsie0CJ5/kn4xbQfj3/4xDg5g9voQGTDNyA6WIBAPMUUHcVQI8rgOaoWkBwLQEfVwWgh0D5GRg0gFgBGBgA5SNwav7EIxBSgdX90TWPKAAN2CIAt8BUAYD4bXR3gMT/4v54B2hF/F8Ocn84+d81ACWAMgM6h0vkPydTATBjDZi44goAuOAlYEsAUQDwigBQSwBHlf7DOPs/l7P/ic3C2z0ZRzZ5C8jz/2b8/VKAB3EalgHwkxqA2R8lAEKAsKO36wogAgCXAARKAFCAFQCA909rBQyOEuCfPQRU+F8xgHD+7yUAlAA88wgB4v9P5/0ENDxyfwLkz4dAIQGb/pdvhwbABhBLgKIAwEz/XgIQyP4IAmUIKERg8L80APR/4Jr/gU2218DoZH+cUAAKgvyJt/e+ubfd/vnNH/Pln0Qi8ZzR4wDg4U8a+H/wAICLaAyC/PsVAsj/6gNJAmiwBlAFsKubCmCLAkBjVFOg/hYkNQA9Ba0I4AqA+f/F86b/2AG4qgP6h0/jBv/HFjDpPx6CI/3LvAD2aVUBAKUJtGwJgOn/iuhfI0BeA2sXAFoA4zCo2B9rYHMdWwB6CE640NaA6b5iCyBg9qeFBsz2DxpAez37n2/+JxKJ5452ANCrz87/6x+D8EEVAMX6YAR+9AoMAN0tgjkAUAKQBhAiML8Fc1oKMNi/rAEI0H+pAXj+xxKADgoAsb/6/+gChQSgDtCnon/ap8j/LQFoB8z0D4OHBLCEcxP30p07S5oBhSsEzBrSASQAzNlmaPQrUzCqwIK/BxY1AGHurz8GEGvASP/Z/vf8z9ns/icSieeKnggAb+yulr9gwCBPo7C/fkcJ4Dqgv7/MATVkagHt2tWNBrD1h7u2IQC4BdRyADiJGoASMMAJIPd/2gWAG0AyKQDXQP/if7jwe/j8vCKACgDAJYBSf517/hAYQPaXCnAbZ2UZ+T8MBYBEYPy4QxXAIsAs3O9AaAkMhiBQ7wEoAEgAQBAoESCGQGMICBYxQE2g+BgwHPTP/J/p/8DdGP4J9OQeQGqg+X9/4nlVAGB+5f84AZK/aB82iBMlAL3R20/+X38FMDxafQzyeNkBoAZwml8C0wgQ8384APqHw7wBZqD/44eAsADMEKAIAFvQDGhN/w/g/OWeR0Bpy8tfwCUCxAYYLb4E8FnpALkAwDCokn+RP9ifTvlXs6ASAa6UFhA/A4Ob5ghwNgKANWAj1oCPDuzdi96P8MH38l9TIpH4RtCjCqB0/nUHBumDcABpP/5jBIF+N4IYArqvALaUFpA1YBcA7AG9C/rHEBD53xKwoQZQRwcI1A8NwPM/+MEFMG2AyTUAZAEgmv8PWAI4ANDZApIGjOMtMPgSfAnJvysASgA04BO483/zPzBD0xqwJAC3gEr7/0JnB8hPQIQGUPL/o2+D/r3+tXfulfxLmUgkvrEKYNeu3Zzz4ccf/z3598OG8XAnf+F/ub+vv0H+JzwJ2ui6AtjOAOAtAFcA+hYAA8Dp0+7+vw9vB4Dgfy2Aof9DkP+9BsZHgPQKxLx3gH9P+if7Fxf961gAhlkBWIYALPpfYfIP+r+NG0tg4n/44qJLAM8BqQiY0yIY2X9qBjd+XJlRAwhWvQUknK2egi6IAFCA7j/7P+L/Ez/Iv5GJTYecWNi03bket4BgIfvSiNIEAvHDEACgCTT6+/sb+IEY0Lv+CkABAO9AAGUEqEX6RwsIOK0WEDcAQgPABJC3gN3/F6Y1CBr9f+T/QIkAkgAsAqv7L+Lnb34GVAoAzzIrAO4Bw0H8lH+X4LfvEJ/RgCD/sgcmBZiYA0j+MH8MrOyBwRkAqgJACPbHIfsXCcDpf3n9bWDulfz3lUgNIPENawAe9jcs/eL0w8j85ZcDNgoBX7kCaALK/nHA//4WGPkfCnDV/79Mv+YhoLXpvwRgfQtYr4DiEvvb2P9h9i8JAIY7poBg4H4cuIZA4ZQA7nAEtIwAeQoI6b/pHwtgUQCUFlDVAZrBHjDgNQBPgMKrAFA9BGEo/f8F+Z8Hwz/f25r/lBKJxDeHrdIAQv6t2N8YbQyOIhIMD/fjNhoEb0WARvcVwDZXAAoA6gDBTwKIAFYAzsPB/V4D9hDoVcSAD2MPjDHgQ9I/j9J/XO4BfeoSoF4Bg9NUAMBhVICZ/6+UDpBaQHAUASB/wHtgegdiUQWAFgGY+tPU/tF1RQHgikRg4VLMAHUMgcriQwBI/9X/x8ufAw9fSfpPZDGR/y94ARVA8L/bP7wF0j9lgH5YqQIagyB/GBAVwLbXuqsAtrkCABQAWuj/aAkMAYAVQHwIgP1/HIQA0D9wlRUA72mY+F/gBrC/BTwPAUAhoNA/nPagWCyBif8BjYCq/yP2Rw1wkz0gFAEhAcxCBRYWccD+ZReMk0Az6gDhAOoAxSIw3BGAa8BnogAIHRjAfRTpv8Z/+PLP9/LvYiKR+KYDwPbXEACQ9xsif+f+TVyDeLe/fxQ/+2n9OBACigxA7Gh0XQFsdQAAOADUakkCkASsCmAC9P/Pa1pA+AQAC4Ay/w/HEf3DAT8ChFsqgGIAF8EsAFv71WX6Xy78z4slwMoK838cxoA7cLSAXADAKQPXIgCCgN6BgGsAlO4QAHMECP6PJQAcFwBt/v+1038EAKT/OfyTSGQB8AIqgNe2727zv3N/oKm70TygAaDB/lE2gRgBGooAOI1QgbeD/3etswJoAez/SAIA/7/nISC2gC6ev3i5aACQgKMCcAEgIz4qzK8RINjCPNkfYAQA6/OS3dOJGGAJ+LYFgBWYKoAlwBNAMQU0azDxR/8HNxDz/3wKCKYKgCd2ACZdATgERAFQ8M6A6B8FALv/+dmvRCLxjaNHFQBon4jBf9+jkoHxag/4Hz0ggCHA9O8I4ApgV5cagAOAKgD3/98NCUCvgEoCkP3OU6DO/iv+N+bhDAOAp0DF/5j/gXkBIKyuAIDbK8sgf2rAbP7zlOSfDgUYmA0VGAD/z8LI/zgzFoFn/BKoxkCFUIBDAg72P6Mt4KOl+wNn+p9f/U1k6p54US0g8X9nCTBKUwdouIkDD/oH+fMidqxfAxiLAHASe8CaAcUimDVgRwC6FGBADSAd8z8cBYCeAC3sLzgC+BlQmto/zv6jAPAagJ6B8AyoNsBwDH0NkhHAmIPHJjDOjPlfFYBFgGffBDYsAUcI4FH6T2j4Zyq7/8kn+ceVeAEbGgoAuxgA2iWAAeIfxo/hQbA+CoDB5vAIS4BGEzEAvzSiB8R9AL4Gum0dAeCQFOD4GPxJ7YFRAWhvAFzUEgDSf0kAjADEDVhHAeDePzxaQFYAov8TJv5fVghYWVH3Z6W0gBABOAIkCfgzlwAsAqwCewSU4z+6tAQg4Cezf6FO/+shoKoBBD86YPr/u5+99fiV/PeVSP5PvLAKQBoAHFeA679wkD+5v79/RF2gJn5rSgKgtVXgdVYAZQLoGAKAWkD+Fgzyf0cAzwBhAkgVgFYA/AoEIoDxkcZ/dOgL7AC5/w/TCpgjAKj/gdN/9YCkACMIcAnY/E9wAQAXuB/8HwJwYM5ToB4DlbX3AKpFYKDjJVBHAB6ovwMe/3lzKrv/iUTiBQaA17dbA4jxn8GmAgB+cP5HIWB0ZARBgAgNYKhhbN+2q5sKYEtHC+g4UHYAwP8TjACgf+f/4n9UAM+GQKdZAkT/RwVAqQD0CjRdE0Dw2AKm/ovUPzRgLwGv4MalGSAgdgAsAjAGQADWIGjQv3VgwFtggK6qALgE/4/3AH4DOxPtH8z+v/Pw5cyeEonEiwwA0gAGYWB8uDAK6RfT/9IAhkeGR0ZH1ARCNHgWBQp2KAC81v0msL8G3NI70K4AKAL7MwDO/6+dv4YdAIWAq9eq/v+NsgQwDxP5R/6Pi2AJ8MBLwKJ+uLBcjOS/vOL8Hz+XCHK/rlICMAKY/kMEoAisEAD+hwjsj0HO+CU4t4CESRcA5n/j12+B/+EUgGey+59IJF58C6jCgeaBJjUApP6jo6Mgff5sMgL0owoQhiQCDMFA/43+7du2IQD0/Lndwp5nLSA9A9TCDCjYnxLABEoABgAm/7EEoD0AQB2gG9NFA7ihCuAWIgBNiBlQOGDx13n/g3uIAxEBjBUY2F8awBJjANmfJkgA4CPQn1UhgCYBIMZAhSlrwB4CDXS2gH59dAAo7Z/Df3wp3+tPJBIbIAC4/zMKcwEwOIrkH95EGJACMILsn07ux1lbAazjLSC9AnTsWIvfgiSU/3MNzPM/Fy+evwxoCPRaNQRK/g8E/WP/t87/P33ACkARAAb+r0eASgi4TecEKIwRQLhjgPxxmP/HBvBdfQaYJYBnQAF9B8D9n0l4xwRQ57dg3nkb7C/8j5/N5EffE4nEi98DeIMVQAgAMLn4n50f5v8wBgCFgCE4FIChBo1QBdC1COyHoIGTx5j9w6kBvKdPgYUAoAgQCsA0/AYsdoDp0QCiaQhUCP4X8+MylmleAnAPKDpAzP6NRXgRgRed+wuF/ksHiKYYECHAEUDM7whQzwC9Bfpvp/+PX968f2eyXkgkviWIAFA0gFFxPxwi8Chu0P9IExGgnxEANgTmZxOowRaQ0b0GEC0gpv+WgE+qAHifFYBfAYIj92cAUAEAw/gPgAhwa80KmCsALYERfgaUIQAWCwD4UbeAvmDmv+yHIODmf17SgGdJ/zhrJACYloG1B1BegQOmjH+/BAAT/eP69dul+zOA7j9m/3vyiedEzoEmXnQF4CkgEL/uYd1I/5tcASsRALl/c6jJ3B+/4TAMNFQCADvWXwG0/BBo4X9GgPfdAkL3h8aHoPkQkAsA0P+0zjRgaPjfFQAN7E+4A0QFAO3/qgbwQ9C4V4oEoPa/R0CLOf2Hi/5RAtwl9esw+/fRM3AuAaoCIMZ/cKqXgH5Tuv9wfPbl8cv5Ny+R/J/YKJvA8fgDbRiH7Z9RDn+ONp+1f4ZGhkZYAYj/iwq8s7f7CuDHawJA+1NgfAcIBYDWgAm/AuEdsGvVBjBx9VYpAKIDVCZAjc9x3P4n9SsCVBIwXCsAK1YAlmDg/0eUAOBAHQKsAeim+R04PAZqDXhqptYAPP9TFwDwdwaIXwxw+Ce7/4lEYkNgi0Xg6P5z/t/8L/23OTJCBQBhYKjZ5ByQ+V9GWAP48ToqAHeA9C14dYDeQwSQBnwRyT8gERgFAMEdAO8AqwTwp4CnY/6HFgpALAGzAOjUAAjtAfgdIPK/CoBaA17EkQRsaP7nLtmfMSA+BRNDQH4ILjQABwCB3f+BXw7sVfr/Zc7+Z0qZSGyUCmAbK4DRmP7XGST19482Mfcv9h8aaZL7m0NDI7iAfromgXaurwIg/wNQgMn/oH/4BKCXIMo7oADIH5fA8U8Mf94C+VMDkM8LUgDE/4EHbv+D/MstdM6A0qUBiP8feQ/gziPcj1kBCOwAuQBgJ+jZGOgMYQWAx+wPr0oABILJD06A/wEO/+x9mLP/iURiAwWA7b2c/mf2Pzxo7h/mBW+O0EoBMEIdYGQIEPnrgP4bQ11WAFsUAFpjsHYFAEx4D9gSgCXgKADYAaICPO38/1bnEsACvY4AEADobv4YEQJW6GZ/8v9K4f+lxwgAZH/yfz0GyiBAE67zKhUANeD4HKS/BuwSwG+BTp4p9K/u/6mnL31bU/SeTOgTic0ZAJT/c/IfGGQB0GwONkH/oyMkfx4m/iB/3NACeA89E4F3rE8DsAJwTAUA+H8CEeDcRMn/zf4kf3wKADD/g/zN/2D/WyZ/67/0+5H/wzX8zx/EE/oTsn9UAJ4AYgCAowS4I/ZHEFgk/fNIBhb938U1F9+CIf0DsQQcEnDk/1EAOP1n+2dgLrv/iURigwWA3Vz7kinvH8Q1zN8k/zYBVAGHcEbUAooekCoAawDb1lEBAKB/FgAUgcsW2IQ6QBdB/hc1BEojblxDB2jaKwC3YF4BgDsCQAcwHuj6HOYBIF6BqgNELOksEY+d/OtepM2C/qshIEaAAtA/juAPwnd+CMAH6q/A2f+zj9YM/+QeQCJVm8SGCABI/4HmKDcBRP604aZ7QENtG+Et9jeoAbAC6EoEdgBQBWAJmHhvjQIAwwbAx3oFunSA+AwcY4Dyf1zm/8j/YYTZf4Hdf9YAOMITtX9Wl3VWaHDCI0CwO9IAgv7pigHK/3HE/7MeAm33/6MFFCGAsAp86q3g/7ceZ/qfSPpPbEgNYHBYQQDkT1cDaGQEB1ZwCP95iFYqgAZ8nRVATwkApQDgDKh7QJgBiocgrAE7/2cA4AtAYn8VALduuQIwavp/AIMz+6fjQu/HMaBWAGoNYIUNIDhQKwDVIjDT/1nTP45fggP1xxRoPAQUOOP2D1e/Jp9+lfQ/l8YSG5m3ezJubP4KgNwP463xH0D9f/D9oeYh5/+k/xrtCmBb1xWAXwJlALAGIA1Y9F/Y3zvA5H90gJD/K/vHCf3XBcB9sT9/CtR/WQR4ACgkgHgGoqb/R2R/ulpASyUELKoGgLsDBMypBeQQMAP+h0URUCkAMhQATv8Fpf/51z2RSGxYDWDYrR/sAKv5007/wf64UAGMIQrgp7tApn/4OiuAsdgC8ztwrADOARe1BgzHBCjoXwD/M/+Hmf5xzdcasPXfqAAkAMDI/Q/A/cYq+H91xRIA3BKwJoBwMfvHQQCACQoBd9X6uUsnLAMLU7pCBb4EJzz8WSLA3/3s0tOX8m9apoaJxIb7l+QAMAwf1uBne/wT0A/R/8gYqF+FQI2dQzu9CLaOCoBAB8gNIBjpX09BSwTWG6CEJeAbN67i3AKm6fOE7tgBuw8D98uAe3AanHhSRIAny8Cq+f8RDL4EgwRw57ECgLAI8HIBIPIH+8MJCcARAdaMANFE/6cOR/t/4I/Z/U8kEhsvMlgD0O4X+z5qADUZBQwk/GO0sTHn/WM4ARUAQ+sOAJaAuQc8gQDwvkKARkDhRIwAlU8ACJKAoQHAqwWA+6UKeFAqADwDgRMlgGwZv/AViNUYAhIe6fIimNJ/XIu4FwUpwFoAw4W7CMB1/8fwQ0A0lAHo/r/1luj/zb2Xvty64RPonszZE/mH/5e7B1BeAGqK+2UVFALA/IcOjQ2N4ZcjdQ3AALBj3RUA+j9wFQDsALULgJr93QCCTcNuWQGehwiMI9y/T/4HogBABDD/P3mmADxh/2cVEQDXUwaA4H9NALECIPvTlfw/xGH3hyrwXUAlgEIA9V9YTf8dXwM+BfaHMf0/nMM/iURig6JHAYCD/zAtAcPc/ZEAMDQGDPHwPqISoDVEHGzsZAmw/haQXoIWxP844H9tAYj+zzMCfPzsFYgb7P3QkP2L/XWc/8Nxgfp5yhQoTJf4HxcP83+elVW2gJ4WAUARQBqAO0CLjxcDIH6auP8u83/ZjNGZ/4v+o/sP/r/wpxfT/e/JBC6RRUCiiwoAvR8ZJQDhkK6xZhUChhgBDg4NwXXtbOzsvgL44Q5XAOZ/C8C1BCwFIB4BgvMZIG0AyEH9kf/Pg/otADv554nuP9s/nP9ZVQFQOkBif9G/VABHAOb/a2qA0ADYAsLtNbDS/7neEQCc/+Ocegf5vyIAhn9eyb9hiaT/xAvDlj/vKQhx/6Db/4bo/9AYgAstIKX/B8eOVPQ/xE2AdQUAzoAeqyKA1oAdAAi9Ay1cLfwv+peB/2HGQswA0a0APNCJFtCTVf4U+Yv+WQIAT0n9CAG4Sw+oPQQE/n+4tgBA++fuXUQBzwDVCvBaDZjDP+z/KP2f/P7X1f3fkv96ExsYWzK+bFa4BTSotz+tALj/M4YOEC7l/WNHxnDxF0UBGRAVQFebwL2lAggJ2EOgloDLGxDXinsHAFYEgDICFP2f+/BKASD7OwSwAIAx+yf7r6oK4BCQ2P/pMiw0gBXS/2OgrAA8fIwWEBz0TxXAIjBjQCkA4B4Cmur4FgC7/6L/t5n+/zHT/0QisRkCgFs/cuMQMn/SP57tBI7AEQOQ/rcK9/tu7OxeBG64AogA4AqAEkBIwDCovyUEENOKAAoBLgAcAdABqkVgzf+A/3nqAVDebgBJAnYLaAmXJAC1gDpEAHB/PAOHq+B6UYE7RGBgqqT/b+Mg/b/yo635tyuRyGR/EwQALn/hwo/AGI4aQAwCraHW2BGk/xAAIAHIDvLeiQjQdQD4rgJA/SUY9X9KA4gPAcUjcD/h/D8OQsAt0b+4f7oUAH9YQ/+8nf4L8QgEagDYKn5ZXYUQsMohIBgDwFM46P8RDnAHRQBCAFEiwMO7qgIK5nhUA9RLwHoLiPzPn5Po/hPs/rz1Zab/iURis7SAnPwHivbLMqA1hoPrCI0q8BGqwLKhfuyCHez2NdDvNvE/snXSAcAR4Fw1AwRcCzAAmP9hmv+H/YH8bw0Ydv/+g/sIAHBBBcATNoDoMKgAy0/M/zDwPhwXuP8pThGBH3MTbPExD4dABZYA6v7LDEUA938CM5dOHBb9I/3Pz74kMm1PbLIWULMDY8ZQC3k/R0DhLdD/waFWVADraQH99fFt23eMOQC8164AYBdZAVQNIFC/3DOgpH+YHPgD2V8zQCH/AlYAkPsXVwgA8z9BBCD5r3oP4OnyIwQBpv/K/8H/UoB1FAQekv55rAEDFgDq/D8weQb8L+zde/ZPL+e/+EQisakCAO+6ANCl7J/9n9aRI7gPHkEPqEX2l1EH7nYTeOt//Ztt27czAJQl4PIlSJoCwPmoAD7GcQeIJYB3wHDI/Y4ACwoBzv5lrgDoUQCsIgaoClhV/r9a0n+0gJD8cxBIBYBEAFUAj7kGxnP3IcifDu6XE9UrEOr96ED9FZD+v/X4e2sYMvcAEonExtYAOjpAY7BDJH84rXWkReKXEUO+0QHq39llBdDzHQaA5snoAE3EEKgUAADcjxAg+oeJ/W94BRgH9x/gloDJ/2J+3DX9k/nlCgKrq+R/XIwBKxwBgin7F/0Dpfkva0eAuzpM/bUIZoQGMAWUS+qvAPH3y5fzb1Uie0CJTfMYXK/nPw2//oPTGlLrv1UM8z+MAi1eIH80gFAC4Oo2AGz9MQJAIzSA0gEqSwCAO0ACyd8joCEAmP8L/TP3p6EAkAN1BfCM/aECr3oNeJUVAI0uAVgFgN+CWOT9cPHxQ4QAUD/PrARgWtB/lABO/w9H+v+fvPyQ3wNIJP8nNmoLCK713zoG6Ltd7dRfP9UDIlouAYa6DQB+C0KvAEkAKD0gzwDVb8DRtAQGj0dAqQCT/WlFAjb3LyzUAnChfpzVogEAuFgArCyT+iUBowUEYwDgIrD5n+SvCkCQAqDs3xpwhwaA8wG6/4cPl+7/j/Ld50QisbkCABi/HyfQogLQkgBwEAUAOkDwgywCcIP7YaJ/jgN1LwJv+W8NqMB8CQ6YsAZwER4VAPv/hAXgGAKdp8FRA9yXDPBMAWD3x7fT//IhMIUA2DIOLrr7/6ULZGAR7BFDwMPHOF4ElgIgEVgCgBUAWvC/hj8Pk/3d/c9kPZFIbLIWUEX9Y00aG/8F+O0gIsB4S/RP6h8/GBUA2B/WdQWAOdAdO1p+BCJaQDX9w8j+xi3wPzAtARgSsORfeOn/0O+jAMBp44lLgKgAOAF0T/wP+rcGrA5Qyf+5B4yj5s9DBIHFhyEBEEr+71YVQIDDP87/Bwb+14+y+59IJDZjBWCM6bSaFoALjuAcKzLAcUyBjqsE+NVBC8HdVwAcA9oxVLeAMAFaSwDAjY+lAZd3QCUBEJZ/76sCuK8D4gf161ow/asI8AZYuwIQGAKeqgMEPJIAwIPcXyKw2v+PGQAICcCz5v8YAeK5HiXA2RNI/xkBMP6/+Gr2cLNHnEhswgAw6h6Q83/IvywCgIMtYRx2/MgxNoCOjx8k+RtcBHMA6AJQgXc0XAHQuAPgLYCLHyP9hzH//wmz/6sSAG6Q/Z3+WwGACSJ/wHdh/9gBXrX8Gz9XRP8ruhAD2nhMPLzzkBpAkQDuwtstoFgEm/EU6BVFgA/I/+/gDPzDlT9l9z+RSGzyCqDlBpD4X/c4Xu1pjY8r/x9n/+c48/+WgoBmgdYRAHagB8QCYMJDQKT/KADU//+JygBBDSDzv9if6T/cGrBDQDUD9CR6QGB9VwCGCwA4DNk/HNAWgBYA+DnghwBCAAyPwbkFBI81MAPDPydE/0j//zG/+pglQ/6JJTZ5AGjB1P1pivzd/UHyP94KQwUwzhIAB9gpEfhvuwwA321t27G9OWENQAWA+f8iG0AqAOBmf5p6QPPwzgJgoc7/Tf9ifxh9lSYRmI4R0Ker1n9J/gYVYKm/OHfaLSBk/x4CjRYQyD9EgCms/hLs/sz96aUUfxOJxOb8HsDaAaCmt7+AcR19u2u8hfT/OGz8V7hYALgGWEcF8F+4CtbAFrAVAG8BA8j/9QaEd4Cn0QIC/Qt6AK4YagBivui/jgFB/1X+j7tsgDEGRAhQBfAIKkDEgDscAQKQ9msOCGAIoAFrQgBAEeDCqRMnEAFOQPw9++Urmzu96sn0LZHpf1YATdC+6B+/KAQcaR1jBDiCT7eMqwr4FWMAawDSvyuALjUAbwL87fYdxyfKGhhwkRWACwDA9K8THSC6vwFcVwAi/4WoAUz/EgAAtv4rARj0HxJwLIEh+/cQ6CIDgJ+Ceyj2lwJQYUY+N/VP/3hY+u8APvr7/a2Z/icSiU0eAFplAcBDoC2BEgA0gHHbwdb4r1QDwHgJbgF1g++eRAkwxPaP18A6lgAK9V/jA0AeApUAYKMGYFABgAMxAgSnaf+L9A/XCkA5fAZCU6Di/6dVD0go/B8a8GI1BRTNnzmk/+B+2OGBvXN/ynefE4nEt0MDcO/fOH6kBfZX45+J/7Hx4ywBSP264QfXVwF8h69B7DjJCEC0+z/sAH0MDZjjP6EAw4TYAFADiDFA5B/tn3+lP1EEMFaLAcu6nq7CCh7R6CJ/JP9wbQAUCRh+9yFHgGIPIHAX6f8psT9Wfw9/+f2/2prpfyKR2JRtu84KQJtguI3jaP7gAsaLIQSgBkAVgOsgDegiAPS0f/x4J2Tgg5oBJRAA4AwAlzED+jHoX67s3zD9uwMUiCHQ/68goDDA9F/df8UAY1n3U40BIfsX/Zv/iwCwCAHY7K8wcNcIBcAtoAv/hOY/6P/EwMDdH72cc/rZI87uff75bvoKwAIw+F/jn8I4XP0fuC6w/jgMToj/d0YA6Ap/XVYBvAUA8hcuqwJQBHD6HyGA7K/uD9wBwPwv5g/2B/f/K0xYpdHN/dYApAKQ/jv7P9oBhon+WQQYc8WEmbOnqP3CBk58+d38+5NIJDYveiIAtCdA6S3h2PFjOOOlAHh3HNn/u7+KGHBQEQDe5RSQ0fPfuQpwZKJoAFUHSF+CfNYA+r9t/lcHSNovIsD/c/+/bgCVKzSAegC0igDk/ugAPfojThGAEQJI/qb/eAqUN5P/wBSHf7j7+w8Dc0j//zLHMnpyvCSR+HZVAGM4rda/sXf9rk1FUZg0Haoi6GQpri6llPj3OIlQyOAg6C3tkscbwi1cylsEp4zOkk3o5uCgm4FoBmt+SMhLBf8Ev3PueSe3zyndGs53vvtWB9Pz4/vOfQ9U/zenYKAGODw8CUCghwjEwenfqQm8Fu4+jiOA7AAheAcUhAmMO8BAdIAFlf37ExSoBbAYl4kBDAq0+6fMzx5AdQtgXvN/wdkEpNRPj1GMmgUw+vI+63Yzdn9fXdlXHw0Gw+3V+HQCeJYoQJr/X+cn3P9z9vcqAOGcEhltxI0koMZWc+85RoB2T24BRHzqkwL0VVC/BSzbn7X8L70/iPMbAf1HJgAQkQ4Akv+nCHA5BXQFlExg6f8peATg9K9vg/t8Hnf/8eYHtP+2Z20w2O9zQyYAfQUEgtp/EP5vRyYA712e46D594gVMAGoBLQWGtEFOO0B3P+LBYwJIFkAElyC+hFgRdX+K0qo/zwClOIArDDn8wtH74DVHQD+CAyVABzeAQIZyP3giO5+Zd2M7n4VV/fs79dgMNx2bHEB0A0gNYCpBMABiI1/jhNy7+EEeEehChCOTgBrovkgxwhw9DZOAGoB8AQA1h3gAd3/xQG+XReAWAFC0i9FAirrS6Di//JDPQBq/0FVgL4j/c9YAcIZpRpQTP+jC7T/WdFF+/9yYp99MRgMm/Q9AFSAJP3nER1+ep+HgIcDg3f+zCVoOScewJpo7OweHhy22r2+fAxS87+m/+FgNQL85wCMETH9M1ABJPePqwKQYB4jYkqcEpfU/OsK0AQ1AEGQAUAB9f+8KLIig/v77q9d/TIYDBuBZAI4oSUgQd6pioCnCD44HwLnf+/dGWoACBy3nUwAa1+H2r6/ewAXoB0ngI9gVQGeigI0HFYG8OAS6Z8vAEsNWBDHFKL/l6T7lOkAsDIA5vzgSFeAELMY0QJWB3gyigcQD+BDAWRQgF50Zw+37VdjGpPB/n83awtIFKDaBpDP80DhfaA64AKSP7EqAO3jljvY339ygwLQaO4FVIBWp98XCQjZH1zdAB4OhuoADPQl0Kn+s6D0j8MTgKR/sGb/qv6T9P8iAV0fAIAfIgGBCuz+F93Y/188umM/d4PBsFH3AN6ICSwqEC8AsQGQ+xC8BuQf7wKKAAf6f0wAxzIBNNf/t3f2jg5RAXx/NQHoADAAgaEoQPoOiKT95wBI/Zf9H8EfrgB1CQgULKcgsJxN/7F3/a5xHFGY8xmTCGzsKuIwpImb4yL2/h41hlQuZDiMd0iVUyM8t8shFoawDqgJnIs0irtASBNEiqiJUhxyIzjnIu7H/g/53pu3c5uzwbAubC/vezNz6iw4+f34vvdmhAO6lJvgKPMPM2A4L7BOwf5A/x0eHQxWd1qakikUiiZVAPv8AHC1AKjwP2lKy9GBGGBjF1uHQiC2JQdket1enQDAnUB7wCMXxoAJlVcApAKQAHBVaf/BXlD+j71km1MBgBViQMX5r6vu/7U3YBVGAOQmCBEAWANmCeAvSf+J/TkefHP2xefqWRUKTTiaJQLvP+b03+f+IQDIELCEAIsD+b91HAG8+zfs/+M9poBqMOM32nf7PUQACMEbEbjyDsy0vAQIEgBXAICUAPIMsFwAxK4fFgSAt/H/IQSIAsAb/l8wk4fAyEoBGJ+nx6T+8svv63sf7lvU/72Kjxd6HXojKKBN+i8L5L/FwexPRgUAAoA4fwtLmAOKpAuonjS6e0Ik0KMXMgUAiALgnf90yvm/NABhAZ7/WZb8D8xzQMsgABS0tioArOu1EECwUgMWCuiSJAAYfH8QgV9h/zk+Zvd/dAD2X5t/FApFAwMAvwEg7l/y/yABI/tPrSwpAWypBJsYML4CaNf793dPvuYIgADAEaDvp8CmUgLwJUBvvQQiVACe+5kvtyqAEmtfAcgSCmhVnQHwkP5PqQAk/R8Ph6T/Dg7Q/KN/LEopKBTN1AC4B1QCQLX/x8O61Nlnz7I0s5l1ceKMTeJRQgWAAQXU69UMAMCNTtyLoijOmf/piwQA14/kH5vIn9ADKr6f2H984PQKMGyORQYUbIgAxWYGjFJ/OSn7X3EHEGwV3oEhm8ktoOz+8fOvE87/if3Bvc/6p6JQKJr4HsD+U+aA/BWg1QqAyZ+UtnNpBu/vbGaNI4tzmxhrTEwBoFuTAgLatzqOIoBJfulzCDj3mFIUCAIwwkAoABYcAwCvAGPB9Qv7E7pAvQi8hhWc++OnawaTP4Lg/bFmWBQC/EUQONH8w7NfR4OHE734TRN6hX6/ja0AZAiAfT8OD3j+QABlzqbOZTALSywsMQn7f0MaQC0RWK6Fu9l5sRcB9mW/Dw1AvP/U2xWXALgEoiIBSAMQDub/aUsEWEr6j1WCM/9/tysAn/9XJODLcgjgFR34+GMC/z8k/z+YafqvUCgaqwHsE/uD/VQCwHfs/6X9J3Wpy6zj5N/itDaH97cmx04oAogGcKt+8tDpcwQwP/UJcP+bFqArbE7/q4/AyBCAVABSAMyxKy1AxXb//1YHEPCPzAHA+4v7x8ZTwKgFziaU/o9p9GtS3NGU7H9otTSlVCiapAFIFyhn/9hASgZQ5o/lbOZ8/p9liaUKIM5HMdUARrqAEABq4+5uhBAQm+e/w/8DxP+fMwHk+X8c1eyfZQAygEuAudcAPArQP/MgAF+LBBBagFgBDhJwIIGCCIDPi1Py/+PhePhwuNb0X6F4F1oa7j/Rb2aXAwCXAFsjYAgAUgFYHwJgmc18AYCdmNxwBRARBXT/s/q/Y/vm7U6MXiBjUARMfQEQhsD+5hGA6gjYAu6f3wHAEv6n5P65/xMHPwWzfnMC+LocAZY7gFabFiBe4v7h/8n9Dw4utPdToX77nWhp4ffpdwGFGQAvAGDB/zvr0szBMgfY3OYOAcDmcP9uZPKRAdAF9NUDCQB1dYCdTj/iCPDDz8j/p5T+lyMAogCXWFD3J1vJ/2AzlvNCQgC8fxEYIKkABHQLkH8JMvQAzVgGBujjDO5/MgbA/h+t7+mIi0KhaHoAeBxmwKolgMAxrHNJltssd4kbOYON08KSqNfrPri/U3uIkAM/ioCXHAEOfQgIN4Gy/ycDFqECkBYgtmV4Bx4icOD/wx1wFbzGDhWA+P8ZtrQBMffv/T9Nf50p+6NtJQpF80XgbwFSAQIDFCYA2POzAJATA5QDCRv8/8jQaZ5H3W7vy5Od9/xF2rdRBERPDp8cHn7/42/ncP0CegX+6j92zuC1iSAK4yUHFYuQW2UvnryJ9k/y6jEsstfooZGNCBaW3dlDJSVElEojSUPJLoJxt9hCTAKGJqSWhnZpusmm+RP83uykUQ9emlM6v+/N22sO4Xvz3uzOrAEg9aGwD4T99wOk2XcAPGEChDhHxqIegNYpgsObADEIium2fBezf6tQiMc//sqy3P5LZKmVLDKJ+2IERMzeABUjICMWYDQGohrADNg/bf8ZLU3XdHsV90E/eH1v6brcSirfVlED1BdUA3ZRBA7h/wOI0vFA+L8gJAkCvoJgEkS8CYgQ/AyYpxES8tU9EKdQHGe0zhDdFtm/ZcH8Aez/zVBe+y9dRiK5SWcAL2P9cQZgGPQNsCgAyCALUbaZDmlZDQUAHcCz5Byq0R1F+axSBSCZpvlp98v+/k/u/4Nj6OKKcXgxpgowDsNLuP8knFxC9AwmkQBFYDSKYP14nE/F/R9w98fQp0ve77sudv+WFbt/Om0N5b2fEolk4UlMR0DP/+oAiFe0+183OIy0jkUCOstSIOm6raEAPHyszOHHJJbuKsrA5DUgEyuTefsOlEp7pT1wIGgcNATNxlGTOIJ+QU2sk/ZJu92j6NXr9V6v0+n8QHA8wvecluP7/rbvglzRmu7+06m1tcJQvvvzX+R3ABLJQnUAgDqAf44ADFIMm1p/Fu5vbBo6s22dQbq2qT0SnwLPhdtJRTk01SeqqmZM8n9BHnzI7+R3qlVETK36sVarlUnl8vdy+SsCVCqIirflYTme5zjOlhOzDVyKXM6FcsWcZcH+Abf/1NNU0Y9WluXfQiKR3IDdmjgDEMz8X2AAhtigTB3Ae2boG7wC2Ez/zd4Zs6gRRHE8q3eXi4dBK1GQVNscIZBPk/ba1Bbp5LDLWNicJjPisD4OFi8Gr/As4jWBXEgbCOQLXCEkHPkI+b+ZUfEKKwNefL/33ky7LrP/N2/G2VVGqSZaJIDjGCfBNsR+Djlg9uNdjUEGCPLf6Zx3zgeDT3BnrP4wVn/mG+IzAuLvmUL5h1+mCav/iA0OrmGs/dD9Pgs/DOr/HnP/k5PT21K5+FjW0AVBvgewUxVAWAEKLOU/AOm3Gg0gN//3WwAG+v9G0QskgGcvcxtTu2x27zBfqVRnPz/WavVXtbqnVe+0Oi3mgsMzBj3XTHqT8XAC8z4dJlD8ZATOEH02B3Q/ANl3nDouf5XLR3sySxAEYVce/GhRAbzm/d/7K0AebRFs2rQJplJlmqRIK0UKwX8Dit/mN3lZ2eyjzAEngerd3Qzfgv96BQZXgzlz+b/ojZ2xO+VHC5JhkozYEU74z/rcrWSASxjWgK5vbr7f/v5Tgvrvy4gQBGH3KgBPYyUBtOEeq30FYLgEUClMk0qNUXCXAMIu8GaJ/Bnhg1y+UKgsqMK4WU+ZbT0l3xXLxadHT/azMhIEQdg1lhXA/VNgYf6v2xYZwKZaa6tTZ5pSRZqMgiuCYxcYJUAls2U/LYq4yaBbS5TJyBrNPyaSVSkZWcJ2VwDLBBAyQMBqazVH6jYAVEo6JUOMMpwAusrvAh/K3RQEQTLMgzsJ7HHq7yuAxREA27bWhsk/WnTGwEkTmS51SQHsAsfHcbOwheMrkudr40QiG4Lwn7B8FUQjJID5AhAcaC4A0tRrP8LoD2TIGFJEXXYFwwuhn8dxRe6mIMg8X+7Ew7mebKgAGosEsLIFYNt/2Tt7FDliIAozqcHg0BiDo0lssbs+m4Nlo8UdTt4MvQIF1YEWxAZSZCU9F3DoQ/gYfiWppxvmAha8r0piw2V+XulVaWZGN1UDALC9eKi/iBflpGHrEEALAHtAvGdNqHqkOwegDMPz7RXQyY2u9H5qSHgJUiYAk0gxAVoArBhYgC/TBz6cfP8SQjphcwBPw24GsHcACKfdH+AEDiCUKiAVW+JkX9kDIoSQXofAA7Ke//cGwOn5303Og8mL88GLRpAVizzb/PgVFYD3gAghpD8HAK5fAjFs+j+q+Ds/YYkuhA9F/r00ZjUBszVaAB4+sY1B+OQQ0guHrQV01X+wDoDB5HxFnG4ayMYZ+Wqtja0HxB9RoZ4TQjrh0BzAgLjpADmHVNWvyl82SWUBbA1r7eURBcAcp/d8SCnR/P8J6YWrAxiQWweonf99aQE1BCuIlxBW9Y/FA4i1UUyBY2BCCMt+Z58DUPXfOwDgkM0BKFK2EJIEQSpRCrNFXB5gAMzxOy0A3xmkGw58fXIG0BzA8wC2DpBrI2CPnLyk2v4Prf+TS8ois0Ss2S4nA460AIT1lJAuuHUAjVFxlWnnAEIKSVJKTf6LCZhjlNnGy50xhhaAEEI6mwHsvgd0VAPgxnFTfyWl5FMopNAMwKvqf1T5j3Gel58GHO95EYgQQjrh850WAGV/CciNDnkdABf1TykgsmiI5CgRCxF1n+PvB1oA9izYYyGkRweALPo/ItsEAFwNQAih6X/IkoHEjIiCUFAAzsbwswCEENLZDGCo1AKABar8Ow+SDyEpknJQ7UdeigWIOa5cLUDkV8LRj9BCENJTC+hp/1uQ6/m/6X8llPZPQNTjv+Qi/7Jo4I+35WyUb3/f8VElhJD//7R2+FgLwKr/YxkCj26rAK0FlFPQPWcp0fo/eZES5yUiYAHujeEcmAdiwtcn6WgGoLQZwKr/02oAfDn965a1BVTVX7Ca/EP5sctbXGaV//vjiU0gQgjppQW06f92CbQZgIQMCEk5JckZCSLykmPRf2xaA5Zfy58fRisAbwIRQkiPDsBpBdhfAUpKRiTBDiTLP/buGMdtGIgCKLJFcoXASJtKQpS7+QTbuzW2U5FGheGCTEMW/lOoIqDORcq0OUZmhhLo3QusFvhvRjyAbZAejiTmIJoBGUCoV0q4IlkJ0Hc/eTgkEdHuj5n9VCuAyjeAdDg/toAvGr4C5EteSc5BJCDURE21PFsFMHx/PnBTkIho776+3gLaDoIx0xQto8qXHDX837/8mjNsFRCRIAGoeU0JqRz7wTaBAt8JRES0b60C8Om/bgGN7SEA5dN/zLX968QiCEKQtgVkEkoa+kGz+8NGMG/5IKIPUwFsR4GdzlsHOFqYnD1XIQfJoqAZIFCpXqm82Aow9P0/rgBERPv+u9YqgDdbQNstoFO2O4By3QBS8B4ALETDBFQJQDkOww8rAlgDEHGWoY9RAbSzgFsL2GqAy9oA8OnfSZv9BUGwugI3lFRuugKwBiAi2v+ZwL4AnHwHyJzH09oCjmOcorPp3wYHHyQjCyyaApPu16MVAIorABHRjj2tC8DJPb4HdIzTFNsKsJIsgjoAOqoZrqAopLLWAH3f4fDET5iIaK/e3AU02hpgpq0HkC3zpt4BOgtmiAgEC9SCUiNplHKz58FU93L4zE+Ye7jcI+bvh7+UnX41WwVQW8Djw/Qfo13ZWwBzrLO/5CwCUaihFo0ClKJp//9Luf8equ544KtBiYj2aesBtMPgNcfJou0ANWIxi2DWEGDxRLEsnr4C/L0e+8F0bAQQEe3Vt1YBeAvg4Snghw5wJZoiQa8ZMxbIogN0KNBYSnP3PoBLhy/8lIm4B0TvYGvD/mfvjFkbO4I4jqU77pwgcefOAX8Ao0KkUvPgwKBGqHAnuCofIcFliJorrgzmkLtLFSIuVVC4wpDogRcU1lmIwz7kFMcKFQHHhT9D/jO7q5UUCQ7uclHE/OY/s6ptMfNm5j29Nez8YwnM9FMFCHcAKVaeQwr5n8yk+Q9l/3j5z251qAC1+smB/DjouyLLdEHyv/BvdgA8AIrvgo+vgeEVcETx9CcOgHgCZJD7EfWQDfgdQOoBmGvZBQuCIGzqDiCsAOJNoH1oEOABkIKd+/k/UMPcmCEEI2lIQwUFbb2cfV4P1E4OHslbwgRBEDayA4j5P4LxDwTOAQKXAAgFgOVnPz7562FM/xCwMDQA1rof60ynXqs99yVgR3pFQRCETesAehBf/sengNNjwJz8FWKe48xz480MIW2ANrpg09oms3YyOkH6D6sAlAB5TYzcpy/I91PYENISmOiBWQcwtwEmlMrhiCDlf0JrwwYKH6w3knWn3AF0EGr10zt5KkAQBGETOwBY6gD6cyWAL/5JwO+ADRiStLeCLWV/WMChCSA6rO7NJ5WK3waU5LLhf3lJJnM8QdgiFjqAb2YTIOT/tACGVK5IFOjqX/Hd/3H6o4vCIOCwGhZkRxY4d0qpHw7D8fPk4FHlQVn+8IIgFxzCf/yfKYUC0OtBCxUgPQZGFQDQCoBluAUYwjWE5F8ADZGFCpBwbswloIsAq9U7XXuHIlB5eO+DfOV23tO3dIcEl+cABEF2VNtCGgGlp8D6/VkHoAbzHUDcAA8NiBMgXXgrLJkPsQaMYVwCUAFYMLopqNMd2Zv9/X3UgcpHDx/cv1cu3y+XSvK/FwRB+NA7gN5cAejHDuB8MPsROB7+czBk6frfFKbQcJr+UIASYx9HVAK+7SL3n7B36GOtg7N79no0vrm727+BPX6vVB9Xq3AO78pedY9V3ZXZlSAI27gETgOgftoA0/iHpSImwLkfNkMXNqZ/H8fWIQAHDyUABkVaq2jDWG18WkGTrAlf5qh5BMKBCK3nKTzLSDCAuIpjWCMjcBw//eKXP3bLJZnHCIKwBdO5VACQ/v2rwAbsYQMAU2oQ0z83ALwDBin9IxIWmlhbTCjCHSLyPheCMZi66eUZpf8uAmyRVmepDKTQhkCTnA2aWeIoxCOIzzVw0l/PIRSNReGwAePj+LvfdzGSlx2bzHAFYWueA5i/B7Q/9ypI5Y3I/eU/+awCXFNgOPsXMMZxcHDrqAFA8CXAXZ5x/l+klT7A5mlDbHySlgklYS2oBEHwFWQcyN6CRnbYyH6tytdGEITt2gEQ/ndAUwPAKwClFiZAw6UGgLHFxNeAycRS5PTv4LP076a+BPw1vXyNIrBIi9SCYO1O6/MWFMHHlPj9p0Rz5itnQrD1JSAjh0KAEKKDVVXhSYZ+4Ke98uYXdrmeFwTh7e4CihMgMEgtABUAFTsAQzKfGgQQL/2vi4gNmR9yduK4DYCRwhpg6m16e3s7nf726tXXzxZLAFcAeLsVaLOnsCb7IzSDFgZCn3GMWwE+lsigeJJlyUnLPOEeoHGY/fCxfG8EQdgCljqA9Cqw9BoAT66UIfMU3gITKEz/IUdyBI5xsCm1ABB8Cm6JP9+8ubq6uri4+B68fMkCL569+BIGsX/1N3vns+ImFIXxZekb9BVamMKsuix03SfIKpBlRxhcFeJsSnBncdHupDvT3eDOjQshERf509oZJwY1UeQqpOQd+p1TY8ZHmOH+vu+e4wPI+fReQ8bjm/G38Q24Jl/3uer0+eMV3DFs63BIq88HEgxG6L1M4EaCoX4EcAK8d17I3wFI5Pf7kmcSAF++E/xXAD9/dEcAxGzGpuHPJ8Dn+d9n320A7fb83M+FeIDLB1CeXgHKXyXIhBAHgro4HI+iFqKuj3XdkBuiKJqiaqrqb1VVyWOiZBtto5bgT8CG4MXCC+HQD33Hd33HJU1d93ZKmn61TdO0bdu0LAvLtnRcGLplGMaE0bSJ1jZVUxRFVdWROhoNBgN8EQRTAgwSeeNIJJJn8wYA+AC4lwDYAjqfAHNbdmyWm/P0J93dY/yfdoBQu3eAkkKABv+uRKXpj56VECFgkeW4ypnfRREXccw1LdI4TVI4AWsq0XrNhoh5EAV9vBDDP3Q8zwFTwsWi4X9rQzT54f/jHxiGxa2FQgCrQwNcKAaQAKd3AOelvHPko6lE8uR5dfHm4i32/1m8/w+BGYn3/5nlJRZx2R0AgA20v4fvKAH2YAe4dNDc5/HPDf2AkmEJRIDIyEzeqshzMgcBZ0GcIgZWq2S1WiettsiA+XoeQcE8CubBiYXnBR4Rer6PBPBddwph/rcpYCIETKQAsGjpum4ZOgRo9OsToCsTRVM0mKQSn2gNOAKgd68beef8Y+9qWuM6sujITjKxgweTlRH5AwkeoV5pY9BfEMxO0c4iYIQHooWHAa+MMPPlEAa8CAjvFO+E8caIMURgjBftGbDiodWtSN3qj9f9Xn+of8Kce+pW1SuSkM0srM4991a9rKP2OXXuvfWewWA452esC3QAC/ceOQuA079+CCAoACWg8qLyGhvYP5SAatoBbkqS+nH+xwPHfwlJ4pQSwOQjoHfqyB9CIOgdwwf0jgGQ/zGYXxIOAHl09O+jI2cCnACA/mWB/wVqAg64g/9B/s/3n796AgVAAejZE5R/yP3InV0A/I/c2QZY/xEBQCK2vtza4pJz/xYUYPP2JhYCuLkBBVgB/SOXPj14/50+EM/Zgd5gMPwyrv7BCQCCJaCkAhQcgNA/j/+s/YD+a7W3COV/Btj/BNFUC6CP3NF/gb3Q0z/WD0gogFgAmgAscD/yBzn+t1o8/+t+JApwBANwiFQDUP8PGwBQgH+B/5HeALx8+ep5FQqAGtATOgCe/yEBogDPsIT6v8KiA3AloAfb7vyP1PLP7S0e/f3pn+zPDQrgJODTL60GZDAYzjnmLl79XAWAeJyMgCbz/zABADdQf02L/yEE38ezP/b8RBICwCi4E04EQP0FqR9L4lii1/rhGOd/OABhf8f/9ABsA2j5hwKgXYCXrgcsi8f/KvkfsQ8HwPYvAh1ggF2AXbI/ugAC0QCWf7BJ8eeBUL8LAId/nv2JjQ3h/811UQBIwKcr7/htsDk7zhsMhl/CHAXglncAoP60AqQNgIoQP54gf0kKgCQdQPPtCchfaz+aBB1AXpwgePhHYiFYABIJkCSOaQFaUgCSaJVrQIJDeAAtAh3WD+tiAHwN6KUEJYATQC6eSAlon/Uf9gAkBDuCrxFy/ufszzY2EQHf9kWS/W9j6fF/c+MmAljfWF9ZEQewtDSy347BYHjXceEXBODKHyEAXzxy/K8FoPRjwCoB5R5wagFCA9gF0MxhACRCB8CJwCn24ADEAIgIaLIHgGixBwxQAEj/rUMMA6kDwOEfgAMg/ZP8dQqUJSAZAI38TwcAkP2xgf93pQGwDf5HADQASGcBpPAvOxXgbjz+SwA3kXAAK9IEGNo9AOsmGOyvct5x5R4FAAoQ3wNKA0D210vAwvwV0n8t8n+N9B97wEjy/yAe/5H5aU6+x3biLUAP9F+Q+0n+CBB/hgXm1yaAl4Cj1n/VATgDAOqnAQD/ExCAA5EAoOqiWn0lYAEIAeyyBJQ6gG3iAUMkwJ//PTZl0QJsIDeQ9ADsAtABDO2nYzAY+Z93fPgJBODzR/FTMNEBUAL0BnBFJYAlILA/VhMPLf0Dnv9VA3JZCOA0RxT+8F8gnARAA0IN6BipQQHwIP23sA495PDPHjBS6z96CayqBgAVIDYAaAEAmADP/l/JDCigBoDdX25bSApALAEBfvyT2GQJaGNtbUUcwFLXfjrGKgbDecdFCMDvFx/SAfjXwCVvAeUQaEUnQGsVWAAxALVmTdgfCxnof8Djf97MWfyXPGXo8T8n+QO0ARFUAbJ/K4MF6LeCCBxhiQIAnv/ZAoAPgAIQB+IAfAkIeFV1bQBOgaoHoANACLQFAAGQvE8T4DTAWQCsrduUgFAA8uf/de8AcB+4bRRlMBjO/+tA4QAW7j1VB+A7wHEIqAIDwCYwk/P/IgGh/K8g/TdPBhq5ixzrNAfxS2oHmNmDCUBwCAjAnvWyLJNKEItAAUeIw5IHqCPA/4dvVAEOJDkH5FzAczEBfBGE4AkNgGAXQf4nlP+BB5Ke/8H86gEALQARoH8kNukC0wEM7cD9k5izA70ZNsM5wjU4gIU7T3kHINwD3uMIkEclzH8iaABoAZpva81m0gEYaA+ABaDctYFPJV0FiEH6x/LET4D5sXrZcSbsn6X83+LrILQHoENACOwCtgBUAWgBKAE4/rMQ5BzAt8L99AE7vguwLbHN9u82Fvgfqa9+CPxPCaAD0B7w+vr6GrrAyzesB2AwGM4/Ll5d+Gxh4RboPzaB9/RbkAAvAUsANUnSP9k/Hv9PuAaSg4HrALAA5FDkBdifFiB39R/Sf4FQBA1owQUc91EDggpgI44IvQdA+qcA+AKQBDUAwSYAe8CQAHUAoQaks0BK/+IBHmgfmNA7YJH/AWcBNiLWkZwCWn7Xx0AvvCPnvTk7spoJMLzLuPJnCMAXEAB9D7Se/wFVAJEA0QDSvypAHAAl9PyPBPMjBnko/5wI+Qvr51hIbLJ6Uv8RFTh2MtCCAiD6x5m0APrC/rLYAGh1whQQqv/UAEpAVABwvxoAgjWgJzQACO0ByCrXgJBkf9m3RAEAYX9uPP17sAOs9A8BEAewdONj++UYDEb/5/4v8wHHgB4+FQnwTeB4CawiSwaAaiICsQKk9Z9Y//ctYGz5QOmfcGd/pwBUArA/F0Ix7in9SyFIDADBB8hf4rATOgAEa0B+DBSgAHgHQDynASD7ewF4RgcQWgAEikBJCxjQWwDpHQDSv46BrsAArH5k9wAMxtvG/zPwVeDPri8s/ONpdAB7KABpBYgjoESlwgYAwAlQhOJ7LPK/cD9Su7+hByAlIE3SvyN/bGX0KQDyHQDWfjJsfWF/sQAd5pHn/3IRqIGAAeAA0MFB9cBdA0BoBYgtgNgCBkj/2gEAYAAQQJgCJaICbCDLkBYAYumrS8YDBoPh/OOaNAHu6OeAiRcI8H+cAXpNB4Dl+L+m/B96AAORAPI/D/8Dx/0K7wCKHKEIBmCMVAcwdhoA8gf3M7GOOq0ONniALsK1ANpkf0RDx0APgCoW6V9WHAN6pnA9YH0ZqLK/vgsiDgGFJnD5/B8lYB1BAYADOLAzucFgmJm7wHr+DwoQ+F+nP2vISjj/A9hi/Z+zn9EBRBQuuHkLEItAxFiWqwD1M0YLiWBCACACh64G1HXn/8NQAmqQ/tkBpgNQAYj8L0HsItM5UGcBZBHhe2BhClQVQMlfsSYVoGVrARgMhpnAB9dEAB4+fQwEA8AWMPkfgawxyP9I0L8kMUBKDFz5H6d/9gAEBTct/3CPcN+B7GWhB5CN8cyA/jGpHwvR6XSw2AY47NIAtOEA6nVZDXYBGhABsv9LloDI/8ECkP0TAdhB7mgJSBVA+R8p1I8Nj01JdQGpA+DbQFc+mq0azQWrMRkMv1LMX79+feEvvAagAPkjowKU6/+1pkQJAwbYXytAg1zx8/TfK8j+AtI+iL83Fu6XBQQDIPRPD9BlDchVgHwjmEWgMAdEI1AF2AIITQBE0gTwXWCmkD+3OAWkDiCQf2R/LKSrAN3/rf1sDAbDLODqLTYB+CbQ6ACAimsBk/+jBJT4f8AEBs4C5Ag2gD0KLtJ/Cp7/tfzPZwYV4IMOQC0AEvQvOOo6B9CtSw8AaDj6b4D8iaoE4AVA6T82AbgJdlIHECpAyT2AzSgBZfoXAVhGD7jxax4GmbPzvMEwO/+2P0QN6HpsAlABaAEqSGcAKAGKUvnHTX8CJ0xXARogAsIEEHGmzzGi16MJGLuAAxiD+yWIFtg/tQCHEpwCggqwD9xogP/pAABaABWAtAIkGy8CY/EmsFoApX/ZAV8Bii+D8x+CSQzA2rLcArj5kf2wDAYDce6vhM4vcBBUBSD9FIyr/0cLwPF/LIU6ANZ/wP2MiEkxgQRMCgEfxJgWAA9yP1Ii4xyQoJ+R+4EOKkF0AN0Om8BaAmor/yNDD+BlFVtVEQTgmWR0AGwBqAFIHUAsAQHYftwBWOcGAwAs7b9vc5oGg91TmQ1cfcSvgrECtIeUm8CEjP+7DwEHNNMSEANo5moAgIGyPzel/uAApoWsMSLWf7IxAxirAfAKgBS0IAFddQDtQ9aASP8NwJWAqlye/1kDImgAlP+TKSAsPwWUjoFuIXkT2PN/dAF6DezGysd2H8hgsJ/Q7MwBwQI4AUivAUMApAVQQ77+UQVowOUUQIeAcqTHBFmIAcipAWcIYqpTQMixj4wxdhKQOfaXXeo/Q9D/8MhdA+iqAUDy/I88aAQBqB7EawD7UQFYA4pTQM4BKHgNICgA2V8NAILkHw0AW8CCry/95qL9aoxPDIbZ+Lc2vyht4HgPONI/slJjFUjRRAT2x8mfSeSMwP2k/omc/rkoAWUDMFXmdx5A+B9bPxvBAyADhvAAw9bwqEML0O3Wu23IANBuv3EegFNAimpSBVLEPvBuYgHiGCgRm8BBAtQDeKy7d0HfsO8BGwyG2TlIXb6GQdBFtQB7vAesH4KhAUgqQGkBCMnIB0huk4HQv1uIQuKMoSUgbqIBSD8DJMgYUIBRP6Ij2YEGdOEBSP/dNjxAnUvLQPQAijgHBAuQdAHiFNCuswBcsQnsFUBW/BoAI0CuAa8sVW0GFL8sO7obDDMCtQD+W/DaAdYbAPwOmEIvAQ9qPPojInKJWP1R9p9gqQU4YyCnoQsAyPQP9kx2bKVJoJEagP6wI+h2tQrUxhSQ7wI0kPQAHt4AECoAJf5H7mgRCBl7AOkcEFYsAjEEm7wFvLK0+jv7vRgMhhk6zF2WLsDiwyAAe6oAgOsApA4gjv8zT4IE5ANyPwDmx/IGAIkIHYAxJaDHiD2ADHrQlzbwKDEACM4BuQpQG/yPhawj37AL3Ij0jwQ8/acWQD8J83M3gflBGISn/3QKCM91toCXunbINRjM+s0U5hecBdhDRAOgHwJI2d+3frEEzUj+2N3ZH8gli7woSQCWOoBpmANCElnmNtR/0AjwEjDk6X+IYA0IElAXDSD944Hzf1oCqiaToEEAtAlcugwM9sdKBCBIADUg8j8iGgB8DPj+Jfu1GAyGGZrQnbsIC7CwsPhPdQDhFgBfAh0tQJMxqIH7fXjkSOV/XwIi4vkf4BP8TxMA8p96F5AhdRupA+BOA4AEeP4XB9BF4NFutN8k/M8HyR9ZugpGBxBvAu8owhxQchk4/SIwBQBJrIoALK327XhlMNjvc6Ywd4EW4Jb/HGT8EnAN8fptTcH6f8L9eJw4+kdMkMr+hdSAyP0T7liSUy7vAWL3F4mVjRD9BEPwf+wBQADYBq4zaQGAcgkI4VsA5H+uZAxI6R9LBUANgPYAkMkQEJJYX+OnYNq/tX+/BoNhxnD5E7EADzkFSgcQPgac1v8lY/U/gOM/uWd/ZABUgGNAktim8hABAPlPxyoCQQFEA/rIPhMYIoeoAeEimKAeFMDVgNqR/xtpE3g/KkC8CUZ4A+C7wIkDYA+YF8HYAi5ZANcA2LECkMFgmD3M3xEF+IY94NKnYGqVpAecFn9S+s8nAzf6SRSIs4lj/oIKwG3KpygAyZ8qEDBCZiMyvwjAcDQE/fc7IgGqAGB/GgAB6J84QAJeALBiDYiIt4GjA3ArCoB3ALKIeBmY34QB/99YWV617wAYDIYZxIfyRqDFO49f7AF+CjReAWsiZRtgkx5wqgETyTxU/sPjTITA1/+xpmwCnE2BYjpGQgOmPXUBCNL/CFALIOTfR+Ch9E+gEVBXBSBw/keU28Dlt0EgiXAXOCjAT74OCAgKAANA4A4wsLzyxn4nBoPVEGcRV9gH/qv/FIC+CTSdAR0gQvUn4X9W//38Pw3A5AxB7p9oE5gGIHYBxlIBCsicA8hGEmIAEEMGDAB7AB0qAEJQd7sKQCoB6RtB2QdO+V8FIFwEUAeAoAAE+g/YwPkf8e179jMxGAwzKc3z9z5bWFz8Jn4MTNrAUQEGQQGaiQTkwv/s/06QDgXWmf6XZ/84BAQHUAT6Zy8gG3v6H/P4j6QHGNIAdLQJQITbwHAA9YbvAiCSChAVICkBEbuA0n+8C5w2AZJBIMXGGg3A/Uv2K7HvARgMs4kPWARafFx5QfAOQOn0z/KP5/+AnA5AAhlbAMr9DDI/QQPAfUwJQGIRGRdEQHrAdABiAEY8/2Pr+hpQm5saAEhAdABhDih9GUQ6BRQlAKkIFwEoAEkFiEtvACzftCvABoPVgGb2L3P1mliAO3sVeABpAb+OLeAmU8//aRUox9IXACEVZwgkFo/9oQLExRhjEIjkP0V4jOABCLoANgHYAUDo6d+VgYh6uQmgAkD6/7kucOB/YltCLYBiSxEl4O7G5l3cAGADYGjvWzemsf+b/4/f55z91d9JzD9VBYAB+E4cQOgBpwqAJJIWMC0Adm4qAjQAQKENAFT+8ZhKUgLGJaD64yyA9AAYPP8jh7wJrA4AqSD/RweABZQdwD6W9gCSJgBCx4C8BSBiD8ALACWANwCAofGAwWA/oRnGe/OLUgT6O2dAOQQqQTRDA4ARNGCC4J57/g8t4FQEFMUU27RcAEpVgF2AviSWdoE7Q6BbngPyCoBIm8BV4CD9KEzaBEgsAKg/eIAtCYIKECVgdW0V5//V7vv2+zAYDLN8H/hDVYA99zlIwNM/E6Hkr5hwc+GQk/w1EQnvg/mxJARjRK8sASMJR/9qAUa4CkCwAjTU+g9S0ShbgNAEJvZLPeD4NjgagNQBEDQAEkjirmJjFfSPAaC2DQAZDIbZxnuX569fX1z809++q1T8LYDYBGimA0Ce/JEIbiWc+SC0BITF8z/pv1APkNaBvAWQjTOg3IDoAFQCGhJqAWIf2BmAajoGpEiaAGkbmBDifxBNANbm6urq/9g7W902giCOq2oL2qpVVHjPYCkXXqmvYGyZXViZDY6EnBQV+AVCjFpSFCnQxLJkUOBAS5ZMKkVmd3b9CJ35e3bnJlsa4pvfzK4NwpLM7HztDoZf+37+9wSB45w7r15fXJ08wEweA3407wCQ2PM/9sT2i9oWIAkBoMDmfxpSbJL+4Q2jwI0kgFhh/tMqAAoAW2kBijUA0we0MC/CgORl+NvWlaC0kbD97w+o/utvwDiO0wGyKy4El5OljAEIsQJMAtIAQNEEEBaO/fLBAt3DAxC8qwdoeBg4hgB1I0VgCQCMCzBVYBKw2kYPsCDREGAhEQDQEMDcCBcFAYDY/yHZfz//ewjgOB1pBeqxByiXm00IAf6chKBRgMT6k2gHUOIBlCOpbEBcALZ9oy4Aq4bSIgGIAOAATA2AlJEuoJUdBGABzx4FMxEA0Jfh9Vpo2P/h4Ivbf8dxB9+J34x6gLycbbgJaK3XQGgJWBEfYE0/NpGY/NEvR60CEzYRxCIhAMx/iAF2pg1Ijv+2DQiySu6C0ByQ3geX+ACYfywIIfn/Pp///f/LcXxOpSO8CTHA7NlN0JIDiuDkjx0rKQGzCqEJKH4BsP/W+u/F+oePGpgIoBUAsDA6CUzKaBHYlgEkB6TmH6o5IOwQsf/9QfPWz2mO43SHbEkeoMzLX5T/WUsHaLgHwk4A2AQQLH8SAYCj7CYAgGK1fABrbAIVIXZSCX5iUSegNQDS1Vavg9YqsA6DmTLwvXaCtt4ECOtmdA37XzSe/3Ecp1NcZHkvz8fl5GEuAYC2AJki8AGKLUn/H5IIgAQbA7tPyt9MABCpecH6g3QOoJUDWtFiD6CzwBIAaA7INAIR2KbT9jgwL7H/xaDgGyCKz27/HcfpnAcoe/k4L6ufc9h/8QC2DegAMdbfdIEaQieQOoE9qTiAtAYQSgCmDgxq6wPSV2FiCmhB2ioD2CpAvBPUPA4Pprejb+j/7H//5JUix3E6x/vsqnc5Ho8n1cMjLoAjNUMApgEUC/zVCyBMDTik/uXDTgIcGxZj/Wv1AYEdqWSASJJZYCwJACQJJCUA8zTwfSwDwAeoBwhZoOn0ZlRcD5jfH/wPwXGcLo6EZVnOHqCq7uZrzvxvzBiAcQGJ+cdGGjmyyIfWABACqCMwEQCoWVv2f/dUQ/4bALD1h4QckGkEZdVZYBa9EVTfBial439RIP2/e3cGR/oX+GkPSRzn/PmY/bjMq3JcTe7mG3YBJ+v/j70z5k0bCuK4oFWbpGqVTiiW+Azl86BssEVZ6jULUhSmSunkkaEzQ5ShE22nRoipoaKBhSLjGGFb4SP0/84nn59f1C/A/e75DF/gf+/u3j3njjvAbEylAQzgiB0vtpwsNxH/zJV/rKICZAzqT/JPzjoISp6aAKL/fA6I9L/SBZAAILdCw6H72zkj/b9O9fofRVH2tLpbf/HK2/gtv2f4kmcBTgdAKkCCJABw9v5ftv8SALCoBoRXCnO2/+SK+0CdDABWMDFJwEKKQECKQKCQf3scWLiE+p91uqb+f/9Oz1kriiZse0uthiTge4tCQBAEN+NC+50QwDyRYTXwWA1g7v+SMbL9ZygIpG4IACnpP9eAnm8C05oYQwzgUeDJD0oCnFuhy0UgcgDu08dOp4vtfxfd3+xQVVdRlL2m/tJr3lAICADSgM3/OgB2ECAjGhwDyNsloIw8XrSoF2wjCUAxB5DIWdCFXAeXM4HJKBipPx6pAckomNwJimXUH6NfqP1jYfu/eK/yryiKcuA1ex+4ENQPht+WPAJMDlgVIFF+m91Oyj+i/tXTn/S2lZ88/eBB4ITr/+5nwagHTCuH5N+Yu/2XBACeOwAX0H/itH2f6eF/RVEUU917iyzARzu4F5g8YDAcTZf5/p9xrwGqBoFd8ZAZGjwJbCUChBSB3CxAWgEcCsACi+CRYMBJwB3fCWd/GYByAAkC1P01N/9A/+nw/3X6WmusWg1WFCWnfuR5f0waQAEADIfj8Wg6/b1c0jfhSyHghKcATgp7amDB+AcbhQABf1IeCKBUAFYleYY1rJwMSDZQngiwvxDJEeArqz/E/+ry4hzqT/rfuUvfqIopiqLk1OpwB8eIAX7L93v9QTAw3I5uiZ9gCmazFZitzGu7AhFeUbTdRsaiLMq2cAWPIMbzN36M0xhA4+MkxkrCOARJGK7Dh/AhvwIUaz5fzH/N4csqT7DSy7fgq98AqBz9KX8D5txAm//Tdvtq3Ti0xF/nABRF0fNAeI6OveYm8EG///kfO3fwmjYUxwHc916h64ZQT2WC/5hXzx6k1zF6CPE00UvpYYcVbEAZbQ/tBrpTMWAzlkRHhqMGZOzQwwb7E/b9vURFd1gZ7NTv5/d+v74mRkU075GEZEMAYATAGADBUhQEX6IoiGCOjOcilgbpPI3naTqP43SBTJN0kSwgWSSwQJ3d3c0glAxniDD8Gk7CcJLxJ1Ph+x99f4rML/a8RAjvvThHtM9svLaneXNt95XrOO76js8v6uDUa1VoTH+WdguGJ3+JiHfq/oPewRhQxihw22weHr6UaHY6neNOV/S61yIYXA+QwSCKsnZjxXlD5MbjJBmLBMafEhtWKBGORiPJIdIa+v4QAR8k0KxLNOFlxQM5z+udtTPu6q/rYvfvOnXHWU775biPveNzzfv+66D0zPB+60T/QPHM0qOgldp5UixDpVK5v/98K4eBupnecW9Tv9cb9G/6cGXzats7iZW3uYs3F2gop1mcIsWJ1Tpp5Y5aR5ZrNdxGvdFA1qFmy5ZqVa7xRFnD41zv/NuPg9Iepv78/RIR/eVgEBgMA8X9/fKGyjLQ/ofniLysQkoOnXUP+RClUvHp3q4paMMJHBHRgyilUNc0FBBKqwKaZTtYqFbbaPu/Nnpjl4PFlgbZXtkHafRsVxeMNsYou0gZZEFB9jwKsFIbUHaVLJPNZUX2YuiDtm9FyhZZxz0gERFxis73T0REREScavJzICIiIuKEYxuvICf+vojfTyIiot/s3WFugzAMgNF97P533s9NmypRRiDAeweYCnZsJ4VVwwAAzR0AeFP+PgAAmN33kgfL7HUAQN/zHgDWlzuBqIApAQCMlAAAnh/HQAwAAJwo2xEAwBmlyOA5TZCfgCkBKQeoD2AlAYDO5oxVsBBfAIDLzEaZ97AJAED594Qus2d6ogiA+Q0AAABwFiAuJ//95BWATg6ABuDzA4CBA+8BMP36yvpF/QfrFwANwCcCULsBxlSqfNmx4uKGdoq0KQAAcDJ0wB/PlgEADByIDKKI/JT/sEnWF4YTwHsAAABgRDdwizsAAEbHdTKXYrMCgPLv9wAYK6uXAfIdFTxebgFSCFBPQI4DoM3gm5zVkreqDABoGGD1engN9FpAmcHpMaKI+g8AAAAAwExyGoyoAwAYyZBxACj/iAx7WWQJqgxg/QIAAADOGty3U+9z4i4/AQAw7oFVA6C8cZhPt8B7AFYvQyWHQH/RlAAAAAA2yydF1AErElAcOEdyFABg5vFscUtuMJoupm08RwxoAUgeQFUBAGClXJKLg4/kJwDAPWSAwyYVAOXfE7rML1HkQKn/8HipA9gyAOoDAIABC/kg3wBUdACV9anKbQYA8B4ABl88/wvsbtF3AAAAAJzVeg8A310hc3BfAfBgGQBgx2lcQxRBfwGsL/4rKQcAAIBjDM/pAwAAF98yZD8HAGjYIsNYyRH5LCrADrJ+AdAAAABuJiOfEd3nB9AxAIUAcQcAMHD4T/KIIugvYH0BAAAA9vxMHK/kG+ILVhIAGskraVIYXQDAE+SIIqyTbQT4TXgA0JIAAIxSLvRAOWMCAOaSQQOpe9WPmZUJKgGAMuMJckQR9V9/gd2lv2ALAIyQLQ+Amg44U1bxnLFukXYEAAD3ehE48zw2eWC9g3Rw2o/15U6ICgAAAADgmM19e1/+PgAA8FrGeQB1HiSiyOBtDlmC/AGsXwAAAMBZhev2+QEAwMhtngcAcPqKX3VAlQEAAAAAnM0BKgSgbgDg9wAAAPAEOd8Wxzk4EQSsXwAAMLwDVvov+Q5AmV8hbUpmiS9gvQM8pxan/GMoEBdE15XxroRrGnkP4MJSDtGu5T/Ww5q+YH0xh6QcaFhaEgCAUeqn/NOjTZbBt77BEc4qc/0AgFGBXXT8k/0JIlY2WHWuDOHyewDsI1FUaUTlj2QRqKqu180EVBUAAEx7bpH/5QLweLkFSE+wwjxZBgAY6b0HgCj6NgEAVRUALQkA4Cz+Pzs/LPMP3BnobbXgq707yG0QBgIoqk/vf+fuK0WqEtux4b1lVEUNHs8MxgDyBoCXWd8yQafAAOjQQbzZQS7SvQ8AswLQJYCSAcgPgLkO8PSkmzriCTsAMpLjB8BYzfzrFDCFFwAUPjv8ML+QZQDXgAEAAIBHrylnGeMt107fnzXiVXJ1CTCrAeTKP/r/xzlmmI4AYIcuZ7Qol7aLCRJB8Hg5BAAAoKkHpIExkqvedykXAABgaeVL7wNwagESFohbcB8AY2QUUa4B8xcAAM0dxh3gLhmvRT8u9xlgfAF7CwDm64b3Acj+AIA1IOfqIv3gUUwmEKeyDMgWAKAkAQCcqCGfv5bGTsNt3AEsoQBw1uavVBcAwBnnubJD9+BIz7N6WCjxA+avQwmAJQUAgKP1opXKvv6NnX9/RuIEAAC9+0rN/CdzLQAkIBC3GC7vAxDpM7+9yzOaZJoJkmVgG5esCoDWFAAADZa1Ie8DQGYCzFIA1iolBgBQsO0sfHikZ42eLSTLAPI/Qg6QHwAABZu9xishuOF9AK8/zhoxAICzCDyyVHCJOYwLiFvDhfsAHM9BusxfAP2V/A+AkoeRxxIQAMqs8bLGBAAA1v3GSesPFg/AtSukmZ39OAQLdHhLnyPNBzIu8LFkVQBghl+T0n3i8ly0OQAAAABJRU5ErkJggg==';
    var NEXUS_LOGO_SVG =
        '<svg class="nexus-logo-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="526 217 501 527" width="48" height="48" aria-hidden="true" focusable="false">' +
            '<image href="' + NEXUS_LOGO_IMAGE + '" xlink:href="' + NEXUS_LOGO_IMAGE + '" x="0" y="0" width="1536" height="1024" preserveAspectRatio="xMidYMid meet"></image>' +
        '</svg>';
    // Lampa takes the first SVG from the card button for the source menu.
    var NEXUS_MENU_ICON =
        '<svg class="nexus-menu-icon" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="526 217 501 527" aria-hidden="true" focusable="false">' +
            '<image href="' + NEXUS_LOGO_IMAGE + '" xlink:href="' + NEXUS_LOGO_IMAGE + '" x="0" y="0" width="1536" height="1024" preserveAspectRatio="xMidYMid meet"></image>' +
        '</svg>';
    var NEXUS_DEBUG     = false;
    var NEXUS_CACHE_TTL = 6 * 60 * 60 * 1000;
    var NEXUS_CONTENT_CACHE_TTL = 45 * 60 * 1000;
    var NEXUS_SOURCE_PROBE_TIMEOUT = 6500;
    var NEXUS_SOURCE_PROBE_CONCURRENCY = 4;
    var NEXUS_CONTENT_TIMEOUT = 16000;
var NEXUS_SOURCE_ATTEMPTS = 3;
var NEXUS_OPEN_ATTEMPTS = 3;


function timeoutForAttempt(base, attempt) {
    return base + (attempt * 4000);
}
    
    var NEXUS_SOURCE_ORDER = [
        'zetflix',
        'veoveo',
        'cdnvideohub',
        'kinotochka',
        'phantom',
        'uafilm',
        'leproduction',
        'filmix',
        'vkmovie',
        'lumio_original_subs'
        // 'pidtor' // Temporarily disabled;
    ];
    var NEXUS_ORIGINAL_SUBS_SOURCE = 'lumio_original_subs';
    var NEXUS_ORIGINAL_SUBS_LABEL = '\u041e\u0440\u0438\u0433\u0438\u043d\u0430\u043b (+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u044b)';
    var NEXUS_SOURCE_ALIASES = {
        videohub: 'cdnvideohub',
        vkvideo: 'vkmovie'
    };
    var NEXUS_DEFAULT_SOURCE = 'zetflix';
    var NEXUS_BALANSER_STORAGE = 'lumio_online_balanser';
    var NEXUS_SUBTITLES_START_BACKUP = 'lumio_original_subs_subtitles_start_backup';
    
    // Clear only Lumio's own cached source lists after this release.
    var NEXUS_STORAGE_SCHEMA = '1.26.0';

function removeStorageKey(key) {
    try {
        if (Lampa.Storage.remove) Lampa.Storage.remove(key);
        else Lampa.Storage.set(key, null);
    } catch (e) {}

    try {
        if (window.localStorage) localStorage.removeItem(key);
    } catch (e2) {}
}

function resetLumioCacheOnce() {
    var saved = Lampa.Storage.get('lumio_storage_schema', '');

    if (saved === NEXUS_STORAGE_SCHEMA) return;

    try {
        if (window.localStorage) {
            Object.keys(localStorage).forEach(function (key) {
                if (
                    key.indexOf('lumio_sources_') === 0 ||
                    key.indexOf('lumio_content_') === 0 ||
                    key.indexOf('lumio_serial_choice_') === 0 ||
                    key.indexOf('lumio_choice_') === 0 ||
                    key.indexOf('nexus_choice_') === 0
                ) {
                    localStorage.removeItem(key);
                }
            });
        }
    } catch (e) {}

    removeStorageKey('lumio_source_latency');
    Lampa.Storage.set('lumio_storage_schema', NEXUS_STORAGE_SCHEMA);
}

resetLumioCacheOnce();

function restoreOriginalSubsAutostart() {
    var saved = Lampa.Storage.get(NEXUS_SUBTITLES_START_BACKUP, null);
    if (saved === null || saved === undefined) return;

    Lampa.Storage.set('subtitles_start', saved === true || saved === 'true');
    removeStorageKey(NEXUS_SUBTITLES_START_BACKUP);
}

restoreOriginalSubsAutostart();

    var NEXUS_HOST = 'https://beta.mitsu.tv/api';

    function resetTemplates() {

        Lampa.Template.add('nexus_prestige_folder',
            '<div class="lumio-prestige lumio-prestige--folder selector {card_class}" data-nexus-voice="{voice_key}">' +
                '<div class="lumio-prestige__glow"></div>' +
                '<div class="lumio-prestige__media {media_class}" style="{media_style}">' +
                    '<div class="lumio-prestige__episode-mark"><span>{media_overline}</span><b>{media_label}</b></div>' +
                    '<div class="lumio-prestige__logo">' +
                        '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">' +
                            '<path d="M32 4 58 18v28L32 60 6 46V18L32 4Z" fill="#12D6DF"/>' +
                            '<path d="M32 4 58 18 32 33 6 18 32 4Z" fill="#9B5CFF"/>' +
                            '<path d="M25 21v22l18-11-18-11Z" fill="#fff"/>' +
                        '</svg>' +
                    '</div>' +
                '</div>' +
                '<div class="lumio-prestige__body">' +
                    '<div class="lumio-prestige__head">' +
                        '<div class="lumio-prestige__title">{title}</div>' +
                        '<div class="lumio-prestige__head-meta">' +
                            '<div class="lumio-prestige__voice {voice_badge_class}">{voice_badge}</div>' +
                            '<div class="lumio-prestige__time">{time}</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="lumio-prestige__footer">' +
                        '<div class="lumio-prestige__info">{info}</div>' +
                        '<div class="lumio-prestige__badge {badge_class}">{badge}</div>' +
                    '</div>' +
                    '<div class="lumio-prestige__progress {progress_class}"><i style="width:{progress}%"></i></div>' +
                '</div>' +
            '</div>'
        );

        Lampa.Template.add('nexus_content_loading',
            '<div class="lumio-empty nexus-loader">' +
                '<div class="nexus-loader__mark">{logo}</div>' +
                '<div class="nexus-loader__title">{title}</div>' +
                '<div class="nexus-loader__text">{text}</div>' +
                '<div class="nexus-loader__bar"><i></i></div>' +
            '</div>'
        );

        Lampa.Template.add('nexus_doesnotanswer',
            '<div class="lumio-empty">' +
                '<div class="lumio-empty__title">{title}</div>' +
                '<div class="lumio-empty__time">{text}</div>' +
            '</div>'
        );

    }

    resetTemplates();

    if (!document.getElementById('nexus-css')) {
        var styleEl = document.createElement('style');
        styleEl.id = 'nexus-css';
        styleEl.textContent = '.lumio-prestige{position:relative;overflow:hidden;border-radius:.55em;background:linear-gradient(110deg,rgba(15,23,42,.76),rgba(7,11,22,.48));border:1px solid rgba(255,255,255,.12);box-shadow:0 .45em 1.2em rgba(0,0,0,.22);display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;min-height:7.4em}.lumio-prestige__glow{position:absolute;inset:-45% -10% auto auto;width:12em;height:12em;background:radial-gradient(circle,rgba(18,214,223,.25),rgba(155,92,255,0) 68%);pointer-events:none}.lumio-prestige__body{padding:1.05em 1.15em;line-height:1.3;-webkit-box-flex:1;-webkit-flex-grow:1;-moz-box-flex:1;-ms-flex-positive:1;flex-grow:1;position:relative;min-width:0}.lumio-prestige__media{width:5.2em;min-height:7.4em;background-color:rgba(255,255,255,.08);background-position:center;background-size:cover;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0;position:relative}.lumio-prestige__media:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,0),rgba(5,8,16,.44))}.lumio-prestige__media--poster .lumio-prestige__logo{display:none}.lumio-prestige__logo{position:absolute;left:50%;top:50%;width:3.7em;height:3.7em;transform:translate(-50%,-50%);filter:drop-shadow(0 .35em .8em rgba(0,0,0,.38));z-index:1}.lumio-prestige__logo svg{width:100%!important;height:100%!important}.lumio-prestige__head,.lumio-prestige__footer{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-pack:justify;-webkit-justify-content:space-between;-moz-box-pack:justify;-ms-flex-pack:justify;justify-content:space-between;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;gap:.8em}.lumio-prestige__title{font-size:1.55em;font-weight:600;overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}.lumio-prestige__time,.lumio-prestige__badge{font-size:.86em;padding:.28em .58em;border-radius:.45em;background:rgba(18,214,223,.16);color:#bdfaff;white-space:nowrap}.lumio-prestige__time:empty,.lumio-prestige__badge:empty{display:none}.lumio-prestige__info{font-size:1.02em;color:rgba(255,255,255,.72);overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}.lumio-prestige--folder .lumio-prestige__footer{margin-top:.85em}.lumio-prestige.focus{background:linear-gradient(110deg,rgba(18,214,223,.22),rgba(155,92,255,.24)),rgba(7,11,22,.78)}.lumio-prestige.focus:after{content:"";position:absolute;top:-0.34em;left:-0.34em;right:-0.34em;bottom:-0.34em;border-radius:.75em;border:solid .22em #fff;z-index:-1;pointer-events:none}.lumio-prestige .lumio-prestige{margin-top:1.5em}.lumio-empty{line-height:1.4}.lumio-empty__title{font-size:1.8em;margin-bottom:.3em}.lumio-empty__time{font-size:1.2em;font-weight:300;margin-bottom:1.6em}.nexus-loader{padding:2.2em 1em;text-align:center}.nexus-loader__mark{width:4.8em;height:4.8em;margin:0 auto 1em;animation:nexusPulse 1.3s ease-in-out infinite}.nexus-loader__mark svg{width:100%;height:100%;filter:drop-shadow(0 .6em 1.2em rgba(18,214,223,.28))}.nexus-loader__title{font-size:1.65em;font-weight:600}.nexus-loader__text{font-size:1.05em;color:rgba(255,255,255,.64);margin-top:.35em}.nexus-loader__bar{position:relative;overflow:hidden;width:15em;max-width:78%;height:.28em;margin:1.25em auto 0;border-radius:2em;background:rgba(255,255,255,.14)}.nexus-loader__bar i{position:absolute;inset:0 auto 0 0;width:45%;border-radius:inherit;background:linear-gradient(90deg,#12d6df,#9b5cff);animation:nexusLoad 1.15s ease-in-out infinite}@keyframes nexusPulse{0%,100%{transform:scale(.96);opacity:.72}50%{transform:scale(1);opacity:1}}@keyframes nexusLoad{0%{transform:translateX(-110%)}100%{transform:translateX(240%)}}.nexus--button svg{filter:drop-shadow(0 .2em .45em rgba(18,214,223,.35))}';
        styleEl.textContent += '.nexus-serial-filter{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;gap:.65em}.nexus-serial-filter__value{font-size:.78em;padding:.32em .55em;border-radius:.36em;background:rgba(255,255,255,.18);white-space:nowrap;color:#fff}.nexus-serial-filter.focus .nexus-serial-filter__value{background:rgba(18,214,223,.28)} .lumio-prestige__badge.nexus-badge--uhd{background:rgba(155,92,255,.22);color:#e4d4ff}.lumio-prestige__badge.nexus-badge--hd{background:rgba(34,197,94,.20);color:#9dffc0}.lumio-prestige__badge.nexus-badge--sd{background:rgba(234,179,8,.22);color:#ffe58a}';
        styleEl.textContent += '.lumio-prestige__media--voice{background:linear-gradient(145deg,rgba(18,214,223,.34),rgba(155,92,255,.20) 58%,rgba(15,23,42,.72));overflow:hidden}.lumio-prestige__media--voice .lumio-prestige__logo{display:none}.lumio-prestige__media--voice:before{content:"";position:absolute;left:50%;top:50%;width:2.75em;height:4.25em;transform:translate(-50%,-50%);background:rgba(255,255,255,.92);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 768 1280%22%3E%3Cg transform=%22translate(0,1280) scale(0.1,-0.1)%22%3E%3Cpath d=%22M3158 12790 c-91 -11 -256 -53 -350 -89 -504 -195 -884 -646 -995 -1184 -16 -76 -17 -285 -21 -2742 -3 -2824 -4 -2785 44 -2975 153 -606 674 -1083 1284 -1175 139 -22 1297 -22 1438 0 532 80 1005 457 1218 971 31 77 84 252 84 282 0 9 -159 12 -760 12 l-760 0 0 255 0 255 775 0 775 0 0 255 0 255 -775 0 -775 0 0 255 0 255 773 2 772 3 0 255 0 255 -772 3 -773 2 0 255 0 255 775 0 775 0 0 255 0 255 -775 0 -775 0 0 255 0 255 775 0 775 0 0 255 0 255 -775 0 -775 0 0 260 0 260 775 0 775 0 0 255 0 255 -775 0 -775 0 0 255 0 255 760 0 761 0 -7 38 c-12 71 -84 274 -128 361 -193 381 -532 678 -923 806 -213 69 -201 68 -923 71 -360 1 -685 -2 -722 -6z%22/%3E%3Cpath d=%22M3 6903 c4 -1139 2 -1097 68 -1418 104 -504 329 -976 672 -1408 101 -128 380 -408 513 -515 562 -451 1232 -709 1920 -740 l149 -7 0 -895 0 -895 -1087 -3 -1088 -2 0 -510 0 -510 2690 0 2690 0 0 510 0 510 -1087 2 -1088 3 0 895 0 895 149 7 c688 31 1358 289 1920 740 133 107 412 387 513 515 343 432 568 904 672 1408 66 321 64 279 68 1418 l4 1037 -510 0 -510 0 -4 -992 c-3 -960 -4 -998 -25 -1129 -41 -258 -116 -484 -236 -715 -113 -217 -227 -373 -406 -558 -357 -368 -795 -595 -1315 -683 -100 -16 -176 -18 -835 -18 -799 0 -798 0 -1062 66 -631 159 -1186 603 -1494 1193 -120 231 -195 457 -236 715 -21 131 -22 169 -25 1129 l-4 992 -510 0 -510 0 4 -1037z%22/%3E%3C/g%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 768 1280%22%3E%3Cg transform=%22translate(0,1280) scale(0.1,-0.1)%22%3E%3Cpath d=%22M3158 12790 c-91 -11 -256 -53 -350 -89 -504 -195 -884 -646 -995 -1184 -16 -76 -17 -285 -21 -2742 -3 -2824 -4 -2785 44 -2975 153 -606 674 -1083 1284 -1175 139 -22 1297 -22 1438 0 532 80 1005 457 1218 971 31 77 84 252 84 282 0 9 -159 12 -760 12 l-760 0 0 255 0 255 775 0 775 0 0 255 0 255 -775 0 -775 0 0 255 0 255 773 2 772 3 0 255 0 255 -772 3 -773 2 0 255 0 255 775 0 775 0 0 255 0 255 -775 0 -775 0 0 255 0 255 775 0 775 0 0 255 0 255 -775 0 -775 0 0 260 0 260 775 0 775 0 0 255 0 255 -775 0 -775 0 0 255 0 255 760 0 761 0 -7 38 c-12 71 -84 274 -128 361 -193 381 -532 678 -923 806 -213 69 -201 68 -923 71 -360 1 -685 -2 -722 -6z%22/%3E%3Cpath d=%22M3 6903 c4 -1139 2 -1097 68 -1418 104 -504 329 -976 672 -1408 101 -128 380 -408 513 -515 562 -451 1232 -709 1920 -740 l149 -7 0 -895 0 -895 -1087 -3 -1088 -2 0 -510 0 -510 2690 0 2690 0 0 510 0 510 -1087 2 -1088 3 0 895 0 895 149 7 c688 31 1358 289 1920 740 133 107 412 387 513 515 343 432 568 904 672 1408 66 321 64 279 68 1418 l4 1037 -510 0 -510 0 -4 -992 c-3 -960 -4 -998 -25 -1129 -41 -258 -116 -484 -236 -715 -113 -217 -227 -373 -406 -558 -357 -368 -795 -595 -1315 -683 -100 -16 -176 -18 -835 -18 -799 0 -798 0 -1062 66 -631 159 -1186 603 -1494 1193 -120 231 -195 457 -236 715 -21 131 -22 169 -25 1129 l-4 992 -510 0 -510 0 4 -1037z%22/%3E%3C/g%3E%3C/svg%3E") center/contain no-repeat;filter:drop-shadow(0 .45em .85em rgba(0,0,0,.34));z-index:1}.lumio-prestige__media--voice:after{background:linear-gradient(90deg,rgba(0,0,0,.04),rgba(5,8,16,.43))}.nexus-voice-tone-0{background:linear-gradient(145deg,rgba(18,214,223,.34),rgba(155,92,255,.20) 58%,rgba(15,23,42,.72))}.nexus-voice-tone-1{background:linear-gradient(145deg,rgba(34,197,94,.34),rgba(18,214,223,.18) 58%,rgba(15,23,42,.72))}.nexus-voice-tone-2{background:linear-gradient(145deg,rgba(244,114,182,.30),rgba(155,92,255,.22) 58%,rgba(15,23,42,.72))}.nexus-voice-tone-3{background:linear-gradient(145deg,rgba(250,204,21,.30),rgba(34,197,94,.18) 58%,rgba(15,23,42,.72))}.nexus-voice-tone-4{background:linear-gradient(145deg,rgba(96,165,250,.34),rgba(18,214,223,.18) 58%,rgba(15,23,42,.72))}.nexus-voice-tone-5{background:linear-gradient(145deg,rgba(248,113,113,.30),rgba(250,204,21,.18) 58%,rgba(15,23,42,.72))}.nexus-voice-tone-6{background:linear-gradient(145deg,rgba(45,212,191,.34),rgba(96,165,250,.20) 58%,rgba(15,23,42,.72))}.nexus-voice-tone-7{background:linear-gradient(145deg,rgba(192,132,252,.32),rgba(244,114,182,.18) 58%,rgba(15,23,42,.72))}.nexus-voice-tone-8{background:linear-gradient(145deg,rgba(251,146,60,.30),rgba(248,113,113,.18) 58%,rgba(15,23,42,.72))}.nexus-voice-tone-9{background:linear-gradient(145deg,rgba(74,222,128,.30),rgba(250,204,21,.18) 58%,rgba(15,23,42,.72))}.nexus-voice-tone-10{background:linear-gradient(145deg,rgba(56,189,248,.34),rgba(129,140,248,.20) 58%,rgba(15,23,42,.72))}.nexus-voice-tone-11{background:linear-gradient(145deg,rgba(217,70,239,.28),rgba(34,211,238,.18) 58%,rgba(15,23,42,.72))}.lumio-prestige__badge.nexus-badge--voice{background:rgba(18,214,223,.18);color:#bdfaff}';
        styleEl.textContent += '.nexus-logo-svg{display:block;width:48px;height:48px;overflow:visible;shape-rendering:geometricPrecision}.nexus-loader__mark{width:5.2em;height:5.2em;margin-bottom:1.05em}.nexus-loader__mark .nexus-logo-svg{width:100%;height:100%;filter:drop-shadow(0 .55em 1.15em rgba(18,214,223,.24))}.nexus--button{display:flex;align-items:center;gap:.45em}.nexus--button .nexus-menu-icon{display:none!important}.nexus--button .nexus-logo-svg{width:1.55em!important;height:1.55em!important;min-width:1.55em;min-height:1.55em;flex:none;filter:drop-shadow(0 .18em .34em rgba(18,214,223,.26))}.nexus--button span{display:inline-block}.nexus-controls-hidden{display:none!important}';
        styleEl.textContent += '.lumio-prestige__progress{display:none;position:absolute;left:1.15em;right:1.15em;bottom:.78em;height:.22em;overflow:hidden;border-radius:2em;background:rgba(255,255,255,.13)}.lumio-prestige__progress i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#12d6df,#9b5cff);box-shadow:0 0 .65em rgba(18,214,223,.62)}.lumio-prestige__progress.nexus-progress--visible{display:block}.lumio-prestige__progress.nexus-progress--done i{background:linear-gradient(90deg,#22c55e,#6ee7b7);box-shadow:0 0 .65em rgba(34,197,94,.54)}.lumio-prestige:has(.nexus-progress--visible) .lumio-prestige__footer{margin-bottom:.55em}.lumio-prestige__badge.nexus-badge--dub{background:rgba(155,92,255,.28);color:#eadcff;font-weight:700;letter-spacing:.04em}.lumio-prestige__badge.nexus-badge--continue{background:rgba(18,214,223,.22);color:#c8fbff}.lumio-prestige__badge.nexus-badge--watched{background:rgba(34,197,94,.21);color:#b6ffd0}.lumio-prestige__badge.nexus-badge--subtitles{background:rgba(234,179,8,.22);color:#ffe9a1}';
        styleEl.textContent += '.lumio-prestige__progress.nexus-progress--visible{position:relative;left:auto;right:auto;bottom:auto;margin-top:.55em}';
        styleEl.textContent += '.lumio-prestige__head-meta{display:flex;align-items:center;gap:.45em;flex:none}.lumio-prestige__voice{display:none;font-size:.76em;padding:.24em .48em;border-radius:.4em;white-space:nowrap}.lumio-prestige__voice:not(:empty){display:block}.lumio-prestige__voice.nexus-badge--dub{background:rgba(155,92,255,.28);color:#eadcff;font-weight:700;letter-spacing:.04em}.lumio-prestige__voice.nexus-badge--subtitles{background:rgba(234,179,8,.22);color:#ffe9a1}.lumio-prestige__voice.nexus-badge--voice{background:rgba(18,214,223,.16);color:#bdfaff}';
        styleEl.textContent += '.lumio-prestige__episode-mark{display:none}.lumio-prestige.nexus-episode-card{min-height:6.65em}.nexus-episode-card .lumio-prestige__body{padding:.82em 1.05em .75em}.nexus-episode-card .lumio-prestige__media{width:4.8em;min-height:6.65em}.lumio-prestige__media--episode{display:flex;align-items:center;justify-content:center;background:linear-gradient(145deg,rgba(18,214,223,.30),rgba(79,70,229,.24) 60%,rgba(15,23,42,.88))}.lumio-prestige__media--episode .lumio-prestige__logo{display:none}.lumio-prestige__media--episode .lumio-prestige__episode-mark{display:flex;position:relative;z-index:1;flex-direction:column;align-items:center;line-height:1}.lumio-prestige__episode-mark span{font-size:.74em;font-weight:600;letter-spacing:.1em;color:rgba(255,255,255,.62)}.lumio-prestige__episode-mark b{font-size:1.5em;margin-top:.18em;letter-spacing:.02em;color:#fff}.nexus-episode-tone-1{background:linear-gradient(145deg,rgba(34,197,94,.30),rgba(18,214,223,.15) 60%,rgba(15,23,42,.88))}.nexus-episode-tone-2{background:linear-gradient(145deg,rgba(155,92,255,.34),rgba(244,114,182,.15) 60%,rgba(15,23,42,.88))}.nexus-episode-tone-3{background:linear-gradient(145deg,rgba(250,204,21,.27),rgba(249,115,22,.16) 60%,rgba(15,23,42,.88))}.nexus-episode-card .lumio-prestige__footer{margin-top:.35em!important}.nexus-episode-card .lumio-prestige__progress{display:block;position:relative;left:auto;right:auto;bottom:auto;height:.2em;margin-top:.5em;visibility:hidden}.nexus-episode-card .lumio-prestige__progress.nexus-progress--visible{visibility:visible}';
        styleEl.textContent += '.nexus-episode-card .lumio-prestige__title{font-size:1.34em}.nexus-episode-card .lumio-prestige__info{font-size:.94em}';
        document.head.appendChild(styleEl);
    }

    var Network = Lampa.Reguest;

    // Lampac validates generated proxy links against this shared session ID.
    // It is a protocol value, not Lumio's own preference.
    var unic_id = Lampa.Storage.get('lampac_unic_id', '');
    if (!unic_id) {
        unic_id = Lampa.Utils.uid(8).toLowerCase();
        Lampa.Storage.set('lampac_unic_id', unic_id);
    }

    // One small aggregate only, at most once per ten minutes. It contains no
    // title, URL, IP address, account data, or individual request history.
    var NEXUS_TELEMETRY_ENABLED = !!CONFIG.lumioTelemetry; // [V10] по умолчанию выключена
    var NEXUS_TELEMETRY_URL = 'https://beta.mitsu.tv/lumio-telemetry.php';
    var NEXUS_TELEMETRY_INTERVAL = 15 * 60 * 1000;
    var nexusTelemetry = (function () {
        var counters = {};
        var sources = {};
        var lastSent = 0;
        var flushTimer = 0;

        function add(target, key, amount) {
            target[key] = Math.min(50, (target[key] || 0) + (amount || 1));
        }

        function sourceKey(name) {
            return String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
        }

        function hasData() {
            return Object.keys(counters).length || Object.keys(sources).length;
        }

        function schedule() {
            if (flushTimer || !hasData()) return;
            var delay = Math.max(1000, NEXUS_TELEMETRY_INTERVAL - (Date.now() - lastSent));
            flushTimer = setTimeout(function () {
                flushTimer = 0;
                flush(false);
            }, delay);
        }

        function flush(force) {
            if (!NEXUS_TELEMETRY_ENABLED || !hasData()) return;
            if (!force && Date.now() - lastSent < NEXUS_TELEMETRY_INTERVAL) {
                schedule();
                return;
            }

            var payload = JSON.stringify({
                uid: unic_id,
                version: NEXUS_VERSION,
                counters: counters,
                sources: sources
            });

            counters = {};
            sources = {};
            lastSent = Date.now();

            try {
                if (navigator.sendBeacon) {
                    navigator.sendBeacon(NEXUS_TELEMETRY_URL, new Blob([payload], { type: 'text/plain;charset=UTF-8' }));
                    return;
                }
            } catch (e) {}

            try {
                if (window.fetch) {
                    window.fetch(NEXUS_TELEMETRY_URL, {
                        method: 'POST',
                        mode: 'cors',
                        credentials: 'omit',
                        keepalive: true,
                        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                        body: payload
                    }).catch(function () {});
                }
            } catch (e2) {}
        }

        function event(name) {
            if (!NEXUS_TELEMETRY_ENABLED) return;
            add(counters, name, 1);
            flush(false);
        }

        function source(name, metric, value) {
            if (!NEXUS_TELEMETRY_ENABLED) return;
            name = sourceKey(name);
            if (!name) return;
            if (!sources[name]) sources[name] = {};
            if (metric === 'latency_ms_sum') {
                sources[name][metric] = Math.min(600000, (sources[name][metric] || 0) + Math.max(0, Math.round(value || 0)));
            } else {
                add(sources[name], metric, value || 1);
            }
            flush(false);
        }

        function latency(name, ms) {
            if (!isFinite(ms) || ms < 0) return;
            source(name, 'latency_count', 1);
            source(name, 'latency_ms_sum', ms);
        }

        try {
            var sessionKey = 'lumio_telemetry_session_' + NEXUS_VERSION;
            var sessionDay = new Date().toISOString().slice(0, 10);
            if (Lampa.Storage.get(sessionKey, '') !== sessionDay) {
                Lampa.Storage.set(sessionKey, sessionDay);
                event('session');
            }
        } catch (e3) {}

        window.addEventListener('pagehide', function () { flush(true); });
        return { event: event, source: source, latency: latency, flush: flush };
    })();
    window.nexusLumioTelemetry = nexusTelemetry;

    function accountUrl(url) {
    url = String(url);

    if (url.indexOf('uid=') === -1) {
        var uid = Lampa.Storage.get('lampac_unic_id', '');
        if (uid) url = Lampa.Utils.addUrlComponent(url, 'uid=' + encodeURIComponent(uid));
    }

    if (url.indexOf('nws_id=') === -1) {
        var nwsid = Lampa.Storage.get('lampac_nws_id', '') || Lampa.Storage.get('lampac_nwsid', '');
        if (nwsid) url = Lampa.Utils.addUrlComponent(url, 'nws_id=' + encodeURIComponent(nwsid));
    }

    return url;
}

function addHeaders() {
    var kit_aesgcmkey = Lampa.Storage.get('kit_aesgcmkey', '');
    if (kit_aesgcmkey) {
        return { 'X-Kit-AesGcm': kit_aesgcmkey };
    }
    return {};
}

    // RCH is required by a few Lampac providers. Keep the client private to
    // Lumio so it cannot alter the state or handlers of other online plugins.
    var nexusRch = {
        client: null,
        state: 'idle',
        type: '',
        waiters: [],
        scriptLoading: false,
        typeLoading: false
    };

    function nexusRchType() {
        return nexusRch.type || (Lampa.Platform.is('android') ? 'apk' : 'cors');
    }

    function nexusRchResolveType(done) {
        if (nexusRch.type) {
            done();
            return;
        }

        if (Lampa.Platform.is('android')) {
            nexusRch.type = 'apk';
            done();
            return;
        }

        if (Lampa.Platform.is('tizen')) {
            nexusRch.type = 'cors';
            done();
            return;
        }

        if (nexusRch.typeLoading) return;
        nexusRch.typeLoading = true;

        var check = new Network();
        check.timeout(3500);
        check.silent(NEXUS_HOST + '/cors/check', function () {
            nexusRch.type = 'cors';
            nexusRch.typeLoading = false;
            done();
        }, function () {
            nexusRch.type = 'web';
            nexusRch.typeLoading = false;
            done();
        }, false, {
            dataType: 'text',
            headers: addHeaders()
        });
    }

    function nexusRchWsUrl() {
        return NEXUS_HOST
            .replace(/^https:/i, 'wss:')
            .replace(/^http:/i, 'ws:')
            .replace(/\/api\/?$/i, '') + '/nws';
    }

    function nexusRchFinish(ok, error) {
        var waiters = nexusRch.waiters.splice(0);
        waiters.forEach(function (waiter) {
            if (ok) waiter.success();
            else if (waiter.error) waiter.error(error || {});
        });
    }

    function nexusRchPostResult(uri, rchId, html) {
        $.ajax({
            url: accountUrl(NEXUS_HOST + '/rch/' + uri + '?id=' + encodeURIComponent(rchId)),
            type: 'POST',
            data: html,
            async: true,
            cache: false,
            contentType: false,
            processData: false,
            headers: addHeaders(),
            success: function () {
                nexusLog('[Lumio RCH] result delivered:', uri, rchId);
            },
            error: function () {
                nexusLog('[Lumio RCH] result delivery failed:', uri, rchId);
                if (nexusRch.client) nexusRch.client.invoke('RchResult', rchId, '');
            }
        });
    }

    function nexusRchSendResult(rchId, html) {
        if (Lampa.Arrays.isObject(html) || Lampa.Arrays.isArray(html)) {
            html = JSON.stringify(html);
        }

        html = html == null ? '' : String(html);

        if (typeof CompressionStream === 'undefined' || typeof TextEncoder === 'undefined' || html.length <= 1000) {
            nexusRchPostResult('result', rchId, html);
            return;
        }

        try {
            var stream = new CompressionStream('gzip');
            var readable = new ReadableStream({
                start: function (controller) {
                    controller.enqueue(new TextEncoder().encode(html));
                    controller.close();
                }
            });

            new Response(readable.pipeThrough(stream)).arrayBuffer().then(function (buffer) {
                var zipped = new Uint8Array(buffer);
                nexusRchPostResult(zipped.length < html.length ? 'gzresult' : 'result', rchId, zipped.length < html.length ? zipped : html);
            }).catch(function () {
                nexusRchPostResult('result', rchId, html);
            });
        } catch (e) {
            nexusRchPostResult('result', rchId, html);
        }
    }

    function nexusRchHandleRequest(rchId, url, data, headers, returnHeaders) {
        var network = new Lampa.Reguest();

        nexusLog('[Lumio RCH] request:', rchId, url);

        // [V10] удалённый eval можно запретить через CONFIG.lumioRemoteEval
        if ((url === 'eval' || url === 'evalrun') && !CONFIG.lumioRemoteEval) {
            if (url === 'eval') nexusRchSendResult(rchId, '');
            return;
        }

        if (url === 'eval') {
            try {
                // Lampac sends these helpers only through this authenticated RCH socket.
                nexusRchSendResult(rchId, eval(data));
            } catch (e) {
                nexusRchSendResult(rchId, '');
            }
            return;
        }

        if (url === 'evalrun') {
            try { eval(data); } catch (e2) {}
            return;
        }

        if (url === 'ping') {
            nexusRchSendResult(rchId, 'pong');
            return;
        }

        network.native(url, function (result) {
            nexusLog('[Lumio RCH] request completed:', rchId, String(result || '').length + ' bytes');
            nexusRchSendResult(rchId, result);
        }, function () {
            nexusLog('[Lumio RCH] request failed:', rchId, url);
            nexusRchSendResult(rchId, '');
        }, data, {
            dataType: 'text',
            timeout: 8000,
            headers: headers || {},
            returnHeaders: returnHeaders
        });
    }

    function nexusRchConnect() {
        if (typeof window.NativeWsClient === 'undefined') {
            nexusRch.state = 'failed';
            nexusRch.scriptLoading = false;
            nexusRchFinish(false, { msg: 'Не удалось загрузить клиент RCH' });
            return;
        }

        var client = nexusRch.client = new window.NativeWsClient(nexusRchWsUrl(), {
            autoReconnect: true,
            onClose: function () {
                if (nexusRch.state === 'ready') nexusRch.state = 'connecting';
            },
            onError: function (error) {
                nexusLog('[Lumio] RCH websocket error:', error);
            }
        });

        client.on('Connected', function () {
            nexusRch.state = 'registering';
            nexusLog('[Lumio] RCH connected, registering device');
            client.invoke('RchRegistry', {
                host: location.host,
                rchtype: nexusRchType(),
                apkVersion: Lampa.Platform.is('android') ? parseInt(((navigator.userAgent || '').match(/Android\s+(\d+)/i) || [])[1] || 0, 10) : 0,
                player: Lampa.Storage.field('player')
            });
        });

        client.on('RchRegistry', function () {
            nexusRch.state = 'ready';
            nexusLog('[Lumio] RCH ready');
            nexusLog('[Lumio RCH] ready:', nexusRchType(), client.connectionId || '');
            nexusRchFinish(true);
        });

        client.on('RchClient', nexusRchHandleRequest);
        client.connect();
    }

    function nexusRchEnsure(success, error) {
        if (nexusRch.state === 'ready' && nexusRch.client && nexusRch.client.connectionId != null) {
            success();
            return;
        }

        nexusRch.waiters.push({ success: success, error: error });

        if (nexusRch.state === 'connecting' || nexusRch.state === 'registering' || nexusRch.scriptLoading) return;

        nexusRch.state = 'connecting';

        nexusRchResolveType(function () {
        if (typeof window.NativeWsClient !== 'undefined') {
            nexusRchConnect();
            return;
        }

        nexusRch.scriptLoading = true;
        var script = document.createElement('script');
        script.src = NEXUS_HOST + '/js/nws-client-es5.js?v21042026';
        script.onload = function () {
            nexusRch.scriptLoading = false;
            nexusRchConnect();
        };
        script.onerror = function () {
            nexusRch.state = 'failed';
            nexusRch.scriptLoading = false;
            nexusRchFinish(false, { msg: 'Не удалось подключиться к RCH' });
        };
        document.head.appendChild(script);
        });
    }

    function nexusRchRequestUrl(url) {
        if (!url) return url;

        var type = encodeURIComponent(nexusRchType());
        if (/[?&]rchtype=/.test(url)) {
            return url.replace(/([?&]rchtype=)[^&]*/i, '$1' + type);
        }

        return Lampa.Utils.addUrlComponent(url, 'rchtype=' + type);
    }

    function nexusRchResponse(data) {
        var json = data;

        if (typeof json === 'string') {
            try {
                json = JSON.parse(json);
            } catch (e) {
                return null;
            }
        }

        return json && json.rch ? json : null;
    }

    function nexusPlainText(value) {
        return String(value == null ? '' : value)
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function nexusPidtorDetails(item) {
        var details = [];
        var quality = item.quality;
        var size = item.size_name || item.sizeName || item.filesize || item.file_size || item.torrent_size || item.size;
        var seeds = item.seeders || item.seeds || item.sid || item.peers;

        function add(value) {
            value = nexusPlainText(value);
            if (value && details.indexOf(value) === -1) details.push(value);
        }

        if (typeof quality === 'string' && quality) add(quality);
        else if (quality && typeof quality === 'object') {
            var variants = Object.keys(quality).filter(Boolean);
            if (variants.length) add(variants.join(', '));
        } else if (item.maxquality) {
            add(item.maxquality + 'p');
        }

        var voiceParts = nexusPlainText(item.voice_name || '').split(/\s*\/\s*/).filter(Boolean);
        voiceParts.forEach(function (part, index) {
            if (/^\d+$/.test(part) && (index === voiceParts.length - 1 || index > 0)) {
                add('Сиды: ' + part);
            } else {
                add(part);
            }
        });

        if (details.length && item.maxquality) {
            var maxquality = item.maxquality + 'p';
            if (details[0] !== maxquality && details.indexOf(maxquality) === -1) details.unshift(maxquality);
        }

        if (size !== undefined && size !== null && size !== '') {
            if (typeof size === 'number' && size > 1024) {
                var units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
                var index = 0;
                while (size >= 1024 && index < units.length - 1) {
                    size /= 1024;
                    index++;
                }
                size = (size >= 10 || index === 0 ? Math.round(size) : Math.round(size * 10) / 10) + ' ' + units[index];
            }
            add(size);
        }

        if (seeds !== undefined && seeds !== null && seeds !== '') {
            add('Сиды: ' + seeds);
        }

        return details.join(' · ');
    }

    function nexusPidtorKey(item) {
        var url = String(item.stream || item.url || '');

        // Tracker parameters describe the same torrent and should not create
        // several visually identical cards for a single hash.
        url = url.replace(/([?&])tr=[^&]*/gi, '$1').replace(/[?&]$/, '').replace('?&', '?');
        return [url, item.method || '', item.season || '', item.episode || ''].join('|');
    }

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function nexusLog() {
    if (NEXUS_DEBUG && window.console && console.log) {
        console.log.apply(console, arguments);
    }
}

function cleanImageUrl(url) {
    if (!url) return '';

    url = String(url);

    var cssUrl = url.match(/url\((['"]?)(.*?)\1\)/i);
    if (cssUrl && cssUrl[2]) url = cssUrl[2];

    if (url.indexOf('//') === 0) url = 'https:' + url;
    if (/^https?:\/\//i.test(url)) return url;

    if (url.charAt(0) === '/') {
        return 'https://image.tmdb.org/t/p/w342' + url;
    }

    return url;
}

function movieImage(movie) {
    movie = movie || {};

    var direct = movie.img || movie.poster || movie.cover || movie.image || movie.picture || movie.poster_path || movie.backdrop || movie.backdrop_path;
    if (direct) return cleanImageUrl(direct);

    try {
        if (Lampa.Utils.cardImg) return cleanImageUrl(Lampa.Utils.cardImg(movie));
    } catch (e) {}

    try {
        if (Lampa.Utils.cardImgBackground) return cleanImageUrl(Lampa.Utils.cardImgBackground(movie));
    } catch (e2) {}

    return '';
}

function mediaTemplateData(movie) {
    var img = movieImage(movie);

    return {
        media_class: img ? 'lumio-prestige__media--poster' : 'lumio-prestige__media--logo',
        media_style: img ? 'background-image:url(&quot;' + escapeHtml(img) + '&quot;)' : ''
    };
}

function stableIndex(value, max) {
    value = String(value || '');
    max = max || 1;

    var hash = 0;
    for (var i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash |= 0;
    }

    return Math.abs(hash) % max;
}

function voiceMediaTemplateData(title, tone) {
    var index = parseInt(tone, 10);
    if (isNaN(index)) index = stableIndex(title, 12);

    return {
        media_class: 'lumio-prestige__media--voice nexus-voice-tone-' + (index % 12),
        media_style: ''
    };
}

function episodeMediaTemplateData(season, episode) {
    season = parseInt(season || 0, 10) || 1;
    episode = parseInt(episode || 0, 10) || 0;

    return {
        media_class: 'lumio-prestige__media--episode nexus-episode-tone-' + (stableIndex(season + ':' + episode, 4)),
        media_style: '',
        media_overline: 'S' + season,
        media_label: 'E' + (episode < 10 ? '0' : '') + episode
    };
}

function movieCacheKey(movie) {
    movie = movie || {};

    var year = String(movie.release_date || movie.first_air_date || '0000').slice(0, 4);
    var raw = [
        movie.source || Lampa.Storage.field('source') || 'tmdb',
        movie.id || movie.tmdb_id || movie.imdb_id || movie.kinopoisk_id || movie.title || movie.name || '',
        movie.name ? 'serial' : 'movie',
        year
    ].join(':').toLowerCase();

    return 'lumio_sources_v127_' + encodeURIComponent(raw).replace(/%/g, '_').slice(0, 180);
}

// [V10] Кэш Lumio раньше рос без ограничений (каждый просмотренный тайтл/серия
// оставляли запись в localStorage навсегда) → на ТВ это приводило к переполнению
// хранилища. Теперь устаревшие записи чистятся при старте, а при ошибке записи
// кэш ужимается и запись повторяется.
function lumioCacheKeys() {
    var out = [];
    try {
        if (!window.localStorage) return out;
        Object.keys(localStorage).forEach(function (key) {
            if (key.indexOf('lumio_content_') === 0 || key.indexOf('lumio_sources_') === 0) out.push(key);
        });
    } catch (e) {}
    return out;
}

function lumioPruneCache(hard) {
    try {
        var now = Date.now();
        var entries = [];

        lumioCacheKeys().forEach(function (key) {
            var isContent = key.indexOf('lumio_content_') === 0;
            var time = 0;
            try {
                var v = JSON.parse(localStorage.getItem(key));
                time = v && v.time ? v.time : 0;
            } catch (e) {}

            // списки источников используются как «устаревший» запасной вариант — держим сутки
            var ttl = isContent ? NEXUS_CONTENT_CACHE_TTL : NEXUS_CACHE_TTL * 4;
            if (!time || (now - time) > ttl) {
                removeStorageKey(key);
                return;
            }
            entries.push({ key: key, time: time });
        });

        var limit = hard ? 20 : 120;
        if (entries.length > limit) {
            entries.sort(function (a, b) { return a.time - b.time; });
            entries.slice(0, entries.length - limit).forEach(function (item) {
                removeStorageKey(item.key);
            });
        }
    } catch (e2) {}
}

function lumioClearCache() {
    lumioCacheKeys().forEach(removeStorageKey);
    removeStorageKey('lumio_source_latency');
}

function lumioCacheSet(key, value) {
    try {
        Lampa.Storage.set(key, value);
    } catch (e) {
        lumioPruneCache(true);
        try { Lampa.Storage.set(key, value); } catch (e2) {}
    }
}

// [V10] Карточки из источника V10 нельзя отдавать в Lumio как есть:
//  - source = «V10_21» серверу Lampac неизвестен → подменяем на tmdb (id — TMDB);
//  - Lumio считает сериалом всё, у чего есть `name`, поэтому фильмам `name` убираем.
function lumioPrepareMovie(movie) {
    if (!movie || movie.source !== SOURCE_NAME) return movie;

    var m = {};
    for (var k in movie) {
        if (Object.prototype.hasOwnProperty.call(movie, k)) m[k] = movie[k];
    }

    var serial = m.method === 'tv' || m.type === 'tv';
    m.source = 'tmdb';

    if (serial) {
        if (!m.name) m.name = m.title || '';
        if (!m.original_name) m.original_name = m.original_title || m.name;
        if (!m.first_air_date && m.release_date) m.first_air_date = m.release_date;
    } else {
        delete m.name;
    }

    return m;
}

function readSourcesCache(movie, allowExpired) {
    var saved = Lampa.Storage.get(movieCacheKey(movie), null);
    if (!saved || !saved.items || !saved.time) return null;
    if (!allowExpired && (Date.now() - saved.time) > NEXUS_CACHE_TTL) return null;
    return saved.items;
}

function saveSourcesCache(movie, items) {
    if (!items || !items.length) return;
    lumioCacheSet(movieCacheKey(movie), {
        time: Date.now(),
        items: filterWorkingSources(items)
    });
}

function isWorkingSource(j) {
    if (!j || !j.url) return false;

    return NEXUS_SOURCE_ORDER.indexOf(balanserName(j)) >= 0;
}

function filterWorkingSources(items) {
    if (!items || !items.length) return [];

    return items.filter(function (j) {
        return isWorkingSource(j);
    });
}

function sourceRank(name) {
    name = String(name || '').toLowerCase();

    var index = NEXUS_SOURCE_ORDER.indexOf(name);
    return index >= 0 ? index : 1000;
}

function sortSourceKeys(keys) {
    return (keys || []).map(function (key, index) {
        return { key: key, index: index };
    }).sort(function (a, b) {
        var rankA = sourceRank(a.key);
        var rankB = sourceRank(b.key);

        if (rankA !== rankB) return rankA - rankB;
        return a.index - b.index;
    }).map(function (item) {
        return item.key;
    });
}

function contentCacheKey(url) {
    var value = String(url || '');
    var forward = 5381;
    var backward = 5381;
    var i;

    // The former truncated URL key treated a long normal request and its
    // `quality=true` variant as the same cache entry. Hash the complete URL
    // while keeping the storage key compact for older Lampa environments.
    for (i = 0; i < value.length; i++) {
        forward = ((forward << 5) + forward) ^ value.charCodeAt(i);
        backward = ((backward << 5) + backward) ^ value.charCodeAt(value.length - 1 - i);
    }

    return 'lumio_content_v128_' +
        (forward >>> 0).toString(36) + '_' +
        (backward >>> 0).toString(36) + '_' +
        value.length;
}

function readContentCache(url) {
    var saved = Lampa.Storage.get(contentCacheKey(url), null);
    if (!saved || !saved.data || !saved.time) return null;
    if ((Date.now() - saved.time) > NEXUS_CONTENT_CACHE_TTL) return null;
    return saved.data;
}

function saveContentCache(url, data) {
    if (!url || !data) return;

    lumioCacheSet(contentCacheKey(url), {
        time: Date.now(),
        data: data
    });
}

var nexusPrefetch = {};
var nexusContentPrefetch = {};

function loadContent(url, options, call, fail) {
    options = options || {};

    if (!url) {
        if (fail) fail({});
        return;
    }

    var cached = options.cache === false ? null : readContentCache(url);
    if (cached) {
        if (call) call(cached, true);
        return;
    }

    if (nexusContentPrefetch[url]) {
        nexusContentPrefetch[url].calls.push(call);
        nexusContentPrefetch[url].fails.push(fail);
        return;
    }

    nexusContentPrefetch[url] = {
        calls: [call],
        fails: [fail]
    };

    var contentNetwork = new Network();

    contentNetwork.timeout(options.timeout || NEXUS_CONTENT_TIMEOUT);
    contentNetwork['native'](
        accountUrl(url),
        function (data) {
            var waiters = nexusContentPrefetch[url];
            saveContentCache(url, data);
            delete nexusContentPrefetch[url];

            waiters.calls.forEach(function (fn) {
                if (fn) fn(data, false);
            });
        },
        function (e) {
            var waiters = nexusContentPrefetch[url];
            delete nexusContentPrefetch[url];

            waiters.fails.forEach(function (fn) {
                if (fn) fn(e || {});
            });
        },
        false,
        {
            dataType: 'text',
            headers: addHeaders()
        }
    );
}

function loadSources(movie, call, fail, fast, idsReady) {
    if (!movie) {
        fail && fail({});
        return;
    }

    if (!idsReady) {
        resolveExternalIds(movie, function () {
            loadSources(movie, call, fail, fast, true);
        });
        return;
    }

    var key = movieCacheKey(movie) + (fast ? ':fast' : ':open');
    var cached = readSourcesCache(movie);

    if (cached && cached.length) {
        call(cached);
        return;
    }

    if (nexusPrefetch[key]) {
        nexusPrefetch[key].calls.push(call);
        nexusPrefetch[key].fails.push(fail);
        return;
    }

    nexusPrefetch[key] = {
        calls: [call],
        fails: [fail]
    };

    var url = requestParams(NEXUS_HOST + '/lite/events?life=false', movie);

    function finishSuccess(items) {
        var waiters = nexusPrefetch[key];
        delete nexusPrefetch[key];

        saveSourcesCache(movie, items);

        waiters.calls.forEach(function (fn) {
            if (fn) fn(items);
        });
    }

    function finishFail(e) {
        var waiters = nexusPrefetch[key];
        var stale = readSourcesCache(movie, true);
        delete nexusPrefetch[key];

        if (stale && stale.length) {
            waiters.calls.forEach(function (fn) {
                if (fn) fn(stale);
            });
            return;
        }

        waiters.fails.forEach(function (fn) {
            if (fn) fn(e || {});
        });
    }

    function requestAttempt(attempt) {
        var sourceNetwork = new Network();
        var maxAttempts = fast ? 2 : NEXUS_SOURCE_ATTEMPTS;

        sourceNetwork.timeout(timeoutForAttempt(fast ? 8000 : 14000, attempt));
        sourceNetwork.silent(
            url,
            function (json) {
                var filtered = filterWorkingSources(json || []);

                if (filtered.length) {
                    finishSuccess(filtered);
                } else if (attempt + 1 < maxAttempts) {
                    setTimeout(function () {
                        requestAttempt(attempt + 1);
                    }, 500 + attempt * 700);
                } else {
                    finishFail({ msg: 'Server did not return working sources' });
                }
            },
            function (e) {
                if (attempt + 1 < maxAttempts) {
                    setTimeout(function () {
                        requestAttempt(attempt + 1);
                    }, 650 + attempt * 850);
                    return;
                }

                finishFail(e || {});
            },
            false,
            {
                headers: addHeaders()
            }
        );
    }

    requestAttempt(0);
}

    function requestParams(baseUrl, movie, extraParams) {
    var cardSource = movie.source || Lampa.Storage.field('source') || 'tmdb';
    var q = [];

    q.push('id=' + encodeURIComponent(movie.id || ''));
    q.push('title=' + encodeURIComponent(movie.title || movie.name || ''));
    q.push('original_title=' + encodeURIComponent(movie.original_title || movie.originaltitle || movie.original_name || movie.originalname || ''));
    q.push('serial=' + (movie.name ? 1 : 0));
    q.push('year=' + String(movie.release_date || movie.first_air_date || '0000').slice(0, 4));
    q.push('source=' + encodeURIComponent(cardSource));
    q.push('original_language=' + encodeURIComponent(movie.original_language || ''));

    if (movie.imdb_id || movie.imdbid) {
        q.push('imdb_id=' + encodeURIComponent(movie.imdb_id || movie.imdbid));
    }

    if (movie.kinopoisk_id || movie.kinopoiskid) {
        q.push('kinopoisk_id=' + encodeURIComponent(movie.kinopoisk_id || movie.kinopoiskid));
    }

    if (movie.tmdb_id) {
        q.push('tmdb_id=' + encodeURIComponent(movie.tmdb_id));
    }

    q.push('rchtype=' + encodeURIComponent(nexusRch.type || ''));

    if (extraParams) {
        Object.keys(extraParams).forEach(function (key) {
            if (extraParams[key] !== undefined && extraParams[key] !== null && extraParams[key] !== '') {
                q.push(encodeURIComponent(key) + '=' + encodeURIComponent(extraParams[key]));
            }
        });
    }

    var sep = baseUrl.indexOf('?') >= 0 ? '&' : '?';
    return accountUrl(baseUrl + sep + q.join('&'));
}

var nexusExternalIdRequests = {};

function resolveExternalIds(movie, done) {
    if (!movie || (movie.imdb_id && movie.kinopoisk_id)) {
        done();
        return;
    }

    var key = [
        movie.source || Lampa.Storage.field('source') || 'tmdb',
        movie.id || movie.tmdb_id || '',
        movie.name ? 'serial' : 'movie'
    ].join(':');

    if (nexusExternalIdRequests[key]) {
        nexusExternalIdRequests[key].push(done);
        return;
    }

    nexusExternalIdRequests[key] = [done];

    function finish(data) {
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) { data = null; }
        }

        if (data && typeof data === 'object') {
            var imdb = data.imdb_id || data.imdbid;
            var kinopoisk = data.kinopoisk_id || data.kinopoiskid || data.kp_id;

            if (imdb) movie.imdb_id = imdb;
            if (kinopoisk) movie.kinopoisk_id = kinopoisk;
        }

        var callbacks = nexusExternalIdRequests[key] || [];
        delete nexusExternalIdRequests[key];
        callbacks.forEach(function (callback) { callback(); });
    }

    var network = new Network();
    var query = [
        'id=' + encodeURIComponent(movie.id || ''),
        'serial=' + (movie.name ? 1 : 0)
    ];

    if (movie.imdb_id || movie.imdbid) {
        query.push('imdb_id=' + encodeURIComponent(movie.imdb_id || movie.imdbid));
    }

    if (movie.kinopoisk_id || movie.kinopoiskid) {
        query.push('kinopoisk_id=' + encodeURIComponent(movie.kinopoisk_id || movie.kinopoiskid));
    }

    network.timeout(6000);
    network.silent(
        accountUrl(NEXUS_HOST + '/externalids?' + query.join('&')),
        finish,
        function () { finish(null); },
        false,
        { headers: addHeaders() }
    );
}

    function balanserName(j) {
        var bals = j.balanser;
        var name = (j.name || '').split(' ')[0];
        var key = (bals || name).toLowerCase();
        return NEXUS_SOURCE_ALIASES[key] || key;
    }

    function sourceDisplayName(j, name) {
        if (name === 'pidtor') return 'PidTor (beta)';
        if (name === NEXUS_ORIGINAL_SUBS_SOURCE) return NEXUS_ORIGINAL_SUBS_LABEL;
        return j.name || name;
    }

    function nexusSourceKey(name) {
        name = String(name || '').toLowerCase();
        return NEXUS_SOURCE_ALIASES[name] || name;
    }

    function nexusQualityRequestUrl(name, url) {
        name = nexusSourceKey(name);

        if (
            (name !== 'cdnvideohub' && name !== 'veoveo') ||
            !url ||
            String(url).indexOf('/lite/' + name) === -1 ||
            /[?&]quality=/i.test(url)
        ) {
            return url;
        }

        return Lampa.Utils.addUrlComponent(url, 'quality=true');
    }

    function nexusQualityLabels(quality) {
        if (quality && typeof quality === 'object') return Object.keys(quality).join(', ');
        if (typeof quality === 'string') return quality;
        return '';
    }

    function nexusQualityHeight(value) {
        var match = String(value || '').match(/(\d{3,4})/);
        if (!match) return 0;

        var height = parseInt(match[1], 10);
        if (height >= 1800) return 2160;
        if (height >= 1200) return 1440;
        if (height >= 900) return 1080;
        if (height >= 600) return 720;
        if (height >= 420) return 480;
        if (height >= 300) return 360;
        return 0;
    }

    function nexusQualityLadder(value) {
        var height = nexusQualityHeight(value);
        var ladders = {
            2160: ['2160p', '1440p', '1080p', '720p', '480p', '360p'],
            1440: ['1440p', '1080p', '720p', '480p', '360p'],
            1080: ['1080p', '720p', '480p', '360p'],
            720: ['720p', '480p', '360p'],
            480: ['480p', '360p'],
            360: ['360p']
        };

        return ladders[height] || [];
    }
    
    function qualityBadge(quality) {
    if (!quality || typeof quality !== 'object') return null;

    var keys = Object.keys(quality).join(' ').toLowerCase();

    if (/2160|4k|uhd/.test(keys)) return { label: '4K', css: 'nexus-badge--uhd' };
    if (/1440|2k/.test(keys)) return { label: '2K', css: 'nexus-badge--uhd' };
    if (/1080|720|hd/.test(keys)) return { label: 'HD', css: 'nexus-badge--hd' };
    if (/480|360|240|sd/.test(keys)) return { label: 'SD', css: 'nexus-badge--sd' };

    return null;
}

    // Keep the ranking deterministic and source-independent.  A source only
    // decides which tracks exist; Lumio decides how familiar labels are shown.
    function nexusVoiceMeta(value) {
        var raw = String(value || '').replace(/\s+/g, ' ').trim();
        var search = raw.toLowerCase().replace(/\u0451/g, '\u0435');
        var compact = search.replace(/[^a-z0-9\u0400-\u04ff]+/g, ' ').replace(/\s+/g, ' ').trim();
        var type = 'unknown';
        var label = '\u041e\u0437\u0432\u0443\u0447\u043a\u0430';
        var badge = '';
        var badgeClass = 'nexus-badge--voice';

        if (/\b(sub|subs|subtitle|subtitles)\b|\u0441\u0443\u0431\u0442\u0438\u0442\u0440/.test(search)) {
            type = 'subtitles';
            label = '\u0421\u0443\u0431\u0442\u0438\u0442\u0440\u044b';
            badge = 'SUB';
            badgeClass = 'nexus-badge--subtitles';
        } else if (/\b(original|orig|eng|en)\b|\u043e\u0440\u0438\u0433\u0438\u043d\u0430\u043b/.test(search)) {
            type = 'original';
            label = '\u041e\u0440\u0438\u0433\u0438\u043d\u0430\u043b';
            badge = 'ORIG';
        } else if (/\b(dub|dubbing|dubbed)\b|\u0434\u0443\u0431\u043b\u044f\u0436|\u0434\u0443\u0431\u043b\u0438\u0440|dragon money|movie dubbing|red head sound|pifagor/.test(search)) {
            type = 'dub';
            label = '\u0414\u0443\u0431\u043b\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0439';
            badge = 'DUB';
            badgeClass = 'nexus-badge--dub';
        } else if (/\b(mvo|multi voice|multivoice)\b|\u043c\u043d\u043e\u0433\u043e\u0433\u043e\u043b/.test(search)) {
            type = 'mvo';
            label = '\u041c\u043d\u043e\u0433\u043e\u0433\u043e\u043b\u043e\u0441\u044b\u0439';
            badge = 'MVO';
        } else if (/\b(avo|author voice)\b|\u0430\u0432\u0442\u043e\u0440\u0441\u043a/.test(search)) {
            type = 'avo';
            label = '\u0410\u0432\u0442\u043e\u0440\u0441\u043a\u0438\u0439';
            badge = 'AVO';
        } else if (/\b(vo|voice over)\b|\u043e\u0434\u043d\u043e\u0433\u043e\u043b/.test(search)) {
            type = 'vo';
            label = '\u041e\u0434\u043d\u043e\u0433\u043e\u043b\u043e\u0441\u044b\u0439';
            badge = 'VO';
        } else if (/hd\s*rezka|hdrezka|rezka|lostfilm|newstudio|tvshows|le\s*production|coldfilm|baibako|alexfilm|jaskier|kerob|rudub|flarrow/.test(compact)) {
            type = 'studio';
        }

        var providerOrder = [
            /dragon money/, /movie dubbing/, /red head sound/, /pifagor/,
            /hd\s*rezka|hdrezka|rezka/, /lostfilm/, /newstudio/, /tvshows/,
            /le\s*production/, /alexfilm/, /jaskier/, /coldfilm/, /baibako/,
            /kerob/, /rudub/, /flarrow/
        ];
        // A bare "DUB"/"Дублированный" is normally the source's primary
        // official track, so it wins inside the dubbed group too.
        var providerRank = (type === 'dub' && /^(?:dub|dubbing|dubbed|\u0434\u0443\u0431\u043b\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0439|\u0434\u0443\u0431\u043b\u044f\u0436)$/.test(compact)) ? -1 : 5000;
        for (var i = 0; i < providerOrder.length; i++) {
            if (providerOrder[i].test(compact)) {
                providerRank = i;
                break;
            }
        }

        var typeRank = { dub: 0, studio: 1, mvo: 1, avo: 2, vo: 3, unknown: 4, original: 9, subtitles: 10 };
        var display = raw.replace(/^\s*(?:(?:dub|mvo|avo|vo)|\u0434\u0443\u0431\u043b\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0439|\u0434\u0443\u0431\u043b\u044f\u0436)\s*(?:[|:\/-]\s*)?/i, '').trim();
        var canonicalTitles = [
            [/dragon money/, 'Dragon Money Studio'], [/movie dubbing/, 'Movie Dubbing'],
            [/red head sound/, 'Red Head Sound'], [/pifagor/, 'Пифагор'],
            [/hd\s*rezka|hdrezka|rezka/, 'HDRezka Studio'], [/lostfilm/, 'LostFilm'],
            [/newstudio/, 'NewStudio'], [/tvshows/, 'TVShows'], [/le\s*production/, 'LE-Production'],
            [/alexfilm/, 'AlexFilm'], [/jaskier/, 'Jaskier'], [/coldfilm/, 'Coldfilm'],
            [/baibako/, 'BaibaKo'], [/kerob/, 'Kerob'], [/rudub/, 'RuDub'], [/flarrow/, 'Flarrow Films']
        ];
        for (var j = 0; j < canonicalTitles.length; j++) {
            if (canonicalTitles[j][0].test(compact)) {
                display = canonicalTitles[j][1];
                break;
            }
        }
        var providerKey = (display || (type === 'dub' ? 'generic' : raw) || 'default').toLowerCase().replace(/[^a-z0-9\u0400-\u04ff]+/g, '');

        return {
            key: type + ':' + providerKey,
            type: type,
            label: label,
            badge: badge,
            badge_class: badgeClass,
            rank: (Object.prototype.hasOwnProperty.call(typeRank, type) ? typeRank[type] : 4) * 10000 + providerRank,
            title: display || (type === 'dub' ? label : raw) || '\u041f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e'
        };
    }

    function nexusTimelineProgress(timeline) {
        if (!timeline || typeof timeline !== 'object') return null;

        var percent = parseFloat(timeline.percent || timeline.progress || timeline.percentage || 0);
        var position = parseFloat(timeline.time || timeline.position || timeline.currentTime || timeline.current || 0);
        var duration = parseFloat(timeline.duration || timeline.total || timeline.length || 0);

        if (percent > 0 && percent <= 1) percent *= 100;
        if ((!percent || percent > 100) && position > 0 && duration > 0) percent = position / duration * 100;
        if (!isFinite(percent) || percent < 2) return null;

        percent = Math.max(0, Math.min(100, Math.round(percent)));
        var done = percent >= 90;

        return {
            percent: percent,
            done: done,
            label: done ? '\u041f\u0440\u043e\u0441\u043c\u043e\u0442\u0440\u0435\u043d\u043e' : ('\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c ' + percent + '%')
        };
    }

    function component(object) {
        object.movie = lumioPrepareMovie(object.movie); // [V10]
        var _this    = this;
        var network  = new Network();
        var scroll   = new Lampa.Scroll({ mask: true, over: true });
        var files    = new Lampa.Explorer(object);
        var filter   = new Lampa.Filter(object);
        var last;

        var sources        = {};
        var filter_sources = [];
        var balanser       = '';
        var source_url     = '';
        var initialized    = false;
        var number_requests = 0;
        var number_requests_timer;
        var request_token = 0;
        var native_subtitles_item = null;
        var is_serial = !!(object.movie && object.movie.name);
        var filter_render = null;
        var serial_filter_button = null;
        var serial_choice_key = 'lumio_serial_choice_' + movieCacheKey(object.movie || {});
        var serial_choice = Lampa.Storage.get(serial_choice_key, { season: 0, voice: '', voice_name: '', episode: 0 });
        var serial_seasons = {};
        var serial_episode_url = '';
        var serial_auto_transition = false;
        var serial_quality_hint = '';
        var serial_coverage_queue = [];
        var serial_coverage_active = false;
        var serial_coverage_timer = null;
        var serial_coverage_token = 0;
        var serial_player_close_listener = null;
        var serial_veoveo_seasons = {};
        var loading_status_timer = null;
        var loading_status_token = 0;
        var destroyed = false;

        this.activity = object.activity;

        this.stopLoadingStatus = function () {
            loading_status_token++;

            if (loading_status_timer) {
                clearInterval(loading_status_timer);
                loading_status_timer = null;
            }
        };

        this.setLoadingStatus = function (title, text) {
            if (destroyed) return;
            var loader = $('.nexus-loader').last();

            if (!loader.length) return;

            loader.find('.nexus-loader__title').text(title || '');
            loader.find('.nexus-loader__text').text(text || '');
        };

        this.loadingStatusSteps = function (title, text) {
            return [
                {
                    title: title || 'Запускаем просмотр',
                    text: text || 'Подключение к серверу'
                },
                {
                    title: 'Подбираем варианты',
                    text: 'Ищем доступные источники'
                },
                {
                    title: 'Проверяем доступность',
                    text: 'Оставляем рабочие варианты'
                },
                {
                    title: 'Готовим просмотр',
                    text: 'Уточняем качество видео'
                },
                {
                    title: 'Почти готово',
                    text: 'Осталось совсем немного'
                }
            ];
        };

        this.startLoadingStatus = function (title, text) {
            var token = ++loading_status_token;
            var index = 0;
            var steps = _this.loadingStatusSteps(title, text);

            if (loading_status_timer) {
                clearInterval(loading_status_timer);
                loading_status_timer = null;
            }

            _this.setLoadingStatus(steps[0].title, steps[0].text);

            loading_status_timer = setInterval(function () {
                if (token !== loading_status_token) return;

                index = Math.min(index + 1, steps.length - 1);
                _this.setLoadingStatus(steps[index].title, steps[index].text);
            }, 3000);
        };
        
        this.loading = function (status) {
            if (destroyed) return;
            if (!status) _this.stopLoadingStatus();

            if (!_this.activity) return;

            if (status) {
                if ($('.nexus-loader').length) _this.activity.loader(false);
                else _this.activity.loader(true);
            }
            else {
                _this.setControlsVisible(true);
                _this.activity.loader(false);
            }
        };

        this.setControlsVisible = function (visible) {
            if (destroyed) return;
            if (!filter_render) return;

            filter_render.toggleClass('nexus-controls-hidden', !visible);
        };

        this.showLoading = function (title, text) {
            if (destroyed) return;
            _this.stopLoadingStatus();
            _this.setControlsVisible(false);
            scroll.clear();
            scroll.append(Lampa.Template.get('nexus_content_loading', {
                logo: NEXUS_LOGO_SVG,
                title: escapeHtml(title || 'Запускаем просмотр'),
                text: escapeHtml(text || 'Подключение к серверу')
            }));
            _this.startLoadingStatus(title, text);
            _this.loading(true);
        };

        this.updateSourceFilter = function () {
            if (!filter_sources.length || !sources[balanser]) return;

            filter.set('sort', filter_sources.map(function (k) {
                return { title: sources[k].name, source: k, selected: k === balanser, ghost: !sources[k].show };
            }));

            filter.chosen('sort', [sources[balanser].name || balanser]);
        };

        this.installSerialFilterButton = function (render) {
            if (!is_serial || serial_filter_button) return;

            serial_filter_button = $('<div class="filter--serial selector nexus-serial-filter"><span>Фильтры</span><div class="nexus-serial-filter__value"></div></div>');
            serial_filter_button.on('hover:enter', function () {
                _this.openSerialFilter();
            });

            var holder = render.find('.torrent-filter');
            if (holder.length) holder.append(serial_filter_button);
            else render.append(serial_filter_button);

            _this.updateSerialFilterButton();
        };

        this.updateSerialFilterButton = function () {
            if (!serial_filter_button) return;

            var value = serial_choice.season ?
                (serial_choice.season + ' \u0441\u0435\u0437\u043e\u043d' +
                    (serial_choice.voice_name ? ' / ' + serial_choice.voice_name : '') +
                    (serial_choice.episode ? ' / ' + serial_choice.episode + ' \u0441\u0435\u0440\u0438\u044f' : '')) :
                '\u0421\u0435\u0437\u043e\u043d, \u043e\u0437\u0432\u0443\u0447\u043a\u0430, \u0441\u0435\u0440\u0438\u044f';

            serial_filter_button.find('.nexus-serial-filter__value').text(value);
        };

        this.saveSerialChoice = function () {
            Lampa.Storage.set(serial_choice_key, serial_choice);
            _this.updateSerialFilterButton();
        };

        this.voiceKey = function (item) {
            return nexusVoiceMeta(_this.voiceName(item)).key;
        };

        this.defaultVoiceTitle = function () {
            return '\u041f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e';
        };

        this.isSeasonText = function (text) {
            return /(\d+)\s*(?:\u0441\u0435\u0437\u043e\u043d|season)/i.test(String(text || ''));
        };

        this.isEpisodeText = function (text) {
            return /(\d+)\s*(?:\u0441\u0435\u0440\u0438\u044f|episode)/i.test(String(text || ''));
        };

        this.voiceName = function (item) {
            item = item || {};

            var name = item.voice_name || item.voice || item.translation || item.translate || item.t || item.translator || item.dubbing || item.sound || item.details || '';
            var text = item.text || item.title || item.name || '';

            if (!name && !item.episode && text && !_this.isSeasonText(text) && !_this.isEpisodeText(text)) {
                name = text;
            }

            return String(name || _this.defaultVoiceTitle()).trim();
        };

        this.ensureSerialSeason = function (season, title, url) {
            season = parseInt(season || 0, 10);
            if (!season) return null;

            if (!serial_seasons[season]) {
                serial_seasons[season] = {
                    season: season,
                    title: title || (season + ' \u0441\u0435\u0437\u043e\u043d'),
                    url: '',
                    episodes: {},
                    voices: {}
                };
            }

            if (title && _this.isSeasonText(title)) serial_seasons[season].title = title;
            if (url && !serial_seasons[season].url) serial_seasons[season].url = url;
            if (!serial_seasons[season].voices) serial_seasons[season].voices = {};

            return serial_seasons[season];
        };

        this.ensureSerialVoice = function (season, voice) {
            var info = _this.ensureSerialSeason(season);
            if (!info) return null;

            voice = voice || {};
            var title = String(voice.title || _this.defaultVoiceTitle()).trim();
            var meta = nexusVoiceMeta(title);
            var key = String(voice.key || meta.key).toLowerCase();

            if (!key) key = 'default';

            if (!info.voices[key]) {
                info.voices[key] = {
                    key: key,
                    title: title,
                    meta: meta,
                    url: '',
                    episodes: {}
                };
            }

            if (title && info.voices[key].title === _this.defaultVoiceTitle()) info.voices[key].title = title;
            if (!info.voices[key].meta) info.voices[key].meta = meta;
            if (voice.url && !info.voices[key].url) info.voices[key].url = voice.url;

            return info.voices[key];
        };

        this.addSerialEpisode = function (season, episode, item, voice) {
            var info = _this.ensureSerialSeason(season);
            if (!info) return false;

            episode = parseInt(episode || 0, 10);
            if (!episode) return false;

            item = item || {};

            var ep = info.episodes[episode] || {
                season: parseInt(season, 10),
                episode: episode,
                title: episode + ' \u0441\u0435\u0440\u0438\u044f',
                original_title: '',
                url: ''
            };

            ep.title = episode + ' \u0441\u0435\u0440\u0438\u044f';
            ep.original_title = ep.original_title || item.text || item.title || '';
            if (item.url && !ep.url) ep.url = item.url;
            if (item.method || item.stream || item.quality) ep.item = item;

            info.episodes[episode] = ep;

            if (voice) {
                var v = _this.ensureSerialVoice(season, voice);
                if (v) v.episodes[episode] = ep;
            }

            return true;
        };

        this.collectSerialVoices = function (items) {
            return _this.collectSerialOptions(items);
        };

        this.currentVoiceList = function (season) {
            season = parseInt(season || serial_choice.season || 0, 10);
            var info = serial_seasons[season];
            if (!info) return [];

            var voices = info.voices || {};
            var keys = Lampa.Arrays.getKeys(voices);
            var hasNamedVoices = keys.some(function (key) {
                return key !== 'default';
            });

            if (hasNamedVoices) {
                keys = keys.filter(function (key) {
                    return key !== 'default';
                });
            } else if (!keys.length && Lampa.Arrays.getKeys(info.episodes || {}).length) {
                _this.ensureSerialVoice(season, { key: 'default', title: _this.defaultVoiceTitle() });
                voices = info.voices || {};
                keys = Lampa.Arrays.getKeys(voices);
            }

            return keys.map(function (key) {
                return voices[key];
            }).sort(function (a, b) {
                var am = a.meta || nexusVoiceMeta(a.title);
                var bm = b.meta || nexusVoiceMeta(b.title);
                var byRank = am.rank - bm.rank;
                if (byRank) return byRank;
                return String(a.title).localeCompare(String(b.title));
            });
        };

        this.serialVoiceCoverage = function (voice, season) {
            season = parseInt(season || serial_choice.season || 0, 10);
            var info = serial_seasons[season] || {};
            var total = Lampa.Arrays.getKeys(info.episodes || {}).length;
            var available = Lampa.Arrays.getKeys((voice && voice.episodes) || {}).length;

            if (total && available) return available + ' \u0438\u0437 ' + total + ' \u0441\u0435\u0440\u0438\u0439';

            var cached = _this.readSerialVoiceCoverage(voice, season);
            return cached ? (cached.available + ' \u0438\u0437 ' + cached.total + ' \u0441\u0435\u0440\u0438\u0439') : '';
        };

        this.serialCoverageCacheKey = function () {
            return 'lumio_voice_coverage_v1_' + movieCacheKey(object.movie || {}) + '_' + nexusSourceKey(balanser);
        };

        this.readSerialVoiceCoverage = function (voice, season) {
            if (!voice || !voice.key || !season) return null;

            try {
                var saved = Lampa.Storage.get(_this.serialCoverageCacheKey(), null);
                if (!saved || !saved.time || Date.now() - saved.time > 12 * 60 * 60 * 1000) return null;
                return saved.items && saved.items[season + ':' + voice.key] || null;
            } catch (e) {
                return null;
            }
        };

        this.saveSerialVoiceCoverage = function (voice, season) {
            if (!voice || !voice.key || !season) return;

            var info = serial_seasons[season] || {};
            var total = Lampa.Arrays.getKeys(info.episodes || {}).length;
            var available = Lampa.Arrays.getKeys(voice.episodes || {}).length;
            if (!total || !available) return;

            try {
                var key = _this.serialCoverageCacheKey();
                var saved = Lampa.Storage.get(key, null) || { items: {} };
                if (!saved.items || typeof saved.items !== 'object') saved.items = {};
                saved.items[season + ':' + voice.key] = { available: available, total: total };
                saved.time = Date.now();
                Lampa.Storage.set(key, saved);
            } catch (e) {}
        };

        this.updateSerialVoiceCoverageCard = function (voice, season) {
            var coverage = _this.serialVoiceCoverage(voice, season);
            if (!coverage || !scroll || !scroll.render) return;

            scroll.render().find('.nexus-voice-card').filter(function () {
                return $(this).attr('data-nexus-voice') === voice.key;
            }).find('.lumio-prestige__info').text(season + ' \u0441\u0435\u0437\u043e\u043d \u00b7 ' + coverage);
        };

        this.stopSerialCoveragePrefetch = function () {
            serial_coverage_token++;
            serial_coverage_queue = [];
            serial_coverage_active = false;
            if (serial_coverage_timer) clearTimeout(serial_coverage_timer);
            serial_coverage_timer = null;
        };

        this.collectSerialVoiceCoverage = function (voice, season, items) {
            if (!voice || !season || !items) return;

            items.forEach(function (item) {
                item = item || {};
                var currentSeason = parseInt(item.season || item.s || season, 10);
                var episode = parseInt(item.episode || item.e || 0, 10);
                if (currentSeason !== season || !episode) return;

                _this.addSerialEpisode(season, episode, item, {
                    key: voice.key,
                    title: voice.title
                });
            });

            _this.saveSerialVoiceCoverage(voice, season);
            _this.updateSerialVoiceCoverageCard(voice, season);
        };

        this.runSerialCoveragePrefetch = function () {
            if (destroyed || serial_coverage_active || !serial_coverage_queue.length) return;

            var task = serial_coverage_queue.shift();
            var token = serial_coverage_token;
            serial_coverage_active = true;

            loadContent(
                _this.normalizeUrl(task.voice.url),
                { timeout: 9000, cache: true },
                function (data) {
                    if (!destroyed && token === serial_coverage_token) {
                        _this.collectSerialVoiceCoverage(task.voice, task.season, _this.parseItems(data));
                    }
                    serial_coverage_active = false;
                    serial_coverage_timer = setTimeout(_this.runSerialCoveragePrefetch, 350);
                },
                function () {
                    serial_coverage_active = false;
                    serial_coverage_timer = setTimeout(_this.runSerialCoveragePrefetch, 350);
                }
            );
        };

        this.queueSerialCoveragePrefetch = function (season) {
            season = parseInt(season || serial_choice.season || 0, 10);
            if (!season || serial_choice.voice) return;

            _this.currentVoiceList(season).forEach(function (voice) {
                if (!voice || !voice.url || _this.serialVoiceCoverage(voice, season)) return;
                var queued = serial_coverage_queue.some(function (task) {
                    return task.season === season && task.voice && task.voice.key === voice.key;
                });
                if (!queued) serial_coverage_queue.push({ season: season, voice: voice });
            });

            if (!serial_coverage_active && serial_coverage_queue.length && !serial_coverage_timer) {
                serial_coverage_timer = setTimeout(function () {
                    serial_coverage_timer = null;
                    _this.runSerialCoveragePrefetch();
                }, 250);
            }
        };

        this.sortItemsByVoice = function (items) {
            return (items || []).map(function (item, index) {
                return { item: item, index: index, meta: nexusVoiceMeta(_this.voiceName(item)) };
            }).sort(function (a, b) {
                var byRank = a.meta.rank - b.meta.rank;
                if (byRank) return byRank;
                var byName = String(a.meta.title).localeCompare(String(b.meta.title));
                return byName || (a.index - b.index);
            }).map(function (entry) {
                return entry.item;
            });
        };

        this.currentEpisodeMap = function (season, voice) {
            var info = serial_seasons[season];
            if (!info) return {};

            var selected = voice && info.voices && info.voices[voice] ? info.voices[voice] : null;
            if (selected && selected.episodes && Lampa.Arrays.getKeys(selected.episodes).length) {
                return selected.episodes;
            }

            return info.episodes || {};
        };

        this.rememberVeoVeoSeasons = function () {
            if (!_this.isVeoVeoSource()) return;

            Lampa.Arrays.getKeys(serial_seasons).forEach(function (key) {
                var season = parseInt(key, 10);
                var info = serial_seasons[season];

                if (!season || !info) return;

                if (!serial_veoveo_seasons[season]) {
                    serial_veoveo_seasons[season] = {
                        season: season,
                        title: info.title || (season + ' \u0441\u0435\u0437\u043e\u043d'),
                        url: info.url || ''
                    };
                }

                if (info.title) serial_veoveo_seasons[season].title = info.title;
                if (info.url) serial_veoveo_seasons[season].url = info.url;
            });
        };

        this.restoreVeoVeoSeasons = function () {
            if (!_this.isVeoVeoSource()) return;

            Lampa.Arrays.getKeys(serial_veoveo_seasons).forEach(function (key) {
                var season = parseInt(key, 10);
                var cached = serial_veoveo_seasons[season];

                if (!season || !cached) return;

                var info = _this.ensureSerialSeason(season, cached.title, cached.url);
                if (cached.url && info && !info.url) info.url = cached.url;
            });
        };

        this.collectSerialOptions = function (items) {
            if (!is_serial || !items || !items.length) return false;

            var changed = false;
            var contextSeason = parseInt(serial_choice.season || 0, 10);
            var contextVoice = serial_choice.voice || '';
            var contextVoiceName = serial_choice.voice_name || '';

            items.forEach(function (item) {
                item = item || {};

                var season = parseInt(item.season || item.s || 0, 10);
                var episode = parseInt(item.episode || item.e || 0, 10);
                var title = item.text || item.title || item.name || '';

                if (!season && title) {
                    var sm = String(title).match(/(\d+)\s*(?:\u0441\u0435\u0437\u043e\u043d|season)/i);
                    if (sm) season = parseInt(sm[1], 10);
                }

                if (!episode && title) {
                    var em = String(title).match(/(\d+)\s*(?:\u0441\u0435\u0440\u0438\u044f|episode)/i);
                    if (em) episode = parseInt(em[1], 10);
                }

                if (!season && contextSeason) season = contextSeason;
                if (!season) return;

                item.season = season;
                if (episode) item.episode = episode;

                var hasLink = !!(item.url || item.method || item.stream || item.quality);

                if (!episode) {
                    if (!contextSeason || _this.isSeasonText(title)) {
                        _this.ensureSerialSeason(season, title || (season + ' \u0441\u0435\u0437\u043e\u043d'), item.url || '');
                        changed = true;
                        return;
                    }

                    if (!contextVoice && hasLink && title && !_this.isEpisodeText(title)) {
                        _this.ensureSerialVoice(season, {
                            key: _this.voiceKey(item),
                            title: _this.voiceName(item),
                            url: item.url || ''
                        });
                        changed = true;
                        return;
                    }
                }

                if (episode) {
                    var voiceTitle = contextVoiceName;
                    var voiceKey = contextVoice;
                    var explicitVoice = _this.voiceName(item);

                    if (!voiceKey && explicitVoice !== _this.defaultVoiceTitle()) {
                        voiceTitle = explicitVoice;
                        voiceKey = _this.voiceKey(item);
                    }

                    if (!voiceKey && hasLink) {
                        voiceKey = 'default';
                        voiceTitle = _this.defaultVoiceTitle();
                    }

                    _this.addSerialEpisode(season, episode, item, voiceKey ? {
                        key: voiceKey,
                        title: voiceTitle || _this.defaultVoiceTitle()
                    } : null);
                    changed = true;
                }
            });

            _this.rememberVeoVeoSeasons();

            return changed;
        };

        this.serialSeasonItems = function () {
            _this.restoreVeoVeoSeasons();

            return Lampa.Arrays.getKeys(serial_seasons).map(function (k) {
                return parseInt(k, 10);
            }).filter(function (season) {
                return !!season;
            }).sort(function (a, b) {
                return a - b;
            }).map(function (season) {
                var info = serial_seasons[season] || {};
                return {
                    text: info.title || (season + ' \u0441\u0435\u0437\u043e\u043d'),
                    season: season,
                    url: info.url || '',
                    folder: true,
                    nexus_serial_action: 'season'
                };
            });
        };

        this.serialVoiceItems = function () {
            var items = _this.currentVoiceList(serial_choice.season).map(function (voice, index) {
                var meta = voice.meta || nexusVoiceMeta(voice.title);
                var coverage = _this.serialVoiceCoverage(voice, serial_choice.season);
                return {
                    text: meta.title,
                    info: serial_choice.season ? (serial_choice.season + ' \u0441\u0435\u0437\u043e\u043d \u00b7 ' + (coverage || meta.label)) : (coverage || meta.label),
                    badge: meta.badge,
                    badge_class: meta.badge_class,
                    voice_tone: index,
                    season: serial_choice.season,
                    voice: voice.key,
                    voice_name: meta.title,
                    voice_key: voice.key,
                    url: voice.url || '',
                    folder: true,
                    nexus_serial_action: 'voice',
                    nexus_card_class: 'nexus-voice-card'
                };
            });

            _this.queueSerialCoveragePrefetch(serial_choice.season);
            return items;
        };

        this.serialEpisodeItems = function () {
            var episodes = _this.currentEpisodeMap(serial_choice.season, serial_choice.voice);

            return Lampa.Arrays.getKeys(episodes).map(function (k) {
                return parseInt(k, 10);
            }).filter(function (episode) {
                return !!episode;
            }).sort(function (a, b) {
                return a - b;
            }).map(function (episode) {
                var ep = episodes[episode] || {};
                var stream = ep.item || {};
                return {
                    text: episode + ' \u0441\u0435\u0440\u0438\u044f',
                    season: serial_choice.season,
                    episode: episode,
                    url: ep.url || '',
                    quality: stream.quality || ep.quality || {},
                    maxquality: stream.maxquality || ep.maxquality || '',
                    folder: false,
                    nexus_serial_action: 'episode'
                };
            });
        };

        this.serialStepItems = function (items) {
            if (!is_serial) return null;

            if (serial_choice.season && serial_choice.voice && serial_choice.episode) {
                return null;
            }

            if (!serial_choice.season) {
                return _this.serialSeasonItems();
            }

            if (!serial_choice.voice) {
                var voices = _this.currentVoiceList(serial_choice.season);

                if (voices.length === 1) {
                    serial_choice.voice = voices[0].key;
                    serial_choice.voice_name = voices[0].title;
                    serial_choice.episode = 0;
                    serial_episode_url = '';
                    _this.saveSerialChoice();

                    if (voices[0].url && !Lampa.Arrays.getKeys(voices[0].episodes || {}).length) {
                        serial_auto_transition = true;
                        setTimeout(function () {
                            _this.selectSerialVoice({
                                voice: voices[0].key,
                                voice_name: voices[0].title
                            });
                        }, 0);

                        return [];
                    }

                    return _this.serialEpisodeItems();
                }

                return _this.serialVoiceItems();
            }

            return _this.serialEpisodeItems();
        };

        this.selectSerialSeason = function (season) {
            _this.stopSerialCoveragePrefetch();
            var info = serial_seasons[season];

            serial_choice.season = parseInt(season || 0, 10);
            serial_choice.voice = '';
            serial_choice.voice_name = '';
            serial_choice.episode = 0;
            serial_episode_url = '';
            _this.saveSerialChoice();

            var hasSeasonData = info && (
                Lampa.Arrays.getKeys(info.voices || {}).length ||
                Lampa.Arrays.getKeys(info.episodes || {}).length
            );

            if (_this.isVeoVeoSource() && !hasSeasonData) {
                var seasonUrl = _this.serialSeasonRequestUrl(serial_choice.season);

                if (seasonUrl) {
                    var token = ++request_token;

                    _this.showLoading('\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043c \u0441\u0435\u0437\u043e\u043d', serial_choice.season + ' \u0441\u0435\u0437\u043e\u043d');

                    loadContent(
                        seasonUrl,
                        { timeout: timeoutForAttempt(NEXUS_CONTENT_TIMEOUT, 1), cache: false },
                        function (data) {
                            if (token !== request_token) return;
                            _this.parse(data);
                        },
                        function () {
                            if (token !== request_token) return;

                            if (info && info.url) {
                                _this.request(accountUrl(_this.normalizeUrl(info.url)));
                                return;
                            }

                            _this.doesNotAnswer({});
                        }
                    );

                    return;
                }
            }

            if (info && info.url && !Lampa.Arrays.getKeys(info.voices || {}).length && !Lampa.Arrays.getKeys(info.episodes || {}).length) {
                _this.showLoading('\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043c \u0441\u0435\u0437\u043e\u043d', serial_choice.season + ' \u0441\u0435\u0437\u043e\u043d');
                _this.request(accountUrl(_this.normalizeUrl(info.url)));
            } else {
                _this.parse([]);
            }
        };

        this.selectSerialVoice = function (voice) {
            _this.stopSerialCoveragePrefetch();
            var info = serial_seasons[serial_choice.season] || {};
            var voices = info.voices || {};
            var selected = voices[voice.voice] || voice || {};

            serial_choice.voice = selected.key || voice.voice || '';
            serial_choice.voice_name = selected.title || voice.voice_name || '';
            serial_choice.episode = 0;
            serial_episode_url = '';
            _this.saveSerialChoice();

            if (selected.url && !Lampa.Arrays.getKeys(selected.episodes || {}).length) {
                _this.showLoading('\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043c \u043e\u0437\u0432\u0443\u0447\u043a\u0443', serial_choice.voice_name);
                _this.request(accountUrl(_this.normalizeUrl(selected.url)));
            } else {
                _this.parse([]);
            }
        };

        this.playSerialEpisode = function () {
            _this.syncEpisodeUrl();

            var url = serial_episode_url ?
                accountUrl(_this.normalizeUrl(serial_episode_url)) :
                requestParams(source_url, object.movie, _this.getSerialParams());

            _this.showLoading('\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043c \u0441\u0435\u0440\u0438\u044e', serial_choice.season + ' \u0441\u0435\u0437\u043e\u043d / ' + serial_choice.episode + ' \u0441\u0435\u0440\u0438\u044f');

            loadContent(
                url,
                { timeout: timeoutForAttempt(NEXUS_CONTENT_TIMEOUT, 1), cache: false },
                function (data) {
                    var items = _this.parseItems(data);

                    _this.collectSerialOptions(items);
                    _this.collectSerialVoices(items);

                    var item = _this.pickEpisodeItem(items, serial_choice.season, serial_choice.episode);

                    if (!item) {
                        _this.parse(items);
                        return;
                    }

                    _this.loading(false);
                    _this.open(item);
                },
                function () {
                    _this.doesNotAnswer({ msg: '\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u0441\u0435\u0440\u0438\u0438' });
                }
            );
        };

        this.selectSerialEpisode = function (episode) {
            var episodes = _this.currentEpisodeMap(serial_choice.season, serial_choice.voice);
            var ep = episodes[episode.episode] || episode || {};

            serial_choice.episode = parseInt(episode.episode || 0, 10);
            serial_episode_url = ep.url || '';
            _this.saveSerialChoice();

            if (ep.item && (ep.item.method || ep.item.stream || ep.item.quality)) {
                _this.open(ep.item);
                return;
            }

            _this.playSerialEpisode();
        };

        this.getSerialParams = function () {
            if (!is_serial || !serial_choice.season || !serial_choice.episode) return null;

            return {
                s: serial_choice.season,
                e: serial_choice.episode,
                season: serial_choice.season,
                episode: serial_choice.episode
            };
        };

        this.filterItemsBySerialChoice = function (items) {
            if (!is_serial || !serial_choice.season || !serial_choice.episode) return items;

            var filtered = items.filter(function (item) {
                return parseInt(item.season || 0, 10) === parseInt(serial_choice.season, 10) &&
                    parseInt(item.episode || 0, 10) === parseInt(serial_choice.episode, 10);
            });

            return filtered;
        };

        this.onlySerialFolders = function (items) {
            if (!is_serial || !items || !items.length) return false;

            return items.every(function (item) {
                return item.season && !item.episode && !item.method && !item.stream && !item.quality;
            });
        };

        this.showSerialPrompt = function (text) {
            scroll.clear();
            scroll.append(Lampa.Template.get('nexus_doesnotanswer', {
                title: 'Выберите серию',
                text: text || 'Откройте Фильтры и выберите сезон и серию'
            }));
            _this.loading(false);

            setTimeout(function () {
                try {
                    Lampa.Controller.toggle('content');
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                } catch (e) {
                    console.error('[Lumio] serial prompt focus error:', e);
                }
            }, 50);
        };

        this.openSerialFilter = function () {
            if (!is_serial) return;

            if (serial_choice.season && serial_choice.voice && serial_choice.episode) {
                _this.openSerialFilterMenu();
            } else if (serial_choice.season && !serial_choice.voice) {
                _this.openVoiceFilter();
            } else if (serial_choice.season && serial_choice.voice) {
                _this.openEpisodeFilter(serial_choice.season);
            } else {
                _this.openSeasonFilter();
            }
        };

        this.syncEpisodeUrl = function () {
            if (!is_serial || serial_episode_url || !serial_choice.season || !serial_choice.episode) return;

            var info = serial_seasons[serial_choice.season];
            var ep = info && info.episodes ? info.episodes[serial_choice.episode] : null;
            if (ep && ep.url) serial_episode_url = ep.url;
        };

        this.openSerialFilterMenu = function () {
            if (!is_serial) return;

            Lampa.Select.show({
                title: '\u0424\u0438\u043b\u044c\u0442\u0440\u044b',
                items: [
                    { title: '\u0421\u0435\u0437\u043e\u043d: ' + serial_choice.season, action: 'season' },
                    { title: '\u041e\u0437\u0432\u0443\u0447\u043a\u0430: ' + (serial_choice.voice_name || _this.defaultVoiceTitle()), action: 'voice' },
                    { title: '\u0421\u0435\u0440\u0438\u044f: ' + serial_choice.episode, action: 'episode' }
                ],
                onSelect: function (a) {
                    Lampa.Select.close();

                    if (a.action === 'season') {
                        _this.openSeasonFilter();
                    } else if (a.action === 'voice') {
                        _this.openVoiceFilter();
                    } else if (a.action === 'episode') {
                        _this.openEpisodeFilter(serial_choice.season);
                    }
                },
                onBack: function () {
                    Lampa.Controller.toggle('content');
                }
            });
        };

        this.openSeasonFilter = function () {
            if (!is_serial) return;

            var seasons = Lampa.Arrays.getKeys(serial_seasons).map(function (k) {
                return parseInt(k, 10);
            }).filter(function (n) {
                return !!n;
            }).sort(function (a, b) {
                return a - b;
            });

            if (!seasons.length) {
                Lampa.Noty.show('Сезоны еще загружаются, попробуйте через пару секунд');
                _this.find();
                return;
            }

            Lampa.Select.show({
                title: 'Сезон',
                items: seasons.map(function (season) {
                    return {
                        title: (serial_seasons[season].title || (season + ' сезон')),
                        season: season,
                        selected: parseInt(serial_choice.season || 0, 10) === season
                    };
                }),
                onSelect: function (a) {
                    Lampa.Select.close();
                    serial_choice.season = a.season;
                    serial_choice.voice = '';
                    serial_choice.voice_name = '';
                    serial_choice.episode = 0;
                    serial_episode_url = '';
                    _this.saveSerialChoice();
                    _this.loadSeasonEpisodes(a.season, function () {
                        _this.openVoiceFilter();
                    });
                },
                onBack: function () {
                    Lampa.Controller.toggle('content');
                }
            });
        };

        this.openEpisodeFilter = function (season) {
            var info = serial_seasons[season];
            if (!info) return;

            var episodeMap = _this.currentEpisodeMap(season, serial_choice.voice);
            var episodes = Lampa.Arrays.getKeys(episodeMap).map(function (k) {
                return parseInt(k, 10);
            }).filter(function (n) {
                return !!n;
            }).sort(function (a, b) {
                return a - b;
            });

            if (!episodes.length) {
                Lampa.Noty.show('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u0441\u0435\u0440\u0438\u0438 \u0434\u043b\u044f \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u043e\u0439 \u043e\u0437\u0432\u0443\u0447\u043a\u0438');
                return;
            }

            Lampa.Select.show({
                title: season + ' \u0441\u0435\u0437\u043e\u043d',
                items: episodes.map(function (episode) {
                    var ep = episodeMap[episode] || {};
                    return {
                        title: episode + ' \u0441\u0435\u0440\u0438\u044f',
                        season: season,
                        episode: episode,
                        url: ep.url,
                        selected: parseInt(serial_choice.episode || 0, 10) === episode
                    };
                }),
                onSelect: function (a) {
                    Lampa.Select.close();
                    _this.selectSerialEpisode(a);
                },
                onBack: function () {
                    if (_this.currentVoiceList(serial_choice.season).length <= 1) {
                        _this.openSeasonFilter();
                    } else {
                        _this.openVoiceFilter();
                    }
                }
            });
        };

        this.prepareEpisodeVoices = function (call) {
            _this.syncEpisodeUrl();

            if (!serial_episode_url) {
                call();
                return;
            }

            var url = accountUrl(_this.normalizeUrl(serial_episode_url));

            Lampa.Loading.start();
            loadContent(
                url,
                { timeout: NEXUS_CONTENT_TIMEOUT },
                function (data) {
                    Lampa.Loading.stop();
                    _this.collectSerialOptions(_this.parseItems(data));
                    call();
                },
                function (e) {
                    Lampa.Loading.stop();
                    call();
                }
            );
        };

        this.openVoiceFilter = function () {
            var voices = _this.currentVoiceList(serial_choice.season);

            if (!voices.length) {
                Lampa.Noty.show('\u041e\u0437\u0432\u0443\u0447\u043a\u0438 \u0435\u0449\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0430\u044e\u0442\u0441\u044f');
                return;
            }

            if (voices.length === 1) {
                _this.selectSerialVoice({
                    voice: voices[0].key,
                    voice_name: voices[0].title
                });
                return;
            }

            Lampa.Select.show({
                title: '\u041e\u0437\u0432\u0443\u0447\u043a\u0430',
                items: voices.map(function (voice) {
                    return {
                        title: voice.title,
                        voice: voice.key,
                        voice_name: voice.title,
                        selected: serial_choice.voice === voice.key
                    };
                }),
                onSelect: function (a) {
                    Lampa.Select.close();
                    _this.selectSerialVoice(a);
                },
                onBack: function () {
                    _this.openSeasonFilter();
                }
            });
        };

        this.loadSeasonEpisodes = function (season, call) {
            var info = serial_seasons[season];
            var hasEpisodes = info && Lampa.Arrays.getKeys(info.episodes).length;
            if (hasEpisodes) {
                call(true);
                return;
            }

            if (!info || !info.url) {
                call(false);
                return;
            }

            var url = accountUrl(_this.normalizeUrl(info.url));

            Lampa.Loading.start();
            loadContent(
                url,
                { timeout: NEXUS_CONTENT_TIMEOUT },
                function (data) {
                    Lampa.Loading.stop();
                    _this.collectSerialOptions(_this.parseItems(data));
                    call(true);
                },
                function (e) {
                    Lampa.Loading.stop();
                    call(false);
                }
            );
        };


        this.initialize = function () {
    _this.stopLoadingStatus();
    if (_this.activity) _this.activity.loader(false);

    filter.onBack = function () {
    Lampa.Controller.toggle('content');
};

    var filterRender = filter.render();
    filter_render = filterRender;
    var search = filterRender.find('.filter--search');
    var torrent = filterRender.find('.torrent-filter');

    if (search.length && torrent.length) {
        search.appendTo(torrent);
    }

    filter.onSelect = function (type, a) {
        if (type === 'sort') {
            Lampa.Select.close();
            object.nexus_custom_select = a.source;
            _this.changeBalanser(a.source);
        }
    };

    if (filter.addButtonBack) filter.addButtonBack();

    filterRender.find('.filter--sort span').text(
        Lampa.Lang.translate('lumio_balanser') || 'Источник'
    );

    scroll.body().addClass('torrent-list');
    files.appendFiles(scroll.render());
    files.appendHead(filterRender);
    scroll.minus(files.render().find('.explorer__files-head'));
    scroll.body().append(Lampa.Template.get('nexus_content_loading', {
        logo: NEXUS_LOGO_SVG,
        title: 'Запускаем просмотр',
        text: 'Подключение к серверу'
    }));
    _this.setControlsVisible(false);
    _this.startLoadingStatus('Запускаем просмотр', 'Подключение к серверу');

    if (object.balanser) {
        sources[object.balanser] = { name: object.balanser, url: object.url };
        balanser = object.balanser;
        source_url = object.url;
        filter_sources = [balanser];
        _this.request(accountUrl(object.url));
        return;
    }

    _this.createSource();
};

        this.createSource = function (attempt) {
    if (destroyed) return;
    attempt = attempt || 0;

    if (attempt === 0) nexusTelemetry.event('content_open');

    var cached = readSourcesCache(object.movie, true);

    nexusLog('[Lumio] createSource attempt:', attempt + 1);

    if (cached && cached.length) {
        nexusLog('[Lumio] sources cache hit:', cached.length);
        _this.startSource(cached);

        loadSources(object.movie, function (json) {
            if (destroyed) return;
            saveSourcesCache(object.movie, json);
        }, function () {}, true);

        return;
    }

    _this.showLoading('Запускаем просмотр', 'Подключение к серверу');

    loadSources(
        object.movie,
        function (json) {
            if (destroyed) return;
            _this.startSource(json);
        },
        function (e) {
            if (destroyed) return;
            console.error('[Lumio] createSource error:', e);
            if (attempt + 1 < NEXUS_OPEN_ATTEMPTS) {
                _this.showLoading('Пробуем снова', 'Сервер отвечает чуть дольше обычного');
                setTimeout(function () {
                    if (destroyed) return;
                    _this.createSource(attempt + 1);
                }, 1200 + attempt * 1400);
                return;
            }
            nexusTelemetry.event('source_no_response');
            _this.doesNotAnswer({ msg: (e && e.msg) || 'Ошибка подключения к серверу' });
        },
        false
    );
};

        // ── startSource ─────────────────────────────────────────────────────
        this.resetSerialSourceState = function () {
            if (!is_serial) return;

            _this.stopSerialCoveragePrefetch();
            serial_seasons = {};
            serial_episode_url = '';
            serial_quality_hint = '';
        };

        this.activateSource = function (name, saveChoice) {
            if (!sources[name]) return false;

            balanser = name;
            source_url = sources[name].url;
            nexusTelemetry.source(name, 'selected');
            if (saveChoice) nexusTelemetry.source(name, 'manual_switch');
            if (saveChoice && name !== NEXUS_ORIGINAL_SUBS_SOURCE) {
                Lampa.Storage.set(NEXUS_BALANSER_STORAGE, name);
            }
            _this.updateSourceFilter();

            return true;
        };

        this.sourceRequestUrl = function (name) {
            if (!sources[name]) return '';

            return requestParams(sources[name].url, object.movie, _this.getSerialParams());
        };

        this.sourceNeedsRch = function (name) {
            return !!(sources[name] && sources[name].rch);
        };

        this.withSourceReady = function (name, success, error) {
            if (!_this.sourceNeedsRch(name)) {
                success();
                return;
            }

            nexusRchEnsure(success, error);
        };

        this.isVeoVeoSource = function () {
            return String(balanser || '').toLowerCase() === 'veoveo';
        };

        this.isOriginalSubsSource = function () {
            return balanser === NEXUS_ORIGINAL_SUBS_SOURCE;
        };

        this.addOriginalSubsSource = function () {
            // This is a virtual source: it never participates in the startup
            // probe and does not make a request until the user selects it.
            if (is_serial) return;

            sources[NEXUS_ORIGINAL_SUBS_SOURCE] = {
                name: NEXUS_ORIGINAL_SUBS_LABEL,
                url: '',
                show: true,
                virtual: true,
                rch: false
            };

            filter_sources = sortSourceKeys(Lampa.Arrays.getKeys(sources));
        };

        this.requestNativeSubtitleTrack = function (done) {
            var url = requestParams(NEXUS_HOST + '/lite/phantom', object.movie);

            loadContent(
                url,
                { timeout: 12000 },
                function (data) {
                    var item = _this.parseItems(data).filter(function (candidate) {
                        var translation = String(candidate.translate || candidate.translation || '').trim().toLowerCase();
                        return translation === '\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u044b';
                    })[0] || null;

                    if (item && item.url && item.url.indexOf('subtitles=true') === -1) {
                        item.url += (item.url.indexOf('?') === -1 ? '?' : '&') + 'subtitles=true';
                    }

                    done(item);
                },
                function () {
                    done(null);
                }
            );
        };

        this.originalSubsUnavailable = function (message, reason) {
            if (reason) nexusTelemetry.source(NEXUS_ORIGINAL_SUBS_SOURCE, reason);
            _this.doesNotAnswer({ msg: message });
        };

        this.originalSubsQuality = function (item) {
            item = item || {};

            var stream = item.url || item.stream || '';
            var current = item.quality;
            var maxquality = item.maxquality || (
                current && typeof current === 'object' ? Object.keys(current)[0] : current
            );
            var labels = nexusQualityLadder(maxquality);
            var quality = {};

            if (labels.length && stream) {
                labels.forEach(function (label) {
                    quality[label] = stream;
                });
                return quality;
            }

            return current && typeof current === 'object' ? Lampa.Arrays.clone(current) : quality;
        };

        this.showOriginalSubsCard = function (item) {
            item = item || native_subtitles_item || {};

            _this.parse([{
                text: '\u041e\u0440\u0438\u0433\u0438\u043d\u0430\u043b (+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u044b)',
                quality: _this.originalSubsQuality(item),
                maxquality: item.maxquality || '',
                method: 'call',
                nexus_original_subs_action: true
            }]);
        };

        this.loadOriginalSubsCard = function () {
            var token = ++request_token;
            native_subtitles_item = null;

            _this.showLoading('Загружаем субтитры', 'Получаем видео и синхронные дорожки');

            _this.requestNativeSubtitleTrack(function (item) {
                if (destroyed || token !== request_token) return;

                if (!item || !item.url) {
                    _this.originalSubsUnavailable('Для этого фильма пока нет оригинала с русскими субтитрами.', 'native_not_found');
                    return;
                }

                native_subtitles_item = item;
                _this.showOriginalSubsCard(item);
            });
        };

        this.openOriginalSubs = function () {
            if (is_serial) {
                _this.originalSubsUnavailable('\u041e\u0440\u0438\u0433\u0438\u043d\u0430\u043b (+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u044b) \u043f\u043e\u043a\u0430 \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f \u0444\u0438\u043b\u044c\u043c\u043e\u0432.');
                return;
            }

            if (!native_subtitles_item || !native_subtitles_item.url) {
                _this.loadOriginalSubsCard();
                return;
            }

            var token = ++request_token;
            var item = Lampa.Arrays.clone(native_subtitles_item);
            item.nexus_quiet_loading = true;

            _this.showLoading('Загружаем субтитры', 'Получаем видео и синхронные дорожки');

            _this.getFileUrl(item, function (stream, original) {
                    if (destroyed || token !== request_token) return;

                    if (!stream || !stream.url) {
                        _this.originalSubsUnavailable('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443 \u043d\u0430 \u043e\u0440\u0438\u0433\u0438\u043d\u0430\u043b\u044c\u043d\u043e\u0435 \u0432\u0438\u0434\u0435\u043e Phantom.', 'native_video_unavailable');
                        return;
                    }

                    var play = _this.makePlayData(item, stream, original);
                    var subtitles = play.subtitles;

                    if (!Array.isArray(subtitles) || !subtitles.length) {
                        _this.originalSubsUnavailable('\u0414\u043b\u044f \u044d\u0442\u043e\u0433\u043e \u0444\u0438\u043b\u044c\u043c\u0430 Phantom \u043d\u0435 \u0432\u0435\u0440\u043d\u0443\u043b \u043d\u0430\u0442\u0438\u0432\u043d\u044b\u0435 \u0441\u0443\u0431\u0442\u0438\u0442\u0440\u044b.', 'native_subtitles_unavailable');
                        return;
                    }

                    var russian = subtitles.filter(function (subtitle) {
                        return /\u0440\u0443\u0441\u0441\u043a/i.test(String(subtitle.label || subtitle.title || ''));
                    })[0];

                    if (russian && russian.url) {
                        // Lampa's automatic subtitle mode opens the first custom
                        // track when no "full" label is present. Keep Russian first.
                        play.subtitles = [russian].concat(subtitles.filter(function (subtitle) {
                            return subtitle !== russian;
                        }));
                        play.subtitle = russian.url;
                    }

                    var title = object.movie.title || object.movie.name || item.text || item.title || 'Video';
                    play.title = title + ' - ' + NEXUS_ORIGINAL_SUBS_LABEL;

                    nexusTelemetry.event('original_subs_play_intent');
                    nexusTelemetry.event('original_subs_native_ready');
                    nexusTelemetry.source(NEXUS_ORIGINAL_SUBS_SOURCE, 'play_intent');
                    nexusTelemetry.source(NEXUS_ORIGINAL_SUBS_SOURCE, 'native_subtitles_ok');
                    // parse() restores controller focus asynchronously. Let it
                    // finish before Player.play(), otherwise that focus update
                    // can immediately close the just-opened player.
                    _this.showOriginalSubsCard(native_subtitles_item);

                    setTimeout(function () {
                        if (destroyed || token !== request_token) return;

                        // Lampa reads this setting only after the external tracks
                        // are loaded. Restore the user's original value on close.
                        var subtitlesStartBefore = !!Lampa.Storage.field('subtitles_start');
                        var subtitlesStartRestored = false;
                        var restoreSubtitlesStart = function () {
                            if (subtitlesStartRestored) return;
                            subtitlesStartRestored = true;
                            Lampa.Player.listener.remove('destroy', restoreSubtitlesStart);
                            Lampa.Storage.set('subtitles_start', subtitlesStartBefore);
                            removeStorageKey(NEXUS_SUBTITLES_START_BACKUP);
                        };

                        Lampa.Storage.set(NEXUS_SUBTITLES_START_BACKUP, subtitlesStartBefore);
                        Lampa.Storage.set('subtitles_start', true);
                        Lampa.Player.listener.follow('destroy', restoreSubtitlesStart);
                        Lampa.Player.play(play);
                    }, 80);
                });
        };

        this.serialSeasonRequestUrl = function (season) {
            season = parseInt(season || 0, 10);
            if (!source_url || !season) return '';

            return requestParams(source_url, object.movie, {
                s: season,
                season: season
            });
        };

        this.previewItems = function (data) {
            var items = _this.parseItems(data);

            if (is_serial && serial_choice.season && serial_choice.episode) {
                items = _this.filterItemsBySerialChoice(items);
            }

            return items;
        };

        this.hasUsablePreview = function (items) {
            if (!items || !items.length) return false;
            if (is_serial && serial_choice.season && serial_choice.episode && _this.onlySerialFolders(items)) return false;

            return true;
        };

        this.startSource = function (json) {
            if (destroyed || !json || !json.forEach) return;
            sources        = {};
            filter_sources = [];

            json.forEach(function (j) {
                if (!isWorkingSource(j)) return;
                var name = balanserName(j);
                sources[name] = {
                    url: _this.normalizeUrl(j.url),
                    name: sourceDisplayName(j, name),
                    show: true,
                    rch: !!j.rch
                };
            });

            filter_sources = sortSourceKeys(Lampa.Arrays.getKeys(sources));

            if (!filter_sources.length) {
                nexusTelemetry.event('sources_empty');
                _this.doesNotAnswer({});
                return;
            }

            _this.showLoading('Ищем доступные источники', 'Проверяем варианты для этого видео');
            _this.probeSources(function () {
                if (destroyed) return;
                _this.addOriginalSubsSource();

                if (!filter_sources.length) {
                    nexusTelemetry.event('sources_empty');
                    _this.doesNotAnswer({});
                    return;
                }

                nexusTelemetry.event('sources_ready');

                var saved = Lampa.Storage.get(NEXUS_BALANSER_STORAGE, '');
                balanser = (saved !== NEXUS_ORIGINAL_SUBS_SOURCE && sources[saved]) ? saved : (sources[NEXUS_DEFAULT_SOURCE] ? NEXUS_DEFAULT_SOURCE : filter_sources[0]);
                _this.resetSerialSourceState();
                _this.activateSource(balanser, false);
                _this.updateSourceFilter();
                _this.showLoading('Загружаем видео', 'Источник: ' + sources[balanser].name);
                _this.find();
            });
        };

        this.probeSources = function (done) {
            if (destroyed) return;
            var queue = filter_sources.slice();
            var available = {};
            var active = 0;
            var finished = false;

            function complete() {
                if (destroyed) return;
                if (finished) return;
                if (queue.length || active) return;

                finished = true;
                sources = available;
                filter_sources = sortSourceKeys(Lampa.Arrays.getKeys(sources));
                done();
            }

            function next() {
                if (destroyed) return;
                while (active < NEXUS_SOURCE_PROBE_CONCURRENCY && queue.length) {
                    var nextName = queue.shift();

                    (function (name, source) {
                        active++;
                        var probeStartedAt = Date.now();

                        function finish(ok) {
                            if (destroyed) return;
                            if (ok) {
                                available[name] = source;
                                nexusTelemetry.source(name, 'probe_ok');
                                nexusTelemetry.latency(name, Date.now() - probeStartedAt);
                            } else {
                                nexusTelemetry.source(name, 'probe_fail');
                            }
                            active--;
                            next();
                            complete();
                        }

                        function probe() {
                            if (destroyed) return;
                            var url = _this.sourceRequestUrl(name);
                            if (!url) {
                                finish(false);
                                return;
                            }

                            loadContent(
                                url,
                                { timeout: NEXUS_SOURCE_PROBE_TIMEOUT },
                                function (data) {
                                    if (destroyed) return;
                                    if (nexusRchResponse(data) && !source.rch) {
                                        source.rch = true;
                                        _this.withSourceReady(name, probe, function () {
                                            finish(false);
                                        });
                                        return;
                                    }

                                    finish(_this.hasUsablePreview(_this.previewItems(data)));
                                },
                                function () {
                                    if (destroyed) return;
                                    finish(false);
                                }
                            );
                        }

                        _this.withSourceReady(name, probe, function () {
                            finish(false);
                        });
                    })(nextName, sources[nextName]);
                }

                complete();
            }

            next();
        };

        // ── changeBalanser ──────────────────────────────────────────────────
        this.changeBalanser = function (name) {
            if (!sources[name]) return;

            _this.activateSource(name, true);
            _this.resetSerialSourceState();
            serial_choice.season = 0;
            serial_choice.voice = '';
            serial_choice.voice_name = '';
            serial_choice.episode = 0;
            _this.saveSerialChoice();
            _this.updateSourceFilter();
            _this.showLoading('Загружаем видео', 'Источник: ' + sources[name].name);
            _this.find();
        };

        // ── find / request ──────────────────────────────────────────────────
        this.find = function () {
            if (destroyed) return;
            var selected = balanser;

            if (_this.isOriginalSubsSource()) {
                _this.loadOriginalSubsCard();
                return;
            }

            _this.withSourceReady(selected, function () {
                var serialParams = _this.getSerialParams();
                var episodeUrl = _this.normalizeUrl(serial_episode_url);
                if (_this.sourceNeedsRch(selected)) episodeUrl = nexusRchRequestUrl(episodeUrl);
                var url = (is_serial && serial_episode_url) ? accountUrl(episodeUrl) : requestParams(source_url, object.movie, serialParams);
                url = nexusQualityRequestUrl(selected, url);
                _this.request(url);
            }, function () {
                nexusTelemetry.event('source_no_response');
                nexusTelemetry.source(selected, 'probe_fail');
                _this.doesNotAnswer({ msg: 'Не удалось подключить источник' });
            });
        };

        this.request = function (url, attempt, token) {
    if (destroyed || !url) return;
    url = nexusQualityRequestUrl(balanser, url);
    attempt = attempt || 0;
    token = token || (++request_token);

    nexusLog('[Lumio] request url:', url, 'attempt:', attempt + 1);
    number_requests++;

    if (number_requests >= 14) {
        _this.doesNotAnswer({ msg: 'Слишком много запросов' });
        return;
    }

    clearTimeout(number_requests_timer);
    number_requests_timer = setTimeout(function () { number_requests = 0; }, 5000);

    var requestStartedAt = Date.now();

    loadContent(
        url,
        { timeout: timeoutForAttempt(NEXUS_CONTENT_TIMEOUT, attempt) },
        function (data) {
            if (destroyed || token !== request_token) return;

            var rch = nexusRchResponse(data);
            if (rch) {
                if (/[?&]rchtype=[^&]+/i.test(url)) {
                    nexusTelemetry.event('rch_fail');
                    nexusTelemetry.source(balanser, 'rch_fail');
                    _this.doesNotAnswer({ msg: 'Источник не завершил подключение RCH' });
                    return;
                }

                nexusLog('[Lumio] RCH requested by source');
                nexusLog('[Lumio RCH] source requested RCH:', rch.nws || 'no nws address');
                nexusRchEnsure(function () {
                    _this.request(nexusRchRequestUrl(url), 0, token);
                }, function () {
                    nexusTelemetry.event('rch_fail');
                    nexusTelemetry.source(balanser, 'rch_fail');
                    _this.doesNotAnswer({ msg: 'Не удалось подключиться к источнику' });
                });
                return;
            }

            nexusLog('[Lumio] request success');
            nexusTelemetry.event('content_ok');
            nexusTelemetry.source(balanser, 'content_ok');
            nexusTelemetry.latency(balanser, Date.now() - requestStartedAt);
            _this.parse(data);
        },
        function (e) {
            if (destroyed || token !== request_token) return;
            console.error('[Lumio] request error:', e);
            nexusLog('[Lumio] source response details:', {
                status: e && e.status,
                text: String((e && (e.responseText || e.statusText)) || '').slice(0, 500),
                url: url
            });
            if (attempt < 1) {
                setTimeout(function () {
                    if (!destroyed) _this.request(url, attempt + 1, token);
                }, 450 + attempt * 650);
                return;
            }
            nexusTelemetry.event('content_fail');
            nexusTelemetry.source(balanser, 'content_fail');
            _this.doesNotAnswer({ msg: 'Ошибка загрузки контента' });
        }
    );
};

        // ── parse ────────────────────────────────────────────────────────────
        this.parse = function (data) {
    if (destroyed) return;
    last = null;
    scroll.clear();

    var items = _this.parseItems(data);

    if (is_serial) {
    _this.collectSerialOptions(items); // можно оставить, просто не используется для гейтинга
}

    if (is_serial) {
        var serialItems = _this.serialStepItems(items);
        if (serialItems) items = serialItems;
        else if (serial_choice.season && serial_choice.episode) {
            items = _this.filterItemsBySerialChoice(items);
        }
    } else {
        // Movie sources use different labels for the same kind of voice.
        // Apply the very same deterministic ordering as serial voice menus.
        items = _this.sortItemsByVoice(items);
    }

    if (is_serial && serial_auto_transition && !items.length) {
        serial_auto_transition = false;
        _this.loading(true);
        return;
    }

    if (!items.length) {
        scroll.append(Lampa.Template.get('nexus_doesnotanswer', {
            title: Lampa.Lang.translate('lumio_error_title') || 'Ничего не найдено',
            text: Lampa.Lang.translate('lumio_no_sources') || 'Нет источников'
        }));
        _this.loading(false);
        return;
    }

    items.forEach(function (item) {
        var title = item.text || item.title || 'Видео';
        var voiceMeta = nexusVoiceMeta(_this.voiceName(item));
        if (!is_serial && voiceMeta.type !== 'unknown') title = voiceMeta.title;
        var media = mediaTemplateData(object.movie);
var cardClass = item.nexus_card_class || '';
var mediaOverline = '';
var mediaLabel = '';
var progress = null;
var qBadge = qualityBadge(item.quality);
var resolutionText = nexusQualityLabels(item.quality);
 var sourceText = nexusPlainText(sources[balanser] ? sources[balanser].name : '');
 var pidtorInfo = balanser === 'pidtor' ? nexusPidtorDetails(item) : '';
 var infoText = pidtorInfo || resolutionText || nexusPlainText(item.info) || sourceText;
var badgeText = qBadge ? qBadge.label : (item.badge || '');
var badgeClass = qBadge ? qBadge.css : (item.badge_class || '');
var timeText = item.episode !== undefined && item.nexus_serial_action !== 'episode' ? ('\u00b7 ' + item.episode) : '';

if (is_serial && item.nexus_serial_action === 'voice') {
    media = voiceMediaTemplateData(item.voice_name || title, item.voice_tone);
    infoText = item.info || '';
    badgeText = item.badge || '\u041e\u0437\u0432\u0443\u0447\u043a\u0430';
    badgeClass = item.badge_class || 'nexus-badge--voice';
    timeText = '';
}

if (is_serial && item.nexus_serial_action === 'episode') {
    media = episodeMediaTemplateData(item.season || serial_choice.season, item.episode);
    cardClass = 'nexus-episode-card';
    mediaOverline = media.media_overline;
    mediaLabel = media.media_label;
    progress = _this.episodeProgress(item);
}

var el = Lampa.Template.get('nexus_prestige_folder', {
    title: escapeHtml(title),
    time: escapeHtml(timeText),
    info: escapeHtml(infoText),
    voice_badge: escapeHtml(!is_serial ? voiceMeta.badge : ''),
    voice_badge_class: !is_serial ? voiceMeta.badge_class : '',
    badge: escapeHtml(badgeText),
    badge_class: badgeClass,
    media_class: media.media_class,
    media_style: media.media_style,
    media_overline: escapeHtml(mediaOverline),
    media_label: escapeHtml(mediaLabel),
    card_class: cardClass,
    voice_key: escapeHtml(item.voice_key || ''),
    progress: progress ? progress.percent : 0,
    progress_class: progress ? ('nexus-progress--visible' + (progress.done ? ' nexus-progress--done' : '')) : ''
});

        el.on('hover:enter', (function (it) {
            return function () {
                _this.open(it);
            };
        })(item)).on('hover:focus', function (e) {
    var current = $(e.currentTarget || e.target).closest('.selector');
    last = current.length ? current[0] : e.target;

    try {
        scroll.update(current.length ? current : $(e.target), true);
    } catch (err) {
        console.error('[Lumio] hover:focus scroll.update error:', err);
    }
});
            

        scroll.append(el);

        if (item.active) last = el[0];
    });

    var first = scroll.render().find('.selector').first();
var target = null;

if (last && $(last).closest(scroll.render()).length) {
    target = $(last).closest('.selector')[0];
}

if (!target && first.length) {
    target = first[0];
}

_this.loading(false);

setTimeout(function () {
    if (destroyed) return;
    try {
        Lampa.Controller.toggle('content');
        Lampa.Controller.collectionSet(scroll.render(), files.render());

        if (target) {
            Lampa.Controller.collectionFocus(target, scroll.render());
            last = target;
            scroll.update($(target), true);
        }
    } catch (e) {
        console.error('[Lumio] parse focus error:', e);
    }
}, 50);
};
        
                // ── orUrlReserve ────────────────────────────────────────────────────
        this.orUrlReserve = function (data) {
            if (data && data.url && typeof data.url === 'string' && data.url.indexOf(' or ') !== -1) {
                var urls = data.url.split(' or ');
                data.url = urls[0];
                data.url_reserve = urls[1] || '';
            }
            return data;
        };
        
                // ── getFileUrl ──────────────────────────────────────────────────────
        this.getFileUrl = function (file, call) {
            if (destroyed) return;
            if (!file) {
                call(false);
                return;
            }

            if (file.method === 'play' && file.url) {
    var direct = Lampa.Arrays.clone(file);
    direct.url = _this.normalizeUrl(direct.url);
    direct = _this.orUrlReserve(direct);
    call(direct, file);
    return;
}

if (file.url) {
    var useGlobalLoading = !file.nexus_quiet_loading;
    if (useGlobalLoading) Lampa.Loading.start();
    file = _this.orUrlReserve(Lampa.Arrays.clone(file));

    network.clear();
    network.timeout(timeoutForAttempt(NEXUS_CONTENT_TIMEOUT, 1));
    network['native'](
        accountUrl(_this.normalizeUrl(file.url)),
        function (stream) {
            if (destroyed) return;
            if (useGlobalLoading) Lampa.Loading.stop();

            if (typeof stream === 'string') {
                try {
                    stream = JSON.parse(stream);
                } catch (e) {}
            }

            if (stream && stream.rch) {
                if (file._nexus_rch_retry) {
                    call(false, file);
                    return;
                }

                file._nexus_rch_retry = true;
                nexusRchEnsure(function () {
                    file.url = nexusRchRequestUrl(file.url);
                    _this.getFileUrl(file, call);
                }, function () {
                    call(false, file);
                });
                return;
            }

            if (stream && stream.url) {
                stream.url = _this.normalizeUrl(stream.url);
                stream = _this.orUrlReserve(stream);
                call(stream, file);
            } else {
                if (file.url_reserve) {
                    file.url = file.url_reserve;
                    file.url_reserve = '';
                    _this.getFileUrl(file, call);
                    return;
                }
                call(false, file);
            }
        },
        function () {
            if (destroyed) return;
            if (useGlobalLoading) Lampa.Loading.stop();
            if (file.url_reserve) {
                file.url = file.url_reserve;
                file.url_reserve = '';
                _this.getFileUrl(file, call);
                return;
            }
            call(false, file);
        },
        false,
        {
            dataType: 'text',
            headers: addHeaders()
        }
    );

    return;
}

if (file.stream) {
    var prepared = Lampa.Arrays.clone(file);
    prepared.url = _this.normalizeUrl(file.stream);
    prepared.method = 'play';
    prepared = _this.orUrlReserve(prepared);
    call(prepared, file);
    return;
}

call(false, file);
};

                // ── normalizeUrl ─────────────────────────────────────────────────────
        this.normalizeUrl = function (url) {
    if (!url) return '';

    url = String(url).trim();

    url = url.replace(/^https?:\/\/127\.0\.0\.1:9118/i, NEXUS_HOST);
    url = url.replace(/^https?:\/\/localhost:9118/i, NEXUS_HOST);

    return url;
};

        this.decorateDisplayQuality = function (data) {
            if (!data || typeof data !== 'object') return data;

            var source = nexusSourceKey(balanser);
            var stream = data.url || data.stream || '';
            var current = data.quality;
            var labels = [];
            var hasQualityObject = current && typeof current === 'object' && Object.keys(current).length;

            if (typeof stream !== 'string' || !stream) return data;

            if (source === 'phantom') {
                labels = nexusQualityLadder(data.maxquality || (hasQualityObject ? Object.keys(current)[0] : current));
            } else if (hasQualityObject) {
                return data;
            }

            if (source === 'kinotochka') labels = ['720p'];
            if (source === 'uafilm') labels = ['1080p'];

            if (!labels.length) return data;

            if (!hasQualityObject) data.quality = {};

            labels.forEach(function (label) {
                if (!data.quality[label]) data.quality[label] = stream;
            });

            return data;
        };

        this.applySerialQualityHint = function (data, hint) {
            if (!is_serial || !data || !data.episode || data.quality && Object.keys(data.quality).length) return data;

            hint = String(hint || serial_quality_hint || '');
            var labels = nexusQualityLadder(hint);
            var stream = data.stream || data.url || '';
            if (!labels.length || !stream) return data;

            data.quality = {};
            labels.forEach(function (label) {
                data.quality[label] = stream;
            });

            return data;
        };

        this.qualityUrl = function (value) {
            if (!value) return '';
            if (typeof value === 'string') return value;
            if (typeof value === 'object') return value.url || value.link || value.file || value.src || '';
            return '';
        };

        this.normalizeQuality = function (quality) {
            if (!quality || typeof quality !== 'object') return {};

            var normalized = {};

            Object.keys(quality).forEach(function (q) {
                var value = quality[q];
                var url = _this.qualityUrl(value);
                if (!url) return;

                url = _this.normalizeUrl(url);

                if (typeof value === 'object') {
                    var copy = Lampa.Arrays.clone(value);
                    copy.url = url;
                    normalized[q] = copy;
                } else {
                    normalized[q] = url;
                }
            });

            return normalized;
        };

        this.rememberSerialQuality = function (item, stream) {
            if (!is_serial || !serial_choice.season || !serial_choice.voice) return;

            var quality = _this.normalizeQuality(stream && stream.quality || item && item.quality || {});
            if (!Object.keys(quality).length) return;

            var info = serial_seasons[serial_choice.season] || {};
            var voice = info.voices && info.voices[serial_choice.voice];
            if (!voice || !voice.episodes) return;

            Lampa.Arrays.getKeys(voice.episodes).forEach(function (key) {
                var episode = voice.episodes[key];
                if (!episode) return;
                episode.quality = Lampa.Arrays.clone(quality);
                if (episode.item) episode.item.quality = Lampa.Arrays.clone(quality);
            });
        };

        this.qualityScore = function (name) {
            name = String(name || '').toLowerCase();

            if (/2160|4k|uhd/.test(name)) return 2160;
            if (/1440|2k/.test(name)) return 1440;
            if (/1080|fhd|full/.test(name)) return 1080;
            if (/720|hd/.test(name)) return 720;
            if (/480/.test(name)) return 480;
            if (/360/.test(name)) return 360;
            if (/240/.test(name)) return 240;

            var n = parseInt(name, 10);
            return isNaN(n) ? 0 : n;
        };

        this.bestQualityUrl = function (quality) {
            if (!quality || typeof quality !== 'object') return '';

            var keys = Object.keys(quality).sort(function (a, b) {
                return _this.qualityScore(b) - _this.qualityScore(a);
            });

            for (var i = 0; i < keys.length; i++) {
                var url = _this.qualityUrl(quality[keys[i]]);
                if (url) return _this.normalizeUrl(url);
            }

            return '';
        };

        this.timelineHash = function (item) {
            if (!Lampa.Timeline || !Lampa.Utils || !Lampa.Utils.hash) return 0;

            item = item || {};

            var movie = object.movie || {};
            var season = parseInt(item.season || serial_choice.season || 0, 10);
            var episode = parseInt(item.episode || serial_choice.episode || 0, 10);

            if (is_serial && season && episode) {
                var serialName = movie.original_name || movie.original_title || movie.name || movie.title || movie.id || '';
                return serialName ? Lampa.Utils.hash([season, season > 10 ? ':' : '', episode, serialName].join('')) : 0;
            }

            var movieName = movie.original_title || movie.original_name || movie.title || movie.name || movie.id || '';
            return movieName ? Lampa.Utils.hash(movieName) : 0;
        };

        this.timelineForItem = function (item) {
            var hash = _this.timelineHash(item);
            return hash && Lampa.Timeline && Lampa.Timeline.view ? Lampa.Timeline.view(hash) : null;
        };

        this.episodeProgress = function (item) {
            return nexusTimelineProgress(_this.timelineForItem(item));
        };

        this.refreshSerialEpisodesAfterPlayer = function () {
            if (!is_serial || !serial_choice.season || !Lampa.Player || !Lampa.Player.listener) return;

            if (serial_player_close_listener) {
                try { Lampa.Player.listener.remove('destroy', serial_player_close_listener); } catch (e) {}
            }

            serial_player_close_listener = function () {
                try { Lampa.Player.listener.remove('destroy', serial_player_close_listener); } catch (e) {}
                serial_player_close_listener = null;

                // Timeline is written by the player on close. Defer the redraw
                // one tick so the episode list receives the freshly saved value.
                setTimeout(function () {
                    if (destroyed || !serial_choice.season) return;

                    serial_choice.episode = 0;
                    serial_episode_url = '';
                    _this.saveSerialChoice();
                    _this.parse([]);
                }, 80);
            };

            Lampa.Player.listener.follow('destroy', serial_player_close_listener);
        };

        this.pickEpisodeItem = function (items, season, episode) {
            if (!items || !items.length) return null;

            var filtered = items.filter(function (item) {
                var s = parseInt(item.season || 0, 10);
                var e = parseInt(item.episode || 0, 10);

                if (s && e) return s === season && e === episode;
                return true;
            }).filter(function (item) {
                return !item.folder && (item.url || item.method || item.stream || item.quality);
            });

            if (!filtered.length) filtered = items.filter(function (item) {
                return !item.folder && (item.url || item.method || item.stream || item.quality);
            });

            if (serial_choice.voice) {
                var voiced = filtered.filter(function (item) {
                    return _this.voiceKey(item) === serial_choice.voice;
                });

                if (voiced.length) filtered = voiced;
            }

            filtered.sort(function (a, b) {
                var aq = a.quality && typeof a.quality === 'object' ? Object.keys(a.quality).sort(function (x, y) {
                    return _this.qualityScore(y) - _this.qualityScore(x);
                })[0] : '';
                var bq = b.quality && typeof b.quality === 'object' ? Object.keys(b.quality).sort(function (x, y) {
                    return _this.qualityScore(y) - _this.qualityScore(x);
                })[0] : '';

                return _this.qualityScore(bq) - _this.qualityScore(aq);
            });

            return filtered[0] || null;
        };

        this.makePlayData = function (item, stream, original) {
            item = item || {};
            stream = stream || {};
            original = original || {};

            var quality = _this.normalizeQuality(stream.quality || original.quality || item.quality || {});
            var bestUrl = _this.bestQualityUrl(quality);
            var title = item.text || item.title || object.movie.title || object.movie.name || 'Video';

            var play = {
                url: bestUrl || _this.normalizeUrl(stream.url || original.url || item.url || ''),
                title: title,
                quality: quality,
                headers: original.headers || stream.headers,
                segments: original.segments || stream.segments,
                hls_manifest_timeout: original.hls_manifest_timeout || stream.hls_manifest_timeout,
                subtitle: stream.subtitle || item.subtitle || '',
                subtitles: stream.subtitles || item.subtitles,
                subtitles_call: original.subtitles_call || stream.subtitles_call,
                timeline: original.timeline || stream.timeline || _this.timelineForItem(item),
                url_reserve: stream.url_reserve || original.url_reserve || item.url_reserve || '',
                card: object.movie,
                isonline: true
            };

            if (!play.url && stream.url) play.url = _this.normalizeUrl(stream.url);
            if (play.subtitle) play.subtitle = _this.normalizeUrl(play.subtitle);
            if (play.url_reserve) play.url_reserve = _this.normalizeUrl(play.url_reserve);

            if (stream.subtitles && Array.isArray(stream.subtitles)) {
                play.subtitles = stream.subtitles.map(function (s) {
                    return {
                        label: s.label || '',
                        url: _this.normalizeUrl(s.url || ''),
                        method: s.method || 'link'
                    };
                });
            }

            return play;
        };

        this.resolveEpisodePlaylistEntry = function (entry, done) {
            if (destroyed) return;
            var season = parseInt(entry.season || 0, 10);
            var episode = parseInt(entry.episode || 0, 10);
            var episodeUrl = entry.nexus_episode_url || '';

            serial_choice.season = season;
            serial_choice.episode = episode;
            serial_episode_url = episodeUrl;
            _this.saveSerialChoice();

            var url = episodeUrl ?
                accountUrl(_this.normalizeUrl(episodeUrl)) :
                requestParams(source_url, object.movie, { s: season, e: episode, season: season, episode: episode });

            loadContent(
                url,
                { timeout: timeoutForAttempt(NEXUS_CONTENT_TIMEOUT, 1), cache: false },
                function (data) {
                    if (destroyed) return;
                    var items = _this.parseItems(data);
                    _this.collectSerialOptions(items);
                    _this.collectSerialVoices(items);

                    var item = _this.pickEpisodeItem(items, season, episode);

                    if (!item) {
                        Lampa.Noty.show('Video was not found for this episode');
                        return;
                    }

                    _this.getFileUrl(item, function (stream, original) {
                        if (!stream || !stream.url) {
                            Lampa.Noty.show('Could not get video link');
                            return;
                        }

                        var play = _this.makePlayData(item, stream, original);
                        play.playlist = _this.buildEpisodePlaylist(item, play);

                        Object.keys(play).forEach(function (key) {
                            entry[key] = play[key];
                        });

                        entry.nexus_episode_url = episodeUrl || item.url || '';

                        if (done) done();
                    });
                },
                function () {
                    if (destroyed) return;
                    Lampa.Noty.show('Episode loading error');
                }
            );
        };

        this.buildEpisodePlaylist = function (item, play) {
            if (!is_serial || !serial_choice.season) return null;

            var season = parseInt((item && item.season) || serial_choice.season || 0, 10);
            var currentEpisode = parseInt((item && item.episode) || serial_choice.episode || 0, 10);
            var info = serial_seasons[season];

            if (!info || !info.episodes) return null;

            var episodeMap = _this.currentEpisodeMap(season, serial_choice.voice);
            var episodes = Lampa.Arrays.getKeys(episodeMap).map(function (k) {
                return parseInt(k, 10);
            }).filter(function (n) {
                return !!n;
            }).sort(function (a, b) {
                return a - b;
            });

            if (episodes.length < 2) return null;

            return episodes.map(function (episode) {
                var ep = episodeMap[episode] || {};
                var entry = {
                    title: episode + ' \u0441\u0435\u0440\u0438\u044f',
                    season: season,
                    episode: episode,
                    nexus_episode_url: ep.url || '',
                    timeline: _this.timelineForItem({ season: season, episode: episode }),
                    card: object.movie,
                    isonline: true,
                    callback: function () {
                        serial_choice.season = season;
                        serial_choice.episode = episode;
                        serial_episode_url = ep.url || '';
                        _this.saveSerialChoice();
                    }
                };

                if (episode === currentEpisode) {
                    entry.url = play.url;
                    entry.quality = play.quality;
                    entry.subtitles = play.subtitles;
                    entry.subtitle = play.subtitle;
                    entry.headers = play.headers;
                    entry.segments = play.segments;
                    entry.url_reserve = play.url_reserve;
                } else {
                    entry.url = function (next) {
                        _this.resolveEpisodePlaylistEntry(entry, next);
                    };
                }

                return entry;
            });
        };

        // ── open ─────────────────────────────────────────────────────────────
                // ── open ─────────────────────────────────────────────────────────────
        this.open = function (item) {
            if (destroyed) return;

            if (item && item.nexus_original_subs_action) {
                _this.openOriginalSubs();
                return;
            }

            if (is_serial && item && item.nexus_serial_action) {
                if (item.nexus_serial_action === 'season') {
                    _this.selectSerialSeason(item.season);
                } else if (item.nexus_serial_action === 'voice') {
                    _this.selectSerialVoice(item);
                } else if (item.nexus_serial_action === 'episode') {
                    _this.selectSerialEpisode(item);
                }
                return;
            }

            if (item.folder || (!item.url && !item.method && !item.stream)) {
                Lampa.Activity.push({
                    url:          item.url || '',
                    title:        NEXUS_TITLE,
                    component:    NEXUS_COMPONENT,
                    movie:        object.movie,
                    page:         1,
                    balanser:     balanser,
                    nexus_folder: true
                });
                return;
            }

            _this.getFileUrl(item, function (stream, original) {
                if (destroyed) return;
                nexusLog('[Lumio] PLAY item:', item);
                nexusLog('[Lumio] PLAY stream:', stream);
                original = original || {};

                if (!stream || !stream.url) {
                    Lampa.Noty.show('Не удалось получить ссылку на видео');
                    return;
                }

                var play = _this.makePlayData(item, stream, original);
                _this.rememberSerialQuality(item, stream);

                var episodePlaylist = _this.buildEpisodePlaylist(item, play);
                if (episodePlaylist && episodePlaylist.length) {
                    play.playlist = episodePlaylist;
                }
                
                nexusLog('[Lumio] FINAL URL:', play.url);
nexusLog('[Lumio] FINAL SUBTITLE:', play.subtitle);
nexusLog('[Lumio] FINAL QUALITY:', play.quality);

if (/^https?:\/\/(127\.0\.0\.1|localhost):9118/i.test(play.url)) {
    Lampa.Noty.show('Осталась локальная ссылка Lampac: ' + play.url);
    return;
}
                
                nexusTelemetry.event('play_intent');
                nexusTelemetry.source(balanser, 'play_intent');
                _this.refreshSerialEpisodesAfterPlayer();
                Lampa.Player.play(play);
            });
        };
        // ── parseItems ───────────────────────────────────────────────────────
        this.parseItems = function (str) {
            if (!str) return [];

            var responseQualityHint = '';
            if (typeof str === 'string') {
                var qualityMatch = str.match(/<!--\s*q\s*:\s*(\d{3,4}\s*p?)\s*-->/i);
                if (qualityMatch) responseQualityHint = qualityMatch[1].replace(/\s+/g, '');
            }
            if (is_serial && responseQualityHint) serial_quality_hint = responseQualityHint;

            function finish(items) {
                if (balanser !== 'pidtor') return items;

                var seen = {};
                return items.filter(function (item) {
                    var key = nexusPidtorKey(item);
                    if (!key || seen[key]) return false;
                    seen[key] = true;
                    return true;
                });
            }

            try {
    var j = (typeof str === 'object') ? str : JSON.parse(str);
    if (Array.isArray(j)) {
        return finish(j.map(function (data) {
            data = data || {};

            var season  = parseInt(data.season || data.s || 0, 10);
var episode = parseInt(data.episode || data.e || 0, 10);
var titleText = data.text || data.title || '';

if (!season && titleText) {
    var sm = titleText.match(/(\d+)\s*(?:сезон|season)/i);
    if (sm) season = parseInt(sm[1], 10);
}
if (!episode && titleText) {
    var em = titleText.match(/(\d+)\s*(?:серия|episode)/i);
    if (em) episode = parseInt(em[1], 10);
}

if (season)  data.season  = season;
if (episode) data.episode = episode;

if (object.movie.name && data.season && !data.episode) {
    data.folder = true;
}

            if (data.url)     data.url     = _this.normalizeUrl(data.url);
            if (data.stream)  data.stream  = _this.normalizeUrl(data.stream);
            if (data.subtitle) data.subtitle = _this.normalizeUrl(data.subtitle);

            if (data.quality && typeof data.quality === 'object') {
                Object.keys(data.quality).forEach(function (q) {
                    data.quality[q] = _this.normalizeUrl(data.quality[q]);
                });
            }

            if (balanser === 'pidtor' && data.maxquality && !data.quality) {
                data.quality = {};
                data.quality[String(data.maxquality) + 'p'] = data.url || data.stream || '';
            }

            _this.decorateDisplayQuality(data);
            _this.applySerialQualityHint(data, responseQualityHint);
            return data;
        }));
    }
} catch (e1) {}

            var result = [];
            try {
                var html = $('<div>' + str + '</div>');
                html.find('[data-json]').each(function () {
                    var el   = $(this);
                    var data = {};
                    try { data = JSON.parse(el.attr('data-json') || '{}'); } catch (e2) {}
                    var s    = el.attr('s');
                    var ep   = el.attr('e');
                    var text = el.text();

                    if (!object.movie.name) {
                        if (text && /\d+p/i.test(text)) {
                            if (!data.quality) { data.quality = {}; data.quality[text] = data.url; }
                            text = object.movie.title;
                        }
                        if (text === 'По умолчанию') text = object.movie.title;
                    }

                    if (ep)   data.episode = parseInt(ep, 10);
if (s)    data.season  = parseInt(s, 10);
if (text) data.text    = text;

if (!data.season && text) {
    var smh = text.match(/(\d+)\s*(?:сезон|season)/i);
    if (smh) data.season = parseInt(smh[1], 10);
}
if (!data.episode && text) {
    var emh = text.match(/(\d+)\s*(?:серия|episode)/i);
    if (emh) data.episode = parseInt(emh[1], 10);
}

if (object.movie.name && data.season && !data.episode) {
    data.folder = true;
}
                    data.active = el.hasClass('active');

                    if (data.url) data.url = _this.normalizeUrl(data.url);
if (data.stream) data.stream = _this.normalizeUrl(data.stream);
if (data.subtitle) data.subtitle = _this.normalizeUrl(data.subtitle);

if (data.quality && typeof data.quality === 'object') {
    Object.keys(data.quality).forEach(function (q) {
        data.quality[q] = _this.normalizeUrl(data.quality[q]);
    });
}

if (balanser === 'pidtor' && data.maxquality && !data.quality) {
    data.quality = {};
    data.quality[String(data.maxquality) + 'p'] = data.url || data.stream || '';
}

_this.decorateDisplayQuality(data);
_this.applySerialQualityHint(data, responseQualityHint);
if (data.url || data.method || data.stream) result.push(data);
                });
            } catch (e3) {}

            return finish(result);
        };

        // ── doesNotAnswer ────────────────────────────────────────────────────
        this.doesNotAnswer = function (er) {
    if (destroyed) return;
    er = er || {};

    var msg = 'Нет соединения';

    if (er.readyState === 0) {
        msg = 'Запрос к Lampac заблокирован (CORS) или сервер недоступен';
    } else if (er.msg) {
        msg = er.msg;
    }

    scroll.clear();
    var html = Lampa.Template.get('nexus_doesnotanswer', {
        title: Lampa.Lang.translate('lumio_error_title') || 'Ошибка',
        text: msg
    });

    scroll.append(html);
    _this.loading(false);
};
        var controller_ready = false;
        
        this.create = function () {
            return this.render();
        };

        this.start = function () {
            if (destroyed) return;
            if (Lampa.Activity.active().activity !== _this.activity) return;

            if (!initialized) {
                initialized = true;
                _this.initialize();
            }

            Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));

            if (!controller_ready) {
                controller_ready = true;

                Lampa.Controller.add('content', {
    toggle: function () {
        try {
            var first = scroll.render().find('.selector').first();
            var target = null;

            if (last && $(last).closest(scroll.render()).length) {
                target = $(last).closest('.selector')[0];
            }

            if (!target && first.length) {
                target = first[0];
            }

            Lampa.Controller.collectionSet(scroll.render(), files.render());

            if (target) {
                Lampa.Controller.collectionFocus(target, scroll.render());
                last = target;
                scroll.update($(target), true);
            }
        } catch (e) {
            console.error('[Lumio] controller toggle error:', e);
        }
    },
    gone: function () {},
    up: function () {
        if (Navigator.canmove('up')) {
            Navigator.move('up');
        } else {
            Lampa.Controller.toggle('head');
        }
    },
    down: function () {
        Navigator.move('down');
    },
    right: function () {
        if (Navigator.canmove('right')) {
            Navigator.move('right');
        } else {
            filter.show(Lampa.Lang.translate('title_filter'), 'filter');
        }
    },
    left: function () {
        if (Navigator.canmove('left')) {
            Navigator.move('left');
        } else {
            Lampa.Controller.toggle('menu');
        }
    },
    back: function () {
        try {
            _this.back();
        } catch (e) {
            console.error('[Lumio] back error:', e);
        }
    }
});
}

            Lampa.Controller.toggle('content');
        };

        this.render = function () {
            return files.render();
        };

        this.pause = function () {};

        this.stop = function () {
            _this.destroy();
        };

        this.destroy = function () {
            if (destroyed) return;

            destroyed = true;
            request_token++;
            _this.stopSerialCoveragePrefetch();
            _this.stopLoadingStatus();
            clearTimeout(number_requests_timer);
            number_requests_timer = null;
            network.clear();
            if (serial_player_close_listener && Lampa.Player && Lampa.Player.listener) {
                try { Lampa.Player.listener.remove('destroy', serial_player_close_listener); } catch (e) {}
                serial_player_close_listener = null;
            }
            try { files.destroy(); } catch (e) {}
            try { scroll.destroy(); } catch (e) {}
            try { filter.destroy(); } catch (e) {}
        };

        this.back = function () {
            if (is_serial) {
                if (serial_choice.episode) {
                    serial_choice.episode = 0;
                    serial_episode_url = '';
                    _this.saveSerialChoice();
                    _this.parse([]);
                    return;
                }

                if (serial_choice.voice) {
                    if (_this.currentVoiceList(serial_choice.season).length <= 1) {
                        serial_choice.season = 0;
                    }

                    serial_choice.voice = '';
                    serial_choice.voice_name = '';
                    serial_choice.episode = 0;
                    serial_episode_url = '';
                    _this.saveSerialChoice();
                    _this.parse([]);
                    return;
                }

                if (serial_choice.season) {
                    serial_choice.season = 0;
                    serial_choice.voice = '';
                    serial_choice.voice_name = '';
                    serial_choice.episode = 0;
                    serial_episode_url = '';
                    _this.saveSerialChoice();
                    _this.parse([]);
                    return;
                }
            }

            try {
                Lampa.Activity.backward();
            } catch (e) {
                console.error('[Lumio] backward error:', e);
            }
        };

        this.getChoice = function (name) {
            return Lampa.Storage.get('lumio_choice_' + (name || balanser), {
                season: 0,
                voice: 0,
                voice_url: '',
                voice_name: ''
            });
        };

        this.saveChoice = function (val, name) {
            Lampa.Storage.set('lumio_choice_' + (name || balanser), val);
        };

        this.replaceChoice = function (val) {
            _this.saveChoice(val);
        };

}

    Lampa.Component.add(NEXUS_COMPONENT, component);

    function openNexus(movie) {
        if (!movie) return;
        Lampa.Activity.push({
            url:       '',
            title:     NEXUS_TITLE,
            component: NEXUS_COMPONENT,
            movie:     movie,
            page:      1
        });
    }


var nexusCardButtonHtml =
    '<div class="full-start__button selector view--online nexus--button" data-subtitle="V' + NEXUS_VERSION + '">' +
        NEXUS_MENU_ICON +
        NEXUS_LOGO_SVG +
        '<span>' + NEXUS_TITLE + '</span>' +
    '</div>';

var nexusButtonObserverTimer = null;

// [V10] Последняя загруженная «полная» карточка: в ней есть imdb_id, original_language
// и корректные title/name — Lumio точнее находит источники.
var lumioLastFullMovie = null;

function getActiveMovie() {
    try {
        var act = Lampa.Activity.active();
        if (!act) return null;
        var card = act.card || act.movie || (act.activity && act.activity.card) || null;
        var full = lumioLastFullMovie;

        if (card && full && String(full.id) === String(card.id)) {
            var merged = {};
            var k;
            for (k in card) if (Object.prototype.hasOwnProperty.call(card, k)) merged[k] = card[k];
            for (k in full) if (Object.prototype.hasOwnProperty.call(full, k) && full[k] !== undefined) merged[k] = full[k];
            if (card.source) merged.source = card.source;
            if (card.method) merged.method = card.method;
            if (card.type)   merged.type   = card.type;
            return merged;
        }

        return card;
    } catch (e) {
        return null;
    }
}

function insertNexusButton() {
    try {
        var act = Lampa.Activity.active();
        if (!act || act.component !== 'full') return false;

        var render = act.activity && act.activity.render ? act.activity.render() : $();
        var scope = render && render.length ? render : $('.full').last();
        var buttons = scope.find('.full-start__button').filter(function () {
            return !$(this).closest('.modal, .selectbox, .settings, .menu, .nexus-container').length;
        });

        // .view--online only exists when another online plugin already added it.
        // Prefer the stable Watch/Torrent button and fall back to any full-card action.
        var anchor = buttons.filter('.view--torrent').first();
        if (!anchor.length) anchor = buttons.filter('.view--online:not(.nexus--button)').first();
        if (!anchor.length) anchor = buttons.not('.nexus--button').last();

        if (!anchor.length) return false;

        var holder = anchor.parent();
        var current = holder.children('.nexus--button');

        $('.full-start__button.nexus--button').not(current).remove();

        if (current.length) return true;

        var btn = $(nexusCardButtonHtml);

        btn.on('hover:enter', function () {
            var activeMovie = getActiveMovie();
            if (activeMovie) openNexus(activeMovie);
        });

        anchor.after(btn);
        nexusLog('[Lumio] button inserted into full-card actions');
        return true;
    } catch (e) {
        console.error('[Lumio] insertNexusButton error:', e);
        return false;
    }
}

function startNexusButtonWatcher() {
    try {
        if (nexusButtonObserverTimer) clearInterval(nexusButtonObserverTimer);

        var attempts = 0;

        nexusButtonObserverTimer = setInterval(function () {
            attempts++;

            var inserted = insertNexusButton();

            if (inserted || attempts >= 40) {
                clearInterval(nexusButtonObserverTimer);
                nexusButtonObserverTimer = null;
                nexusLog('[Lumio] watcher stop, inserted:', inserted, 'attempts:', attempts);
            }
        }, 250);
    } catch (e) {
        console.error('[Lumio] startNexusButtonWatcher error:', e);
    }
}

if (Lampa.Listener && Lampa.Listener.follow) {
    Lampa.Listener.follow('app', function (e) {
        if (e.type === 'ready') {
            setTimeout(startNexusButtonWatcher, 0);
            setTimeout(startNexusButtonWatcher, 500);
            setTimeout(startNexusButtonWatcher, 1500);
        }
    });

    Lampa.Listener.follow('full', function (e) {
        nexusLog('[Lumio] full event:', e.type);
        // [V10] в Lampa событие называется «complite» (с опечаткой) — поддерживаем оба написания
        if ((e.type === 'complite' || e.type === 'complete') && e.data && e.data.movie) lumioLastFullMovie = e.data.movie;
        registerNexusManifest();
        setTimeout(startNexusButtonWatcher, 0);
        setTimeout(startNexusButtonWatcher, 300);
        setTimeout(startNexusButtonWatcher, 1000);
    });

    Lampa.Listener.follow('activity', function (e) {
        setTimeout(startNexusButtonWatcher, 0);
        setTimeout(startNexusButtonWatcher, 500);
    });
}

    var manifst = {
        type:    'video',
        version: NEXUS_VERSION,
        name:    NEXUS_TITLE,
        description: 'Онлайн просмотр через Lampac',
        icon:    NEXUS_MENU_ICON,
        component: NEXUS_COMPONENT,
        onContextMenu: function (obj) {
            return {
                name:        NEXUS_TITLE,
                description: Lampa.Lang.translate('lumio_watch') || 'Смотреть онлайн',
                icon:        NEXUS_MENU_ICON
            };
        },
        onContextLauch: function (obj) {
            openNexus(obj);
        }
    };

    function registerNexusManifest() {
        if (!Lampa.Manifest) return false;

        var plugins = Lampa.Manifest.plugins;

        Lampa.Component.add(NEXUS_COMPONENT, component);
        resetTemplates();

        // Depending on the Lampa build and plugin load order, this can be
        // either one manifest object or an array. Always normalise it first.
        if (Object.prototype.toString.call(plugins) !== '[object Array]') {
            plugins = plugins && typeof plugins === 'object' ? [plugins] : [];
        }

        for (var i = plugins.length - 1; i >= 0; i--) {
            if (plugins[i] && plugins[i].component === manifst.component) {
                plugins.splice(i, 1);
            }
        }

        plugins.unshift(manifst);
        Lampa.Manifest.plugins = plugins;
        return true;
    }

    registerNexusManifest();



    if (Lampa.Lang && Lampa.Lang.add) {
    Lampa.Lang.add({
        lumio_watch: {
            ru: 'Смотреть онлайн',
            uk: 'Дивитися онлайн',
            en: 'Watch online'
        },
        lumio_balanser: {
            ru: 'Источник',
            uk: 'Джерело',
            en: 'Source'
        },
        lumio_no_sources: {
            ru: 'Нет соединения с сервером или сервер не вернул источники',
            uk: 'Немає зʼєднання з сервером або сервер не повернув джерела',
            en: 'No connection to server or no sources returned'
        },
        lumio_error_title: {
            ru: 'Ошибка',
            uk: 'Помилка',
            en: 'Error'
        }
    });
}

    nexusLog('[Lumio] v' + NEXUS_VERSION + ' loaded | server: ' + NEXUS_HOST);

    // [V10] initLumio() вызывается уже после события app:ready — запускаем то, что оригинал делал по нему
    LUMIO.clearCache = lumioClearCache;
    LUMIO.ready = true;
    setTimeout(lumioPruneCache, 3000);
    setTimeout(startNexusButtonWatcher, 0);
    setTimeout(startNexusButtonWatcher, 500);
    setTimeout(startNexusButtonWatcher, 1500);
    }

    // Настройки Lumio (очистка кэша)
    function addLumioSettings() {
        try {
            Lampa.SettingsApi.addComponent({
                component: 'v10_lumio',
                icon: '<svg height="60" viewBox="0 0 24 24" width="60" fill="currentColor">' +
                          '<path d="M8 5v14l11-7L8 5Z"/>' +
                      '</svg>',
                name: 'Lumio (онлайн)'
            });

            Lampa.SettingsApi.addParam({
                component: 'v10_lumio',
                param: { name: 'v10_lumio_clear', type: 'button', default: '' },
                field: {
                    name: 'Очистить кэш Lumio',
                    description: 'Версия ' + LUMIO.version + ' · сбросить кэш списков источников и ответов'
                },
                onRender: function (item) {
                    item.on('hover:enter', function () {
                        LUMIO.clearCache();
                        noty('Кэш Lumio очищен');
                    });
                }
            });
        } catch (e) {
            console.warn('[V10 lumio] addSettings failed:', e);
        }
    }

    // ================================================================
    //  МЕНЮ
    // ================================================================
    function buildMenuItem(action, text, svg, onEnter) {
        var item = $(
            '<li class="menu__item selector" data-action="' + action + '">' +
                '<div class="menu__ico">' + svg + '</div>' +
                '<div class="menu__text">' + text + '</div>' +
            '</li>'
        );
        item.on('hover:enter', onEnter);
        return item;
    }

    var MENU_ITEMS = [
        {
            action: 'v10',
            text: SOURCE_NAME,
            svg: '<svg height="36" viewBox="0 0 24 24" width="36" fill="currentColor">' +
                     '<path d="M12 2L2 8V20H8V14H16V20H22V8L12 2ZM4 10L12 6L20 10V18H17V12H7V18H4V10Z"/>' +
                     '<path d="M9 13H15V15H9V13Z"/>' +
                 '</svg>',
            onEnter: function () {
                Lampa.Activity.push({
                    title: SOURCE_NAME,
                    component: 'category',
                    source: SOURCE_NAME,
                    method: 'category'
                });
            }
        },
        {
            action: 'torrserver_switcher',
            text: 'TorrServer',
            svg: '<svg height="36" viewBox="0 0 24 24" width="36" fill="currentColor">' +
                     '<path d="M4 3H20C21.1 3 22 3.9 22 5V9C22 10.1 21.1 11 20 11H4C2.9 11 2 10.1 2 9V5C2 3.9 2.9 3 4 3ZM4 13H20C21.1 13 22 13.9 22 15V19C22 20.1 21.1 21 20 21H4C2.9 21 2 20.1 2 19V15C2 13.9 2.9 13 4 13ZM6 6.5C5.45 6.5 5 6.95 5 7.5C5 8.05 5.45 8.5 6 8.5C6.55 8.5 7 8.05 7 7.5C7 6.95 6.55 6.5 6 6.5Z"/>' +
                 '</svg>',
            onEnter: function () { TS.pick('primary'); }
        },
        {
            action: 'v10_parsers',
            text: 'Парсеры',
            svg: '<svg height="36" viewBox="0 0 24 24" width="36" fill="currentColor">' +
                     '<path d="M12 2L2 7L12 12L22 7L12 2Z"/>' +
                     '<path d="M2 12L12 17L22 12L20 11L12 15L4 11L2 12Z"/>' +
                     '<path d="M2 17L12 22L22 17L20 16L12 20L4 16L2 17Z"/>' +
                 '</svg>',
            onEnter: function () { PARSERS.open(false); }
        }
    ];

    // Возвращает true, когда меню найдено и пункты на месте
    function addAllMenuItems() {
        var list = $('.menu .menu__list').eq(0);
        if (!list.length) list = $('.menu__list').eq(0);
        if (!list.length) return false;

        var fresh = [];
        MENU_ITEMS.forEach(function (m) {
            if ($('.menu__item[data-action="' + m.action + '"]').length) return;
            fresh.push(buildMenuItem(m.action, m.text, m.svg, m.onEnter));
        });
        if (!fresh.length) return true;

        // вставляем группой сразу после «Фильмы/Сериалы» (порядок пунктов сохраняется)
        var anchor = list.find('[data-action="movie"], [data-action="tv"]').last();
        if (anchor.length) {
            for (var i = fresh.length - 1; i >= 0; i--) anchor.after(fresh[i]);
        } else {
            fresh.forEach(function (el) { list.append(el); });
        }
        return true;
    }

    var menuRetryTimer = null;
    function ensureMenuItems() {
        if (menuRetryTimer) clearInterval(menuRetryTimer);
        var attempts = 0;
        menuRetryTimer = setInterval(function () {
            attempts++;
            var ok = false;
            try { ok = addAllMenuItems(); } catch (e) { console.warn('[V10] menu error:', e); }
            if (ok || attempts >= 40) {
                clearInterval(menuRetryTimer);
                menuRetryTimer = null;
            }
        }, 500);
    }

    // ================================================================
    //  INIT
    // ================================================================
    var started = false;

    function init() {
        if (started) return;
        started = true;

        safe('V10 source', function () { Lampa.Api.sources[SOURCE_NAME] = new RutorApiService(); });
        safe('TorrServer', function () { TS.init(); });
        safe('Parsers',    function () { PARSERS.init(); });

        if (CONFIG.lumio) {
            safe('Lumio', function () { initLumio(); });
            safe('Lumio settings', addLumioSettings);
        }

        safe('Menu', function () {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'render') ensureMenuItems();
            });
            ensureMenuItems();
        });

        log('[V10] all-in-one запущен');
    }

    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
