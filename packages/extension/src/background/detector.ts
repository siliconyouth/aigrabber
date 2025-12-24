import {
  parseHLSManifest,
  parseDASHManifest,
  hlsVariantsToQualities,
  hlsAudioGroupsToTracks,
  dashRepresentationsToQualities,
  dashAdaptationSetsToAudioTracks,
  getHLSProtection,
  getDASHProtection,
  generateId,
  type DetectedStream,
  type StreamType,
  type StreamProtection,
  type HLSMasterPlaylist,
} from '@aigrabber/shared';

// Sites supported by yt-dlp
const YTDLP_SUPPORTED_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'dailymotion.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'twitch.tv',
  'reddit.com',
  'soundcloud.com',
];

export class StreamDetector {
  private manifestCache = new Map<string, string>();
  private detectedYtdlpUrls = new Set<string>();

  /**
   * Check if URL is from a yt-dlp supported site
   */
  isYtdlpSupported(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return YTDLP_SUPPORTED_DOMAINS.some(domain =>
        urlObj.hostname.includes(domain)
      );
    } catch {
      return false;
    }
  }

  /**
   * Detect video page for yt-dlp supported sites
   */
  detectYtdlpPage(pageUrl: string, pageTitle: string): DetectedStream | null {
    if (!this.isYtdlpSupported(pageUrl)) {
      return null;
    }

    // Avoid duplicates
    if (this.detectedYtdlpUrls.has(pageUrl)) {
      return null;
    }

    // Check if it's a video page (not homepage/search)
    try {
      const urlObj = new URL(pageUrl);

      // YouTube video detection
      if (urlObj.hostname.includes('youtube.com')) {
        if (!urlObj.pathname.includes('/watch') && !urlObj.pathname.includes('/shorts')) {
          return null;
        }
      }

      // Vimeo video detection
      if (urlObj.hostname.includes('vimeo.com')) {
        if (!/\/\d+/.test(urlObj.pathname)) {
          return null;
        }
      }

      // Twitter/X video detection
      if (urlObj.hostname.includes('twitter.com') || urlObj.hostname.includes('x.com')) {
        if (!urlObj.pathname.includes('/status/')) {
          return null;
        }
      }
    } catch {
      return null;
    }

    this.detectedYtdlpUrls.add(pageUrl);

    return {
      id: generateId(),
      url: pageUrl,
      type: 'ytdlp' as StreamType,
      protection: 'none',
      qualities: [
        { width: 3840, height: 2160, label: '4K' },
        { width: 1920, height: 1080, label: '1080p' },
        { width: 1280, height: 720, label: '720p' },
        { width: 854, height: 480, label: '480p' },
      ],
      audioTracks: [],
      pageUrl,
      pageTitle,
      title: pageTitle,
      detectedAt: Date.now(),
    };
  }

  /**
   * Clear detected yt-dlp URLs (call on tab navigation)
   */
  clearYtdlpCache(): void {
    this.detectedYtdlpUrls.clear();
  }

  /**
   * Detect stream type from URL and request type
   */
  detectFromUrl(
    url: string,
    requestType: string
  ): Partial<DetectedStream> | null {
    const urlLower = url.toLowerCase();

    // HLS detection
    if (urlLower.includes('.m3u8') || urlLower.includes('playlist.m3u')) {
      return {
        url,
        type: 'hls',
        protection: 'unknown',
        qualities: [],
        audioTracks: [],
      };
    }

    // DASH detection
    if (urlLower.includes('.mpd')) {
      return {
        url,
        type: 'dash',
        protection: 'unknown',
        qualities: [],
        audioTracks: [],
      };
    }

    // Direct video detection by content type or extension
    if (
      requestType === 'media' ||
      urlLower.match(/\.(mp4|webm|mkv|avi|mov)(\?|$)/)
    ) {
      // Filter out small files (likely not videos) and tracking pixels
      if (urlLower.includes('tracking') || urlLower.includes('pixel')) {
        return null;
      }

      return {
        url,
        type: 'direct',
        protection: 'none',
        qualities: [{ width: 0, height: 0, label: 'Original' }],
        audioTracks: [],
      };
    }

    return null;
  }

  /**
   * Enrich partial stream with full metadata by fetching manifest
   */
  async enrichStream(
    partial: Partial<DetectedStream>,
    pageUrl: string,
    pageTitle: string
  ): Promise<DetectedStream | null> {
    const stream: DetectedStream = {
      id: generateId(),
      url: partial.url!,
      type: partial.type || 'unknown',
      protection: partial.protection || 'unknown',
      qualities: partial.qualities || [],
      audioTracks: partial.audioTracks || [],
      pageUrl,
      pageTitle,
      detectedAt: Date.now(),
    };

    // For HLS/DASH, fetch and parse manifest
    if (stream.type === 'hls' || stream.type === 'dash') {
      try {
        const manifest = await this.fetchManifest(stream.url);
        this.parseManifest(stream, manifest);
      } catch (error) {
        console.warn('[AIGrabber] Failed to fetch manifest:', error);
        // Still return stream but with limited info
      }
    }

    // Skip DRM-protected streams (mark but don't filter)
    if (stream.protection === 'drm') {
      stream.title = `[Protected] ${stream.title || pageTitle}`;
    }

    return stream;
  }

  /**
   * Fetch manifest content
   */
  private async fetchManifest(url: string): Promise<string> {
    // Check cache
    if (this.manifestCache.has(url)) {
      return this.manifestCache.get(url)!;
    }

    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        Accept: '*/*',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch manifest: ${response.status}`);
    }

    const content = await response.text();

    // Cache for reuse
    this.manifestCache.set(url, content);

    // Limit cache size
    if (this.manifestCache.size > 100) {
      const firstKey = this.manifestCache.keys().next().value;
      if (firstKey) {
        this.manifestCache.delete(firstKey);
      }
    }

    return content;
  }

  /**
   * Parse manifest and update stream info
   */
  private parseManifest(stream: DetectedStream, content: string): void {
    if (stream.type === 'hls') {
      this.parseHLS(stream, content);
    } else if (stream.type === 'dash') {
      this.parseDASH(stream, content);
    }
  }

  /**
   * Parse HLS manifest
   */
  private parseHLS(stream: DetectedStream, content: string): void {
    try {
      const playlist = parseHLSManifest(content, stream.url);

      stream.protection = getHLSProtection(playlist);

      if (playlist.type === 'master') {
        stream.qualities = hlsVariantsToQualities(playlist.variants);
        stream.audioTracks = hlsAudioGroupsToTracks(playlist.audioGroups);
      } else {
        // Media playlist - single quality
        stream.qualities = [
          {
            width: 0,
            height: 0,
            label: 'Default',
          },
        ];
        stream.duration = playlist.totalDuration;
      }
    } catch (error) {
      console.warn('[AIGrabber] Failed to parse HLS manifest:', error);
    }
  }

  /**
   * Parse DASH manifest
   */
  private parseDASH(stream: DetectedStream, content: string): void {
    try {
      const manifest = parseDASHManifest(content, stream.url);

      stream.protection = getDASHProtection(manifest);
      stream.duration = manifest.duration;

      // Get video qualities
      const videoSets = manifest.adaptationSets.filter(
        as => as.contentType === 'video'
      );
      if (videoSets.length > 0) {
        stream.qualities = dashRepresentationsToQualities(videoSets[0]);
      }

      // Get audio tracks
      stream.audioTracks = dashAdaptationSetsToAudioTracks(manifest);
    } catch (error) {
      console.warn('[AIGrabber] Failed to parse DASH manifest:', error);
    }
  }
}
