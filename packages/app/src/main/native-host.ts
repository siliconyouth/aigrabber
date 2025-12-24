import type { Message } from '@aigrabber/shared';

interface NativeMessagingHostOptions {
  onMessage: (message: any) => void;
}

/**
 * Native Messaging Host for browser extension communication
 *
 * The native messaging protocol uses length-prefixed JSON messages:
 * - First 4 bytes: message length (little-endian uint32)
 * - Remaining bytes: JSON-encoded message
 */
export class NativeMessagingHost {
  private options: NativeMessagingHostOptions;
  private running = false;
  private buffer = Buffer.alloc(0);

  constructor(options: NativeMessagingHostOptions) {
    this.options = options;
  }

  /**
   * Start listening for messages from stdin
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Set stdin to binary mode
    if (process.stdin.setEncoding) {
      process.stdin.setEncoding(undefined as any);
    }
    process.stdin.resume();

    process.stdin.on('data', (data: Buffer) => {
      this.handleData(data);
    });

    process.stdin.on('end', () => {
      this.running = false;
    });

    console.log('[AIGrabber] Native messaging host started');
  }

  /**
   * Stop listening
   */
  stop(): void {
    this.running = false;
    process.stdin.pause();
  }

  /**
   * Send message to browser extension via stdout
   */
  sendMessage(message: Message): void {
    const json = JSON.stringify(message);
    const buffer = Buffer.from(json, 'utf8');

    // Write length prefix (4 bytes, little-endian)
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32LE(buffer.length, 0);

    process.stdout.write(lengthBuffer);
    process.stdout.write(buffer);
  }

  /**
   * Handle incoming data from stdin
   */
  private handleData(data: Buffer): void {
    // Append to buffer
    this.buffer = Buffer.concat([this.buffer, data]);

    // Process complete messages
    while (this.buffer.length >= 4) {
      // Read message length
      const messageLength = this.buffer.readUInt32LE(0);

      // Check if we have the complete message
      if (this.buffer.length < 4 + messageLength) {
        break;
      }

      // Extract message
      const messageBuffer = this.buffer.slice(4, 4 + messageLength);
      this.buffer = this.buffer.slice(4 + messageLength);

      // Parse and handle message
      try {
        const message = JSON.parse(messageBuffer.toString('utf8'));
        this.options.onMessage(message);
      } catch (error) {
        console.error('[AIGrabber] Failed to parse native message:', error);
      }
    }
  }
}
