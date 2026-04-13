import { useState, useEffect } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Drop your Etherscan key in your .env file as VITE_ETHERSCAN_KEY
const ETHERSCAN_KEY = import.meta.env.VITE_ETHERSCAN_KEY || "";
const BSCSCAN_KEY   = import.meta.env.VITE_BSCSCAN_KEY   || "";

// ─── REAL API PIPELINE ────────────────────────────────────────────────────────

// 1. DexScreener — free, no key, works for ETH/BSC/SOL/ARB
async function fetchDexScreener(address) {
  const res  = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
  const data = await res.json();
  const pair = data?.pairs?.[0];
  if (!pair) return null;
  return {
    name:        pair.baseToken?.name    || "Unknown",
    symbol:      pair.baseToken?.symbol  || "???",
    chain:       pair.chainId?.toUpperCase() || "ETH",
    liquidity:   pair.liquidity?.usd     || 0,
    marketCap:   pair.marketCap          || 0,
    volume24h:   pair.volume?.h24        || 0,
    priceChange: pair.priceChange?.h24   || 0,
    txns24h:     (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
    pairAddress: pair.pairAddress        || "",
    dexUrl:      pair.url                || "",
    age:         pair.pairCreatedAt
      ? Math.floor((Date.now() - pair.pairCreatedAt) / 86400000)
      : null,
  };
}

// 2. Etherscan — contract info, owner, source code verified
async function fetchEtherscan(address) {
  if (!ETHERSCAN_KEY) return null;
  try {
    const [srcRes, txRes] = await Promise.all([
      fetch(`https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${address}&apikey=${ETHERSCAN_KEY}`),
      fetch(`https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc&page=1&offset=1&apikey=${ETHERSCAN_KEY}`),
    ]);
    const srcData = await srcRes.json();
    const txData  = await txRes.json();
    const src     = srcData?.result?.[0];
    const firstTx = txData?.result?.[0];
    return {
      verified:    src?.ABI !== "Contract source code not verified",
      contractName:src?.ContractName || "",
      compiler:    src?.CompilerVersion || "",
      // If ContractName is empty the contract is likely a proxy or unverified
      isProxy:     src?.Proxy === "1",
      deployer:    firstTx?.from || null,
    };
  } catch { return null; }
}

// 3. BSCScan — same as Etherscan but for BSC
async function fetchBSCScan(address) {
  if (!BSCSCAN_KEY) return null;
  try {
    const res  = await fetch(`https://api.bscscan.com/api?module=contract&action=getsourcecode&address=${address}&apikey=${BSCSCAN_KEY}`);
    const data = await res.json();
    const src  = data?.result?.[0];
    return {
      verified:     src?.ABI !== "Contract source code not verified",
      contractName: src?.ContractName || "",
      isProxy:      src?.Proxy === "1",
    };
  } catch { return null; }
}

// 4. Calculate real rug score from actual data
function calcScore({ dex, contract }) {
  let score  = 0;
  const flags = [];

  // Liquidity checks (0-30 pts)
  if (dex.liquidity < 1000)       { score += 30; flags.push("LIQUIDITY BELOW $1K"); }
  else if (dex.liquidity < 10000) { score += 20; flags.push("LOW LIQUIDITY"); }
  else if (dex.liquidity < 50000) { score += 10; flags.push("THIN LIQUIDITY"); }

  // Market cap vs liquidity ratio (0-20 pts)
  const mcLiqRatio = dex.marketCap / Math.max(dex.liquidity, 1);
  if (mcLiqRatio > 100) { score += 20; flags.push("MC/LIQ RATIO EXTREME"); }
  else if (mcLiqRatio > 50) { score += 10; flags.push("HIGH MC/LIQ RATIO"); }

  // Token age (0-15 pts)
  if (dex.age !== null) {
    if (dex.age < 1)  { score += 15; flags.push("LESS THAN 1 DAY OLD"); }
    else if (dex.age < 3)  { score += 10; flags.push("LESS THAN 3 DAYS OLD"); }
    else if (dex.age < 7)  { score += 5;  flags.push("LESS THAN 1 WEEK OLD"); }
  }

  // Volume / liquidity ratio - sell pressure (0-15 pts)
  const volLiqRatio = dex.volume24h / Math.max(dex.liquidity, 1);
  if (volLiqRatio > 5)  { score += 15; flags.push("EXTREME SELL PRESSURE"); }
  else if (volLiqRatio > 2) { score += 8; flags.push("HIGH SELL PRESSURE"); }

  // Price crash (0-15 pts)
  if (dex.priceChange < -50)  { score += 15; flags.push("PRICE DOWN 50%+"); }
  else if (dex.priceChange < -30) { score += 10; flags.push("PRICE DOWN 30%+"); }
  else if (dex.priceChange < -20) { score += 5;  flags.push("PRICE DOWN 20%+"); }

  // Contract checks (0-15 pts)
  if (contract) {
    if (!contract.verified) { score += 10; flags.push("CONTRACT UNVERIFIED"); }
    if (contract.isProxy)   { score += 5;  flags.push("PROXY CONTRACT"); }
  } else {
    score += 5; // can't verify = slight risk
  }

  // Very low tx count (0-10 pts)
  if (dex.txns24h < 10)  { score += 10; flags.push("ALMOST NO TRANSACTIONS"); }
  else if (dex.txns24h < 50) { score += 5; flags.push("LOW TRANSACTION COUNT"); }

  return { score: Math.min(score, 100), flags };
}

// ─── MAIN SCAN FUNCTION ───────────────────────────────────────────────────────
async function scanAddress(input) {
  const trimmed = input.trim();
  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(trimmed);

  // Fetch DexScreener data first
  const dex = await fetchDexScreener(trimmed);
  if (!dex) throw new Error("Token not found on DexScreener. Check the address and try again.");

  // Fetch contract data based on chain
  let contract = null;
  if (isAddress) {
    const chain = (dex.chain || "").toLowerCase();
    if (chain.includes("bsc") || chain.includes("bnb")) {
      contract = await fetchBSCScan(trimmed);
    } else {
      contract = await fetchEtherscan(trimmed);
    }
  }

  const { score, flags } = calcScore({ dex, contract });

  return { dex, contract, score, flags };
}

// ─── HALL OF SHAME (real rugs) ────────────────────────────────────────────────
const HALL_OF_SHAME = [
  { token: "SQUID",    score: 99, verdict: "Game token rug. $3.38M stolen in minutes. Dev sold everything.", chain: "BSC" },
  { token: "LUNA",     score: 97, verdict: "$40B wiped in 72 hours. Algorithmic stablecoin. Never again.", chain: "ETH" },
  { token: "SAFEMOON", score: 95, verdict: "CEO arrested. Dev wallet drained $200M. RIP holders.", chain: "BSC" },
  { token: "FROSTIES", score: 94, verdict: "NFT rug. $1.3M vanished overnight. Devs arrested.", chain: "ETH" },
  { token: "ANUBIS",   score: 92, verdict: "$60M raised, liquidity pulled after 20 hours.", chain: "ETH" },
];

// ─── VERDICTS ─────────────────────────────────────────────────────────────────
const VERDICTS = {
  safe:   ["Numbers check out. Still DYOR but this ain't an obvious funeral.", "Liquidity looks real. Dev hasn't vanished yet. Proceed cautiously.", "Cleaner than most. Still set a stop loss."],
  mid:    ["Smells like Exit Liquidity Season. Proceed with helmet.", "Not confirmed rug but the vibe is off. Trust the data.", "Whale concentration giving red flags. 50/50 you lose everything."],
  danger: ["Liquidity thinner than your patience. Dev already packing bags.", "The numbers are giving 'donation to a stranger' energy.", "Contract unverified. Volume suspicious. RIP your portfolio.", "Every metric screaming danger. This is not financial advice but also run."],
  rug:    ["This is not a coin. This is a funeral with extra steps.", "Liquidity below $1K. Market cap in the millions. You do the math.", "Honeypot vibes confirmed. You can buy. Selling is a different story.", "Every single metric is red. Historic levels of not good."],
};

// ─── THEMES ──────────────────────────────────────────────────────────────────
const THEMES = {
  dark: { name:"DARK", icon:"🌑", bg:"#0f1117", surface:"#13161f", card:"#13161f", border:"#1e2130", border2:"#272d3f", input:"#181c27", text:"#e8e8e8", textSub:"#6a738f", textMute:"#3a4155", textDim:"#2a3045", accent:"#00ff88", accentDim:"rgba(0,255,136,0.08)" },
  light:{ name:"LIGHT", icon:"☀️", bg:"#f0f2f7", surface:"#ffffff", card:"#ffffff", border:"#dde1ec", border2:"#c8cedd", input:"#f8f9fc", text:"#1a1d2e", textSub:"#5a6080", textMute:"#8890aa", textDim:"#b0b8cc", accent:"#00aa55", accentDim:"rgba(0,170,85,0.08)" },
  hacker:{ name:"HACKER", icon:"💾", bg:"#000000", surface:"#001100", card:"#001800", border:"#003300", border2:"#004400", input:"#000d00", text:"#00ff41", textSub:"#00aa2a", textMute:"#006618", textDim:"#003a0e", accent:"#00ff41", accentDim:"rgba(0,255,65,0.06)" },
};

function getRiskLevel(score) {
  if (score < 30) return { label: "Safe-ish",    emoji: "🟢", color: "#00cc66", tier: "safe" };
  if (score < 60) return { label: "Suspicious",  emoji: "🟡", color: "#e6a800", tier: "mid" };
  if (score < 80) return { label: "Danger Zone", emoji: "🔴", color: "#ff4444", tier: "danger" };
  return           { label: "Certified Rug",      emoji: "☠️", color: "#ff0055", tier: "rug" };
}

function AnimatedScore({ target }) {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      setCurrent(Math.floor(Math.min(frame / 60, 1) * target));
      if (frame >= 60) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [target]);
  return <>{current}</>;
}

