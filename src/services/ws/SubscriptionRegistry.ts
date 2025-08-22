import { HeliusWebSocketConnection } from './WebSocketConnection';

export type DexProgramConfig = {
  programIds: string[];
};

export type TokenProgramConfig = {
  splToken: boolean;
  token2022: boolean;
};

export class SubscriptionRegistry {
  private conn: HeliusWebSocketConnection;
  private dexCfg: DexProgramConfig;
  private tokCfg: TokenProgramConfig;

  constructor(params: { conn: HeliusWebSocketConnection; dexCfg: DexProgramConfig; tokCfg: TokenProgramConfig }) {
    this.conn = params.conn;
    this.dexCfg = params.dexCfg;
    this.tokCfg = params.tokCfg;
  }

  public registerAll(): void {
    // logsSubscribe for DEX programs
    for (const pid of this.dexCfg.programIds) {
      this.conn.addSubscriptionFrame({
        jsonrpc: '2.0',
        method: 'logsSubscribe',
        params: [
          { mentions: [pid] },
          { commitment: 'confirmed' }
        ]
      });
    }

    // programSubscribe for Token programs
    if (this.tokCfg.splToken) {
      this.conn.addSubscriptionFrame({
        jsonrpc: '2.0',
        method: 'programSubscribe',
        params: [
          'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          { encoding: 'jsonParsed', commitment: 'confirmed' }
        ]
      });
    }
    if (this.tokCfg.token2022) {
      this.conn.addSubscriptionFrame({
        jsonrpc: '2.0',
        method: 'programSubscribe',
        params: [
          'TokenzQdBNbLqP5VEh9xnFJz5dG27K7ivozsQJ4xxQh',
          { encoding: 'jsonParsed', commitment: 'confirmed' }
        ]
      });
    }
  }
}


