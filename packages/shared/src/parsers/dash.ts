import type { VideoQuality, AudioTrack, StreamProtection } from '../types/index.js';

export interface DASHRepresentation {
  id: string;
  bandwidth: number;
  width?: number;
  height?: number;
  frameRate?: string;
  codecs?: string;
  mimeType?: string;
  baseUrl?: string;
  segmentTemplate?: DASHSegmentTemplate;
  segmentList?: DASHSegmentList;
}

export interface DASHSegmentTemplate {
  media: string;
  initialization?: string;
  startNumber: number;
  timescale: number;
  duration?: number;
  timeline?: DASHSegmentTimeline[];
}

export interface DASHSegmentTimeline {
  start?: number;
  duration: number;
  repeat?: number;
}

export interface DASHSegmentList {
  initialization?: string;
  segments: string[];
}

export interface DASHAdaptationSet {
  id: string;
  mimeType: string;
  contentType: 'video' | 'audio' | 'text';
  lang?: string;
  representations: DASHRepresentation[];
  contentProtection?: DASHContentProtection[];
}

export interface DASHContentProtection {
  schemeIdUri: string;
  value?: string;
  pssh?: string;
}

export interface DASHManifest {
  type: 'static' | 'dynamic';
  duration?: number;
  minBufferTime?: number;
  adaptationSets: DASHAdaptationSet[];
  isDRM: boolean;
  baseUrl?: string;
}

/**
 * Parse a DASH manifest (MPD file)
 */
export function parseDASHManifest(content: string, baseUrl: string): DASHManifest {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'application/xml');

  const mpd = doc.querySelector('MPD');
  if (!mpd) {
    throw new Error('Invalid DASH manifest: missing MPD element');
  }

  const manifest: DASHManifest = {
    type: (mpd.getAttribute('type') as 'static' | 'dynamic') || 'static',
    duration: parseDuration(mpd.getAttribute('mediaPresentationDuration')),
    minBufferTime: parseDuration(mpd.getAttribute('minBufferTime')),
    adaptationSets: [],
    isDRM: false,
  };

  // Get base URL
  const baseUrlEl = doc.querySelector('BaseURL');
  if (baseUrlEl?.textContent) {
    manifest.baseUrl = resolveUrl(baseUrlEl.textContent, baseUrl);
  }

  // Parse periods
  const periods = doc.querySelectorAll('Period');
  for (const period of periods) {
    const adaptationSets = period.querySelectorAll('AdaptationSet');

    for (const as of adaptationSets) {
      const adaptationSet = parseAdaptationSet(as, manifest.baseUrl || baseUrl);
      manifest.adaptationSets.push(adaptationSet);

      // Check for DRM
      if (adaptationSet.contentProtection && adaptationSet.contentProtection.length > 0) {
        manifest.isDRM = true;
      }
    }
  }

  return manifest;
}

function parseAdaptationSet(element: Element, baseUrl: string): DASHAdaptationSet {
  const mimeType = element.getAttribute('mimeType') || '';
  let contentType: 'video' | 'audio' | 'text' = 'video';

  if (mimeType.includes('audio') || element.getAttribute('contentType') === 'audio') {
    contentType = 'audio';
  } else if (mimeType.includes('text') || element.getAttribute('contentType') === 'text') {
    contentType = 'text';
  }

  const adaptationSet: DASHAdaptationSet = {
    id: element.getAttribute('id') || '',
    mimeType,
    contentType,
    lang: element.getAttribute('lang') || undefined,
    representations: [],
    contentProtection: [],
  };

  // Parse content protection (DRM)
  const cpElements = element.querySelectorAll('ContentProtection');
  for (const cp of cpElements) {
    const protection: DASHContentProtection = {
      schemeIdUri: cp.getAttribute('schemeIdUri') || '',
      value: cp.getAttribute('value') || undefined,
    };

    // Get PSSH box if present
    const pssh = cp.querySelector('pssh, cenc\\:pssh');
    if (pssh?.textContent) {
      protection.pssh = pssh.textContent;
    }

    adaptationSet.contentProtection!.push(protection);
  }

  // Get segment template at AdaptationSet level
  const asSegmentTemplate = parseSegmentTemplate(element.querySelector(':scope > SegmentTemplate'), baseUrl);

  // Parse representations
  const representations = element.querySelectorAll('Representation');
  for (const rep of representations) {
    const representation = parseRepresentation(rep, baseUrl, asSegmentTemplate);
    adaptationSet.representations.push(representation);
  }

  // Sort by bandwidth (highest first for video, lowest first for audio)
  if (contentType === 'video') {
    adaptationSet.representations.sort((a, b) => b.bandwidth - a.bandwidth);
  } else {
    adaptationSet.representations.sort((a, b) => a.bandwidth - b.bandwidth);
  }

  return adaptationSet;
}

