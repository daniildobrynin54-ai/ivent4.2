// inject.js - УЛУЧШЕННЫЙ: Более ранний перехват для первого вопроса
'use strict';

(() => {
  try {
    window.__QH_PAGE_INSTALLED = true;
    
    // КРИТИЧНО: Отправляем сообщение о загрузке СРАЗУ
    window.postMessage({
      source: 'quiz-helper-inject',
      type: 'INJECT_LOADED'
    }, '*');
    
    console.log('[QH][inject] ✅ Маркер установлен, начинаем перехват');
  } catch (err) {
    console.error('[QH][inject] ❌ Ошибка установки маркера:', err);
  }

  const CONFIG = {
    DEBUG: true,
    MESSAGE_SOURCE: 'quiz-helper',
    MESSAGE_TYPE: 'CORRECT',
    
    PATTERNS: {
      TEXT: /(correct|right|true|верн).*(text|answer|ответ)|correct_text|correctanswer|correct_answer|right_text|answer_true_text|answer_text|правильн/i,
      TOKEN: /(token|^id$|answer.*id|answer_token|correct.*id)/i
    },
    
    CONTENT_TYPES: {
      JSON: 'application/json'
    },
    
    SOCKETIO_PREFIX: '42',
    
    MAX_RECURSION_DEPTH: 15
  };

  const logger = {
    debug: (...args) => {
      if (CONFIG.DEBUG) console.log('[QH][inject]', ...args);
    },
    warn: (...args) => {
      if (CONFIG.DEBUG) console.warn('[QH][inject]', ...args);
    },
    error: (...args) => {
      if (CONFIG.DEBUG) console.error('[QH][inject]', ...args);
    }
  };

  function postCorrectAnswer(info) {
    try {
      window.postMessage({
        source: CONFIG.MESSAGE_SOURCE,
        type: CONFIG.MESSAGE_TYPE,
        payload: info
      }, '*');
      
      logger.debug('📤 Отправлено сообщение:', info);
    } catch (err) {
      logger.error('❌ Ошибка отправки:', err);
    }
  }

  function extractCorrectInfo(data, depth = 0) {
    if (!data || typeof data !== 'object' || depth > CONFIG.MAX_RECURSION_DEPTH) {
      return null;
    }

    let correctText = null;
    let correctToken = null;
    const foundAnswers = [];
    const visited = new WeakSet();

    function walkObject(obj, path = '', currentDepth = 0) {
      if (!obj || typeof obj !== 'object') return;
      if (currentDepth > CONFIG.MAX_RECURSION_DEPTH) return;
      
      if (visited.has(obj)) return;
      visited.add(obj);

      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => {
          walkObject(item, `${path}[${idx}]`, currentDepth + 1);
        });
        return;
      }

      for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;
        
        if (CONFIG.PATTERNS.TEXT.test(key)) {
          if (typeof value === 'string' && value.trim() && !correctText) {
            correctText = value.trim();
            logger.debug(`📝 correct_text найден в ${currentPath}:`, value);
          }
        }

        if (CONFIG.PATTERNS.TOKEN.test(key)) {
          if ((typeof value === 'string' || typeof value === 'number')) {
            const tokenStr = String(value);
            if (tokenStr.length < 10 && !correctToken) {
              correctToken = tokenStr;
              logger.debug(`🔑 correct_token найден в ${currentPath}:`, value);
            }
          }
        }

        // КРИТИЧНО: Обработка массива answer
        if (key === 'answer' && Array.isArray(value)) {
          logger.debug('📦 Найден массив answer:', value);
          
          value.forEach((ans, idx) => {
            if (ans && typeof ans === 'object') {
              const text = ans.correct_text || ans.text || ans.answer_text;
              
              if (text && !correctText) {
                correctText = String(text).trim();
                logger.debug(`✓ answer[${idx}].correct_text:`, correctText);
              }
              
              if (ans.id && !correctToken) {
                const simpleId = String(ans.id);
                if (simpleId.length < 10) {
                  correctToken = simpleId;
                  logger.debug(`✓ answer[${idx}].id (простой):`, correctToken);
                }
              }
              
              foundAnswers.push(ans);
            }
          });
        }

        if (key === 'answers' && Array.isArray(value)) {
          value.forEach((ans, idx) => {
            if (ans && typeof ans === 'object') {
              const isCorrect = ans.correct || ans.is_correct || ans.right || ans.isRight;
              
              if (isCorrect) {
                if (ans.text && !correctText) {
                  correctText = String(ans.text).trim();
                  logger.debug(`✓ Правильный answer[${idx}].text:`, correctText);
                }
                if ((ans.id || ans.token) && !correctToken) {
                  correctToken = String(ans.id || ans.token);
                  logger.debug(`✓ Правильный answer[${idx}].id:`, correctToken);
                }
                
                foundAnswers.push(ans);
              }
            }
          });
        }

        if (typeof value === 'object' && value !== null) {
          walkObject(value, currentPath, currentDepth + 1);
        }
      }
    }

    try {
      walkObject(data);

      if (correctText || correctToken) {
        logger.debug('🎯 Результат извлечения:', { correctText, correctToken, foundAnswers });
        return { correctText, correctToken };
      }
    } catch (err) {
      logger.error('Ошибка при извлечении данных:', err);
    }

    return null;
  }

  // ==================== ПЕРЕХВАТ FETCH ====================
  
  (function interceptFetch() {
    const originalFetch = window.fetch;
    if (!originalFetch) {
      logger.warn('Fetch API недоступен');
      return;
    }

    window.fetch = async function(...args) {
      const url = args[0];
      logger.debug('🌐 Fetch:', url);

      try {
        const response = await originalFetch.apply(this, args);

        // КРИТИЧНО: Обрабатываем СРАЗУ, без проверок
        try {
          const clonedResponse = response.clone();
          
          clonedResponse.text().then(text => {
            if (!text) return;
            
            try {
              const data = JSON.parse(text);
              logger.debug('📦 Fetch Response:', data);
              
              if (data) {
                const info = extractCorrectInfo(data);
                if (info) {
                  logger.debug('✨ НАЙДЕН ПРАВИЛЬНЫЙ ОТВЕТ в Fetch!');
                  postCorrectAnswer(info);
                }
              }
            } catch (jsonErr) {
              // Не JSON - игнорируем
            }
          }).catch(() => {});
        } catch (analysisErr) {
          // Ошибка анализа - игнорируем
        }

        return response;
      } catch (err) {
        throw err;
      }
    };

    logger.debug('✅ Fetch перехвачен');
  })();

  // ==================== ПЕРЕХВАТ XHR ====================
  
  (function interceptXHR() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__interceptedUrl = url;
      this.__interceptedMethod = method;
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(...args) {
      logger.debug('🌐 XHR:', this.__interceptedMethod, this.__interceptedUrl);

      this.addEventListener('load', function handleLoad() {
        try {
          const responseText = this.responseText;
          
          if (!responseText) return;
          
          try {
            const data = JSON.parse(responseText);
            logger.debug('📦 XHR Response:', data);
            
            const info = extractCorrectInfo(data);
            if (info) {
              logger.debug('✨ НАЙДЕН ПРАВИЛЬНЫЙ ОТВЕТ в XHR!');
              postCorrectAnswer(info);
            }
          } catch (jsonErr) {
            // Не JSON - игнорируем
          }
        } catch (analysisErr) {
          // Ошибка анализа - игнорируем
        }
      });

      return originalSend.apply(this, args);
    };

    logger.debug('✅ XHR перехвачен');
  })();

  // ==================== ПЕРЕХВАТ WebSocket ====================
  
  (function interceptWebSocket() {
    const OriginalWebSocket = window.WebSocket;
    if (!OriginalWebSocket) {
      logger.warn('WebSocket недоступен');
      return;
    }

    try {
      class InterceptedWebSocket extends OriginalWebSocket {
        constructor(...args) {
          super(...args);
          logger.debug('🔌 WebSocket:', args[0]);

          this.addEventListener?.('message', (event) => {
            try {
              logger.debug('📨 WS message:', event.data);
              parseSocketMessage(event.data);
            } catch (err) {
              // Ошибка обработки - игнорируем
            }
          });
        }
      }

      Object.getOwnPropertyNames(OriginalWebSocket).forEach(name => {
        try {
          InterceptedWebSocket[name] = OriginalWebSocket[name];
        } catch (err) {}
      });

      window.WebSocket = InterceptedWebSocket;
      logger.debug('✅ WebSocket перехвачен');
    } catch (err) {
      logger.warn('WebSocket intercept error:', err);
    }

    function parseSocketMessage(data) {
      if (typeof data !== 'string') return;

      if (data.startsWith(CONFIG.SOCKETIO_PREFIX) && data.includes('[')) {
        try {
          const jsonPart = data.slice(data.indexOf('['));
          const array = JSON.parse(jsonPart);
          logger.debug('📨 Socket.io parsed:', array);

          for (const item of array) {
            if (item && typeof item === 'object') {
              const info = extractCorrectInfo(item);
              if (info) {
                logger.debug('✨ НАЙДЕН ПРАВИЛЬНЫЙ ОТВЕТ в Socket.io!');
                postCorrectAnswer(info);
              }
            }
          }
        } catch (err) {}
        return;
      }

      if (data.startsWith('{') || data.startsWith('[')) {
        try {
          const parsedData = JSON.parse(data);
          logger.debug('📨 WS JSON:', parsedData);
          
          const info = extractCorrectInfo(parsedData);
          if (info) {
            logger.debug('✨ НАЙДЕН ПРАВИЛЬНЫЙ ОТВЕТ в WS!');
            postCorrectAnswer(info);
          }
        } catch (err) {}
      }
    }
  })();

  logger.debug('🚀 inject.js полностью инициализирован');
  logger.debug('💡 Все перехватчики активны');
})();