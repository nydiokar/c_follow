import WebSocket from 'ws';
import { logger } from '../../utils/logger';

export type WsEvent = {
  type: 'log' | 'program-account' | 'other';
  payload: any;
  context?: any;
};

export type SendFrame = Record<string, unknown>;

export type Subscription = {
  id: number;
  frame: SendFrame;
};

export class HeliusWebSocketConnection {
  private ws: WebSocket | null = null;
  private url: string;
  private pingIntervalMs: number;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectBackoffMs = 1000;
  private subscriptions: Subscription[] = [];
  private nextId = 1;
  private onEvent: (e: WsEvent) => void;

  constructor(params: { apiKey: string; pingIntervalMs: number; onEvent: (e: WsEvent) => void }) {
    this.url = `wss://mainnet.helius-rpc.com/?api-key=${params.apiKey}`;
    this.pingIntervalMs = Math.max(30000, params.pingIntervalMs || 55000);
    this.onEvent = params.onEvent;
  }

  public connect(): void {
    if (this.ws) return;
    this.open();
  }

  public close(): void {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  public addSubscriptionFrame(frame: SendFrame): number {
    const id = this.nextId++;
    const sub: Subscription = { id, frame: { ...frame, id } };
    this.subscriptions.push(sub);
    this.send(sub.frame);
    return id;
  }

  private open(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on('open', () => {
      logger.info('Helius WS connected');
      this.startHeartbeat(ws);
      // Re-subscribe
      for (const sub of this.subscriptions) {
        this.safeSend(ws, sub.frame);
      }
      // Reset backoff
      this.reconnectBackoffMs = 1000;
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg?.method === 'logsNotification') {
          this.onEvent({ type: 'log', payload: msg.params?.result, context: msg.params?.context });
        } else if (msg?.method === 'programNotification' || msg?.method === 'accountNotification') {
          this.onEvent({ type: 'program-account', payload: msg.params?.result, context: msg.params?.context });
        } else {
          // subscription ack or other
        }
      } catch (e) {
        logger.warn('WS message parse error', { error: (e as Error).message });
      }
    });

    ws.on('error', (err: Error) => {
      logger.error('Helius WS error', { error: (err as Error).message });
    });

    ws.on('close', () => {
      logger.warn('Helius WS closed, scheduling reconnect');
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      this.ws = null;
      setTimeout(() => this.open(), this.reconnectBackoffMs);
      this.reconnectBackoffMs = Math.min(this.reconnectBackoffMs * 2, 30000);
    });
  }

  private startHeartbeat(ws: WebSocket): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.ping(); } catch {}
      }
    }, this.pingIntervalMs);
  }

  private send(frame: SendFrame): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    this.safeSend(ws, frame);
  }

  private safeSend(ws: WebSocket, frame: SendFrame): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch (e) {
      logger.warn('WS send failed', { error: (e as Error).message });
    }
  }
}


