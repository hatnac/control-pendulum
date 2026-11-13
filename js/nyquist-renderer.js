/**
 * nyquist-renderer.js - ベクトル軌跡（ナイキスト線図 / 複素平面プロット）のCanvas描画
 * 1:1等方スケール・進行方向矢印・現在周波数ベクトル＆位相角扇形・実測点プロット・クリック周波数ジャンプ対応
 */

import { BodeAnalyzer } from './bode.js';

export class NyquistRenderer {
    /**
     * @param {HTMLCanvasElement} canvas 
     */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;

        // 閉ループ時の描画対象: 'matched' (ボード線図と同じ T(jω)) | 'loop' (一巡伝達関数 L(jω) と (-1,0)点)
        this.nyquistMode = 'matched';

        this.colors = {
            bg: '#0f172a',
            grid: '#1e293b',
            axis: '#475569',
            text: '#94a3b8',
            theory: '#38bdf8',
            unitCircle: 'rgba(148, 163, 184, 0.35)',
            critical: '#f43f5e',
            measured: '#34d399',
            cursor: '#eab308',
            cursorGlow: 'rgba(234, 179, 8, 0.5)'
        };

        // 座標逆変換・クリック検索用キャッシュ
        this.lastView = null;
        this.lastCurvePoints = [];

