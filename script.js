const body = document.body;
const DATA_URL = body?.dataset?.file || "data/kus_site_data.json";
const PAGE = body?.dataset?.page || "kus";
let DATA = null;
let DETAILS_OPEN = false;


const TWITCH_CLIENT_ID = "__TWITCH_CLIENT_ID__";
const TWITCH_SCOPES = "";
const ACHIEVEMENTS_API_URL = "https://script.google.com/macros/s/AKfycbz5H4RmAuAUAlJ3AXzhYAZyAwO7vwZc-m6HRJhvbOJtgRMlMubLSxEeA77TNojtpfHg/exec";
let AUTH_USER = null;
let USER_STATE = null;
let LAST_RANK_SYNC_KEY = "";
let CAT_PET_PENDING = 0;
let CAT_PET_TIMER = null;
let CAT_PET_SYNCING = false;

const ACHIEVEMENT_DEFS = [
  { id: "top_1", icon: "👑", title: "Король топа", desc: "Попасть на 1 место в общем топе.", hidden: false },
  { id: "top_5", icon: "💎", title: "Топ-5", desc: "Попасть в первые 5 мест общего топа.", hidden: false },
  { id: "top_10", icon: "🏆", title: "Топ-10", desc: "Попасть в первые 10 мест общего топа.", hidden: false },
  { id: "top_20", icon: "⭐", title: "Топ-20", desc: "Попасть в первые 20 мест общего топа.", hidden: false },
  { id: "cat_10", icon: "🐾", title: "Котик доверяет", desc: "Погладить кота 10 раз.", hidden: false },
  { id: "cat_20", icon: "😺", title: "Любимчик кота", desc: "Погладить кота 20 раз.", hidden: false },
  { id: "hidden_cat_100", icon: "🐈‍⬛", title: "Тайный кошачий друг", desc: "Скрытое достижение: погладить кота 100 раз.", hidden: true },
  { id: "hidden_three_20", icon: "🎲", title: "Критическая удача", desc: "Скрытое достижение: выбросить 20 три раза подряд за 5 минут.", hidden: true },
  { id: "hidden_lilanei_warmth", icon: "🌙", title: "Тёплая искра", desc: "Скрытое достижение: lilanei стала мягче рядом с тобой.", hidden: true },
  { id: "hidden_lilanei_trust", icon: "🕯️", title: "Тихое доверие", desc: "Скрытое достижение: lilanei начала доверять тебе.", hidden: true },
  { id: "hidden_lilanei_close", icon: "🖤", title: "Она остаётся рядом", desc: "Скрытое достижение: особая концовка lilanei.", hidden: true },
  { id: "hidden_lilanei_distance", icon: "❄️", title: "Закрытая дверь", desc: "Скрытое достижение: lilanei отдалилась.", hidden: true },
];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
}[m]));
const $ = (id) => document.getElementById(id);
const norm = (s) => String(s ?? "").toLowerCase();
const cleanLogin = (s) => norm(s).replace(/^@/, "").trim();
const sameUser = (a, b) => cleanLogin(a) && cleanLogin(a) === cleanLogin(b);
const setHTML = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };

function getGroups(data) {
  if (PAGE === "kus" && Array.isArray(data?.kusy)) return data.kusy;
  if (PAGE === "popki" && Array.isArray(data?.popki)) return data.popki;
  if (Array.isArray(data?.popki)) return data.popki;
  if (Array.isArray(data?.kusy)) return data.kusy;
  return [];
}

function totalCount(groups) {
  return groups.reduce((sum, g) => sum + Number(g.count || (g.items || []).length || 0), 0);
}

function firstSeconds(group) {
  const values = (group.items || [])
    .map(x => Number(x.seconds || 0))
    .filter(x => Number.isFinite(x));
  if (values.length) return Math.min(...values);
  return Number(group.first_seconds || 0);
}

function getSavedUser() {
  try {
    const raw = localStorage.getItem("twitch_user");
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveUser(user) {
  AUTH_USER = user || null;
  USER_STATE = null;
  LAST_RANK_SYNC_KEY = "";
  if (AUTH_USER) {
    localStorage.setItem("twitch_user", JSON.stringify(AUTH_USER));
    loadLocalUserState();
  } else {
    localStorage.removeItem("twitch_user");
  }
  updateAchievementsNavLock();
}

function baseRedirectUri() {
  const path = window.location.pathname.replace(/\/(index|popki|schedule|achievements|romance)\.html$/i, "/");
  return window.location.origin + path;
}

function currentPageFile() {
  const last = window.location.pathname.split("/").pop();
  if (!last || !last.endsWith(".html")) return PAGE === "popki" ? "popki.html" : "index.html";
  return last;
}

function makeState() {
  const state = crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  localStorage.setItem("twitch_oauth_state", state);
  localStorage.setItem("twitch_return_page", currentPageFile());
  return state;
}

function twitchLoginUrl() {
  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID.trim(),
    redirect_uri: baseRedirectUri(),
    response_type: "token",
    state: makeState(),
    force_verify: "false",
  });
  if (TWITCH_SCOPES.trim()) params.set("scope", TWITCH_SCOPES.trim());
  return "https://id.twitch.tv/oauth2/authorize?" + params.toString();
}

async function fetchTwitchUser(token) {
  const res = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      "Authorization": "Bearer " + token,
      "Client-Id": TWITCH_CLIENT_ID.trim(),
    }
  });
  if (!res.ok) throw new Error("Twitch не отдал профиль пользователя. Проверь Client ID и Redirect URL.");
  const json = await res.json();
  const user = json?.data?.[0];
  if (!user?.login) throw new Error("Не смог получить Twitch login");
  return {
    login: user.login,
    display_name: user.display_name || user.login,
    profile_image_url: user.profile_image_url || "",
  };
}

