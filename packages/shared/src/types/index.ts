// Stream types
export type StreamType = 'hls' | 'dash' | 'direct' | 'ytdlp' | 'unknown';
export type StreamProtection = 'none' | 'drm' | 'unknown';

export interface VideoQuality {
  width: number;
  height: number;
  bitrate?: number;
  framerate?: number;
  label: string; // e.g., "1080p", "720p"
}

export interface AudioTrack {
  language: string;
  bitrate?: number;
  channels?: number;
  label: string;
}

export interface DetectedStream {
  id: string;
  url: string;
  type: StreamType;
  protection: StreamProtection;
  qualities: VideoQuality[];
  audioTracks: AudioTrack[];
  title?: string;
  duration?: number;
  thumbnail?: string;
  pageUrl: string;
  pageTitle: string;
  detectedAt: number;
}

// Download types
export type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  speed: number; // bytes per second
  eta: number; // seconds remaining
  percentage: number;
  currentSegment?: number;
  totalSegments?: number;
}

export interface DownloadJob {
  id: string;
  stream: DetectedStream;
  selectedQuality: VideoQuality;
  selectedAudio?: AudioTrack;
  status: DownloadStatus;
  progress: DownloadProgress;
  outputPath?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

// Message types for extension <-> app communication
export type MessageType =
  | 'PING'
  | 'PONG'
  | 'STREAM_DETECTED'
  | 'DOWNLOAD_REQUEST'
  | 'DOWNLOAD_PROGRESS'
  | 'DOWNLOAD_COMPLETE'
  | 'DOWNLOAD_ERROR'
  | 'DOWNLOAD_CANCEL'
  | 'GET_DOWNLOADS'
  | 'DOWNLOADS_LIST'
  | 'APP_STATUS';

export interface BaseMessage {
  type: MessageType;
  timestamp: number;
}

export interface PingMessage extends BaseMessage {
  type: 'PING';
}

export interface PongMessage extends BaseMessage {
  type: 'PONG';
  version: string;
}

export interface StreamDetectedMessage extends BaseMessage {
  type: 'STREAM_DETECTED';
  stream: DetectedStream;
}

export interface DownloadRequestMessage extends BaseMessage {
  type: 'DOWNLOAD_REQUEST';
  stream: DetectedStream;
  quality: VideoQuality;
  audio?: AudioTrack;
  outputDir?: string;
}

export interface DownloadProgressMessage extends BaseMessage {
  type: 'DOWNLOAD_PROGRESS';
  jobId: string;
  progress: DownloadProgress;
  status: DownloadStatus;
}

export interface DownloadCompleteMessage extends BaseMessage {
  type: 'DOWNLOAD_COMPLETE';
  jobId: string;
  outputPath: string;
}

export interface DownloadErrorMessage extends BaseMessage {
  type: 'DOWNLOAD_ERROR';
  jobId: string;
  error: string;
}

export interface DownloadCancelMessage extends BaseMessage {
  type: 'DOWNLOAD_CANCEL';
  jobId: string;
}

export interface GetDownloadsMessage extends BaseMessage {
  type: 'GET_DOWNLOADS';
}

export interface DownloadsListMessage extends BaseMessage {
  type: 'DOWNLOADS_LIST';
  downloads: DownloadJob[];
}

export interface AppStatusMessage extends BaseMessage {
  type: 'APP_STATUS';
  connected: boolean;
  ffmpegAvailable: boolean;
  version: string;
}

export type Message =
  | PingMessage
  | PongMessage
  | StreamDetectedMessage
  | DownloadRequestMessage
  | DownloadProgressMessage
  | DownloadCompleteMessage
  | DownloadErrorMessage
  | DownloadCancelMessage
  | GetDownloadsMessage
  | DownloadsListMessage
  | AppStatusMessage;

// Utility functions
export function createMessage<T extends Message>(msg: Omit<T, 'timestamp'>): T {
  return { ...msg, timestamp: Date.now() } as T;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
