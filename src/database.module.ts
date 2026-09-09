import { Global, Module, Provider } from '@nestjs/common';
import mysql from 'mysql2/promise';
import { config } from './config';

export const DATABASE = Symbol('DATABASE');

async function createDatabase(): Promise<mysql.Pool> {
  return mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    connectionLimit: config.db.connectionLimit,
    connectTimeout: config.db.connectTimeout,
    charset: 'utf8mb4_0900_ai_ci',
    timezone: 'Z',
    namedPlaceholders: true,
    multipleStatements: false,
  });
}

const databaseProvider: Provider = {
  provide: DATABASE,
  useFactory: async () => createDatabase(),
};

export function injectDatabase(): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    Reflect.defineMetadata('tongpin:database:index', parameterIndex, target, propertyKey ?? '');
  };
}

@Global()
@Module({
  providers: [databaseProvider],
  exports: [databaseProvider],
})
export class DatabaseModule {}
