import { useState, useEffect, useMemo } from "react";

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx9cxN1nOmdkS01NcrLrHJRtaZ6oTVyL9kOLFu1LJOU4gg8WsuyuTye8HG3JJOwsgwb/exec";
const ASSET_TYPES = ["Azione", "ETF", "Crypto"];
const ASSET_COLORS = { Azione: "#378ADD", ETF: "#1D9E75", Fondo: "#7F77DD", Crypto: "#EF9F27" };
const STORAGE_KEY = "portafoglio_v2";

function loadLocal() {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : { posizioni: [], movimenti: [] }; }
  catch { return { posizioni: [], movimenti: [] }; }
}
function saveLocal(d) { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }
async function loadFromSheets() {
  const r = await fetch(`${SCRIPT_URL}?action=load`); return r.json();
}
async function saveToSheets(d) {
  await fetch(`${SCRIPT_URL}?action=save&data=${encodeURIComponent(JSON.stringify(d))}`);
}

function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}
function fmtEur(n) {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(n);
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return "—";
  return (n >= 0 ? "+" : "") + fmt(n, 2) + "%";
}

async function fetchLivePrice(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
    const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
    const json = await res.json();
    const data = JSON.parse(json.contents);
    const meta = data?.chart?.result?.[0]?.meta;
    return meta?.regularMarketPrice ?? null;
  } catch { return null; }
}

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [data, setData] = useState(loadLocal);
  const [prices, setPrices] = useState({});
  const [toast, setToast] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [loadingCloud, setLoadingCloud] = useState(true);
  const [updatingPrices, setUpdatingPrices] = useState(false);

  useEffect(() => {
    loadFromSheets()
      .then(remote => {
        if (remote && !remote.error && (remote.posizioni?.length > 0 || remote.movimenti?.length > 0)) {
          setData(remote); saveLocal(remote); setLastSync(new Date());
        }
      })
      .catch(() => {})
      .finally(() => setLoadingCloud(false));
  }, []);

  useEffect(() => { saveLocal(data); }, [data]);

  function showToast(msg, type = "ok") {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3000);
  }

  async function syncToCloud(newData) {
    setSyncing(true);
    try { await saveToSheets(newData); setLastSync(new Date()); }
    catch { showToast("Errore sync cloud", "warn"); }
    setSyncing(false);
  }

  async function aggiornaPressiAutomatico() {
    if (data.posizioni.length === 0) return;
    setUpdatingPrices(true);
    showToast("Aggiorno prezzi...", "info");
    const newPrices = { ...prices };
    for (const p of data.posizioni) {
      const price = await fetchLivePrice(p.ticker);
      if (price) newPrices[p.ticker] = price;
    }
    setPrices(newPrices);
    // Aggiorna prezzoManuale nelle posizioni
    const nuovePosizioni = data.posizioni.map(p => ({
      ...p,
      prezzoManuale: newPrices[p.ticker] ?? p.prezzoManuale ?? p.pmc
    }));
    const newData = { ...data, posizioni: nuovePosizioni };
    setData(newData);
    await syncToCloud(newData);
    setUpdatingPrices(false);
    showToast("Prezzi aggiornati!");
  }

  function aggiornaPosizioneConMovimento(pos, mov) {
    if (mov.tipo === "acquisto" || mov.tipo === "pac") {
      const nQ = Number(pos.quantita) + Number(mov.quantita);
      const nPMC = (Number(pos.quantita) * Number(pos.pmc) + Number(mov.quantita) * Number(mov.prezzo)) / nQ;
      return { ...pos, quantita: nQ, pmc: nPMC };
    }
    if (mov.tipo === "vendita") return { ...pos, quantita: Math.max(0, Number(pos.quantita) - Number(mov.quantita)) };
    return pos;
  }

  function addPosizione(p) {
    setData(d => {
      if (d.posizioni.find(x => x.ticker.toUpperCase() === p.ticker.toUpperCase())) {
        showToast("Ticker già presente", "warn"); return d;
      }
      const nuova = { ...p, id: Date.now(), ticker: p.ticker.toUpperCase() };
      const nd = { ...d, posizioni: [...d.posizioni, nuova] };
      showToast(`${nuova.ticker} aggiunto`); syncToCloud(nd); return nd;
    });
  }

  function editPosizione(id, updates) {
    setData(d => {
      const nd = { ...d, posizioni: d.posizioni.map(p => p.id === id ? { ...p, ...updates } : p) };
      showToast("Posizione aggiornata"); syncToCloud(nd); return nd;
    });
  }

  function deletePosizione(id) {
    setData(d => {
      const nd = { ...d, posizioni: d.posizioni.filter(p => p.id !== id) };
      showToast("Posizione rimossa"); syncToCloud(nd); return nd;
    });
  }

  function addMovimento(mov) {
    setData(d => {
      const pos = d.posizioni.find(p => p.ticker === mov.ticker.toUpperCase());
      if (!pos && mov.tipo === "vendita") { showToast("Ticker non trovato", "warn"); return d; }
      let nuovePosizioni = d.posizioni;
      if (pos) {
        nuovePosizioni = d.posizioni.map(p => p.ticker === mov.ticker.toUpperCase() ? aggiornaPosizioneConMovimento(p, mov) : p);
      } else {
        nuovePosizioni = [...d.posizioni, { id: Date.now(), ticker: mov.ticker.toUpperCase(), nome: mov.ticker.toUpperCase(), tipo: mov.tipoAsset || "Azione", quantita: mov.quantita, pmc: mov.prezzo, prezzoManuale: mov.prezzo }];
      }
      const nd = { posizioni: nuovePosizioni, movimenti: [{ ...mov, id: Date.now(), ticker: mov.ticker.toUpperCase(), data: mov.data || new Date().toISOString().slice(0, 10) }, ...d.movimenti] };
      showToast(`${mov.tipo} registrato`); syncToCloud(nd); return nd;
    });
  }

  const posizioni = useMemo(() => data.posizioni.map(p => {
    const prezzoLive = prices[p.ticker] ?? p.prezzoManuale ?? p.pmc;
    const valoreMercato = Number(prezzoLive) * Number(p.quantita);
    const costoCarico = Number(p.pmc) * Number(p.quantita);
    const plLatente = valoreMercato - costoCarico;
    const plPct = costoCarico > 0 ? (plLatente / costoCarico) * 100 : 0;
    return { ...p, prezzoLive, valoreMercato, costoCarico, plLatente, plPct };
  }), [data.posizioni, prices]);

  const totali = useMemo(() => {
    const totValore = posizioni.reduce((s, p) => s + (p.valoreMercato || 0), 0);
    const totCosto = posizioni.reduce((s, p) => s + (p.costoCarico || 0), 0);
    const totPL = totValore - totCosto;
    return { totValore, totCosto, totPL, totPLpct: totCosto > 0 ? (totPL / totCosto) * 100 : 0 };
  }, [posizioni]);

  const NAV = [
    { id: "dashboard", label: "Home", icon: "⬡" },
    { id: "portafoglio", label: "Titoli", icon: "◈" },
    { id: "movimenti", label: "Movimenti", icon: "↕" },
    { id: "cerca", label: "Cerca", icon: "◎" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e8e6df", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", paddingBottom: 72 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 3px; } ::-webkit-scrollbar-thumb { background: #2a2a35; border-radius: 2px; }
        input, select { background: #13131a; border: 1px solid #2a2a38; border-radius: 10px; color: #e8e6df; padding: 12px 14px; font-family: inherit; font-size: 16px; width: 100%; outline: none; -webkit-appearance: none; }
        input:focus, select:focus { border-color: #4a7fd4; }
        select option { background: #13131a; }
        button { cursor: pointer; font-family: inherit; font-size: 15px; border: none; border-radius: 10px; padding: 12px 20px; transition: all .15s; -webkit-tap-highlight-color: transparent; }
        .btn-primary { background: #4a7fd4; color: #fff; font-weight: 500; }
        .btn-primary:active { background: #3a6fc4; transform: scale(0.98); }
        .btn-ghost { background: transparent; color: #9a98a0; border: 1px solid #2a2a38; }
        .btn-ghost:active { background: #1a1a25; }
        .btn-danger { background: transparent; color: #e24b4a; border: 1px solid #3a2020; }
        .card { background: #13131a; border: 1px solid #1e1e2a; border-radius: 16px; padding: 16px; }
        .tag { display: inline-block; font-size: 11px; font-weight: 500; padding: 3px 9px; border-radius: 20px; }
        .pl-pos { color: #4ecb8d; } .pl-neg { color: #e24b4a; }
        label { font-size: 12px; color: #7a7888; margin-bottom: 6px; display: block; letter-spacing: .04em; }
        .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.8); display: flex; align-items: flex-end; justify-content: center; z-index: 200; }
        .modal { background: #13131a; border: 1px solid #2a2a38; border-radius: 20px 20px 0 0; padding: 24px 20px 40px; width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto; }
        .mono { font-family: 'DM Mono', monospace; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; display: inline-block; }
        .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; background: #0d0d14; border-top: 1px solid #1a1a25; display: flex; z-index: 100; padding-bottom: env(safe-area-inset-bottom); }
        .nav-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 10px 4px; background: none; border: none; border-radius: 0; font-size: 10px; letter-spacing: .04em; transition: color .15s; }
        .nav-btn.active { color: #4a7fd4; }
        .nav-btn:not(.active) { color: #4a4858; }
        .nav-icon { font-size: 20px; }
        .section-title { font-size: 22px; font-weight: 600; letter-spacing: -.02em; margin-bottom: 4px; }
        .section-sub { color: #5a5868; font-size: 13px; margin-bottom: 20px; }
        .kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
        .kpi-card { background: #13131a; border: 1px solid #1e1e2a; border-radius: 14px; padding: 14px; }
        .kpi-label { font-size: 10px; color: #5a5868; letter-spacing: .06em; margin-bottom: 6px; }
        .kpi-val { font-size: 18px; font-weight: 600; font-family: 'DM Mono', monospace; }
        .kpi-sub { font-size: 12px; margin-top: 3px; }
        .pos-card { background: #13131a; border: 1px solid #1e1e2a; border-radius: 14px; padding: 14px; margin-bottom: 10px; }
        .pos-row { display: flex; justify-content: space-between; align-items: center; }
        .bar-wrap { background: #1a1a25; border-radius: 4px; height: 4px; overflow: hidden; margin-top: 8px; }
        .bar { height: 100%; border-radius: 4px; }
        .mov-item { background: #13131a; border: 1px solid #1e1e2a; border-radius: 12px; padding: 12px 14px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
        .form-group { margin-bottom: 14px; }
        .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .update-btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; background: #0f2a1a; border: 1px solid #1a4a2a; color: #4ecb8d; border-radius: 12px; padding: 14px; font-size: 15px; font-weight: 500; margin-bottom: 16px; }
        .update-btn:active { background: #1a3a28; }
        .sync-badge { font-size: 11px; display: flex; align-items: center; gap: 4px; }
      `}</style>

      {/* HEADER */}
      <div style={{ padding: "52px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 13, color: "#4a4858", letterSpacing: ".06em" }}>PORTAFOGLIO</div>
          <div style={{ fontSize: 11, marginTop: 2 }} className="sync-badge">
            {syncing
              ? <><span className="spin">↻</span><span style={{ color: "#378ADD" }}>Sync...</span></>
              : lastSync
              ? <span style={{ color: "#1D9E75" }}>✓ {lastSync.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>
              : <span style={{ color: "#3a3848" }}>○ locale</span>}
          </div>
        </div>
        <div style={{ fontSize: 28 }}>
          {loadingCloud ? <span className="spin">↻</span> : "◈"}
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ padding: "0 20px" }}>
        {loadingCloud ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50vh", gap: 16, color: "#4a4858" }}>
            <span className="spin" style={{ fontSize: 36 }}>↻</span>
            <div style={{ fontSize: 14 }}>Carico dal cloud...</div>
          </div>
        ) : (
          <>
            {page === "dashboard" && <Dashboard posizioni={posizioni} totali={totali} onAggiornaPressi={aggiornaPressiAutomatico} updatingPrices={updatingPrices} />}
            {page === "portafoglio" && <Portafoglio posizioni={posizioni} onAdd={addPosizione} onEdit={editPosizione} onDelete={deletePosizione} />}
            {page === "movimenti" && <Movimenti movimenti={data.movimenti} posizioni={data.posizioni} onAdd={addMovimento} />}
            {page === "cerca" && <CercaTitolo />}
          </>
        )}
      </div>

      {/* BOTTOM NAV */}
      <nav className="bottom-nav">
        {NAV.map(n => (
          <button key={n.id} className={`nav-btn ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
            <span className="nav-icon">{n.icon}</span>
            {n.label}
          </button>
        ))}
      </nav>

      {/* TOAST */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 88, left: 20, right: 20,
          background: toast.type === "warn" ? "#2a1f0a" : toast.type === "info" ? "#0a1f2a" : "#0f2a1a",
          border: `1px solid ${toast.type === "warn" ? "#4a3010" : toast.type === "info" ? "#1a3a4a" : "#1a4a2a"}`,
          color: toast.type === "warn" ? "#EF9F27" : toast.type === "info" ? "#378ADD" : "#4ecb8d",
          padding: "12px 18px", borderRadius: 12, fontSize: 14, zIndex: 300, textAlign: "center",
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/* ─── DASHBOARD ─── */
function Dashboard({ posizioni, totali, onAggiornaPressi, updatingPrices }) {
  const byType = useMemo(() => {
    const map = {};
    posizioni.forEach(p => { map[p.tipo] = (map[p.tipo] || 0) + p.valoreMercato; });
    return Object.entries(map).map(([tipo, val]) => ({
      tipo, val, pct: totali.totValore > 0 ? (val / totali.totValore) * 100 : 0
    }));
  }, [posizioni, totali]);

  const rischioConc = posizioni.filter(p => totali.totValore > 0 && (p.valoreMercato / totali.totValore) * 100 > 25);

  if (posizioni.length === 0) return (
    <div className="card" style={{ textAlign: "center", padding: "60px 20px", color: "#4a4858", marginTop: 20 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>◈</div>
      <div style={{ fontSize: 17, marginBottom: 8 }}>Portafoglio vuoto</div>
      <div style={{ fontSize: 13 }}>Vai in "Titoli" per aggiungere le tue posizioni</div>
    </div>
  );

  return (
    <div>
      {/* PULSANTE AGGIORNA PREZZI */}
      <button className="update-btn" onClick={onAggiornaPressi} disabled={updatingPrices}>
        {updatingPrices ? <><span className="spin">↻</span> Aggiornamento in corso...</> : <><span>↻</span> Aggiorna prezzi live</>}
      </button>

      {/* KPI */}
      <div className="kpi-grid">
        <div className="kpi-card" style={{ gridColumn: "1 / -1" }}>
          <div className="kpi-label">VALORE TOTALE</div>
          <div className="kpi-val" style={{ fontSize: 28 }}>{fmtEur(totali.totValore)}</div>
          <div className="kpi-sub" style={{ color: totali.totPL >= 0 ? "#4ecb8d" : "#e24b4a" }}>
            {fmtEur(totali.totPL)} ({fmtPct(totali.totPLpct)})
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">COSTO CARICO</div>
          <div className="kpi-val" style={{ fontSize: 16 }}>{fmtEur(totali.totCosto)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">POSIZIONI</div>
          <div className="kpi-val" style={{ fontSize: 16 }}>{posizioni.length}</div>
          <div className="kpi-sub" style={{ color: "#5a5868" }}>{byType.length} classi</div>
        </div>
      </div>

      {/* ALERT */}
      {rischioConc.length > 0 && (
        <div style={{ background: "#1f1808", border: "1px solid #3a2e08", borderRadius: 12, padding: "12px 14px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span>⚠</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#EF9F27" }}>Concentrazione elevata</div>
            <div style={{ fontSize: 12, color: "#8a7a40", marginTop: 2 }}>
              {rischioConc.map(p => `${p.ticker} (${fmt((p.valoreMercato / totali.totValore) * 100, 1)}%)`).join(", ")} &gt; 25%
            </div>
          </div>
        </div>
      )}

      {/* ALLOCAZIONE */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 14, color: "#9a98a0" }}>Allocazione</div>
        {byType.map(({ tipo, pct }) => (
          <div key={tipo} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: ASSET_COLORS[tipo], display: "inline-block" }} />
                {tipo}
              </span>
              <span className="mono" style={{ color: "#9a98a0" }}>{fmt(pct, 1)}%</span>
            </div>
            <div className="bar-wrap"><div className="bar" style={{ width: `${pct}%`, background: ASSET_COLORS[tipo] }} /></div>
          </div>
        ))}
      </div>

      {/* POSIZIONI */}
      <div style={{ fontSize: 13, fontWeight: 500, color: "#9a98a0", marginBottom: 10 }}>Posizioni</div>
      {[...posizioni].sort((a, b) => b.valoreMercato - a.valoreMercato).map(p => (
        <div key={p.id} className="pos-card">
          <div className="pos-row" style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: ASSET_COLORS[p.tipo] + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: ASSET_COLORS[p.tipo] }}>{p.ticker.slice(0, 4)}</span>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{p.ticker}</div>
                <div style={{ fontSize: 11, color: "#5a5868" }}>{p.nome}</div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="mono" style={{ fontSize: 16, fontWeight: 600 }}>{fmtEur(p.valoreMercato)}</div>
              <div className={`mono ${p.plLatente >= 0 ? "pl-pos" : "pl-neg"}`} style={{ fontSize: 12 }}>{fmtPct(p.plPct)}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {[
              { label: "Qtà", val: fmt(p.quantita, 2) },
              { label: "PMC", val: fmtEur(p.pmc) },
              { label: "Prezzo", val: fmtEur(p.prezzoLive) },
            ].map(k => (
              <div key={k.label} style={{ background: "#0d0d14", borderRadius: 8, padding: "7px 10px" }}>
                <div style={{ fontSize: 10, color: "#5a5868", marginBottom: 2 }}>{k.label}</div>
                <div className="mono" style={{ fontSize: 12 }}>{k.val}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── PORTAFOGLIO ─── */
function Portafoglio({ posizioni, onAdd, onEdit, onDelete }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  return (
    <div>
      <div className="section-title">I miei titoli</div>
      <div className="section-sub">Gestisci posizioni e prezzi</div>

      <button className="btn-primary" style={{ width: "100%", marginBottom: 16 }} onClick={() => setShowAdd(true)}>
        + Aggiungi posizione
      </button>

      {posizioni.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "#4a4858" }}>
          <div style={{ fontSize: 13 }}>Nessuna posizione ancora</div>
        </div>
      ) : (
        posizioni.map(p => (
          <div key={p.id} className="pos-card">
            <div className="pos-row" style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: ASSET_COLORS[p.tipo] + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: ASSET_COLORS[p.tipo] }}>{p.ticker.slice(0, 4)}</span>
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>{p.ticker}</div>
                  <div style={{ fontSize: 11, color: "#5a5868" }}>{p.nome}</div>
                </div>
              </div>
              <span className="tag" style={{ background: ASSET_COLORS[p.tipo] + "22", color: ASSET_COLORS[p.tipo] }}>{p.tipo}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
              {[
                { label: "Qtà", val: fmt(p.quantita, 2) },
                { label: "PMC", val: fmtEur(p.pmc) },
                { label: "Prezzo", val: fmtEur(p.prezzoLive) },
              ].map(k => (
                <div key={k.label} style={{ background: "#0d0d14", borderRadius: 8, padding: "7px 10px" }}>
                  <div style={{ fontSize: 10, color: "#5a5868", marginBottom: 2 }}>{k.label}</div>
                  <div className="mono" style={{ fontSize: 12 }}>{k.val}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-ghost" style={{ flex: 1, padding: "9px", fontSize: 13 }} onClick={() => setEditTarget(p)}>Modifica</button>
              <button className="btn-danger" style={{ padding: "9px 16px", fontSize: 13 }} onClick={() => onDelete(p.id)}>✕</button>
            </div>
          </div>
        ))
      )}

      {showAdd && <PosizioneModal title="Nuova posizione" onSubmit={d => { onAdd(d); setShowAdd(false); }} onClose={() => setShowAdd(false)} />}
      {editTarget && <PosizioneModal title={`Modifica ${editTarget.ticker}`} initial={editTarget} onSubmit={d => { onEdit(editTarget.id, d); setEditTarget(null); }} onClose={() => setEditTarget(null)} />}
    </div>
  );
}

function PosizioneModal({ title, initial, onSubmit, onClose }) {
  const [ticker, setTicker] = useState(initial?.ticker || "");
  const [nome, setNome] = useState(initial?.nome || "");
  const [tipo, setTipo] = useState(initial?.tipo || "Azione");
  const [quantita, setQuantita] = useState(initial?.quantita?.toString() || "");
  const [pmc, setPmc] = useState(initial?.pmc?.toString() || "");
  const [prezzoManuale, setPrezzoManuale] = useState(initial?.prezzoManuale?.toString() || "");

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({
      ticker, nome, tipo,
      quantita: parseFloat(quantita),
      pmc: parseFloat(pmc),
      prezzoManuale: prezzoManuale ? parseFloat(prezzoManuale) : parseFloat(pmc)
    });
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{title}</div>
          <button className="btn-ghost" style={{ padding: "6px 12px" }} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="row2">
            <div className="form-group"><label>TICKER *</label><input placeholder="es. ENEL.MI" value={ticker} onChange={e => setTicker(e.target.value)} /></div>
            <div className="form-group"><label>NOME</label><input placeholder="es. Enel SpA" value={nome} onChange={e => setNome(e.target.value)} /></div>
          </div>
          <div className="form-group">
            <label>TIPO ASSET</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)}>
              {ASSET_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="row2">
            <div className="form-group"><label>QUANTITÀ *</label><input type="number" placeholder="0" value={quantita} onChange={e => setQuantita(e.target.value)} /></div>
            <div className="form-group"><label>PMC (€) *</label><input type="number" placeholder="0.00" value={pmc} onChange={e => setPmc(e.target.value)} /></div>
          </div>
          <div className="form-group">
            <label>PREZZO ATTUALE (€) — opzionale</label>
            <input type="number" placeholder="lascia vuoto = usa PMC" value={prezzoManuale} onChange={e => setPrezzoManuale(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary" style={{ width: "100%", marginTop: 4, padding: 14 }}>Salva</button>
        </form>
      </div>
    </div>
  );
}

/* ─── MOVIMENTI ─── */
function Movimenti({ movimenti, posizioni, onAdd }) {
  const [showForm, setShowForm] = useState(false);
  const [ticker, setTicker] = useState("");
  const [tipo, setTipo] = useState("acquisto");
  const [tipoAsset, setTipoAsset] = useState("Azione");
  const [quantita, setQuantita] = useState("");
  const [prezzo, setPrezzo] = useState("");
  const [note, setNote] = useState("");
  const [dataVal, setDataVal] = useState(new Date().toISOString().slice(0, 10));

  const TIPI = ["acquisto", "pac", "vendita", "dividendo"];
  const TIPO_COLORS = { acquisto: "#4ecb8d", pac: "#378ADD", vendita: "#e24b4a", dividendo: "#EF9F27" };
  const tickerSuggest = [...new Set(posizioni.map(p => p.ticker))];

  function handleSubmit(e) {
    e.preventDefault();
    if (!ticker || !quantita || !prezzo) return;
    onAdd({ ticker, tipo, tipoAsset, quantita: parseFloat(quantita), prezzo: parseFloat(prezzo), note, data: dataVal });
    setTicker(""); setQuantita(""); setPrezzo(""); setNote("");
    setDataVal(new Date().toISOString().slice(0, 10));
    setShowForm(false);
  }

  return (
    <div>
      <div className="section-title">Movimenti</div>
      <div className="section-sub">PAC, acquisti, vendite, dividendi</div>

      <button className="btn-primary" style={{ width: "100%", marginBottom: 16 }} onClick={() => setShowForm(s => !s)}>
        {showForm ? "Chiudi" : "+ Nuovo movimento"}
      </button>

      {showForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <form onSubmit={handleSubmit}>
            <div className="row2">
              <div className="form-group">
                <label>TIPO</label>
                <select value={tipo} onChange={e => setTipo(e.target.value)}>{TIPI.map(t => <option key={t}>{t}</option>)}</select>
              </div>
              <div className="form-group">
                <label>TICKER</label>
                <input list="tl" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="es. ENEL.MI" />
                <datalist id="tl">{tickerSuggest.map(t => <option key={t} value={t} />)}</datalist>
              </div>
            </div>
            {(tipo === "acquisto" || tipo === "pac") && (
              <div className="form-group">
                <label>TIPO ASSET</label>
                <select value={tipoAsset} onChange={e => setTipoAsset(e.target.value)}>{ASSET_TYPES.map(t => <option key={t}>{t}</option>)}</select>
              </div>
            )}
            <div className="row2">
              <div className="form-group">
                <label>{tipo === "dividendo" ? "IMPORTO (€)" : "QUANTITÀ"}</label>
                <input type="number" step="any" value={quantita} onChange={e => setQuantita(e.target.value)} placeholder="0" />
              </div>
              {tipo !== "dividendo" && (
                <div className="form-group">
                  <label>PREZZO (€)</label>
                  <input type="number" step="any" value={prezzo} onChange={e => setPrezzo(e.target.value)} placeholder="0.00" />
                </div>
              )}
            </div>
            <div className="form-group"><label>DATA</label><input type="date" value={dataVal} onChange={e => setDataVal(e.target.value)} /></div>
            <div className="form-group"><label>NOTE</label><input value={note} onChange={e => setNote(e.target.value)} placeholder="es. PAC mensile" /></div>
            <button type="submit" className="btn-primary" style={{ width: "100%", padding: 14 }}>Registra</button>
          </form>
        </div>
      )}

      {movimenti.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "#4a4858" }}>
          <div style={{ fontSize: 13 }}>Nessun movimento ancora</div>
        </div>
      ) : (
        movimenti.map(m => (
          <div key={m.id} className="mov-item">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <span className="tag" style={{ background: (TIPO_COLORS[m.tipo] || "#888") + "22", color: TIPO_COLORS[m.tipo] || "#888" }}>{m.tipo}</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{m.ticker}</span>
              </div>
              <div style={{ fontSize: 12, color: "#5a5868" }}>{m.data}{m.note ? ` · ${m.note}` : ""}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="mono" style={{ fontSize: 14, fontWeight: 500 }}>
                {m.tipo === "dividendo" ? fmtEur(m.quantita) : fmtEur(m.quantita * m.prezzo)}
              </div>
              <div style={{ fontSize: 11, color: "#5a5868" }}>
                {m.tipo !== "dividendo" ? `${fmt(m.quantita, 2)} @ ${fmtEur(m.prezzo)}` : "dividendo"}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ─── CERCA TITOLO ─── */
function CercaTitolo() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function search() {
    if (!query.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const ticker = query.trim().toUpperCase();
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1mo`;
      const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
      const json = await res.json();
      const data = JSON.parse(json.contents);
      const q = data?.chart?.result?.[0];
      if (!q) throw new Error();
      setResult({ meta: q.meta, closes: q.indicators?.quote?.[0]?.close || [], ticker });
    } catch { setError("Titolo non trovato. Prova es. ENEL.MI · AAPL · BTC-USD"); }
    setLoading(false);
  }

  return (
    <div>
      <div className="section-title">Cerca titolo</div>
      <div className="section-sub">Prezzi live da Yahoo Finance</div>

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Es. ENEL.MI · AAPL · BTC-USD" />
        <button className="btn-primary" onClick={search} disabled={loading} style={{ whiteSpace: "nowrap", padding: "12px 18px" }}>
          {loading ? <span className="spin">↻</span> : "Cerca"}
        </button>
      </div>

      {error && <div style={{ background: "#1f0808", border: "1px solid #3a1010", borderRadius: 12, padding: "14px", color: "#e24b4a", fontSize: 13 }}>{error}</div>}
      {result && <TitoloCard result={result} />}
    </div>
  );
}

function TitoloCard({ result }) {
  const { meta, closes, ticker } = result;
  const validCloses = closes.filter(c => c != null);
  const last = validCloses[validCloses.length - 1];
  const first = validCloses[0];
  const change = first > 0 ? ((last - first) / first) * 100 : 0;
  const currency = meta.currency || "USD";
  const W = 340, H = 100, pad = 8;
  const min = Math.min(...validCloses);
  const max = Math.max(...validCloses);
  const range = max - min || 1;
  const pts = validCloses.map((c, i) => {
    const x = pad + (i / (validCloses.length - 1)) * (W - pad * 2);
    const y = pad + ((max - c) / range) * (H - pad * 2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card">
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{ticker}</div>
          <div style={{ fontSize: 12, color: "#5a5868", marginTop: 2 }}>{meta.longName || meta.shortName || "—"}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700 }}>{fmt(last, 2)}<span style={{ fontSize: 14, color: "#5a5868", marginLeft: 4 }}>{currency}</span></div>
          <div className={`mono ${change >= 0 ? "pl-pos" : "pl-neg"}`} style={{ fontSize: 15 }}>{fmtPct(change)}</div>
        </div>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
          <polyline points={pts} fill="none" stroke={change >= 0 ? "#4ecb8d" : "#e24b4a"} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <div style={{ fontSize: 11, color: "#4a4858", textAlign: "right", marginTop: 4 }}>1 mese</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: "Prezzo attuale", val: `${fmt(meta.regularMarketPrice, 2)} ${currency}` },
          { label: "Chiusura prec.", val: `${fmt(meta.chartPreviousClose, 2)} ${currency}` },
          { label: "52w High", val: `${fmt(meta["fiftyTwoWeekHigh"], 2)} ${currency}` },
          { label: "52w Low", val: `${fmt(meta["fiftyTwoWeekLow"], 2)} ${currency}` },
        ].map(k => (
          <div key={k.label} className="card" style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: "#5a5868", marginBottom: 4 }}>{k.label.toUpperCase()}</div>
            <div className="mono" style={{ fontSize: 13 }}>{k.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
