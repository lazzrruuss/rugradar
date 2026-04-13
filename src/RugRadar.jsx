import { useState, useEffect, useRef } from "react";

const ETHERSCAN_KEY = import.meta.env.VITE_ETHERSCAN_KEY || "E8G4BUJ4AA6BY2R916NJCUISEG8DSFCV9K";
const BSCSCAN_KEY   = import.meta.env.VITE_BSCSCAN_KEY   || "E8G4BUJ4AA6BY2R916NJCUISEG8DSFCV9K";

// ─── API FUNCTIONS ────────────────────────────────────────────────────────────
async function fetchDexScreener(address) {
  const res  = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
  const data = await res.json();
  const pair = data?.pairs?.[0];
  if (!pair) return null;
  return {
    name:        pair.baseToken?.name    || "Unknown",
    symbol:      pair.baseToken?.symbol  || "???",
    chain:       (pair.chainId || "eth").toUpperCase(),
    liquidity:   pair.liquidity?.usd     || 0,
    marketCap:   pair.marketCap          || 0,
    volume24h:   pair.volume?.h24        || 0,
    priceChange: pair.priceChange?.h24   || 0,
    txns24h:     (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
    dexUrl:      pair.url                || "",
    age:         pair.pairCreatedAt ? Math.floor((Date.now() - pair.pairCreatedAt) / 86400000) : null,
  };
}

async function fetchEtherscan(address) {
  if (!ETHERSCAN_KEY) return null;
  try {
    const res  = await fetch(`https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${address}&apikey=${ETHERSCAN_KEY}`);
    const data = await res.json();
    const src  = data?.result?.[0];
    return { verified: src?.ABI !== "Contract source code not verified", isProxy: src?.Proxy === "1" };
  } catch { return null; }
}

async function fetchBSCScan(address) {
  if (!BSCSCAN_KEY) return null;
  try {
    const res  = await fetch(`https://api.bscscan.com/api?module=contract&action=getsourcecode&address=${address}&apikey=${BSCSCAN_KEY}`);
    const data = await res.json();
    const src  = data?.result?.[0];
    return { verified: src?.ABI !== "Contract source code not verified", isProxy: src?.Proxy === "1" };
  } catch { return null; }
}

function calcScore({ dex, contract }) {
  let score = 0; const flags = [];
  if      (dex.liquidity < 1000)  { score += 30; flags.push("LIQUIDITY BELOW $1K"); }
  else if (dex.liquidity < 10000) { score += 20; flags.push("LOW LIQUIDITY"); }
  else if (dex.liquidity < 50000) { score += 10; flags.push("THIN LIQUIDITY"); }
  const mcl = dex.marketCap / Math.max(dex.liquidity, 1);
  if      (mcl > 100) { score += 20; flags.push("MC/LIQ RATIO EXTREME"); }
  else if (mcl > 50)  { score += 10; flags.push("HIGH MC/LIQ RATIO"); }
  if (dex.age !== null) {
    if      (dex.age < 1) { score += 15; flags.push("LESS THAN 1 DAY OLD"); }
    else if (dex.age < 3) { score += 10; flags.push("LESS THAN 3 DAYS OLD"); }
    else if (dex.age < 7) { score +=  5; flags.push("LESS THAN 1 WEEK OLD"); }
  }
  const vl = dex.volume24h / Math.max(dex.liquidity, 1);
  if      (vl > 5) { score += 15; flags.push("EXTREME SELL PRESSURE"); }
  else if (vl > 2) { score +=  8; flags.push("HIGH SELL PRESSURE"); }
  if      (dex.priceChange < -50) { score += 15; flags.push("PRICE DOWN 50%+"); }
  else if (dex.priceChange < -30) { score += 10; flags.push("PRICE DOWN 30%+"); }
  else if (dex.priceChange < -20) { score +=  5; flags.push("PRICE DOWN 20%+"); }
  if (contract) {
    if (!contract.verified) { score += 10; flags.push("CONTRACT UNVERIFIED"); }
    if (contract.isProxy)   { score +=  5; flags.push("PROXY CONTRACT"); }
  } else { score += 5; }
  if      (dex.txns24h < 10) { score += 10; flags.push("ALMOST NO TRANSACTIONS"); }
  else if (dex.txns24h < 50) { score +=  5; flags.push("LOW TRANSACTION COUNT"); }
  return { score: Math.min(score, 100), flags };
}

async function scanAddress(input) {
  const trimmed   = input.trim();
  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(trimmed);
  const dex = await fetchDexScreener(trimmed);
  if (!dex) throw new Error("Token not found on DexScreener. Check the address and try again.");
  let contract = null;
  if (isAddress) {
    const chain = dex.chain.toLowerCase();
    contract = chain.includes("bsc") || chain.includes("bnb") ? await fetchBSCScan(trimmed) : await fetchEtherscan(trimmed);
  }
  const { score, flags } = calcScore({ dex, contract });
  return { dex, contract, score, flags };
}

// ─── LIVE GAINERS FEED ────────────────────────────────────────────────────────
async function fetchGainers() {
  const queries = ["pump", "moon", "gem", "alpha", "rocket", "fire", "based", "pepe", "chad", "launch", "degen", "100x"];
  const results = [];
  await Promise.all(queries.map(async q => {
    try {
      const res  = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${q}`);
      const data = await res.json();
      if (data?.pairs) results.push(...data.pairs);
    } catch (_) {}
  }));
  const seen = new Set();
  return results
    .filter(p => {
      if (seen.has(p.pairAddress)) return false;
      seen.add(p.pairAddress);
      return (
        p.priceChange?.h24 > 15 &&
        p.liquidity?.usd > 2000 &&
        p.volume?.h24 > 300 &&
        p.baseToken?.symbol
      );
    })
    .sort((a, b) => b.priceChange.h24 - a.priceChange.h24)
    .slice(0, 25)
    .map(p => ({
      symbol:  p.baseToken.symbol,
      name:    p.baseToken.name || p.baseToken.symbol,
      chain:   (p.chainId || "eth").toUpperCase().slice(0, 3),
      change:  p.priceChange.h24.toFixed(1),
      change1h: p.priceChange?.h1 != null ? p.priceChange.h1.toFixed(1) : null,
      liq:     p.liquidity?.usd || 0,
      vol:     p.volume?.h24 || 0,
      mc:      p.marketCap || 0,
      url:     p.url || "",
      address: p.baseToken?.address || "",
    }));
}


// ─── LIVE RUGS FEED ───────────────────────────────────────────────────────────
async function fetchLiveRugs() {
  const queries = ["safe", "moon", "baby", "inu", "elon", "pepe", "floki", "shib", "doge", "cum", "token", "swap"];
  const results = [];
  await Promise.all(queries.map(async q => {
    try {
      const res  = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${q}`);
      const data = await res.json();
      if (data?.pairs) results.push(...data.pairs);
    } catch (_) {}
  }));
  const seen = new Set();
  const unique = results.filter(p => {
    if (seen.has(p.pairAddress)) return false;
    seen.add(p.pairAddress);
    return true;
  });
  return unique
    .filter(p =>
      p.priceChange?.h24 < -30 &&
      p.liquidity?.usd > 100 && p.liquidity?.usd < 100000 &&
      p.volume?.h24 > 20 && p.baseToken?.symbol
    )
    .sort((a, b) => a.priceChange.h24 - b.priceChange.h24)
    .slice(0, 25)
    .map(p => {
      const drop = Math.abs(p.priceChange?.h24 || 0);
      const liq  = p.liquidity?.usd || 0;
      const mc   = p.marketCap || 0;
      const age  = p.pairCreatedAt ? Math.floor((Date.now() - p.pairCreatedAt) / 86400000) : null;
      let score  = 40;
      if (drop > 80) score += 35; else if (drop > 60) score += 22; else if (drop > 40) score += 12; else score += 6;
      if (liq < 1000) score += 15; else if (liq < 10000) score += 8;
      if (mc / Math.max(liq, 1) > 100) score += 10;
      if (age !== null && age < 3) score += 10;
      const fmtL = liq < 1000 ? "$" + liq.toFixed(0) : "$" + (liq / 1000).toFixed(1) + "K";
      const vv = [
        `Down ${drop.toFixed(0)}% in 24h. Liquidity at ${fmtL}. This is a crime scene.`,
        `${drop.toFixed(0)}% crash. Volume dried up. Dev probably on vacation permanently.`,
        `Liquidity at ${fmtL} and falling. Chart looks like a staircase to zero.`,
        `${drop.toFixed(0)}% red in 24h. Holders in denial. Data is not.`,
        `${drop.toFixed(0)}% down. Someone is getting rekt. Might be you.`,
      ];
      return {
        token: p.baseToken.symbol, name: p.baseToken.name || p.baseToken.symbol,
        score: Math.min(score, 99),
        verdict: vv[Math.floor(Math.random() * vv.length)],
        chain: (p.chainId || "eth").replace("bsc","BSC").replace("ethereum","ETH").replace("solana","SOL").replace("arbitrum","ARB").toUpperCase(),
        drop: drop.toFixed(1), liq, mc, vol: p.volume?.h24 || 0, url: p.url || "", age,
        change1h: p.priceChange?.h1 != null ? p.priceChange.h1.toFixed(1) : null,
      };
    });
}


