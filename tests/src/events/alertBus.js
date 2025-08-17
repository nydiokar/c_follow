"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalAlertBus = exports.AlertEventBus = void 0;
var events_1 = require("events");
var logger_1 = require("../utils/logger");
var AlertEventBus = /** @class */ (function (_super) {
    __extends(AlertEventBus, _super);
    function AlertEventBus() {
        var _this = _super.call(this) || this;
        _this.subscribers = new Map();
        _this.eventHistory = [];
        _this.maxHistorySize = 1000;
        _this.setMaxListeners(50); // Increase limit for multiple subscribers
        return _this;
    }
    AlertEventBus.prototype.subscribe = function (subscriber) {
        this.subscribers.set(subscriber.id, subscriber);
        this.on('alert', this.createEventHandler(subscriber));
        logger_1.logger.info("Alert subscriber registered: ".concat(subscriber.id));
    };
    AlertEventBus.prototype.unsubscribe = function (subscriberId) {
        var subscriber = this.subscribers.get(subscriberId);
        if (subscriber) {
            this.removeAllListeners("alert_".concat(subscriberId));
            this.subscribers.delete(subscriberId);
            logger_1.logger.info("Alert subscriber unregistered: ".concat(subscriberId));
        }
    };
    AlertEventBus.prototype.createEventHandler = function (subscriber) {
        var _this = this;
        return function (event) { return __awaiter(_this, void 0, void 0, function () {
            var error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        // Apply filters
                        if (subscriber.filters) {
                            if (subscriber.filters.types && !subscriber.filters.types.includes(event.type)) {
                                return [2 /*return*/];
                            }
                            if (subscriber.filters.priority && !subscriber.filters.priority.includes(event.priority)) {
                                return [2 /*return*/];
                            }
                            if (subscriber.filters.symbols && event.data.symbol &&
                                !subscriber.filters.symbols.includes(event.data.symbol)) {
                                return [2 /*return*/];
                            }
                        }
                        return [4 /*yield*/, subscriber.handler(event)];
                    case 1:
                        _a.sent();
                        return [3 /*break*/, 3];
                    case 2:
                        error_1 = _a.sent();
                        logger_1.logger.error("Error in alert subscriber ".concat(subscriber.id, ":"), error_1);
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        }); };
    };
    AlertEventBus.prototype.emitLongTrigger = function (trigger) {
        return __awaiter(this, void 0, void 0, function () {
            var event;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        event = {
                            id: "trigger_".concat(trigger.coinId, "_").concat(trigger.triggerType, "_").concat(Date.now()),
                            timestamp: Date.now(),
                            type: 'long_trigger',
                            data: trigger,
                            priority: this.getTriggerPriority(trigger)
                        };
                        return [4 /*yield*/, this.emitEvent(event)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    AlertEventBus.prototype.emitHotAlert = function (alert) {
        return __awaiter(this, void 0, void 0, function () {
            var event;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        event = {
                            id: "hot_".concat(alert.hotId, "_").concat(alert.alertType, "_").concat(Date.now()),
                            timestamp: Date.now(),
                            type: 'hot_alert',
                            data: alert,
                            priority: this.getHotAlertPriority(alert)
                        };
                        return [4 /*yield*/, this.emitEvent(event)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    AlertEventBus.prototype.emitSystemAlert = function (message_1) {
        return __awaiter(this, arguments, void 0, function (message, priority) {
            var event;
            if (priority === void 0) { priority = 'normal'; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        event = {
                            id: "system_".concat(Date.now(), "_").concat(Math.random().toString(36).substr(2, 9)),
                            timestamp: Date.now(),
                            type: 'system_alert',
                            data: { message: message },
                            priority: priority
                        };
                        return [4 /*yield*/, this.emitEvent(event)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    AlertEventBus.prototype.emitEvent = function (event) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                // Add to history
                this.eventHistory.unshift(event);
                if (this.eventHistory.length > this.maxHistorySize) {
                    this.eventHistory = this.eventHistory.slice(0, this.maxHistorySize);
                }
                // Emit to subscribers
                this.emit('alert', event);
                logger_1.logger.debug("Alert event emitted: ".concat(event.type, " - ").concat(event.id));
                return [2 /*return*/];
            });
        });
    };
    AlertEventBus.prototype.getTriggerPriority = function (trigger) {
        switch (trigger.triggerType) {
            case 'retrace':
                return trigger.retraceFromHigh && trigger.retraceFromHigh > 30 ? 'high' : 'normal';
            case 'breakout':
                return 'high';
            case 'mcap':
                return 'normal';
            case 'stall':
                return 'low';
            default:
                return 'normal';
        }
    };
    AlertEventBus.prototype.getHotAlertPriority = function (alert) {
        switch (alert.alertType) {
            case 'failsafe':
                return 'critical';
            case 'pct':
                return Math.abs(alert.deltaFromAnchor) > 50 ? 'high' : 'normal';
            case 'mcap':
                return 'normal';
            default:
                return 'normal';
        }
    };
    AlertEventBus.prototype.getEventHistory = function (limit) {
        if (limit === void 0) { limit = 50; }
        return this.eventHistory.slice(0, limit);
    };
    AlertEventBus.prototype.getSubscriberCount = function () {
        return this.subscribers.size;
    };
    AlertEventBus.prototype.clearHistory = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                this.eventHistory = [];
                logger_1.logger.info('Alert event history cleared');
                return [2 /*return*/];
            });
        });
    };
    AlertEventBus.prototype.getStats = function () {
        var eventsByType = {};
        var eventsByPriority = {};
        for (var _i = 0, _a = this.eventHistory; _i < _a.length; _i++) {
            var event_1 = _a[_i];
            eventsByType[event_1.type] = (eventsByType[event_1.type] || 0) + 1;
            eventsByPriority[event_1.priority] = (eventsByPriority[event_1.priority] || 0) + 1;
        }
        return {
            totalEvents: this.eventHistory.length,
            subscriberCount: this.subscribers.size,
            eventsByType: eventsByType,
            eventsByPriority: eventsByPriority
        };
    };
    return AlertEventBus;
}(events_1.EventEmitter));
exports.AlertEventBus = AlertEventBus;
exports.globalAlertBus = new AlertEventBus();
