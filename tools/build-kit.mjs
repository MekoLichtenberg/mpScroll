// Baut die fertigen Ein-Klick-Pakete für Windows und Mac.
//
// Es lädt einmalig die offiziellen, portablen Node.js-Binaries herunter und legt
// sie zusammen mit der App in fertige ZIP-Dateien unter dist/. Die Teamer*innen
// müssen dann nichts mehr installieren – ZIP herunterladen, entpacken, auf
// STARTEN-WINDOWS.cmd bzw. STARTEN-MAC.command doppelklicken.
//
// Aufruf (im Projektordner):   node tools/build-kit.mjs
// Optional eine feste Version: NODE_BUNDLE_VERSION=v22.14.0 node tools/build-kit.mjs
//
// Danach die beiden ZIPs aus dist/ als GitHub-„Release" hochladen.

import { createWriteStream, existsSync, rmSync } from "node:fs";
import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, ".build-cache");
const distDir = join(root, "dist");

// Diese App-Dateien kommen in jedes Paket (bewusst OHNE data/, docs/, .git …).
const appFiles = ["server.mjs", "package.json", "LICENSE", "public"];

function compareVersions(a, b) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

// Neueste LTS-Version ab Node 22 ermitteln (App braucht mindestens Node 22).
async function resolveVersion() {
  if (process.env.NODE_BUNDLE_VERSION) return process.env.NODE_BUNDLE_VERSION;
  const response = await fetch("https://nodejs.org/dist/index.json");
  if (!response.ok) throw new Error("Konnte die Node-Versionsliste nicht laden.");
  const releases = await response.json();
  const candidates = releases.filter(
    (entry) => entry.lts && Number(entry.version.slice(1).split(".")[0]) >= 22,
  );
  candidates.sort((a, b) => compareVersions(b.version, a.version));
  if (!candidates.length) throw new Error("Keine passende Node-LTS-Version gefunden.");
  return candidates[0].version;
}

async function download(url, targetPath) {
  if (existsSync(targetPath)) return; // aus dem Cache
  console.log("  ↓", url);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download fehlgeschlagen (${response.status}): ${url}`);
  }
  await pipeline(response.body, createWriteStream(targetPath));
}

// Entpackt in extractDir. Für .zip auf Windows PowerShell (GNU tar kann kein zip);
// für .tar.gz tar mit relativem Pfad + cwd (umgeht das C:-Doppelpunkt-Problem).
function extract(archiveName, cacheRoot, extractRel, isZip) {
  if (isZip && process.platform === "win32") {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath "${join(cacheRoot, archiveName)}" -DestinationPath "${join(cacheRoot, extractRel)}" -Force`,
      ],
      { stdio: "inherit" },
    );
  } else {
    execFileSync("tar", ["-xf", archiveName, "-C", extractRel], {
      cwd: cacheRoot,
      stdio: "inherit",
    });
  }
}

// Lädt ein Node-Archiv und gibt den Pfad zur enthaltenen node-Binärdatei zurück.
async function fetchNodeBinary(version, platform, ext, innerPath) {
  const base = `node-${version}-${platform}`;
  const archiveName = `${base}.${ext}`;
  await download(`https://nodejs.org/dist/${version}/${archiveName}`, join(cacheDir, archiveName));

  const extractDir = join(cacheDir, base);
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  extract(archiveName, cacheDir, base, ext === "zip");

  const binaryPath = join(extractDir, base, ...innerPath.split("/"));
  if (!existsSync(binaryPath)) throw new Error(`node nicht gefunden: ${binaryPath}`);
  return binaryPath;
}

function anleitung(startFile) {
  const lines = [
    "mpScroll – so startest du den Workshop",
    "=====================================",
    "",
    "Es muss NICHTS installiert werden. Node steckt schon im Ordner.",
    "",
    `1. Doppelklick auf  ${startFile}`,
    "2. Es öffnet sich die Regie im Browser. Regie-PIN eingeben (Standard: 2468).",
    "3. Clips hochladen, Feed freigeben – fertig.",
    "   Die Wand-Ansicht an den Beamer geben, die iPads scannen den QR-Code.",
    "",
    "Beim ersten Start ggf. den Firewall-Zugriff fürs private Netzwerk erlauben.",
  ];
  if (startFile.endsWith(".command")) {
    lines.push("Auf dem Mac einmalig: Rechtsklick auf die Datei -> Öffnen (Gatekeeper bestätigen).");
  }
  lines.push(
    "",
    "Alle Uploads und Einstellungen bleiben lokal im Ordner data/ auf diesem Laptop.",
  );
  return lines.join("\n");
}

async function copyApp(pkgDir, { startFile }) {
  await rm(pkgDir, { recursive: true, force: true });
  await mkdir(pkgDir, { recursive: true });
  for (const file of appFiles) {
    await cp(join(root, file), join(pkgDir, file), { recursive: true });
  }
  await cp(join(root, startFile), join(pkgDir, startFile));
  await writeFile(join(pkgDir, "ANLEITUNG.txt"), anleitung(startFile));
}

function zipFolder(folder) {
  const outZip = `${folder}.zip`;
  if (existsSync(outZip)) rmSync(outZip, { force: true });
  if (process.platform === "win32") {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path "${folder}" -DestinationPath "${outZip}" -Force`,
      ],
      { stdio: "inherit" },
    );
  } else {
    // Auf Mac/Linux erhält bsdtar die Ausführrechte der node-Binärdatei im ZIP.
    execFileSync("tar", ["-a", "-cf", outZip, "-C", dirname(folder), basename(folder)], {
      stdio: "inherit",
    });
  }
  return outZip;
}

async function main() {
  const version = await resolveVersion();
  console.log(`\nmpScroll-Pakete bauen mit Node ${version}\n`);
  await mkdir(cacheDir, { recursive: true });
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  // --- Windows ---
  console.log("Windows-Paket:");
  const winNode = await fetchNodeBinary(version, "win-x64", "zip", "node.exe");
  const winDir = join(distDir, "mpScroll-Windows");
  await copyApp(winDir, { startFile: "STARTEN-WINDOWS.cmd" });
  await mkdir(join(winDir, "runtime"), { recursive: true });
  await cp(winNode, join(winDir, "runtime", "node.exe"));
  console.log("  →", zipFolder(winDir));

  // --- Mac (Apple Silicon + Intel) ---
  console.log("Mac-Paket:");
  const macArm = await fetchNodeBinary(version, "darwin-arm64", "tar.gz", "bin/node");
  const macX64 = await fetchNodeBinary(version, "darwin-x64", "tar.gz", "bin/node");
  const macDir = join(distDir, "mpScroll-Mac");
  await copyApp(macDir, { startFile: "STARTEN-MAC.command" });
  for (const [arch, binary] of [["arm64", macArm], ["x64", macX64]]) {
    const targetDir = join(macDir, "runtime", arch, "bin");
    await mkdir(targetDir, { recursive: true });
    await cp(binary, join(targetDir, "node"));
    await chmod(join(targetDir, "node"), 0o755);
  }
  await chmod(join(macDir, "STARTEN-MAC.command"), 0o755);
  console.log("  →", zipFolder(macDir));

  console.log("\nFertig. Beide ZIPs liegen in dist/ und können als GitHub-Release hochgeladen werden.\n");
}

main().catch((error) => {
  console.error("\nFEHLER:", error.message);
  process.exit(1);
});
