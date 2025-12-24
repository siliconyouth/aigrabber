import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { app } from 'electron';

export class FFmpegManager {
  private ffmpegPath: string | null = null;
  private ffprobePath: string | null = null;

  /**
   * Initialize FFmpeg - find or download binary
   */
  async initialize(): Promise<boolean> {
    // Check common locations
    const possiblePaths = [
      // Bundled with app
      path.join(app.getAppPath(), 'resources', 'ffmpeg'),
      path.join(process.resourcesPath || '', 'ffmpeg'),
      // System paths
      '/usr/local/bin/ffmpeg',
      '/usr/bin/ffmpeg',
      '/opt/homebrew/bin/ffmpeg',
      // Windows
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
    ];

    // Check PATH
    const pathEnv = process.env.PATH || '';
    const pathDirs = pathEnv.split(path.delimiter);

    for (const dir of pathDirs) {
      possiblePaths.push(path.join(dir, 'ffmpeg'));
      possiblePaths.push(path.join(dir, 'ffmpeg.exe'));
    }

    // Find FFmpeg
    for (const ffmpegPath of possiblePaths) {
      if (await this.checkFFmpeg(ffmpegPath)) {
        this.ffmpegPath = ffmpegPath;

        // Also check for ffprobe
        const ffprobePath = ffmpegPath.replace('ffmpeg', 'ffprobe');
        if (await this.fileExists(ffprobePath)) {
          this.ffprobePath = ffprobePath;
        }

        console.log('[AIGrabber] FFmpeg found:', this.ffmpegPath);
        return true;
      }
    }

    console.warn('[AIGrabber] FFmpeg not found');
    return false;
  }

  /**
   * Check if FFmpeg is available
   */
  isAvailable(): boolean {
    return this.ffmpegPath !== null;
  }

  /**
   * Get FFmpeg version
   */
  async getVersion(): Promise<string | null> {
    if (!this.ffmpegPath) return null;

    return new Promise((resolve) => {
      const proc = spawn(this.ffmpegPath!, ['-version']);
      let output = '';

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', () => {
        const match = output.match(/ffmpeg version ([^\s]+)/);
        resolve(match ? match[1] : null);
      });

      proc.on('error', () => {
        resolve(null);
      });
    });
  }

  /**
   * Merge video segments into single file
   */
  async mergeSegments(inputFiles: string[], outputPath: string): Promise<void> {
    if (!this.ffmpegPath) {
      throw new Error('FFmpeg not available');
    }

    // Create concat file
    const concatPath = outputPath + '.txt';
    const concatContent = inputFiles.map(f => `file '${f}'`).join('\n');
    await fs.writeFile(concatPath, concatContent);

    return new Promise((resolve, reject) => {
      const args = [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatPath,
        '-c', 'copy',
        '-y',
        outputPath,
      ];

      const proc = spawn(this.ffmpegPath!, args);

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', async (code) => {
        // Cleanup concat file
        await fs.unlink(concatPath).catch(() => {});

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Convert video format
   */
  async convert(
    inputPath: string,
    outputPath: string,
    options: {
      videoCodec?: string;
      audioCodec?: string;
      videoBitrate?: string;
      audioBitrate?: string;
    } = {}
  ): Promise<void> {
    if (!this.ffmpegPath) {
      throw new Error('FFmpeg not available');
    }

    const args = ['-i', inputPath];

    if (options.videoCodec) {
      args.push('-c:v', options.videoCodec);
    }
    if (options.audioCodec) {
      args.push('-c:a', options.audioCodec);
    }
    if (options.videoBitrate) {
      args.push('-b:v', options.videoBitrate);
    }
    if (options.audioBitrate) {
      args.push('-b:a', options.audioBitrate);
    }

    args.push('-y', outputPath);

    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpegPath!, args);

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg conversion failed: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Extract audio from video
   */
  async extractAudio(
    inputPath: string,
    outputPath: string,
    format: 'mp3' | 'aac' | 'wav' = 'mp3'
  ): Promise<void> {
    if (!this.ffmpegPath) {
      throw new Error('FFmpeg not available');
    }

    const codecMap = {
      mp3: 'libmp3lame',
      aac: 'aac',
      wav: 'pcm_s16le',
    };

    const args = [
      '-i', inputPath,
      '-vn', // No video
      '-c:a', codecMap[format],
      '-y',
      outputPath,
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpegPath!, args);

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Audio extraction failed with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Get video metadata
   */
  async getMetadata(filePath: string): Promise<{
    duration?: number;
    width?: number;
    height?: number;
    bitrate?: number;
  }> {
    if (!this.ffprobePath) {
      return {};
    }

    return new Promise((resolve) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
      ];

      const proc = spawn(this.ffprobePath!, args);
      let output = '';

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', () => {
        try {
          const info = JSON.parse(output);
          const videoStream = info.streams?.find((s: any) => s.codec_type === 'video');

          resolve({
            duration: info.format?.duration ? parseFloat(info.format.duration) : undefined,
            width: videoStream?.width,
            height: videoStream?.height,
            bitrate: info.format?.bit_rate ? parseInt(info.format.bit_rate, 10) : undefined,
          });
        } catch {
          resolve({});
        }
      });

      proc.on('error', () => {
        resolve({});
      });
    });
  }

  /**
   * Check if FFmpeg binary works
   */
  private async checkFFmpeg(ffmpegPath: string): Promise<boolean> {
    if (!(await this.fileExists(ffmpegPath))) {
      return false;
    }

    return new Promise((resolve) => {
      const proc = spawn(ffmpegPath, ['-version']);

      proc.on('close', (code) => {
        resolve(code === 0);
      });

      proc.on('error', () => {
        resolve(false);
      });

      // Timeout
      setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 5000);
    });
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
