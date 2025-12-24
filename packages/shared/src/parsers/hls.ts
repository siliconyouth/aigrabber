import type { VideoQuality, AudioTrack, StreamProtection } from '../types/index.js';

export interface HLSVariant {
  url: string;
  bandwidth: number;
  resolution?: { width: number; height: number };
  codecs?: string;
  frameRate?: number;
  audio?: string;
}

export interface HLSAudioGroup {
  groupId: string;
  name: string;
  language: string;
  uri?: string;
  default: boolean;
  autoSelect: boolean;
}

export interface HLSMediaSegment {
  uri: string;
  duration: number;
  title?: string;
  byteRange?: { length: number; offset: number };
  key?: HLSKey;
}

export interface HLSKey {
  method: string;
  uri?: string;
  iv?: string;
  keyFormat?: string;
}

export interface HLSMasterPlaylist {
  type: 'master';
  variants: HLSVariant[];
  audioGroups: Map<string, HLSAudioGroup[]>;
  isDRM: boolean;
}

export interface HLSMediaPlaylist {
  type: 'media';
  targetDuration: number;
  segments: HLSMediaSegment[];
  totalDuration: number;
  isDRM: boolean;
  encryption?: HLSKey;
}

export type HLSPlaylist = HLSMasterPlaylist | HLSMediaPlaylist;

/**
 * Parse an HLS manifest (M3U8 file)
 */
export function parseHLSManifest(content: string, baseUrl: string): HLSPlaylist {
  const lines = content.split('\n').map(line => line.trim()).filter(Boolean);

  if (!lines[0]?.startsWith('#EXTM3U')) {
    throw new Error('Invalid HLS manifest: missing #EXTM3U header');
  }

  // Check if master playlist (contains #EXT-X-STREAM-INF)
  const isMaster = lines.some(line => line.startsWith('#EXT-X-STREAM-INF'));

  if (isMaster) {
    return parseMasterPlaylist(lines, baseUrl);
  } else {
    return parseMediaPlaylist(lines, baseUrl);
  }
}

function parseMasterPlaylist(lines: string[], baseUrl: string): HLSMasterPlaylist {
  const variants: HLSVariant[] = [];
  const audioGroups = new Map<string, HLSAudioGroup[]>();
  let isDRM = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Parse audio groups
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = parseAttributes(line.slice(13));
      if (attrs.TYPE === 'AUDIO') {
        const groupId = attrs['GROUP-ID'] || 'default';
        const group: HLSAudioGroup = {
          groupId,
          name: attrs.NAME || 'Audio',
          language: attrs.LANGUAGE || 'und',
          uri: attrs.URI ? resolveUrl(attrs.URI, baseUrl) : undefined,
          default: attrs.DEFAULT === 'YES',
          autoSelect: attrs.AUTOSELECT === 'YES',
        };

        if (!audioGroups.has(groupId)) {
          audioGroups.set(groupId, []);
        }
        audioGroups.get(groupId)!.push(group);
      }
    }

    // Parse variants
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = parseAttributes(line.slice(18));
      const nextLine = lines[i + 1];

      if (nextLine && !nextLine.startsWith('#')) {
        const variant: HLSVariant = {
          url: resolveUrl(nextLine, baseUrl),
          bandwidth: parseInt(attrs.BANDWIDTH || '0', 10),
          codecs: attrs.CODECS,
          frameRate: attrs['FRAME-RATE'] ? parseFloat(attrs['FRAME-RATE']) : undefined,
          audio: attrs.AUDIO,
        };

        // Parse resolution
        if (attrs.RESOLUTION) {
          const [width, height] = attrs.RESOLUTION.split('x').map(Number);
          variant.resolution = { width, height };
        }

        variants.push(variant);
        i++; // Skip URL line
      }
    }

    // Check for DRM
    if (line.includes('EXT-X-KEY') && line.includes('METHOD=SAMPLE-AES')) {
      isDRM = true;
    }
    if (line.includes('com.widevine') || line.includes('com.apple.fps')) {
      isDRM = true;
    }
  }

  // Sort variants by bandwidth (highest first)
  variants.sort((a, b) => b.bandwidth - a.bandwidth);

  return { type: 'master', variants, audioGroups, isDRM };
}

