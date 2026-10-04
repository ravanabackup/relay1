import { useCallback, useEffect, useRef, useState } from 'react';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import coreJsURL from '@ffmpeg/core?url&no-inline';
import coreWasmURL from '@ffmpeg/core/wasm?url&no-inline';
import { inspectMedia, MAX_BROWSER_CONVERSION_BYTES, type MediaDetails } from '../lib/media';

export type ConversionState = {
  phase: 'idle' | 'loading' | 'converting' | 'error';
  progress: number;
  message: string;
};

export function useBrowserMedia() {
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectionError, setInspectionError] = useState(false);
  const [converted, setConverted] = useState<{ url: string; audioIndex: number } | null>(null);
  const [conversion, setConversion] = useState<ConversionState>({ phase: 'idle', progress: 0, message: '' });
  const inspectionRun = useRef(0);
  const conversionRun = useRef(0);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const convertedRef = useRef<string | null>(null);

  const cancelConversion = useCallback(() => {
    conversionRun.current += 1;
    ffmpegRef.current?.terminate();
    ffmpegRef.current = null;
    setConversion({ phase: 'idle', progress: 0, message: '' });
  }, []);

  const reset = useCallback(() => {
    inspectionRun.current += 1;
    cancelConversion();
    if (convertedRef.current) URL.revokeObjectURL(convertedRef.current);
    convertedRef.current = null;
    setConverted(null);
    setDetails(null);
    setInspectionError(false);
    setInspecting(false);
  }, [cancelConversion]);

  const inspect = useCallback(async (file: File) => {
    const run = ++inspectionRun.current;
    setInspecting(true);
    setInspectionError(false);
    try {
      const found = await inspectMedia(file);
      if (run === inspectionRun.current) setDetails(found);
    } catch {
      if (run === inspectionRun.current) setInspectionError(true);
    } finally {
      if (run === inspectionRun.current) setInspecting(false);
    }
  }, []);

  const convert = useCallback(async (file: File, audioIndex: number, info: MediaDetails | null, nativePlayable: boolean) => {
    cancelConversion();
    const run = conversionRun.current;
    if (file.size > MAX_BROWSER_CONVERSION_BYTES) {
      setConversion({ phase: 'error', progress: 0, message: 'This file is too large for in-browser conversion. Use the VLC helper to stream the original file without a size limit.' });
      return false;
    }
    if (!window.Worker || !window.WebAssembly) {
      setConversion({ phase: 'error', progress: 0, message: 'This browser cannot run the local converter. Use the VLC helper on a trusted network.' });
      return false;
    }

    const video = document.createElement('video');
    const mp4 = Boolean(video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'));
    const webm = Boolean(video.canPlayType('video/webm; codecs="vp8, vorbis"'));
    if (!mp4 && !webm) {
      setConversion({ phase: 'error', progress: 0, message: 'This browser cannot play the available conversion formats. Try Chrome, Edge, or Firefox, or use VLC.' });
      return false;
    }

    const format = mp4 ? 'mp4' : 'webm';
    const inputExtension = file.name.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase() || 'bin';
    const inputName = `source.${inputExtension}`;
    const outputName = `playable.${format}`;
    setConversion({ phase: 'loading', progress: 0, message: 'Loading the on-device codec engine...' });
    let ffmpeg: FFmpeg | null = null;
    let engineLoaded = false;

    try {
      const { FFmpeg: FFmpegClass } = await import('@ffmpeg/ffmpeg');
      if (run !== conversionRun.current) return false;
      ffmpeg = new FFmpegClass();
      ffmpegRef.current = ffmpeg;
      ffmpeg.on('progress', ({ progress }) => {
        if (run === conversionRun.current && Number.isFinite(progress)) {
          setConversion({ phase: 'converting', progress: Math.min(99, Math.max(0, Math.round(progress * 100))), message: 'Preparing browser-friendly playback on this device...' });
        }
      });
      const loadTimeout = window.setTimeout(() => ffmpeg?.terminate(), 90000);
      try {
        await ffmpeg.load({
          coreURL: new URL(coreJsURL, document.baseURI).href,
          wasmURL: new URL(coreWasmURL, document.baseURI).href,
        });
      } finally {
        window.clearTimeout(loadTimeout);
      }
      if (run !== conversionRun.current) return false;
      engineLoaded = true;
      setConversion({ phase: 'converting', progress: 0, message: 'Preparing browser-friendly playback on this device...' });
      await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
      if (run !== conversionRun.current) return false;

      // Confirm that the audio ordinal from MediaInfo matches FFmpeg's stream order.
      if (info?.audioTracks.length) {
        const probe = await ffmpeg.ffprobe(['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', inputName, '-o', 'streams.json']);
        if (run !== conversionRun.current) return false;
        if (probe === 0) {
          const raw = await ffmpeg.readFile('streams.json', 'utf8');
          const found = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) as { streams?: { codec_type?: string }[] };
          const audioCount = found.streams?.filter((stream) => stream.codec_type === 'audio').length ?? 0;
          if (audioCount !== info.audioTracks.length || audioIndex >= audioCount) {
            throw new Error('The audio track layout could not be matched safely. Open this file in VLC instead.');
          }
        }
      }

      const audioMap = info && !info.hasAudio ? [] : ['-map', info?.audioTracks.length ? `0:a:${audioIndex}` : '0:a:0?'];
      const common = ['-hide_banner', '-loglevel', 'error', '-i', inputName, '-map', '0:v:0', ...audioMap, '-sn', '-dn'];
      const compatibleVideo = nativePlayable && (
        (format === 'mp4' && /^(AVC|H\.264)$/i.test(info?.videoCodec || '')) ||
        (format === 'webm' && /^(VP8|VP9)$/i.test(info?.videoCodec || ''))
      );

      const runConversion = async (copyVideo: boolean) => {
        const args = [...common, '-c:v', copyVideo ? 'copy' : format === 'mp4' ? 'libx264' : 'libvpx'];
        if (!copyVideo) {
          if (format === 'mp4') args.push('-preset', 'ultrafast', '-crf', '27', '-pix_fmt', 'yuv420p');
          else args.push('-deadline', 'realtime', '-cpu-used', '5', '-b:v', '1M', '-pix_fmt', 'yuv420p');
          if (info?.width && info.height && (info.width > 1280 || info.height > 720)) {
            const factor = Math.min(1280 / info.width, 720 / info.height);
            const width = Math.max(2, Math.floor((info.width * factor) / 2) * 2);
            const height = Math.max(2, Math.floor((info.height * factor) / 2) * 2);
            args.push('-vf', `scale=${width}:${height}`);
          }
        }
        if (info && !info.hasAudio) args.push('-an');
        else args.push('-c:a', format === 'mp4' ? 'aac' : 'libvorbis', '-b:a', '128k', '-ac', '2');
        if (format === 'mp4') args.push('-movflags', '+faststart');
        args.push(outputName);
        return ffmpeg!.exec(args, 15 * 60 * 1000);
      };

      let code = await runConversion(Boolean(compatibleVideo));
      if (run !== conversionRun.current) return false;
      if (code !== 0 && compatibleVideo) {
        // A container may reject a copied stream; retry with an actual video conversion.
        code = await runConversion(false);
        if (run !== conversionRun.current) return false;
      }
      if (code !== 0) throw new Error('The installed codec engine could not decode or convert this video. Try another file or stream the original in VLC.');

      const data = await ffmpeg.readFile(outputName);
      if (run !== conversionRun.current) return false;
      if (typeof data === 'string' || !data.byteLength) throw new Error('The converter produced an empty video. Try VLC for this file.');
      const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' }));
      if (run !== conversionRun.current) {
        URL.revokeObjectURL(url);
        return false;
      }
      const oldURL = convertedRef.current;
      convertedRef.current = url;
      setConverted({ url, audioIndex });
      setConversion({ phase: 'idle', progress: 100, message: '' });
      if (oldURL) window.setTimeout(() => URL.revokeObjectURL(oldURL), 1000);
      return true;
    } catch (error) {
      if (run === conversionRun.current) {
        setConversion({
          phase: 'error',
          progress: 0,
          message: !engineLoaded
            ? 'The codec engine could not load. Publish every file from dist (including the WASM files) or use VLC.'
            : error instanceof Error && /could not decode|empty video|could not be matched safely/i.test(error.message)
            ? error.message
            : 'Browser conversion did not finish. Some formats or large videos need VLC; you can also try a smaller file.',
        });
      }
      return false;
    } finally {
      ffmpeg?.terminate();
      if (ffmpegRef.current === ffmpeg) ffmpegRef.current = null;
    }
  }, [cancelConversion]);

  useEffect(() => () => {
    inspectionRun.current += 1;
    conversionRun.current += 1;
    ffmpegRef.current?.terminate();
    if (convertedRef.current) URL.revokeObjectURL(convertedRef.current);
  }, []);

  return { details, inspecting, inspectionError, inspect, converted, conversion, convert, cancelConversion, reset };
}