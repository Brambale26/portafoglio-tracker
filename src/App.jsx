import { useState, useEffect, useMemo } from "react";

const ASSET_TYPES = ["Azione", "ETF", "Fondo", "Crypto"];

const ASSET_COLORS = {
  Azione: "#378ADD",
  ETF: "#1D9E75",
  Fondo: "#7F77DD",
  Crypto: "#EF9F27",
};

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "⬡" },
  { id: "portafoglio", label: "Portafoglio", icon: "◈" },
  { id: "movimenti", label: "Movimenti", icon: "↕" },
  { id: "cerca", label: "Cerca titolo", icon: "◎" },
];

const STORAGE_KEY = "portafoglio_v1";

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { posizioni: [], movimenti: [] };
    return JSON.parse(raw);
  } catch {
    return { posizioni: [], movimenti: [] };
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function fmtEur(n) {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return "—";
  const s = n >= 0 ? "+" : "";
  return s + fmt(n, 2) + "%";
}

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [data, setData] = useState(loadData);
  const [prices] = useState({});
  const [toast, setToast] = useState(null);

  useEffect(() => {
    saveData(data);
  }, [data]);

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  }

  function aggiornaPosizioneConMovimento(pos, mov) {
    if (mov.tipo === "acquisto" || mov.tipo === "pac") {
      const nuovaQta = pos.quantita + mov.quantita;
      const nuovoPMC = (pos.quantita * pos.pmc + mov.quantita * mov.prezzo) / nuovaQta;
      return { ...pos, quantita: nuovaQta, pmc: nuovoPMC };
    }
    if (mov.tipo === "vendita") {
      const nuovaQta = Math.max(0, pos.quantita - mov.quantita);
      return { ...pos, quantita: nuovaQta };
    }
    return pos;
  }

  function addPosizione(p) {
    setData((d) => {
      const existing = d.posizioni.find(
        (x) => x.ticker.toUpperCase() === p.ticker.toUpperCase()
      );
      if (existing) {
        showToast("Ticker già presente — usa Movimenti per aggiornarlo", "warn");
        return d;
      }
      const nuova = { ...p, id: Date.now(), ticker: p.ticker.toUpperCase() };
      showToast(`${nuova.ticker} aggiunto al portafoglio`);
      return { ...d, posizioni: [...d.posizioni, nuova] };
    });
  }

  function editPosizione(id, updates) {
    setData((d) => ({
      ...d,
      posizioni: d.posizioni.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
    showToast("Posizione aggiornata");
  }

  function deletePosizione(id) {
    setData((d) => ({
      ...d,
      posizioni: d.posizioni.filter((p) => p.id !== id),
    }));
    showToast("Posizione rimossa");
  }

  function addMovimento(mov) {
    setData((d) => {
      const pos = d.posizioni.find((p) => p.ticker === mov.ticker.toUpperCase());
      if (!pos && mov.tipo === "vendita") {
        showToast("Ticker non trovato nel portafoglio", "warn");
        return d;
      }
      let nuovePosizioni = d.posizioni;
      if (pos) {
        nuovePosizioni = d.posizioni.map((p) =>
          p.ticker === mov.ticker.toUpperCase()
            ? aggiornaPosizioneConMovimento(p, mov)
            : p
        );
      } else {
        const nuova = {
          id: Date.now(),
          ticker: mov.ticker.toUpperCase(),
          nome: mov.ticker.toUpperCase(),
          tipo: mov.tipoAsset || "Azione",
          quantita: mov.quantita,
          pmc: mov.prezzo,
          prezzoManuale: mov.prezzo,
        };
        nuovePosizioni = [...d.posizioni, nuova];
      }
      const newMov = {
        ...mov,
        id: Date.now(),
        ticker: mov.ticker.toUpperCase(),
        data: mov.data || new Date().toISOString().slice(0, 10),
      };
      showToast(`Movimento ${mov.tipo} registrato`);
      return { posizioni: nuovePosizioni, movimenti: [newMov, ...d.movimenti] };
    });
  }

  const posizioni = useMemo(() => {
    return data.posizioni.map((p) => {
      const prezzoLive = prices[p.ticker] ?? p.prezzoManuale ?? p.pmc;
      const valoreMercato = prezzoLive * p.quantita;
      const costoCarico = p.pmc * p.quantita;
      const plLatente = valoreMercato - costoCarico;
      const plPct = costoCarico > 0 ? (plLatente / costoCarico) * 100 : 0;
      return { ...p, prezzoLive, valoreMercato, costoCarico, plLatente, plPct };
    });
  }, [data.posizioni, prices]);

  const totali = useMemo(() => {
    const totValore = posizioni.reduce((s, p) => s + (p.valoreMercato || 0), 0);
    const totCosto = posizioni.reduce((s, p) => s + (p.costoCarico || 0), 0);
    const totPL = totValore - totCosto;
    const totPLpct = totCosto > 0 ? (totPL / totCosto) * 100 : 0;
    return { totValore, totCosto, totPL, totPLpct };
  }, [posizioni]);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e8e6df", fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #2a2a35; border-radius: 2px; }
        input, select, textarea { background: #13131a; border: 1px solid #2a2a38; border-radius: 8px; color: #e8e6df; padding: 10px 14px; font-family: inherit; font-size: 14px; width: 100%; outline: none; transition: border-color .18s; }
        input:focus, select:focus { border-color: #4a7fd4; }
        select option { background: #13131a; }
        button { cursor: pointer; font-family: inherit; font-size: 14px; border: none; border-radius: 8px; padding: 10px 20px; transition: all .15s; }
        .btn-primary { background: #4a7fd4; color: #fff; font-weight: 500; }
        .btn-primary:hover { background: #5a8fe4; }
        .btn-ghost { background: transparent; color: #9a98a0; border: 1px solid #2a2a38; }
        .btn-ghost:hover { background: #1a1a25; color: #e8e6df; }
        .btn-danger { background: transparent; color: #e24b4a; border: 1px solid #3a2020; }
        .btn-danger:hover { background: #2a1515; }
        .card { background: #13131a; border: 1px solid #1e1e2a; border-radius: 14px; padding: 20px; }
        .tag { display: inline-block; font-size: 11px; font-weight: 500; padding: 3px 9px; border-radius: 20px; }
        .pl-pos { color: #4ecb8d; }
        .pl-neg { color: #e24b4a; }
        label { font-size: 12px; color: #7a7888; margin-bottom: 5px; display: block; letter-spacing: .04em; }
        .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.7); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
        .modal { background: #13131a; border: 1px solid #2a2a38; border-radius: 18px; padding: 28px; width: 100%; max-width: 420px; }
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        th { color: #7a7888; font-size: 11px; font-weight: 500; letter-spacing: .06em; padding: 8px 12px; text-align: left; border-bottom: 1px solid #1e1e2a; }
        td { padding: 12px; border-bottom: 1px solid #131320; vertical-align: middle; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: #16161f; }
        .mono { font-family: 'DM Mono', monospace; }
      `}</style>

      <div style={{ display: "flex", minHeight: "100vh" }}>
        <nav style={{ width: 220, background: "#0d0d14", borderRight: "1px solid #1a1a25", padding: "28px 16px", display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
          <div style={{ marginBottom: 32, paddingLeft: 8 }}>
            <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-.02em" }}>portafoglio</div>
            <div style={{ fontSize: 11, color: "#4a4858", marginTop: 2, letterSpacing: ".06em" }}>TRACKER PERSONALE</div>
          </div>
          {NAV_ITEMS.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              style={{
                background: page === n.id ? "#1a1a28" : "transparent",
                color: page === n.id ? "#e8e6df" : "#6a6878",
                border: "none", borderRadius: 10, padding: "11px 14px",
                textAlign: "left", display: "flex", alignItems: "center", gap: 10,
                fontWeight: page === n.id ? 500 : 400, fontSize: 14, transition: "all .15s",
              }}
            >
              <span style={{ fontSize: 16, opacity: .8 }}>{n.icon}</span>
              {n.label}
            </button>
          ))}
          <div style={{ marginTop: "auto", paddingLeft: 8 }}>
            <div style={{ fontSize: 11, color: "#3a3848" }}>{data.posizioni.length} posizioni</div>
          </div>
        </nav>

        <main style={{ flex: 1, padding: "32px 36px", overflowY: "auto", maxWidth: "calc(100vw - 220px)" }}>
          {page === "dashboard" && <Dashboard posizioni={posizioni} totali={totali} data={data} />}
          {page === "portafoglio" && <Portafoglio posizioni={posizioni} onAdd={addPosizione} onEdit={editPosizione} onDelete={deletePosizione} />}
          {page === "movimenti" && <Movimenti movimenti={data.movimenti} posizioni={data.posizioni} onAdd={addMovimento} />}
          {page === "cerca" && <CercaTitolo />}
        </main>
      </div>

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24,
          background: toast.type === "warn" ? "#2a1f0a" : "#0f2a1a",
          border: `1px solid ${toast.type === "warn" ? "#4a3010" : "#1a4a2a"}`,
          color: toast.type === "warn" ? "#EF9F27" : "#4ecb8d",
          padding: "12px 20px", borderRadius: 12, fontSize: 14, zIndex: 200,
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/* ─── DASHBOARD ─── */
function Dashboard({ posizioni, totali, data }) {
  const byType = useMemo(() => {
    const map = {};
    posizioni.forEach((p) => { map[p.tipo] = (map[p.tipo] || 0) + p.valoreMercato; });
    return Object.entries(map).map(([tipo, val]) => ({
      tipo, val, pct: totali.totValore > 0 ? (val / totali.totValore) * 100 : 0,
    }));
  }, [posizioni, totali]);

  const topPos = [...posizioni].sort((a, b) => b.valoreMercato - a.valoreMercato).slice(0, 5);
  const rischioConc = posizioni.filter(p => totali.totValore > 0 && (p.valoreMercato / totali.totValore) * 100 > 25);

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 600, marginBottom: 6, letterSpacing: "-.02em" }}>Dashboard</h1>
      <p style={{ color: "#5a5868", fontSize: 14, marginBottom: 28 }}>
        {new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      </p>

      {posizioni.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 60, color: "#4a4858" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>◈</div>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Portafoglio vuoto</div>
          <div style={{ fontSize: 13 }}>Vai in "Portafoglio" per aggiungere le tue posizioni</div>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 24 }}>
            {[
              { label: "Valore totale", val: fmtEur(totali.totValore) },
              { label: "Costo di carico", val: fmtEur(totali.totCosto) },
              { label: "P&L latente", val: fmtEur(totali.totPL), sub: fmtPct(totali.totPLpct), positive: totali.totPL >= 0 },
              { label: "Posizioni aperte", val: posizioni.length, sub: `${byType.length} classi` },
            ].map((k) => (
              <div key={k.label} className="card">
                <div style={{ fontSize: 11, color: "#5a5868", letterSpacing: ".06em", marginBottom: 8 }}>{k.label.toUpperCase()}</div>
                <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "'DM Mono', monospace", color: k.positive === false ? "#e24b4a" : k.positive ? "#4ecb8d" : "#e8e6df" }}>{k.val}</div>
                {k.sub && <div style={{ fontSize: 12, color: totali.totPL >= 0 ? "#4ecb8d" : "#e24b4a", marginTop: 4 }}>{k.sub}</div>}
              </div>
            ))}
          </div>

          {rischioConc.length > 0 && (
            <div style={{ background: "#1f1808", border: "1px solid #3a2e08", borderRadius: 12, padding: "14px 18px", marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 18 }}>⚠</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#EF9F27" }}>Concentrazione elevata</div>
                <div style={{ fontSize: 12, color: "#8a7a40", marginTop: 2 }}>
                  {rischioConc.map(p => `${p.ticker} (${fmt((p.valoreMercato / totali.totValore) * 100, 1)}%)`).join(", ")} supera il 25% del portafoglio
                </div>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <div className="card">
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 16, color: "#9a98a0" }}>Allocazione per classe</div>
              {byType.map(({ tipo, val, pct }) => (
                <div key={tipo} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: ASSET_COLORS[tipo], display: "inline-block" }} />
                      {tipo}
                    </span>
                    <span className="mono" style={{ color: "#9a98a0" }}>{fmt(pct, 1)}%</span>
                  </div>
                  <div style={{ background: "#1a1a25", borderRadius: 4, height: 4, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: ASSET_COLORS[tipo], borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 16, color: "#9a98a0" }}>Posizioni principali</div>
              {topPos.map((p, i) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, color: "#4a4858", width: 16 }}>{i + 1}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{p.ticker}</div>
                      <div style={{ fontSize: 11, color: "#5a5868" }}>{p.nome}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" style={{ fontSize: 13 }}>{fmtEur(p.valoreMercato)}</div>
                    <div style={{ fontSize: 11, color: "#5a6888" }}>{fmt(totali.totValore > 0 ? (p.valoreMercato / totali.totValore) * 100 : 0, 1)}%</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 16, color: "#9a98a0" }}>Performance posizioni</div>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr><th>Ticker</th><th>Tipo</th><th>Qtà</th><th>PMC</th><th>Prezzo att.</th><th>Valore</th><th>P&L</th><th>P&L %</th></tr>
                </thead>
                <tbody>
                  {[...posizioni].sort((a, b) => b.valoreMercato - a.valoreMercato).map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.ticker}</td>
                      <td><span className="tag" style={{ background: ASSET_COLORS[p.tipo] + "22", color: ASSET_COLORS[p.tipo] }}>{p.tipo}</span></td>
                      <td className="mono">{fmt(p.quantita, 4)}</td>
                      <td className="mono">{fmtEur(p.pmc)}</td>
                      <td className="mono">{fmtEur(p.prezzoLive)}</td>
                      <td className="mono">{fmtEur(p.valoreMercato)}</td>
                      <td className={`mono ${p.plLatente >= 0 ? "pl-pos" : "pl-neg"}`}>{fmtEur(p.plLatente)}</td>
                      <td className={`mono ${p.plPct >= 0 ? "pl-pos" : "pl-neg"}`}>{fmtPct(p.plPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── PORTAFOGLIO ─── */
function Portafoglio({ posizioni, onAdd, onEdit, onDelete }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  function handleAdd(formData) {
    if (!formData.ticker || !formData.quantita || !formData.pmc) return;
    onAdd({
      ...formData,
      quantita: parseFloat(formData.quantita),
      pmc: parseFloat(formData.pmc),
      prezzoManuale: formData.prezzoManuale ? parseFloat(formData.prezzoManuale) : parseFloat(formData.pmc),
    });
    setShowAdd(false);
  }

  function handleEdit(formData) {
    onEdit(editTarget.id, {
      ...formData,
      quantita: parseFloat(formData.quantita),
      pmc: parseFloat(formData.pmc),
      prezzoManuale: formData.prezzoManuale ? parseFloat(formData.prezzoManuale) : parseFloat(formData.pmc),
    });
    setEditTarget(null);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em" }}>Portafoglio</h1>
          <p style={{ color: "#5a5868", fontSize: 14, marginTop: 4 }}>Gestisci le tue posizioni — aggiorna PMC e prezzo corrente manualmente</p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Aggiungi posizione</button>
      </div>

      {posizioni.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 60, color: "#4a4858" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>◈</div>
          <div style={{ fontSize: 15 }}>Nessuna posizione ancora</div>
          <div style={{ fontSize: 13, marginTop: 8 }}>Aggiungi il tuo primo titolo con il pulsante in alto a destra</div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {posizioni.map((p) => (
            <div key={p.id} className="card" style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: ASSET_COLORS[p.tipo] + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: ASSET_COLORS[p.tipo] }}>{p.ticker.slice(0, 4)}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{p.ticker}</span>
                  <span className="tag" style={{ background: ASSET_COLORS[p.tipo] + "22", color: ASSET_COLORS[p.tipo] }}>{p.tipo}</span>
                </div>
                <div style={{ fontSize: 12, color: "#5a5868", marginTop: 2 }}>{p.nome || "—"}</div>
              </div>
              <div style={{ textAlign: "right", minWidth: 80 }}>
                <div style={{ fontSize: 11, color: "#5a5868" }}>Qtà</div>
                <div className="mono" style={{ fontSize: 14 }}>{fmt(p.quantita, 4)}</div>
              </div>
              <div style={{ textAlign: "right", minWidth: 90 }}>
                <div style={{ fontSize: 11, color: "#5a5868" }}>PMC</div>
                <div className="mono" style={{ fontSize: 14 }}>{fmtEur(p.pmc)}</div>
              </div>
              <div style={{ textAlign: "right", minWidth: 100 }}>
                <div style={{ fontSize: 11, color: "#5a5868" }}>Prezzo att.</div>
                <div className="mono" style={{ fontSize: 14 }}>{fmtEur(p.prezzoLive)}</div>
              </div>
              <div style={{ textAlign: "right", minWidth: 110 }}>
                <div style={{ fontSize: 11, color: "#5a5868" }}>Valore</div>
                <div className="mono" style={{ fontSize: 14 }}>{fmtEur(p.valoreMercato)}</div>
              </div>
              <div style={{ textAlign: "right", minWidth: 90 }}>
                <div style={{ fontSize: 11, color: "#5a5868" }}>P&L</div>
                <div className={`mono ${p.plLatente >= 0 ? "pl-pos" : "pl-neg"}`} style={{ fontSize: 14 }}>{fmtPct(p.plPct)}</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button className="btn-ghost" style={{ padding: "7px 12px", fontSize: 13 }} onClick={() => setEditTarget(p)}>Modifica</button>
                <button className="btn-danger" style={{ padding: "7px 12px", fontSize: 13 }} onClick={() => onDelete(p.id)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <PosizioneModal title="Nuova posizione" onSubmit={handleAdd} onClose={() => setShowAdd(false)} />}
      {editTarget && <PosizioneModal title={`Modifica ${editTarget.ticker}`} initial={editTarget} onSubmit={handleEdit} onClose={() => setEditTarget(null)} />}
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
    onSubmit({ ticker, nome, tipo, quantita, pmc, prezzoManuale });
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
          <button className="btn-ghost" style={{ padding: "4px 10px" }} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
            <div style={{ marginBottom: 14 }}>
              <label>TICKER *</label>
              <input placeholder="es. ENEL.MI" value={ticker} onChange={e => setTicker(e.target.value)} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label>NOME</label>
              <input placeholder="es. Enel SpA" value={nome} onChange={e => setNome(e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label>TIPO ASSET</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)}>
              {ASSET_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
            <div style={{ marginBottom: 14 }}>
              <label>QUANTITÀ *</label>
              <input type="number" placeholder="0" value={quantita} onChange={e => setQuantita(e.target.value)} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label>PMC (€) *</label>
              <input type="number" placeholder="0.00" value={pmc} onChange={e => setPmc(e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label>PREZZO ATTUALE (€) — lascia vuoto = usa PMC</label>
            <input type="number" placeholder="0.00" value={prezzoManuale} onChange={e => setPrezzoManuale(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button type="submit" className="btn-primary" style={{ flex: 1 }}>Salva</button>
            <button type="button" className="btn-ghost" onClick={onClose}>Annulla</button>
          </div>
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
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));

  const TIPI = ["acquisto", "pac", "vendita", "dividendo"];
  const TIPO_COLORS = { acquisto: "#4ecb8d", pac: "#378ADD", vendita: "#e24b4a", dividendo: "#EF9F27" };
  const tickerSuggest = [...new Set(posizioni.map(p => p.ticker))];

  function handleSubmit(e) {
    e.preventDefault();
    if (!ticker || !quantita || !prezzo) return;
    onAdd({ ticker, tipo, tipoAsset, quantita: parseFloat(quantita), prezzo: parseFloat(prezzo), note, data });
    setTicker(""); setTipo("acquisto"); setQuantita(""); setPrezzo(""); setNote("");
    setData(new Date().toISOString().slice(0, 10));
    setShowForm(false);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em" }}>Movimenti</h1>
          <p style={{ color: "#5a5868", fontSize: 14, marginTop: 4 }}>Registra acquisti, PAC, vendite e dividendi — il PMC si aggiorna in automatico</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(s => !s)}>{showForm ? "Chiudi" : "+ Nuovo movimento"}</button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 18, color: "#9a98a0" }}>Registra movimento</div>
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
              <div>
                <label>TIPO</label>
                <select value={tipo} onChange={e => setTipo(e.target.value)}>
                  {TIPI.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label>TICKER</label>
                <input list="ticker-list" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="es. ENEL.MI" />
                <datalist id="ticker-list">{tickerSuggest.map(t => <option key={t} value={t} />)}</datalist>
              </div>
              {(tipo === "acquisto" || tipo === "pac") && (
                <div>
                  <label>TIPO ASSET</label>
                  <select value={tipoAsset} onChange={e => setTipoAsset(e.target.value)}>
                    {ASSET_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label>{tipo === "dividendo" ? "IMPORTO (€)" : "QUANTITÀ"}</label>
                <input type="number" step="any" value={quantita} onChange={e => setQuantita(e.target.value)} placeholder="0" />
              </div>
              {tipo !== "dividendo" && (
                <div>
                  <label>PREZZO (€)</label>
                  <input type="number" step="any" value={prezzo} onChange={e => setPrezzo(e.target.value)} placeholder="0.00" />
                </div>
              )}
              <div>
                <label>DATA</label>
                <input type="date" value={data} onChange={e => setData(e.target.value)} />
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <label>NOTE (opzionale)</label>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="es. PAC mensile" />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button type="submit" className="btn-primary">Registra</button>
              <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Annulla</button>
            </div>
          </form>
        </div>
      )}

      {movimenti.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 60, color: "#4a4858" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>↕</div>
          <div style={{ fontSize: 15 }}>Nessun movimento registrato</div>
          <div style={{ fontSize: 13, marginTop: 8 }}>I movimenti futuri (PAC, acquisti, vendite) saranno tracciati qui</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr><th>Data</th><th>Tipo</th><th>Ticker</th><th>Quantità</th><th>Prezzo</th><th>Controvalore</th><th>Note</th></tr>
            </thead>
            <tbody>
              {movimenti.map((m) => (
                <tr key={m.id}>
                  <td style={{ color: "#5a5868", fontSize: 13 }}>{m.data}</td>
                  <td><span className="tag" style={{ background: (TIPO_COLORS[m.tipo] || "#888") + "22", color: TIPO_COLORS[m.tipo] || "#888" }}>{m.tipo}</span></td>
                  <td style={{ fontWeight: 500 }}>{m.ticker}</td>
                  <td className="mono">{fmt(m.quantita, 4)}</td>
                  <td className="mono">{m.tipo === "dividendo" ? "—" : fmtEur(m.prezzo)}</td>
                  <td className="mono">{m.tipo === "dividendo" ? fmtEur(m.quantita) : fmtEur(m.quantita * m.prezzo)}</td>
                  <td style={{ color: "#5a5868", fontSize: 13 }}>{m.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const ticker = query.trim().toUpperCase();
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1mo`;
      const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
      const json = await res.json();
      const data = JSON.parse(json.contents);
      const q = data?.chart?.result?.[0];
      if (!q) throw new Error("Titolo non trovato");
      const meta = q.meta;
      const closes = q.indicators?.quote?.[0]?.close || [];
      setResult({ meta, closes, ticker });
    } catch {
      setError("Titolo non trovato o errore di rete. Prova con il ticker Yahoo (es. ENEL.MI, AAPL, BTC-USD)");
    }
    setLoading(false);
  }

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 600, marginBottom: 6, letterSpacing: "-.02em" }}>Cerca titolo</h1>
      <p style={{ color: "#5a5868", fontSize: 14, marginBottom: 28 }}>Inserisci il ticker Yahoo Finance — es. ENEL.MI · AAPL · BTC-USD · VWCE.AS</p>

      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Ticker (es. ENI.MI, AAPL, BTC-USD)" style={{ maxWidth: 320 }} />
        <button className="btn-primary" onClick={search} disabled={loading}>{loading ? "Carico..." : "Cerca"}</button>
      </div>

      {error && <div style={{ background: "#1f0808", border: "1px solid #3a1010", borderRadius: 12, padding: "14px 18px", color: "#e24b4a", fontSize: 13 }}>{error}</div>}
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

  const W = 560, H = 120, pad = 10;
  const min = Math.min(...validCloses);
  const max = Math.max(...validCloses);
  const range = max - min || 1;
  const pts = validCloses.map((c, i) => {
    const x = pad + (i / (validCloses.length - 1)) * (W - pad * 2);
    const y = pad + ((max - c) / range) * (H - pad * 2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{ticker}</div>
            <div style={{ fontSize: 13, color: "#5a5868", marginTop: 2 }}>{meta.longName || meta.shortName || "—"} · {meta.exchangeName}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mono" style={{ fontSize: 26, fontWeight: 600 }}>{fmt(last, 2)} {currency}</div>
            <div className={`mono ${change >= 0 ? "pl-pos" : "pl-neg"}`} style={{ fontSize: 14, marginTop: 4 }}>{fmtPct(change)} (1 mese)</div>
          </div>
        </div>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
          <polyline points={pts} fill="none" stroke={change >= 0 ? "#4ecb8d" : "#e24b4a"} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        {[
          { label: "Prezzo attuale", val: `${fmt(meta.regularMarketPrice, 2)} ${currency}` },
          { label: "Chiusura prec.", val: `${fmt(meta.chartPreviousClose, 2)} ${currency}` },
          { label: "52w High", val: `${fmt(meta["fiftyTwoWeekHigh"], 2)} ${currency}` },
          { label: "52w Low", val: `${fmt(meta["fiftyTwoWeekLow"], 2)} ${currency}` },
          { label: "Valuta", val: currency },
          { label: "Mercato", val: meta.exchangeName || "—" },
        ].map(k => (
          <div key={k.label} className="card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: "#5a5868", marginBottom: 6, letterSpacing: ".04em" }}>{k.label.toUpperCase()}</div>
            <div className="mono" style={{ fontSize: 14 }}>{k.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
