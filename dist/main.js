"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const express_1 = __importDefault(require("express"));
const node_path_1 = __importDefault(require("node:path"));
const app_module_1 = require("./app.module");
const config_1 = require("./config");
async function bootstrap() {
    const app = await core_1.NestFactory.create(AppInstance(), {
        logger: ['error', 'warn', 'log'],
    });
    const origins = config_1.config.corsOrigins.includes('*') ? true : config_1.config.corsOrigins;
    app.enableCors({
        origin: origins,
        credentials: true,
        exposedHeaders: ['X-Request-Id'],
    });
    app.setGlobalPrefix(config_1.config.basePath.replace(/^\//, ''), {
        exclude: [`${config_1.config.basePath.replace(/^\//, '')}/docs`, `${config_1.config.basePath.replace(/^\//, '')}/docs/(.*)`],
    });
    const publicDir = node_path_1.default.resolve(process.cwd(), 'public');
    app.use(`${config_1.config.basePath}/docs`, express_1.default.static(publicDir, { index: 'index.html' }));
    await app.listen(config_1.config.port, '0.0.0.0');
    console.log(`Tongpin B2 backend listening on http://localhost:${config_1.config.port}${config_1.config.basePath}`);
    console.log(`Swagger UI: http://localhost:${config_1.config.port}${config_1.config.basePath}/docs`);
}
// Small helper keeps AppModule construction explicit for readers and future DI tests.
function AppInstance() {
    return app_module_1.AppModule;
}
void bootstrap().catch((error) => {
    console.error('Failed to start Tongpin B2 backend', error);
    process.exit(1);
});
//# sourceMappingURL=main.js.map