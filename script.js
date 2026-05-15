const DATA_URL = "data/popki_site_data.json";
let DATA = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[m]));

async function loadData(){
  const res = await fetch(DATA_URL, {cache:"no-store"});
  if(!res.ok) throw new Error("Не смог загрузить " + DATA_URL);
  DATA = await res.json();
  render();
}

function render(){
  const q = document.querySelector("#search").value.trim().toLowerCase();
  const sort = document.querySelector("#sort").value;

  const meta = DATA.meta || {};
  document.title = meta.title || "🫦 Топ попок";
  const sourceEl = document.querySelector("#source");
  const sourceUrl = meta.source_url || (meta.source && String(meta.source).startsWith("http") ? meta.source : "");
  if (sourceUrl) {
    sourceEl.innerHTML = `Источник: <a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(meta.source || sourceUrl)}</a>`;
  } else if ((meta.source_urls || []).length) {
    sourceEl.innerHTML = `Источники: ${(meta.source_urls || []).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">VOD ${i + 1}</a>`).join(" · ")}`;
  } else {
    sourceEl.textContent = meta.source ? `Источник: ${meta.source}` : "Статистика из Twitch-чата";
  }
  document.querySelector("#total").textContent = meta.total ?? 0;
  document.querySelector("#groups").textContent = meta.groups ?? (DATA.popki || []).length;
  document.querySelector("#leaders").textContent = (DATA.top_chosen || []).length;

  renderTop(q);
  renderPopki(q, sort);
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

function renderPopki(q, sort){
  let popki = [...(DATA.popki || [])];

  if(q){
    popki = popki.filter(p =>
      String(p.title).toLowerCase().includes(q) ||
      (p.chosen_users || []).some(u => String(u.user).toLowerCase().includes(q))
    );
  }

  if(sort === "name") popki.sort((a,b) => String(a.title).localeCompare(String(b.title), "ru"));
  else if(sort === "chosen") popki.sort((a,b) => ((b.chosen_users||[]).length - (a.chosen_users||[]).length));
  else popki.sort((a,b) => (b.count || 0) - (a.count || 0));

  document.querySelector("#popki").innerHTML = popki.map(p => {
    const users = (p.chosen_users || []).slice(0, 12).map(u =>
      `<span>${esc(u.user)}${u.count > 1 ? ` x${u.count}` : ""}</span>`
    ).join(" · ");

    const items = (p.items || []).slice(0, 20).map(it => `
      <div class="item">
        <div><span class="time">[${esc(it.time)}]</span> ${esc(it.chooser)} → <b>${esc(it.chosen_user)}</b></div>
        <div>${esc(it.command)}</div>
      </div>
    `).join("");

    return `
      <article class="card">
        <h3>${esc(p.title)}: ${p.count}</h3>
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
