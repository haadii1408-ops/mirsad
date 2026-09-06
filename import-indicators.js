import 'dotenv/config';
import fs from 'fs';
import pg from 'pg';
const {Pool}=pg; const pool=new Pool({connectionString:process.env.DATABASE_URL});
const data=JSON.parse(fs.readFileSync(process.argv[2]||'db/indicator-seed.json','utf8'));
for(const x of data.indicators){
 await pool.query(`INSERT INTO indicators(code,title,domain,requirements) VALUES($1,$2,$3,$4)
 ON CONFLICT(code) DO UPDATE SET title=EXCLUDED.title,domain=EXCLUDED.domain,requirements=EXCLUDED.requirements`,
 [x.code,x.title,x.domain,JSON.stringify(x.requirements||[])]);
}
console.log(`Imported ${data.indicators.length} indicators`);
await pool.end();