function parseRepresentation(
  element: Element,
  baseUrl: string,
  parentTemplate?: DASHSegmentTemplate
): DASHRepresentation {
  const rep: DASHRepresentation = {
    id: element.getAttribute('id') || '',
    bandwidth: parseInt(element.getAttribute('bandwidth') || '0', 10),
    width: element.getAttribute('width') ? parseInt(element.getAttribute('width')!, 10) : undefined,
    height: element.getAttribute('height') ? parseInt(element.getAttribute('height')!, 10) : undefined,
    frameRate: element.getAttribute('frameRate') || undefined,
    codecs: element.getAttribute('codecs') || undefined,
    mimeType: element.getAttribute('mimeType') || undefined,
  };

  // Get base URL
  const baseUrlEl = element.querySelector('BaseURL');
  if (baseUrlEl?.textContent) {
    rep.baseUrl = resolveUrl(baseUrlEl.textContent, baseUrl);
  }

  // Get segment template (representation level overrides adaptation set level)
  const repSegmentTemplate = element.querySelector(':scope > SegmentTemplate');
  rep.segmentTemplate = parseSegmentTemplate(repSegmentTemplate, baseUrl) || parentTemplate;

  // Get segment list
  const segmentList = element.querySelector('SegmentList');
  if (segmentList) {
    rep.segmentList = parseSegmentList(segmentList, baseUrl);
  }

  return rep;
}

function parseSegmentTemplate(element: Element | null, _baseUrl: string): DASHSegmentTemplate | undefined {
  if (!element) return undefined;

  const template: DASHSegmentTemplate = {
    media: element.getAttribute('media') || '',
    initialization: element.getAttribute('initialization') || undefined,
    startNumber: parseInt(element.getAttribute('startNumber') || '1', 10),
    timescale: parseInt(element.getAttribute('timescale') || '1', 10),
    duration: element.getAttribute('duration')
      ? parseInt(element.getAttribute('duration')!, 10)
      : undefined,
  };

  // Parse segment timeline
  const timeline = element.querySelector('SegmentTimeline');
  if (timeline) {
    template.timeline = [];
    const segments = timeline.querySelectorAll('S');
    for (const s of segments) {
      template.timeline.push({
        start: s.getAttribute('t') ? parseInt(s.getAttribute('t')!, 10) : undefined,
        duration: parseInt(s.getAttribute('d') || '0', 10),
        repeat: s.getAttribute('r') ? parseInt(s.getAttribute('r')!, 10) : undefined,
      });
    }
  }

  return template;
}

function parseSegmentList(element: Element, baseUrl: string): DASHSegmentList {
  const list: DASHSegmentList = {
    segments: [],
  };

  const init = element.querySelector('Initialization');
  if (init) {
    list.initialization = init.getAttribute('sourceURL') || undefined;
  }

  const segmentUrls = element.querySelectorAll('SegmentURL');
  for (const seg of segmentUrls) {
    const media = seg.getAttribute('media');
    if (media) {
      list.segments.push(resolveUrl(media, baseUrl));
    }
  }

  return list;
}

