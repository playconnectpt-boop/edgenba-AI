import './style.css';
import { adaptBbdGamelog, buildPlayerProfile, rankPlayerTrends, type StatLine, type Market } from './engine';

type Tab = 'dashboard'|'scan'|'opportunities'|'validator'|'history'|'settings';
type ESPNScoreboard = { source: string; retrievedAt: string; data: { events?: Array<{ id: string; name: string; date: string; status?: { type?: { description?: string } }; competitions?: Array<{ competitors?: Array<{ team?: { displayName?: string; abbreviation?: string } }> }> }> } };
const app = document.querySelector<HTMLDivElement>('#app')!;
const tabs: {id:Tab;label:string;icon:string}[] = [
  {id:'dashboard',label:'Início',icon:'⌂'}, {id:'scan',label:'Análise',icon:'◎'},
  {id:'opportunities',label:'Top 10',icon:'↗'}, {id:'validator',label:'Validação',icon:'◇'},
  {id:'history',label:'Histórico',icon:'◷'}
];
let active:Tab='dashboard';
let authenticated = false;
let authMessage = '';
let installPrompt: BeforeInstallPromptEvent | null = null;
const API_BASE = ((import.meta as ImportMeta & { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE || '').replace(/\/$/, '');

interface BeforeInstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{outcome:'accepted'|'dismissed'}> }
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt=e as BeforeInstallPromptEvent; render(); });

