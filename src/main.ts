import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import path from 'node:path';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppInstance(), {
    logger: ['error', 'warn', 'log'],
  });

  const origins = config.corsOrigins.includes('*') ? true : config.corsOrigins;
  app.enableCors({
    origin: origins,
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });

  app.setGlobalPrefix(config.basePath.replace(/^\//, ''), {
    exclude: [`${config.basePath.replace(/^\//, '')}/docs`, `${config.basePath.replace(/^\//, '')}/docs/(.*)`],
  });

  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(`${config.basePath}/docs`, express.static(publicDir, { index: 'index.html' }));

  await app.listen(config.port, '0.0.0.0');
  console.log(`Tongpin B2 backend listening on http://localhost:${config.port}${config.basePath}`);
  console.log(`Swagger UI: http://localhost:${config.port}${config.basePath}/docs`);
}

// Small helper keeps AppModule construction explicit for readers and future DI tests.
function AppInstance(): any {
  return AppModule;
}

void bootstrap().catch((error) => {
  console.error('Failed to start Tongpin B2 backend', error);
  process.exit(1);
});
