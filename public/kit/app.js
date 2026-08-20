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
const phoneStage = document.querySelector(".phone-stage");
const soundButton = document.querySelector(".sound-button");
const speedButton = document.querySelector(".speed-button");
const brandLabel = document.querySelector(".brand");
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
const startOverlay = document.querySelector(".start-overlay");
const startButton = document.querySelector(".start-button");
const deviceNameInput = document.querySelector("#device-name");

const storageKey = "mpscroll-workshop-v2";
const initialLocalState = { liked: {}, counts: {} };
let localState = loadLocalState();
let feedData = fallbackFeed;
let serverMode = false;
let soundOn = false;
let fastPlayback = false; // Dauer-Schalter für doppelte Geschwindigkeit
let randomOrder = null; // gemerkte Zufallsreihenfolge (nur bei feedOrder === "random")
let clips = [];
let observer;
let activeClipId = null;
let openCommentClipId = null;
let toastTimer;
let feedSignature = "";
let joinPin = localStorage.getItem("mpscroll-join-pin") || "";
let deviceName = localStorage.getItem("mpscroll-device-name") || "";

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
  startOverlay.hidden = true;
  joinError.textContent = message;
  joinPinInput.focus();
}

function hideJoinGate() {
  if (!joinGate.hidden) joinGate.hidden = true;
}

// Der große Start-Button erscheint, sobald der Feed offen ist und der Ton noch
// nicht freigeschaltet wurde – ein bewusster Tipp entsperrt den Ton (iOS-Regel).
function updateStartOverlay() {
  const published = feedData.settings?.published !== false;
  const show = !soundUnlocked && joinGate.hidden && published && clips.length > 0;
  startOverlay.hidden = !show;
  if (show && !deviceNameInput.value && deviceName) {
    deviceNameInput.value = deviceName;
  }
  updateStartEnabled();
}

// Namen abfragen (in der Regie schaltbar): Feld zeigen und den Start sperren,
// bis ein Name eingetragen ist – oder das Feld ganz ausblenden.
function applyNameRequirement() {
  const nameField = document.querySelector(".start-name-field");
  if (nameField) nameField.hidden = feedData.settings?.requireName === false;
  updateStartEnabled();
}

