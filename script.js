const body = document.body;
const DATA_URL = body?.dataset?.file || "data/kus_site_data.json";
const PAGE = body?.dataset?.page || "kus";
let DATA = null;
let DETAILS_OPEN = false;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
}[m]));
const $ = (id) => document.getElementById(id);
const norm = (s) => String(s ?? "").toLowerCase();
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

  if (sourceUrl) {
    setHTML("sourceUrl", `<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(sourceUrl)}</a>`);
  } else if (urls.length) {
    setHTML("sourceUrl", urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`).join("<br>"));
  } else {
    setText("sourceUrl", "—");
  }

  setText("dataFile", DATA_URL);
}

function render() {
  const groups = getGroups(DATA);
  const meta = DATA?.meta || {};
  document.title = meta.title || (PAGE === "kus" ? "🫦 Статистика кусей" : "🍑 Топ попок");
  renderSource(meta);

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
    <div class="leader">
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
    `<span class="user-chip">${esc(u.user)}${Number(u.count) > 1 ? ` <b>x${esc(u.count)}</b>` : ""}</span>`
  ).join("");

  const items = (group.items || []).slice(0, 80).map(it => `
    <div class="item">
      <div class="item-line"><span class="time">[${esc(it.time)}]</span> <span class="chooser">${esc(it.chooser || it.user || "???")}</span> → <b>${esc(it.chosen_user || "не определено")}</b></div>
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
          <div class="card-sub">${itemCount} ${PAGE === "popki" ? "совпадений" : "совпадений"} · ${chosenCount} выбранных</div>
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

loadData().catch(err => {
  setText("sourceName", "Ошибка загрузки данных");
  setText("sourceUrl", "—");
  setHTML("message", `<div class="error">
    Не удалось загрузить <b>${esc(DATA_URL)}</b>.<br>
    ${PAGE === "kus"
      ? "Для главной страницы нужен файл <code>data/kus_site_data.json</code>. В парсере выключи ползунок “Попки” и сохрани JSON сайта."
      : "Для страницы попок нужен файл <code>data/popki_site_data.json</code>. В парсере включи ползунок “Попки” и сохрани JSON сайта."}
  </div>`);
});
