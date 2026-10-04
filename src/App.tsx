import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { ArrowUpRight, AudioLines, BookOpen, Check, CircleAlert, CircleCheck, CodeXml, Copy, Download, FileVideo, FolderOpen, Info, Link2, LoaderCircle, LockKeyhole, Monitor, ShieldCheck, Square, X } from 'lucide-react';
import { Brand, VlcIcon } from './components/Brand';
import { GuideModal, type GuideTab } from './components/GuideModal';
import { WatchView } from './components/WatchView';
import { useBrowserMedia } from './hooks/useBrowserMedia';
import { useHostStream } from './hooks/useHostStream';
import { MAX_BROWSER_CONVERSION_BYTES } from './lib/media';
import { copyText, downloadText, formatBytes, formatDuration, isHttpUrl, readWatchLink } from './lib/utils';

type Toast = { message: string; kind: 'success' | 'error'; id: number };

function UploadIllustration() {
  return (
    <svg className="upload-illustration" width="104" height="88" viewBox="0 0 104 88" fill="none" aria-hidden="true">
      <path d="M14 14h12M14 14v12M90 64H78M90 64V52" stroke="#E3DBD1" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="34" y="11" width="51" height="55" rx="8" transform="rotate(12 34 11)" fill="#FFF2E8" stroke="#F1C6AC" strokeWidth="1.5" />
      <rect x="22" y="24" width="57" height="44" rx="8" fill="#FFFDF9" stroke="#ED8858" strokeWidth="1.7" />
      <path d="m46 36 15 10-15 10V36Z" fill="#ED8858" />
      <path d="M30 29v5M30 58v5M71 29v5M71 58v5" stroke="#EFCBB5" strokeWidth="2" strokeLinecap="round" />
      <path d="M44 78h19" stroke="#E9E2D9" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState('');
  const [duration, setDuration] = useState(Number.NaN);
  const [ready, setReady] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [loop, setLoop] = useState(true);
  const [mode, setMode] = useState<'browser' | 'vlc'>('browser');
  const [vlcUrl, setVlcUrl] = useState('');
  const [guide, setGuide] = useState<GuideTab | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [copied, setCopied] = useState(false);
  const [watch, setWatch] = useState(readWatchLink);
  const [selectedAudio, setSelectedAudio] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const urlRef = useRef('');
  const nativePlayableRef = useRef(false);
  const resumeRef = useRef<{ time: number; wasPlaying: boolean } | null>(null);
  const conversionAttemptRef = useRef(0);
  const pendingSelectionRef = useRef<{ previous: number; wasReady: boolean; wasPlaying: boolean } | null>(null);
  const autoStartRef = useRef(false);
  const dragDepth = useRef(0);
  const toastTimer = useRef<number | undefined>(undefined);
  const copyTimer = useRef<number | undefined>(undefined);
  const toastId = useRef(0);

  const notify = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, kind, id: ++toastId.current });
    toastTimer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 6500 : 3500);
  }, []);
  const host = useHostStream(videoRef, notify);
  const browserMedia = useBrowserMedia();
  const closeGuide = useCallback(() => setGuide(null), []);
  const openGuide = useCallback((tab: GuideTab) => setGuide(tab), []);

  useEffect(() => {
    const onHashChange = () => {
      const session = readWatchLink();
      if (session) host.stop();
      setWatch(session);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [host.stop]);

  useEffect(() => {
    const input = inputRef.current;
    const onCancel = () => { autoStartRef.current = false; };
    input?.addEventListener('cancel', onCancel);
    return () => input?.removeEventListener('cancel', onCancel);
  }, [watch]);

  useEffect(() => {
    const preventFileNavigation = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    window.clearTimeout(toastTimer.current);
    window.clearTimeout(copyTimer.current);
  }, []);

  const goHome = () => {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setWatch(null);
  };

  const chooseFile = (autoStart = false) => {
    autoStartRef.current = autoStart;
    inputRef.current?.click();
  };

  const loadFile = (next: File) => {
    if (!next.size) {
      autoStartRef.current = false;
      notify('This file is empty. Choose a video with playable content.', 'error');
      return;
    }
    if (!next.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v|ogv|ogg|mkv|mk3d|avi|mpeg|mpg|ts|m2ts|mts|m2v|flv|wmv|asf|vob|3gp|mxf|divx|f4v)$/i.test(next.name)) {
      autoStartRef.current = false;
      notify('That does not look like a video. Choose an MP4, WebM, MOV, or another video file.', 'error');
      return;
    }
    host.stop();
    conversionAttemptRef.current += 1;
    browserMedia.reset();
    nativePlayableRef.current = false;
    resumeRef.current = null;
    pendingSelectionRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(next);
    setFile(next);
    setObjectUrl(urlRef.current);
    setDuration(Number.NaN);
    setReady(false);
    setVideoError('');
    setCopied(false);
    setVlcUrl('');
    setSelectedAudio(0);
    if (inputRef.current) inputRef.current.value = '';
    void browserMedia.inspect(next);
  };

  const removeFile = () => {
    const wasLive = host.status === 'live';
    host.stop();
    conversionAttemptRef.current += 1;
    browserMedia.reset();
    nativePlayableRef.current = false;
    resumeRef.current = null;
    pendingSelectionRef.current = null;
    autoStartRef.current = false;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = '';
    setFile(null);
    setObjectUrl('');
    setReady(false);
    setVideoError('');
    setDuration(Number.NaN);
    setSelectedAudio(0);
    if (wasLive) notify('Video removed. Your stream has stopped.');
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    autoStartRef.current = false;
    const next = event.dataTransfer.files[0];
    if (next) loadFile(next);
  };

  const activeURL = browserMedia.converted?.url || objectUrl;
  const converting = browserMedia.conversion.phase === 'loading' || browserMedia.conversion.phase === 'converting';
  const selectedTrack = browserMedia.details?.audioTracks[selectedAudio];
  const audioNeedsConversion = Boolean(selectedTrack && !browserMedia.converted && (
    (browserMedia.details?.audioTracks.length ?? 0) > 1 ||
    !/^(AAC|MPEG Audio|Opus|Vorbis|FLAC)$/i.test(selectedTrack.codec)
  ));

  useEffect(() => {
    if (file && browserMedia.details && !browserMedia.converted) {
      setSelectedAudio(browserMedia.details.defaultAudio);
    }
  }, [file, browserMedia.details, browserMedia.converted]);

  const prepareBrowserPlayback = async (index: number) => {
    if (!file || converting) return;
    const request = ++conversionAttemptRef.current;
    const player = videoRef.current;
    const previous = selectedAudio;
    const wasReady = ready;
    pendingSelectionRef.current = { previous, wasReady, wasPlaying: Boolean(player && !player.paused) };
    resumeRef.current = player && !videoError
      ? { time: player.currentTime, wasPlaying: !player.paused }
      : null;
    if (host.status === 'live' || host.status === 'connecting') {
      host.stop();
      notify('Sharing stopped to change playback. Create a fresh link after conversion.');
    }
    player?.pause();
    setSelectedAudio(index);
    setReady(false);
    const succeeded = await browserMedia.convert(file, index, browserMedia.details, nativePlayableRef.current);
    if (request !== conversionAttemptRef.current) return;
    pendingSelectionRef.current = null;
    if (succeeded) {
      setVideoError('');
      notify('Browser-friendly video is ready. The selected audio is now part of the playback.');
    } else {
      setSelectedAudio(previous);
      setReady(wasReady);
      resumeRef.current = null;
      if (wasReady && player && !videoError) void player.play().catch(() => {});
    }
  };

  const cancelBrowserConversion = () => {
    const pending = pendingSelectionRef.current;
    conversionAttemptRef.current += 1;
    browserMedia.cancelConversion();
    resumeRef.current = null;
    pendingSelectionRef.current = null;
    setSelectedAudio(pending?.previous ?? selectedAudio);
    setReady(pending?.wasReady ?? (nativePlayableRef.current || Boolean(browserMedia.converted)));
    if (pending?.wasPlaying && videoRef.current && !videoError) {
      void videoRef.current.play().catch(() => {});
    }
  };

  const startOrStop = () => {
    if (host.status === 'live') {
      host.stop();
      notify('Sharing stopped. Your previous link is no longer active.');
    } else if (!file) {
      chooseFile(true);
    } else if ((videoError || audioNeedsConversion) && file.size > MAX_BROWSER_CONVERSION_BYTES) {
      setMode('vlc');
      setGuide('vlc');
    } else if (videoError || audioNeedsConversion) {
      void prepareBrowserPlayback(selectedAudio);
    } else if (ready) {
      void host.start(file, selectedTrack?.label || (browserMedia.details && !browserMedia.details.hasAudio ? 'No audio' : 'Default audio'));
    } else {
      notify('Your video is still loading. Please try again in a moment.', 'error');
    }
  };

  useEffect(() => {
    if (!autoStartRef.current || !file || !ready || videoError || browserMedia.inspecting || converting || host.status !== 'idle') return;
    if (browserMedia.details && !browserMedia.converted && selectedAudio !== browserMedia.details.defaultAudio) return;
    autoStartRef.current = false;
    if (audioNeedsConversion) {
      if (file.size > MAX_BROWSER_CONVERSION_BYTES) {
        setMode('vlc');
        setGuide('vlc');
      } else {
        void prepareBrowserPlayback(selectedAudio);
      }
    } else {
      void host.start(file, selectedTrack?.label || (browserMedia.details && !browserMedia.details.hasAudio ? 'No audio' : 'Default audio'));
    }
  }, [file, ready, videoError, browserMedia.inspecting, browserMedia.details, browserMedia.converted, converting, audioNeedsConversion, selectedAudio, selectedTrack, host.status, host.start]);

  const copyLink = async () => {
    const link = mode === 'browser' ? host.link : vlcUrl.trim();
    if (!link || (mode === 'vlc' && !isHttpUrl(link))) return;
    try {
      await copyText(link);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
      notify('Link copied. A good video deserves company.');
    } catch {
      notify('Clipboard access was blocked. Select the URL and copy it manually.', 'error');
    }
  };

  const importVlc = (url: string) => {
    if (!isHttpUrl(url)) return false;
    setVlcUrl(url);
    setMode('vlc');
    if (watch) goHome();
    notify('VLC link added. Keep the local helper running on your source device.');
    return true;
  };

  const downloadPlaylist = () => {
    if (!isHttpUrl(vlcUrl)) return;
    const name = (file?.name || 'Relay video stream').replace(/[\r\n]/g, ' ');
    downloadText(`#EXTM3U\n#EXTINF:-1,${name}\n${new URL(vlcUrl.trim()).href}\n`, 'relay-stream.m3u', 'audio/x-mpegurl');
    notify('Playlist downloaded. Open it in VLC to play the source stream.');
  };

  const isLive = host.status === 'live';
  const isConnecting = host.status === 'connecting';
  const hasVlcLink = isHttpUrl(vlcUrl);
  const canCopy = mode === 'browser' ? Boolean(host.link) : hasVlcLink;

  return (
    <MotionConfig reducedMotion="user">
      {watch ? <WatchView session={watch} onBack={goHome} onGuide={openGuide} /> : <div className="app-shell">
        <motion.header className="site-header" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
          <div className="header-inner">
            <button className="brand-button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Relay home"><Brand /></button>
            <nav className="main-nav" aria-label="Main navigation">
              <button className="nav-active" onClick={() => document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>New stream</button>
              <button onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}>How it works</button>
            </nav>
            <div className="header-right"><span className="header-local"><LockKeyhole size={14} /> Files stay with you</span><button className="header-guide" onClick={() => setGuide('start')}><BookOpen size={16} /> Setup guide <ArrowUpRight size={14} /></button></div>
          </div>
        </motion.header>

        <main className="main-container">
          <motion.div className="page-intro" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.08 }}>
            <div className="intro-kicker"><span className="kicker-line" /> LOCAL-FIRST VIDEO SHARING</div>
            <h1>Your video. <span>Just a link.</span></h1>
            <p>Stream straight from your device. No uploads. No cloud storage. All yours.</p>
          </motion.div>

          <motion.section id="workspace" className="workspace" aria-label="Create a video stream" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.18 }}>
            <div className="source-panel interactive-panel">
              <div className="panel-heading"><div className="panel-title"><span className="step-number">01</span><h2>Your video</h2></div>{file ? <button className="icon-button remove-source" onClick={removeFile} aria-label="Remove preview video and stop browser sharing" title="Remove video"><X size={18} /></button> : <span className="panel-meta">THE SOURCE</span>}</div>
              <div className="source-body">
                <input ref={inputRef} type="file" accept="video/*,.mkv,.mk3d,.avi,.wmv,.flv,.vob,.asf,.mxf,.m2v,.mts,.m2ts,.ts,.divx,.f4v" className="hidden-file-input" aria-label="Choose a video from your device" onChange={(event) => { const next = event.target.files?.[0]; if (next) loadFile(next); }} />
                <motion.div className={`upload-area${dragging ? ' is-dragging' : ''}${file ? ' has-video' : ''}`} animate={{ scale: dragging ? 1.012 : 1 }} transition={{ duration: 0.2 }} onDragEnter={(event) => { event.preventDefault(); dragDepth.current += 1; setDragging(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }} onDrop={onDrop}>
                  {!file ? <div className="empty-source"><UploadIllustration /><h3>{dragging ? 'Drop it. Make it a moment.' : 'Drop your video here'}</h3><p>Good things are better when shared.</p><button className="button button-primary choose-button" onClick={() => chooseFile()}><FolderOpen size={17} /> Choose a video</button><span className="file-formats">MP4 <span /> WEBM <span /> MOV <span /> & MORE</span></div> : <>
                    <video
                      key={activeURL}
                      ref={videoRef}
                      src={activeURL}
                      controls
                      playsInline
                      muted
                      loop={loop}
                      preload="auto"
                      className={videoError || converting ? 'source-video video-failed' : 'source-video'}
                      onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? Number.NaN)}
                      onCanPlay={() => {
                        if (activeURL === objectUrl) nativePlayableRef.current = true;
                        setVideoError('');
                        setReady(true);
                        const resume = resumeRef.current;
                        if (resume && videoRef.current) {
                          resumeRef.current = null;
                          if (Number.isFinite(resume.time) && resume.time > 0) {
                            try { videoRef.current.currentTime = Math.min(resume.time, Math.max(0, videoRef.current.duration - 0.25)); } catch { /* Some files are not seekable. */ }
                          }
                          if (resume.wasPlaying) void videoRef.current.play().catch(() => {});
                        }
                      }}
                      onEnded={() => { if (isLive || isConnecting) { host.stop(); notify('The video ended. Create a new link to share it again.'); } }}
                      onError={() => {
                        autoStartRef.current = false;
                        setReady(false);
                        if (isLive || isConnecting) host.stop();
                        setVideoError(activeURL === objectUrl
                          ? 'This codec is not supported by your browser. Convert it locally to play and share it on the web.'
                          : 'This browser cannot decode the converted video. Try a different browser or use VLC.');
                      }}
                    />
                    {converting && <div className="conversion-state" role="status" aria-live="polite"><LoaderCircle size={31} className="spin" /><h3>{browserMedia.conversion.phase === 'loading' ? 'Loading the codec engine' : 'Making this video browser-ready'}</h3><p>{browserMedia.conversion.message} Nothing is uploaded.</p><div className="conversion-meter" role="progressbar" aria-label="Video conversion progress" aria-valuenow={browserMedia.conversion.progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${browserMedia.conversion.progress}%` }} /></div><span className="conversion-progress">{browserMedia.conversion.phase === 'loading' ? 'Preparing engine...' : `${browserMedia.conversion.progress}% - this may take a few minutes`}</span><button className="text-link" onClick={cancelBrowserConversion}>Cancel conversion</button></div>}
                    {videoError && !converting && <div className="video-error-state"><FileVideo size={38} strokeWidth={1.3} /><h3>Let's make this playable.</h3><p>{browserMedia.conversion.phase === 'error' ? browserMedia.conversion.message : videoError}</p>{file.size <= MAX_BROWSER_CONVERSION_BYTES && <button className="button button-primary" disabled={browserMedia.inspecting} onClick={() => void prepareBrowserPlayback(selectedAudio)}><AudioLines size={16} /> {browserMedia.inspecting ? 'Finding audio tracks...' : 'Convert for browser'}</button>}<button className="text-link video-fallback" onClick={() => { setMode('vlc'); setGuide('vlc'); }}><VlcIcon /> {file.size > MAX_BROWSER_CONVERSION_BYTES ? 'Large file? Use VLC instead' : 'Or stream the original in VLC'} <ArrowUpRight size={14} /></button></div>}
                    {dragging && <div className="drop-replace"><FolderOpen size={30} /><strong>Drop to replace your video</strong><span>Replacing the source ends the current browser stream.</span></div>}
                  </>}
                </motion.div>
                {file ? <div className="selected-file"><span className="selected-file-icon"><FileVideo size={21} /></span><div className="selected-file-detail"><strong title={file.name}>{file.name}</strong><span>{formatBytes(file.size)} <i /> {formatDuration(duration)} <i /> {(file.name.split('.').pop() || 'VIDEO').toUpperCase()}</span></div><button className="change-file text-link" onClick={() => chooseFile()} title="Choose a different video">Change <ArrowUpRight size={13} /></button></div> : <div className="source-assurance"><span><ShieldCheck size={15} /> Stays on your device</span><span>No size cap for native/VLC</span></div>}
                {file && <div className="audio-controls"><label htmlFor="audio-track"><AudioLines size={17} /><span>Audio track</span></label>{browserMedia.inspecting ? <span className="audio-detail">Finding audio tracks...</span> : browserMedia.details?.audioTracks.length ? <select id="audio-track" value={selectedAudio} disabled={converting || browserMedia.details.audioTracks.length < 2 || file.size > MAX_BROWSER_CONVERSION_BYTES} title={file.size > MAX_BROWSER_CONVERSION_BYTES ? 'For large videos, use VLC to select an audio track.' : undefined} onChange={(event) => { const index = Number(event.target.value); if (index !== selectedAudio) void prepareBrowserPlayback(index); }} aria-label="Choose the audio track for browser playback">{browserMedia.details.audioTracks.map((track) => <option key={track.index} value={track.index}>{track.label}{track.isDefault ? ' (default)' : ''}</option>)}</select> : <span className="audio-detail">{browserMedia.inspectionError || browserMedia.details?.hasAudio ? 'Track info unavailable' : 'No audio tracks detected'}</span>}</div>}
                {file && browserMedia.details && <p className="codec-detail">Video: {browserMedia.details.videoCodec}{browserMedia.converted ? ' / Converted for browser' : ''}{browserMedia.details.audioTracks.length > 1 ? file.size > MAX_BROWSER_CONVERSION_BYTES ? ' / Use VLC to select audio for this large file.' : ' / Selecting a track converts it locally and stops live sharing.' : ''}</p>}
                {file && !browserMedia.converted && !videoError && !converting && !browserMedia.inspecting && (browserMedia.details?.hasAudio || browserMedia.inspectionError) && file.size <= MAX_BROWSER_CONVERSION_BYTES && <button className="text-link audio-fix" onClick={() => void prepareBrowserPlayback(selectedAudio)}>{(browserMedia.details?.audioTracks.length ?? 0) > 1 ? 'Prepare selected audio for browser sharing' : audioNeedsConversion ? 'Audio codec may not play here. Convert for browser' : 'Wrong or silent audio? Convert for browser'} <ArrowUpRight size={13} /></button>}
                {file && browserMedia.conversion.phase === 'error' && !videoError && <p className="conversion-inline-error" role="alert">{browserMedia.conversion.message}</p>}
              </div>
              <div className="source-panel-footer"><span className="source-device"><Monitor size={15} /> {file ? 'Source on this device' : 'Your device is the source'}</span>{file ? <button className="loop-control" role="switch" aria-checked={loop} onClick={() => setLoop((value) => !value)}><span className={`mini-switch${loop ? ' on' : ''}`} /> Loop video</button> : <span className="local-only"><span /> LOCAL ONLY</span>}</div>
            </div>

            <div className="share-panel interactive-panel">
              <div className="panel-heading"><div className="panel-title"><span className="step-number">02</span><h2>Share your stream</h2></div><Link2 size={18} className="panel-heading-icon" /></div>
              <div className="share-body">
                <div className="mode-tabs" role="tablist" aria-label="Stream link type" onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'browser' : event.key === 'End' ? 'vlc' : mode === 'browser' ? 'vlc' : 'browser'; setMode(next); setCopied(false); document.getElementById(`share-tab-${next}`)?.focus(); } }}>
                  {(['browser', 'vlc'] as const).map((option) => <button key={option} id={`share-tab-${option}`} className={mode === option ? 'active' : ''} role="tab" tabIndex={mode === option ? 0 : -1} aria-selected={mode === option} aria-controls="share-mode-content" onClick={() => { setMode(option); setCopied(false); }}>{mode === option && <motion.span className="mode-active-background" layoutId="active-share-mode" transition={{ type: 'spring', stiffness: 420, damping: 35 }} />}<span className="mode-label">{option === 'browser' ? <Monitor size={16} /> : <VlcIcon size={17} />}{option === 'browser' ? 'Browser' : 'VLC player'}</span></button>)}
                </div>
                <div id="share-mode-content" role="tabpanel" aria-labelledby={`share-tab-${mode}`}>
                  <p className="mode-description">{mode === 'browser' ? 'One link. A direct connection.' : 'Original video. Your favorite player.'}</p>
                  <div className="link-label-row"><label htmlFor="stream-link">{mode === 'browser' ? 'YOUR STREAM LINK' : 'YOUR VLC STREAM URL'}</label>{mode === 'browser' && host.link && <a href={host.link} target="_blank" rel="noreferrer" className="text-link">Open link <ArrowUpRight size={12} /></a>}</div>
                  <div className={`link-field${canCopy ? ' has-link' : ''}`}><Link2 size={16} className="link-field-icon" /><input id="stream-link" readOnly={mode === 'browser'} value={mode === 'browser' ? host.link : vlcUrl} placeholder={mode === 'browser' ? 'Your link will appear here' : 'Paste the URL from the helper'} aria-label={mode === 'browser' ? 'Browser stream link' : 'HTTP stream URL for VLC'} spellCheck={false} autoComplete="off" onChange={(event) => { if (mode === 'vlc') { setVlcUrl(event.target.value); setCopied(false); } }} /><button className={`copy-link${copied ? ' is-copied' : ''}`} disabled={!canCopy} onClick={() => void copyLink()} aria-label={copied ? 'Link copied' : 'Copy stream link'} title="Copy link">{copied ? <Check size={17} /> : <Copy size={17} />}</button></div>
                  <p className="link-hint">{mode === 'browser' ? isLive ? 'Ready to share. Your link is live while you are.' : isConnecting ? 'Making a direct connection...' : converting ? 'Converting locally before browser sharing...' : file ? videoError ? 'This format needs conversion or the VLC helper.' : audioNeedsConversion ? 'Prepare the selected audio track before sharing.' : ready ? 'Your video is ready. Give it a link.' : 'Loading your local video...' : 'Choose a video to get things flowing.' : vlcUrl && !hasVlcLink ? 'Enter a full http:// or https:// URL.' : hasVlcLink ? 'Link added. Make sure the source helper is running.' : 'The local helper prints this URL when it starts.'}</p>
                  {mode === 'browser' ? <button className={`button create-link-button${isLive ? ' button-stop' : ' button-primary'}`} disabled={isConnecting || converting || browserMedia.inspecting || (Boolean(file) && !ready && !videoError && !audioNeedsConversion)} onClick={startOrStop}>{isConnecting || converting ? <LoaderCircle size={18} className="spin" /> : isLive ? <Square size={14} fill="currentColor" /> : <Link2 size={18} />}<span>{isConnecting ? 'Creating your link...' : converting ? 'Converting on your device...' : isLive ? 'Stop sharing' : (videoError || audioNeedsConversion) && Boolean(file && file.size > MAX_BROWSER_CONVERSION_BYTES) ? 'Use VLC for this file' : videoError ? 'Convert for browser' : audioNeedsConversion ? 'Prepare audio for browser' : 'Create stream link'}</span>{!isConnecting && !converting && !isLive && <ArrowUpRight size={19} className="button-trailing-icon" />}</button> : <button className="button button-primary create-link-button" onClick={() => hasVlcLink ? downloadPlaylist() : setGuide('vlc')}>{hasVlcLink ? <Download size={17} /> : <VlcIcon size={19} />}<span>{hasVlcLink ? 'Download VLC playlist' : 'Set up VLC streaming'}</span><ArrowUpRight size={19} className="button-trailing-icon" /></button>}
                  <div className="sharing-reminder"><span className="reminder-icon">{mode === 'browser' ? <ShieldCheck size={21} strokeWidth={1.5} /> : <VlcIcon size={23} />}</span><div><h3>{mode === 'browser' ? 'You are the source.' : 'A little helper. A real URL.'}</h3><p>{mode === 'browser' ? 'Keep this tab open and your device awake. Your video streams directly from here.' : 'VLC needs an HTTP stream. Run the helper on the device with your video. No uploads needed.'}</p><button className="text-link reminder-link" onClick={() => setGuide(mode === 'browser' ? 'privacy' : 'vlc')}>{mode === 'browser' ? 'Private by design' : 'View the setup guide'} <ArrowUpRight size={13} /></button></div></div>
                </div>
              </div>
              <div className="share-panel-footer"><span className={`status-dot${isLive ? ' is-live' : isConnecting ? ' is-connecting' : ''}`} />{isLive ? <><span>Browser stream is live</span><span className="viewer-count">{host.viewers} watching</span></> : <span>{isConnecting ? 'Connecting your device' : mode === 'vlc' && hasVlcLink ? 'VLC link added, not verified' : 'Ready when you are'}</span>}</div>
            </div>
          </motion.section>

          <motion.div className="workspace-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.4 }}><div><Info size={15} /><span>Browser links are made for browsers. Using VLC? We've got a helper for that.</span></div><button className="text-link" onClick={() => setGuide('vlc')}>See how <ArrowUpRight size={13} /></button></motion.div>

          <motion.section id="how-it-works" className="how-section" initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.5 }} aria-labelledby="how-title">
            <div className="how-intro"><span className="eyebrow">SIMPLE BY NATURE</span><h2 id="how-title">Less cloud.<br />{' '}More connection.</h2><button className="text-link" onClick={() => setGuide('start')}>How Relay works <ArrowUpRight size={14} /></button></div>
            <div className="how-step"><span className="how-number">01 <span /></span><h3>Pick your video.</h3><p>Big or small, your file stays right where it belongs. On your device.</p></div>
            <div className="how-step"><span className="how-number">02 <span /></span><h3>Pass along a link.</h3><p>Connect directly in a browser, or use the local helper for VLC.</p></div>
            <div className="how-step"><span className="how-number">03</span><h3>Keep the moment going.</h3><p>Stay connected while they watch. Stop sharing whenever you like.</p></div>
          </motion.section>
        </main>

        <footer className="site-footer"><div className="footer-inner"><div className="footer-brand"><Brand compact /><span>A direct way to share.</span></div><div className="footer-links"><button onClick={() => setGuide('privacy')}>Privacy & limits</button><button onClick={() => setGuide('github')}><CodeXml size={15} /> GitHub Pages ready <ArrowUpRight size={12} /></button></div></div></footer>
      </div>}

      <AnimatePresence>{guide && <GuideModal tab={guide} setTab={setGuide} onClose={closeGuide} filename={file?.name} onImportVlc={importVlc} />}</AnimatePresence>
      <AnimatePresence>{toast && <motion.div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} initial={{ opacity: 0, y: 15, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }}>{toast.kind === 'success' ? <CircleCheck size={20} /> : <CircleAlert size={20} />}<span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={16} /></button></motion.div>}</AnimatePresence>
    </MotionConfig>
  );
}
