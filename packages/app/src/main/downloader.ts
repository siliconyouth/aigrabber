import path from 'path';
import fs from 'fs/promises';
import { createWriteStream, existsSync } from 'fs';
import got from 'got';
import {
  generateId,
  parseHLSManifest,
  parseDASHManifest,
  type DetectedStream,
  type VideoQuality,
  type AudioTrack,
  type DownloadJob,
  type DownloadProgress,
  type DownloadStatus,
} from '@aigrabber/shared';
import { FFmpegManager } from './ffmpeg';

interface DownloaderOptions {
  downloadPath: string;
  maxConcurrent: number;
  ffmpeg: FFmpegManager | null;
  onProgress: (jobId: string, progress: DownloadProgress) => void;
  onComplete: (jobId: string, outputPath: string) => void;
  onError: (jobId: string, error: string) => void;
}

export class Downloader {
  private options: DownloaderOptions;
  private jobs = new Map<string, DownloadJob>();
  private activeDownloads = 0;
  private queue: string[] = [];
  private abortControllers = new Map<string, AbortController>();

  constructor(options: DownloaderOptions) {
    this.options = options;
  }

  setDownloadPath(path: string) {
    this.options.downloadPath = path;
  }

  /**
   * Start a new download
   */
  startDownload(
    stream: DetectedStream,
    quality: VideoQuality,
    audio?: AudioTrack
  ): string {
    const job: DownloadJob = {
      id: generateId(),
      stream,
      selectedQuality: quality,
      selectedAudio: audio,
      status: 'pending',
      progress: {
        downloadedBytes: 0,
        totalBytes: 0,
        speed: 0,
        eta: 0,
        percentage: 0,
      },
      createdAt: Date.now(),
    };

    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    this.processQueue();

    return job.id;
  }

  /**
   * Cancel a download
   */
  cancelDownload(jobId: string): void {
    const controller = this.abortControllers.get(jobId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(jobId);
    }

    const job = this.jobs.get(jobId);
    if (job) {
      job.status = 'cancelled';
    }

    // Remove from queue if pending
    const queueIndex = this.queue.indexOf(jobId);
    if (queueIndex > -1) {
      this.queue.splice(queueIndex, 1);
    }
  }

  /**
   * Get all downloads
   */
  getDownloads(): DownloadJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Process the download queue
   */
  private processQueue(): void {
    while (
      this.activeDownloads < this.options.maxConcurrent &&
      this.queue.length > 0
    ) {
      const jobId = this.queue.shift()!;
      this.executeDownload(jobId);
    }
  }

  /**
   * Execute a download job
   */
  private async executeDownload(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.status === 'cancelled') return;

    this.activeDownloads++;
    job.status = 'downloading';

    const controller = new AbortController();
    this.abortControllers.set(jobId, controller);