const marketNames: Record<string,string> = {points:'Pontos',rebounds:'Ressaltos',assists:'Assistências',threes:'Triplos',pra:'PRA'};
type BbdPlayer = { id: string; name: string; team_name?: string; position?: string; league_name?: string };
let bbdPlayers: BbdPlayer[] = [];
let bbdSelectedPlayer: BbdPlayer | null = null;
let bbdRows: StatLine[] = [];
let bbdProfile: ReturnType<typeof buildPlayerProfile> | null = null;
let bbdMessage = '';
type ESPNEvent = { id:string; name:string; date:string; status?:{type?:{description?:string}}; competitions?:Array<{competitors?:Array<{team?:{displayName?:string;abbreviation?:string}}>} > };
let scanEvents: ESPNEvent[] = [];
let scanRetrievedAt = '';
let scanInjuryText = 'Relatório de lesões ainda não consultado';
type ScanPlayer = { id:string; name:string; team_name:string; position?:string|null };
let scanPlayers: ScanPlayer[] = [];
let scanRosterStatus = 'Plantéis ainda não consultados';
let scanOpportunities: import('./engine').TrendCandidate[] = [];
let scanAnalysisStatus = 'Históricos ainda não analisados.';
let scanAnalysisCoverage = { requested: 0, loaded: 0, noHistory: 0, failed: 0, retried: 0 };
const render = () => {
 if (!authenticated) {
  app.innerHTML = `
   <main class="auth-shell">
    <section class="panel auth-panel">
     <div class="brand"><div class="mark">E</div><div><b>EDGE NBA AI</b><small>ACESSO PRIVADO</small></div></div>
     <p class="eyebrow">AUTENTICAÇÃO</p><h1>Entrar na plataforma</h1>
     <p class="sub">Introduz a palavra-passe para aceder à tua aplicação.</p>
     <form id="login-form">
      <label>Palavra-passe<input id="login-password" type="password" autocomplete="current-password" required placeholder="A tua palavra-passe"></label>
      <button class="primary full" id="login-submit" type="submit">Entrar</button>
      <p id="login-message" class="footnote" role="alert">${escapeHtml(authMessage)}</p>
     </form>
    </section>
   </main>`;
  document.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', async e => {
   e.preventDefault();
   const button = document.querySelector<HTMLButtonElement>('#login-submit');
   const password = (document.querySelector<HTMLInputElement>('#login-password')?.value || '');
   const message = document.querySelector<HTMLParagraphElement>('#login-message');
   if (button) { button.disabled = true; button.textContent = 'A validar…'; }
   if (message) message.textContent = '';
   try {
    const response = await fetch(`${API_BASE}/api/login`, {
     method: 'POST', credentials: 'include',
     headers: { 'content-type': 'application/json' },
     body: JSON.stringify({ password })
    });
    if (!response.ok) throw new Error(response.status === 401 ? 'Palavra-passe incorreta.' : `Erro de autenticação (HTTP ${response.status}).`);
    authenticated = true; authMessage = ''; render();
   } catch (error) {
    authMessage = String(error);
    if (message) message.textContent = authMessage;
    if (button) { button.disabled = false; button.textContent = 'Entrar'; }
   }
  });
  return;
 }
 const content = active==='dashboard' ? dashboard() : active==='scan' ? scan() : active==='opportunities' ? opportunities() : active==='validator' ? validator() : active==='history' ? history() : settings();
 app.innerHTML = `
  <header><div class="brand"><div class="mark">E</div><div><b>EDGE NBA AI</b><small>QUANTITATIVE PLAYER PROP RESEARCH</small></div></div><span class="env"><i></i> AMBIENTE DE DESENVOLVIMENTO</span></header>
  <main>${content}</main>
  <nav>${tabs.map(t=>`<button class="nav-item ${active===t.id?'selected':''}" data-tab="${t.id}"><span>${t.icon}</span><small>${t.label}</small></button>`).join('')}</nav>`;
 document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>b.addEventListener('click',()=>{active=b.dataset.tab as Tab;render()}));
 document.querySelector('#install')?.addEventListener('click',async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;render()}else alert('No Android: menu do navegador → Adicionar ao ecrã inicial. No iPhone: Safari → Partilhar → Adicionar ao ecrã principal.')});
 document.querySelector('#save-odds')?.addEventListener('click',saveOdds);
 document.querySelector('#run-scan')?.addEventListener('click',runScan);
 document.querySelector('#bbd-search')?.addEventListener('click',searchBbdPlayer);
 document.querySelector('#bbd-player-name')?.addEventListener('keydown',e=>{if((e as KeyboardEvent).key==='Enter'){e.preventDefault();void searchBbdPlayer();}});
 document.querySelector('#bbd-season')?.addEventListener('keydown',e=>{if((e as KeyboardEvent).key==='Enter'){e.preventDefault();}});
 document.querySelectorAll<HTMLButtonElement>('[data-bbd-player]').forEach(b=>b.addEventListener('click',()=> {
  const player=bbdPlayers.find(p=>p.id===b.dataset.bbdPlayer);
  if(player) void loadBbdGamelog(player);
 }));
 document.querySelector('#check-provider')?.addEventListener('click',()=>alert('Ainda não existem credenciais ou contrato de API configurados.'));
};
function dashboard(){return `
 <section class="hero"><p class="eyebrow">NBA · DAILY RESEARCH SYSTEM</p><h1>Investigar tudo.<br><em>Selecionar com critério.</em></h1><p class="sub">Análise integral dos jogos e jogadores. Até 10 oportunidades fundamentadas por dia. O sistema não inventa dados para preencher a lista.</p><div class="hero-actions"><button class="primary" data-tab="scan" id="go-scan">Abrir análise diária</button><button class="secondary" id="install">Instalar aplicação</button></div></section>
 <section class="status-grid"><article class="metric"><span>Jogos analisados hoje</span><strong>—</strong><small>A aguardar fonte de dados</small></article><article class="metric"><span>Mercados avaliados</span><strong>—</strong><small>4 tipos de player props</small></article><article class="metric"><span>Oportunidades aprovadas</span><strong>0</strong><small>Sem dados, sem seleções</small></article></section>
 <section class="panel"><div class="section-head"><div><p class="eyebrow">PIPELINE DE ANÁLISE</p><h2>Como funciona</h2></div><span class="chip">4 fases</span></div><div class="pipeline">${[['01','Cobertura integral','Todos os jogos, jogadores e mercados'],['02','Contexto e cenários','Lesões, minutos, rotações e efeitos indiretos'],['03','Ranking diário','Até 10 oportunidades, sem quotas artificiais'],['04','Validação de valor','A tua odd → probabilidade, odd justa e EV']].map(x=>`<div class="pipe-row"><b>${x[0]}</b><div><strong>${x[1]}</strong><small>${x[2]}</small></div><span>›</span></div>`).join('')}</div></section>
 <section class="panel"><div class="section-head"><div><p class="eyebrow">INTEGRIDADE DOS DADOS</p><h2>Estado das integrações</h2></div></div>${provider('Estatísticas NBA','Histórico jogo a jogo, box scores e minutos','NÃO LIGADO')}${provider('Injury reports','Disponibilidade oficial e atualizações','NÃO LIGADO')}${provider('Calendário NBA','Jogos, equipas e horários','NÃO LIGADO')}<p class="footnote">A interface está preparada. A análise automática só será ativada depois de testar a cobertura, qualidade e proveniência de cada fornecedor.</p></section>`}
