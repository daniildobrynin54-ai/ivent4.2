// content.js - Улучшенная версия с плавной прокруткой и автозакрытием комментариев
'use strict';

(() => {
  // ==================== КОНСТАНТЫ ====================
  
  const CONFIG = {
    // Интервалы
    FARM_INTERVAL: 700,
    MINE_INTERVAL_MIN: 200,
    
    // Задержки
    DEFAULT_GIFT_DELAY: 600,
    DEFAULT_MINE_DELAY: 2000,
    MIN_GIFT_DELAY: 50,
    MIN_MINE_DELAY: 200,
    
    // Лимиты
    MAX_BAG_CLICKS: 10,
    MAX_GIFT_ELEMENTS: 60,
    MAX_BAG_ELEMENTS: 40,
    SCROLL_BOTTOM_THRESHOLD: 50,
    
    // Анимация движения мыши
    MOUSE_PATH_STEPS: 12,
    MOUSE_EXTRA_STEPS: 8,
    MOUSE_CURVE_AMPLITUDE: 10,
    MOUSE_CURVE_VARIATION: 20,
    MIN_MOVE_INTERVAL: 12,
    
    // Автокомментирование
    AUTO_COMMENT_KEY: 'autoCommentSettings',
    AUTO_COMMENT_STATE_KEY: 'autoCommentState',
    COMMENT_DELAY: 700,
    COMMENT_WAIT_TIMEOUT: 6000,
    COMMENT_TEXTAREA_TIMEOUT: 5000,
    COMMENT_FALLBACK_WAIT: 4000,
    
    // Регулярные выражения
    REGEX: {
      CHAPTER_PATH: /^\/manga\/[^/]+\/[^/]+\/\d+$/,
      MINE_PATH: /\/mine(\?|$)/,
      NEXT_CHAPTER: /след/i,
      GIFT_TEXT: /подар|gift|event/i,
      BAG_TEXT: /сумк|мешок|bag|pack/i,
      MINE_BTN: /шахт|удар|копа/i,
      COMMENT_BTN: /коммент|comment/i,
      SEND_BTN: /отправ|send|отосл/i
    },
    
    // Селекторы
    SELECTORS: {
      GIFT: '.event-gift-ball',
      BAG: '.event-bag',
      MINE_BTN: '.main-mine__game-tap',
      MINE_HITS: '.main-mine__game-hits-left',
      NEXT_CHAPTER: 'a.button.button--primary',
      COMMENT_TEXTAREA: '.comments__send-form textarea, textarea[name="comment"], .comments textarea',
      COMMENT_SEND: '.comments__send-btn, .button--primary.comments__send-btn, .comments__send-form button[type="submit"]',
      COMMENT_CLOSE: '.comments__close-form-btn'
    }
  };

  const STORAGE_KEYS = [
    'autoScroll', 'scrollSpeed', 'chapterLimit', 'chapterRead',
    'farmActive', 'mineActive', 'currentChapterUrl',
    'giftClickDelay', 'mineClickDelay',
    CONFIG.AUTO_COMMENT_KEY, CONFIG.AUTO_COMMENT_STATE_KEY
  ];

  // ==================== СОСТОЯНИЕ ====================
  
  const state = {
    // Прокрутка
    autoScroll: false,
    scrollSpeed: 50,
    scrollRAF: null,
    lastRafTs: null,
    
    // Счетчики глав
    chapterLimit: 0,
    chapterRead: 0,
    
    // Фарм
    farmActive: false,
    farmInterval: null,
    giftClickDelay: CONFIG.DEFAULT_GIFT_DELAY,
    
    // Шахта
    mineActive: false,
    mineInterval: null,
    mineClickDelay: CONFIG.DEFAULT_MINE_DELAY,
    
    // Автокомментирование
    autoCommentSettings: {
      enabled: false,
      interval: 2,
      totalComments: 5,
      commentsList: []
    },
    autoCommentState: {
      posted: 0
    },
    
    // Трекинг кликов
    clickedElements: new WeakSet(),
    bagClickCounts: new WeakMap(),
    
    // Флаг для синхронизации кликов и прокрутки
    isPerformingClick: false
  };

  // ==================== УТИЛИТЫ ====================
  
  const chromeAsync = {
    storage: {
      get: (keys) => new Promise(resolve => 
        chrome.storage.sync.get(keys, resolve)
      ),
      set: (obj) => new Promise(resolve => 
        chrome.storage.sync.set(obj, resolve)
      )
    }
  };

  const logger = {
    info: (...args) => console.log('[MBH][content]', ...args),
    warn: (...args) => console.warn('[MBH][content]', ...args),
    error: (...args) => console.error('[MBH][content]', ...args)
  };

  /**
   * Безопасная отмена requestAnimationFrame
   */
  function safeCancelRAF(id) {
    if (id != null) cancelAnimationFrame(id);
  }

  /**
   * Откладывает выполнение с использованием requestIdleCallback
   */
  function idleDelay(callback, delay = 0) {
    if (typeof requestIdleCallback === 'function') {
      if (delay > 0) {
        return setTimeout(() => requestIdleCallback(callback), delay);
      }
      return requestIdleCallback(callback);
    }
    return setTimeout(callback, delay);
  }

  /**
   * Промисифицированная задержка
   */
  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Ожидание появления элемента в DOM
   */
  function waitForSelector(selector, timeout = CONFIG.COMMENT_WAIT_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) return resolve(element);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout: ${selector}`));
      }, timeout);
    });
  }

  // ==================== ОПРЕДЕЛЕНИЕ ТИПА СТРАНИЦЫ ====================
  
  /**
   * Проверяет, является ли текущая страница страницей главы
   */
  function isChapterPage() {
    try {
      const url = new URL(location.href);
      const parts = url.pathname.split('/').filter(Boolean);
      
      if (parts.length < 3 || parts[0] !== 'manga') return false;
      
      const lastPart = parts[parts.length - 1];
      return !isNaN(Number(lastPart));
    } catch (err) {
      return false;
    }
  }

  /**
   * Проверяет, является ли текущая страница страницей шахты
   */
  function isMinePage() {
    return CONFIG.REGEX.MINE_PATH.test(location.pathname);
  }

  // ==================== ПОИСК ЭЛЕМЕНТОВ ====================
  
  /**
   * Находит элементы подарков на странице
   */
  function findGiftElements() {
    let elements = Array.from(document.querySelectorAll(CONFIG.SELECTORS.GIFT));
    if (elements.length) return elements;

    elements = Array.from(document.querySelectorAll(
      '[data-event*="gift"], [data-role*="gift"]'
    ));
    if (elements.length) return elements;

    return Array.from(document.querySelectorAll('button, a, div, span'))
      .filter(el => {
        const text = (
          el.getAttribute('title') || 
          el.getAttribute('aria-label') || 
          el.textContent || 
          ''
        ).toLowerCase();
        return CONFIG.REGEX.GIFT_TEXT.test(text);
      })
      .slice(0, CONFIG.MAX_GIFT_ELEMENTS);
  }

  /**
   * Находит элементы сумок на странице
   */
  function findBagElements() {
    let elements = Array.from(document.querySelectorAll(CONFIG.SELECTORS.BAG));
    if (elements.length) return elements;

    elements = Array.from(document.querySelectorAll(
      '[data-event*="bag"], [data-role*="bag"]'
    ));
    if (elements.length) return elements;

    return Array.from(document.querySelectorAll('button, a, div, span'))
      .filter(el => {
        const text = (
          el.getAttribute('title') || 
          el.getAttribute('aria-label') || 
          el.textContent || 
          ''
        ).toLowerCase();
        return CONFIG.REGEX.BAG_TEXT.test(text);
      })
      .slice(0, CONFIG.MAX_BAG_ELEMENTS);
  }

  /**
   * Находит кнопку для клика в шахте
   */
  function findMineButton() {
    let button = document.querySelector(CONFIG.SELECTORS.MINE_BTN);
    if (button) return button;

    return Array.from(document.querySelectorAll('button, a')).find(el => {
      const text = (
        el.getAttribute('aria-label') || 
        el.textContent || 
        ''
      ).toLowerCase();
      return CONFIG.REGEX.MINE_BTN.test(text);
    }) || null;
  }

  /**
   * Проверяет видимость элемента в viewport
   */
  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.bottom >= 0 && rect.top <= window.innerHeight;
  }

  // ==================== ЗАГРУЗКА/СОХРАНЕНИЕ СОСТОЯНИЯ ====================
  
  /**
   * Загружает состояние из chrome.storage
   */
  async function loadStateFromStorage(callback) {
    try {
      const data = await chromeAsync.storage.get(STORAGE_KEYS);

      state.autoScroll = Boolean(data.autoScroll);
      state.scrollSpeed = Math.max(Number(data.scrollSpeed) || 50, 1);
      state.chapterLimit = Math.max(Number(data.chapterLimit) || 0, 0);
      state.chapterRead = Math.max(Number(data.chapterRead) || 0, 0);
      state.farmActive = Boolean(data.farmActive);
      state.mineActive = Boolean(data.mineActive);
      state.giftClickDelay = Math.max(Number(data.giftClickDelay) || CONFIG.DEFAULT_GIFT_DELAY, CONFIG.MIN_GIFT_DELAY);
      state.mineClickDelay = Math.max(Number(data.mineClickDelay) || CONFIG.DEFAULT_MINE_DELAY, CONFIG.MIN_MINE_DELAY);

      if (data[CONFIG.AUTO_COMMENT_KEY]) {
        Object.assign(state.autoCommentSettings, data[CONFIG.AUTO_COMMENT_KEY]);
      }
      if (data[CONFIG.AUTO_COMMENT_STATE_KEY]) {
        Object.assign(state.autoCommentState, data[CONFIG.AUTO_COMMENT_STATE_KEY]);
      }

      syncAllFeatures();
      
      if (typeof callback === 'function') {
        callback(data);
      }
    } catch (err) {
      logger.error('Ошибка загрузки состояния:', err);
    }
  }

  // ==================== ИМИТАЦИЯ ЧЕЛОВЕЧЕСКОГО ПОВЕДЕНИЯ ====================
  
  /**
   * Генерирует путь движения мыши с естественными кривыми
   */
  function generateMousePath(x0, y0, x1, y1, steps) {
    const path = [];
    const dx = x1 - x0;
    const dy = y1 - y0;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let x = x0 + dx * t;
      let y = y0 + dy * t;

      const amplitude = Math.sin(Math.PI * t) * (
        CONFIG.MOUSE_CURVE_AMPLITUDE + 
        Math.random() * CONFIG.MOUSE_CURVE_VARIATION
      );
      const angle = Math.random() * Math.PI * 2;
      
      x += Math.cos(angle) * amplitude;
      y += Math.sin(angle) * amplitude;

      path.push({ x, y });
    }

    return path;
  }

  /**
   * Выполняет клик с имитацией естественного поведения человека
   */
  async function humanLikeClick(element) {
    if (!element || state.clickedElements.has(element)) return;
    
    state.clickedElements.add(element);
    state.isPerformingClick = true;

    const wasScrolling = state.autoScroll;
    if (wasScrolling) {
      stopSmoothScroll();
    }

    const baseDelay = Math.max(CONFIG.MIN_GIFT_DELAY, state.giftClickDelay);
    
    const noticeDelay = Math.floor(baseDelay * (0.25 + Math.random() * 0.6));
    const realizeDelay = Math.floor(baseDelay * (0.4 + Math.random() * 0.8));
    const moveTime = Math.floor(baseDelay * (1.0 + Math.random() * 1.2));
    const resumeDelay = Math.floor(baseDelay * (0.6 + Math.random() * 1.0));

    const steps = CONFIG.MOUSE_PATH_STEPS + Math.floor(Math.random() * CONFIG.MOUSE_EXTRA_STEPS);

    try {
      await wait(noticeDelay);
      await wait(realizeDelay);
      
      if (!isVisible(element)) {
        throw new Error('Element disappeared');
      }

      const rect = element.getBoundingClientRect();
      const targetX = rect.left + rect.width / 2;
      const targetY = rect.top + rect.height / 2;
      const startX = window.innerWidth / 2;
      const startY = window.innerHeight / 2;

      const path = generateMousePath(startX, startY, targetX, targetY, steps);
      const stepDelay = Math.max(
        CONFIG.MIN_MOVE_INTERVAL, 
        Math.floor(moveTime / Math.max(1, steps))
      );

      for (let i = 0; i < path.length; i++) {
        if (!isVisible(element)) {
          throw new Error('Element disappeared during movement');
        }

        const point = path[i];
        document.dispatchEvent(new MouseEvent('mousemove', {
          clientX: point.x,
          clientY: point.y,
          bubbles: true,
          cancelable: true
        }));
        
        await wait(stepDelay);
      }

      if (isVisible(element)) {
        element.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true
        }));
        logger.info('Клик выполнен:', element.className);
      }

      await wait(resumeDelay);
      
    } catch (err) {
      logger.warn('Клик прерван:', err.message);
    } finally {
      state.isPerformingClick = false;
      
      if (wasScrolling && !state.isPerformingClick) {
        startSmoothScroll();
        logger.info('Прокрутка возобновлена после клика');
      }
    }
  }

  /**
   * Клик по сумке с ограничением количества
   */
  async function humanLikeClickBag(bag) {
    if (!bag) return;

    const clickCount = state.bagClickCounts.get(bag) || 0;
    if (clickCount >= CONFIG.MAX_BAG_CLICKS) return;

    state.bagClickCounts.set(bag, clickCount + 1);
    state.isPerformingClick = true;

    const wasScrolling = state.autoScroll;
    if (wasScrolling) {
      stopSmoothScroll();
    }

    try {
      bag.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true
      }));

      const resumeDelay = Math.floor(state.giftClickDelay * (0.9 + Math.random() * 0.7));
      await wait(resumeDelay);
      
    } finally {
      state.isPerformingClick = false;
      
      if (wasScrolling && !state.isPerformingClick) {
        startSmoothScroll();
        logger.info('Прокрутка возобновлена после клика по сумке');
      }
    }
  }

  // ==================== АВТОПРОКРУТКА (УЛУЧШЕННАЯ) ====================
  
  /**
   * Запускает плавную автопрокрутку с улучшенной производительностью
   */
  function startSmoothScroll() {
    if (!state.autoScroll || !isChapterPage() || state.isPerformingClick) {
      return;
    }

    state.lastRafTs = null;
    let frameSkipCounter = 0;
    const FRAME_SKIP_THRESHOLD = 2;

    function scrollLoop(timestamp) {
      if (!state.autoScroll || state.isPerformingClick) {
        safeCancelRAF(state.scrollRAF);
        state.scrollRAF = null;
        return;
      }

      if (!state.lastRafTs) state.lastRafTs = timestamp;
      
      const deltaTime = timestamp - state.lastRafTs;
      
      // Защита от больших скачков времени
      if (deltaTime > 100) {
        state.lastRafTs = timestamp;
        state.scrollRAF = requestAnimationFrame(scrollLoop);
        return;
      }
      
      state.lastRafTs = timestamp;

      // Пропуск кадров при высокой нагрузке
      frameSkipCounter++;
      if (frameSkipCounter < FRAME_SKIP_THRESHOLD) {
        state.scrollRAF = requestAnimationFrame(scrollLoop);
        return;
      }
      frameSkipCounter = 0;

      // Плавная интерполяция
      const targetScroll = state.scrollSpeed * (deltaTime / 1000);
      const smoothScroll = targetScroll * 0.8;
      const scrollDelta = Math.max(smoothScroll, 0.5);
      
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => {
          window.scrollBy({ top: scrollDelta, behavior: 'auto' });
        }, { timeout: 16 });
      } else {
        window.scrollBy({ top: scrollDelta, behavior: 'auto' });
      }

      if (document.body && 
          window.innerHeight + window.scrollY >= 
          document.body.offsetHeight - CONFIG.SCROLL_BOTTOM_THRESHOLD) {
        goToNextChapter();
        return;
      }

      state.scrollRAF = requestAnimationFrame(scrollLoop);
    }

    safeCancelRAF(state.scrollRAF);
    state.scrollRAF = requestAnimationFrame(scrollLoop);
  }

  /**
   * Останавливает автопрокрутку
   */
  function stopSmoothScroll() {
    safeCancelRAF(state.scrollRAF);
    state.scrollRAF = null;
    state.lastRafTs = null;
  }

  /**
   * Переходит к следующей главе
   */
  function goToNextChapter() {
    const nextButton = Array.from(
      document.querySelectorAll(CONFIG.SELECTORS.NEXT_CHAPTER)
    ).find(btn => 
      CONFIG.REGEX.NEXT_CHAPTER.test(btn.textContent) || 
      btn.textContent.includes('След. глава')
    );

    if (nextButton) {
      nextButton.click();
    } else {
      state.autoScroll = false;
      chromeAsync.storage.set({ autoScroll: false });
      stopSmoothScroll();
    }
  }

  // ==================== ФАРМ ИВЕНТА ====================
  
  /**
   * Выполняет один цикл фарма подарков и сумок
   */
  function farmOnce() {
    if (!state.farmActive || state.isPerformingClick || !isChapterPage()) {
      return;
    }

    const gifts = findGiftElements();
    gifts.forEach(gift => {
      if (!state.clickedElements.has(gift) && isVisible(gift)) {
        humanLikeClick(gift);
      }
    });

    const bags = findBagElements();
    bags.forEach(bag => {
      if (isVisible(bag)) {
        humanLikeClickBag(bag);
      }
    });
  }

  // ==================== ФАРМ ШАХТЫ ====================
  
  /**
   * Получает количество оставшихся ударов в шахте
   */
  function getHitsLeft() {
    const element = document.querySelector(CONFIG.SELECTORS.MINE_HITS);
    if (!element) return 0;

    const hits = parseInt(element.textContent.trim(), 10);
    return Number.isFinite(hits) ? hits : 0;
  }

  /**
   * Кликает по кнопке шахты
   */
  function clickMineButton() {
    const button = findMineButton();
    if (button) button.click();
  }

  /**
   * Выполняет один тик фарма шахты
   */
  function mineTick() {
    if (!state.mineActive) return;

    const hitsLeft = getHitsLeft();
    
    if (hitsLeft > 0) {
      clickMineButton();
    } else {
      state.mineActive = false;
      
      if (state.mineInterval) {
        clearInterval(state.mineInterval);
        state.mineInterval = null;
      }
      
      chromeAsync.storage.set({ mineActive: false });
    }
  }

  // ==================== АВТОКОММЕНТИРОВАНИЕ (УЛУЧШЕННОЕ) ====================
  
  /**
   * Вычисляет необходимое количество глав для заданных параметров
   */
  function computeNeededChapters(interval, totalComments) {
    return 2 + ((Math.max(1, totalComments) - 1) * Math.max(1, interval));
  }

  /**
   * Отправляет комментарий на странице главы (с автозакрытием окна)
   */
  async function postComment(text) {
    try {
      const commentButtonSelectors = [
        'button.reader-menu__item.reader-menu__item--comment',
        'button.reader-menu__Item--comment',
        'button.reader-menu__item--comment',
        '.reader-menu__item--comment',
        '.comments-open-btn',
        '[data-role*="comment"]',
        'button[aria-label*="коммент"]',
        'a[aria-label*="коммент"]'
      ];

      let commentButton = null;
      
      for (const selector of commentButtonSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          commentButton = el;
          break;
        }
      }

      if (!commentButton) {
        await wait(50);
        commentButton = Array.from(document.querySelectorAll('button, a'))
          .find(el => CONFIG.REGEX.COMMENT_BTN.test(
            el.textContent || el.innerText || ''
          )) || null;
      }

      if (!commentButton) {
        commentButton = await waitForSelector('button, a', CONFIG.COMMENT_FALLBACK_WAIT)
          .then(() => Array.from(document.querySelectorAll('button, a'))
            .find(el => CONFIG.REGEX.COMMENT_BTN.test(
              el.textContent || el.innerText || ''
            ))
          )
          .catch(() => null);
      }

      if (!commentButton) {
        const error = 'Кнопка комментариев не найдена';
        await chromeAsync.storage.set({ lastAutoCommentError: error });
        logger.warn(error);
        return false;
      }

      commentButton.click();

      const textarea = await waitForSelector(
        CONFIG.SELECTORS.COMMENT_TEXTAREA, 
        CONFIG.COMMENT_TEXTAREA_TIMEOUT
      ).catch(() => null);

      if (!textarea) {
        const error = 'Textarea комментария не найдена';
        await chromeAsync.storage.set({ lastAutoCommentError: error });
        logger.warn(error);
        return false;
      }

      textarea.focus();
      textarea.value = text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      
      await wait(300);

      let sendButton = document.querySelector(CONFIG.SELECTORS.COMMENT_SEND);
      
      if (!sendButton) {
        sendButton = Array.from(document.querySelectorAll('button'))
          .find(btn => CONFIG.REGEX.SEND_BTN.test(
            btn.textContent || btn.innerText || ''
          )) || null;
      }

      if (!sendButton) {
        const error = 'Кнопка отправки не найдена';
        await chromeAsync.storage.set({ lastAutoCommentError: error });
        logger.warn(error);
        return false;
      }

      sendButton.click();
      await wait(CONFIG.COMMENT_DELAY);

      // ==================== УЛУЧШЕННОЕ ЗАКРЫТИЕ ОКНА ====================
      
      const closeSelectors = [
        CONFIG.SELECTORS.COMMENT_CLOSE,
        '.comments__close-form-btn',
        'button.comments__close-form-btn',
        '.reader-comments__close',
        'button.reader-comments__close',
        '[data-role="close-comments"]',
        'button[aria-label*="закрыт"]',
        'button[aria-label*="close"]'
      ];

      let closeButton = null;
      for (const selector of closeSelectors) {
        closeButton = document.querySelector(selector);
        if (closeButton) break;
      }

      if (!closeButton) {
        const buttons = Array.from(document.querySelectorAll('button'));
        closeButton = buttons.find(btn => {
          const text = (btn.textContent || btn.innerText || '').toLowerCase();
          return text.includes('отмена') || text.includes('закрыт') || 
                 text.includes('cancel') || text.includes('close');
        });
      }

      if (closeButton) {
        closeButton.click();
        logger.info('✅ Окно комментариев закрыто');
      } else {
        logger.warn('⚠️ Кнопка закрытия комментариев не найдена');
        
        // Попытка закрыть через ESC
        document.dispatchEvent(new KeyboardEvent('keydown', { 
          key: 'Escape', 
          keyCode: 27,
          bubbles: true 
        }));
      }

      await chromeAsync.storage.set({ lastAutoCommentError: '' });
      logger.info('Комментарий отправлен:', text);
      
      return true;
    } catch (err) {
      const error = `Ошибка postComment: ${err?.message || err}`;
      await chromeAsync.storage.set({ lastAutoCommentError: error });
      logger.error('postComment error:', err);
      return false;
    }
  }

  /**
   * Обрабатывает событие прочтения главы для автокомментирования
   */
  async function handleChapterRead(chapterIndex) {
    try {
      if (!state.autoCommentSettings?.enabled) return;
      if (!chapterIndex || chapterIndex === 1) return;

      const interval = Math.max(1, Number(state.autoCommentSettings.interval) || 1);
      const total = Math.max(1, Number(state.autoCommentSettings.totalComments) || 1);
      const posted = Number(state.autoCommentState.posted) || 0;
      
      const offset = chapterIndex - 2;

      if (offset >= 0 && (offset % interval === 0) && posted < total) {
        const textList = Array.isArray(state.autoCommentSettings.commentsList) && 
                        state.autoCommentSettings.commentsList.length 
          ? state.autoCommentSettings.commentsList 
          : [];
        
        const text = textList.length 
          ? textList[Math.floor(Math.random() * textList.length)]
          : 'Спасибо за главу!';

        const wasAutoScrolling = state.autoScroll;
        
        try {
          if (wasAutoScrolling) {
            await chromeAsync.storage.set({ autoScroll: false });
            state.autoScroll = false;
            stopSmoothScroll();
          }
        } catch (err) {
          logger.warn('Ошибка паузы автопрокрутки:', err);
        }

        let success = false;
        try {
          const promise = postComment(text);
          success = promise && typeof promise.then === 'function' 
            ? await promise 
            : Boolean(promise);
        } catch (err) {
          logger.error('Ошибка вызова postComment:', err);
        }

        try {
          if (wasAutoScrolling) {
            await chromeAsync.storage.set({ autoScroll: true });
            state.autoScroll = true;
            if (isChapterPage()) startSmoothScroll();
          }
        } catch (err) {
          logger.warn('Ошибка возобновления автопрокрутки:', err);
        }

        if (success) {
          state.autoCommentState.posted = posted + 1;
          await chromeAsync.storage.set({
            [CONFIG.AUTO_COMMENT_STATE_KEY]: state.autoCommentState
          });
        }
      }
    } catch (err) {
      logger.error('Ошибка handleChapterRead:', err);
    }
  }

  // ==================== СИНХРОНИЗАЦИЯ ====================
  
  /**
   * Синхронизирует все активные функции
   */
  function syncAllFeatures() {
    if (state.autoScroll && isChapterPage() && !state.isPerformingClick) {
      startSmoothScroll();
    } else {
      stopSmoothScroll();
    }

    if (state.farmActive && isChapterPage() && !state.farmInterval) {
      state.farmInterval = setInterval(farmOnce, CONFIG.FARM_INTERVAL);
      logger.info('✅ Фарм ивента запущен');
    }
    if ((!state.farmActive || !isChapterPage()) && state.farmInterval) {
      clearInterval(state.farmInterval);
      state.farmInterval = null;
      logger.info('⏸️ Фарм ивента остановлен');
    }

    if (state.mineActive && isMinePage() && !state.mineInterval) {
      state.mineInterval = setInterval(
        mineTick, 
        Math.max(CONFIG.MINE_INTERVAL_MIN, state.mineClickDelay)
      );
    }
    if ((!state.mineActive || !isMinePage()) && state.mineInterval) {
      clearInterval(state.mineInterval);
      state.mineInterval = null;
    }
  }

  // ==================== ОБРАБОТЧИКИ СООБЩЕНИЙ ====================
  
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      if (!msg?.action) {
        sendResponse({ success: false, error: 'Неверное сообщение' });
        return;
      }

      try {
        switch (msg.action) {
          case 'startScrolling': {
            if (!isChapterPage()) {
              sendResponse({ 
                success: false, 
                error: 'Только на странице главы!' 
              });
              return;
            }

            state.autoScroll = true;
            if (typeof msg.chapterLimit === 'number') {
              state.chapterLimit = msg.chapterLimit;
            }

            const { currentChapterUrl } = await chromeAsync.storage.get(['currentChapterUrl']);
            const updates = { 
              autoScroll: true, 
              chapterLimit: state.chapterLimit 
            };

            if (currentChapterUrl !== location.href) {
              updates.currentChapterUrl = location.href;
            }

            await chromeAsync.storage.set(updates);
            syncAllFeatures();
            sendResponse({ success: true });
            break;
          }

          case 'stopScrolling': {
            state.autoScroll = false;
            await chromeAsync.storage.set({ autoScroll: false });
            stopSmoothScroll();
            sendResponse({ success: true });
            break;
          }

          case 'updateSpeed': {
            const speed = Math.max(Number(msg.speed) || 50, 1);
            state.scrollSpeed = speed;
            await chromeAsync.storage.set({ scrollSpeed: speed });
            
            if (state.autoScroll) {
              stopSmoothScroll();
              startSmoothScroll();
            }
            
            sendResponse({ success: true });
            break;
          }

          case 'startFarm': {
            if (!isChapterPage()) {
              sendResponse({ 
                success: false, 
                error: 'Фарм ивента работает только на страницах глав!' 
              });
              return;
            }

            state.farmActive = true;
            await chromeAsync.storage.set({ farmActive: true });
            
            if (!state.farmInterval) {
              state.farmInterval = setInterval(farmOnce, CONFIG.FARM_INTERVAL);
            }
            
            logger.info('✅ Фарм ивента запущен');
            sendResponse({ success: true });
            break;
          }

          case 'stopFarm': {
            state.farmActive = false;
            await chromeAsync.storage.set({ farmActive: false });
            
            if (state.farmInterval) {
              clearInterval(state.farmInterval);
              state.farmInterval = null;
            }
            
            logger.info('⏸️ Фарм ивента остановлен');
            sendResponse({ success: true });
            break;
          }

          case 'startMine': {
            if (!isMinePage()) {
              sendResponse({ 
                success: false, 
                error: 'Только на странице Шахты!' 
              });
              return;
            }

            state.mineActive = true;
            await chromeAsync.storage.set({ mineActive: true });
            
            if (!state.mineInterval) {
              state.mineInterval = setInterval(
                mineTick, 
                Math.max(CONFIG.MINE_INTERVAL_MIN, state.mineClickDelay)
              );
            }
            
            sendResponse({ success: true });
            break;
          }

          case 'stopMine': {
            state.mineActive = false;
            await chromeAsync.storage.set({ mineActive: false });
            
            if (state.mineInterval) {
              clearInterval(state.mineInterval);
              state.mineInterval = null;
            }
            
            sendResponse({ success: true });
            break;
          }

          default:
            sendResponse({ 
              success: false, 
              error: 'Неизвестное действие' 
            });
        }
      } catch (err) {
        sendResponse({ 
          success: false, 
          error: err?.message || 'Ошибка' 
        });
      }
    })();

    return true;
  });

  // ==================== ОБРАБОТЧИКИ ИЗМЕНЕНИЙ ХРАНИЛИЩА ====================
  
  chrome.storage.onChanged.addListener((changes) => {
    const relevantKeys = STORAGE_KEYS;
    const hasRelevantChanges = Object.keys(changes).some(key => 
      relevantKeys.includes(key)
    );

    if (hasRelevantChanges) {
      loadStateFromStorage();
    }

    if (changes.chapterRead) {
      const newValue = changes.chapterRead.newValue;
      if (typeof newValue === 'number') {
        setTimeout(() => handleChapterRead(newValue), 900);
      }
    }

    if (changes[CONFIG.AUTO_COMMENT_KEY]) {
      Object.assign(
        state.autoCommentSettings, 
        changes[CONFIG.AUTO_COMMENT_KEY].newValue || {}
      );
    }

    if (changes[CONFIG.AUTO_COMMENT_STATE_KEY]) {
      Object.assign(
        state.autoCommentState, 
        changes[CONFIG.AUTO_COMMENT_STATE_KEY].newValue || {}
      );
    }
  });

  // ==================== ИНИЦИАЛИЗАЦИЯ ====================
  
  window.addEventListener('load', () => {
    loadStateFromStorage(async () => {
      if (state.autoScroll && isChapterPage()) {
        const data = await chromeAsync.storage.get([
          'currentChapterUrl', 
          'chapterRead', 
          'chapterLimit'
        ]);

        const { 
          currentChapterUrl = null, 
          chapterRead: storedRead = 0, 
          chapterLimit: storedLimit = 0 
        } = data;

        const updates = {};
        let newRead = storedRead;

        if (currentChapterUrl !== location.href) {
          newRead = (typeof storedRead === 'number' ? storedRead : 0) + 1;
          updates.chapterRead = newRead;
          updates.currentChapterUrl = location.href;
        }

        if (storedLimit > 0 && newRead > storedLimit) {
          state.autoScroll = false;
          updates.autoScroll = false;
        }

        if (Object.keys(updates).length) {
          await chromeAsync.storage.set(updates);
          
          if (state.autoScroll && isChapterPage()) {
            startSmoothScroll();
          }
        } else if (state.autoScroll && isChapterPage()) {
          startSmoothScroll();
        }
      }
    });
  });

  loadStateFromStorage();

  logger.info('✅ Content script загружен (v4.2 - улучшенная версия)');
  logger.info('🚀 Плавная прокрутка без рывков');
  logger.info('💬 Автозакрытие окна комментариев');
})();
