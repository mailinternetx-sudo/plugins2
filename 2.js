/**
 * Lampa plugin.js (V10) — v4 "all-in-one" (улучшенная версия)
 *
 * Состав:
 *  1) Источник каталога V10 (rutor-воркер) — категории, пагинация,
 *     дедупликация, корректное определение типа карточек (movie/tv).
 *  2) TorrServer Switcher — выбор основного/резервного TorrServer из
 *     списка с живой проверкой (🟢/🔴) и авто-failover раз в 5 минут.
 *  3) Каталог парсеров (по мотивам LME PubTorr) — выбор Jackett/Prowlarr
 *     парсера из списка с проверкой доступности и записью в штатные
 *     ключи Lampa (jackett_url / jackett_key / parser_torrent_type).
 *
 * Всё работает в одном файле, ставится как один плагин.
 */
(function () {
    'use strict';

    if (window.v10_all_in_one_ready) return;
    window.v10_all_in_one_ready = true;

    var SOURCE_NAME = 'V10';
    var WORKER_URL  = 'https://my-proxy-worker.mail-internetx.workers.dev/';

    var TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
    var TMDB_BG  = 'https://image.tmdb.org/t/p/original';

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

    function noty(text) {
        try { 
            if (window.Lampa && window.Lampa.Noty) {
                Lampa.Noty.show(text);
            } else {
                console.log('[V10] ' + text);
            }
        } catch (e) { 
            console.log('[V10] ' + text);
        }
    }

    // ================================================================
    //  УТИЛИТЫ ДЛЯ ПОСТЕРОВ
    // ================================================================
    function buildImg(item) {
        if (!item) return '';
        if (item.img && typeof item.img === 'string' && item.img.indexOf('http') === 0) return item.img;
        if (item.poster_path) {
            if (item.poster_path.indexOf('http') === 0) return item.poster_path;
            if (item.poster_path.indexOf('/t/p/') === 0) return 'https://image.tmdb.org' + item.poster_path;
            return TMDB_IMG + item.poster_path;
        }
        return '';
    }

    function buildBg(item) {
        if (!item) return '';
        if (item.background_image && typeof item.background_image === 'string' && item.background_image.indexOf('http') === 0) return item.background_image;
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
    // ================================================================
    function normalizeCard(item) {
        if (!item) return null;
        
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

    // ================================================================
    //  API SERVICE
    // ================================================================
    function RutorApiService() {
        var self = this;
        self.network = new Lampa.Reguest();

        var clientSeen = {};

        function seenKey(card) {
            if (!card) return '';
            var id = (card && card.id) ? String(card.id) : '';
            var t  = ((card && (card.title || card.name)) || '').toLowerCase()
                        .replace(/[^\u0400-\u04ffa-z0-9]/gi, '').slice(0, 80);
            return id + '|' + t;
        }

        function dedupClient(catUrl, cards, resetPage) {
            if (!cards || !Array.isArray(cards)) return [];
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
            if (!meta || meta.method !== 'tv' || !Array.isArray(cards)) return cards || [];
            return cards.map(function (card) {
                if (!card) return card;
                card.type   = 'tv';
                card.method = 'tv';
                if (!card.first_air_date && card.release_date) card.first_air_date = card.release_date;
                return card;
            });
        }

        // ---------------- FETCH RAW ----------------
        self._fetchRaw = function (url, onComplete, onError) {
            self.network.silent(
                url,
                function (json) {
                    if (!json || !json.results) {
                        onComplete({ results: [], total_pages: 1, page: 1, total_results: 0 });
                        return;
                    }
                    var normalized = json.results.map(normalizeCard).filter(function(item) { return item !== null; });
                    onComplete({
                        results: normalized,
                        page: json.page || 1,
                        total_pages: json.total_pages || 1,
                        total_results: json.total_results || normalized.length
                    });
                },
                function (err) {
                    console.warn('[V10] fetch error:', url, err);
                    if (onError) onError(err);
                    else onComplete({ results: [], total_pages: 1, page: 1, total_results: 0 });
                }
            );
        };

        // ---------------- SEARCH ----------------
        self.search = function (params, onComplete) {
            var query = (params && params.query) ? (params.query || '').trim() : '';
            if (!query) { onComplete({ results: [] }); return; }
            var url = WORKER_URL + 'search?query=' + encodeURIComponent(query);
            self.network.silent(
                url,
                function (json) {
                    if (!json || !json.results) { onComplete({ results: [] }); return; }
                    var normalized = json.results.map(normalizeCard).filter(function(item) { return item !== null; });
                    onComplete({
                        results: normalized,
                        page: json.page || 1,
                        total_pages: json.total_pages || 1
                    });
                },
                function () { onComplete({ results: [] }); }
            );
        };

        // ---------------- CATEGORY ----------------
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
                            var ia = -1, ib = -1;
                            CATEGORIES.forEach(function (c, i) {
                                if (c.url === a.url) ia = i;
                                if (c.url === b.url) ib = i;
                            });
                            return ia - ib;
                        });
                        onSuccess(rows);
                    }
                });
            });
        };

        // ---------------- LIST ----------------
        self.list = function (params, onComplete) {
            if (!params) params = {};
            var page   = params.page || 1;
            var catUrl = params.url  || 'top24';

            var meta = null;
            CATEGORIES.forEach(function (c) { if (c.url === catUrl) meta = c; });
            var pageSize = params.page_size || (meta && meta.page_size) || 15;

            var url = WORKER_URL + catUrl + '?page=' + page + '&page_size=' + pageSize;

            self._fetchRaw(
                url,
                function (data) {
                    var unique = dedupClient(catUrl, data.results, page === 1);
                    unique = forceCardType(meta, unique);
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
            if (!params) params = {};
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
                if (!data.title) data.title = (card && (card.title || card.name)) || '';
                if (!data.img && savedImg) data.img = savedImg;
                if (!data.background_image && savedBg)     data.background_image = savedBg;
                if (!data.release_quality && savedQuality) data.release_quality  = savedQuality;
                data.type   = method;
                data.method = method;
                if (card) {
                    for (var k in card) {
                        if (card.hasOwnProperty(k) && data[k] === undefined) data[k] = card[k];
                    }
                }
                onSuccess(data);
            }

            if (!card || !card.id || card.id <= 0 || String(card.id).length < 3) {
                fallbackFull({});
                return;
            }

            try {
                if (window.Lampa && window.Lampa.Api && window.Lampa.Api.sources && window.Lampa.Api.sources.tmdb) {
                    Lampa.Api.sources.tmdb.full(
                        params,
                        function (data) {
                            if (!data || !data.title) fallbackFull(data);
                            else {
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
                } else {
                    fallbackFull({});
                }
            } catch (e) {
                console.warn('[V10] full() error:', e);
                fallbackFull({});
            }
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
            '85.113.39.177:8090',
            '109.237.108.184:8090',
            '95.174.115.119:8888',
            '91.201.54.146:8090',
            '45.144.53.25:37940',
            '95.67.104.126:43871',
            '178.141.254.11:8090',
            '212.92.250.83:8090',
            '195.189.63.152:8090'
        ];

        var STORAGE_PRIMARY = 'torrserver_url';
        var STORAGE_BACKUP  = 'torrserver_switcher_backup';

        var CHECK_TIMEOUT       = 4000;
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

        function checkServer(url, cb) {
            var full = normalizeUrl(url);
            if (!full) { cb(false); return; }
            
            var done = false;
            var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;

            var timer = setTimeout(function () {
                if (done) return;
                done = true;
                if (controller) { 
                    try { controller.abort(); } catch (e) {} 
                }
                cb(false);
            }, CHECK_TIMEOUT);

            try {
                fetch(full + '/', {
                    method: 'HEAD',
                    mode: 'no-cors',
                    cache: 'no-store',
                    signal: controller ? controller.signal : undefined
                }).then(function () {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    cb(true);
                }).catch(function (err) {
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

        function getPrimary() { 
            try { return Lampa.Storage.get(STORAGE_PRIMARY, ''); } 
            catch (e) { return ''; }
        }
        function getBackup()  { 
            try { return Lampa.Storage.get(STORAGE_BACKUP, ''); }
            catch (e) { return ''; }
        }

        function setPrimary(url, silent) {
            try {
                Lampa.Storage.set(STORAGE_PRIMARY, url);
                if (!silent) noty('Основной сервер TorrServer: ' + shortAddr(url));
            } catch (e) {
                console.warn('[TS] setPrimary error:', e);
            }
        }
        function setBackup(url, silent) {
            try {
                Lampa.Storage.set(STORAGE_BACKUP, url);
                if (!silent) noty('Резервный сервер TorrServer: ' + shortAddr(url));
            } catch (e) {
                console.warn('[TS] setBackup error:', e);
            }
        }

        function pickServer(mode) {
            noty('Проверка серверов TorrServer…');

            checkAll(function (results) {
                var currentUrl = mode === 'primary' ? getPrimary() : getBackup();

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

                try {
                    Lampa.Select.show({
                        title: mode === 'primary' ? 'TorrServer — основной адрес' : 'TorrServer — резервный адрес',
                        items: items,
                        onSelect: function (item) {
                            if (!item.ok) noty('⚠ Этот сервер сейчас не отвечает. Выбран, но лучше выбрать зелёный.');
                            if (mode === 'primary') setPrimary(item.url);
                            else setBackup(item.url);
                        },
                        onBack: function () {
                            try { Lampa.Controller.toggle('settings_component'); }
                            catch (e) { try { Lampa.Controller.toggle('menu'); } catch (e2) {} }
                        }
                    });
                } catch (e) {
                    console.warn('[TS] Lampa.Select error:', e);
                }
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
                    noty('⚠ Основной TorrServer не отвечает. Переключено на резервный: ' + shortAddr(backup));
                });
            });
        }

        function addSettings() {
            try {
                Lampa.SettingsApi.addComponent({
                    component: COMPONENT,
                    icon: '<svg height="60" viewBox="0 0 24 24" width="60" fill="currentColor"><path d="M4 3H20C21.1 3 22 3.9 22 5V9C22 10.1 21.1 11 20 11H4C2.9 11 2 10.1 2 9V5C2 3.9 2.9 3 4 3ZM4 13H20C21.1 13 22 13.9 22 15V19C22 20.1 21.1 21 20 21H4C2.9 21 2 20.1 2 19V15C2 13.9 2.9 13 4 13Z"/></svg>',
                    name: 'TorrServer'
                });

                Lampa.SettingsApi.addParam({
                    component: COMPONENT,
                    param: { name: COMPONENT + '_primary', type: 'button', default: '' },
                    field: {
                        name: 'Основной сервер',
                        description: getPrimary() ? shortAddr(getPrimary()) : 'не выбран — нажмите, чтобы выбрать'
                    },
                    onRender: function (item) {
                        item.on('hover:enter', function () { pickServer('primary'); });
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: COMPONENT,
                    param: { name: COMPONENT + '_backup', type: 'button', default: '' },
                    field: {
                        name: 'Резервный сервер',
                        description: getBackup() ? shortAddr(getBackup()) : 'не выбран — используется при отказе основного'
                    },
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
            setInterval(autoFailoverCheck, AUTO_CHECK_INTERVAL);
        }

        return { init: init, pick: pickServer };
    })();

    // ================================================================
    // ================================================================
    //  МОДУЛЬ 3. КАТАЛОГ ПАРСЕРОВ (по мотивам LME PubTorr)
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
            { id: 'jac_red_ru',          name: 'jac-red.ru',   settings: { url: 'jac-red.ru',           key: '',        parser_torrent_type: 'jackett' } },
            { id: 'jacred_ru',           name: 'Jacred.ru',    settings: { url: 'jacred.ru',            key: '',        parser_torrent_type: 'jackett' } },
            { id: 'jacred_xyz',          name: 'Jacred.xyz',   settings: { url: 'jacred.xyz',           key: '',        parser_torrent_type: 'jackett' } }
        ];

        // кэш проверок на 10 минут
        var cache = {};
        var TTL = 10 * 60 * 1000;

        function protocol() {
            if (typeof window !== 'undefined' && window.Lampa && window.Lampa.Utils && typeof window.Lampa.Utils.protocol === 'function') {
                return window.Lampa.Utils.protocol();
            }
            return (typeof location !== 'undefined' && location.protocol === 'https:') ? 'https://' : 'http://';
        }

        function healthUrl(parser) {
            if (!parser || !parser.settings || !parser.settings.url) return '';
            var s    = parser.settings;
            var type = s.parser_torrent_type || 'jackett';
            var pre  = /^https?:\/\//.test(s.url) ? '' : protocol();
            var base = type === 'prowlarr' ? '/api/v1/health' : '/api/v2.0/indexers/status:healthy/results';
            return pre + s.url + base + '?apikey=' + (s.key || '');
        }

        function getById(id) {
            var found = null;
            LIST.forEach(function (p) { if (p.id === id) found = p; });
            return found;
        }

        function getSelectedId() { 
            try { return Lampa.Storage.get(STORAGE_KEY, NO_PARSER); }
            catch (e) { return NO_PARSER; }
        }

        function currentName() {
            var p = getById(getSelectedId());
            return p ? p.name : 'Не выбран';
        }

        // Применяет выбранный парсер в штатные ключи Lampa
        function applySelected(id) {
            var parserId = id || getSelectedId();
            var parser   = getById(parserId);
            if (!parser || !parser.settings) return false;

            try {
                var s    = parser.settings;
                var type = s.parser_torrent_type || 'jackett';

                Lampa.Storage.set(type === 'prowlarr' ? 'prowlarr_url' : 'jackett_url', s.url);
                Lampa.Storage.set(type === 'prowlarr' ? 'prowlarr_key' : 'jackett_key', s.key || '');
                Lampa.Storage.set('parser_torrent_type', type);
                Lampa.Storage.set('parser_use', true);
                return true;
            } catch (e) {
                console.warn('[PARSERS] applySelected error:', e);
                return false;
            }
        }

        function checkOne(parser, cb) {
            var url = healthUrl(parser);
            if (!url) { cb('unknown'); return; }

            var key = parser.id + '::' + url;
            var c   = cache[key];
            if (c && Date.now() < c.expires) { cb(c.status); return; }

            try {
                fetch(url, {
                    method: 'GET',
                    timeout: CHECK_TIMEOUT
                }).then(function (response) {
                    var st = response.status === 200 ? 'ok' 
                           : response.status === 401 ? 'auth' 
                           : 'network';
                    cache[key] = { status: st, expires: Date.now() + TTL };
                    cb(st);
                }).catch(function (err) {
                    cache[key] = { status: 'network', expires: Date.now() + TTL };
                    cb('network');
                });
            } catch (e) {
                cb('network');
            }
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

        function openCatalog(force) {
            if (force) cache = {};
            noty('Проверка парсеров…');

            checkAll(function (statuses) {
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

                try {
                    Lampa.Select.show({
                        title: 'Каталог парсеров',
                        items: items,
                        onSelect: function (item) {
                            if (item.refresh) { openCatalog(true); return; }

                            if (!item.parser) {
                                try {
                                    Lampa.Storage.set(STORAGE_KEY, NO_PARSER);
                                    Lampa.Storage.set('parser_use', false);
                                } catch (e) {}
                                noty('Парсер отключён');
                                return;
                            }

                            try {
                                Lampa.Storage.set(STORAGE_KEY, item.parser.id);
                                applySelected(item.parser.id);
                            } catch (e) {}
                            noty('Парсер выбран: ' + item.parser.name);
                        },
                        onBack: function () {
                            try { Lampa.Controller.toggle('settings_component'); }
                            catch (e) { try { Lampa.Controller.toggle('menu'); } catch (e2) {} }
                        }
                    });
                } catch (e) {
                    console.warn('[PARSERS] Lampa.Select error:', e);
                }
            });
        }

        function addSettings() {
            try {
                Lampa.SettingsApi.addComponent({
                    component: COMPONENT,
                    icon: '<svg height="60" viewBox="0 0 24 24" width="60" fill="currentColor"><path d="M12 2L2 7L12 12L22 7L12 2ZM2 12L12 17L22 12M2 17L12 22L22 17"/></svg>',
                    name: 'Каталог парсеров'
                });

                Lampa.SettingsApi.addParam({
                    component: COMPONENT,
                    param: { name: COMPONENT + '_select', type: 'button', default: '' },
                    field: {
                        name: 'Выбрать парсер',
                        description: 'Текущий выбор: ' + currentName() + ' (всего ' + LIST.length + ')'
                    },
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
            // При старте восстанавливаем ранее выбранный парсер в ключи Lampa
            if (getSelectedId() !== NO_PARSER) applySelected();
        }

        return { init: init, open: openCatalog, current: currentName };
    })();

    // ================================================================
    //  МЕНЮ
    // ================================================================
    function addMenuItem(action, text, svg, onEnter) {
        try {
            var selector = '.menu__item[data-action="' + action + '"]';
            var $existing = document.querySelectorAll(selector);
            if ($existing && $existing.length) return;

            var item = document.createElement('li');
            item.className = 'menu__item selector';
            item.setAttribute('data-action', action);
            
            var ico = document.createElement('div');
            ico.className = 'menu__ico';
            ico.innerHTML = svg;
            
            var txt = document.createElement('div');
            txt.className = 'menu__text';
            txt.textContent = text;
            
            item.appendChild(ico);
            item.appendChild(txt);

            if (typeof onEnter === 'function') {
                item.addEventListener('click', onEnter);
            }

            var menuList = document.querySelector('.menu__list');
            var $after = document.querySelector('.menu__list [data-action="movie"], .menu__list [data-action="tv"]');
            
            if (menuList) {
                if ($after && $after.parentNode) {
                    $after.parentNode.parentNode.insertBefore(item, $after.parentNode.nextSibling);
                } else {
                    menuList.appendChild(item);
                }
            }
        } catch (e) {
            console.warn('[V10] addMenuItem error:', e);
        }
    }

    function addAllMenuItems() {
        addMenuItem(
            'v10',
            SOURCE_NAME,
            '<svg height="36" viewBox="0 0 24 24" width="36" fill="currentColor"><path d="M12 2L2 8V20H8V14H16V20H22V8L12 2ZM4 10L12 6L20 10V18H17V12H7V18H4V10Z"/><path d="M9 13H15V15H9V13Z"/></svg>',
            function () {
                try {
                    Lampa.Activity.push({
                        title: SOURCE_NAME,
                        component: 'category',
                        source: SOURCE_NAME,
                        method: 'category'
                    });
                } catch (e) {
                    console.warn('[V10] Activity.push error:', e);
                }
            }
        );

        addMenuItem(
            'torrserver_switcher',
            'TorrServer',
            '<svg height="36" viewBox="0 0 24 24" width="36" fill="currentColor"><path d="M4 3H20C21.1 3 22 3.9 22 5V9C22 10.1 21.1 11 20 11H4C2.9 11 2 10.1 2 9V5C2 3.9 2.9 3 4 3ZM4 13H20C21.1 13 22 13.9 22 15V19C22 20.1 21.1 21 20 21H4C2.9 21 2 20.1 2 19V15C2 13.9 2.9 13 4 13Z"/></svg>',
            function () { TS.pick('primary'); }
        );

        addMenuItem(
            'v10_parsers',
            'Парсеры',
            '<svg height="36" viewBox="0 0 24 24" width="36" fill="currentColor"><path d="M12 2L2 7L12 12L22 7L12 2Z"/><path d="M2 12L12 17L22 12L20 11L12 15L4 11L2 12Z"/><path d="M2 17L12 22L22 17L20 16L12 20L4 16L2 17Z"/></svg>',
            function () { PARSERS.open(false); }
        );
    }

    // ================================================================
    //  INIT
    // ================================================================
    function init() {
        try {
            if (!window.Lampa) return;
            if (!Lampa.Api.sources) Lampa.Api.sources = {};
            Lampa.Api.sources[SOURCE_NAME] = new RutorApiService();

            TS.init();
            PARSERS.init();

            if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('app', function (e) {
                    if (e && (e.type === 'ready' || e.type === 'render')) {
                        setTimeout(addAllMenuItems, 1000);
                    }
                });
            }
            setTimeout(addAllMenuItems, 2000);
        } catch (e) {
            console.warn('[V10] Init error:', e);
        }
    }

    try {
        if (window.appready) {
            init();
        } else if (window.Lampa && Lampa.Listener) {
            Lampa.Listener.follow('app', function (e) {
                if (e && e.type === 'ready') init();
            });
        }
    } catch (e) {
        console.warn('[V10] Startup error:', e);
    }
})();