async function handleTwitchCallback() {
  const hashText = window.location.hash.replace(/^#/, "");
  if (!hashText) return;
  const hash = new URLSearchParams(hashText);

  const error = hash.get("error");
  if (error) {
    const desc = hash.get("error_description") || error;
    window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    alert("Twitch вход не сработал: " + desc);
    return;
  }

  const token = hash.get("access_token");
  if (!token) return;

  const expectedState = localStorage.getItem("twitch_oauth_state");
  const returnedState = hash.get("state");
  window.history.replaceState({}, document.title, window.location.pathname + window.location.search);

  if (expectedState && returnedState && expectedState !== returnedState) {
    alert("Twitch вход отменён: state не совпал. Попробуй войти ещё раз.");
    return;
  }

  try {
    const user = await fetchTwitchUser(token);
    saveUser(user);
    localStorage.removeItem("twitch_oauth_state");

    const returnPage = localStorage.getItem("twitch_return_page");
    localStorage.removeItem("twitch_return_page");
    if (returnPage && returnPage !== currentPageFile()) {
      const basePath = window.location.pathname.replace(/[^/]*$/, "");
      window.location.replace(basePath + returnPage);
    }
  } catch (err) {
    console.error(err);
    alert("Не получилось войти через Twitch: " + err.message);
  }
}

function findUserRank(login) {
  const list = DATA?.top_chosen || [];
  const idx = list.findIndex(x => sameUser(x.user, login));
  if (idx < 0) return null;
  return { place: idx + 1, count: list[idx].count, user: list[idx].user };
}

function renderAuth() {
  const loginBtn = $("loginTwitch");
  const logoutBtn = $("logoutTwitch");
  const authTitle = $("authTitle");
  const authStatus = $("authStatus");
  if (!loginBtn || !logoutBtn || !authTitle || !authStatus) return;

  if (!AUTH_USER) {
    loginBtn.hidden = false;
    logoutBtn.hidden = true;
    authTitle.textContent = "Найди себя в топе";
    authStatus.textContent = "Войди через Twitch — подсвечу твой ник и покажу место.";
    return;
  }

  loginBtn.hidden = true;
  logoutBtn.hidden = false;
  const display = AUTH_USER.display_name || AUTH_USER.login;
  const rank = findUserRank(AUTH_USER.login);
  authTitle.textContent = `Ты вошёл как ${display}`;
  if (rank) {
    authStatus.innerHTML = `Ты в топе: <b>#${esc(rank.place)}</b>, тебя выбрало <b>${esc(rank.count)}</b> раз.`;
  } else {
    authStatus.textContent = "Твоего ника пока нет в топе на этой странице.";
  }
}

function setupAuthButtons() {
  const loginBtn = $("loginTwitch");
  const logoutBtn = $("logoutTwitch");
  loginBtn?.addEventListener("click", () => {
    if (!TWITCH_CLIENT_ID || TWITCH_CLIENT_ID === "PASTE_TWITCH_CLIENT_ID_HERE") {
      alert("Сначала вставь Twitch Идентификатор клиента в script.js в переменную TWITCH_CLIENT_ID.");
      return;
    }
    window.location.href = twitchLoginUrl();
  });
  logoutBtn?.addEventListener("click", () => {
    saveUser(null);
    render();
  });
}

function achievementsApiReady() {
  return Boolean(
    ACHIEVEMENTS_API_URL &&
    !ACHIEVEMENTS_API_URL.includes("__ACHIEVEMENTS_API_URL__") &&
    !ACHIEVEMENTS_API_URL.includes("PASTE_GOOGLE_APPS_SCRIPT") &&
    /^https?:\/\//i.test(ACHIEVEMENTS_API_URL)
  );
}

function userAchievementsSet() {
  return new Set(Array.isArray(USER_STATE?.achievements) ? USER_STATE.achievements : []);
}

function getAchievementDef(id) {
  return ACHIEVEMENT_DEFS.find(a => a.id === id) || { id, icon: "🏅", title: id, desc: "Достижение открыто.", hidden: false };
}

function localStateKey(login = AUTH_USER?.login) {
  return "achievements_state_" + cleanLogin(login || "guest");
}

function defaultUserState(user = AUTH_USER) {
  const login = cleanLogin(user?.login || "");
  return {
    login,
    display_name: user?.display_name || login,
    profile_image_url: user?.profile_image_url || "",
    cat_pets: 0,
    d20_rolls: 0,
    best_d20: 0,
    last_d20: "",
    achievements: [],
    recent20: [],
    updated_at: new Date().toISOString(),
  };
}

function normalizeUserState(state, user = AUTH_USER) {
  const base = defaultUserState(user);
  const merged = { ...base, ...(state || {}) };
  merged.login = cleanLogin(merged.login || user?.login || "");
  merged.cat_pets = Number(merged.cat_pets || 0);
  merged.d20_rolls = Number(merged.d20_rolls || 0);
  merged.best_d20 = Number(merged.best_d20 || 0);
  merged.achievements = Array.isArray(merged.achievements) ? merged.achievements : [];
  merged.recent20 = Array.isArray(merged.recent20) ? merged.recent20 : [];
  return merged;
}

function loadLocalUserState() {
  if (!AUTH_USER) return null;
  try {
    const raw = localStorage.getItem(localStateKey());
    USER_STATE = normalizeUserState(raw ? JSON.parse(raw) : null);
  } catch (_) {
    USER_STATE = defaultUserState();
  }
  localStorage.setItem("catPets", String(USER_STATE.cat_pets || 0));
  return USER_STATE;
}

function saveLocalUserState() {
  if (!AUTH_USER || !USER_STATE) return;
  USER_STATE = normalizeUserState(USER_STATE);
  USER_STATE.updated_at = new Date().toISOString();
  localStorage.setItem(localStateKey(), JSON.stringify(USER_STATE));
  localStorage.setItem("catPets", String(USER_STATE.cat_pets || 0));
}

function ensureUserState() {
  if (!AUTH_USER) return null;
  if (!USER_STATE) loadLocalUserState();
  if (!USER_STATE) USER_STATE = defaultUserState();
  return USER_STATE;
}

function unlockLocalAchievement(id, notify = true) {
  const state = ensureUserState();
  if (!state) return false;
  if (!state.achievements.includes(id)) {
    state.achievements.push(id);
    saveLocalUserState();
    if (notify) showAchievementToast(id);
    renderAchievementsPage();
    return true;
  }
  return false;
}

function mergeRemoteState(remote) {
  if (!AUTH_USER || !remote) return;
  const local = ensureUserState() || defaultUserState();
  const remoteAchievements = Array.isArray(remote.achievements) ? remote.achievements : [];
  USER_STATE = normalizeUserState({
    ...local,
    ...remote,
    cat_pets: Math.max(Number(local.cat_pets || 0), Number(remote.cat_pets || 0)),
    d20_rolls: Math.max(Number(local.d20_rolls || 0), Number(remote.d20_rolls || 0)),
    best_d20: Math.max(Number(local.best_d20 || 0), Number(remote.best_d20 || 0)),
    achievements: remoteAchievements,
  });
  saveLocalUserState();
}

function updateCatCounterFromState() {
  const catCount = document.getElementById("catCount");
  if (!catCount || !AUTH_USER || USER_STATE?.cat_pets == null) return;
  const visible = Number(catCount.textContent || 0);
  const saved = Number(USER_STATE.cat_pets || 0);
  catCount.textContent = String(Math.max(visible, saved));
}

function updateAchievementsNavLock() {
  document.querySelectorAll(".achievements-nav-link").forEach((a) => {
    if (AUTH_USER) {
      a.classList.remove("auth-required");
      a.removeAttribute("title");
    } else {
      a.classList.add("auth-required");
      a.setAttribute("title", "Нужно войти через Twitch");
    }
  });
}

function setupAchievementsNav() {
  document.querySelectorAll(".achievements-nav-link").forEach((a) => {
    const warn = () => {
      if (!AUTH_USER) showSmallSiteNotice("Сначала войди через Twitch, чтобы открыть достижения.");
    };
    a.addEventListener("mouseenter", warn);
    a.addEventListener("focus", warn);
    a.addEventListener("click", (e) => {
      if (!AUTH_USER) {
        e.preventDefault();
        warn();
      }
    });
  });
  updateAchievementsNavLock();
}

function showSmallSiteNotice(text) {
  let box = document.getElementById("siteNotice");
  if (!box) {
    box = document.createElement("div");
    box.id = "siteNotice";
    box.className = "site-notice";
    document.body.appendChild(box);
  }
  box.textContent = text;
  box.classList.add("show");
  clearTimeout(showSmallSiteNotice._timer);
  showSmallSiteNotice._timer = setTimeout(() => box.classList.remove("show"), 2200);
}

function showAchievementToast(achievementId) {
  const def = getAchievementDef(achievementId);
  let holder = document.getElementById("achievementToastHolder");
  if (!holder) {
    holder = document.createElement("div");
    holder.id = "achievementToastHolder";
    holder.className = "achievement-toast-holder";
    document.body.appendChild(holder);
  }

  const toast = document.createElement("button");
  toast.type = "button";
  toast.className = "achievement-toast";
  toast.innerHTML = `
    <span class="achievement-toast-glow"></span>
    <b>${esc(def.icon)} Достижение открыто!</b>
    <strong>${esc(def.title)}</strong>
    <small>${esc(def.desc || "Нажми, чтобы закрыть")}</small>
    <em>Нажми, чтобы закрыть</em>
  `;

  const closeToast = () => {
    clearTimeout(toast._closeTimer);
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 260);
  };

  toast.addEventListener("click", closeToast);
  holder.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 20);
  toast._closeTimer = setTimeout(closeToast, 30000);
}

