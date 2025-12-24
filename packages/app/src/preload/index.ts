import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Downloads
  getDownloads: () => ipcRenderer.invoke('get-downloads'),
  startDownload: (stream: any, quality: any, audio: any) =>
    ipcRenderer.invoke('start-download', stream, quality, audio),
  cancelDownload: (jobId: string) => ipcRenderer.invoke('cancel-download', jobId),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings: any) => ipcRenderer.invoke('update-settings', settings),
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // Status
  getStatus: () => ipcRenderer.invoke('get-status'),
  openPath: (filePath: string) => ipcRenderer.invoke('open-path', filePath),

  // Events
  onDownloadProgress: (callback: (data: any) => void) => {
    const listener = (_: any, data: any) => callback(data);
    ipcRenderer.on('download-progress', listener);
    return () => ipcRenderer.removeListener('download-progress', listener);
  },

  onDownloadComplete: (callback: (data: any) => void) => {
    const listener = (_: any, data: any) => callback(data);
    ipcRenderer.on('download-complete', listener);
    return () => ipcRenderer.removeListener('download-complete', listener);
  },

  onDownloadError: (callback: (data: any) => void) => {
    const listener = (_: any, data: any) => callback(data);
    ipcRenderer.on('download-error', listener);
    return () => ipcRenderer.removeListener('download-error', listener);
  },
});

// Type definitions for renderer
export interface ElectronAPI {
  getDownloads: () => Promise<any[]>;
  startDownload: (stream: any, quality: any, audio: any) => Promise<string>;
  cancelDownload: (jobId: string) => Promise<void>;
  getSettings: () => Promise<{
    downloadPath: string;
    maxConcurrentDownloads: number;
    autoConvertToMp4: boolean;
    ffmpegAvailable: boolean;
  }>;
  updateSettings: (settings: Partial<{
    downloadPath: string;
    maxConcurrentDownloads: number;
    autoConvertToMp4: boolean;
  }>) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  getStatus: () => Promise<{
    version: string;
    ffmpegAvailable: boolean;
    downloadPath: string;
  }>;
  openPath: (filePath: string) => Promise<void>;
  onDownloadProgress: (callback: (data: { jobId: string; progress: any }) => void) => () => void;
  onDownloadComplete: (callback: (data: { jobId: string; outputPath: string }) => void) => () => void;
  onDownloadError: (callback: (data: { jobId: string; error: string }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
