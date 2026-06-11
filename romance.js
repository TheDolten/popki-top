const ROMANCE_KEY = "romance_lilanei_chat_state_v4";
const LILANEI_ENDPOINT = "__LILANEI_AI_ENDPOINT__";
const DAILY_REPLY_LIMIT = 5;
const ACHIEVEMENTS_API_URL = "https://script.google.com/macros/s/AKfycbz5H4RmAuAUAlJ3AXzhYAZyAwO7vwZc-m6HRJhvbOJtgRMlMubLSxEeA77TNojtpfHg/exec";
const TWITCH_CLIENT_ID = "__TWITCH_CLIENT_ID__";

const $ = (id) => document.getElementById(id);

const openers = [
  "lilanei смотрит на тебя чуть строго, но не отстраняется. «Ну? О чём хочешь поговорить?»",
  "Она убирает прядь волос и ждёт твоего сообщения. «Только без глупых спектаклей, ладно?»",
  "lilanei рядом. В её взгляде спокойствие, но кажется, она замечает каждую мелочь."
];

let state = loadState();

function defaultState() {
  return {
    respect: 0,
    warmth: 0,
    pressure: 0,
    messages: [],
    turns: 0
  };
}

function normalizeState(raw) {
  const safe = defaultState();
  if (!raw || typeof raw !== "object") return safe;
  safe.respect = Number(raw.respect || 0);
  safe.warmth = Number(raw.warmth || 0);
  safe.pressure = Number(raw.pressure || 0);
  safe.messages = Array.isArray(raw.messages) ? raw.messages : [];
  safe.turns = Number(raw.turns || 0);
  return safe;
}

function loadState() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(ROMANCE_KEY) || "null"));
  } catch (_) {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(ROMANCE_KEY, JSON.stringify(state));
}

function getAuthUser() {
  try {
    const raw = localStorage.getItem("twitch_user");
    const user = raw ? JSON.parse(raw) : null;
    if (!user?.login) return null;
    return user;
  } catch (_) {
    return null;
  }
}

function localReplyKey(user) {
  const login = String(user?.login || "guest").toLowerCase();
  const day = new Date().toISOString().slice(0, 10);
  return `lilanei_reply_count_${login}_${day}`;
}

function getLocalReplyCount(user) {
  return Number(localStorage.getItem(localReplyKey(user)) || 0);
}

function setLocalReplyCount(user, n) {
  localStorage.setItem(localReplyKey(user), String(Math.max(0, Number(n || 0))));
}

