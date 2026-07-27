const fallbackFeed = {
  settings: {
    workshopTitle: "mediale pfade Workshop",
    published: true,
    commentsEnabled: true,
  },
  videos: [
    {
      id: "popcorn",
      title: "Warum knallt Popcorn?",
      channel: "Wissen",
      description:
        "Wasserdampf baut Druck auf – bis die Hülle nachgibt. Was glaubt ihr: Wie heiß wird das Korn?",
      prompt: "Erst schätzen, dann auflösen",
      videoUrl:
        "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
      avatarUrl: "",
      accent: "cyan",
      likes: 18,
    },
    {
      id: "stopmotion",
      title: "Stop-Motion in 15 Minuten",
      channel: "Machen",
      description:
        "Ein Gegenstand, zwölf Bilder, eine kleine Bewegung. Schon wird aus eurem Tisch ein Filmset.",
      prompt: "Challenge: 3er-Teams bilden",
      videoUrl: "https://media.w3.org/2010/05/sintel/trailer.mp4",
      avatarUrl: "",
      accent: "yellow",
      likes: 32,
    },
    {
      id: "illusion",
      title: "Traust du deinen Augen?",
      channel: "Wahrnehmung",
      description:
        "Zwei gleich große Kreise wirken plötzlich verschieden. Wo täuscht euch das Bild?",
      prompt: "Abstimmung im Raum",
      videoUrl: "https://media.w3.org/2010/05/bunny/trailer.mp4",
      avatarUrl: "",
      accent: "magenta",
      likes: 27,
    },
  ],
  comments: {},
  shared: false,
};

const feedElement = document.querySelector(".feed");
const soundButton = document.querySelector(".sound-button");
const statusMode = document.querySelector(".status-mode");
const workshopLabel = document.querySelector(".workshop-label");
const toast = document.querySelector(".toast");
const holdScreen = document.querySelector(".hold-screen");
const commentSheet = document.querySelector(".comment-sheet");
const commentList = document.querySelector(".comment-list");
const commentForm = document.querySelector(".comment-form");
const commentText = document.querySelector("#comment-text");
const closeCommentsButton = document.querySelector(".close-comments");
const sheetBackdrop = document.querySelector(".sheet-backdrop");
const joinGate = document.querySelector(".join-gate");
const joinForm = document.querySelector(".join-form");
const joinPinInput = document.querySelector("#join-pin");
const joinError = document.querySelector(".join-error");

const storageKey = "mpscroll-workshop-v2";
const initialLocalState = { liked: {}, counts: {} };
let localState = loadLocalState();
let feedData = fallbackFeed;
let serverMode = false;
let soundOn = false;
let clips = [];
let observer;
let activeClipId = null;
let openCommentClipId = null;
let toastTimer;
let feedSignature = "";
let joinPin = localStorage.getItem("mpscroll-join-pin") || "";

// Direkt-Beitreten: Der QR-Code der Wand-Ansicht hängt die PIN als #pin=… an.
// Das Fragment bleibt lokal im Browser und wird nie an den Server gesendet.
(function applyHashPin() {
  const match = /[#&]pin=(\d{3,12})/.exec(window.location.hash);
  if (!match) return;
  joinPin = match[1];
  localStorage.setItem("mpscroll-join-pin", joinPin);
  history.replaceState(null, "", window.location.pathname + window.location.search);
})();

function joinHeaders(extra = {}) {
  return joinPin ? { ...extra, "X-Join-Pin": joinPin } : extra;
}

function showJoinGate(message = "") {
  joinGate.hidden = false;
  joinError.textContent = message;
  joinPinInput.focus();
}

function hideJoinGate() {
  if (!joinGate.hidden) joinGate.hidden = true;
}

function loadLocalState() {
  try {
    return {
      ...initialLocalState,
      ...JSON.parse(localStorage.getItem(storageKey) || "{}"),
    };
  } catch {
    return { ...initialLocalState };
  }
}

function saveLocalState() {
  localStorage.setItem(storageKey, JSON.stringify(localState));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value = "") {
  if (/^https?:\/\//i.test(value) || value.startsWith("/uploads/")) {
    return escapeHtml(value);
  }
  return "";
}

function accentName(value) {
  return ["cyan", "yellow", "magenta", "green", "blue", "red"].includes(value)
    ? value
    : "cyan";
}

function apiUrl(path) {
  return new URL(`../api/${path}`, window.location.href).toString();
}

function setToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1700);
}

