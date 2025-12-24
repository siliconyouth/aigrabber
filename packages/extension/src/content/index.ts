import browser from 'webextension-polyfill';

/**
 * Content script for detecting video elements on the page
 */

interface VideoElementInfo {
  src: string;
  currentSrc: string;
  poster?: string;
  duration?: number;
  width: number;
  height: number;
}

// Scan for video elements
function scanForVideos(): VideoElementInfo[] {
  const videos: VideoElementInfo[] = [];
  const videoElements = document.querySelectorAll('video');

  for (const video of videoElements) {
    // Get video source
    let src = video.src || video.currentSrc;

    // Check source elements
    if (!src) {
      const sourceEl = video.querySelector('source');
      if (sourceEl) {
        src = sourceEl.src;
      }
    }

    // Skip empty or blob URLs (often DRM protected)
    if (!src || src.startsWith('blob:')) {
      continue;
    }

    videos.push({
      src,
      currentSrc: video.currentSrc,
      poster: video.poster || undefined,
      duration: video.duration && !isNaN(video.duration) ? video.duration : undefined,
      width: video.videoWidth || video.clientWidth,
      height: video.videoHeight || video.clientHeight,
    });
  }

  return videos;
}

// Monitor for dynamically added videos
function observeVideos() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLVideoElement) {
          handleNewVideo(node);
        }
        if (node instanceof HTMLElement) {
          const videos = node.querySelectorAll('video');
          for (const video of videos) {
            handleNewVideo(video);
          }
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return observer;
}

// Handle newly detected video element
function handleNewVideo(video: HTMLVideoElement) {
  const src = video.src || video.currentSrc;

  // Skip blob URLs (usually DRM)
  if (!src || src.startsWith('blob:')) {
    return;
  }

  // Notify background script
  browser.runtime.sendMessage({
    type: 'VIDEO_ELEMENT_DETECTED',
    data: {
      src,
      poster: video.poster,
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    },
    timestamp: Date.now(),
  }).catch(() => {
    // Extension context may not be available
  });
}

// Listen for messages from background/popup
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'SCAN_PAGE') {
    const videos = scanForVideos();
    return Promise.resolve({ videos });
  }

  if (message.type === 'GET_PAGE_INFO') {
    return Promise.resolve({
      url: window.location.href,
      title: document.title,
      videos: scanForVideos(),
    });
  }
});

// Initialize
console.log('[AIGrabber] Content script loaded');

// Initial scan
const initialVideos = scanForVideos();
if (initialVideos.length > 0) {
  console.log(`[AIGrabber] Found ${initialVideos.length} video elements`);
}

// Start observing
observeVideos();
