import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type Peer from 'peerjs';
import type { DataConnection, MediaConnection } from 'peerjs';
import { createPeer, peerErrorMessage } from '../lib/peer';

type CaptureVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};
type Client = { data: DataConnection; call: MediaConnection; connected: boolean };
export type StreamStatus = 'idle' | 'connecting' | 'live' | 'error';

async function waitForVideoTrack(stream: MediaStream) {
  if (stream.getVideoTracks().length) return;
  await new Promise<void>((resolve, reject) => {
    const onTrack = () => {
      if (!stream.getVideoTracks().length) return;
      window.clearTimeout(timer);
      stream.removeEventListener('addtrack', onTrack);
      resolve();
    };
    const timer = window.setTimeout(() => {
      stream.removeEventListener('addtrack', onTrack);
      reject(new Error('No playable video track was found. Try an MP4/WebM file or use the VLC helper.'));
    }, 2500);
    stream.addEventListener('addtrack', onTrack);
    onTrack();
  });
}

export function useHostStream(
  videoRef: RefObject<HTMLVideoElement | null>,
  notify: (message: string, kind?: 'success' | 'error') => void,
) {
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [link, setLink] = useState('');
  const [viewers, setViewers] = useState(0);
  const peerRef = useRef<Peer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clients = useRef(new Map<string, Client>());
  const generation = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const busy = useRef(false);

  const cleanup = useCallback(() => {
    generation.current += 1;
    busy.current = false;
    window.clearTimeout(timerRef.current);
    clients.current.forEach(({ data, call }) => {
      if (data.open) {
        try { data.send({ type: 'stopped' }); } catch { /* The viewer may already have disconnected. */ }
      }
      call.close();
      data.close();
    });
    clients.current.clear();
    peerRef.current?.destroy();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void wakeRef.current?.release();
    wakeRef.current = null;
  }, []);

  const stop = useCallback(() => {
    cleanup();
    videoRef.current?.pause();
    setStatus('idle');
    setLink('');
    setViewers(0);
  }, [cleanup, videoRef]);

  const start = useCallback(async (file: File, audioLabel = 'Default audio') => {
    if (busy.current || peerRef.current) return;
    const video = videoRef.current as CaptureVideo | null;
    if (!video || video.readyState < 2) {
      notify('Your video is still loading. Try again in a moment.', 'error');
      return;
    }
    const capture = video.captureStream || video.mozCaptureStream;
    if (!capture) {
      notify('Direct browser sharing requires Chrome, Edge, or Firefox. You can still use the VLC helper with this browser.', 'error');
      return;
    }
    const session = ++generation.current;
    busy.current = true;
    setStatus('connecting');
    const fail = (message: string) => {
      if (session !== generation.current) return;
      cleanup();
      video.pause();
      setLink('');
      setViewers(0);
      setStatus('error');
      notify(message, 'error');
    };

    try {
      await video.play();
      if (session !== generation.current) return;
      const stream = capture.call(video);
      streamRef.current = stream;
      await waitForVideoTrack(stream);
      if (session !== generation.current) return;

      const secret = crypto.randomUUID();
      const peer = createPeer();
      peerRef.current = peer;
      const updateViewers = () => {
        if (session === generation.current) {
          setViewers([...clients.current.values()].filter((client) => client.connected).length);
        }
      };
      timerRef.current = window.setTimeout(() => fail('Connection timed out. Check your internet connection and try again.'), 20000);

      peer.on('open', (id) => {
        if (session !== generation.current) return;
        window.clearTimeout(timerRef.current);
        const url = new URL(window.location.href);
        url.hash = new URLSearchParams({ watch: id, key: secret }).toString();
        setLink(url.href);
        setStatus('live');
        busy.current = false;
        if ('wakeLock' in navigator && (!wakeRef.current || wakeRef.current.released)) {
          void navigator.wakeLock.request('screen').then((lock) => {
            if (session === generation.current) wakeRef.current = lock;
            else void lock.release();
          }).catch(() => { /* Keeping the device awake is a best-effort enhancement. */ });
        }
      });

      peer.on('connection', (connection) => {
        let accepted = false;
        let removed = false;
        const helloTimer = window.setTimeout(() => connection.close(), 10000);
        const remove = () => {
          if (removed) return;
          removed = true;
          window.clearTimeout(helloTimer);
          const client = clients.current.get(connection.peer);
          if (client?.data === connection) {
            clients.current.delete(connection.peer);
            client.call.close();
            updateViewers();
          }
        };
        connection.on('data', (raw) => {
          if (accepted || session !== generation.current) return;
          const message = raw as { type?: string; key?: string } | null;
          if (!message || message.type !== 'hello' || message.key !== secret) {
            connection.send({ type: 'error', message: 'This link is invalid. Ask the sender for a new one.' });
            window.setTimeout(() => connection.close(), 150);
            return;
          }
          if (clients.current.has(connection.peer)) {
            connection.send({ type: 'error', message: 'This viewer already has a connection. Reopen the link in a new tab.' });
            window.setTimeout(() => connection.close(), 150);
            return;
          }
          if (clients.current.size >= 4) {
            connection.send({ type: 'error', message: 'This stream already has four viewers. Please try again later.' });
            window.setTimeout(() => connection.close(), 150);
            return;
          }
          accepted = true;
          window.clearTimeout(helloTimer);
          connection.send({ type: 'welcome', name: file.name, size: file.size, paused: video.paused, audio: audioLabel.slice(0, 120) });
          // Associate the call with its authenticated data channel without exposing the link key to signaling.
          const call = peer.call(connection.peer, stream, { metadata: { channel: connection.connectionId } });
          if (!call) {
            connection.close();
            return;
          }
          const client: Client = { data: connection, call, connected: false };
          clients.current.set(connection.peer, client);
          call.peerConnection.addEventListener('connectionstatechange', () => {
            client.connected = call.peerConnection.connectionState === 'connected';
            updateViewers();
            if (['failed', 'closed'].includes(call.peerConnection.connectionState)) connection.close();
          });
          call.on('close', () => connection.close());
          call.on('error', () => connection.close());
        });
        connection.on('close', remove);
        connection.on('error', remove);
      });

      peer.on('error', (error) => {
        if (error.type === 'peer-unavailable') return;
        fail(peerErrorMessage(error.type));
      });
      peer.on('disconnected', () => {
        if (!peer.destroyed && session === generation.current) {
          try { peer.reconnect(); } catch { fail('The connection service disconnected. Please create a new link.'); }
        }
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Could not start your video stream.');
    }
  }, [cleanup, notify, videoRef]);

  useEffect(() => () => cleanup(), [cleanup]);

  useEffect(() => {
    if (status !== 'live') return;
    const video = videoRef.current;
    const onPlayback = () => {
      clients.current.forEach(({ data }) => {
        if (data.open) data.send({ type: 'playback', paused: video?.paused, ended: video?.ended });
      });
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && 'wakeLock' in navigator && (!wakeRef.current || wakeRef.current.released)) {
        const session = generation.current;
        void navigator.wakeLock.request('screen').then((lock) => {
          if (session === generation.current) wakeRef.current = lock;
          else void lock.release();
        }).catch(() => {});
      }
    };
    video?.addEventListener('play', onPlayback);
    video?.addEventListener('pause', onPlayback);
    video?.addEventListener('ended', onPlayback);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      video?.removeEventListener('play', onPlayback);
      video?.removeEventListener('pause', onPlayback);
      video?.removeEventListener('ended', onPlayback);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [status, videoRef]);

  return { status, link, viewers, start, stop };
}