import { Context, Telegraf } from 'telegraf';
import { Update, Message } from 'telegraf/typings/core/types/typegram';

export interface BotCommand {
  command: string;
  description: string;
  handler: (msg: Message, match: RegExpMatchArray | null) => Promise<void>;
}

export interface TelegramMessage {
  message_id: number;
  chat: {
    id: number;
    type: string;
  };
  text?: string;
  from?: {
    id: number;
    username?: string;
  };
}

export type TelegramBot = Telegraf<Context<Update>>;
export type TelegramContext = Context<Update>;

export interface OutboxMessage {
  chatId: string;
  text: string;
  fingerprint: string;
  timestamp: number;
}

export interface MessageSender {
  sendMessage(chatId: string, text: string, fingerprint?: string): Promise<boolean>;
  sendBulkMessages(messages: OutboxMessage[]): Promise<number>;
}