function scan(){return `<section class="page-title"><p class="eyebrow">FASE 1 · SCANNER AUTOMÁTICO</p><h1>Jogos das próximas 48 horas</h1><p class="sub">Janela móvel baseada na hora local de Portugal. O calendário é filtrado pelo horário real de cada encontro, não apenas pela data.</p></section><section class="panel"><div class="section-head"><h2>Mercados a investigar</h2><span class="chip">NBA</span></div><div class="market-grid">${Object.values(marketNames).map(m=>`<div class="market-card"><b>${m}</b><small>Player props</small></div>`).join('')}</div><div class="check-list">${['Calendário completo e estado dos jogos','Registos individuais jogo a jogo','Minutos, titularidade e rotação','Lesões: out, doubtful, questionable, probable','Cenários com e sem jogadores em dúvida','Impacto na utilização e oportunidades dos colegas','Confronto defensivo, ritmo e contexto','Amostras, outliers e qualidade dos dados'].map(x=>`<div><span>✓</span>${x}</div>`).join('')}</div><button class="primary full" id="run-scan">Analisar jogos das próximas 48 horas</button><p class="footnote">Primeira etapa: calendário ESPN, filtro exacto de 48 horas e relatório de lesões. O ranking estatístico só será criado depois de ligar a pesquisa de jogadores e os históricos BBD por equipa.</p><div id="scan-results" class="scan-results" aria-live="polite"><p class="muted">Ainda não foram consultadas fontes.</p></div></section>
 <section class="panel"><div class="section-head"><div><p class="eyebrow">BIGBALLSDATA · PLAYER GAMELOG</p><h2>Pesquisar jogador</h2></div><span class="chip">BBD</span></div>
 <p class="sub">Pesquisa um jogador e carrega os registos jogo a jogo directamente da BigBallsData.</p>
 <div class="two"><label>Nome do jogador<input id="bbd-player-name" value="LeBron James" placeholder="Ex.: LeBron James"></label><label>Época BBD<input id="bbd-season" type="number" min="2019" max="2035" value="2025"></label></div>
 <button class="primary full" id="bbd-search">Pesquisar jogador na BBD</button>
 <div id="bbd-results" class="scan-results" aria-live="polite"><p class="muted">Ainda não foi feita nenhuma pesquisa BBD.</p></div>
 <div id="bbd-profile" class="scan-results" aria-live="polite"></div>
 </section><section class="panel"><p class="eyebrow">CRITÉRIO DE SELEÇÃO</p><h2>Até 10 oportunidades</h2><p class="body-copy">A lista é ordenada por qualidade estatística, estabilidade da projeção, contexto e incerteza. Se só existirem 4 oportunidades que cumpram os critérios, serão apresentadas 4.</p></section>`}
