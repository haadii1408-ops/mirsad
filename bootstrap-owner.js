import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';
const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const email=process.env.BOOTSTRAP_OWNER_EMAIL;
const password=process.env.BOOTSTRAP_OWNER_PASSWORD;
const name=process.env.BOOTSTRAP_OWNER_NAME||'مالك منصة هادي';
if(!email||!password){console.error('Set BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_PASSWORD');process.exit(1)}
const hash=await bcrypt.hash(password,12);
await pool.query(`INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'OWNER')
ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,active=true`,
[name,email,hash]);
console.log('Owner ready:',email);
await pool.end();