function endpointReady() {
  return LILANEI_ENDPOINT && !LILANEI_ENDPOINT.includes("PASTE_GOOGLE_APPS_SCRIPT");
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function addMessage(who, text, meta = "") {
  state.messages.push({ who, text, meta, time: Date.now() });
  if (state.messages.length > 100) state.messages = state.messages.slice(-100);
}

function hasAny(t, words) {
  return words.some((w) => t.includes(w));
}

function analyze(text) {
  const t = text.toLowerCase();
  const result = { respect: 0, warmth: 0, pressure: 0 };

  const warmWords = ["как дела", "ты как", "забоч", "пережива", "спасибо", "нрав", "мила", "добра", "устала", "отдох", "рядом", "слушаю", "понимаю", "обнять", "тепло", "улыб", "скуч", "важна", "важен"];
  const respectWords = ["честно", "уваж", "границ", "не буду давить", "не давлю", "не тороп", "сама реш", "твой выбор", "можешь не отвечать", "если хочешь", "прости", "извини", "не обязана", "как тебе удобно", "я подожду"];
  const pressureWords = ["добьюсь", "должна", "обязана", "будь моей", "моя", "требую", "сейчас же", "почему молчишь", "ревную", "не отпущу", "ты будешь", "я заставлю", "докажи"];
  const rudeWords = ["глуп", "туп", "затк", "дура", "ненавиж", "бесишь", "идиот", "слабая", "жалкая", "пошла", "отвали"];

  if (hasAny(t, warmWords)) result.warmth += 2;
  if (hasAny(t, respectWords)) result.respect += 3;
  if (hasAny(t, pressureWords)) { result.pressure += 3; result.respect -= 1; }
  if (hasAny(t, rudeWords)) { result.pressure += 4; result.warmth -= 2; result.respect -= 3; }
  if ((t.includes("как") && t.includes("дел")) || t.includes("как ты")) result.warmth += 1;
  if (t.includes("люблю") || t.includes("нравишься") || t.includes("ты мне нрав")) {
    result.warmth += 2;
    result.pressure += 1;
  }
  if (t.includes("прости") || t.includes("извини") || t.includes("виноват")) {
    result.respect += 2;
    result.pressure -= 1;
  }
  if (text.trim().endsWith("?") || t.includes("почему") || t.includes("зачем") || t.includes("что думаешь")) result.respect += 1;
  if (text.trim().length > 45) result.respect += 1;
  return result;
}

function applyAnalysis(text) {
  const a = analyze(text);
  state.respect += a.respect;
  state.warmth += a.warmth;
  state.pressure += a.pressure;
  state.turns += 1;
}

function getReplyHistory() {
  return state.messages
    .filter((m) => m.who === "user" || m.who === "lilanei")
    .slice(-12)
    .map((m) => ({
      role: m.who === "user" ? "user" : "assistant",
      content: String(m.text || "").slice(0, 800)
    }));
}

async function askLilanei(text) {
  const user = getAuthUser();
  if (!user) throw new Error("AUTH_REQUIRED_LOCAL");
  if (!endpointReady()) throw new Error("ENDPOINT_NOT_READY_LOCAL");

  const localCount = getLocalReplyCount(user);
  if (localCount >= DAILY_REPLY_LIMIT) throw new Error("DAILY_LIMIT_LOCAL");

  const payload = {
    message: text,
    user: {
      login: user.login,
      display_name: user.display_name || user.login,
      profile_image_url: user.profile_image_url || ""
    },
    stats: {
      respect: state.respect,
      warmth: state.warmth,
      pressure: state.pressure,
      turns: state.turns
    },
    history: getReplyHistory()
  };

  const res = await fetch(LILANEI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });

  let data = null;
  try { data = await res.json(); } catch (_) {}

    if (!res.ok || data?.error) {
    const code = data?.error || "CONNECTION_ERROR";
    if (code === "DAILY_LIMIT") throw new Error("DAILY_LIMIT_LOCAL");
    if (code === "AUTH_REQUIRED") throw new Error("AUTH_REQUIRED_LOCAL");
    if (code === "NO_OPENROUTER_KEY") throw new Error("CONNECTION_KEY_MISSING");
    if (code === "REMOTE_CONNECTION_ERROR") throw new Error(`REMOTE_CONNECTION_ERROR:${data?.detail || ''}`);
    if (code === "SCRIPT_ERROR") throw new Error(`SCRIPT_ERROR:${data?.detail || ''}`);
    if (code === "EMPTY_REPLY") throw new Error(`EMPTY_REPLY_LOCAL:${data?.detail || ''}`);
    throw new Error(`${code}:${data?.detail || ''}`);
  }

  if (!data?.reply) throw new Error(`EMPTY_REPLY_LOCAL:${JSON.stringify(data || {}).slice(0, 240)}`);

  if (typeof data.used === "number") setLocalReplyCount(user, data.used);
  else setLocalReplyCount(user, localCount + 1);

  return String(data.reply).trim();
}

function replyStatusText() {
  const user = getAuthUser();
  if (!user) return "Доступно после входа через Twitch";
  if (!endpointReady()) return "Связь временно недоступна";
  const used = getLocalReplyCount(user);
  const left = Math.max(0, DAILY_REPLY_LIMIT - used);
  return `Ответы: ${left}/${DAILY_REPLY_LIMIT} сегодня для ${user.display_name || user.login}`;
}

function render() {
  const win = $("chatWindow");
  if (!win) return;

  if (!state.messages.length) {
    win.innerHTML = `<div class="chat-empty">${escapeHtml(pick(openers))}</div>`;
  } else {
    win.innerHTML = state.messages.map((msg) => {
      if (msg.who === "offline") {
        return `
      <div class="chat-offline-separator">${escapeHtml(msg.text)}</div>`;
      }

      const cls = msg.who === "user" ? "from-user" : (msg.who === "system" ? "from-system" : "from-lilanei");
      const name = msg.who === "user" ? "Ты" : (msg.who === "system" ? "система" : "lilanei");
      return `
      <div class="chat-bubble ${cls}">
        <span>${name}</span>
        <p>${escapeHtml(msg.text)}</p>
      </div>`;
    }).join("");
    win.scrollTop = win.scrollHeight;
  }

  updateMood();
  updateReplyUi();
}

