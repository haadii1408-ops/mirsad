import 'dotenv/config';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Pool } = pg;
const schemaPath = new URL('./db/schema.sql', import.meta.url);
const seedPath = new URL('./db/indicator-seed.json', import.meta.url);
const schemaSql = fs.readFileSync(schemaPath, 'utf8');
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const databaseUrl = process.env.DATABASE_URL;
const retries = Math.max(1, Number(process.env.DB_INIT_RETRIES || 10));
const retryDelayMs = Math.max(1000, Number(process.env.DB_INIT_RETRY_DELAY_MS || 3000));

if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function initialize() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const client = await pool.connect().catch(err => {
        lastError = err;
        return null;
      });
      if (!client) {
        if (attempt < retries) {
          console.warn(`Database not ready; retry ${attempt}/${retries}...`);
          await sleep(retryDelayMs);
          continue;
        }
        throw lastError;
      }

      try {
        await client.query('BEGIN');
        await client.query(schemaSql);

        if (process.env.AUTO_SEED_INDICATORS !== 'false') {
          for (const item of seed.indicators) {
            await client.query(
              `INSERT INTO indicators(code,title,domain,requirements) VALUES($1,$2,$3,$4)
               ON CONFLICT(code) DO UPDATE SET title=EXCLUDED.title,domain=EXCLUDED.domain,requirements=EXCLUDED.requirements,active=true`,
              [item.code, item.title, item.domain, JSON.stringify(item.requirements || [])]
            );
          }

          const checksum = crypto.createHash('sha256')
            .update(fs.readFileSync(seedPath))
            .digest('hex');
          await client.query(
            `INSERT INTO indicator_versions(version,source_name,source_date,checksum,active)
             VALUES($1,$2,$3,$4,true)
             ON CONFLICT(version, checksum) DO UPDATE SET active=true`,
            [seed.framework, seed.source, null, checksum]
          );
          await client.query(
            `INSERT INTO app_meta(key,value) VALUES ('release','MIRSAD 1.1'),('indicator_baseline','ETEC-1447-2026-government-49')
             ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`
          );
        }

        const ownerEmail = process.env.BOOTSTRAP_OWNER_EMAIL?.trim();
        const ownerPassword = process.env.BOOTSTRAP_OWNER_PASSWORD;
        const ownerName = (process.env.BOOTSTRAP_OWNER_NAME || 'مالك منصة مرصاد').trim();
        if (ownerEmail || ownerPassword) {
          if (!ownerEmail || !ownerPassword) {
            throw new Error('BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_PASSWORD must be provided together.');
          }
          if (ownerPassword.length < 12) {
            throw new Error('BOOTSTRAP_OWNER_PASSWORD must be at least 12 characters.');
          }
          const hash = await bcrypt.hash(ownerPassword, 12);
          await client.query(
            `INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'OWNER')
             ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,role='OWNER',school_id=NULL,active=true`,
            [ownerName || 'مالك منصة مرصاد', ownerEmail, hash]
          );
          console.log(`Owner account ready: ${ownerEmail}`);
        }

        await client.query('COMMIT');
        console.log(`Database initialized. Indicators ready: ${seed.indicators.length}.`);
        return;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        lastError = err;
      } finally {
        client.release();
      }

      if (attempt < retries) {
        console.warn(`Database initialization failed; retry ${attempt}/${retries}: ${lastError.message}`);
        await sleep(retryDelayMs);
      }
    }
    throw lastError;
  } finally {
    await pool.end();
  }
}

await initialize();
await import('./server.js');
