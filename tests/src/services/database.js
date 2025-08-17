"use strict";
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
exports.DatabaseService = void 0;
var database_1 = require("../utils/database");
var logger_1 = require("../utils/logger");
var DatabaseService = /** @class */ (function () {
    function DatabaseService() {
        this.prisma = database_1.DatabaseManager.getInstance();
        // Database initialization handled by DatabaseManager
    }
    DatabaseService.prototype.initialize = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                // Initialization handled by DatabaseManager
                logger_1.logger.info('DatabaseService initialized');
                return [2 /*return*/];
            });
        });
    };
    DatabaseService.prototype.addCoinToLongList = function (symbol, chain, tokenAddress, name) {
        return __awaiter(this, void 0, void 0, function () {
            var now, result;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        now = Math.floor(Date.now() / 1000);
                        return [4 /*yield*/, this.prisma.$transaction(function (tx) { return __awaiter(_this, void 0, void 0, function () {
                                var coin, existingWatch;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: return [4 /*yield*/, tx.coin.upsert({
                                                where: {
                                                    chain_tokenAddress: {
                                                        chain: chain,
                                                        tokenAddress: tokenAddress
                                                    }
                                                },
                                                update: {
                                                    symbol: symbol,
                                                    name: name || null,
                                                    isActive: true
                                                },
                                                create: {
                                                    chain: chain,
                                                    tokenAddress: tokenAddress,
                                                    symbol: symbol,
                                                    name: name || null,
                                                    isActive: true
                                                }
                                            })];
                                        case 1:
                                            coin = _a.sent();
                                            return [4 /*yield*/, tx.longWatch.findUnique({
                                                    where: { coinId: coin.coinId }
                                                })];
                                        case 2:
                                            existingWatch = _a.sent();
                                            if (!!existingWatch) return [3 /*break*/, 5];
                                            return [4 /*yield*/, tx.longWatch.create({
                                                    data: {
                                                        coinId: coin.coinId,
                                                        addedAtUtc: now
                                                    }
                                                })];
                                        case 3:
                                            _a.sent();
                                            return [4 /*yield*/, tx.longState.create({
                                                    data: {
                                                        coinId: coin.coinId,
                                                        lastUpdatedUtc: now
                                                    }
                                                })];
                                        case 4:
                                            _a.sent();
                                            _a.label = 5;
                                        case 5: return [2 /*return*/, coin.coinId];
                                    }
                                });
                            }); })];
                    case 1:
                        result = _a.sent();
                        logger_1.logger.info("Added coin ".concat(symbol, " to long list with ID ").concat(result));
                        return [2 /*return*/, result];
                }
            });
        });
    };
    DatabaseService.prototype.removeCoinFromLongList = function (symbol) {
        return __awaiter(this, void 0, void 0, function () {
            var coin;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.prisma.coin.findFirst({
                            where: { symbol: symbol },
                            include: { longWatch: true }
                        })];
                    case 1:
                        coin = _a.sent();
                        if (!coin || !coin.longWatch) {
                            return [2 /*return*/, false];
                        }
                        return [4 /*yield*/, this.prisma.longWatch.delete({
                                where: { coinId: coin.coinId }
                            })];
                    case 2:
                        _a.sent();
                        logger_1.logger.info("Removed coin ".concat(symbol, " from long list"));
                        return [2 /*return*/, true];
                }
            });
        });
    };
    DatabaseService.prototype.getLongListCoins = function () {
        return __awaiter(this, void 0, void 0, function () {
            var result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.prisma.coin.findMany({
                            where: {
                                isActive: true,
                                longWatch: {
                                    isNot: null
                                }
                            },
                            include: {
                                longWatch: true
                            }
                        })];
                    case 1:
                        result = _a.sent();
                        return [2 /*return*/, result.map(function (coin) { return ({
                                coinId: coin.coinId,
                                chain: coin.chain,
                                tokenAddress: coin.tokenAddress,
                                symbol: coin.symbol,
                                name: coin.name || undefined,
                                config: {
                                    retraceOn: coin.longWatch.retraceOn,
                                    stallOn: coin.longWatch.stallOn,
                                    breakoutOn: coin.longWatch.breakoutOn,
                                    mcapOn: coin.longWatch.mcapOn,
                                    retracePct: coin.longWatch.retracePct,
                                    stallVolPct: coin.longWatch.stallVolPct,
                                    stallBandPct: coin.longWatch.stallBandPct,
                                    breakoutPct: coin.longWatch.breakoutPct,
                                    breakoutVolX: coin.longWatch.breakoutVolX,
                                    mcapLevels: coin.longWatch.mcapLevels || undefined
                                }
                            }); })];
                }
            });
        });
    };
    DatabaseService.prototype.updateLongState = function (coinId, data) {
        return __awaiter(this, void 0, void 0, function () {
            var now;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        now = Math.floor(Date.now() / 1000);
                        return [4 /*yield*/, this.prisma.longState.upsert({
                                where: { coinId: coinId },
                                update: {
                                    lastPrice: data.price,
                                    lastMcap: data.marketCap || null,
                                    h12High: data.h12High || null,
                                    h24High: data.h24High || null,
                                    h72High: data.h72High || null,
                                    h12Low: data.h12Low || null,
                                    h24Low: data.h24Low || null,
                                    h72Low: data.h72Low || null,
                                    v12Sum: data.v12Sum || null,
                                    v24Sum: data.v24Sum || null,
                                    lastUpdatedUtc: now
                                },
                                create: {
                                    coinId: coinId,
                                    lastPrice: data.price,
                                    lastMcap: data.marketCap || null,
                                    h12High: data.h12High || null,
                                    h24High: data.h24High || null,
                                    h72High: data.h72High || null,
                                    h12Low: data.h12Low || null,
                                    h24Low: data.h24Low || null,
                                    h72Low: data.h72Low || null,
                                    v12Sum: data.v12Sum || null,
                                    v24Sum: data.v24Sum || null,
                                    lastUpdatedUtc: now
                                }
                            })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    DatabaseService.prototype.recordTriggerFire = function (coinId, triggerType) {
        return __awaiter(this, void 0, void 0, function () {
            var now, updateData;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        now = Math.floor(Date.now() / 1000);
                        updateData = {};
                        switch (triggerType) {
                            case 'retrace':
                                updateData.lastRetraceFireUtc = now;
                                break;
                            case 'stall':
                                updateData.lastStallFireUtc = now;
                                break;
                            case 'breakout':
                                updateData.lastBreakoutFireUtc = now;
                                break;
                            case 'mcap':
                                updateData.lastMcapFireUtc = now;
                                break;
                        }
                        return [4 /*yield*/, this.prisma.longState.update({
                                where: { coinId: coinId },
                                data: updateData
                            })];
                    case 1:
                        _a.sent();
                        logger_1.logger.debug("Recorded ".concat(triggerType, " trigger fire for coin ").concat(coinId));
                        return [2 /*return*/];
                }
            });
        });
    };
    DatabaseService.prototype.recordLongTriggerAlert = function (coinId, trigger) {
        return __awaiter(this, void 0, void 0, function () {
            var fingerprint, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        fingerprint = "long_".concat(coinId, "_").concat(trigger.triggerType, "_").concat(trigger.timestamp || Date.now());
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this.prisma.alertHistory.create({
                                data: {
                                    coinId: coinId,
                                    tsUtc: Math.floor(Date.now() / 1000),
                                    kind: trigger.triggerType,
                                    payloadJson: JSON.stringify(trigger),
                                    fingerprint: fingerprint,
                                },
                            })];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        error_1 = _a.sent();
                        if ((error_1 === null || error_1 === void 0 ? void 0 : error_1.code) !== 'P2002') { // Ignore unique constraint errors
                            throw error_1;
                        }
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    DatabaseService.prototype.recordHotTriggerAlert = function (hotId, alert) {
        return __awaiter(this, void 0, void 0, function () {
            var fingerprint, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        fingerprint = "hot_".concat(hotId, "_").concat(alert.alertType, "_").concat(alert.timestamp);
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this.prisma.alertHistory.create({
                                data: {
                                    hotId: hotId,
                                    tsUtc: Math.floor(alert.timestamp / 1000),
                                    kind: alert.alertType,
                                    payloadJson: JSON.stringify(alert),
                                    fingerprint: fingerprint,
                                    symbol: alert.symbol,
                                },
                            })];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        error_2 = _a.sent();
                        if ((error_2 === null || error_2 === void 0 ? void 0 : error_2.code) !== 'P2002') { // Ignore unique constraint errors
                            throw error_2;
                        }
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    DatabaseService.prototype.getLongStates = function () {
        return __awaiter(this, void 0, void 0, function () {
            var states;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.prisma.longState.findMany()];
                    case 1:
                        states = _a.sent();
                        return [2 /*return*/, states.map(function (state) { return ({
                                coinId: state.coinId,
                                h12High: state.h12High || undefined,
                                h24High: state.h24High || undefined,
                                h72High: state.h72High || undefined,
                                h12Low: state.h12Low || undefined,
                                h24Low: state.h24Low || undefined,
                                h72Low: state.h72Low || undefined,
                                v12Sum: state.v12Sum || undefined,
                                v24Sum: state.v24Sum || undefined,
                                lastPrice: state.lastPrice || undefined,
                                lastMcap: state.lastMcap || undefined,
                                lastUpdatedUtc: state.lastUpdatedUtc,
                                lastRetraceFireUtc: state.lastRetraceFireUtc || undefined,
                                lastStallFireUtc: state.lastStallFireUtc || undefined,
                                lastBreakoutFireUtc: state.lastBreakoutFireUtc || undefined,
                                lastMcapFireUtc: state.lastMcapFireUtc || undefined
                            }); })];
                }
            });
        });
    };
    DatabaseService.prototype.getScheduleConfig = function () {
        return __awaiter(this, void 0, void 0, function () {
            var config;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.prisma.scheduleCfg.findUnique({
                            where: { cfgId: 1 }
                        })];
                    case 1:
                        config = _a.sent();
                        if (!config) {
                            throw new Error('Schedule configuration not found');
                        }
                        return [2 /*return*/, {
                                anchorTimesLocal: config.anchorTimesLocal,
                                anchorPeriodHours: config.anchorPeriodHours,
                                longCheckpointHours: config.longCheckpointHours,
                                hotIntervalMinutes: config.hotIntervalMinutes,
                                cooldownHours: config.cooldownHours,
                                hysteresisPct: config.hysteresisPct,
                                globalRetraceOn: config.globalRetraceOn,
                                globalStallOn: config.globalStallOn,
                                globalBreakoutOn: config.globalBreakoutOn,
                                globalMcapOn: config.globalMcapOn
                            }];
                }
            });
        });
    };
    DatabaseService.prototype.updateTriggerConfig = function (symbol, config) {
        return __awaiter(this, void 0, void 0, function () {
            var coin;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.prisma.coin.findFirst({
                            where: { symbol: symbol },
                            include: { longWatch: true }
                        })];
                    case 1:
                        coin = _a.sent();
                        if (!coin || !coin.longWatch) {
                            return [2 /*return*/, false];
                        }
                        return [4 /*yield*/, this.prisma.longWatch.update({
                                where: { coinId: coin.coinId },
                                data: config
                            })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, true];
                }
            });
        });
    };
    DatabaseService.prototype.updateGlobalTriggerSettings = function (settings) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.prisma.scheduleCfg.update({
                            where: { cfgId: 1 },
                            data: settings
                        })];
                    case 1:
                        _a.sent();
                        logger_1.logger.info('Global trigger settings updated:', settings);
                        return [2 /*return*/];
                }
            });
        });
    };
    DatabaseService.prototype.getAllRecentAlerts = function () {
        return __awaiter(this, arguments, void 0, function (limit) {
            var alerts, error_3;
            if (limit === void 0) { limit = 50; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.prisma.alertHistory.findMany({
                                include: {
                                    hotEntry: true,
                                    coin: true
                                },
                                orderBy: { tsUtc: 'desc' },
                                take: limit,
                            })];
                    case 1:
                        alerts = _a.sent();
                        return [2 /*return*/, alerts.map(function (alert) {
                                var _a, _b;
                                var payload = JSON.parse(alert.payloadJson);
                                return {
                                    symbol: ((_a = alert.hotEntry) === null || _a === void 0 ? void 0 : _a.symbol) || ((_b = alert.coin) === null || _b === void 0 ? void 0 : _b.symbol) || 'Unknown',
                                    kind: alert.kind,
                                    message: payload.message,
                                    timestamp: alert.tsUtc,
                                    source: alert.hotId ? 'hot' : 'long'
                                };
                            })];
                    case 2:
                        error_3 = _a.sent();
                        logger_1.logger.error('Failed to get all recent alerts:', error_3);
                        throw error_3;
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    DatabaseService.prototype.disconnect = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                // Disconnection handled by DatabaseManager
                logger_1.logger.info('DatabaseService disconnected');
                return [2 /*return*/];
            });
        });
    };
    return DatabaseService;
}());
exports.DatabaseService = DatabaseService;