        this.resize();
    }

    setNyquistMode(mode) {
        this.nyquistMode = mode;
    }

    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        let w = rect.width;
        let h = rect.height;

        if (w <= 0 || h <= 0) {
            const parent = this.canvas.parentElement;
            if (parent) {
                const pRect = parent.getBoundingClientRect();
                w = pRect.width || w;
                h = pRect.height || h;
            }
        }
        if (w <= 0) w = 320;
        if (h <= 0) h = 240;

        this.width = w;
        this.height = h;
        this.canvas.width = w * this.dpr;
        this.canvas.height = h * this.dpr;
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    /**
     * 複素平面の描画対象点の配列を生成 (ω: 0.05 〜 40 rad/s)
     */
    computeCurvePoints(analyzer, systemType, physics, pid) {
        const isClosed = (analyzer.loopType || 'open') === 'closed';
        const isLoopL = isClosed && this.nyquistMode === 'loop';

        const N = 180;
        const wMin = 0.05;
        const wMax = 40.0;
        const logMin = Math.log10(wMin);
        const logMax = Math.log10(wMax);

        const pts = [];
        for (let i = 0; i < N; i++) {
            const w = Math.pow(10, logMin + (i / (N - 1)) * (logMax - logMin));
            const pt = isLoopL
                ? BodeAnalyzer.evaluateOpenLoopL(w, systemType, physics, pid)
                : BodeAnalyzer.evaluatePoint(w, systemType, physics, isClosed ? 'closed' : 'open', pid);
            pts.push(pt);
        }
        return { pts, isClosed, isLoopL };
    }

    /**
     * 適切な目盛りステップ幅を選択
     */
    pickNiceStep(span) {
        const raw = span / 5.0;
        const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(1e-5, raw))));
        const norm = raw / pow10;
        let nice = 1;
        if (norm > 5) nice = 10;
        else if (norm > 2) nice = 5;
        else if (norm > 1) nice = 2;
        return nice * pow10;
    }

    /**
     * クリック位置に最も近い軌跡上の周波数 ω を検索
     */
    findNearestOmega(canvasX, canvasY) {
        if (!this.lastView || !this.lastCurvePoints || this.lastCurvePoints.length === 0) {
            return null;
        }
        const { centerRe, centerIm, pxPerUnit, plotCenterX, plotCenterY } = this.lastView;
        const reToX = (re) => plotCenterX + (re - centerRe) * pxPerUnit;
        const imToY = (im) => plotCenterY - (im - centerIm) * pxPerUnit;

        let bestOmega = null;
        let bestDistSq = Infinity;
        for (const pt of this.lastCurvePoints) {
            if (!isFinite(pt.re) || !isFinite(pt.im)) continue;
            const px = reToX(pt.re);
            const py = imToY(pt.im);
            const dSq = (px - canvasX) * (px - canvasX) + (py - canvasY) * (py - canvasY);
            if (dSq < bestDistSq) {
                bestDistSq = dSq;
                bestOmega = pt.omega;
            }
        }
        return bestOmega;
    }

    /**
     * ベクトル軌跡全体の描画
     */
    draw(analyzer, systemType, physics, pid = null) {
        if (!this.width || this.width < 20 || !this.height || this.height < 20) {
            this.resize();
        }

        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, w, h);

        const padLeft = 42;
        const padRight = 14;
        const padTop = 22;
        const padBottom = 22;
        const plotW = Math.max(60, w - padLeft - padRight);
        const plotH = Math.max(60, h - padTop - padBottom);
        const plotCenterX = padLeft + plotW * 0.5;
        const plotCenterY = padTop + plotH * 0.5;

        const { pts, isClosed, isLoopL } = this.computeCurvePoints(analyzer, systemType, physics, pid);
        this.lastCurvePoints = pts;

        const chars = BodeAnalyzer.computeSystemCharacteristics(systemType, physics, isClosed ? 'closed' : 'open', pid);

        // バウンディングボックス計算（極端な発散点を除外しつつ主要範囲を確保）
        const capRadius = isLoopL
            ? 3.8
            : (isClosed ? 3.5 : Math.max(0.5, chars.dcGain * 6.5));

        let minRe = isLoopL ? -1.4 : (isClosed ? -0.3 : -chars.dcGain * 0.3);
        let maxRe = isLoopL ? 0.8 : (isClosed ? 1.25 : Math.max(0.05, chars.dcGain * 1.15));
        let minIm = isLoopL ? -2.2 : (isClosed ? -0.9 : -chars.dcGain * 1.2);
        let maxIm = isLoopL ? 0.6 : (isClosed ? 0.35 : chars.dcGain * 0.25);

        // 必ず原点 (0,0) を含める
        minRe = Math.min(minRe, 0);
        maxRe = Math.max(maxRe, 0);
        minIm = Math.min(minIm, 0);
        maxIm = Math.max(maxIm, 0);

        for (const pt of pts) {
            const mag = Math.hypot(pt.re, pt.im);
            if (!isFinite(mag) || mag > capRadius) continue;
            if (pt.re < minRe) minRe = pt.re;
            if (pt.re > maxRe) maxRe = pt.re;
            if (pt.im < minIm) minIm = pt.im;
            if (pt.im > maxIm) maxIm = pt.im;
        }

        // 1:1 正方形スケール（アスペクト比維持）
        const spanRe = Math.max(1e-3, (maxRe - minRe) * 1.22);
        const spanIm = Math.max(1e-3, (maxIm - minIm) * 1.22);
        const pxPerUnit = Math.min(plotW / spanRe, plotH / spanIm);
        const centerRe = (minRe + maxRe) * 0.5;
        const centerIm = (minIm + maxIm) * 0.5;

        this.lastView = { centerRe, centerIm, pxPerUnit, plotCenterX, plotCenterY };

        const reToX = (re) => plotCenterX + (re - centerRe) * pxPerUnit;
        const imToY = (im) => plotCenterY - (im - centerIm) * pxPerUnit;

        // クリップ領域設定
        ctx.save();
        ctx.beginPath();
        ctx.rect(padLeft, padTop, plotW, plotH);
        ctx.clip();

        // 1. グリッド線と複素軸
        const visibleReSpan = plotW / pxPerUnit;
        const visibleImSpan = plotH / pxPerUnit;
        const step = this.pickNiceStep(Math.max(visibleReSpan, visibleImSpan));

        const reStart = Math.floor((centerRe - visibleReSpan * 0.5) / step) * step;
        const reEnd = Math.ceil((centerRe + visibleReSpan * 0.5) / step) * step;
        const imStart = Math.floor((centerIm - visibleImSpan * 0.5) / step) * step;
        const imEnd = Math.ceil((centerIm + visibleImSpan * 0.5) / step) * step;

        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 1;
        for (let r = reStart; r <= reEnd + step * 0.1; r += step) {
            const x = reToX(r);
            ctx.beginPath();
            ctx.moveTo(x, padTop);
            ctx.lineTo(x, padTop + plotH);
            ctx.stroke();
        }
        for (let im = imStart; im <= imEnd + step * 0.1; im += step) {
            const y = imToY(im);
            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(padLeft + plotW, y);
            ctx.stroke();
        }

        const ox = reToX(0);
        const oy = imToY(0);

        // 原点を通る実軸 (Im=0) と虚軸 (Re=0)
        ctx.strokeStyle = this.colors.axis;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(padLeft, oy);
        ctx.lineTo(padLeft + plotW, oy);
        ctx.moveTo(ox, padTop);
        ctx.lineTo(ox, padTop + plotH);
        ctx.stroke();

        // 2. 単位円や基準点（閉ループ T / 一巡 L）
        if (isClosed) {
            ctx.strokeStyle = this.colors.unitCircle;
            ctx.lineWidth = 1.1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(ox, oy, 1.0 * pxPerUnit, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            if (isLoopL) {
                // (-1, j0) ナイキスト臨界点
                const cxCrit = reToX(-1.0);
                const cyCrit = imToY(0.0);
                ctx.strokeStyle = this.colors.critical;
                ctx.lineWidth = 2.2;
                const s = 5;
                ctx.beginPath();
                ctx.moveTo(cxCrit - s, cyCrit - s);
                ctx.lineTo(cxCrit + s, cyCrit + s);
                ctx.moveTo(cxCrit + s, cyCrit - s);
                ctx.lineTo(cxCrit - s, cyCrit + s);
                ctx.stroke();

                ctx.fillStyle = '#fda4af';
                ctx.font = 'bold 9px monospace';
                ctx.textAlign = 'center';
                ctx.fillText('(-1, 0) 臨界点', cxCrit, cyCrit - 9);
            } else {
                // T(j0) = (1, 0) 理想追従点
                const cxIdeal = reToX(1.0);
                const cyIdeal = imToY(0.0);
                ctx.fillStyle = '#10b981';
                ctx.beginPath();
                ctx.arc(cxIdeal, cyIdeal, 3.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.font = '9px monospace';
                ctx.textAlign = 'right';
                ctx.fillText('理想(1,0)', cxIdeal - 5, cyIdeal - 6);
            }
        } else {
            // 開ループ: DCゲイン点 (1/K, 0)
            const cxDc = reToX(chars.dcGain);
            const cyDc = imToY(0);
            ctx.fillStyle = '#10b981';
            ctx.beginPath();
            ctx.arc(cxDc, cyDc, 3.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('ω=0', cxDc, cyDc - 7);
        }

        // 3. 理論ベクトル軌跡の描画
        ctx.strokeStyle = this.colors.theory;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        let started = false;
        for (const pt of pts) {
            if (!isFinite(pt.re) || !isFinite(pt.im)) continue;
            const px = reToX(pt.re);
            const py = imToY(pt.im);
            if (!started) {
                ctx.moveTo(px, py);
                started = true;
            } else {
                ctx.lineTo(px, py);
            }
        }
        ctx.stroke();

        // 軌跡上の進行方向矢印 (ω 増加方向)
        const arrowIndices = [Math.floor(pts.length * 0.35), Math.floor(pts.length * 0.55), Math.floor(pts.length * 0.72)];
        ctx.fillStyle = '#7dd3fc';
        for (const idx of arrowIndices) {
            if (idx > 0 && idx < pts.length - 1) {
                const p1 = pts[idx - 1];
                const p2 = pts[idx + 1];
                const x1 = reToX(p1.re);
                const y1 = imToY(p1.im);
                const x2 = reToX(p2.re);
                const y2 = imToY(p2.im);
                const segLen = Math.hypot(x2 - x1, y2 - y1);
                if (segLen > 3 && x2 >= padLeft && x2 <= padLeft + plotW && y2 >= padTop && y2 <= padTop + plotH) {
                    const ang = Math.atan2(y2 - y1, x2 - x1);
                    const sz = 5.5;
                    ctx.beginPath();
                    ctx.moveTo(x2, y2);
                    ctx.lineTo(x2 - sz * Math.cos(ang - 0.45), y2 - sz * Math.sin(ang - 0.45));
                    ctx.lineTo(x2 - sz * Math.cos(ang + 0.45), y2 - sz * Math.sin(ang + 0.45));
                    ctx.closePath();
                    ctx.fill();
                }
            }
        }

        // 固有角周波数 ωn (開ループ時) のマーカー
        if (!isClosed && isFinite(chars.wn)) {
            const wnPt = BodeAnalyzer.evaluatePoint(chars.wn, systemType, physics, 'open', null);
            const wx = reToX(wnPt.re);
            const wy = imToY(wnPt.im);
            if (wy >= padTop && wy <= padTop + plotH) {
                ctx.fillStyle = '#38bdf8';
                ctx.beginPath();
                ctx.arc(wx, wy, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.font = '9px monospace';
                ctx.textAlign = 'left';
                ctx.fillText(`ωn (-90°)`, wx + 6, wy + 3);
            }
        }

        // 4. 実測プロット点の描画 (matched モード時)
        if (!isLoopL && analyzer.measurements && analyzer.measurements.length > 0) {
            ctx.fillStyle = this.colors.measured;
            for (const mPt of analyzer.measurements) {
                const mag = Math.pow(10, mPt.gainDb / 20.0);
                const rad = (mPt.phaseDeg * Math.PI) / 180.0;
                const re = mag * Math.cos(rad);
                const im = mag * Math.sin(rad);
                const mx = reToX(re);
                const my = imToY(im);
                ctx.beginPath();
                ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 5. 現在周波数 ω の位置ベクトル矢印（原点 -> G(jω)）と位相差扇形
        const curPt = isLoopL
            ? BodeAnalyzer.evaluateOpenLoopL(analyzer.omega, systemType, physics, pid)
            : BodeAnalyzer.evaluatePoint(analyzer.omega, systemType, physics, isClosed ? 'closed' : 'open', pid);

        if (isFinite(curPt.re) && isFinite(curPt.im)) {
            const cxCur = reToX(curPt.re);
            const cyCur = imToY(curPt.im);
            const vecLen = Math.hypot(cxCur - ox, cyCur - oy);

            // 位相差 φ の扇形アーク (実軸正方向 0° 〜 φ)
            if (vecLen > 12 && Math.abs(curPt.phaseDeg) > 1.0) {
                const arcR = Math.min(28, vecLen * 0.45);
                const phiRad = (curPt.phaseDeg * Math.PI) / 180.0;
                ctx.fillStyle = 'rgba(234, 179, 8, 0.18)';
                ctx.beginPath();
                ctx.moveTo(ox, oy);
                ctx.arc(ox, oy, arcR, 0, -phiRad, phiRad > 0);
                ctx.closePath();
                ctx.fill();
            }

            // 原点からの位置ベクトル矢印（黄色）
            ctx.strokeStyle = this.colors.cursor;
            ctx.fillStyle = this.colors.cursor;
            ctx.lineWidth = 2.4;
            ctx.shadowColor = this.colors.cursorGlow;
            ctx.shadowBlur = 8;

            ctx.beginPath();
            ctx.moveTo(ox, oy);
            ctx.lineTo(cxCur, cyCur);
            ctx.stroke();

            if (vecLen > 8) {
                const ang = Math.atan2(cyCur - oy, cxCur - ox);
                const head = 8;
                ctx.beginPath();
                ctx.moveTo(cxCur, cyCur);
                ctx.lineTo(cxCur - head * Math.cos(ang - 0.38), cyCur - head * Math.sin(ang - 0.38));
                ctx.lineTo(cxCur - head * Math.cos(ang + 0.38), cyCur - head * Math.sin(ang + 0.38));
                ctx.closePath();
                ctx.fill();
            }

            // 現在の先端ドット
            ctx.fillStyle = '#fef08a';
            ctx.beginPath();
            ctx.arc(cxCur, cyCur, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // クリップ解除して枠線と軸ラベル描画
        ctx.restore();

        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.strokeRect(padLeft, padTop, plotW, plotH);

        // 目盛り数値 (実軸左右と虚軸上下の代表値)
        ctx.fillStyle = this.colors.text;
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let r = reStart; r <= reEnd + step * 0.1; r += step) {
            const x = reToX(r);
            if (x >= padLeft + 12 && x <= padLeft + plotW - 12) {
                ctx.fillText(Math.abs(r) < 1e-6 ? '0' : r.toFixed(step < 0.1 ? 2 : 1), x, padTop + plotH + 4);
            }
        }

        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let im = imStart; im <= imEnd + step * 0.1; im += step) {
            const y = imToY(im);
            if (y >= padTop + 8 && y <= padTop + plotH - 8) {
                ctx.fillText(Math.abs(im) < 1e-6 ? '0' : im.toFixed(step < 0.1 ? 2 : 1), padLeft - 4, y);
            }
        }

        // 軸名
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('Re (実部)', padLeft + plotW, padTop + plotH + 4);
        ctx.textAlign = 'left';
        ctx.fillText('Im (虚部)', padLeft + 4, padTop - 13);

        // 凡例 & 右上数値HUD
        ctx.fillStyle = '#eab308';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        const sym = isLoopL ? 'L' : (isClosed ? 'T' : 'G');
        if (w < 420) {
            ctx.fillText(
                `${sym}(j${analyzer.omega.toFixed(2)}): |${curPt.gain.toFixed(3)}| ∠${curPt.phaseDeg.toFixed(0)}°`,
                padLeft + plotW,
                padTop - 13
            );
        } else {
            const reSign = curPt.re >= 0 ? '+' : '';
            const imSign = curPt.im >= 0 ? '+' : '-';
            ctx.fillText(
                `${sym}(j${analyzer.omega.toFixed(2)}) = ${reSign}${curPt.re.toFixed(3)} ${imSign} j${Math.abs(curPt.im).toFixed(3)} | |${sym}|=${curPt.gain.toFixed(3)} ∠${curPt.phaseDeg.toFixed(0)}°`,
                padLeft + plotW,
                padTop - 13
            );
        }
    }
}