function applyApiState(payload) {
  if (!payload || !payload.ok) return;
  const before = userAchievementsSet();
  mergeRemoteState(payload.user || null);

  const newly = Array.isArray(payload.newly_unlocked) ? payload.newly_unlocked : [];
  newly.forEach((id) => {
    if (!before.has(id)) showAchievementToast(id);
    unlockLocalAchievement(id, false);
  });

  updateCatCounterFromState();
  renderAchievementsPage();
}

async function sendAchievementEvent(action, value = {}) {
  if (!AUTH_USER || !achievementsApiReady()) return null;

  const payload = {
    action,
    value,
    page: PAGE,
    user: {
      login: AUTH_USER.login,
      display_name: AUTH_USER.display_name || AUTH_USER.login,
      profile_image_url: AUTH_USER.profile_image_url || "",
    }
  };

  try {
    const res = await fetch(ACHIEVEMENTS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    applyApiState(json);
    return json;
  } catch (err) {
    console.warn("Не удалось обновить достижения:", err);
    return null;
  }
}

async function loadRemoteUserState() {
  if (!AUTH_USER || !achievementsApiReady()) {
    renderAchievementsPage();
    return;
  }
  await sendAchievementEvent("get", {});
}

async function syncRankAchievement() {
  if (!AUTH_USER || !DATA || PAGE === "popki") return;
  const rank = findUserRank(AUTH_USER.login);
  if (!rank) return;

  const key = `${AUTH_USER.login}:${PAGE}:${rank.place}:${rank.count}`;
  if (LAST_RANK_SYNC_KEY === key) return;
  LAST_RANK_SYNC_KEY = key;

  await sendAchievementEvent("rank_sync", {
    place: rank.place,
    count: rank.count,
    source_page: PAGE,
  });
}

function queueCatPetSync(amount = 1) {
  if (!AUTH_USER || !achievementsApiReady()) return;
  CAT_PET_PENDING += Math.max(1, Number(amount || 1));
  clearTimeout(CAT_PET_TIMER);
  CAT_PET_TIMER = setTimeout(flushCatPetSync, 700);
}

async function flushCatPetSync() {
  if (CAT_PET_SYNCING || CAT_PET_PENDING <= 0) return;
  CAT_PET_SYNCING = true;
  const amount = CAT_PET_PENDING;
  CAT_PET_PENDING = 0;
  await sendAchievementEvent("cat_pet", { amount });
  CAT_PET_SYNCING = false;
  if (CAT_PET_PENDING > 0) {
    clearTimeout(CAT_PET_TIMER);
    CAT_PET_TIMER = setTimeout(flushCatPetSync, 350);
  }
}

function recordCatPet() {
  if (!AUTH_USER) return;
  const state = ensureUserState();
  state.cat_pets = Number(state.cat_pets || 0) + 1;
  saveLocalUserState();
  updateCatCounterFromState();
  queueCatPetSync(1);
}

async function recordD20Roll(value) {
  if (!AUTH_USER) return;
  const roll = Math.max(1, Math.min(20, Number(value) || 0));
  const state = ensureUserState();
  state.d20_rolls = Number(state.d20_rolls || 0) + 1;
  state.last_d20 = roll;
  state.best_d20 = Math.max(Number(state.best_d20 || 0), roll);
  saveLocalUserState();
  renderAchievementsPage();
  await sendAchievementEvent("d20_roll", { roll });
}

function renderAchievementsPage() {
  if (PAGE !== "achievements") return;

  const locked = document.getElementById("achLocked");
  const grid = document.getElementById("achievementsGrid");
  const msg = document.getElementById("achievementsMessage");
  if (!locked || !grid) return;

  if (!AUTH_USER) {
    locked.hidden = false;
    grid.innerHTML = "";
    if (msg) msg.innerHTML = "";
    setText("achUnlockedCount", "0");
    setText("achCatPets", "0");
    setText("achBestD20", "—");
    return;
  }

  locked.hidden = true;

  if (!achievementsApiReady()) {
    if (msg) msg.innerHTML = `<div class="error">Сохранение достижений пока не настроено.</div>`;
  } else if (msg) {
    msg.innerHTML = "";
  }

  const earned = userAchievementsSet();
  const visibleDefs = ACHIEVEMENT_DEFS.filter(a => !a.hidden || earned.has(a.id));

  setText("achUnlockedCount", String(earned.size));
  setText("achCatPets", String(USER_STATE?.cat_pets ?? 0));
  setText("achBestD20", USER_STATE?.best_d20 ? String(USER_STATE.best_d20) : "—");

  grid.innerHTML = visibleDefs.map((a) => {
    const unlocked = earned.has(a.id);
    return `
      <article class="achievement-card ${unlocked ? "unlocked" : "locked"} ${a.hidden ? "secret" : ""}">
        <div class="achievement-icon">${esc(a.icon)}</div>
        <div>
          <h3>${esc(a.title)}</h3>
          <p>${esc(a.desc)}</p>
          <span class="achievement-status">${unlocked ? "Открыто" : "Не открыто"}</span>
        </div>
      </article>
    `;
  }).join("");
}

async function loadData() {
  const res = await fetch(DATA_URL + "?v=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("Не смог загрузить " + DATA_URL);
  DATA = await res.json();
  render();
}

function renderSource(meta = {}) {
  const source = meta.source || "—";
  const sourceUrl = meta.source_url || (typeof source === "string" && source.startsWith("http") ? source : "");
  const urls = Array.isArray(meta.source_urls) ? meta.source_urls.filter(Boolean) : [];

  if (source && source !== "—") {
    if (sourceUrl) {
      setHTML("sourceName", `<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(source)}</a>`);
    } else {
      setText("sourceName", source);
    }
  } else if (urls.length) {
    setHTML("sourceName", urls.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">Источник ${i + 1}</a>`).join("<br>"));
  } else {
    setText("sourceName", "Статистика из Twitch-чата");
  }
}

function render() {
  const groups = getGroups(DATA);
  const meta = DATA?.meta || {};
  document.title = meta.title || (PAGE === "kus" ? "🫦 Статистика кусей" : PAGE === "popki" ? "🍑 Топ попок" : PAGE === "schedule" ? "📅 Расписание" : "🏅 Достижения");
  renderSource(meta);
  renderAuth();
  updateAchievementsNavLock();

  if (PAGE === "achievements") {
    renderAchievementsPage();
    return;
  }

  setText("total", String(meta.total ?? totalCount(groups)));
  setText("groups", String(meta.groups ?? groups.length));
  setText("leaders", String((DATA?.top_chosen || []).length));

  renderTop();
  renderGroups(groups);
}

function renderTop() {
  const q = norm($("search")?.value?.trim());
  const top = (DATA?.top_chosen || [])
    .filter(x => !q || norm(x.user).includes(q))
    .slice(0, 100);

  setHTML("top", top.length ? top.map((x, i) => `
    <div class="leader ${AUTH_USER && sameUser(x.user, AUTH_USER.login) ? "is-me" : ""}">
      <div class="leader-left">
        <span class="rank">#${i + 1}</span>
        <span class="name">${esc(x.user)}</span>
      </div>
      <div class="count">${esc(x.count)} раз</div>
    </div>
  `).join("") : `<div class="empty">Ничего не найдено</div>`);
}

function itemMatchesQuery(item, q) {
  return norm(item.command).includes(q)
    || norm(item.chooser || item.user).includes(q)
    || norm(item.chosen_user).includes(q)
    || norm(item.bot_reply).includes(q);
}

function renderGroups(allGroups) {
  const q = norm($("search")?.value?.trim());
  const sort = $("sort")?.value || "count";
  let groups = [...allGroups];

  if (q) {
    groups = groups.filter(g =>
      norm(g.title).includes(q)
      || (g.chosen_users || []).some(u => norm(u.user).includes(q))
      || (g.items || []).some(item => itemMatchesQuery(item, q))
    );
  }

  if (sort === "name") {
    groups.sort((a, b) => norm(a.title).localeCompare(norm(b.title), "ru"));
  } else if (sort === "time") {
    groups.sort((a, b) => firstSeconds(a) - firstSeconds(b));
  } else if (sort === "chosen") {
    groups.sort((a, b) => (b.chosen_users || []).length - (a.chosen_users || []).length);
  } else {
    groups.sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || norm(a.title).localeCompare(norm(b.title), "ru"));
  }

  setHTML("message", groups.length ? "" : `<div class="empty">Ничего не найдено</div>`);
  setHTML("items", groups.map(renderCard).join(""));
}

function renderCard(group) {
  const users = (group.chosen_users || []).slice(0, 12).map(u =>
    `<span class="user-chip ${AUTH_USER && sameUser(u.user, AUTH_USER.login) ? "is-me" : ""}">${esc(u.user)}${Number(u.count) > 1 ? ` <b>x${esc(u.count)}</b>` : ""}</span>`
  ).join("");

  const items = (group.items || []).slice(0, 80).map(it => `
    <div class="item">
      <div class="item-line"><span class="time">[${esc(it.time)}]</span> <span class="chooser">${esc(it.chooser || it.user || "???")}</span> → <b class="${AUTH_USER && sameUser(it.chosen_user, AUTH_USER.login) ? "is-me-text" : ""}">${esc(it.chosen_user || "не определено")}</b></div>
      <div class="command">${esc(it.command)}</div>
      ${it.bot_reply ? `<div class="bot">Mara_Nei [${esc(it.bot_time || "")}] ${esc(it.bot_reply)}</div>` : ""}
    </div>
  `).join("");

  const more = (group.items || []).length > 80
    ? `<div class="more">Показаны первые 80 из ${esc((group.items || []).length)}.</div>`
    : "";

  const itemCount = Number(group.count || (group.items || []).length || 0);
  const chosenCount = (group.chosen_users || []).length;

  return `
    <article class="card ${DETAILS_OPEN ? "open" : ""}" onclick="if(event.target.tagName !== 'A') this.classList.toggle('open')">
      <div class="card-head">
        <div>
          <h3>${esc(group.title || "Кусь")}</h3>
          <div class="card-sub">${itemCount} совпадений · ${chosenCount} выбранных</div>
        </div>
        <div class="card-count">${esc(itemCount)}</div>
      </div>
      <div class="users-block">
        <div class="users-title">Кого выбрало</div>
        <div class="user-chips">${users || '<span class="user-chip">—</span>'}</div>
      </div>
      <div class="hint">Нажми на карточку, чтобы раскрыть подробности</div>
      <div class="details">${items || `<div class="item">Нет подробностей</div>`}${more}</div>
    </article>
  `;
}

$("search")?.addEventListener("input", () => {
  renderTop();
  renderGroups(getGroups(DATA || {}));
});
$("sort")?.addEventListener("change", () => renderGroups(getGroups(DATA || {})));
$("toggleDetails")?.addEventListener("click", () => {
  DETAILS_OPEN = !DETAILS_OPEN;
  setText("toggleDetails", DETAILS_OPEN ? "Скрыть детали" : "Показать детали");
  renderGroups(getGroups(DATA || {}));
});

AUTH_USER = getSavedUser();
if (AUTH_USER) loadLocalUserState();
setupAuthButtons();
setupAchievementsNav();
handleTwitchCallback().finally(async () => {
  try {
    if (PAGE === "schedule") {
      renderAuth();
      updateAchievementsNavLock();
      await loadSchedulePage();
      return;
    }

    await loadData();
    if (AUTH_USER) {
      await syncRankAchievement();
      await loadRemoteUserState();
      await syncRankAchievement();
      render();
    }
  } catch (err) {
    setText("sourceName", "Ошибка загрузки данных");
    const target = PAGE === "achievements" ? "achievementsMessage" : "message";
    setHTML(target, `<div class="error">
      Не удалось загрузить <b>${esc(DATA_URL)}</b>.<br>
      ${PAGE === "popki"
        ? "Для страницы попок нужен файл <code>data/popki_site_data.json</code>. В парсере включи ползунок “Попки” и сохрани JSON сайта."
        : PAGE === "schedule"
          ? "Для страницы расписания нужен файл <code>data/schedule.json</code>."
          : "Для главной страницы и достижений нужен файл <code>data/kus_site_data.json</code>."}
    </div>`);
  }
});

(function initBackgroundMusic(){
  const music = document.getElementById("bgMusic");
  const btn = document.getElementById("musicToggle");
  if (!music || !btn) return;

  const MUSIC_VOLUME = 0.14;
  const MUSIC_TIME_KEY = "bgMusicTime";
  const MUSIC_UPDATED_KEY = "bgMusicTimeUpdatedAt";

  music.volume = MUSIC_VOLUME;
  let enabled = localStorage.getItem("bgMusicOff") !== "1";
  let playing = false;
  let saveTimer = null;

  function safeSavedTime(){
    const value = Number(localStorage.getItem(MUSIC_TIME_KEY) || 0);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  function restoreMusicPosition(){
    const saved = safeSavedTime();
    if (!saved) return;

    if (Number.isFinite(music.duration) && music.duration > 0) {
      music.currentTime = Math.min(saved, Math.max(0, music.duration - 0.5));
    } else {
      music.currentTime = saved;
    }
  }

  function saveMusicPosition(){
    if (!music || !Number.isFinite(music.currentTime)) return;
    localStorage.setItem(MUSIC_TIME_KEY, String(music.currentTime));
    localStorage.setItem(MUSIC_UPDATED_KEY, String(Date.now()));
  }

  function startSavingPosition(){
    if (saveTimer) return;
    saveTimer = setInterval(saveMusicPosition, 700);
  }

  function stopSavingPosition(){
    if (!saveTimer) return;
    clearInterval(saveTimer);
    saveTimer = null;
  }

  function updateMusicButton(){
    if (!enabled) {
      btn.textContent = "🔇";
      btn.classList.add("is-off");
      btn.title = "Включить музыку";
      btn.setAttribute("aria-label", "Включить музыку");
    } else if (playing) {
      btn.textContent = "🔊";
      btn.classList.remove("is-off");
      btn.title = "Выключить музыку";
      btn.setAttribute("aria-label", "Выключить музыку");
    } else {
      btn.textContent = "🎵";
      btn.classList.remove("is-off");
      btn.title = "Включить музыку";
      btn.setAttribute("aria-label", "Включить музыку");
    }
  }

  async function tryPlayMusic(){
    if (!enabled) return;
    try {
      music.volume = MUSIC_VOLUME;
      if (music.readyState >= 1) restoreMusicPosition();
      await music.play();
      playing = true;
      startSavingPosition();
    } catch (_) {
      playing = false;
    }
    updateMusicButton();
  }

  function stopMusic(){
    saveMusicPosition();
    music.pause();
    playing = false;
    stopSavingPosition();
    updateMusicButton();
  }

  music.addEventListener("loadedmetadata", restoreMusicPosition, { once: true });
  music.addEventListener("timeupdate", saveMusicPosition);
  music.addEventListener("pause", saveMusicPosition);
  music.addEventListener("ended", () => {
    localStorage.setItem(MUSIC_TIME_KEY, "0");
  });

  window.addEventListener("pagehide", saveMusicPosition);
  window.addEventListener("beforeunload", saveMusicPosition);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveMusicPosition();
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (enabled && playing) {
      enabled = false;
      localStorage.setItem("bgMusicOff", "1");
      stopMusic();
      return;
    }

    if (enabled && !playing) {
      tryPlayMusic();
      return;
    }

    enabled = true;
    localStorage.removeItem("bgMusicOff");
    tryPlayMusic();
  });

  function startAfterFirstInteraction(e){
    if (e?.target?.closest?.("#musicToggle")) return;
    tryPlayMusic();
    document.removeEventListener("pointerdown", startAfterFirstInteraction);
    document.removeEventListener("keydown", startAfterFirstInteraction);
  }

  if (enabled) {
    tryPlayMusic();
    document.addEventListener("pointerdown", startAfterFirstInteraction);
    document.addEventListener("keydown", startAfterFirstInteraction);
  }

  updateMusicButton();
})();

(function initPetCat(){
  const petCat = document.getElementById("petCat");
  const catBubble = document.getElementById("catBubble");
  const catCount = document.getElementById("catCount");
  const catPurrSound = document.getElementById("catPurrSound");
  if (!petCat || !catBubble || !catCount) return;

  let pets = AUTH_USER ? Number(ensureUserState()?.cat_pets || 0) : Number(localStorage.getItem("catPets") || 0);
  catCount.textContent = String(pets);

  const catPhrases = [
    "мур-р-р ♡",
    "мяу",
    "ещё!",
    "приятно",
    "пурр",
    "люблю куси",
    "я охраняю топ"
  ];

  function playCatPurr(){
    if (!catPurrSound) return;
    try {
      catPurrSound.pause();
      catPurrSound.currentTime = 0;
      catPurrSound.volume = 0.32;
      const promise = catPurrSound.play();
      if (promise && typeof promise.catch === "function") promise.catch(() => {});
    } catch (_) {}
  }

  function petTheCat(){
    if (AUTH_USER) {
      const state = ensureUserState();
      state.cat_pets = Number(state.cat_pets || 0) + 1;
      pets = Number(state.cat_pets || 0);
      saveLocalUserState();
      catCount.textContent = String(pets);
      queueCatPetSync(1);
      renderAchievementsPage();
    } else {
      pets += 1;
      localStorage.setItem("catPets", String(pets));
      catCount.textContent = String(pets);
    }

    catBubble.textContent = catPhrases[Math.floor(Math.random() * catPhrases.length)];
    petCat.classList.add("happy", "pet-shake");
    playCatPurr();

    const heart = document.createElement("div");
    heart.className = "cat-heart";
    heart.textContent = Math.random() > 0.18 ? "❤" : "★";
    petCat.appendChild(heart);

    setTimeout(() => heart.remove(), 900);
    setTimeout(() => petCat.classList.remove("pet-shake"), 360);
    setTimeout(() => petCat.classList.remove("happy"), 650);
  }

  petCat.addEventListener("click", petTheCat);
  petCat.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      petTheCat();
    }
  });
})();

