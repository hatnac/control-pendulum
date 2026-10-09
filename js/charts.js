/**
 * charts.js - 制御工学学習用グラフ（時系列応答＆相平面）
 * （振子モータ制御系 & マス・バネ・ダンパー系 & 正弦波周波数応答 両対応）
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
        this.pCtx = phaseCanvas ? phaseCanvas.getContext('2d') : null;

        this.dpr = window.devicePixelRatio || 1;

        // 現在のシステムモード ('pendulum' | 'msd')
        this.systemMode = 'pendulum';
        this.isBodeMode = false;
        this.isTransientMode = false;

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
            phaseLine: 'rgba(56, 189, 248, 0.4)',
            peakLine: 'rgba(234, 179, 8, 0.4)',
            dtArrow: '#f59e0b',
            settleBand: 'rgba(234, 179, 8, 0.08)',
            settleBorder: 'rgba(234, 179, 8, 0.25)',
            impulseMarker: '#f43f5e'
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

    setBodeMode(isBode) {
        this.isBodeMode = isBode;
    }

    setTransientMode(isTransient) {
        this.isTransientMode = isTransient;
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
            if (this.pCtx) this.pCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
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
     * @param {object} bodeAnalyzer (任意: 正弦波周波数応答用)
     * @param {object} transientManager (任意: 過渡応答用)
     */
    render(physics, bodeAnalyzer = null, transientManager = null) {
        this.renderTimeHistory(physics, bodeAnalyzer, transientManager);
        if (this.phaseCanvas && this.phaseCanvas.style.display !== 'none') {
            this.renderPhasePlane(physics);
        }
    }

    /**
     * 時系列応答グラフ
     */
    renderTimeHistory(physics, bodeAnalyzer = null, transientManager = null) {
        if (!this.tWidth || this.tWidth < 20 || !this.tHeight || this.tHeight < 20) {
            this.resize();
        }

        const ctx = this.tCtx;
        const w = this.tWidth || 320;
        const h = this.tHeight || 200;

        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, w, h);

        const isPendulum = this.systemMode === 'pendulum';
        const isBode = this.isBodeMode && bodeAnalyzer !== null;
        const isTransient = this.isTransientMode && transientManager !== null;

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

        // 凡例表示
        ctx.textAlign = 'left';
        if (isBode) {
            // 正弦波モードの凡例
            ctx.fillStyle = this.colors.signal;
            ctx.fillText(isPendulum ? '― 出力 θ(t)' : '― 出力 x(t)', padLeft + 6, padTop - 8);

            ctx.fillStyle = this.colors.control;
            ctx.fillText('--- 正弦波入力 u(t)', padLeft + 80, padTop - 8);

            if (bodeAnalyzer.currentAmpOut > 0.001) {
                ctx.fillStyle = '#eab308';
                ctx.fillText(`|G|=${bodeAnalyzer.currentGainDb.toFixed(1)}dB  φ=${bodeAnalyzer.currentPhaseDeg.toFixed(0)}°`, padLeft + 185, padTop - 8);
            }
        } else if (isTransient) {
            // 過渡応答モードの凡例
            ctx.fillStyle = this.colors.signal;
            ctx.fillText(isPendulum ? '― 応答 θ(t)' : '― 応答 x(t)', padLeft + 6, padTop - 8);

            if (transientManager.responseType === 'impulse') {
                ctx.fillStyle = this.colors.impulseMarker;
                ctx.fillText('⚡ インパルス撃力', padLeft + 85, padTop - 8);
            } else {
                ctx.fillStyle = this.colors.target;
                ctx.fillText('--- 目標/定常値', padLeft + 85, padTop - 8);
                ctx.fillStyle = this.colors.control;
                ctx.fillText('― 入力', padLeft + 175, padTop - 8);
            }
        } else {
            // 通常モードの凡例
            ctx.fillStyle = this.colors.signal;
            ctx.fillText(isPendulum ? '― 角度 θ' : '― 変位 x', padLeft + 6, padTop - 8);
            ctx.fillStyle = this.colors.target;
            ctx.fillText(isPendulum ? '--- 目標 θ_ref' : '--- 目標 x_ref', padLeft + (isPendulum ? 72 : 76), padTop - 8);
            ctx.fillStyle = this.colors.control;
            ctx.fillText(isPendulum ? '― トルク τ' : '― 入力外力 F', padLeft + (isPendulum ? 160 : 166), padTop - 8);
        }

        if (this.history.length < 2) return;

        // 1. 目標値の破線プロット (通常モードおよび過渡ステップ時)
        if (!isBode && (!isTransient || transientManager.responseType !== 'impulse')) {
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
        }

        // 2. 制御入力（トルク τ / 外力 F）プロット（ゼロ軸中心にスケーリング）
        ctx.save();
        ctx.strokeStyle = this.colors.control;
        ctx.lineWidth = isBode ? 1.6 : 1.2;
        if (isBode) ctx.setLineDash([4, 3]);
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

        // 4. 正弦波モード時の振幅ガイド＆位相差アノテーション
        if (isBode && bodeAnalyzer.currentAmpOut > 0.005) {
            this.drawBodeAnnotations(ctx, padLeft, plotW, plotH, zeroY, isPendulum, bodeAnalyzer);
        }

        // 5. 過渡応答モード時のアノテーション
        if (isTransient) {
            this.drawTransientAnnotations(ctx, padLeft, plotW, plotH, zeroY, isPendulum, transientManager);
        }
    }

    /**
     * 過渡応答（インパルス / ステップ）のアノテーションおよびHUD描画
     */
    drawTransientAnnotations(ctx, padLeft, plotW, plotH, zeroY, isPendulum, tm) {
        ctx.save();

        const isImpulse = tm.responseType === 'impulse';
        const targetVal = tm.targetFinal;
        const metrics = tm.metrics;

        // 値 -> Y座標変換ヘルパー
        const valToY = (val) => {
            if (isPendulum) {
                return 22 + plotH * (1.0 - (val + 180) / 360);
            } else {
                const norm = (val - (-1.0)) / 2.0;
                return 22 + plotH * (1.0 - Math.max(0, Math.min(1, norm)));
            }
        };

        if (!isImpulse && Math.abs(targetVal - tm.y0) > 0.005) {
            // ステップ応答のアノテーション
            const yTarget = valToY(targetVal);
            const stepMag = Math.abs(targetVal - tm.y0);
            const bandVal = stepMag * tm.metrics.toleranceBand;
            const yBandTop = valToY(targetVal + (targetVal >= tm.y0 ? bandVal : -bandVal));
            const yBandBottom = valToY(targetVal - (targetVal >= tm.y0 ? bandVal : -bandVal));

            // 1. ±2% 整定許容バンド
            const bTop = Math.min(yBandTop, yBandBottom);
            const bHeight = Math.abs(yBandBottom - yBandTop);
            ctx.fillStyle = this.colors.settleBand;
            ctx.fillRect(padLeft, bTop, plotW, Math.max(2, bHeight));

            ctx.strokeStyle = this.colors.settleBorder;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(padLeft, bTop);
            ctx.lineTo(padLeft + plotW, bTop);
            ctx.moveTo(padLeft, bTop + bHeight);
            ctx.lineTo(padLeft + plotW, bTop + bHeight);
            ctx.stroke();

            // バンドラベル
            ctx.fillStyle = 'rgba(234, 179, 8, 0.5)';
            ctx.font = '9px monospace';
            ctx.textAlign = 'right';
            ctx.fillText('±2%バンド', padLeft + plotW - 4, bTop - 3);

            // 2. 最大オーバーシュート点 (ピーク) のマーカー
            if (metrics.peakVal !== null && metrics.overshootPercent !== null && metrics.overshootPercent > 0.5) {
                const yPeak = valToY(metrics.peakVal);
                ctx.setLineDash([3, 3]);
                ctx.strokeStyle = 'rgba(234, 179, 8, 0.45)';
                ctx.beginPath();
                ctx.moveTo(padLeft, yPeak);
                ctx.lineTo(padLeft + plotW, yPeak);
                ctx.stroke();

                ctx.fillStyle = '#eab308';
                ctx.font = '10px monospace';
                ctx.textAlign = 'left';
                ctx.fillText(`ピーク値: ${metrics.peakVal.toFixed(2)}${isPendulum ? '°' : 'm'} (Mp: +${metrics.overshootPercent.toFixed(1)}%)`, padLeft + 8, yPeak - 4);
            }
        }

        // 3. インパルス応答時: 撃力印加マーカー
        if (isImpulse && tm.lastImpulseTime >= 0) {
            ctx.save();
            ctx.fillStyle = this.colors.impulseMarker;
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('⚡ 撃力印加', padLeft + 40, zeroY - 20);
            ctx.restore();
        }

        // 4. 右上 HUD オーバーレイ (過渡特性サマリー)
        const hudW = 160;
        const hudH = isImpulse ? 48 : 66;
        const hudX = padLeft + plotW - hudW - 6;
        const hudY = 26;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.fillRect(hudX, hudY, hudW, hudH);
        ctx.strokeRect(hudX, hudY, hudW, hudH);

        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(isImpulse ? '【 インパルス過渡特性 】' : '【 ステップ過渡特性 】', hudX + 6, hudY + 12);

        ctx.font = '9px monospace';
        if (isImpulse) {
            ctx.fillStyle = '#38bdf8';
            const peakStr = metrics.peakVal !== null ? `${metrics.peakVal.toFixed(2)}${isPendulum ? '°' : 'm'}` : '--';
            ctx.fillText(`最大応答 y_max: ${peakStr}`, hudX + 6, hudY + 26);
            ctx.fillStyle = metrics.isSettled ? '#10b981' : '#94a3b8';
            const tsStr = metrics.settlingTime !== null ? `${metrics.settlingTime.toFixed(2)}s` : (metrics.isSettled ? '整定済' : '過渡中...');
            ctx.fillText(`整定時間 t_s:   ${tsStr}`, hudX + 6, hudY + 40);
        } else {
            // ステップ
            ctx.fillStyle = (metrics.overshootPercent && metrics.overshootPercent > 0) ? '#eab308' : '#94a3b8';
            const mpStr = metrics.overshootPercent !== null ? `${metrics.overshootPercent.toFixed(1)}%` : '--%';
            ctx.fillText(`行き過ぎ量 Mp: ${mpStr}`, hudX + 6, hudY + 24);

            ctx.fillStyle = metrics.riseTime !== null ? '#38bdf8' : '#94a3b8';
            const trStr = metrics.riseTime !== null ? `${metrics.riseTime.toFixed(2)}s` : '--';
            ctx.fillText(`立上時間 t_r:  ${trStr}`, hudX + 6, hudY + 36);

            ctx.fillStyle = metrics.isSettled ? '#10b981' : '#94a3b8';
            const tsStr = metrics.settlingTime !== null ? `${metrics.settlingTime.toFixed(2)}s` : (metrics.isSettled ? '整定済' : '過渡中...');
            ctx.fillText(`整定時間 t_s:  ${tsStr}`, hudX + 6, hudY + 48);

            ctx.fillStyle = '#cbd5e1';
            const essStr = metrics.steadyStateError !== null ? `${metrics.steadyStateError.toFixed(3)}${isPendulum ? '°' : 'm'}` : '--';
            ctx.fillText(`定常偏差 e_ss: ${essStr}`, hudX + 6, hudY + 60);
        }

        ctx.restore();
    }

    /**
     * 正弦波モードにおける振幅比と位相遅れ Δt の図解アノテーション描画
     */
    drawBodeAnnotations(ctx, padLeft, plotW, plotH, zeroY, isPendulum, bodeAnalyzer) {
        ctx.save();

        // 出力ピーク値の水平ガイドライン
        const ampOut = bodeAnalyzer.currentAmpOut;
        let yTop, yBottom;
        if (isPendulum) {
            const deg = ampOut * (180 / Math.PI);
            yTop = zeroY - (deg / 180) * (plotH * 0.5);
            yBottom = zeroY + (deg / 180) * (plotH * 0.5);
        } else {
            yTop = zeroY - (ampOut / 1.0) * (plotH * 0.5);
            yBottom = zeroY + (ampOut / 1.0) * (plotH * 0.5);
        }

        ctx.strokeStyle = this.colors.peakLine;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);

        ctx.beginPath();
        ctx.moveTo(padLeft, yTop);
        ctx.lineTo(padLeft + plotW, yTop);
        ctx.moveTo(padLeft, yBottom);
        ctx.lineTo(padLeft + plotW, yBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // ガイドラベル: 出力振幅 Aout
        ctx.fillStyle = '#eab308';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        const unit = isPendulum ? '°' : 'm';
        const ampStr = isPendulum ? (ampOut * 180 / Math.PI).toFixed(1) : ampOut.toFixed(3);
        ctx.fillText(`+Aout: ${ampStr}${unit}`, padLeft + plotW - 4, yTop - 3);

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
        if (!ctx) return;
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