function opportunities(){
 const rows=scanOpportunities.slice(0,10).map((x,i)=>`<div class="source"><span><b>#${i+1} · ${escapeHtml(x.playerName)} — ${escapeHtml(x.teamName)}</b><small>${escapeHtml(x.marketLabel)} · ${x.direction} · Índice descritivo ${x.score}/100</small><small>${escapeHtml(x.explanation)}</small><small>Últimos 5: ${x.recentMean.toFixed(1)} · 5 anteriores: ${x.previousMean.toFixed(1)} · Época: ${x.seasonMean.toFixed(1)} · Amostra: ${x.seasonSample} jogos</small></span><strong class="pending">${x.direction}</strong></div>`).join('');
 return `<section class="page-title"><p class="eyebrow">FASE 2 · RANKING ESTATÍSTICO</p><h1>Oportunidades</h1><p class="sub">Apenas jogadores com alterações recentes sustentadas nos dados. Não são apostas com valor confirmado.</p></section><section class="panel"><div class="notice"><b>${escapeHtml(scanAnalysisStatus)}</b><p>Históricos solicitados: ${scanAnalysisCoverage.requested} · Carregados: ${scanAnalysisCoverage.loaded} · Sem histórico: ${scanAnalysisCoverage.noHistory} · Falhas definitivas: ${scanAnalysisCoverage.failed} · Recuperados após repetição: ${scanAnalysisCoverage.retried}</p></div>${rows||'<div class="empty-state compact"><h2>Sem oportunidades suficientemente fundamentadas</h2><p>Não foram encontrados desvios recentes que cumpram os critérios de amostra, consistência e dimensão do sinal. Não vamos preencher o Top 10 artificialmente.</p></div>'}<p class="footnote">O índice ordena desvios descritivos recentes. Não é probabilidade de acerto, linha de bookmaker nem EV. Matchups, lesões e rotação ainda não estão incorporados no ranking.</p></section>`;
}
function validator(){return `<section class="page-title"><p class="eyebrow">FASES 3 E 4 · VALIDAÇÃO</p><h1>Validador de aposta</h1><p class="sub">Introduz a linha e a odd da Spinbetter para um mercado previamente analisado.</p></section><section class="panel"><div class="notice"><b>Motor de probabilidade ainda não ligado</b><p>Não introduzas uma probabilidade manual para obter um veredicto. A probabilidade terá de vir do modelo validado e associado à análise selecionada.</p></div><label>Jogador<input id="v-player" placeholder="Selecionar oportunidade analisada" /></label><div class="two"><label>Mercado<select id="v-market">${Object.entries(marketNames).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label>Linha da Spinbetter<input id="v-line" type="number" step="0.5" placeholder="Ex.: 24.5" /></label></div><label>Odd decimal<input id="v-odds" type="number" min="1.01" step="0.01" placeholder="Ex.: 1.90" /></label><button class="primary full" id="save-odds">Guardar dados da cotação</button><p class="footnote">Guardar a cotação não significa recomendar a aposta. O veredicto só será calculado quando existir uma previsão válida para o mesmo jogador, mercado e linha.</p></section><section class="panel"><h2>Critérios do veredicto</h2><div class="verdict-row"><b>VALOR</b><span>EV positivo após ajuste conservador de incerteza.</span></div><div class="verdict-row"><b>SEM VALOR</b><span>Preço insuficiente face à probabilidade estimada.</span></div><div class="verdict-row"><b>DADOS INSUFICIENTES</b><span>Previsão, contexto ou cotação sem validação suficiente.</span></div></section>`}
function history(){return `<section class="page-title"><p class="eyebrow">CONTROLO DE DESEMPENHO</p><h1>Histórico</h1><p class="sub">Registo de previsões, linhas, odds introduzidas, resultados e calibração do modelo.</p></section><section class="status-grid"><article class="metric"><span>Previsões registadas</span><strong>0</strong></article><article class="metric"><span>Taxa de acerto</span><strong>—</strong></article><article class="metric"><span>ROI observado</span><strong>—</strong></article></section><section class="empty-state compact"><h2>Sem histórico disponível</h2><p>Os resultados só serão calculados com previsões guardadas antes dos jogos e resultados oficiais posteriores. O modelo será avaliado fora da amostra.</p></section>`}
function settings(){return `<section class="page-title"><p class="eyebrow">CONFIGURAÇÃO</p><h1>Fontes e segurança</h1><p class="sub">A aplicação é privada e protegida por sessão.</p></section><section class="panel"><h2>Autenticação</h2><p class="body-copy">Acesso protegido pelo Worker Cloudflare. A sessão expira após 7 dias.</p><div class="source-row"><span>Proteção de acesso</span><b class="pending">ATIVA</b></div></section><section class="panel"><h2>Fornecedores de dados</h2>${provider('NBA statistics','Dados históricos e box scores','POR CONFIGURAR')}${provider('Injury report','Estado oficial dos jogadores','POR CONFIGURAR')}<button class="secondary full" id="check-provider">Verificar configuração</button></section><section class="panel"><h2>Política de integridade</h2><ul class="rules"><li>Guardar fonte e timestamp de cada registo.</li><li>Separar factos confirmados de cenários condicionais.</li><li>Não confundir hit rate histórico com probabilidade futura.</li><li>Não declarar EV sem odd válida e previsão calibrada.</li><li>Registar versão do modelo e dados usados.</li></ul></section>`}
function provider(name:string,desc:string,status:string){return `<div class="source"><span><b>${name}</b><small>${desc}</small></span><strong class="pending">${status}</strong></div>`}