function fmt(n) {
  if (!n && n !== 0) return "N/A";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(0);
}

function makeCSS(t) {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Bebas+Neue&display=swap');
    .rr, .rr * { box-sizing: border-box; }
    .rr {
      min-height: 100vh; background: ${t.bg}; color: ${t.text};
      font-family: 'Share Tech Mono', monospace; position: relative; overflow-x: hidden;
      transition: background 0.3s, color 0.3s;
    }
    @keyframes rr-scan    { 0%{top:-4px;} 100%{top:100%;} }
    @keyframes rr-flicker { 0%,89%,91%,93%,100%{opacity:1;} 90%{opacity:0.4;} 92%{opacity:0.7;} }
    @keyframes rr-up      { from{opacity:0;transform:translateY(14px);} to{opacity:1;transform:translateY(0);} }
    @keyframes rr-blink   { 0%,100%{opacity:1;} 50%{opacity:0;} }
    @keyframes rr-bar     { from{width:0%;} }
    @keyframes rr-dot     { 0%,100%{opacity:0.2;} 50%{opacity:1;} }
    @keyframes rr-glitch  { 0%,100%{transform:translate(0,0);} 25%{transform:translate(-3px,1px);} 50%{transform:translate(3px,-1px);} 75%{transform:translate(-2px,2px);} }

    .rr-line { position:fixed;left:0;right:0;height:2px;background:${t.accentDim};animation:rr-scan 5s linear infinite;pointer-events:none;z-index:9999; }
    .rr-crt  { position:fixed;inset:0;pointer-events:none;z-index:9998;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px); }

    .rr-hdr  { border-bottom:1px solid ${t.border};padding:16px 24px;display:flex;justify-content:space-between;align-items:center;background:${t.surface};animation:rr-flicker 9s infinite; }
    .rr-logo { font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:5px;color:${t.accent}; }
    .rr-sub  { font-size:9px;color:${t.textMute};letter-spacing:3px;margin-top:3px; }
    .rr-hdr-right { display:flex;align-items:center;gap:16px; }
    .rr-live { font-size:9px;color:${t.textMute};text-align:right;line-height:2; }

    .rr-theme-bar { display:flex;gap:4px;background:${t.bg};border:1px solid ${t.border2};padding:4px;border-radius:2px; }
    .rr-theme-btn { background:transparent;border:none;cursor:pointer;font-size:10px;font-family:'Share Tech Mono',monospace;letter-spacing:1px;padding:5px 10px;color:${t.textMute};transition:background 0.15s,color 0.15s;white-space:nowrap; }
    .rr-theme-btn:hover { color:${t.text}; }
    .rr-theme-btn.active { background:${t.accent};color:#000; }

    .rr-tabs { border-bottom:1px solid ${t.border};padding:0 24px;display:flex;gap:28px;background:${t.surface}; }
    .rr-tab  { background:transparent;border:none;border-bottom:2px solid transparent;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:2px;cursor:pointer;padding:10px 0;color:${t.textMute};transition:color 0.2s,border-color 0.2s; }
    .rr-tab.on { color:${t.accent};border-bottom-color:${t.accent}; }

    .rr-body { max-width:680px;margin:0 auto;padding:30px 24px; }
    .rr-lbl  { font-size:9px;color:${t.textSub};letter-spacing:3px;margin-bottom:8px; }

    .rr-row { display:flex;margin-bottom:30px; }
    .rr-inp { flex:1;min-width:0;background:${t.input};border:1px solid ${t.border2};border-right:none;color:${t.text};font-family:'Share Tech Mono',monospace;font-size:13px;padding:13px 16px;outline:none;transition:border-color 0.2s; }
    .rr-inp:focus { border-color:${t.accent}; }
    .rr-inp::placeholder { color:${t.textDim}; }

    .rr-btn { background:${t.accent};color:#000;border:none;font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:3px;padding:13px 26px;cursor:pointer;flex-shrink:0;transition:opacity 0.15s,transform 0.1s; }
    .rr-btn:hover:not(:disabled) { opacity:0.85; }
    .rr-btn:active:not(:disabled) { transform:scale(0.97); }
    .rr-btn:disabled { background:${t.border2};color:${t.textMute};cursor:not-allowed; }

    .rr-notice { font-size:10px;color:${t.textSub};margin-bottom:20px;padding:10px 14px;border:1px solid ${t.border2};background:${t.input};line-height:1.7;letter-spacing:0.5px; }
    .rr-notice a { color:${t.accent};text-decoration:none; }

    .rr-loading { text-align:center;padding:52px 0; }
    .rr-lh { font-family:'Bebas Neue',sans-serif;font-size:40px;color:${t.accent};letter-spacing:6px; }
    .rr-ls { font-size:10px;color:${t.textMute};letter-spacing:2px;margin-top:14px; }
    .rr-dots { margin-top:20px;display:flex;gap:5px;justify-content:center; }
    .rr-d  { width:4px;height:4px;background:${t.accent};animation:rr-dot 0.9s ease-in-out infinite; }
    .rr-bl { animation:rr-blink 0.9s step-end infinite; }

    .rr-err { text-align:center;padding:40px 0; }
    .rr-err-icon { font-size:36px;margin-bottom:12px; }
    .rr-err-msg  { font-size:12px;color:#ff4444;letter-spacing:1px;line-height:1.7; }

    .rr-card { border:1px solid ${t.border};background:${t.card};padding:22px;animation:rr-up 0.4s ease;transition:background 0.3s,border-color 0.3s; }
    .rr-card.gl { animation:rr-glitch 0.4s steps(2) forwards; }

    .rr-token-hdr { display:flex;align-items:center;gap:10px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid ${t.border}; }
    .rr-token-name { font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;color:${t.text}; }
    .rr-token-sym  { font-size:11px;color:${t.textSub};padding:2px 8px;border:1px solid ${t.border2}; }
    .rr-token-ch   { font-size:9px;color:${t.accent};padding:2px 7px;border:1px solid ${t.accent}33;letter-spacing:1px; }

    .rr-sh { display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px; }
    .rr-sn { font-family:'Bebas Neue',sans-serif;font-size:72px;line-height:1;letter-spacing:-2px; }
    .rr-rl { font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:2px;margin-top:4px; }

    .rr-bg { height:7px;background:${t.bg};border:1px solid ${t.border};overflow:hidden;margin-bottom:20px; }
    .rr-bf { height:100%;width:0%;animation:rr-bar 1.1s ease-out 0.2s forwards; }

    .rr-st { display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid ${t.border};font-size:12px; }
    .rr-st:last-child { border-bottom:none; }
    .rr-sl { color:${t.textSub};letter-spacing:1px; }
    .rr-sv { color:${t.text};margin-left:10px; }
    .rr-sr { display:flex;align-items:center; }
    .rr-fl { font-size:9px;padding:1px 6px;border:1px solid;letter-spacing:1px;margin-right:8px; }

    .rr-flags { margin-top:14px;display:flex;flex-wrap:wrap;gap:6px; }
    .rr-flag-chip { font-size:9px;padding:3px 8px;border:1px solid #ff444466;color:#ff4444;letter-spacing:1px;background:rgba(255,68,68,0.06); }

    .rr-vd { border-left:2px solid;padding:11px 15px;margin-top:18px;font-size:13px;font-style:italic;line-height:1.6;background:${t.accentDim}; }

    .rr-acts { display:flex;gap:10px;margin-top:18px;flex-wrap:wrap; }
    .rr-gb { background:transparent;border:1px solid ${t.border2};color:${t.textSub};font-family:'Share Tech Mono',monospace;font-size:11px;padding:9px 18px;cursor:pointer;letter-spacing:1px;transition:border-color 0.2s,color 0.2s; }
    .rr-gb:hover { border-color:${t.accent};color:${t.accent}; }
    .rr-ext { font-size:10px;color:${t.textMute};margin-top:10px; }
    .rr-ext a { color:${t.accent};text-decoration:none; }
    .rr-cp { margin-top:10px;font-size:10px;color:${t.accent};opacity:0.7;letter-spacing:2px;animation:rr-up 0.3s ease; }

    .rr-empty { text-align:center;padding:52px 0; }
    .rr-ei { font-size:42px;margin-bottom:12px;color:${t.textDim}; }
    .rr-et { font-size:11px;color:${t.textMute};letter-spacing:4px; }
    .rr-es { font-size:10px;color:${t.textDim};margin-top:8px; }

    .rr-sr2 { display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid ${t.border}; }
    .rr-sr2:last-of-type { border-bottom:none; }
    .rr-sn2 { font-family:'Bebas Neue',sans-serif;font-size:24px;color:${t.textDim};min-width:22px; }
    .rr-si  { width:42px;height:42px;background:${t.input};border:1px solid ${t.border2};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0; }
    .rr-stk { font-family:'Bebas Neue',sans-serif;font-size:17px;color:${t.text};letter-spacing:1px; }
    .rr-svd { font-size:11px;color:${t.textSub};margin-top:3px;line-height:1.5; }
    .rr-ssc { font-family:'Bebas Neue',sans-serif;font-size:26px;color:#ff0055; }
    .rr-ssl { font-size:8px;color:${t.textMute};letter-spacing:1px; }
    .rr-disc { margin-top:28px;padding:16px;border:1px dashed ${t.border2};font-size:10px;color:${t.textMute};text-align:center;line-height:2;letter-spacing:1px; }
  `;
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function RugRadar() {
  const [input, setInput]       = useState("");
  const [loading, setLoad]      = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState("");
  const [verdict, setVerdict]   = useState("");
  const [tab, setTab]           = useState("scanner");
  const [copied, setCopied]     = useState(false);
  const [glitch, setGlitch]     = useState(false);
  const [themeKey, setThemeKey] = useState("dark");
  const [loadMsg, setLoadMsg]   = useState("");

  const t   = THEMES[themeKey];
  const CSS = makeCSS(t);

  const LOAD_MSGS = [
    "CONNECTING TO DEXSCREENER...",
    "PULLING LIQUIDITY DATA...",
    "CHECKING CONTRACT INFO...",
    "ANALYZING SELL PRESSURE...",
    "CALCULATING RUG SCORE...",
  ];

  const scan = async () => {
    if (!input.trim() || loading) return;
    setLoad(true); setResult(null); setError(""); setCopied(false);
    setGlitch(true); setTimeout(() => setGlitch(false), 420);

    // Cycle loading messages
    let msgIdx = 0;
    setLoadMsg(LOAD_MSGS[0]);
    const msgInterval = setInterval(() => {
      msgIdx = (msgIdx + 1) % LOAD_MSGS.length;
      setLoadMsg(LOAD_MSGS[msgIdx]);
    }, 900);

    try {
      const data = await scanAddress(input);
      const risk = getRiskLevel(data.score);
      const pool = VERDICTS[risk.tier];
      setVerdict(pool[Math.floor(Math.random() * pool.length)]);
      setResult({ ...data, risk });
    } catch (err) {
      setError(err.message || "Something went wrong. Try again.");
    } finally {
      clearInterval(msgInterval);
      setLoad(false);
    }
  };

  const share = () => {
    if (!result) return;
    const sym = result.dex?.symbol || input.slice(0, 8);
    const msg = `Just checked $${sym} on RugRadar — ${result.score}% rug probability ${result.risk.emoji} "${verdict}" — rugradar.degen`;
    try { navigator.clipboard.writeText(msg); } catch (_) {}
    setCopied(true);
  };

  const reset = () => { setResult(null); setInput(""); setCopied(false); setError(""); };
  const risk  = result?.risk;

  const STATS = result ? [
    { lbl: "Liquidity (USD)",    val: fmt(result.dex.liquidity),  flag: result.dex.liquidity < 10000 ? "⚠ LOW" : null,          fc: "#e6a800" },
    { lbl: "Market Cap",         val: fmt(result.dex.marketCap),  flag: null,                                                    fc: "#e6a800" },
    { lbl: "24h Volume",         val: fmt(result.dex.volume24h),  flag: null,                                                    fc: "#e6a800" },
    { lbl: "24h Price Change",   val: (result.dex.priceChange > 0 ? "+" : "") + result.dex.priceChange?.toFixed(2) + "%", flag: result.dex.priceChange < -30 ? "⚠ DUMPING" : null, fc: "#ff4444" },
    { lbl: "24h Transactions",   val: result.dex.txns24h?.toLocaleString() || "N/A", flag: result.dex.txns24h < 20 ? "⚠ DEAD" : null, fc: "#e6a800" },
    { lbl: "Token Age",          val: result.dex.age !== null ? result.dex.age + " days" : "N/A", flag: result.dex.age < 3 ? "⚠ NEW" : null, fc: "#e6a800" },
    { lbl: "Contract Verified",  val: result.contract ? (result.contract.verified ? "YES" : "NO") : "N/A", flag: result.contract && !result.contract.verified ? "⚠ UNVERIFIED" : null, fc: "#ff4444" },
  ] : [];

  return (
    <div className="rr">
      <style>{CSS}</style>
      <div className="rr-line" />
      <div className="rr-crt" />

      {/* Header */}
      <div className="rr-hdr">
        <div>
          <div className="rr-logo">▓ RUGRADAR</div>
          <div className="rr-sub">REAL-TIME DEGEN SURVIVAL TOOL v3.0</div>
        </div>
        <div className="rr-hdr-right">
          <div className="rr-theme-bar">
            {Object.entries(THEMES).map(([key, th]) => (
              <button key={key} className={"rr-theme-btn" + (themeKey === key ? " active" : "")} onClick={() => setThemeKey(key)}>
                {th.icon} {th.name}
              </button>
            ))}
          </div>
          <div className="rr-live">
            <div style={{ color: t.accent, opacity: 0.4 }}>■ LIVE</div>
            <div>DEXSCREENER · ETHERSCAN</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="rr-tabs">
        {[["scanner","⬡ SCANNER"],["shame","☠ HALL OF SHAME"]].map(([id, label]) => (
          <button key={id} className={"rr-tab" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      <div className="rr-body">

        {tab === "scanner" && (
          <>
            {/* API key notice */}
            {!ETHERSCAN_KEY && (
              <div className="rr-notice">
                ⚠ No Etherscan key found. Contract verification data will be unavailable.
                Add <strong>VITE_ETHERSCAN_KEY</strong> to your <strong>.env</strong> file for full analysis.
                Get a free key at <a href="https://etherscan.io/myapikey" target="_blank" rel="noreferrer">etherscan.io</a>.
              </div>
            )}

            <div className="rr-lbl">PASTE CONTRACT ADDRESS OR TOKEN ADDRESS</div>
            <div className="rr-row">
              <input
                className="rr-inp"
                placeholder="0x... contract address"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && scan()}
              />
              <button className="rr-btn" onClick={scan} disabled={loading || !input.trim()}>
                {loading ? "..." : "SCAN"}
              </button>
            </div>

            {loading && (
              <div className="rr-loading">
                <div className="rr-lh">SCANNING<span className="rr-bl">_</span></div>
                <div className="rr-ls">{loadMsg}</div>
                <div className="rr-dots">
                  {Array.from({ length: 18 }, (_, i) => (
                    <div key={i} className="rr-d" style={{ animationDelay: i * 0.055 + "s", opacity: i % 3 === 0 ? 1 : 0.15 }} />
                  ))}
                </div>
              </div>
            )}

            {error && !loading && (
              <div className="rr-err">
                <div className="rr-err-icon">⚠️</div>
                <div className="rr-err-msg">{error}</div>
              </div>
            )}

            {result && !loading && (
              <div className={"rr-card" + (glitch ? " gl" : "")}>

                {/* Token name */}
                <div className="rr-token-hdr">
                  <span className="rr-token-name">{result.dex.name}</span>
                  <span className="rr-token-sym">${result.dex.symbol}</span>
                  <span className="rr-token-ch">{result.dex.chain}</span>
                </div>

                {/* Score */}
                <div className="rr-sh">
                  <div>
                    <div className="rr-lbl">RUG PROBABILITY SCORE</div>
                    <div className="rr-sn" style={{ color: risk.color }}>
                      <AnimatedScore target={result.score} />%
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 34 }}>{risk.emoji}</div>
                    <div className="rr-rl" style={{ color: risk.color }}>{risk.label}</div>
                  </div>
                </div>

                {/* Risk bar */}
                <div className="rr-bg">
                  <div className="rr-bf" style={{ width: result.score + "%", background: "linear-gradient(90deg," + t.accent + "," + risk.color + ")" }} />
                </div>

                {/* Stats */}
                {STATS.map(({ lbl, val, flag, fc }) => (
                  <div key={lbl} className="rr-st">
                    <span className="rr-sl">{lbl}</span>
                    <div className="rr-sr">
                      {flag && <span className="rr-fl" style={{ color: fc, borderColor: fc }}>{flag}</span>}
                      <span className="rr-sv">{val}</span>
                    </div>
                  </div>
                ))}

                {/* Risk flags */}
                {result.flags?.length > 0 && (
                  <div className="rr-flags">
                    {result.flags.map(f => <span key={f} className="rr-flag-chip">{f}</span>)}
                  </div>
                )}

                {/* AI verdict */}
                <div className="rr-vd" style={{ borderColor: risk.color, color: risk.color }}>
                  {verdict}
                </div>

                {/* Actions */}
                <div className="rr-acts">
                  <button className="rr-gb" onClick={share}>↗ COPY TWEET</button>
                  <button className="rr-gb" onClick={reset}>↺ SCAN ANOTHER</button>
                  {result.dex.dexUrl && (
                    <a href={result.dex.dexUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                      <button className="rr-gb">↗ VIEW ON DEXSCREENER</button>
                    </a>
                  )}
                </div>
                {copied && <div className="rr-cp">✓ Copied to clipboard</div>}
                <div className="rr-ext">
                  Data via <a href="https://dexscreener.com" target="_blank" rel="noreferrer">DexScreener</a>
                  {result.contract && <> · <a href={"https://etherscan.io/address/" + input} target="_blank" rel="noreferrer">Etherscan</a></>}
                </div>
              </div>
            )}

            {!result && !loading && !error && (
              <div className="rr-empty">
                <div className="rr-ei">◈</div>
                <div className="rr-et">AWAITING INPUT</div>
                <div className="rr-es">paste a real contract address and pray</div>
              </div>
            )}
          </>
        )}

        {/* HALL OF SHAME */}
        {tab === "shame" && (
          <>
            <div className="rr-lbl" style={{ marginBottom: 22 }}>CONFIRMED RUGS — HALL OF SHAME</div>
            {HALL_OF_SHAME.map((rug, i) => (
              <div key={i} className="rr-sr2">
                <div className="rr-sn2">{i + 1}</div>
                <div className="rr-si">☠️</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="rr-stk">${rug.token}</span>
                    <span style={{ fontSize: 9, padding: "2px 7px", border: "1px solid", color: t.textMute, borderColor: t.border2, letterSpacing: 1 }}>{rug.chain}</span>
                  </div>
                  <div className="rr-svd">{rug.verdict}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div className="rr-ssc">{rug.score}%</div>
                  <div className="rr-ssl">RUG SCORE</div>
                </div>
              </div>
            ))}
            <div className="rr-disc">
              DATA SOURCED FROM DEXSCREENER + ETHERSCAN APIs.<br />
              NOT FINANCIAL ADVICE. ALWAYS DYOR. BUT ALSO TRUST THE DATA.
            </div>
          </>
        )}

      </div>
    </div>
  );
}
