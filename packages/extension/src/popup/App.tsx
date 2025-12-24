import React, { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';
import type { DetectedStream, VideoQuality, Message } from '@aigrabber/shared';

interface StreamWithSelection extends DetectedStream {
  selectedQuality?: VideoQuality;
}

export function App() {
  const [streams, setStreams] = useState<StreamWithSelection[]>([]);
  const [appConnected, setAppConnected] = useState(false);
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    // Get streams for current tab
    loadStreams();

    // Listen for new streams and updates
    const listener = (message: Message) => {
      switch (message.type) {
        case 'STREAM_DETECTED':
          if ('stream' in message) {
            setStreams(prev => {
              const exists = prev.some(s => s.id === message.stream.id);
              if (exists) return prev;
              return [...prev, { ...message.stream, selectedQuality: message.stream.qualities[0] }];
            });
          }
          break;

        case 'APP_STATUS':
          if ('connected' in message) {
            setAppConnected(message.connected);
          }
          break;

        case 'DOWNLOAD_PROGRESS':
          if ('jobId' in message && 'progress' in message) {
            setProgress(prev => new Map(prev).set(message.jobId, message.progress.percentage));
          }
          break;

        case 'DOWNLOAD_COMPLETE':
          if ('jobId' in message) {
            setDownloading(prev => {
              const next = new Set(prev);
              next.delete(message.jobId);
              return next;
            });
            setProgress(prev => {
              const next = new Map(prev);
              next.delete(message.jobId);
              return next;
            });
          }
          break;
      }
    };

    browser.runtime.onMessage.addListener(listener);

    // Check app status
    browser.runtime.sendMessage({ type: 'PING', timestamp: Date.now() })
      .then((response: any) => {
        if (response?.appConnected) {
          setAppConnected(true);
        }
      })
      .catch(() => {});

    return () => {
      browser.runtime.onMessage.removeListener(listener);
    };
  }, []);

  async function loadStreams() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      // Send tab ID so background can look up streams
      const response = await browser.runtime.sendMessage({
        type: 'GET_DOWNLOADS',
        tabId: tab.id
      });
      if (response?.streams) {
        setStreams(response.streams.map((s: DetectedStream) => ({
          ...s,
          selectedQuality: s.qualities[0],
        })));
      }
    } catch (error) {
      console.error('Failed to load streams:', error);
    }
  }

  function selectQuality(streamId: string, quality: VideoQuality) {
    setStreams(prev =>
      prev.map(s =>
        s.id === streamId ? { ...s, selectedQuality: quality } : s
      )
    );
  }

  async function downloadStream(stream: StreamWithSelection) {
    if (!stream.selectedQuality || stream.protection === 'drm') {
      return;
    }

    setDownloading(prev => new Set(prev).add(stream.id));

    try {
      await browser.runtime.sendMessage({
        type: 'DOWNLOAD_REQUEST',
        stream,
        quality: stream.selectedQuality,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Failed to start download:', error);
      setDownloading(prev => {
        const next = new Set(prev);
        next.delete(stream.id);
        return next;
      });
    }
  }

  function formatDuration(seconds?: number): string {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <h1>
          <svg className="logo" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          AIGrabber
        </h1>
        <div className="status-indicator">
          <span className={`status-dot ${appConnected ? 'connected' : ''}`} />
          {appConnected ? 'App connected' : 'App offline'}
        </div>
      </header>

      {/* Stream List */}
      <div className="stream-list">
        {streams.length === 0 ? (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M10 10l4 2-4 2v-4z" />
            </svg>
            <h2>No videos detected</h2>
            <p>
              Play a video on the page to detect it.
              <br />
              Supports HLS, DASH, and direct MP4.
            </p>
          </div>
        ) : (
          streams.map(stream => (
            <div
              key={stream.id}
              className={`stream-item ${stream.protection === 'drm' ? 'protected' : ''}`}
            >
              <div className="stream-header">
                {stream.thumbnail ? (
                  <img
                    className="stream-thumbnail"
                    src={stream.thumbnail}
                    alt=""
                  />
                ) : (
                  <div className="stream-thumbnail" />
                )}
                <div className="stream-info">
                  <div className="stream-title">
                    {stream.title || stream.pageTitle || 'Untitled video'}
                  </div>
                  <div className="stream-meta">
                    <span className={`stream-type ${stream.protection === 'drm' ? 'drm' : ''}`}>
                      {stream.protection === 'drm' ? 'Protected' : stream.type.toUpperCase()}
                    </span>
                    {stream.duration && (
                      <span>{formatDuration(stream.duration)}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Quality selector */}
              {stream.qualities.length > 1 && stream.protection !== 'drm' && (
                <div className="quality-selector">
                  {stream.qualities.map((q, i) => (
                    <button
                      key={i}
                      className={`quality-btn ${stream.selectedQuality === q ? 'selected' : ''}`}
                      onClick={() => selectQuality(stream.id, q)}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Download button */}
              <button
                className="download-btn"
                disabled={
                  stream.protection === 'drm' ||
                  !appConnected ||
                  downloading.has(stream.id)
                }
                onClick={() => downloadStream(stream)}
              >
                {downloading.has(stream.id) ? (
                  <>Downloading...</>
                ) : stream.protection === 'drm' ? (
                  <>Protected - Cannot Download</>
                ) : !appConnected ? (
                  <>Start AIGrabber App</>
                ) : (
                  <>Download {stream.selectedQuality?.label || ''}</>
                )}
              </button>

              {/* Progress bar */}
              {downloading.has(stream.id) && (
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${progress.get(stream.id) || 0}%` }}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <footer className="footer">
        {streams.length} video{streams.length !== 1 ? 's' : ''} detected
      </footer>
    </div>
  );
}
