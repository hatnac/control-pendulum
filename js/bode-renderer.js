/**
 * bode-renderer.js - ボード線図（ゲイン線図＆位相線図）のCanvas描画
 * 学習ガイド（領域色分け・折れ線漸近線・共振点/帯域幅マーカー）＆クリック周波数選択対応
 */

import { BodeAnalyzer } from './bode.js';

export class BodeRenderer {
    /**
     * @param {HTMLCanvasElement} canvas 
     */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;

        // 学習ガイド（領域色分け・漸近線・折点マーカー）表示フラグ
        this.showGuide = true;

        // 周波数レンジ（対数）
        this.minOmega = 0.2;
        this.maxOmega = 30.0;

        // ゲインレンジ [dB]
        this.minGainDb = -45.0;
        this.maxGainDb = 25.0;

        // 位相レンジ [deg]
        this.minPhaseDeg = -195.0;
        this.maxPhaseDeg = 15.0;

        // レイアウトパディング（座標逆変換でも共有）
        this.padLeft = 44;
        this.padRight = 18;
        this.padTop = 18;
        this.padBottom = 22;
        this.gap = 18;

        this.colors = {
            bg: '#0f172a',
            grid: '#1e293b',
            subGrid: 'rgba(30, 41, 59, 0.5)',
            axis: '#334155',
            zeroLine: 'rgba(148, 163, 184, 0.4)',
            text: '#94a3b8',
            theory: 'rgba(56, 189, 248, 0.65)',  // 理論曲線
            asymptote: 'rgba(251, 146, 60, 0.55)', // 折れ線漸近線（オレンジ破線）
            measured: '#10b981',                 // 実測プロット（エメラルド実線）
            point: '#34d399',
            pointGlow: 'rgba(16, 185, 129, 0.5)',
            cursor: '#eab308',                   // 現在周波数カーソル（イエロー）
            cursorDot: '#fef08a'
        };

        this.resize();
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
     * 周波数 ω -> Xピクセル座標 (対数変換)
     */
    omegaToX(omega, plotLeft, plotWidth) {
        const logMin = Math.log10(this.minOmega);
        const logMax = Math.log10(this.maxOmega);
        const logW = Math.log10(Math.max(this.minOmega, Math.min(this.maxOmega, omega)));
        const norm = (logW - logMin) / (logMax - logMin);
        return plotLeft + norm * plotWidth;
    }

    /**
     * Xピクセル座標 -> 周波数 ω (対数逆変換: ボード線図クリック操作用)
     */
    xToOmega(canvasX) {
        const plotW = Math.max(10, (this.width || 320) - this.padLeft - this.padRight);
        const norm = Math.max(0, Math.min(1, (canvasX - this.padLeft) / plotW));
        const logMin = Math.log10(this.minOmega);
        const logMax = Math.log10(this.maxOmega);
        return Math.pow(10, logMin + norm * (logMax - logMin));
    }

    /**
     * ゲイン [dB] -> Yピクセル座標
     */
    gainToY(gainDb, plotTop, plotHeight) {
        const norm = (gainDb - this.minGainDb) / (this.maxGainDb - this.minGainDb);
        return plotTop + plotHeight * (1.0 - Math.max(0, Math.min(1, norm)));
    }

    /**
     * 位相 [deg] -> Yピクセル座標
     */
    phaseToY(phaseDeg, plotTop, plotHeight) {
        const norm = (phaseDeg - this.minPhaseDeg) / (this.maxPhaseDeg - this.minPhaseDeg);
        return plotTop + plotHeight * (1.0 - Math.max(0, Math.min(1, norm)));
    }

