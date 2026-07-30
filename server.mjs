import {
  createReadStream,
  createWriteStream,
  existsSync,
} from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { randomUUID, randomInt } from "node:crypto";
import { spawn } from "node:child_process";

const baseDir = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(baseDir, "public", "kit");
const dataRoot = join(baseDir, "data");
const uploadRoot = join(dataRoot, "uploads");
const statePath = join(dataRoot, "state.json");
const port = Number(process.env.PORT || 4173);
const adminPin = process.env.MPSCROLL_PIN || "2468";
const presence = new Map();
let writeQueue = Promise.resolve();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const uploadExtensions = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

function defaultState() {
  return {
    settings: {
      workshopTitle: "mediale pfade Workshop",
      published: true,
      commentsEnabled: true,
      requireName: true,
      showOverlay: true,
      feedOrder: "custom",
      joinPin: String(randomInt(1000, 10000)),
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
    comments: [],
    likeLog: [],
  };
}

await mkdir(uploadRoot, { recursive: true });

let state;
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch {
  state = defaultState();
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

function persistState() {
  writeQueue = writeQueue.then(async () => {
    const tempPath = `${statePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2));
    await rename(tempPath, statePath);
  });
  return writeQueue;
}

// Existing state.json files predate the join PIN – make sure one always exists.
state.settings ||= defaultState().settings;
state.comments ||= [];
state.likeLog ||= []; // Protokoll für die Auswertung (wer hat was geliked)
if (!state.settings.joinPin) {
  state.settings.joinPin = String(randomInt(1000, 10000));
  await persistState();
}
// Ältere state.json-Dateien kennen die neuen Schalter noch nicht – Standardwerte
// ergänzen (Namen abfragen = an, Overlay zeigen = an, feste Reihenfolge).
if (state.settings.requireName === undefined) state.settings.requireName = true;
if (state.settings.showOverlay === undefined) state.settings.showOverlay = true;
state.settings.feedOrder = state.settings.feedOrder === "random" ? "random" : "custom";

const loopbackAddresses = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

function isLocalhost(request) {
  return loopbackAddresses.has(request.socket.remoteAddress || "");
}

function joinAuthorized(request) {
  const pin = state.settings.joinPin;
  if (!pin) return true;
  return request.headers["x-join-pin"] === pin;
}

function clientIp(request) {
  return (request.socket.remoteAddress || "").replace(/^::ffff:/, "");
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function isAdmin(request) {
  return request.headers["x-admin-pin"] === adminPin;
}

async function readJson(request, limit = 256_000) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > limit) throw new Error("Anfrage ist zu groß.");
  }
  return JSON.parse(body || "{}");
}

async function receiveUpload(request, kind) {
  const contentType = String(request.headers["content-type"] || "").split(";")[0];
  const extension = uploadExtensions[contentType];
  const isVideo = contentType.startsWith("video/");
  const isImage = contentType.startsWith("image/");
  const maxBytes = kind === "video" ? 250 * 1024 * 1024 : 3 * 1024 * 1024;
  const contentLength = Number(request.headers["content-length"] || 0);

  if ((kind === "video" && !isVideo) || (kind === "avatar" && !isImage) || !extension) {
    throw new Error(kind === "video" ? "Bitte MP4 oder WebM auswählen." : "Bitte PNG, JPG oder WebP auswählen.");
  }
  if (!contentLength || contentLength > maxBytes) {
    throw new Error(
      kind === "video" ? "Das Video darf maximal 250 MB groß sein." : "Das Profilbild darf maximal 3 MB groß sein.",
    );
  }

  const filename = `${randomUUID()}${extension}`;
  const destination = join(uploadRoot, filename);
  await pipeline(request, createWriteStream(destination));
  return `/uploads/${filename}`;
}

function activeDeviceCount() {
  const cutoff = Date.now() - 35_000;
  for (const [deviceId, lastSeen] of presence.entries()) {
    if (lastSeen < cutoff) presence.delete(deviceId);
  }
  return presence.size;
}

// VPN-/Overlay-/virtuelle Adapter (Tailscale, WireGuard, Hyper-V …) ans Ende –
// die iPads erreichen sie nicht. Sortierung nach ADAPTERNAME, weil ein echtes
// WLAN durchaus selbst eine 100.x-Adresse haben kann (CGNAT-Router).
function interfaceRank(name) {
  return /tailscale|wireguard|\bwg\d|zerotier|hamachi|\bvpn\b|virtual|vethernet|vmware|vbox|hyper-v|loopback|bluetooth|\btun\b|\btap\b/i.test(
    name,
  )
    ? 1
    : 0;
}

// Innerhalb echter Adapter die klassischen privaten LAN-Bereiche bevorzugen.
function ipRank(address) {
  if (/^192\.168\./.test(address)) return 0;
  if (/^10\./.test(address)) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 1;
  return 2;
}

function accessUrls() {
  const candidates = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries || []) {
      // Link-local (169.254.x) ist nicht erreichbar und fliegt raus.
      if (
        entry.family === "IPv4" &&
        !entry.internal &&
        !entry.address.startsWith("169.254.")
      ) {
        candidates.push({
          address: entry.address,
          rank: interfaceRank(name) * 10 + ipRank(entry.address),
        });
      }
    }
  }
  candidates.sort((a, b) => a.rank - b.rank);
  return candidates.map((c) => `http://${c.address}:${port}`);
}

function publicFeed() {
  const approvedComments = {};
  for (const comment of state.comments.filter((item) => item.status === "approved")) {
    approvedComments[comment.clipId] ||= [];
    approvedComments[comment.clipId].push({
      id: comment.id,
      text: comment.text,
      createdAt: comment.createdAt,
    });
  }
  return {
    settings: {
      workshopTitle: state.settings.workshopTitle,
      published: state.settings.published,
      commentsEnabled: state.settings.commentsEnabled,
      requireName: state.settings.requireName !== false,
      showOverlay: state.settings.showOverlay !== false,
      feedOrder: state.settings.feedOrder === "random" ? "random" : "custom",
    },
    videos: state.videos,
    comments: approvedComments,
    shared: true,
  };
}

function adminPayload() {
  return {
    settings: state.settings,
    videos: state.videos,
    comments: state.comments,
    stats: {
      activeDevices: activeDeviceCount(),
      videos: state.videos.length,
      likes: state.videos.reduce((sum, video) => sum + Number(video.likes || 0), 0),
      pendingComments: state.comments.filter((comment) => comment.status === "pending").length,
    },
    accessUrls: accessUrls(),
  };
}

// Excel-taugliches CSV: Semikolon-getrennt (deutsches Excel) + UTF-8-BOM.
function csvField(value) {
  const text = String(value ?? "");
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildActivityCsv() {
  const titleById = new Map(state.videos.map((video) => [video.id, video.title]));
  const rows = [];
  for (const comment of state.comments) {
    rows.push({
      time: comment.createdAt,
      device: comment.device || comment.deviceIp || "(ohne Name)",
      action: "Kommentar",
      status: comment.status === "approved" ? "freigegeben" : "wartet",
      clip: titleById.get(comment.clipId) || comment.clipId,
      text: comment.text,
    });
  }
  for (const like of state.likeLog) {
    rows.push({
      time: like.createdAt,
      device: like.device || like.deviceIp || "(ohne Name)",
      action: like.action === "unlike" ? "Like entfernt" : "Like",
      status: "",
      clip: titleById.get(like.clipId) || like.clipId,
      text: "",
    });
  }
  rows.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

  const header = ["Zeitpunkt", "Gerät", "Aktion", "Status", "Clip", "Inhalt"];
  const lines = [header.map(csvField).join(";")];
  for (const row of rows) {
    let when = row.time;
    try {
      when = new Date(row.time).toLocaleString("de-DE");
    } catch {
      /* Rohwert behalten */
    }
    lines.push(
      [when, row.device, row.action, row.status, row.clip, row.text].map(csvField).join(";"),
    );
  }
  return "﻿" + lines.join("\r\n");
}

async function removeUploadedFile(url) {
  if (!url?.startsWith("/uploads/")) return;
  const filename = url.slice("/uploads/".length);
  const target = join(uploadRoot, filename);
  if (target.startsWith(uploadRoot) && existsSync(target)) {
    await unlink(target);
  }
}

async function serveFile(request, response, filePath) {
  const fileInfo = await stat(filePath);
  const contentType = contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
  const range = request.headers.range;

  if (range && contentType.startsWith("video/")) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (!match) {
      response.writeHead(416, { "Content-Range": `bytes */${fileInfo.size}` });
      response.end();
      return;
    }
    const start = Number(match[1]);
    const end = Math.min(match[2] ? Number(match[2]) : fileInfo.size - 1, fileInfo.size - 1);
    response.writeHead(206, {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${fileInfo.size}`,
      "Content-Length": end - start + 1,
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    });
    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": fileInfo.size,
    "Cache-Control": contentType.startsWith("video/") ? "public, max-age=3600" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");

    // The control room and the projection page only work from the laptop itself.
    if (url.pathname === "/regie" || url.pathname === "/wand") {
      if (!isLocalhost(request)) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Nicht gefunden");
        return;
      }
      response.writeHead(302, { Location: `${url.pathname}.html` });
      response.end();
      return;
    }

    if (url.pathname === "/api/wand" && request.method === "GET") {
      if (!isLocalhost(request)) {
        sendJson(response, 404, { error: "Nicht gefunden." });
        return;
      }
      sendJson(response, 200, {
        workshopTitle: state.settings.workshopTitle,
        published: state.settings.published,
        joinPin: state.settings.joinPin,
        accessUrls: accessUrls(),
      });
      return;
    }

    if (url.pathname === "/api/join" && request.method === "POST") {
      const payload = await readJson(request);
      const pin = cleanText(payload.pin, 20);
      if (state.settings.joinPin && pin !== state.settings.joinPin) {
        sendJson(response, 401, { error: "Die Workshop-PIN stimmt nicht." });
        return;
      }
      sendJson(response, 200, { ok: true, workshopTitle: state.settings.workshopTitle });
      return;
    }

    if (url.pathname === "/api/feed" && request.method === "GET") {
      if (!joinAuthorized(request)) {
        sendJson(response, 401, { error: "Workshop-PIN erforderlich." });
        return;
      }
      sendJson(response, 200, publicFeed());
      return;
    }

    if (url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/api/admin/") &&
        !joinAuthorized(request)) {
      sendJson(response, 401, { error: "Workshop-PIN erforderlich." });
      return;
    }

    if (url.pathname === "/api/presence" && request.method === "POST") {
      const payload = await readJson(request);
      const deviceId = cleanText(payload.deviceId, 80);
      if (deviceId) presence.set(deviceId, Date.now());
      sendJson(response, 200, { activeDevices: activeDeviceCount() });
      return;
    }

    if (url.pathname === "/api/likes" && request.method === "GET") {
      sendJson(response, 200, {
        counts: Object.fromEntries(state.videos.map((video) => [video.id, video.likes || 0])),
        shared: true,
      });
      return;
    }

    if (url.pathname === "/api/likes" && request.method === "POST") {
      const payload = await readJson(request);
      const clipId = cleanText(payload.clipId, 80);
      const delta = payload.delta === -1 ? -1 : 1;
      const video = state.videos.find((item) => item.id === clipId);
      if (!video) {
        sendJson(response, 400, { error: "Unbekannter Clip." });
        return;
      }
      video.likes = Math.max(0, Number(video.likes || 0) + delta);
      state.likeLog.push({
        createdAt: new Date().toISOString(),
        device: cleanText(payload.deviceName, 40),
        deviceIp: clientIp(request),
        clipId,
        action: delta === 1 ? "like" : "unlike",
      });
      await persistState();
      sendJson(response, 200, { clipId, count: video.likes, shared: true });
      return;
    }

    if (url.pathname === "/api/comments" && request.method === "POST") {
      if (!state.settings.commentsEnabled) {
        sendJson(response, 403, { error: "Kommentare sind deaktiviert." });
        return;
      }
      const payload = await readJson(request);
      const clipId = cleanText(payload.clipId, 80);
      const text = cleanText(payload.text, 180);
      if (!text || !state.videos.some((video) => video.id === clipId)) {
        sendJson(response, 400, { error: "Kommentar oder Clip fehlt." });
        return;
      }
      state.comments.push({
        id: randomUUID(),
        clipId,
        text,
        status: "pending",
        createdAt: new Date().toISOString(),
        device: cleanText(payload.deviceName, 40),
        deviceIp: clientIp(request),
      });
      await persistState();
      sendJson(response, 201, { pending: true });
      return;
    }

    if (url.pathname.startsWith("/api/admin/")) {
      if (!isLocalhost(request)) {
        sendJson(response, 404, { error: "Nicht gefunden." });
        return;
      }
      if (!isAdmin(request)) {
        sendJson(response, 401, { error: "Regie-PIN ist nicht korrekt." });
        return;
      }

      if (url.pathname === "/api/admin/state" && request.method === "GET") {
        sendJson(response, 200, adminPayload());
        return;
      }

      if (url.pathname === "/api/admin/export" && request.method === "GET") {
        response.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="mpscroll-auswertung.csv"',
          "Cache-Control": "no-store",
        });
        response.end(buildActivityCsv());
        return;
      }

      if (url.pathname === "/api/admin/joinpin" && request.method === "POST") {
        state.settings.joinPin = String(randomInt(1000, 10000));
        await persistState();
        sendJson(response, 200, { joinPin: state.settings.joinPin });
        return;
      }

      if (url.pathname === "/api/admin/settings" && request.method === "POST") {
        const payload = await readJson(request);
        state.settings.workshopTitle =
          cleanText(payload.workshopTitle, 60) || "mediale pfade Workshop";
        state.settings.published = Boolean(payload.published);
        state.settings.commentsEnabled = Boolean(payload.commentsEnabled);
        state.settings.requireName = Boolean(payload.requireName);
        state.settings.showOverlay = Boolean(payload.showOverlay);
        state.settings.feedOrder = payload.feedOrder === "random" ? "random" : "custom";
        await persistState();
        sendJson(response, 200, { settings: state.settings });
        return;
      }

      if (url.pathname === "/api/admin/reorder" && request.method === "POST") {
        const payload = await readJson(request);
        const order = Array.isArray(payload.order) ? payload.order.map(String) : [];
        const byId = new Map(state.videos.map((video) => [video.id, video]));
        const reordered = [];
        for (const id of order) {
          const video = byId.get(id);
          if (video && !reordered.includes(video)) reordered.push(video);
        }
        // Nicht genannte Clips (Sicherheitsnetz) hinten anhängen.
        for (const video of state.videos) {
          if (!reordered.includes(video)) reordered.push(video);
        }
        state.videos = reordered;
        await persistState();
        sendJson(response, 200, { ok: true });
        return;
      }

      if (url.pathname === "/api/admin/avatar" && request.method === "POST") {
        const uploadedUrl = await receiveUpload(request, "avatar");
        sendJson(response, 201, { url: uploadedUrl });
        return;
      }

      if (url.pathname === "/api/admin/video" && request.method === "POST") {
        const title = cleanText(url.searchParams.get("title"), 80);
        const channel = cleanText(url.searchParams.get("channel"), 30);
        const description = cleanText(url.searchParams.get("description"), 240);
        const prompt = cleanText(url.searchParams.get("prompt"), 100);
        const avatarUrl = cleanText(url.searchParams.get("avatarUrl"), 180);
        const accent = cleanText(url.searchParams.get("accent"), 20);
        // Nur das Video ist Pflicht – Titel, Profilname, Beschreibung, Impuls
        // und Profilbild sind alle optional (im Feed gibt es Rückfallwerte).
        const videoUrl = await receiveUpload(request, "video");
        const video = {
          id: randomUUID(),
          title,
          channel,
          description,
          prompt,
          videoUrl,
          avatarUrl: avatarUrl.startsWith("/uploads/") ? avatarUrl : "",
          accent: ["cyan", "yellow", "magenta", "green", "blue", "red"].includes(accent)
            ? accent
            : "cyan",
          likes: 0,
        };
        state.videos.push(video);
        await persistState();
        sendJson(response, 201, { video });
        return;
      }

      const videoMatch = /^\/api\/admin\/video\/([^/]+)$/.exec(url.pathname);
      if (videoMatch && request.method === "PATCH") {
        const videoId = decodeURIComponent(videoMatch[1]);
        const video = state.videos.find((item) => item.id === videoId);
        if (!video) {
          sendJson(response, 404, { error: "Clip nicht gefunden." });
          return;
        }
        const payload = await readJson(request);
        // Felder sind optional: ein leeres Feld leert den Wert (statt den alten zu behalten).
        if (payload.title !== undefined) video.title = cleanText(payload.title, 80);
        if (payload.channel !== undefined) video.channel = cleanText(payload.channel, 30);
        if (payload.description !== undefined) video.description = cleanText(payload.description, 240);
        if (payload.prompt !== undefined) video.prompt = cleanText(payload.prompt, 100);
        const accent = cleanText(payload.accent, 20);
        if (["cyan", "yellow", "magenta", "green", "blue", "red"].includes(accent)) {
          video.accent = accent;
        }
        await persistState();
        sendJson(response, 200, { video });
        return;
      }

      if (videoMatch && request.method === "DELETE") {
        const videoId = decodeURIComponent(videoMatch[1]);
        const video = state.videos.find((item) => item.id === videoId);
        if (!video) {
          sendJson(response, 404, { error: "Clip nicht gefunden." });
          return;
        }
        state.videos = state.videos.filter((item) => item.id !== videoId);
        state.comments = state.comments.filter((comment) => comment.clipId !== videoId);
        await removeUploadedFile(video.videoUrl);
        await removeUploadedFile(video.avatarUrl);
        await persistState();
        sendJson(response, 200, { deleted: true });
        return;
      }

      const commentMatch = /^\/api\/admin\/comment\/([^/]+)$/.exec(url.pathname);
      if (commentMatch && request.method === "POST") {
        const commentId = decodeURIComponent(commentMatch[1]);
        const payload = await readJson(request);
        const comment = state.comments.find((item) => item.id === commentId);
        if (!comment) {
          sendJson(response, 404, { error: "Kommentar nicht gefunden." });
          return;
        }
        if (payload.action === "approve") comment.status = "approved";
        else if (payload.action === "delete") {
          state.comments = state.comments.filter((item) => item.id !== commentId);
        } else {
          sendJson(response, 400, { error: "Unbekannte Moderationsaktion." });
          return;
        }
        await persistState();
        sendJson(response, 200, { ok: true });
        return;
      }
    }

    // Regie and Wand assets stay on the laptop only.
    if (/^\/(regie|wand)\.(html|css|js)$/.test(url.pathname) && !isLocalhost(request)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Nicht gefunden");
      return;
    }

    let filePath;
    if (url.pathname.startsWith("/uploads/")) {
      const filename = normalize(url.pathname.slice("/uploads/".length)).replace(/^([/\\])+/, "");
      filePath = join(uploadRoot, filename);
      if (!filePath.startsWith(uploadRoot)) filePath = "";
    } else {
      const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const safePath = normalize(requested).replace(/^([/\\])+/, "");
      filePath = join(publicRoot, safePath);
      if (!filePath.startsWith(publicRoot)) filePath = "";
    }

    if (!filePath || !existsSync(filePath)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Nicht gefunden");
      return;
    }
    await serveFile(request, response, filePath);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Serverfehler",
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log("");
  console.log("mpScroll ist bereit.");
  console.log(`Regie:        http://localhost:${port}/regie`);
  console.log(`Wand/Beamer:  http://localhost:${port}/wand`);
  console.log(`Regie-PIN:    ${adminPin}`);
  console.log(`Workshop-PIN: ${state.settings.joinPin}  (fuer die iPads)`);
  for (const url of accessUrls()) console.log(`iPads:        ${url}`);
  console.log("");

  if (process.env.MPSCROLL_OPEN_BROWSER !== "0") {
    const target = `http://localhost:${port}/regie`;
    let opener = null;
    if (process.platform === "win32") {
      opener = ["cmd.exe", ["/d", "/c", "start", "", target]];
    } else if (process.platform === "darwin") {
      opener = ["open", [target]];
    }
    if (opener) {
      const browserProcess = spawn(opener[0], opener[1], {
        detached: true,
        stdio: "ignore",
      });
      browserProcess.unref();
    }
  }
});
