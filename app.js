const VIDEO_EXT = new Set(["mp4", "webm", "mov"]);

function extOf(filename) {
  return filename.split(".").pop().toLowerCase();
}

function isVideo(filename) {
  return VIDEO_EXT.has(extOf(filename));
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
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

function mediaEl(filename, { muted = true, controls = false } = {}) {
  const src = `media/${filename}`;
  if (isVideo(filename)) {
    const video = document.createElement("video");
    video.src = src;
    video.muted = muted;
    video.loop = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.controls = controls;
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
    const el = mediaEl(filename);
    mediaWrap.appendChild(el);
    if (el.tagName === "VIDEO") {
      mediaWrap.addEventListener("mouseenter", () => el.play().catch(() => {}));
      mediaWrap.addEventListener("mouseleave", () => el.pause());
    }
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

  const plat = entry.platinum || {};
  if (plat.icon_url) {
    const platIcon = document.createElement("img");
    platIcon.className = "plat-icon";
    platIcon.src = plat.icon_url;
    platIcon.alt = "Platinum";
    mediaWrap.appendChild(platIcon);
  }

  if (filename && entry.unlocked_by) {
    const chip = document.createElement("div");
    chip.className = "unlocked-chip";
    chip.innerHTML = `<span class="label">Unlocked by</span>`;
    if (entry.unlocked_by.icon_url) {
      const icon = document.createElement("img");
      icon.src = entry.unlocked_by.icon_url;
      icon.alt = "";
      chip.appendChild(icon);
    }
    const name = document.createElement("span");
    name.textContent = entry.unlocked_by.name || "";
    chip.appendChild(name);
    mediaWrap.appendChild(chip);
  }

  const body = document.createElement("div");
  body.className = "card-body";

  const title = document.createElement("div");
  title.className = "game-title";
  title.textContent = cleanTitle(entry.game_title);
  body.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  const ts = document.createElement("div");
  ts.className = "timestamp";
  ts.textContent = formatDate(entry.earned_at);
  meta.appendChild(ts);
  if (entry.platform) {
    const platform = document.createElement("span");
    platform.className = "platform-tag";
    platform.textContent = entry.platform.split(",")[0];
    meta.appendChild(platform);
  }
  body.appendChild(meta);

  card.appendChild(mediaWrap);
  card.appendChild(body);

  card.addEventListener("click", () => openLightbox(entry, filename));

  return card;
}

function trophyBlock(eyebrow, trophy) {
  if (!trophy) return "";
  const typeClass = `type-${trophy.type || "bronze"}`;
  return `
    <div class="trophy-block">
      ${trophy.icon_url ? `<img src="${trophy.icon_url}" alt="" />` : ""}
      <div class="trophy-body">
        <div class="trophy-eyebrow">${eyebrow}</div>
        <div class="trophy-name ${typeClass}">${trophy.name || ""}</div>
        <div class="trophy-detail">${trophy.detail || ""}</div>
        <div class="trophy-stats">
          ${trophy.rarity ? `<span class="rarity-tag">${trophy.rarity}</span>` : ""}
          ${trophy.earned_rate ? `<span>${trophy.earned_rate}% of players</span>` : ""}
        </div>
      </div>
    </div>
  `;
}

function openLightbox(entry, filename) {
  const lightbox = document.getElementById("lightbox");
  const content = document.getElementById("lightbox-content");
  content.innerHTML = "";

  if (filename) {
    const mediaWrap = document.createElement("div");
    mediaWrap.className = "lightbox-media";
    const el = mediaEl(filename, { muted: false, controls: true });
    if (el.tagName === "VIDEO") el.autoplay = true;
    mediaWrap.appendChild(el);
    content.appendChild(mediaWrap);
  }

  const info = document.createElement("div");
  info.className = "lightbox-info";
  info.innerHTML = `
    <h2>${cleanTitle(entry.game_title)}</h2>
    <div class="lightbox-sub">
      <span>${formatDateTime(entry.earned_at)}</span>
      ${entry.platform ? `<span class="platform-tag">${entry.platform.split(",")[0]}</span>` : ""}
      ${entry.total_trophies ? `<span>${entry.total_trophies} trophies total</span>` : ""}
    </div>
    ${trophyBlock("Platinum", entry.platinum)}
    ${trophyBlock("Unlocked by — the last trophy earned", entry.unlocked_by)}
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

function buildStats(all, withCapture) {
  const stats = document.getElementById("stats");
  const years = new Set(all.map((e) => new Date(e.earned_at).getFullYear()));
  stats.innerHTML = `
    <div class="stat-pill plat"><b>${all.length}</b>&nbsp;platinums</div>
    <div class="stat-pill"><b>${withCapture}</b>&nbsp;with a capture</div>
    <div class="stat-pill"><b>${years.size}</b>&nbsp;years</div>
  `;
}

function buildMilestone(milestone) {
  const banner = document.createElement("div");
  banner.className = "milestone";
  banner.innerHTML = `
    <span class="milestone-icon">${milestone.icon || "📍"}</span>
    <span class="milestone-label">${milestone.label}</span>
    <span class="milestone-date">${formatDate(milestone.date)}</span>
  `;
  return banner;
}

async function main() {
  const [synced, manual, mediaMap, milestones] = await Promise.all([
    fetchJson("data/platinums.json"),
    fetchJson("data/manual_platinums.json"),
    fetchJson("data/media_map.json"),
    fetchJson("data/milestones.json"),
  ]);

  const all = [...(synced || []), ...(manual || [])];
  all.sort((a, b) => new Date(b.earned_at) - new Date(a.earned_at));

  const timeline = document.getElementById("timeline");
  const empty = document.getElementById("empty");

  if (all.length === 0) {
    empty.classList.remove("hidden");
    return;
  }

  const map = mediaMap || {};
  const withCapture = all.filter((e) => map[e.np_communication_id]).length;
  buildStats(all, withCapture);

  // Milestones sorted newest-first, same order as `all`, so a single pointer
  // can walk both lists in lockstep as we render.
  const sortedMilestones = [...(milestones || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  let milestoneIndex = 0;

  const byYear = new Map();
  for (const entry of all) {
    const year = new Date(entry.earned_at).getFullYear();
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(entry);
  }

  let cardIndex = 0;
  for (const [year, entries] of byYear) {
    const section = document.createElement("section");
    section.className = "year-section";

    const header = document.createElement("div");
    header.className = "year-header";
    header.innerHTML = `
      <h2>${year}</h2>
      <span class="year-count">${entries.length} platinum${entries.length === 1 ? "" : "s"}</span>
      <span class="year-line"></span>
    `;
    section.appendChild(header);

    let grid = document.createElement("div");
    grid.className = "grid";
    section.appendChild(grid);

    for (const entry of entries) {
      // A milestone that happened strictly before this entry (chronologically
      // older) gets inserted as a full-width banner right before its card.
      while (
        milestoneIndex < sortedMilestones.length &&
        new Date(sortedMilestones[milestoneIndex].date) > new Date(entry.earned_at)
      ) {
        section.appendChild(buildMilestone(sortedMilestones[milestoneIndex]));
        grid = document.createElement("div");
        grid.className = "grid";
        section.appendChild(grid);
        milestoneIndex++;
      }

      const card = buildCard(entry, map);
      card.style.animationDelay = `${Math.min(cardIndex * 0.04, 0.4)}s`;
      cardIndex++;
      grid.appendChild(card);
    }

    timeline.appendChild(section);
  }

  // Any remaining (older-than-everything) milestones go at the very end.
  while (milestoneIndex < sortedMilestones.length) {
    timeline.appendChild(buildMilestone(sortedMilestones[milestoneIndex]));
    milestoneIndex++;
  }
}

main();
