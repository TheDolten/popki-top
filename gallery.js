(() => {
'use strict';

const GALLERY_API_URL = "__ACHIEVEMENTS_API_URL__";
const GALLERY_ADMIN_LOGIN = "thedolten";
const GALLERY_MAX_BYTES = 5 * 1024 * 1024;
const GALLERY_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const g$ = (id) => document.getElementById(id);

let GALLERY_ITEMS = [];

function galleryEndpointReady() {
  const placeholder = "__" + "ACHIEVEMENTS_API_URL" + "__";
  return Boolean(
    GALLERY_API_URL &&
    !GALLERY_API_URL.includes(placeholder) &&
    !GALLERY_API_URL.includes("PASTE_GOOGLE_APPS_SCRIPT") &&
    /^https?:\/\//i.test(GALLERY_API_URL)
  );
}

function getGalleryUser() {
  try {
    return JSON.parse(localStorage.getItem("twitch_user") || "null");
  } catch (_) {
    return null;
  }
}

function cleanLogin(v) {
  return String(v || "").trim().replace(/^@/, "").toLowerCase();
}

function isGalleryAdmin(user = getGalleryUser()) {
  return cleanLogin(user?.login) === GALLERY_ADMIN_LOGIN;
}

function escText(value) {
  return String(value == null ? "" : value);
}

function setGalleryStatus(text, isError = false) {
  const el = g$("galleryStatus");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("error", Boolean(isError));
}

function setUploadStatus(text, isError = false) {
  const el = g$("galleryUploadStatus");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("error", Boolean(isError));
}

function galleryJsonp(params) {
  return new Promise((resolve, reject) => {
    if (!galleryEndpointReady()) {
      reject(new Error("GALLERY_API_URL_NOT_READY"));
      return;
    }

    const callback = "__galleryCb_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    const url = new URL(GALLERY_API_URL);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value != null && value !== "") url.searchParams.set(key, value);
    });
    url.searchParams.set("callback", callback);
    url.searchParams.set("_", Date.now());

    const script = document.createElement("script");
    const cleanup = () => {
      try { delete window[callback]; } catch (_) { window[callback] = undefined; }
      script.remove();
    };

    window[callback] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP_LOAD_FAILED"));
    };

    script.src = url.toString();
    document.body.appendChild(script);
  });
}

async function galleryPost(payload) {
  if (!galleryEndpointReady()) throw new Error("GALLERY_API_URL_NOT_READY");

  const res = await fetch(GALLERY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });

  let data = null;
  try { data = await res.json(); } catch (_) {}

  if (!res.ok || data?.ok === false || data?.error) {
    const msg = data?.detail || data?.error || ("HTTP_" + res.status);
    throw new Error(msg);
  }

  return data || {};
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FILE_READ_ERROR"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function updateGalleryAuthHint() {
  const user = getGalleryUser();
  const hint = g$("galleryAdminHint");
  const uploadBtn = g$("galleryUploadBtn");
  const openUploadBtn = g$("galleryOpenUploadBtn");
  const file = g$("galleryFile");
  const caption = g$("galleryCaption");

  if (hint) {
    if (isGalleryAdmin(user)) {
      hint.textContent = "Ты вошёл как thedolten: доступны кнопки подтверждения, скрытия и удаления.";
    } else {
      hint.textContent = user
        ? "Ты вошёл через Twitch. Можно загружать картинки."
        : "Войди через Twitch, чтобы загрузить картинку.";
    }
  }

  const canUpload = Boolean(user?.login);
  if (openUploadBtn) openUploadBtn.hidden = !canUpload;
  if (uploadBtn) uploadBtn.disabled = !canUpload;
  if (file) file.disabled = !canUpload;
  if (caption) caption.disabled = !canUpload;

  if (!canUpload) closeGalleryUploadDrawer();
}

function imageUrlForCard(item) {
  return item.thumb_url || item.image_url || "";
}