// ─── HELPERS ─────────────────────────────────────────────────────────────────
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

const VERDICTS = {
  safe:   ["Numbers check out. Still DYOR but this ain't an obvious funeral.", "Liquidity looks real. Dev hasn't vanished yet. Proceed cautiously.", "Cleaner than most. Still set a stop loss."],
  mid:    ["Smells like Exit Liquidity Season. Proceed with helmet.", "Not confirmed rug but the vibe is off. Trust the data.", "Whale concentration giving red flags. 50/50 you lose everything."],
  danger: ["Liquidity thinner than your patience. Dev already packing bags.", "The numbers are giving 'donation to a stranger' energy.", "Contract unverified. Volume suspicious. RIP your portfolio."],
  rug:    ["This is not a coin. This is a funeral with extra steps.", "Liquidity below $1K. Market cap in the millions. You do the math.", "Every single metric is red. Historic levels of not good."],
};

// ─── THEMES ──────────────────────────────────────────────────────────────────
const THEMES = {
  dark:   { name:"DARK",   icon:"🌑", bg:"#0f1117", surface:"#13161f", card:"#13161f", border:"#1e2130", border2:"#272d3f", input:"#181c27", text:"#e8e8e8", textSub:"#6a738f", textMute:"#3a4155", textDim:"#2a3045", accent:"#00ff88", accentDim:"rgba(0,255,136,0.08)" },
  light:  { name:"LIGHT",  icon:"☀️", bg:"#f0f2f7", surface:"#ffffff", card:"#ffffff", border:"#dde1ec", border2:"#c8cedd", input:"#f8f9fc", text:"#1a1d2e", textSub:"#5a6080", textMute:"#8890aa", textDim:"#b0b8cc", accent:"#00aa55", accentDim:"rgba(0,170,85,0.08)" },
  hacker: { name:"HACKER", icon:"💾", bg:"#000000", surface:"#001100", card:"#001800", border:"#003300", border2:"#004400", input:"#000d00", text:"#00ff41", textSub:"#00aa2a", textMute:"#006618", textDim:"#003a0e", accent:"#00ff41", accentDim:"rgba(0,255,65,0.06)" },
};

