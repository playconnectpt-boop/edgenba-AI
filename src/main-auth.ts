import './style.css';

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

const marketNames: Record<string,string> = {points:'Pontos',rebounds:'Ressaltos',assists:'Assistências',threes:'Triplos'};
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
 document.querySelector('#check-provider')?.addEventListener('click',()=>alert('Ainda não existem credenciais ou contrato de API configurados.'));
};
function dashboard(){return `
 <section class="hero"><p class="eyebrow">NBA · DAILY RESEARCH SYSTEM</p><h1>Investigar tudo.<br><em>Selecionar com critério.</em></h1><p class="sub">Análise integral dos jogos e jogadores. Até 10 oportunidades fundamentadas por dia. O sistema não inventa dados para preencher a lista.</p><div class="hero-actions"><button class="primary" data-tab="scan" id="go-scan">Abrir análise diária</button><button class="secondary" id="install">Instalar aplicação</button></div></section>
 <section class="status-grid"><article class="metric"><span>Jogos analisados hoje</span><strong>—</strong><small>A aguardar fonte de dados</small></article><article class="metric"><span>Mercados avaliados</span><strong>—</strong><small>4 tipos de player props</small></article><article class="metric"><span>Oportunidades aprovadas</span><strong>0</strong><small>Sem dados, sem seleções</small></article></section>
 <section class="panel"><div class="section-head"><div><p class="eyebrow">PIPELINE DE ANÁLISE</p><h2>Como funciona</h2></div><span class="chip">4 fases</span></div><div class="pipeline">${[['01','Cobertura integral','Todos os jogos, jogadores e mercados'],['02','Contexto e cenários','Lesões, minutos, rotações e efeitos indiretos'],['03','Ranking diário','Até 10 oportunidades, sem quotas artificiais'],['04','Validação de valor','A tua odd → probabilidade, odd justa e EV']].map(x=>`<div class="pipe-row"><b>${x[0]}</b><div><strong>${x[1]}</strong><small>${x[2]}</small></div><span>›</span></div>`).join('')}</div></section>
 <section class="panel"><div class="section-head"><div><p class="eyebrow">INTEGRIDADE DOS DADOS</p><h2>Estado das integrações</h2></div></div>${provider('Estatísticas NBA','Histórico jogo a jogo, box scores e minutos','NÃO LIGADO')}${provider('Injury reports','Disponibilidade oficial e atualizações','NÃO LIGADO')}${provider('Calendário NBA','Jogos, equipas e horários','NÃO LIGADO')}<p class="footnote">A interface está preparada. A análise automática só será ativada depois de testar a cobertura, qualidade e proveniência de cada fornecedor.</p></section>`}
