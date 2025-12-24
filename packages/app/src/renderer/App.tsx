import React, { useEffect, useState } from 'react';
import type { DownloadJob, DownloadProgress } from '@aigrabber/shared';

type View = 'downloads' | 'completed' | 'settings';

interface AppStatus {
  version: string;
  ffmpegAvailable: boolean;
  downloadPath: string;
}

export function App() {
  const [view, setView] = useState<View>('downloads');
  const [downloads, setDownloads] = useState<DownloadJob[]>([]);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [settings, setSettings] = useState({
    downloadPath: '',
    maxConcurrentDownloads: 3,
    autoConvertToMp4: true,
  });

  useEffect(() => {
    // Load initial data
    loadData();

    // Set up event listeners
    const unsubProgress = window.electronAPI.onDownloadProgress(({ jobId, progress }) => {
      setDownloads(prev =>
        prev.map(d =>
          d.id === jobId
            ? { ...d, progress, status: 'downloading' as const }
            : d
        )
      );
    });

    const unsubComplete = window.electronAPI.onDownloadComplete(({ jobId, outputPath }) => {
      setDownloads(prev =>
        prev.map(d =>
          d.id === jobId
            ? { ...d, status: 'completed' as const, outputPath, completedAt: Date.now() }
            : d
        )
      );
    });

    const unsubError = window.electronAPI.onDownloadError(({ jobId, error }) => {
      setDownloads(prev =>
        prev.map(d =>
          d.id === jobId
            ? { ...d, status: 'failed' as const, error }
            : d
        )
      );
    });

    return () => {
      unsubProgress();
      unsubComplete();
      unsubError();
    };
  }, []);

  async function loadData() {
    const [downloadsData, statusData, settingsData] = await Promise.all([
      window.electronAPI.getDownloads(),
      window.electronAPI.getStatus(),
      window.electronAPI.getSettings(),
    ]);

    setDownloads(downloadsData);
    setStatus(statusData);
    setSettings(settingsData);
  }

  async function cancelDownload(jobId: string) {
    await window.electronAPI.cancelDownload(jobId);
    setDownloads(prev =>
      prev.map(d =>
        d.id === jobId ? { ...d, status: 'cancelled' as const } : d
      )
    );
  }

  async function openFile(filePath: string) {
    await window.electronAPI.openPath(filePath);
  }

  async function selectFolder() {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      setSettings(prev => ({ ...prev, downloadPath: folder }));
      await window.electronAPI.updateSettings({ downloadPath: folder });
    }
  }

  async function updateSetting<K extends keyof typeof settings>(
    key: K,
    value: typeof settings[K]
  ) {
    setSettings(prev => ({ ...prev, [key]: value }));
    await window.electronAPI.updateSettings({ [key]: value });
  }

  const activeDownloads = downloads.filter(d =>
    d.status === 'downloading' || d.status === 'pending' || d.status === 'merging'
  );
  const completedDownloads = downloads.filter(d => d.status === 'completed');

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatSpeed(bytesPerSec: number): string {
    return formatBytes(bytesPerSec) + '/s';
  }

  function formatETA(seconds: number): string {
    if (!seconds || seconds === Infinity) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  return (
    <div className="app">
      {/* Title Bar */}
      <div className="titlebar">
        <h1>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          AIGrabber
        </h1>
      </div>

      <div className="app-container">
        {/* Sidebar */}
        <aside className="sidebar">
          <nav className="sidebar-nav">
            <div
              className={`nav-item ${view === 'downloads' ? 'active' : ''}`}
              onClick={() => setView('downloads')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Downloads
              {activeDownloads.length > 0 && (
                <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.7 }}>
                  {activeDownloads.length}
                </span>
              )}
            </div>

            <div
              className={`nav-item ${view === 'completed' ? 'active' : ''}`}
              onClick={() => setView('completed')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              Completed
              {completedDownloads.length > 0 && (
                <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.7 }}>
                  {completedDownloads.length}
                </span>
              )}
            </div>

            <div
              className={`nav-item ${view === 'settings' ? 'active' : ''}`}
              onClick={() => setView('settings')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Settings
            </div>
          </nav>

          <div className="sidebar-footer">
            <div className="status-card">
              <div className="status-row">
                <span className="status-label">FFmpeg</span>
                <span className="status-value">
                  <span className={`status-dot ${status?.ffmpegAvailable ? 'ok' : ''}`} />
                  {status?.ffmpegAvailable ? 'Ready' : 'Not found'}
                </span>
              </div>
              <div className="status-row">
                <span className="status-label">Version</span>
                <span className="status-value">{status?.version || '-'}</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="main-content">
          {view === 'downloads' && (
            <>
              <div className="content-header">
                <h2>Active Downloads</h2>
                <p>Videos currently being downloaded</p>
              </div>
              <div className="content-body">
                {activeDownloads.length === 0 ? (
                  <div className="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <h3>No active downloads</h3>
                    <p>Use the browser extension to detect and download videos from websites.</p>
                  </div>
                ) : (
                  <div className="download-list">
                    {activeDownloads.map(download => (
                      <div key={download.id} className="download-item">
                        <div className="download-header">
                          <div className="download-thumbnail" />
                          <div className="download-info">
                            <div className="download-title">
                              {download.stream.title || download.stream.pageTitle || 'Video'}
                            </div>
                            <div className="download-meta">
                              <span className={`status-badge ${download.status}`}>
                                {download.status}
                              </span>
                              <span>{download.selectedQuality.label}</span>
                              <span>{download.stream.type.toUpperCase()}</span>
                            </div>
                          </div>
                          <div className="download-actions">
                            <button
                              className="icon-btn danger"
                              onClick={() => cancelDownload(download.id)}
                              title="Cancel"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        <div className="download-progress">
                          <div className="progress-bar">
                            <div
                              className="progress-fill"
                              style={{ width: `${download.progress.percentage}%` }}
                            />
                          </div>
                          <div className="progress-text">
                            {download.progress.percentage.toFixed(1)}% •{' '}
                            {formatSpeed(download.progress.speed)} •{' '}
                            {formatETA(download.progress.eta)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {view === 'completed' && (
            <>
              <div className="content-header">
                <h2>Completed Downloads</h2>
                <p>Your downloaded videos</p>
              </div>
              <div className="content-body">
                {completedDownloads.length === 0 ? (
                  <div className="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    <h3>No completed downloads</h3>
                    <p>Downloads will appear here when finished.</p>
                  </div>
                ) : (
                  <div className="download-list">
                    {completedDownloads.map(download => (
                      <div key={download.id} className="download-item">
                        <div className="download-header">
                          <div className="download-thumbnail" />
                          <div className="download-info">
                            <div className="download-title">
                              {download.stream.title || download.stream.pageTitle || 'Video'}
                            </div>
                            <div className="download-meta">
                              <span className="status-badge completed">Completed</span>
                              <span>{download.selectedQuality.label}</span>
                              <span>{formatBytes(download.progress.downloadedBytes)}</span>
                            </div>
                          </div>
                          <div className="download-actions">
                            {download.outputPath && (
                              <button
                                className="icon-btn"
                                onClick={() => openFile(download.outputPath!)}
                                title="Show in folder"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="download-progress">
                          <div className="progress-bar">
                            <div className="progress-fill complete" style={{ width: '100%' }} />
                          </div>
                          <div className="progress-text">Complete</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {view === 'settings' && (
            <>
              <div className="content-header">
                <h2>Settings</h2>
                <p>Configure AIGrabber preferences</p>
              </div>
              <div className="content-body">
                <div className="settings-section">
                  <h3>Downloads</h3>

                  <div className="setting-row">
                    <div className="setting-label">
                      <h4>Download Location</h4>
                      <p>Where to save downloaded videos</p>
                    </div>
                    <div className="setting-control">
                      <input
                        type="text"
                        className="setting-input"
                        value={settings.downloadPath}
                        readOnly
                      />
                      <button className="btn btn-secondary" onClick={selectFolder}>
                        Browse
                      </button>
                    </div>
                  </div>

                  <div className="setting-row">
                    <div className="setting-label">
                      <h4>Concurrent Downloads</h4>
                      <p>Maximum simultaneous downloads</p>
                    </div>
                    <div className="setting-control">
                      <select
                        className="setting-input"
                        value={settings.maxConcurrentDownloads}
                        onChange={e =>
                          updateSetting('maxConcurrentDownloads', parseInt(e.target.value))
                        }
                        style={{ width: 80 }}
                      >
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                        <option value={5}>5</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="settings-section">
                  <h3>About</h3>
                  <div className="setting-row">
                    <div className="setting-label">
                      <h4>AIGrabber</h4>
                      <p>Video downloader for HLS and DASH streams</p>
                    </div>
                    <div className="setting-control">
                      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                        v{status?.version}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