function updateStartEnabled() {
  const requireName = feedData.settings?.requireName !== false;
  const hasName = deviceNameInput.value.trim().length > 0;
  startButton.disabled = requireName && !hasName;
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

function clipMarkup(video, index) {
  const accent = accentName(video.accent);
  const mediaUrl = safeUrl(video.videoUrl);
  const audioUrl = safeUrl(video.audioUrl);
  const isImage = video.mediaType === "image";
  const images = (Array.isArray(video.images) && video.images.length
    ? video.images
    : [video.videoUrl]
  )
    .map(safeUrl)
    .filter(Boolean);
  const comments = feedData.comments?.[video.id] || [];
  const count = localState.counts[video.id] ?? video.likes ?? 0;
  const liked = Boolean(localState.liked[video.id]);
  // Kommentare können global und pro Clip abgeschaltet sein.
  const commentsOn =
    feedData.settings?.commentsEnabled !== false && video.commentsEnabled !== false;

  // Leere Angaben werden gar nicht erst eingeblendet – nichts legt sich unnötig
  // über das Video. Nur was wirklich befüllt ist, erscheint.
  const topicHtml = video.channel ? `<span class="topic">#${escapeHtml(video.channel)}</span>` : "";
  const titleHtml = video.title ? `<h2>${escapeHtml(video.title)}</h2>` : "";
  const descHtml = video.description ? `<p>${escapeHtml(video.description)}</p>` : "";
  const promptHtml = video.prompt
    ? `<div class="prompt"><span>?</span>${escapeHtml(video.prompt)}</div>`
    : "";
  const copyInner = topicHtml + titleHtml + descHtml + promptHtml;
  const copyHtml = copyInner ? `<div class="clip-copy">${copyInner}</div>` : "";

  const avatar = safeUrl(video.avatarUrl);
  const avatarHtml = avatar ? `<div class="avatar"><img src="${avatar}" alt="" /></div>` : "";

  // Bild-Clip (ein Bild oder Karussell, optional mit Musik) oder Video-Clip.
  // Videos/Musik bekommen ihre Quelle erst, wenn der Clip in die Nähe kommt
  // (data-src) – sonst lädt ein Handy alle Clips gleichzeitig und stürzt ab.
  let mediaHtml;
  if (isImage) {
    const slides = images
      .map(
        (src, slideIndex) =>
          `<img class="carousel-slide" ${slideIndex === 0 ? `src="${src}"` : `data-src="${src}"`} alt="" draggable="false" />`,
      )
      .join("");
    const dots =
      images.length > 1
        ? `<div class="carousel-dots" aria-hidden="true">${images
            .map((_, dotIndex) => `<span class="${dotIndex === 0 ? "is-current" : ""}"></span>`)
            .join("")}</div>`
        : "";
    mediaHtml =
      `<div class="carousel" data-count="${images.length}" data-slide="0">${slides}</div>${dots}` +
      (audioUrl
        ? `<audio class="clip-audio" data-src="${audioUrl}" loop preload="none"></audio>`
        : "");
  } else {
    mediaHtml = `<video class="clip-media clip-video" data-src="${mediaUrl}" muted loop playsinline webkit-playsinline preload="none" disablepictureinpicture disableremoteplayback></video>`;
  }

  // Zeitleiste + Pause nur, wenn es etwas Abspielbares gibt (Video oder Bild+Musik).
  const hasTimeline = !isImage || Boolean(audioUrl);
  const scrubberHtml = hasTimeline
    ? `<div class="pause-indicator" aria-hidden="true">▶</div>
      <div class="scrubber" role="slider" aria-label="Im Clip spulen" tabindex="-1">
        <div class="scrubber-track">
          <div class="scrubber-fill"></div>
          <div class="scrubber-knob"></div>
        </div>
      </div>`
    : "";

  return `
    <article
      class="clip clip-${accent}"
      data-clip-id="${escapeHtml(video.id)}"
      data-base-likes="${Number(video.likes || 0)}"
      ${index === 0 ? 'id="first-clip"' : ""}
    >
      ${mediaHtml}
      <div class="motion-fallback" aria-hidden="true"></div>
      <div class="clip-shade"></div>
      ${copyHtml}
      <aside class="action-rail" aria-label="Aktionen für diesen Clip">
        ${avatarHtml}
        <button
          class="like-button${liked ? " is-liked" : ""}"
          type="button"
          aria-label="${liked ? "Like entfernen" : "Clip liken"}"
          aria-pressed="${liked}"
        >
          <span class="heart" aria-hidden="true">♥</span>
          <strong class="like-count">${count}</strong>
        </button>
        ${
          commentsOn
            ? `<button class="comment-button" type="button" aria-label="Kommentare öffnen">
          <span class="comment-icon" aria-hidden="true">○</span>
          <strong class="comment-count">${comments.length}</strong>
        </button>`
            : ""
        }
      </aside>
      ${scrubberHtml}
    </article>
  `;
}

// Fisher–Yates: mischt eine Kopie, ohne das Original zu verändern.
function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Reihenfolge bestimmen: feste Reihenfolge aus der Regie oder pro Gerät gemischt.
// Die Zufallsreihenfolge bleibt stabil, solange sich die Clip-Menge nicht ändert –
// so springt der Feed nicht bei jeder Aktualisierung durcheinander.
function orderedVideos(data) {
  const videos = data.videos || [];
  if (data.settings?.feedOrder !== "random") {
    randomOrder = null;
    return videos;
  }
  const ids = videos.map((video) => video.id);
  const sameSet =
    randomOrder &&
    randomOrder.length === ids.length &&
    randomOrder.every((id) => ids.includes(id));
  if (!sameSet) randomOrder = shuffle(ids);
  const byId = new Map(videos.map((video) => [video.id, video]));
  return randomOrder.map((id) => byId.get(id)).filter(Boolean);
}

function renderFeed(data) {
  feedData = data;
  serverMode = Boolean(data.shared);
  statusMode.textContent = serverMode ? "gemeinsam" : "Demo";
  workshopLabel.textContent = data.settings?.workshopTitle || "mediale pfade Workshop";
  holdScreen.hidden = data.settings?.published !== false;
  feedElement.hidden = data.settings?.published === false;

  // Overlay (Titel, Beschreibung, Buttons) auf Wunsch ausblenden, damit sich die
  // Tool-Oberfläche nicht mit eingebrannter Plattform-UI im Video überlagert.
  phoneStage.classList.toggle("overlay-hidden", data.settings?.showOverlay === false);
  // Kopf- und Fußleiste sind in der Regie einzeln abschaltbar.
  phoneStage.classList.toggle("no-topbar", data.settings?.showTopbar === false);
  phoneStage.classList.toggle("no-bottomnav", data.settings?.showBottomNav === false);
  brandLabel.textContent = data.settings?.brandName || "mpScroll";

  feedElement.innerHTML = orderedVideos(data).map(clipMarkup).join("");
  clips = [...document.querySelectorAll(".clip")];
  setupClips();
  applyNameRequirement();
  updateStartOverlay();
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
    // Abspielbares Element: <video> beim Video-Clip, <audio> beim Bild-mit-Musik.
    const media = clip.querySelector("video, audio");
    const likeButton = clip.querySelector(".like-button");
    const commentButton = clip.querySelector(".comment-button");
    const scrubber = clip.querySelector(".scrubber");
    let lastTap = 0;
    let singleTapTimer = 0;
    let holdTimer = 0;
    let holding = false;

    media?.addEventListener("error", () => clip.classList.add("has-video-error"));
    likeButton.addEventListener("click", () => toggleLike(clip));
    commentButton?.addEventListener("click", () => openComments(clip.dataset.clipId));
    setupCarousel(clip);

    // Fortschrittsleiste + Spulen – nur wenn es eine Leiste und Abspielbares gibt.
    if (scrubber && media) {
      const fill = clip.querySelector(".scrubber-fill");
      const knob = clip.querySelector(".scrubber-knob");
      const paintProgress = (ratio) => {
        const percent = `${Math.min(100, Math.max(0, ratio * 100))}%`;
        fill.style.width = percent;
        knob.style.left = percent;
      };
      media.addEventListener("timeupdate", () => {
        if (clip.classList.contains("is-scrubbing")) return;
        paintProgress(media.duration ? media.currentTime / media.duration : 0);
      });
      const seekFromEvent = (event) => {
        const rect = scrubber.getBoundingClientRect();
        const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0;
        paintProgress(ratio);
        if (media.duration) media.currentTime = Math.min(1, Math.max(0, ratio)) * media.duration;
      };
      scrubber.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        clip.classList.add("is-scrubbing");
        try {
          scrubber.setPointerCapture(event.pointerId);
        } catch {
          /* Pointer-Capture ist nicht überall verfügbar – Seek läuft trotzdem. */
        }
        seekFromEvent(event);
      });
      scrubber.addEventListener("pointermove", (event) => {
        if (clip.classList.contains("is-scrubbing")) seekFromEvent(event);
      });
      const endScrub = (event) => {
        if (!clip.classList.contains("is-scrubbing")) return;
        event.stopPropagation();
        clip.classList.remove("is-scrubbing");
      };
      scrubber.addEventListener("pointerup", endScrub);
      scrubber.addEventListener("pointercancel", endScrub);
    }

    // Gesten: kurz tippen = Pause/Weiter · doppelt tippen = Like ·
    // gedrückt halten = 2× im Schnelldurchlauf (wie bei TikTok), loslassen = normal.
    const endHold = () => {
      window.clearTimeout(holdTimer);
      if (holding) {
        holding = false;
        stopFastForward(clip);
      }
    };
    clip.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, a, textarea, .scrubber")) return;
      holding = false;
      window.clearTimeout(holdTimer);
      holdTimer = window.setTimeout(() => {
        if (clip.dataset.swiping) return; // im Karussell geblättert – kein Schnelllauf
        holding = true;
        window.clearTimeout(singleTapTimer); // dann kein Pause-Tipp auslösen
        startFastForward(clip);
      }, 240);
    });
    clip.addEventListener("pointerup", (event) => {
      if (event.target.closest("button, a, textarea, .scrubber")) return;
      const wasHolding = holding;
      endHold();
      if (wasHolding) return; // Halten war der Schnelldurchlauf – nicht als Tipp werten.
      if (clip.dataset.swiping) return; // seitlich gewischt zählt nicht als Tipp
      const now = Date.now();
      const isDouble = now - lastTap < 330;
      lastTap = now;
      if (isDouble) {
        window.clearTimeout(singleTapTimer);
        if (!localState.liked[clip.dataset.clipId]) toggleLike(clip);
        return;
      }
      singleTapTimer = window.setTimeout(() => handleTap(clip), 250);
    });
    clip.addEventListener("pointercancel", endHold);
  });

  if (clips[0]) setActiveClip(clips[0]);
  wakeChrome();
}