    try {
      switch (job.stream.type) {
        case 'hls':
          await this.downloadHLS(job, controller.signal);
          break;
        case 'dash':
          await this.downloadDASH(job, controller.signal);
          break;
        case 'direct':
          await this.downloadDirect(job, controller.signal);
          break;
        default:
          throw new Error(`Unsupported stream type: ${job.stream.type}`);
      }

      if (job.status !== 'cancelled') {
        job.status = 'completed';
        job.completedAt = Date.now();
        this.options.onComplete(jobId, job.outputPath!);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError' && job.status !== 'cancelled') {
        job.status = 'failed';
        job.error = error.message;
        this.options.onError(jobId, error.message);
      }
    } finally {
      this.activeDownloads--;
      this.abortControllers.delete(jobId);
      this.processQueue();
    }
  }

  /**
   * Download HLS stream
   */
  private async downloadHLS(job: DownloadJob, signal: AbortSignal): Promise<void> {
    // Fetch master manifest
    const manifestResponse = await got(job.stream.url, { signal });
    const manifest = parseHLSManifest(manifestResponse.body, job.stream.url);

    // Get the variant URL for selected quality
    let variantUrl = job.stream.url;
    if (manifest.type === 'master') {
      const variant = manifest.variants.find(
        v => v.resolution?.height === job.selectedQuality.height
      ) || manifest.variants[0];
      variantUrl = variant.url;
    }

    // Fetch media playlist
    const playlistResponse = await got(variantUrl, { signal });
    const playlist = parseHLSManifest(playlistResponse.body, variantUrl);

    if (playlist.type !== 'media') {
      throw new Error('Expected media playlist');
    }

    // Download all segments
    const segments = playlist.segments;
    const tempDir = path.join(this.options.downloadPath, `.aigrabber-${job.id}`);
    await fs.mkdir(tempDir, { recursive: true });

    const segmentFiles: string[] = [];
    let downloadedBytes = 0;
    const totalSegments = segments.length;
    const startTime = Date.now();

    for (let i = 0; i < segments.length; i++) {
      if (signal.aborted) throw new Error('Download cancelled');

      const segment = segments[i];
      const segmentPath = path.join(tempDir, `segment-${i.toString().padStart(5, '0')}.ts`);

      // Download segment
      const segmentData = await got(segment.uri, { signal }).buffer();
      await fs.writeFile(segmentPath, segmentData);
      segmentFiles.push(segmentPath);

      // Update progress
      downloadedBytes += segmentData.length;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = downloadedBytes / elapsed;
      const remaining = totalSegments - (i + 1);
      const avgSegmentSize = downloadedBytes / (i + 1);
      const eta = remaining * (avgSegmentSize / speed);

      job.progress = {
        downloadedBytes,
        totalBytes: avgSegmentSize * totalSegments,
        speed,
        eta,
        percentage: ((i + 1) / totalSegments) * 100,
        currentSegment: i + 1,
        totalSegments,
      };

      this.options.onProgress(job.id, job.progress);
    }

    // Merge segments with FFmpeg
    job.status = 'merging';
    const outputFilename = this.sanitizeFilename(job.stream.pageTitle || 'video') + '.mp4';
    const outputPath = path.join(this.options.downloadPath, outputFilename);

    if (this.options.ffmpeg?.isAvailable()) {
      await this.options.ffmpeg.mergeSegments(segmentFiles, outputPath);
    } else {
      // Fallback: concatenate TS files
      await this.concatenateFiles(segmentFiles, outputPath.replace('.mp4', '.ts'));
      job.outputPath = outputPath.replace('.mp4', '.ts');
      return;
    }

    // Cleanup temp files
    await fs.rm(tempDir, { recursive: true, force: true });

    job.outputPath = outputPath;
  }

  /**
   * Download DASH stream
   */
  private async downloadDASH(job: DownloadJob, signal: AbortSignal): Promise<void> {
    // Fetch MPD manifest
    const manifestResponse = await got(job.stream.url, { signal });
    const manifest = parseDASHManifest(manifestResponse.body, job.stream.url);

    // Find video adaptation set
    const videoSet = manifest.adaptationSets.find(as => as.contentType === 'video');
    if (!videoSet) {
      throw new Error('No video stream found');
    }

    // Find representation matching quality
    const representation = videoSet.representations.find(
      r => r.height === job.selectedQuality.height
    ) || videoSet.representations[0];

    // Generate segment URLs
    const { generateSegmentUrls } = await import('@aigrabber/shared');
    const segmentUrls = generateSegmentUrls(representation, manifest.baseUrl || job.stream.url);

    if (segmentUrls.length === 0) {
      throw new Error('Could not generate segment URLs');
    }

    // Download segments
    const tempDir = path.join(this.options.downloadPath, `.aigrabber-${job.id}`);
    await fs.mkdir(tempDir, { recursive: true });

    const segmentFiles: string[] = [];
    let downloadedBytes = 0;
    const startTime = Date.now();

    // Download init segment if present
    if (representation.segmentTemplate?.initialization) {
      const initUrl = representation.segmentTemplate.initialization
        .replace('$RepresentationID$', representation.id);
      const initPath = path.join(tempDir, 'init.mp4');
      const initData = await got(initUrl, { signal }).buffer();
      await fs.writeFile(initPath, initData);
      segmentFiles.push(initPath);
    }

    for (let i = 0; i < segmentUrls.length; i++) {
      if (signal.aborted) throw new Error('Download cancelled');

      const segmentPath = path.join(tempDir, `segment-${i.toString().padStart(5, '0')}.m4s`);
      const segmentData = await got(segmentUrls[i], { signal }).buffer();
      await fs.writeFile(segmentPath, segmentData);
      segmentFiles.push(segmentPath);

      // Update progress
      downloadedBytes += segmentData.length;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = downloadedBytes / elapsed;
      const percentage = ((i + 1) / segmentUrls.length) * 100;

      job.progress = {
        downloadedBytes,
        totalBytes: 0,
        speed,
        eta: 0,
        percentage,
        currentSegment: i + 1,
        totalSegments: segmentUrls.length,
      };

      this.options.onProgress(job.id, job.progress);
    }

    // Merge segments
    job.status = 'merging';
    const outputFilename = this.sanitizeFilename(job.stream.pageTitle || 'video') + '.mp4';
    const outputPath = path.join(this.options.downloadPath, outputFilename);

    if (this.options.ffmpeg?.isAvailable()) {
      await this.options.ffmpeg.mergeSegments(segmentFiles, outputPath);
    } else {
      await this.concatenateFiles(segmentFiles, outputPath);
    }

    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });

    job.outputPath = outputPath;
  }

  /**
   * Download direct video file
   */
  private async downloadDirect(job: DownloadJob, signal: AbortSignal): Promise<void> {
    const outputFilename = this.sanitizeFilename(job.stream.pageTitle || 'video') + '.mp4';
    const outputPath = path.join(this.options.downloadPath, outputFilename);

    const startTime = Date.now();
    let downloadedBytes = 0;

    const downloadStream = got.stream(job.stream.url, { signal });
    const fileStream = createWriteStream(outputPath);

    downloadStream.on('downloadProgress', (progress) => {
      downloadedBytes = progress.transferred;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = downloadedBytes / elapsed;
      const eta = progress.total ? (progress.total - downloadedBytes) / speed : 0;

      job.progress = {
        downloadedBytes,
        totalBytes: progress.total || 0,
        speed,
        eta,
        percentage: progress.percent * 100,
      };

      this.options.onProgress(job.id, job.progress);
    });

    await new Promise<void>((resolve, reject) => {
      downloadStream.pipe(fileStream);
      downloadStream.on('error', reject);
      fileStream.on('error', reject);
      fileStream.on('finish', resolve);
    });

    job.outputPath = outputPath;
  }

  /**
   * Concatenate files (fallback when FFmpeg unavailable)
   */
  private async concatenateFiles(inputFiles: string[], outputPath: string): Promise<void> {
    const output = createWriteStream(outputPath);

    for (const file of inputFiles) {
      const data = await fs.readFile(file);
      output.write(data);
    }

    output.end();

    await new Promise<void>((resolve, reject) => {
      output.on('finish', resolve);
      output.on('error', reject);
    });
  }

  /**
   * Sanitize filename
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }
}
