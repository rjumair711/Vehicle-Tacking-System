// Applies a raw SQL file to the database in DATABASE_URL (.env).
// Usage: node scripts/apply-sql.mjs prisma/sql/001_hardware_integration.sql
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/apply-sql.mjs <file.sql>');
  process.exit(1);
}

if (!process.env.DATABASE_URL && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

// Split on ";" at line end, keeping $$ ... $$ bodies in one piece.
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inDollar = false;
  for (const line of sql.split(/\r?\n/)) {
    if (!inDollar && line.trim().startsWith('--')) continue;
    current += line + '\n';
    const dollars = (line.match(/\$[a-z_]*\$/gi) || []).length;
    if (dollars % 2 === 1) inDollar = !inDollar;
    if (!inDollar && line.trim().endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const prisma = new PrismaClient();
try {
  const statements = splitStatements(fs.readFileSync(file, 'utf8'));
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
    console.log('ok  ', statement.split('\n')[0].slice(0, 90));
  }
  console.log(`Applied ${statements.length} statements from ${file}`);
} catch (error) {
  console.error('FAILED:', error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
