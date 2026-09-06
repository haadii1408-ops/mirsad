
/**
 * HADI Evidence Intelligence Engine V2
 * Deterministic baseline: Arabic normalization + section/sentence extraction +
 * requirement matching + lexical similarity + proof-location traceability.
 *
 * This is intentionally provider-agnostic. A future LLM/OCR adapter can enrich
 * the same intermediate representation without changing the API contract.
 */

const STOP = new Set([
  'من','في','على','الى','إلى','عن','مع','هذا','هذه','ذلك','تلك','هو','هي','هم','هن',
  'أن','إن','ما','لا','لم','لن','قد','تم','يتم','كان','كانت','يكون','تكون','و','أو',
  'ثم','كما','أي','كل','بعض','عند','حتى','بعد','قبل','بين','ضمن','لدى','لذلك','الذي',
  'التي','الذين','هناك','هنا','به','بها','له','لها','فيه','فيها','منها','عليه','عليها'
]);

const REQUIREMENT_LEXICON = {
  goal:['هدف','أهداف','غاية','خطة','مستهدف','أولوية'],
  implementation:['تنفيذ','نفذ','تطبيق','إجراء','برنامج','نشاط','ممارسة','تشغيل'],
  measurement:['قياس','مؤشر','مقياس','نتيجة','نتائج','بيانات','استبانة','نسبة','معدل'],
  analysis:['تحليل','حلل','قراءة النتائج','تفسير','تشخيص','مقارنة','فجوة'],
  improvement:['تحسين','تحسينات','تطوير','إجراء تصحيحي','خطة علاجية','معالجة','أثر'],
  governance:['حوكمة','صلاحية','مسؤولية','قرار','لجنة','اجتماع','محضر','تفويض'],
  participation:['مشاركة','شراكة','مجتمع','أسرة','أولياء الأمور','طلاب','طالبات','مجلس'],
  learning:['تعلم','تعليم','تدريس','استراتيجية','نشاط صفي','تقويم','واجب','مهارة'],
  environment:['بيئة مدرسية','سلامة','أمن','مرافق','تجهيزات','صحة','نظافة','إرشاد']
};

function normalizeArabic(s=''){
  return String(s)
    .replace(/[\u064B-\u065F\u0670]/g,'')
    .replace(/[إأآا]/g,'ا').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي')
    .replace(/ة/g,'ه').replace(/[^\p{L}\p{N}\s]/gu,' ')
    .replace(/\s+/g,' ').trim().toLowerCase();
}

function tokens(s){
  return normalizeArabic(s).split(/\s+/).filter(x=>x && x.length>1 && !STOP.has(x));
}

function unique(arr){ return [...new Set(arr)]; }

function sentences(text){
  const raw=String(text||'').replace(/\r/g,'');
  const parts=raw.split(/(?<=[\.\!\؟\?؛;])\s+|\n{2,}/).map(x=>x.trim()).filter(x=>x.length>=12);
  return parts.length ? parts : raw.split('\n').map(x=>x.trim()).filter(x=>x.length>=12);
}

function scoreText(a,b){
  const A=tokens(a), B=tokens(b);
  if(!A.length || !B.length) return 0;
  const sa=new Set(A), sb=new Set(B);
  let inter=0; for(const x of sa) if(sb.has(x)) inter++;
  const union=new Set([...sa,...sb]).size;
  return union ? inter/union : 0;
}

function requirementSignals(text){
  const n=normalizeArabic(text);
  return Object.entries(REQUIREMENT_LEXICON).map(([key,words])=>({
    key,
    detected:words.some(w=>n.includes(normalizeArabic(w))),
    matched_terms:words.filter(w=>n.includes(normalizeArabic(w)))
  }));
}

function proofLocations(text, indicator){
  const ss=sentences(text);
  const target=[indicator.title||'', ...(indicator.requirements||[]).map(x=>typeof x==='string'?x:(x.title||x.label||''))].join(' ');
  return ss.map((s,i)=>({sentence:s,index:i+1,score:scoreText(s,target)}))
    .filter(x=>x.score>=0.12).sort((a,b)=>b.score-a.score).slice(0,5);
}