(function initD20Widget(){
  const d20Widget = document.getElementById("d20Widget");
  const d20Bubble = document.getElementById("d20Bubble");
  const d20Dice = document.getElementById("d20Dice");
  const d20Main = document.getElementById("d20Main");
  if (!d20Widget || !d20Bubble || !d20Dice || !d20Main) return;

  let d20Rolling = false;

  function randomD20(min = 1, max = 20) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function paintD20(value) {
    d20Main.textContent = String(value);
  }

  function showD20Bubble(text = "Скоро будет") {
    d20Bubble.textContent = text;
    d20Widget.classList.add("show-bubble");
    clearTimeout(showD20Bubble._timer);
    showD20Bubble._timer = setTimeout(() => {
      d20Widget.classList.remove("show-bubble");
    }, 1500);
  }

  function addD20Spark() {
    const spark = document.createElement("div");
    spark.className = "d20-spark";
    spark.textContent = Math.random() > 0.5 ? "✦" : "✧";
    d20Widget.appendChild(spark);
    setTimeout(() => spark.remove(), 900);
  }

  function rollD20() {
    if (d20Rolling) return;
    d20Rolling = true;

    showD20Bubble("Скоро будет");
    addD20Spark();

    const rx = randomD20(-7, 7);
    const ry = randomD20(-7, 7);
    const rz = 720 + randomD20(0, 220);

    d20Dice.style.setProperty("--rx", `${rx}deg`);
    d20Dice.style.setProperty("--ry", `${ry}deg`);
    d20Dice.style.setProperty("--rz", `${rz}deg`);

    d20Dice.classList.remove("rolling");
    void d20Dice.offsetWidth;
    d20Dice.classList.add("rolling");

    const shuffle = setInterval(() => {
      paintD20(randomD20());
    }, 75);

    const finalMain = randomD20();

    setTimeout(() => {
      clearInterval(shuffle);
      paintD20(finalMain);
      recordD20Roll(finalMain);
    }, 980);

    setTimeout(() => {
      d20Dice.classList.remove("rolling");
      d20Rolling = false;
    }, 1180);
  }

  paintD20(20);
  d20Dice.addEventListener("click", (e) => {
    e.preventDefault();
    rollD20();
  });
})();


