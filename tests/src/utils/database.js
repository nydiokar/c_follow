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
exports.DatabaseManager = void 0;
var client_1 = require("@prisma/client");
var logger_1 = require("./logger");
// Configuration constants - keep in sync with scheduler!
var HOT_LIST_CHECK_INTERVAL_MINUTES = 1; // Change this to whatever you want!
var DatabaseManager = /** @class */ (function () {
    function DatabaseManager() {
    }
    DatabaseManager.getInstance = function () {
        if (!this.instance) {
            this.instance = new client_1.PrismaClient({
                log: [
                    { emit: 'event', level: 'query' },
                    { emit: 'event', level: 'error' },
                    { emit: 'event', level: 'info' },
                    { emit: 'event', level: 'warn' }
                ],
                datasources: {
                    db: {
                        url: process.env.DATABASE_URL || 'file:./dev.db'
                    }
                }
            });
            // Note: Prisma event handlers commented out due to type issues
            // this.instance.$on('error', (e) => {
            //   logger.error('Prisma error:', e);
            // });
            // if (process.env.NODE_ENV === 'development') {
            //   this.instance.$on('query', (e) => {
            //     logger.debug(`Query: ${e.query} Params: ${e.params} Duration: ${e.duration}ms`);
            //   });
            // }
        }
        return this.instance;
    };
    DatabaseManager.initialize = function () {
        return __awaiter(this, arguments, void 0, function (retries, delay) {
            var i, prisma, error_1, error_2;
            if (retries === void 0) { retries = 3; }
            if (delay === void 0) { delay = 2000; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.isInitialized)
                            return [2 /*return*/];
                        i = 0;
                        _a.label = 1;
                    case 1:
                        if (!(i < retries)) return [3 /*break*/, 17];
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 12, , 16]);
                        prisma = this.getInstance();
                        return [4 /*yield*/, prisma.$connect()];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4:
                        _a.trys.push([4, 6, , 7]);
                        return [4 /*yield*/, prisma.$queryRaw(templateObject_1 || (templateObject_1 = __makeTemplateObject(["PRAGMA journal_mode=WAL"], ["PRAGMA journal_mode=WAL"])))];
                    case 5:
                        _a.sent();
                        logger_1.logger.info('WAL mode enabled');
                        return [3 /*break*/, 7];
                    case 6:
                        error_1 = _a.sent();
                        logger_1.logger.warn('Could not enable WAL mode, continuing with default:', error_1);
                        return [3 /*break*/, 7];
                    case 7: return [4 /*yield*/, prisma.$executeRaw(templateObject_2 || (templateObject_2 = __makeTemplateObject(["PRAGMA synchronous=NORMAL"], ["PRAGMA synchronous=NORMAL"])))];
                    case 8:
                        _a.sent();
                        return [4 /*yield*/, prisma.$executeRaw(templateObject_3 || (templateObject_3 = __makeTemplateObject(["PRAGMA temp_store=MEMORY"], ["PRAGMA temp_store=MEMORY"])))];
                    case 9:
                        _a.sent();
                        return [4 /*yield*/, prisma.$executeRaw(templateObject_4 || (templateObject_4 = __makeTemplateObject(["PRAGMA cache_size=10000"], ["PRAGMA cache_size=10000"])))];
                    case 10:
                        _a.sent();
                        return [4 /*yield*/, this.ensureDefaultConfig()];
                    case 11:
                        _a.sent();
                        this.isInitialized = true;
                        logger_1.logger.info('Database initialized successfully with optimized settings');
                        return [2 /*return*/]; // Success, exit the loop
                    case 12:
                        error_2 = _a.sent();
                        logger_1.logger.error("Failed to initialize database on attempt ".concat(i + 1, "/").concat(retries, ":"), error_2);
                        if (!(i < retries - 1)) return [3 /*break*/, 14];
                        logger_1.logger.info("Retrying in ".concat(delay / 1000, " seconds..."));
                        return [4 /*yield*/, new Promise(function (res) { return setTimeout(res, delay); })];
                    case 13:
                        _a.sent();
                        return [3 /*break*/, 15];
                    case 14:
                        logger_1.logger.error('All database initialization attempts failed.');
                        throw error_2;
                    case 15: return [3 /*break*/, 16];
                    case 16:
                        i++;
                        return [3 /*break*/, 1];
                    case 17: return [2 /*return*/];
                }
            });
        });
    };
    DatabaseManager.ensureDefaultConfig = function () {
        return __awaiter(this, void 0, void 0, function () {
            var prisma, existingConfig;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        prisma = this.getInstance();
                        return [4 /*yield*/, prisma.scheduleCfg.findUnique({
                                where: { cfgId: 1 }
                            })];
                    case 1:
                        existingConfig = _a.sent();
                        if (!!existingConfig) return [3 /*break*/, 3];
                        return [4 /*yield*/, prisma.scheduleCfg.create({
                                data: {
                                    cfgId: 1,
                                    anchorTimesLocal: '08:00,20:00',
                                    anchorPeriodHours: 12,
                                    longCheckpointHours: 6,
                                    hotIntervalMinutes: 1,
                                    cooldownHours: 2.0,
                                    hysteresisPct: 30.0
                                }
                            })];
                    case 2:
                        _a.sent();
                        logger_1.logger.info('Created default schedule configuration');
                        _a.label = 3;
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    DatabaseManager.disconnect = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.instance) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.instance.$disconnect()];
                    case 1:
                        _a.sent();
                        this.instance = null;
                        this.isInitialized = false;
                        logger_1.logger.info('Database disconnected');
                        _a.label = 2;
                    case 2: return [2 /*return*/];
                }
            });
        });
    };
    DatabaseManager.healthCheck = function () {
        return __awaiter(this, void 0, void 0, function () {
            var start, latency, error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        start = Date.now();
                        return [4 /*yield*/, this.getInstance().$queryRaw(templateObject_5 || (templateObject_5 = __makeTemplateObject(["SELECT 1"], ["SELECT 1"])))];
                    case 1:
                        _a.sent();
                        latency = Date.now() - start;
                        return [2 /*return*/, { healthy: true, latency: latency }];
                    case 2:
                        error_3 = _a.sent();
                        return [2 /*return*/, {
                                healthy: false,
                                latency: -1,
                                error: error_3 instanceof Error ? error_3.message : 'Unknown error'
                            }];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    DatabaseManager.instance = null;
    DatabaseManager.isInitialized = false;
    return DatabaseManager;
}());
exports.DatabaseManager = DatabaseManager;
var templateObject_1, templateObject_2, templateObject_3, templateObject_4, templateObject_5;
