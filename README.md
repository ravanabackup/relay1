# Relay

A local-first video-sharing app that can be hosted on GitHub Pages. The original video stays on the source device. Relay does not upload videos to GitHub, a media server, or cloud storage.

## Important: Browser Links and VLC Links Are Different

GitHub Pages only serves static HTML, CSS, and JavaScript. A browser cannot create an HTTP server on your device, and a local `blob:` URL is not accessible to another device or VLC.

Relay provides two real options:

| Mode | How it works | Where to open the link |
| --- | --- | --- |
| Browser | A direct, encrypted WebRTC stream of the source player's playback; optionally converts unsupported formats locally first | Another modern browser |
| VLC | A small Python HTTP helper reads the original video from your device | VLC's Open Network Stream, on a reachable trusted network |

The source device must remain powered on and connected. Browser mode requires the sender's tab to stay open. VLC mode requires the helper's terminal to stay open, but the website can be closed.

## 1. Install and Run the Website Locally

Install Node.js 22 or newer from https://nodejs.org. Download this project's files, extract them, and open a terminal in the project folder.

```sh
npm install
npm run dev
```

Open the local address printed in your terminal, usually `http://localhost:5173`. Chrome or Edge is recommended for sending browser streams. Current Firefox also supports media-element capture, with browser-specific limitations. Safari can watch compatible WebRTC streams but does not support the source capture method used here; use Chrome or the VLC helper to send.

Links inherit the address of the page you are using. A `localhost` link only opens on the same device. Publish to GitHub Pages before sharing browser links with other devices, or provide your own appropriately secured and reachable frontend hosting.

## 2. Share a Video in a Browser

1. Choose a video or drop it into the source area. MP4 with H.264/AAC or WebM is recommended for instant native playback; MKV, MOV, AVI and other recognizable formats can also be inspected locally. Playback depends on the actual codecs, not only the extension.
2. If the file has multiple audio streams, use **Audio track** under the preview to select a language or soundtrack. MediaInfo reads only local file slices to list available tracks. Relay converts the selected track to a temporary playable copy in your browser's memory before sharing, including when you keep the default track; otherwise browsers may silently choose the wrong audio. The selected track applies to all browser viewers, not independently to each viewer.
3. If the file cannot play natively, select **Convert for browser**. Relay uses FFmpeg WebAssembly on the source device to produce H.264/AAC MP4 or VP8/Vorbis WebM, depending on the browser. Browser conversion supports files up to **150 MiB**, can take several minutes, and may fail for formats unsupported by the included codec engine or on memory-limited devices. The codec engine (roughly 32 MB) loads from your copy of the Relay website on first use. It does **not** upload the source video.
4. Select Browser and click Create stream link. Playback starts on your source device, muted locally by default. Copy the generated link and send it to a viewer. The viewer opens it in a browser and clicks Enable sound if needed.
5. Keep the sender's tab open and the device awake. The source player controls what everyone sees, including pause, seek, loop, and the selected audio track. A viewer joins at the current playback position rather than starting an independent copy.
6. Click Stop sharing to end the session and invalidate its link. Changing audio while live stops sharing and requires a fresh link. Changing or removing the source also ends sharing. Up to four viewers can connect, subject to your device's performance and upload bandwidth.

**Not literally every VLC codec:** Browser codec support varies. On-device conversion supports many common formats such as H.265/HEVC, MKV with AC-3, and AVI when the bundled FFmpeg core has a suitable decoder, but not every codec, container, DRM-protected file, or huge video. Use the original-file VLC helper for large or unconvertible content; it is not subject to the browser conversion limit. Receivers cannot select different original audio tracks independently because a WebRTC browser stream contains the one track chosen by the sender.

Browser mode uses the public PeerJS signaling service and STUN to discover a direct route. These services exchange connection metadata; the video is sent over WebRTC between the devices. No TURN media relay is configured. Some mobile, corporate, and restrictive NAT networks cannot establish a direct route. Try the same Wi-Fi network or the VLC helper on a trusted reachable network. This is not a promise that every pair of internet connections will work.

## 3. Stream Directly to VLC Without Uploading

Install Python 3.8 or newer from https://www.python.org/downloads/ and VLC from https://www.videolan.org/vlc/. On Windows, enable Add Python to PATH during installation if offered.

1. In Relay, open the VLC player tab, then Set up VLC streaming.
2. Download `relay-stream.py` using the Download helper button. The helper has no package dependencies. Its source is in `src/assets/relay-stream.py`.
3. Open a terminal in the folder containing the downloaded helper. Run it with the full path to the original video. The browser cannot obtain a real filesystem path from a selected file, so this path must be supplied manually.

macOS or Linux:

```sh
python3 relay-stream.py "/full/path/to/video.mp4"
```

Windows:

```powershell
py relay-stream.py "C:\Videos\video.mp4"
```

4. Allow Python through your firewall for your private network only, if prompted. Do not disable the firewall. Both devices should be on the same trusted Wi-Fi or connected through an existing trusted VPN. Guest Wi-Fi client isolation can prevent connections.
5. Copy the HTTP URL printed in the terminal. It will resemble `http://192.168.1.42:8765/stream/RANDOM_PRIVATE_TOKEN/video.mp4`. Use the source device's LAN address, not `localhost`, on another device. The helper also prints a loopback URL for VLC on the same device.
6. On the viewer, open VLC, choose Media > Open Network Stream (Ctrl+N on Windows/Linux; File > Open Network on macOS), paste the full URL, and select Play. You can also paste this URL into Relay's VLC tab to copy it or download a small `.m3u` playlist. The website does not probe or verify that the helper is running.
7. Keep the terminal and source device running. Ctrl+C stops the server. Each run generates a new private token, so old links are no longer valid.

