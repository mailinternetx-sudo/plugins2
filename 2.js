/**
 * Плагин Lampa: кастомные карусели с внешних источников через Cloudflare Worker
 * Совместимость: WebOS 3.0+/4.0+, Tizen — только ES5, без стрелочных функций,
 * без let/const в критичных областях, без деструктуризации и шаблонных строк.
 *
 * Подключение: Настройки -> Расширения -> вставить URL до этого файла
 */

(function () {
  'use strict';

  Lampa.Plugins.add('my_custom_cards', function () {

    // ==================== НАСТРОЙКИ ====================

    // !!! ВСТАВЬТЕ СЮДА СВОЙ URL CLOUDFLARE WORKER (без слэша на конце) !!!
    var PROXY_URL = 'https://lampa-parser.mail-internetx.workers.dev';

    var CATEGORIES = [
      { cat: 1, title: 'Топ раздач' },
      { cat: 2, title: 'Новинки кино' },
      { cat: 3, title: 'Детективы 2026 года' },
      { cat: 4, title: 'Зарубежные детективные сериалы' },
      { cat: 5, title: 'Русские детективные сериалы' }
    ];

    var REQUEST_TIMEOUT = 12000;

    // ==================== СЕТЕВОЙ СЛОЙ ====================

    // Обёртка над XHR, совместимая со старыми движками WebOS/Tizen
    function requestJson(url, onSuccess, onError) {
      var xhr = new XMLHttpRequest();
      var finished = false;

      var timer = setTimeout(function () {
        if (finished) return;
        finished = true;
        try { xhr.abort(); } catch (e) {}
        onError('timeout');
      }, REQUEST_TIMEOUT);

      xhr.open('GET', url, true);
      xhr.timeout = REQUEST_TIMEOUT;

      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (finished) return;
        finished = true;
        clearTimeout(timer);

        if (xhr.status >= 200 && xhr.status < 300) {
          var data;
          try {
            data = JSON.parse(xhr.responseText);
          } catch (e) {
            onError('parse_error');
            return;
          }
          onSuccess(data);
        } else {
          onError('http_' + xhr.status);
        }
      };

      xhr.onerror = function () {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        onError('network_error');
      };

      xhr.send();
    }

    // ==================== ПОСТРОЕНИЕ КАРУСЕЛИ ====================

    // Создаёт один ряд (карусель) карточек для категории
    function buildLine(container, categoryConfig, results) {
      var lineTitle = document.createElement('div');
      lineTitle.className = 'category-full__title';
      lineTitle.innerText = categoryConfig.title;
      container.appendChild(lineTitle);

      var scroll = new Lampa.Scroll({ mask: true, over: true });
      var body = scroll.render ? scroll.render() : scroll.body;

      var wrapItems = document.createElement('div');
      wrapItems.className = 'items-line';

      var i;
      for (i = 0; i < results.length; i++) {
        var item = results[i];
        var cardEl = buildCard(item);
        wrapItems.appendChild(cardEl);
      }

      if (scroll.append) {
        scroll.append(wrapItems);
      } else {
        body.appendChild(wrapItems);
      }

      container.appendChild(body);

      // Регистрация навигации пультом ДУ по карточкам ряда
      Lampa.Controller.enable && Lampa.Controller.add('content', {
        toggle: function () {}
      });
    }

    // Создаёт DOM-элемент одной карточки на базе Lampa.Card, с фолбэком на чистый DOM
    function buildCard(item) {
      var cardData = {
        title: item.title,
        img: item.img || './img/img_broken.svg',
        release_date: item.year,
        vote_average: item.vote_average,
        id: item.id,
        source: 'custom'
      };

      var cardWrapper = document.createElement('div');
      cardWrapper.className = 'card selector';
      cardWrapper.setAttribute('data-id', item.id);

      var poster = document.createElement('div');
      poster.className = 'card__view';

      var img = document.createElement('img');
      img.className = 'card__img';
      img.src = cardData.img;
      img.onerror = function () {
        img.src = './img/img_broken.svg';
      };
      poster.appendChild(img);

      var titleEl = document.createElement('div');
      titleEl.className = 'card__title';
      titleEl.innerText = item.title;

      var yearEl = document.createElement('div');
      yearEl.className = 'card__age';
      yearEl.innerText = item.year || '';

      cardWrapper.appendChild(poster);
      cardWrapper.appendChild(titleEl);
      cardWrapper.appendChild(yearEl);

      // Обработка выбора карточки пультом/кликом — запуск внутреннего поиска Lampa
      cardWrapper.addEventListener('hover:enter', function () {
        onCardSelect(item);
      });
      cardWrapper.addEventListener('click', function () {
        onCardSelect(item);
      });

      return cardWrapper;
    }

    // При выборе карточки — переход к стандартному поиску Lampa по названию,
    // чтобы пользователь мог найти контент через торренты/онлайн-балансеры
    function onCardSelect(item) {
      Lampa.Activity.push({
        url: '',
        title: item.title,
        component: 'search',
        search: item.title,
        page: 1
      });
    }

    // ==================== ГЛАВНЫЙ КОМПОНЕНТ ====================

    function initCustomComponent() {
      var container = document.createElement('div');
      container.className = 'custom-cards-page';

      var loadedCount = 0;

      function loadCategory(index) {
        if (index >= CATEGORIES.length) return;

        var conf = CATEGORIES[index];
        var apiUrl = PROXY_URL + '/?cat=' + conf.cat;

        requestJson(apiUrl, function (data) {
          loadedCount++;
          if (data && data.results && data.results.length) {
            buildLine(container, conf, data.results);
          }
          loadCategory(index + 1);
        }, function (errCode) {
          // Логируем ошибку категории, но не прерываем загрузку остальных
          if (window.console) {
            console.log('[my_custom_cards] Ошибка загрузки категории ' + conf.title + ': ' + errCode);
          }
          loadCategory(index + 1);
        });
      }

      loadCategory(0);

      return container;
    }

    // Регистрируем свой компонент/активность в Lampa
    Lampa.Component.add('custom_cards', {
      create: function () {
        return initCustomComponent();
      }
    });

    // ==================== ИНТЕГРАЦИЯ В ГЛАВНОЕ МЕНЮ ====================

    // Добавляем пункт в главное меню Lampa для перехода к нашим каруселям
    Lampa.Listener.follow('app', function (event) {
      if (event.type !== 'ready') return;

      var menuItem = $('<li class="menu__item selector" data-action="custom_cards">' +
        '<div class="menu__ico">' +
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none">' +
        '<rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" stroke-width="2"/>' +
        '</svg>' +
        '</div>' +
        '<div class="menu__text">Подборки</div>' +
        '</li>');

      menuItem.on('hover:enter', function () {
        Lampa.Activity.push({
          url: '',
          title: 'Подборки',
          component: 'custom_cards'
        });
      });

      $('.menu .menu__list').eq(0).append(menuItem);
    });

  });

  // Инициализация плагина при подключении файла
  if (window.Lampa && Lampa.Plugins) {
    // уже добавлено выше через Lampa.Plugins.add
  }

})();
