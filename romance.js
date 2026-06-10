const ROMANCE_KEY = "romance_lilanei_chat_state_v4";
const LILANEI_AI_ENDPOINT = "https://script.google.com/macros/s/AKfycbxRB_4X8-a11DIA0uVQ5X4jL__LfHseel1ObnHmYaXihWJa1EWI9YIcN3RgLNovm5tr/exec";
const DAILY_AI_LIMIT = 5;
const ACHIEVEMENTS_API_URL = "https://script.google.com/macros/s/AKfycbxRB_4X8-a11DIA0uVQ5X4jL__LfHseel1ObnHmYaXihWJa1EWI9YIcN3RgLNovm5tr/exec";

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

function localAiKey(user) {
  const login = String(user?.login || "guest").toLowerCase();
  const day = new Date().toISOString().slice(0, 10);
  return `lilanei_ai_count_${login}_${day}`;
}

function getLocalAiCount(user) {
  return Number(localStorage.getItem(localAiKey(user)) || 0);
}

function setLocalAiCount(user, n) {
  localStorage.setItem(localAiKey(user), String(Math.max(0, Number(n || 0))));
}

function endpointReady() {
  return LILANEI_AI_ENDPOINT && !LILANEI_AI_ENDPOINT.includes("PASTE_GOOGLE_APPS_SCRIPT");
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

function getAiHistory() {
  return state.messages
    .filter((m) => m.who === "user" || m.who === "lilanei")
    .slice(-12)
    .map((m) => ({
      role: m.who === "user" ? "user" : "assistant",
      content: String(m.text || "").slice(0, 800)
    }));
}

async function askAi(text) {
  const user = getAuthUser();
  if (!user) throw new Error("AI_AUTH_REQUIRED");
  if (!endpointReady()) throw new Error("AI_ENDPOINT_NOT_READY");

  const localCount = getLocalAiCount(user);
  if (localCount >= DAILY_AI_LIMIT) throw new Error("AI_DAILY_LIMIT");

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
    history: getAiHistory()
  };

  const res = await fetch(LILANEI_AI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });

  let data = null;
  try { data = await res.json(); } catch (_) {}

  // Google Apps Script часто возвращает HTTP 200 даже для ошибок,
  // поэтому проверяем data.error отдельно, а не только res.ok.
  if (!res.ok || data?.error) {
    const code = data?.error || "AI_ERROR";
    if (code === "DAILY_LIMIT") throw new Error("AI_DAILY_LIMIT");
    if (code === "AUTH_REQUIRED") throw new Error("AI_AUTH_REQUIRED");
    if (code === "NO_OPENROUTER_KEY") throw new Error("AI_NO_OPENROUTER_KEY");
    if (code === "OPENROUTER_ERROR") throw new Error(`OPENROUTER_ERROR:${data?.detail || ''}`);
    if (code === "SCRIPT_ERROR") throw new Error(`SCRIPT_ERROR:${data?.detail || ''}`);
    if (code === "EMPTY_REPLY") throw new Error(`AI_EMPTY_REPLY:${data?.detail || ''}`);
    throw new Error(`${code}:${data?.detail || ''}`);
  }

  if (!data?.reply) throw new Error(`AI_EMPTY_REPLY:${JSON.stringify(data || {}).slice(0, 240)}`);

  if (typeof data.used === "number") setLocalAiCount(user, data.used);
  else setLocalAiCount(user, localCount + 1);

  return String(data.reply).trim();
}

function aiStatusText() {
  const user = getAuthUser();
  if (!user) return "ИИ-ответы только после входа через Twitch";
  if (!endpointReady()) return "ИИ выключен: вставь ссылку Google Apps Script Web App в romance.js";
  const used = getLocalAiCount(user);
  const left = Math.max(0, DAILY_AI_LIMIT - used);
  return `ИИ-ответы: ${left}/${DAILY_AI_LIMIT} сегодня для ${user.display_name || user.login}`;
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
  updateAiUi();
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

function updateAiUi() {
  const aiStatus = $("aiStatus");
  const loginHint = $("loginHint");
  const user = getAuthUser();
  if (aiStatus) aiStatus.textContent = aiStatusText();
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

function explainAiError(err) {
  const code = String(err?.message || "");
  if (code === "AI_AUTH_REQUIRED") return "Чтобы говорить с ИИ lilanei, сначала войди через Twitch на главной странице.";
  if (code === "AI_ENDPOINT_NOT_READY") return "ИИ ещё не подключён: вставь ссылку Google Apps Script Web App в romance.js вместо PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE.";
  if (code === "AI_DAILY_LIMIT") return "Сегодняшний лимит ИИ-сообщений закончился. Завтра он обновится, либо можно вручную сбросить счётчик.";
  if (code === "AI_NO_OPENROUTER_KEY") return "В Google Apps Script не найден OPENROUTER_KEY. Добавь его в Script properties.";
  if (code.startsWith("OPENROUTER_ERROR:")) return "OpenRouter вернул ошибку: " + code.slice("OPENROUTER_ERROR:".length);
  if (code.startsWith("SCRIPT_ERROR:")) return "Google Apps Script вернул ошибку: " + code.slice("SCRIPT_ERROR:".length);
  if (code.startsWith("AI_EMPTY_REPLY:")) return "ИИ вернул пустой ответ. Детали: " + code.slice("AI_EMPTY_REPLY:".length);
  if (code === "AI_EMPTY_REPLY") return "ИИ вернул пустой ответ. Скорее всего OpenRouter или модель вернули нестандартный формат ответа.";
  return "Не удалось получить ответ от ИИ. Проверь Apps Script, OpenRouter и ссылку в romance.js.";
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
  const used = user ? getLocalAiCount(user) : 0;
  const left = Math.max(0, DAILY_AI_LIMIT - used);

  return [
    "Скрытые показатели:",
    "Уважение: " + Number(state.respect || 0),
    "Теплота: " + Number(state.warmth || 0),
    "Давление/настороженность: " + Number(state.pressure || 0),
    "Сообщения: " + Number(state.turns || 0),
    "Текущий путь: " + relationshipStageLocal(),
    "ИИ-лимит сегодня: " + left + "/" + DAILY_AI_LIMIT
  ].join("\n");
}

function isLimitOverLocal() {
  const user = getAuthUser();
  if (!user) return false;
  return getLocalAiCount(user) >= DAILY_AI_LIMIT;
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
    input.placeholder = "lilanei вне сети. Команды всё ещё работают.";
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
      ? "lilanei вне сети. Команды всё ещё работают."
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
    const reply = await askAi(clean);
    applyAnalysis(clean);
    await sendRomanceProgressAchievement();
    addMessage("lilanei", reply);
  } catch (err) {
    const code = String(err?.message || "");

    if (code === "AI_DAILY_LIMIT") {
      const user = getAuthUser();
      if (user) setLocalAiCount(user, DAILY_AI_LIMIT);
      showOfflineSeparator();
      return;
    }

    addMessage("system", explainAiError(err), "system");
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

initButtons();
initMusic();
initPhoto();
render();
