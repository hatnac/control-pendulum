/**
 * bode-renderer.js - ボード線図（ゲイン線図＆位相線図）のCanvas描画
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

        // 周波数レンジ（対数）
        this.minOmega = 0.2;
        this.maxOmega = 30.0;

        // ゲインレンジ [dB]
        this.minGainDb = -45.0;
        this.maxGainDb = 25.0;

        // 位相レンジ [deg]
        this.minPhaseDeg = -195.0;
        this.maxPhaseDeg = 15.0;

        this.colors = {
            bg: '#0f172a',
            grid: '#1e293b',
            subGrid: 'rgba(30, 41, 59, 0.5)',
            axis: '#334155',
            zeroLine: 'rgba(148, 163, 184, 0.4)',
            text: '#94a3b8',
            theory: 'rgba(56, 189, 248, 0.45)',  // 理論曲線（薄いシアン破線）
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
     */
    draw(analyzer, systemType, physics) {
        if (!this.width || this.width < 20 || !this.height || this.height < 20) {
            this.resize();
        }

        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, w, h);

        const padLeft = 44;
        const padRight = 18;
        const padTop = 18;
        const padBottom = 22;
        const gap = 18; // ゲイン線図と位相線図の間の隙間

        const totalPlotH = h - padTop - padBottom - gap;
        const gainPlotH = Math.floor(totalPlotH * 0.52);
        const phasePlotH = totalPlotH - gainPlotH;

        const plotW = w - padLeft - padRight;
        const gainPlotTop = padTop;
        const phasePlotTop = padTop + gainPlotH + gap;

        // 1. グリッドと目盛り
        this.drawGridsAndAxes(plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH, padLeft, padRight);

        // 2. 理論曲線の描画（高解像度サンプル）
        this.drawTheoreticalCurves(systemType, physics, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH);

        // 3. 実測プロット点の描画
        this.drawMeasuredPlots(analyzer.measurements, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH);

        // 4. 現在入力中の周波数カーソル＆リアルタイム点
        this.drawCurrentCursor(analyzer, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH);

        // 5. 凡例＆HUD
        this.drawLegend(analyzer, padLeft, gainPlotTop, phasePlotTop);
    }

    drawGridsAndAxes(plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH, padLeft, padRight) {
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
            ctx.strokeStyle = gVal === 0 ? this.colors.zeroLine : this.colors.grid;
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

    drawTheoreticalCurves(systemType, physics, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH) {
        // 対数等間隔に120点サンプリングして理論曲線を生成
        const N = 120;
        const omegaRange = [];
        const logMin = Math.log10(this.minOmega);
        const logMax = Math.log10(this.maxOmega);
        for (let i = 0; i < N; i++) {
            const w = Math.pow(10, logMin + (i / (N - 1)) * (logMax - logMin));
            omegaRange.push(w);
        }

        const theoretical = BodeAnalyzer.computeTheoreticalBode(systemType, physics, omegaRange);
        if (theoretical.length < 2) return;

        const ctx = this.ctx;
        ctx.save();
        ctx.strokeStyle = this.colors.theory;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([4, 3]);

        // 理論ゲイン線図
        ctx.beginPath();
        for (let i = 0; i < theoretical.length; i++) {
            const pt = theoretical[i];
            const x = this.omegaToX(pt.omega, padLeft, plotW);
            const y = this.gainToY(pt.gainDb, gainPlotTop, gainPlotH);
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

    drawMeasuredPlots(measurements, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH) {
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
            const y = this.gainToY(pt.gainDb, gainPlotTop, gainPlotH);
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
            const yGain = this.gainToY(pt.gainDb, gainPlotTop, gainPlotH);
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

    drawCurrentCursor(analyzer, padLeft, plotW, gainPlotTop, gainPlotH, phasePlotTop, phasePlotH) {
        const ctx = this.ctx;
        const curOmega = analyzer.omega;
        const x = this.omegaToX(curOmega, padLeft, plotW);

        ctx.save();

        // 縦のカーソル破線
        ctx.strokeStyle = this.colors.cursor;
        ctx.lineWidth = 1.2;
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
            const curYGain = this.gainToY(analyzer.currentGainDb, gainPlotTop, gainPlotH);
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

    drawLegend(analyzer, padLeft, gainPlotTop, phasePlotTop) {
        const ctx = this.ctx;
        ctx.font = '10px sans-serif';
        ctx.textBaseline = 'top';

        // ゲイン線図タイトル
        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'left';
        ctx.fillText('ゲイン線図 [dB]', padLeft + 6, gainPlotTop + 5);

        // 凡例
        ctx.fillStyle = 'rgba(56, 189, 248, 0.8)';
        ctx.fillText('-- 理論曲線', padLeft + 110, gainPlotTop + 5);

        ctx.fillStyle = '#34d399';
        ctx.fillText('―● 実測プロット', padLeft + 185, gainPlotTop + 5);

        // 位相線図タイトル
        ctx.fillStyle = '#f8fafc';
        ctx.fillText('位相線図 [deg]', padLeft + 6, phasePlotTop + 5);

        // スイープ状態のHUDバッジ
        if (analyzer.isSweeping) {
            const isSettling = analyzer.sweepState === 'settling';
            ctx.fillStyle = isSettling ? '#eab308' : '#10b981';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'right';
            const progress = `[${analyzer.sweepIndex + 1}/${analyzer.sweepFrequencies.length}]`;
            const statusText = isSettling ? `⏳ 過渡待ち中... ${progress}` : `📡 測定積算中... ${progress}`;
            ctx.fillText(statusText, this.width - 24, gainPlotTop + 5);
        }
    }
}
