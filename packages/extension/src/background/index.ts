import browser from 'webextension-polyfill';
import { StreamDetector } from './detector';
import { NativeMessaging } from './native-messaging';
import type { DetectedStream, Message, DownloadRequestMessage } from '@aigrabber/shared';

// Store detected streams per tab
const tabStreams = new Map<number, DetectedStream[]>();
const detector = new StreamDetector();
const nativeMessaging = new NativeMessaging();

// Initialize extension
async function init() {
  console.log('[AIGrabber] Background service worker started');

  // Listen for web requests to detect streams
  browser.webRequest.onBeforeRequest.addListener(
    handleRequest,
    { urls: ['<all_urls>'] },
    []
  );

  // Listen for tab updates
  browser.tabs.onUpdated.addListener(handleTabUpdate);

  // Listen for tab removal
  browser.tabs.onRemoved.addListener(handleTabRemove);

  // Listen for messages from popup/content scripts
  browser.runtime.onMessage.addListener(handleMessage);

  // Try to connect to native app
  await nativeMessaging.connect();
}

// Handle web requests to detect video streams
function handleRequest(details: browser.WebRequest.OnBeforeRequestDetailsType) {
  const { tabId, url, type } = details;

  if (tabId < 0) return; // Ignore background requests

  // Check if this is a video stream
  const streamInfo = detector.detectFromUrl(url, type);

  if (streamInfo) {
    addStreamToTab(tabId, streamInfo);
  }
}

// Handle tab navigation - clear old streams
function handleTabUpdate(
  tabId: number,
  changeInfo: browser.Tabs.OnUpdatedChangeInfoType,
  tab: browser.Tabs.Tab
) {
  if (changeInfo.status === 'loading') {
    // Clear streams when navigating to a new page
    tabStreams.delete(tabId);
    updateBadge(tabId, 0);
  }
}

// Handle tab closure
function handleTabRemove(tabId: number) {
  tabStreams.delete(tabId);
}

// Add detected stream to tab
async function addStreamToTab(tabId: number, partialStream: Partial<DetectedStream>) {
  if (!tabStreams.has(tabId)) {
    tabStreams.set(tabId, []);
  }

  const streams = tabStreams.get(tabId)!;

  // Avoid duplicates
  const exists = streams.some(s => s.url === partialStream.url);
  if (exists) return;

  // Get tab info for page context
  let pageUrl = '';
  let pageTitle = '';
  try {
    const tab = await browser.tabs.get(tabId);
    pageUrl = tab.url || '';
    pageTitle = tab.title || '';
  } catch {
    // Tab may not exist
  }

  // Fetch manifest to get quality info
  const fullStream = await detector.enrichStream(partialStream, pageUrl, pageTitle);

  if (fullStream) {
    streams.push(fullStream);
    updateBadge(tabId, streams.length);

    // Notify popup if open
    browser.runtime.sendMessage({
      type: 'STREAM_DETECTED',
      stream: fullStream,
      timestamp: Date.now(),
    }).catch(() => {
      // Popup not open, ignore
    });
  }
}

// Update extension badge with stream count
function updateBadge(tabId: number, count: number) {
  const text = count > 0 ? String(count) : '';
  const color = count > 0 ? '#4CAF50' : '#666666';

  browser.action.setBadgeText({ text, tabId });
  browser.action.setBadgeBackgroundColor({ color, tabId });
}

// Handle messages from popup/content scripts
function handleMessage(
  message: Message,
  sender: browser.Runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): boolean | void {
  switch (message.type) {
    case 'GET_DOWNLOADS':
      // Get current tab's streams
      const tabId = sender.tab?.id;
      if (tabId) {
        const streams = tabStreams.get(tabId) || [];
        sendResponse({ streams });
      } else {
        sendResponse({ streams: [] });
      }
      return true;

    case 'DOWNLOAD_REQUEST':
      handleDownloadRequest(message as DownloadRequestMessage);
      return true;

    case 'PING':
      sendResponse({
        type: 'PONG',
        timestamp: Date.now(),
        version: '0.1.0',
        appConnected: nativeMessaging.isConnected(),
      });
      return true;

    default:
      return false;
  }
}

// Handle download request from popup
async function handleDownloadRequest(message: DownloadRequestMessage) {
  if (!nativeMessaging.isConnected()) {
    // Try to reconnect
    const connected = await nativeMessaging.connect();
    if (!connected) {
      browser.runtime.sendMessage({
        type: 'DOWNLOAD_ERROR',
        error: 'Companion app is not running. Please start AIGrabber app.',
        timestamp: Date.now(),
      });
      return;
    }
  }

  // Forward to native app
  nativeMessaging.send(message);
}

// Start the extension
init();

// Export for use in popup
export { tabStreams, nativeMessaging };
