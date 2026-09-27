/**
 * renderer-msd.js - マス・バネ・ダンパー系のCanvasアニメーション描画
 */

export class MassSpringDamperRenderer {
    /**
     * @param {HTMLCanvasElement} canvas 
     */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;

        this.colors = {
            bg: '#0f172a',
            wall: '#334155',
            wallHatch: '#1e293b',
            floor: '#475569',
            floorLine: '#1e293b',
            spring: '#38bdf8',
            damperCylinder: '#64748b',
            damperPiston: '#cbd5e1',
            massBox: '#0284c7',
            massBorder: '#7dd3fc',
            massGlow: 'rgba(56, 189, 248, 0.4)',
            wheel: '#1e293b',
            targetGhost: 'rgba(234, 179, 8, 0.35)',
            targetBorder: '#eab308',
            forceRight: '#10b981',    // 正の外力 (右向き)
            forceLeft: '#f43f5e',     // 負の外力 (左向き)
            centerLine: '#94a3b8',
            textMain: '#f1f5f9',
            textMuted: '#64748b'
        };

        this.resize();
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.width = rect.width || 300;
        this.height = rect.height || 300;
        this.canvas.width = this.width * this.dpr;
        this.canvas.height = this.height * this.dpr;
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    /**
     * レイアウト寸法の計算（メートル -> ピクセル変換）
     */
    getLayoutMetrics(physics) {
        const w = this.width;
        const h = this.height;

        const wallX = 40;                 // 固定壁のX位置
        const floorY = h * 0.72;          // 床面のY位置
        const massWidth = Math.max(50, Math.min(90, 60 * Math.cbrt(physics.m)));
        const massHeight = massWidth * 0.85;

        // 表示スケール: ±1.2m が画面に収まるように設定
        // つり合い位置 (x = 0) のマスの中心位置
        const centerX0 = wallX + (w - wallX) * 0.42;
        const scalePxPerMeter = (w - wallX) * 0.36; // 1mあたりのピクセル数

        // 現在のマスの中心X座標
        const massCenterX = centerX0 + physics.x * scalePxPerMeter;
        // マスの左端と右端
        const massLeftX = massCenterX - massWidth * 0.5;
        const massRightX = massCenterX + massWidth * 0.5;
        const massTopY = floorY - massHeight - 12; // 車輪分12px浮かす

        // 目標位置のマスの中心X座標
        const targetCenterX = centerX0 + physics.targetX * scalePxPerMeter;

        return {
            wallX, floorY, scalePxPerMeter, centerX0,
            massWidth, massHeight, massCenterX, massLeftX, massRightX, massTopY,
            targetCenterX
        };
    }

    /**
     * マスの当たり判定（タッチ・ドラッグ用）
     */
    getMassPosition(physics) {
        const m = this.getLayoutMetrics(physics);
        return {
            x: m.massCenterX,
            y: m.massTopY + m.massHeight * 0.5,
            width: m.massWidth,
            height: m.massHeight,
            left: m.massLeftX,
            right: m.massRightX,
            top: m.massTopY,
            bottom: m.floorY,
            scalePxPerMeter: m.scalePxPerMeter,
            centerX0: m.centerX0
        };
    }

    /**
     * 画面全体の描画
     */
    draw(physics, stateStatus = {}) {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, w, h);

        const m = this.getLayoutMetrics(physics);

        // 1. 床面とルーラー目盛り
        this.drawFloorAndRuler(m);

        // 2. つり合い位置 (x=0) のセンターライン
        this.drawCenterLine(m);

        // 3. 目標位置のゴースト
        this.drawTargetGhost(m, physics);

        // 4. 左端の固定壁
        this.drawWall(m);

        // 5. コイルばね（上段）
        this.drawSpring(m, physics);

        // 6. ダッシュポットダンパー（下段）
        this.drawDamper(m, physics);

        // 7. マスブロック（車輪付き）
        this.drawMassBlock(m, physics, stateStatus.isDragging);

        // 8. 入力外力 F のベクトル矢印
        this.drawForceVector(m, physics);

