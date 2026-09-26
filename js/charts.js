/**
 * charts.js - 制御工学学習用グラフ（時系列応答＆相平面）
 */

import { PendulumPhysics } from './physics.js';

export class ControlCharts {
    /**
     * @param {HTMLCanvasElement} timeCanvas 
     * @param {HTMLCanvasElement} phaseCanvas 
     */
    constructor(timeCanvas, phaseCanvas) {
        this.timeCanvas = timeCanvas;
        this.phaseCanvas = phaseCanvas;

        this.tCtx = timeCanvas.getContext('2d');
        this.pCtx = phaseCanvas.getContext('2d');

        this.dpr = window.devicePixelRatio || 1;

        // データ履歴バッファ
        this.maxHistory = 400; // 約6〜8秒分のデータ
        this.history = [];     // { t, thetaDeg, targetDeg, omega, tau }

        // 相平面の軌跡履歴
        this.maxPhaseHistory = 300;
        this.phaseHistory = []; // { thetaDeg, omega }

        this.colors = {
            bg: '#0f172a',
            grid: '#1e293b',
            axis: '#334155',
            text: '#94a3b8',
            theta: '#38bdf8',      // 現在角度（シアン）
            target: '#eab308',     // 目標角度（イエロー破線）
            torque: '#10b981',     // トルク（エメラルド）
            omega: '#c084fc',      // 角速度（パープル）
            phaseDot: '#38bdf8',
            phaseLine: 'rgba(56, 189, 248, 0.4)'
        };

        this.resize();
    }

    resize() {
        if (this.timeCanvas) {
            const rect = this.timeCanvas.getBoundingClientRect();
            this.tWidth = rect.width;
            this.tHeight = rect.height;
            this.timeCanvas.width = this.tWidth * this.dpr;
            this.timeCanvas.height = this.tHeight * this.dpr;
            this.tCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        }

        if (this.phaseCanvas) {
            const rect = this.phaseCanvas.getBoundingClientRect();
            this.pWidth = rect.width;
            this.pHeight = rect.height;
            this.phaseCanvas.width = this.pWidth * this.dpr;
            this.phaseCanvas.height = this.pHeight * this.dpr;
            this.pCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        }
    }

    /**
     * 新しいサンプル点を記録
     * @param {PendulumPhysics} physics 
     */
    addSample(physics) {
        const item = {
            t: physics.time,
            thetaDeg: physics.normalizedThetaDeg,
            targetDeg: physics.targetAngleDeg,
            omega: physics.omega,
            tau: physics.tau
        };

        this.history.push(item);
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }

