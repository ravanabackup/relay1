import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowUpRight, AudioLines, CircleAlert, LoaderCircle, MonitorPlay, RefreshCw, ShieldCheck, Volume2, VolumeX } from 'lucide-react';
import type Peer from 'peerjs';
import type { DataConnection, MediaConnection } from 'peerjs';
import { createPeer, peerErrorMessage } from '../lib/peer';
import { formatBytes } from '../lib/utils';
import { Brand } from './Brand';
import type { GuideTab } from './GuideModal';

export function WatchView({ session, onBack, onGuide }: {
  session: { id: string; key: string };
  onBack: () => void;
  onGuide: (tab: GuideTab) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'live' | 'error' | 'ended'>('connecting');
  const [message, setMessage] = useState('Finding a direct route to the source device...');
  const [source, setSource] = useState({ name: 'A video, sent straight to you.', size: 0, audio: '' });
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  useEffect(() => {
    let disposed = false;
    let peer: Peer | null = null;
    let connection: DataConnection | undefined;
    let call: MediaConnection | undefined;
    let remoteStream: MediaStream | undefined;
    let connected = false;
    let terminal = false;
    let disconnectTimer: number | undefined;
    setStatus('connecting');
    setMessage('Finding a direct route to the source device...');
    setPaused(false);
    setMuted(true);
    setPlaybackBlocked(false);
    const fail = (error: string, ended = false) => {
      if (disposed || terminal) return;
      terminal = true;
      window.clearTimeout(timeout);
      window.clearTimeout(disconnectTimer);
      setStatus(ended ? 'ended' : 'error');
      setMessage(error);
      call?.close();
      connection?.close();
      peer?.destroy();
      remoteStream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    const timeout = window.setTimeout(() => fail('A direct route could not be established. Keep the source tab open and try the same Wi-Fi, or use the VLC helper on a trusted network.'), 30000);

    try {
      peer = createPeer();
      peer.on('call', (incoming) => {
        if (incoming.peer !== session.id || incoming.metadata?.channel !== connection?.connectionId || terminal || call) {
          incoming.close();
          return;
        }
        call = incoming;
        const onConnectionState = () => {
          if (disposed || terminal) return;
          const state = incoming.peerConnection?.connectionState;
          if (state === 'connected' && remoteStream) {
            connected = true;
            window.clearTimeout(timeout);
            window.clearTimeout(disconnectTimer);
            disconnectTimer = undefined;
            setStatus('live');
            setMessage('Connected directly to the source device.');
          } else if (state === 'failed') {
            fail('The direct media connection failed. Try reconnecting on the same Wi-Fi or use the VLC helper.');
          } else if (state === 'closed') {
            fail('The source has closed this stream. Ask the sender for a new link.', true);
          } else if (state === 'disconnected' && disconnectTimer === undefined) {
            disconnectTimer = window.setTimeout(() => fail('The source connection was lost. Please reconnect.'), 15000);
          }
        };
        incoming.on('stream', (stream) => {
          if (disposed || terminal) return;
          remoteStream = stream;
          const video = videoRef.current;
          if (video) {
            video.srcObject = stream;
            video.muted = true;
            void video.play().catch(() => { if (!disposed && !terminal) setPlaybackBlocked(true); });
          }
          onConnectionState();
        });
        incoming.on('close', () => fail('The source has stopped sharing. Ask the sender for a new link.', true));
        incoming.on('error', () => fail('The media connection was interrupted. Reconnect or ask the sender to restart.'));
        incoming.answer();
        incoming.peerConnection.addEventListener('connectionstatechange', onConnectionState);
        onConnectionState();
      });
      peer.on('open', () => {
        if (disposed || terminal || !peer || connection) return;
        connection = peer.connect(session.id, { reliable: true, serialization: 'json' });
        connection.on('open', () => connection?.send({ type: 'hello', key: session.key }));
        connection.on('data', (raw) => {
          if (disposed || terminal) return;
          const data = raw as { type?: string; name?: string; size?: number; paused?: boolean; ended?: boolean; message?: string; audio?: string } | null;
          if (!data) return;
          if (data.type === 'welcome') {
            setSource({ name: typeof data.name === 'string' ? data.name : 'Shared video', size: typeof data.size === 'number' ? data.size : 0, audio: typeof data.audio === 'string' ? data.audio : '' });
            setPaused(Boolean(data.paused));
            setMessage('Source found. Connecting your video...');
          }
          if (data.type === 'playback') setPaused(Boolean(data.paused));
          if (data.type === 'error') fail(data.message || 'This link is no longer available.');
          if (data.type === 'stopped') fail('The source has stopped sharing. Thanks for watching.', true);
        });
        connection.on('close', () => fail(connected ? 'The source has disconnected. Ask the sender to restart sharing.' : 'The source is unavailable. Ask the sender for a fresh link.', connected));
        connection.on('error', () => fail('The direct connection was interrupted. Please try reconnecting.'));
      });
      peer.on('error', (error) => fail(peerErrorMessage(error.type)));
      peer.on('disconnected', () => {
        if (!terminal && peer && !peer.destroyed) {
          try { peer.reconnect(); } catch { if (!connected) fail('The connection service is unavailable. Please try again.'); }
        }
      });
    } catch {
      fail('Your browser could not start a WebRTC connection. Try Chrome or Firefox.');
    }

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      window.clearTimeout(disconnectTimer);
      call?.close();
      connection?.close();
      peer?.destroy();
      remoteStream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [attempt, session.id, session.key]);

  const toggleSound = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    void video.play().catch(() => setPlaybackBlocked(true));
  };

  return (
    <div className="watch-shell">
      <header className="site-header"><div className="header-inner"><button className="brand-button" onClick={onBack} aria-label="Relay home"><Brand /></button><span className="header-local"><span className="status-dot" /> Device-to-device video</span><button className="header-guide" onClick={() => onGuide('start')}>Setup guide <ArrowUpRight size={15} /></button></div></header>
      <motion.main className="watch-main" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
        <button className="text-link watch-back" onClick={onBack}><ArrowLeft size={16} /> Share your own video</button>
        <div className="watch-title"><span className="eyebrow">A DIRECT CONNECTION. A SHARED MOMENT.</span><h1>{source.name}</h1><p>{source.size ? `${formatBytes(source.size)} source file. ` : ''}Streaming from the sender's device, not the cloud.</p></div>
        <div className="watch-player">
          <video ref={videoRef} autoPlay playsInline muted controls={status === 'live'} className={status === 'live' ? 'visible' : ''} onPlaying={() => setPlaybackBlocked(false)} onVolumeChange={() => setMuted(Boolean(videoRef.current?.muted))} />
          {status !== 'live' && <div className="watch-placeholder">
            <span className={`watch-state-icon ${status === 'connecting' ? 'connecting' : ''}`}>{status === 'connecting' ? <LoaderCircle size={34} className="spin" /> : status === 'ended' ? <MonitorPlay size={34} /> : <CircleAlert size={34} />}</span>
            <h2>{status === 'connecting' ? 'One moment. Two devices.' : status === 'ended' ? 'This stream has ended.' : "We couldn't make the connection."}</h2>
            <p>{message}</p>
            {status !== 'connecting' && <button className="button button-primary" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} /> Try reconnecting</button>}
          </div>}
        </div>
        <div className="watch-toolbar"><span className="watch-connection"><span className={`status-dot ${status === 'live' ? 'is-live' : ''}`} />{status === 'live' ? playbackBlocked ? 'Press play in the video controls to start' : paused ? 'Source playback is paused' : 'Live from the source device' : status === 'connecting' ? 'Connecting devices' : 'Not connected'}</span>{status === 'live' && <button className="button button-secondary" onClick={toggleSound}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}{muted ? 'Enable sound' : 'Mute sound'}</button>}</div>
        {status === 'live' && source.audio && <p className="watch-audio"><AudioLines size={15} /> {source.audio} <span>Audio track selected by the sender.</span></p>}
        <div className="watch-footnote"><ShieldCheck size={17} /><p>Direct and encrypted. The sender controls playback and needs to stay connected.</p><button className="text-link" onClick={() => onGuide('privacy')}>Learn more <ArrowUpRight size={14} /></button></div>
      </motion.main>
    </div>
  );
}