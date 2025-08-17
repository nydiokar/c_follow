"use strict";
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
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
exports.RollingWindowManager = void 0;
var database_1 = require("../utils/database");
var logger_1 = require("../utils/logger");
var RollingWindowManager = /** @class */ (function () {
    function RollingWindowManager() {
        this.CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
        this.cleanupTimer = undefined;
        this.startCleanupTimer();
    }
    RollingWindowManager.prototype.startCleanupTimer = function () {
        var _this = this;
        this.cleanupTimer = setInterval(function () {
            _this.cleanupOldData().catch(function (error) {
                logger_1.logger.error('Failed to cleanup old rolling window data:', error);
            });
        }, this.CLEANUP_INTERVAL);
    };
    RollingWindowManager.prototype.addDataPoint = function (coinId, dataPoint) {
        return __awaiter(this, void 0, void 0, function () {
            var prisma, stats, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        prisma = database_1.DatabaseManager.getInstance();
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 5, , 6]);
                        // Store the data point for rolling calculations
                        return [4 /*yield*/, prisma.$executeRaw(templateObject_1 || (templateObject_1 = __makeTemplateObject(["\n        INSERT INTO rolling_data_points (coin_id, timestamp, price, volume, market_cap)\n        VALUES (", ", ", ", ", ", ", ", ", ")\n      "], ["\n        INSERT INTO rolling_data_points (coin_id, timestamp, price, volume, market_cap)\n        VALUES (", ", ", ", ", ", ", ", ", ")\n      "])), coinId, dataPoint.timestamp, dataPoint.price, dataPoint.volume, dataPoint.marketCap)];
                    case 2:
                        // Store the data point for rolling calculations
                        _a.sent();
                        return [4 /*yield*/, this.calculateRollingStats(coinId, dataPoint.timestamp)];
                    case 3:
                        stats = _a.sent();
                        return [4 /*yield*/, this.updateLongState(coinId, dataPoint, stats)];
                    case 4:
                        _a.sent();
                        return [3 /*break*/, 6];
                    case 5:
                        error_1 = _a.sent();
                        logger_1.logger.error("Failed to add data point for coin ".concat(coinId, ":"), error_1);
                        throw error_1;
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    RollingWindowManager.prototype.calculateRollingStats = function (coinId, currentTime) {
        return __awaiter(this, void 0, void 0, function () {
            var prisma, h12Ago, h24Ago, h72Ago, _a, h12Stats, h24Stats, h72Stats, _b, v12Sum, v24Sum, stats, error_2;
            var _c, _d, _e, _f, _g, _h, _j, _k;
            return __generator(this, function (_l) {
                switch (_l.label) {
                    case 0:
                        prisma = database_1.DatabaseManager.getInstance();
                        h12Ago = currentTime - (12 * 60 * 60);
                        h24Ago = currentTime - (24 * 60 * 60);
                        h72Ago = currentTime - (72 * 60 * 60);
                        _l.label = 1;
                    case 1:
                        _l.trys.push([1, 4, , 5]);
                        return [4 /*yield*/, Promise.all([
                                prisma.$queryRaw(templateObject_2 || (templateObject_2 = __makeTemplateObject(["\n          SELECT MAX(price) as high, MIN(price) as low\n          FROM rolling_data_points \n          WHERE coin_id = ", " AND timestamp >= ", "\n        "], ["\n          SELECT MAX(price) as high, MIN(price) as low\n          FROM rolling_data_points \n          WHERE coin_id = ", " AND timestamp >= ", "\n        "])), coinId, h12Ago),
                                prisma.$queryRaw(templateObject_3 || (templateObject_3 = __makeTemplateObject(["\n          SELECT MAX(price) as high, MIN(price) as low\n          FROM rolling_data_points \n          WHERE coin_id = ", " AND timestamp >= ", "\n        "], ["\n          SELECT MAX(price) as high, MIN(price) as low\n          FROM rolling_data_points \n          WHERE coin_id = ", " AND timestamp >= ", "\n        "])), coinId, h24Ago),
                                prisma.$queryRaw(templateObject_4 || (templateObject_4 = __makeTemplateObject(["\n          SELECT MAX(price) as high, MIN(price) as low\n          FROM rolling_data_points \n          WHERE coin_id = ", " AND timestamp >= ", "\n        "], ["\n          SELECT MAX(price) as high, MIN(price) as low\n          FROM rolling_data_points \n          WHERE coin_id = ", " AND timestamp >= ", "\n        "])), coinId, h72Ago)
                            ])];
                    case 2:
                        _a = _l.sent(), h12Stats = _a[0], h24Stats = _a[1], h72Stats = _a[2];
                        return [4 /*yield*/, Promise.all([
                                prisma.$queryRaw(templateObject_5 || (templateObject_5 = __makeTemplateObject(["\n          SELECT SUM(volume) as total\n          FROM rolling_data_points \n          WHERE coin_id = ", " AND timestamp >= ", "\n        "], ["\n          SELECT SUM(volume) as total\n          FROM rolling_data_points \n          WHERE coin_id = ", " AND timestamp >= ", "\n        "])), coinId, h12Ago),
                                prisma.$queryRaw(templateObject_6 || (templateObject_6 = __makeTemplateObject(["\n          SELECT SUM(volume) as total\n          FROM rolling_data_points \n          WHERE coin_id = ", " AND timestamp >= ", "\n        "], ["\n          SELECT SUM(volume) as total\n          FROM rolling_data_points \n          WHERE coin_id = ", " AND timestamp >= ", "\n        "])), coinId, h24Ago)
                            ])];
                    case 3:
                        _b = _l.sent(), v12Sum = _b[0], v24Sum = _b[1];
                        stats = {};
                        if ((_c = h12Stats[0]) === null || _c === void 0 ? void 0 : _c.high)
                            stats.h12High = h12Stats[0].high;
                        if ((_d = h12Stats[0]) === null || _d === void 0 ? void 0 : _d.low)
                            stats.h12Low = h12Stats[0].low;
                        if ((_e = h24Stats[0]) === null || _e === void 0 ? void 0 : _e.high)
                            stats.h24High = h24Stats[0].high;
                        if ((_f = h24Stats[0]) === null || _f === void 0 ? void 0 : _f.low)
                            stats.h24Low = h24Stats[0].low;
                        if ((_g = h72Stats[0]) === null || _g === void 0 ? void 0 : _g.high)
                            stats.h72High = h72Stats[0].high;
                        if ((_h = h72Stats[0]) === null || _h === void 0 ? void 0 : _h.low)
                            stats.h72Low = h72Stats[0].low;
                        if ((_j = v12Sum[0]) === null || _j === void 0 ? void 0 : _j.total)
                            stats.v12Sum = v12Sum[0].total;
                        if ((_k = v24Sum[0]) === null || _k === void 0 ? void 0 : _k.total)
                            stats.v24Sum = v24Sum[0].total;
                        return [2 /*return*/, stats];
                    case 4:
                        error_2 = _l.sent();
                        logger_1.logger.error("Failed to calculate rolling stats for coin ".concat(coinId, ":"), error_2);
                        throw error_2;
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    RollingWindowManager.prototype.updateLongState = function (coinId, dataPoint, stats) {
        return __awaiter(this, void 0, void 0, function () {
            var prisma, error_3;
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
            return __generator(this, function (_u) {
                switch (_u.label) {
                    case 0:
                        prisma = database_1.DatabaseManager.getInstance();
                        _u.label = 1;
                    case 1:
                        _u.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, prisma.longState.upsert({
                                where: { coinId: coinId },
                                update: {
                                    lastPrice: dataPoint.price,
                                    lastMcap: (_a = dataPoint.marketCap) !== null && _a !== void 0 ? _a : null,
                                    h12High: (_b = stats.h12High) !== null && _b !== void 0 ? _b : null,
                                    h24High: (_c = stats.h24High) !== null && _c !== void 0 ? _c : null,
                                    h72High: (_d = stats.h72High) !== null && _d !== void 0 ? _d : null,
                                    h12Low: (_e = stats.h12Low) !== null && _e !== void 0 ? _e : null,
                                    h24Low: (_f = stats.h24Low) !== null && _f !== void 0 ? _f : null,
                                    h72Low: (_g = stats.h72Low) !== null && _g !== void 0 ? _g : null,
                                    v12Sum: (_h = stats.v12Sum) !== null && _h !== void 0 ? _h : null,
                                    v24Sum: (_j = stats.v24Sum) !== null && _j !== void 0 ? _j : null,
                                    lastUpdatedUtc: dataPoint.timestamp
                                },
                                create: {
                                    coinId: coinId,
                                    lastPrice: dataPoint.price,
                                    lastMcap: (_k = dataPoint.marketCap) !== null && _k !== void 0 ? _k : null,
                                    h12High: (_l = stats.h12High) !== null && _l !== void 0 ? _l : null,
                                    h24High: (_m = stats.h24High) !== null && _m !== void 0 ? _m : null,
                                    h72High: (_o = stats.h72High) !== null && _o !== void 0 ? _o : null,
                                    h12Low: (_p = stats.h12Low) !== null && _p !== void 0 ? _p : null,
                                    h24Low: (_q = stats.h24Low) !== null && _q !== void 0 ? _q : null,
                                    h72Low: (_r = stats.h72Low) !== null && _r !== void 0 ? _r : null,
                                    v12Sum: (_s = stats.v12Sum) !== null && _s !== void 0 ? _s : null,
                                    v24Sum: (_t = stats.v24Sum) !== null && _t !== void 0 ? _t : null,
                                    lastUpdatedUtc: dataPoint.timestamp
                                }
                            })];
                    case 2:
                        _u.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        error_3 = _u.sent();
                        logger_1.logger.error("Failed to update long state for coin ".concat(coinId, ":"), error_3);
                        throw error_3;
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    RollingWindowManager.prototype.backfillData = function (coinId, historicalData) {
        return __awaiter(this, void 0, void 0, function () {
            var sortedData, _i, sortedData_1, dataPoint;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        logger_1.logger.info("Starting backfill for coin ".concat(coinId, " with ").concat(historicalData.length, " data points"));
                        sortedData = historicalData.sort(function (a, b) { return a.timestamp - b.timestamp; });
                        _i = 0, sortedData_1 = sortedData;
                        _a.label = 1;
                    case 1:
                        if (!(_i < sortedData_1.length)) return [3 /*break*/, 4];
                        dataPoint = sortedData_1[_i];
                        return [4 /*yield*/, this.addDataPoint(coinId, dataPoint)];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        _i++;
                        return [3 /*break*/, 1];
                    case 4:
                        logger_1.logger.info("Completed backfill for coin ".concat(coinId));
                        return [2 /*return*/];
                }
            });
        });
    };
    RollingWindowManager.prototype.cleanupOldData = function () {
        return __awaiter(this, void 0, void 0, function () {
            var prisma, cutoffTime, result, error_4;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        prisma = database_1.DatabaseManager.getInstance();
                        cutoffTime = Math.floor(Date.now() / 1000) - (73 * 60 * 60);
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, prisma.$executeRaw(templateObject_7 || (templateObject_7 = __makeTemplateObject(["\n        DELETE FROM rolling_data_points \n        WHERE timestamp < ", "\n      "], ["\n        DELETE FROM rolling_data_points \n        WHERE timestamp < ", "\n      "])), cutoffTime)];
                    case 2:
                        result = _a.sent();
                        logger_1.logger.debug("Cleaned up ".concat(result, " old rolling window data points"));
                        return [3 /*break*/, 4];
                    case 3:
                        error_4 = _a.sent();
                        logger_1.logger.error('Failed to cleanup old rolling window data:', error_4);
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    RollingWindowManager.prototype.getDataPointsCount = function (coinId) {
        return __awaiter(this, void 0, void 0, function () {
            var prisma, result;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        prisma = database_1.DatabaseManager.getInstance();
                        return [4 /*yield*/, prisma.$queryRaw(templateObject_8 || (templateObject_8 = __makeTemplateObject(["\n      SELECT COUNT(*) as count\n      FROM rolling_data_points \n      WHERE coin_id = ", "\n    "], ["\n      SELECT COUNT(*) as count\n      FROM rolling_data_points \n      WHERE coin_id = ", "\n    "])), coinId)];
                    case 1:
                        result = _b.sent();
                        return [2 /*return*/, ((_a = result[0]) === null || _a === void 0 ? void 0 : _a.count) || 0];
                }
            });
        });
    };
    RollingWindowManager.prototype.isWarmupComplete = function (coinId_1) {
        return __awaiter(this, arguments, void 0, function (coinId, requiredHours) {
            var prisma, requiredTime, result, earliestTimestamp;
            var _a;
            if (requiredHours === void 0) { requiredHours = 72; }
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        prisma = database_1.DatabaseManager.getInstance();
                        requiredTime = Math.floor(Date.now() / 1000) - (requiredHours * 60 * 60);
                        return [4 /*yield*/, prisma.$queryRaw(templateObject_9 || (templateObject_9 = __makeTemplateObject(["\n      SELECT MIN(timestamp) as earliest\n      FROM rolling_data_points \n      WHERE coin_id = ", "\n    "], ["\n      SELECT MIN(timestamp) as earliest\n      FROM rolling_data_points \n      WHERE coin_id = ", "\n    "])), coinId)];
                    case 1:
                        result = _b.sent();
                        earliestTimestamp = (_a = result[0]) === null || _a === void 0 ? void 0 : _a.earliest;
                        return [2 /*return*/, earliestTimestamp ? earliestTimestamp <= requiredTime : false];
                }
            });
        });
    };
    RollingWindowManager.prototype.getSumVolume = function (coinId, startTime, endTime) {
        return __awaiter(this, void 0, void 0, function () {
            var prisma, result;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        prisma = database_1.DatabaseManager.getInstance();
                        return [4 /*yield*/, prisma.$queryRaw(templateObject_10 || (templateObject_10 = __makeTemplateObject(["\n      SELECT SUM(volume) as total\n      FROM rolling_data_points \n      WHERE coin_id = ", " AND timestamp >= ", " AND timestamp <= ", "\n    "], ["\n      SELECT SUM(volume) as total\n      FROM rolling_data_points \n      WHERE coin_id = ", " AND timestamp >= ", " AND timestamp <= ", "\n    "])), coinId, startTime, endTime)];
                    case 1:
                        result = _b.sent();
                        return [2 /*return*/, ((_a = result[0]) === null || _a === void 0 ? void 0 : _a.total) || 0];
                }
            });
        });
    };
    RollingWindowManager.prototype.stop = function () {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
    };
    return RollingWindowManager;
}());
exports.RollingWindowManager = RollingWindowManager;
var templateObject_1, templateObject_2, templateObject_3, templateObject_4, templateObject_5, templateObject_6, templateObject_7, templateObject_8, templateObject_9, templateObject_10;
