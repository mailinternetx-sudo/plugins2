/**
 * V10 + TorrServer Switcher + Parser/Jackett Catalog
 * Единый плагин для Lampa
 *
 * 1) Источник V10 — категории (Топ 24, фильмы/сериалы и т.д.) через WORKER_URL
 * 2) TorrServer Switcher — основной/резервный TorrServer + авто-failover
 * 3) Каталог парсеров (PubTorr/Jackett-style) — публичные Jackett/парсеры
 *    с живым статусом, выбор основного и резервного, запись в штатные
 *    ключи Lampa (jackett_url, jackett_key, parser_torrent_type и т.д.)
 */
(function () {
    'use strict';

    // ─── Общие константы ───────────────────────────────────────────────────
    var SOURCE_NAME = 'V10';
    var WORKER_URL  = 'https://my-proxy-worker.mail-internetx.workers.dev/';

    var TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
    var TMDB_BG  = 'https://image.tmdb.org/t/p/original';

    // ═══════════════════════════════════════════════════════════════════════
    //  ЧАСТЬ 1: V10 — КАТЕГОРИИ И API
    // ═══════════════════════════════════════════════════════════════════════

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

    function buildImg(item) {
        if (item.img && item.img.startsWith('http')) return item.img;
        if (item.poster_path) {
            if (item.poster_path.startsWith('http')) return item.poster_path;
            if (item.poster_path.startsWith('/t/p/')) return 'https://image.tmdb.org' + item.poster_path;
            return TMDB_IMG + item.poster_path;
        }
        return '';
    }

    function buildBg(item) {
        if (item.background_image && item.background_image.startsWith('http')) return item.background_image;
        if (item.backdrop_path) {
            if (item.backdrop_path.startsWith('http')) return item.backdrop_path;
            if (item.backdrop_path.startsWith('/t/p/')) return 'https://image.tmdb.org' + item.backdrop_path;
            return TMDB_BG + item.backdrop_path;
        }
        return '';
    }

    function detectMediaMethod(item) {
        if (!item) return 'movie';
        if (item.method === 'tv' || item.type === 'tv') return 'tv';
        if (item.method === 'movie' || item.type === 'movie') return 'movie';
        if (item.number_of_seasons || item.seasons || item.first_air_date) return 'tv';
        return 'movie';
    }

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

    function RutorApiService() {
        var self = this;
        self.network = new Lampa.Reguest();

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

        self._fetchRaw = function (url, onComplete, onError) {
            self.network.silent(
                url,
                function (json) {
                    if (!json || !json.results) {
                        onComplete({ results: [], total_pages: 1, page: 1, total_results: 0 });
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
                    console.warn('[V10] fetch error:', url, err);
                    if (onError) onError(err);
                    else {
                        onComplete({ results: [], total_pages: 1, page: 1, total_results: 0 });
                    }
                }
            );
        };

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

        self.category = function (params, onSuccess) {
            var rows  = [];
            var total = CATEGORIES.length;
            var done  = 0;

            CATEGORIES.forEach(function (cat) {
                var pageSize = cat.page_size_preview || 15;
                var url = WORKER_URL + cat.url + '?page=1&page_size=' + pageSize;

                self._fetchRaw(url, function (data) {
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
                });
            });
        };

        self.list = function (params, onComplete) {
            var page     = params.page || 1;
            var catUrl   = params.url  || 'top24';
            var meta     = CATEGORIES.find(function (c) { return c.url === catUrl; });
            var pageSize = params.page_size || (meta && meta.page_size) || 15;
            var url = WORKER_URL + catUrl + '?page=' + page + '&page_size=' + pageSize;

            self._fetchRaw(
                url,
                function (data) {
                    var unique = dedupClient(catUrl, data.results, page === 1);
                    unique = forceCardType(meta, unique);
                    onComplete({
                        results:       unique,
                        page:          data.page          || page,
                        total_pages:   data.total_pages   || 1,
                        total_results: data.total_results || unique.length
                    });
                },
                function () {
                    onComplete({ results: [], page: page, total_pages: 1, total_results: 0 });
                }
            );
        };

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

    // ═══════════════════════════════════════════════════════════════════════
    //  ЧАСТЬ 2: TORRSERVER SWITCHER
    // ═══════════════════════════════════════════════════════════════════════

    var TS_PLUGIN_ID = 'torrserver_switcher';
    var TS_SERVERS = [
        '178.150.255.251:8090',
        '109.237.108.184:8090',
        '95.174.115.119:8888',
        '91.201.54.146:8090',
        '45.144.53.25:37940',
        '95.67.104.126:43871',
        '178.150.115.242:8090',
        '95.165.134.227:8090'
    ];

    var STORAGE_TS_PRIMARY = 'torrserver_url';
    var STORAGE_TS_BACKUP  = 'torrserver_switcher_backup';
    var TS_CHECK_TIMEOUT   = 4000;
    var TS_AUTO_INTERVAL   = 5 * 60000;

    function tsNormalizeUrl(raw) {
        var u = (raw || '').trim();
        if (!u) return '';
        if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
        return u.replace(/\/+$/, '');
    }

    function tsShortAddr(url) {
        return (url || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }

    function noty(text) {
        try { Lampa.Noty.show(text); } catch (e) { console.log('[V10+] ' + text); }
    }

    function checkHttp(url, timeout, cb) {
        var full = tsNormalizeUrl(url);
        var done = false;
        var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;

        var timer = setTimeout(function () {
            if (done) return;
            done = true;
            if (controller) { try { controller.abort(); } catch (e) {} }
            cb(false);
        }, timeout || 4000);

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

    function tsCheckAll(onDone) {
        var results = new Array(TS_SERVERS.length);
        var left = TS_SERVERS.length;
        if (!left) { onDone([]); return; }

        TS_SERVERS.forEach(function (addr, idx) {
            var url = tsNormalizeUrl(addr);
            checkHttp(url, TS_CHECK_TIMEOUT, function (ok) {
                results[idx] = { addr: addr, url: url, ok: ok };
                left--;
                if (left === 0) onDone(results);
            });
        });
    }

    function getTsPrimary() { return Lampa.Storage.get(STORAGE_TS_PRIMARY, ''); }
    function getTsBackup()  { return Lampa.Storage.get(STORAGE_TS_BACKUP, ''); }

    function setTsPrimary(url, silent) {
        Lampa.Storage.set(STORAGE_TS_PRIMARY, url);
        if (!silent) noty('Основной TorrServer: ' + tsShortAddr(url));
    }
    function setTsBackup(url, silent) {
        Lampa.Storage.set(STORAGE_TS_BACKUP, url);
        if (!silent) noty('Резервный TorrServer: ' + tsShortAddr(url));
    }

    function tsPickServer(mode) {
        noty('Проверка серверов TorrServer…');
        tsCheckAll(function (results) {
            var currentUrl = mode === 'primary' ? getTsPrimary() : getTsBackup();

            var items = results.map(function (r) {
                var dot  = r.ok ? '🟢' : '🔴';
                var mark = (currentUrl && currentUrl.replace(/\/+$/, '') === r.url) ? ' ✓' : '';
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
                        noty('⚠ Этот сервер сейчас не отвечает. Выбран, но лучше выбрать зелёный.');
                    }
                    if (mode === 'primary') setTsPrimary(item.url);
                    else setTsBackup(item.url);
                },
                onBack: function () {
                    try { Lampa.Controller.toggle('settings_component'); }
                    catch (e) { try { Lampa.Controller.toggle('menu'); } catch (e2) {} }
                }
            });
        });
    }

    function tsAutoFailoverCheck() {
        var primary = getTsPrimary();
        var backup  = getTsBackup();
        if (!primary || !backup) return;

        checkHttp(primary, TS_CHECK_TIMEOUT, function (primaryOk) {
            if (primaryOk) return;
            checkHttp(backup, TS_CHECK_TIMEOUT, function (backupOk) {
                if (!backupOk) return;
                setTsPrimary(backup, true);
                noty('⚠ Основной TorrServer не отвечает. Переключено на резервный: ' + tsShortAddr(backup));
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
                    description: getTsPrimary() ? tsShortAddr(getTsPrimary()) : 'не выбран — нажмите, чтобы выбрать'
                },
                onRender: function (item) {
                    item.on('hover:enter', function () { tsPickServer('primary'); });
                }
            });

            Lampa.SettingsApi.addParam({
                component: TS_PLUGIN_ID,
                param: { name: TS_PLUGIN_ID + '_backup', type: 'button', default: '' },
                field: {
                    name: 'Резервный сервер',
                    description: getTsBackup()
                        ? tsShortAddr(getTsBackup()) + ' (авто-переключение при сбое)'
                        : 'не выбран — нажмите, чтобы выбрать'
                },
                onRender: function (item) {
                    item.on('hover:enter', function () { tsPickServer('backup'); });
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
                    item.on('hover:enter', function () { tsPickServer('primary'); });
                }
            });
        } catch (e) {
            console.warn('[TS-Switcher] addSettings failed:', e);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ЧАСТЬ 3: КАТАЛОГ ПАРСЕРОВ / JACKETT (аналог pubtorr + jackett)
    // ═══════════════════════════════════════════════════════════════════════

    var PARSER_PLUGIN_ID = 'v10_parser_catalog';

    // Публичные парсеры / Jackett-инстансы (типичный набор сообщества Lampa).
    // url — базовый адрес; key — API-ключ если нужен (часто пустой для публичных).
    // type: 'jackett' | 'prowlarr' | 'torrserver' (для записи в настройки Lampa)
    var PUBLIC_PARSERS = [
        { name: 'JacRed',           url: 'https://jacred.xyz',              key: '', type: 'jackett' },
        { name: 'JacRed (alt)',     url: 'https://jacred.freebie.se',       key: '', type: 'jackett' },
        { name: 'Jackett Public 1', url: 'http://jackett.cf',               key: '', type: 'jackett' },
        { name: 'Jackett Public 2', url: 'http://parser.lampa.stream',      key: '', type: 'jackett' },
        { name: 'Prowlarr Public',  url: 'https://prowlarr.lampa.stream',   key: '', type: 'prowlarr' },
        { name: 'TorrServer Parse', url: 'http://127.0.0.1:8090',           key: '', type: 'torrserver' }
    ];

    var STORAGE_PARSER_URL  = 'jackett_url';
    var STORAGE_PARSER_KEY  = 'jackett_key';
    var STORAGE_PARSER_TYPE = 'parser_torrent_type'; // jackett | prowlarr | ...
    var STORAGE_PARSER_USE  = 'parser_use';          // true = использовать парсер
    var STORAGE_PARSER_BACKUP_URL = 'v10_parser_backup_url';
    var STORAGE_PARSER_BACKUP_KEY = 'v10_parser_backup_key';
    var STORAGE_PARSER_BACKUP_TYPE = 'v10_parser_backup_type';

    var PARSER_CHECK_TIMEOUT = 5000;
    var PARSER_AUTO_INTERVAL  = 5 * 60000;

    function getParserPrimary() {
        return {
            url:  Lampa.Storage.get(STORAGE_PARSER_URL, ''),
            key:  Lampa.Storage.get(STORAGE_PARSER_KEY, ''),
            type: Lampa.Storage.get(STORAGE_PARSER_TYPE, 'jackett')
        };
    }
    function getParserBackup() {
        return {
            url:  Lampa.Storage.get(STORAGE_PARSER_BACKUP_URL, ''),
            key:  Lampa.Storage.get(STORAGE_PARSER_BACKUP_KEY, ''),
            type: Lampa.Storage.get(STORAGE_PARSER_BACKUP_TYPE, 'jackett')
        };
    }

    function applyParser(p, silent) {
        if (!p || !p.url) return;
        var url = tsNormalizeUrl(p.url);
        Lampa.Storage.set(STORAGE_PARSER_URL, url);
        Lampa.Storage.set(STORAGE_PARSER_KEY, p.key || '');
        Lampa.Storage.set(STORAGE_PARSER_TYPE, p.type || 'jackett');
        Lampa.Storage.set(STORAGE_PARSER_USE, true);
        // Некоторые сборки Lampa смотрят ещё и на эти ключи:
        try {
            Lampa.Storage.set('parser_jackett_url', url);
            Lampa.Storage.set('parser_jackett_key', p.key || '');
        } catch (e) {}
        if (!silent) noty('Парсер: ' + tsShortAddr(url) + ' (' + (p.type || 'jackett') + ')');
    }

    function setParserBackup(p, silent) {
        if (!p || !p.url) return;
        var url = tsNormalizeUrl(p.url);
        Lampa.Storage.set(STORAGE_PARSER_BACKUP_URL, url);
        Lampa.Storage.set(STORAGE_PARSER_BACKUP_KEY, p.key || '');
        Lampa.Storage.set(STORAGE_PARSER_BACKUP_TYPE, p.type || 'jackett');
        if (!silent) noty('Резервный парсер: ' + tsShortAddr(url));
    }

    function checkParser(entry, cb) {
        var base = tsNormalizeUrl(entry.url);
        // Пробуем типичные health/api точки Jackett/Prowlarr
        var paths = ['/', '/api/v2.0/indexers', '/health', '/api'];
        var idx = 0;

        function tryNext() {
            if (idx >= paths.length) { cb(false); return; }
            var path = paths[idx++];
            var full = base + path;
            var done = false;
            var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var timer = setTimeout(function () {
                if (done) return;
                done = true;
                if (controller) { try { controller.abort(); } catch (e) {} }
                tryNext();
            }, PARSER_CHECK_TIMEOUT);

            try {
                fetch(full, {
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
                    tryNext();
                });
            } catch (e) {
                if (!done) {
                    done = true;
                    clearTimeout(timer);
                    tryNext();
                }
            }
        }
        tryNext();
    }

    function checkAllParsers(onDone) {
        var results = new Array(PUBLIC_PARSERS.length);
        var left = PUBLIC_PARSERS.length;
        if (!left) { onDone([]); return; }

        PUBLIC_PARSERS.forEach(function (p, idx) {
            checkParser(p, function (ok) {
                results[idx] = {
                    name: p.name,
                    url: tsNormalizeUrl(p.url),
                    key: p.key || '',
                    type: p.type || 'jackett',
                    ok: ok
                };
                left--;
                if (left === 0) onDone(results);
            });
        });
    }

    function pickParser(mode) {
        noty('Проверка публичных парсеров…');
        checkAllParsers(function (results) {
            var current = mode === 'primary' ? getParserPrimary() : getParserBackup();
            var curUrl  = (current.url || '').replace(/\/+$/, '');

            var items = results.map(function (r) {
                var dot  = r.ok ? '🟢' : '🔴';
                var mark = (curUrl && curUrl === r.url.replace(/\/+$/, '')) ? ' ✓' : '';
                return {
                    title: dot + ' ' + r.name + mark,
                    subtitle: (r.ok ? 'работает' : 'не отвечает') + ' · ' + tsShortAddr(r.url) + ' · ' + r.type,
                    url: r.url,
                    key: r.key,
                    type: r.type,
                    ok: r.ok,
                    name: r.name
                };
            });

            // Пункт «ввести вручную»
            items.push({
                title: '✏️ Ввести адрес вручную',
                subtitle: 'Свой Jackett / Prowlarr / парсер',
                manual: true
            });

            Lampa.Select.show({
                title: mode === 'primary'
                    ? 'Парсер / Jackett — основной'
                    : 'Парсер / Jackett — резервный',
                items: items,
                onSelect: function (item) {
                    if (item.manual) {
                        // Простой ввод через prompt (на TV может не сработать — тогда через настройки Lampa)
                        var raw = '';
                        try {
                            raw = window.prompt('Адрес парсера (http://host:port или https://…)', current.url || '') || '';
                        } catch (e) {
                            noty('Ввод вручную недоступен на этом устройстве. Задайте адрес в Настройки → Парсер.');
                            return;
                        }
                        raw = raw.trim();
                        if (!raw) return;
                        var obj = { url: raw, key: '', type: 'jackett' };
                        if (mode === 'primary') applyParser(obj);
                        else setParserBackup(obj);
                        return;
                    }
                    if (!item.ok) {
                        noty('⚠ Этот парсер сейчас не отвечает. Выбран, но лучше выбрать зелёный.');
                    }
                    var obj = { url: item.url, key: item.key, type: item.type };
                    if (mode === 'primary') applyParser(obj);
                    else setParserBackup(obj);
                },
                onBack: function () {
                    try { Lampa.Controller.toggle('settings_component'); }
                    catch (e) { try { Lampa.Controller.toggle('menu'); } catch (e2) {} }
                }
            });
        });
    }

    function parserAutoFailoverCheck() {
        var primary = getParserPrimary();
        var backup  = getParserBackup();
        if (!primary.url || !backup.url) return;

        checkParser({ url: primary.url, key: primary.key, type: primary.type }, function (ok) {
            if (ok) return;
            checkParser({ url: backup.url, key: backup.key, type: backup.type }, function (bok) {
                if (!bok) return;
                applyParser(backup, true);
                noty('⚠ Основной парсер не отвечает. Переключено на резервный: ' + tsShortAddr(backup.url));
            });
        });
    }

    function addParserSettings() {
        try {
            Lampa.SettingsApi.addComponent({
                component: PARSER_PLUGIN_ID,
                icon: '<svg height="60" viewBox="0 0 24 24" width="60" fill="currentColor">' +
                      '<path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>' +
                      '</svg>',
                name: 'Парсеры / Jackett'
            });

            Lampa.SettingsApi.addParam({
                component: PARSER_PLUGIN_ID,
                param: { name: PARSER_PLUGIN_ID + '_primary', type: 'button', default: '' },
                field: {
                    name: 'Основной парсер',
                    description: (function () {
                        var p = getParserPrimary();
                        return p.url ? tsShortAddr(p.url) + ' (' + (p.type || 'jackett') + ')' : 'не выбран — нажмите, чтобы выбрать';
                    })()
                },
                onRender: function (item) {
                    item.on('hover:enter', function () { pickParser('primary'); });
                }
            });

            Lampa.SettingsApi.addParam({
                component: PARSER_PLUGIN_ID,
                param: { name: PARSER_PLUGIN_ID + '_backup', type: 'button', default: '' },
                field: {
                    name: 'Резервный парсер',
                    description: (function () {
                        var p = getParserBackup();
                        return p.url
                            ? tsShortAddr(p.url) + ' (авто-переключение при сбое)'
                            : 'не выбран — нажмите, чтобы выбрать';
                    })()
                },
                onRender: function (item) {
                    item.on('hover:enter', function () { pickParser('backup'); });
                }
            });

            Lampa.SettingsApi.addParam({
                component: PARSER_PLUGIN_ID,
                param: { name: PARSER_PLUGIN_ID + '_recheck', type: 'button', default: '' },
                field: {
                    name: 'Проверить все парсеры сейчас',
                    description: 'Обновить статус (зелёный/красный) каталога'
                },
                onRender: function (item) {
                    item.on('hover:enter', function () { pickParser('primary'); });
                }
            });
        } catch (e) {
            console.warn('[ParserCatalog] addSettings failed:', e);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  МЕНЮ
    // ═══════════════════════════════════════════════════════════════════════

    function addV10MenuItem() {
        if ($('.menu__item[data-action="v10"]').length) return;

        var item = $(
            '<li class="menu__item selector" data-action="v10">' +
                '<div class="menu__ico">' +
                    '<svg height="36" viewBox="0 0 24 24" width="36" fill="currentColor">' +
                        '<path d="M12 2L2 8V20H8V14H16V20H22V8L12 2ZM4 10L12 6L20 10V18H17V12H7V18H4V10Z"/>' +
                        '<path d="M9 13H15V15H9V13Z"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="menu__text">' + SOURCE_NAME + '</div>' +
            '</li>'
        );

        item.on('hover:enter', function () {
            Lampa.Activity.push({
                title: SOURCE_NAME,
                component: 'category',
                source: SOURCE_NAME,
                method: 'category'
            });
        });

        var $after = $('.menu__list [data-action="movie"], .menu__list [data-action="tv"]').first().parent();
        if ($after.length) $after.after(item);
        else $('.menu__list').append(item);
    }

    function addTsMenuItem() {
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

        item.on('hover:enter', function () { tsPickServer('primary'); });

        var $after = $('.menu__list [data-action="v10"]').first().parent();
        if (!$after.length) $after = $('.menu__list [data-action="settings"]').first().parent();
        if ($after.length) $after.after(item);
        else $('.menu__list').append(item);
    }

    function addParserMenuItem() {
        if ($('.menu__item[data-action="' + PARSER_PLUGIN_ID + '"]').length) return;

        var item = $(
            '<li class="menu__item selector" data-action="' + PARSER_PLUGIN_ID + '">' +
                '<div class="menu__ico">' +
                    '<svg height="36" viewBox="0 0 24 24" width="36" fill="currentColor">' +
                        '<path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="menu__text">Парсеры</div>' +
            '</li>'
        );

        item.on('hover:enter', function () { pickParser('primary'); });

        var $after = $('.menu__list [data-action="' + TS_PLUGIN_ID + '"]').first().parent();
        if (!$after.length) $after = $('.menu__list [data-action="v10"]').first().parent();
        if (!$after.length) $after = $('.menu__list [data-action="settings"]').first().parent();
        if ($after.length) $after.after(item);
        else $('.menu__list').append(item);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════════════════════════════════

    function init() {
        if (window.v10_unified_ready) return;
        window.v10_unified_ready = true;

        // V10 source
        Lampa.Api.sources[SOURCE_NAME] = new RutorApiService();

        // Settings
        addTorrServerSettings();
        addParserSettings();

        // Menu items
        setTimeout(function () {
            addV10MenuItem();
            addTsMenuItem();
            addParserMenuItem();
        }, 1500);

        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready' || e.type === 'render') {
                setTimeout(function () {
                    addV10MenuItem();
                    addTsMenuItem();
                    addParserMenuItem();
                }, 1000);
            }
        });

        // Фоновые проверки failover
        setTimeout(tsAutoFailoverCheck, 60000);
        setInterval(tsAutoFailoverCheck, TS_AUTO_INTERVAL);

        setTimeout(parserAutoFailoverCheck, 90000);
        setInterval(parserAutoFailoverCheck, PARSER_AUTO_INTERVAL);
    }

    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
