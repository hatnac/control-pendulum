/**
 * renderer.js - 振子シミュレーションのCanvas描画（レスポンシブ＆タッチ対応）
 */

import { PendulumPhysics } from './physics.js';

export class PendulumRenderer {
    /**
     * @param {HTMLCanvasElement} canvas 
     */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // ピクセル比対応
        this.dpr = window.devicePixelRatio || 1;
        this.resize();

        // 描画スタイル設定
        this.colors = {
            bg: '#0f172a',
            grid: '#1e293b',
            axis: '#334155',
            rod: '#94a3b8',
            bob: '#38bdf8',
            bobGlow: 'rgba(56, 189, 248, 0.4)',
            pivot: '#f8fafc',
            pivotRim: '#475569',
            targetGhost: 'rgba(234, 179, 8, 0.4)',
            targetGhostBob: 'rgba(234, 179, 8, 0.25)',
            targetHighlight: '#eab308',
            torqueCcw: '#10b981',       // 正トルク（緑・反時計回り）
            torqueCw: '#f43f5e',        // 負トルク（赤・時計回り）
            trail: 'rgba(56, 189, 248, 0.15)',
            textMain: '#f1f5f9',
            textMuted: '#64748b',
            dragGlow: 'rgba(234, 179, 8, 0.6)'
        };