        // 9. HUD表示
        this.drawHUD(m, physics, stateStatus);
    }

    drawWall(m) {
        const ctx = this.ctx;
        const wallW = m.wallX;
        const wallH = m.floorY + 20;

        ctx.save();
        // 壁の本体
        ctx.fillStyle = this.colors.wall;
        ctx.fillRect(0, 20, wallW, wallH);

        // 斜線ハッチング
        ctx.strokeStyle = this.colors.wallHatch;
        ctx.lineWidth = 2;
        for (let y = 10; y < wallH + 40; y += 12) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(wallW, y - wallW);
            ctx.stroke();
        }

        // 壁の右境界線
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(wallW, 20);
        ctx.lineTo(wallW, m.floorY);
        ctx.stroke();

        ctx.restore();
    }

    drawFloorAndRuler(m) {
        const ctx = this.ctx;
        ctx.save();

        // 床面ライン
        ctx.strokeStyle = this.colors.floor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(m.wallX, m.floorY);
        ctx.lineTo(this.width, m.floorY);
        ctx.stroke();

        // 目盛り刻み (-1.0m 〜 +1.5m)
        const ticks = [-1.0, -0.5, 0.0, 0.5, 1.0, 1.5];
        ctx.fillStyle = this.colors.textMuted;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        ticks.forEach(tVal => {
            const x = m.centerX0 + tVal * m.scalePxPerMeter;
            if (x > m.wallX + 15 && x < this.width - 15) {
                ctx.strokeStyle = tVal === 0 ? this.colors.centerLine : this.colors.floorLine;
                ctx.lineWidth = tVal === 0 ? 2 : 1;
                ctx.beginPath();
                ctx.moveTo(x, m.floorY);
                ctx.lineTo(x, m.floorY + (tVal === 0 ? 8 : 5));
                ctx.stroke();

                const label = tVal > 0 ? `+${tVal.toFixed(1)}m` : `${tVal.toFixed(1)}m`;
                ctx.fillText(label, x, m.floorY + 10);
            }
        });

        ctx.restore();
    }

    drawCenterLine(m) {
        const ctx = this.ctx;
        ctx.save();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(m.centerX0, 30);
        ctx.lineTo(m.centerX0, m.floorY);
        ctx.stroke();

        ctx.fillStyle = this.colors.textMuted;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('x = 0 (自然長)', m.centerX0, 24);
        ctx.restore();
    }

    drawTargetGhost(m, physics) {
        const ctx = this.ctx;
        const gx = m.targetCenterX - m.massWidth * 0.5;
        const gy = m.massTopY;

        ctx.save();
        ctx.fillStyle = this.colors.targetGhost;
        ctx.strokeStyle = this.colors.targetBorder;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.roundRect(gx, gy, m.massWidth, m.massHeight, 6);
        ctx.fill();
        ctx.stroke();

        // ターゲットマーク
        ctx.setLineDash([]);
        ctx.fillStyle = this.colors.targetBorder;
        ctx.beginPath();
        ctx.arc(m.targetCenterX, gy + m.massHeight * 0.5, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('TARGET', m.targetCenterX, gy - 6);
        ctx.restore();
    }

    drawSpring(m, physics) {
        const ctx = this.ctx;
        const startX = m.wallX;
        const endX = m.massLeftX;
        const y = m.massTopY + m.massHeight * 0.32; // 上段
        const coils = 14;
        const springWidth = Math.max(20, endX - startX);
        const coilAmp = 12; // コイルの振幅（上下）

        ctx.save();
        ctx.strokeStyle = this.colors.spring;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(startX, y);

        // リードイン（壁からの直線）
        const lead = 12;
        ctx.lineTo(startX + lead, y);

        const activeW = springWidth - lead * 2;
        const step = activeW / coils;

        for (let i = 0; i < coils; i++) {
            const cx1 = startX + lead + (i + 0.25) * step;
            const cy1 = y - coilAmp;
            const cx2 = startX + lead + (i + 0.75) * step;
            const cy2 = y + coilAmp;
            ctx.lineTo(cx1, cy1);
            ctx.lineTo(cx2, cy2);
        }

        // リードアウト（マスへの直線）
        ctx.lineTo(endX - lead, y);
        ctx.lineTo(endX, y);
        ctx.stroke();

        // ばね定数 K の表示
        ctx.fillStyle = this.colors.spring;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`K=${physics.k.toFixed(1)} N/m`, startX + springWidth * 0.5, y - coilAmp - 4);

        ctx.restore();
    }

    drawDamper(m, physics) {
        const ctx = this.ctx;
        const startX = m.wallX;
        const endX = m.massLeftX;
        const y = m.massTopY + m.massHeight * 0.72; // 下段
        const totalSpan = endX - startX;

        ctx.save();

        // シリンダー（外筒）: 壁側に固定
        const cylinderLen = Math.max(35, Math.min(80, totalSpan * 0.5));
        const cylinderH = 16;
        const cylX = startX + 10;
        const cylY = y - cylinderH * 0.5;

        // 壁からシリンダーへのロッド
        ctx.strokeStyle = this.colors.damperCylinder;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(cylX, y);
        ctx.stroke();

        // シリンダー外枠
        ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
        ctx.strokeStyle = this.colors.damperCylinder;
        ctx.lineWidth = 2;
        ctx.strokeRect(cylX, cylY, cylinderLen, cylinderH);
        ctx.fillRect(cylX, cylY, cylinderLen, cylinderH);

        // ピストンロッド: マス側からシリンダー内部へ挿入
        const pistonX = Math.max(cylX + 5, Math.min(cylX + cylinderLen - 5, cylX + (totalSpan * 0.35)));

        ctx.strokeStyle = this.colors.damperPiston;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(endX, y);
        ctx.lineTo(pistonX, y);
        ctx.stroke();

        // ピストンヘッド（シリンダー内の板）
        ctx.fillStyle = this.colors.damperPiston;
        ctx.fillRect(pistonX - 2, cylY + 2, 4, cylinderH - 4);

        // 減衰係数 D の表示
        ctx.fillStyle = this.colors.damperPiston;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`D=${physics.d.toFixed(1)} Ns/m`, cylX + cylinderLen * 0.5, cylY + cylinderH + 12);

        ctx.restore();
    }

    drawMassBlock(m, physics, isDragging = false) {
        const ctx = this.ctx;
        const bx = m.massLeftX;
        const by = m.massTopY;
        const bw = m.massWidth;
        const bh = m.massHeight;

        ctx.save();

        // 車輪（ベアリング 2個）
        const wheelR = 6;
        const wheelY = m.floorY - wheelR;
        ctx.fillStyle = this.colors.wheel;
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.5;

        [bx + bw * 0.25, bx + bw * 0.75].forEach(wx => {
            ctx.beginPath();
            ctx.arc(wx, wheelY, wheelR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#38bdf8';
            ctx.beginPath();
            ctx.arc(wx, wheelY, 2, 0, Math.PI * 2);
            ctx.fill();
        });

        // マス本体ボックス
        const grad = ctx.createLinearGradient(bx, by, bx, by + bh);
        if (isDragging) {
            grad.addColorStop(0, '#fef08a');
            grad.addColorStop(1, '#ca8a04');
            ctx.shadowColor = 'rgba(234, 179, 8, 0.6)';
            ctx.shadowBlur = 18;
        } else {
            grad.addColorStop(0, '#38bdf8');
            grad.addColorStop(0.6, '#0284c7');
            grad.addColorStop(1, '#0369a1');
            ctx.shadowColor = this.colors.massGlow;
            ctx.shadowBlur = 12;
        }

        ctx.fillStyle = grad;
        ctx.strokeStyle = isDragging ? '#fef08a' : this.colors.massBorder;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 6);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;

        // 質量ラベル
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`m=${physics.m.toFixed(1)}kg`, m.massCenterX, by + bh * 0.5);

        ctx.restore();
    }

    drawForceVector(m, physics) {
        const ctx = this.ctx;
        const f = physics.f;
        if (Math.abs(f) < 0.1) return;

        const isRight = f > 0;
        const maxArrowLen = m.massWidth * 1.2;
        const arrowLen = (Math.abs(f) / physics.fMax) * maxArrowLen;

        const startX = isRight ? m.massRightX : m.massLeftX;
        const endX = isRight ? (startX + arrowLen) : (startX - arrowLen);
        const y = m.massTopY + m.massHeight * 0.5;

        ctx.save();
        ctx.strokeStyle = isRight ? this.colors.forceRight : this.colors.forceLeft;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();

        // 矢印の先端
        const headSize = 8;
        ctx.beginPath();
        if (isRight) {
            ctx.moveTo(endX + headSize, y);
            ctx.lineTo(endX, y - headSize * 0.6);
            ctx.lineTo(endX, y + headSize * 0.6);
        } else {
            ctx.moveTo(endX - headSize, y);
            ctx.lineTo(endX, y - headSize * 0.6);
            ctx.lineTo(endX, y + headSize * 0.6);
        }
        ctx.closePath();
        ctx.fill();

        // 力の数値
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = isRight ? 'left' : 'right';
        ctx.fillText(`F=${Math.abs(f).toFixed(1)}N`, endX + (isRight ? 12 : -12), y - 6);

        ctx.restore();
    }

    drawHUD(m, physics, stateStatus) {
        const ctx = this.ctx;
        ctx.save();

        const isSmallScreen = this.width < 450;
        const pad = isSmallScreen ? 10 : 16;
        const hudW = isSmallScreen ? 165 : 210;
        const hudH = isSmallScreen ? 95 : 120;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(pad, pad, hudW, hudH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.font = isSmallScreen ? '10px "Courier New", monospace' : '11px "Courier New", monospace';
        ctx.fillStyle = this.colors.textMain;

        const xVal = physics.x.toFixed(3);
        const vVal = physics.v.toFixed(2);
        const fVal = physics.f.toFixed(2);
        const errVal = physics.error.toFixed(3);
        const zetaVal = physics.zeta.toFixed(2);
        const wnVal = physics.omegaN.toFixed(2);

        const lineStep = isSmallScreen ? 15 : 18;
        let y = pad + (isSmallScreen ? 15 : 18);

        ctx.fillText(`変位 x : ${xVal} m`, pad + 8, y);
        y += lineStep;
        ctx.fillText(`速度 v : ${vVal} m/s`, pad + 8, y);
        y += lineStep;
        ctx.fillText(`外力 F : ${fVal} N`, pad + 8, y);
        y += lineStep;
        ctx.fillText(`偏差 e : ${errVal} m`, pad + 8, y);
        y += lineStep;
        ctx.fillText(`減衰比ζ: ${zetaVal} (${physics.dampingTypeLabel})`, pad + 8, y);
        if (!isSmallScreen) {
            y += lineStep;
            ctx.fillText(`固有ωn : ${wnVal} rad/s`, pad + 8, y);
        }

        // 整定判定バッジ
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
            ctx.fillText(`目標位置キープ... ${(stateStatus.holdingTime).toFixed(1)}s`, this.width / 2, barY - 3);
        }

        ctx.restore();
    }
}