function parseDuration(duration: string | null): number | undefined {
  if (!duration) return undefined;

  // Parse ISO 8601 duration format (PT#H#M#S)
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!match) return undefined;

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseFloat(match[3] || '0');

  return hours * 3600 + minutes * 60 + seconds;
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
 * Convert DASH representations to VideoQuality array
 */
export function dashRepresentationsToQualities(adaptationSet: DASHAdaptationSet): VideoQuality[] {
  return adaptationSet.representations.map(r => ({
    width: r.width || 0,
    height: r.height || 0,
    bitrate: r.bandwidth,
    framerate: r.frameRate ? parseFloat(r.frameRate) : undefined,
    label: getQualityLabel(r.height, r.bandwidth),
  }));
}

/**
 * Convert DASH audio adaptation sets to AudioTrack array
 */
export function dashAdaptationSetsToAudioTracks(manifest: DASHManifest): AudioTrack[] {
  const audioSets = manifest.adaptationSets.filter(as => as.contentType === 'audio');

  return audioSets.map(as => ({
    language: as.lang || 'und',
    bitrate: as.representations[0]?.bandwidth,
    label: as.lang ? getLanguageLabel(as.lang) : 'Audio',
  }));
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

function getLanguageLabel(lang: string): string {
  const languages: Record<string, string> = {
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    ru: 'Russian',
    ja: 'Japanese',
    ko: 'Korean',
    zh: 'Chinese',
    und: 'Unknown',
  };

  return languages[lang.toLowerCase()] || lang;
}

/**
 * Determine stream protection from DASH manifest
 */
export function getDASHProtection(manifest: DASHManifest): StreamProtection {
  if (manifest.isDRM) return 'drm';

  // Check for common DRM schemes
  for (const as of manifest.adaptationSets) {
    if (as.contentProtection) {
      for (const cp of as.contentProtection) {
        // Widevine
        if (cp.schemeIdUri === 'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed') {
          return 'drm';
        }
        // PlayReady
        if (cp.schemeIdUri === 'urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95') {
          return 'drm';
        }
        // FairPlay
        if (cp.schemeIdUri === 'urn:uuid:94ce86fb-07ff-4f43-adb8-93d2fa968ca2') {
          return 'drm';
        }
      }
    }
  }

  return 'none';
}

/**
 * Generate segment URLs from a DASH representation
 */
export function generateSegmentUrls(
  representation: DASHRepresentation,
  baseUrl: string
): string[] {
  const urls: string[] = [];
  const template = representation.segmentTemplate;

  if (template) {
    // Template-based segments
    const replaceVars = (str: string, vars: Record<string, string | number>) => {
      let result = str;
      for (const [key, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(`\\$${key}\\$`, 'g'), String(value));
        // Handle $Number%04d$ style formatting
        result = result.replace(new RegExp(`\\$${key}%(\\d+)d\\$`, 'g'), (_, width) =>
          String(value).padStart(parseInt(width), '0')
        );
      }
      return result;
    };

    if (template.timeline) {
      let time = 0;
      let number = template.startNumber;

      for (const segment of template.timeline) {
        if (segment.start !== undefined) {
          time = segment.start;
        }

        const repeat = (segment.repeat || 0) + 1;
        for (let i = 0; i < repeat; i++) {
          const url = replaceVars(template.media, {
            RepresentationID: representation.id,
            Number: number,
            Time: time,
            Bandwidth: representation.bandwidth,
          });
          urls.push(resolveUrl(url, representation.baseUrl || baseUrl));
          time += segment.duration;
          number++;
        }
      }
    } else if (template.duration) {
      // Fixed duration segments - would need total duration to calculate count
      // For now, return empty and let the downloader handle dynamically
    }
  } else if (representation.segmentList) {
    // Explicit segment list
    urls.push(...representation.segmentList.segments);
  }

  return urls;
}