async function runScan(){
 const target=document.querySelector<HTMLDivElement>('#scan-results');
 const button=document.querySelector<HTMLButtonElement>('#run-scan');
 if(!target||!button)return;
 button.disabled=true;button.textContent='A analisar janela de 48 horas…';
 target.innerHTML='<p class="muted">A consultar os dias necessários na ESPN e o relatório de lesões. A janela será filtrada pelos horários reais dos jogos.</p>';
 const now=new Date();
 const windowEnd=new Date(now.getTime()+48*60*60*1000);
 const dayStart=new Date(now);dayStart.setHours(0,0,0,0);
 const dates:string[]=[];
 for(let offset=0;offset<=2;offset++){
  const day=new Date(dayStart);day.setDate(dayStart.getDate()+offset);
  dates.push(`${day.getFullYear()}${String(day.getMonth()+1).padStart(2,'0')}${String(day.getDate()).padStart(2,'0')}`);
 }
 try{
  const scoreboardResponses=await Promise.all(dates.map(async date=>{
   const response=await fetch(`${API_BASE}/api/espn/scoreboard?date=${date}`,{credentials:'include'});
   if(!response.ok)throw new Error(`Calendário ESPN (${date}): HTTP ${response.status}`);
   return await response.json() as ESPNScoreboard;
  }));
  const injPromise=fetch(`${API_BASE}/api/espn/injuries`,{credentials:'include'}).catch(()=>null);
  const unique=new Map<string,NonNullable<ESPNScoreboard['data']['events']>[number]>();
  for(const payload of scoreboardResponses){
   for(const event of payload.data?.events||[]){
    const kickoff=Date.parse(event.date);
    if(Number.isFinite(kickoff)&&kickoff>=now.getTime()&&kickoff<=windowEnd.getTime())unique.set(event.id,event);
   }
  }
  scanEvents=[...unique.values()].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
  scanRetrievedAt=new Date().toISOString();
  scanInjuryText='Relatório de lesões indisponível';
  const injRes=await injPromise;
  if(injRes?.ok){
   const injuryPayload=await injRes.json() as {retrievedAt?:string};
   scanInjuryText=injuryPayload.retrievedAt?`Relatório consultado às ${new Date(injuryPayload.retrievedAt).toLocaleTimeString('pt-PT')}`:'Relatório consultado';
  }

  scanPlayers=[];
  scanRosterStatus='Sem jogos para descobrir jogadores.';
  if(scanEvents.length){
   const teamNames=Array.from(new Set(scanEvents.flatMap(ev=>(ev.competitions?.[0]?.competitors||[])
    .map(c=>c.team?.displayName).filter((name):name is string=>!!name))));
   const syncResponse=await fetch(`${API_BASE}/api/bbd/players`,{credentials:'include'});
   const syncPayload=await syncResponse.json() as {error?:string;meta?:{complete?:boolean;d1_synced?:boolean;total_unique?:number;teams_found?:number}};
   if(!syncResponse.ok)throw new Error(syncPayload.error||`Sincronização BBD: HTTP ${syncResponse.status}`);
   if(syncPayload.meta?.complete!==true||syncPayload.meta?.d1_synced!==true){
    scanRosterStatus=`Base BBD incompleta: ${syncPayload.meta?.total_unique??0} jogadores, ${syncPayload.meta?.teams_found??0}/30 equipas. Não foi assumida cobertura total.`;
   }else{
    const params=new URLSearchParams({teams:teamNames.join('|')});
    const rosterResponse=await fetch(`${API_BASE}/api/scan/players?${params.toString()}`,{credentials:'include'});
    const rosterPayload=await rosterResponse.json() as {error?:string;players?:ScanPlayer[];missing_teams?:string[];meta?:{players_count?:number;teams_found?:number;teams_requested?:number}};
    if(!rosterResponse.ok)throw new Error(rosterPayload.error||`Consulta de plantéis: HTTP ${rosterResponse.status}`);
    scanPlayers=Array.isArray(rosterPayload.players)?rosterPayload.players:[];
    scanRosterStatus=`${scanPlayers.length} jogadores identificados em ${rosterPayload.meta?.teams_found??0}/${rosterPayload.meta?.teams_requested??teamNames.length} equipas`;
    if(rosterPayload.missing_teams?.length)scanRosterStatus+=`. Equipas sem correspondência: ${rosterPayload.missing_teams.join(', ')}`;
   }
  }
  // Remove IDs repetidos antes de pedir históricos: cada jogador deve ser contabilizado uma única vez.
  const uniquePlayers = new Map<string, ScanPlayer>();
  for (const player of scanPlayers) {
   if (player?.id && !uniquePlayers.has(String(player.id))) uniquePlayers.set(String(player.id), player);
  }
  scanPlayers = [...uniquePlayers.values()];
  scanOpportunities=[];
  scanAnalysisCoverage={requested:scanPlayers.length,loaded:0,noHistory:0,failed:0,retried:0};
  const season=Number(new Date().getFullYear());
  const candidates: import('./engine').TrendCandidate[]=[];
  const batchSize=20; // Limite máximo aceite pelo endpoint do Worker.
  const maxAttempts=4; // Primeira tentativa + até três repetições.
  const retryableStatus=(status:number)=>status===408||status===425||status===429||status>=500;
  const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

  for(let offset=0;offset<scanPlayers.length;offset+=batchSize){
   const batch=scanPlayers.slice(offset,offset+batchSize);
   let pending=[...batch];
   const successfulResults=new Map<string,{data:unknown[]}>();
   const attemptCounts=new Map<string,number>();
   const terminalFailures=new Set<string>();

   for(let attempt=1;attempt<=maxAttempts&&pending.length;attempt++){
    target.innerHTML=`<div class="notice"><b>A analisar históricos individuais BBD</b><p>${Math.min(offset+batch.length,scanPlayers.length)} / ${scanPlayers.length} jogadores enviados.</p><p>Históricos carregados: ${scanAnalysisCoverage.loaded} · Sem histórico: ${scanAnalysisCoverage.noHistory} · A recuperar: ${pending.length}.</p><p>Tentativa ${attempt}/${maxAttempts} para os registos ainda não confirmados.</p></div>`;
    const nextPending:ScanPlayer[]=[];

    // Cada pedido contém no máximo 20 IDs. Os lotes são sequenciais para não
    // multiplicar a concorrência global contra a BBD.
    for(let subOffset=0;subOffset<pending.length;subOffset+=batchSize){
     const requestPlayers=pending.slice(subOffset,subOffset+batchSize);
     requestPlayers.forEach(player=>attemptCounts.set(player.id,(attemptCounts.get(player.id)||0)+1));
     try{
      const response=await fetch(`${API_BASE}/api/bbd/player-gamelogs`,{
       method:'POST',credentials:'include',headers:{'content-type':'application/json'},
       body:JSON.stringify({playerIds:requestPlayers.map(player=>player.id),season})
      });
      const payload=await response.json().catch(()=>null) as {results?:Array<{playerId?:string;data?:unknown;error?:string}>;error?:string}|null;
      if(!response.ok){
       for(const player of requestPlayers){
        if(!retryableStatus(response.status))terminalFailures.add(player.id);
        else nextPending.push(player);
       }
       continue;
      }
      const results=Array.isArray(payload?.results)?payload!.results!:[];
      const resultById=new Map<string,{playerId?:string;data?:unknown;error?:string}>();
      for(const result of results){
       if(result&&typeof result.playerId==='string'&&!resultById.has(result.playerId))resultById.set(result.playerId,result);
      }
      for(const player of requestPlayers){
       const result=resultById.get(player.id);
       if(!result||result.error||!Array.isArray(result.data)){
        nextPending.push(player);
        continue;
       }
       successfulResults.set(player.id,{data:result.data});
      }
     }catch{
      requestPlayers.forEach(player=>nextPending.push(player));
     }
    }
    pending=nextPending.filter(player=>!successfulResults.has(player.id));
    if(pending.length&&attempt<maxAttempts)await pause(500*attempt);
   }

   for(const player of batch){
    const result=successfulResults.get(player.id);
    if(!result||terminalFailures.has(player.id)){scanAnalysisCoverage.failed++;continue;}
    if((attemptCounts.get(player.id)||0)>1)scanAnalysisCoverage.retried++;
    if(result.data.length===0){scanAnalysisCoverage.noHistory++;continue;}
    try{
     const rows=adaptBbdGamelog({data:result.data});
     if(!rows.length){scanAnalysisCoverage.failed++;continue;}
     scanAnalysisCoverage.loaded++;
     candidates.push(...rankPlayerTrends(player,rows));
    }catch{
     scanAnalysisCoverage.failed++;
    }
   }
  }
  scanOpportunities=candidates.sort((a,b)=>b.score-a.score).slice(0,10);
  scanAnalysisStatus=scanAnalysisCoverage.loaded===0?'Não foi possível carregar históricos BBD válidos.':`Análise concluída: ${scanOpportunities.length} candidatos seleccionados após avaliar os históricos disponíveis.`;
  target.innerHTML=`<div class="notice"><b>${scanEvents.length} jogos encontrados nas próximas 48 horas</b><p>${escapeHtml(scanRosterStatus)}</p><p>${escapeHtml(scanAnalysisStatus)}</p><p>Históricos: ${scanAnalysisCoverage.loaded} carregados · ${scanAnalysisCoverage.noHistory} sem registos nesta época · ${scanAnalysisCoverage.failed} falhas definitivas · ${scanAnalysisCoverage.retried} recuperados após repetição.</p></div><button class="primary full" id="open-opportunities">Ver shortlist de oportunidades (${scanOpportunities.length})</button>`;
  document.querySelector('#open-opportunities')?.addEventListener('click',()=>{active='opportunities';render();});
 }catch(error){
  target.innerHTML=`<div class="notice"><b>Não foi possível concluir o scanner</b><p>${escapeHtml(String(error))}</p><p>Não foram fabricados jogos nem resultados para datas cuja consulta falhou.</p></div>`;
 }finally{
  button.disabled=false;button.textContent='Voltar a analisar as próximas 48 horas';
 }
}
async function searchBbdPlayer(){
 const input=document.querySelector<HTMLInputElement>('#bbd-player-name');
 const target=document.querySelector<HTMLDivElement>('#bbd-results');
 const button=document.querySelector<HTMLButtonElement>('#bbd-search');
 const name=input?.value.trim()||'';
 if(!target||!button)return;
 if(name.length<2){target.innerHTML='<p class="muted">Introduz pelo menos 2 caracteres.</p>';return;}
 button.disabled=true;button.textContent='A pesquisar na BBD…';
 target.innerHTML='<p class="muted">A consultar a BigBallsData…</p>';
 const seasonInput=document.querySelector<HTMLInputElement>('#bbd-season');
 const season=Number(seasonInput?.value);
 if(!Number.isInteger(season)||season<2019||season>2035){
  target.innerHTML='<p class="muted">Indica uma época válida (ano inicial, por exemplo 2025 para 2025-26).</p>';
  button.disabled=false;button.textContent='Pesquisar jogador na BBD';return;
 }
 try{
  const response=await fetch(`${API_BASE}/api/bbd/player-search?name=${encodeURIComponent(name)}`,{credentials:'include'});
  const payload=await response.json() as {data?:unknown;error?:string};
  if(!response.ok)throw new Error(payload.error||`Pesquisa BBD: HTTP ${response.status}`);
  if(!Array.isArray(payload.data))throw new Error('Resposta BBD inválida: lista de jogadores em falta.');
  bbdPlayers=payload.data.filter((p):p is BbdPlayer=>!!p&&typeof p==='object'&&typeof (p as BbdPlayer).id==='string'&&typeof (p as BbdPlayer).name==='string');
  bbdSelectedPlayer=null;bbdRows=[];bbdProfile=null;
  if(!bbdPlayers.length){target.innerHTML='<p class="muted">Não foram encontrados jogadores com esse nome.</p>';return;}
  target.innerHTML=`<div class="notice"><b>${bbdPlayers.length} resultado(s) encontrados</b><p>Selecciona o jogador correcto para carregar o histórico.</p></div>`+
   bbdPlayers.map(p=>`<div class="source"><span><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.team_name||'Equipa não indicada')} · ${escapeHtml(p.position||'Posição não indicada')}</small></span><button class="secondary" data-bbd-player="${escapeHtml(p.id)}">Carregar histórico</button></div>`).join('');
  target.querySelectorAll<HTMLButtonElement>('[data-bbd-player]').forEach(b=>b.addEventListener('click',()=>{const player=bbdPlayers.find(p=>p.id===b.dataset.bbdPlayer);if(player)void loadBbdGamelog(player);}));
 }catch(error){
  target.innerHTML=`<div class="notice"><b>Falha na pesquisa BBD</b><p>${escapeHtml(String(error))}</p></div>`;
 }finally{
  button.disabled=false;button.textContent='Pesquisar jogador na BBD';
 }
}

