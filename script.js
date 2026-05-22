const DATA_URL = "data/kus_site_data.json";
const FALLBACK_DATA_URL = "data/popki_site_data.json";
let DATA = null;
let USED_DATA_URL = DATA_URL;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[m]));

async function fetchJson(url){
  const res = await fetch(url, {cache:"no-store"});
  if(!res.ok) throw new Error("Не смог загрузить " + url);
  return await res.json();
}

async function loadData(){
  try{
    DATA = await fetchJson(DATA_URL);
    USED_DATA_URL = DATA_URL;
  }catch(err){
    DATA = await fetchJson(FALLBACK_DATA_URL);
    USED_DATA_URL = FALLBACK_DATA_URL;
  }
  render();
}

function getGroups(){
  return DATA.kusi || DATA.kus || DATA.items || DATA.popki || [];
}

function getGroupTitle(group){
  return group.title || group.name || group.command || "Неизвестный кусь";
}

function getChosenUsers(group){
  return group.chosen_users || group.users || [];
}

function getChooser(item){
  return item.chooser || item.user || item.author || "???";
}

function getChosen(item){
  return item.chosen_user || item.chosen || "не определено";
}

function getCommand(item){
  return item.command || item.text || item.message || "";
}

function render(){
  const q = document.querySelector("#search").value.trim().toLowerCase();
  const sort = document.querySelector("#sort").value;

  const groups = getGroups();
  const meta = DATA.meta || {};
  document.title = meta.title || "🫦 Статистика кусей";

  const sourceEl = document.querySelector("#source");
  const sourceUrl = meta.source_url || (meta.source && String(meta.source).startsWith("http") ? meta.source : "");
  const fallbackNote = USED_DATA_URL === FALLBACK_DATA_URL ? " · показан старый файл popki_site_data.json, потому что kus_site_data.json не найден" : "";

  if (sourceUrl) {
    sourceEl.innerHTML = `Источник: <a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(meta.source || sourceUrl)}</a>${fallbackNote}`;
  } else if ((meta.source_urls || []).length) {
    sourceEl.innerHTML = `Источники: ${(meta.source_urls || []).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">VOD ${i + 1}</a>`).join(" · ")}${fallbackNote}`;
  } else {
    sourceEl.textContent = `${meta.source ? `Источник: ${meta.source}` : "Статистика из Twitch-чата"}${fallbackNote}`;
  }

  document.querySelector("#total").textContent = meta.total ?? groups.reduce((sum, g) => sum + Number(g.count || (g.items || []).length || 0), 0);
  document.querySelector("#groups").textContent = meta.groups ?? groups.length;
  document.querySelector("#leaders").textContent = (DATA.top_chosen || []).length;

  renderTop(q);
  renderKusi(q, sort);
}

function renderTop(q){
  const top = (DATA.top_chosen || [])
    .filter(x => !q || String(x.user).toLowerCase().includes(q))
    .slice(0, 50);

  document.querySelector("#top").innerHTML = top.map((x, i) => `
    <div class="leader">
      <div><span class="rank">#${i+1}</span> <span class="name">${esc(x.user)}</span></div>
      <div class="count">${x.count} раз</div>
    </div>
  `).join("") || `<div class="item">Ничего не найдено</div>`;
}

function renderKusi(q, sort){
  let groups = [...getGroups()];

  if(q){
    groups = groups.filter(g => {
      const title = getGroupTitle(g).toLowerCase();
      const chosen = getChosenUsers(g).some(u => String(u.user).toLowerCase().includes(q));
      const items = (g.items || []).some(it =>
        getCommand(it).toLowerCase().includes(q) ||
        getChooser(it).toLowerCase().includes(q) ||
        getChosen(it).toLowerCase().includes(q)
      );
      return title.includes(q) || chosen || items;
    });
  }

  if(sort === "name") groups.sort((a,b) => getGroupTitle(a).localeCompare(getGroupTitle(b), "ru"));
  else if(sort === "chosen") groups.sort((a,b) => (getChosenUsers(b).length - getChosenUsers(a).length));
  else groups.sort((a,b) => (Number(b.count || 0) - Number(a.count || 0)) || getGroupTitle(a).localeCompare(getGroupTitle(b), "ru"));

  document.querySelector("#kusi").innerHTML = groups.map(g => {
    const title = getGroupTitle(g);
    const count = g.count ?? (g.items || []).length;
    const users = getChosenUsers(g).slice(0, 12).map(u =>
      `<span>${esc(u.user)}${u.count > 1 ? ` x${u.count}` : ""}</span>`
    ).join(" · ");

    const items = (g.items || []).slice(0, 25).map(it => `
      <div class="item">
        <div><span class="time">[${esc(it.time)}]</span> ${esc(getChooser(it))} → <b>${esc(getChosen(it))}</b></div>
        <div>${esc(getCommand(it))}</div>
      </div>
    `).join("");

    return `
      <article class="card">
        <h3>${esc(title)}: ${esc(count)}</h3>
        <div class="users"><b>Кого выбрало:</b><br>${users || "—"}</div>
        <div class="details">
          <details>
            <summary>показать подробности</summary>
            ${items || `<div class="item">Нет подробностей</div>`}
          </details>
        </div>
      </article>
    `;
  }).join("") || `<div class="item">Ничего не найдено</div>`;
}

document.querySelector("#search").addEventListener("input", render);
document.querySelector("#sort").addEventListener("change", render);

loadData().catch(err => {
  document.querySelector("#source").textContent = err.message;
});