        this.phaseHistory.push({
            thetaDeg: physics.normalizedThetaDeg,
            omega: physics.omega
        });
        if (this.phaseHistory.length > this.maxPhaseHistory) {
            this.phaseHistory.shift();
        }
    }

    clear() {
        this.history = [];
        this.phaseHistory = [];
    }

    /**
     * 両グラフを更新描画
     * @param {PendulumPhysics} physics 
     */
    render(physics) {
        this.renderTimeHistory(physics);
        this.renderPhasePlane(physics);
    }

    /**
     * 時系列応答グラフ（角度＆目標角度＆トルク）
     */
    renderTimeHistory(physics) {
        const ctx = this.tCtx;
        const w = this.tWidth;
        const h = this.tHeight;

        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, w, h);

        const padLeft = 40;
        const padRight = 15;
        const padTop = 20;
        const padBottom = 25;
        const plotW = w - padLeft - padRight;
        const plotH = h - padTop - padBottom;

        // グリッド（-180°, -90°, 0°, 90°, 180°）
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 1;
        ctx.fillStyle = this.colors.text;
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        const degTicks = [-180, -90, 0, 90, 180];
        degTicks.forEach(deg => {
            const y = padTop + plotH * (1.0 - (deg + 180) / 360);
            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(w - padRight, y);
            ctx.stroke();
            ctx.fillText(`${deg}°`, padLeft - 6, y);
        });

        // ゼロ軸の強調
        const zeroY = padTop + plotH * 0.5;
        ctx.strokeStyle = this.colors.axis;
        ctx.beginPath();
        ctx.moveTo(padLeft, zeroY);
        ctx.lineTo(w - padRight, zeroY);
        ctx.stroke();

        // 凡例
        ctx.textAlign = 'left';
        ctx.fillStyle = this.colors.theta;
        ctx.fillText('― 角度 θ', padLeft + 10, padTop - 8);
        ctx.fillStyle = this.colors.target;
        ctx.fillText('--- 目標 θ_ref', padLeft + 75, padTop - 8);
        ctx.fillStyle = this.colors.torque;
        ctx.fillText('― トルク τ', padLeft + 160, padTop - 8);

        if (this.history.length < 2) return;

        // 目標値の破線プロット
        ctx.save();
        ctx.strokeStyle = this.colors.target;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        for (let i = 0; i < this.history.length; i++) {
            const p = this.history[i];
            const x = padLeft + (i / (this.maxHistory - 1)) * plotW;
            const y = padTop + plotH * (1.0 - (p.targetDeg + 180) / 360);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        // トルクプロット（スケール: ±tauMax を画面下半分にフィット）
        ctx.save();
        ctx.strokeStyle = this.colors.torque;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < this.history.length; i++) {
            const p = this.history[i];
            const x = padLeft + (i / (this.maxHistory - 1)) * plotW;
            // トルクは zeroY を中心に ±plotH*0.4 の範囲で描画
            const tNorm = p.tau / Math.max(0.1, physics.tauMax);
            const y = zeroY - tNorm * (plotH * 0.35);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        // 角度 θ プロット
        ctx.save();
        ctx.strokeStyle = this.colors.theta;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let prevNorm = null;
        for (let i = 0; i < this.history.length; i++) {
            const p = this.history[i];
            const x = padLeft + (i / (this.maxHistory - 1)) * plotW;
            const y = padTop + plotH * (1.0 - (p.thetaDeg + 180) / 360);

            // 180°と-180°の境界ジャンプ時は線を途切らせる
            if (prevNorm !== null && Math.abs(p.thetaDeg - prevNorm) > 180) {
                ctx.moveTo(x, y);
            } else if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            prevNorm = p.thetaDeg;
        }
        ctx.stroke();
        ctx.restore();
    }

    /**
     * 相平面（Phase Plane: θ vs dθ/dt）プロット
     */
    renderPhasePlane(physics) {
        const ctx = this.pCtx;
        const w = this.pWidth;
        const h = this.pHeight;

        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, w, h);

        const cx = w * 0.5;
        const cy = h * 0.5;
        const plotRadiusX = w * 0.42;
        const plotRadiusY = h * 0.40;

        // グリッドと軸
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        // 縦横の十字軸
        ctx.moveTo(cx - plotRadiusX, cy); ctx.lineTo(cx + plotRadiusX, cy);
        ctx.moveTo(cx, cy - plotRadiusY); ctx.lineTo(cx, cy + plotRadiusY);
        ctx.stroke();

        ctx.strokeStyle = this.colors.axis;
        ctx.strokeRect(cx - plotRadiusX, cy - plotRadiusY, plotRadiusX * 2, plotRadiusY * 2);

        // ラベル
        ctx.fillStyle = this.colors.text;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('角度 θ ([-180°, 180°])', cx, cy + plotRadiusY + 4);

        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('角速度 ω [rad/s]', cx - plotRadiusX - 4, cy);

        // 角速度の表示レンジ（動的または固定）
        const maxOmega = Math.max(10, Math.abs(physics.omega) * 1.2);

        // 目標点のマーカー（目標角度, ω=0）
        const targetX = cx + (physics.targetAngleDeg / 180.0) * plotRadiusX;
        ctx.fillStyle = this.colors.target;
        ctx.beginPath();
        ctx.arc(targetX, cy, 4, 0, Math.PI * 2);
        ctx.fill();

        if (this.phaseHistory.length < 2) return;

        // 軌跡プロット
        ctx.save();
        ctx.strokeStyle = this.colors.phaseLine;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let prevDeg = null;

        for (let i = 0; i < this.phaseHistory.length; i++) {
            const p = this.phaseHistory[i];
            const px = cx + (p.thetaDeg / 180.0) * plotRadiusX;
            const py = cy - (p.omega / maxOmega) * plotRadiusY;

            if (prevDeg !== null && Math.abs(p.thetaDeg - prevDeg) > 180) {
                ctx.moveTo(px, py);
            } else if (i === 0) {
                ctx.moveTo(px, py);
            } else {
                ctx.lineTo(px, py);
            }
            prevDeg = p.thetaDeg;
        }
        ctx.stroke();

        // 最新の現在点
        const currentP = this.phaseHistory[this.phaseHistory.length - 1];
        const curX = cx + (currentP.thetaDeg / 180.0) * plotRadiusX;
        const curY = cy - (currentP.omega / maxOmega) * plotRadiusY;

        ctx.fillStyle = this.colors.phaseDot;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(curX, curY, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}