function avatarMarkup(video) {
  const avatar = safeUrl(video.avatarUrl);
  if (avatar) {
    return `<img src="${avatar}" alt="" />`;
  }
  return escapeHtml((video.channel || "mp").slice(0, 2).toUpperCase());
}

function clipMarkup(video, index) {
  const accent = accentName(video.accent);
  const title = escapeHtml(video.title);
  const channel = escapeHtml(video.channel || "Workshop");
  const description = escapeHtml(video.description || "");
  const prompt = escapeHtml(video.prompt || "Gemeinsam besprechen");
  const videoUrl = safeUrl(video.videoUrl);
  const comments = feedData.comments?.[video.id] || [];
  const count = localState.counts[video.id] ?? video.likes ?? 0;
  const liked = Boolean(localState.liked[video.id]);

  return `
    <article
      class="clip clip-${accent}"
      data-clip-id="${escapeHtml(video.id)}"
      data-base-likes="${Number(video.likes || 0)}"
      ${index === 0 ? 'id="first-clip"' : ""}
    >
      <video
        class="clip-video"
        src="${videoUrl}"
        muted
        loop
        playsinline
        preload="metadata"
      ></video>
      <div class="motion-fallback" aria-hidden="true"></div>
      <div class="clip-shade"></div>
      <div class="clip-copy">
        <span class="topic">#${channel}</span>
        <h2>${title}</h2>
        <p>${description}</p>
        <div class="prompt"><span>?</span>${prompt}</div>
      </div>
      <aside class="action-rail" aria-label="Aktionen für diesen Clip">
        <div class="avatar" aria-label="Profil ${channel}">${avatarMarkup(video)}</div>
        <button
          class="like-button${liked ? " is-liked" : ""}"
          type="button"
          aria-label="${liked ? "Like entfernen" : "Clip liken"}"
          aria-pressed="${liked}"
        >
          <span class="heart" aria-hidden="true">♥</span>
          <strong class="like-count">${count}</strong>
        </button>
        <button class="comment-button" type="button" aria-label="Kommentare öffnen">
          <span class="comment-icon" aria-hidden="true">○</span>
          <strong class="comment-count">${comments.length}</strong>
        </button>
      </aside>
    </article>
  `;
}

function renderFeed(data) {
  feedData = data;
  serverMode = Boolean(data.shared);
  statusMode.textContent = serverMode ? "gemeinsam" : "Demo";
  workshopLabel.textContent = data.settings?.workshopTitle || "mediale pfade Workshop";
  holdScreen.hidden = data.settings?.published !== false;
  feedElement.hidden = data.settings?.published === false;

  feedElement.innerHTML = data.videos.map(clipMarkup).join("");
  clips = [...document.querySelectorAll(".clip")];
  setupClips();
}

function setupClips() {
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible && visible.intersectionRatio > 0.6) {
        setActiveClip(visible.target);
      }
    },
    { root: feedElement, threshold: [0.6, 0.85] },
  );

  clips.forEach((clip) => {
    observer.observe(clip);
    const video = clip.querySelector("video");
    const likeButton = clip.querySelector(".like-button");
    const commentButton = clip.querySelector(".comment-button");
    let lastTap = 0;

    video.addEventListener("error", () => clip.classList.add("has-video-error"));
    likeButton.addEventListener("click", () => toggleLike(clip));
    commentButton.addEventListener("click", () => openComments(clip.dataset.clipId));
    clip.addEventListener("pointerup", (event) => {
      if (event.target.closest("button, a, textarea")) return;
      const now = Date.now();
      if (now - lastTap < 330 && !localState.liked[clip.dataset.clipId]) {
        toggleLike(clip);
      }
      lastTap = now;
    });
  });

  if (clips[0]) setActiveClip(clips[0]);
}

