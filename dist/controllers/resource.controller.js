"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourceController = void 0;
const common_1 = require("@nestjs/common");
const database_module_1 = require("../database.module");
const auth_1 = require("../auth");
const utils_1 = require("../utils");
let ResourceController = class ResourceController {
    database;
    constructor(database) {
        this.database = database;
    }
    async list(region = 'shanghai', category) {
        const rows = await this.database
            .query(category
            ? 'SELECT * FROM resources WHERE region = ? AND category = ? AND status = ? ORDER BY verified_at DESC'
            : 'SELECT * FROM resources WHERE region = ? AND status = ? ORDER BY verified_at DESC', category ? [region, category, 'verified'] : [region, 'verified'])
            .then(([rows]) => rows);
        return {
            items: rows.map((row) => ({
                id: row.id,
                name: row.name,
                category: row.category,
                region: row.region,
                contact: (0, utils_1.parseJsonField)(row.contact, {}),
                service_time: (0, utils_1.parseJsonField)(row.service_time, {}),
                service_target: row.service_target,
                fee_info: row.fee_info,
                official_source: row.official_source,
                verified_at: row.verified_at,
                status: row.status,
                limitations: row.limitations,
            })),
        };
    }
};
exports.ResourceController = ResourceController;
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)('region')),
    __param(1, (0, common_1.Query)('category')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ResourceController.prototype, "list", null);
exports.ResourceController = ResourceController = __decorate([
    (0, common_1.Controller)('resources'),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object])
], ResourceController);
//# sourceMappingURL=resource.controller.js.map