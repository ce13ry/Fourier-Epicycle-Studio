import { useState, useRef, useEffect, useCallback } from "react";

// ─── FFT ────────────────────────────────────────────────────────────────────
function fft(re, im) {
    const n = re.length;
    if (n <= 1) return;
    const reEven = [], imEven = [], reOdd = [], imOdd = [];
    for (let i = 0; i < n; i += 2) { reEven.push(re[i]); imEven.push(im[i]); }
    for (let i = 1; i < n; i += 2) { reOdd.push(re[i]); imOdd.push(im[i]); }
    fft(reEven, imEven); fft(reOdd, imOdd);
    for (let k = 0; k < n / 2; k++) {
        const angle = -2 * Math.PI * k / n;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const tRe = cos * reOdd[k] - sin * imOdd[k];
        const tIm = cos * imOdd[k] + sin * reOdd[k];
        re[k] = reEven[k] + tRe; im[k] = imEven[k] + tIm;
        re[k + n / 2] = reEven[k] - tRe; im[k + n / 2] = imEven[k] - tIm;
    }
}

function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

function computeEpicycles(points) {
    const n = nextPow2(points.length);
    const re = new Array(n).fill(0);
    const im = new Array(n).fill(0);

    for (let i = 0; i < points.length; i++) {
        re[i] = points[i].x;
        im[i] = -points[i].y;
    }

    fft(re, im);
    const cycles = [];
    for (let k = 0; k < n; k++) {
        const freq = k <= n / 2 ? k : k - n;
        const amp = Math.sqrt(re[k] ** 2 + im[k] ** 2) / n;
        const phase = Math.atan2(im[k], re[k]);
        cycles.push({ freq, amp, phase });
    }
    return cycles.sort((a, b) => b.amp - a.amp);
}

// ─── Parametric string ───────────────────────────────────────────────────────
function toParametric(cycles, count) {
    const top = cycles.slice(0, count).filter(c => c.amp > 0.001);

    const fmtNum = (v) => {
        // Keep it simple for Desmos: fixed precision, avoid "-0"
        const n = Number(v.toFixed(4));
        return Object.is(n, -0) ? "0" : String(n);
    };

    const fmtAngle = (freq, phase) => {
        let base = "";
        if (freq === 0) base = "";
        else if (freq === 1) base = "t";
        else if (freq === -1) base = "-t";
        else base = `${freq}t`;

        const ph = Number(phase.toFixed(4));
        const phStr = ph === 0 ? "" : (ph > 0 ? `+${fmtNum(ph)}` : `-${fmtNum(Math.abs(ph))}`);

        if (!base) return phStr ? phStr.replace(/^\+/, "") : "0";
        return phStr ? `${base}${phStr}` : base;
    };

    const xTerms = top.map(c => {
        const a = fmtNum(c.amp);
        if (c.freq === 0) return a; // DC term
        return `${a}*cos(${fmtAngle(c.freq, c.phase)})`;
    });

    const yTerms = top.map(c => {
        const a = fmtNum(c.amp);
        if (c.freq === 0) return "0"; // DC doesn't contribute to sine in this representation
        return `${a}*sin(${fmtAngle(c.freq, c.phase)})`;
    });

    return {
        x: "x(t) = " + (xTerms.join(" + ") || "0"),
        y: "y(t) = " + (yTerms.join(" + ") || "0"),
    };
}

