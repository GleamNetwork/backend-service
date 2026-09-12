(() => {
  'use strict';

  const REMOTE_DEFAULT = 'http://8.133.215.80:8080/api/v1';
  const API_KEY = 'tongpin.portal.apiBase';
  const SESSION_KEY = 'tongpin.portal.session';
  const mascot = '../mobile-pwa/assets/xiaopin-wave.png';

  const state = {
    apiBase: getInitialApiBase(),
    apiStatus: 'checking',
    auth: null,
    role: 'user',
    route: 'home',
    user: { profile: null, consents: null, metrics: null, trends: null, diary: null, messages: null, support: null, resources: null, questionnaire: null },
    volunteer: { profile: null, cases: null, capacity: null, schedule: null, selectedCase: null, detail: null, detailRefreshTimer: null },
    manager: { overview: null, users: null, volunteers: null, schedules: null, transfers: null, professionals: null, audits: null, resources: null, ai: null },
    modal: null,
    toast: null,
    busy: false,
    error: '',
    exercise: { id: null, type: 'breathing', remaining: 60, running: false, paused: false, timer: null },
    diary: { id: null, content: '', feeling: 'calm', currentVersion: 1 },
    support: { kind: 'peer', diary: false, trends: false },
    loginRole: 'user',
    loginAccount: '',
    loginPassword: ''
  };

  class ApiError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.payload = payload;
    }
  }

  const api = {
    base: state.apiBase,
    token: '',
    setBase(value) {
      this.base = normalizeBase(value);
      state.apiBase = this.base;
    },
    setToken(value) { this.token = value || ''; },
    async request(route, options = {}) {
      const method = (options.method || 'GET').toUpperCase();
      const headers = { Accept: 'application/json', ...(options.headers || {}) };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      let body = options.body;
      if (body !== undefined && body !== null && typeof body !== 'string') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
      }
      if (!['GET', 'HEAD'].includes(method) && !headers['Idempotency-Key']) {
        headers['Idempotency-Key'] = crypto.randomUUID ? crypto.randomUUID() : `portal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
      let response;
      try {
        response = await fetch(`${this.base}${route}`, { method, headers, body });
      } catch (error) {
        throw new ApiError('无法连接 API。请检查地址、网络与 CORS 配置。', 0, { cause: error });
      }
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
      if (!response.ok) {
        const apiMessage = payload?.error?.message || payload?.message || `请求失败（${response.status}）`;
        if (response.status === 401 && state.auth) logout(false);
        throw new ApiError(apiMessage, response.status, payload);
      }
      return payload;
    }
  };

  function getInitialApiBase() {
    const queryBase = new URLSearchParams(location.search).get('api');
    return normalizeBase(queryBase || localStorage.getItem(API_KEY) || REMOTE_DEFAULT);
  }

  function normalizeBase(value) { return String(value || REMOTE_DEFAULT).trim().replace(/\/$/, ''); }
  function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
  function asArray(value) { return Array.isArray(value) ? value : []; }
  function formatTime(value) { if (!value) return '暂无时间'; const date = new Date(value); return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function shortId(value) { return value ? `${String(value).slice(0, 8)}…` : '未分配'; }
  function roleLabel(role) { return ({ user: '用户端', volunteer: '志愿者端', duty_manager: '值班负责人', professional_supervisor: '专业督导', ai_config_admin: 'AI 配置管理员' }[role] || '工作台'); }
  function statusLabel(value) { return ({ waiting_assignment: '等待接收', assigned: '已分配', in_progress: '陪伴中', awaiting_transfer: '等待交接', professional_takeover_requested: '等待专业接管', professional_taken_over: '专业已接管', completed: '已完成', cancelled: '已取消', created: '已创建', none: '暂无请求', available: '可接单', paused: '已暂停', resting: '休息中', checked_in: '已签到', active: '正常', offline: '离线' }[value] || value || '待确认'); }
  function statusClass(value) { if (['in_progress', 'professional_taken_over', 'completed', 'available', 'active', 'checked_in'].includes(value)) return 'good'; if (['waiting_assignment', 'awaiting_transfer', 'professional_takeover_requested', 'assigned', 'paused', 'resting'].includes(value)) return 'warn'; if (['immediate_safety', 'cancelled', 'suspended'].includes(value)) return 'alert'; return ''; }
  function jsonPreview(value) { try { return esc(JSON.stringify(value, null, 2)); } catch { return ''; } }
  function safeCall(promise) { return promise.catch((error) => ({ __error: error })); }

  function showToast(message, isError = false) {
    state.toast = { message, isError };
    render();
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { state.toast = null; render(); }, 3600);
  }

  async function run(task, successMessage) {
    if (state.busy) return null;
    state.busy = true; state.error = ''; render();
    try {
      const result = await task();
      if (successMessage) showToast(successMessage);
      return result;
    } catch (error) {
      state.error = error.message || '操作失败，请稍后再试。';
      showToast(state.error, true);
      return null;
    } finally {
      state.busy = false; render();
    }
  }

  function saveSession() { if (state.auth) sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.auth)); else sessionStorage.removeItem(SESSION_KEY); }
  function restoreSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
  function clearExerciseTimer() { if (state.exercise.timer) window.clearInterval(state.exercise.timer); state.exercise.timer = null; }
  function clearVolunteerDetailTimer() { if (state.volunteer.detailRefreshTimer) window.clearInterval(state.volunteer.detailRefreshTimer); state.volunteer.detailRefreshTimer = null; }

  async function checkHealth() {
    try { await api.request('/health'); state.apiStatus = 'online'; }
    catch { state.apiStatus = 'error'; }
    render();
  }

  async function loginUser(form) {
    const body = { age_band: form.age_band.value, district_id: form.district_id.value, client_type: 'web', client_version: 'portal-1.0' };
    const result = await api.request('/auth/user-session', { method: 'POST', body });
    setAuth({ token: result.token, refreshToken: result.refresh_token, role: 'user', actor: result.user });
    await loadUser();
  }

  async function loginStaff(form) {
    const route = state.loginRole === 'volunteer' ? '/auth/volunteer-login' : '/auth/manager-login';
    const result = await api.request(route, { method: 'POST', body: { account: form.account.value.trim(), password: form.password.value, client_type: 'web' } });
    setAuth({ token: result.token, refreshToken: result.refresh_token, role: result.role, actor: result });
    if (result.role === 'volunteer') await loadVolunteer(); else if (result.role === 'ai_config_admin') await loadAi(); else await loadManager();
  }

  function setAuth(auth) { state.auth = auth; api.setToken(auth.token); state.role = auth.role; state.route = auth.role === 'user' ? 'home' : auth.role === 'volunteer' ? 'overview' : auth.role === 'ai_config_admin' ? 'ai' : 'overview'; saveSession(); }

  async function logout(callApi = true) {
    clearExerciseTimer();
    clearVolunteerDetailTimer();
    if (callApi && state.auth?.token) { try { await api.request('/auth/logout', { method: 'POST', body: {} }); } catch {} }
    state.auth = null; state.role = 'user'; state.route = 'home'; state.error = ''; api.setToken(''); saveSession(); render();
  }

  async function loadUser() {
    const results = await Promise.all([
      safeCall(api.request('/me')),
      safeCall(api.request('/me/consents')),
      safeCall(api.request('/me/device/metrics')),
      safeCall(api.request('/me/device/trends')),
      safeCall(api.request('/me/diary')),
      safeCall(api.request('/me/chat/messages')),
      safeCall(api.request('/me/support-cases/current')),
      safeCall(api.request('/resources'))
    ]);
    [state.user.profile, state.user.consents, state.user.metrics, state.user.trends, state.user.diary, state.user.messages, state.user.support, state.user.resources] = results;
    state.user.profile = state.user.profile?.__error ? null : state.user.profile;
    if (state.user.profile) state.auth.actor = state.user.profile;
    state.apiStatus = results.some((item) => item?.__error?.status === 0) ? 'error' : 'online';
    render();
  }

  async function loadVolunteer() {
    const results = await Promise.all([
      safeCall(api.request('/volunteer/me')),
      safeCall(api.request('/volunteer/cases')),
      safeCall(api.request('/volunteer/capacity')),
      safeCall(api.request('/volunteer/schedule'))
    ]);
    [state.volunteer.profile, state.volunteer.cases, state.volunteer.capacity, state.volunteer.schedule] = results;
    if (state.volunteer.profile?.__error) state.volunteer.profile = null;
    state.apiStatus = 'online'; render();
  }

  async function loadManager() {
    const results = await Promise.all([
      safeCall(api.request('/manager/overview')),
      safeCall(api.request('/manager/users')),
      safeCall(api.request('/manager/volunteers')),
      safeCall(api.request('/manager/schedules')),
      safeCall(api.request('/manager/transfer-requests')),
      safeCall(api.request('/manager/professional-requests')),
      safeCall(api.request('/manager/audit-logs')),
      safeCall(api.request('/resources'))
    ]);
    [state.manager.overview, state.manager.users, state.manager.volunteers, state.manager.schedules, state.manager.transfers, state.manager.professionals, state.manager.audits, state.manager.resources] = results;
    state.apiStatus = 'online'; render();
  }

  async function loadAi() {
    const results = await Promise.all([
      safeCall(api.request('/ai/health')),
      safeCall(api.request('/manager/ai/config')),
      safeCall(api.request('/manager/ai/prompts')),
      safeCall(api.request('/manager/ai/skills')),
      safeCall(api.request('/manager/ai/tools')),
      safeCall(api.request('/manager/ai/audit-logs'))
    ]);
    state.manager.ai = { health: results[0], config: results[1], prompts: results[2], skills: results[3], tools: results[4], audits: results[5] };
    state.apiStatus = 'online'; render();
  }

  async function init() {
    api.setBase(state.apiBase);
    const restored = restoreSession();
    if (restored?.token) {
      state.auth = restored; state.role = restored.role; api.setToken(restored.token);
      try {
        if (state.role === 'user') await loadUser(); else if (state.role === 'volunteer') await loadVolunteer(); else if (state.role === 'ai_config_admin') await loadAi(); else await loadManager();
      } catch { await logout(false); }
    }
    render();
    checkHealth();
  }

  function render() {
    const root = document.querySelector('#app');
    if (!root) return;
    root.innerHTML = state.auth ? renderShell() : renderLogin();
    if (state.modal) renderModal();
    if (state.toast) {
      const toast = document.createElement('div'); toast.className = `toast${state.toast.isError ? ' error' : ''}`; toast.setAttribute('role', 'status'); toast.textContent = state.toast.message; root.append(toast);
    }
    if (state.busy) root.querySelectorAll('button, input, select, textarea').forEach((element) => { if (!element.closest('.modal')) element.disabled = true; });
  }

  function renderLogin() {
    return `<main class="login-shell">
      <section class="login-visual">
        <div><div class="eyebrow">同频 B2 联机工作台</div><h1>把每一次求助，接到真实的支持上。</h1><p>用户可以和小频聊天、记录、跟练并主动找人；志愿者与管理端在同一条服务链路里完成接收、陪伴、交接和人工复核。</p></div>
        <div class="login-art"><img src="${mascot}" alt="小频微笑着挥手"><div class="login-art-copy"><strong>数据边界清楚，责任接续明确</strong>联机模式调用远程 API。AI 只提供辅助建议，安全事件和专业接管保留人工确认。</div></div>
      </section>
      <section class="login-panel"><div class="login-card">
        <h2>进入工作台</h2><p>选择入口后登录。用户端使用匿名会话，志愿者和管理端使用后端演示账号。</p>
        ${state.error ? `<div class="error-box" role="alert">${esc(state.error)}</div>` : ''}
        <div class="role-cards" role="tablist" aria-label="选择入口">
          ${loginRoleCard('user', '用户端', '小频陪伴与主动求助')}
          ${loginRoleCard('volunteer', '志愿者端', '接单、陪伴与交接')}
          ${loginRoleCard('manager', '管理端', '辖区协调与复核')}
        </div>
        ${state.loginRole === 'user' ? renderUserLoginForm() : renderStaffLoginForm()}
        <div class="login-footer"><span>当前 API：${esc(state.apiBase)}</span><button class="button quiet small" type="button" data-action="open-api">切换 API 地址</button></div>
      </div></section>
    </main>`;
  }

  function loginRoleCard(role, title, description) { return `<button class="role-card${state.loginRole === role ? ' is-selected' : ''}" type="button" data-login-role="${role}" role="tab" aria-selected="${state.loginRole === role}"><strong>${title}</strong><small>${description}</small></button>`; }
  function renderUserLoginForm() { return `<form class="login-form" id="user-login-form"><div class="form-row"><div class="field"><label for="age-band">年龄段</label><select id="age-band" name="age_band"><option value="18+">18 岁及以上</option><option value="14-17">14 至 17 岁</option><option value="12-13">12 至 13 岁</option></select><small>未成年人分支不自动套用成人问卷，也不默认通知监护人。</small></div><div class="field"><label for="district-id">服务片区</label><select id="district-id" name="district_id"><option value="district_shanghai_a">上海片区 A</option><option value="district_shanghai_b">上海片区 B</option></select></div></div><button class="button" type="submit">创建匿名会话</button><div class="note-box"><strong>联机边界</strong>这是合成演示环境。页面不自动报警、外呼或通知家属，紧急情况请使用所在地现实支持。</div></form>`; }
  function renderStaffLoginForm() { return `<form class="login-form" id="staff-login-form"><div class="field"><label for="account">账号</label><input id="account" name="account" autocomplete="username" placeholder="例如 volunteer.lin" value="${esc(state.loginAccount)}" required></div><div class="field"><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" placeholder="输入后端演示账号密码" required></div><button class="button" type="submit">登录${state.loginRole === 'volunteer' ? '志愿者端' : '管理端'}</button><div class="note-box"><strong>需要什么权限</strong>管理端账号可以是值班负责人或专业督导。AI 配置管理员使用同一管理登录入口，但只开放 AI 配置页面。</div></form>`; }

  function renderShell() {
    return `<div class="app-shell"><header class="topbar"><button class="brand" type="button" data-action="go-home" aria-label="返回当前入口首页"><span class="brand-mark">频</span><span><strong>同频</strong><small>联机工作台 · ${roleLabel(state.role)}</small></span></button><div class="topbar-middle"><span class="connection ${state.apiStatus === 'online' ? 'is-online' : state.apiStatus === 'error' ? 'is-error' : ''}"><i aria-hidden="true"></i>${state.apiStatus === 'online' ? 'API 已连接' : state.apiStatus === 'error' ? 'API 连接异常' : '正在检查 API'}</span><span class="api-address">${esc(state.apiBase)}</span></div><div class="topbar-actions"><button class="button secondary small" type="button" data-action="open-api">API 设置</button><button class="button quiet small" type="button" data-action="logout">退出登录</button></div></header><div class="workspace"><aside class="sidebar">${renderRoleSwitcher()}${renderNav()}<div class="sidebar-note"><strong>安全与权限</strong>${state.role === 'user' ? '日记、设备趋势和人工求助分别授权；没有设备也能主动求助。' : '权限由后端角色、片区、个案归属和授权范围共同决定。页面隐藏按钮不能替代服务端鉴权。'}</div></aside><main class="main"><div class="content-wrap">${renderView()}</div></main></div></div>`;
  }

  function renderRoleSwitcher() {
    return `<div class="role-switcher" role="tablist" aria-label="演示入口"><p class="side-label">入口</p>${[['user','用户','U'],['volunteer','志愿者','V'],['manager','管理','M']].map(([role,title,symbol]) => `<button class="${(state.role === role || (role === 'manager' && ['duty_manager','professional_supervisor'].includes(state.role))) ? 'is-active' : ''}" type="button" data-switch-role="${role}" role="tab" aria-selected="${state.role === role}"><span class="role-symbol">${symbol}</span><span>${title}端</span></button>`).join('')}</div>`;
  }

  function renderNav() {
    const items = state.role === 'user' ? [['home','首页','陪伴'],['chat','聊天','聊天'],['diary','日记','日记'],['device','设备摘要','设备'],['exercise','舒缓跟练','跟练'],['questionnaire','可选自评','自评'],['support','求助与资源','支持']] : state.role === 'volunteer' ? [['overview','今日工作','工作'],['cases','我的个案','个案'],['handoff','交接与自检','交接']] : state.role === 'ai_config_admin' ? [['ai','AI 配置','AI']] : [['overview','辖区总览','总览'],['queue','升级与交接','队列'],['people','人员与排班','人员'],['audit','审计与资源','审计']];
    return `<nav class="nav-list" aria-label="工作台导航"><p class="side-label">工作区</p>${items.map(([route,title,short]) => `<button class="nav-button${state.route === route ? ' is-active' : ''}" type="button" data-route="${route}"><span>${title}</span>${route === 'queue' && pendingCount() ? `<span class="nav-count">${pendingCount()}</span>` : ''}</button>`).join('')}</nav>`;
  }

  function pendingCount() { return asArray(state.manager.transfers?.items).length + asArray(state.manager.professionals?.items).length; }

  function renderView() {
    if (state.role === 'user') return renderUserView();
    if (state.role === 'volunteer') return renderVolunteerView();
    if (state.role === 'ai_config_admin') return renderAiView();
    return renderManagerView();
  }

  function renderUserView() {
    if (state.route === 'chat') return renderUserChat();
    if (state.route === 'diary') return renderUserDiary();
    if (state.route === 'device') return renderUserDevice();
    if (state.route === 'support') return renderUserSupport();
    if (state.route === 'questionnaire') return renderUserQuestionnaire();
    if (state.route === 'exercise') return renderUserExercise();
    const profile = state.user.profile || state.auth.actor || {};
    const support = state.user.support || {};
    return `<section class="page-head"><div><h1>你好，${esc(profile.display_name || '匿名用户')}</h1><p>今天想先从哪一件小事开始？没有设备、暂时离线或不想回答，也都可以直接找人。</p></div><div class="page-actions"><button class="button secondary" type="button" data-route="support">即时求助</button><button class="button" type="button" data-route="chat">和小频聊聊</button></div></section>
      <section class="welcome"><div class="welcome-copy"><div class="eyebrow">小频陪伴</div><h2>先把此刻说清楚，再决定下一步。</h2><p>小频可以倾听、帮你记录和陪你做短练习。它不会替你诊断，也不会因为你没有回复而推断发生了什么。</p><div class="page-actions" style="margin-top:18px"><button class="button" type="button" data-route="chat">开始一段对话</button><button class="button secondary" type="button" data-route="diary">写下今天</button></div></div><div class="welcome-mascot"><img src="${mascot}" alt="小频微笑着挥手回应"></div></section>
      <section class="card flat"><div class="card-head"><div><h2>身体的小信号</h2><p>只显示你已授权的设备摘要，变化不是诊断。</p></div><button class="button quiet small" type="button" data-route="device">查看趋势</button></div>${renderMetricGrid()}</section>
      <section class="quick-actions" aria-label="快捷操作"><button class="quick-action" type="button" data-route="chat"><em>○</em><strong>聊天</strong><span>说一句就好，支持点选和文字。</span></button><button class="quick-action" type="button" data-route="diary"><em>□</em><strong>陪伴日记</strong><span>生成草稿，编辑确认后再决定分享。</span></button><button class="quick-action" type="button" data-route="device"><em>≈</em><strong>设备摘要</strong><span>查看授权范围和近 7 天趋势。</span></button><button class="quick-action" type="button" data-route="support"><em>+</em><strong>找现实中的人</strong><span>不要求先分享日记，也不要求设备数据。</span></button></section>
      <div class="grid two" style="margin-top:18px"><section class="card"><div class="card-head"><div><h2>当前对话</h2><p>${asArray(state.user.messages?.items).length ? `已记录 ${asArray(state.user.messages.items).length} 条消息` : '还没有消息'}</p></div><button class="button quiet small" type="button" data-route="chat">打开聊天</button></div>${renderMessagePreview()}</section><section class="card highlight"><div class="card-head"><div><h2>人工支持</h2><p>当前状态会从服务端同步。</p></div><span class="status ${statusClass(support.status || support.service_progress)}">${statusLabel(support.status || support.service_progress)}</span></div><p class="card-body-copy">发起请求后会明确区分“已发起、等待接收、具名接收和跟进完成”，收件不等于已经接管。</p><button class="button secondary" type="button" data-route="support">查看支持状态</button></section></div>`;
  }

  function renderMetricGrid() {
    const items = asArray(state.user.metrics?.items);
    if (!items.length) return `<div class="empty" style="margin-top:14px"><div><strong>暂无授权设备摘要</strong><span>可在“设备摘要”里开启授权；没有设备也不影响聊天和求助。</span></div></div>`;
    return `<div class="metric-grid" style="margin-top:14px">${items.slice(0, 4).map((item) => `<div class="metric"><small>${esc(item.metric_type || item.name || '指标')}</small><strong>${esc(item.value ?? item.display_value ?? '暂无')}</strong><span>${esc(item.unit || item.source || '来源待确认')}</span></div>`).join('')}</div>`;
  }

  function renderMessagePreview() {
    const items = asArray(state.user.messages?.items).slice(-3);
    if (!items.length) return `<div class="empty"><div><strong>还没有对话</strong><span>选择一个入口，开始表达当前的需要。</span></div></div>`;
    return `<div class="message-list">${items.map(messageHtml).join('')}</div>`;
  }
  function messageHtml(item) {
    const labels = { user: '用户', volunteer: '我（志愿者）', duty_manager: '值班负责人', professional_supervisor: '专业支持', assistant: '小频' };
    const sender = labels[item.sender_role] || item.sender_role || '小频';
    return `<div class="message${item.sender_role === 'volunteer' || item.sender_role === 'duty_manager' ? ' me' : ''}"><small>${esc(sender)} · ${formatTime(item.created_at)}</small>${esc(item.content || '')}</div>`;
  }

  function renderUserChat() {
    const items = asArray(state.user.messages?.items);
    return `<section class="page-head"><div><h1>和小频聊聊</h1><p>一次只处理一个需要。你可以点选、打字、跳过，或直接进入人工支持。</p></div><div class="page-actions"><button class="button danger" type="button" data-action="open-safety">即时安全入口</button><button class="button secondary" type="button" data-route="support">直接找人</button></div></section><div class="grid two"><section class="card"><div class="card-head"><div><h2>对话记录</h2><p>消息会按当前匿名会话保存。</p></div><span class="status">${items.length} 条</span></div><div class="message-list" aria-live="polite">${items.length ? items.map(messageHtml).join('') : `<div class="empty"><div><strong>我在这里</strong><span>此刻你更希望我怎么陪你？</span></div></div>`}</div><form class="composer" id="chat-form"><label class="sr-only" for="chat-content">发送消息</label><input id="chat-content" name="content" maxlength="500" placeholder="写下一句就好" required><button class="button" type="submit">发送</button></form><div class="choice-grid"><button class="choice" type="button" data-need="listen"><strong>有人听听</strong><small>我想说说最近发生的事</small></button><button class="choice" type="button" data-need="quiet"><strong>安静待一会</strong><small>先不回答，也可以</small></button><button class="choice" type="button" data-need="support"><strong>我想找人</strong><small>进入人工支持选项</small></button><button class="choice" type="button" data-need="exercise"><strong>做个小练习</strong><small>保持舒适，随时能停</small></button></div></section><aside class="card lilac"><div class="card-head"><div><h2>当前安全</h2><p>明确不安全时，不等待量表或设备授权。</p></div></div><p class="card-body-copy">如果你有伤害自己或他人的想法、已经受伤、服药过量，或无法保证此刻安全，请优先联系所在地急救服务或身边可信任的人。</p><button class="button danger" type="button" data-action="open-safety">我现在不安全 / 不确定</button><div class="note-box"><strong>小频的边界</strong>聊天中的建议不是专业判断，不会自动报警、外呼或通知家属。</div></aside></div>`;
  }

  function renderUserDiary() {
    const entries = asArray(state.user.diary?.items);
    const current = state.diary.id ? entries.find((item) => item.id === state.diary.id) : entries[0];
    if (current && !state.diary.id) { state.diary.id = current.id; state.diary.content = current.content || ''; state.diary.currentVersion = current.current_version || 1; }
    const entry = current || (state.diary.id ? state.diary : null);
    return `<section class="page-head"><div><h1>陪伴日记</h1><p>这是你的记录，不是隐形监测。生成草稿、编辑、确认和分享分别完成。</p></div><div class="page-actions"><button class="button secondary" type="button" data-route="chat">回到聊天</button><button class="button" type="button" data-action="diary-draft">生成草稿</button></div></section><div class="grid two"><section class="card butter"><div class="card-head"><div><h2>${entry ? '编辑当前草稿' : '留一句给今天'}</h2><p>内容由你确认后才会成为正式记录。</p></div>${entry ? `<span class="status ${statusClass(entry.status)}">${statusLabel(entry.status)}</span>` : ''}</div><div class="choice-grid"><button class="choice${state.diary.feeling === 'calm' ? ' is-selected' : ''}" type="button" data-feeling="calm"><strong>平静</strong><small>想把今天留在这里</small></button><button class="choice${state.diary.feeling === 'tired' ? ' is-selected' : ''}" type="button" data-feeling="tired"><strong>有点累</strong><small>先写下现在的状态</small></button><button class="choice${state.diary.feeling === 'low' ? ' is-selected' : ''}" type="button" data-feeling="low"><strong>低落</strong><small>不需要解释得很完整</small></button><button class="choice${state.diary.feeling === 'unclear' ? ' is-selected' : ''}" type="button" data-feeling="unclear"><strong>说不清</strong><small>模糊也可以被记录</small></button></div><form class="field-list" id="diary-form" style="margin-top:15px"><div class="field"><label for="diary-content">日记内容</label><textarea id="diary-content" name="content" placeholder="写下一句话，或者先点选上面的感受">${esc(entry?.content || state.diary.content || '')}</textarea><small>编辑已确认日记会撤销之前的确认和分享，需要再次确认。</small></div><div class="form-actions"><button class="button secondary" type="submit" name="diary_action" value="save">保存草稿</button><button class="button" type="submit" name="diary_action" value="confirm">确认日记</button><button class="button quiet" type="button" data-action="diary-draft">重新生成草稿</button></div></form></section><aside class="card"><div class="card-head"><div><h2>分享范围</h2><p>分享是单独授权，不和求助资格绑定。</p></div></div>${entry ? `<div class="note-box"><strong>当前版本 ${esc(entry.current_version || state.diary.currentVersion)}</strong>来源：本人表达。分享不会默认包含设备原始数据。</div><div class="form-actions"><button class="button" type="button" data-action="diary-share" ${entry.status !== 'confirmed' ? 'disabled' : ''}>分享给当前支持者</button><button class="button secondary" type="button" data-action="diary-revoke" ${entry.shared_scope ? '' : 'disabled'}>撤回分享</button></div>` : `<div class="empty"><div><strong>还没有日记</strong><span>先点选一种感受，或生成一份草稿。</span></div></div>`}<div class="note-box"><strong>权限提示</strong>未分享的日记不会因为管理权限更高而开放给普通管理者。</div></aside></div><section class="card flat" style="margin-top:18px"><div class="card-head"><div><h2>历史记录</h2><p>服务端返回的当前匿名会话日记。</p></div></div>${entries.length ? `<div class="table-wrap"><table><thead><tr><th>状态</th><th>内容</th><th>版本</th><th>更新时间</th><th>分享</th></tr></thead><tbody>${entries.map((item) => `<tr><td><span class="status ${statusClass(item.status)}">${statusLabel(item.status)}</span></td><td>${esc(item.content || '')}</td><td class="mono">${esc(item.current_version || 1)}</td><td>${formatTime(item.updated_at)}</td><td>${item.shared_scope ? esc(item.shared_scope) : '未分享'}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty"><div><strong>暂无历史记录</strong><span>草稿确认后会显示在这里。</span></div></div>`}</section>`;
  }

  function renderUserDevice() {
    const consents = state.user.consents?.consents || state.user.consents || {};
    const trendItems = asArray(state.user.trends?.items);
    const items = asArray(state.user.metrics?.items);
    return `<section class="page-head"><div><h1>设备摘要</h1><p>设备是可选数据入口。缺失、未佩戴或未授权都不等于发生了什么。</p></div><button class="button secondary" type="button" data-action="refresh-user">刷新数据</button></section><section class="card sage"><div class="card-head"><div><h2>授权由你决定</h2><p>只读取服务端提供的摘要，不把连续原始数据展示给其他角色。</p></div><span class="status ${consents.device_metrics ? 'good' : ''}">${consents.device_metrics ? '设备摘要已授权' : '未授权'}</span></div><div class="form-actions"><button class="button" type="button" data-action="toggle-consent" data-consent="device_metrics">${consents.device_metrics ? '撤回设备摘要授权' : '开启设备摘要授权'}</button><button class="button secondary" type="button" data-action="toggle-consent" data-consent="trend_summary_share">${consents.trend_summary_share ? '撤回趋势分享' : '允许分享趋势摘要'}</button></div></section><section class="card" style="margin-top:18px"><div class="card-head"><div><h2>当前指标</h2><p>来源与时间以服务端返回为准。</p></div></div>${items.length ? `<div class="metric-grid" style="margin-top:14px">${items.map((item) => `<div class="metric"><small>${esc(item.metric_type || item.name || '设备指标')}</small><strong>${esc(item.value ?? item.display_value ?? '暂无')}</strong><span>${esc(item.unit || item.source || '待确认')} · ${formatTime(item.recorded_at || item.created_at)}</span></div>`).join('')}</div>` : `<div class="empty" style="margin-top:14px"><div><strong>当前没有设备指标</strong><span>${consents.device_metrics ? '服务端暂未返回摘要，稍后可刷新。' : '开启授权后再查看；没有设备也不影响求助。'}</span></div></div>`}</section><section class="card" style="margin-top:18px"><div class="card-head"><div><h2>近 7 天趋势</h2><p>仅在有授权且服务端有数据时显示。</p></div></div>${trendItems.length ? renderTrendChart(trendItems) : `<div class="empty" style="margin-top:14px"><div><strong>暂无趋势数据</strong><span>不把缺失当作正常，也不把变化解释为诊断结论。</span></div></div>`}</section>`;
  }

  function renderTrendChart(items) { return `<div class="bar-chart">${items.slice(-7).map((item, index) => { const number = Number(item.value ?? item.score ?? 0); const height = Math.max(8, Math.min(118, Math.abs(number) || 8)); return `<div class="bar-col"><b>${esc(item.value ?? item.score ?? '')}</b><i style="height:${height}px"></i><span>${esc(item.label || item.date || `第 ${index + 1} 天`)}</span></div>`; }).join('')}</div>`; }

  function renderUserSupport() {
    const support = state.user.support || {};
    const resources = asArray(state.user.resources?.items);
    return `<section class="page-head"><div><h1>求助与现实资源</h1><p>你可以直接发起人工支持，也可以先查看所在地的现实渠道。请求已发起不代表已经有人接管。</p></div><button class="button danger" type="button" data-action="open-safety">即时安全入口</button></section><div class="grid two"><section class="card highlight"><div class="card-head"><div><h2>当前支持状态</h2><p>服务端状态：${esc(support.service_progress || support.status || 'no_request')}</p></div><span class="status ${statusClass(support.service_progress || support.status)}">${statusLabel(support.service_progress || support.status)}</span></div>${support.status && support.status !== 'none' ? `<div class="progress"><span class="done">已发起</span><span class="current">${support.service_progress === 'in_progress' ? '具名接收' : '等待接收'}</span><span>跟进完成</span></div>` : `<div class="empty" style="margin-top:14px"><div><strong>还没有人工支持请求</strong><span>不要求先分享日记或设备摘要。</span></div></div>`}<div class="form-actions"><button class="button" type="button" data-action="request-support" ${support.status && support.status !== 'none' ? 'disabled' : ''}>发起人工支持请求</button><button class="button secondary" type="button" data-action="open-safety">我现在不安全 / 不确定</button></div></section><section class="card lilac"><div class="card-head"><div><h2>本次分享什么</h2><p>当前需要必需，其它内容按需选择。</p></div></div><div class="choice-grid"><button class="choice${state.support.kind === 'peer' ? ' is-selected' : ''}" type="button" data-support-kind="peer"><strong>有人听听</strong><small>文字陪伴请求</small></button><button class="choice${state.support.kind === 'professional' ? ' is-selected' : ''}" type="button" data-support-kind="professional"><strong>专业帮助</strong><small>进入人工专业路径</small></button></div><div class="field-list" style="margin-top:15px"><label class="choice" style="display:flex;align-items:center;gap:10px"><input type="checkbox" data-share-toggle="diary" ${state.support.diary ? 'checked' : ''} style="width:auto"><span><strong>分享日记摘要</strong><small>不会默认带上日记正文</small></span></label><label class="choice" style="display:flex;align-items:center;gap:10px"><input type="checkbox" data-share-toggle="trends" ${state.support.trends ? 'checked' : ''} style="width:auto"><span><strong>分享设备趋势摘要</strong><small>不会默认分享原始连续数据</small></span></label></div></section></div><section class="card" style="margin-top:18px"><div class="card-head"><div><h2>现实支持渠道</h2><p>请按所在地、服务时间和当下情况自行核验。</p></div></div>${resources.length ? `<div class="resource-list">${resources.map(resourceHtml).join('')}</div>` : `<div class="empty" style="margin-top:14px"><div><strong>暂无已核验资源</strong><span>资源库暂时不可用时，也请使用所在地现实支持。</span></div></div>`}</section>`;
  }

  function renderUserQuestionnaire() {
    const questionnaire = state.user.questionnaire;
    const items = asArray(questionnaire?.items);
    return `<section class="page-head"><div><h1>可选状态记录</h1><p>可以跳过，不生成诊断或风险等级。当前量表内容由服务端返回，适用年龄和版本需经过专业核验。</p></div><div class="page-actions"><button class="button danger" type="button" data-action="open-safety">即时安全入口</button><button class="button secondary" type="button" data-route="chat">回到聊天</button></div></section><section class="card butter">${questionnaire ? `<div class="card-head"><div><h2>${esc(questionnaire.title || '可选状态记录')}</h2><p>${esc(questionnaire.notice || '这份记录只用于表达感受。')}</p></div><span class="status warn">可跳过</span></div><form id="questionnaire-form" class="field-list" style="margin-top:18px">${items.map((item) => `<fieldset class="field"><legend>${esc(item.text || item.title || item.id || '当前感受')}</legend><div class="choice-grid"><button class="choice" type="button" data-question-answer="${esc(item.id || 'today')}" data-answer-value="not_now"><strong>暂时不回答</strong><small>不填默认答案</small></button><button class="choice" type="button" data-question-answer="${esc(item.id || 'today')}" data-answer-value="some"><strong>有一些影响</strong><small>记录为本人表达</small></button><button class="choice" type="button" data-question-answer="${esc(item.id || 'today')}" data-answer-value="a_lot"><strong>影响比较明显</strong><small>仍不转换为诊断结论</small></button></div></fieldset>`).join('')}<div class="form-actions"><button class="button" type="submit">记录这次回答</button><button class="button secondary" type="button" data-route="chat">跳过，继续聊聊</button></div></form>` : `<div class="empty"><div><strong>还没有加载状态记录</strong><span>点击下方按钮从服务端获取当前可选工具。</span><div class="form-actions" style="justify-content:center"><button class="button" type="button" data-action="load-questionnaire">加载可选记录</button></div></div></div>`}</section><section class="card lilac" style="margin-top:18px"><div class="card-head"><div><h2>安全旁路</h2><p>如果此刻不安全，不要等待自评完成。</p></div></div><p class="card-body-copy">你可以直接进入即时安全支持。量表回答与日常感受记录分开保存，普通回答不会自动改变服务分层。</p></section>`;
  }

  function renderUserExercise() {
    const exercise = state.exercise;
    const isRunning = exercise.running;
    return `<section class="page-head"><div><h1>舒缓跟练</h1><p>保持舒适，随时可以暂停、跳过或停止。练后感受不会自动写入日记。</p></div><div class="page-actions"><button class="button danger" type="button" data-action="open-safety">如果更不舒服，先求助</button><button class="button secondary" type="button" data-route="home">返回陪伴</button></div></section><div class="grid two"><section class="card butter"><div class="card-head"><div><h2>${isRunning ? '跟着自己的节奏' : '选择一个入口'}</h2><p>${isRunning ? '页面进入后台会自动暂停。' : '不要求用力深呼吸、闭眼或完成全部步骤。'}</p></div>${isRunning ? `<span class="status warn">${exercise.paused ? '已暂停' : '进行中'}</span>` : ''}</div>${isRunning ? `<div class="welcome-copy" style="min-height:220px;margin-top:16px;align-items:center;text-align:center"><div class="mono" style="font-size:58px;letter-spacing:-.09em" id="exercise-timer">${exercise.remaining}</div><strong>${exercise.paused ? '准备好再继续' : '保持舒适，不必追求完成'}</strong><div class="form-actions" style="justify-content:center"><button class="button secondary" type="button" data-action="toggle-exercise">${exercise.paused ? '继续' : '暂停'}</button><button class="button danger" type="button" data-action="stop-exercise">停止</button><button class="button" type="button" data-action="complete-exercise">完成并记录感受</button></div></div>` : `<div class="choice-grid" style="margin-top:18px"><button class="choice${exercise.type === 'breathing' ? ' is-selected' : ''}" type="button" data-exercise-type="breathing"><strong>轻柔呼吸</strong><small>自然呼吸，不憋气</small></button><button class="choice${exercise.type === 'grounding' ? ' is-selected' : ''}" type="button" data-exercise-type="grounding"><strong>看看周围</strong><small>找找眼前的颜色和形状</small></button><button class="choice${exercise.type === 'relax' ? ' is-selected' : ''}" type="button" data-exercise-type="relax"><strong>放松肩手</strong><small>只做不痛、不过度的幅度</small></button></div><label class="choice" style="display:flex;align-items:center;gap:10px;margin-top:15px"><input id="exercise-safe" type="checkbox" style="width:auto"><span><strong>我当前安全且愿意尝试</strong><small>如果有新出现或加重的急症，请先寻求现实医疗支持。</small></span></label><div class="form-actions"><button class="button" type="button" data-action="start-exercise">开始这一小段</button><button class="button secondary" type="button" data-route="chat">先和小频聊聊</button></div>`}</section><aside class="card sage"><div class="card-head"><div><h2>练习边界</h2><p>演示节奏不是疗程或效果承诺。</p></div></div><div class="note-box"><strong>可以随时停</strong>不舒服、头晕、疼痛、呼吸困难或担心身体情况时，停止练习并联系现实中的医疗支持。</div><div class="note-box"><strong>不会暗中记录</strong>练后感受需要你主动选择，默认不写入日记、不分享设备数据。</div></aside></div>`;
  }
  function resourceHtml(item) { return `<article class="resource-item"><strong>${esc(item.name || '现实支持资源')} <span class="status ${item.status === 'verified' ? 'good' : 'warn'}">${item.status === 'verified' ? '已核验' : '待核验'}</span></strong><small>${esc(item.category || '')} · ${esc(item.region || '所在地待确认')} · ${esc(item.contact?.phone || item.phone || '请查看官方渠道')}</small><div class="form-actions"><button class="button secondary small" type="button" data-action="resource-note" data-resource="${esc(item.name || '')}">查看提示</button></div></article>`; }

  function renderVolunteerView() {
    if (state.route === 'cases') return renderVolunteerCases();
    if (state.route === 'handoff') return renderVolunteerHandoff();
    const profile = state.volunteer.profile || {};
    const capacity = state.volunteer.capacity || {};
    const cases = asArray(state.volunteer.cases?.items);
    return `<section class="page-head"><div><h1>今日工作，${esc(profile.display_name || '志愿者')}</h1><p>先看当前责任、剩余容量和待接收请求。即时安全请求不能由普通志愿者单独承接。</p></div><div class="page-actions"><button class="button secondary" type="button" data-route="handoff">交接与自检</button><button class="button" type="button" data-action="refresh-volunteer">刷新工作台</button></div></section><div class="grid stats"><div class="card"><div class="eyebrow">今日接待</div><strong class="mono" style="font-size:31px">${esc(capacity.current_daily_count ?? 0)} / ${esc(capacity.daily_limit ?? profile.daily_limit ?? '-')}</strong><p class="muted" style="font-size:12px">按用户去重，不因结束服务返还额度</p></div><div class="card"><div class="eyebrow">同时服务</div><strong class="mono" style="font-size:31px">${esc(capacity.current_concurrent_count ?? 0)} / ${esc(capacity.concurrent_limit ?? profile.concurrent_limit ?? '-')}</strong><p class="muted" style="font-size:12px">结束服务后释放同时名额</p></div><div class="card sage"><div class="eyebrow">当前状态</div><strong style="font-size:20px">${statusLabel(profile.status || 'active')}</strong><p class="muted" style="font-size:12px">${profile.self_check_passed_at ? `最近自检 ${formatTime(profile.self_check_passed_at)}` : '尚未记录最近自检'}</p></div><div class="card butter"><div class="eyebrow">片区</div><strong style="font-size:20px">${asArray(profile.district_ids).length ? asArray(profile.district_ids).map(esc).join('、') : '待确认'}</strong><p class="muted" style="font-size:12px">按授权片区查看必要摘要</p></div></div><div class="grid two" style="margin-top:18px"><section class="card"><div class="card-head"><div><h2>待处理个案</h2><p>只显示本人可见的必要摘要。</p></div><button class="button quiet small" type="button" data-route="cases">查看全部</button></div>${cases.length ? `<div class="queue-list">${cases.map(volunteerCaseHtml).join('')}</div>` : `<div class="empty" style="margin-top:14px"><div><strong>当前没有待处理个案</strong><span>没有主动请求时，不自动联系陌生人。</span></div></div>`}</section><section class="card lilac"><div class="card-head"><div><h2>排班</h2><p>服务时间和角色由服务端返回。</p></div></div>${renderSchedule(state.volunteer.schedule)}</section></div>`;
  }
  function volunteerCaseHtml(item) { return `<article class="queue-item"><div><strong>${shortId(item.id)} <span class="status ${statusClass(item.status)}">${statusLabel(item.status)}</span></strong><small>需要层级：${esc(item.support_need_level || '待确认')} · 路径 ${esc(item.response_path || '待确认')}<br>创建于 ${formatTime(item.created_at)} · 授权：${asArray(item.consent_scope).map(esc).join('、') || '无'}</small></div><div class="item-actions">${item.status === 'waiting_assignment' ? `<button class="button small" type="button" data-action="accept-case" data-case-id="${esc(item.id)}">承接</button>` : ''}<button class="button secondary small" type="button" data-action="select-case" data-case-id="${esc(item.id)}">查看</button></div></article>`; }
  function renderSchedule(payload) { const items = asArray(payload?.items); return items.length ? `<div class="timeline-list">${items.map((item) => `<div class="timeline-item"><strong>${esc(item.start_at || '')} - ${esc(item.end_at || '')}</strong><small>${esc(item.role_in_shift || '值班')} · ${item.confirmed ? '已确认' : '待确认'}</small></div>`).join('')}</div>` : `<div class="empty"><div><strong>暂无排班记录</strong><span>当前账号未返回排班；不影响查看个案和自检入口。</span></div></div>`; }

  function renderVolunteerCases() {
    const cases = asArray(state.volunteer.cases?.items);
    const detail = state.volunteer.detail;
    return `<section class="page-head"><div><h1>我的个案</h1><p>接单、查看获授权摘要、发送文字陪伴和结束服务都要经过服务端状态校验。</p></div><button class="button secondary" type="button" data-route="overview">回到今日工作</button></section><div class="grid two"><section class="card"><div class="card-head"><div><h2>个案列表</h2><p>${cases.length} 条服务端记录</p></div></div>${cases.length ? `<div class="queue-list">${cases.map(volunteerCaseHtml).join('')}</div>` : `<div class="empty" style="margin-top:14px"><div><strong>暂无个案</strong><span>等待用户主动请求或管理端分配。</span></div></div>`}</section><section class="card">${detail ? renderVolunteerDetail(detail) : `<div class="empty"><div><strong>选择一个个案</strong><span>普通志愿者只能查看本人承接或可分配状态下的必要摘要。</span></div></div>`}</section></div>`;
  }
  function renderVolunteerDetail(detail) {
    const item = detail.case || detail;
    const messages = asArray(detail.messages?.items || detail.chat?.items);
    const active = ['in_progress', 'awaiting_transfer', 'professional_takeover_requested', 'professional_taken_over'].includes(item.status);
    const composer = active
      ? `<form class="composer" id="volunteer-message-form"><label class="sr-only" for="volunteer-message">陪伴消息</label><input id="volunteer-message" name="content" maxlength="500" placeholder="输入消息，用户会在同一会话收到" required><button class="button" type="submit">发送</button></form>`
      : `<div class="note-box"><strong>本次陪伴已结束</strong>该案件只读保留，不能继续发送消息或重复结束。</div>`;
    const actions = active
      ? `<div class="form-actions"><button class="button secondary" type="button" data-action="professional-request" data-case-id="${esc(item.id)}">请求专业支持</button><button class="button secondary" type="button" data-action="transfer-request" data-case-id="${esc(item.id)}">发起普通交接</button><button class="button danger" type="button" data-action="close-case" data-case-id="${esc(item.id)}">结束本次陪伴</button></div>`
      : '';
    return `<div class="card-head"><div><div class="eyebrow">个案详情</div><h2>${shortId(item.id)}</h2><p>${esc(item.service_progress || item.status || '待确认')} · ${esc(item.request_type || '文字陪伴')}</p></div><span class="status ${statusClass(item.status)}">${statusLabel(item.status)}</span></div><div class="note-box"><strong>只显示必要范围</strong>授权：${asArray(item.consent_scope).map(esc).join('、') || '未返回'}。安全和专业接管信息以人工复核为准。</div><div class="message-list" style="max-height:260px">${messages.length ? messages.map(messageHtml).join('') : `<div class="empty"><div><strong>暂无聊天消息</strong><span>${active ? '可以发送第一条文字陪伴。' : '本次陪伴没有聊天消息。'}</span></div></div>`}</div>${composer}${actions}`;
  }

  function renderVolunteerHandoff() { const profile = state.volunteer.profile || {}; return `<section class="page-head"><div><h1>交接与自检</h1><p>休息会停止新接单，但不会隐藏已有责任。重新接单必须由本人提交自检。</p></div><button class="button secondary" type="button" data-route="overview">回到今日工作</button></section><div class="grid two"><section class="card butter"><div class="card-head"><div><h2>申请休息</h2><p>请明确是否停止新的普通请求。</p></div></div><form id="rest-form" class="field-list" style="margin-top:15px"><div class="field"><label for="rest-reason">原因</label><select id="rest-reason" name="reason"><option value="need_rest">需要休息</option><option value="private_environment">暂时没有私密环境</option><option value="capacity">当前容量已满</option></select></div><label class="choice" style="display:flex;align-items:center;gap:10px"><input type="checkbox" name="stop_new_cases" checked style="width:auto"><span><strong>停止新的普通接单</strong><small>已有服务仍需保持责任。</small></span></label><button class="button" type="submit">提交休息申请</button></form></section><section class="card sage"><div class="card-head"><div><h2>恢复接单自检</h2><p>管理端不能代替本人勾选。</p></div><span class="status ${profile.self_check_passed_at ? 'good' : 'warn'}">${profile.self_check_passed_at ? '已自检' : '待自检'}</span></div><form id="self-check-form" class="field-list" style="margin-top:15px"><label class="choice" style="display:flex;align-items:center;gap:10px"><input type="checkbox" name="fit_to_continue" style="width:auto" required><span><strong>我当前适合继续服务</strong><small>由本人确认，不是系统自动推断。</small></span></label><label class="choice" style="display:flex;align-items:center;gap:10px"><input type="checkbox" name="private_environment" style="width:auto" required><span><strong>我有适合服务的私密环境</strong><small>如果不满足，可继续休息或请求交接。</small></span></label><div class="field"><label for="available-until">可服务到</label><input id="available-until" name="available_until" type="time" value="20:00"></div><button class="button" type="submit">提交自检，恢复接单</button></form></section></div><section class="card" style="margin-top:18px"><div class="card-head"><div><h2>为什么需要交接</h2><p>普通交接、专业接管和管理收件不是同一个状态。</p></div></div><div class="grid three" style="margin-top:14px"><div class="note-box"><strong>普通交接</strong>由当前承接者发起，接班人确认后才改变责任关系。</div><div class="note-box"><strong>专业求助</strong>请求专业人员接管，不等于已完成专业评估。</div><div class="note-box"><strong>管理收件</strong>只表示已收到调配请求，不表示新增人员可接单。</div></div></section>`; }

  function renderManagerView() { if (state.route === 'queue') return renderManagerQueue(); if (state.route === 'people') return renderManagerPeople(); if (state.route === 'audit') return renderManagerAudit(); const overview = state.manager.overview || {}; return `<section class="page-head"><div><h1>辖区总览</h1><p>管理端只看授权辖区的聚合和必要摘要，不默认开放聊天全文、精确位置或未分享日记。</p></div><div class="page-actions"><button class="button secondary" type="button" data-route="queue">查看队列${pendingCount() ? ` (${pendingCount()})` : ''}</button><button class="button" type="button" data-action="refresh-manager">刷新总览</button></div></section><div class="grid stats"><div class="card"><div class="eyebrow">在服务人数</div><strong class="mono" style="font-size:31px">${esc(overview.active_cases ?? 0)}</strong><p class="muted" style="font-size:12px">当前 active cases</p></div><div class="card highlight"><div class="eyebrow">等待支援</div><strong class="mono" style="font-size:31px">${esc(overview.waiting_support ?? 0)}</strong><p class="muted" style="font-size:12px">待接收不等于已接管</p></div><div class="card lilac"><div class="eyebrow">即时安全待接管</div><strong class="mono" style="font-size:31px">${esc(overview.immediate_safety_pending ?? 0)}</strong><p class="muted" style="font-size:12px">安全旁路优先处理</p></div><div class="card sage"><div class="eyebrow">可服务人员</div><strong class="mono" style="font-size:31px">${esc(overview.available_volunteers ?? 0)}</strong><p class="muted" style="font-size:12px">按后端状态统计</p></div></div><div class="grid two" style="margin-top:18px"><section class="card"><div class="card-head"><div><h2>支持分层分布</h2><p>当前辖区聚合，不显示用户私密正文。</p></div></div>${renderDistribution(overview.support_need_distribution)}</section><section class="card"><div class="card-head"><div><h2>责任提示</h2><p>用于协调下一步人工动作。</p></div></div><div class="note-box"><strong>不要用数字替代接续</strong>普通管理者不能代替专业人员做临床复核，也不能通过提高志愿者上限解决资质、休息不足或无人值守。</div><div class="note-box"><strong>数据更新时间</strong>${formatTime(overview.generated_at)} · 统计口径以服务端返回为准。</div><button class="button secondary" type="button" data-route="people">查看人员与排班</button></section></div><section class="card" style="margin-top:18px"><div class="card-head"><div><h2>辖区用户摘要</h2><p>只显示编号、片区、服务进度和支持分层。</p></div><span class="status">${asArray(state.manager.users?.items).length} 人</span></div>${renderManagerUsers()}</section>`; }
  function renderDistribution(dist) { const entries = Object.entries(dist || {}); return entries.length ? `<div class="metric-grid" style="margin-top:14px">${entries.map(([key,value]) => `<div class="metric"><small>${esc(key)}</small><strong>${esc(value)}</strong><span>服务端聚合</span></div>`).join('')}</div>` : `<div class="empty" style="margin-top:14px"><div><strong>暂无分层数据</strong><span>缺失不等于稳定，等待更多人工确认。</span></div></div>`; }
  function renderManagerUsers() { const items = asArray(state.manager.users?.items); if (!items.length) return `<div class="empty" style="margin-top:14px"><div><strong>暂无用户摘要</strong><span>授权辖区内没有可显示的数据。</span></div></div>`; return `<div class="table-wrap"><table><thead><tr><th>编号</th><th>显示名</th><th>年龄段</th><th>服务进度</th><th>支持分层</th></tr></thead><tbody>${items.slice(0, 20).map((item) => `<tr><td class="mono">${shortId(item.id)}</td><td>${esc(item.display_name || '匿名用户')}</td><td>${esc(item.age_band || '待确认')}</td><td>${statusLabel(item.service_progress)}</td><td>${esc(item.support_need_level || '未确认')}</td></tr>`).join('')}</tbody></table></div>`; }

  function renderManagerQueue() { const transfers = asArray(state.manager.transfers?.items); const professionals = asArray(state.manager.professionals?.items); return `<section class="page-head"><div><h1>升级与交接</h1><p>队列按请求类型分开。收到请求、具名接收和完成交接各自保留状态。</p></div><button class="button secondary" type="button" data-route="overview">回到总览</button></section><div class="grid two"><section class="card"><div class="card-head"><div><h2>普通交接</h2><p>${transfers.length} 条</p></div></div>${transfers.length ? `<div class="queue-list">${transfers.map((item) => managerQueueHtml(item, 'transfer')).join('')}</div>` : `<div class="empty" style="margin-top:14px"><div><strong>暂无普通交接</strong><span>没有新的接班确认请求。</span></div></div>`}</section><section class="card highlight"><div class="card-head"><div><h2>专业接管请求</h2><p>${professionals.length} 条</p></div></div>${professionals.length ? `<div class="queue-list">${professionals.map((item) => managerQueueHtml(item, 'professional')).join('')}</div>` : `<div class="empty" style="margin-top:14px"><div><strong>暂无专业接管请求</strong><span>即时安全和专业接管不因管理收件自动完成。</span></div></div>`}</section></div>`; }
  function managerQueueHtml(item, kind) { const id = item.id || item.request_id; return `<article class="queue-item"><div><strong>${shortId(id)} <span class="status ${statusClass(item.status)}">${statusLabel(item.status)}</span></strong><small>个案 ${shortId(item.case_id)} · 发起于 ${formatTime(item.created_at || item.requested_at)}<br>${esc(item.reason || item.note || item.takeover_reason || '需要人工核对下一步')}</small></div><div class="item-actions"><button class="button small" type="button" data-action="confirm-queue" data-queue-kind="${kind}" data-queue-id="${esc(id)}">${kind === 'professional' ? '确认专业接管' : '确认普通交接'}</button></div></article>`; }
  function renderManagerPeople() { const volunteers = asArray(state.manager.volunteers?.items); return `<section class="page-head"><div><h1>人员与排班</h1><p>查看人员负荷和职责范围。排班修改保留在服务端权限内。</p></div><button class="button secondary" type="button" data-action="refresh-manager">刷新数据</button></section><section class="card"><div class="card-head"><div><h2>人员负荷</h2><p>当前角色、状态、每日上限与同时服务上限。</p></div></div>${volunteers.length ? `<div class="table-wrap"><table><thead><tr><th>人员</th><th>角色</th><th>状态</th><th>每日上限</th><th>同时上限</th><th>今日计数</th></tr></thead><tbody>${volunteers.map((item) => `<tr><td>${esc(item.display_name || '未命名')}<br><span class="mono muted">${shortId(item.id)}</span></td><td>${roleLabel(item.role)}</td><td><span class="status ${statusClass(item.status)}">${statusLabel(item.status)}</span></td><td class="mono">${esc(item.daily_limit ?? '-')}</td><td class="mono">${esc(item.concurrent_limit ?? '-')}</td><td class="mono">${esc(item.daily_count ?? 0)} / ${esc(item.concurrent_count ?? 0)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty" style="margin-top:14px"><div><strong>暂无人员数据</strong><span>请检查管理端片区授权。</span></div></div>`}</section><section class="card" style="margin-top:18px"><div class="card-head"><div><h2>排班记录</h2><p>新增、请假换班和发布流程按后端契约逐步开放。</p></div></div>${renderSchedule(state.manager.schedules)}</section>`; }
  function renderManagerAudit() { const audits = asArray(state.manager.audits?.items); const resources = asArray(state.manager.resources?.items); return `<section class="page-head"><div><h1>审计与资源</h1><p>审计用于追溯访问和状态变化，资源库用于现实支持渠道维护。</p></div><button class="button secondary" type="button" data-action="refresh-manager">刷新数据</button></section><div class="grid two"><section class="card"><div class="card-head"><div><h2>最近审计日志</h2><p>${audits.length} 条服务端记录</p></div></div>${audits.length ? `<div class="timeline-list">${audits.slice(0, 14).map((item) => `<div class="timeline-item"><strong>${esc(item.action || '请求')}</strong><small>${esc(item.actor_role || 'system')} · ${esc(item.reason || item.object_type || '')}<br>${formatTime(item.occurred_at)} · request ${shortId(item.request_id)}</small></div>`).join('')}</div>` : `<div class="empty" style="margin-top:14px"><div><strong>暂无审计日志</strong><span>服务端会记录关键访问与变更。</span></div></div>`}</section><section class="card sage"><div class="card-head"><div><h2>新增现实资源</h2><p>发布前请核对地区、电话、服务时间和来源。</p></div></div><form id="resource-form" class="field-list" style="margin-top:15px"><div class="field"><label for="resource-name">名称</label><input id="resource-name" name="name" placeholder="上海心理援助热线 12356 / 962525" required></div><div class="form-row"><div class="field"><label for="resource-category">类别</label><select id="resource-category" name="category"><option value="mental_hotline">心理援助热线</option><option value="emergency">紧急支持</option><option value="medical">医疗资源</option></select></div><div class="field"><label for="resource-region">地区</label><input id="resource-region" name="region" value="shanghai" required></div></div><div class="form-row"><div class="field"><label for="resource-phone">电话</label><input id="resource-phone" name="phone" placeholder="12356"></div><div class="field"><label for="resource-time">服务时间</label><input id="resource-time" name="available_time" value="24h"></div></div><button class="button" type="submit">保存资源</button></form></section></div><section class="card" style="margin-top:18px"><div class="card-head"><div><h2>已登记资源</h2><p>展示内容仍需用户按所在地自行核验。</p></div></div>${resources.length ? `<div class="resource-list">${resources.map(resourceHtml).join('')}</div>` : `<div class="empty" style="margin-top:14px"><div><strong>暂无资源</strong><span>可在上方新增一条。</span></div></div>`}</section>`; }

  function renderAiView() { const ai = state.manager.ai || {}; const health = ai.health || {}; const configPayload = ai.config || {}; const config = configPayload.active_config || configPayload; const configId = config.id; return `<section class="page-head"><div><h1>AI 配置</h1><p>只允许合成输入测试与版本化发布。模型输出必须人工确认，不自动发送或触发外部动作。</p></div><button class="button secondary" type="button" data-action="refresh-ai">刷新 AI 状态</button></section><div class="grid stats"><div class="card"><div class="eyebrow">服务模式</div><strong>${esc(health.mode || '待确认')}</strong><p class="muted" style="font-size:12px">${esc(health.provider || 'provider')} · ${esc(health.model || '')}</p></div><div class="card sage"><div class="eyebrow">API Key</div><strong>${health.api_key_configured ? '已配置' : '未配置'}</strong><p class="muted" style="font-size:12px">当前 mock 仍可完成演示。</p></div><div class="card lilac"><div class="eyebrow">提示词</div><strong class="mono">${asArray(ai.prompts?.items).length}</strong><p class="muted" style="font-size:12px">版本化记录</p></div><div class="card butter"><div class="eyebrow">安全工具</div><strong class="mono">${asArray(ai.tools?.items).length}</strong><p class="muted" style="font-size:12px">按白名单启用</p></div></div><section class="card" style="margin-top:18px"><div class="card-head"><div><h2>当前配置</h2><p>配置 ID、模型和发布状态来自服务端，不在前端保存密钥。</p></div><span class="status ${config.published_at || config.status === 'published' ? 'good' : 'warn'}">${config.published_at || config.status === 'published' ? '已发布' : '草稿或未发布'}</span></div>${config.id ? `<div class="table-wrap"><table><tbody><tr><th>配置 ID</th><td class="mono">${shortId(config.id)}</td></tr><tr><th>Provider</th><td>${esc(config.provider || health.provider || '')}</td></tr><tr><th>Model</th><td class="mono">${esc(config.model || health.model || '')}</td></tr><tr><th>启用</th><td>${config.enabled ? '是' : '否'}</td></tr><tr><th>发布时间</th><td>${formatTime(config.published_at)}</td></tr></tbody></table></div><div class="form-actions"><button class="button secondary" type="button" data-action="test-ai" data-config-id="${esc(configId)}">用合成输入测试</button><button class="button" type="button" data-action="publish-ai" data-config-id="${esc(configId)}">发布当前配置</button></div>` : `<div class="empty" style="margin-top:14px"><div><strong>暂无可读配置</strong><span>请确认当前账号是 AI 配置管理员。</span></div></div>`}</section><div class="grid two" style="margin-top:18px"><section class="card"><div class="card-head"><div><h2>提示词与技能</h2><p>用于版本化和审计，不在页面里直接执行模型输出。</p></div></div>${renderMiniList(ai.prompts, '提示词')}</section><section class="card"><div class="card-head"><div><h2>工具与审计</h2><p>工具调用遵守白名单和安全检查。</p></div></div>${renderMiniList(ai.tools, '工具')}<div class="note-box"><strong>最近变更</strong>${asArray(ai.audits?.items).slice(0, 2).map((item) => `${esc(item.action || '变更')} · ${formatTime(item.occurred_at)}`).join('<br>') || '暂无记录'}</div></section></div>`; }
  function renderMiniList(payload, emptyLabel) { const items = asArray(payload?.items); return items.length ? `<div class="queue-list">${items.slice(0, 5).map((item) => `<div class="queue-item"><div><strong>${esc(item.name || item.title || item.id || emptyLabel)}</strong><small>${esc(item.status || item.version || item.description || '已登记')}</small></div><span class="status">${esc(item.status || 'active')}</span></div>`).join('')}</div>` : `<div class="empty" style="margin-top:14px"><div><strong>暂无${emptyLabel}</strong><span>等待服务端配置。</span></div></div>`; }

  function renderModal() {
    const root = document.querySelector('#app');
    const modal = document.createElement('div'); modal.className = 'modal-backdrop'; modal.innerHTML = state.modal === 'api' ? renderApiModal() : renderSafetyModal(); root.append(modal);
  }
  function renderApiModal() { return `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="api-title"><div class="modal-head"><div><h2 id="api-title">API 连接设置</h2><p>默认指向当前远程服务。生产部署建议使用 HTTPS 域名，并由后端配置明确 CORS 来源。</p></div><button class="close-button" type="button" data-action="close-modal" aria-label="关闭">×</button></div><form id="api-form" class="field-list" style="margin-top:16px"><div class="field"><label for="api-base">API Base URL</label><input id="api-base" name="api_base" value="${esc(state.apiBase)}" inputmode="url" required><small>例如 http://8.133.215.80:8080/api/v1</small></div><div class="form-actions"><button class="button" type="submit">保存并检查连接</button><button class="button secondary" type="button" data-action="close-modal">取消</button></div></form></section>`; }
  function renderSafetyModal() { return `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="safety-title"><div class="modal-head"><div><h2 id="safety-title">先照顾眼前的安全</h2><p>不需要完成日记、量表或设备授权。页面不会自动报警或外呼。</p></div><button class="close-button" type="button" data-action="close-modal" aria-label="关闭">×</button></div><div class="note-box" style="margin-top:16px"><strong>如果你现在有伤害自己或他人的想法、已经受伤、服药过量，或无法保证此刻安全</strong>请优先联系所在地急救服务或公共安全服务，并尽量让可信任的人陪在身边。</div><form id="safety-form" class="field-list" style="margin-top:16px"><div class="field"><label for="safety-status">当前状态</label><select id="safety-status" name="safety_status"><option value="unsafe">我现在不安全</option><option value="unsure">我不确定</option><option value="safe">我现在安全</option></select></div><label class="choice" style="display:flex;align-items:center;gap:10px"><input type="checkbox" name="physical_emergency" style="width:auto"><span><strong>有身体急症或已经受伤</strong><small>需要现实医疗支持，不等待普通陪伴。</small></span></label><label class="choice" style="display:flex;align-items:center;gap:10px"><input type="checkbox" name="trusted_contact_available" style="width:auto"><span><strong>身边有可信任的人可以陪伴</strong><small>请按你自己的选择联系，不由应用代为通知。</small></span></label><div class="form-actions"><button class="button danger" type="submit">提交即时安全求助</button><button class="button secondary" type="button" data-action="close-modal">取消</button></div></form></section>`; }

  async function refreshUser() { await run(loadUser, '用户数据已刷新'); }
  async function refreshVolunteer() { await run(loadVolunteer, '志愿者工作台已刷新'); }
  async function refreshManager() { await run(loadManager, '管理端数据已刷新'); }
  async function refreshAi() { await run(loadAi, 'AI 配置状态已刷新'); }

  async function handleSubmit(event) {
    const form = event.target; event.preventDefault();
    if (form.id === 'user-login-form') return run(() => loginUser(form));
    if (form.id === 'staff-login-form') { state.loginAccount = form.account.value.trim(); return run(() => loginStaff(form)); }
    if (form.id === 'chat-form') { const content = form.content.value.trim(); return run(async () => { await api.request('/me/chat/messages', { method: 'POST', body: { content } }); await loadUser(); state.route = 'chat'; }, '消息已发送'); }
    if (form.id === 'diary-form') return handleDiarySubmit(form);
    if (form.id === 'safety-form') return handleSafetySubmit(form);
    if (form.id === 'questionnaire-form') return run(async () => { const answers = Object.entries(state.user.questionnaireAnswers || {}).map(([item, value]) => ({ item, value })); if (!answers.length) throw new Error('请先选择一项回答，或直接跳过。'); await api.request('/me/questionnaires/phq-2/responses', { method: 'POST', body: { answers } }); state.route = 'questionnaire'; }, '这次回答已记录，不生成风险等级');
    if (form.id === 'volunteer-message-form') { const content = form.content.value.trim(); const caseId = state.volunteer.selectedCase; return run(async () => { await api.request(`/volunteer/cases/${encodeURIComponent(caseId)}/messages`, { method: 'POST', body: { content, message_type: 'text', ai_assisted: false } }); await loadVolunteerDetail(caseId); }, '陪伴消息已发送'); }
    if (form.id === 'rest-form') return run(async () => { await api.request('/volunteer/rest', { method: 'POST', body: { stop_new_cases: form.stop_new_cases.checked, reason: form.reason.value } }); await loadVolunteer(); }, '休息申请已提交');
    if (form.id === 'self-check-form') return run(async () => { await api.request('/volunteer/self-check', { method: 'POST', body: { fit_to_continue: form.fit_to_continue.checked, private_environment: form.private_environment.checked, available_until: form.available_until.value } }); await loadVolunteer(); }, '自检已提交');
    if (form.id === 'resource-form') return run(async () => { await api.request('/manager/resources', { method: 'POST', body: { name: form.name.value.trim(), category: form.category.value, region: form.region.value.trim(), phone: form.phone.value.trim(), available_time: form.available_time.value.trim() } }); await loadManager(); }, '资源已保存');
    if (form.id === 'api-form') { api.setBase(form.api_base.value); localStorage.setItem(API_KEY, state.apiBase); state.modal = null; render(); return checkHealth(); }
  }

  async function handleDiarySubmit(form) {
    const content = form.content.value.trim(); state.diary.content = content;
    const action = form.diary_action.value;
    if (!content) return showToast('请先写下一句话，再保存或确认。', true);
    return run(async () => {
      if (action === 'save' || action === 'confirm') {
        if (!state.diary.id) { const draft = await api.request('/me/diary/drafts', { method: 'POST', body: { feeling: state.diary.feeling, free_text: content, source: 'user_input' } }); state.diary.id = draft.id; }
        await api.request(`/me/diary/${encodeURIComponent(state.diary.id)}`, { method: 'PATCH', body: { content } });
        if (action === 'confirm') await api.request(`/me/diary/${encodeURIComponent(state.diary.id)}/confirm`, { method: 'POST', body: { confirm: true } });
        await loadUser(); state.route = 'diary';
      }
    }, action === 'confirm' ? '日记已确认，分享仍需单独选择' : '草稿已保存');
  }

  async function loadQuestionnaire() { return run(async () => { state.user.questionnaire = await api.request('/me/questionnaires/phq-2'); state.route = 'questionnaire'; }, '可选状态记录已加载'); }

  function startExercise() {
    const checkbox = document.querySelector('#exercise-safe');
    if (!checkbox?.checked) return showToast('请先确认当前安全且愿意尝试。', true);
    return run(async () => { const result = await api.request(`/me/exercises/${encodeURIComponent(state.exercise.type)}/start`, { method: 'POST', body: { safety_confirmed: true, willing_to_try: true } }); state.exercise.id = result.exercise_id || result.id; state.exercise.remaining = 60; state.exercise.running = true; state.exercise.paused = false; state.route = 'exercise'; render(); clearExerciseTimer(); state.exercise.timer = window.setInterval(() => { if (state.exercise.paused) return; state.exercise.remaining -= 1; const timer = document.querySelector('#exercise-timer'); if (timer) timer.textContent = String(Math.max(state.exercise.remaining, 0)); if (state.exercise.remaining <= 0) completeExercise(); }, 1000); }, '跟练已开始');
  }
  async function toggleExercise() { if (!state.exercise.running || !state.exercise.id) return; const next = state.exercise.paused ? 'continue' : 'pause'; return run(async () => { await api.request(`/me/exercises/${encodeURIComponent(state.exercise.id)}`, { method: 'PATCH', body: { action: next } }); state.exercise.paused = !state.exercise.paused; state.route = 'exercise'; }, state.exercise.paused ? '跟练继续' : '跟练已暂停'); }
  async function completeExercise() { if (!state.exercise.id) return; return run(async () => { await api.request(`/me/exercises/${encodeURIComponent(state.exercise.id)}/complete`, { method: 'POST', body: { feeling_after: 'slightly_relieved', want_continue: false } }); clearExerciseTimer(); state.exercise.running = false; state.exercise.paused = false; state.route = 'exercise'; }, '跟练已完成，结果不会自动写入日记'); }
  async function stopExercise() { if (!state.exercise.id) return; return run(async () => { await api.request(`/me/exercises/${encodeURIComponent(state.exercise.id)}`, { method: 'PATCH', body: { action: 'stop' } }); clearExerciseTimer(); state.exercise.running = false; state.exercise.paused = false; state.route = 'exercise'; }, '跟练已停止'); }

  async function handleSafetySubmit(form) {
    return run(async () => { await api.request('/me/safety/escalate', { method: 'POST', body: { safety_status: form.safety_status.value, physical_emergency: form.physical_emergency.checked, public_safety_danger: false, current_location: null, trusted_contact_available: form.trusted_contact_available.checked } }); state.modal = null; await loadUser(); state.route = 'support'; }, '即时安全求助状态已提交');
  }

  async function loadVolunteerDetail(caseId) {
    clearVolunteerDetailTimer();
    state.volunteer.selectedCase = caseId;
    state.volunteer.detail = await api.request(`/volunteer/cases/${encodeURIComponent(caseId)}`);
    state.route = 'cases';
    render();
    state.volunteer.detailRefreshTimer = window.setInterval(async () => {
      if (state.role !== 'volunteer' || state.route !== 'cases' || state.volunteer.selectedCase !== caseId || state.busy) return;
      try {
        state.volunteer.detail = await api.request(`/volunteer/cases/${encodeURIComponent(caseId)}`);
        render();
      } catch (_) {}
    }, 5000);
  }

  async function handleAction(actionTarget) {
    const action = actionTarget.dataset.action;
    if (action === 'go-home') { state.route = state.role === 'user' ? 'home' : state.role === 'volunteer' ? 'overview' : state.role === 'ai_config_admin' ? 'ai' : 'overview'; return render(); }
    if (action === 'logout') return logout();
    if (action === 'open-api') { state.modal = 'api'; return render(); }
    if (action === 'close-modal') { state.modal = null; return render(); }
    if (action === 'open-safety') { state.modal = 'safety'; return render(); }
    if (action === 'start-exercise') return startExercise();
    if (action === 'toggle-exercise') return toggleExercise();
    if (action === 'stop-exercise') return stopExercise();
    if (action === 'complete-exercise') return completeExercise();
    if (action === 'load-questionnaire') return loadQuestionnaire();
    if (action === 'refresh-user') return refreshUser();
    if (action === 'refresh-volunteer') return refreshVolunteer();
    if (action === 'refresh-manager') return refreshManager();
    if (action === 'refresh-ai') return refreshAi();
    if (action === 'open-help') { state.route = 'support'; return render(); }
    if (action === 'toggle-consent') { const key = actionTarget.dataset.consent; const consents = state.user.consents?.consents || state.user.consents || {}; const next = !consents[key]; return run(async () => { await api.request('/me/consents', { method: 'PATCH', body: { [key]: next } }); await loadUser(); }, next ? '授权已开启' : '授权已撤回'); }
    if (action === 'diary-draft') return run(async () => { const draft = await api.request('/me/diary/drafts', { method: 'POST', body: { feeling: state.diary.feeling, free_text: state.diary.content, source: 'user_input' } }); state.diary.id = draft.id; state.diary.content = draft.content || state.diary.content; await loadUser(); state.route = 'diary'; }, '草稿已生成');
    if (action === 'diary-share') return run(async () => { await api.request(`/me/diary/${encodeURIComponent(state.diary.id)}/share`, { method: 'POST', body: { scope: 'current_supporter' } }); await loadUser(); }, '已分享给当前支持者');
    if (action === 'diary-revoke') return run(async () => { await api.request(`/me/diary/${encodeURIComponent(state.diary.id)}/share`, { method: 'DELETE', body: {} }); await loadUser(); }, '已撤回分享');
    if (action === 'request-support') return run(async () => { await api.request('/me/support-cases', { method: 'POST', body: { request_type: state.support.kind === 'professional' ? 'professional_support' : 'volunteer_text', consent_scope: ['chat_text'].concat(state.support.diary ? ['diary_summary'] : []).concat(state.support.trends ? ['trend_summary'] : []), preferred_contact: 'text', share_trend_summary: state.support.trends, share_diary: state.support.diary, immediate_safety: false } }); await loadUser(); state.route = 'support'; }, '人工支持请求已发起');
    if (action === 'resource-note') return showToast(`请按所在地核验“${actionTarget.dataset.resource}”的官方联系方式和服务时间。`);
    if (action === 'accept-case') return run(async () => { const caseId = actionTarget.dataset.caseId; await api.request(`/volunteer/cases/${encodeURIComponent(caseId)}/accept`, { method: 'POST', body: { acknowledge_scope: ['chat_text'] } }); await loadVolunteer(); await loadVolunteerDetail(caseId); }, '个案已承接，已进入会话');
    if (action === 'select-case') return run(() => loadVolunteerDetail(actionTarget.dataset.caseId));
    if (action === 'close-case') return run(async () => { await api.request(`/volunteer/cases/${encodeURIComponent(actionTarget.dataset.caseId)}/close`, { method: 'POST', body: { user_agreed: true, follow_up: 'next_day' } }); clearVolunteerDetailTimer(); state.volunteer.selectedCase = null; state.volunteer.detail = null; await loadVolunteer(); state.route = 'cases'; }, '陪伴已结束');
    if (action === 'professional-request') return run(async () => { await api.request('/volunteer/professional-requests', { method: 'POST', body: { case_id: actionTarget.dataset.caseId, reason: '用户当前情况需要专业复核。' } }); await loadVolunteer(); }, '专业支持请求已提交');
    if (action === 'transfer-request') return run(async () => { await api.request('/volunteer/transfer-requests', { method: 'POST', body: { case_id: actionTarget.dataset.caseId, type: 'shift_transfer', summary_scope: ['main_request', 'safety_facts', 'actions_taken', 'open_questions'] } }); await loadVolunteer(); }, '普通交接请求已提交');
    if (action === 'confirm-queue') return confirmQueue(actionTarget.dataset.queueKind, actionTarget.dataset.queueId);
    if (action === 'test-ai') return run(async () => { const result = await api.request(`/manager/ai/config/${encodeURIComponent(actionTarget.dataset.configId)}/test`, { method: 'POST', body: { task_type: 'chat_suggestion', synthetic_input: { age_band: '14-17', main_request: '希望有人听我说说', current_safety: 'safe' }, execute_tools: false } }); state.modal = null; await loadAi(); showToast(`合成输入测试完成：${result?.status || result?.result || '已返回服务端结果'}`); }, 'AI 合成输入测试已完成');
    if (action === 'publish-ai') return run(async () => { await api.request(`/manager/ai/config/${encodeURIComponent(actionTarget.dataset.configId)}/publish`, { method: 'POST', body: { confirm_no_sensitive_data_in_test: true, safety_review_passed: true, change_note: '由联机工作台发起的合成配置发布。' } }); await loadAi(); }, 'AI 配置已提交发布');
  }

  async function confirmQueue(kind, id) {
    if (!id) return;
    return run(async () => { if (kind === 'transfer') await api.request(`/manager/transfer-requests/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: { capacity_verified: true, note: '已核对接班人剩余名额和资格。' } }); else await api.request(`/manager/professional-requests/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: { reviewed_user_situation: true, takeover_reason: '管理端已核对请求并提交专业接管确认。', next_action: 'coordinate_external_referral', external_referral_status: 'pending' } }); await loadManager(); }, '队列状态已更新');
  }

  async function handleClick(event) {
    const target = event.target.closest('button'); if (!target) return;
    if (target.dataset.loginRole) { state.loginRole = target.dataset.loginRole; state.error = ''; render(); return; }
    if (target.dataset.switchRole) { state.loginRole = target.dataset.switchRole; return logout(false); }
    if (target.dataset.route) {
      if (target.dataset.route !== 'cases') clearVolunteerDetailTimer();
      state.route = target.dataset.route;
      render();
      return;
    }
    if (target.dataset.feeling) { state.diary.feeling = target.dataset.feeling; render(); return; }
    if (target.dataset.exerciseType) { state.exercise.type = target.dataset.exerciseType; render(); return; }
    if (target.dataset.questionAnswer) { state.user.questionnaireAnswers = state.user.questionnaireAnswers || {}; state.user.questionnaireAnswers[target.dataset.questionAnswer] = target.dataset.answerValue; target.closest('.field')?.querySelectorAll('[data-question-answer]').forEach((item) => item.classList.toggle('is-selected', item === target)); return; }
    if (target.dataset.need) { const map = { listen: 'listen', quiet: 'quiet', support: 'talk_to_human', exercise: 'exercise' }; return run(async () => { await api.request('/me/chat/needs', { method: 'POST', body: { current_safety: 'safe', main_need: map[target.dataset.need], skip_questionnaire: true } }); if (target.dataset.need === 'support') state.route = 'support'; else if (target.dataset.need === 'exercise') state.route = 'exercise'; await loadUser(); }, '当前需要已记录'); }
    if (target.dataset.supportKind) { state.support.kind = target.dataset.supportKind; render(); return; }
    if (target.dataset.action || target.id === 'go-home') return handleAction(target);
    if (target.dataset.action === 'start-exercise') return startExercise();
  }

  async function handleChange(event) { const target = event.target; if (target.dataset.shareToggle) { state.support[target.dataset.shareToggle] = target.checked; } }

  document.addEventListener('submit', handleSubmit);
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  window.addEventListener('beforeunload', clearExerciseTimer);
  init();
})();
