import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { app } from 'electron';
import type { VideoQuality, DownloadProgress } from '@aigrabber/shared';

export interface YtdlpVideoInfo {
  id: string;
  title: string;
  description?: string;
  duration?: number;
  thumbnail?: string;
  uploader?: string;
  formats: YtdlpFormat[];
  url: string;
}

export interface YtdlpFormat {
  format_id: string;
  ext: string;
  resolution?: string;
  width?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  format_note?: string;
}

export class YtdlpManager {
  private ytdlpPath: string | null = null;
  private activeProcesses = new Map<string, ChildProcess>();

  /**
   * Initialize yt-dlp - find binary
   */
  async initialize(): Promise<boolean> {
    const possiblePaths = [
      // Bundled with app
      path.join(app.getAppPath(), 'resources', 'yt-dlp'),
      path.join(process.resourcesPath || '', 'yt-dlp'),
      // Homebrew (macOS)
      '/opt/homebrew/bin/yt-dlp',
      '/usr/local/bin/yt-dlp',
      // Linux
      '/usr/bin/yt-dlp',
      // Python pip
      path.join(process.env.HOME || '', '.local', 'bin', 'yt-dlp'),
    ];

    // Check PATH
    const pathEnv = process.env.PATH || '';
    const pathDirs = pathEnv.split(path.delimiter);
    for (const dir of pathDirs) {
      possiblePaths.push(path.join(dir, 'yt-dlp'));
    }

    for (const ytdlpPath of possiblePaths) {
      if (await this.checkYtdlp(ytdlpPath)) {
        this.ytdlpPath = ytdlpPath;
        console.log('[AIGrabber] yt-dlp found:', this.ytdlpPath);
        return true;
      }
    }

    console.warn('[AIGrabber] yt-dlp not found');
    return false;
  }

  /**
   * Check if yt-dlp is available
   */
  isAvailable(): boolean {
    return this.ytdlpPath !== null;
  }