        // おもりの軌跡履歴
        this.trail = [];
        this.maxTrailLength = 35;
    }

    /**
     * Canvas解像度のリサイズ調整
     */
    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.width = rect.width || 300;
        this.height = rect.height || 300;
        this.canvas.width = this.width * this.dpr;
        this.canvas.height = this.height * this.dpr;
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    /**
     * 支点の中心座標と振子の表示長さを計算
     */
    getLayoutMetrics(physics) {
        const w = this.width;
        const h = this.height;
        const pivotX = w * 0.5;
        const pivotY = h * 0.5;

        // 縦横の小さい方に合わせてスケーリング
        const visualScale = Math.min(w, h) * 0.36;
        const visualLength = Math.max(35, physics.l * visualScale);
        const bobRadius = Math.max(14, Math.min(32, 14 * Math.cbrt(physics.m)));

        return { pivotX, pivotY, visualLength, bobRadius };
    }

    /**
     * おもりの現在の画面座標とタッチ当たり判定用半径を取得
     */
    getBobPosition(physics) {
        const { pivotX, pivotY, visualLength, bobRadius } = this.getLayoutMetrics(physics);
        const bx = pivotX + visualLength * Math.sin(physics.theta);
        const by = pivotY + visualLength * Math.cos(physics.theta);
        return { x: bx, y: by, radius: bobRadius, pivotX, pivotY, visualLength };
    }

    /**
     * 画面全体の描画
     * @param {PendulumPhysics} physics 
     * @param {Object} stateStatus 
     */
    draw(physics, stateStatus = {}) {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        // 背景クリア
        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, w, h);

        const { pivotX, pivotY, visualLength, bobRadius } = this.getLayoutMetrics(physics);

        // 背景の分度器ガイド（円形目盛り）
        this.drawAngleDial(pivotX, pivotY, visualLength);

        // 目標角度のゴースト振子
        this.drawTargetGhost(pivotX, pivotY, visualLength, physics);

        // おもりの軌跡を描画
        this.drawTrail();

        // 振子本体（ロッドとおもり）
        this.drawPendulum(pivotX, pivotY, visualLength, bobRadius, physics, stateStatus.isDragging);

        // 支点モーター＆トルクインジケータ
        this.drawMotorPivot(pivotX, pivotY, physics);

        // HUD / ステータス表示
        this.drawHUD(physics, stateStatus);
    }

    /**
     * 背景の角度目盛り盤を描画
     */
    drawAngleDial(cx, cy, radius) {
        const ctx = this.ctx;
        ctx.save();

        // 外周円
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();

        // 目盛り線
        const isSmallScreen = this.width < 450;
        const step = isSmallScreen ? 90 : 30;

        for (let deg = 0; deg < 360; deg += step) {
            const rad = (deg * Math.PI) / 180;
            const sx = cx + Math.sin(rad) * (radius - 5);
            const sy = cy + Math.cos(rad) * (radius - 5);
            const ex = cx + Math.sin(rad) * (radius + 5);
            const ey = cy + Math.cos(rad) * (radius + 5);

            ctx.strokeStyle = (deg % 90 === 0) ? this.colors.axis : this.colors.grid;
            ctx.lineWidth = (deg % 90 === 0) ? 2 : 1;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.stroke();

            // 0°, 90°, 180°, 270° のラベル
            if (deg % 90 === 0) {
                const tx = cx + Math.sin(rad) * (radius + (isSmallScreen ? 14 : 18));
                const ty = cy + Math.cos(rad) * (radius + (isSmallScreen ? 14 : 18));
                ctx.fillStyle = this.colors.textMuted;
                ctx.font = isSmallScreen ? '10px sans-serif' : '11px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                let label = `${deg}°`;
                if (!isSmallScreen) {
                    if (deg === 0) label = '0° (安定)';
                    else if (deg === 180) label = '180° (倒立)';
                }
                ctx.fillText(label, tx, ty);
            }
        }

        ctx.restore();
    }

    /**
     * 目標角度の半透明ゴースト振子を描画
     */
    drawTargetGhost(cx, cy, length, physics) {
        const ctx = this.ctx;
        const targetRad = physics.targetAngleRad;

        const gx = cx + length * Math.sin(targetRad);
        const gy = cy + length * Math.cos(targetRad);

        ctx.save();
        ctx.strokeStyle = this.colors.targetGhost;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(gx, gy);
        ctx.stroke();
        ctx.setLineDash([]);

        const bobRadius = Math.max(12, Math.min(30, 13 * Math.cbrt(physics.m)));
        ctx.fillStyle = this.colors.targetGhostBob;
        ctx.strokeStyle = this.colors.targetHighlight;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(gx, gy, bobRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = this.colors.targetHighlight;
        ctx.beginPath();
        ctx.arc(gx, gy, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    /**
     * おもりの移動軌跡を描画
     */
    drawTrail() {
        if (this.trail.length < 2) return;
        const ctx = this.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(this.trail[0].x, this.trail[0].y);
        for (let i = 1; i < this.trail.length; i++) {
            ctx.lineTo(this.trail[i].x, this.trail[i].y);
        }
        ctx.strokeStyle = this.colors.trail;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }

    /**
     * 振子本体を描画
     */
    drawPendulum(cx, cy, length, bobRadius, physics, isDragging = false) {
        const ctx = this.ctx;
        const th = physics.theta;

        const bx = cx + length * Math.sin(th);
        const by = cy + length * Math.cos(th);

        if (!isDragging) {
            this.trail.push({ x: bx, y: by });
            if (this.trail.length > this.maxTrailLength) {
                this.trail.shift();
            }
        }

        ctx.save();

        // ロッド
        const rodGrad = ctx.createLinearGradient(cx, cy, bx, by);
        rodGrad.addColorStop(0, '#64748b');
        rodGrad.addColorStop(1, '#cbd5e1');

        ctx.strokeStyle = rodGrad;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(bx, by);
        ctx.stroke();

        // ドラッグ中のタッチハイライト
        if (isDragging) {
            ctx.strokeStyle = '#eab308';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(bx, by, bobRadius + 8, 0, Math.PI * 2);
            ctx.stroke();
        }

        // おもりのグローエフェクト
        ctx.shadowColor = isDragging ? this.colors.dragGlow : this.colors.bobGlow;
        ctx.shadowBlur = isDragging ? 22 : 14;

        const bobGrad = ctx.createRadialGradient(
            bx - bobRadius * 0.3, by - bobRadius * 0.3, bobRadius * 0.1,
            bx, by, bobRadius
        );
        bobGrad.addColorStop(0, isDragging ? '#fef08a' : '#7dd3fc');
        bobGrad.addColorStop(0.7, isDragging ? '#eab308' : '#0284c7');
        bobGrad.addColorStop(1, isDragging ? '#ca8a04' : '#0369a1');

        ctx.fillStyle = bobGrad;
        ctx.beginPath();
        ctx.arc(bx, by, bobRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = isDragging ? '#fef08a' : '#bae6fd';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 質量ラベル
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${physics.m.toFixed(1)}kg`, bx, by);

        ctx.restore();
    }

    /**
     * 支点モーター＆トルク表示
     */
    drawMotorPivot(cx, cy, physics) {
        const ctx = this.ctx;
        ctx.save();

        const pivotRadius = 16;
        const tau = physics.tau;
        const tauRatio = tau / physics.tauMax;

        if (Math.abs(tauRatio) > 0.01) {
            const isCCW = tau > 0;
            const arcRadius = pivotRadius + 12;
            const startAngle = Math.PI * 0.5;
            const angleSpan = Math.abs(tauRatio) * Math.PI * 1.5;
            const endAngle = isCCW ? (startAngle - angleSpan) : (startAngle + angleSpan);

            ctx.lineWidth = 5;
            ctx.lineCap = 'round';
            ctx.strokeStyle = isCCW ? this.colors.torqueCcw : this.colors.torqueCw;
            ctx.shadowColor = ctx.strokeStyle;
            ctx.shadowBlur = 8;

            ctx.beginPath();
            ctx.arc(cx, cy, arcRadius, startAngle, endAngle, isCCW);
            ctx.stroke();

            const arrowX = cx + arcRadius * Math.cos(endAngle);
            const arrowY = cy + arcRadius * Math.sin(endAngle);
            const tangent = endAngle + (isCCW ? -Math.PI / 2 : Math.PI / 2);
            const arrowSize = 7;

            ctx.fillStyle = ctx.strokeStyle;
            ctx.beginPath();
            ctx.moveTo(arrowX, arrowY);
            ctx.lineTo(
                arrowX - arrowSize * Math.cos(tangent - Math.PI / 6),
                arrowY - arrowSize * Math.sin(tangent - Math.PI / 6)
            );
            ctx.lineTo(
                arrowX - arrowSize * Math.cos(tangent + Math.PI / 6),
                arrowY - arrowSize * Math.sin(tangent + Math.PI / 6)
            );
            ctx.closePath();
            ctx.fill();
        }

        ctx.shadowBlur = 0;

        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, pivotRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    /**
     * HUD (現在状態のオーバーレイ表示)
     */
    drawHUD(physics, stateStatus) {
        const ctx = this.ctx;
        ctx.save();

        const isSmallScreen = this.width < 450;
        const pad = isSmallScreen ? 10 : 16;
        const hudW = isSmallScreen ? 150 : 190;
        const hudH = isSmallScreen ? 85 : 105;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(pad, pad, hudW, hudH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.font = isSmallScreen ? '11px "Courier New", monospace' : '12px "Courier New", monospace';
        ctx.fillStyle = this.colors.textMain;

        const degNorm = physics.normalizedThetaDeg.toFixed(1);
        const omegaVal = physics.omega.toFixed(2);
        const tauVal = physics.tau.toFixed(2);
        const errDeg = Math.abs(physics.angleErrorDeg).toFixed(1);

        const lineStep = isSmallScreen ? 16 : 19;
        let y = pad + (isSmallScreen ? 16 : 20);

        ctx.fillText(`θ  : ${degNorm}°`, pad + 8, y);
        y += lineStep;
        ctx.fillText(`ω  : ${omegaVal} rad/s`, pad + 8, y);
        y += lineStep;
        ctx.fillText(`τ  : ${tauVal} Nm`, pad + 8, y);
        y += lineStep;
        ctx.fillText(`偏差: ${errDeg}°`, pad + 8, y);
        if (!isSmallScreen) {
            y += lineStep;
            ctx.fillText(`全E : ${physics.totalEnergy.toFixed(2)} J`, pad + 8, y);
        }

        // 整定判定ステータス
        if (stateStatus.stabilized) {
            ctx.fillStyle = 'rgba(16, 185, 129, 0.92)';
            const badgeW = isSmallScreen ? 160 : 200;
            const badgeH = isSmallScreen ? 34 : 40;
            ctx.beginPath();
            ctx.roundRect(this.width / 2 - badgeW / 2, isSmallScreen ? 12 : 20, badgeW, badgeH, 18);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = isSmallScreen ? 'bold 15px sans-serif' : 'bold 17px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('★ STABILIZED! ★', this.width / 2, (isSmallScreen ? 12 : 20) + badgeH / 2);
        } else if (stateStatus.holdingProgress > 0) {
            const barW = isSmallScreen ? 140 : 180;
            const barH = 12;
            const barX = this.width / 2 - barW / 2;
            const barY = isSmallScreen ? 20 : 24;

            ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
            ctx.beginPath();
            ctx.roundRect(barX, barY, barW, barH, 6);
            ctx.fill();

            const fillW = Math.max(0, Math.min(barW, barW * stateStatus.holdingProgress));
            ctx.fillStyle = '#eab308';
            ctx.beginPath();
            ctx.roundRect(barX, barY, fillW, barH, 6);
            ctx.fill();

            ctx.fillStyle = '#f8fafc';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`安定化維持中... ${(stateStatus.holdingTime).toFixed(1)}s`, this.width / 2, barY - 3);
        }

        ctx.restore();
    }
}
