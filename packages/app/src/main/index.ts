import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { Downloader } from './downloader';
import { NativeMessagingHost } from './native-host';
import { FFmpegManager } from './ffmpeg';
import { YtdlpManager } from './ytdlp';
import Store from 'electron-store';
import { generateId, type DownloadJob, type DetectedStream, type VideoQuality } from '@aigrabber/shared';

// Store for app settings
const store = new Store({
  defaults: {
    downloadPath: app.getPath('downloads'),
    maxConcurrentDownloads: 3,
    autoConvertToMp4: true,
  },
});

let mainWindow: BrowserWindow | null = null;
let downloader: Downloader | null = null;
let nativeHost: NativeMessagingHost | null = null;
let ffmpegManager: FFmpegManager | null = null;
let ytdlpManager: YtdlpManager | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize app components
async function initialize() {
  // Initialize FFmpeg manager
  ffmpegManager = new FFmpegManager();
  const ffmpegReady = await ffmpegManager.initialize();

  if (!ffmpegReady) {
    console.warn('FFmpeg not found. Some features will be limited.');
  }

  // Initialize yt-dlp manager
  ytdlpManager = new YtdlpManager();
  const ytdlpReady = await ytdlpManager.initialize();

  if (ytdlpReady) {
    const version = await ytdlpManager.getVersion();
    console.log('[AIGrabber] yt-dlp ready, version:', version);
  } else {
    console.warn('yt-dlp not found. YouTube downloads will be unavailable.');
  }

  // Initialize downloader
  downloader = new Downloader({
    downloadPath: store.get('downloadPath') as string,
    maxConcurrent: store.get('maxConcurrentDownloads') as number,
    ffmpeg: ffmpegManager,
    onProgress: (jobId, progress) => {
      mainWindow?.webContents.send('download-progress', { jobId, progress });
      nativeHost?.sendMessage({
        type: 'DOWNLOAD_PROGRESS',
        jobId,
        progress,
        status: 'downloading',
        timestamp: Date.now(),
      });
    },
    onComplete: (jobId, outputPath) => {
      mainWindow?.webContents.send('download-complete', { jobId, outputPath });
      nativeHost?.sendMessage({
        type: 'DOWNLOAD_COMPLETE',
        jobId,
        outputPath,
        timestamp: Date.now(),
      });
    },
    onError: (jobId, error) => {
      mainWindow?.webContents.send('download-error', { jobId, error });
      nativeHost?.sendMessage({
        type: 'DOWNLOAD_ERROR',
        jobId,
        error,
        timestamp: Date.now(),
      });
    },
  });

  // Initialize native messaging host
  nativeHost = new NativeMessagingHost({
    onMessage: (message) => {
      handleNativeMessage(message);
    },
  });

  // Start listening for native messages
  nativeHost.start();
}

// Handle messages from browser extension
function handleNativeMessage(message: any) {
  console.log('[AIGrabber] Received native message:', message.type);

  switch (message.type) {
    case 'PING':
      nativeHost?.sendMessage({
        type: 'PONG',
        version: app.getVersion(),
        timestamp: Date.now(),
      });
      break;

    case 'DOWNLOAD_REQUEST':
      if (message.stream && message.quality) {
        // Check if this is a yt-dlp stream
        if (message.stream.type === 'ytdlp' && ytdlpManager?.isAvailable()) {
          handleYtdlpDownload(message.stream, message.quality);
        } else if (downloader) {
          const jobId = downloader.startDownload(message.stream, message.quality, message.audio);
          nativeHost?.sendMessage({
            type: 'DOWNLOAD_PROGRESS',
            jobId,
            progress: { percentage: 0, downloadedBytes: 0, totalBytes: 0, speed: 0, eta: 0 },
            status: 'pending',
            timestamp: Date.now(),
          });
        }
      }
      break;

    case 'DOWNLOAD_CANCEL':
      if (message.jobId) {
        downloader?.cancelDownload(message.jobId);
      }
      break;
  }
}

// Handle yt-dlp downloads
async function handleYtdlpDownload(stream: DetectedStream, quality: VideoQuality) {
  if (!ytdlpManager) return;

  const jobId = generateId();
  const downloadPath = store.get('downloadPath') as string;

  // Send initial progress
  nativeHost?.sendMessage({
    type: 'DOWNLOAD_PROGRESS',
    jobId,
    progress: { percentage: 0, downloadedBytes: 0, totalBytes: 0, speed: 0, eta: 0 },
    status: 'pending',
    timestamp: Date.now(),
  });

  mainWindow?.webContents.send('download-progress', {
    jobId,
    progress: { percentage: 0, downloadedBytes: 0, totalBytes: 0, speed: 0, eta: 0 },
  });

  try {
    const outputPath = await ytdlpManager.download(
      stream.url,
      downloadPath,
      quality,
      (progress) => {
        nativeHost?.sendMessage({
          type: 'DOWNLOAD_PROGRESS',
          jobId,
          progress,
          status: 'downloading',
          timestamp: Date.now(),
        });
        mainWindow?.webContents.send('download-progress', { jobId, progress });
      }
    );

    // Success
    nativeHost?.sendMessage({
      type: 'DOWNLOAD_COMPLETE',
      jobId,
      outputPath,
      timestamp: Date.now(),
    });
    mainWindow?.webContents.send('download-complete', { jobId, outputPath });

  } catch (error: any) {
    // Error
    nativeHost?.sendMessage({
      type: 'DOWNLOAD_ERROR',
      jobId,
      error: error.message,
      timestamp: Date.now(),
    });
    mainWindow?.webContents.send('download-error', { jobId, error: error.message });
  }
}

// IPC handlers
function setupIPC() {
  // Get downloads list
  ipcMain.handle('get-downloads', () => {
    return downloader?.getDownloads() || [];
  });

  // Start download
  ipcMain.handle('start-download', (_, stream, quality, audio) => {
    return downloader?.startDownload(stream, quality, audio);
  });

  // Cancel download
  ipcMain.handle('cancel-download', (_, jobId) => {
    downloader?.cancelDownload(jobId);
  });

  // Get settings
  ipcMain.handle('get-settings', () => {
    return {
      downloadPath: store.get('downloadPath'),
      maxConcurrentDownloads: store.get('maxConcurrentDownloads'),
      autoConvertToMp4: store.get('autoConvertToMp4'),
      ffmpegAvailable: ffmpegManager?.isAvailable() || false,
    };
  });

  // Update settings
  ipcMain.handle('update-settings', (_, settings) => {
    if (settings.downloadPath) {
      store.set('downloadPath', settings.downloadPath);
      downloader?.setDownloadPath(settings.downloadPath);
    }
    if (settings.maxConcurrentDownloads !== undefined) {
      store.set('maxConcurrentDownloads', settings.maxConcurrentDownloads);
    }
    if (settings.autoConvertToMp4 !== undefined) {
      store.set('autoConvertToMp4', settings.autoConvertToMp4);
    }
  });

  // Open file/folder
  ipcMain.handle('open-path', (_, filePath) => {
    shell.showItemInFolder(filePath);
  });

  // Select download folder
  ipcMain.handle('select-folder', async () => {
    const { dialog } = await import('electron');
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Get app status
  ipcMain.handle('get-status', () => {
    return {
      version: app.getVersion(),
      ffmpegAvailable: ffmpegManager?.isAvailable() || false,
      ytdlpAvailable: ytdlpManager?.isAvailable() || false,
      downloadPath: store.get('downloadPath'),
    };
  });
}

// App lifecycle
app.whenReady().then(async () => {
  await initialize();
  setupIPC();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  nativeHost?.stop();
});
