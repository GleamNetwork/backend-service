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
exports.EventController = void 0;
const common_1 = require("@nestjs/common");
const event_service_1 = require("../services/event.service");
const config_1 = require("../config");
let EventController = class EventController {
    events;
    constructor(events) {
        this.events = events;
    }
    async stream(request, response) {
        response.setHeader('Content-Type', 'text/event-stream');
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('Connection', 'keep-alive');
        response.setHeader('X-Accel-Buffering', 'no');
        response.flushHeaders?.();
        let lastEventId = Number(request.headers['last-event-id'] ?? 0);
        if (!Number.isFinite(lastEventId) || lastEventId < 0)
            lastEventId = 0;
        const timer = setInterval(async () => {
            try {
                const rows = await this.listForAuth(request, lastEventId, 50);
                for (const row of rows) {
                    lastEventId = Number(row.id);
                    response.write(`id: ${row.id}\n`);
                    response.write(`event: ${row.event_type}\n`);
                    response.write(`data: ${JSON.stringify({
                        id: row.id,
                        event: row.event_type,
                        aggregate_type: row.aggregate_type,
                        aggregate_id: row.aggregate_id,
                        payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
                        occurred_at: row.occurred_at,
                    })}\n\n`);
                }
            }
            catch {
                // Polling errors should not close the stream; frontend has /events/poll fallback.
            }
        }, config_1.config.eventPollIntervalMs);
        request.on('close', () => {
            clearInterval(timer);
            response.end();
        });
    }
    async poll(request, afterEventId = '0') {
        const rows = await this.listForAuth(request, Number(afterEventId) || 0, 50);
        return {
            events: rows.map((row) => ({
                id: row.id,
                event: row.event_type,
                aggregate_type: row.aggregate_type,
                aggregate_id: row.aggregate_id,
                payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
                occurred_at: row.occurred_at,
            })),
            next_after_event_id: rows.length ? Number(rows[rows.length - 1].id) : Number(afterEventId) || 0,
            has_more: rows.length === 50,
        };
    }
    async listForAuth(request, afterEventId, limit) {
        const auth = request.auth;
        if (!auth)
            return [];
        if (auth.role === 'user' && auth.userId) {
            return this.events.listForAudience('user', auth.userId, afterEventId, limit);
        }
        if (auth.staffId) {
            const rows = await this.events.listForAudience('staff', auth.staffId, afterEventId, limit);
            const districtRows = (auth.districtIds ?? []).length
                ? await Promise.all(auth.districtIds.map((districtId) => this.events.listForAudience('district', districtId, afterEventId, limit)))
                : [];
            return [...rows, ...districtRows.flat()].sort((a, b) => Number(a.id) - Number(b.id));
        }
        return this.events.listGlobal(afterEventId, limit);
    }
};
exports.EventController = EventController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], EventController.prototype, "stream", null);
__decorate([
    (0, common_1.Get)('poll'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('after_event_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], EventController.prototype, "poll", null);
exports.EventController = EventController = __decorate([
    (0, common_1.Controller)('events'),
    __param(0, (0, common_1.Inject)(event_service_1.EventService)),
    __metadata("design:paramtypes", [event_service_1.EventService])
], EventController);
//# sourceMappingURL=event.controller.js.map