// Bild-Karussell: seitlich wischen blättert durch die Bilder (wie Insta/TikTok).
function setupCarousel(clip) {
  const carousel = clip.querySelector(".carousel");
  if (!carousel) return;
  const slides = [...carousel.querySelectorAll(".carousel-slide")];
  const dots = [...clip.querySelectorAll(".carousel-dots span")];
  if (slides.length < 2) return;

  let startX = 0;
  let startY = 0;
  let dragging = false;
  let horizontal = null; // noch unklar, ob seitlich oder hoch/runter gewischt wird

  const show = (next) => {
    const index = Math.max(0, Math.min(slides.length - 1, next));
    carousel.dataset.slide = String(index);
    carousel.style.transform = `translateX(-${index * 100}%)`;
    dots.forEach((dot, dotIndex) => dot.classList.toggle("is-current", dotIndex === index));
    // Nachbarbilder erst bei Bedarf laden.
    [index - 1, index, index + 1].forEach((i) => {
      const slide = slides[i];
      if (slide?.dataset.src) {
        slide.src = slide.dataset.src;
        delete slide.dataset.src;
      }
    });
  };
  show(0);

  carousel.addEventListener(
    "pointerdown",
    (event) => {
      dragging = true;
      horizontal = null;
      startX = event.clientX;
      startY = event.clientY;
    },
    { passive: true },
  );
  carousel.addEventListener(
    "pointermove",
    (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        horizontal = Math.abs(dx) > Math.abs(dy);
      }
      if (horizontal) clip.dataset.swiping = "1"; // unterdrückt Tippen/Halten
    },
    { passive: true },
  );
  const finish = (event) => {
    if (!dragging) return;
    dragging = false;
    const dx = (event.clientX ?? startX) - startX;
    if (horizontal && Math.abs(dx) > 45) {
      show(Number(carousel.dataset.slide) + (dx < 0 ? 1 : -1));
    }
    horizontal = null;
    window.setTimeout(() => delete clip.dataset.swiping, 60);
  };
  carousel.addEventListener("pointerup", finish, { passive: true });
  carousel.addEventListener("pointercancel", finish, { passive: true });
}

