import type { AudioTrack, VideoTrack } from 'mediainfo.js';
import mediaInfoWasmURL from 'mediainfo.js/MediaInfoModule.wasm?url&no-inline';

export const MAX_BROWSER_CONVERSION_BYTES = 150 * 1024 * 1024;

export type AudioChoice = {
  index: number;
  label: string;
  codec: string;
  language: string;
  isDefault: boolean;
};

export type MediaDetails = {
  audioTracks: AudioChoice[];
  hasAudio: boolean;
  defaultAudio: number;
  videoCodec: string;
  width: number;
  height: number;
  duration: number | null;
};

function audioLabel(track: AudioTrack, index: number) {
  const language = track.Language_String || track.Language || '';
  const title = track.Title || '';
  const codec = track.Format || track.CodecID || 'Audio';
  const parts = [language, title, codec].filter((part, position, all) =>
    Boolean(part) && all.findIndex((item) => item.toLowerCase() === part.toLowerCase()) === position,
  );
  return `Track ${index + 1}${parts.length ? ` - ${parts.join(' / ')}` : ''}`;
}

export async function inspectMedia(file: File): Promise<MediaDetails> {
  const { default: mediaInfoFactory } = await import('mediainfo.js');
  const inspector = await mediaInfoFactory({
    format: 'object',
    chunkSize: 256 * 1024,
    locateFile: () => new URL(mediaInfoWasmURL, document.baseURI).href,
  });

  try {
    // MediaInfo only reads the requested slices, not the whole video into memory.
    const result = await inspector.analyzeData(file.size, async (size, offset) =>
      new Uint8Array(await file.slice(offset, offset + size).arrayBuffer()),
    );
    const tracks = result.media?.track ?? [];
    const video = tracks.find((track): track is VideoTrack => track['@type'] === 'Video');
    const audio = tracks.filter((track): track is AudioTrack => track['@type'] === 'Audio');
    const general = tracks.find((track) => track['@type'] === 'General');
    const audioTracks = audio.map((track, index) => ({
      index,
      label: audioLabel(track, index),
      codec: track.Format || track.CodecID || 'Unknown',
      language: track.Language_String || track.Language || '',
      isDefault: track.Default === 'Yes',
    }));
    return {
      audioTracks,
      hasAudio: audioTracks.length > 0 || (general?.['@type'] === 'General' && (general.AudioCount || 0) > 0),
      defaultAudio: Math.max(0, audioTracks.findIndex((track) => track.isDefault)),
      videoCodec: video?.Format || video?.CodecID || 'Unknown video codec',
      width: video?.Width || 0,
      height: video?.Height || 0,
      duration: general?.['@type'] === 'General' && general.Duration ? general.Duration : null,
    };
  } finally {
    inspector.close();
  }
}