function createGalleryCard(item) {
  const user = getGalleryUser();
  const admin = isGalleryAdmin(user);

  const card = document.createElement("article");
  card.className = "gallery-card";
  if (item.status && item.status !== "approved") card.classList.add("not-approved");

  const imageWrap = document.createElement("button");
  imageWrap.type = "button";
  imageWrap.className = "gallery-image-wrap";
  imageWrap.title = "Открыть картинку";

  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = item.caption || "gallery image";
  img.src = imageUrlForCard(item);
  imageWrap.appendChild(img);
  imageWrap.addEventListener("click", () => openGalleryLightbox(item.image_url || item.thumb_url));

  const body = document.createElement("div");
  body.className = "gallery-card-body";

  const caption = document.createElement("h3");
  caption.textContent = item.caption || "Без подписи";

  const meta = document.createElement("p");
  meta.className = "gallery-meta";
  const date = item.created_at ? new Date(item.created_at) : null;
  const dateText = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("ru-RU") : "";
  meta.textContent = "@" + (item.display_name || item.login || "unknown") + (dateText ? " · " + dateText : "");

  body.appendChild(caption);
  body.appendChild(meta);

  if (admin) {
    const status = document.createElement("div");
    status.className = "gallery-admin-status";
    status.textContent = "status: " + (item.status || "approved");
    body.appendChild(status);

    const actions = document.createElement("div");
    actions.className = "gallery-admin-actions";

    if (item.status !== "approved") {
      actions.appendChild(adminActionButton("Подтвердить", () => moderateGalleryItem(item.id, "approved")));
    }

    if (item.status === "approved") {
      actions.appendChild(adminActionButton("Скрыть", () => moderateGalleryItem(item.id, "hidden")));
    } else {
      actions.appendChild(adminActionButton("Вернуть", () => moderateGalleryItem(item.id, "approved")));
    }

    actions.appendChild(adminActionButton("Удалить", () => {
      if (confirm("Удалить картинку из галереи и Cloudinary?")) {
        moderateGalleryItem(item.id, "delete");
      }
    }, true));

    body.appendChild(actions);
  }

  card.appendChild(imageWrap);
  card.appendChild(body);

  return card;
}

function adminActionButton(text, onClick, danger = false) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = danger ? "btn tiny danger" : "btn tiny ghost";
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

function renderGallery() {
  const grid = g$("galleryGrid");
  if (!grid) return;

  grid.innerHTML = "";

  if (!GALLERY_ITEMS.length) {
    setGalleryStatus("Пока нет картинок.");
    return;
  }

  setGalleryStatus("");

  const frag = document.createDocumentFragment();
  GALLERY_ITEMS.forEach((item) => frag.appendChild(createGalleryCard(item)));
  grid.appendChild(frag);
}

async function loadGallery() {
  updateGalleryAuthHint();

  const user = getGalleryUser();
  if (!galleryEndpointReady()) {
    setGalleryStatus("GALLERY_API_URL не настроен. Проверь GitHub Secret ACHIEVEMENTS_API_URL.", true);
    return;
  }

  setGalleryStatus("Загружаю галерею...");

  try {
    const data = await galleryJsonp({
      action: "gallery_list",
      login: user?.login || "",
      admin: isGalleryAdmin(user) ? "1" : "0"
    });

    if (!data?.ok) throw new Error(data?.error || "GALLERY_LIST_ERROR");

    GALLERY_ITEMS = Array.isArray(data.items) ? data.items : [];
    renderGallery();
  } catch (err) {
    console.error(err);
    setGalleryStatus("Не удалось загрузить галерею: " + String(err.message || err), true);
  }
}

async function uploadGalleryImage(event) {
  event.preventDefault();

  const user = getGalleryUser();
  if (!user?.login) {
    setUploadStatus("Сначала войди через Twitch.", true);
    return;
  }

  const fileInput = g$("galleryFile");
  const captionInput = g$("galleryCaption");
  const uploadBtn = g$("galleryUploadBtn");
  const file = fileInput?.files?.[0];

  if (!file) {
    setUploadStatus("Выбери картинку.", true);
    return;
  }

  if (!GALLERY_ALLOWED_TYPES.has(file.type)) {
    setUploadStatus("Можно загружать только JPG, PNG или WEBP.", true);
    return;
  }

  if (file.size > GALLERY_MAX_BYTES) {
    setUploadStatus("Картинка слишком большая. Максимум 5 MB.", true);
    return;
  }

  try {
    if (uploadBtn) {
      uploadBtn.disabled = true;
      uploadBtn.textContent = "Загружаю...";
    }

    setUploadStatus("Читаю файл...");
    const dataUrl = await readFileAsDataUrl(file);

    setUploadStatus("Отправляю в Cloudinary...");
    const data = await galleryPost({
      action: "gallery_upload",
      user: {
        login: user.login,
        display_name: user.display_name || user.login,
        profile_image_url: user.profile_image_url || ""
      },
      caption: captionInput?.value || "",
      image: {
        data_url: dataUrl,
        filename: file.name,
        mime: file.type,
        size: file.size
      }
    });

    if (!data?.item) throw new Error("UPLOAD_WITHOUT_ITEM");

    setUploadStatus("Готово. Картинка добавлена в галерею.");
    if (fileInput) fileInput.value = "";
    if (captionInput) captionInput.value = "";
    const name = g$("galleryFileName");
    if (name) name.textContent = "Выбрать картинку";

    await loadGallery();
    closeGalleryUploadDrawer();
  } catch (err) {
    console.error(err);
    setUploadStatus("Ошибка загрузки: " + String(err.message || err), true);
  } finally {
    if (uploadBtn) {
      uploadBtn.disabled = !getGalleryUser()?.login;
      uploadBtn.textContent = "Загрузить";
    }
  }
}

