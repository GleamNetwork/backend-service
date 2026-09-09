import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

async function main(): Promise<void> {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  });
  const databaseName = process.env.DB_NAME ?? 'tongpin_b2';
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await connection.query(`USE \`${databaseName}\``);
  const sql = fs.readFileSync(path.resolve(process.cwd(), 'sql', 'schema.sql'), 'utf-8');
  await connection.query(sql);
  await connection.end();
  console.log(`Database ${databaseName} migrated successfully.`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