  /**
   * Get yt-dlp version
   */
  async getVersion(): Promise<string | null> {
    if (!this.ytdlpPath) return null;

    return new Promise((resolve) => {
      const proc = spawn(this.ytdlpPath!, ['--version']);
      let output = '';

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', () => {
        resolve(output.trim() || null);
      });

      proc.on('error', () => resolve(null));
    });
  }

  /**
   * Check if URL is supported by yt-dlp
   */
  isSupportedUrl(url: string): boolean {
    const supportedDomains = [
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
      'bandcamp.com',
    ];

    try {
      const urlObj = new URL(url);
      return supportedDomains.some(domain =>
        urlObj.hostname.includes(domain)
      );
    } catch {
      return false;
    }
  }

  /**
   * Get video info without downloading
   */
  async getVideoInfo(url: string): Promise<YtdlpVideoInfo | null> {
    if (!this.ytdlpPath) return null;

    return new Promise((resolve) => {
      const args = [
        '--dump-json',
        '--no-download',
        '--no-warnings',
        url,
      ];

      const proc = spawn(this.ytdlpPath!, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && stdout) {
          try {
            const info = JSON.parse(stdout);
            resolve({
              id: info.id,
              title: info.title,
              description: info.description,
              duration: info.duration,
              thumbnail: info.thumbnail,
              uploader: info.uploader,
              formats: info.formats || [],
              url,
            });
          } catch {
            resolve(null);
          }
        } else {
          console.error('[yt-dlp] Error:', stderr);
          resolve(null);
        }
      });

      proc.on('error', () => resolve(null));
    });
  }

  /**
   * Convert yt-dlp formats to VideoQuality array
   */
  formatsToQualities(formats: YtdlpFormat[]): VideoQuality[] {
    // Filter to video formats with height info
    const videoFormats = formats.filter(f =>
      f.height && f.vcodec && f.vcodec !== 'none'
    );

    // Deduplicate by height
    const seen = new Set<number>();
    const qualities: VideoQuality[] = [];

    for (const f of videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0))) {
      if (f.height && !seen.has(f.height)) {
        seen.add(f.height);
        qualities.push({
          width: f.width || 0,
          height: f.height,
          bitrate: f.filesize,
          framerate: f.fps,
          label: this.getQualityLabel(f.height),
        });
      }
    }

    return qualities;
  }

  /**
   * Download video using yt-dlp
   */
  async download(
    url: string,
    outputDir: string,
    quality: VideoQuality,
    onProgress: (progress: DownloadProgress) => void
  ): Promise<string> {
    if (!this.ytdlpPath) {
      throw new Error('yt-dlp not available');
    }

    const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');

    // Build format selector based on quality
    let formatSelector = 'bestvideo+bestaudio/best';
    if (quality.height) {
      formatSelector = `bestvideo[height<=${quality.height}]+bestaudio/best[height<=${quality.height}]`;
    }

    const args = [
      '-f', formatSelector,
      '--merge-output-format', 'mp4',
      '-o', outputTemplate,
      '--newline', // Progress on new lines
      '--no-warnings',
      url,
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(this.ytdlpPath!, args);
      const jobId = `ytdlp-${Date.now()}`;
      this.activeProcesses.set(jobId, proc);

      let outputPath = '';
      let lastProgress: DownloadProgress = {
        downloadedBytes: 0,
        totalBytes: 0,
        speed: 0,
        eta: 0,
        percentage: 0,
      };

      proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          // Parse progress: [download]  45.2% of 150.00MiB at 5.00MiB/s ETA 00:15
          const progressMatch = line.match(
            /\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+)(\w+)\s+at\s+([\d.]+)(\w+)\/s\s+ETA\s+([\d:]+)/
          );

          if (progressMatch) {
            const percentage = parseFloat(progressMatch[1]);
            const totalSize = parseFloat(progressMatch[2]);
            const totalUnit = progressMatch[3];
            const speed = parseFloat(progressMatch[4]);
            const speedUnit = progressMatch[5];
            const eta = progressMatch[6];

            lastProgress = {
              percentage,
              totalBytes: this.parseSize(totalSize, totalUnit),
              downloadedBytes: Math.floor(this.parseSize(totalSize, totalUnit) * percentage / 100),
              speed: this.parseSize(speed, speedUnit),
              eta: this.parseEta(eta),
            };

            onProgress(lastProgress);
          }

          // Capture output filename
          const destMatch = line.match(/\[Merger\] Merging formats into "(.+)"/);
          if (destMatch) {
            outputPath = destMatch[1];
          }

          const downloadMatch = line.match(/\[download\] Destination: (.+)/);
          if (downloadMatch) {
            outputPath = downloadMatch[1];
          }

          // Already downloaded
          const alreadyMatch = line.match(/\[download\] (.+) has already been downloaded/);
          if (alreadyMatch) {
            outputPath = alreadyMatch[1];
          }
        }
      });

      proc.stderr.on('data', (data) => {
        console.error('[yt-dlp]', data.toString());
      });

      proc.on('close', (code) => {
        this.activeProcesses.delete(jobId);

        if (code === 0) {
          resolve(outputPath);
        } else {
          reject(new Error(`yt-dlp exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        this.activeProcesses.delete(jobId);
        reject(err);
      });
    });
  }

  /**
   * Cancel a download
   */
  cancelDownload(jobId: string): void {
    const proc = this.activeProcesses.get(jobId);
    if (proc) {
      proc.kill('SIGTERM');
      this.activeProcesses.delete(jobId);
    }
  }

  /**
   * Check if yt-dlp binary works
   */
  private async checkYtdlp(ytdlpPath: string): Promise<boolean> {
    try {
      await fs.access(ytdlpPath);
    } catch {
      return false;
    }

    return new Promise((resolve) => {
      const proc = spawn(ytdlpPath, ['--version']);

      proc.on('close', (code) => {
        resolve(code === 0);
      });

      proc.on('error', () => resolve(false));

      setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 5000);
    });
  }

  private getQualityLabel(height: number): string {
    if (height >= 2160) return '4K';
    if (height >= 1440) return '1440p';
    if (height >= 1080) return '1080p';
    if (height >= 720) return '720p';
    if (height >= 480) return '480p';
    if (height >= 360) return '360p';
    return `${height}p`;
  }

  private parseSize(value: number, unit: string): number {
    const multipliers: Record<string, number> = {
      'B': 1,
      'KiB': 1024,
      'MiB': 1024 * 1024,
      'GiB': 1024 * 1024 * 1024,
      'KB': 1000,
      'MB': 1000 * 1000,
      'GB': 1000 * 1000 * 1000,
    };
    return value * (multipliers[unit] || 1);
  }

  private parseEta(eta: string): number {
    const parts = eta.split(':').map(Number);
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  }
}