The helper serves only the one chosen file. It supports HTTP byte-range requests for seeking, reads in bounded chunks, disables HTTP caching, and does not create a copy, upload, or transcode the video. Viewers can play independently of the browser source player.

If the network adapter was detected incorrectly or you are using a trusted VPN, specify the reachable source address:

```sh
python3 relay-stream.py "/full/path/to/video.mp4" --advertise 192.168.1.42
```

If port 8765 is busy:

```sh
python3 relay-stream.py "/full/path/to/video.mp4" --port 8766
```

HTTP is not encrypted. Use the helper only on a trusted private network or an appropriately secured private VPN. Do not expose it directly to the public internet. An unguessable URL is not a substitute for transport encryption. To reach a source outside your local network, you need a reachable, secured network route; GitHub Pages cannot provide it.

## 4. Host on GitHub Pages

The website is entirely static. The main app and styles are bundled into `dist/index.html`. The conversion worker, MediaInfo WASM and FFmpeg JS/WASM codec engine are separate files inside `dist` and served by your Pages site. Publish **every file** from `dist`. The build uses a relative asset base so these files load on GitHub Pages project URLs as well as custom domains. Do not add any video files to the repository.

**Recommended: use Option B, the included GitHub Actions workflow.** GitHub's browser uploader limits individual files to 25 MiB; the bundled FFmpeg WASM file is roughly 32 MB, so simply dragging `dist` into the GitHub website will fail. Automatic deployment uploads it as a Pages artifact instead.

### Option A: Publish the Built Site with Git

1. In the project folder, run:

```sh
npm install
npm run build -- --base=./
```

2. Install [Git](https://git-scm.com/downloads). Create a **new, empty** public repository on GitHub, for example `relay`. Do not add a README or initialize it there yet.
3. In a terminal, enter the built `dist` directory. Publish its contents (including both `.wasm` files) as the repository root. Replace the username and repository in the URL below:

```sh
cd dist
git init
git add .
git commit -m "Publish Relay"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/relay.git
git push -u origin main
```

4. Open Settings > Pages. Under Build and deployment, choose Deploy from a branch, select `main`, choose `/ (root)`, and Save.
5. Wait for deployment. Open `https://YOUR_USERNAME.github.io/relay/`. Enable Enforce HTTPS if available. HTTPS is required for the site's clipboard and modern browser features. For updates, rebuild, clone the published repository into a separate folder, copy the new files from `dist` into that clone, then commit and push. Vite empties `dist` on every build, so do not rely on a `.git` directory inside `dist` surviving a rebuild.

### Option B: Automatic Deployment from Source

1. Push the full project, including `.github/workflows/deploy.yml` and `package-lock.json`, to your GitHub repository's `main` branch.
2. Open Settings > Pages and set Source to GitHub Actions.
3. Open Actions and run Deploy Relay to GitHub Pages, or push a change to `main`.
4. The included workflow installs dependencies, builds the website, and deploys `dist`. The Pages URL appears in the completed deployment. If your default branch is not `main`, adjust the workflow's branch trigger.

The workflow uses a relative Vite base through a command-line flag. No runtime backend, video storage, environment variables, or API keys are needed. PeerJS signaling is an external availability dependency. MediaInfo and FFmpeg codec assets are served from your own GitHub Pages site; no third-party transcoding service is used.

## Privacy and Limits

- Relay keeps the selected file and session link in current-tab memory. It does not persist them in local storage or upload the video. Conversion also creates a temporary in-memory playable copy, released when you replace/remove the file or close the tab.
- MediaInfo.js (BSD-2-Clause) and the optional FFmpeg core (GPL-2.0-or-later) supply local media inspection/conversion. Their runtime assets are served by your Pages site, and GitHub may log asset requests under its privacy policy. The original or converted video is never sent to GitHub. See [MediaInfo.js source](https://github.com/buzz/mediainfo.js) and [FFmpeg.wasm source](https://github.com/ffmpegwasm/ffmpeg.wasm).
- Browser connections are encrypted by WebRTC. Peers can learn one another's IP addresses, and PeerJS/STUN receive connection metadata. GitHub Pages may log visitor IPs under GitHub's own privacy policy.
- A link grants access to whoever has it. Share privately. Receivers necessarily buffer media and can record or save what they can play; no app can guarantee that a viewer stores nothing.
- The Python helper uses a per-run random URL token and HTTP `Cache-Control: no-store`. This discourages caching but cannot stop deliberate recording or saving.
- Browser mode streams decoded, real-time playback and may re-encode it for WebRTC. An optional browser conversion step can create a temporary compatible video in memory before sharing; it is not on-the-fly transcoding, a permanent file URL, an independent on-demand copy, or a VLC-compatible URL.
- VLC mode streams original file bytes. Codec support is determined by VLC. It requires Python and a reachable source device, not just a static webpage.
- Closing, refreshing, or sleeping the sender's browser ends or interrupts browser sharing. Stopping the helper or sleeping the source device interrupts VLC sharing.

## Project Files

- `src/App.tsx`: source workspace and sharing controls.
- `src/hooks/useHostStream.ts`: direct WebRTC source sessions.
- `src/lib/media.ts`: MediaInfo-based audio stream inspection.
- `src/hooks/useBrowserMedia.ts`: optional FFmpeg WASM conversion and cleanup.
- `src/components/WatchView.tsx`: browser receiver.
- `src/components/GuideModal.tsx`: installation and privacy tutorials.
- `src/assets/relay-stream.py`: no-upload, single-file HTTP server for VLC.
- `.github/workflows/deploy.yml`: GitHub Pages deployment.