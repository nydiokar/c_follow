"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
var winston_1 = require("winston");
var logLevel = process.env.LOG_LEVEL || 'info';
exports.logger = winston_1.default.createLogger({
    level: logLevel,
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json()),
    defaultMeta: { service: 'follow-coin-bot' },
    transports: [
        new winston_1.default.transports.File({
            filename: './logs/error.log',
            level: 'error',
            maxsize: 5242880,
            maxFiles: 5
        }),
        new winston_1.default.transports.File({
            filename: './logs/combined.log',
            maxsize: 5242880,
            maxFiles: 5
        }),
    ],
});
if (process.env.NODE_ENV !== 'production') {
    exports.logger.add(new winston_1.default.transports.Console({
        format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple())
    }));
}
exports.default = exports.logger;
