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
        this.showPhasor = true; // 正弦波モード時のリアルタイム・フェーザ図表示

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
        const isClosedBode = isBode && bodeAnalyzer.loopType === 'closed';
        const showPhasor = isBode && this.showPhasor;

        const padLeft = isPendulum ? 42 : 46;
        const padRight = showPhasor ? 10 : 15;
        const padTop = 22;
        const padBottom = 22;
        const phasorAreaW = showPhasor ? Math.min(138, Math.max(92, Math.floor(w * 0.28))) : 0;
        const plotW = Math.max(80, w - padLeft - padRight - phasorAreaW);
        const plotH = h - padTop - padBottom;

        // 値 -> Y座標変換ヘルパー
        const valToY = (val) => {
            if (isPendulum) {
                return padTop + plotH * (1.0 - (val + 180) / 360);
            } else {
                const norm = (val - (-1.0)) / 2.0;
                return padTop + plotH * (1.0 - Math.max(0, Math.min(1, norm)));
            }
        };

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
                ctx.lineTo(padLeft + plotW, y);
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
                ctx.lineTo(padLeft + plotW, y);
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
        ctx.lineTo(padLeft + plotW, zeroY);
        ctx.stroke();

        // 凡例表示
        ctx.textAlign = 'left';
        if (isBode) {
            // 正弦波モードの凡例
            ctx.fillStyle = this.colors.signal;
            ctx.fillText(isPendulum ? '― 出力 θ(t)' : '― 出力 x(t)', padLeft + 6, padTop - 8);

            ctx.fillStyle = this.colors.control;
            ctx.fillText(isClosedBode ? '--- 目標正弦波 r(t)' : '--- 正弦波入力 u(t)', padLeft + 80, padTop - 8);

            if (bodeAnalyzer.currentAmpOut > 0.001 && !showPhasor) {
                const ampRatio = Math.pow(10, bodeAnalyzer.currentGainDb / 20.0);
                ctx.fillStyle = '#eab308';
                ctx.fillText(`×${ampRatio.toFixed(2)} (${bodeAnalyzer.currentGainDb.toFixed(1)}dB) φ=${bodeAnalyzer.currentPhaseDeg.toFixed(0)}°`, padLeft + 195, padTop - 8);
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

        // X座標計算（正弦波モード時は最新点が右端に揃い左へスクロール）
        const idxToX = (i) => {
            if (isBode) {
                return padLeft + plotW - ((this.history.length - 1 - i) / (this.maxHistory - 1)) * plotW;
            }
            return padLeft + (i / (this.maxHistory - 1)) * plotW;
        };

        // 静的基準線 (開ループ正弦波時の DC変位 A_in / K)
        let staticYTop = null;
        let staticYBottom = null;
        if (isBode && !isClosedBode) {
            const chars = bodeAnalyzer.constructor.computeSystemCharacteristics(this.systemMode, physics, 'open', null);
            const dcAmp = bodeAnalyzer.amplitude * chars.dcGain;
            const dcVal = isPendulum ? (dcAmp * 180 / Math.PI) : dcAmp;
            staticYTop = valToY(dcVal);
            staticYBottom = valToY(-dcVal);

            ctx.save();
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(padLeft, staticYTop);
            ctx.lineTo(padLeft + plotW, staticYTop);
            ctx.moveTo(padLeft, staticYBottom);
            ctx.lineTo(padLeft + plotW, staticYBottom);
            ctx.stroke();
            ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';
            ctx.font = '9px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`静的基準 ±${isPendulum ? dcVal.toFixed(1) + '°' : dcVal.toFixed(2) + 'm'}`, padLeft + 4, staticYTop - 4);
            ctx.restore();
        }

        if (this.history.length >= 2) {
            // 1. 目標値の破線プロット (通常モードおよび過渡ステップ時)
            if (!isBode && (!isTransient || transientManager.responseType !== 'impulse')) {
                ctx.save();
                ctx.strokeStyle = this.colors.target;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                for (let i = 0; i < this.history.length; i++) {
                    const p = this.history[i];
                    const x = idxToX(i);
                    const y = valToY(p.target);
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
                ctx.restore();
            }

            // 2. 制御入力（または閉ループ目標正弦波）プロット
            ctx.save();
            ctx.strokeStyle = this.colors.control;
            ctx.lineWidth = isBode ? 1.8 : 1.2;
            if (isBode) ctx.setLineDash([4, 3]);
            ctx.beginPath();
            for (let i = 0; i < this.history.length; i++) {
                const p = this.history[i];
                const x = idxToX(i);
                let y;
                if (isClosedBode) {
                    // 閉ループ時は目標正弦波を出力と同じ物理Yスケールで描画
                    y = valToY(p.target);
                } else {
                    const inMax = Math.max(0.1, isBode ? bodeAnalyzer.amplitude : (p.inputMax || 10.0));
                    const inNorm = Math.max(-1.2, Math.min(1.2, p.input / inMax));
                    y = zeroY - inNorm * (plotH * 0.30);
                }
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.restore();

            // 3. 状態量（角度 θ / 変位 x）プロット
            ctx.save();
            ctx.strokeStyle = this.colors.signal;
            ctx.lineWidth = 2.1;
            ctx.beginPath();
            let prevVal = null;
            for (let i = 0; i < this.history.length; i++) {
                const p = this.history[i];
                const x = idxToX(i);
                const y = valToY(p.val);
                if (isPendulum) {
                    if (prevVal !== null && Math.abs(p.val - prevVal) > 180) {
                        ctx.moveTo(x, y);
                    } else if (i === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                    prevVal = p.val;
                } else {
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
            ctx.restore();

            // 4. 正弦波モード時の振幅ガイド＆位相差 Δt アノテーション
            if (isBode) {
                this.drawBodeAnnotations(ctx, padLeft, plotW, plotH, padTop, zeroY, isPendulum, bodeAnalyzer, idxToX, valToY, isClosedBode);
            }

            // 5. 過渡応答モード時のアノテーション
            if (isTransient) {
                this.drawTransientAnnotations(ctx, padLeft, plotW, plotH, zeroY, isPendulum, transientManager);
            }
        }

        // 6. 右側リアルタイム・フェーザ図（回転ベクトル）＆波形先端接続ライン
        if (showPhasor) {
            this.drawPhasorDiagram(ctx, padLeft + plotW, phasorAreaW, padTop, plotH, zeroY, isPendulum, bodeAnalyzer, valToY, physics);
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
            if (typeof metrics.peakVal === 'number' && isFinite(metrics.peakVal) &&
                typeof metrics.overshootPercent === 'number' && isFinite(metrics.overshootPercent) &&
                metrics.overshootPercent > 0.5) {
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
            const peakStr = (typeof metrics.peakVal === 'number' && isFinite(metrics.peakVal))
                ? `${metrics.peakVal.toFixed(2)}${isPendulum ? '°' : 'm'}` : '--';
            ctx.fillText(`最大応答 y_max: ${peakStr}`, hudX + 6, hudY + 26);
            ctx.fillStyle = metrics.isSettled ? '#10b981' : '#94a3b8';
            const tsStr = (typeof metrics.settlingTime === 'number' && isFinite(metrics.settlingTime))
                ? `${metrics.settlingTime.toFixed(2)}s` : (metrics.isSettled ? '整定済' : '過渡中...');
            ctx.fillText(`整定時間 t_s:   ${tsStr}`, hudX + 6, hudY + 40);
        } else {
            // ステップ
            ctx.fillStyle = (typeof metrics.overshootPercent === 'number' && metrics.overshootPercent > 0) ? '#eab308' : '#94a3b8';
            const mpStr = (typeof metrics.overshootPercent === 'number' && isFinite(metrics.overshootPercent))
                ? `${metrics.overshootPercent.toFixed(1)}%` : '--%';
            ctx.fillText(`行き過ぎ量 Mp: ${mpStr}`, hudX + 6, hudY + 24);

            ctx.fillStyle = (typeof metrics.riseTime === 'number' && isFinite(metrics.riseTime)) ? '#38bdf8' : '#94a3b8';
            const trStr = (typeof metrics.riseTime === 'number' && isFinite(metrics.riseTime))
                ? `${metrics.riseTime.toFixed(2)}s` : '--';
            ctx.fillText(`立上時間 t_r:  ${trStr}`, hudX + 6, hudY + 36);

            ctx.fillStyle = metrics.isSettled ? '#10b981' : '#94a3b8';
            const tsStr = (typeof metrics.settlingTime === 'number' && isFinite(metrics.settlingTime))
                ? `${metrics.settlingTime.toFixed(2)}s` : (metrics.isSettled ? '整定済' : '過渡中...');
            ctx.fillText(`整定時間 t_s:  ${tsStr}`, hudX + 6, hudY + 48);

            ctx.fillStyle = '#cbd5e1';
            const essStr = (typeof metrics.steadyStateError === 'number' && isFinite(metrics.steadyStateError))
                ? `${metrics.steadyStateError.toFixed(3)}${isPendulum ? '°' : 'm'}` : '--';
            ctx.fillText(`定常偏差 e_ss: ${essStr}`, hudX + 6, hudY + 60);
        }

        ctx.restore();
    }

    /**
     * 正弦波モードにおける振幅比と位相遅れ Δt の図解アノテーション描画
     */
    drawBodeAnnotations(ctx, padLeft, plotW, plotH, padTop, zeroY, isPendulum, bodeAnalyzer, idxToX, valToY, isClosedBode) {
        ctx.save();

        // 1. 出力ピーク値の水平ガイドライン
        const ampOut = bodeAnalyzer.currentAmpOut;
        if (ampOut > 0.002) {
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

            // ガイドラベル: 出力振幅 Aout と倍率
            ctx.fillStyle = '#eab308';
            ctx.font = '10px monospace';
            ctx.textAlign = 'right';
            const unit = isPendulum ? '°' : 'm';
            const ampStr = isPendulum ? (ampOut * 180 / Math.PI).toFixed(1) : ampOut.toFixed(3);
            const ampRatio = Math.pow(10, bodeAnalyzer.currentGainDb / 20.0);
            const ratioLabel = isClosedBode ? ` (倍率 ×${ampRatio.toFixed(2)})` : '';
            ctx.fillText(`+Aout: ${ampStr}${unit}${ratioLabel}`, padLeft + plotW - 4, Math.max(padTop + 10, yTop - 4));
        }

        // 2. 入力の山（ピーク）と出力の山（ピーク）を結ぶ位相遅れ Δt 矢印
        const hist = this.history;
        if (hist.length >= 12) {
            const getInVal = (p) => isClosedBode ? p.target : p.input;
            const period = (2.0 * Math.PI) / Math.max(0.1, bodeAnalyzer.omega);

            // 入力の極大点（正のピーク）を後ろから検索し、その直後に出力の正のピークが観測できている最新ペアを探す
            let foundPair = null;
            for (let i = hist.length - 3; i >= 2; i--) {
                const vPrev = getInVal(hist[i - 1]);
                const vCurr = getInVal(hist[i]);
                const vNext = getInVal(hist[i + 1]);

                if (vCurr > 0 && vCurr >= vPrev && vCurr > vNext) {
                    const tIn = hist[i].t;
                    // この入力ピーク以降 0 〜 0.70 * period の範囲で出力の正ピークを探す
                    let bestOutIdx = -1;
                    let bestOutVal = -Infinity;
                    for (let j = i; j < hist.length - 1; j++) {
                        const dtPeak = hist[j].t - tIn;
                        if (dtPeak > period * 0.7) break;
                        const yPrev = hist[j - 1].val;
                        const yCurr = hist[j].val;
                        const yNext = hist[j + 1].val;
                        if (yCurr > 0 && yCurr >= yPrev && yCurr >= yNext && yCurr > bestOutVal) {
                            bestOutVal = yCurr;
                            bestOutIdx = j;
                        }
                    }
                    if (bestOutIdx >= i) {
                        foundPair = { inIdx: i, outIdx: bestOutIdx };
                        break;
                    }
                }
            }

            if (foundPair) {
                const pIn = hist[foundPair.inIdx];
                const pOut = hist[foundPair.outIdx];
                const xIn = idxToX(foundPair.inIdx);
                const xOut = idxToX(foundPair.outIdx);

                let yIn;
                if (isClosedBode) {
                    yIn = valToY(pIn.target);
                } else {
                    const inMax = Math.max(0.1, bodeAnalyzer.amplitude);
                    yIn = zeroY - Math.max(-1.2, Math.min(1.2, pIn.input / inMax)) * (plotH * 0.30);
                }
                const yOut = valToY(pOut.val);
                const dtDelay = Math.max(0, pOut.t - pIn.t);
                const phaseFromDtDeg = -(dtDelay / period) * 360.0;

                // 位相遅れ区間のハイライト帯
                if (xOut >= xIn) {
                    ctx.fillStyle = 'rgba(245, 158, 11, 0.10)';
                    ctx.fillRect(xIn, padTop, Math.max(2, xOut - xIn), plotH);
                }

                // 山頂マーカー点（入力: 緑, 出力: シアン）
                ctx.fillStyle = this.colors.control;
                ctx.beginPath();
                ctx.arc(xIn, yIn, 3.8, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = this.colors.signal;
                ctx.beginPath();
                ctx.arc(xOut, yOut, 3.8, 0, Math.PI * 2);
                ctx.fill();

                // 矢印ガイド線とラベル
                const arrowY = padTop + 14;
                ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.beginPath();
                ctx.moveTo(xIn, yIn);
                ctx.lineTo(xIn, arrowY);
                ctx.moveTo(xOut, yOut);
                ctx.lineTo(xOut, arrowY);
                ctx.stroke();
                ctx.setLineDash([]);

                // 水平矢印
                ctx.strokeStyle = this.colors.dtArrow;
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.moveTo(xIn, arrowY);
                ctx.lineTo(xOut, arrowY);
                ctx.stroke();

                if (xOut - xIn > 10) {
                    // 矢じり
                    ctx.fillStyle = this.colors.dtArrow;
                    ctx.beginPath();
                    ctx.moveTo(xOut, arrowY);
                    ctx.lineTo(xOut - 5, arrowY - 3);
                    ctx.lineTo(xOut - 5, arrowY + 3);
                    ctx.closePath();
                    ctx.fill();
                }

                // Δt / φ テキスト
                const delayLabel = `遅れ Δt=${dtDelay.toFixed(2)}s (${phaseFromDtDeg.toFixed(0)}°)`;
                ctx.font = 'bold 9px monospace';
                const labelX = Math.max(padLeft + 60, Math.min(padLeft + plotW - 60, (xIn + xOut) * 0.5));
                ctx.textAlign = 'center';
                ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
                const tw = ctx.measureText(delayLabel).width + 8;
                ctx.fillRect(labelX - tw * 0.5, arrowY + 3, tw, 13);
                ctx.fillStyle = '#fbbf24';
                ctx.fillText(delayLabel, labelX, arrowY + 13);
            }
        }

        ctx.restore();
    }

    /**
     * 右側のリアルタイム・フェーザ図（回転ベクトル）を描画し、波形先端と水平線で接続
     */
    drawPhasorDiagram(ctx, areaLeft, areaW, padTop, plotH, zeroY, isPendulum, bodeAnalyzer, valToY, physics) {
        ctx.save();

        // 境界線
        ctx.strokeStyle = this.colors.axis;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(areaLeft, padTop);
        ctx.lineTo(areaLeft, padTop + plotH);
        ctx.stroke();

        // タイトル
        const cx = areaLeft + areaW * 0.52;
        const cy = zeroY;
        const maxR = Math.min(areaW * 0.41, plotH * 0.44);

        ctx.fillStyle = '#cbd5e1';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('フェーザ図 (回転ベクトル)', areaLeft + areaW * 0.5, padTop - 13);

        // 背景十字軸と単位基準円
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - maxR - 4, cy);
        ctx.lineTo(cx + maxR + 4, cy);
        ctx.moveTo(cx, cy - maxR - 4);
        ctx.lineTo(cx, cy + maxR + 4);
        ctx.stroke();

        const isClosedBode = bodeAnalyzer.loopType === 'closed';
        const thetaIn = bodeAnalyzer.getCurrentInputPhaseRad();
        const phaseRad = (bodeAnalyzer.currentPhaseDeg * Math.PI) / 180.0;
        const thetaOut = thetaIn + phaseRad;

        // 入力ベクトルの半径（時系列グラフ側の振幅とY高さを一致）
        let rIn;
        if (isClosedBode) {
            const ampInVal = isPendulum ? (bodeAnalyzer.amplitude * 180 / Math.PI) : bodeAnalyzer.amplitude;
            const yAmp = Math.abs(zeroY - valToY(ampInVal));
            rIn = Math.min(maxR, Math.max(8, yAmp));
        } else {
            rIn = Math.min(maxR * 0.92, plotH * 0.30);
        }

        // 出力ベクトルの半径
        const ampOut = bodeAnalyzer.currentAmpOut;
        let rOutPx;
        if (isPendulum) {
            rOutPx = ((ampOut * 180 / Math.PI) / 180) * (plotH * 0.5);
        } else {
            rOutPx = (ampOut / 1.0) * (plotH * 0.5);
        }
        const rOut = Math.min(maxR, Math.max(4, rOutPx));

        // 入力の基準円（薄い緑点線）
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.25)';
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.arc(cx, cy, rIn, 0, Math.PI * 2);
        ctx.stroke();

        // 出力の振幅円（薄いシアン点線）
        if (ampOut > 0.002) {
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
            ctx.beginPath();
            ctx.arc(cx, cy, rOut, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // 位相差 φ の扇形ハイライト
        if (ampOut > 0.002 && Math.abs(phaseRad) > 0.03) {
            ctx.fillStyle = 'rgba(234, 179, 8, 0.16)';
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            // Canvas の arc は時計回り正なので -theta が数学角
            const startAng = -thetaIn;
            const endAng = -thetaOut;
            ctx.arc(cx, cy, Math.min(rIn, rOut, maxR * 0.65), startAng, endAng, phaseRad > 0);
            ctx.closePath();
            ctx.fill();
        }

        // ヘルパー: ベクトル矢印描画
        const drawVector = (angleRad, radius, color, label) => {
            const vx = cx + radius * Math.cos(angleRad);
            const vy = cy - radius * Math.sin(angleRad);

            // 波形の先端（左境界）への水平射影破線
            ctx.save();
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.45;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(vx, vy);
            ctx.lineTo(areaLeft, vy);
            ctx.stroke();
            ctx.restore();

            // 矢印本体
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(vx, vy);
            ctx.stroke();

            // 先端ドット
            ctx.beginPath();
            ctx.arc(vx, vy, 3.2, 0, Math.PI * 2);
            ctx.fill();

            // ラベル
            const lx = cx + (radius + 9) * Math.cos(angleRad);
            const ly = cy - (radius + 9) * Math.sin(angleRad);
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, lx, ly);
        };

        drawVector(thetaIn, rIn, this.colors.control, 'U');
        if (ampOut > 0.002) {
            drawVector(thetaOut, rOut, this.colors.signal, 'Y');
        }

        // 下部数値バッジ（位相差 φ と倍率）
        ctx.fillStyle = '#eab308';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const phiTxt = ampOut > 0.002 ? `φ = ${bodeAnalyzer.currentPhaseDeg.toFixed(0)}°` : '計測中...';
        ctx.fillText(phiTxt, cx, padTop + plotH + 14);

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
