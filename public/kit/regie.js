const settingsForm = document.querySelector(".settings-form");
const videoForm = document.querySelector(".video-form");
const videoList = document.querySelector(".video-list");
const commentQueue = document.querySelector(".comment-queue");
const progress = document.querySelector(".upload-progress");
const progressBar = progress.querySelector("span");
const formMessage = document.querySelector(".form-message");
const adminToast = document.querySelector(".admin-toast");

let adminState = null;
let editingVideoId = null;
let toastTimer;
let pollTimer;
let currentMode = "video"; // "video" oder "image" (Bild + Musik)

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
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Aktion fehlgeschlagen");
  return payload;
}

// Die Regie ist ohne PIN direkt nutzbar (nur vom Host-Laptop erreichbar).
async function loadDashboard() {
  try {
    adminState = await api("state");
    render();
    window.clearInterval(pollTimer);
    pollTimer = window.setInterval(refreshState, 3000);
  } catch (error) {
    showToast(error.message || "Regie konnte nicht geladen werden.");
  }
}

async function refreshState() {
  // Während des Bearbeitens nicht neu rendern, sonst gingen Eingaben verloren.
  if (editingVideoId) return;
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
  settingsForm.elements.brandName.value = adminState.settings.brandName || "mpScroll";
  settingsForm.elements.published.checked = adminState.settings.published;
  settingsForm.elements.commentsEnabled.checked = adminState.settings.commentsEnabled;
  settingsForm.elements.requireName.checked = adminState.settings.requireName !== false;
  settingsForm.elements.showOverlay.checked = adminState.settings.showOverlay !== false;
  settingsForm.elements.showTopbar.checked = adminState.settings.showTopbar !== false;
  settingsForm.elements.showBottomNav.checked = adminState.settings.showBottomNav !== false;
  settingsForm.elements.feedOrderRandom.checked = adminState.settings.feedOrder === "random";

  renderVideos();
  renderComments();
}