// Nur der aktive Clip und seine direkten Nachbarn bekommen eine Quelle. Alles
// andere wird entladen – Handys halten sonst nicht viele Videos gleichzeitig aus
// (das war die Ursache für Ruckeln und Abstürze).
function applyMediaWindow() {
  const active = clips.findIndex((clip) => clip.dataset.clipId === activeClipId);
  if (active < 0) return;
  clips.forEach((clip, index) => {
    const media = clip.querySelector("video, audio");
    if (!media) return;
    const near = Math.abs(index - active) <= 1;
    if (near) {
      if (media.dataset.src) {
        media.src = media.dataset.src;
        delete media.dataset.src;
        media.load();
      }
      media.preload = index === active ? "auto" : "metadata";
    } else if (!media.dataset.src && media.src) {
      // Quelle merken und Speicher freigeben.
      media.dataset.src = media.getAttribute("src");
      media.pause();
      media.removeAttribute("src");
      media.load();
    }
  });
}

// Lautstärke angleichen: zu laute Clips werden über einen Kompressor gebändigt,
// leise etwas angehoben – so springt die Lautstärke zwischen Clips nicht.
let audioContext = null;
const normalizedMedia = new WeakSet();

function normalizeAudio(media) {
  if (!media || normalizedMedia.has(media)) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  try {
    audioContext ||= new AudioCtx();
    const source = audioContext.createMediaElementSource(media);
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -26; // ab hier wird abgeregelt
    compressor.knee.value = 28;
    compressor.ratio.value = 10;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.25;
    const makeup = audioContext.createGain();
    makeup.gain.value = 1.6; // Ausgleich für das Abregeln
    source.connect(compressor);
    compressor.connect(makeup);
    makeup.connect(audioContext.destination);
    normalizedMedia.add(media);
  } catch {
    // Klappt der Web-Audio-Weg nicht, läuft der Ton einfach unverändert weiter.
    normalizedMedia.add(media);
  }
}