// ─── CSS FACTORY ─────────────────────────────────────────────────────────────
function makeCSS(t) {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Bebas+Neue&display=swap');
    .rr, .rr * { box-sizing: border-box; }
    .rr { min-height:100vh; background:${t.bg}; color:${t.text}; font-family:'Share Tech Mono',monospace; position:relative; overflow-x:hidden; transition:background 0.3s,color 0.3s; }

    @keyframes rr-scan    { 0%{top:-4px;} 100%{top:100%;} }
    @keyframes rr-flicker { 0%,89%,91%,93%,100%{opacity:1;} 90%{opacity:0.4;} 92%{opacity:0.7;} }
    @keyframes rr-up      { from{opacity:0;transform:translateY(14px);} to{opacity:1;transform:translateY(0);} }
    @keyframes rr-blink   { 0%,100%{opacity:1;} 50%{opacity:0;} }
    @keyframes rr-bar     { from{width:0%;} }
    @keyframes rr-dot     { 0%,100%{opacity:0.2;} 50%{opacity:1;} }
    @keyframes rr-glitch  { 0%,100%{transform:translate(0,0);} 25%{transform:translate(-3px,1px);} 50%{transform:translate(3px,-1px);} 75%{transform:translate(-2px,2px);} }
    @keyframes rr-scroll  { 0%{transform:translateX(0);} 100%{transform:translateX(-50%);} }
    @keyframes rr-bounce  { 0%,100%{transform:translateY(0);} 40%{transform:translateY(-5px);} 70%{transform:translateY(-2px);} }
    @keyframes rr-pulse   { 0%,100%{opacity:1;} 50%{opacity:0.5;} }
    @keyframes rr-popIn   { 0%{transform:scale(0.94);opacity:0;} 100%{transform:scale(1);opacity:1;} }
    @keyframes rr-flash   { 0%,100%{background:transparent;} 50%{background:rgba(0,255,136,0.12);} }

    .rr-line { position:fixed;left:0;right:0;height:2px;background:${t.accentDim};animation:rr-scan 5s linear infinite;pointer-events:none;z-index:9999; }
    .rr-crt  { position:fixed;inset:0;pointer-events:none;z-index:9998;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px); }

    /* ── HEADER ── */
    .rr-hdr  { border-bottom:1px solid ${t.border};padding:14px 24px;display:flex;justify-content:space-between;align-items:center;background:${t.surface};animation:rr-flicker 9s infinite; }
    .rr-logo { font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:5px;color:${t.accent}; }
    .rr-sub  { font-size:9px;color:${t.textMute};letter-spacing:3px;margin-top:2px; }
    .rr-hdr-right { display:flex;align-items:center;gap:14px; }
    .rr-live { font-size:9px;color:${t.textMute};text-align:right;line-height:2; }

    .rr-theme-bar { display:flex;gap:3px;background:${t.bg};border:1px solid ${t.border2};padding:3px;border-radius:2px; }
    .rr-theme-btn { background:transparent;border:none;cursor:pointer;font-size:9px;font-family:'Share Tech Mono',monospace;letter-spacing:1px;padding:4px 9px;color:${t.textMute};transition:background 0.15s,color 0.15s;white-space:nowrap; }
    .rr-theme-btn:hover { color:${t.text}; }
    .rr-theme-btn.active { background:${t.accent};color:#000; }

    /* ── GAINERS TICKER ── */
    .rr-ticker-wrap { background:${t.surface};border-bottom:1px solid ${t.border};overflow:hidden;height:34px;display:flex;align-items:center;position:relative; }
    .rr-ticker-label { font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:2px;color:${t.accent};padding:0 14px;white-space:nowrap;flex-shrink:0;border-right:1px solid ${t.border2}; }
    .rr-ticker-track { display:flex;animation:rr-scroll 40s linear infinite;width:max-content; }
    .rr-ticker-track:hover { animation-play-state:paused; }
    .rr-ticker-item  { display:flex;align-items:center;gap:7px;padding:0 20px;font-size:11px;white-space:nowrap;cursor:pointer;transition:background 0.15s;border-right:1px solid ${t.border}; }
    .rr-ticker-item:hover { background:${t.border}; }
    .rr-ticker-sym   { font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:1px;color:${t.text}; }
    .rr-ticker-up    { color:#00cc66;font-size:11px; }
    .rr-ticker-ch    { font-size:8px;color:${t.textMute};padding:1px 4px;border:1px solid ${t.border2}; }

    /* ── TABS ── */
    .rr-tabs { border-bottom:1px solid ${t.border};padding:0 24px;display:flex;gap:28px;background:${t.surface}; }
    .rr-tab  { background:transparent;border:none;border-bottom:2px solid transparent;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:2px;cursor:pointer;padding:10px 0;color:${t.textMute};transition:color 0.2s,border-color 0.2s; }
    .rr-tab.on { color:${t.accent};border-bottom-color:${t.accent}; }

    .rr-body { max-width:680px;margin:0 auto;padding:28px 24px; }
    .rr-lbl  { font-size:9px;color:${t.textSub};letter-spacing:3px;margin-bottom:8px; }

    /* ── INPUT ── */
    .rr-row { display:flex;margin-bottom:24px; }
    .rr-inp { flex:1;min-width:0;background:${t.input};border:1px solid ${t.border2};border-right:none;color:${t.text};font-family:'Share Tech Mono',monospace;font-size:13px;padding:13px 16px;outline:none;transition:border-color 0.2s,box-shadow 0.2s; }
    .rr-inp:focus { border-color:${t.accent};box-shadow:0 0 0 2px ${t.accentDim}; }
    .rr-inp::placeholder { color:${t.textDim}; }
    .rr-btn { background:${t.accent};color:#000;border:none;font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:3px;padding:13px 26px;cursor:pointer;flex-shrink:0;transition:opacity 0.15s,transform 0.1s; }
    .rr-btn:hover:not(:disabled) { opacity:0.85; }
    .rr-btn:active:not(:disabled) { transform:scale(0.97); }
    .rr-btn:disabled { background:${t.border2};color:${t.textMute};cursor:not-allowed; }

    /* ── GAINERS PANEL ── */
    .rr-gainers { margin-bottom:28px;animation:rr-up 0.4s ease; }
    .rr-gainers-hdr { display:flex;justify-content:space-between;align-items:center;margin-bottom:10px; }
    .rr-gainers-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px; }
    .rr-gainer-card {
      background:${t.card};border:1px solid ${t.border};
      padding:10px 12px;cursor:pointer;
      transition:border-color 0.2s,transform 0.15s,background 0.2s;
      animation:rr-popIn 0.3s ease;
    }
    .rr-gainer-card:hover { border-color:#00cc66;transform:translateY(-2px);background:rgba(0,204,102,0.04); }
    .rr-gainer-sym  { font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1px;color:${t.text}; }
    .rr-gainer-pct  { font-size:14px;color:#00cc66;font-family:'Bebas Neue',sans-serif; }
    .rr-gainer-meta { font-size:9px;color:${t.textMute};margin-top:3px;display:flex;gap:6px; }

    /* ── NOTICE ── */
    .rr-notice { font-size:10px;color:${t.textSub};margin-bottom:18px;padding:10px 14px;border:1px solid ${t.border2};background:${t.input};line-height:1.7;letter-spacing:0.5px; }
    .rr-notice a { color:${t.accent};text-decoration:none; }

    /* ── LOADING ── */
    .rr-loading { text-align:center;padding:52px 0; }
    .rr-lh { font-family:'Bebas Neue',sans-serif;font-size:40px;color:${t.accent};letter-spacing:6px; }
    .rr-ls { font-size:10px;color:${t.textMute};letter-spacing:2px;margin-top:14px; }
    .rr-dots { margin-top:20px;display:flex;gap:5px;justify-content:center; }
    .rr-d  { width:4px;height:4px;background:${t.accent};animation:rr-dot 0.9s ease-in-out infinite; }
    .rr-bl { animation:rr-blink 0.9s step-end infinite; }
    .rr-err { text-align:center;padding:40px 0; }
    .rr-err-msg { font-size:12px;color:#ff4444;letter-spacing:1px;line-height:1.7;margin-top:10px; }

    /* ── RESULT CARD ── */
    .rr-card { border:1px solid ${t.border};background:${t.card};padding:22px;animation:rr-up 0.4s ease; }
    .rr-card.gl { animation:rr-glitch 0.4s steps(2) forwards; }
    .rr-token-hdr { display:flex;align-items:center;gap:10px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid ${t.border}; }
    .rr-token-name { font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;color:${t.text}; }
    .rr-token-sym  { font-size:11px;color:${t.textSub};padding:2px 8px;border:1px solid ${t.border2}; }
    .rr-token-ch   { font-size:9px;color:${t.accent};padding:2px 7px;border:1px solid ${t.accent}33;letter-spacing:1px; }
    .rr-sh  { display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px; }
    .rr-sn  { font-family:'Bebas Neue',sans-serif;font-size:72px;line-height:1;letter-spacing:-2px; }
    .rr-rl  { font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:2px;margin-top:4px; }
    .rr-bg  { height:7px;background:${t.bg};border:1px solid ${t.border};overflow:hidden;margin-bottom:20px; }
    .rr-bf  { height:100%;width:0%;animation:rr-bar 1.1s ease-out 0.2s forwards; }

    /* ── STATS ── */
    .rr-st  { display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid ${t.border};font-size:12px;cursor:default;transition:background 0.15s; }
    .rr-st:hover { background:${t.border}; }
    .rr-st:last-child { border-bottom:none; }
    .rr-sl  { color:${t.textSub};letter-spacing:1px; }
    .rr-sv  { color:${t.text};margin-left:10px; }
    .rr-sr  { display:flex;align-items:center; }
    .rr-fl  { font-size:9px;padding:1px 6px;border:1px solid;letter-spacing:1px;margin-right:8px; }
    .rr-flags { margin-top:14px;display:flex;flex-wrap:wrap;gap:6px; }
    .rr-flag-chip { font-size:9px;padding:3px 8px;border:1px solid #ff444466;color:#ff4444;letter-spacing:1px;background:rgba(255,68,68,0.06);cursor:default;transition:background 0.15s; }
    .rr-flag-chip:hover { background:rgba(255,68,68,0.14); }
    .rr-vd  { border-left:2px solid;padding:11px 15px;margin-top:18px;font-size:13px;font-style:italic;line-height:1.6;background:${t.accentDim}; }

    /* ── BUTTONS ── */
    .rr-acts { display:flex;gap:10px;margin-top:18px;flex-wrap:wrap; }
    .rr-gb   { background:transparent;border:1px solid ${t.border2};color:${t.textSub};font-family:'Share Tech Mono',monospace;font-size:11px;padding:9px 18px;cursor:pointer;letter-spacing:1px;transition:border-color 0.2s,color 0.2s,transform 0.1s; }
    .rr-gb:hover { border-color:${t.accent};color:${t.accent};transform:translateY(-1px); }
    .rr-gb:active { transform:translateY(0); }
    .rr-cp   { margin-top:10px;font-size:10px;color:${t.accent};opacity:0.7;letter-spacing:2px;animation:rr-up 0.3s ease; }
    .rr-ext  { font-size:9px;color:${t.textMute};margin-top:10px; }
    .rr-ext a { color:${t.accent};text-decoration:none; }

    /* ── EMPTY ── */
    .rr-empty { text-align:center;padding:40px 0; }
    .rr-ei { font-size:42px;margin-bottom:12px;color:${t.textDim}; }
    .rr-et { font-size:11px;color:${t.textMute};letter-spacing:4px; }
    .rr-es { font-size:10px;color:${t.textDim};margin-top:8px; }

    /* ── HALL OF SHAME ── */
    .rr-sr2 { display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid ${t.border};cursor:pointer;transition:background 0.15s; }
    .rr-sr2:hover { background:${t.border}; }
    .rr-sr2:hover .rr-si { animation:rr-bounce 0.6s ease; }
    .rr-sr2:last-of-type { border-bottom:none; }
    .rr-sn2 { font-family:'Bebas Neue',sans-serif;font-size:24px;color:${t.textDim};min-width:22px; }
    .rr-si  { width:42px;height:42px;background:${t.input};border:1px solid ${t.border2};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0; }
    .rr-stk { font-family:'Bebas Neue',sans-serif;font-size:17px;color:${t.text};letter-spacing:1px; }
    .rr-svd { font-size:11px;color:${t.textSub};margin-top:3px;line-height:1.5; }
    .rr-ssc { font-family:'Bebas Neue',sans-serif;font-size:26px;color:#ff0055; }
    .rr-ssl { font-size:8px;color:${t.textMute};letter-spacing:1px; }
    .rr-disc { margin-top:28px;padding:16px;border:1px dashed ${t.border2};font-size:10px;color:${t.textMute};text-align:center;line-height:2;letter-spacing:1px; }

    /* ── MISC ── */
    .rr-divider { height:1px;background:${t.border};margin:24px 0; }
    .rr-flash   { animation:rr-flash 0.4s ease; }
  `;
}

// ─── TICKER COMPONENT ─────────────────────────────────────────────────────────
function GainersTicker({ gainers, losers, onClickToken, t }) {
  if (!gainers.length && !losers.length) return null;
  // Interleave: gainer, loser, gainer, loser...
  const mixed = [];
  const maxLen = Math.max(gainers.length, losers.length);
  for (let i = 0; i < maxLen; i++) {
    if (gainers[i]) mixed.push({ ...gainers[i], kind: "gain" });
    if (losers[i])  mixed.push({ symbol: losers[i].token, change: "-" + losers[i].drop, chain: losers[i].chain, address: null, kind: "loss" });
  }
  const doubled = [...mixed, ...mixed];
  return (
    <div className="rr-ticker-wrap">
      <div className="rr-ticker-label">⚡ LIVE</div>
      <div style={{ overflow: "hidden", flex: 1 }}>
        <div className="rr-ticker-track">
          {doubled.map((g, i) => (
            <div
              key={i}
              className="rr-ticker-item"
              onClick={() => g.address && onClickToken(g.address)}
              style={{ cursor: g.address ? "pointer" : "default", borderRight: "1px solid " + t.border }}
            >
              <span className="rr-ticker-sym">${g.symbol}</span>
              {g.kind === "gain"
                ? <span className="rr-ticker-up">▲ +{g.change}%</span>
                : <span style={{ color: "#ff3355", fontSize: 11 }}>▼ {g.change}%</span>
              }
              <span className="rr-ticker-ch">{g.chain}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── GAINERS & LOSERS PANEL ───────────────────────────────────────────────────
function MarketPanel({ t, onClickToken }) {
  const [gainers, setGainers] = useState([]);
  const [losers,  setLosers]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUp,  setLastUp]  = useState(null);
  const [activeTab, setActiveTab] = useState("gainers");
  const [sortBy, setSortBy] = useState("change");

  const load = async () => {
    setLoading(true);
    try {
      const [g, l] = await Promise.all([fetchGainers(), fetchLiveRugs()]);
      setGainers(g);
      setLosers(l);
      setLastUp(new Date());
    } catch (_) {}
    finally { setLoading(false); }
  };

  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, []);

  const sortedGainers = [...gainers].sort((a, b) => {
    if (sortBy === "change") return parseFloat(b.change) - parseFloat(a.change);
    if (sortBy === "liq")    return b.liq - a.liq;
    if (sortBy === "vol")    return (b.vol || 0) - (a.vol || 0);
    return 0;
  });

  const sortedLosers = [...losers].sort((a, b) => {
    if (sortBy === "change") return parseFloat(b.drop) - parseFloat(a.drop);
    if (sortBy === "liq")    return b.liq - a.liq;
    if (sortBy === "vol")    return (b.vol || 0) - (a.vol || 0);
    return 0;
  });

  const list = activeTab === "gainers" ? sortedGainers : sortedLosers;

  const SortBtn = ({ val, label }) => (
    <button
      onClick={() => setSortBy(val)}
      style={{
        background: sortBy === val ? t.accent : "transparent",
        border: "1px solid " + (sortBy === val ? t.accent : t.border2),
        color: sortBy === val ? "#000" : t.textMute,
        fontFamily: "'Share Tech Mono', monospace",
        fontSize: 9, padding: "3px 8px", cursor: "pointer",
        letterSpacing: 1, transition: "all 0.15s",
      }}
    >{label}</button>
  );

  return (
    <div style={{ marginBottom: 28 }}>
      {/* Panel header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 0, border: "1px solid " + t.border2 }}>
          <button
            onClick={() => setActiveTab("gainers")}
            style={{
              background: activeTab === "gainers" ? "#00cc66" : "transparent",
              border: "none", borderRight: "1px solid " + t.border2,
              color: activeTab === "gainers" ? "#000" : t.textMute,
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: 2,
              padding: "6px 16px", cursor: "pointer", transition: "all 0.2s",
            }}
          >🚀 GAINERS ({gainers.length})</button>
          <button
            onClick={() => setActiveTab("losers")}
            style={{
              background: activeTab === "losers" ? "#ff0055" : "transparent",
              border: "none",
              color: activeTab === "losers" ? "#fff" : t.textMute,
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: 2,
              padding: "6px 16px", cursor: "pointer", transition: "all 0.2s",
            }}
          >☠ LOSERS ({losers.length})</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ display: "flex", gap: 4 }}>
            <SortBtn val="change" label="% CHG" />
            <SortBtn val="liq"    label="LIQ" />
            <SortBtn val="vol"    label="VOL" />
          </div>
          <button className="rr-gb" onClick={load} disabled={loading} style={{ fontSize: 9, padding: "4px 10px" }}>
            {loading ? "..." : "↺"}
          </button>
        </div>
      </div>

      {lastUp && (
        <div style={{ fontSize: 9, color: t.textDim, letterSpacing: 1, marginBottom: 10 }}>
          {lastUp.toLocaleTimeString()} · {activeTab === "gainers" ? "Click to scan" : "Click to scan · Sorted by " + sortBy}
        </div>
      )}

      {loading && list.length === 0 ? (
        <div style={{ fontSize: 11, color: t.textMute, padding: "20px 0", letterSpacing: 2 }}>
          FETCHING {activeTab.toUpperCase()}<span className="rr-bl">_</span>
        </div>
      ) : list.length === 0 ? (
        <div style={{ fontSize: 11, color: t.textMute, padding: "12px 0" }}>Nothing found right now.</div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 7,
          opacity: loading ? 0.6 : 1,
          transition: "opacity 0.3s",
        }}>
          {list.map((item, i) => {
            const isGainer = activeTab === "gainers";
            const pct      = isGainer ? "+" + item.change + "%" : "-" + item.drop + "%";
            const pctColor = isGainer ? "#00cc66" : "#ff3355";
            const addr     = isGainer ? item.address : null;
            return (
              <div
                key={i}
                onClick={() => addr && onClickToken(addr)}
                title={addr ? "Click to scan" : ""}
                style={{
                  background: t.card,
                  border: "1px solid " + t.border,
                  padding: "10px 11px",
                  cursor: addr ? "pointer" : "default",
                  transition: "border-color 0.2s, transform 0.15s, background 0.2s",
                  animation: "rr-popIn 0.3s ease",
                  animationDelay: i * 0.03 + "s",
                  animationFillMode: "both",
                  position: "relative",
                  overflow: "hidden",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = isGainer ? "#00cc66" : "#ff3355";
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.background = isGainer ? "rgba(0,204,102,0.04)" : "rgba(255,51,85,0.04)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = t.border;
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.background = t.card;
                }}
              >
                {/* Left accent bar */}
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0, width: 2,
                  background: isGainer ? "#00cc6666" : "#ff335566",
                }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: 1, color: t.text }}>
                    ${item.symbol}
                  </div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, color: pctColor }}>
                    {pct}
                  </div>
                </div>
                <div style={{ fontSize: 9, color: t.textMute, display: "flex", gap: 5, flexWrap: "wrap" }}>
                  <span style={{ color: t.textSub }}>{item.chain || "?"}</span>
                  <span>{fmt(item.liq)} liq</span>
                </div>
                {item.change1h && (
                  <div style={{ fontSize: 8, color: t.textDim, marginTop: 3 }}>
                    1h: {parseFloat(item.change1h) > 0 ? "+" : ""}{item.change1h}%
                  </div>
                )}
                {!isGainer && item.age !== null && item.age < 7 && (
                  <div style={{ fontSize: 8, color: "#e6a800", marginTop: 3 }}>{item.age}d old</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── HALL OF SHAME COMPONENT ──────────────────────────────────────────────────
function HallOfShame({ t }) {
  const [rugs, setRugs]   = useState([]);
  const [loading, setLoad] = useState(true);
  const [lastUp, setLastUp] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = async () => {
    setLoad(true);
    try { const d = await fetchLiveRugs(); setRugs(d); setLastUp(new Date()); }
    catch (_) {}
    finally { setLoad(false); }
  };

  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, []);

  const fmtL = n => {
    if (!n) return "N/A";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + n.toFixed(0);
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div className="rr-lbl" style={{ marginBottom: 2 }}>☠ LIVE RUG FEED — ACTIVELY COLLAPSING</div>
          <div style={{ fontSize: 9, color: t.textMute, letterSpacing: 1 }}>Down 40%+ in 24h · Low liquidity · Click a row to expand</div>
          {lastUp && <div style={{ fontSize: 9, color: t.textDim, letterSpacing: 1, marginTop: 2 }}>Updated {lastUp.toLocaleTimeString()}</div>}
        </div>
        <button className="rr-gb" onClick={load} disabled={loading} style={{ fontSize: 10, padding: "6px 14px" }}>
          {loading ? "LOADING..." : "↺ REFRESH"}
        </button>
      </div>

      {loading && rugs.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div className="rr-lh" style={{ fontSize: 28 }}>SCANNING<span className="rr-bl">_</span></div>
          <div className="rr-ls" style={{ marginTop: 10 }}>HUNTING FOR RUGS IN REAL TIME...</div>
        </div>
      )}

      {!loading && rugs.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", color: t.textMute, fontSize: 12 }}>
          No active rugs detected right now. The degens are sleeping.
        </div>
      )}

      {rugs.map((rug, i) => (
        <div key={i} style={{ opacity: loading ? 0.5 : 1, transition: "opacity 0.3s" }}>
          {/* Main row — clickable to expand */}
          <div
            className="rr-sr2"
            onClick={() => setExpanded(expanded === i ? null : i)}
            style={{ paddingLeft: 8, borderLeft: expanded === i ? "2px solid #ff0055" : "2px solid transparent", transition: "border-color 0.2s" }}
          >
            <div className="rr-sn2">{i + 1}</div>
            <div className="rr-si" style={{ animation: expanded === i ? "rr-bounce 0.6s ease" : "none" }}>☠️</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
                <span className="rr-stk">${rug.token}</span>
                <span style={{ fontSize: 9, padding: "2px 5px", border: "1px solid", color: t.textMute, borderColor: t.border2, letterSpacing: 1 }}>{rug.chain}</span>
                {rug.age !== null && rug.age < 7 && (
                  <span style={{ fontSize: 9, padding: "2px 5px", border: "1px solid #e6a80066", color: "#e6a800", letterSpacing: 1 }}>{rug.age}d OLD</span>
                )}
              </div>
              <div className="rr-svd">{rug.verdict}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div className="rr-ssc">{rug.score}%</div>
              <div style={{ fontSize: 10, color: "#ff4444", fontFamily: "'Share Tech Mono',monospace" }}>▼ {rug.drop}%</div>
              <div style={{ fontSize: 9, color: t.textMute, marginTop: 2 }}>{expanded === i ? "▲ LESS" : "▼ MORE"}</div>
            </div>
          </div>

          {/* Expanded details */}
          {expanded === i && (
            <div style={{
              background: t.input, border: "1px solid " + t.border2, borderTop: "none",
              padding: "12px 16px", marginBottom: 4, animation: "rr-up 0.2s ease",
              display: "flex", gap: 24, flexWrap: "wrap", fontSize: 11,
            }}>
              <div><span style={{ color: t.textMute }}>LIQUIDITY  </span><span style={{ color: t.text }}>{fmtL(rug.liq)}</span></div>
              {rug.mc > 0 && <div><span style={{ color: t.textMute }}>MARKET CAP  </span><span style={{ color: t.text }}>{fmtL(rug.mc)}</span></div>}
              {rug.age !== null && <div><span style={{ color: t.textMute }}>AGE  </span><span style={{ color: t.text }}>{rug.age} days</span></div>}
              {rug.url && (
                <a href={rug.url} target="_blank" rel="noreferrer"
                  style={{ color: t.accent, textDecoration: "none", fontSize: 10, letterSpacing: 1 }}>
                  VIEW ON DEXSCREENER ↗
                </a>
              )}
            </div>
          )}
        </div>
      ))}

      <div className="rr-disc" style={{ marginTop: 24 }}>
        LIVE DATA FROM DEXSCREENER. REFRESHES EVERY 60 SECONDS.<br />
        NOT FINANCIAL ADVICE. ALWAYS DYOR. BUT ALSO TRUST THE DATA.
      </div>
    </>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
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
  const [gainers, setGainers]   = useState([]);
  const [losers,  setLosers]    = useState([]);
  const inputRef = useRef();

  const t   = THEMES[themeKey];
  const CSS = makeCSS(t);

  const LOAD_MSGS = [
    "CONNECTING TO DEXSCREENER...",
    "PULLING LIQUIDITY DATA...",
    "CHECKING CONTRACT INFO...",
    "ANALYZING SELL PRESSURE...",
    "CALCULATING RUG SCORE...",
  ];

  // Prefetch gainers + losers for ticker
  useEffect(() => {
    fetchGainers().then(setGainers).catch(() => {});
    fetchLiveRugs().then(setLosers).catch(() => {});
  }, []);

  const scan = async (addr) => {
    const target = addr || input;
    if (!target.trim() || loading) return;
    if (addr) { setInput(addr); setTab("scanner"); }
    setLoad(true); setResult(null); setError(""); setCopied(false);
    setGlitch(true); setTimeout(() => setGlitch(false), 420);
    let msgIdx = 0;
    setLoadMsg(LOAD_MSGS[0]);
    const msgInterval = setInterval(() => {
      msgIdx = (msgIdx + 1) % LOAD_MSGS.length;
      setLoadMsg(LOAD_MSGS[msgIdx]);
    }, 900);
    try {
      const data = await scanAddress(addr || input);
      const risk = getRiskLevel(data.score);
      setVerdict(VERDICTS[risk.tier][Math.floor(Math.random() * VERDICTS[risk.tier].length)]);
      setResult({ ...data, risk });
    } catch (err) {
      setError(err.message || "Something went wrong. Try again.");
    } finally {
      clearInterval(msgInterval);
      setLoad(false);
    }
  };

  const handleClickToken = (address) => {
    setInput(address);
    setTab("scanner");
    scan(address);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    { lbl: "Liquidity (USD)",    val: fmt(result.dex.liquidity),  flag: result.dex.liquidity < 10000 ? "⚠ LOW" : null,  fc: "#e6a800" },
    { lbl: "Market Cap",         val: fmt(result.dex.marketCap),  flag: null, fc: "#e6a800" },
    { lbl: "24h Volume",         val: fmt(result.dex.volume24h),  flag: null, fc: "#e6a800" },
    { lbl: "24h Price Change",   val: (result.dex.priceChange > 0 ? "+" : "") + result.dex.priceChange?.toFixed(2) + "%", flag: result.dex.priceChange < -30 ? "⚠ DUMPING" : null, fc: "#ff4444" },
    { lbl: "24h Transactions",   val: result.dex.txns24h?.toLocaleString() || "N/A", flag: result.dex.txns24h < 20 ? "⚠ DEAD" : null, fc: "#e6a800" },
    { lbl: "Token Age",          val: result.dex.age !== null ? result.dex.age + " days" : "N/A", flag: result.dex.age !== null && result.dex.age < 3 ? "⚠ NEW" : null, fc: "#e6a800" },
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
          <div className="rr-sub">REAL-TIME DEGEN SURVIVAL TOOL v3.1</div>
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
            <div style={{ color: t.accent, opacity: 0.5 }}>■ LIVE</div>
            <div>DEXSCREENER</div>
          </div>
        </div>
      </div>

      {/* Gainers ticker — always visible */}
      <GainersTicker gainers={gainers} losers={losers} onClickToken={handleClickToken} t={t} />

      {/* Tabs */}
      <div className="rr-tabs">
        {[["scanner","⬡ SCANNER"],["shame","☠ HALL OF SHAME"]].map(([id, label]) => (
          <button key={id} className={"rr-tab" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      <div className="rr-body">

        {tab === "scanner" && (
          <>
            {!ETHERSCAN_KEY && (
              <div className="rr-notice">
                ⚠ Add <strong>VITE_ETHERSCAN_KEY</strong> to your <strong>.env</strong> for contract verification.
                Free key at <a href="https://etherscan.io/myapikey" target="_blank" rel="noreferrer">etherscan.io</a>.
              </div>
            )}

            <div className="rr-lbl">PASTE CONTRACT ADDRESS</div>
            <div className="rr-row">
              <input
                ref={inputRef}
                className="rr-inp"
                placeholder="0x... contract address"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && scan()}
              />
              <button className="rr-btn" onClick={() => scan()} disabled={loading || !input.trim()}>
                {loading ? "..." : "SCAN"}
              </button>
            </div>

            {/* Live gainers panel on homepage */}
            {!result && !loading && !error && (
              <MarketPanel t={t} onClickToken={handleClickToken} />
            )}

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
                <div style={{ fontSize: 32 }}>⚠️</div>
                <div className="rr-err-msg">{error}</div>
                <button className="rr-gb" onClick={reset} style={{ marginTop: 16 }}>↺ TRY AGAIN</button>
              </div>
            )}

            {result && !loading && (
              <div className={"rr-card" + (glitch ? " gl" : "")}>
                <div className="rr-token-hdr">
                  <span className="rr-token-name">{result.dex.name}</span>
                  <span className="rr-token-sym">${result.dex.symbol}</span>
                  <span className="rr-token-ch">{result.dex.chain}</span>
                </div>

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

                <div className="rr-bg">
                  <div className="rr-bf" style={{ width: result.score + "%", background: "linear-gradient(90deg," + t.accent + "," + risk.color + ")" }} />
                </div>

                {STATS.map(({ lbl, val, flag, fc }) => (
                  <div key={lbl} className="rr-st">
                    <span className="rr-sl">{lbl}</span>
                    <div className="rr-sr">
                      {flag && <span className="rr-fl" style={{ color: fc, borderColor: fc }}>{flag}</span>}
                      <span className="rr-sv">{val}</span>
                    </div>
                  </div>
                ))}

                {result.flags?.length > 0 && (
                  <div className="rr-flags">
                    {result.flags.map(f => <span key={f} className="rr-flag-chip">{f}</span>)}
                  </div>
                )}

                <div className="rr-vd" style={{ borderColor: risk.color, color: risk.color }}>
                  {verdict}
                </div>

                <div className="rr-acts">
                  <button className="rr-gb" onClick={share}>↗ COPY TWEET</button>
                  <button className="rr-gb" onClick={reset}>↺ SCAN ANOTHER</button>
                  {result.dex.dexUrl && (
                    <a href={result.dex.dexUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                      <button className="rr-gb">↗ DEXSCREENER</button>
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
          </>
        )}

        {tab === "shame" && <HallOfShame t={t} />}

      </div>
    </div>
  );
}