function renderVideos() {
  if (!adminState.videos.length) {
    videoList.innerHTML =
      '<div class="empty-state">Noch keine Clips im Feed. Oben könnt ihr den ersten hinzufügen.</div>';
    return;
  }
  const accents = [
    ["cyan", "Cyan"],
    ["yellow", "Gelb"],
    ["magenta", "Magenta"],
    ["green", "Grün"],
    ["blue", "Blau"],
    ["red", "Rot"],
  ];
  const totalVideos = adminState.videos.length;
  const randomOrder = adminState.settings.feedOrder === "random";
  videoList.innerHTML = adminState.videos
    .map((video, index) => {
      if (video.id === editingVideoId) {
        const options = accents
          .map(
            ([value, label]) =>
              `<option value="${value}"${video.accent === value ? " selected" : ""}>${label}</option>`,
          )
          .join("");
        return `
        <article class="video-row is-editing">
          <form class="video-edit-form" data-video-id="${escapeHtml(video.id)}">
            <label>Titel<input name="title" maxlength="80" value="${escapeHtml(video.title)}" required /></label>
            <label>Profilname<input name="channel" maxlength="30" value="${escapeHtml(video.channel)}" required /></label>
            <label>Kurzbeschreibung<textarea name="description" maxlength="240" rows="2" required>${escapeHtml(video.description)}</textarea></label>
            <label>Gesprächsimpuls<input name="prompt" maxlength="100" value="${escapeHtml(video.prompt || "")}" /></label>
            <label>Akzentfarbe<select name="accent">${options}</select></label>
            <label class="switch-row">
              <span><strong>Kommentare für diesen Clip</strong></span>
              <input name="commentsEnabled" type="checkbox" ${video.commentsEnabled === false ? "" : "checked"} />
            </label>
            <div class="edit-actions">
              <button type="submit" class="primary-button">Speichern</button>
              <button type="button" class="cancel-edit">Abbrechen</button>
            </div>
          </form>
        </article>
      `;
      }
      const avatar = safeUrl(video.avatarUrl);
      const avatarMarkup = avatar
        ? `<img src="${avatar}" alt="" />`
        : escapeHtml((video.channel || "mp").slice(0, 2).toUpperCase());
      const titleLabel = video.title ? escapeHtml(video.title) : "<em>(ohne Titel)</em>";
      const channelLabel = video.channel ? escapeHtml(video.channel) : "ohne Profilname";
      const imageCount = video.images?.length || 0;
      const typeLabel =
        video.mediaType === "image"
          ? ` · ${imageCount > 1 ? `${imageCount} Bilder` : "Bild"}${video.audioUrl ? " + Musik" : ""}`
          : "";
      const commentLabel = video.commentsEnabled === false ? " · Kommentare aus" : "";
      return `
        <article class="video-row">
          <div class="reorder-actions">
            <button class="move-video" type="button" data-video-id="${escapeHtml(video.id)}" data-direction="-1"
              aria-label="Nach oben" ${index === 0 ? "disabled" : ""}>↑</button>
            <button class="move-video" type="button" data-video-id="${escapeHtml(video.id)}" data-direction="1"
              aria-label="Nach unten" ${index === totalVideos - 1 ? "disabled" : ""}>↓</button>
          </div>
          <div class="video-avatar">${avatarMarkup}</div>
          <div class="row-copy">
            <strong>${titleLabel}</strong>
            <span>${channelLabel} · ${Number(video.likes || 0)} Likes${typeLabel}${commentLabel}</span>
          </div>
          <div class="row-actions">
            <button class="edit-video" type="button" data-video-id="${escapeHtml(video.id)}">Bearbeiten</button>
            <button class="delete-video" type="button" data-video-id="${escapeHtml(video.id)}">Entfernen</button>
          </div>
        </article>
      `;
    })
    .join("");

  if (randomOrder && totalVideos > 1) {
    videoList.insertAdjacentHTML(
      "afterbegin",
      '<div class="reorder-note">Reihenfolge steht auf „zufällig“ – jedes iPad mischt selbst. Die Sortierung hier gilt, sobald du wieder auf feste Reihenfolge umstellst.</div>',
    );
  }

  videoList.querySelectorAll(".delete-video").forEach((button) => {
    button.addEventListener("click", () => deleteVideo(button.dataset.videoId));
  });
  videoList.querySelectorAll(".move-video").forEach((button) => {
    button.addEventListener("click", () =>
      moveVideo(button.dataset.videoId, Number(button.dataset.direction)),
    );
  });
  videoList.querySelectorAll(".edit-video").forEach((button) => {
    button.addEventListener("click", () => {
      editingVideoId = button.dataset.videoId;
      renderVideos();
    });
  });
  const editForm = videoList.querySelector(".video-edit-form");
  if (editForm) {
    editForm.addEventListener("submit", saveVideoEdit);
    editForm.querySelector(".cancel-edit").addEventListener("click", () => {
      editingVideoId = null;
      renderVideos();
    });
    editForm.elements.title.focus();
  }
}