function updateMood() {
  const mood = $("characterMood");
  const status = $("chatStatus");
  if (!mood) return;

  if (state.pressure >= 10) {
    mood.textContent = "Она стала заметно холоднее. Не злится открыто, но держит дистанцию.";
    if (status) status.textContent = "lilanei насторожена";
  } else if (state.respect >= 12 && state.warmth >= 8) {
    mood.textContent = "Она всё ещё строгая, но рядом с тобой говорит мягче и дольше обычного.";
    if (status) status.textContent = "lilanei слушает внимательно";
  } else if (state.warmth >= 7) {
    mood.textContent = "В её строгом взгляде иногда появляется тёплая искра.";
    if (status) status.textContent = "lilanei чуть мягче";
  } else {
    mood.textContent = "Она спокойная и внимательная. Строгость в голосе не мешает ей быть доброй, если с ней говорить честно.";
    if (status) status.textContent = "lilanei рядом";
  }
}

function updateReplyUi() {
  const replyStatus = $("replyStatus");
  const loginHint = $("loginHint");
  const user = getAuthUser();
  if (replyStatus) replyStatus.textContent = replyStatusText();
  if (loginHint) loginHint.hidden = Boolean(user && endpointReady());

  if (user && endpointReady()) {
    unlockChatInputIfPossible();
  }
}

function setFormBusy(isBusy) {
  const input = $("chatInput");
  const btn = $("sendBtn");

  if (input) input.disabled = isBusy;
  if (btn) btn.disabled = isBusy;

  if (!isBusy) {
    unlockChatInputIfPossible();
  }
}

function explainConnectionError(err) {
  const code = String(err?.message || "");
  if (code === "AUTH_REQUIRED_LOCAL") return "Сначала войди через Twitch на главной странице.";
  if (code === "ENDPOINT_NOT_READY_LOCAL") return "Связь с lilanei пока не настроена.";
  if (code === "DAILY_LIMIT_LOCAL") return "lilanei сейчас вне сети. Попробуй вернуться позже.";
  if (code === "CONNECTION_KEY_MISSING") return "Связь временно недоступна.";
  if (code.startsWith("REMOTE_CONNECTION_ERROR:")) return "Связь оборвалась: " + code.slice("REMOTE_CONNECTION_ERROR:".length);
  if (code.startsWith("SCRIPT_ERROR:")) return "Связь оборвалась: " + code.slice("SCRIPT_ERROR:".length);
  if (code.startsWith("EMPTY_REPLY_LOCAL:")) return "lilanei промолчала. Детали: " + code.slice("EMPTY_REPLY_LOCAL:".length);
  if (code === "EMPTY_REPLY_LOCAL") return "lilanei промолчала. Попробуй написать иначе.";
  return "Не удалось связаться с lilanei. Попробуй позже.";
}




function cleanLogin(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}

function baseRedirectUri() {
  const path = window.location.pathname.replace(/\/(romance|index|popki|schedule|achievements)\.html$/i, "/");
  return window.location.origin + path;
}

function currentPageFile() {
  const last = window.location.pathname.split("/").pop();
  return last && last.endsWith(".html") ? last : "romance.html";
}

function makeTwitchState() {
  const stateValue = crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  localStorage.setItem("twitch_oauth_state", stateValue);
  localStorage.setItem("twitch_return_page", currentPageFile());
  return stateValue;
}

function twitchLoginUrl() {
  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID.trim(),
    redirect_uri: baseRedirectUri(),
    response_type: "token",
    scope: "",
    state: makeTwitchState(),
  });

  return "https://id.twitch.tv/oauth2/authorize?" + params.toString();
}

async function fetchTwitchUser(token) {
  const res = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      "Client-ID": TWITCH_CLIENT_ID.trim(),
      "Authorization": "Bearer " + token,
    },
  });

  if (!res.ok) throw new Error("twitch_user_fetch_failed");

  const json = await res.json();
  return json?.data?.[0] || null;
}