function setActiveClip(activeClip) {
  activeClipId = activeClip?.dataset.clipId || null;
  clips.forEach((clip) => {
    const video = clip.querySelector("video");
    const isActive = clip === activeClip;
    clip.classList.toggle("is-active", isActive);
    if (isActive) {
      video.muted = !soundOn;
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  });
}

async function toggleLike(clip) {
  const clipId = clip.dataset.clipId;
  const baseLikes = Number(clip.dataset.baseLikes || 0);
  const wasLiked = Boolean(localState.liked[clipId]);
  const delta = wasLiked ? -1 : 1;
  localState.liked[clipId] = !wasLiked;
  localState.counts[clipId] = Math.max(
    0,
    (localState.counts[clipId] ?? baseLikes) + delta,
  );
  updateLikeButton(clip);
  saveLocalState();
  setToast(wasLiked ? "Like entfernt" : "Für die Auswertung gemerkt");

  if (!serverMode) return;
  try {
    const response = await fetch(apiUrl("likes"), {
      method: "POST",
      headers: joinHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ clipId, delta }),
    });
    if (response.status === 401) {
      showJoinGate("Die PIN wurde geändert. Bitte neu eingeben.");
      throw new Error();
    }
    if (!response.ok) throw new Error();
    const payload = await response.json();
    localState.counts[clipId] = payload.count;
    updateLikeButton(clip);
    saveLocalState();
  } catch {
    serverMode = false;
    statusMode.textContent = "lokal";
  }
}

function updateLikeButton(clip) {
  const clipId = clip.dataset.clipId;
  const button = clip.querySelector(".like-button");
  const label = clip.querySelector(".like-count");
  const liked = Boolean(localState.liked[clipId]);
  label.textContent = localState.counts[clipId] ?? clip.dataset.baseLikes ?? 0;
  button.classList.toggle("is-liked", liked);
  button.setAttribute("aria-pressed", String(liked));
  button.setAttribute("aria-label", liked ? "Like entfernen" : "Clip liken");
}

function renderComments() {
  const comments = feedData.comments?.[openCommentClipId] || [];
  if (!comments.length) {
    commentList.innerHTML =
      '<div class="empty-comments">Noch keine freigegebenen Kommentare.<br />Vielleicht kommt der erste von dir?</div>';
  } else {
    commentList.innerHTML = comments
      .map((comment) => `<div class="comment">${escapeHtml(comment.text)}</div>`)
      .join("");
  }

  const enabled = feedData.settings?.commentsEnabled !== false && serverMode;
  commentForm.classList.toggle("is-disabled", !enabled);
  commentText.disabled = !enabled;
  commentForm.querySelector("button").disabled = !enabled;
  commentText.placeholder = enabled
    ? "Schreib respektvoll und ohne persönliche Daten …"
    : "Kommentare sind in dieser Ansicht nicht aktiviert.";
}

function openComments(clipId) {
  openCommentClipId = clipId;
  renderComments();
  commentSheet.classList.add("is-open");
  commentSheet.setAttribute("aria-hidden", "false");
  sheetBackdrop.hidden = false;
}

function closeComments() {
  commentSheet.classList.remove("is-open");
  commentSheet.setAttribute("aria-hidden", "true");
  sheetBackdrop.hidden = true;
  openCommentClipId = null;
}

