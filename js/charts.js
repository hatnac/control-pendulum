/**
 * charts.js - 制御工学学習用グラフ（時系列応答＆相平面）
 * （振子モータ制御系 & マス・バネ・ダンパー系 両対応）
 */

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

        // 現在のシステムモード ('pendulum' | 'msd')
        this.systemMode = 'pendulum';

        // データ履歴バッファ
        this.maxHistory = 400; // 約6〜8秒分のデータ
        this.history = [];

        // 相平面の軌跡履歴
        this.maxPhaseHistory = 300;
        this.phaseHistory = [];

        this.colors = {
            bg: '#0f172a',
            grid: '#1e293b',
            axis: '#334155',
            text: '#94a3b8',
            signal: '#38bdf8',     // 現在値（角度 θ / 変位 x）
            target: '#eab308',     // 目標値（θ_ref / x_ref: イエロー破線）
            control: '#10b981',    // 制御入力（トルク τ / 外力 F: エメラルド）
            velocity: '#c084fc',   // 速度（角速度 ω / 速度 v: パープル）
            phaseDot: '#38bdf8',
            phaseLine: 'rgba(56, 189, 248, 0.4)'
        };

        this.resize();

        // スマホ画面や動的レイアウト変更に対応するResizeObserver
        if (window.ResizeObserver) {
            this.resizeObserver = new ResizeObserver(() => {
                this.resize();
            });
            if (this.timeCanvas) this.resizeObserver.observe(this.timeCanvas);
            if (this.phaseCanvas) this.resizeObserver.observe(this.phaseCanvas);
        }
    }

    setSystemMode(mode) {
        if (this.systemMode !== mode) {
            this.systemMode = mode;
            this.clear();
        }
    }

    resize() {
        if (this.timeCanvas) {
            let rect = this.timeCanvas.getBoundingClientRect();
            let w = rect.width;
            let h = rect.height;

            if (w <= 0 || h <= 0) {
                const parent = this.timeCanvas.parentElement;
                if (parent) {
                    const pRect = parent.getBoundingClientRect();
                    w = pRect.width || w;
                    h = pRect.height || h;
                }
            }
            if (w <= 0) w = 320;
            if (h <= 0) h = 200;

            this.tWidth = w;
            this.tHeight = h;
            this.timeCanvas.width = w * this.dpr;
            this.timeCanvas.height = h * this.dpr;
            this.tCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        }

        if (this.phaseCanvas) {
            let rect = this.phaseCanvas.getBoundingClientRect();
            let w = rect.width;
            let h = rect.height;

            if (w <= 0 || h <= 0) {
                const parent = this.phaseCanvas.parentElement;
                if (parent) {
                    const pRect = parent.getBoundingClientRect();
                    w = pRect.width || w;
                    h = pRect.height || h;
                }
            }
            if (w <= 0) w = 320;
            if (h <= 0) h = 200;

            this.pWidth = w;
            this.pHeight = h;
            this.phaseCanvas.width = w * this.dpr;
            this.phaseCanvas.height = h * this.dpr;
            this.pCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        }
    }

    /**
     * 新しいサンプル点を記録
     * @param {object} physics 
     */
    addSample(physics) {
        if (this.systemMode === 'pendulum') {
            const item = {
                t: physics.time,
                val: physics.normalizedThetaDeg,
                target: physics.targetAngleDeg,
                vel: physics.omega,
                input: physics.tau,
                inputMax: physics.tauMax
            };

            this.history.push(item);
            if (this.history.length > this.maxHistory) this.history.shift();

            this.phaseHistory.push({
                xVal: physics.normalizedThetaDeg,
                yVal: physics.omega
            });
            if (this.phaseHistory.length > this.maxPhaseHistory) this.phaseHistory.shift();
        } else {
            // マス・バネ・ダンパー系
            const item = {
                t: physics.time,
                val: physics.x,
                target: physics.targetX,
                vel: physics.v,
                input: physics.f,
                inputMax: physics.fMax
            };

            this.history.push(item);
            if (this.history.length > this.maxHistory) this.history.shift();

            this.phaseHistory.push({
                xVal: physics.x,
                yVal: physics.v
            });
            if (this.phaseHistory.length > this.maxPhaseHistory) this.phaseHistory.shift();
        }
    }

    clear() {
        this.history = [];
        this.phaseHistory = [];
    }

    /**
     * 両グラフを更新描画
     * @param {object} physics 
     */
    render(physics) {
        this.renderTimeHistory(physics);
        this.renderPhasePlane(physics);
    }

    /**
     * 時系列応答グラフ
     */
    renderTimeHistory(physics) {
        if (!this.tWidth || this.tWidth < 20 || !this.tHeight || this.tHeight < 20) {
            this.resize();
        }

        const ctx = this.tCtx;
        const w = this.tWidth || 320;
        const h = this.tHeight || 200;

        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, w, h);

        const isPendulum = this.systemMode === 'pendulum';
        const padLeft = isPendulum ? 42 : 46;
        const padRight = 15;
        const padTop = 22;
        const padBottom = 22;
        const plotW = w - padLeft - padRight;
        const plotH = h - padTop - padBottom;

        // グリッド線と目盛りの設定
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 1;
        ctx.fillStyle = this.colors.text;
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        let zeroY;

        if (isPendulum) {
            // 振子: -180° 〜 +180°
            const degTicks = [-180, -90, 0, 90, 180];
            degTicks.forEach(deg => {
                const y = padTop + plotH * (1.0 - (deg + 180) / 360);
                ctx.beginPath();
                ctx.moveTo(padLeft, y);
                ctx.lineTo(w - padRight, y);
                ctx.stroke();
                ctx.fillText(`${deg}°`, padLeft - 6, y);
            });
            zeroY = padTop + plotH * 0.5;
        } else {
            // MSD: -1.0m 〜 +1.0m
            const minX = -1.0;
            const maxX = 1.0;
            const mTicks = [-1.0, -0.5, 0.0, 0.5, 1.0];
            mTicks.forEach(tVal => {
                const norm = (tVal - minX) / (maxX - minX);
                const y = padTop + plotH * (1.0 - norm);
                ctx.beginPath();
                ctx.moveTo(padLeft, y);
                ctx.lineTo(w - padRight, y);
                ctx.stroke();
                const sign = tVal > 0 ? '+' : '';
                ctx.fillText(`${sign}${tVal.toFixed(1)}m`, padLeft - 6, y);
            });
            zeroY = padTop + plotH * 0.5;
        }

        // ゼロ軸の強調
        ctx.strokeStyle = this.colors.axis;
        ctx.beginPath();
        ctx.moveTo(padLeft, zeroY);
        ctx.lineTo(w - padRight, zeroY);
        ctx.stroke();

        // 凡例
        ctx.textAlign = 'left';
        ctx.fillStyle = this.colors.signal;
        ctx.fillText(isPendulum ? '― 角度 θ' : '― 変位 x', padLeft + 6, padTop - 8);
        ctx.fillStyle = this.colors.target;
        ctx.fillText(isPendulum ? '--- 目標 θ_ref' : '--- 目標 x_ref', padLeft + (isPendulum ? 72 : 76), padTop - 8);
        ctx.fillStyle = this.colors.control;
        ctx.fillText(isPendulum ? '― トルク τ' : '― 入力外力 F', padLeft + (isPendulum ? 160 : 166), padTop - 8);

        if (this.history.length < 2) return;

        // 1. 目標値の破線プロット
        ctx.save();
        ctx.strokeStyle = this.colors.target;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        for (let i = 0; i < this.history.length; i++) {
            const p = this.history[i];
            const x = padLeft + (i / (this.maxHistory - 1)) * plotW;
            let y;
            if (isPendulum) {
                y = padTop + plotH * (1.0 - (p.target + 180) / 360);
            } else {
                const norm = (p.target - (-1.0)) / 2.0;
                y = padTop + plotH * (1.0 - Math.max(0, Math.min(1, norm)));
            }
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        // 2. 制御入力（トルク τ / 外力 F）プロット（ゼロ軸中心にスケーリング）
        ctx.save();
        ctx.strokeStyle = this.colors.control;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < this.history.length; i++) {
            const p = this.history[i];
            const x = padLeft + (i / (this.maxHistory - 1)) * plotW;
            const inMax = Math.max(0.1, p.inputMax || 10.0);
            const inNorm = p.input / inMax;
            const y = zeroY - inNorm * (plotH * 0.35);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        // 3. 状態量（角度 θ / 変位 x）プロット
        ctx.save();
        ctx.strokeStyle = this.colors.signal;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let prevVal = null;
        for (let i = 0; i < this.history.length; i++) {
            const p = this.history[i];
            const x = padLeft + (i / (this.maxHistory - 1)) * plotW;
            let y;
            if (isPendulum) {
                y = padTop + plotH * (1.0 - (p.val + 180) / 360);
                // 180°と-180°の境界ジャンプ時は線を途切らせる
                if (prevVal !== null && Math.abs(p.val - prevVal) > 180) {
                    ctx.moveTo(x, y);
                } else if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                prevVal = p.val;
            } else {
                const norm = (p.val - (-1.0)) / 2.0;
                y = padTop + plotH * (1.0 - Math.max(0, Math.min(1, norm)));
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        ctx.restore();
    }

    /**
     * 相平面プロット (Phase Plane)
     */
    renderPhasePlane(physics) {
        if (!this.pWidth || this.pWidth < 20 || !this.pHeight || this.pHeight < 20) {
            this.resize();
        }

        const ctx = this.pCtx;
        const w = this.pWidth || 320;
        const h = this.pHeight || 200;

        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, w, h);

        const isPendulum = this.systemMode === 'pendulum';
        const cx = w * 0.5;
        const cy = h * 0.5;
        const plotRadiusX = w * 0.42;
        const plotRadiusY = h * 0.40;

        // グリッドと軸
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
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

        if (isPendulum) {
            ctx.fillText('角度 θ ([-180°, 180°])', cx, cy + plotRadiusY + 4);
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText('角速度 ω [rad/s]', cx - plotRadiusX - 4, cy);
        } else {
            ctx.fillText('変位 x ([-1.0m, 1.0m])', cx, cy + plotRadiusY + 4);
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText('速度 v [m/s]', cx - plotRadiusX - 4, cy);
        }

        // 速度の表示スケーリングレンジ
        let maxVel;
        if (isPendulum) {
            maxVel = Math.max(10, Math.abs(physics.omega) * 1.2);
        } else {
            maxVel = Math.max(2.5, Math.abs(physics.v) * 1.3);
        }

        // 目標点のマーカー（目標位置, 速度=0）
        let targetXCoord;
        if (isPendulum) {
            targetXCoord = cx + (physics.targetAngleDeg / 180.0) * plotRadiusX;
        } else {
            targetXCoord = cx + (physics.targetX / 1.0) * plotRadiusX;
        }

        ctx.fillStyle = this.colors.target;
        ctx.beginPath();
        ctx.arc(targetXCoord, cy, 4, 0, Math.PI * 2);
        ctx.fill();

        if (this.phaseHistory.length < 2) return;

        // 軌跡プロット
        ctx.save();
        ctx.strokeStyle = this.colors.phaseLine;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let prevXVal = null;

        for (let i = 0; i < this.phaseHistory.length; i++) {
            const p = this.phaseHistory[i];
            let px;
            if (isPendulum) {
                px = cx + (p.xVal / 180.0) * plotRadiusX;
            } else {
                px = cx + (p.xVal / 1.0) * plotRadiusX;
            }
            const py = cy - (p.yVal / maxVel) * plotRadiusY;

            if (isPendulum && prevXVal !== null && Math.abs(p.xVal - prevXVal) > 180) {
                ctx.moveTo(px, py);
            } else if (i === 0) {
                ctx.moveTo(px, py);
            } else {
                ctx.lineTo(px, py);
            }
            prevXVal = p.xVal;
        }
        ctx.stroke();

        // 最新の現在点
        const currentP = this.phaseHistory[this.phaseHistory.length - 1];
        let curX;
        if (isPendulum) {
            curX = cx + (currentP.xVal / 180.0) * plotRadiusX;
        } else {
            curX = cx + (currentP.xVal / 1.0) * plotRadiusX;
        }
        const curY = cy - (currentP.yVal / maxVel) * plotRadiusY;

        ctx.fillStyle = this.colors.phaseDot;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(curX, curY, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}