function scheduleStatusLabel(status) {
  if (status === "video") return "видео";
  if (status === "stream") return "стрим";
  return "offline";
}

function scheduleStatusClass(status) {
  if (status === "video") return "schedule-video";
  if (status === "stream") return "schedule-stream";
  return "schedule-offline";
}

async function loadSchedulePage() {
  if (PAGE !== "schedule") return;

  const board = document.getElementById("scheduleBoard");
  const strip = document.getElementById("scheduleWeekStrip");
  const month = document.getElementById("scheduleMonth");
  const next = document.getElementById("scheduleNext");
  if (!board || !strip) return;

  try {
    const res = await fetch("data/schedule.json?v=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("Не смог загрузить data/schedule.json");
    const schedule = await res.json();
    const days = Array.isArray(schedule.days) ? schedule.days : [];
    const meta = schedule.meta || {};

    if (month) month.textContent = meta.month || "06.2026";

    const weekdayMap = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
    const now = new Date();
    const todayDay = weekdayMap[now.getDay()];
    const todayDate = now.getDate();

    let todayIndex = days.findIndex((d) => Number(d.date) === todayDate);
    if (todayIndex === -1) {
      todayIndex = days.findIndex((d) => String(d.day || "").toUpperCase() === todayDay);
    }

    strip.innerHTML = days.map((d, idx) => `
      <div class="week-day ${idx === todayIndex ? "is-today" : ""}">
        <span>${esc(d.day || "")}</span>
        <b>${esc(d.date || "")}</b>
      </div>
    `).join("");

    board.innerHTML = days.map((d, idx) => {
      const status = String(d.status || "offline").toLowerCase();
      const isOffline = status === "offline";
      const time = d.time || (!isOffline ? meta.default_time : "");
      const title = d.title || scheduleStatusLabel(status);
      return `
        <article class="schedule-card ${scheduleStatusClass(status)} ${idx === todayIndex ? "is-today" : ""}">
          <div class="schedule-card-day">${esc(d.day || "")}</div>
          <div class="schedule-card-main">
            <div class="schedule-toggle ${isOffline ? "" : "on"}"><span></span></div>
            <div>
              <h3>${esc(title)}</h3>
              ${d.note ? `<p>${esc(d.note)}</p>` : ""}
              ${time ? `<em>${esc(time)}</em>` : ""}
            </div>
          </div>
        </article>
      `;
    }).join("");

    let upcomingIndex = -1;
    if (todayIndex !== -1) {
      for (let offset = 0; offset < days.length; offset += 1) {
        const idx = (todayIndex + offset) % days.length;
        if (String(days[idx]?.status || "offline").toLowerCase() !== "offline") {
          upcomingIndex = idx;
          break;
        }
      }
    }
    if (upcomingIndex === -1) {
      upcomingIndex = days.findIndex((d) => String(d.status || "offline").toLowerCase() !== "offline");
    }

    if (next) {
      if (upcomingIndex !== -1) {
        const upcoming = days[upcomingIndex];
        const time = upcoming.time || meta.default_time || "";
        const prefix = upcomingIndex === todayIndex ? "Сегодня" : "Ближайшее";
        next.innerHTML = `
          <b>${esc(prefix)} · ${esc(upcoming.day || "")} · ${esc(upcoming.title || "")}</b>
          <span>${esc(time)}</span>
        `;
      } else {
        next.textContent = "На этой неделе только отдых.";
      }
    }
  } catch (err) {
    board.innerHTML = `<div class="error">Не удалось загрузить расписание: ${esc(err.message || err)}</div>`;
    if (next) next.textContent = "Ошибка загрузки";
  }
}


/* ===== HARD OVERRIDE: achievements page fetch render ===== */
(function hardAchievementsFetchOverride() {
  let achievementsLoading = false;
  let achievementsLoaded = false;

  function isAchievementsPage() {
    return document.body?.dataset?.page === "achievements" || /achievements\.html$/i.test(location.pathname);
  }

  function hEsc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function hSet(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function hMsg(text, isError = false) {
    const msg = document.getElementById("achievementsMessage");
    if (!msg) return;

    if (!text) {
      msg.innerHTML = "";
      return;
    }

    msg.innerHTML = `<div class="${isError ? "error" : "debug-box"}">${hEsc(text)}</div>`;
  }

  function hGetUser() {
    try {
      const user = JSON.parse(localStorage.getItem("twitch_user") || "null");
      return user && user.login ? user : null;
    } catch (err) {
      hMsg("localStorage twitch_user не читается: " + err.message, true);
      return null;
    }
  }

  function hApiReady() {
    return Boolean(
      typeof ACHIEVEMENTS_API_URL !== "undefined" &&
      ACHIEVEMENTS_API_URL &&
      !ACHIEVEMENTS_API_URL.includes("__ACHIEVEMENTS_API_URL__") &&
      !ACHIEVEMENTS_API_URL.includes("PASTE_GOOGLE_APPS_SCRIPT") &&
      /^https?:\/\//i.test(ACHIEVEMENTS_API_URL)
    );
  }

  const hDefs = [
    { id: "top_1", icon: "👑", title: "Король топа", desc: "Попасть на 1 место в общем топе.", hidden: false },
    { id: "top_5", icon: "💎", title: "Топ-5", desc: "Попасть в первые 5 мест общего топа.", hidden: false },
    { id: "top_10", icon: "🏆", title: "Топ-10", desc: "Попасть в первые 10 мест общего топа.", hidden: false },
    { id: "top_20", icon: "⭐", title: "Топ-20", desc: "Попасть в первые 20 мест общего топа.", hidden: false },
    { id: "cat_10", icon: "🐾", title: "Котик доверяет", desc: "Погладить кота 10 раз.", hidden: false },
    { id: "cat_20", icon: "😺", title: "Любимчик кота", desc: "Погладить кота 20 раз.", hidden: false },
    { id: "hidden_cat_100", icon: "🐈‍⬛", title: "Тайный кошачий друг", desc: "Скрытое достижение.", hidden: true },
    { id: "hidden_three_20", icon: "🎲", title: "Критическая удача", desc: "Скрытое достижение.", hidden: true },
    { id: "hidden_jump_lila", icon: "🖤", title: "Прыжок к lilanei", desc: "Скрытое достижение.", hidden: true },
    { id: "hidden_lilanei_warmth", icon: "🖤", title: "Тёплая искра", desc: "Скрытое достижение.", hidden: true },
    { id: "hidden_lilanei_trust", icon: "🌙", title: "Тихое доверие", desc: "Скрытое достижение.", hidden: true },
    { id: "hidden_lilanei_close", icon: "💜", title: "Она остаётся рядом", desc: "Скрытое достижение.", hidden: true },
    { id: "hidden_lilanei_distance", icon: "🕯️", title: "Закрытая дверь", desc: "Скрытое достижение.", hidden: true },
  ];

  function hDef(id) {
    return hDefs.find((a) => a.id === id) || {
      id,
      icon: "🏅",
      title: id,
      desc: "Скрытое достижение.",
      hidden: true
    };
  }

  function hNormalizePayload(payload) {
    const user = payload?.user || payload?.public_user || payload?.record || payload?.state || {};
    const achievements = Array.isArray(user.achievements)
      ? user.achievements
      : Array.isArray(payload?.achievements)
        ? payload.achievements
        : Array.isArray(payload?.parsed_achievements)
          ? payload.parsed_achievements
          : [];

    return { user, achievements };
  }

  function hPaint(payload) {
    const grid = document.getElementById("achievementsGrid");
    const locked = document.getElementById("achLocked");

    if (!grid) {
      hMsg("Не найден блок achievementsGrid в HTML", true);
      return;
    }

    const normalized = hNormalizePayload(payload);
    const serverUser = normalized.user;
    const achievements = normalized.achievements;

    const earned = new Set(achievements);
    const allIds = new Set(hDefs.map((a) => a.id));
    achievements.forEach((id) => allIds.add(id));

    const visible = [...allIds]
      .map(hDef)
      .filter((a) => !a.hidden || earned.has(a.id));

    if (locked) locked.hidden = true;
    hMsg("");

    hSet("achUnlockedCount", earned.size);
    hSet("achCatPets", Number(serverUser.cat_pets || 0));
    hSet("achBestD20", Number(serverUser.best_d20 || 0) || "—");

    grid.innerHTML = visible.map((a) => {
      const opened = earned.has(a.id);
      return `
        <article class="achievement-card ${opened ? "unlocked" : "locked"}">
          <div class="achievement-icon">${hEsc(a.icon)}</div>
          <div>
            <div class="achievement-title">${hEsc(a.title)}</div>
            <div class="achievement-desc">${hEsc(a.desc)}</div>
            <div class="achievement-state">${opened ? "Открыто" : "Не открыто"}</div>
          </div>
        </article>
      `;
    }).join("");

    window.__ACHIEVEMENTS_SERVER_PAYLOAD__ = payload;
  }

  async function hLoad() {
    if (!isAchievementsPage()) return;
    if (achievementsLoading || achievementsLoaded) return;

    achievementsLoading = true;

    const user = hGetUser();
    if (!user) {
      achievementsLoading = false;
      hMsg("Нет Twitch пользователя. Выйди и войди через Twitch заново.", true);
      return;
    }

    if (!hApiReady()) {
      achievementsLoading = false;
      hMsg("ACHIEVEMENTS_API_URL не подставился или неправильный.", true);
      return;
    }

    try {
      hMsg("Загружаю достижения...");

      const params = new URLSearchParams({
        action: "get",
        page: "achievements",
        login: user.login,
        display_name: user.display_name || user.login,
        profile_image_url: user.profile_image_url || ""
      });

      const url = ACHIEVEMENTS_API_URL + (ACHIEVEMENTS_API_URL.includes("?") ? "&" : "?") + params.toString();

      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
      });

      const text = await res.text();

      if (!res.ok) {
        throw new Error("HTTP " + res.status + ": " + text.slice(0, 240));
      }

      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_) {
        throw new Error("Ответ не JSON: " + text.slice(0, 240));
      }

      if (!json || json.ok === false) {
        throw new Error("Apps Script вернул ошибку: " + JSON.stringify(json).slice(0, 240));
      }

      achievementsLoaded = true;
      hPaint(json);
    } catch (err) {
      console.warn("fetch achievements load failed:", err);
      hMsg("Ошибка загрузки: " + (err && err.message ? err.message : String(err)), true);
    } finally {
      achievementsLoading = false;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hLoad, { once: true });
  } else {
    hLoad();
  }
})();

