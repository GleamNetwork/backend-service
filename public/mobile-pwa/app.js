(() => {
  'use strict';

  const mascot = document.querySelector('#mascot');
  const mascotStage = document.querySelector('.mascot-stage');
  const petGreeting = document.querySelector('#petGreeting');
  const waveform = document.querySelector('#waveform');
  const scrim = document.querySelector('#scrim');
  const toast = document.querySelector('#toast');
  const apiStatus = document.querySelector('#apiStatus');
  const sendButton = document.querySelector('#composer .send');
  const panels = [...document.querySelectorAll('[data-panel]')];
  const tabs = [...document.querySelectorAll('.tab')];
  const api = window.HOLDU_API || window.HOLDU_DEMO_API;
  const messages = document.querySelector('#messages');
  const input = document.querySelector('#messageInput');
  const state = {
    ready: false,
    loading: true,
    feeling: '',
    diary: { id: '', text: '', version: 1, saved: false, confirmed: false, shared: false, dirty: false },
    profile: { nickname: '', ageBand: '' },
    consents: { device_metrics: false, activity_reminder: false, trend_summary_share: false, diary_share: false },
    support: { kind: 'peer', diary: false, device: false, pending: false, status: 'none' },
    exercise: { type: 'breathing', id: '', remaining: 60, running: false, paused: false, timer: null },
    questions: {},
    questionnaire: { type: 'phq2', title: '可选状态记录', items: [], notice: '' },
    messages: [],
    aiConversation: [],
    metrics: [],
    trends: [],
    demoMetrics: null,
    resources: [],
    chatSending: false,
    eventsAfter: 0,
    eventTimer: null,
    eventStream: null,
    motionReduced: false,
    guardianConsent: sessionStorage.getItem('tongpin.mobile.guardianConsent') === 'true'
  };
  let toastTimer;
  let petLifeTimer;
  let petStateTimer;
  let petGreetingTimer;
  let previousPetGreeting = '';
  let mascotHovered = false;

  const petStates = {
    idle: { className: 'is-pet-idle', label: '小频正在安静陪伴，轻触开始聊天', stageLabel: '小频正在安静陪伴', hold: 0, greetings: [] },
    wave: { className: 'is-pet-wave', label: '小频正向你招手，轻触开始聊天', stageLabel: '小频正在向你招手', hold: 2100, greetings: ['嗨，我在这儿', '又见面啦', '很高兴见到你'] },
    curious: { className: 'is-pet-curious', label: '小频歪着头，认真地倾听', stageLabel: '小频正在认真听你说话', hold: 4600, greetings: ['我认真听着呢', '嗯嗯，你说', '我靠近一点听'] },
    heart: { className: 'is-pet-heart', label: '小频抱着一颗心回应你', stageLabel: '小频正抱着一颗心陪你', hold: 4800, greetings: ['把这颗心送给你', '今天也想抱抱你', '你已经做得很好了'] },
    hop: { className: 'is-pet-hop', label: '小频开心地跳了一下', stageLabel: '小频正在开心地跳跃', hold: 1700, greetings: ['见到你真好', '给你一点元气', '嘿，接住好心情'] },
    listening: { className: 'is-pet-listening', label: '小频靠近一点，等你开口', stageLabel: '小频正耐心等你开口', hold: 4600, greetings: ['慢慢说，我在', '不用着急', '我陪你待一会儿'] },
    cheer: { className: 'is-pet-cheer', label: '小频正在给你打气', stageLabel: '小频正在开心地为你打气', hold: 1900, greetings: ['给你比个心', '今天也有一点光', '我为你加油'] },
    peek: { className: 'is-pet-peek', label: '小频探出头看着你', stageLabel: '小频正悄悄探头看你', hold: 3900, greetings: ['我偷偷看你一眼', '我还在哦', '发现你啦'] }
  };
  const petStateClasses = Object.values(petStates).map((item) => item.className);

  const demoMetricProfiles = [
    { id: 'daybreak', name: '晨间节律', sync: '模拟手表 · 10:24', quality: '有效佩戴 7小时48分', heart: 69, hrv: 52, sleep: 431, steps: 1360, active: 14, energy: 760, medication: { status: '已服用', hint: '08:00' }, trend: [48, 61, 55, 68, 63, 72, 58] },
    { id: 'midday', name: '午后片刻', sync: '模拟手表 · 14:06', quality: '有效佩戴 8小时12分', heart: 74, hrv: 46, sleep: 408, steps: 4680, active: 41, energy: 1180, medication: { status: '待服用', hint: '20:00' }, trend: [54, 70, 67, 58, 76, 64, 73] },
    { id: 'weekend', name: '周末步调', sync: '模拟手表 · 11:38', quality: '有效佩戴 9小时03分', heart: 66, hrv: 58, sleep: 487, steps: 3120, active: 27, energy: 960, medication: { status: '已服用', hint: '09:00' }, trend: [45, 52, 62, 49, 57, 66, 60] },
    { id: 'evening', name: '傍晚回看', sync: '模拟手表 · 18:42', quality: '有效佩戴 10小时21分', heart: 71, hrv: 44, sleep: 454, steps: 6430, active: 53, energy: 1460, medication: { status: '待确认', hint: '20:00' }, trend: [63, 58, 71, 66, 74, 61, 77] }
  ];

  const exerciseCopy = {
    breathing: { cue: '跟着舒服的节奏就好', done: '这一次，先照顾到自己' },
    grounding: { cue: '找找眼前的颜色和形状', done: '你回到了眼前这一刻' },
    relax: { cue: '只做不痛、不过度的幅度', done: '肩手可以先松一点' }
  };

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-showing');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-showing'), 3100);
  }

  function errorText(error) {
    return error && error.message ? error.message : '同频服务暂时不可用，请稍后重试。';
  }

  function setApiStatus(kind, text) {
    if (!apiStatus) return;
    apiStatus.textContent = text;
    apiStatus.classList.toggle('is-online', kind === 'online');
    apiStatus.classList.toggle('is-error', kind === 'error');
    apiStatus.classList.toggle('is-loading', kind === 'loading');
  }

  async function remote(name, payload, options = {}) {
    if (!api) throw new Error('页面没有加载接口适配器。');
    try {
      return await api.request(name, payload || {});
    } catch (error) {
      if (!options.quiet) {
        setApiStatus('error', '服务异常');
        showToast(errorText(error));
      }
      throw error;
    }
  }

  function itemsOf(result) {
    if (Array.isArray(result)) return result;
    return result && Array.isArray(result.items) ? result.items : [];
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function hydrateProfile(user) {
    if (!user) return;
    state.profile.nickname = user.display_name || user.nickname || '';
    state.profile.ageBand = user.age_band || state.profile.ageBand || '';
    if (user.consents) state.consents = { ...state.consents, ...user.consents };
  }

  function renderMinorConsent() {
    const isYoungTeen = state.profile.ageBand === '12-13';
    const notice = document.querySelector('#minorGuardian');
    const row = document.querySelector('#guardianConsentRow');
    const checkbox = document.querySelector('#guardianConsent');
    if (notice) notice.hidden = !isYoungTeen;
    if (row) row.hidden = !isYoungTeen;
    if (checkbox) checkbox.checked = isYoungTeen && state.guardianConsent;
  }

  async function handleGuardianConsent(checkbox) {
    state.guardianConsent = checkbox.checked;
    sessionStorage.setItem('tongpin.mobile.guardianConsent', String(state.guardianConsent));
    if (!state.guardianConsent && state.profile.ageBand === '12-13') {
      const protectedKeys = ['device_metrics', 'trend_summary_share'];
      try {
        await remote('consents', protectedKeys.reduce((payload, key) => ({ ...payload, [key]: false }), {}));
        protectedKeys.forEach((key) => { state.consents[key] = false; });
        renderProfile();
        renderDevice();
        showToast('已撤回设备相关授权，主动求助仍然可用');
      } catch (_) {}
      return;
    }
    renderProfile();
    showToast(state.guardianConsent ? '监护知情同意演示已记录' : '已取消监护知情同意演示');
  }

  function hydrateDiary(entry) {
    if (!entry) return;
    state.diary.id = entry.id || state.diary.id;
    state.diary.text = entry.content || '';
    state.diary.version = Number(entry.current_version || entry.version || 1);
    state.diary.saved = entry.status === 'draft' || entry.status === 'confirmed' || Boolean(entry.content);
    state.diary.confirmed = entry.status === 'confirmed' || Boolean(entry.confirmed_at);
    state.diary.shared = Boolean(entry.shared_scope);
    state.diary.dirty = false;
  }

  function setActiveTab(name) {
    tabs.forEach((tab) => {
      const active = (name === 'community' && tab.dataset.open === 'community') ||
        (name === 'profile' && tab.dataset.open === 'profile') ||
        (name !== 'community' && name !== 'profile' && tab.dataset.home !== undefined);
      tab.classList.toggle('is-active', active);
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
  }

  function closePanels() {
    panels.forEach((panel) => panel.classList.remove('is-open'));
    scrim.classList.remove('is-open');
    setActiveTab('home');
  }

  function humanCaseActive() {
    return ['assigned', 'in_progress', 'awaiting_transfer', 'professional_takeover_requested', 'professional_taken_over'].includes(state.support.status);
  }

  function supportCasePending(status = state.support.status) {
    return ['waiting_assignment', 'assigned', 'in_progress', 'awaiting_transfer', 'professional_takeover_requested', 'professional_taken_over'].includes(status);
  }

  function openPanel(name) {
    if (name === 'questionnaire' && state.profile.ageBand && state.profile.ageBand !== '18+') {
      showToast('未成年人需使用经专业审核的适龄问卷，当前入口不会加载成人问卷');
      return;
    }
    const panel = document.querySelector('[data-panel="' + name + '"]');
    if (!panel) return;
    if (name === 'chat') {
      const active = humanCaseActive();
      const title = document.querySelector('#chatTitle');
      const subtitle = document.querySelector('#chatPanel .panel-head p');
      const eyebrow = document.querySelector('#chatPanel .eyebrow');
      if (title) title.textContent = active ? '和志愿者聊聊' : '我在这里';
      if (subtitle) subtitle.textContent = active ? '你的消息会送到当前承接的志愿者。' : '慢一点说，也没关系。';
      if (eyebrow) eyebrow.textContent = active ? '当前案件会话' : '直接说给小频听';
      if (input) input.placeholder = active ? '发消息给当前志愿者…' : '写下一句就好';
    }
    panels.forEach((item) => item.classList.toggle('is-open', item === panel));
    scrim.classList.add('is-open');
    setActiveTab(name);
    if (name === 'profile') renderProfile();
    if (name === 'device') renderDevice();
    if (name === 'support') { renderSupport(); void loadSupport(); }
    if (name === 'resources') void loadResources();
    if (name === 'questionnaire') void loadQuestionnaire();
    const closeButton = panel.querySelector('[data-close]');
    if (closeButton) closeButton.focus();
  }

  function decorativeMotionReduced() {
    return state.motionReduced || document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function updatePetGreeting(name) {
    if (!petGreeting) return;
    const messages = (petStates[name] && petStates[name].greetings) || [];
    if (!messages.length) return;
    const alternatives = messages.filter((message) => message !== previousPetGreeting);
    const nextMessage = (alternatives.length ? alternatives : messages)[Math.floor(Math.random() * (alternatives.length || messages.length))];
    previousPetGreeting = nextMessage;
    petGreeting.textContent = nextMessage;
    petGreeting.classList.remove('is-updating');
    window.requestAnimationFrame(() => petGreeting.classList.add('is-updating'));
    window.clearTimeout(petGreetingTimer);
    petGreetingTimer = window.setTimeout(() => petGreeting.classList.remove('is-updating'), 540);
  }

  function setPetState(name, allowReturn = true, announce = name !== 'idle') {
    const activeName = petStates[name] ? name : 'idle';
    const next = petStates[activeName];
    window.clearTimeout(petStateTimer);
    mascot.classList.remove(...petStateClasses);
    mascot.classList.add(next.className);
    mascot.dataset.petState = activeName;
    mascot.setAttribute('aria-label', next.label);
    if (mascotStage) {
      mascotStage.classList.remove(...petStateClasses);
      mascotStage.classList.add(next.className);
      mascotStage.setAttribute('aria-label', next.stageLabel);
    }
    if (announce) updatePetGreeting(activeName);
    if (allowReturn && next.hold && !decorativeMotionReduced()) {
      petStateTimer = window.setTimeout(() => setPetState('idle', false, false), next.hold);
    }
  }

  function stopPetLife() {
    window.clearTimeout(petLifeTimer);
    window.clearTimeout(petStateTimer);
  }

  function schedulePetLife(delay) {
    window.clearTimeout(petLifeTimer);
    if (decorativeMotionReduced() || document.hidden) return;
    petLifeTimer = window.setTimeout(() => {
      if (mascot.classList.contains('is-responding') || mascotHovered) {
        schedulePetLife(1600);
        return;
      }
      const nextStates = ['wave', 'curious', 'heart', 'hop', 'listening', 'cheer', 'peek'];
      const next = nextStates[Math.floor(Math.random() * nextStates.length)];
      setPetState(next);
      schedulePetLife(10000);
    }, delay);
  }

  function startPetLife() {
    stopPetLife();
    setPetState('idle', false, false);
    schedulePetLife(10000);
  }

  function invite() {
    if (mascot.classList.contains('is-responding')) return;
    stopPetLife();
    setPetState('wave', false, false);
    mascot.classList.add('is-responding');
    if (petGreeting) {
      petGreeting.textContent = '走，和我聊聊';
      previousPetGreeting = petGreeting.textContent;
      petGreeting.classList.remove('is-updating');
      window.requestAnimationFrame(() => petGreeting.classList.add('is-updating'));
    }
    waveform.classList.add('is-listening');
    window.setTimeout(() => openPanel('chat'), 510);
    window.setTimeout(() => {
      mascot.classList.remove('is-responding');
      waveform.classList.remove('is-listening');
      startPetLife();
    }, 2600);
  }

  function appendBubble(item, mine) {
    const bubble = document.createElement('div');
    bubble.className = mine ? 'message me' : 'message';
    if (!mine) {
      const label = document.createElement('small');
      const roleLabels = {
        volunteer: '志愿者 · 陪伴',
        duty_manager: '值班负责人 · 陪伴',
        professional_supervisor: '专业支持',
        assistant: '小频 · 陪伴建议'
      };
      label.textContent = item.label || roleLabels[item.sender_role || item.role] || '小频';
      bubble.append(label);
    }
    bubble.append(document.createTextNode(item.content || item.text || ''));
    messages.append(bubble);
    return bubble;
  }

  function appendStreamingBubble(label) {
    const bubble = document.createElement('div');
    bubble.className = 'message';
    const caption = document.createElement('small');
    caption.textContent = label || '小频 · 实时回应';
    const textNode = document.createTextNode('');
    bubble.append(caption, textNode);
    messages.append(bubble);
    return {
      update(value) { textNode.nodeValue = String(value || ''); },
      remove() { bubble.remove(); }
    };
  }

  function renderMessages() {
    if (!messages) return;
    messages.innerHTML = '';
    const conversation = state.aiConversation.length ? state.aiConversation : state.messages;
    if (!conversation.length) {
      appendBubble({ content: '此刻你更希望我怎么陪你？' }, false);
      return;
    }
    conversation.slice(-30).forEach((item) => appendBubble(item, item.sender_role === 'user' || item.role === 'user'));
    messages.scrollTop = messages.scrollHeight;
  }

  async function loadChat() {
    const result = await remote('chatList', {}, { quiet: true });
    state.messages = itemsOf(result);
    if (!state.chatSending) {
      state.aiConversation = state.messages.slice(-30).map((item) => ({
        id: item.id,
        sender_role: item.sender_role || 'user',
        content: item.content || '',
        label: item.label || ''
      }));
    }
    renderMessages();
    return result;
  }

  async function appendMessage(value) {
    const text = String(value || '').trim();
    if (!text || state.loading || state.chatSending) return;
    const sendToVolunteer = humanCaseActive();
    state.chatSending = true;
    input.value = '';
    input.disabled = true;
    if (sendButton) sendButton.disabled = true;
    const previousPlaceholder = input.placeholder;
    input.placeholder = '小频正在回应…';
    state.aiConversation.push({ role: 'user', content: text });
    renderMessages();
    try {
      await remote('chat', { text });
      await loadChat();
      if (sendToVolunteer) {
        showToast('消息已发送给当前志愿者');
        return;
      }
      let suggestion = null;
      let streamBubble = null;
      try {
        if (!api.streamChatSuggestion) throw new Error('实时聊天接口不可用');
        let streamedText = '';
        streamBubble = appendStreamingBubble('小频 · 实时回应');
        suggestion = await api.streamChatSuggestion({
          text,
          conversation: state.aiConversation,
          currentSafety: 'unknown'
        }, {
          onDelta(delta) {
            streamedText += delta;
            streamBubble.update(streamedText);
            messages.scrollTop = messages.scrollHeight;
          }
        });
      } catch (_) {
        if (streamBubble) streamBubble.remove();
        streamBubble = null;
        try {
          suggestion = await remote('chatSuggestion', {
            text,
            conversation: state.aiConversation,
            currentSafety: 'unknown'
          }, { quiet: true });
        } catch (_) {}
      }
      const candidate = suggestion && suggestion.candidate_text;
      if (candidate) {
        state.aiConversation.push({ role: 'assistant', content: candidate, label: '小频 · 陪伴建议' });
        if (streamBubble) streamBubble.update(candidate);
        else appendBubble({ content: candidate, label: '小频 · 陪伴建议' }, false);
      }
      if (/不安全|自杀|伤害自己|伤害别人|想死|撑不住/.test(text)) {
        const check = document.createElement('div');
        check.className = 'message';
        check.innerHTML = '<small>小频 · 需要你确认</small>如果这句话是在说现在的你，请告诉我：此刻安全吗？不需要解释，可以直接进入即时安全支持。';
        messages.append(check);
        const actions = document.createElement('div');
        actions.className = 'prompt-row';
        actions.innerHTML = '<button class="prompt" type="button" data-open="safety">现在不安全 / 不确定</button><button class="prompt" type="button" data-safety-choice="safe">我现在安全</button>';
        messages.append(actions);
      } else if (!candidate) {
        const fallback = '我听到了。你可以继续说，也可以先停在这里。需要找现实中的人时，入口一直在。';
        state.aiConversation.push({ role: 'assistant', content: fallback, label: '小频 · 陪伴建议' });
        appendBubble({ content: fallback, label: '小频 · 陪伴建议' }, false);
      }
      messages.scrollTop = messages.scrollHeight;
    } catch (_) {}
    finally {
      state.chatSending = false;
      input.disabled = false;
      if (sendButton) sendButton.disabled = false;
      input.placeholder = previousPlaceholder;
      input.focus();
    }
  }

  function renderDiary() {
    const text = document.querySelector('#diaryText');
    const meta = document.querySelector('#diaryMeta');
    if (!text || !meta) return;
    text.value = state.diary.text;
    const statuses = [];
    statuses.push(state.diary.confirmed
      ? '<span class="status-pill is-confirmed">已确认</span>'
      : state.diary.saved
        ? '<span class="status-pill">草稿已保存</span>'
        : '<span class="status-pill">未生成草稿</span>');
    if (state.diary.shared) statuses.push('<span class="status-pill is-shared">已单独分享</span>');
    statuses.push('<span class="source-pill">来源：本人表达 · v' + state.diary.version + '</span>');
    meta.innerHTML = statuses.join('');
    document.querySelector('[data-diary-action="share"]').disabled = !state.diary.confirmed;
    document.querySelector('[data-diary-action="revoke"]').disabled = !state.diary.shared;
  }

  async function makeDiaryDraft() {
    const diaryInput = document.querySelector('#diaryText');
    if (!state.feeling && !diaryInput.value.trim()) {
      showToast('先点选一种感受，或写下一句话');
      return;
    }
    const feeling = state.feeling || '此刻';
    try {
      const entry = await remote('diaryDraft', { feeling, text: diaryInput.value.trim() });
      hydrateDiary(entry);
      renderDiary();
      showToast('草稿已由服务端生成，你可以继续编辑');
    } catch (_) {}
  }

  async function ensureDiary(text) {
    if (state.diary.id) return state.diary.id;
    const entry = await remote('diaryDraft', { feeling: state.feeling || '此刻', text });
    hydrateDiary(entry);
    return state.diary.id;
  }

  async function handleDiaryAction(action) {
    const diaryInput = document.querySelector('#diaryText');
    const text = diaryInput.value.trim();
    if (action === 'draft') { await makeDiaryDraft(); return; }
    if (!text) { showToast('还没有内容，写一句或先点选感受'); return; }
    try {
      const id = await ensureDiary(text);
      if (action === 'save') {
        hydrateDiary(await remote('diaryEdit', { id, text }));
        state.diary.saved = true;
        state.diary.confirmed = false;
        state.diary.shared = false;
        showToast('草稿已保存到你的同频记录');
      } else if (action === 'confirm') {
        await remote('diaryEdit', { id, text });
        hydrateDiary(await remote('diaryConfirm', { id }));
        state.diary.confirmed = true;
        showToast('日记已由你确认，分享仍需单独选择');
      } else if (action === 'share') {
        if (!state.diary.confirmed) { showToast('请先确认这份日记'); return; }
        await remote('diaryShare', { id });
        state.diary.shared = true;
        showToast('已单独分享给当前支持者，可随时撤回');
      } else if (action === 'revoke') {
        await remote('diaryRevoke', { id });
        state.diary.shared = false;
        showToast('已撤回日记分享');
      }
      state.diary.text = text;
      state.diary.dirty = false;
      renderDiary();
    } catch (_) {}
  }

  function renderProfile() {
    const nickname = document.querySelector('#nickname');
    const ageBand = document.querySelector('#ageBand');
    if (nickname) nickname.value = state.profile.nickname;
    if (ageBand) ageBand.value = state.profile.ageBand;
    document.querySelectorAll('[data-consent]').forEach((button) => {
      const key = button.dataset.consent;
      button.classList.toggle('is-on', Boolean(state.consents[key]));
      button.setAttribute('aria-pressed', String(Boolean(state.consents[key])));
    });
    const motionSwitch = document.querySelector('#motionSwitch');
    motionSwitch.classList.toggle('is-on', state.motionReduced);
    motionSwitch.setAttribute('aria-pressed', String(state.motionReduced));
    renderMinorConsent();
  }

  function metricValue(item) {
    if (!item) return '暂无数据';
    const value = item.value == null ? item.metric_value : item.value;
    if (value == null || value === '') return '暂无数据';
    return String(value) + (item.unit ? ' ' + item.unit : '');
  }

  function randomInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function formatSleep(minutes) {
    return Math.floor(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
  }

  function createDemoMetrics(previousId) {
    const choices = demoMetricProfiles.filter((item) => item.id !== previousId);
    const available = choices.length ? choices : demoMetricProfiles;
    const profile = available[randomInteger(0, available.length - 1)];
    const heart = Math.max(55, profile.heart + randomInteger(-3, 3));
    const hrv = Math.max(24, profile.hrv + randomInteger(-6, 6));
    const sleep = Math.max(300, profile.sleep + randomInteger(-13, 13));
    const steps = Math.max(480, profile.steps + randomInteger(-620, 620));
    const active = Math.max(6, profile.active + randomInteger(-7, 8));
    const energy = Math.max(480, profile.energy + randomInteger(-90, 90));
    return {
      ...profile,
      heart,
      hrv,
      sleep,
      steps,
      active,
      energy,
      trend: profile.trend.map((value) => Math.max(28, Math.min(88, value + randomInteger(-6, 6))))
    };
  }

  function renderHomeMetrics() {
    const metrics = document.querySelector('#homeMetrics');
    const card = document.querySelector('#homeMetricCard');
    if (!metrics || !card) return;
    if (!state.demoMetrics) state.demoMetrics = createDemoMetrics();
    const snapshot = state.demoMetrics;
    const cards = [
      { emoji: '❤️', label: '心率', value: snapshot.heart, unit: 'bpm', hint: '静坐 · 刚刚' },
      { emoji: '🫧', label: 'HRV', value: snapshot.hrv, unit: 'ms', hint: '刚刚同步' },
      { emoji: '😴', label: '睡眠', value: formatSleep(snapshot.sleep), unit: '', hint: '昨夜记录' },
      { emoji: '👟', label: '活动', value: snapshot.steps.toLocaleString('zh-CN'), unit: '步', hint: snapshot.active + ' 分钟活动' },
      { emoji: '🔥', label: '能量消耗', value: snapshot.energy, unit: 'kcal', hint: '今天累计' },
      { emoji: '💊', label: '用药', value: snapshot.medication.status, unit: '', hint: snapshot.medication.hint }
    ];
    metrics.innerHTML = cards.map((item) => '<span class="home-metric"><span class="home-metric-top"><b aria-hidden="true">' + item.emoji + '</b>' + item.label + '</span><strong>' + escapeHtml(item.value) + (item.unit ? '<small>' + escapeHtml(item.unit) + '</small>' : '') + '</strong><em>' + escapeHtml(item.hint) + '</em></span>').join('');
    card.setAttribute('aria-busy', 'false');
    card.setAttribute('aria-label', '当前身体指标：心率 ' + snapshot.heart + ' bpm，HRV ' + snapshot.hrv + ' ms，睡眠 ' + formatSleep(snapshot.sleep) + '，活动 ' + snapshot.steps.toLocaleString('zh-CN') + ' 步，能量消耗 ' + snapshot.energy + ' 千卡，用药状态 ' + snapshot.medication.status);
  }

  function renderDevice() {
    const metrics = document.querySelector('#deviceMetrics');
    if (!metrics) return;
    if (!state.demoMetrics) state.demoMetrics = createDemoMetrics();
    const snapshot = state.demoMetrics;
    const currentMetrics = [
      ['心率', snapshot.heart + ' bpm', '刚刚同步'],
      ['HRV', snapshot.hrv + ' ms', '刚刚同步'],
      ['睡眠', formatSleep(snapshot.sleep), '昨夜记录'],
      ['活动', snapshot.steps.toLocaleString('zh-CN') + ' 步', '今天 ' + snapshot.active + ' 分钟'],
      ['能量消耗', snapshot.energy + ' kcal', '今天累计'],
      ['用药状态', snapshot.medication.status, snapshot.medication.hint]
    ];
    metrics.innerHTML = currentMetrics.map(([label, value, stamp]) => '<div class="metric"><small>' + label + '</small><strong>' + escapeHtml(value) + '</strong><span>' + escapeHtml(stamp) + '</span></div>').join('');
    const bars = document.querySelector('.bars');
    if (bars) {
      const days = ['一', '二', '三', '四', '五', '六', '日'];
      bars.innerHTML = snapshot.trend.map((value, index) => '<span class="bar" style="--bar:' + Math.round(value * .82) + 'px"><i>' + days[index] + '</i></span>').join('');
    }
  }

  function renderSupport() {
    const request = document.querySelector('#supportRequest');
    const pending = document.querySelector('#supportPending');
    if (request) request.hidden = state.support.pending;
    if (pending) pending.hidden = !state.support.pending;
    if (pending && state.support.pending) {
      const active = humanCaseActive();
      const title = pending.querySelector('strong');
      const description = pending.querySelector('p');
      const chatButton = pending.querySelector('[data-open="chat"]');
      if (title) title.textContent = active ? '志愿者已承接，可以直接聊天' : '请求已发起，正在等待接收';
      if (description) description.textContent = active
        ? '你现在发送的消息会进入这条案件会话，志愿者回复后会实时出现在这里。'
        : '这表示请求已经提交，不代表已有志愿者或专业人员接管。页面会保留“等待接收”的状态。';
      if (chatButton) chatButton.textContent = active ? '打开和志愿者聊天' : '继续和小频聊聊';
    }
    document.querySelectorAll('[data-support-kind]').forEach((button) => {
      button.classList.toggle('is-selected', button.dataset.supportKind === state.support.kind);
    });
    document.querySelectorAll('[data-support-share]').forEach((button) => {
      const key = button.dataset.supportShare;
      button.classList.toggle('is-on', Boolean(state.support[key]));
      button.setAttribute('aria-pressed', String(Boolean(state.support[key])));
    });
  }

  async function loadSupport() {
    try {
      const result = await remote('supportStatus', {}, { quiet: true });
      state.support.status = result && result.status || 'none';
      state.support.pending = supportCasePending();
      renderSupport();
    } catch (_) {}
  }

  async function requestSupport() {
    const requestType = state.support.kind === 'professional' ? 'professional_support' :
      state.support.kind === 'trusted' ? 'trusted_contact' : 'volunteer_text';
    const consentScope = ['chat_text'];
    if (state.support.diary) consentScope.push('diary_summary');
    if (state.support.device) consentScope.push('trend_summary');
    try {
      const result = await remote('support', {
        request_type: requestType,
        preferred_contact: 'text',
        consent_scope: consentScope,
        share_diary: state.support.diary,
        share_trend_summary: state.support.device,
        immediate_safety: false
      });
      state.support.status = result && result.status || 'waiting_assignment';
      state.support.pending = true;
      renderSupport();
      showToast('人工请求已提交，当前状态：等待接收');
    } catch (_) {}
  }

  async function handleSafety(choice) {
    try {
      await remote('safety', {
        safety_status: choice,
        physical_emergency: false,
        public_safety_danger: choice === 'unsafe',
        current_location: null,
        trusted_contact_available: false
      });
    } catch (_) {}
    if (choice === 'safe') {
      showToast('谢谢你告诉我，我们继续按你舒服的方式来');
      openPanel('chat');
      return;
    }
    showToast(choice === 'unsafe' ? '已记录即时安全求助状态' : '已记录不确定状态，先看看现实支持');
    openPanel('resources');
  }

  async function handleCare(kind) {
    document.querySelectorAll('[data-care]').forEach((item) => item.classList.remove('is-selected'));
    const button = document.querySelector('[data-care="' + kind + '"]');
    if (button) button.classList.add('is-selected');
    const scenario = { work: 'work_or_study', rest: 'resting', unwell: 'body_uncomfortable', low: 'low_energy', willing: 'willing_to_move' }[kind] || kind;
    try { await remote('care', { scenario, want_exercise: kind === 'willing', note: '' }); } catch (_) {}
    const notice = document.querySelector('#careNotice');
    if (kind === 'work' || kind === 'rest') {
      notice.innerHTML = '<strong>好，我先不打扰</strong>这次关怀到这里，不会因为没有回复而连续追问。你可以在“我的”里关闭或调整提醒。';
      showToast('这次提醒已暂缓');
      return;
    }
    if (kind === 'unwell') {
      notice.innerHTML = '<strong>先照顾身体</strong>身体不舒服时不推运动任务。如果不适持续、加重或让你担心，请联系现实中的医疗支持。';
      showToast('已记下：这次不安排运动');
      return;
    }
    if (kind === 'low') {
      notice.innerHTML = '<strong>提不起劲也可以先不动</strong><button class="soft-link" type="button" data-open="chat">和小频聊聊</button><button class="soft-link" type="button" data-open="support">找现实中的人</button>';
      return;
    }
    if (kind === 'willing') openPanel('exercise');
  }

  function renderExercise() {
    const timer = document.querySelector('#exerciseTimer');
    const cue = document.querySelector('#exerciseCue');
    const stage = document.querySelector('#exerciseStage');
    const pause = document.querySelector('#pauseExercise');
    const copy = exerciseCopy[state.exercise.type];
    timer.textContent = String(state.exercise.remaining);
    cue.textContent = state.exercise.paused ? '已经暂停，准备好再继续' : state.exercise.running ? copy.cue : copy.done;
    stage.classList.toggle('is-paused', state.exercise.paused);
    stage.classList.toggle('is-stopped', !state.exercise.running);
    pause.textContent = state.exercise.paused ? '继续' : '暂停';
  }

  function clearExerciseTimer() {
    if (state.exercise.timer) window.clearInterval(state.exercise.timer);
    state.exercise.timer = null;
  }

  async function stopExercise(message, action) {
    clearExerciseTimer();
    state.exercise.running = false;
    state.exercise.paused = false;
    document.querySelector('#exerciseChooser').hidden = false;
    document.querySelector('#exerciseRunning').hidden = true;
    document.querySelector('#exerciseSafe').checked = false;
    if (state.exercise.id) {
      try { await remote('exerciseUpdate', { exerciseId: state.exercise.id, action: action || 'stop' }); } catch (_) {}
    }
    renderExercise();
    if (message) showToast(message);
  }

  async function startExercise() {
    if (!document.querySelector('#exerciseSafe').checked) {
      showToast('请先确认当前安全且愿意尝试');
      return;
    }
    try {
      const result = await remote('exerciseStart', { type: state.exercise.type });
      state.exercise.id = result && (result.exercise_id || result.id) || '';
      clearExerciseTimer();
      state.exercise.remaining = 60;
      state.exercise.running = true;
      state.exercise.paused = false;
      document.querySelector('#exerciseChooser').hidden = true;
      document.querySelector('#exerciseRunning').hidden = false;
      renderExercise();
      state.exercise.timer = window.setInterval(() => {
        if (state.exercise.paused) return;
        state.exercise.remaining -= 1;
        if (state.exercise.remaining <= 0) { void completeExercise(); return; }
        renderExercise();
      }, 1000);
    } catch (_) {}
  }

  async function toggleExercisePause(fromVisibility) {
    if (!state.exercise.running) return;
    state.exercise.paused = !state.exercise.paused;
    renderExercise();
    if (state.exercise.id) {
      try { await remote('exerciseUpdate', { exerciseId: state.exercise.id, action: state.exercise.paused ? 'pause' : 'continue' }); } catch (_) {}
    }
    if (fromVisibility) showToast('页面进入后台，练习已自动暂停');
  }

  async function completeExercise() {
    clearExerciseTimer();
    state.exercise.running = false;
    state.exercise.paused = false;
    if (state.exercise.id) {
      try { await remote('exerciseComplete', { exerciseId: state.exercise.id }); } catch (_) {}
    }
    renderExercise();
    document.querySelector('#exerciseChooser').hidden = false;
    document.querySelector('#exerciseRunning').hidden = true;
    document.querySelector('#exerciseSafe').checked = false;
    showToast('这一小段完成了，结果不会自动写进日记');
  }

  function renderQuestionnaire() {
    const holder = document.querySelector('#questionnaireQuestions');
    if (!holder) return;
    const fallback = [
      { value: 'not_at_all', label: '完全没有' },
      { value: 'several_days', label: '有几天' },
      { value: 'more_than_half_days', label: '一半以上的天数' },
      { value: 'nearly_every_day', label: '几乎每天' },
      { value: 'prefer_not_to_answer', label: '不想回答' }
    ];
    holder.innerHTML = (state.questionnaire.items || []).map((item) => {
      const options = (item.options || fallback).map((option) => typeof option === 'string' ? { value: option, label: option } : { value: option.value || option.id || option.label, label: option.label || option.text || option.value });
      return '<div class="question-card"><strong>' + escapeHtml(item.text || item.id) + '</strong><div class="question-options" data-question="' + escapeHtml(item.id) + '">' + options.map((option) => '<button class="question-option' + (state.questions[item.id] === option.value ? ' is-selected' : '') + '" type="button" data-answer="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</button>').join('') + '</div></div>';
    }).join('') || '<div class="notice"><strong>暂无可用问卷</strong>你可以跳过，也可以继续和小频聊聊。</div>';
  }

  async function loadQuestionnaire() {
    try {
      const result = await remote('questionnaireGet', { type: 'phq2' }, { quiet: true });
      state.questionnaire = result || state.questionnaire;
      renderQuestionnaire();
      const notice = document.querySelector('#questionnaireNotice');
      if (notice && result && result.notice) notice.innerHTML = '<strong>可选回答</strong>' + escapeHtml(result.notice);
    } catch (_) {}
  }

  async function submitQuestionnaire() {
    const answered = Object.entries(state.questions).map(([item, value]) => ({ item, value }));
    if (!answered.length) { showToast('可以选择一项，也可以直接跳过'); return; }
    try {
      const result = await remote('questionnaire', { type: 'phq2', answers: answered });
      document.querySelector('#questionnaireNotice').innerHTML = '<strong>这次回答已记录</strong>' + escapeHtml((result && result.notice) || '它只用于你回看，不会直接转换成支持分层、诊断或转诊结论。');
      showToast('已记录，不生成风险等级');
    } catch (_) {}
  }

  function renderResources() {
    const list = document.querySelector('#resourceList');
    if (!list || !state.resources.length) return;
    list.innerHTML = state.resources.map((resource) => {
      const phone = resource.contact && resource.contact.phone;
      return '<article class="resource-card"><header><strong>' + escapeHtml(resource.name) + '</strong><span>' + escapeHtml(resource.region || resource.category || '现实渠道') + '</span></header><p>' + escapeHtml(resource.limitations || (resource.service_time && resource.service_time.available_time ? '服务时间：' + resource.service_time.available_time : '使用前请按所在地核验服务范围与当前信息。')) + '</p>' + (phone ? '<button type="button" data-toast="请先按所在地核验号码与服务时间：' + escapeHtml(phone) + '">查看联系方式</button>' : '') + '</article>';
    }).join('');
  }

  async function loadResources() {
    try {
      const result = await remote('resources', {}, { quiet: true });
      state.resources = itemsOf(result);
      renderResources();
    } catch (_) {}
  }

  async function refreshAll() {
    const results = await Promise.allSettled([
      remote('profileGet', {}, { quiet: true }),
      remote('consentsGet', {}, { quiet: true }),
      remote('metrics', {}, { quiet: true }),
      remote('trends', {}, { quiet: true }),
      remote('diaryList', {}, { quiet: true }),
      remote('chatList', {}, { quiet: true }),
      remote('supportStatus', {}, { quiet: true }),
      remote('resources', {}, { quiet: true })
    ]);
    const value = (index) => results[index].status === 'fulfilled' ? results[index].value : null;
    const profile = value(0);
    if (profile) hydrateProfile(profile);
    const consents = value(1);
    if (consents && consents.consents) state.consents = { ...state.consents, ...consents.consents };
    state.metrics = itemsOf(value(2));
    state.trends = itemsOf(value(3));
    const diaries = itemsOf(value(4));
    if (diaries[0]) hydrateDiary(diaries[0]);
    state.messages = itemsOf(value(5));
    if (!state.aiConversation.length) {
      state.aiConversation = state.messages.slice(-30).map((item) => ({
        id: item.id,
        sender_role: item.sender_role || 'user',
        content: item.content || ''
      }));
    }
    const support = value(6);
    if (support) {
      state.support.status = support.status || 'none';
      state.support.pending = supportCasePending();
    }
    state.resources = itemsOf(value(7));
    renderMessages();
    renderDiary();
    renderProfile();
    renderDevice();
    renderSupport();
    renderResources();
  }

  async function pollEvents() {
    if (!api || !api.token) return;
    try {
      const result = await remote('eventsPoll', { afterEventId: state.eventsAfter }, { quiet: true });
      state.eventsAfter = Number(result && result.next_after_event_id || state.eventsAfter);
      if (result && result.events && result.events.length) {
        await Promise.all([
          loadChat(),
          loadSupport(),
          remote('diaryList', {}, { quiet: true }).then((diary) => {
            const latest = itemsOf(diary)[0];
            if (latest) { hydrateDiary(latest); renderDiary(); }
          }).catch(() => {})
        ]);
      }
      setApiStatus('online', '已连接');
    } catch (_) {}
    window.clearTimeout(state.eventTimer);
    state.eventTimer = window.setTimeout(pollEvents, 20000);
  }

  function startEventStream() {
    if (!api || !api.streamEvents || !api.token || !state.ready) return;
    if (state.eventStream) state.eventStream.close();
    state.eventStream = api.streamEvents((event, id) => {
      const nextId = Number(id || event && event.id || 0);
      if (Number.isFinite(nextId)) state.eventsAfter = Math.max(state.eventsAfter, nextId);
      setApiStatus('online', '实时已连接');
      if (event && /case\.|safety\.|resource\./.test(String(event.event || ''))) {
        void Promise.all([loadChat(), loadSupport(), loadResources()]).then(() => {
          if (event.event === 'case.assigned') showToast('志愿者已接入，可以开始聊天');
          if (event.event === 'case.closed') showToast('本次陪伴已结束');
        }).catch(() => {});
      }
    }, () => {
      setApiStatus('loading', '等待重连');
    }, state.eventsAfter);
    state.eventStream.promise.then(() => {
      if (state.ready) window.setTimeout(startEventStream, 5000);
    }, () => {
      if (state.ready) window.setTimeout(startEventStream, 5000);
    });
  }

  async function bootstrap() {
    setApiStatus('loading', '正在连接');
    try {
      const result = await api.bootstrap({ ageBand: '18+', districtId: 'district_shanghai_a' });
      hydrateProfile(result && result.user);
      await refreshAll();
      state.ready = true;
      state.loading = false;
      setApiStatus('online', '已连接');
      void pollEvents();
      startEventStream();
    } catch (error) {
      state.loading = false;
      setApiStatus('error', '连接失败');
      showToast(errorText(error));
    }
  }

  document.querySelector('#listenButton').addEventListener('click', invite);
  document.querySelector('#refreshDemoMetrics').addEventListener('click', () => {
    state.demoMetrics = createDemoMetrics(state.demoMetrics && state.demoMetrics.id);
    renderHomeMetrics();
    renderDevice();
  });
  mascot.addEventListener('click', invite);
  mascot.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse' || decorativeMotionReduced() || mascot.classList.contains('is-responding')) return;
    mascotHovered = true;
    window.clearTimeout(petStateTimer);
    setPetState('wave', false, false);
  });
  mascot.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'mouse') return;
    mascotHovered = false;
    window.clearTimeout(petStateTimer);
    petStateTimer = window.setTimeout(() => {
      if (!mascotHovered && !mascot.classList.contains('is-responding')) setPetState('idle', false, false);
    }, 340);
  });
  document.querySelector('#composer').addEventListener('submit', (event) => {
    event.preventDefault();
    void appendMessage(input.value);
  });
  document.querySelector('#startExercise').addEventListener('click', () => void startExercise());
  document.querySelector('#pauseExercise').addEventListener('click', () => void toggleExercisePause(false));
  document.querySelector('#skipExercise').addEventListener('click', () => void stopExercise('已跳过这一小段，不会自动写进日记', 'skip'));
  document.querySelector('#stopExercise').addEventListener('click', () => void stopExercise('练习已停止，不会自动写进日记'));
  document.querySelector('#completeExercise').addEventListener('click', () => void completeExercise());
  document.querySelector('#requestSupport').addEventListener('click', () => void requestSupport());
  document.querySelector('#saveProfile').addEventListener('click', async () => {
    state.profile.nickname = document.querySelector('#nickname').value.trim();
    state.profile.ageBand = document.querySelector('#ageBand').value;
    try {
      const user = await remote('profile', state.profile);
      hydrateProfile(user);
      showToast(state.profile.ageBand === '12-13' || state.profile.ageBand === '14-17'
        ? '偏好已更新，将使用年龄适配表达；不会默认通知监护人'
        : '偏好已更新');
      renderProfile();
    } catch (_) {}
  });
  document.querySelector('#submitQuestionnaire').addEventListener('click', () => void submitQuestionnaire());

  const diaryText = document.querySelector('#diaryText');
  if (diaryText) diaryText.addEventListener('input', (event) => {
    const nextText = event.target.value;
    if (!state.diary.dirty && (state.diary.confirmed || state.diary.shared)) {
      state.diary.version += 1;
      state.diary.confirmed = false;
      state.diary.shared = false;
      state.diary.dirty = true;
      state.diary.text = nextText;
      renderDiary();
      showToast('内容有修改，已撤销之前的确认和分享');
      return;
    }
    state.diary.text = nextText;
    state.diary.saved = false;
  });

  document.addEventListener('click', (event) => {
    if (event.target && event.target.id === 'guardianConsent') {
      void handleGuardianConsent(event.target);
      return;
    }
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.open) { openPanel(target.dataset.open); return; }
    if (target.hasAttribute('data-close')) { closePanels(); return; }
    if (target.dataset.toast) { showToast(target.dataset.toast); return; }
    if (target.dataset.message) { void appendMessage(target.dataset.message); return; }
    if (target.dataset.feeling) {
      state.feeling = target.dataset.feeling;
      document.querySelectorAll('[data-feeling]').forEach((item) => item.classList.remove('is-selected'));
      target.classList.add('is-selected');
      document.querySelector('#recordNotice').innerHTML = '<strong>“' + escapeHtml(target.dataset.feeling) + '” 已留在这里</strong>你不必马上解决它。想继续时，小频会在对话里等你。';
      return;
    }
    if (target.dataset.diaryAction) { void handleDiaryAction(target.dataset.diaryAction); return; }
    if (target.dataset.care) { void handleCare(target.dataset.care); return; }
    if (target.dataset.exercise) {
      state.exercise.type = target.dataset.exercise;
      document.querySelectorAll('[data-exercise]').forEach((item) => item.classList.toggle('is-selected', item === target));
      return;
    }
    if (target.dataset.supportKind) {
      state.support.kind = target.dataset.supportKind;
      renderSupport();
      return;
    }
    if (target.dataset.supportShare) {
      const key = target.dataset.supportShare;
      state.support[key] = !state.support[key];
      renderSupport();
      return;
    }
    if (target.dataset.safetyChoice) { void handleSafety(target.dataset.safetyChoice); return; }
    if (target.dataset.consent) {
      const key = target.dataset.consent;
      if ((key === 'device_metrics' || key === 'trend_summary_share') && state.profile.ageBand === '12-13' && !state.guardianConsent) {
        showToast('12–13 岁开启设备数据前，请先完成监护知情同意演示');
        return;
      }
      const next = !state.consents[key];
      void remote('consents', { [key]: next }).then(() => {
        state.consents[key] = next;
        renderProfile();
        if (key === 'device_metrics') { renderDevice(); void refreshAll(); }
        showToast(next ? '这项授权已开启' : '这项授权已撤回');
      }).catch(() => {});
      return;
    }
    if (target.id === 'motionSwitch') {
      state.motionReduced = !state.motionReduced;
      document.documentElement.classList.toggle('reduce-motion', state.motionReduced);
      if (state.motionReduced) {
        stopPetLife();
        setPetState('idle', false, false);
      } else {
        startPetLife();
      }
      renderProfile();
      showToast(state.motionReduced ? '已减少装饰性动效' : '已恢复动效');
      return;
    }
    if (target.dataset.answer) {
      const question = target.closest('[data-question]');
      if (!question) return;
      state.questions[question.dataset.question] = target.dataset.answer;
      question.querySelectorAll('[data-answer]').forEach((item) => item.classList.toggle('is-selected', item === target));
      return;
    }
    if (target.dataset.action === 'skip-questionnaire') { openPanel('chat'); }
  });

  document.querySelector('[data-home]').addEventListener('click', closePanels);
  scrim.addEventListener('click', closePanels);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePanels(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPetLife();
      if (state.exercise.running && !state.exercise.paused) void toggleExercisePause(true);
      return;
    }
    startPetLife();
  });

  renderMessages();
  renderDiary();
  renderProfile();
  renderDevice();
  renderExercise();
  renderSupport();
  renderQuestionnaire();
  renderHomeMetrics();
  startPetLife();
  void bootstrap();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();
