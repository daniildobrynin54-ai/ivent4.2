// popup.js - Исправленная версия с увеличенной максимальной скоростью
'use strict';

/**
 * @fileoverview UI логика для popup расширения Mangabuff Helper
 * Управление всеми функциями через интерфейс
 */

// ==================== КОНСТАНТЫ ====================

const CONFIG = {
  // Лимиты (ИЗМЕНЕНО)
  LIMITS: {
    MAX_COMMENTS: 100,
    MIN_INTERVAL: 1,
    MAX_INTERVAL: 100,
    MIN_TOTAL_COMMENTS: 1,
    MAX_TOTAL_COMMENTS: 100,
    MIN_CHAPTERS: 0,
    MAX_CHAPTERS: 100000,
    MIN_GIFT_DELAY: 50,
    MAX_GIFT_DELAY: 2000,
    MIN_MINE_DELAY: 0.2,
    MAX_MINE_DELAY: 5.0,
    MIN_SCROLL_SPEED: 10,
    MAX_SCROLL_SPEED: 5000      // ИЗМЕНЕНО: было 2000
  },
  
  // Таймауты
  TIMEOUTS: {
    ERROR_DISPLAY: 3200,
    SPEED_DEBOUNCE: 140,
    DELAY_DEBOUNCE: 120,
    INIT_DELAY: 50
  },
  
  // Высота popup
  POPUP_HEIGHT: {
    MIN: 255,
    MAX: 760,
    EXTRA_PADDING: 9
  },
  
  // Ключи хранилища
  STORAGE_KEYS: {
    AUTO_COMMENT: 'autoCommentSettings',
    AUTO_COMMENT_STATE: 'autoCommentState',
    LAST_ERROR: 'lastAutoCommentError'
  },
  
  // Дефолтные значения (ИЗМЕНЕНО)
  DEFAULTS: {
    ENABLED: false,
    INTERVAL: 2,
    TOTAL_COMMENTS: 5,
    COMMENTS_LIST: [],
    GIFT_DELAY: 400,          // ИЗМЕНЕНО: было 600
    MINE_DELAY: 0.2           // ИЗМЕНЕНО: было 2.0
  }
};

// ==================== УТИЛИТЫ ====================

/**
 * Быстрый querySelector
 */
const $ = (selector) => document.querySelector(selector);

/**
 * Промисифицированные Chrome API
 */
const chromeAsync = {
  storage: {
    get: (keys) => new Promise((resolve, reject) => {
      try {
        chrome.storage.sync.get(keys, (result) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(result);
          }
        });
      } catch (err) {
        reject(err);
      }
    }),
    set: (obj) => new Promise((resolve, reject) => {
      try {
        chrome.storage.sync.set(obj, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      } catch (err) {
        reject(err);
      }
    })
  },
  tabs: {
    query: (opts) => new Promise(resolve => 
      chrome.tabs.query(opts, resolve)
    )
  },
  runtime: {
    sendMessage: (msg) => new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        });
      } catch (err) {
        reject(err);
      }
    })
  }
};

/**
 * Клампит число в заданном диапазоне
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Безопасный парсинг числа
 */
