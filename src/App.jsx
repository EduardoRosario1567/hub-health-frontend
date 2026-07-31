import { useState, useRef, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Hub Health — v2 (PATCH 03)
//
// Novidades desta versão:
//   1. Contrato alinhado ao schema exato do backend: state{label,score,
//      confidence}, sources[], findings[{source,urgency,detail}],
//      actions[{title,impact,time,cta,url}], upsell{}.
//   2. Score deixou de ser a manchete — o status do negócio ("Em Risco",
//      "Atenção", "Protegida") é o texto principal; o score vira badge
//      secundário, pequeno, ao lado.
//   3. Checkout iniciado pelo backend (POST /v1/checkout) — não mais
//      construído só no client. O backend salva o lead e devolve a URL.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://hub-trust-backend-production.up.railway.app";

function getUTM() {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const utm = {};
  ["utm_source","utm_medium","utm_campaign","utm_content","utm_term"].forEach(k => {
    if (p.get(k)) utm[k] = p.get(k);
  });
  return utm;
}

async function registrarLead(dados) {
  const payload = { ...dados, utm: getUTM() };
  if (!API_BASE) { console.log("EVENTO (backend não configurado):", payload); return true; }
  try {
    const r = await fetch(`${API_BASE}/v1/leads`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    return r.ok;
  } catch { return false; }
}

async function iniciarCheckout(dados) {
  const payload = { ...dados, utm: getUTM() };
  if (!API_BASE) { console.log("CHECKOUT (backend não configurado):", payload); return { ok: false, checkoutUrl: null }; }
  try {
    const r = await fetch(`${API_BASE}/v1/checkout`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    return await r.json();
  } catch { return { ok: false, checkoutUrl: null }; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fmtCNPJ(v) {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d.replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function validateCNPJ(cnpj) {
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (s, l) => {
    let t = 0, p = l - 7;
    for (let i = l; i >= 1; i--) { t += parseInt(s[l - i]) * p--; if (p < 2) p = 9; }
    return t % 11 < 2 ? 0 : 11 - (t % 11);
  };
  return calc(d, 12) === parseInt(d[12]) && calc(d, 13) === parseInt(d[13]);
}

async function fetchAuditReal(digits, addLog) {
  if (!API_BASE) return null;
  addLog("📡", "Conectando ao Hub Health…");
  try {
    const r = await fetch(`${API_BASE}/v1/audit/${digits}`);
    if (!r.ok) throw new Error(`Backend retornou ${r.status}`);
    const contrato = await r.json();
    addLog("✅", "Resposta recebida");
    return contrato;
  } catch (e) {
    addLog("⚠️", `Backend indisponível (${e.message}) — caindo para modo simulação`);
    return null;
  }
}

// ── Fallback DEMO — mesmo contrato, dados simulados, sempre rotulados ──────
const DEMO_CASOS = {
  "69210953000180": {
    razaoSocial: "TOBIAS MELO SERVICOS LTDA", situacao: "ATIVA", porte: "ME", regime: "SIMPLES_NACIONAL",
    cnae: { cod: "74.90-1/04", desc: "Atividades de intermediação e agenciamento de serviços" },
    municipio: "Goiânia", uf: "GO", capitalSocial: 80000,
    socios: [{ nome: "RAPHAEL TOBIAS DE MELO", qualificacao: "Sócio-Administrador" }, { nome: "AUGUSTO SILVA MELO", qualificacao: "Sócio" }],
    findings: [
      { source: "Certidão PGFN/RFB", urgency: "critical", detail: "Débito ativo: R$ 18.430,00 — IRPJ/CSLL referente 2022/2023. Inscrição em Dívida Ativa.", preview: true },
      { source: "FGTS / CRF", urgency: "high", detail: "CRF vencido desde 14/04/2026. Competências mar/2026 e abr/2026 em aberto.", preview: true },
      { source: "CNDT (Trabalhista)", urgency: "high", detail: "Débito trabalhista: R$ 6.200,00 — Reclamação proc. 0001234-45.2025.5.18.0001.", preview: true },
    ],
  },
};

const _URGENCIA_IMPACTO = { critical: "Muito alto", high: "Alto", medium: "Médio" };
const _URGENCIA_TEMPO = { critical: "5 minutos", high: "10 minutos", medium: "15 minutos" };
function guidedUrlPorFonte(nome) {
  const m = { "Certidão PGFN/RFB": "https://www.regularize.pgfn.gov.br", "FGTS / CRF": "https://consulta-crf.caixa.gov.br", "CNDT (Trabalhista)": "https://certidao.tst.jus.br" };
  return m[nome] || "#";
}

function toDemoContract(cnpj, digits) {
  const base = DEMO_CASOS[digits];
  const temDebito = parseInt(digits[7]) % 2 === 0;
  const findings = base ? base.findings : (temDebito ? [
    { source: "Certidão PGFN/RFB", urgency: "critical", detail: `Débito ativo: R$ ${(parseInt(digits.slice(0,5))%50000+5000).toLocaleString("pt-BR")},00 — IRPJ em aberto.`, preview: true },
  ] : []);
  const company = base || {
    razaoSocial: `EMPRESA ${digits.slice(0,3)}.${digits.slice(3,6)} LTDA`, situacao: "ATIVA",
    porte: parseInt(digits[5]) % 10 < 7 ? "ME" : "EPP", regime: "SIMPLES_NACIONAL",
    cnae: { cod: "62.01-5/01", desc: "Desenvolvimento de programas de computador sob encomenda" },
    municipio: "São Paulo", uf: "SP", capitalSocial: 50000,
    socios: [{ nome: `SÓCIO ${digits.slice(0,6)}`, qualificacao: "Sócio-Administrador" }],
  };

  const actions = findings.map(f => ({ title: `Resolver ${f.source}`, impact: _URGENCIA_IMPACTO[f.urgency], time: _URGENCIA_TEMPO[f.urgency], cta: "Resolver agora", url: guidedUrlPorFonte(f.source) }));
  const nomesComFinding = findings.map(f => f.source);
  const guiadas = [
    ["Certidão PGFN/RFB", "https://www.regularize.pgfn.gov.br"], ["FGTS / CRF", "https://consulta-crf.caixa.gov.br"],
    ["CNDT (Trabalhista)", "https://certidao.tst.jus.br"], ["eSocial", "https://esocial.gov.br"], ["DCTFWeb", "https://cav.receita.fazenda.gov.br"],
  ].filter(([nome]) => !nomesComFinding.includes(nome));
  guiadas.forEach(([nome, url]) => actions.push({ title: `Verificar ${nome} manualmente`, impact: _URGENCIA_IMPACTO.medium, time: _URGENCIA_TEMPO.medium, cta: "Verificar agora", url }));

  const sources = [
    { id: "rfb", name: "Receita Federal", type: "automatic", status: "ok", detail: "Situação cadastral ATIVA (simulação).", guidedUrl: null },
    { id: "ceis", name: "CEIS / CNEP", type: "automatic", status: "ok", detail: "Nenhuma sanção encontrada (simulação).", guidedUrl: null },
    ...["Certidão PGFN/RFB","FGTS / CRF","CNDT (Trabalhista)","eSocial","DCTFWeb"].map(nome => ({
      id: nome, name: nome, type: "guided",
      status: nomesComFinding.includes(nome) ? "critical" : "pending",
      detail: nomesComFinding.includes(nome) ? "Simulação — pendência encontrada." : "Fonte não conectada — verificar manualmente.",
      guidedUrl: guidedUrlPorFonte(nome) !== "#" ? guidedUrlPorFonte(nome) : "https://esocial.gov.br",
    })),
  ];

  let score = 100;
  findings.forEach(f => { score -= f.urgency === "critical" ? 25 : f.urgency === "high" ? 15 : 8; });
  score = Math.max(0, Math.min(100, score));
  const label = score >= 80 ? "Protegida" : score >= 60 ? "Atenção" : "Em Risco";

  return {
    cnpj: digits, mode: "DEMO", auditedAt: new Date().toISOString(),
    company: { cnpj, ...company },
    state: { label, score, confidence: 75 },
    sources, findings, actions,
    upsell: { plan: "fundador", message: "Posso avisar quando algo mudar", price: "R$ 19,90/mês" },
  };
}

const T = {
  bg:"#07090F", surface:"#0D1117", surface2:"#111827",
  border:"#1A2235", borderLight:"#1E2D42",
  accent:"#14B8A6", accentDim:"#14B8A608",
  success:"#10B981", warning:"#F59E0B", danger:"#EF4444",
  purple:"#0EA5E9", muted:"#374151",
  text:"#E4EAF4", sub:"#6B7FA0",
};

const Card = ({ children, style={} }) => (
  <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:16, padding:20, ...style }}>{children}</div>
);
const Chip = ({ label, color=T.muted }) => (
  <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", padding:"3px 10px", borderRadius:99, background:color+"20", color, border:`1px solid ${color}35`, whiteSpace:"nowrap" }}>{label}</span>
);
const Logo = ({ size=28 }) => (
  <div style={{ width:size, height:size, borderRadius:size*.28, background:"linear-gradient(135deg,#14B8A6,#0EA5E9)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:size*.5, color:"#fff", flexShrink:0 }}>H</div>
);
const Wordmark = ({ small }) => (
  <span style={{ fontWeight:900, fontSize:small?15:20, letterSpacing:"-.03em" }}>Hub<span style={{ color:T.accent }}>Health</span></span>
);

const urgColor = { critical:T.danger, high:T.warning, medium:T.accent };
const urgLabel = { critical:"Crítico", high:"Alto", medium:"Médio" };
const stateColor = { "Protegida":T.success, "Atenção":T.warning, "Em Risco":T.danger };
const stateIcon = { "Protegida":"🟢", "Atenção":"🟡", "Em Risco":"🔴" };

// ── Landing ──────────────────────────────────────────────────────────────
// ── HeroMap — cena de rede viva sobre o Brasil ──────────────────────────────
// SVG + CSS puro, sem canvas/vídeo/imagem externa. Pontos verdes pulsam de
// forma assíncrona, com glow real via filtro SVG (feGaussianBlur), textura
// de fundo com pontinhos estáticos, e linhas convergindo para o selo "H".
// Respeita prefers-reduced-motion suavizando a animação.
const BR_PONTOS = [
  { nome:"Manaus", x:88, y:78 },
  { nome:"Belém", x:172, y:64 },
  { nome:"Fortaleza", x:248, y:82 },
  { nome:"Recife", x:274, y:122 },
  { nome:"Salvador", x:246, y:168 },
  { nome:"Brasília", x:188, y:188, hub:true },
  { nome:"Belo Horizonte", x:212, y:214 },
  { nome:"Rio de Janeiro", x:222, y:250 },
  { nome:"São Paulo", x:194, y:256 },
  { nome:"Curitiba", x:178, y:280 },
  { nome:"Porto Alegre", x:162, y:316 },
];
const BRASIL_PATH = "M 96 40 C 130 30, 175 34, 205 46 C 235 52, 262 66, 278 90 C 292 110, 296 132, 282 150 C 296 166, 290 188, 272 196 C 280 216, 268 236, 248 244 C 250 264, 236 282, 216 288 C 214 306, 198 322, 178 324 C 162 330, 144 322, 136 306 C 118 302, 106 286, 108 268 C 90 260, 80 242, 86 224 C 68 214, 60 194, 70 176 C 56 162, 54 140, 68 124 C 60 106, 68 86, 86 76 C 82 60, 86 46, 96 40 Z";

// Pontinhos decorativos fixos (textura de "rede" no fundo do mapa) — posições
// pseudo-aleatórias mas determinísticas, geradas uma vez.
function gerarTextura(n, seed) {
  const pts = [];
  let s = seed;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < n; i++) pts.push({ x: 30 + rand()*280, y: 30 + rand()*300, r: 0.6 + rand()*1 });
  return pts;
}
const TEXTURA = gerarTextura(38, 7);

function HeroMap() {
  const hub = BR_PONTOS.find(p => p.hub);
  return (
    <div style={{ position:"relative", width:"100%", maxWidth:380, margin:"0 auto", aspectRatio:"1/1.05" }} aria-hidden="true">
      <style>{`
        @keyframes hmPulseDot { 0%,100%{ transform:scale(1); opacity:.9 } 50%{ transform:scale(1.9); opacity:.2 } }
        @keyframes hmGlowCenter { 0%,100%{ opacity:.4; transform:scale(1) } 50%{ opacity:.8; transform:scale(1.15) } }
        @keyframes hmLineFade { 0%,100%{ opacity:.1 } 50%{ opacity:.4 } }
        @keyframes hmTwinkle { 0%,100%{ opacity:.15 } 50%{ opacity:.5 } }
        @media (prefers-reduced-motion: reduce) {
          .hm-dot-pulse, .hm-glow, .hm-line, .hm-twinkle { animation: none !important; opacity: .4 !important; }
        }
      `}</style>
      <svg viewBox="0 0 340 340" width="100%" height="100%" style={{ overflow:"visible" }}>
        <defs>
          <linearGradient id="hmGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#14B8A6"/><stop offset="100%" stopColor="#0EA5E9"/>
          </linearGradient>
          <filter id="hmBlur" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.2"/>
          </filter>
          <filter id="hmBlurBig" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="7"/>
          </filter>
        </defs>

        <path d={BRASIL_PATH} fill={T.success+"0a"} stroke={T.success+"30"} strokeWidth="1.2"/>

        {TEXTURA.map((p,i)=>(
          <circle key={"t"+i} className="hm-twinkle" cx={p.x} cy={p.y} r={p.r} fill={T.success} opacity=".25"
            style={{ animation:`hmTwinkle ${2.6+(i%6)*0.5}s ease-in-out ${i*0.18}s infinite` }}/>
        ))}

        {BR_PONTOS.filter(p=>!p.hub).map((p,i)=>(
          <line key={"l"+i} className="hm-line" x1={hub.x} y1={hub.y} x2={p.x} y2={p.y}
            stroke={T.success} strokeWidth="0.8" opacity=".18"
            style={{ animation:`hmLineFade ${3.4+ (i%4)*0.6}s ease-in-out ${i*0.31}s infinite` }}/>
        ))}

        {BR_PONTOS.filter(p=>!p.hub).map((p,i)=>(
          <g key={"d"+i}>
            <circle className="hm-dot-pulse" cx={p.x} cy={p.y} r="9" fill={T.success} filter="url(#hmBlur)"
              style={{ transformOrigin:`${p.x}px ${p.y}px`, animation:`hmPulseDot ${2.2+(i%5)*0.35}s ease-in-out ${i*0.42}s infinite` }}/>
            <circle cx={p.x} cy={p.y} r="2.6" fill="#D1FFEB"/>
          </g>
        ))}

        <circle className="hm-glow" cx={hub.x} cy={hub.y} r="30" fill={T.accent} opacity=".35" filter="url(#hmBlurBig)"
          style={{ transformOrigin:`${hub.x}px ${hub.y}px`, animation:"hmGlowCenter 4s ease-in-out infinite" }}/>
        <circle cx={hub.x} cy={hub.y} r="13" fill="url(#hmGrad)"/>
        <text x={hub.x} y={hub.y+4.5} textAnchor="middle" fontSize="13" fontWeight="900" fill="#031018">H</text>
      </svg>
    </div>
  );
}

// ── Cards flutuantes de fontes verificadas — prova de valor ao lado do mapa
function LiveCheckCard({ nome, status, detalhe }) {
  const ok = status === "ok";
  const color = ok ? T.success : T.warning;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:T.surface, border:`1px solid ${T.border}`, borderRadius:12 }}>
      <span style={{ fontSize:16, color }}>{ok ? "✓" : "!"}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.06em", textTransform:"uppercase", color:T.muted }}>{nome}</div>
        <div style={{ fontSize:12, fontWeight:700, color }}>{detalhe}</div>
      </div>
    </div>
  );
}

const NAV_LINKS = [
  ["Como funciona", "#como-funciona"],
  ["Planos", "#planos"],
  ["Recursos", "#recursos"],
];

function ScreenLanding({ onStart }) {
  return (
    <div style={{ minHeight:"100vh", background:T.bg, color:T.text, fontFamily:"'Inter',-apple-system,sans-serif" }}>
      <style>{`
        @keyframes up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
        .hh-nav-links{ display:none; }
        @media (min-width: 760px){ .hh-nav-links{ display:flex; } }
      `}</style>

      {/* Nav */}
      <div style={{ borderBottom:`1px solid ${T.border}` }}>
        <div style={{ maxWidth:960, margin:"0 auto", padding:"14px 20px", display:"flex", alignItems:"center", gap:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <Logo/><Wordmark/>
          </div>
          <div className="hh-nav-links" style={{ gap:24, flex:1 }}>
            {NAV_LINKS.map(([label,href])=>(
              <a key={label} href={href} style={{ fontSize:13, color:T.sub, textDecoration:"none", fontWeight:600 }}>{label}</a>
            ))}
          </div>
          <div style={{ flex:1 }}/>
          <button onClick={onStart} style={{ marginLeft:"auto", padding:"9px 16px", borderRadius:10, border:`1px solid ${T.success}`, background:"transparent", color:T.success, fontWeight:700, fontSize:12, cursor:"pointer", whiteSpace:"nowrap" }}>
            Fazer check-up →
          </button>
        </div>
      </div>

      <div style={{ maxWidth:520, margin:"0 auto", padding:"40px 24px 60px", animation:"up .5s ease both" }}>

        <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"6px 14px", borderRadius:99, background:T.success+"14", border:`1px solid ${T.success}35`, marginBottom:20 }}>
          <span style={{ width:7, height:7, borderRadius:"50%", background:T.success }}/>
          <span style={{ fontSize:11, fontWeight:800, letterSpacing:"0.06em", textTransform:"uppercase", color:T.success }}>O Guardian da sua empresa</span>
        </div>

        <div style={{ fontWeight:900, fontSize:34, lineHeight:1.15, letterSpacing:"-.03em", marginBottom:16 }}>
          Sua empresa está saudável<span style={{ color:T.sub }}>…</span><br/>
          <span style={{ color:T.success }}>ou só parece estar?</span>
        </div>
        <div style={{ fontSize:16, color:T.sub, lineHeight:1.7, marginBottom:28 }}>
          Monitoramos continuamente as principais informações da sua empresa e alertamos você
          antes que pequenos problemas virem grandes prejuízos.
        </div>

        <button onClick={onStart} style={{ width:"100%", padding:"16px", borderRadius:14, border:"none", background:`linear-gradient(135deg, ${T.success}, ${T.accent})`, color:"#031018", fontWeight:800, fontSize:16, cursor:"pointer", marginBottom:10 }}>
          Fazer check-up gratuito →
        </button>
        <a href="#demonstracao" style={{ display:"block", textAlign:"center", fontSize:13, color:T.sub, textDecoration:"underline", marginBottom:28 }}>
          Ver exemplo de resultado ↓
        </a>

        <div style={{ display:"flex", flexWrap:"wrap", gap:16, justifyContent:"center", marginBottom:40 }}>
          {[
            ["💳","Sem cartão de crédito"],
            ["⏱️","Resultado em minutos"],
            ["🛡️","100% online e seguro"],
          ].map(([icon,label],i)=>(
            <div key={i} style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:T.muted }}>
              <span>{icon}</span>{label}
            </div>
          ))}
        </div>

        {/* Cena viva — Guardian observando o Brasil */}
        <div id="demonstracao" style={{ textAlign:"center", marginBottom:16 }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:T.muted }}>O Guardian nunca dorme</div>
        </div>
        <HeroMap/>

        <div style={{ display:"grid", gap:8, margin:"20px 0 12px" }}>
          <LiveCheckCard nome="Receita Federal" status="ok" detalhe="Regular"/>
          <LiveCheckCard nome="FGTS" status="ok" detalhe="Sem pendências"/>
          <LiveCheckCard nome="PGFN" status="alerta" detalhe="Débito identificado — ação recomendada"/>
          <LiveCheckCard nome="Simples Nacional" status="ok" detalhe="Ativo"/>
        </div>
        <div style={{ textAlign:"center", fontSize:12, color:T.muted, lineHeight:1.6, margin:"8px 0 40px" }}>
          Exemplo ilustrativo — o seu check-up mostra a situação real da sua empresa.
        </div>

        {/* 4 benefícios */}
        <div id="recursos" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:40 }}>
          {[
            ["🛡️","Monitore 24/7","Acompanhamento contínuo das principais fontes oficiais."],
            ["🔔","Alertas Inteligentes","Se algo mudar, você é avisado na hora."],
            ["📋","Ações Recomendadas","Não é só informação — você recebe o que fazer."],
            ["📊","Decisões Seguras","Clareza pra planejar e crescer com segurança."],
          ].map(([icon,title,desc],i)=>(
            <Card key={i} style={{ padding:14 }}>
              <div style={{ width:34, height:34, borderRadius:10, background:T.success+"14", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, marginBottom:10 }}>{icon}</div>
              <div style={{ fontWeight:700, fontSize:13, marginBottom:4 }}>{title}</div>
              <div style={{ fontSize:12, color:T.sub, lineHeight:1.5 }}>{desc}</div>
            </Card>
          ))}
        </div>

        <button onClick={onStart} style={{ width:"100%", padding:"16px", borderRadius:14, border:`1px solid ${T.success}`, background:"transparent", color:T.success, fontWeight:700, fontSize:15, cursor:"pointer" }}>
          Fazer check-up gratuito →
        </button>
      </div>
    </div>
  );
}


