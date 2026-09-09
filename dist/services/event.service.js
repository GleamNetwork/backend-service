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
exports.EventService = void 0;
const common_1 = require("@nestjs/common");
const database_module_1 = require("../database.module");
let EventService = class EventService {
    database;
    constructor(database) {
        this.database = database;
    }
    async publish(input) {
        const sql = `
      INSERT INTO events
      (event_type, aggregate_type, aggregate_id, audience_type, audience_id, payload, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))
    `;
        const values = [
            input.eventType,
            input.aggregateType,
            input.aggregateId,
            input.audienceType,
            input.audienceId ?? null,
            JSON.stringify(input.payload ?? {}),
        ];
        if (input.connection) {
            const [result] = await input.connection.query(sql, values);
            return result.insertId;
        }
        const [result] = await this.database.query(sql, values);
        return result.insertId;
    }
    async listForAudience(audienceType, audienceId, afterEventId = 0, limit = 50) {
        const [rows] = await this.database.query(`SELECT * FROM events
       WHERE audience_type = ? AND audience_id = ? AND id > ?
       ORDER BY id ASC LIMIT ?`, [audienceType, audienceId, afterEventId, Math.min(limit, 200)]);
        return rows;
    }
    async listGlobal(afterEventId = 0, limit = 50) {
        const [rows] = await this.database.query(`SELECT * FROM events
       WHERE (audience_type = 'all' OR audience_type = 'district')
         AND id > ?
       ORDER BY id ASC LIMIT ?`, [afterEventId, Math.min(limit, 200)]);
        return rows;
    }
};
exports.EventService = EventService;
exports.EventService = EventService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object])
], EventService);
//# sourceMappingURL=event.service.js.map