    /**
     * ボード線図全体の描画
     * @param {BodeAnalyzer} analyzer 
     * @param {string} systemType 'msd' | 'pendulum'
     * @param {object} physics 
     * @param {object|null} pid
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

        const padLeft = this.padLeft;
        const padRight = this.padRight;
        const padTop = this.padTop;
        const padBottom = this.padBottom;
        const gap = this.gap;

        const totalPlotH = h - padTop - padBottom - gap;
        const gainPlotH = Math.floor(totalPlotH * 0.52);
        const phasePlotH = totalPlotH - gainPlotH;

        const plotW = w - padLeft - padRight;
        const gainPlotTop = padTop;
        const phasePlotTop = padTop + gainPlotH + gap;

        const loopType = analyzer.loopType || 'open';
        const offsetDb = analyzer.getDisplayGainOffsetDb ? analyzer.getDisplayGainOffsetDb(systemType, physics) : 0.0;
        const isNormalized = analyzer.isDcNormalizedActive ? analyzer.isDcNormalizedActive(systemType, physics) : false;

        // 0. 学習ガイド（3領域背景色分け）
        if (this.showGuide) {
            this.drawRegionBackgrounds(analyzer, systemType, physics, pid, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH);
        }

        // 1. グリッドと目盛り
        this.drawGridsAndAxes(plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH, padLeft, padRight, loopType, isNormalized);

        // 2. 学習ガイド（漸近線・共振点/帯域幅マーカー）
        if (this.showGuide) {
            this.drawLearningOverlays(analyzer, systemType, physics, pid, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH, offsetDb);
        }

        // 3. 理論曲線の描画（高解像度サンプル）
        this.drawTheoreticalCurves(systemType, physics, loopType, pid, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH, offsetDb);

        // 4. 実測プロット点の描画
        this.drawMeasuredPlots(analyzer.measurements, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH, offsetDb);

        // 5. 現在入力中の周波数カーソル＆リアルタイム点
        this.drawCurrentCursor(analyzer, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH, offsetDb);

        // 6. 凡例＆HUD
        this.drawLegend(analyzer, padLeft, gainPlotTop, phasePlotTop, isNormalized);
    }

    drawRegionBackgrounds(analyzer, systemType, physics, pid, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH) {
        const ctx = this.ctx;
        const loopType = analyzer.loopType || 'open';
        const chars = BodeAnalyzer.computeSystemCharacteristics(systemType, physics, loopType, pid);

        ctx.save();
        if (loopType === 'open') {
            const wLowMax = Math.max(this.minOmega, Math.min(this.maxOmega, chars.wn * 0.6));
            const wHighMin = Math.max(this.minOmega, Math.min(this.maxOmega, chars.wn * 1.45));

            const xMin = padLeft;
            const xLowEnd = this.omegaToX(wLowMax, padLeft, plotW);
            const xHighStart = this.omegaToX(wHighMin, padLeft, plotW);
            const xMax = padLeft + plotW;

            // 低周波域（緑ティント）
            if (xLowEnd > xMin) {
                ctx.fillStyle = 'rgba(16, 185, 129, 0.06)';
                ctx.fillRect(xMin, gainPlotTop, xLowEnd - xMin, gainPlotH);
                ctx.fillRect(xMin, phasePlotTop, xLowEnd - xMin, phasePlotH);
            }
            // 共振域（アンバーティント）
            if (xHighStart > xLowEnd) {
                ctx.fillStyle = 'rgba(234, 179, 8, 0.07)';
                ctx.fillRect(xLowEnd, gainPlotTop, xHighStart - xLowEnd, gainPlotH);
                ctx.fillRect(xLowEnd, phasePlotTop, xHighStart - xLowEnd, phasePlotH);
            }
            // 高周波域（レッドティント）
            if (xMax > xHighStart) {
                ctx.fillStyle = 'rgba(244, 63, 94, 0.06)';
                ctx.fillRect(xHighStart, gainPlotTop, xMax - xHighStart, gainPlotH);
                ctx.fillRect(xHighStart, phasePlotTop, xMax - xHighStart, phasePlotH);
            }
        } else {
            // 閉ループ時は追従帯域内 (0 〜 ωB) を薄い緑で示す
            if (chars.bandwidthOmega) {
                const xBw = this.omegaToX(Math.min(this.maxOmega, chars.bandwidthOmega), padLeft, plotW);
                if (xBw > padLeft) {
                    ctx.fillStyle = 'rgba(16, 185, 129, 0.07)';
                    ctx.fillRect(padLeft, gainPlotTop, xBw - padLeft, gainPlotH);
                    ctx.fillRect(padLeft, phasePlotTop, xBw - padLeft, phasePlotH);
                }
            }
        }
        ctx.restore();
    }

    drawLearningOverlays(analyzer, systemType, physics, pid, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH, offsetDb = 0.0) {
        const ctx = this.ctx;
        const loopType = analyzer.loopType || 'open';
        const chars = BodeAnalyzer.computeSystemCharacteristics(systemType, physics, loopType, pid);

        ctx.save();
        if (loopType === 'open') {
            // 1. 折れ線漸近線（DCゲイン一定 → ωnから -40dB/dec で下降）
            const wn = Math.max(this.minOmega, Math.min(this.maxOmega, chars.wn));
            const xCorner = this.omegaToX(wn, padLeft, plotW);
            const effDcGainDb = chars.dcGainDb + offsetDb;
            const yDc = this.gainToY(effDcGainDb, gainPlotTop, gainPlotH);

            ctx.strokeStyle = this.colors.asymptote;
            ctx.lineWidth = 1.4;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(padLeft, yDc);
            ctx.lineTo(xCorner, yDc);

            // ω_max での漸近値: effDcGainDb - 40 * log10(maxOmega / wn)
            const highGainDb = effDcGainDb - 40.0 * Math.log10(Math.max(1.0, this.maxOmega / wn));
            // グラフ下端との交点をクリッピングして綺麗に描く
            const xEnd = padLeft + plotW;
            const yEnd = this.gainToY(highGainDb, gainPlotTop, gainPlotH);
            ctx.lineTo(xEnd, yEnd);
            ctx.stroke();

            // 漸近線ラベル (-40 dB/dec)
            if (xCorner < padLeft + plotW - 60) {
                ctx.fillStyle = 'rgba(251, 146, 60, 0.85)';
                ctx.font = '9px monospace';
                ctx.textAlign = 'left';
                const labelY = Math.min(gainPlotTop + gainPlotH - 12, Math.max(gainPlotTop + 18, (yDc + yEnd) * 0.5));
                ctx.fillText('-40dB/dec', Math.min(padLeft + plotW - 58, xCorner + 12), labelY);
            }

            // 2. 固有角周波数 ωn の縦ガイドライン & -90°交点
            if (chars.wn >= this.minOmega && chars.wn <= this.maxOmega) {
                const xWn = this.omegaToX(chars.wn, padLeft, plotW);
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
                ctx.lineWidth = 1.1;
                ctx.setLineDash([2, 3]);
                ctx.beginPath();
                ctx.moveTo(xWn, gainPlotTop);
                ctx.lineTo(xWn, gainPlotTop + gainPlotH);
                ctx.moveTo(xWn, phasePlotTop);
                ctx.lineTo(xWn, phasePlotTop + phasePlotH);
                ctx.stroke();

                // 位相 -90° 交点マーカー
                const yMinus90 = this.phaseToY(-90, phasePlotTop, phasePlotH);
                ctx.setLineDash([]);
                ctx.fillStyle = '#38bdf8';
                ctx.beginPath();
                ctx.arc(xWn, yMinus90, 3.5, 0, Math.PI * 2);
                ctx.fill();

                ctx.font = '9px monospace';
                ctx.textAlign = xWn > padLeft + plotW * 0.72 ? 'right' : 'left';
                const txOffset = xWn > padLeft + plotW * 0.72 ? -5 : 5;
                ctx.fillText(`ωn=${chars.wn.toFixed(2)} (-90°)`, xWn + txOffset, yMinus90 - 11);
            }

            // 領域ラベル（下部空きスペース付近）
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(16, 185, 129, 0.75)';
            ctx.fillText('同位相・追従', padLeft + 6, phasePlotTop + phasePlotH - 13);

            ctx.textAlign = 'right';
            ctx.fillStyle = 'rgba(244, 63, 94, 0.75)';
            ctx.fillText('逆位相・減衰', padLeft + plotW - 6, phasePlotTop + 4);
        } else {
            // 閉ループ学習オーバーレイ: -3dBライン & 帯域幅 ωB
            const yMinus3 = this.gainToY(chars.dcGainDb - 3.0, gainPlotTop, gainPlotH);
            ctx.strokeStyle = 'rgba(251, 146, 60, 0.55)';
            ctx.lineWidth = 1.1;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(padLeft, yMinus3);
            ctx.lineTo(padLeft + plotW, yMinus3);
            ctx.stroke();

            ctx.fillStyle = 'rgba(251, 146, 60, 0.85)';
            ctx.font = '9px monospace';
            ctx.textAlign = 'right';
            ctx.fillText('-3dB基準', padLeft + plotW - 4, yMinus3 + 3);

            if (chars.bandwidthOmega && chars.bandwidthOmega >= this.minOmega && chars.bandwidthOmega <= this.maxOmega) {
                const xBw = this.omegaToX(chars.bandwidthOmega, padLeft, plotW);
                ctx.strokeStyle = 'rgba(16, 185, 129, 0.65)';
                ctx.lineWidth = 1.2;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(xBw, gainPlotTop);
                ctx.lineTo(xBw, gainPlotTop + gainPlotH);
                ctx.moveTo(xBw, phasePlotTop);
                ctx.lineTo(xBw, phasePlotTop + phasePlotH);
                ctx.stroke();

                ctx.setLineDash([]);
                ctx.fillStyle = '#10b981';
                ctx.beginPath();
                ctx.arc(xBw, yMinus3, 4, 0, Math.PI * 2);
                ctx.fill();

                ctx.font = '9px monospace';
                ctx.textAlign = xBw > padLeft + plotW * 0.7 ? 'right' : 'left';
                const offset = xBw > padLeft + plotW * 0.7 ? -6 : 6;
                ctx.fillText(`帯域幅 ωB=${chars.bandwidthOmega.toFixed(2)}`, xBw + offset, gainPlotTop + 18);
            }
        }
        ctx.restore();
    }

    drawGridsAndAxes(plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH, padLeft, padRight, loopType = 'open', isNormalized = false) {
        const ctx = this.ctx;
        const w = this.width;

        // 対数周波数グリッド (0.2, 0.5, 1, 2, 5, 10, 20 rad/s)
        const omegaTicks = [0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0];
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 1;
        ctx.fillStyle = this.colors.text;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        omegaTicks.forEach(wVal => {
            const x = this.omegaToX(wVal, padLeft, plotW);
            // 縦グリッド
            ctx.beginPath();
            ctx.moveTo(x, gainPlotTop);
            ctx.lineTo(x, gainPlotTop + gainPlotH);
            ctx.moveTo(x, phasePlotTop);
            ctx.lineTo(x, phasePlotTop + phasePlotH);
            ctx.stroke();

            // 下部周波数ラベル
            ctx.fillText(`${wVal}`, x, phasePlotTop + phasePlotH + 4);
        });

        // ゲイン線図の横グリッド (-40, -20, 0, +20 dB)
        const gainTicks = [-40, -20, 0, 20];
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        gainTicks.forEach(gVal => {
            const y = this.gainToY(gVal, gainPlotTop, gainPlotH);
            ctx.strokeStyle = gVal === 0 ? ((loopType === 'closed' || isNormalized) ? 'rgba(16, 185, 129, 0.65)' : this.colors.zeroLine) : this.colors.grid;
            ctx.lineWidth = gVal === 0 ? 1.5 : 1;
            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(w - padRight, y);
            ctx.stroke();

            ctx.fillStyle = gVal === 0 ? '#f8fafc' : this.colors.text;
            ctx.fillText(`${gVal > 0 ? '+' : ''}${gVal}dB`, padLeft - 6, y);
        });

        // 位相線図の横グリッド (0°, -45°, -90°, -135°, -180°)
        const phaseTicks = [0, -45, -90, -135, -180];
        phaseTicks.forEach(pVal => {
            const y = this.phaseToY(pVal, phasePlotTop, phasePlotH);
            ctx.strokeStyle = (pVal === -90 || pVal === -180) ? this.colors.zeroLine : this.colors.grid;
            ctx.lineWidth = (pVal === -90 || pVal === -180) ? 1.5 : 1;
            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(w - padRight, y);
            ctx.stroke();

            ctx.fillStyle = (pVal === -90 || pVal === -180) ? '#f8fafc' : this.colors.text;
            ctx.fillText(`${pVal}°`, padLeft - 6, y);
        });

        // 枠線
        ctx.strokeStyle = this.colors.axis;
        ctx.lineWidth = 1;
        ctx.strokeRect(padLeft, gainPlotTop, plotW, gainPlotH);
        ctx.strokeRect(padLeft, phasePlotTop, plotW, phasePlotH);

        // 軸名ラベル
        ctx.fillStyle = this.colors.text;
        ctx.textAlign = 'right';
        ctx.fillText('ω [rad/s]', w - padRight, phasePlotTop + phasePlotH + 5);
    }

    drawTheoreticalCurves(systemType, physics, loopType, pid, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH, offsetDb = 0.0) {
        // 対数等間隔に120点サンプリングして理論曲線を生成
        const N = 120;
        const omegaRange = [];
        const logMin = Math.log10(this.minOmega);
        const logMax = Math.log10(this.maxOmega);
        for (let i = 0; i < N; i++) {
            const w = Math.pow(10, logMin + (i / (N - 1)) * (logMax - logMin));
            omegaRange.push(w);
        }

        const theoretical = BodeAnalyzer.computeTheoreticalBode(systemType, physics, omegaRange, loopType, pid);
        if (theoretical.length < 2) return;

        const ctx = this.ctx;
        ctx.save();
        ctx.strokeStyle = this.colors.theory;
        ctx.lineWidth = 1.9;
        ctx.setLineDash([4, 3]);

        // 理論ゲイン線図
        ctx.beginPath();
        for (let i = 0; i < theoretical.length; i++) {
            const pt = theoretical[i];
            const x = this.omegaToX(pt.omega, padLeft, plotW);
            const y = this.gainToY(pt.gainDb + offsetDb, gainPlotTop, gainPlotH);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 理論位相線図
        ctx.beginPath();
        for (let i = 0; i < theoretical.length; i++) {
            const pt = theoretical[i];
            const x = this.omegaToX(pt.omega, padLeft, plotW);
            const y = this.phaseToY(pt.phaseDeg, phasePlotTop, phasePlotH);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.restore();
    }

    drawMeasuredPlots(measurements, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH, offsetDb = 0.0) {
        if (!measurements || measurements.length === 0) return;

        const ctx = this.ctx;
        ctx.save();

        // 実測ゲインの折れ線
        ctx.strokeStyle = this.colors.measured;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        for (let i = 0; i < measurements.length; i++) {
            const pt = measurements[i];
            const x = this.omegaToX(pt.omega, padLeft, plotW);
            const y = this.gainToY(pt.gainDb + offsetDb, gainPlotTop, gainPlotH);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 実測位相の折れ線
        ctx.beginPath();
        for (let i = 0; i < measurements.length; i++) {
            const pt = measurements[i];
            const x = this.omegaToX(pt.omega, padLeft, plotW);
            const y = this.phaseToY(pt.phaseDeg, phasePlotTop, phasePlotH);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 実測データ点マーカー
        measurements.forEach(pt => {
            const x = this.omegaToX(pt.omega, padLeft, plotW);
            const yGain = this.gainToY(pt.gainDb + offsetDb, gainPlotTop, gainPlotH);
            const yPhase = this.phaseToY(pt.phaseDeg, phasePlotTop, phasePlotH);

            // ゲイン点
            ctx.fillStyle = this.colors.point;
            ctx.shadowColor = this.colors.pointGlow;
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.arc(x, yGain, 3.5, 0, Math.PI * 2);
            ctx.fill();

            // 位相点
            ctx.beginPath();
            ctx.arc(x, yPhase, 3.5, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.restore();
    }

    drawCurrentCursor(analyzer, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH, offsetDb = 0.0) {
        const ctx = this.ctx;
        const curOmega = analyzer.omega;
        const x = this.omegaToX(curOmega, padLeft, plotW);

        ctx.save();

        // 縦のカーソル破線
        ctx.strokeStyle = this.colors.cursor;
        ctx.lineWidth = 1.3;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, gainPlotTop);
        ctx.lineTo(x, gainPlotTop + gainPlotH);
        ctx.moveTo(x, phasePlotTop);
        ctx.lineTo(x, phasePlotTop + phasePlotH);
        ctx.stroke();
        ctx.setLineDash([]);

        // 現在の推定ゲイン・位相マーカー（光るリング）
        if (analyzer.currentAmpOut > 0.001) {
            const curYGain = this.gainToY(analyzer.currentGainDb + offsetDb, gainPlotTop, gainPlotH);
            const curYPhase = this.phaseToY(analyzer.currentPhaseDeg, phasePlotTop, phasePlotH);

            ctx.strokeStyle = this.colors.cursor;
            ctx.fillStyle = this.colors.cursorDot;
            ctx.lineWidth = 2;
            ctx.shadowColor = '#eab308';
            ctx.shadowBlur = 8;

            // ゲインマーカー
            ctx.beginPath();
            ctx.arc(x, curYGain, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // 位相マーカー
            ctx.beginPath();
            ctx.arc(x, curYPhase, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();
    }

    drawLegend(analyzer, padLeft, gainPlotTop, phasePlotTop, isNormalized = false) {
        const ctx = this.ctx;
        ctx.font = '10px sans-serif';
        ctx.textBaseline = 'top';

        // ゲイン線図タイトル
        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'left';
        const gainTitle = isNormalized ? 'ゲイン線図 [dB] (DC正規化)' : 'ゲイン線図 [dB]';
        ctx.fillText(gainTitle, padLeft + 6, gainPlotTop + 5);

        // 凡例
        const legendOffsetX = isNormalized ? 154 : 94;
        ctx.fillStyle = 'rgba(56, 189, 248, 0.85)';
        ctx.fillText('-- 理論', padLeft + legendOffsetX, gainPlotTop + 5);

        ctx.fillStyle = '#34d399';
        ctx.fillText('―● 実測', padLeft + legendOffsetX + 46, gainPlotTop + 5);

        // 位相線図タイトル
        ctx.fillStyle = '#f8fafc';
        ctx.fillText('位相線図 [deg]', padLeft + 6, phasePlotTop + 5);

        // 操作ヒント（スイープ中でなければ右上に控えめ表示）
        if (analyzer.isSweeping) {
            const isSettling = analyzer.sweepState === 'settling';
            ctx.fillStyle = isSettling ? '#eab308' : '#10b981';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'right';
            const progress = `[${analyzer.sweepIndex + 1}/${analyzer.sweepFrequencies.length}]`;
            const statusText = isSettling ? `⏳ 過渡待ち... ${progress}` : `📡 測定積算... ${progress}`;
            ctx.fillText(statusText, this.width - 22, gainPlotTop + 5);
        } else {
            ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('👆 グラフ押下で周波数変更', this.width - 22, gainPlotTop + 5);
        }
    }
}