function parseMediaPlaylist(lines: string[], baseUrl: string): HLSMediaPlaylist {
  const segments: HLSMediaSegment[] = [];
  let targetDuration = 0;
  let totalDuration = 0;
  let isDRM = false;
  let currentKey: HLSKey | undefined;
  let segmentDuration = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = parseInt(line.slice(22), 10);
    }

    if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line.slice(11));
      currentKey = {
        method: attrs.METHOD || 'NONE',
        uri: attrs.URI ? resolveUrl(attrs.URI, baseUrl) : undefined,
        iv: attrs.IV,
        keyFormat: attrs.KEYFORMAT,
      };

      // Check for DRM encryption
      if (currentKey.method !== 'NONE' && currentKey.method !== 'AES-128') {
        isDRM = true;
      }
      if (currentKey.keyFormat?.includes('widevine') || currentKey.keyFormat?.includes('fairplay')) {
        isDRM = true;
      }
    }

    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/#EXTINF:([0-9.]+)/);
      if (match) {
        segmentDuration = parseFloat(match[1]);
      }
    }

    // Segment URL
    if (!line.startsWith('#') && line.length > 0) {
      segments.push({
        uri: resolveUrl(line, baseUrl),
        duration: segmentDuration,
        key: currentKey,
      });
      totalDuration += segmentDuration;
      segmentDuration = 0;
    }
  }

  return {
    type: 'media',
    targetDuration,
    segments,
    totalDuration,
    isDRM,
    encryption: currentKey,
  };
}

function parseAttributes(str: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([A-Z-]+)=(?:"([^"]+)"|([^,]+))/g;
  let match;

  while ((match = regex.exec(str)) !== null) {
    attrs[match[1]] = match[2] || match[3];
  }

  return attrs;
}

function resolveUrl(url: string, baseUrl: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

/**
 * Convert HLS variants to VideoQuality array
 */
export function hlsVariantsToQualities(variants: HLSVariant[]): VideoQuality[] {
  return variants.map(v => ({
    width: v.resolution?.width || 0,
    height: v.resolution?.height || 0,
    bitrate: v.bandwidth,
    framerate: v.frameRate,
    label: getQualityLabel(v.resolution?.height, v.bandwidth),
  }));
}

/**
 * Convert HLS audio groups to AudioTrack array
 */
export function hlsAudioGroupsToTracks(groups: Map<string, HLSAudioGroup[]>): AudioTrack[] {
  const tracks: AudioTrack[] = [];

  for (const groupTracks of groups.values()) {
    for (const track of groupTracks) {
      tracks.push({
        language: track.language,
        label: track.name,
      });
    }
  }

  return tracks;
}

function getQualityLabel(height?: number, bitrate?: number): string {
  if (height) {
    if (height >= 2160) return '4K';
    if (height >= 1440) return '1440p';
    if (height >= 1080) return '1080p';
    if (height >= 720) return '720p';
    if (height >= 480) return '480p';
    if (height >= 360) return '360p';
    return `${height}p`;
  }

  if (bitrate) {
    if (bitrate >= 8000000) return 'High';
    if (bitrate >= 4000000) return 'Medium';
    return 'Low';
  }

  return 'Unknown';
}

/**
 * Determine stream protection from HLS manifest
 */
export function getHLSProtection(playlist: HLSPlaylist): StreamProtection {
  if (playlist.isDRM) return 'drm';
  if (playlist.type === 'media' && playlist.encryption?.method === 'AES-128') {
    return 'none'; // AES-128 is downloadable
  }
  return 'none';
}
