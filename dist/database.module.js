"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseModule = exports.DATABASE = void 0;
exports.injectDatabase = injectDatabase;
const common_1 = require("@nestjs/common");
const promise_1 = __importDefault(require("mysql2/promise"));
const config_1 = require("./config");
exports.DATABASE = Symbol('DATABASE');
async function createDatabase() {
    return promise_1.default.createPool({
        host: config_1.config.db.host,
        port: config_1.config.db.port,
        user: config_1.config.db.user,
        password: config_1.config.db.password,
        database: config_1.config.db.database,
        connectionLimit: config_1.config.db.connectionLimit,
        connectTimeout: config_1.config.db.connectTimeout,
        charset: 'utf8mb4_0900_ai_ci',
        timezone: 'Z',
        namedPlaceholders: true,
        multipleStatements: false,
    });
}
const databaseProvider = {
    provide: exports.DATABASE,
    useFactory: async () => createDatabase(),
};
function injectDatabase() {
    return (target, propertyKey, parameterIndex) => {
        Reflect.defineMetadata('tongpin:database:index', parameterIndex, target, propertyKey ?? '');
    };
}
let DatabaseModule = class DatabaseModule {
};
exports.DatabaseModule = DatabaseModule;
exports.DatabaseModule = DatabaseModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [databaseProvider],
        exports: [databaseProvider],
    })
], DatabaseModule);
//# sourceMappingURL=database.module.js.map