/**
 * TorrServer Switcher — плагин для Lampa
 *
 * Что делает:
 *  - Добавляет в Настройки Lampa раздел "TorrServer" со списком заданных
 *    адресов серверов.
 *  - При открытии списка каждый адрес "пингуется" (короткий HTTP-запрос
 *    с таймаутом) и помечается 🟢 (отвечает) или 🔴 (не отвечает) —
 *    статус актуален на момент открытия, а не закэширован.
 *  - Позволяет выбрать ОСНОВНОЙ адрес (записывается в тот же ключ
 *    хранилища, который использует сам Lampa для TorrServer —
 *    'torrserver_url', то есть реально влияет на воспроизведение)
 *    и РЕЗЕРВНЫЙ адрес (свой ключ плагина).
 *  - Раз в 5 минут в фоне проверяет текущий основной адрес; если он
 *    не отвечает, а резервный отвечает — автоматически переключается
 *    на резервный и показывает уведомление.
 *  - Дублирующий пункт в главном меню — на случай, если в конкретной
 *    сборке Lampa раздел Настроек рендерится нестандартно, доступ к
 *    списку серверов остаётся гарантирован через меню.
 *
 * ВАЖНО (честно, чтобы не было сюрпризов):
 *  - Проверка серверов идёт через fetch(..., {mode:'no-cors'}) — это
 *    единственный способ "пропинговать" произвольный IP:порт из
 *    браузерного JS без CORS-заголовков на стороне TorrServer. Если
 *    интерфейс Lampa у вас загружен по HTTPS, а адреса серверов — по
 *    обычному HTTP, браузер может заблокировать запрос как "смешанный
 *    контент" (mixed content) — тогда сервер будет ошибочно показан
 *    красным, хотя работает. В штатной установке Lampa (desktop/Android/
 *    TV-приложение), где сам TorrServer тоже обычно подключается по
 *    HTTP, это не проблема — так же, как и штатная интеграция TorrServer
 *    в Lampa.
 */
