import { useState, useRef, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Hub Health — v1
//
// Novidades desta versão:
//   1. Rebranding Hub Trust → Hub Health.
//   2. Landing page real antes do CNPJ — vende o check-up antes de pedir dado.
//   3. Captura de lead persistida no PRÓPRIO backend (/v1/leads) — sem
//      depender de serviço externo, sem console.log em produção.
//   4. Checkout real via Stripe Payment Link — substitui o fake-door.
//      "No fake monetization": o clique leva a um checkout hospedado de
//      verdade. Ativação chega pelo webhook do Stripe no backend.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://hub-trust-backend-production.up.railway.app";

// ← Cole aqui o Payment Link do Stripe (Stripe Dashboard → Payment Links →
// Create → plano recorrente US$15/mês → copiar link). Leva ~3 minutos,
// não precisa de código nenhum do seu lado.
const STRIPE_PAYMENT_LINK = "";

function getUTM() {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const utm = {};
  ["utm_source","utm_medium","utm_campaign","utm_content","utm_term"].forEach(k => {
    if (p.get(k)) utm[k] = p.get(k);
  });
  return utm;
}

async function capturarLead(dados) {
  const payload = { ...dados, utm: getUTM() };
  if (!API_BASE) { console.log("EVENTO (backend não configurado):", payload); return true; }
  try {
    const r = await fetch(`${API_BASE}/v1/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.ok;
  } catch {
    return false;
  }
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
    addLog("⚠️", `Backend indisponível (${e.message}) — caindo para modo demo`);
    return null;
  }
}

const DEMO_CASOS = {
  "69210953000180": {
    razaoSocial: "TOBIAS MELO SERVICOS LTDA", situacao: "ATIVA", porte: "ME", regime: "SIMPLES_NACIONAL",
    cnae: { codigo: "74.90-1/04", descricao: "Atividades de intermediação e agenciamento de serviços" },
    municipio: "Goiânia", uf: "GO", capitalSocial: 80000,
    socios: [{ nome: "RAPHAEL TOBIAS DE MELO", qualificacao: "Sócio-Administrador" }, { nome: "AUGUSTO SILVA MELO", qualificacao: "Sócio" }],
    findings: [
      { id: "pgfn", source: "Certidão PGFN/RFB", icon: "📋", severity: "CRITICA", detail: "Débito ativo: R$ 18.430,00 — IRPJ/CSLL referente 2022/2023. Inscrição em Dívida Ativa.", dueDate: "31/12/2023", evidenceSource: "PREVIEW_DEMO" },
      { id: "fgts", source: "FGTS / CRF", icon: "🔒", severity: "ALTA", detail: "CRF vencido desde 14/04/2026. Competências mar/2026 e abr/2026 em aberto.", dueDate: "14/04/2026", evidenceSource: "PREVIEW_DEMO" },
      { id: "cndt", source: "CNDT (Trabalhista)", icon: "⚖️", severity: "ALTA", detail: "Débito trabalhista: R$ 6.200,00 — Reclamação proc. 0001234-45.2025.5.18.0001.", dueDate: null, evidenceSource: "PREVIEW_DEMO" },
    ],
  },
};

function toDemoContract(cnpj, digits) {
  const base = DEMO_CASOS[digits];
  const temDebito = parseInt(digits[7]) % 2 === 0;
  const findings = base ? base.findings : (temDebito ? [
    { id: "pgfn", source: "Certidão PGFN/RFB", icon: "📋", severity: "CRITICA", detail: `Débito ativo: R$ ${(parseInt(digits.slice(0,5))%50000+5000).toLocaleString("pt-BR")},00 — IRPJ em aberto.`, dueDate: null, evidenceSource: "PREVIEW_DEMO" },
  ] : []);
  const company = base || {
    razaoSocial: `EMPRESA ${digits.slice(0,3)}.${digits.slice(3,6)} LTDA`, situacao: "ATIVA",
    porte: parseInt(digits[5]) % 10 < 7 ? "ME" : "EPP", regime: "SIMPLES_NACIONAL",
    cnae: { codigo: "62.01-5/01", descricao: "Desenvolvimento de programas de computador sob encomenda" },
    municipio: "São Paulo", uf: "SP", capitalSocial: 50000,
    socios: [{ nome: `SÓCIO ${digits.slice(0,6)}`, qualificacao: "Sócio-Administrador" }],
  };

  const nextActions = findings.map(f => ({ id: `resolver_${f.id}`, label: `Resolver ${f.source}`, url: guidedUrl(f.id), priority: f.severity }));
  const guiadas = ["pgfn","fgts","cndt","esocial","dctf"].filter(id => !findings.find(f=>f.id===id));
  guiadas.forEach(id => nextActions.push({ id: `conectar_${id}`, label: `Verificar ${nomeFonte(id)} manualmente`, url: guidedUrl(id), priority: "MEDIA" }));

  const coverage = [
    { id: "rfb", name: "Receita Federal", tier: "AUTOMATIC", status: "OK", ok: true, checkedAt: "agora (demo)" },
    { id: "ceis", name: "CEIS / CNEP", tier: "AUTOMATIC", status: "OK", ok: true, checkedAt: "agora (demo)" },
    ...["pgfn","fgts","cndt","esocial","dctf"].map(id => ({ id, name: nomeFonte(id), tier: "GUIDED", status: findings.find(f=>f.id===id) ? "SIMULATED" : "NOT_CONNECTED", ok: findings.find(f=>f.id===id) ? false : null, guidedUrl: guidedUrl(id) })),
  ];

  let score = 100;
  findings.forEach(f => { score -= f.severity === "CRITICA" ? 25 : f.severity === "ALTA" ? 15 : 8; });
  score = Math.max(0, Math.min(100, score));
  const riskLevel = score >= 80 ? "PROTEGIDA" : score >= 60 ? "ATENCAO" : "EM_RISCO";
  const label = { PROTEGIDA: "Protegida", ATENCAO: "Atenção", EM_RISCO: "Em Risco" }[riskLevel];

  return {
    cnpj: digits, cnpjFormatted: cnpj, mode: "DEMO", auditedAt: new Date().toISOString(),
    company, verdict: { trustScore: score, confidence: 75, riskLevel, label },
    findings, nextActions, sourcesCoverage: coverage,
    premium: { monitoringAvailable: true, priceMonthly: 15, currency: "USD" },
  };
}

function nomeFonte(id) {
  return { pgfn: "Certidão PGFN/RFB", fgts: "FGTS / CRF", cndt: "CNDT (Trabalhista)", esocial: "eSocial", dctf: "DCTFWeb" }[id] || id;
}
function guidedUrl(id) {
  return {
    pgfn: "https://www.regularize.pgfn.gov.br", fgts: "https://consulta-crf.caixa.gov.br",
    cndt: "https://certidao.tst.jus.br", esocial: "https://esocial.gov.br", dctf: "https://cav.receita.fazenda.gov.br",
  }[id] || "#";
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
const Dot = ({ color, pulse }) => (
  <span style={{ position:"relative", display:"inline-flex", width:10, height:10, flexShrink:0 }}>
    {pulse && <span style={{ position:"absolute", inset:0, borderRadius:"50%", background:color, opacity:.3, animation:"ping 1.5s ease-in-out infinite" }} />}
    <span style={{ position:"absolute", inset:1, borderRadius:"50%", background:color, boxShadow:`0 0 5px ${color}88` }} />
  </span>
);
const Logo = ({ size=28 }) => (
  <div style={{ width:size, height:size, borderRadius:size*.28, background:"linear-gradient(135deg,#14B8A6,#0EA5E9)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:size*.5, color:"#fff", flexShrink:0 }}>H</div>
);
const Wordmark = ({ small }) => (
  <span style={{ fontWeight:900, fontSize:small?15:20, letterSpacing:"-.03em" }}>Hub<span style={{ color:T.accent }}>Health</span></span>
);

function TrustRing({ score, confidence, label, animated, size=148 }) {
  const r=size*.42, cx=size/2, cy=size/2, sw=size*.052;
  const circ=2*Math.PI*r;
  const color = score>=80?T.success:score>=60?T.warning:T.danger;
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.border} strokeWidth={sw}/>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={animated?circ-(score/100)*circ:circ} style={{ transition:"stroke-dashoffset 1.6s cubic-bezier(.4,0,.2,1)" }}/>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:2 }}>
        <span style={{ fontSize:size*.24, fontWeight:900, color, fontVariantNumeric:"tabular-nums", lineHeight:1 }}>{score}</span>
        <span style={{ fontSize:size*.075, color:T.sub, textTransform:"uppercase", letterSpacing:"0.08em" }}>Health Score</span>
        <span style={{ fontSize:size*.07, color, fontWeight:700, marginTop:2 }}>{label}</span>
        <span style={{ fontSize:size*.065, color:T.muted, marginTop:3 }}>Confiança {confidence}%</span>
      </div>
    </div>
  );
}

// ── Landing — vende o check-up antes de pedir o CNPJ ────────────────────────
function ScreenLanding({ onStart }) {
  return (
    <div style={{ minHeight:"100vh", background:T.bg, color:T.text, fontFamily:"'Inter',-apple-system,sans-serif" }}>
      <style>{`@keyframes up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}`}</style>
      <div style={{ maxWidth:520, margin:"0 auto", padding:"48px 24px 60px", animation:"up .5s ease both" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:56 }}>
          <Logo/>
          <div>
            <Wordmark/>
            <div style={{ fontSize:10, color:T.muted, letterSpacing:"0.12em", textTransform:"uppercase" }}>Check-up de Saúde Empresarial</div>
          </div>
        </div>

        <div style={{ fontWeight:900, fontSize:32, lineHeight:1.15, letterSpacing:"-.03em", marginBottom:16 }}>
          Sua empresa está saudável — <span style={{ color:T.accent }}>ou só parece estar?</span>
        </div>
        <div style={{ fontSize:16, color:T.sub, lineHeight:1.7, marginBottom:32 }}>
          Um check-up gratuito que cruza sua empresa direto com a Receita Federal e o Portal da Transparência,
          mostra o que está pendente, o que fazer agora — e continua de olho depois que você fechar essa aba.
        </div>

        <div style={{ display:"grid", gap:12, marginBottom:32 }}>
          {[
            ["🔍","Diagnóstico em 15 segundos","Situação cadastral, sanções, pendências — sem jargão."],
            ["🎯","Próxima ação, não só dado bruto","Cada achado vem com o link exato pra resolver."],
            ["🔔","Monitoramento contínuo (opcional)","Avisamos quando algo mudar — não precisa checar de novo."],
          ].map(([icon,title,desc],i)=>(
            <Card key={i} style={{ display:"flex", gap:14, alignItems:"flex-start", padding:16 }}>
              <span style={{ fontSize:22 }}>{icon}</span>
              <div>
                <div style={{ fontWeight:700, fontSize:14, marginBottom:3 }}>{title}</div>
                <div style={{ fontSize:13, color:T.sub, lineHeight:1.5 }}>{desc}</div>
              </div>
            </Card>
          ))}
        </div>

        <button onClick={onStart} style={{ width:"100%", padding:"16px", borderRadius:14, border:"none", background:"linear-gradient(135deg,#14B8A6,#0EA5E9)", color:"#031018", fontWeight:800, fontSize:16, cursor:"pointer" }}>
          Fazer check-up gratuito →
        </button>
        <div style={{ textAlign:"center", fontSize:12, color:T.muted, marginTop:12 }}>Grátis · sem cartão · leva 15 segundos</div>
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

const sevColor = { CRITICA:T.danger, ALTA:T.warning, MEDIA:T.accent, BAIXA:T.muted };

// ── CTA de checkout real — Stripe Payment Link, hospedado, sem formulário próprio
function CheckoutCTA({ audit }) {
  const [email, setEmail] = useState("");
  const abrirCheckout = async () => {
    if (!/\S+@\S+\.\S+/.test(email)) return;
    await capturarLead({
      email, intent: "checkout_iniciado", cnpj: audit.cnpj, companyName: audit.company.razaoSocial,
      sourceMode: audit.mode, selectedPlan: "individual",
      resultSnapshot: { trustScore: audit.verdict.trustScore, riskLevel: audit.verdict.riskLevel },
    });
    if (STRIPE_PAYMENT_LINK) {
      const url = new URL(STRIPE_PAYMENT_LINK);
      url.searchParams.set("prefilled_email", email);
      url.searchParams.set("client_reference_id", audit.cnpj);
      window.open(url.toString(), "_blank");
    }
  };
  return (
    <Card style={{ background:`linear-gradient(135deg, ${T.surface}, ${T.surface2})`, border:`1px solid ${T.accent}40` }}>
      <div style={{ fontWeight:800, fontSize:15, marginBottom:6 }}>Isso pode mudar amanhã.</div>
      <div style={{ fontSize:13, color:T.sub, lineHeight:1.6, marginBottom:14 }}>
        Essa é a foto de hoje, grátis. Assine o monitoramento contínuo e a gente avisa assim que surgir algo novo — sem precisar checar de novo.
      </div>
      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="seu@email.com"
        style={{ width:"100%", boxSizing:"border-box", padding:"11px 14px", borderRadius:10, background:T.surface2, border:`1px solid ${T.border}`, color:T.text, fontSize:13, marginBottom:10, outline:"none" }}/>
      <button onClick={abrirCheckout} style={{ width:"100%", padding:"12px", borderRadius:12, border:"none", background:`linear-gradient(135deg, ${T.accent}, ${T.purple})`, color:"#031018", fontWeight:700, fontSize:14, cursor:"pointer" }}>
        Assinar monitoramento — US$ 15/mês →
      </button>
      {!STRIPE_PAYMENT_LINK && (
        <div style={{ marginTop:10, fontSize:11, color:T.warning }}>⚠ Checkout ainda não configurado (STRIPE_PAYMENT_LINK vazio) — o lead já está sendo salvo.</div>
      )}
    </Card>
  );
}

function ScreenResult({ audit, onReset }) {
  const [tab, setTab] = useState("home");

  const { trustScore, confidence, label } = audit.verdict;
  const scoreColor = trustScore>=80?T.success:trustScore>=60?T.warning:T.danger;
  const sitColor = audit.company.situacao==="ATIVA"?T.success:T.danger;
  const criticas = audit.findings.filter(f=>f.severity==="CRITICA");
  const altas = audit.findings.filter(f=>f.severity==="ALTA");
  const [ringAnim, setRingAnim] = useState(false);
  useEffect(()=>{ setTimeout(()=>setRingAnim(true),300); },[]);

  const tabs = [
    { id:"home", label:"Situação" },
    { id:"achados", label:`Achados ${audit.findings.length>0?`(${audit.findings.length})`:""}` },
    { id:"fontes", label:"Fontes" },
    { id:"perfil", label:"Perfil" },
  ];

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:"'Inter',-apple-system,sans-serif", color:T.text }}>
      <style>{`@keyframes up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}} @keyframes ping{0%,100%{transform:scale(1);opacity:.3}50%{transform:scale(2);opacity:0}}`}</style>

      <div style={{ position:"sticky", top:0, zIndex:50, background:T.bg+"f0", backdropFilter:"blur(16px)", borderBottom:`1px solid ${T.border}` }}>
        <div style={{ maxWidth:680, margin:"0 auto", padding:"0 16px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, height:54 }}>
            <Logo size={28}/><Wordmark small/>
            {audit.mode==="DEMO" && <span style={{ fontSize:10, fontWeight:800, padding:"3px 9px", borderRadius:99, background:T.warning+"18", color:T.warning, border:`1px solid ${T.warning}30` }}>MODO DEMO</span>}
            <div style={{ flex:1 }}/>
            <div style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 12px", borderRadius:99, background:scoreColor+"18", border:`1px solid ${scoreColor}30` }}>
              <Dot color={scoreColor} pulse={trustScore<80}/>
              <span style={{ fontWeight:800, fontSize:13, color:scoreColor }}>{trustScore}</span><span style={{ fontSize:11, color:T.muted }}>/100</span>
            </div>
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
            <Card style={{ background:`linear-gradient(135deg,${T.surface} 55%,${T.accent}08)`, borderColor:T.borderLight }}>
              <div style={{ fontWeight:800, fontSize:18, marginBottom:16 }}>{audit.company.razaoSocial}</div>
              <div style={{ display:"flex", gap:22, alignItems:"center", flexWrap:"wrap" }}>
                <TrustRing score={trustScore} confidence={confidence} label={label} animated={ringAnim}/>
                <div style={{ flex:1, minWidth:180 }}>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12 }}>
                    <Chip label={audit.company.situacao} color={sitColor}/>
                    {audit.company.regime && <Chip label={audit.company.regime==="SIMPLES_NACIONAL"?"Simples Nacional":audit.company.regime} color={T.accent}/>}
                    {audit.company.porte && <Chip label={audit.company.porte} color={T.muted}/>}
                  </div>
                  <div style={{ fontSize:14, color:T.sub, lineHeight:1.7, marginBottom:12 }}>
                    {criticas.length>0||altas.length>0
                      ? <>Encontrei <strong style={{ color:T.danger }}>{criticas.length} achado(s) crítico(s)</strong> e <strong style={{ color:T.warning }}>{altas.length} de alta prioridade</strong>.</>
                      : "Nenhum achado crítico nas fontes verificadas."}
                  </div>
                  <div style={{ fontSize:12, color:T.muted }}>Confiança: <span style={{ color:T.sub }}>{confidence}%</span></div>
                </div>
              </div>
            </Card>

            {audit.findings.slice(0,3).map((f,i)=>(
              <Card key={i} style={{ padding:"14px 16px", borderLeft:`3px solid ${sevColor[f.severity]||T.muted}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                  <span style={{ fontSize:18 }}>{f.icon}</span>
                  <span style={{ fontWeight:700, fontSize:14 }}>{f.source}</span>
                  <Chip label={f.severity} color={sevColor[f.severity]||T.muted}/>
                </div>
                <div style={{ fontSize:13, color:T.sub, lineHeight:1.6 }}>{f.detail}</div>
              </Card>
            ))}
            {audit.findings.length>3 && (
              <button onClick={()=>setTab("achados")} style={{ padding:"11px", borderRadius:10, border:`1px solid ${T.border}`, background:"transparent", color:T.sub, fontSize:13, fontWeight:600, cursor:"pointer" }}>Ver todos os {audit.findings.length} achados →</button>
            )}
          </div>
        )}

        {tab==="achados" && (
          <div style={{ animation:"up .5s ease both" }}>
            <div style={{ fontSize:20, fontWeight:800, marginBottom:4 }}>Achados e Próximas Ações</div>
            <div style={{ fontSize:13, color:T.sub, marginBottom:20 }}>{audit.findings.length} achado(s) · {criticas.length} crítico(s) · {altas.length} alta prioridade</div>

            {audit.findings.length===0 ? (
              <Card style={{ textAlign:"center", padding:40, marginBottom:16 }}>
                <div style={{ fontSize:40, marginBottom:12 }}>✅</div>
                <div style={{ fontWeight:700, color:T.success, fontSize:18 }}>Nenhum achado crítico</div>
              </Card>
            ) : (
              <div style={{ display:"grid", gap:10, marginBottom:16 }}>
                {audit.findings.map((f,i)=>{
                  const action = audit.nextActions.find(a=>a.id===`resolver_${f.id}`);
                  return (
                    <Card key={i} style={{ padding:"16px 18px", borderLeft:`3px solid ${sevColor[f.severity]||T.muted}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:8 }}>
                            <span style={{ fontSize:20 }}>{f.icon}</span>
                            <span style={{ fontWeight:700, fontSize:15 }}>{f.source}</span>
                            <Chip label={f.severity} color={sevColor[f.severity]||T.muted}/>
                            {f.evidenceSource==="PREVIEW_DEMO" && <Chip label="Simulado (demo)" color={T.warning}/>}
                          </div>
                          <div style={{ fontSize:13, color:T.sub, lineHeight:1.7 }}>{f.detail}</div>
                          {f.dueDate && <div style={{ fontSize:12, color:T.danger, fontWeight:700, marginTop:8 }}>📅 Vencimento: {f.dueDate}</div>}
                        </div>
                        {action?.url && <a href={action.url} target="_blank" rel="noreferrer" style={{ padding:"7px 12px", borderRadius:8, border:`1px solid ${sevColor[f.severity]}44`, background:(sevColor[f.severity]||T.muted)+"12", color:sevColor[f.severity], fontSize:11, fontWeight:700, textDecoration:"none", whiteSpace:"nowrap" }}>Resolver ↗</a>}
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
              {audit.sourcesCoverage.map((f,i)=>{
                const statusColor = f.status==="OK" ? (f.ok?T.success:T.danger) : f.status==="SIMULATED" ? T.warning : T.muted;
                const statusLabel = { OK: f.ok?"Regular":"Irregular", NOT_CONNECTED:"Não conectada", UNAVAILABLE:"Indisponível", SIMULATED:"Simulado (demo)" }[f.status] || f.status;
                return (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", background:T.surface, border:`1px solid ${T.border}`, borderRadius:12 }}>
                    <span style={{ fontWeight:700, fontSize:13, flex:1 }}>{f.name}</span>
                    <Chip label={f.tier==="AUTOMATIC"?"Automática":"Guiada"} color={f.tier==="AUTOMATIC"?T.success:T.warning}/>
                    <Chip label={statusLabel} color={statusColor}/>
                    {f.guidedUrl && f.status==="NOT_CONNECTED" && <a href={f.guidedUrl} target="_blank" rel="noreferrer" style={{ padding:"6px 12px", borderRadius:8, border:`1px solid ${T.accent}44`, background:T.accent+"15", color:T.accent, fontSize:11, fontWeight:700, textDecoration:"none" }}>Verificar →</a>}
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
                ["CNPJ", audit.cnpjFormatted], ["Situação", audit.company.situacao],
                ["Data de Abertura", audit.company.dataAbertura], ["Natureza Jurídica", audit.company.naturezaJuridica],
                ["Porte", audit.company.porte],
                ["Regime", audit.company.regime==="SIMPLES_NACIONAL"?"Simples Nacional":audit.company.regime],
                ["Capital Social", audit.company.capitalSocial?`R$ ${Number(audit.company.capitalSocial).toLocaleString("pt-BR",{minimumFractionDigits:2})}`:null],
                ["CNAE", audit.company.cnae?.codigo?`${audit.company.cnae.codigo} — ${audit.company.cnae.descricao}`:null],
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

    addLog("📊", `Health Score: ${contrato.verdict.trustScore}/100`);
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