function ScreenInput({ onSubmit, error, onBack }) {
  const [cnpj, setCnpj] = useState("69.210.953/0001-80");
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);
  useEffect(()=>{ ref.current?.focus(); },[]);
  const go = async () => { if(loading) return; setLoading(true); await onSubmit(cnpj); setLoading(false); };
  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24, fontFamily:"'Inter',-apple-system,sans-serif", color:T.text }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}`}</style>
      <div style={{ maxWidth:440, width:"100%", animation:"up .55s ease both" }}>
        <div onClick={onBack} style={{ display:"flex", alignItems:"center", gap:12, marginBottom:52, cursor:"pointer" }}>
          <Logo/><Wordmark/>
        </div>
        <div style={{ fontWeight:900, fontSize:26, lineHeight:1.2, marginBottom:12 }}>Qual o CNPJ da empresa?</div>
        <div style={{ fontSize:14, color:T.sub, lineHeight:1.6, marginBottom:32 }}>Verificamos direto nas fontes oficiais e devolvemos o veredito.</div>
        <Card style={{ padding:20, marginBottom:14 }}>
          <div style={{ display:"flex", gap:10 }}>
            <input ref={ref} value={cnpj} onChange={e=>setCnpj(fmtCNPJ(e.target.value))} onKeyDown={e=>e.key==="Enter"&&go()} placeholder="00.000.000/0000-00"
              style={{ flex:1, background:T.bg, border:`1px solid ${T.border}`, borderRadius:12, padding:"13px 16px", color:T.text, fontSize:16, fontVariantNumeric:"tabular-nums", outline:"none" }}/>
            <button onClick={go} disabled={loading} style={{ padding:"0 20px", borderRadius:12, border:"none", background:loading?T.border:"linear-gradient(135deg,#14B8A6,#0EA5E9)", color:loading?T.muted:"#031018", fontWeight:800, fontSize:13, cursor:loading?"default":"pointer", display:"flex", alignItems:"center", gap:8, minWidth:130, justifyContent:"center" }}>
              {loading?<><div style={{ width:18, height:18, borderRadius:"50%", border:"2px solid #333", borderTop:`2px solid ${T.accent}`, animation:"spin .7s linear infinite" }}/><span>…</span></>:"Auditar →"}
            </button>
          </div>
          {error&&<div style={{ marginTop:12, padding:"10px 14px", borderRadius:10, background:T.danger+"15", border:`1px solid ${T.danger}35`, fontSize:13, color:T.danger }}>{error}</div>}
        </Card>
      </div>
    </div>
  );
}

function ScreenLoading({ logs }) {
  const end = useRef(null);
  useEffect(()=>{ end.current?.scrollIntoView({ behavior:"smooth" }); },[logs]);
  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:24, fontFamily:"'Inter',-apple-system,sans-serif" }}>
      <div style={{ maxWidth:440, width:"100%" }}>
        <div style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{ fontSize:40, marginBottom:14 }}>🔍</div>
          <div style={{ fontWeight:800, fontSize:22, color:T.text, marginBottom:6 }}>Fazendo o check-up…</div>
        </div>
        <Card>
          {logs.map((l,i)=>(
            <div key={i} style={{ display:"flex", gap:12, padding:"9px 0", borderBottom:i<logs.length-1?`1px solid ${T.border}`:"none" }}>
              <span style={{ fontSize:16, width:24, textAlign:"center", flexShrink:0 }}>{l.icon}</span>
              <div><div style={{ fontSize:13, color:T.sub }}>{l.msg}</div></div>
            </div>
          ))}
          <div ref={end}/>
        </Card>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );
}

// ── CTA de checkout — inicia via backend (POST /v1/checkout) ───────────────
function CheckoutCTA({ audit }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null); // null | "sem_checkout" | "erro"

  const assinar = async () => {
    if (!/\S+@\S+\.\S+/.test(email)) return;
    setLoading(true);
    const res = await iniciarCheckout({
      email, cnpj: audit.cnpj, companyName: audit.company.razaoSocial, sourceMode: audit.mode,
      selectedPlan: "fundador", resultSnapshot: { score: audit.state.score, label: audit.state.label },
    });
    setLoading(false);
    if (res.ok && res.checkoutUrl) {
      window.open(res.checkoutUrl, "_blank");
    } else {
      setStatus("sem_checkout");
    }
  };

  return (
    <Card style={{ background:`linear-gradient(135deg, ${T.surface}, ${T.surface2})`, border:`1px solid ${T.accent}40` }}>
      <div style={{ fontWeight:800, fontSize:15, marginBottom:6 }}>{audit.upsell?.message || "Posso avisar quando algo mudar"}</div>
      <div style={{ fontSize:13, color:T.sub, lineHeight:1.6, marginBottom:14 }}>
        Essa é a foto de hoje, grátis. Assine o monitoramento contínuo e a gente avisa assim que surgir algo novo.
      </div>
      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="seu@email.com"
        style={{ width:"100%", boxSizing:"border-box", padding:"11px 14px", borderRadius:10, background:T.surface2, border:`1px solid ${T.border}`, color:T.text, fontSize:13, marginBottom:10, outline:"none" }}/>
      <button onClick={assinar} disabled={loading} style={{ width:"100%", padding:"12px", borderRadius:12, border:"none", background:`linear-gradient(135deg, ${T.accent}, ${T.purple})`, color:"#031018", fontWeight:700, fontSize:14, cursor:"pointer", opacity:loading?.7:1 }}>
        {loading ? "Preparando checkout…" : `Ativar proteção contínua — ${audit.upsell?.price || "R$ 19,90/mês"} →`}
      </button>
      {status==="sem_checkout" && (
        <div style={{ marginTop:10, fontSize:11, color:T.warning }}>⚠ Seu e-mail já foi salvo. O checkout ainda está sendo configurado — te avisamos assim que abrir.</div>
      )}
    </Card>
  );
}

function ScreenResult({ audit, onReset }) {
  const [tab, setTab] = useState("home");
  const { label, score, confidence } = audit.state;
  const color = stateColor[label] || T.muted;
  const sitColor = audit.company.situacao==="ATIVA"?T.success:T.danger;
  const criticos = audit.findings.filter(f=>f.urgency==="critical");
  const altos = audit.findings.filter(f=>f.urgency==="high");

  const tabs = [
    { id:"home", label:"Situação" },
    { id:"achados", label:`Achados ${audit.findings.length>0?`(${audit.findings.length})`:""}` },
    { id:"fontes", label:"Fontes" },
    { id:"perfil", label:"Perfil" },
  ];

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:"'Inter',-apple-system,sans-serif", color:T.text }}>
      <style>{`@keyframes up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`}</style>

      <div style={{ position:"sticky", top:0, zIndex:50, background:T.bg+"f0", backdropFilter:"blur(16px)", borderBottom:`1px solid ${T.border}` }}>
        <div style={{ maxWidth:680, margin:"0 auto", padding:"0 16px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, height:54 }}>
            <Logo size={28}/><Wordmark small/>
            {audit.mode==="DEMO" && <span style={{ fontSize:10, fontWeight:800, padding:"3px 9px", borderRadius:99, background:T.warning+"18", color:T.warning, border:`1px solid ${T.warning}30` }}>SIMULAÇÃO</span>}
            <div style={{ flex:1 }}/>
            <button onClick={onReset} style={{ padding:"7px 14px", borderRadius:8, border:`1px solid ${T.border}`, background:"transparent", color:T.sub, fontSize:12, fontWeight:600, cursor:"pointer" }}>Nova consulta</button>
          </div>
          <div style={{ display:"flex", overflowX:"auto" }}>
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"10px 16px", border:"none", borderBottom:tab===t.id?`2px solid ${T.accent}`:"2px solid transparent", background:"transparent", color:tab===t.id?T.accent:T.sub, fontWeight:tab===t.id?700:500, fontSize:13, cursor:"pointer", whiteSpace:"nowrap" }}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth:680, margin:"0 auto", padding:"24px 16px 80px" }}>

        {tab==="home" && (
          <div style={{ display:"grid", gap:16, animation:"up .5s ease both" }}>
            {/* Estado do negócio é a manchete — score vira badge secundário */}
            <Card style={{ background:`linear-gradient(135deg,${T.surface} 55%,${color}0c)`, borderColor:color+"40" }}>
              <div style={{ fontSize:12, color:T.muted, marginBottom:4 }}>{audit.company.razaoSocial}</div>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <span style={{ fontSize:28 }}>{stateIcon[label]}</span>
                <span style={{ fontWeight:900, fontSize:26, color, letterSpacing:"-.02em" }}>{label}</span>
                <span style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:4, padding:"4px 10px", borderRadius:99, background:T.surface2, border:`1px solid ${T.border}`, fontSize:11, color:T.muted }}>
                  score <strong style={{ color:T.sub }}>{score}</strong>/100
                </span>
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12 }}>
                <Chip label={audit.company.situacao} color={sitColor}/>
                {audit.company.regime && <Chip label={audit.company.regime==="SIMPLES_NACIONAL"?"Simples Nacional":audit.company.regime} color={T.accent}/>}
                {audit.company.porte && <Chip label={audit.company.porte} color={T.muted}/>}
              </div>
              <div style={{ fontSize:14, color:T.sub, lineHeight:1.7 }}>
                {criticos.length>0||altos.length>0
                  ? <>Encontrei <strong style={{ color:T.danger }}>{criticos.length} achado(s) crítico(s)</strong> e <strong style={{ color:T.warning }}>{altos.length} de alta prioridade</strong>.</>
                  : "Nenhum achado crítico nas fontes verificadas."}
                {" "}Confiança da análise: {confidence}%.
              </div>
            </Card>

            {audit.findings.slice(0,3).map((f,i)=>(
              <Card key={i} style={{ padding:"14px 16px", borderLeft:`3px solid ${urgColor[f.urgency]||T.muted}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                  <span style={{ fontWeight:700, fontSize:14 }}>{f.source}</span>
                  <Chip label={urgLabel[f.urgency]||f.urgency} color={urgColor[f.urgency]||T.muted}/>
                </div>
                <div style={{ fontSize:13, color:T.sub, lineHeight:1.6 }}>{f.detail}</div>
              </Card>
            ))}
            {audit.findings.length>3 && (
              <button onClick={()=>setTab("achados")} style={{ padding:"11px", borderRadius:10, border:`1px solid ${T.border}`, background:"transparent", color:T.sub, fontSize:13, fontWeight:600, cursor:"pointer" }}>Ver todos os {audit.findings.length} achados →</button>
            )}

            <CheckoutCTA audit={audit}/>
          </div>
        )}

        {tab==="achados" && (
          <div style={{ animation:"up .5s ease both" }}>
            <div style={{ fontSize:20, fontWeight:800, marginBottom:4 }}>Achados e Próximas Ações</div>
            <div style={{ fontSize:13, color:T.sub, marginBottom:20 }}>{audit.findings.length} achado(s) · {criticos.length} crítico(s) · {altos.length} alta prioridade</div>

            {audit.findings.length===0 ? (
              <Card style={{ textAlign:"center", padding:40, marginBottom:16 }}>
                <div style={{ fontSize:40, marginBottom:12 }}>✅</div>
                <div style={{ fontWeight:700, color:T.success, fontSize:18 }}>Nenhum achado crítico</div>
              </Card>
            ) : (
              <div style={{ display:"grid", gap:10, marginBottom:16 }}>
                {audit.findings.map((f,i)=>{
                  const action = audit.actions.find(a=>a.title.includes(f.source));
                  return (
                    <Card key={i} style={{ padding:"16px 18px", borderLeft:`3px solid ${urgColor[f.urgency]||T.muted}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:8 }}>
                            <span style={{ fontWeight:700, fontSize:15 }}>{f.source}</span>
                            <Chip label={urgLabel[f.urgency]||f.urgency} color={urgColor[f.urgency]||T.muted}/>
                            {f.preview && <Chip label="Simulação" color={T.warning}/>}
                          </div>
                          <div style={{ fontSize:13, color:T.sub, lineHeight:1.7 }}>{f.detail}</div>
                          {action && <div style={{ fontSize:11, color:T.muted, marginTop:8 }}>Impacto: {action.impact} · Tempo estimado: {action.time}</div>}
                        </div>
                        {action?.url && <a href={action.url} target="_blank" rel="noreferrer" style={{ padding:"7px 12px", borderRadius:8, border:`1px solid ${urgColor[f.urgency]}44`, background:(urgColor[f.urgency]||T.muted)+"12", color:urgColor[f.urgency], fontSize:11, fontWeight:700, textDecoration:"none", whiteSpace:"nowrap" }}>{action.cta} ↗</a>}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            <CheckoutCTA audit={audit}/>
          </div>
        )}

        {tab==="fontes" && (
          <div style={{ animation:"up .5s ease both" }}>
            <div style={{ fontSize:20, fontWeight:800, marginBottom:4 }}>Cobertura de Fontes</div>
            <div style={{ fontSize:13, color:T.sub, marginBottom:16 }}>Confiança atual: {confidence}%</div>
            <div style={{ display:"grid", gap:8 }}>
              {audit.sources.map((f,i)=>{
                const statusColor = { ok:T.success, critical:T.danger, pending:T.muted }[f.status] || T.muted;
                const statusLabel = { ok:"Regular", critical:"Pendência encontrada", pending:"Não conectada" }[f.status] || f.status;
                return (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", background:T.surface, border:`1px solid ${T.border}`, borderRadius:12 }}>
                    <div style={{ flex:1 }}>
                      <span style={{ fontWeight:700, fontSize:13 }}>{f.name}</span>
                      <div style={{ fontSize:12, color:T.sub, marginTop:2 }}>{f.detail}</div>
                    </div>
                    <Chip label={f.type==="automatic"?"Automática":"Guiada"} color={f.type==="automatic"?T.success:T.warning}/>
                    <Chip label={statusLabel} color={statusColor}/>
                    {f.guidedUrl && f.status!=="ok" && <a href={f.guidedUrl} target="_blank" rel="noreferrer" style={{ padding:"6px 12px", borderRadius:8, border:`1px solid ${T.accent}44`, background:T.accent+"15", color:T.accent, fontSize:11, fontWeight:700, textDecoration:"none" }}>Verificar →</a>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab==="perfil" && (
          <div style={{ animation:"up .5s ease both" }}>
            <div style={{ fontSize:20, fontWeight:800, marginBottom:4 }}>Perfil da Empresa</div>
            <div style={{ fontSize:13, color:T.sub, marginBottom:20 }}>Dados cadastrais oficiais.</div>
            <Card style={{ marginBottom:14 }}>
              {[
                ["Razão Social", audit.company.razaoSocial], ["Nome Fantasia", audit.company.nomeFantasia],
                ["CNPJ", audit.company.cnpj], ["Situação", audit.company.situacao],
                ["Data de Abertura", audit.company.dataAbertura], ["Natureza Jurídica", audit.company.naturezaJuridica],
                ["Porte", audit.company.porte],
                ["Regime", audit.company.regime==="SIMPLES_NACIONAL"?"Simples Nacional":audit.company.regime],
                ["Capital Social", audit.company.capitalSocial?`R$ ${Number(audit.company.capitalSocial).toLocaleString("pt-BR",{minimumFractionDigits:2})}`:null],
                ["CNAE", audit.company.cnae?.cod?`${audit.company.cnae.cod} — ${audit.company.cnae.desc}`:null],
                ["Município/UF", audit.company.municipio?`${audit.company.municipio} / ${audit.company.uf}`:null],
              ].filter(([,v])=>v).map(([l,v],i,arr)=>(
                <div key={l} style={{ display:"flex", justifyContent:"space-between", gap:12, padding:"9px 0", borderBottom:i<arr.length-1?`1px solid ${T.border}`:"none" }}>
                  <span style={{ fontSize:12, color:T.muted }}>{l}</span>
                  <span style={{ fontSize:13, fontWeight:600, textAlign:"right" }}>{String(v)}</span>
                </div>
              ))}
            </Card>
            {audit.company.socios?.length>0 && (
              <Card>
                <div style={{ fontSize:10, color:T.muted, textTransform:"uppercase", marginBottom:14 }}>Quadro Societário (QSA)</div>
                {audit.company.socios.map((s,i,arr)=>(
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"9px 0", borderBottom:i<arr.length-1?`1px solid ${T.border}`:"none" }}>
                    <span style={{ fontWeight:600, fontSize:13 }}>{s.nome}</span>
                    <span style={{ fontSize:11, color:T.muted }}>{s.qualificacao}</span>
                  </div>
                ))}
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState("landing");
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [audit, setAudit] = useState(null);

  const addLog = (icon, msg) => setLogs(l => [...l, { icon, msg }]);

  const handleSubmit = async (cnpj) => {
    const digits = cnpj.replace(/\D/g, "");
    if (!validateCNPJ(digits)) { setError("CNPJ inválido. Verifique os dígitos."); return; }
    setError(null); setLogs([]);
    setScreen("loading");

    addLog("🔍", "Check-up iniciado");
    await sleep(300);

    let contrato = await fetchAuditReal(digits, addLog);
    if (!contrato) {
      addLog("🧠", "Modo demonstração — dados simulados para fins de apresentação");
      await sleep(500);
      contrato = toDemoContract(cnpj, digits);
    }

    addLog("📊", `${contrato.state.label} — score ${contrato.state.score}/100`);
    await sleep(400);
    addLog(contrato.findings.length>0?"🚨":"✅", contrato.findings.length>0?`${contrato.findings.length} achado(s) identificado(s)`:"Nenhum achado crítico");
    await sleep(400);

    setAudit(contrato);
    setScreen("result");
  };

  const handleReset = () => { setScreen("landing"); setLogs([]); setError(null); setAudit(null); };

  if (screen==="landing") return <ScreenLanding onStart={()=>setScreen("input")}/>;
  if (screen==="loading") return <ScreenLoading logs={logs}/>;
  if (screen==="result" && audit) return <ScreenResult audit={audit} onReset={handleReset}/>;
  return <ScreenInput onSubmit={handleSubmit} error={error} onBack={()=>setScreen("landing")}/>;
}
