const body = document.body;
const DATA_URL = body?.dataset?.file || "data/kus_site_data.json";
const PAGE = body?.dataset?.page || "kus";
let DATA = null;
let DETAILS_OPEN = false;

// 1) Создай приложение Twitch: https://dev.twitch.tv/console/apps
// 2) В OAuth Redirect URLs добавь адрес главной GitHub Pages страницы, например:
//    https://anicreek.github.io/REPO_NAME/
// 3) Вставь сюда "Идентификатор клиента". Client Secret сюда НЕ вставлять.
const TWITCH_CLIENT_ID = "lrvv741h9kzldosuxd5aw0k6jir7hv";
const TWITCH_SCOPES = ""; // для получения ника права не нужны
let AUTH_USER = null;

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
  if (AUTH_USER) localStorage.setItem("twitch_user", JSON.stringify(AUTH_USER));
  else localStorage.removeItem("twitch_user");
}

function baseRedirectUri() {
  // Для GitHub Pages удобнее всегда возвращаться на главную папку репозитория.
  // Поэтому в Twitch Redirect URLs добавляй именно URL с / на конце.
  const path = window.location.pathname.replace(/\/(index|popki)\.html$/i, "/");
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
  document.title = meta.title || (PAGE === "kus" ? "🫦 Статистика кусей" : "🍑 Топ попок");
  renderSource(meta);
  renderAuth();

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
setupAuthButtons();
handleTwitchCallback().finally(() => {
  loadData().catch(err => {
    setText("sourceName", "Ошибка загрузки данных");
    setHTML("message", `<div class="error">
      Не удалось загрузить <b>${esc(DATA_URL)}</b>.<br>
      ${PAGE === "kus"
        ? "Для главной страницы нужен файл <code>data/kus_site_data.json</code>. В парсере выключи ползунок “Попки” и сохрани JSON сайта."
        : "Для страницы попок нужен файл <code>data/popki_site_data.json</code>. В парсере включи ползунок “Попки” и сохрани JSON сайта."}
    </div>`);
  });
});
