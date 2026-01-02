// qh_content.js - ИСПРАВЛЕНО: Решена проблема с первым вопросом
'use strict';

(() => {
  const CONFIG = {
    DEBUG: true,
    MESSAGE_SOURCE: 'quiz-helper',
    MESSAGE_TYPE: 'CORRECT',
    
    CSS: {
      CORRECT_CLASS: 'quiz-helper-correct',
      STYLE_ID: 'quiz-helper-styles'
    },
    
    QUIZ_AREA_SELECTOR: '.quiz__answers',
    ANSWER_ITEM_SELECTOR: '.quiz__answer-item',
    
    ANSWER_SELECTORS: [
      '.quiz__answer-item',
      '.quiz__answer',
      'button.quiz__answer-item',
      'div.quiz__answer-item'
    ].join(', '),
    
    TOKEN_ATTRIBUTES: [
      'data-id',
      'data-answer-id',
      'data-token',
      'data-answer',
      'data-key',
      'data-value',
      'id',
      'value'
    ],
    
    LIMITS: {
      MAX_PARENT_DEPTH: 3,
      MAX_CANDIDATES: 50,
      MAX_TEXT_ELEMENTS: 100
    },
    
    TIMEOUTS: {
      MARK_DEBOUNCE: 100,
      RETRY_DELAY: 500,
      MAX_RETRIES: 8,  // Увеличено для первого вопроса
      INJECT_CHECK_DELAY: 2000,
      BUFFER_PROCESS_DELAY: 500,  // Увеличена задержка
      CONTAINER_CHECK_INTERVAL: 200,  // Новый параметр
      CONTAINER_CHECK_MAX_ATTEMPTS: 15  // Новый параметр
    }
  };

  const logger = {
    log: (...args) => {
      if (CONFIG.DEBUG) console.log('[QH][content]', ...args);
    },
    debug: (...args) => {
      if (CONFIG.DEBUG) console.debug('[QH][content]', ...args);
    },
    warn: (...args) => {
      if (CONFIG.DEBUG) console.warn('[QH][content]', ...args);
    },
    error: (...args) => {
      if (CONFIG.DEBUG) console.error('[QH][content]', ...args);
    }
  };

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function cssEscape(value) {
    if (window.CSS?.escape) {
      return CSS.escape(String(value));
    }
    return String(value).replace(/[\0-\x1F\x7F"\\]/g, char => 
      '\\' + char.charCodeAt(0).toString(16) + ' '
    );
  }

  const state = {
    lastPayload: null,
    lastMarkTimestamp: 0,
    mutationScheduled: false,
    retryCount: 0,
    retryTimer: null,
    isEnabled: true,
    injectLoaded: false,
    messageBuffer: [],
    domReady: false,
    containerCheckAttempts: 0  // Новое поле
  };

  // ==================== ИНЪЕКЦИЯ ====================
  
  function injectPageScript() {
    try {
      if (document.getElementById('qh-inject-script')) {
        logger.debug('⚠️ inject.js уже инжектирован');
        return;
      }

      const script = document.createElement('script');
      script.id = 'qh-inject-script';
      script.src = chrome.runtime.getURL('inject.js');
      script.type = 'text/javascript';

      script.onload = () => {
        logger.log('✅ inject.js загружен в DOM');
        script.remove();
      };

      script.onerror = () => {
        logger.error('❌ Ошибка загрузки inject.js');
        script.remove();
      };

      (document.head || document.documentElement).appendChild(script);
      logger.debug('📌 inject.js инжектирован');
    } catch (err) {
      logger.error('❌ Критическая ошибка инъекции:', err);
    }
  }

  function injectStyles() {
    if (document.getElementById(CONFIG.CSS.STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = CONFIG.CSS.STYLE_ID;
    style.textContent = `
      .${CONFIG.CSS.CORRECT_CLASS} {
        outline: 4px solid #16c60c !important;
        background: rgba(22, 198, 12, 0.15) !important;
        position: relative;
        box-shadow: 0 0 15px rgba(22, 198, 12, 0.4) !important;
        animation: pulse-correct 1.5s ease-in-out infinite;
      }
      .${CONFIG.CSS.CORRECT_CLASS}::after {
        content: "✓ ПРАВИЛЬНО";
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        color: #16c60c;
        font-weight: 700;
        font-size: 14px;
        pointer-events: none;
        background: rgba(255, 255, 255, 0.9);
        padding: 4px 8px;
        border-radius: 4px;
        z-index: 999999;
      }
      @keyframes pulse-correct {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.85; }
      }
    `;

    (document.head || document.documentElement).appendChild(style);
    logger.debug('✅ Стили инжектированы');
  }

  // ==================== ПОЛУЧЕНИЕ ОБЛАСТИ КВИЗА ====================
  
  function getQuizAnswersContainer() {
    const container = document.querySelector(CONFIG.QUIZ_AREA_SELECTOR);
    
    if (!container) {
      logger.warn('⚠️ Контейнер .quiz__answers не найден на странице');
      return null;
    }
    
    logger.debug('✅ Контейнер квиза найден:', container);
    return container;
  }

  function isInsideQuizArea(element) {
    if (!element) return false;
    
    const container = getQuizAnswersContainer();
    if (!container) return false;
    
    return container.contains(element);
  }

  // ==================== ОЖИДАНИЕ КОНТЕЙНЕРА ====================
  
  /**
   * НОВАЯ ФУНКЦИЯ: Ожидает появления контейнера квиза
   */
  async function waitForQuizContainer() {
    return new Promise((resolve) => {
      const check = () => {
        const container = getQuizAnswersContainer();
        
        if (container) {
          logger.log('✅ Контейнер квиза появился');
          resolve(true);
          return;
        }
        
        state.containerCheckAttempts++;
        
        if (state.containerCheckAttempts >= CONFIG.TIMEOUTS.CONTAINER_CHECK_MAX_ATTEMPTS) {
          logger.warn('⚠️ Превышено максимальное количество попыток поиска контейнера');
          resolve(false);
          return;
        }
        
        setTimeout(check, CONFIG.TIMEOUTS.CONTAINER_CHECK_INTERVAL);
      };
      
      check();
    });
  }

  // ==================== ПОИСК ЭЛЕМЕНТОВ ====================
  
  function findClosestAnswer(element) {
    if (!isInsideQuizArea(element)) {
      logger.warn('⚠️ Элемент находится вне области квиза');
      return null;
    }
    
    let node = element;
    
    for (let i = 0; i < CONFIG.LIMITS.MAX_PARENT_DEPTH && node; i++) {
      try {
        if (node.matches?.(CONFIG.ANSWER_SELECTORS)) {
          return node;
        }
      } catch (err) {}
      
      node = node.parentElement;
      
      const container = getQuizAnswersContainer();
      if (container && !container.contains(node)) {
        break;
      }
    }

    return element;
  }

  function findByToken(token) {
    if (!token) return null;

    logger.debug('🔍 Ищем по токену:', token);

    const container = getQuizAnswersContainer();
    if (!container) {
      logger.error('❌ Контейнер квиза не найден');
      return null;
    }

    const escapedToken = cssEscape(token);
    
    for (const attr of CONFIG.TOKEN_ATTRIBUTES) {
      const selector = `${CONFIG.QUIZ_AREA_SELECTOR} [${attr}="${escapedToken}"]`;
      const element = document.querySelector(selector);
      
      if (element) {
        logger.log('✅ Элемент найден по атрибуту', attr, ':', element);
        logger.debug('📋 Значение атрибута:', element.getAttribute(attr));
        return element;
      }
    }

    const answerItems = container.querySelectorAll(CONFIG.ANSWER_ITEM_SELECTOR);
    logger.debug('📊 Найдено элементов ответов:', answerItems.length);
    
    if (CONFIG.DEBUG && answerItems.length > 0) {
      logger.debug('🔍 Атрибуты элементов ответов:');
      answerItems.forEach((item, idx) => {
        const attrs = {};
        CONFIG.TOKEN_ATTRIBUTES.forEach(attr => {
          const val = item.getAttribute(attr);
          if (val) attrs[attr] = val;
        });
        
        const text = item.textContent.trim();
        logger.debug(`  [${idx}]:`, attrs, '| Текст:', text);
        
        if (attrs['data-id']) {
          const matches = String(attrs['data-id']) === String(token);
          logger.debug(`    ➜ data-id="${attrs['data-id']}" === "${token}"?`, matches ? '✅ ДА' : '❌ НЕТ');
        }
      });
    }
    
    for (const item of answerItems) {
      for (const attr of CONFIG.TOKEN_ATTRIBUTES) {
        const value = item.getAttribute(attr);
        if (value && String(value) === String(token)) {
          logger.log('✅ Элемент найден среди ответов по атрибуту', attr, ':', item);
          return item;
        }
      }
    }

    for (const item of answerItems) {
      const allElements = item.querySelectorAll('*');
      for (const el of allElements) {
        for (const attr of CONFIG.TOKEN_ATTRIBUTES) {
          const value = el.getAttribute(attr);
          if (value && String(value) === String(token)) {
            logger.log('✅ Элемент найден глубоким поиском:', el);
            logger.debug('📋 Возвращаем родительский answer-item:', item);
            return item;
          }
        }
      }
    }

    logger.warn('❌ Элемент по токену не найден в области квиза');
    logger.warn('💡 Искали токен:', token, 'в атрибутах:', CONFIG.TOKEN_ATTRIBUTES);
    return null;
  }

  function findByText(text) {
    if (!text) return null;

    logger.debug('🔍 Ищем по тексту:', text);

    const container = getQuizAnswersContainer();
    if (!container) {
      logger.error('❌ Контейнер квиза не найден');
      return null;
    }

    const normalizedSearchText = normalizeText(text);

    const answerItems = Array.from(
      container.querySelectorAll(CONFIG.ANSWER_ITEM_SELECTOR)
    );

    logger.debug('📊 Найдено элементов ответов:', answerItems.length);

    for (const element of answerItems) {
      const elementText = normalizeText(element.innerText || element.textContent);
      if (elementText === normalizedSearchText) {
        logger.log('✅ Точное совпадение текста:', element);
        return element;
      }
    }

    for (const element of answerItems) {
      const elementText = normalizeText(element.innerText || element.textContent);
      if (elementText.includes(normalizedSearchText)) {
        logger.log('✅ Частичное совпадение текста:', element);
        return element;
      }
    }

    for (const element of answerItems) {
      const elementText = (element.innerText || element.textContent).trim();
      if (elementText === text || elementText.includes(text)) {
        logger.log('✅ Совпадение без нормализации:', element);
        return element;
      }
    }

    logger.warn('❌ Элемент по тексту не найден в области квиза');
    return null;
  }

  // ==================== МАРКИРОВКА ====================
  
  function clearPreviousHighlight() {
    const highlighted = document.querySelectorAll(`.${CONFIG.CSS.CORRECT_CLASS}`);
    highlighted.forEach(el => {
      el.classList.remove(CONFIG.CSS.CORRECT_CLASS);
    });
    
    if (highlighted.length > 0) {
      logger.debug('🧹 Очищено предыдущих подсветок:', highlighted.length);
    }
  }

  function markAsCorrect(element) {
    if (!state.isEnabled) {
      logger.debug('⏸️ Подсветка отключена');
      return false;
    }
    
    if (!element) {
      logger.error('❌ Элемент для подсветки не передан');
      return false;
    }

    if (!isInsideQuizArea(element)) {
      logger.error('❌ Элемент находится вне области квиза! Игнорируем.');
      return false;
    }

    clearPreviousHighlight();

    const targetElement = findClosestAnswer(element);
    
    if (!targetElement) {
      logger.error('❌ Не удалось найти элемент ответа');
      return false;
    }

    try {
      targetElement.classList.add(CONFIG.CSS.CORRECT_CLASS);
      state.lastMarkTimestamp = Date.now();
      state.retryCount = 0;
      
      logger.log('🎉 ЭЛЕМЕНТ ПОДСВЕЧЕН!', targetElement);
      logger.log('📝 Текст элемента:', targetElement.innerText || targetElement.textContent);
      
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      return true;
    } catch (err) {
      logger.error('❌ Ошибка подсветки:', err);
      return false;
    }
  }

  async function tryMarkCorrectAnswer() {
    if (!state.lastPayload) {
      logger.warn('⚠️ Нет данных для подсветки');
      return false;
    }

    if (!state.isEnabled) {
      logger.debug('⏸️ Подсветка отключена');
      return false;
    }

    const container = getQuizAnswersContainer();
    if (!container) {
      logger.warn('⚠️ Контейнер квиза не найден, ожидаем...');
      
      // ИСПРАВЛЕНИЕ: Ожидаем появления контейнера
      const containerAppeared = await waitForQuizContainer();
      
      if (!containerAppeared) {
        logger.error('❌ Контейнер квиза так и не появился');
        if (state.retryCount < CONFIG.TIMEOUTS.MAX_RETRIES) {
          state.retryCount++;
          logger.warn(`⏳ Попытка ${state.retryCount}/${CONFIG.TIMEOUTS.MAX_RETRIES}`);
          
          clearTimeout(state.retryTimer);
          state.retryTimer = setTimeout(() => {
            tryMarkCorrectAnswer();
          }, CONFIG.TIMEOUTS.RETRY_DELAY);
        }
        return false;
      }
    }

    logger.log('🎯 Пытаемся найти правильный ответ:', state.lastPayload);

    let element = null;

    if (state.lastPayload.correctToken) {
      element = findByToken(state.lastPayload.correctToken);
    }

    if (!element && state.lastPayload.correctText) {
      element = findByText(state.lastPayload.correctText);
    }

    if (element) {
      const success = markAsCorrect(element);
      if (success) {
        state.lastPayload = null;
        state.containerCheckAttempts = 0;  // Сброс счетчика
        clearTimeout(state.retryTimer);
        return true;
      }
    }

    if (state.retryCount < CONFIG.TIMEOUTS.MAX_RETRIES) {
      state.retryCount++;
      logger.warn(`⏳ Попытка ${state.retryCount}/${CONFIG.TIMEOUTS.MAX_RETRIES}`);
      
      clearTimeout(state.retryTimer);
      state.retryTimer = setTimeout(() => {
        tryMarkCorrectAnswer();
      }, CONFIG.TIMEOUTS.RETRY_DELAY);
    } else {
      logger.error('❌ Превышено максимальное число попыток');
      state.containerCheckAttempts = 0;  // Сброс счетчика
    }

    return false;
  }

  // ==================== ОБРАБОТЧИКИ СОБЫТИЙ ====================
  
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const message = event.data;

    if (!message || typeof message !== 'object') return;

    if (message.source === 'quiz-helper-inject' && message.type === 'INJECT_LOADED') {
      state.injectLoaded = true;
      logger.log('✅ inject.js успешно загружен и инициализирован');
      return;
    }

    if (message.source !== CONFIG.MESSAGE_SOURCE || message.type !== CONFIG.MESSAGE_TYPE) {
      return;
    }

    logger.log('📨 ПОЛУЧЕНО СООБЩЕНИЕ:', message.payload);

    if (message.payload) {
      logger.log('📋 Детали:');
      logger.log('  - Текст:', message.payload.correctText || '(нет)');
      logger.log('  - Токен:', message.payload.correctToken || '(нет)');
    }

    if (!state.domReady) {
      logger.warn('⏳ DOM не готов - сообщение добавлено в буфер');
      state.messageBuffer.push(message.payload);
      return;
    }

    state.lastPayload = message.payload;
    state.retryCount = 0;
    state.containerCheckAttempts = 0;  // Сброс счетчика
    clearTimeout(state.retryTimer);
    
    tryMarkCorrectAnswer();
  });

  const mutationObserver = new MutationObserver(() => {
    if (!state.mutationScheduled) {
      state.mutationScheduled = true;

      requestAnimationFrame(() => {
        state.mutationScheduled = false;

        if (Date.now() - state.lastMarkTimestamp > CONFIG.TIMEOUTS.MARK_DEBOUNCE) {
          if (state.lastPayload && state.retryCount < CONFIG.TIMEOUTS.MAX_RETRIES && state.isEnabled) {
            logger.debug('🔄 DOM изменился - повторная попытка');
            tryMarkCorrectAnswer();
          }
        }
      });
    }
  });

  mutationObserver.observe(document.documentElement, {
    subtree: true,
    childList: true
  });

  // ==================== УПРАВЛЕНИЕ СОСТОЯНИЕМ ====================
  
  function setEnabled(enabled) {
    state.isEnabled = Boolean(enabled);
    logger.log(state.isEnabled ? '✅ Подсветка включена' : '⏸️ Подсветка выключена');
    
    if (!state.isEnabled) {
      clearPreviousHighlight();
      state.lastPayload = null;
      clearTimeout(state.retryTimer);
    }
  }

  async function syncState() {
    try {
      const data = await new Promise(resolve => 
        chrome.storage.sync.get(['quizHighlight'], resolve)
      );
      
      setEnabled(data.quizHighlight !== false);
    } catch (err) {
      logger.warn('Ошибка синхронизации состояния:', err);
    }
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.quizHighlight) {
      setEnabled(changes.quizHighlight.newValue !== false);
    }
  });

  // ==================== ПУБЛИЧНЫЙ API ====================
  
  window.__QH = {
    findByText,
    findByToken,
    markAsCorrect,
    setEnabled,
    clearHighlight: clearPreviousHighlight,
    getQuizContainer: getQuizAnswersContainer,
    state,
    CONFIG,
    testHighlight: (token) => {
      state.lastPayload = { correctToken: token };
      tryMarkCorrectAnswer();
    }
  };

  // ==================== ИНИЦИАЛИЗАЦИЯ ====================
  
  (async function init() {
    injectPageScript();
    injectStyles();
    await syncState();
    
    logger.log('🚀 QH Content Script инициализирован');
    logger.log('💡 Доступен глобальный объект window.__QH');
    logger.log('🎯 Поиск ограничен областью:', CONFIG.QUIZ_AREA_SELECTOR);
    
    /**
     * ИСПРАВЛЕНИЕ: Улучшенная обработка буфера сообщений
     */
    async function processPendingMessages() {
      state.domReady = true;
      
      if (state.messageBuffer.length > 0) {
        logger.log(`📦 Обрабатываем ${state.messageBuffer.length} сообщений из буфера`);
        
        // Ожидаем появления контейнера квиза
        const containerAppeared = await waitForQuizContainer();
        
        if (!containerAppeared) {
          logger.warn('⚠️ Контейнер квиза не появился, буфер будет обработан при появлении контейнера');
          // Не очищаем буфер, оставляем для повторной попытки
          return;
        }
        
        const lastMessage = state.messageBuffer[state.messageBuffer.length - 1];
        state.lastPayload = lastMessage;
        state.retryCount = 0;
        state.containerCheckAttempts = 0;
        
        tryMarkCorrectAnswer();
        
        state.messageBuffer = [];
      }
    }
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(processPendingMessages, CONFIG.TIMEOUTS.BUFFER_PROCESS_DELAY);
      });
    } else {
      setTimeout(processPendingMessages, CONFIG.TIMEOUTS.BUFFER_PROCESS_DELAY);
    }
    
    setTimeout(() => {
      if (!state.injectLoaded) {
        logger.error('❌ inject.js НЕ ЗАГРУЖЕН!');
        logger.error('💡 Проверьте:');
        logger.error('   1. web_accessible_resources в manifest.json');
        logger.error('   2. CSP сайта');
        logger.error('   3. Консоль браузера');
      } else {
        logger.log('✅ Все компоненты загружены успешно');
      }
    }, CONFIG.TIMEOUTS.INJECT_CHECK_DELAY);
  })();
})();
