"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Formatters = void 0;
var Formatters = /** @class */ (function () {
    function Formatters() {
    }
    Formatters.formatPrice = function (price, decimals) {
        if (decimals === void 0) { decimals = 6; }
        if (price >= 1) {
            return price.toFixed(4);
        }
        return price.toFixed(decimals);
    };
    Formatters.formatPriceChange = function (change) {
        var sign = change >= 0 ? '+' : '';
        return "".concat(sign).concat(change.toFixed(1), "%");
    };
    Formatters.formatVolume = function (volume) {
        if (volume >= 1000000000) {
            return "".concat((volume / 1000000000).toFixed(1), "B");
        }
        if (volume >= 1000000) {
            return "".concat((volume / 1000000).toFixed(1), "M");
        }
        if (volume >= 1000) {
            return "".concat((volume / 1000).toFixed(1), "K");
        }
        return volume.toFixed(0);
    };
    Formatters.formatMarketCap = function (value) {
        if (value >= 1000000000) {
            return "$".concat((value / 1000000000).toFixed(1), "B");
        }
        if (value >= 1000000) {
            return "$".concat((value / 1000000).toFixed(1), "M");
        }
        if (value >= 1000) {
            return "$".concat((value / 1000).toFixed(1), "K");
        }
        return "$".concat(value.toFixed(0));
    };
    Formatters.formatDuration = function (milliseconds) {
        var seconds = Math.floor(milliseconds / 1000);
        var minutes = Math.floor(seconds / 60);
        var hours = Math.floor(minutes / 60);
        var days = Math.floor(hours / 24);
        if (days > 0)
            return "".concat(days, "d ").concat(hours % 24, "h");
        if (hours > 0)
            return "".concat(hours, "h ").concat(minutes % 60, "m");
        if (minutes > 0)
            return "".concat(minutes, "m ").concat(seconds % 60, "s");
        return "".concat(seconds, "s");
    };
    Formatters.formatTimestamp = function (timestamp, timezone) {
        if (timezone === void 0) { timezone = 'UTC'; }
        return new Date(timestamp * 1000).toLocaleString('en-US', {
            timeZone: timezone,
            hour12: false,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };
    Formatters.formatPercentage = function (value, decimals) {
        if (decimals === void 0) { decimals = 1; }
        var sign = value >= 0 ? '+' : '';
        return "".concat(sign).concat(value.toFixed(decimals), "%");
    };
    Formatters.formatTableRow = function (symbol, price, change24h, retraceFrom72h, volume24h) {
        var priceStr = this.formatPrice(price);
        var change24hStr = this.formatPriceChange(change24h);
        var retraceStr = retraceFrom72h.toFixed(1);
        var volumeStr = this.formatVolume(volume24h);
        return "`".concat(symbol.padEnd(8), " ").concat(priceStr.padStart(8), " ").concat(change24hStr.padStart(7), " ").concat(retraceStr.padStart(6), "% ").concat(volumeStr.padStart(10), "`");
    };
    Formatters.escapeMarkdown = function (text) {
        if (!text)
            return '';
        var links = [];
        var linkRegex = /\[(.*?)\]\((.*?)\)/g;
        var textWithPlaceholders = text.replace(linkRegex, function (match) {
            links.push(match);
            return "__LINK_PLACEHOLDER_".concat(links.length - 1, "__");
        });
        var escapeChars = /[\\_[\]()~>#+=|{}.!-]/g;
        var escapedText = textWithPlaceholders.replace(escapeChars, '\\$&');
        var result = escapedText;
        links.forEach(function (link, index) {
            result = result.replace("__LINK_PLACEHOLDER_".concat(index, "__"), link);
        });
        return result;
    };
    Formatters.createProgressBar = function (current, total, length) {
        if (length === void 0) { length = 10; }
        var filled = Math.round((current / total) * length);
        var empty = length - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    };
    Formatters.truncateText = function (text, maxLength) {
        if (text.length <= maxLength)
            return text;
        return text.substring(0, maxLength - 3) + '...';
    };
    Formatters.formatBytes = function (bytes) {
        var sizes = ['B', 'KB', 'MB', 'GB'];
        if (bytes === 0)
            return '0 B';
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        return "".concat((bytes / Math.pow(1024, i)).toFixed(1), " ").concat(sizes[i]);
    };
    Formatters.formatLargeNumber = function (num) {
        if (num >= 1000000000) {
            return "".concat((num / 1000000000).toFixed(1), "B");
        }
        if (num >= 1000000) {
            return "".concat((num / 1000000).toFixed(1), "M");
        }
        if (num >= 1000) {
            return "".concat((num / 1000).toFixed(1), "K");
        }
        return num.toString();
    };
    return Formatters;
}());
exports.Formatters = Formatters;
