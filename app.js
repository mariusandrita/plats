const VIDEO_EXT = new Set(["mp4", "webm", "mov"]);

function extOf(filename) {
  return filename.split(".").pop().toLowerCase();
}

function isVideo(filename) {
  return VIDEO_EXT.has(extOf(filename));
}

function formatTimestamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function cleanTitle(title) {
  return title.replace(/®|™/g, "").replace(/\s+/g, " ").trim();
}

async function fetchJson(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function mediaEl(filename) {
  const src = `media/${filename}`;
  if (isVideo(filename)) {
    const video = document.createElement("video");
    video.src = src;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.addEventListener("mouseenter", () => video.play().catch(() => {}));
    video.addEventListener("mouseleave", () => video.pause());
    return video;
  }
  const img = document.createElement("img");
  img.className = "capture";
  img.src = src;
  img.loading = "lazy";
  img.alt = "";
  return img;
}

function buildCard(entry, mediaMap) {
  const card = document.createElement("div");
  card.className = "card";

  const mediaWrap = document.createElement("div");
  const filename = mediaMap[entry.np_communication_id];

  if (filename) {
    mediaWrap.className = "card-media";
    mediaWrap.appendChild(mediaEl(filename));
  } else {
    mediaWrap.className = "card-media placeholder";
    if (entry.game_icon_url) {
      const img = document.createElement("img");
      img.src = entry.game_icon_url;
      img.alt = "";
      mediaWrap.appendChild(img);
    }
    const tag = document.createElement("span");
    tag.className = "no-capture-tag";
    tag.textContent = "no capture yet";
    mediaWrap.appendChild(tag);
  }

  if (entry.platinum_icon_url) {
    const platIcon = document.createElement("img");
    platIcon.className = "plat-icon";
    platIcon.src = entry.platinum_icon_url;
    platIcon.alt = "Platinum";
    mediaWrap.appendChild(platIcon);
  }

  const body = document.createElement("div");
  body.className = "card-body";

  const title = document.createElement("div");
  title.className = "game-title";
  title.textContent = cleanTitle(entry.game_title);

  const ts = document.createElement("div");
  ts.className = "timestamp";
  ts.textContent = formatTimestamp(entry.earned_at);

  body.appendChild(title);
  body.appendChild(ts);

  if (entry.platform) {
    const plat = document.createElement("span");
    plat.className = "platform-tag";
    plat.textContent = entry.platform.split(",")[0];
    body.appendChild(plat);
  }

  card.appendChild(mediaWrap);
  card.appendChild(body);

  card.addEventListener("click", () => openLightbox(entry, filename));

  return card;
}

function openLightbox(entry, filename) {
  const lightbox = document.getElementById("lightbox");
  const content = document.getElementById("lightbox-content");
  content.innerHTML = "";

  if (filename) {
    const el = mediaEl(filename);
    if (el.tagName === "VIDEO") {
      el.muted = false;
      el.controls = true;
      el.autoplay = true;
    }
    content.appendChild(el);
  }

  const info = document.createElement("div");
  info.className = "lightbox-info";
  info.innerHTML = `
    <h2>${cleanTitle(entry.game_title)}</h2>
    ${entry.platinum_trophy_name ? `<div class="plat-name">🏆 ${entry.platinum_trophy_name}</div>` : ""}
    <div class="timestamp">${formatTimestamp(entry.earned_at)}</div>
  `;
  content.appendChild(info);

  lightbox.classList.remove("hidden");
}

function closeLightbox() {
  const lightbox = document.getElementById("lightbox");
  const content = document.getElementById("lightbox-content");
  content.querySelectorAll("video").forEach((v) => v.pause());
  lightbox.classList.add("hidden");
  content.innerHTML = "";
}

document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
document.getElementById("lightbox").addEventListener("click", (e) => {
  if (e.target.id === "lightbox") closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLightbox();
});

async function main() {
  const [synced, manual, mediaMap] = await Promise.all([
    fetchJson("data/platinums.json"),
    fetchJson("data/manual_platinums.json"),
    fetchJson("data/media_map.json"),
  ]);

  const all = [...(synced || []), ...(manual || [])];
  all.sort((a, b) => new Date(b.earned_at) - new Date(a.earned_at));

  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  const stats = document.getElementById("stats");

  if (all.length === 0) {
    empty.classList.remove("hidden");
    return;
  }

  const withCapture = all.filter((e) => mediaMap && mediaMap[e.np_communication_id]).length;
  stats.innerHTML = `
    <div><b>${all.length}</b>platinums</div>
    <div><b>${withCapture}</b>with a capture</div>
  `;

  for (const entry of all) {
    grid.appendChild(buildCard(entry, mediaMap || {}));
  }
}

main();
