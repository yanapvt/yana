import { Request, Response, Router } from 'express';
import { z } from 'zod';
import {
  DemoSportsContentProvider,
  SportsFanExperienceService,
} from '../services/sports-engine/index.js';

const router = Router();
const service = new SportsFanExperienceService([new DemoSportsContentProvider()]);

const feedRequest = z.object({
  sports: z.array(z.string().trim().min(1)).max(5).default(['cricket']),
  teams: z.array(z.string().trim().min(1)).max(10).default([]),
  topics: z.array(z.string().trim().min(1)).max(10).default([]),
  language: z.string().trim().min(2).max(12).default('en'),
  accessibilityMode: z.boolean().default(true),
  prioritizeWomensSport: z.boolean().default(true),
});

router.get('/', (_req: Request, res: Response) => {
  res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>YANA Play — Women’s sport, one message away</title>
<style>
:root{color-scheme:dark;--ink:#f7f5ff;--muted:#b8b2cb;--card:#171326;--accent:#d8ff3e;--violet:#8e6cff}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,sans-serif;background:radial-gradient(circle at 80% 0,#382471 0,transparent 35%),#0b0912;color:var(--ink)}
main{max-width:1040px;margin:auto;padding:32px 20px 64px}.eyebrow{color:var(--accent);font-weight:800;letter-spacing:.12em;text-transform:uppercase}
h1{font-size:clamp(42px,8vw,88px);line-height:.95;margin:18px 0;max-width:900px}h1 span{color:var(--accent)}.lead{font-size:20px;color:var(--muted);max-width:690px}
.grid{display:grid;grid-template-columns:1fr 1.25fr;gap:22px;margin-top:42px}.panel{background:rgba(23,19,38,.92);border:1px solid #39304f;border-radius:20px;padding:22px}
label{display:block;margin:14px 0 5px;font-weight:700}input,select,button{width:100%;border:1px solid #514568;border-radius:12px;background:#0f0c19;color:var(--ink);padding:12px;font:inherit}
button{margin-top:20px;background:var(--accent);color:#111500;border:0;font-weight:900;cursor:pointer}.item{border-top:1px solid #39304f;padding:18px 0}.item:first-child{border-top:0;padding-top:0}
.tag{display:inline-block;background:#30264a;color:#d9cdff;padding:3px 8px;border-radius:999px;font-size:12px}.score{float:right;color:var(--accent);font-weight:800}.why{color:var(--muted);font-size:14px}.note{font-size:13px;color:var(--muted)}
@media(max-width:760px){.grid{grid-template-columns:1fr}main{padding-top:22px}}
</style></head><body><main>
<div class="eyebrow">ICC Global Hackathon prototype</div><h1>Women’s sport.<br><span>One message away.</span></h1>
<p class="lead">YANA Play turns the messaging app fans already use into a personal sports companion: verified stories, fixtures, challenges and local communities—ranked for relevance and representation.</p>
<div class="grid"><section class="panel"><h2>Shape my feed</h2>
<label for="sport">Sport</label><select id="sport"><option>cricket</option><option>football</option></select>
<label for="team">Team</label><input id="team" value="Sri Lanka" maxlength="80">
<label for="topic">What brings you closer?</label><select id="topic"><option value="community">Community</option><option value="athlete stories">Athlete stories</option><option value="learn cricket">Learn the game</option></select>
<label><input id="accessible" type="checkbox" checked style="width:auto"> Concise accessible text</label>
<button id="build">Build my three-card feed</button><p class="note">No app download. Designed for WhatsApp, low bandwidth and multilingual delivery.</p></section>
<section class="panel" aria-live="polite"><h2>Your YANA Play feed</h2><div id="feed"><p class="why">Choose your interests to begin.</p></div></section></div>
<p class="note">Prototype data is fictional and clearly labelled. Production fixtures and athlete facts require an authoritative ICC or partner source.</p>
</main><script>
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
document.querySelector('#build').addEventListener('click',async()=>{const target=document.querySelector('#feed');target.textContent='Building your feed…';
try{const response=await fetch('/sports/api/feed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sports:[document.querySelector('#sport').value],teams:[document.querySelector('#team').value],topics:[document.querySelector('#topic').value],language:'en',accessibilityMode:document.querySelector('#accessible').checked,prioritizeWomensSport:true})});
const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to build feed');target.innerHTML=data.items.map(item=>'<article class="item"><span class="tag">'+esc(item.kind.replace('_',' '))+'</span><span class="score">'+esc(item.relevanceScore)+' match</span><h3>'+esc(item.title)+'</h3><p>'+esc(item.summary)+'</p><p class="why">Why this: '+esc(item.reasons.join(' · '))+'</p><strong>'+esc(item.callToAction)+' →</strong></article>').join('');}
catch(error){target.textContent=error.message;}});
</script></body></html>`);
});

router.post('/api/feed', async (req: Request, res: Response) => {
  const parsed = feedRequest.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Please check the selected sports preferences.' });
    return;
  }
  res.json(await service.buildFeed(parsed.data));
});

router.get('/api/capabilities', (_req: Request, res: Response) => {
  res.json({
    product: 'YANA Play',
    prototype: true,
    channels: ['Twilio WhatsApp', 'OpenWA', 'Meta WhatsApp'],
    capabilities: [
      'personalized feed',
      'women-first discovery',
      'provider fallback',
      'provenance',
      'accessible text',
    ],
    productionBoundary:
      'Connect an authorized ICC or partner data adapter before presenting live fixtures or official athlete facts.',
  });
});

export default router;
