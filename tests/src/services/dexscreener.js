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
exports.DexScreenerService = void 0;
var axios_1 = require("axios");
var logger_1 = require("../utils/logger");
var RateLimiter = /** @class */ (function () {
    function RateLimiter(maxRequests, timeWindowMs) {
        this.requests = [];
        this.maxRequests = maxRequests;
        this.timeWindow = timeWindowMs;
    }
    RateLimiter.prototype.canMakeRequest = function () {
        var _this = this;
        var now = Date.now();
        this.requests = this.requests.filter(function (time) { return now - time < _this.timeWindow; });
        return this.requests.length < this.maxRequests;
    };
    RateLimiter.prototype.recordRequest = function () {
        this.requests.push(Date.now());
    };
    RateLimiter.prototype.getNextAvailableTime = function () {
        if (this.canMakeRequest())
            return 0;
        var now = Date.now();
        var oldestRequest = this.requests[0];
        return oldestRequest ? oldestRequest + this.timeWindow - now : 0;
    };
    return RateLimiter;
}());
var DexScreenerService = /** @class */ (function () {
    function DexScreenerService(rateLimitMs) {
        if (rateLimitMs === void 0) { rateLimitMs = 200; }
        var _this = this;
        this.baseURL = 'https://api.dexscreener.com';
        this.client = axios_1.default.create({
            baseURL: this.baseURL,
            timeout: 10000,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'follow-coin-bot/1.0.0'
            }
        });
        this.rateLimiter = new RateLimiter(300, 60000);
        this.client.interceptors.request.use(function (config) { return __awaiter(_this, void 0, void 0, function () {
            var _loop_1, this_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _loop_1 = function () {
                            var waitTime;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        waitTime = this_1.rateLimiter.getNextAvailableTime();
                                        if (!(waitTime > 0)) return [3 /*break*/, 2];
                                        logger_1.logger.debug("Rate limit reached, waiting ".concat(waitTime, "ms"));
                                        return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, Math.min(waitTime, rateLimitMs)); })];
                                    case 1:
                                        _b.sent();
                                        _b.label = 2;
                                    case 2: return [2 /*return*/];
                                }
                            });
                        };
                        this_1 = this;
                        _a.label = 1;
                    case 1:
                        if (!!this.rateLimiter.canMakeRequest()) return [3 /*break*/, 3];
                        return [5 /*yield**/, _loop_1()];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 1];
                    case 3:
                        this.rateLimiter.recordRequest();
                        return [2 /*return*/, config];
                }
            });
        }); });
        this.client.interceptors.response.use(function (response) { return response; }, function (error) {
            var _a, _b;
            logger_1.logger.error('DexScreener API error:', {
                url: (_a = error.config) === null || _a === void 0 ? void 0 : _a.url,
                status: (_b = error.response) === null || _b === void 0 ? void 0 : _b.status,
                message: error.message
            });
            return Promise.reject(error);
        });
    }
    DexScreenerService.prototype.getPairsByChain = function (chainId, tokenAddresses) {
        return __awaiter(this, void 0, void 0, function () {
            var addressParam, url, response, pairs, error_1;
            var _this = this;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (tokenAddresses.length === 0)
                            return [2 /*return*/, []];
                        addressParam = tokenAddresses.join(',');
                        url = "/tokens/v1/".concat(chainId, "/").concat(addressParam);
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        logger_1.logger.info("Fetching pairs for chain ".concat(chainId), { addresses: addressParam });
                        return [4 /*yield*/, this.client.get(url)];
                    case 2:
                        response = _b.sent();
                        pairs = Array.isArray(response.data) ? response.data : (_a = response.data) === null || _a === void 0 ? void 0 : _a.pairs;
                        if (!pairs || pairs.length === 0) {
                            logger_1.logger.warn("No pairs returned for chain ".concat(chainId, ", addresses: ").concat(addressParam));
                            return [2 /*return*/, []];
                        }
                        logger_1.logger.debug("Received ".concat(pairs.length, " pairs from API"), { pairs: pairs });
                        return [2 /*return*/, pairs.map(function (pair) { return _this.transformPairData(pair); })];
                    case 3:
                        error_1 = _b.sent();
                        logger_1.logger.error("Failed to fetch pairs for chain ".concat(chainId, ":"), { error: error_1, addresses: addressParam });
                        throw new Error("Failed to fetch pair data: ".concat(error_1));
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    DexScreenerService.prototype.searchPairs = function (query) {
        return __awaiter(this, void 0, void 0, function () {
            var response, pairs, error_2;
            var _this = this;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        this.rateLimiter.recordRequest();
                        return [4 /*yield*/, this.client.get("/dex/search/?q=".concat(encodeURIComponent(query)))];
                    case 1:
                        response = _b.sent();
                        pairs = response.data.pairs;
                        logger_1.logger.info("Found ".concat((pairs === null || pairs === void 0 ? void 0 : pairs.length) || 0, " pairs for query \"").concat(query, "\""), { query: query });
                        if (!pairs) {
                            logger_1.logger.info("No pairs found for query: ".concat(query));
                            return [2 /*return*/, []];
                        }
                        return [2 /*return*/, ((_a = response.data.pairs) === null || _a === void 0 ? void 0 : _a.map(function (pair) { return _this.transformPairData(pair); })) || []];
                    case 2:
                        error_2 = _b.sent();
                        logger_1.logger.error("Failed to search pairs for query ".concat(query, ":"), error_2);
                        throw new Error("Failed to search pairs: ".concat(error_2));
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    DexScreenerService.prototype.getPairInfo = function (chainId, tokenAddress) {
        return __awaiter(this, void 0, void 0, function () {
            var pairs;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.getPairsByChain(chainId, [tokenAddress])];
                    case 1:
                        pairs = _a.sent();
                        return [2 /*return*/, pairs.length > 0 && pairs[0] ? pairs[0] : null];
                }
            });
        });
    };
    DexScreenerService.prototype.transformPairData = function (pair) {
        var _a, _b, _c;
        var price = parseFloat(pair.priceUsd || '0');
        var marketCap = pair.marketCap || pair.fdv || null;
        var volume24h = ((_a = pair.volume) === null || _a === void 0 ? void 0 : _a.h24) || 0;
        var priceChange24h = ((_b = pair.priceChange) === null || _b === void 0 ? void 0 : _b.h24) || 0;
        var liquidity = ((_c = pair.liquidity) === null || _c === void 0 ? void 0 : _c.usd) || null;
        if (price <= 0) {
            logger_1.logger.warn("Invalid price for pair ".concat(pair.tokenAddress, ": ").concat(price));
        }
        return {
            chainId: pair.chainId,
            tokenAddress: pair.baseToken.address,
            symbol: pair.baseToken.symbol,
            name: pair.baseToken.name,
            price: price,
            marketCap: marketCap,
            volume24h: volume24h,
            priceChange24h: priceChange24h,
            liquidity: liquidity,
            info: pair.info,
            lastUpdated: Date.now()
        };
    };
    DexScreenerService.prototype.validatePairData = function (pairInfo) {
        if (!pairInfo.price || pairInfo.price <= 0) {
            logger_1.logger.warn("Invalid price for ".concat(pairInfo.symbol, ": ").concat(pairInfo.price));
            return false;
        }
        if (pairInfo.volume24h < 0) {
            logger_1.logger.warn("Invalid volume for ".concat(pairInfo.symbol, ": ").concat(pairInfo.volume24h));
            return false;
        }
        var priceChangeAbs = Math.abs(pairInfo.priceChange24h);
        if (priceChangeAbs > 95) {
            logger_1.logger.warn("Suspicious price change for ".concat(pairInfo.symbol, ": ").concat(pairInfo.priceChange24h, "%"));
            return false;
        }
        return true;
    };
    DexScreenerService.prototype.batchGetTokens = function (requests) {
        return __awaiter(this, void 0, void 0, function () {
            var results, chainGroups, _i, requests_1, req, addresses, _a, chainGroups_1, _b, chainId, tokenAddresses, pairs, bestByToken, _c, pairs_1, p, key, existing, existingScore, newScore, _d, tokenAddresses_1, tokenAddr, key, error_3, _e, tokenAddresses_2, tokenAddr, key;
            return __generator(this, function (_f) {
                switch (_f.label) {
                    case 0:
                        results = new Map();
                        chainGroups = new Map();
                        for (_i = 0, requests_1 = requests; _i < requests_1.length; _i++) {
                            req = requests_1[_i];
                            addresses = chainGroups.get(req.chainId) || [];
                            addresses.push(req.tokenAddress);
                            chainGroups.set(req.chainId, addresses);
                        }
                        _a = 0, chainGroups_1 = chainGroups;
                        _f.label = 1;
                    case 1:
                        if (!(_a < chainGroups_1.length)) return [3 /*break*/, 6];
                        _b = chainGroups_1[_a], chainId = _b[0], tokenAddresses = _b[1];
                        _f.label = 2;
                    case 2:
                        _f.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, this.getPairsByChain(chainId, tokenAddresses)];
                    case 3:
                        pairs = _f.sent();
                        bestByToken = new Map();
                        for (_c = 0, pairs_1 = pairs; _c < pairs_1.length; _c++) {
                            p = pairs_1[_c];
                            key = p.tokenAddress;
                            existing = bestByToken.get(key);
                            if (!existing) {
                                bestByToken.set(key, p);
                                continue;
                            }
                            existingScore = (existing.liquidity || 0) * 1000000 + existing.volume24h;
                            newScore = (p.liquidity || 0) * 1000000 + p.volume24h;
                            if (newScore > existingScore) {
                                bestByToken.set(key, p);
                            }
                        }
                        for (_d = 0, tokenAddresses_1 = tokenAddresses; _d < tokenAddresses_1.length; _d++) {
                            tokenAddr = tokenAddresses_1[_d];
                            key = "".concat(chainId, ":").concat(tokenAddr);
                            results.set(key, bestByToken.get(tokenAddr) || null);
                        }
                        return [3 /*break*/, 5];
                    case 4:
                        error_3 = _f.sent();
                        logger_1.logger.error("Failed to fetch batch for chain ".concat(chainId, ":"), error_3);
                        for (_e = 0, tokenAddresses_2 = tokenAddresses; _e < tokenAddresses_2.length; _e++) {
                            tokenAddr = tokenAddresses_2[_e];
                            key = "".concat(chainId, ":").concat(tokenAddr);
                            results.set(key, null);
                        }
                        return [3 /*break*/, 5];
                    case 5:
                        _a++;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/, results];
                }
            });
        });
    };
    return DexScreenerService;
}());
exports.DexScreenerService = DexScreenerService;