async function saveVideoEdit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    await api(`video/${encodeURIComponent(form.dataset.videoId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: form.elements.title.value,
        channel: form.elements.channel.value,
        description: form.elements.description.value,
        prompt: form.elements.prompt.value,
        accent: form.elements.accent.value,
        commentsEnabled: form.elements.commentsEnabled.checked,
      }),
    });
    editingVideoId = null;
    showToast("Clip aktualisiert");
    await refreshState();
  } catch (error) {
    submitButton.disabled = false;
    if (error.message !== "unauthorized") showToast(error.message);
  }
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
        brandName: settingsForm.elements.brandName.value,
        published: settingsForm.elements.published.checked,
        commentsEnabled: settingsForm.elements.commentsEnabled.checked,
        requireName: settingsForm.elements.requireName.checked,
        showOverlay: settingsForm.elements.showOverlay.checked,
        showTopbar: settingsForm.elements.showTopbar.checked,
        showBottomNav: settingsForm.elements.showBottomNav.checked,
        feedOrder: settingsForm.elements.feedOrderRandom.checked ? "random" : "custom",
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
  const isImage = currentMode === "image";
  const imageFiles = isImage ? [...videoForm.elements.image.files] : [];
  const videoFile = isImage ? null : videoForm.elements.video.files[0];
  const avatarFile = isImage ? null : videoForm.elements.avatar.files[0];
  const audioFile = isImage ? videoForm.elements.audio.files[0] : null;
  const clipComments = videoForm.elements.clipComments.checked;
  if (isImage ? !imageFiles.length : !videoFile) {
    formMessage.textContent = isImage
      ? "Bitte mindestens ein Bild auswählen."
      : "Bitte ein Video auswählen.";
    return;
  }

  submitButton.disabled = true;
  progress.hidden = false;
  progressBar.style.width = "2%";
  formMessage.textContent = "Wird vorbereitet …";

  try {
    const fields = Object.fromEntries(new FormData(videoForm).entries());
    let result;

    if (isImage) {
      // Erst die Musik, dann jedes Bild einzeln – danach den Clip zusammensetzen.
      let audioUrl = "";
      if (audioFile) {
        formMessage.textContent = "Musik wird übertragen …";
        const audioResult = await uploadFile("audio", audioFile, {}, (ratio) => {
          progressBar.style.width = `${Math.round(ratio * 25)}%`;
        });
        audioUrl = audioResult.url;
      }
      const images = [];
      for (const [index, file] of imageFiles.entries()) {
        formMessage.textContent = `Bild ${index + 1} von ${imageFiles.length} wird übertragen …`;
        const imageResult = await uploadFile("image", file, {}, (ratio) => {
          const done = (index + ratio) / imageFiles.length;
          progressBar.style.width = `${25 + Math.round(done * 70)}%`;
        });
        images.push(imageResult.url);
      }
      result = await api("clip", {
        method: "POST",
        body: JSON.stringify({
          images,
          audioUrl,
          title: fields.title,
          channel: fields.channel,
          description: fields.description,
          prompt: fields.prompt,
          accent: fields.accent,
          commentsEnabled: clipComments,
        }),
      });
    } else {
      let avatarUrl = "";
      if (avatarFile) {
        const avatarResult = await uploadFile("avatar", avatarFile, {}, (ratio) => {
          progressBar.style.width = `${Math.round(ratio * 10)}%`;
        });
        avatarUrl = avatarResult.url;
      }
      result = await uploadFile(
        "video",
        videoFile,
        {
          title: fields.title,
          channel: fields.channel,
          description: fields.description,
          prompt: fields.prompt,
          accent: fields.accent,
          avatarUrl,
          commentsEnabled: clipComments ? "1" : "0",
        },
        (ratio) => {
          progressBar.style.width = `${10 + Math.round(ratio * 90)}%`;
          formMessage.textContent = `Video wird übertragen … ${Math.round(ratio * 100)} %`;
        },
      );
    }

    progressBar.style.width = "100%";
    const label = result.video.title || (isImage ? "Bild-Clip" : "Clip");
    formMessage.textContent = `„${label}“ ist jetzt im Feed.`;
    videoForm.reset();
    setMode("video");
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

// Umschalter Video / Bild+Musik: passenden Dateibereich zeigen, den anderen ausblenden.
function setMode(mode) {
  currentMode = mode === "image" ? "image" : "video";
  videoForm.querySelectorAll(".mode-option").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === currentMode);
  });
  videoForm.querySelectorAll("[data-media]").forEach((grid) => {
    grid.hidden = grid.dataset.media !== currentMode;
  });
  formMessage.textContent = "";
}

async function deleteVideo(videoId) {
  const video = adminState.videos.find((item) => item.id === videoId);
  const name = video?.title || "Dieser Clip";
  if (!video || !window.confirm(`„${name}“ wirklich aus dem Feed entfernen?`)) return;
  try {
    await api(`video/${encodeURIComponent(videoId)}`, { method: "DELETE" });
    showToast("Clip entfernt");
    await refreshState();
  } catch (error) {
    showToast(error.message);
  }
}

async function moveVideo(videoId, direction) {
  const ids = adminState.videos.map((video) => video.id);
  const from = ids.indexOf(videoId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  // Optimistisch lokal umsortieren, damit es sofort reagiert.
  adminState.videos = ids.map((id) => adminState.videos.find((video) => video.id === id));
  renderVideos();
  try {
    await api("reorder", { method: "POST", body: JSON.stringify({ order: ids }) });
    await refreshState();
  } catch (error) {
    if (error.message !== "unauthorized") showToast(error.message);
    await refreshState();
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

settingsForm.addEventListener("submit", saveSettings);
videoForm.addEventListener("submit", addVideo);
videoForm.querySelectorAll(".mode-option").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

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

document.querySelector(".export-button").addEventListener("click", async () => {
  try {
    const response = await fetch(apiUrl("export"), {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Auswertung konnte nicht erstellt werden.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    link.download = `mpscroll-auswertung-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Auswertung heruntergeladen");
  } catch (error) {
    showToast(error.message || "Export fehlgeschlagen");
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

loadDashboard();