function resumeAudioContext() {
  if (audioContext?.state === "suspended") audioContext.resume().catch(() => {});
}

// Gedrückt halten → 2×; nur Video wird beschleunigt (Musik nicht verzerren).
function startFastForward(clip) {
  const video = clip.querySelector("video");
  if (!video) return;
  video.playbackRate = 2;
  clip.classList.add("is-fast");
  video.play().catch(() => {});
}
function stopFastForward(clip) {
  const video = clip.querySelector("video");
  if (!video) return;
  // Zurück auf das, was der Dauer-Schalter oben rechts vorgibt.
  video.playbackRate = fastPlayback ? 2 : 1;
  clip.classList.remove("is-fast");
}

// Ein einzelner Tipp: erst Ton freischalten (iOS-Regel), danach Pause/Weiter.
function handleTap(clip) {
  if (!soundUnlocked) {
    unlockSound();
    return;
  }
  // Der Tipp, der gerade den Ton freigeschaltet hat, soll nicht sofort pausieren.
  if (Date.now() - lastUnlockAt < 500) return;
  togglePause(clip);
}

function togglePause(clip) {
  const media = clip.querySelector("video, audio");
  if (!media) return; // statisches Bild ohne Musik – nichts zu pausieren
  if (media.paused) {
    media.play().catch(() => {});
    clip.classList.remove("is-paused");
  } else {
    media.pause();
    clip.classList.add("is-paused");
  }
}

