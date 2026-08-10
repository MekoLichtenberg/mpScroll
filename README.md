# mpScroll – Workshop-Kit

Ein kuratierter Kurzvideo-Feed im TikTok-Stil für Medienpädagogik-Workshops.
Die Workshop-Leitung pflegt Clips und moderiert Kommentare über eine
Regie-Oberfläche, die Teilnehmenden scrollen auf ihren iPads. Alles läuft
**lokal im eigenen WLAN**. Keine Cloud, keine Konten.

## Schnellstart (ohne Installation)

Das **fertige Paket** unter [Releases](../../releases) laden – `mpScroll-Windows.zip`
oder `mpScroll-Mac.zip`. Darin steckt Node.js schon mit drin, es muss **nichts
installiert** werden.

1. ZIP entpacken.
2. Auf Windows `STARTEN-WINDOWS.cmd`, auf dem Mac `STARTEN-MAC.command` doppelklicken.
3. Die Regie öffnet sich direkt im Browser. Clips hochladen (MP4/WebM, Hochformat 9:16, am besten 720p), Feed freigeben (Muss man nur einmal machen, alles bleibt für das nächste mal gespeichert)
4. Die Wand-Ansicht (http://localhost:4173/wand) an den Beamer geben über erweitertes Display. Die iPads scannen den QR-Code und kommen direkt in den Feed.

Auf dem Mac beim ersten Mal: Rechtsklick auf die Datei → **Öffnen** (Gatekeeper einmal
bestätigen).

## Aus dem Quellcode starten (für Entwickler)

Oben die ZIP über den grünen <> Code Button downloaden.

[Node.js](https://nodejs.org) 22 oder später wird benötigt, beim ersten Start wird es durch das Tool installiert wenn es noch nicht vorhanden ist.

1. **Starten** – Im Ordner auf Windows: `STARTEN-WINDOWS.cmd` · Mac: `STARTEN-MAC.command`
   klicken.
2. Die **Regie** öffnet sich direkt im Browser andere Geräte im WLAN kommen nicht dran.
   Clips hochladen (MP4/WebM, Hochformat 9:16, am besten 720p), Feed freigeben (Muss man nur einmal machen, alles bleibt für das nächste mal gespeichert)
3. Die **Wand-Ansicht** (`http://localhost:4173/wand`) an den Beamer geben über erweitertes Display.
   Die iPads scannen den QR-Code und kommen **direkt** in den Feed.

Beim ersten Start ggf. den Firewall-Zugriff fürs private Netzwerk erlauben.
Auf dem Mac muss `STARTEN-MAC.command` einmal per Rechtsklick → Öffnen erlaubt
werden (bei Bedarf `chmod +x STARTEN-MAC.command`).

![Wand-Ansicht für den Beamer](docs/wand.png)

<table>
  <tr>
    <td width="34%"><img src="docs/feed.png" alt="Feed auf dem iPad"></td>
    <td width="66%"><img src="docs/regie.png" alt="Regie-Oberfläche"></td>
  </tr>
  <tr>
    <td align="center"><em>Feed auf dem iPad</em></td>
    <td align="center"><em>Regie am Laptop</em></td>
  </tr>
</table>

## Zugang & Schutz

Die **Regie** (Steuerung am Laptop) braucht keine PIN – sie ist ausschließlich
über den Host-Laptop selbst (**localhost**) erreichbar, andere Geräte im WLAN
können sie nicht öffnen.

Die **Workshop-PIN** schützt den Feed: nur damit betreten die iPads den Feed.
Sie wird zufällig erzeugt, steht auf der Wand-Ansicht und ist in der Regie
jederzeit neu erzeugbar.

Kommentare erscheinen nie automatisch – sie werden erst nach Freigabe in der
Regie sichtbar. Teilnehmende geben keine Namen oder E-Mail-Adressen an.


## Grenzen & Technik

Jede*r startet das Kit **lokal auf dem eigenen Laptop**; die iPads verbinden
sich im selben WLAN. Realistisch gleichzeitig: **~20–30 iPads** (Laptop per
Kabel am guten WLAN-6-Access-Point), **~10–20** bei reinem WLAN. Der
Flaschenhals ist fast immer das WLAN, nicht der Server. Als öffentlich
gehosteter Internet-Dienst ist das Kit nicht gedacht.

Reines Node.js ohne Abhängigkeiten (auch der QR-Code wird offline erzeugt).
Alle Uploads und Einstellungen liegen nur im Ordner `data/` auf dem Laptop.

## Pakete bauen (für Releases)

Die fertigen ZIPs für Windows und Mac erzeugt ein kleines Skript. Es lädt die
offiziellen, portablen Node-Runtimes und legt sie zusammen mit der App ab:

```
node tools/build-kit.mjs
```

Danach liegen `mpScroll-Windows.zip` und `mpScroll-Mac.zip` in `dist/` – diese als
GitHub-Release hochladen. (`dist/`, `.build-cache/` und `runtime/` sind in
`.gitignore` und landen nie im Repo.) Das Mac-Paket enthält Node für Apple Silicon
**und** Intel; das Start-Skript wählt automatisch das passende.
