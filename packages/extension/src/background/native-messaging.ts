import browser from 'webextension-polyfill';
import type { Message, DownloadProgressMessage, DownloadCompleteMessage, DownloadErrorMessage } from '@aigrabber/shared';

const NATIVE_APP_NAME = 'com.aigrabber.app';

export class NativeMessaging {
  private port: browser.Runtime.Port | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

  /**
   * Check if connected to native app
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Connect to native messaging host
   */
  async connect(): Promise<boolean> {
    if (this.connected && this.port) {
      return true;
    }

    try {
      this.port = browser.runtime.connectNative(NATIVE_APP_NAME);

      this.port.onMessage.addListener(this.handleMessage.bind(this));
      this.port.onDisconnect.addListener(this.handleDisconnect.bind(this));

      // Send ping to verify connection
      this.port.postMessage({ type: 'PING', timestamp: Date.now() });

      // Wait briefly for response
      await new Promise(resolve => setTimeout(resolve, 100));

      this.connected = true;
      this.reconnectAttempts = 0;

      console.log('[AIGrabber] Connected to native app');

      // Notify popup
      browser.runtime.sendMessage({
        type: 'APP_STATUS',
        connected: true,
        ffmpegAvailable: true,
        version: '0.1.0',
        timestamp: Date.now(),
      }).catch(() => {});

      return true;
    } catch (error) {
      console.warn('[AIGrabber] Failed to connect to native app:', error);
      this.connected = false;
      this.port = null;
      return false;
    }
  }

  /**
   * Disconnect from native app
   */
  disconnect(): void {
    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }
    this.connected = false;
  }

  /**
   * Send message to native app
   */
  send(message: Message): boolean {
    if (!this.port || !this.connected) {
      console.warn('[AIGrabber] Cannot send message: not connected');
      return false;
    }

    try {
      this.port.postMessage(message);
      return true;
    } catch (error) {
      console.error('[AIGrabber] Failed to send message:', error);
      return false;
    }
  }

  /**
   * Handle incoming message from native app
   */
  private handleMessage(message: Message): void {
    console.log('[AIGrabber] Received from native app:', message.type);

    switch (message.type) {
      case 'PONG':
        this.connected = true;
        break;

      case 'DOWNLOAD_PROGRESS':
      case 'DOWNLOAD_COMPLETE':
      case 'DOWNLOAD_ERROR':
        // Forward to popup
        browser.runtime.sendMessage(message).catch(() => {
          // Popup not open
        });
        break;

      case 'APP_STATUS':
        browser.runtime.sendMessage(message).catch(() => {});
        break;
    }
  }

  /**
   * Handle disconnect from native app
   */
  private handleDisconnect(): void {
    console.log('[AIGrabber] Disconnected from native app');

    const error = browser.runtime.lastError;
    if (error) {
      console.warn('[AIGrabber] Disconnect error:', error.message);
    }

    this.connected = false;
    this.port = null;

    // Notify popup
    browser.runtime.sendMessage({
      type: 'APP_STATUS',
      connected: false,
      ffmpegAvailable: false,
      version: '',
      timestamp: Date.now(),
    }).catch(() => {});

    // Attempt reconnect
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => this.connect(), 5000);
    }
  }
}
