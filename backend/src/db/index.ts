import { initializeDatabase } from './schema.js';
import Database from 'better-sqlite3';

let dbInstance: Database.Database | null = null;

export function getDb(customPath?: string): Database.Database {
  if (!dbInstance) {
    dbInstance = initializeDatabase(customPath);
  }
  return dbInstance;
}