function saveAuthUser(user) {
  if (user) {
    localStorage.setItem("twitch_user", JSON.stringify(user));
  } else {
    localStorage.removeItem("twitch_user");
  }
  updateAuthPanel();
  updateReplyUi();
}

function renderAuthUserText(user) {
  const title = $("authTitle");
  const status = $("authStatus");
  const loginBtn = $("loginTwitch");
  const logoutBtn = $("logoutTwitch");

  if (!title || !status) return;

  if (!user) {
    title.textContent = "Нужна авторизация";
    status.textContent = "Войди через Twitch, чтобы сайт узнал твой ник.";
    if (loginBtn) loginBtn.hidden = false;
    if (logoutBtn) logoutBtn.hidden = true;
    return;
  }

  const display = user.display_name || user.login;
  title.textContent = "Ты вошёл как " + display;
  status.textContent = "Можно продолжать общение с lilanei.";
  if (loginBtn) loginBtn.hidden = true;
  if (logoutBtn) logoutBtn.hidden = false;
}

function updateAuthPanel() {
  renderAuthUserText(getAuthUser());
}

function setupAuthButtons() {
  $("loginTwitch")?.addEventListener("click", () => {
    if (!TWITCH_CLIENT_ID || TWITCH_CLIENT_ID.includes("__TWITCH_CLIENT_ID__")) {
      alert("Вход через Twitch пока не настроен.");
      return;
    }

    window.location.href = twitchLoginUrl();
  });

  $("logoutTwitch")?.addEventListener("click", () => {
    saveAuthUser(null);
  });
}

async function handleTwitchCallback() {
  if (!location.hash || !location.hash.includes("access_token=")) return;

  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("access_token");
  const gotState = params.get("state");
  const savedState = localStorage.getItem("twitch_oauth_state");

  history.replaceState(null, "", window.location.pathname + window.location.search);

  if (!token || !savedState || gotState !== savedState) {
    updateAuthPanel();
    return;
  }

  localStorage.removeItem("twitch_oauth_state");

  try {
    const user = await fetchTwitchUser(token);
    if (user?.login) saveAuthUser(user);
  } catch (_) {
    updateAuthPanel();
  }
}


function relationshipStageLocal() {
  const respect = Number(state.respect || 0);
  const warmth = Number(state.warmth || 0);
  const pressure = Number(state.pressure || 0);
  const turns = Number(state.turns || 0);

  if (pressure >= 10 || respect < -2) return "закрытая дверь";
  if (respect >= 18 && warmth >= 14 && pressure <= 3 && turns >= 10) return "она остаётся рядом";
  if (respect >= 12 && warmth >= 8 && pressure <= 6 && turns >= 6) return "тихое доверие";
  if (warmth >= 7 && turns >= 4) return "тёплая искра";
  return "неопределённо";
}

function buildLocalProgressReply() {
  const user = getAuthUser();
  const used = user ? getLocalReplyCount(user) : 0;
  const left = Math.max(0, DAILY_REPLY_LIMIT - used);

  return [
    "Скрытые показатели:",
    "Уважение: " + Number(state.respect || 0),
    "Теплота: " + Number(state.warmth || 0),
    "Давление/настороженность: " + Number(state.pressure || 0),
    "Сообщения: " + Number(state.turns || 0),
    "Текущий путь: " + relationshipStageLocal(),
    "Ответы сегодня: " + left + "/" + DAILY_REPLY_LIMIT
  ].join("\n");
}

function isLimitOverLocal() {
  const user = getAuthUser();
  if (!user) return false;
  return getLocalReplyCount(user) >= DAILY_REPLY_LIMIT;
}

function showOfflineSeparator() {
  const last = state.messages[state.messages.length - 1];
  if (last && last.who === "offline") return;

  addMessage("offline", "-------- lilanei вне сети --------");
}

function lockChatInputByLimit() {
  const input = $("chatInput");
  const btn = $("sendBtn");

  if (input) {
    input.disabled = false;
    input.placeholder = "lilanei вне сети.";
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = "Отправить";
  }
}

function unlockChatInputIfPossible() {
  const input = $("chatInput");
  const btn = $("sendBtn");

  if (input) {
    input.disabled = false;
    input.placeholder = isLimitOverLocal()
      ? "lilanei вне сети."
      : "Напиши lilanei сообщение...";
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = "Отправить";
  }
}

