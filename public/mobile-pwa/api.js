/* Real API adapter for the existing mobile user PWA. */
(() => {
  'use strict';

  const REMOTE_DEFAULT = 'http://8.133.215.80:8080/api/v1';
  const SESSION_KEY = 'tongpin.mobile.session';
  const API_KEY = 'tongpin.mobile.apiBase';
  const endpointMap = {
    session: 'POST /auth/user-session',
    profileGet: 'GET /me',
    profile: 'PATCH /me',
    consentsGet: 'GET /me/consents',
    consents: 'PATCH /me/consents',
    metrics: 'GET /me/device/metrics',
    trends: 'GET /me/device/trends',
    care: 'POST /me/device/care-responses',
    diaryList: 'GET /me/diary',
    diaryDraft: 'POST /me/diary/drafts',
    diaryEdit: 'PATCH /me/diary/{diary_id}',
    diaryConfirm: 'POST /me/diary/{diary_id}/confirm',
    diaryShare: 'POST /me/diary/{diary_id}/share',
    diaryRevoke: 'DELETE /me/diary/{diary_id}/share',
    chatList: 'GET /me/chat/messages',
    chat: 'POST /me/chat/messages',
    chatSuggestion: 'POST /ai/chat/suggestion',
    chatStream: 'POST /ai/chat/stream',
    need: 'POST /me/chat/needs',
    safety: 'POST /me/safety/escalate',
    exerciseStart: 'POST /me/exercises/{type}/start',
    exerciseUpdate: 'PATCH /me/exercises/{exercise_id}',
    exerciseComplete: 'POST /me/exercises/{exercise_id}/complete',
    questionnaireGet: 'GET /me/questionnaires/{type}',
    questionnaire: 'POST /me/questionnaires/{type}/responses',
    supportStatus: 'GET /me/support-cases/current',
    support: 'POST /me/support-cases',
    resources: 'GET /resources',
    events: 'GET /events',
    eventsPoll: 'GET /events/poll'
  };

  const sameServerBase = location.protocol + '//' + location.host + '/api/v1';
  const backendHosted = location.pathname.startsWith('/api/v1/docs/mobile-pwa');
  const defaultBase = backendHosted || location.hostname === '8.133.215.80' ? sameServerBase : REMOTE_DEFAULT;
  const queryBase = new URLSearchParams(location.search).get('api');
  let base = normalizeBase(queryBase || localStorage.getItem(API_KEY) || defaultBase);
  let session = restoreSession();

  function normalizeBase(value) {
    return String(value || REMOTE_DEFAULT).trim().replace(/\/+$/, '');
  }

  function restoreSession() {
    try {
      const stored = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || '';
      return stored ? JSON.parse(stored) : null;
    }
    catch { return null; }
  }

  function saveSession() {
    try {
      if (session) {
        const value = JSON.stringify(session);
        localStorage.setItem(SESSION_KEY, value);
        sessionStorage.removeItem(SESSION_KEY);
      } else {
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch (_) {}
  }

  function idempotencyKey() {
    return crypto.randomUUID ? crypto.randomUUID() : 'mobile-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function pathId(value) {
    return encodeURIComponent(String(value || ''));
  }

  class ApiError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.payload = payload;
    }
  }

  async function raw(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (session && session.token) headers.Authorization = 'Bearer ' + session.token;
    let body = options.body;
    if (body !== undefined && body !== null && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    if (!['GET', 'HEAD'].includes(method)) {
      headers['Idempotency-Key'] = headers['Idempotency-Key'] || idempotencyKey();
    }
    let response;
    try {
      response = await fetch(base + path, { method, headers, body });
    } catch (error) {
      throw new ApiError('无法连接同频服务，请检查网络后重试。', 0, { cause: error });
    }
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; }
    catch { payload = { raw: text }; }
    if (!response.ok) {
      const message = (payload && payload.error && payload.error.message) ||
        (payload && payload.message) || '请求失败（' + response.status + '）';
      if (response.status === 401) {
        session = null;
        saveSession();
      }
      throw new ApiError(message, response.status, payload);
    }
    return payload;
  }

  function streamEvents(onEvent, onError, afterEventId = 0) {
    const controller = new AbortController();
    const promise = (async () => {
      const headers = { Accept: 'text/event-stream' };
      if (session && session.token) headers.Authorization = 'Bearer ' + session.token;
      if (Number(afterEventId) > 0) headers['Last-Event-ID'] = String(afterEventId);
      const response = await fetch(base + '/events', { headers, signal: controller.signal });
      if (!response.ok || !response.body) throw new ApiError('事件流暂时不可用。', response.status, null);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventId = '';
      let dataLines = [];
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        lines.forEach((line) => {
          if (line.startsWith('id:')) eventId = line.slice(3).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          else if (!line && dataLines.length) {
            try { if (onEvent) onEvent(JSON.parse(dataLines.join('\n')), eventId); } catch (_) {}
            eventId = '';
            dataLines = [];
          }
        });
      }
    })();
    promise.catch((error) => {
      if (error && error.name !== 'AbortError' && onError) onError(error);
    });
    return { close: () => controller.abort(), promise };
  }

  async function streamChatSuggestion(payload = {}, handlers = {}) {
    const current = String(payload.text || payload.mainRequest || '').trim();
    const conversation = Array.isArray(payload.conversation)
      ? payload.conversation.slice(-12).map((item) => ({
        role: item.sender_role === 'assistant' || item.role === 'assistant' ? 'assistant' : 'user',
        content: String(item.content || '').slice(0, 1200)
      })).filter((item) => item.content)
      : [];
    const transcript = conversation.length > 1
      ? '当前用户消息：' + current + '\n\n最近对话：\n' + conversation.map((item) => (item.role === 'assistant' ? '小频：' : '用户：') + item.content).join('\n')
      : current;
    const headers = {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json'
    };
    if (session && session.token) headers.Authorization = 'Bearer ' + session.token;
    headers['Idempotency-Key'] = idempotencyKey();
    const response = await fetch(base + '/ai/chat/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        main_request: transcript || null,
        current_safety: payload.currentSafety || 'unknown',
        goal: payload.goal || 'empathetic_listening'
      })
    });
    if (!response.ok || !response.body) {
      const detail = await response.text();
      let parsed = null;
      try { parsed = detail ? JSON.parse(detail) : null; } catch (_) {}
      throw new ApiError((parsed && parsed.error && parsed.error.message) || '实时聊天暂时不可用。', response.status, parsed);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName = 'message';
    let dataLines = [];
    let finalResult = null;
    const dispatch = (name, data) => {
      let payloadData;
      try { payloadData = JSON.parse(data); } catch (_) { payloadData = { text: data }; }
      if (name === 'delta' && payloadData.text && handlers.onDelta) handlers.onDelta(String(payloadData.text));
      if (name === 'done') {
        finalResult = payloadData;
        if (handlers.onDone) handlers.onDone(payloadData);
      }
      if (name === 'error') throw new ApiError(payloadData.message || '实时聊天失败。', 502, payloadData);
    };
    const flush = () => {
      if (!dataLines.length) return;
      dispatch(eventName, dataLines.join('\n'));
      eventName = 'message';
      dataLines = [];
    };
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.forEach((line) => {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        else if (!line) flush();
      });
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      buffer.split(/\r?\n/).forEach((line) => {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        else if (!line) flush();
      });
    }
    flush();
    if (!finalResult) throw new ApiError('实时聊天没有返回完整结果。', 502, null);
    return finalResult;
  }

  async function createSession(payload = {}) {
    const result = await raw('/auth/user-session', {
      method: 'POST',
      body: {
        age_band: payload.ageBand || payload.age_band || '18+',
        district_id: payload.districtId || payload.district_id || 'district_shanghai_a',
        client_type: 'web',
        client_version: 'mobile-pwa-1.0'
      }
    });
    session = {
      token: result.token,
      refreshToken: result.refresh_token || '',
      user: result.user || null,
      expiresAt: result.expires_at || null
    };
    saveSession();
    return result;
  }

  async function bootstrap(payload = {}) {
    if (session && session.token) {
      const previousSession = session;
      try {
        const user = await raw('/me');
        session.user = user;
        saveSession();
        return { restored: true, user, token: session.token, expires_at: session.expiresAt };
      } catch (error) {
        if (error.status !== 401) throw error;
        session = previousSession;
        saveSession();
        if (previousSession.refreshToken) {
          try {
            const refreshed = await raw('/auth/refresh', {
              method: 'POST',
              body: { refresh_token: previousSession.refreshToken }
            });
            session = {
              ...previousSession,
              token: refreshed.token,
              refreshToken: refreshed.refresh_token || previousSession.refreshToken,
              expiresAt: refreshed.expires_at || null
            };
            saveSession();
            const user = await raw('/me');
            session.user = user;
            saveSession();
            return { restored: true, user, token: session.token, expires_at: session.expiresAt };
          } catch (refreshError) {
            if (refreshError.status !== 401) throw refreshError;
          }
        }
        session = null;
        saveSession();
      }
    }
    return createSession(payload);
  }

  const calls = {
    session: createSession,
    profileGet: () => raw('/me'),
    profile: (payload) => raw('/me', { method: 'PATCH', body: { display_name: payload.nickname || '', age_band: payload.ageBand || '18+' } }),
    consentsGet: () => raw('/me/consents'),
    consents: (payload) => raw('/me/consents', { method: 'PATCH', body: payload }),
    metrics: () => raw('/me/device/metrics'),
    trends: () => raw('/me/device/trends'),
    care: (payload) => raw('/me/device/care-responses', { method: 'POST', body: payload }),
    diaryList: () => raw('/me/diary'),
    diaryDraft: (payload) => raw('/me/diary/drafts', { method: 'POST', body: { feeling: payload.feeling || 'unclear', free_text: payload.text || '', source: 'user_input' } }),
    diaryEdit: (payload) => raw('/me/diary/' + pathId(payload.id), { method: 'PATCH', body: { content: payload.text || '' } }),
    diaryConfirm: (payload) => raw('/me/diary/' + pathId(payload.id) + '/confirm', { method: 'POST', body: { confirm: true } }),
    diaryShare: (payload) => raw('/me/diary/' + pathId(payload.id) + '/share', { method: 'POST', body: { scope: 'current_supporter' } }),
    diaryRevoke: (payload) => raw('/me/diary/' + pathId(payload.id) + '/share', { method: 'DELETE', body: {} }),
    chatList: () => raw('/me/chat/messages'),
    chat: (payload) => raw('/me/chat/messages', { method: 'POST', body: { content: payload.text || '' } }),
    chatSuggestion: (payload = {}) => {
      const current = String(payload.text || payload.mainRequest || '').trim();
      const conversation = Array.isArray(payload.conversation)
        ? payload.conversation.slice(-12).map((item) => ({
          role: item.sender_role === 'assistant' || item.role === 'assistant' ? 'assistant' : 'user',
          content: String(item.content || '').slice(0, 1200)
        })).filter((item) => item.content)
        : [];
      const transcript = conversation.length > 1
        ? '当前用户消息：' + current + '\n\n最近对话：\n' + conversation.map((item) => (item.role === 'assistant' ? '小频：' : '用户：') + item.content).join('\n')
        : current;
      return raw('/ai/chat/suggestion', {
        method: 'POST',
        body: {
          context_scope: ['chat_text', 'main_request'],
          main_request: transcript || null,
          current_safety: payload.currentSafety || 'unknown',
          goal: payload.goal || 'empathetic_listening',
          max_tokens: 200,
          stream: false
        }
      });
    },
    need: (payload) => raw('/me/chat/needs', { method: 'POST', body: { current_safety: payload.currentSafety || 'safe', main_need: payload.need, skip_questionnaire: true } }),
    safety: (payload) => raw('/me/safety/escalate', { method: 'POST', body: payload }),
    exerciseStart: (payload) => raw('/me/exercises/' + pathId(payload.type) + '/start', { method: 'POST', body: { safety_confirmed: true, willing_to_try: true } }),
    exerciseUpdate: (payload) => raw('/me/exercises/' + pathId(payload.exerciseId), { method: 'PATCH', body: { action: payload.action } }),
    exerciseComplete: (payload) => raw('/me/exercises/' + pathId(payload.exerciseId) + '/complete', { method: 'POST', body: { feeling_after: payload.feelingAfter || 'slightly_relieved', want_continue: false } }),
    questionnaireGet: (payload) => raw('/me/questionnaires/' + pathId(payload.type || 'phq2')),
    questionnaire: (payload) => raw('/me/questionnaires/' + pathId(payload.type || 'phq2') + '/responses', { method: 'POST', body: { answers: payload.answers || [] } }),
    supportStatus: () => raw('/me/support-cases/current'),
    support: (payload) => raw('/me/support-cases', { method: 'POST', body: payload }),
    resources: () => raw('/resources'),
    eventsPoll: (payload) => raw('/events/poll?after_event_id=' + encodeURIComponent(Number(payload && payload.afterEventId) || 0))
  };

  const api = {
    endpointMap,
    ApiError,
    get base() { return base; },
    get token() { return session && session.token ? session.token : ''; },
    get user() { return session && session.user ? session.user : null; },
    setBase(value) { base = normalizeBase(value); localStorage.setItem(API_KEY, base); },
    bootstrap,
    streamEvents,
    streamChatSuggestion,
    request(name, payload = {}) {
      const call = calls[name];
      if (!call) return Promise.reject(new ApiError('未实现的接口动作：' + name, 0));
      return call(payload);
    },
    clearSession() { session = null; saveSession(); }
  };

  window.HOLDU_API = api;
  window.HOLDU_DEMO_API = api;
})();