function safeParseInt(value, defaultValue = 0) {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function safeParseFloat(value, defaultValue = 0) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

// ==================== UI МЕНЕДЖЕР ====================

class UIManager {
  /**
   * Показывает ошибку в нижней панели
   */
  static showError(message) {
    const errorBar = $('#errorBar');
    if (!errorBar) return;
    
    errorBar.textContent = message;
    errorBar.classList.add('visible');
    
    clearTimeout(errorBar._timeout);
    errorBar._timeout = setTimeout(() => {
      errorBar.classList.remove('visible');
    }, CONFIG.TIMEOUTS.ERROR_DISPLAY);
  }

  /**
   * Устанавливает тему
   */
  static setTheme(isDark) {
    document.body.classList.toggle('dark', isDark);
    const toggle = $('#themeToggle');
    if (toggle) toggle.checked = isDark;
  }

  /**
   * Открывает панель
   */
  static openPanel(panelSelector) {
    document.querySelectorAll('.section.active')
      .forEach(el => el.classList.remove('active'));
    
    const mainMenu = $('#mainMenu');
    if (mainMenu) mainMenu.style.display = 'none';
    
    const panel = document.querySelector(panelSelector);
    if (panel) panel.classList.add('active');
    
    this.adjustPopupHeight();
  }

  /**
   * Закрывает все панели
   */
  static closePanels() {
    const mainMenu = $('#mainMenu');
    if (mainMenu) mainMenu.style.display = '';
    
    document.querySelectorAll('.section.active')
      .forEach(el => el.classList.remove('active'));
    
    this.adjustPopupHeight();
  }

  /**
   * Динамически подстраивает высоту popup
   */
  static adjustPopupHeight() {
    const body = document.body;
    body.style.height = 'auto';
    body.style.width = '360px';

    const activePanel = document.querySelector('.section.active');
    const menu = $('#mainMenu');
    const header = $('#header');
    const headerSep = $('#header-sep');
    
    let height = 0;
    
    if (activePanel?.offsetHeight) {
      height = (header?.offsetHeight || 0) + 
               (headerSep?.offsetHeight || 0) + 
               activePanel.scrollHeight + 
               CONFIG.POPUP_HEIGHT.EXTRA_PADDING;
    } else {
      height = (header?.offsetHeight || 0) + 
               (headerSep?.offsetHeight || 0) + 
               (menu?.offsetHeight || 0) + 
               CONFIG.POPUP_HEIGHT.EXTRA_PADDING;
    }

    height = clamp(height, CONFIG.POPUP_HEIGHT.MIN, CONFIG.POPUP_HEIGHT.MAX);
    
    body.style.height = `${height}px`;
    body.style.width = '360px';
    document.documentElement.style.height = `${height}px`;
    document.documentElement.style.width = '360px';
  }
}

// ==================== COMMENTS МЕНЕДЖЕР ====================

class CommentsManager {
  /**
   * Рендерит облако комментариев
   */
  static render(commentsList) {
    const container = $('#commentsCloud');
    if (!container) return;
    
    container.innerHTML = '';

    (commentsList || []).forEach((comment, index) => {
      const card = this._createCommentCard(comment, index);
      container.appendChild(card);
    });
  }

  /**
   * Создает карточку комментария
   */
  static _createCommentCard(comment, index) {
    const card = document.createElement('div');
    card.className = 'comment-item';

    const textDiv = document.createElement('div');
    textDiv.className = 'comment-text';
    textDiv.textContent = comment;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'comment-del';
    deleteBtn.title = 'Удалить комментарий';
    deleteBtn.setAttribute('aria-label', 'Удалить комментарий');
    deleteBtn.dataset.index = index;
    deleteBtn.textContent = '✕';
    
    deleteBtn.addEventListener('click', () => this._handleDelete(index));

    card.appendChild(textDiv);
    card.appendChild(deleteBtn);

    return card;
  }

  /**
   * Обрабатывает удаление комментария
   */
  static async _handleDelete(index) {
    try {
      const data = await chromeAsync.storage.get([CONFIG.STORAGE_KEYS.AUTO_COMMENT]);
      
      const settings = Object.assign(
        { ...CONFIG.DEFAULTS }, 
        data[CONFIG.STORAGE_KEYS.AUTO_COMMENT] || {}
      );

      settings.commentsList = settings.commentsList || [];

      if (index >= 0 && index < settings.commentsList.length) {
        settings.commentsList.splice(index, 1);
        
        await chromeAsync.storage.set({ 
          [CONFIG.STORAGE_KEYS.AUTO_COMMENT]: settings 
        });
        
        StatusManager.sync();
      }
    } catch (err) {
      console.error('Ошибка удаления комментария:', err);
      UIManager.showError('Ошибка удаления');
    }
  }

  /**
   * Добавляет новый комментарий
   */
  static async add(text) {
    if (!text?.trim()) return;

    try {
      const data = await chromeAsync.storage.get([CONFIG.STORAGE_KEYS.AUTO_COMMENT]);
      
      const settings = Object.assign(
        { ...CONFIG.DEFAULTS }, 
        data[CONFIG.STORAGE_KEYS.AUTO_COMMENT] || {}
      );

      settings.commentsList = settings.commentsList || [];

      if (settings.commentsList.length >= CONFIG.LIMITS.MAX_COMMENTS) {
        UIManager.showError(`Максимум ${CONFIG.LIMITS.MAX_COMMENTS} комментариев`);
        return;
      }

      settings.commentsList.push(text.trim());
      
      await chromeAsync.storage.set({ 
        [CONFIG.STORAGE_KEYS.AUTO_COMMENT]: settings 
      });

      const input = $('#newCommentText');
      if (input) input.value = '';
      
      StatusManager.sync();
    } catch (err) {
      console.error('Ошибка добавления комментария:', err);
      UIManager.showError('Ошибка добавления');
    }
  }

  /**
   * Сохраняет настройки комментирования
   */
  static async save() {
    try {
      const data = await chromeAsync.storage.get([CONFIG.STORAGE_KEYS.AUTO_COMMENT]);
      const settings = Object.assign(
        { ...CONFIG.DEFAULTS }, 
        data[CONFIG.STORAGE_KEYS.AUTO_COMMENT] || {}
      );

      const intervalInput = $('#commentInterval');
      const totalInput = $('#commentTotal');
      
      settings.interval = clamp(
        safeParseInt(intervalInput?.value, CONFIG.DEFAULTS.INTERVAL),
        CONFIG.LIMITS.MIN_INTERVAL,
        CONFIG.LIMITS.MAX_INTERVAL
      );
      settings.totalComments = clamp(
        safeParseInt(totalInput?.value, CONFIG.DEFAULTS.TOTAL_COMMENTS),
        CONFIG.LIMITS.MIN_TOTAL_COMMENTS,
        CONFIG.LIMITS.MAX_TOTAL_COMMENTS
      );

      // Собираем комментарии из UI
      const commentsCloud = $('#commentsCloud');
      if (commentsCloud) {
        settings.commentsList = [];
        commentsCloud.querySelectorAll('.comment-text')
          .forEach(el => settings.commentsList.push(el.textContent));
      }

      await chromeAsync.storage.set({ 
        [CONFIG.STORAGE_KEYS.AUTO_COMMENT]: settings 
      });

      UIManager.showError('Сохранено');
      StatusManager.sync();
    } catch (err) {
      console.error('Ошибка сохранения:', err);
      UIManager.showError('Ошибка сохранения');
    }
  }

  /**
   * Очищает все комментарии
   */
  static async clear() {
    try {
      await chromeAsync.storage.set({
        [CONFIG.STORAGE_KEYS.AUTO_COMMENT]: { ...CONFIG.DEFAULTS },
        [CONFIG.STORAGE_KEYS.AUTO_COMMENT_STATE]: { posted: 0 },
        [CONFIG.STORAGE_KEYS.LAST_ERROR]: ''
      });

      StatusManager.sync();
    } catch (err) {
      console.error('Ошибка очистки:', err);
      UIManager.showError('Ошибка очистки');
    }
  }

  /**
   * Включает комментирование
   */
  static async enable() {
    try {
      const data = await chromeAsync.storage.get([CONFIG.STORAGE_KEYS.AUTO_COMMENT]);
      const settings = Object.assign(
        { ...CONFIG.DEFAULTS }, 
        data[CONFIG.STORAGE_KEYS.AUTO_COMMENT] || {}
      );
      
      settings.enabled = true;
      
      await chromeAsync.storage.set({ 
        [CONFIG.STORAGE_KEYS.AUTO_COMMENT]: settings 
      });
      
      StatusManager.sync();
      UIManager.showError('Комментирование включено');
    } catch (err) {
      console.error('Ошибка включения комментирования:', err);
      UIManager.showError('Ошибка');
    }
  }

  /**
   * Выключает комментирование
   */
  static async disable() {
    try {
      const data = await chromeAsync.storage.get([CONFIG.STORAGE_KEYS.AUTO_COMMENT]);
      const settings = Object.assign(
        { ...CONFIG.DEFAULTS }, 
        data[CONFIG.STORAGE_KEYS.AUTO_COMMENT] || {}
      );
      
      settings.enabled = false;
      
      await chromeAsync.storage.set({ 
        [CONFIG.STORAGE_KEYS.AUTO_COMMENT]: settings 
      });
      
      StatusManager.sync();
      UIManager.showError('Комментирование выключено');
    } catch (err) {
      console.error('Ошибка выключения комментирования:', err);
      UIManager.showError('Ошибка');
    }
  }
}

// ==================== STATUS МЕНЕДЖЕР ====================

class StatusManager {
  /**
   * Синхронизирует состояние UI с хранилищем
   */
  static async sync() {
    try {
      const keys = [
        'autoScroll', 'farmActive', 'scrollSpeed', 'theme', 
        'mineActive', 'chapterLimit', 'chapterRead', 
        'giftClickDelay', 'mineClickDelay', 
        CONFIG.STORAGE_KEYS.AUTO_COMMENT, 
        CONFIG.STORAGE_KEYS.LAST_ERROR, 
        'quizHighlight'
      ];

      const data = await chromeAsync.storage.get(keys);

      this._updateStatusIndicators(data);
      this._updateScrollControls(data);
      this._updateFarmControls(data);
      this._updateMineControls(data);
      this._updateCommentControls(data);
      this._updateQuizToggle(data);

      UIManager.setTheme(data.theme === 'dark');

      // Показать последнюю ошибку автокомментирования
      const lastError = data[CONFIG.STORAGE_KEYS.LAST_ERROR] || '';
      if (lastError) {
        UIManager.showError(lastError);
      }
    } catch (err) {
      console.error('Ошибка синхронизации:', err);
    }
  }

  /**
   * Обновляет индикаторы статуса
   */
  static _updateStatusIndicators(data) {
    const auto = Boolean(data.autoScroll);
    const farm = Boolean(data.farmActive);
    const mine = Boolean(data.mineActive);
    const quiz = Boolean(data.quizHighlight);
    
    const commentSettings = data[CONFIG.STORAGE_KEYS.AUTO_COMMENT] || {};
    const comment = Boolean(commentSettings.enabled);

    this._setIndicator('autoStatus', auto, 
      'Автопрокрутка включена', 'Автопрокрутка выключена');
    this._setIndicator('farmStatus', farm, 
      'Фарм активен', 'Фарм не активен');
    this._setIndicator('mineStatus', mine, 
      'Шахта активна', 'Шахта не активна');
    this._setIndicator('quizStatus', quiz, 
      'Квиз включен', 'Квиз выключен');
    this._setIndicator('commentStatus', comment, 
      'Комментирование включено', 'Комментирование выключено');
  }

  /**
   * Устанавливает состояние индикатора
   */
  static _setIndicator(id, isActive, activeTitle, inactiveTitle) {
    const indicator = $(`#${id}`);
    if (!indicator) return;
    
    indicator.className = `status-indicator ${isActive ? 'on' : 'off'}`;
    indicator.title = isActive ? activeTitle : inactiveTitle;
  }

  /**
   * Обновляет контролы прокрутки
   */
  static _updateScrollControls(data) {
    const autoSwitch = $('#autoScrollSwitch');
    if (autoSwitch) autoSwitch.checked = Boolean(data.autoScroll);
    
    const speed = clamp(
      safeParseInt(data.scrollSpeed, 50),
      CONFIG.LIMITS.MIN_SCROLL_SPEED,
      CONFIG.LIMITS.MAX_SCROLL_SPEED
    );
    
    const speedRange = $('#scrollSpeedRange');
    const speedLabel = $('#scrollSpeedLabel');
    const speedInput = $('#scrollSpeedInput');
    
    if (speedRange) speedRange.value = speed;
    if (speedLabel) speedLabel.textContent = speed;
    if (speedInput) speedInput.value = speed;
    
    const chapterLimit = safeParseInt(data.chapterLimit, 0);
    const limitInput = $('#chapterLimitInput');
    if (limitInput) limitInput.value = chapterLimit;
  }

  /**
   * Обновляет контролы фарма (ИЗМЕНЕНО)
   */
  static _updateFarmControls(data) {
    const giftDelay = safeParseInt(data.giftClickDelay, CONFIG.DEFAULTS.GIFT_DELAY);
    const giftRange = $('#giftDelayRange');
    const giftLabel = $('#giftDelayLabel');
    const giftInput = $('#giftDelayInput');
    
    if (giftRange) giftRange.value = giftDelay;
    if (giftLabel) giftLabel.textContent = giftDelay;
    if (giftInput) giftInput.value = giftDelay;

    const startBtn = $('#startFarm');
    if (startBtn) startBtn.disabled = Boolean(data.farmActive);
  }

  /**
   * Обновляет контролы шахты (ИЗМЕНЕНО)
   */
  static _updateMineControls(data) {
    const mineDelay = safeParseFloat(
      data.mineClickDelay, 
      CONFIG.DEFAULTS.MINE_DELAY * 1000
    ) / 1000;
    const mineRange = $('#mineDelayRange');
    const mineLabel = $('#mineDelayLabel');
    const mineInput = $('#mineDelayInput');
    
    if (mineRange) mineRange.value = mineDelay;
    if (mineLabel) mineLabel.textContent = mineDelay.toFixed(1);
    if (mineInput) mineInput.value = mineDelay.toFixed(1);

    const startBtn = $('#startMine');
    if (startBtn) startBtn.disabled = Boolean(data.mineActive);
  }

  /**
   * Обновляет контролы комментирования
   */
  static _updateCommentControls(data) {
    const settings = data[CONFIG.STORAGE_KEYS.AUTO_COMMENT] || { ...CONFIG.DEFAULTS };
    
    const intervalInput = $('#commentInterval');
    const totalInput = $('#commentTotal');
    const startBtn = $('#startComment');
    const stopBtn = $('#stopComment');
    
    if (intervalInput) intervalInput.value = settings.interval || CONFIG.DEFAULTS.INTERVAL;
    if (totalInput) totalInput.value = settings.totalComments || CONFIG.DEFAULTS.TOTAL_COMMENTS;
    
    const isEnabled = Boolean(settings.enabled);
    if (startBtn) startBtn.disabled = isEnabled;
    if (stopBtn) stopBtn.disabled = !isEnabled;
    
    CommentsManager.render(settings.commentsList || []);
  }

  /**
   * Обновляет переключатель квизов
   */
  static _updateQuizToggle(data) {
    const quizToggle = $('#quizHighlightToggle');
    if (quizToggle) {
      quizToggle.checked = Boolean(data.quizHighlight);
    }
  }
}

// ==================== ACTION МЕНЕДЖЕР ====================

class ActionManager {
  /**
   * Отправляет действие в background script
   */
  static async sendAction(action, params = {}) {
    try {
      const response = await chromeAsync.runtime.sendMessage({
        action,
        ...params
      });

      if (response?.success) {
        StatusManager.sync();
        return true;
      } else {
        UIManager.showError(response?.error || 'Ошибка');
        return false;
      }
    } catch (err) {
      UIManager.showError(err?.message || 'Ошибка соединения');
      return false;
    }
  }

  /**
   * Вычисляет необходимое количество глав
   */
  static computeNeededChapters(interval, totalComments) {
    return 2 + ((Math.max(1, totalComments) - 1) * Math.max(1, interval));
  }

  /**
   * Валидирует настройки перед запуском автопрокрутки
   */
  static async validateAutoScrollStart() {
    try {
      const data = await chromeAsync.storage.get([CONFIG.STORAGE_KEYS.AUTO_COMMENT]);
      const settings = data[CONFIG.STORAGE_KEYS.AUTO_COMMENT] || { ...CONFIG.DEFAULTS };
      const limitInput = $('#chapterLimitInput');
      const plannedChapters = safeParseInt(limitInput?.value, 0);

      if (!settings.enabled) return true;
      if (plannedChapters === 0) return true;

      const interval = Math.max(1, safeParseInt(settings.interval, 1));
      const total = Math.max(1, safeParseInt(settings.totalComments, 1));
      const needed = this.computeNeededChapters(interval, total);

      if (plannedChapters < needed) {
        UIManager.showError(
          `Для оставки ${total} комментариев с интервалом ${interval} ` +
          `требуется прочитать как минимум ${needed} глав. ` +
          `Увеличьте число глав или отключите комментирование.`
        );
        return false;
      }

      return true;
    } catch (err) {
      console.error('Ошибка валидации:', err);
      return true;
    }
  }
}

// ==================== ОБРАБОТЧИКИ СОБЫТИЙ ====================

class EventHandlers {
  /**
   * Инициализирует все обработчики
   */
  static init() {
    this._initTheme();
    this._initNavigation();
    this._initScroll();
    this._initFarm();
    this._initMine();
    this._initComments();
    this._initQuiz();
    this._initResize();
  }

  /**
   * Тема
   */
  static _initTheme() {
    const toggle = $('#themeToggle');
    if (!toggle) return;
    
    toggle.addEventListener('change', async (e) => {
      try {
        const isDark = e.target.checked;
        UIManager.setTheme(isDark);
        await chromeAsync.storage.set({ theme: isDark ? 'dark' : 'light' });
      } catch (err) {
        console.error('Ошибка смены темы:', err);
      }
    });
  }

  /**
   * Навигация по панелям
   */
  static _initNavigation() {
    const btnAuto = $('#btnAuto');
    const btnFarm = $('#btnFarm');
    const btnFuture = $('#btnFuture');
    const backAuto = $('#backAuto');
    const backFarm = $('#backFarm');
    const backComment = $('#backComment');
    
    if (btnAuto) btnAuto.onclick = () => UIManager.openPanel('#autoPanel');
    if (btnFarm) btnFarm.onclick = () => UIManager.openPanel('#farmPanel');
    if (btnFuture) btnFuture.onclick = () => UIManager.openPanel('#commentPanel');
    
    if (backAuto) backAuto.onclick = () => UIManager.closePanels();
    if (backFarm) backFarm.onclick = () => UIManager.closePanels();
    if (backComment) backComment.onclick = () => UIManager.closePanels();
  }

  /**
   * Автопрокрутка
   */
  static _initScroll() {
    const autoSwitch = $('#autoScrollSwitch');
    const speedRange = $('#scrollSpeedRange');
    const speedInput = $('#scrollSpeedInput');
    const limitInput = $('#chapterLimitInput');
    const resetBtn = $('#resetChapters');
    
    if (autoSwitch) {
      autoSwitch.onchange = async (e) => {
        try {
          const enabled = e.target.checked;

          if (enabled && !(await ActionManager.validateAutoScrollStart())) {
            autoSwitch.checked = false;
            return;
          }

          await chromeAsync.storage.set({ autoScroll: enabled });
          await ActionManager.sendAction(
            enabled ? 'startScrolling' : 'stopScrolling',
            { chapterLimit: safeParseInt(limitInput?.value, 0) }
          );
        } catch (err) {
          console.error('Ошибка переключения прокрутки:', err);
          UIManager.showError('Ошибка');
        }
      };
    }

    let speedDebounce;
    
    if (speedRange) {
      speedRange.addEventListener('input', (e) => {
        const value = clamp(
          safeParseInt(e.target.value, 50),
          CONFIG.LIMITS.MIN_SCROLL_SPEED,
          CONFIG.LIMITS.MAX_SCROLL_SPEED
        );
        
        const label = $('#scrollSpeedLabel');
        const input = $('#scrollSpeedInput');
        
        if (label) label.textContent = value;
        if (input) input.value = value;
        
        clearTimeout(speedDebounce);
        speedDebounce = setTimeout(async () => {
          try {
            await chromeAsync.storage.set({ scrollSpeed: value });
            await ActionManager.sendAction('updateSpeed', { speed: value });
          } catch (err) {
            console.error('Ошибка обновления скорости:', err);
          }
        }, CONFIG.TIMEOUTS.SPEED_DEBOUNCE);
      });
    }

    if (speedInput) {
      speedInput.addEventListener('change', async (e) => {
        try {
          const value = clamp(
            safeParseInt(e.target.value, 50),
            CONFIG.LIMITS.MIN_SCROLL_SPEED,
            CONFIG.LIMITS.MAX_SCROLL_SPEED
          );
          
          const range = $('#scrollSpeedRange');
          const label = $('#scrollSpeedLabel');
          
          e.target.value = value;
          if (range) range.value = value;
          if (label) label.textContent = value;
          
          await chromeAsync.storage.set({ scrollSpeed: value });
          await ActionManager.sendAction('updateSpeed', { speed: value });
          StatusManager.sync();
        } catch (err) {
          console.error('Ошибка обновления скорости:', err);
        }
      });

      speedInput.addEventListener('input', (e) => {
        const value = clamp(
          safeParseInt(e.target.value, 50),
          CONFIG.LIMITS.MIN_SCROLL_SPEED,
          CONFIG.LIMITS.MAX_SCROLL_SPEED
        );
        
        const range = $('#scrollSpeedRange');
        const label = $('#scrollSpeedLabel');
        
        if (range) range.value = value;
        if (label) label.textContent = value;
      });
    }

    if (limitInput) {
      limitInput.addEventListener('input', async (e) => {
        try {
          const value = clamp(
            safeParseInt(e.target.value, 0),
            CONFIG.LIMITS.MIN_CHAPTERS,
            CONFIG.LIMITS.MAX_CHAPTERS
          );
          e.target.value = value;
          await chromeAsync.storage.set({ chapterLimit: value });
          StatusManager.sync();
        } catch (err) {
          console.error('Ошибка обновления лимита:', err);
        }
      });
    }

    if (resetBtn) {
      resetBtn.onclick = async () => {
        try {
          if (limitInput) limitInput.value = 0;
          await chromeAsync.storage.set({
            chapterLimit: 0,
            chapterRead: 0,
            currentChapterUrl: null,
            autoScroll: false
          });
          await ActionManager.sendAction('stopScrolling');
        } catch (err) {
          console.error('Ошибка сброса:', err);
          UIManager.showError('Ошибка сброса');
        }
      };
    }
  }

  /**
   * Фарм ивента
   */
  static _initFarm() {
    const giftRange = $('#giftDelayRange');
    const giftInput = $('#giftDelayInput');
    const startBtn = $('#startFarm');
    const stopBtn = $('#stopFarm');
    
    let giftDebounce;
    
    if (giftRange) {
      giftRange.addEventListener('input', (e) => {
        const value = safeParseInt(e.target.value, CONFIG.DEFAULTS.GIFT_DELAY);
        const label = $('#giftDelayLabel');
        const input = $('#giftDelayInput');
        if (label) label.textContent = value;
        if (input) input.value = value;
        
        clearTimeout(giftDebounce);
        giftDebounce = setTimeout(async () => {
          try {
            await chromeAsync.storage.set({ giftClickDelay: value });
            StatusManager.sync();
          } catch (err) {
            console.error('Ошибка обновления задержки:', err);
          }
        }, CONFIG.TIMEOUTS.DELAY_DEBOUNCE);
      });
    }

    if (giftInput) {
      giftInput.addEventListener('change', async (e) => {
        try {
          const value = clamp(
            safeParseInt(e.target.value, CONFIG.DEFAULTS.GIFT_DELAY),
            CONFIG.LIMITS.MIN_GIFT_DELAY,
            CONFIG.LIMITS.MAX_GIFT_DELAY
          );
          
          const range = $('#giftDelayRange');
          const label = $('#giftDelayLabel');
          
          e.target.value = value;
          if (range) range.value = value;
          if (label) label.textContent = value;
          
          await chromeAsync.storage.set({ giftClickDelay: value });
          StatusManager.sync();
        } catch (err) {
          console.error('Ошибка обновления задержки:', err);
        }
      });
    }

    if (startBtn) {
      startBtn.onclick = async () => {
        try {
          await chromeAsync.storage.set({ farmActive: true });
          await ActionManager.sendAction('startFarm');
        } catch (err) {
          console.error('Ошибка запуска фарма:', err);
          UIManager.showError('Ошибка запуска');
        }
      };
    }

    if (stopBtn) {
      stopBtn.onclick = async () => {
        try {
          await ActionManager.sendAction('stopFarm');
          await chromeAsync.storage.set({ farmActive: false });
          StatusManager.sync();
        } catch (err) {
          console.error('Ошибка остановки фарма:', err);
          UIManager.showError('Ошибка остановки');
        }
      };
    }
  }

  /**
   * Фарм шахты
   */
  static _initMine() {
    const mineRange = $('#mineDelayRange');
    const mineInput = $('#mineDelayInput');
    const startBtn = $('#startMine');
    const stopBtn = $('#stopMine');
    
    let mineDebounce;
    
    if (mineRange) {
      mineRange.addEventListener('input', (e) => {
        const value = safeParseFloat(e.target.value, CONFIG.DEFAULTS.MINE_DELAY);
        const label = $('#mineDelayLabel');
        const input = $('#mineDelayInput');
        if (label) label.textContent = value.toFixed(1);
        if (input) input.value = value.toFixed(1);
        
        clearTimeout(mineDebounce);
        mineDebounce = setTimeout(async () => {
          try {
            await chromeAsync.storage.set({ mineClickDelay: Math.round(value * 1000) });
            StatusManager.sync();
          } catch (err) {
            console.error('Ошибка обновления скорости шахты:', err);
          }
        }, CONFIG.TIMEOUTS.DELAY_DEBOUNCE);
      });
    }

    if (mineInput) {
      mineInput.addEventListener('change', async (e) => {
        try {
          const value = clamp(
            safeParseFloat(e.target.value, CONFIG.DEFAULTS.MINE_DELAY),
            CONFIG.LIMITS.MIN_MINE_DELAY,
            CONFIG.LIMITS.MAX_MINE_DELAY
          );
          
          const range = $('#mineDelayRange');
          const label = $('#mineDelayLabel');
          
          e.target.value = value.toFixed(1);
          if (range) range.value = value.toFixed(1);
          if (label) label.textContent = value.toFixed(1);
          
          await chromeAsync.storage.set({ mineClickDelay: Math.round(value * 1000) });
          StatusManager.sync();
        } catch (err) {
          console.error('Ошибка обновления скорости шахты:', err);
        }
      });
    }

    if (startBtn) {
      startBtn.onclick = async () => {
        try {
          await chromeAsync.storage.set({ mineActive: true });
          await ActionManager.sendAction('startMine');
        } catch (err) {
          console.error('Ошибка запуска шахты:', err);
          UIManager.showError('Ошибка запуска');
        }
      };
    }

    if (stopBtn) {
      stopBtn.onclick = async () => {
        try {
          await ActionManager.sendAction('stopMine');
          await chromeAsync.storage.set({ mineActive: false });
          StatusManager.sync();
        } catch (err) {
          console.error('Ошибка остановки шахты:', err);
          UIManager.showError('Ошибка остановки');
        }
      };
    }
  }

  /**
   * Автокомментирование
   */
  static _initComments() {
    const startBtn = $('#startComment');
    const stopBtn = $('#stopComment');
    const addBtn = $('#addCommentBtn');
    const saveBtn = $('#saveCommentsBtn');
    const clearBtn = $('#clearCommentsBtn');
    const newText = $('#newCommentText');
    
    if (startBtn) {
      startBtn.onclick = () => CommentsManager.enable();
    }

    if (stopBtn) {
      stopBtn.onclick = () => CommentsManager.disable();
    }

    if (addBtn) {
      addBtn.onclick = () => {
        if (newText) CommentsManager.add(newText.value);
      };
    }

    if (newText) {
      newText.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          CommentsManager.add(newText.value);
        }
      });
    }

    if (saveBtn) {
      saveBtn.onclick = () => CommentsManager.save();
    }

    if (clearBtn) {
      clearBtn.onclick = () => CommentsManager.clear();
    }
  }

  /**
   * Квиз
   */
  static _initQuiz() {
    const quizToggle = $('#quizHighlightToggle');
    if (!quizToggle) return;

    quizToggle.addEventListener('change', async (e) => {
      try {
        const enabled = e.target.checked;
        
        await chromeAsync.storage.set({ quizHighlight: enabled });
        
        StatusManager.sync();
      } catch (err) {
        console.error('Ошибка переключения квиза:', err);
        UIManager.showError('Ошибка');
      }
    });
  }

  /**
   * Изменение размера окна
   */
  static _initResize() {
    document.body.addEventListener('transitionend', () => 
      UIManager.adjustPopupHeight()
    );

    document.querySelectorAll('.section').forEach(panel => {
      panel.addEventListener('transitionend', () => 
        UIManager.adjustPopupHeight()
      );
    });

    window.addEventListener('resize', () => 
      UIManager.adjustPopupHeight()
    );

    chrome.storage.onChanged.addListener(() => StatusManager.sync());
  }
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

document.addEventListener('DOMContentLoaded', () => {
  try {
    setTimeout(() => {
      EventHandlers.init();
      StatusManager.sync();
      UIManager.adjustPopupHeight();
    }, CONFIG.TIMEOUTS.INIT_DELAY);
  } catch (err) {
    console.error('Ошибка инициализации popup:', err);
  }
});