function CopyLine({ label, value }) {
    const [copied, setCopied] = useState(false);

    const onCopy = async () => {
        try {
            await navigator.clipboard.writeText(value);
        } catch {
            const el = document.getElementById(`copyline-${label}`);
            if (el) {
                el.focus();
                el.select();
            }
        }

        setCopied(true);

        // revert back after 1.5 seconds
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#ffffff", minWidth: 70, opacity: 0.9 }}>
                {label}
            </div>
            <input
                id={`copyline-${label}`}
                readOnly
                value={value}
                onFocus={(e) => e.target.select()}
                style={{
                    flex: 1,
                    fontFamily: "'Courier New', monospace",
                    fontSize: 12,
                    padding: "10px 12px",
                    borderRadius: 6,
                    border: "1px solid rgba(100,200,255,0.2)",
                    background: "rgba(0,0,0,0.25)",
                    color: "#ffffff",
                    outline: "none",
                }}
            />
            <button onClick={onCopy} style={btnStyle(false)}>
                {copied ? "✓" : "COPY"}
            </button>
        </div>
    );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function App() {
    const drawCanvas = useRef(null);
    const animCanvas = useRef(null);
    const [mode, setMode] = useState("draw"); // draw | animate
    const [drawing, setDrawing] = useState(false);
    const [rawPoints, setRawPoints] = useState([]);
    const [numCircles, setNumCircles] = useState(30);
    const [parametric, setParametric] = useState(null);
    const animRef = useRef(null);
    const epicyclesRef = useRef([]);
    const trailRef = useRef([]);
    const tRef = useRef(0);

    // ─── Draw mode ──────────────────────────────────────────────────────────
    const getPos = (e, canvas) => {
        const r = canvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return { x: src.clientX - r.left, y: src.clientY - r.top };
    };

    const startDraw = useCallback((e) => {
        const canvas = drawCanvas.current;
        const pos = getPos(e, canvas);
        setDrawing(true);
        setRawPoints([pos]);
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
    }, []);

    const continueDraw = useCallback((e) => {
        if (!drawing) return;
        e.preventDefault();
        const canvas = drawCanvas.current;
        const pos = getPos(e, canvas);
        setRawPoints(p => [...p, pos]);
        const ctx = canvas.getContext("2d");
        ctx.lineTo(pos.x, pos.y);
        ctx.strokeStyle = "#e8f4f8";
        ctx.lineWidth = 2.5;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
    }, [drawing]);

    const endDraw = useCallback(() => setDrawing(false), []);

    // ─── Animate ─────────────────────────────────────────────────────────────
    const startAnimation = useCallback(() => {
        if (rawPoints.length < 8) return;
        // Resample to power of 2
        const n = Math.min(nextPow2(rawPoints.length), 512);
        const step = rawPoints.length / n;
        const pts = Array.from({ length: n }, (_, i) => {
            const idx = Math.min(Math.floor(i * step), rawPoints.length - 1);
            return rawPoints[idx];
        });
        // Center
        const cx = pts.reduce((s, p) => s + p.x, 0) / n;
        const cy = pts.reduce((s, p) => s + p.y, 0) / n;
        const centered = pts.map(p => ({ x: p.x - cx, y: p.y - cy }));
        epicyclesRef.current = computeEpicycles(centered);
        setParametric(toParametric(epicyclesRef.current, numCircles));
        trailRef.current = [];
        tRef.current = 0;
        setMode("animate");
    }, [rawPoints, numCircles]);

    useEffect(() => {
        if (mode !== "animate") return;
        const canvas = animCanvas.current;
        const ctx = canvas.getContext("2d");
        const W = canvas.width, H = canvas.height;
        const cycles = epicyclesRef.current.slice(0, numCircles);
        const speed = (2 * Math.PI) / (cycles.length > 0 ? cycles.length * 2 : 60);

        const draw = () => {
            ctx.clearRect(0, 0, W, H);
            // Background grid
            ctx.strokeStyle = "rgba(100,150,180,0.06)";
            ctx.lineWidth = 1;
            for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
            for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

            let x = W / 2, y = H / 2;
            for (const c of cycles) {
                const px = x, py = y;
                const angle = c.freq * tRef.current + c.phase;
                x += c.amp * Math.cos(angle);
                y -= c.amp * Math.sin(angle);
                // Circle
                ctx.beginPath();
                ctx.arc(px, py, c.amp, 0, 2 * Math.PI);
                ctx.strokeStyle = "rgba(100,200,255,0.15)";
                ctx.lineWidth = 0.8;
                ctx.stroke();
                // Arm
                ctx.beginPath();
                ctx.moveTo(px, py); ctx.lineTo(x, y);
                ctx.strokeStyle = "rgba(100,220,255,0.5)";
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }

            trailRef.current.push({ x, y });
            if (trailRef.current.length > 2000) trailRef.current.shift();

            // Trail
            if (trailRef.current.length > 1) {
                ctx.beginPath();
                ctx.moveTo(trailRef.current[0].x, trailRef.current[0].y);
                for (let i = 1; i < trailRef.current.length; i++) {
                    ctx.lineTo(trailRef.current[i].x, trailRef.current[i].y);
                }
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 2;
                ctx.lineJoin = "round";
                ctx.shadowColor = "#ffffff";
                ctx.shadowBlur = 6;
                ctx.stroke();
                ctx.shadowBlur = 0;
            }

            // Tip dot
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, 2 * Math.PI);
            ctx.fillStyle = "#fff";
            ctx.fill();

            tRef.current += speed;
            animRef.current = requestAnimationFrame(draw);
        };

        animRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(animRef.current);
    }, [mode, numCircles]);

    const reset = () => {
        cancelAnimationFrame(animRef.current);
        setMode("draw");
        setRawPoints([]);
        setParametric(null);
        trailRef.current = [];
        const ctx = drawCanvas.current?.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, drawCanvas.current.width, drawCanvas.current.height);
    };

    const W = 900, H = 560;

    const desmosTuple = (() => {
        if (!parametric) return "";
        const safeReplaceDot = (s) => (s || "").split("·").join("*"); // no replaceAll
        const xExpr = safeReplaceDot(parametric.x.split("=").slice(1).join("=").trim());
        const yExpr = safeReplaceDot(parametric.y.split("=").slice(1).join("=").trim());

        return `(${xExpr}, ${yExpr})`;
    })();

    return (
        <div style={{
            minHeight: "100vh",
            background: "#050d14",
            fontFamily: "'Courier New', monospace",
            color: "#ffffff",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "24px 16px",
        }}>
            {/* Header */}
            <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ fontSize: 11, letterSpacing: 6, color: "#ffffff", marginBottom: 6 }}>FOURIER SERIES VISUALIZER</div>
                <h1 style={{
                    margin: 0,
                    fontSize: 32,
                    fontWeight: 700,
                    background: "linear-gradient(90deg, #7eeaff, #a0d8ef, #7eeaff)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    letterSpacing: 2,
                }}>Epicycle Studio</h1>
            </div>

            {/* Controls */}
            <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
                {mode === "draw" ? (
                    <button onClick={startAnimation} disabled={rawPoints.length < 8} style={btnStyle(!!(rawPoints.length < 8))}>
                        ▶ ANIMATE
                    </button>
                ) : (
                    <button onClick={reset} style={btnStyle(false, true)}>
                        ✕ RESET
                    </button>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(100,200,255,0.05)", border: "1px solid rgba(100,200,255,0.15)", borderRadius: 6, padding: "6px 14px" }}>
                    <span style={{ fontSize: 11, letterSpacing: 2, color: "#ffffff" }}>CIRCLES</span>
                    <input
                        type="range" min={1} max={150} value={numCircles}
                        onChange={e => {
                            setNumCircles(+e.target.value);
                            if (mode === "animate") {
                                setParametric(toParametric(epicyclesRef.current, +e.target.value));
                                trailRef.current = [];
                                tRef.current = 0;
                            }
                        }}
                        style={{ width: 120, accentColor: "#ffffff" }}
                    />
                    <span style={{ fontSize: 14, color: "#ffffff", minWidth: 28, textAlign: "right" }}>{numCircles}</span>
                </div>
            </div>

            {/* Canvas */}
            <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(100,200,255,0.2)", boxShadow: "0 0 40px rgba(100,200,255,0.07)" }}>
                <canvas
                    ref={drawCanvas}
                    width={W} height={H}
                    style={{ display: mode === "draw" ? "block" : "none", background: "#060f18", cursor: "crosshair", touchAction: "none" }}
                    onMouseDown={startDraw} onMouseMove={continueDraw} onMouseUp={endDraw} onMouseLeave={endDraw}
                    onTouchStart={startDraw} onTouchMove={continueDraw} onTouchEnd={endDraw}
                />
                <canvas
                    ref={animCanvas}
                    width={W} height={H}
                    style={{ display: mode === "animate" ? "block" : "none", background: "#060f18" }}
                />
                {mode === "draw" && rawPoints.length === 0 && (
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                        <div style={{ textAlign: "center", opacity: 0.3 }}>
                            <div style={{ fontSize: 48, marginBottom: 10 }}>✏</div>
                            <div style={{ fontSize: 13, letterSpacing: 3 }}>DRAW YOUR CURVE HERE</div>
                        </div>
                    </div>
                )}
            </div>

            {/* Parametric output */}
            {parametric && (
                <div style={{
                    marginTop: 20, maxWidth: W, width: "100%",
                    background: "rgba(0,30,50,0.8)", border: "1px solid rgba(100,200,255,0.2)",
                    borderRadius: 8, padding: "16px 22px",
                }}>
                    <div style={{ fontSize: 10, letterSpacing: 4, color: "#ffffff", marginBottom: 10 }}>PARAMETRIC EQUATION — t ∈ [0, 2π]</div>
                    <div style={{ fontSize: 12, color: "#ffffff", lineHeight: 1.8, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        <span style={{ color: "#ffffff" }}>{parametric.x}</span>
                        <br />
                        <span style={{ color: "#ffffff" }}>{parametric.y}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "#ffffff", marginTop: 10, letterSpacing: 1 }}>
                        Showing top {numCircles} frequency components · Drag the slider to change precision
                    </div>
                    <CopyLine label="DESMOS" value={desmosTuple} />
                </div>
            )}
        </div>
    );
}

function btnStyle(disabled, danger = false) {
    return {
        padding: "8px 22px",
        fontSize: 11,
        letterSpacing: 3,
        fontFamily: "'Courier New', monospace",
        fontWeight: 700,
        border: `1px solid ${danger ? "rgba(255,100,100,0.4)" : "rgba(256,256,256,256)"}`,
        borderRadius: 6,
        background: danger ? "rgba(255,60,60,0.08)" : "rgba(100,200,255,0.08)",
        color: disabled ? "#ffffff" : danger ? "#ff8888" : "#ffffff",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.2s",
        opacity: disabled ? 0.5 : 1,
    };
}