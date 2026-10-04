import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ArrowDownToLine, ArrowUpRight, BookOpen, Check, CodeXml, Copy, Download, ExternalLink, LockKeyhole, MonitorPlay, X } from 'lucide-react';
import helperSource from '../assets/relay-stream.py?raw';
import guideSource from '../../README.md?raw';
import { copyText, downloadText } from '../lib/utils';
import { VlcIcon } from './Brand';

export type GuideTab = 'start' | 'vlc' | 'github' | 'privacy';

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timeout = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timeout.current), []);
  const copy = async () => {
    try {
      await copyText(code);
      setCopied(true);
      setFailed(false);
      window.clearTimeout(timeout.current);
      timeout.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="code-block">
      <pre><code>{code}</code></pre>
      <button className="code-copy" onClick={() => void copy()} aria-label={copied ? 'Command copied' : 'Copy command'} title="Copy command">
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
      {failed && <span className="code-error">Select the command and copy it manually.</span>}
    </div>
  );
}

function GuideStep({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <section className="guide-step">
      <span className="guide-step-number">{number}</span>
      <div><h3>{title}</h3>{children}</div>
    </section>
  );
}

export function GuideModal({ tab, setTab, onClose, filename, onImportVlc }: {
  tab: GuideTab;
  setTab: (tab: GuideTab) => void;
  onClose: () => void;
  filename?: string;
  onImportVlc: (url: string) => boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [platform, setPlatform] = useState<'mac' | 'windows'>('mac');
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState(false);
  const safeName = (filename || 'video.mp4').replace(/[^a-zA-Z0-9 ._-]/g, '_');
  const command = platform === 'mac'
    ? `python3 relay-stream.py "/full/path/to/${safeName}"`
    : `py relay-stream.py "C:\\Videos\\${safeName}"`;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const elements = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), a[href], input:not(:disabled), [tabindex="0"]');
      if (!elements?.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  const importUrl = () => {
    if (onImportVlc(url.trim())) onClose();
    else setUrlError(true);
  };

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div ref={dialogRef} className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title" initial={{ opacity: 0, y: 25, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 15 }} transition={{ duration: 0.23 }} onClick={(event) => event.stopPropagation()}>
        <div className="guide-header">
          <div className="guide-heading"><span className="guide-book"><BookOpen size={23} /></span><div><h2 id="guide-title">A little guidance. A lot of possibility.</h2><p>Your step-by-step Relay handbook.</p></div></div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close setup guide"><X size={21} /></button>
        </div>
        <div className="guide-tabs" role="tablist" aria-label="Setup topics" onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const tabs: GuideTab[] = ['start', 'vlc', 'github', 'privacy'];
          const offset = event.key === 'ArrowRight' ? 1 : -1;
          const next = event.key === 'Home' ? 'start' : event.key === 'End' ? 'privacy' : tabs[(tabs.indexOf(tab) + offset + tabs.length) % tabs.length];
          setTab(next);
          document.getElementById(`guide-tab-${next}`)?.focus();
        }}>
          {([
            ['start', 'Quick start', <MonitorPlay size={16} />],
            ['vlc', 'VLC streaming', <VlcIcon size={17} />],
            ['github', 'GitHub Pages', <CodeXml size={16} />],
            ['privacy', 'Privacy & limits', <LockKeyhole size={15} />],
          ] as [GuideTab, string, ReactNode][]).map(([id, label, icon]) => (
            <button key={id} role="tab" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} aria-controls={`guide-panel-${id}`} id={`guide-tab-${id}`} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{icon}{label}</button>
          ))}
        </div>
        <div key={tab} className="guide-body" role="tabpanel" id={`guide-panel-${tab}`} aria-labelledby={`guide-tab-${tab}`} tabIndex={0}>
          {tab === 'start' && <>
            <div className="guide-intro"><span className="eyebrow">START HERE</span><h2>From your device to theirs.</h2><p>No accounts. No uploading. Just a video and a direct connection.</p></div>
            <GuideStep number="01" title="Choose the video you want to share."><p>Drop a file into Relay or select <strong>Choose a video</strong>. Use Chrome or Edge as the source browser for the best experience. MP4, WebM, MKV, MOV and AVI files can be inspected; their codecs determine whether native playback works.</p></GuideStep>
            <GuideStep number="02" title="Choose audio and prepare playback."><p>Use <strong>Audio track</strong> below the player to select a language or soundtrack. When a file has multiple tracks, Relay converts your selected track before browser sharing, so viewers hear the right one. If your video cannot play natively, click <strong>Convert for browser</strong>. Conversion supports files up to 150 MB and may take several minutes. The original is never uploaded.</p></GuideStep>
            <GuideStep number="03" title="Create a link. Make a connection."><p>Select <strong>Browser</strong>, then <strong>Create stream link</strong>. Copy the link and send it to someone. They open it in their browser and enable sound if needed. A maximum of four viewers can join.</p></GuideStep>
            <GuideStep number="04" title="You're in control of the playback."><p>The source player controls pause, seeking, looping and the audio choice for <em>everyone</em>. Changing audio while live ends that link; make a fresh link afterward. Keep your tab open and device awake. <strong>Stop sharing</strong> ends the session.</p></GuideStep>
            <p className="guide-fineprint">Running locally? A localhost link only opens on the same device. Publish the page on GitHub Pages before sending browser links to other devices.</p>
            <div className="guide-note"><strong>A browser link is not a VLC link.</strong><p>GitHub Pages cannot run a server on your device. Browser links use WebRTC; VLC needs an HTTP URL from the local helper.</p><button className="text-link" onClick={() => setTab('vlc')}>Show me the VLC setup <ArrowUpRight size={15} /></button></div>
            <p className="guide-fineprint">Browsers cannot play literally every VLC codec. MediaInfo and FFmpeg WebAssembly files are fetched from your Relay Pages site when needed; your video is processed locally. Conversion uses temporary browser memory and can fail on limited devices or DRM-protected/unsupported formats. For large or unconvertible files, use VLC. Direct WebRTC connections may also fail on restrictive networks.</p>
          </>}

          {tab === 'vlc' && <>
            <div className="guide-intro"><span className="eyebrow">FOR YOUR FAVORITE PLAYER</span><h2>A real URL. Ready for VLC.</h2><p>A tiny local helper streams the original file, with no copy and no upload.</p></div>
            <GuideStep number="01" title="Get Python and the streaming helper."><p>Install <a href="https://www.python.org/downloads/" target="_blank" rel="noreferrer">Python 3.8+ <ExternalLink size={12} /></a> if you don't have it, then download the helper. No extra Python packages are needed.</p><button className="button button-secondary helper-download" onClick={() => downloadText(helperSource, 'relay-stream.py', 'text/x-python')}><Download size={16} /> Download helper <span>.py</span></button></GuideStep>
            <GuideStep number="02" title="Run it on the device with your video."><p>Open a terminal in the folder where you downloaded the helper. Replace the example path below with your video's <strong>actual full path</strong>. Selecting a file in a browser cannot reveal its filesystem path.</p><div className="platform-switch"><button className={platform === 'mac' ? 'active' : ''} onClick={() => setPlatform('mac')}>macOS / Linux</button><button className={platform === 'windows' ? 'active' : ''} onClick={() => setPlatform('windows')}>Windows</button></div><CodeBlock code={command} /><p className="guide-fineprint">On Windows, allow Python through the firewall for private networks only. If the port is busy, add <code>--port 8766</code>. If the IP is incorrect, add <code>--advertise YOUR_LAN_IP</code>.</p></GuideStep>
            <GuideStep number="03" title="Copy the printed URL into VLC."><p>Connect both devices to the same trusted Wi-Fi or a trusted private VPN. In <a href="https://www.videolan.org/vlc/" target="_blank" rel="noreferrer">VLC <ExternalLink size={12} /></a>, choose <strong>Media &gt; Open Network Stream</strong> (Ctrl+N), or <strong>File &gt; Open Network</strong> on macOS. Paste the HTTP URL and play.</p><p>You can also add the printed URL to Relay to copy it or download a VLC playlist:</p><div className="import-url"><input aria-label="HTTP URL printed by the streaming helper" type="url" placeholder="http://192.168.1.42:8765/stream/..." value={url} onChange={(event) => { setUrl(event.target.value); setUrlError(false); }} onKeyDown={(event) => { if (event.key === 'Enter') importUrl(); }} /><button className="button button-primary" onClick={importUrl}>Use link <ArrowUpRight size={16} /></button></div>{urlError && <p className="field-error">Enter a complete http:// or https:// URL from the helper.</p>}</GuideStep>
            <div className="guide-note"><strong>Keep the terminal open, not necessarily the website.</strong><p>Ctrl+C stops sharing. The helper reads the original file in small chunks and supports seeking. HTTP is not encrypted: only use a trusted LAN or secured private VPN, and never expose this helper directly to the public internet.</p></div>
          </>}

          {tab === 'github' && <>
            <div className="guide-intro"><span className="eyebrow">YOUR OWN CORNER OF THE WEB</span><h2>Make yourself at home on GitHub Pages.</h2><p>One static website. No hosting bill. No video files in your repository.</p></div>
            <GuideStep number="01" title="Install and build the project."><p>Install <a href="https://nodejs.org/" target="_blank" rel="noreferrer">Node.js 22+ <ExternalLink size={12} /></a>. Download the project files, open a terminal in the project folder, and run:</p><CodeBlock code={'npm install\nnpm run dev'} /><p>The local site usually opens at <code>http://localhost:5173</code>. For a GitHub Pages project URL, build with a relative asset base:</p><CodeBlock code="npm run build -- --base=./" /></GuideStep>
            <GuideStep number="02" title="Publish the source with GitHub Actions (recommended)."><p>Push the full project, including <code>.github/workflows/deploy.yml</code> and <code>package-lock.json</code>, to a public GitHub repository's <strong>main</strong> branch. In <strong>Settings &gt; Pages</strong>, choose <strong>GitHub Actions</strong> as the source. Push a change or run <strong>Deploy Relay to GitHub Pages</strong> in Actions; it builds and publishes the complete <code>dist</code> directory.</p></GuideStep>
            <GuideStep number="03" title="Open your deployed page."><p>Wait for the workflow to finish. Visit the Pages URL in the deployment output, enable HTTPS, and share your link:</p><CodeBlock code="https://YOUR_USERNAME.github.io/relay/" /></GuideStep>
            <div className="guide-note"><strong>Building manually instead?</strong><p>GitHub's browser upload is limited to 25 MiB per file; the FFmpeg WASM asset is around 32 MB. Build with <code>npm run build -- --base=./</code>, then <strong>git push every file inside dist to the root of an empty repository</strong> and enable <strong>Deploy from a branch &gt; main &gt; / (root)</strong>. See the downloadable full guide for exact Git commands. Do not upload only index.html.</p></div>
            <p className="guide-fineprint">GitHub Pages hosts the interface, conversion worker, MediaInfo and FFmpeg assets. PeerJS handles connection signaling. The actual video is never deployed, and the VLC helper runs on your source device, not GitHub.</p>
          </>}

          {tab === 'privacy' && <>
            <div className="guide-intro"><span className="eyebrow">A FEW THINGS WORTH KNOWING</span><h2>Local first. Honest always.</h2><p>Here's what stays private, and where the practical limits are.</p></div>
            <GuideStep number="01" title="Your original video stays on your device."><p>Relay does not upload videos or save them in cloud storage. MediaInfo inspects local file slices. FFmpeg WebAssembly can create a temporary converted copy in browser memory, removed when you replace the file or close the tab. Recipients necessarily buffer media and can record it.</p></GuideStep>
            <GuideStep number="02" title="Browser streams are encrypted, not anonymous."><p>WebRTC encrypts media between peers. PeerJS and STUN exchange connection metadata, and connected peers can learn each other's IP addresses. GitHub Pages may log visits under GitHub's privacy policy. No TURN media relay or analytics is configured by this app.</p></GuideStep>
            <GuideStep number="03" title="A link is an invitation. Share it carefully."><p>Anyone with a link can watch while the source is active. Browser links have a random session key. The VLC helper generates a new secret URL every run, but HTTP is unencrypted and should only be used on trusted networks. Stopping the source invalidates the session.</p></GuideStep>
            <GuideStep number="04" title="Always source-dependent."><p>Browser sharing requires a supported source browser, an open tab, and a successful direct network route. The sender selects audio for everyone. Browser conversion is limited to 150 MB, downloads its codec assets from your Pages site (about 32 MB on first use), and cannot guarantee every codec or protected file. VLC requires the local Python helper and a reachable source address. Neither mode works after the source device turns off.</p></GuideStep>
          </>}
        </div>
        <div className="guide-footer"><span>Good things come with good instructions.</span><button className="text-link" onClick={() => downloadText(guideSource, 'relay-setup-guide.md', 'text/markdown')}><ArrowDownToLine size={15} /> Download full guide</button></div>
      </motion.div>
    </motion.div>
  );
}