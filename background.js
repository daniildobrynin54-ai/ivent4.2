// background.js - Исправленная версия Service Worker
'use strict';

const CONSTANTS = {
  VALID_ACTIONS: new Set([
    'startScrolling', 'stopScrolling', 'updateSpeed',
    'startFarm', 'stopFarm',
    'startMine', 'stopMine'
  ]),
  DOMAIN_PATTERN: /\b(?:^|\.)mangabuff\.ru$/i,
  ERROR_MESSAGES: {
    INVALID_MESSAGE: 'Неверное сообщение',
    UNKNOWN_ACTION: 'Неизвестное действие',
    NO_ACTIVE_TAB: 'Нет активной вкладки',
    WRONG_DOMAIN: 'Откройте mangabuff.ru',
    INVALID_URL: 'Некорректный URL вкладки',
    TAB_SEND_ERROR: 'Ошибка при отправке в вкладку',
    GENERIC_ERROR: 'Ошибка'
  }
};

/**
 * Промисифицированные Chrome API
 */
const chromeAsync = {
  tabs: {
    query: (opts) => new Promise(resolve => 
      chrome.tabs.query(opts, resolve)
    ),
    sendMessage: (tabId, msg) => new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, msg, resp => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(resp);
      });
    })
  },
  storage: {
    get: (keys) => new Promise(resolve => 
      chrome.storage.sync.get(keys, resolve)
    ),
    set: (obj) => new Promise(resolve => 
      chrome.storage.sync.set(obj, resolve)
    )
  }
};

/**
 * Логгер для отладки - ИСПРАВЛЕНО
 */
const logger = {
  info: function(...args) { console.log('[MBH][bg]', ...args); },
  warn: function(...args) { console.warn('[MBH][bg]', ...args); },
  error: function(...args) { console.error('[MBH][bg]', ...args); }
};

/**
 * Валидирует входящее сообщение
 */
function validateMessage(msg) {
  if (!msg || typeof msg.action !== 'string') {
    return { 
      valid: false, 
      error: CONSTANTS.ERROR_MESSAGES.INVALID_MESSAGE 
    };
  }
  return { valid: true };
}

/**
 * Валидирует URL вкладки
 */
function validateTabUrl(url) {
  try {
    const urlObj = new URL(url);
    if (!CONSTANTS.DOMAIN_PATTERN.test(urlObj.hostname)) {
      return { 
        valid: false, 
        error: CONSTANTS.ERROR_MESSAGES.WRONG_DOMAIN 
      };
    }
    return { valid: true };
  } catch (err) {
    return { 
      valid: false, 
      error: CONSTANTS.ERROR_MESSAGES.INVALID_URL 
    };
  }
}

/**
 * Нормализует значение скорости
 */
function normalizeSpeed(speed) {
  const num = Number(speed);
  return Number.isFinite(num) ? Math.max(1, Math.floor(num)) : 50;
}

/**
 * Обрабатывает действие обновления скорости
 */
async function handleUpdateSpeed(msg) {
  try {
    const safeSpeed = normalizeSpeed(msg.speed);
    await chromeAsync.storage.set({ scrollSpeed: safeSpeed });
    return { success: true, speed: safeSpeed };
  } catch (err) {
    logger.error('Ошибка handleUpdateSpeed:', err);
    return { 
      success: false, 
      error: err?.message || CONSTANTS.ERROR_MESSAGES.GENERIC_ERROR 
    };
  }
}

/**
 * Обрабатывает стандартные действия (отправка в content script)
 */
async function handleStandardAction(msg) {
  if (!CONSTANTS.VALID_ACTIONS.has(msg.action)) {
    return { 
      success: false, 
      error: CONSTANTS.ERROR_MESSAGES.UNKNOWN_ACTION 
    };
  }

  try {
    // Получаем активную вкладку
    const tabs = await chromeAsync.tabs.query({ 
      active: true, 
      currentWindow: true 
    });
    
    const tab = tabs?.[0];
    if (!tab) {
      return { 
        success: false, 
        error: CONSTANTS.ERROR_MESSAGES.NO_ACTIVE_TAB 
      };
    }

    // Валидируем URL
    const urlValidation = validateTabUrl(tab.url);
    if (!urlValidation.valid) {
      return { success: false, error: urlValidation.error };
    }

    // Отправляем сообщение в content script
    const response = await chromeAsync.tabs.sendMessage(tab.id, msg);
    return response || { success: true };
    
  } catch (err) {
    logger.error('Ошибка отправки в вкладку:', err);
    return { 
      success: false, 
      error: err?.message || CONSTANTS.ERROR_MESSAGES.TAB_SEND_ERROR 
    };
  }
}

/**
 * Главный обработчик сообщений
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      // Валидация сообщения
      const validation = validateMessage(msg);
      if (!validation.valid) {
        sendResponse({ success: false, error: validation.error });
        return;
      }

      logger.info('Получено сообщение:', msg.action);

      let result;
      
      // Маршрутизация действий
      if (msg.action === 'updateSpeed') {
        result = await handleUpdateSpeed(msg);
      } else {
        result = await handleStandardAction(msg);
      }

      logger.info('Результат:', result);
      sendResponse(result);
      
    } catch (err) {
      logger.error('Необработанная ошибка:', err);
      sendResponse({ 
        success: false, 
        error: err?.message || CONSTANTS.ERROR_MESSAGES.GENERIC_ERROR 
      });
    }
  })();

  // ВАЖНО: возвращаем true для асинхронного ответа
  return true;
});

/**
 * Обработчик установки расширения
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    logger.info('🎉 Расширение установлено');
    
    // Устанавливаем дефолтные настройки
    await chromeAsync.storage.set({
      autoScroll: false,
      scrollSpeed: 50,
      chapterLimit: 0,
      chapterRead: 0,
      farmActive: false,
      mineActive: false,
      giftClickDelay: 600,
      mineClickDelay: 2000,
      theme: 'light',
      quizHighlight: true,
      autoCommentSettings: {
        enabled: false,
        interval: 2,
        totalComments: 5,
        commentsList: []
      },
      autoCommentState: {
        posted: 0
      }
    });
    
  } else if (details.reason === 'update') {
    logger.info('🔄 Расширение обновлено до версии', chrome.runtime.getManifest().version);
  }
});

/**
 * Обработчик запуска Service Worker
 */
chrome.runtime.onStartup.addListener(() => {
  logger.info('🚀 Service Worker запущен');
});

logger.info('Service Worker загружен');
