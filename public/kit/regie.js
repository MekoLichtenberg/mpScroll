const pinScreen = document.querySelector(".pin-screen");
const dashboard = document.querySelector(".dashboard");
const pinForm = document.querySelector(".pin-form");
const pinInput = document.querySelector("#pin");
const pinError = document.querySelector(".pin-error");
const settingsForm = document.querySelector(".settings-form");
const videoForm = document.querySelector(".video-form");
const videoList = document.querySelector(".video-list");
const commentQueue = document.querySelector(".comment-queue");
const progress = document.querySelector(".upload-progress");
const progressBar = progress.querySelector("span");
const formMessage = document.querySelector(".form-message");
const adminToast = document.querySelector(".admin-toast");

let adminPin = sessionStorage.getItem("mpscroll-admin-pin") || "";
let adminState = null;
let toastTimer;
let pollTimer;

function apiUrl(path) {
  return new URL(`../api/admin/${path}`, window.location.href).toString();
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
  return value.startsWith("/uploads/") ? escapeHtml(value) : "";
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  adminToast.textContent = message;
  adminToast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => adminToast.classList.remove("is-visible"), 2200);
}

async function api(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      "X-Admin-Pin": adminPin,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  if (response.status === 401) {
    lockDashboard("Die PIN stimmt nicht oder wurde geändert.");
    throw new Error("unauthorized");
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Aktion fehlgeschlagen");
  return payload;
}

function lockDashboard(message = "") {
  window.clearInterval(pollTimer);
  adminPin = "";
  sessionStorage.removeItem("mpscroll-admin-pin");
  dashboard.hidden = true;
  pinScreen.hidden = false;
  pinError.textContent = message;
  pinInput.focus();
}

async function unlockDashboard() {
  try {
    adminState = await api("state");
    sessionStorage.setItem("mpscroll-admin-pin", adminPin);
    pinScreen.hidden = true;
    dashboard.hidden = false;
    render();
    window.clearInterval(pollTimer);
    pollTimer = window.setInterval(refreshState, 3000);
  } catch (error) {
    if (error.message !== "unauthorized") pinError.textContent = error.message;
  }
}

async function refreshState() {
  try {
    adminState = await api("state");
    render();
  } catch {
    // Keep the current view during a short network interruption.
  }
}

function render() {
  if (!adminState) return;
  document.querySelector(".stat-devices").textContent = adminState.stats.activeDevices;
  document.querySelector(".stat-videos").textContent = adminState.stats.videos;
  document.querySelector(".stat-likes").textContent = adminState.stats.likes;
  document.querySelector(".stat-pending").textContent = adminState.stats.pendingComments;
  document.querySelector(".kid-link").textContent =
    adminState.accessUrls[0] || "http://IP-DES-LAPTOPS:4173";
  document.querySelector(".join-pin-value").textContent =
    adminState.settings.joinPin || "····";

  settingsForm.elements.workshopTitle.value = adminState.settings.workshopTitle;
  settingsForm.elements.published.checked = adminState.settings.published;
  settingsForm.elements.commentsEnabled.checked = adminState.settings.commentsEnabled;

  renderVideos();
  renderComments();
}

function renderVideos() {
  if (!adminState.videos.length) {
    videoList.innerHTML =
      '<div class="empty-state">Noch keine Clips im Feed. Oben könnt ihr den ersten hinzufügen.</div>';
    return;
  }
  videoList.innerHTML = adminState.videos
    .map((video) => {
      const avatar = safeUrl(video.avatarUrl);
      const avatarMarkup = avatar
        ? `<img src="${avatar}" alt="" />`
        : escapeHtml((video.channel || "mp").slice(0, 2).toUpperCase());
      return `
        <article class="video-row">
          <div class="video-avatar">${avatarMarkup}</div>
          <div class="row-copy">
            <strong>${escapeHtml(video.title)}</strong>
            <span>${escapeHtml(video.channel)} · ${Number(video.likes || 0)} Likes</span>
          </div>
          <button class="delete-video" type="button" data-video-id="${escapeHtml(video.id)}">
            Entfernen
          </button>
        </article>
      `;
    })
    .join("");

  videoList.querySelectorAll(".delete-video").forEach((button) => {
    button.addEventListener("click", () => deleteVideo(button.dataset.videoId));
  });
}

function renderComments() {
  const pending = adminState.comments.filter((comment) => comment.status === "pending");
  if (!pending.length) {
    commentQueue.innerHTML =
      '<div class="empty-state">Alles geprüft – aktuell warten keine Kommentare.</div>';
    return;
  }
  commentQueue.innerHTML = pending
    .map((comment) => {
      const clip = adminState.videos.find((video) => video.id === comment.clipId);
      return `
        <article class="queue-row">
          <div class="video-avatar">?</div>
          <div class="row-copy">
            <strong>${escapeHtml(comment.text)}</strong>
            <span>Zu: ${escapeHtml(clip?.title || "Gelöschter Clip")}</span>
          </div>
          <div class="queue-actions">
            <button class="approve-comment" data-comment-id="${escapeHtml(comment.id)}" type="button">
              Freigeben
            </button>
            <button class="reject-comment" data-comment-id="${escapeHtml(comment.id)}" type="button">
              Löschen
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  commentQueue.querySelectorAll(".approve-comment").forEach((button) => {
    button.addEventListener("click", () => moderateComment(button.dataset.commentId, "approve"));
  });
  commentQueue.querySelectorAll(".reject-comment").forEach((button) => {
    button.addEventListener("click", () => moderateComment(button.dataset.commentId, "delete"));
  });
}

async function saveSettings(event) {
  event.preventDefault();
  const submitButton = settingsForm.querySelector("button");
  submitButton.disabled = true;
  try {
    await api("settings", {
      method: "POST",
      body: JSON.stringify({
        workshopTitle: settingsForm.elements.workshopTitle.value,
        published: settingsForm.elements.published.checked,
        commentsEnabled: settingsForm.elements.commentsEnabled.checked,
      }),
    });
    showToast("Workshop-Einstellungen gespeichert");
    await refreshState();
  } catch (error) {
    showToast(error.message);
  } finally {
    submitButton.disabled = false;
  }
}

function uploadFile(path, file, query = {}, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiUrl(path));
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value || ""));
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("X-Admin-Pin", adminPin);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      let payload = {};
      try {
        payload = JSON.parse(request.responseText || "{}");
      } catch {
        // The status code below will provide the fallback message.
      }
      if (request.status >= 200 && request.status < 300) resolve(payload);
      else reject(new Error(payload.error || "Upload fehlgeschlagen"));
    };
    request.onerror = () => reject(new Error("Verbindung beim Upload unterbrochen"));
    request.send(file);
  });
}

async function addVideo(event) {
  event.preventDefault();
  const submitButton = videoForm.querySelector("button[type='submit']");
  const videoFile = videoForm.elements.video.files[0];
  const avatarFile = videoForm.elements.avatar.files[0];
  if (!videoFile) return;

  submitButton.disabled = true;
  progress.hidden = false;
  progressBar.style.width = "2%";
  formMessage.textContent = "Profilbild und Video werden vorbereitet …";

  try {
    let avatarUrl = "";
    if (avatarFile) {
      const avatarResult = await uploadFile("avatar", avatarFile, {}, (ratio) => {
        progressBar.style.width = `${Math.round(ratio * 15)}%`;
      });
      avatarUrl = avatarResult.url;
    }

    const fields = Object.fromEntries(new FormData(videoForm).entries());
    const result = await uploadFile(
      "video",
      videoFile,
      {
        title: fields.title,
        channel: fields.channel,
        description: fields.description,
        prompt: fields.prompt,
        accent: fields.accent,
        avatarUrl,
      },
      (ratio) => {
        progressBar.style.width = `${15 + Math.round(ratio * 85)}%`;
        formMessage.textContent = `Video wird übertragen … ${Math.round(ratio * 100)} %`;
      },
    );
    progressBar.style.width = "100%";
    formMessage.textContent = `„${result.video.title}“ ist jetzt im Feed.`;
    videoForm.reset();
    showToast("Clip erfolgreich hinzugefügt");
    await refreshState();
  } catch (error) {
    formMessage.textContent = error.message;
  } finally {
    submitButton.disabled = false;
    window.setTimeout(() => {
      progress.hidden = true;
      progressBar.style.width = "0";
    }, 900);
  }
}

async function deleteVideo(videoId) {
  const video = adminState.videos.find((item) => item.id === videoId);
  if (!video || !window.confirm(`„${video.title}“ wirklich aus dem Feed entfernen?`)) return;
  try {
    await api(`video/${encodeURIComponent(videoId)}`, { method: "DELETE" });
    showToast("Clip entfernt");
    await refreshState();
  } catch (error) {
    showToast(error.message);
  }
}

async function moderateComment(commentId, action) {
  try {
    await api(`comment/${encodeURIComponent(commentId)}`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    showToast(action === "approve" ? "Kommentar freigegeben" : "Kommentar gelöscht");
    await refreshState();
  } catch (error) {
    showToast(error.message);
  }
}

pinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  adminPin = pinInput.value.trim();
  unlockDashboard();
});

settingsForm.addEventListener("submit", saveSettings);
videoForm.addEventListener("submit", addVideo);

document.querySelector(".logout-button").addEventListener("click", () => lockDashboard());
document.querySelector(".regen-pin").addEventListener("click", async () => {
  if (!window.confirm("Neue Workshop-PIN erzeugen? Bereits verbundene iPads müssen die neue PIN eingeben.")) {
    return;
  }
  try {
    const result = await api("joinpin", { method: "POST", body: "{}" });
    showToast(`Neue Workshop-PIN: ${result.joinPin}`);
    await refreshState();
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector(".copy-link").addEventListener("click", async () => {
  const link = document.querySelector(".kid-link").textContent;
  try {
    await navigator.clipboard.writeText(link);
    showToast("Adresse kopiert");
  } catch {
    showToast("Adresse markieren und kopieren");
  }
});

if (adminPin) unlockDashboard();
else pinInput.focus();