function scan(){return `<section class="page-title"><p class="eyebrow">FASE 1 · COBERTURA TOTAL</p><h1>Análise diária</h1><p class="sub">A IA deve percorrer todos os jogos e todos os jogadores relevantes, não apenas nomes pré-selecionados.</p></section><section class="panel"><div class="section-head"><h2>Âmbito obrigatório</h2><span class="chip">NBA</span></div><div class="market-grid">${Object.values(marketNames).map(m=>`<div class="market-card"><b>${m}</b><small>Player props</small></div>`).join('')}</div><div class="check-list">${['Calendário completo e estado dos jogos','Registos individuais jogo a jogo','Minutos, titularidade e rotação','Lesões: out, doubtful, questionable, probable','Cenários com e sem jogadores em dúvida','Impacto na utilização e oportunidades dos colegas','Confronto defensivo, ritmo e contexto','Amostras, outliers e qualidade dos dados'].map(x=>`<div><span>✓</span>${x}</div>`).join('')}</div><button class="primary full" id="run-scan">Consultar calendário e lesões</button><p class="footnote">Esta primeira recolha testa o calendário e o relatório de lesões. Ainda não equivale à análise integral de jogadores nem produz o Top 10.</p><div id="scan-results" class="scan-results" aria-live="polite"><p class="muted">Ainda não foram consultadas fontes.</p></div></section><section class="panel"><p class="eyebrow">CRITÉRIO DE SELEÇÃO</p><h2>Até 10 oportunidades</h2><p class="body-copy">A lista é ordenada por qualidade estatística, estabilidade da projeção, contexto e incerteza. Se só existirem 4 oportunidades que cumpram os critérios, serão apresentadas 4.</p></section>`}
function opportunities(){return `<section class="page-title"><p class="eyebrow">FASE 2 · RANKING</p><h1>Top 10 diário</h1><p class="sub">As melhores oportunidades encontradas depois de analisar toda a NBA.</p></section><section class="empty-state"><div class="empty-icon">◎</div><h2>Ainda sem oportunidades validadas</h2><p>O ranking só será preenchido depois de a recolha de dados e o motor estatístico estarem ligados e testados. Não vamos fabricar candidatos para completar 10 posições.</p><button class="secondary" data-tab="scan">Ver requisitos da análise</button></section>`}
function validator(){return `<section class="page-title"><p class="eyebrow">FASES 3 E 4 · VALIDAÇÃO</p><h1>Validador de aposta</h1><p class="sub">Introduz a linha e a odd da Spinbetter para um mercado previamente analisado.</p></section><section class="panel"><div class="notice"><b>Motor de probabilidade ainda não ligado</b><p>Não introduzas uma probabilidade manual para obter um veredicto. A probabilidade terá de vir do modelo validado e associado à análise selecionada.</p></div><label>Jogador<input id="v-player" placeholder="Selecionar oportunidade analisada" /></label><div class="two"><label>Mercado<select id="v-market">${Object.entries(marketNames).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label>Linha da Spinbetter<input id="v-line" type="number" step="0.5" placeholder="Ex.: 24.5" /></label></div><label>Odd decimal<input id="v-odds" type="number" min="1.01" step="0.01" placeholder="Ex.: 1.90" /></label><button class="primary full" id="save-odds">Guardar dados da cotação</button><p class="footnote">Guardar a cotação não significa recomendar a aposta. O veredicto só será calculado quando existir uma previsão válida para o mesmo jogador, mercado e linha.</p></section><section class="panel"><h2>Critérios do veredicto</h2><div class="verdict-row"><b>VALOR</b><span>EV positivo após ajuste conservador de incerteza.</span></div><div class="verdict-row"><b>SEM VALOR</b><span>Preço insuficiente face à probabilidade estimada.</span></div><div class="verdict-row"><b>DADOS INSUFICIENTES</b><span>Previsão, contexto ou cotação sem validação suficiente.</span></div></section>`}
function history(){return `<section class="page-title"><p class="eyebrow">CONTROLO DE DESEMPENHO</p><h1>Histórico</h1><p class="sub">Registo de previsões, linhas, odds introduzidas, resultados e calibração do modelo.</p></section><section class="status-grid"><article class="metric"><span>Previsões registadas</span><strong>0</strong></article><article class="metric"><span>Taxa de acerto</span><strong>—</strong></article><article class="metric"><span>ROI observado</span><strong>—</strong></article></section><section class="empty-state compact"><h2>Sem histórico disponível</h2><p>Os resultados só serão calculados com previsões guardadas antes dos jogos e resultados oficiais posteriores. O modelo será avaliado fora da amostra.</p></section>`}
function settings(){return `<section class="page-title"><p class="eyebrow">CONFIGURAÇÃO</p><h1>Fontes e segurança</h1><p class="sub">A aplicação é privada e protegida por sessão.</p></section><section class="panel"><h2>Autenticação</h2><p class="body-copy">Acesso protegido pelo Worker Cloudflare. A sessão expira após 7 dias.</p><div class="source-row"><span>Proteção de acesso</span><b class="pending">ATIVA</b></div></section><section class="panel"><h2>Fornecedores de dados</h2>${provider('NBA statistics','Dados históricos e box scores','POR CONFIGURAR')}${provider('Injury report','Estado oficial dos jogadores','POR CONFIGURAR')}<button class="secondary full" id="check-provider">Verificar configuração</button></section><section class="panel"><h2>Política de integridade</h2><ul class="rules"><li>Guardar fonte e timestamp de cada registo.</li><li>Separar factos confirmados de cenários condicionais.</li><li>Não confundir hit rate histórico com probabilidade futura.</li><li>Não declarar EV sem odd válida e previsão calibrada.</li><li>Registar versão do modelo e dados usados.</li></ul></section>`}
function provider(name:string,desc:string,status:string){return `<div class="source"><span><b>${name}</b><small>${desc}</small></span><strong class="pending">${status}</strong></div>`}

async function runScan(){
 const target=document.querySelector<HTMLDivElement>('#scan-results');
 const button=document.querySelector<HTMLButtonElement>('#run-scan');
 if(!target||!button)return;
 button.disabled=true; button.textContent='A consultar fontes…';
 target.innerHTML='<p class="muted">A obter calendário e relatório de lesões. Os resultados serão identificados pela fonte e hora de recolha.</p>';
 const date=new Date(); const ymd=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('');
 try{
  const [gamesRes,injRes]=await Promise.all([fetch(`${API_BASE}/api/espn/scoreboard?date=${ymd}`),fetch(`${API_BASE}/api/espn/injuries`)]);
  if(!gamesRes.ok)throw new Error(`Calendário: HTTP ${gamesRes.status}. Confirma se o Worker está publicado e VITE_API_BASE configurado.`);
  const gamesPayload=await gamesRes.json() as ESPNScoreboard;
  const events=gamesPayload.data.events||[];
  let injuryText='Relatório de lesões indisponível';
  if(injRes.ok){const injuryPayload=await injRes.json() as {retrievedAt:string}; injuryText=`Relatório de lesões consultado (${new Date(injuryPayload.retrievedAt).toLocaleTimeString('pt-PT')})`;}
  const rows=events.map(ev=>{const teams=(ev.competitions?.[0]?.competitors||[]).map(c=>c.team?.displayName||c.team?.abbreviation||'Equipa').join(' vs ');return `<div class="source"><span><b>${escapeHtml(teams||ev.name)}</b><small>${new Date(ev.date).toLocaleString('pt-PT')} · ${escapeHtml(ev.status?.type?.description||'Estado não indicado')}</small></span><strong class="pending">${escapeHtml(ev.id)}</strong></div>`}).join('');
  target.innerHTML=`<div class="notice"><b>${events.length} jogos encontrados</b><p>Fonte: ESPN · Recolhido às ${new Date(gamesPayload.retrievedAt).toLocaleTimeString('pt-PT')} · ${escapeHtml(injuryText)}</p></div>${rows||'<p class="muted">Não há jogos no calendário para esta data. Confirma a data e a época.</p>'}<p class="footnote">Isto valida apenas calendário e disponibilidade da fonte. Não declara que todos os jogadores foram analisados.</p>`;
 }catch(error){target.innerHTML=`<div class="notice"><b>Não foi possível concluir a consulta</b><p>${escapeHtml(String(error))}</p><p>O sistema não substituiu dados em falta por estimativas.</p></div>`;}
 finally{button.disabled=false;button.textContent='Voltar a consultar calendário e lesões';}
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