async function moderateGalleryItem(id, status) {
  const user = getGalleryUser();

  if (!isGalleryAdmin(user)) {
    alert("Только thedolten может управлять галереей.");
    return;
  }

  try {
    setGalleryStatus("Обновляю...");
    await galleryPost({
      action: "gallery_moderate",
      user: {
        login: user.login,
        display_name: user.display_name || user.login,
        profile_image_url: user.profile_image_url || ""
      },
      id,
      status
    });

    await loadGallery();
    closeGalleryUploadDrawer();
  } catch (err) {
    console.error(err);
    setGalleryStatus("Ошибка модерации: " + String(err.message || err), true);
  }
}

function openGalleryLightbox(url) {
  if (!url) return;
  const box = g$("galleryLightbox");
  const img = g$("galleryLightboxImg");
  if (!box || !img) return;
  img.src = url;
  box.hidden = false;
}

function closeGalleryLightbox() {
  const box = g$("galleryLightbox");
  const img = g$("galleryLightboxImg");
  if (img) img.src = "";
  if (box) box.hidden = true;
}


function openGalleryUploadDrawer() {
  const user = getGalleryUser();
  if (!user?.login) return;

  const drawer = g$("galleryUploadDrawer");
  if (!drawer) return;

  drawer.hidden = false;
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("gallery-drawer-open");

  setTimeout(() => {
    g$("galleryCaption")?.focus();
  }, 80);
}

function closeGalleryUploadDrawer() {
  const drawer = g$("galleryUploadDrawer");
  if (!drawer) return;

  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("gallery-drawer-open");

  setTimeout(() => {
    drawer.hidden = true;
  }, 180);
}

function maybeReloadOnGalleryLogout() {
  const logout = g$("logoutTwitch");
  if (!logout) return;

  logout.addEventListener("click", () => {
    // Даём основному script.js удалить twitch_user, потом обновляем страницу,
    // чтобы скрыть загрузку/админ-кнопки без странных остатков состояния.
    setTimeout(() => location.reload(), 120);
  });
}

function setupGalleryPage() {
  updateGalleryAuthHint();

  g$("galleryOpenUploadBtn")?.addEventListener("click", openGalleryUploadDrawer);
  g$("galleryCloseUploadBtn")?.addEventListener("click", closeGalleryUploadDrawer);
  g$("galleryDrawerBackdrop")?.addEventListener("click", closeGalleryUploadDrawer);
  maybeReloadOnGalleryLogout();

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeGalleryUploadDrawer();
  });

  g$("galleryUploadForm")?.addEventListener("submit", uploadGalleryImage);
  g$("galleryRefreshBtn")?.addEventListener("click", loadGallery);
  g$("galleryLightboxClose")?.addEventListener("click", closeGalleryLightbox);
  g$("galleryLightbox")?.addEventListener("click", (event) => {
    if (event.target?.id === "galleryLightbox") closeGalleryLightbox();
  });

  g$("galleryFile")?.addEventListener("change", () => {
    const file = g$("galleryFile")?.files?.[0];
    const name = g$("galleryFileName");
    if (name) name.textContent = file ? file.name : "Выбрать картинку";
  });

  window.addEventListener("storage", updateGalleryAuthHint);
  loadGallery();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupGalleryPage, { once: true });
} else {
  setupGalleryPage();
}

window.reloadGallery = loadGallery;

})();