(function () {
    'use strict';

    var PLUGIN_ID = 'torrserver_switcher';
    if (window[PLUGIN_ID + '_ready']) return;
    window[PLUGIN_ID + '_ready'] = true;

    // ================================================================
    //  СПИСОК АДРЕСОВ
    // ================================================================
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

    var STORAGE_PRIMARY = 'torrserver_url';            // ключ, реально используемый Lampa
    var STORAGE_BACKUP   = 'torrserver_switcher_backup'; // резервный адрес (только для этого плагина)

    var CHECK_TIMEOUT        = 4000;       // таймаут пинга одного сервера, мс
    var AUTO_CHECK_INTERVAL  = 5 * 60000;  // как часто проверять основной сервер в фоне

    // ================================================================
    //  УТИЛИТЫ
    // ================================================================
    function normalizeUrl(raw) {
        var u = (raw || '').trim();
        if (!u) return '';
        if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
        return u.replace(/\/+$/, '');
    }

    function shortAddr(url) {
        return (url || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }

    function noty(text) {
        try { Lampa.Noty.show(text); } catch (e) { console.log('[TS-Switcher] ' + text); }
    }

    // ================================================================
    //  ПРОВЕРКА ДОСТУПНОСТИ ОДНОГО СЕРВЕРА
    // ================================================================
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

    // Проверяет весь список параллельно, возвращает [{addr, url, ok}, ...]
    // в исходном порядке SERVERS.
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

    // ================================================================
    //  ХРАНИЛИЩЕ
    // ================================================================
    function getPrimary() { return Lampa.Storage.get(STORAGE_PRIMARY, ''); }
    function getBackup()  { return Lampa.Storage.get(STORAGE_BACKUP, ''); }

    function setPrimary(url, silent) {
        Lampa.Storage.set(STORAGE_PRIMARY, url);
        if (!silent) noty('Основной сервер TorrServer: ' + shortAddr(url));
    }
    function setBackup(url, silent) {
        Lampa.Storage.set(STORAGE_BACKUP, url);
        if (!silent) noty('Резервный сервер TorrServer: ' + shortAddr(url));
    }

    // ================================================================
    //  СПИСОК ВЫБОРА С ЖИВЫМ СТАТУСОМ
    // ================================================================
    function pickServer(mode) {
        // mode: 'primary' | 'backup'
        noty('Проверка серверов TorrServer…');

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
                        noty('⚠ Этот сервер сейчас не отвечает. Выбран, но лучше выбрать зелёный.');
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

    // ================================================================
    //  ФОНОВЫЙ АВТО-FAILOVER: если основной перестал отвечать —
    //  переключаемся на резервный (если он задан и жив).
    // ================================================================
    function autoFailoverCheck() {
        var primary = getPrimary();
        var backup  = getBackup();
        if (!primary || !backup) return;

        checkServer(primary, function (primaryOk) {
            if (primaryOk) return; // всё в порядке, ничего не делаем

            checkServer(backup, function (backupOk) {
                if (!backupOk) return; // и резервный недоступен — оставляем как есть

                setPrimary(backup, true);
                noty('⚠ Основной TorrServer не отвечает. Автоматически переключено на резервный: ' + shortAddr(backup));
            });
        });
    }

    // ================================================================
    //  НАСТРОЙКИ LAMPA
    // ================================================================
    function addSettings() {
        try {
            Lampa.SettingsApi.addComponent({
                component: PLUGIN_ID,
                icon: '<svg height="60" viewBox="0 0 24 24" width="60" fill="currentColor">' +
                          '<path d="M4 3H20C21.1 3 22 3.9 22 5V9C22 10.1 21.1 11 20 11H4C2.9 11 2 10.1 2 9V5C2 3.9 2.9 3 4 3ZM4 13H20C21.1 13 22 13.9 22 15V19C22 20.1 21.1 21 20 21H4C2.9 21 2 20.1 2 19V15C2 13.9 2.9 13 4 13ZM6 6.5C5.45 6.5 5 6.95 5 7.5C5 8.05 5.45 8.5 6 8.5C6.55 8.5 7 8.05 7 7.5C7 6.95 6.55 6.5 6 6.5ZM6 16.5C5.45 16.5 5 16.95 5 17.5C5 18.05 5.45 18.5 6 18.5C6.55 18.5 7 18.05 7 17.5C7 16.95 6.55 16.5 6 16.5Z"/>' +
                      '</svg>',
                name: 'TorrServer'
            });

            Lampa.SettingsApi.addParam({
                component: PLUGIN_ID,
                param: { name: PLUGIN_ID + '_primary', type: 'button', default: '' },
                field: {
                    name: 'Основной сервер',
                    description: getPrimary() ? shortAddr(getPrimary()) : 'не выбран — нажмите, чтобы выбрать'
                },
                onRender: function (item) {
                    item.on('hover:enter', function () { pickServer('primary'); });
                }
            });

            Lampa.SettingsApi.addParam({
                component: PLUGIN_ID,
                param: { name: PLUGIN_ID + '_backup', type: 'button', default: '' },
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
                component: PLUGIN_ID,
                param: { name: PLUGIN_ID + '_recheck', type: 'button', default: '' },
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

    // ================================================================
    //  ПУНКТ ГЛАВНОГО МЕНЮ (страховочный доступ к тому же списку)
    // ================================================================
    function addMenuItem() {
        if ($('.menu__item[data-action="' + PLUGIN_ID + '"]').length) return;

        var item = $(
            '<li class="menu__item selector" data-action="' + PLUGIN_ID + '">' +
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

    // ================================================================
    //  INIT
    // ================================================================
    function init() {
        addSettings();
        setTimeout(addMenuItem, 1500);

        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready' || e.type === 'render') {
                setTimeout(addMenuItem, 1000);
            }
        });

        // Первая фоновая проверка — через минуту после старта, затем по таймеру
        setTimeout(autoFailoverCheck, 60000);
        setInterval(autoFailoverCheck, AUTO_CHECK_INTERVAL);
    }

    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