function achievementsApiReady() {
  return ACHIEVEMENTS_API_URL && !ACHIEVEMENTS_API_URL.includes("PASTE_");
}

async function sendRomanceProgressAchievement() {
  const user = getAuthUser();
  if (!user || !achievementsApiReady()) return;

  try {
    const res = await fetch(ACHIEVEMENTS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "romance_progress",
        value: {
          respect: state.respect,
          warmth: state.warmth,
          pressure: state.pressure,
          turns: state.turns
        },
        page: "romance",
        user: {
          login: user.login,
          display_name: user.display_name || user.login,
          profile_image_url: user.profile_image_url || ""
        }
      })
    });

    const json = await res.json();
    if (json?.newly_unlocked?.length) {
      const saved = JSON.parse(localStorage.getItem("achievements_state_" + String(user.login || "").toLowerCase()) || "null");
      if (saved && Array.isArray(saved.achievements)) {
        for (const id of json.newly_unlocked) {
          if (!saved.achievements.includes(id)) saved.achievements.push(id);
        }
        localStorage.setItem("achievements_state_" + String(user.login || "").toLowerCase(), JSON.stringify(saved));
      }
    }
  } catch (err) {
    console.warn("romance achievement sync failed", err);
  }
}

async function sendText(text) {
  const clean = String(text || "").trim();
  if (!clean) return;
  const isSecretProgressCommand = clean.trim().toLowerCase() === "!покажи_прогресс";

  if (isSecretProgressCommand) {
    addMessage("user", clean);
    addMessage("lilanei", buildLocalProgressReply());
    saveState();
    render();
    return;
  }

  if (isLimitOverLocal()) {
    showOfflineSeparator();
    saveState();
    render();
    return;
  }

  addMessage("user", clean);
  saveState();
  render();
  setFormBusy(true);

  try {
    const reply = await askLilanei(clean);
    applyAnalysis(clean);
    await sendRomanceProgressAchievement();
    addMessage("lilanei", reply);
  } catch (err) {
    const code = String(err?.message || "");

    if (code === "DAILY_LIMIT_LOCAL") {
      const user = getAuthUser();
      if (user) setLocalReplyCount(user, DAILY_REPLY_LIMIT);
      showOfflineSeparator();
      return;
    }

    addMessage("system", explainConnectionError(err), "system");
  } finally {
    saveState();
    setFormBusy(false);
    render();
  }
}

function reset() {
  state = defaultState();
  saveState();
  render();
}

function initButtons() {
  $("chatForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("chatInput");
    const text = input.value;
    input.value = "";
    sendText(text);
  });

  $("resetRomance")?.addEventListener("click", reset);
}

function initMusic() {
  const music = $("bgMusic");
  const btn = $("musicToggle");
  if (!music || !btn) return;
  music.volume = 0.14;
  let enabled = localStorage.getItem("bgMusicOff") !== "1";
  btn.classList.toggle("is-off", !enabled);

  btn.addEventListener("click", async () => {
    enabled = !enabled;
    localStorage.setItem("bgMusicOff", enabled ? "0" : "1");
    btn.classList.toggle("is-off", !enabled);
    if (!enabled) {
      music.pause();
      return;
    }
    try { await music.play(); } catch (_) {}
  });
}

function initPhoto() {
  const img = $("characterPhoto");
  if (!img) return;

  const photos = [
    "assets/lilanei.png",
    "assets/lilanei2.png",
    "assets/lilanei3.png",
    "assets/lilanei4.png",
    "assets/lilanei5.png"
  ];

  const fallback = "assets/lilanei_placeholder.svg";

  function shuffle(arr) {
    return [...arr].sort(() => Math.random() - 0.5);
  }

  const candidates = shuffle(photos);
  let i = 0;

  function tryNext() {
    if (i >= candidates.length) {
      img.src = fallback;
      return;
    }

    const src = candidates[i++];
    const test = new Image();

    test.onload = () => {
      img.src = src;
    };

    test.onerror = tryNext;
    test.src = src;
  }

  tryNext();
}

setupAuthButtons();
initButtons();
initMusic();
initPhoto();
handleTwitchCallback().finally(() => {
  updateAuthPanel();
  render();
});