async function loadBbdGamelog(player:BbdPlayer){
 const target=document.querySelector<HTMLDivElement>('#bbd-profile');
 const results=document.querySelector<HTMLDivElement>('#bbd-results');
 const season=Number(document.querySelector<HTMLInputElement>('#bbd-season')?.value);
 if(!target)return;
 target.innerHTML='<p class="muted">A carregar histórico jogo a jogo…</p>';
 try{
  const response=await fetch(`${API_BASE}/api/bbd/player-gamelog?playerId=${encodeURIComponent(player.id)}&season=${encodeURIComponent(String(season))}`,{credentials:'include'});
  const payload=await response.json() as {data?:unknown;error?:string;meta?:{cached?:boolean}};
  if(!response.ok)throw new Error(payload.error||`Histórico BBD: HTTP ${response.status}`);
  const rows=adaptBbdGamelog(payload);
  if(!rows.length)throw new Error('A BBD respondeu, mas não foram encontrados registos válidos para esta época.');
  bbdSelectedPlayer=player;bbdRows=rows;bbdProfile=buildPlayerProfile(rows);
  const markets:Market[]=['points','rebounds','assists','threes','pra'];
  const labels:Record<Market,string>={points:'Pontos',rebounds:'Ressaltos',assists:'Assistências',threes:'Triplos',pra:'PRA'};
  const fmt=(v:number|null)=>v===null?'—':v.toFixed(1);
  const marketRows=markets.map(m=>{
   const x=bbdProfile!.markets[m] as {season:{sample:number;mean:number|null;median:number|null};last10:{sample:number;mean:number|null};last5:{sample:number;mean:number|null}};
   return `<div class="source"><span><b>${labels[m]}</b><small>Época: ${x.season.sample} jogos · Média ${fmt(x.season.mean)} · Mediana ${fmt(x.season.median)}</small></span><strong>5J: ${fmt(x.last5.mean)}<br>10J: ${fmt(x.last10.mean)}</strong></div>`;
  }).join('');
  const recent=rows.slice(0,5).map(g=>`<div class="source"><span><b>${escapeHtml(g.date)}</b><small>${g.minutes} min</small></span><strong>${g.points} PTS · ${g.rebounds} REB · ${g.assists} AST · ${g.threes} 3PM · ${g.pra} PRA</strong></div>`).join('');
  target.innerHTML=`<div class="notice"><b>Histórico carregado com sucesso</b><p>${escapeHtml(player.name)} · ${escapeHtml(player.team_name||'Equipa não indicada')} · Época ${season}-${String(season+1).slice(-2)} · ${rows.length} jogos válidos</p></div><h3>Resumo estatístico</h3>${marketRows}<h3>Últimos 5 jogos</h3>${recent}<p class="footnote">Fonte: BigBallsData. Estatísticas descritivas; ainda não representam probabilidades calibradas nem recomendações.</p>`;
  if(results)results.innerHTML=`<div class="notice"><b>${escapeHtml(player.name)} seleccionado</b><p>ID BBD: ${escapeHtml(player.id)}</p></div>`;
 }catch(error){
  target.innerHTML=`<div class="notice"><b>Falha ao carregar histórico</b><p>${escapeHtml(String(error))}</p></div>`;
  bbdSelectedPlayer=null;bbdRows=[];bbdProfile=null;
 }
}

function escapeHtml(value:string){return value.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch));}

function saveOdds(){const player=(document.querySelector('#v-player') as HTMLInputElement)?.value.trim();const line=(document.querySelector('#v-line') as HTMLInputElement)?.value;const odds=(document.querySelector('#v-odds') as HTMLInputElement)?.value;if(!player||!line||!odds||Number(odds)<=1){alert('Preenche jogador, linha e odd decimal válida.');return;}alert('Dados recebidos nesta sessão. Ainda não existe previsão validada associada, por isso não é possível emitir um veredicto de valor.');}

async function startApp(){
 try {
  const response = await fetch(`${API_BASE}/api/health`, { credentials: 'include' });
  authenticated = response.ok;
 } catch { authenticated = false; }
 render();
}
void startApp();
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
