export class Formatters {
  static formatPrice(price: number, decimals: number = 6): string {
    if (price >= 1) {
      return price.toFixed(4);
    }
    return price.toFixed(decimals);
  }

  static formatPriceChange(change: number): string {
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(1)}%`;
  }

  static formatVolume(volume: number): string {
    if (volume >= 1_000_000_000) {
      return `${(volume / 1_000_000_000).toFixed(1)}B`;
    }
    if (volume >= 1_000_000) {
      return `${(volume / 1_000_000).toFixed(1)}M`;
    }
    if (volume >= 1_000) {
      return `${(volume / 1_000).toFixed(1)}K`;
    }
    return volume.toFixed(0);
  }

  static formatMarketCap(value: number): string {
    if (value >= 1_000_000_000) {
      return `$${(value / 1_000_000_000).toFixed(1)}B`;
    }
    if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `$${(value / 1_000).toFixed(1)}K`;
    }
    return `$${value.toFixed(0)}`;
  }

  static formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  static formatTimestamp(timestamp: number, timezone: string = 'UTC'): string {
    return new Date(timestamp * 1000).toLocaleString('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  static formatPercentage(value: number, decimals: number = 1): string {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(decimals)}%`;
  }

  static formatTableRow(
    symbol: string,
    price: number,
    change24h: number,
    retraceFrom72h: number,
    volume24h: number
  ): string {
    const priceStr = this.formatPrice(price);
    const change24hStr = this.formatPriceChange(change24h);
    const retraceStr = retraceFrom72h.toFixed(1);
    const volumeStr = this.formatVolume(volume24h);

    return `\`${symbol.padEnd(8)} ${priceStr.padStart(8)} ${change24hStr.padStart(7)} ${retraceStr.padStart(6)}% ${volumeStr.padStart(10)}\``;
  }

  static escapeMarkdown(text: string): string {
    if (!text) return '';

    const links: string[] = [];
    const linkRegex = /\[(.*?)\]\((.*?)\)/g;

    const textWithPlaceholders = text.replace(linkRegex, (match) => {
        links.push(match);
        return `__LINK_PLACEHOLDER_${links.length - 1}__`;
    });

    const escapeChars = /[\\_[\]()~>#+=|{}.!-]/g;
    const escapedText = textWithPlaceholders.replace(escapeChars, '\\$&');

    let result = escapedText;
    links.forEach((link, index) => {
        result = result.replace(`__LINK_PLACEHOLDER_${index}__`, link);
    });

    return result;
  }

  static createProgressBar(current: number, total: number, length: number = 10): string {
    const filled = Math.round((current / total) * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  static truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  static formatBytes(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }

  static formatLargeNumber(num: number): string {
    if (num >= 1_000_000_000) {
      return `${(num / 1_000_000_000).toFixed(1)}B`;
    }
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    }
    return num.toString();
  }
}