function classifyEvidence(text){
  const signals=requirementSignals(text);
  const detected=signals.filter(x=>x.detected);
  const core=['goal','implementation','measurement','analysis','improvement'];
  const coreDetected=core.filter(k=>signals.find(x=>x.key===k)?.detected);
  return {
    signals,
    evidence_dimensions:{
      existence: detected.length>0,
      implementation: signals.find(x=>x.key==='implementation')?.detected||false,
      measurement: signals.find(x=>x.key==='measurement')?.detected||false,
      analysis: signals.find(x=>x.key==='analysis')?.detected||false,
      improvement: signals.find(x=>x.key==='improvement')?.detected||false
    },
    dimension_count:coreDetected.length,
    completeness_percent:Math.round(coreDetected.length/core.length*100)
  };
}

function matchIndicators(text, indicators){
  const global=classifyEvidence(text);
  const results=[];
  for(const ind of indicators){
    const reqs=(ind.requirements||[]).map(r=>typeof r==='string'?r:(r.title||r.label||''));
    const indicatorText=[ind.code,ind.title,ind.domain,...reqs].join(' ');
    const lexical=scoreText(text,indicatorText);
    const locs=proofLocations(text,ind);
    const reqSignals=requirementSignals(text);
    const requirementCoverage=reqs.length
      ? reqs.filter(r=>scoreText(text,r)>=0.10).length/reqs.length
      : 0;
    const dimensionBonus=global.dimension_count/5*0.25;
    const locationBonus=locs.length ? Math.min(0.20,locs[0].score) : 0;
    const confidence=Math.min(1, lexical*0.55 + requirementCoverage*0.25 + dimensionBonus + locationBonus);
    if(confidence>=0.18){
      results.push({
        indicator_id:ind.id, code:ind.code, title:ind.title, domain:ind.domain||null,
        confidence:Number(confidence.toFixed(4)),
        confidence_percent:Math.round(confidence*100),
        proof_locations:locs.map(x=>({sentence_index:x.index,score:Number(x.score.toFixed(4)),text:x.sentence})),
        evidence_strength:Math.round(Math.min(100, confidence*70 + global.completeness_percent*0.30)),
        missing_dimensions:['goal','implementation','measurement','analysis','improvement']
          .filter(k=>!global.evidence_dimensions[dimKey(k)])
      });
    }
  }
  return results.sort((a,b)=>b.confidence-a.confidence);
}

function dimKey(k){return k;}

function analyzeEvidence({text='',indicators=[]}){
  const cls=classifyEvidence(text);
  const matches=matchIndicators(text,indicators);
  const gaps=matches.map(m=>({
    indicator_id:m.indicator_id,code:m.code,title:m.title,
    missing_dimensions:m.missing_dimensions,
    recommended_actions:m.missing_dimensions.map(x=>recommendation(x))
  })).filter(x=>x.missing_dimensions.length);
  return {
    engine:'HADI-EVIDENCE-INTELLIGENCE-ENGINE',
    version:'2.0',
    input:{characters:String(text).length},
    evidence_profile:cls,
    matches,
    top_matches:matches.slice(0,8),
    gaps,
    complementary_search_terms:buildComplementaryTerms(matches,gaps),
    traceability:matches.flatMap(m=>m.proof_locations.map(p=>({
      indicator_id:m.indicator_id,code:m.code,sentence_index:p.sentence_index,proof:p.text
    })))
  };
}
function recommendation(x){
  return ({
    goal:'إرفاق الهدف أو المستهدف المعتمد الذي يوضح الغاية من الإجراء.',
    implementation:'إرفاق ما يثبت التنفيذ الفعلي، مثل خطة تنفيذ أو محضر أو سجل نشاط.',
    measurement:'إرفاق أداة قياس أو نتائج كمية/نوعية قابلة للتحقق.',
    analysis:'إرفاق تحليل للنتائج يوضح ما تم استنتاجه من البيانات.',
    improvement:'إرفاق إجراء تحسين أو معالجة مبني على النتائج مع ما يثبت المتابعة.'
  })[x]||'إرفاق دليل إضافي.';
}
function buildComplementaryTerms(matches,gaps){
  const terms=[];
  for(const g of gaps) for(const x of g.missing_dimensions) terms.push(x);
  return unique(terms);
}

module.exports={normalizeArabic,tokens,scoreText,classifyEvidence,matchIndicators,analyzeEvidence};
