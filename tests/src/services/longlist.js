"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
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
exports.LongListService = void 0;
var logger_1 = require("../utils/logger");
var alertBus_1 = require("../events/alertBus");
var formatters_1 = require("../utils/formatters");
var LongListTriggerEvaluator = /** @class */ (function () {
    function LongListTriggerEvaluator() {
    }
    LongListTriggerEvaluator.prototype.evaluateRetrace = function (state, config, currentPrice, cooldownHours) {
        if (!config.retraceOn || !state.h72High || currentPrice <= 0) {
            return false;
        }
        var now = Math.floor(Date.now() / 1000);
        var cooldownSeconds = cooldownHours * 3600;
        if (state.lastRetraceFireUtc && (now - state.lastRetraceFireUtc) < cooldownSeconds) {
            return false;
        }
        var retraceThreshold = state.h72High * (1 - config.retracePct / 100);
        return currentPrice <= retraceThreshold;
    };
    LongListTriggerEvaluator.prototype.evaluateStall = function (state, config, currentVolume, currentPrice, cooldownHours) {
        if (!config.stallOn || !state.v24Sum || !state.h12High || !state.h12Low) {
            return false;
        }
        var now = Math.floor(Date.now() / 1000);
        var cooldownSeconds = cooldownHours * 3600;
        if (state.lastStallFireUtc && (now - state.lastStallFireUtc) < cooldownSeconds) {
            return false;
        }
        var volumeDropped = currentVolume <= (state.v24Sum * (1 - config.stallVolPct / 100));
        var priceInBand = (state.h12High <= currentPrice * (1 + config.stallBandPct / 100) &&
            state.h12Low >= currentPrice * (1 - config.stallBandPct / 100));
        return volumeDropped && priceInBand;
    };
    LongListTriggerEvaluator.prototype.evaluateBreakout = function (state, config, currentPrice, currentVolume, cooldownHours) {
        if (!config.breakoutOn || !state.h12High || !state.v12Sum) {
            return false;
        }
        var now = Math.floor(Date.now() / 1000);
        var cooldownSeconds = cooldownHours * 3600;
        if (state.lastBreakoutFireUtc && (now - state.lastBreakoutFireUtc) < cooldownSeconds) {
            return false;
        }
        var priceBreakout = currentPrice >= (state.h12High * (1 + config.breakoutPct / 100));
        var volumeIncrease = currentVolume >= (state.v12Sum * config.breakoutVolX);
        return priceBreakout && volumeIncrease;
    };
    LongListTriggerEvaluator.prototype.evaluateMcap = function (state, config, currentMcap, cooldownHours) {
        if (!config.mcapOn || !config.mcapLevels || currentMcap <= 0) {
            return { triggered: false };
        }
        var now = Math.floor(Date.now() / 1000);
        var cooldownSeconds = cooldownHours * 3600;
        if (state.lastMcapFireUtc && (now - state.lastMcapFireUtc) < cooldownSeconds) {
            return { triggered: false };
        }
        var levels = config.mcapLevels.sort(function (a, b) { return a - b; });
        for (var _i = 0, levels_1 = levels; _i < levels_1.length; _i++) {
            var level = levels_1[_i];
            if (currentMcap >= level && (!state.lastMcap || state.lastMcap < level)) {
                return { triggered: true, level: level };
            }
        }
        return { triggered: false };
    };
    return LongListTriggerEvaluator;
}());
var LongListService = /** @class */ (function () {
    function LongListService(db, dexScreener, rollingWindow) {
        this.db = db;
        this.dexScreener = dexScreener;
        this.triggerEvaluator = new LongListTriggerEvaluator();
        this.rollingWindow = rollingWindow;
    }
    LongListService.prototype.addCoin = function (symbol_1) {
        return __awaiter(this, arguments, void 0, function (symbol, chainId) {
            var searchResults, chainPairs, pair, error_1;
            if (chainId === void 0) { chainId = 'solana'; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 3, , 4]);
                        return [4 /*yield*/, this.dexScreener.searchPairs(symbol)];
                    case 1:
                        searchResults = _a.sent();
                        if (searchResults.length === 0) {
                            throw new Error("No pairs found for symbol: ".concat(symbol));
                        }
                        chainPairs = searchResults.filter(function (p) { return p.chainId === chainId; });
                        pair = chainPairs.length > 0 ? chainPairs[0] : searchResults[0];
                        if (!pair || !this.dexScreener.validatePairData(pair)) {
                            throw new Error("Invalid pair data for ".concat(symbol));
                        }
                        return [4 /*yield*/, this.db.addCoinToLongList(pair.symbol, pair.chainId, pair.tokenAddress, pair.name)];
                    case 2:
                        _a.sent();
                        logger_1.logger.info("Added ".concat(symbol, " to long list"), {
                            symbol: pair.symbol,
                            chain: pair.chainId,
                            tokenAddress: pair.tokenAddress
                        });
                        return [2 /*return*/, true];
                    case 3:
                        error_1 = _a.sent();
                        logger_1.logger.error("Failed to add coin ".concat(symbol, " to long list:"), error_1);
                        throw error_1;
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    LongListService.prototype.removeCoin = function (symbol) {
        return __awaiter(this, void 0, void 0, function () {
            var result, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.db.removeCoinFromLongList(symbol)];
                    case 1:
                        result = _a.sent();
                        if (result) {
                            logger_1.logger.info("Removed ".concat(symbol, " from long list"));
                        }
                        return [2 /*return*/, result];
                    case 2:
                        error_2 = _a.sent();
                        logger_1.logger.error("Failed to remove coin ".concat(symbol, " from long list:"), error_2);
                        throw error_2;
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    LongListService.prototype.updateTriggerSettings = function (symbol, settings) {
        return __awaiter(this, void 0, void 0, function () {
            var updateData, result, error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        updateData = {};
                        if (settings.trigger && typeof settings.enabled !== 'undefined') {
                            switch (settings.trigger) {
                                case 'retrace':
                                    updateData.retraceOn = settings.enabled;
                                    break;
                                case 'stall':
                                    updateData.stallOn = settings.enabled;
                                    break;
                                case 'breakout':
                                    updateData.breakoutOn = settings.enabled;
                                    break;
                                case 'mcap':
                                    updateData.mcapOn = settings.enabled;
                                    break;
                            }
                        }
                        if (typeof settings.retracePct !== 'undefined') {
                            updateData.retracePct = settings.retracePct;
                        }
                        if (typeof settings.stallVolPct !== 'undefined') {
                            updateData.stallVolPct = settings.stallVolPct;
                        }
                        if (typeof settings.stallBandPct !== 'undefined') {
                            updateData.stallBandPct = settings.stallBandPct;
                        }
                        if (typeof settings.breakoutPct !== 'undefined') {
                            updateData.breakoutPct = settings.breakoutPct;
                        }
                        if (typeof settings.breakoutVolX !== 'undefined') {
                            updateData.breakoutVolX = settings.breakoutVolX;
                        }
                        if (settings.mcapLevels) {
                            updateData.mcapLevels = settings.mcapLevels.join(',');
                        }
                        return [4 /*yield*/, this.db.updateTriggerConfig(symbol, updateData)];
                    case 1:
                        result = _a.sent();
                        if (result) {
                            logger_1.logger.info("Updated trigger settings for ".concat(symbol), settings);
                        }
                        return [2 /*return*/, result];
                    case 2:
                        error_3 = _a.sent();
                        logger_1.logger.error("Failed to update trigger settings for ".concat(symbol, ":"), error_3);
                        throw error_3;
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    LongListService.prototype.checkTriggers = function () {
        return __awaiter(this, void 0, void 0, function () {
            var coins, states, config, pairRequests, pairData, stateMap, triggers, _i, coins_1, coin, key, pair, state, isWarmupComplete, triggerConfig, evaluatedTriggers, _a, evaluatedTriggers_1, trigger, error_4;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 17, , 18]);
                        return [4 /*yield*/, this.db.getLongListCoins()];
                    case 1:
                        coins = _b.sent();
                        return [4 /*yield*/, this.db.getLongStates()];
                    case 2:
                        states = _b.sent();
                        return [4 /*yield*/, this.db.getScheduleConfig()];
                    case 3:
                        config = _b.sent();
                        if (coins.length === 0) {
                            return [2 /*return*/, []];
                        }
                        pairRequests = coins.map(function (coin) { return ({
                            chainId: coin.chain,
                            tokenAddress: coin.tokenAddress
                        }); });
                        return [4 /*yield*/, this.dexScreener.batchGetTokens(pairRequests)];
                    case 4:
                        pairData = _b.sent();
                        stateMap = new Map(states.map(function (s) { return [s.coinId, s]; }));
                        triggers = [];
                        _i = 0, coins_1 = coins;
                        _b.label = 5;
                    case 5:
                        if (!(_i < coins_1.length)) return [3 /*break*/, 16];
                        coin = coins_1[_i];
                        key = "".concat(coin.chain, ":").concat(coin.tokenAddress);
                        pair = pairData.get(key);
                        state = stateMap.get(coin.coinId);
                        if (!pair || !state || !this.dexScreener.validatePairData(pair)) {
                            return [3 /*break*/, 15];
                        }
                        return [4 /*yield*/, this.rollingWindow.isWarmupComplete(coin.coinId, 12)];
                    case 6:
                        isWarmupComplete = _b.sent();
                        if (!!isWarmupComplete) return [3 /*break*/, 8];
                        logger_1.logger.info("Skipping triggers for ".concat(coin.symbol, " - warmup not complete"));
                        // Still update state data even if we skip triggers
                        return [4 /*yield*/, this.updateStateData(coin.coinId, pair, state)];
                    case 7:
                        // Still update state data even if we skip triggers
                        _b.sent();
                        return [3 /*break*/, 15];
                    case 8: return [4 /*yield*/, this.updateStateData(coin.coinId, pair, state)];
                    case 9:
                        _b.sent();
                        triggerConfig = {
                            retraceOn: coin.config.retraceOn && config.globalRetraceOn,
                            stallOn: coin.config.stallOn && config.globalStallOn,
                            breakoutOn: coin.config.breakoutOn && config.globalBreakoutOn,
                            mcapOn: coin.config.mcapOn && config.globalMcapOn,
                            retracePct: coin.config.retracePct,
                            stallVolPct: coin.config.stallVolPct,
                            stallBandPct: coin.config.stallBandPct,
                            breakoutPct: coin.config.breakoutPct,
                            breakoutVolX: coin.config.breakoutVolX,
                            mcapLevels: coin.config.mcapLevels ?
                                coin.config.mcapLevels.split(',').map(function (l) { return parseFloat(l); }).filter(function (l) { return !isNaN(l); }) :
                                []
                        };
                        evaluatedTriggers = this.evaluateAllTriggers(coin.coinId, coin.symbol, state, triggerConfig, pair, config.cooldownHours);
                        triggers.push.apply(triggers, evaluatedTriggers);
                        _a = 0, evaluatedTriggers_1 = evaluatedTriggers;
                        _b.label = 10;
                    case 10:
                        if (!(_a < evaluatedTriggers_1.length)) return [3 /*break*/, 15];
                        trigger = evaluatedTriggers_1[_a];
                        return [4 /*yield*/, this.db.recordTriggerFire(coin.coinId, trigger.triggerType)];
                    case 11:
                        _b.sent();
                        return [4 /*yield*/, this.db.recordLongTriggerAlert(coin.coinId, trigger)];
                    case 12:
                        _b.sent();
                        return [4 /*yield*/, alertBus_1.globalAlertBus.emitLongTrigger(trigger)];
                    case 13:
                        _b.sent();
                        _b.label = 14;
                    case 14:
                        _a++;
                        return [3 /*break*/, 10];
                    case 15:
                        _i++;
                        return [3 /*break*/, 5];
                    case 16:
                        logger_1.logger.info("Evaluated triggers for ".concat(coins.length, " coins, found ").concat(triggers.length, " alerts"));
                        return [2 /*return*/, triggers];
                    case 17:
                        error_4 = _b.sent();
                        logger_1.logger.error('Failed to check triggers:', error_4);
                        throw error_4;
                    case 18: return [2 /*return*/];
                }
            });
        });
    };
    LongListService.prototype.evaluateAllTriggers = function (coinId, symbol, state, config, pair, cooldownHours) {
        var triggers = [];
        if (this.triggerEvaluator.evaluateRetrace(state, config, pair.price, cooldownHours)) {
            var retracePercent = state.h72High ?
                ((state.h72High - pair.price) / state.h72High * 100) : 0;
            triggers.push({
                coinId: coinId,
                symbol: symbol,
                triggerType: 'retrace',
                message: "".concat(symbol, " retraced ").concat(retracePercent.toFixed(1), "% from 72h high"),
                price: pair.price,
                marketCap: pair.marketCap || 0,
                volume24h: pair.volume24h,
                priceChange24h: pair.priceChange24h,
                retraceFromHigh: retracePercent
            });
        }
        if (this.triggerEvaluator.evaluateStall(state, config, pair.volume24h, pair.price, cooldownHours)) {
            triggers.push({
                coinId: coinId,
                symbol: symbol,
                triggerType: 'stall',
                message: "".concat(symbol, " momentum stalled: volume down ").concat(config.stallVolPct, "%, price in ").concat(config.stallBandPct, "% band"),
                price: pair.price,
                marketCap: pair.marketCap || 0,
                volume24h: pair.volume24h,
                priceChange24h: pair.priceChange24h
            });
        }
        if (this.triggerEvaluator.evaluateBreakout(state, config, pair.price, pair.volume24h, cooldownHours)) {
            var breakoutPercent = state.h12High ?
                ((pair.price - state.h12High) / state.h12High * 100) : 0;
            triggers.push({
                coinId: coinId,
                symbol: symbol,
                triggerType: 'breakout',
                message: "".concat(symbol, " breakout: +").concat(breakoutPercent.toFixed(1), "% with ").concat(config.breakoutVolX, "x volume"),
                price: pair.price,
                marketCap: pair.marketCap || 0,
                volume24h: pair.volume24h,
                priceChange24h: pair.priceChange24h
            });
        }
        if (pair.marketCap) {
            var mcapResult = this.triggerEvaluator.evaluateMcap(state, config, pair.marketCap, cooldownHours);
            if (mcapResult.triggered && mcapResult.level) {
                triggers.push({
                    coinId: coinId,
                    symbol: symbol,
                    triggerType: 'mcap',
                    message: "".concat(symbol, " market cap reached ").concat(this.formatMarketCap(mcapResult.level)),
                    price: pair.price,
                    marketCap: pair.marketCap,
                    volume24h: pair.volume24h,
                    priceChange24h: pair.priceChange24h,
                    targetLevel: mcapResult.level
                });
            }
        }
        return triggers;
    };
    LongListService.prototype.updateStateData = function (coinId, pair, currentState) {
        return __awaiter(this, void 0, void 0, function () {
            var now, h12, h24, h72, dataPoints, hasHistory, newState, _a, error_5, updateData;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        now = Math.floor(Date.now() / 1000);
                        h12 = 12 * 3600;
                        h24 = 24 * 3600;
                        h72 = 72 * 3600;
                        return [4 /*yield*/, this.rollingWindow.getDataPointsCount(coinId)];
                    case 1:
                        dataPoints = _b.sent();
                        hasHistory = dataPoints > 0;
                        newState = {
                            h12High: currentState.h12High !== undefined ? Math.max(currentState.h12High, pair.price) : pair.price,
                            h24High: currentState.h24High !== undefined ? Math.max(currentState.h24High, pair.price) : pair.price,
                            h72High: currentState.h72High !== undefined ? Math.max(currentState.h72High, pair.price) : pair.price,
                            h12Low: currentState.h12Low !== undefined ? Math.min(currentState.h12Low, pair.price) : pair.price,
                            h24Low: currentState.h24Low !== undefined ? Math.min(currentState.h24Low, pair.price) : pair.price,
                            h72Low: currentState.h72Low !== undefined ? Math.min(currentState.h72Low, pair.price) : pair.price,
                        };
                        if (!hasHistory) return [3 /*break*/, 6];
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 4, , 5]);
                        _a = newState;
                        return [4 /*yield*/, this.rollingWindow.getSumVolume(coinId, now - h12, now)];
                    case 3:
                        _a.v12Sum = _b.sent();
                        newState.v24Sum = pair.volume24h; // Already 24h from API
                        return [3 /*break*/, 5];
                    case 4:
                        error_5 = _b.sent();
                        logger_1.logger.warn("Failed to get accurate volume data, using estimates for ".concat(coinId), error_5);
                        newState.v12Sum = pair.volume24h * 0.5; // Fallback
                        newState.v24Sum = pair.volume24h;
                        return [3 /*break*/, 5];
                    case 5: return [3 /*break*/, 7];
                    case 6:
                        // Initial data without history
                        newState.v12Sum = pair.volume24h * 0.5;
                        newState.v24Sum = pair.volume24h;
                        _b.label = 7;
                    case 7:
                        // Reset time period values if enough time has passed
                        if (currentState.lastUpdatedUtc && (now - currentState.lastUpdatedUtc) > h12) {
                            newState.h12High = pair.price;
                            newState.h12Low = pair.price;
                        }
                        if (currentState.lastUpdatedUtc && (now - currentState.lastUpdatedUtc) > h24) {
                            newState.h24High = pair.price;
                            newState.h24Low = pair.price;
                        }
                        if (currentState.lastUpdatedUtc && (now - currentState.lastUpdatedUtc) > h72) {
                            newState.h72High = pair.price;
                            newState.h72Low = pair.price;
                        }
                        updateData = __assign({ price: pair.price, volume24h: pair.volume24h }, newState);
                        if (pair.marketCap !== null) {
                            updateData.marketCap = pair.marketCap;
                        }
                        return [4 /*yield*/, this.db.updateLongState(coinId, updateData)];
                    case 8:
                        _b.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    LongListService.prototype.generateAnchorReport = function () {
        return __awaiter(this, void 0, void 0, function () {
            var coins, states, tokenRequests, tokenData, stateMap, reportData, _i, coins_2, coin, key, pair, state, retraceFrom72hHigh, error_6;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 4, , 5]);
                        return [4 /*yield*/, this.db.getLongListCoins()];
                    case 1:
                        coins = _a.sent();
                        return [4 /*yield*/, this.db.getLongStates()];
                    case 2:
                        states = _a.sent();
                        if (coins.length === 0) {
                            return [2 /*return*/, []];
                        }
                        tokenRequests = coins.map(function (coin) { return ({
                            chainId: coin.chain,
                            tokenAddress: coin.tokenAddress
                        }); });
                        return [4 /*yield*/, this.dexScreener.batchGetTokens(tokenRequests)];
                    case 3:
                        tokenData = _a.sent();
                        stateMap = new Map(states.map(function (s) { return [s.coinId, s]; }));
                        reportData = [];
                        for (_i = 0, coins_2 = coins; _i < coins_2.length; _i++) {
                            coin = coins_2[_i];
                            key = "".concat(coin.chain, ":").concat(coin.tokenAddress);
                            pair = tokenData.get(key);
                            state = stateMap.get(coin.coinId);
                            if (!pair || !state || !this.dexScreener.validatePairData(pair)) {
                                continue;
                            }
                            retraceFrom72hHigh = state.h72High ?
                                ((state.h72High - pair.price) / state.h72High * 100) : 0;
                            reportData.push({
                                symbol: pair.symbol,
                                price: pair.price,
                                change24h: pair.priceChange24h,
                                retraceFrom72hHigh: retraceFrom72hHigh,
                                volume24h: pair.volume24h
                            });
                        }
                        reportData.sort(function (a, b) { return b.retraceFrom72hHigh - a.retraceFrom72hHigh; });
                        return [2 /*return*/, reportData];
                    case 4:
                        error_6 = _a.sent();
                        logger_1.logger.error('Failed to generate anchor report:', error_6);
                        throw error_6;
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    LongListService.prototype.formatMarketCap = function (value) {
        return formatters_1.Formatters.formatMarketCap(value);
    };
    return LongListService;
}());
exports.LongListService = LongListService;