async function submitComment(event) {
  event.preventDefault();
  const text = commentText.value.trim();
  if (!text || !openCommentClipId || !serverMode) return;
  try {
    const response = await fetch(apiUrl("comments"), {
      method: "POST",
      headers: joinHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        clipId: openCommentClipId,
        text,
        deviceId: getDeviceId(),
      }),
    });
    if (response.status === 401) {
      showJoinGate("Die PIN wurde geändert. Bitte neu eingeben.");
      throw new Error();
    }
    if (!response.ok) throw new Error();
    commentText.value = "";
    setToast("Kommentar wartet auf Freigabe");
    closeComments();
  } catch {
    setToast("Kommentar konnte nicht gesendet werden");
  }
}

function getDeviceId() {
  let deviceId = localStorage.getItem("mpscroll-device-id");
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem("mpscroll-device-id", deviceId);
  }
  return deviceId;
}

async function heartbeat() {
  if (!serverMode) return;
  try {
    await fetch(apiUrl("presence"), {
      method: "POST",
      headers: joinHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ deviceId: getDeviceId() }),
    });
  } catch {
    // The feed remains usable even when presence tracking is unavailable.
  }
}

async function refreshFeed() {
  try {
    const response = await fetch(apiUrl("feed"), {
      cache: "no-store",
      headers: joinHeaders(),
    });
    if (response.status === 401) {
      showJoinGate(joinPin ? "Die PIN wurde geändert. Bitte neu eingeben." : "");
      return;
    }
    if (!response.ok) throw new Error();
    hideJoinGate();
    const data = await response.json();
    const signature = JSON.stringify({
      settings: data.settings,
      videos: data.videos,
      comments: data.comments,
    });
    if (signature !== feedSignature) {
      feedSignature = signature;
      data.videos.forEach((video) => {
        if (typeof video.likes === "number") localState.counts[video.id] = video.likes;
      });
      renderFeed(data);
      saveLocalState();
      if (openCommentClipId) renderComments();
    } else {
      serverMode = true;
      statusMode.textContent = "gemeinsam";
    }
  } catch {
    if (!feedSignature) {
      feedSignature = "fallback";
      renderFeed(fallbackFeed);
    }
  }
}

soundButton.addEventListener("click", () => {
  soundOn = !soundOn;
  soundButton.classList.toggle("is-on", soundOn);
  soundButton.setAttribute("aria-label", soundOn ? "Ton ausschalten" : "Ton einschalten");
  clips.forEach((clip) => {
    clip.querySelector("video").muted = !soundOn;
  });
  setToast(soundOn ? "Ton an" : "Ton aus");
});

feedElement.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  const activeIndex = clips.findIndex((clip) => clip.dataset.clipId === activeClipId);
  const delta = event.key === "ArrowDown" ? 1 : -1;
  const nextIndex = Math.max(0, Math.min(clips.length - 1, activeIndex + delta));
  clips[nextIndex]?.scrollIntoView({ behavior: "smooth" });
});

commentForm.addEventListener("submit", submitComment);
closeCommentsButton.addEventListener("click", closeComments);
sheetBackdrop.addEventListener("click", closeComments);

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const candidate = joinPinInput.value.trim();
  if (!candidate) return;
  joinError.textContent = "Prüfe …";
  try {
    const response = await fetch(apiUrl("join"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: candidate }),
    });
    if (!response.ok) {
      joinError.textContent = "PIN stimmt nicht. Bitte prüfen.";
      return;
    }
    joinPin = candidate;
    localStorage.setItem("mpscroll-join-pin", joinPin);
    joinPinInput.value = "";
    joinError.textContent = "";
    hideJoinGate();
    feedSignature = "";
    await refreshFeed();
    heartbeat();
  } catch {
    joinError.textContent = "Keine Verbindung. Bitte nochmal versuchen.";
  }
});

refreshFeed();
window.setInterval(refreshFeed, 10000);
window.setInterval(heartbeat, 10000);
window.setTimeout(heartbeat, 1000);
feedElement.focus({ preventScroll: true });
