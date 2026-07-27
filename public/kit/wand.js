const titleEl = document.querySelector(".wall-title");
const addressEl = document.querySelector(".address");
const pinEl = document.querySelector(".pin");
const statusEl = document.querySelector(".wall-status");
const canvas = document.querySelector(".qr");

let lastQrText = "";

function drawQr(text) {
  if (text === lastQrText) return;
  const { size, modules } = window.QR.build(text);
  const quiet = 4;
  const dim = size + quiet * 2;
  const scale = 12;
  canvas.width = dim * scale;
  canvas.height = dim * scale;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#050505";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) {
        ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
  }
  lastQrText = text;
}

function setStatus(message) {
  if (message) {
    statusEl.textContent = message;
    statusEl.hidden = false;
  } else {
    statusEl.hidden = true;
  }
}

async function refresh() {
  try {
    const response = await fetch("/api/wand", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const data = await response.json();

    titleEl.textContent = data.workshopTitle || "mediale pfade Workshop";
    pinEl.textContent = data.joinPin || "····";

    const url = (data.accessUrls && data.accessUrls[0]) || "";
    if (url) {
      addressEl.textContent = url.replace(/^https?:\/\//, "");
      // QR enthält die PIN im Fragment: Scannen führt direkt in den Feed.
      const joinUrl = data.joinPin ? `${url}/#pin=${data.joinPin}` : url;
      drawQr(joinUrl);
    } else {
      addressEl.textContent = "Kein WLAN erkannt";
    }

    if (!url) {
      setStatus("Der Laptop ist mit keinem Netzwerk verbunden – die iPads finden ihn so nicht.");
    } else if (data.published === false) {
      setStatus("Feed ist noch pausiert. Die iPads warten, bis ihr in der Regie freigebt.");
    } else {
      setStatus("");
    }
  } catch {
    setStatus("Keine Verbindung zur Regie.");
  }
}

refresh();
window.setInterval(refresh, 4000);