function setActiveClip(activeClip) {
  activeClipId = activeClip?.dataset.clipId || null;
  clips.forEach((clip) => {
    const media = clip.querySelector("video, audio");
    const isActive = clip === activeClip;
    clip.classList.toggle("is-active", isActive);
    clip.classList.remove("is-paused", "is-fast");
    if (!media) return; // statisches Bild ohne Musik
    if (!isActive) {
      media.pause();
      media.playbackRate = 1;
    }
  });

  applyMediaWindow();

  const media = activeClip?.querySelector("video, audio");
  if (!media) return;
  media.playbackRate = fastPlayback ? 2 : 1;
  media.muted = !soundOn;
  if (soundUnlocked) {
    normalizeAudio(media);
    resumeAudioContext();
  }
  media.play().catch(() => {});
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
      body: JSON.stringify({ clipId, delta, deviceName }),
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

  const clip = feedData.videos?.find((video) => video.id === openCommentClipId);
  const enabled =
    feedData.settings?.commentsEnabled !== false &&
    clip?.commentsEnabled !== false &&
    serverMode;
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
        deviceName,
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

function generateDeviceId() {
  // crypto.randomUUID gibt es nur in sicheren Kontexten (HTTPS/localhost).
  // Die iPads erreichen den Server über http://LAN-IP – deshalb Fallbacks.
  if (window.crypto?.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch {
      /* fällt unten durch */
    }
  }
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getDeviceId() {
  let deviceId = localStorage.getItem("mpscroll-device-id");
  if (!deviceId) {
    deviceId = generateDeviceId();
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

// Nur echte Änderungen am Aufbau lösen ein Neuzeichnen aus. Likes und
// Kommentarzahlen ändern sich ständig – die werden unten still nachgetragen.
// (Vorher wurde bei jedem Like der ganze Feed neu gebaut und ALLE Videos neu
// geladen – genau das hat auf dem Handy geruckelt und abgestürzt.)
function structuralSignature(data) {
  return JSON.stringify({
    settings: data.settings,
    videos: (data.videos || []).map((video) => ({
      id: video.id,
      mediaType: video.mediaType,
      title: video.title,
      channel: video.channel,
      description: video.description,
      prompt: video.prompt,
      videoUrl: video.videoUrl,
      images: video.images,
      audioUrl: video.audioUrl,
      avatarUrl: video.avatarUrl,
      accent: video.accent,
      commentsEnabled: video.commentsEnabled,
    })),
  });
}

// Zahlen (Likes, Kommentare) direkt im vorhandenen Markup auffrischen.
function syncCounts(data) {
  const byId = new Map((data.videos || []).map((video) => [video.id, video]));
  clips.forEach((clip) => {
    const clipId = clip.dataset.clipId;
    const video = byId.get(clipId);
    if (!video) return;
    if (typeof video.likes === "number") {
      localState.counts[clipId] = video.likes;
      clip.dataset.baseLikes = String(video.likes);
      const likeLabel = clip.querySelector(".like-count");
      if (likeLabel) likeLabel.textContent = video.likes;
    }
    const commentLabel = clip.querySelector(".comment-count");
    if (commentLabel) commentLabel.textContent = (data.comments?.[clipId] || []).length;
  });
  saveLocalState();
}

async function refreshFeed() {
  // Im Hintergrund (Bildschirm aus, anderer Tab) nicht nachladen – spart Akku
  // und verhindert Aussetzer beim Zurückkommen.
  // Der allererste Aufbau laeuft immer – sonst bliebe ein im Hintergrund
  // geoeffneter Feed (anderer Tab, gesperrtes Handy) dauerhaft leer.
  if (document.hidden && feedSignature) return;
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
    const signature = structuralSignature(data);
    if (signature !== feedSignature) {
      feedSignature = signature;
      data.videos.forEach((video) => {
        if (typeof video.likes === "number") localState.counts[video.id] = video.likes;
      });
      renderFeed(data);
      saveLocalState();
    } else {
      feedData = data; // frische Kommentare für das Kommentar-Fenster
      serverMode = true;
      statusMode.textContent = "gemeinsam";
      syncCounts(data);
    }
    if (openCommentClipId) renderComments();
  } catch {
    if (!feedSignature) {
      feedSignature = "fallback";
      renderFeed(fallbackFeed);
    }
  }
}

function applySound() {
  soundButton.classList.toggle("is-on", soundOn);
  soundButton.setAttribute("aria-label", soundOn ? "Ton ausschalten" : "Ton einschalten");
  clips.forEach((clip) => {
    const media = clip.querySelector("video, audio");
    if (media) media.muted = !soundOn;
  });
}

// Browser verbieten Autoplay MIT Ton – erlaubt ist er nur nach einer
// Nutzer-Geste. Darum schalten wir den Ton beim ersten Antippen/Wischen im
// Feed automatisch ein, direkt in der Geste (nur so lässt iOS ihn zu).
let soundUnlocked = false;
let lastUnlockAt = 0;

function unlockSound() {
  if (soundUnlocked || soundOn) return;
  // Solange der Start-Knopf sichtbar ist, entscheidet nur der Knopf (Namensabfrage).
  if (!startOverlay.hidden) return;
  soundUnlocked = true;
  lastUnlockAt = Date.now();
  soundOn = true;
  applySound();
  const active = clips.find((clip) => clip.dataset.clipId === activeClipId);
  const activeMedia = active?.querySelector("video, audio");
  if (activeMedia) {
    normalizeAudio(activeMedia);
    resumeAudioContext();
    activeMedia.play().catch(() => {});
  }
  setToast("Ton an");
}

function startWorkshop() {
  const requireName = feedData.settings?.requireName !== false;
  deviceName = (deviceNameInput.value || "").trim().slice(0, 40);
  if (requireName && !deviceName) {
    deviceNameInput.focus();
    return;
  }
  localStorage.setItem("mpscroll-device-name", deviceName);
  soundUnlocked = true;
  lastUnlockAt = Date.now();
  soundOn = true;
  applySound();
  const active = clips.find((clip) => clip.dataset.clipId === activeClipId);
  const activeMedia = active?.querySelector("video, audio");
  if (activeMedia) {
    normalizeAudio(activeMedia);
    resumeAudioContext();
    activeMedia.play().catch(() => {});
  }
  startOverlay.hidden = true;
  setToast("Los geht’s – Ton an");
}

startButton.addEventListener("click", startWorkshop);
deviceNameInput.addEventListener("input", updateStartEnabled);
feedElement.addEventListener("pointerdown", unlockSound);
feedElement.addEventListener("keydown", unlockSound);

soundButton.addEventListener("click", () => {
  soundUnlocked = true; // ab jetzt entscheidet die Nutzer*in bewusst
  soundOn = !soundOn;
  applySound();
  setToast(soundOn ? "Ton an" : "Ton aus");
});

// Dauerhafte doppelte Geschwindigkeit (zusätzlich zum Gedrückt-Halten).
speedButton.addEventListener("click", () => {
  fastPlayback = !fastPlayback;
  speedButton.classList.toggle("is-on", fastPlayback);
  speedButton.setAttribute("aria-pressed", String(fastPlayback));
  speedButton.setAttribute(
    "aria-label",
    fastPlayback ? "Normale Geschwindigkeit" : "Doppelte Geschwindigkeit einschalten",
  );
  clips.forEach((clip) => {
    const media = clip.querySelector("video, audio");
    if (media) media.playbackRate = fastPlayback ? 2 : 1;
  });
  setToast(fastPlayback ? "Tempo 2×" : "Tempo normal");
});

// Langes Drücken auf Video/Bild öffnet sonst das Browser-Menü („Video sichern …“).
// Das stört beim Gedrückt-Halten für 2× – deshalb hier unterbinden.
phoneStage.addEventListener("contextmenu", (event) => {
  if (event.target.closest(".clip")) event.preventDefault();
});

// Bedien-Elemente oben (Statuszeile + Kopfleiste) legen sich nur kurz übers Video
// und dimmen sich dann weg – wie bei TikTok. Jede Berührung/Scroll holt sie zurück.
let chromeTimer;
function wakeChrome() {
  phoneStage.classList.remove("chrome-dimmed");
  window.clearTimeout(chromeTimer);
  chromeTimer = window.setTimeout(() => phoneStage.classList.add("chrome-dimmed"), 3500);
}
feedElement.addEventListener("pointerdown", wakeChrome);
feedElement.addEventListener("scroll", wakeChrome, { passive: true });

// Endlosschleife: hinter dem letzten Clip geht es wieder beim ersten los
// (und über dem ersten Clip landet man am letzten).
function goToClip(index) {
  clips[index]?.scrollIntoView({ behavior: "smooth" });
}
function activeIndex() {
  return clips.findIndex((clip) => clip.dataset.clipId === activeClipId);
}

feedElement.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  const index = activeIndex();
  if (event.key === "ArrowDown") goToClip(index >= clips.length - 1 ? 0 : index + 1);
  else goToClip(index <= 0 ? clips.length - 1 : index - 1);
});

// Wischen/Scrollen über den Rand hinaus lässt den Feed umschlagen. Wichtig: NUR,
// wenn man schon am Rand steht und dann noch weiter wischt – nicht schon durch den
// Wisch, der einen überhaupt erst zum letzten Clip bringt (sonst „springt" der Feed
// beim Ankommen wieder hoch).
let wrapCooldownUntil = 0;
const edgeTolerance = 6;

function atBottom() {
  return feedElement.scrollTop + feedElement.clientHeight >= feedElement.scrollHeight - edgeTolerance;
}
function atTop() {
  return feedElement.scrollTop <= edgeTolerance;
}
function tryWrap(direction) {
  const now = Date.now();
  if (now < wrapCooldownUntil || clips.length < 2) return;
  if (direction > 0 && activeIndex() >= clips.length - 1 && atBottom()) {
    wrapCooldownUntil = now + 800;
    goToClip(0);
  } else if (direction < 0 && activeIndex() <= 0 && atTop()) {
    wrapCooldownUntil = now + 800;
    goToClip(clips.length - 1);
  }
}

// Seit wann stehen wir ununterbrochen am Rand? Der Scroll, der einen gerade erst
// ans Ende bringt, zählt nicht – erst ein erneuter Impuls nach kurzem Verweilen
// schlägt um. Das entschärft vor allem das Mausrad mit Nachlauf/Trägheit.
let atEdgeSince = 0;
feedElement.addEventListener(
  "scroll",
  () => {
    atEdgeSince = atBottom() || atTop() ? atEdgeSince || Date.now() : 0;
  },
  { passive: true },
);
function restedAtEdge() {
  return atEdgeSince && Date.now() - atEdgeSince > 250;
}

feedElement.addEventListener(
  "wheel",
  (event) => {
    if (Math.abs(event.deltaY) < 4 || !restedAtEdge()) return;
    tryWrap(event.deltaY > 0 ? 1 : -1);
  },
  { passive: true },
);

// Für Touch merken wir uns beim Auflegen, ob man schon am Rand steht. Nur dann
// (plus deutlicher Weiter-Wisch) wird umgeschlagen.
let touchStartY = null;
let startedAtBottom = false;
let startedAtTop = false;
feedElement.addEventListener(
  "touchstart",
  (event) => {
    // Bedienelemente (Leiste, Buttons) lösen kein Umschlagen aus.
    if (event.target.closest("button, a, textarea, .scrubber")) {
      touchStartY = null;
      return;
    }
    touchStartY = event.touches[0].clientY;
    startedAtBottom = activeIndex() >= clips.length - 1 && atBottom();
    startedAtTop = activeIndex() <= 0 && atTop();
  },
  { passive: true },
);
feedElement.addEventListener(
  "touchend",
  (event) => {
    if (touchStartY == null) return;
    const endY = (event.changedTouches[0] || {}).clientY ?? touchStartY;
    const dy = endY - touchStartY;
    if (startedAtBottom && dy < -60) tryWrap(1); // schon unten + weiter hoch gewischt
    else if (startedAtTop && dy > 60) tryWrap(-1); // schon oben + weiter runter gewischt
    touchStartY = null;
  },
  { passive: true },
);

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

// Beim Zurueckkommen (Tab gewechselt, Handy entsperrt) sofort auffrischen,
// statt bis zum naechsten Takt zu warten.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshFeed();
});

refreshFeed();
window.setInterval(refreshFeed, 10000);
window.setInterval(heartbeat, 10000);
window.setTimeout(heartbeat, 1000);
feedElement.focus({ preventScroll: true });
