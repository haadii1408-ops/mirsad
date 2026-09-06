
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { z } from 'zod';
import pdfParse from 'pdf-parse';
import { analyzeEvidence } from './engine.cjs';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'storage');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.warn('WARNING: JWT_SECRET should be a random secret of at least 32 characters.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' }, contentSecurityPolicy: false }));
if (process.env.CORS_ORIGIN) {
  const origins = process.env.CORS_ORIGIN.split(',').map(s=>s.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length === 1 ? origins[0] : origins, credentials: false }));
}
app.use(express.json({ limit: '2mb' }));

const authLimiter = rateLimit({ windowMs: 15*60*1000, limit: 60, standardHeaders: true });
const uploadLimiter = rateLimit({ windowMs: 15*60*1000, limit: 100, standardHeaders: true });

const storage = multer.diskStorage({
  destination: (_,__,cb)=>cb(null,UPLOAD_DIR),
  filename: (_,file,cb)=>cb(null,`${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage,
  limits:{fileSize:Number(process.env.MAX_UPLOAD_MB||25)*1024*1024},
  fileFilter:(_,file,cb)=>{
    const allowed = new Set([
      'application/pdf','image/png','image/jpeg','text/plain',
      'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]);
    cb(null,allowed.has(file.mimetype));
  }
});

function sign(user){
  return jwt.sign({sub:user.id,role:user.role,schoolId:user.school_id||null},
    process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN || '4h',issuer:'mirsad'});
}
async function auth(req,res,next){
  try{
    const h=req.headers.authorization||'';
    if(!h.startsWith('Bearer ')) return res.status(401).json({message:'غير مصرح'});
    const p=jwt.verify(h.slice(7),process.env.JWT_SECRET,{issuer:'mirsad'});
    const {rows}=await pool.query('SELECT u.id,u.name,u.email,u.role,u.school_id,u.active,s.name AS school_name FROM users u LEFT JOIN schools s ON s.id=u.school_id WHERE u.id=$1',[p.sub]);
    if(!rows[0]||!rows[0].active) return res.status(401).json({message:'الحساب غير متاح'});
    req.user=rows[0]; next();
  }catch{res.status(401).json({message:'جلسة الدخول غير صالحة'});}
}
const ownerOnly=(req,res,next)=>req.user.role==='OWNER'?next():res.status(403).json({message:'هذه العملية لمالك المنصة فقط'});
const schoolOnly=(req,res,next)=>req.user.role!=='OWNER'?next():res.status(400).json({message:'هذه العملية مخصصة لمساحة مدرسة'});

async function audit(user,action,entityType,entityId,metadata={},schoolId=user?.school_id||null){
  await pool.query('INSERT INTO audit_log(school_id,user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [schoolId,user?.id||null,action,entityType,entityId||null,metadata]);
}

app.get('/health',async(_,res)=>{
  try{await pool.query('SELECT 1');res.json({ok:true,service:'mirsad',time:new Date().toISOString()})}
  catch{res.status(503).json({ok:false})}
});

app.post('/api/auth/login',authLimiter,async(req,res)=>{
  try{
    const s=z.object({email:z.string().email(),password:z.string().min(1).max(200)}).parse(req.body);
    const {rows}=await pool.query(`SELECT u.*, s.name AS school_name FROM users u LEFT JOIN schools s ON s.id=u.school_id WHERE lower(u.email)=lower($1)`,[s.email]);
    const u=rows[0];
    if(!u || !u.active || !(await bcrypt.compare(s.password,u.password_hash))) return res.status(401).json({message:'البريد أو كلمة المرور غير صحيحة'});
    await audit(u,'LOGIN','USER',u.id,{});
    res.json({token:sign(u),user:{id:u.id,name:u.name,email:u.email,role:u.role,school_id:u.school_id,school_name:u.school_name||null}});
  }catch(e){res.status(400).json({message:e.message});}
});
app.get('/api/auth/me',auth,async(req,res)=>res.json({user:req.user}));

app.get('/api/evidence',auth,schoolOnly,async(req,res)=>{
  const {rows}=await pool.query(`SELECT id,title,original_name,mime_type,size_bytes,status,coverage_percent,engine_version,created_at,analyzed_at
    FROM evidence WHERE school_id=$1 AND status<>'ARCHIVED' ORDER BY created_at DESC`,[req.user.school_id]);
  res.json({items:rows});
});
app.get('/api/evidence/:id/analysis',auth,schoolOnly,async(req,res)=>{
  const e=(await pool.query(`SELECT id,title,status,analysis_json,coverage_percent,engine_version FROM evidence WHERE id=$1 AND school_id=$2`,
    [req.params.id,req.user.school_id])).rows[0];
  if(!e) return res.status(404).json({message:'الشاهد غير موجود'});
  const links=(await pool.query(`SELECT el.*,i.code,i.title,i.domain FROM evidence_links el JOIN indicators i ON i.id=el.indicator_id WHERE el.evidence_id=$1 ORDER BY el.confidence DESC`,[e.id])).rows;
  const recs=(await pool.query(`SELECT * FROM evidence_recommendations WHERE evidence_id=$1 ORDER BY created_at DESC`,[e.id])).rows;
  res.json({evidence:e,links,recommendations:recs});
});
app.get('/api/indicators',auth,async(req,res)=>{
  const {rows}=await pool.query(`SELECT id,code,title,domain,requirements FROM indicators WHERE active=true ORDER BY code`);
  res.json({items:rows});
});
app.post('/api/evidence/:id/review',auth,schoolOnly,async(req,res)=>{
  const allowed=new Set(['APPROVED','REJECTED','PENDING']);
  const status=String(req.body.status||'');
  if(!allowed.has(status)) return res.status(400).json({message:'حالة مراجعة غير صالحة'});
  const q=await pool.query(`UPDATE evidence_links el SET reviewer_status=$1
    FROM evidence e WHERE el.evidence_id=e.id AND el.id=$2 AND e.school_id=$3 RETURNING el.*`,
    [status,req.body.link_id,req.params.id,req.user.school_id]);
  if(!q.rows[0]) return res.status(404).json({message:'الرابط غير موجود'});
  await audit(req.user,'EVIDENCE_LINK_REVIEWED','EVIDENCE',req.params.id,{link_id:req.body.link_id,status});
  res.json({item:q.rows[0]});
});

app.post('/api/evidence',auth,schoolOnly,uploadLimiter,upload.single('file'),async(req,res)=>{
  if(!req.file) return res.status(400).json({message:'الملف غير صالح أو لم يتم رفعه'});
  const title=String(req.body.title||req.file.originalname).slice(0,300);
  const buf=fs.readFileSync(req.file.path);
  const sha=crypto.createHash('sha256').update(buf).digest('hex');
  const dup=await pool.query('SELECT id FROM evidence WHERE school_id=$1 AND sha256=$2 LIMIT 1',[req.user.school_id,sha]);
  if(dup.rows[0]){
    fs.unlinkSync(req.file.path);
    return res.status(409).json({message:'هذا الملف موجود مسبقًا في مستودع المدرسة',id:dup.rows[0].id});
  }
  const {rows}=await pool.query(`INSERT INTO evidence(school_id,uploaded_by,title,original_name,stored_name,mime_type,size_bytes,sha256,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PROCESSING') RETURNING id,title,status,created_at`,
    [req.user.school_id,req.user.id,title,req.file.originalname,req.file.filename,req.file.mimetype,req.file.size,sha]);
  await audit(req.user,'EVIDENCE_UPLOADED','EVIDENCE',rows[0].id,{original_name:req.file.originalname});
  queueAnalysis(rows[0].id).catch(console.error);
  res.status(201).json({item:rows[0]});
});


async function extractEvidenceText(filePath,mime){
  try{
    if(mime==='application/pdf') return (await pdfParse(fs.readFileSync(filePath))).text||'';
    if(mime==='text/plain') return fs.readFileSync(filePath,'utf8');
    if(mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'){
      const mammoth=await import('mammoth');
      const out=await mammoth.extractRawText({path:filePath});
      return out.value||'';
    }
    if(mime==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mime==='application/vnd.ms-excel'){
      const XLSX=await import('xlsx');
      const wb=XLSX.readFile(filePath,{cellDates:true});
      return wb.SheetNames.map(name=>`[${name}]\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`).join('\n\n');
    }
    if(mime==='image/png' || mime==='image/jpeg'){
      const T=await import('tesseract.js');
      const result=await T.recognize(filePath,'ara+eng',{logger:()=>{}});
      return result.data?.text||'';
    }
  }catch(err){ console.warn('extraction failed',mime,err.message); }
  return '';
}

async function queueAnalysis(id){
  const c=await pool.connect();
  try{
    const r=await c.query('SELECT * FROM evidence WHERE id=$1',[id]);
    if(!r.rows[0]) return;
    const e=r.rows[0];
    const file=path.join(UPLOAD_DIR,e.stored_name);
    const text=await extractEvidenceText(file,e.mime_type);
    const indRows = (await c.query(`SELECT id,code,title,domain,requirements FROM indicators WHERE active=true`)).rows;
    const result = analyzeEvidence({text,indicators:indRows});
    const coverage = result.top_matches.length
      ? Math.round(result.top_matches.reduce((a,x)=>a+x.evidence_strength,0)/result.top_matches.length)
      : result.evidence_profile.completeness_percent;
    await c.query('BEGIN');
    await c.query(`UPDATE evidence SET status='ANALYZED',extracted_text=$1,analysis_json=$2,evidence_profile=$3,engine_version=$4,coverage_percent=$5,analyzed_at=NOW() WHERE id=$6`,
      [text,JSON.stringify(result),JSON.stringify(result.evidence_profile),'2.0',coverage,id]);
    await c.query('DELETE FROM evidence_links WHERE evidence_id=$1',[id]);
    await c.query('DELETE FROM evidence_recommendations WHERE evidence_id=$1',[id]);
    for(const m of result.matches){
      await c.query(`INSERT INTO evidence_links(evidence_id,indicator_id,confidence,proof_location,rationale,reviewer_status)
        VALUES($1,$2,$3,$4,$5,'PENDING') ON CONFLICT DO NOTHING`,
        [id,m.indicator_id,m.confidence,JSON.stringify(m.proof_locations),
         `تم الربط آليًا بواسطة محرك هادي V2. قوة الإثبات ${m.evidence_strength}%.`]);
      for(const d of m.missing_dimensions){
        const rec=(m.recommended_actions||[]).find(x=>x.key===d)?.recommendation || '';
        await c.query(`INSERT INTO evidence_recommendations(evidence_id,indicator_id,missing_dimension,recommendation)
          VALUES($1,$2,$3,$4)`,[id,m.indicator_id,d,rec]);
      }
    }
    await c.query('COMMIT');
  }catch(e){
    await c.query(`UPDATE evidence SET status='FAILED',analysis_json=$1 WHERE id=$2`,[JSON.stringify({error:'analysis_failed'}),id]).catch(()=>{});
  }finally{c.release()}
}
function extractHeuristicElements(text){
  const t=text.toLowerCase();
  const keys=[
    ['goal',['هدف','أهداف','الغرض']],
    ['implementation',['تنفيذ','نفذ','تطبيق']],
    ['measurement',['قياس','مؤشر','نتيجة','نتائج']],
    ['analysis',['تحليل','تحليل النتائج']],
    ['improvement',['تحسين','تحسينات','إجراء تصحيحي']]
  ];
  return keys.map(([key,words])=>({key,detected:words.some(w=>t.includes(w)),source:'heuristic'}));
}


app.get('/api/dashboard',auth,schoolOnly,async(req,res)=>{
  const schoolId=req.user.school_id;
  const e=(await pool.query(`SELECT COUNT(*)::int total, COUNT(*) FILTER(WHERE status='ANALYZED')::int analyzed,
    COALESCE(ROUND(AVG(coverage_percent))::int,0) avg_coverage FROM evidence WHERE school_id=$1 AND status<>'ARCHIVED'`,[schoolId])).rows[0];
  const links=(await pool.query(`SELECT COUNT(*)::int total, COUNT(*) FILTER(WHERE reviewer_status='APPROVED')::int approved,
    COUNT(DISTINCT indicator_id)::int indicators FROM evidence_links el JOIN evidence e ON e.id=el.evidence_id WHERE e.school_id=$1`,[schoolId])).rows[0];
  res.json({evidence:e,links});
});

app.get('/api/evidence/:id/download',auth,schoolOnly,async(req,res)=>{
  const e=(await pool.query('SELECT original_name,stored_name,mime_type FROM evidence WHERE id=$1 AND school_id=$2',[req.params.id,req.user.school_id])).rows[0];
  if(!e) return res.status(404).json({message:'الشاهد غير موجود'});
  const file=path.join(UPLOAD_DIR,e.stored_name);
  if(!fs.existsSync(file)) return res.status(404).json({message:'الملف غير موجود على الخادم'});
  res.download(file,e.original_name,{headers:{'Content-Type':e.mime_type}});
});

app.get('/api/schools',auth,ownerOnly,async(req,res)=>{
  const {rows}=await pool.query(`SELECT s.id,s.name,s.code,s.active,COUNT(u.id)::int AS user_count
    FROM schools s LEFT JOIN users u ON u.school_id=s.id GROUP BY s.id ORDER BY s.created_at DESC`);
  res.json({items:rows});
});

app.post('/api/schools',auth,ownerOnly,async(req,res)=>{
  try{
    const s=z.object({name:z.string().min(2).max(250),email:z.string().email(),password:z.string().min(12).max(200)}).parse(req.body);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const code='SCH-'+crypto.randomBytes(3).toString('hex').toUpperCase();
      const school=(await client.query('INSERT INTO schools(name,code) VALUES($1,$2) RETURNING *',[s.name,code])).rows[0];
      const hash=await bcrypt.hash(s.password,12);
      const user=(await client.query(`INSERT INTO users(school_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,'SCHOOL_ADMIN') RETURNING id,name,email,role,school_id`,
        [school.id,`مدير ${s.name}`,s.email,hash])).rows[0];
      await client.query('COMMIT');
      await audit(req.user,'SCHOOL_CREATED','SCHOOL',school.id,{email:s.email},school.id);
      res.status(201).json({school,user});
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }catch(e){res.status(400).json({message:e.code==='23505'?'البريد مستخدم مسبقًا أو رمز المدرسة مكرر':e.message});}
});

app.get('/api/audit',auth,async(req,res)=>{
  const schoolId=req.user.role==='OWNER' ? req.query.school_id : req.user.school_id;
  const q=schoolId
    ? await pool.query('SELECT * FROM audit_log WHERE school_id=$1 ORDER BY created_at DESC LIMIT 200',[schoolId])
    : await pool.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200');
  res.json({items:q.rows});
});

app.use(express.static(path.join(__dirname,'public')));
app.use((req,res)=>{
  if(req.method==='GET' && !req.path.startsWith('/api/')) return res.sendFile(path.join(__dirname,'public/index.html'));
  res.status(404).json({message:'المسار غير موجود'});
});

app.use((err,req,res,next)=>{
  if (err instanceof multer.MulterError) return res.status(400).json({message:'تعذر رفع الملف: '+err.message});
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({message:'حدث خطأ داخلي غير متوقع'});
});

const server = app.listen(PORT,()=>console.log(`MIRSAD listening on :${PORT}`));
const shutdown = async signal => {
  console.log(`Received ${signal}; shutting down...`);
  server.close(async()=>{ await pool.end(); process.exit(0); });
  setTimeout(()=>process.exit(1),10000).unref();
};
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
