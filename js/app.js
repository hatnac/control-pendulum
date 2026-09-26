/**
 * app.js - メインアプリケーション制御・イベントハンドリング・ゲームループ（モバイル＆タッチ対応）
 */

import { PendulumPhysics } from './physics.js';
import { PendulumRenderer } from './renderer.js';
import { ControlCharts } from './charts.js';

class PendulumApp {
    constructor() {
        this.physics = new PendulumPhysics();

        // Canvas要素
        this.simCanvas = document.getElementById('simCanvas');
        this.timeCanvas = document.getElementById('timeCanvas');
        this.phaseCanvas = document.getElementById('phaseCanvas');

        this.renderer = new PendulumRenderer(this.simCanvas);
        this.charts = new ControlCharts(this.timeCanvas, this.phaseCanvas);

        // 操作状態
        this.isPaused = false;
        this.controlMode = 'momentary'; // 'momentary' | 'throttle'
        this.appliedTau = 0.0;
        this.keyState = {
            ArrowLeft: false,
            ArrowRight: false,
            KeyA: false,
            KeyD: false
        };

        // タッチ＆マウスドラッグ状態
        this.isDragging = false;
        this.dragLastAngle = 0;
        this.dragLastTime = 0;

        // 整定判定（ゲーム要素）
        this.holdingTime = 0.0;
        this.requiredHoldTime = 2.0;
        this.stabilized = false;
        this.angleToleranceDeg = 6.0;
        this.omegaTolerance = 0.35;

        // アニメーションループ用タイムスタンプ
        this.lastTimestamp = performance.now();
        this.chartSampleTimer = 0.0;
        this.chartSampleInterval = 0.02;

        // プリセット定義
        this.presets = {
            default: {
                name: '標準設定',
                l: 1.0, m: 1.0, tauMax: 8.0, c: 0.15, g: 9.8, targetDeg: 180,
                desc: '倒立振子(180°)を目指す基本構成'
            },
            pendulum90: {
                name: '水平静止 (90°)',
                l: 1.0, m: 1.0, tauMax: 12.0, c: 0.2, g: 9.8, targetDeg: 90,
                desc: '重力に対抗して90度でキープする'
            },
            lowTorque: {
                name: 'スイングアップ必須',
                l: 1.0, m: 1.0, tauMax: 5.0, c: 0.08, g: 9.8, targetDeg: 180,
                desc: '最大トルク < mgl のため助走が必要'
            },
            heavyLong: {
                name: '長尺・大質量',
                l: 1.8, m: 2.5, tauMax: 20.0, c: 0.25, g: 9.8, targetDeg: 180,
                desc: '大きな慣性モーメントの振子'
            },
            fastShort: {
                name: '短尺・高速',
                l: 0.5, m: 0.5, tauMax: 6.0, c: 0.1, g: 9.8, targetDeg: 180,
                desc: '素早い反応が求められる機敏な振子'
            },
            zeroG: {
                name: '無重力 (宇宙)',
                l: 1.0, m: 1.0, tauMax: 4.0, c: 0.05, g: 0.0, targetDeg: 90,
                desc: '重力のない空間での回転制御'
            }
        };

        this.initDOM();
        this.initEvents();
        this.initDragEvents();
        this.initMobileTabs();
        this.initShareModal();
        this.updateParamUIFromPhysics();

        this.handleResize();
        requestAnimationFrame((t) => this.loop(t));
    }

    initDOM() {
        this.inputs = {
            l: document.getElementById('param-l'),
            lVal: document.getElementById('val-l'),
            m: document.getElementById('param-m'),
            mVal: document.getElementById('val-m'),
            tauMax: document.getElementById('param-tauMax'),
            tauMaxVal: document.getElementById('val-tauMax'),
            targetDeg: document.getElementById('param-targetDeg'),
            targetDegVal: document.getElementById('val-targetDeg'),
            c: document.getElementById('param-c'),
            cVal: document.getElementById('val-c'),
            g: document.getElementById('param-g'),
            gVal: document.getElementById('val-g')
        };

        this.gaugeFill = document.getElementById('gauge-fill');
        this.torqueText = document.getElementById('torque-val-text');

        this.btnLeft = document.getElementById('btn-left');
        this.btnRight = document.getElementById('btn-right');
        this.btnZero = document.getElementById('btn-zero');
        this.btnReset = document.getElementById('btn-reset');
        this.btnPause = document.getElementById('btn-pause');

        this.btnModeMomentary = document.getElementById('mode-momentary');
        this.btnModeThrottle = document.getElementById('mode-throttle');
    }

    initEvents() {
        window.addEventListener('resize', () => this.handleResize());

        // キーボード操作
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));

        // トルクボタン（マウス/タッチ共通バインド）
        const bindHoldButton = (btn, dir) => {
            const start = (ev) => {
                if (ev.cancelable) ev.preventDefault();
                if (this.controlMode === 'momentary') {
                    if (dir === 'left') this.keyState.ArrowLeft = true;
                    if (dir === 'right') this.keyState.ArrowRight = true;
                } else {
                    const step = this.physics.tauMax * 0.15;
                    this.appliedTau += (dir === 'left' ? step : -step);
                    this.appliedTau = Math.max(-this.physics.tauMax, Math.min(this.physics.tauMax, this.appliedTau));
                }
            };
            const end = (ev) => {
                if (ev.cancelable) ev.preventDefault();
                if (this.controlMode === 'momentary') {
                    if (dir === 'left') this.keyState.ArrowLeft = false;
                    if (dir === 'right') this.keyState.ArrowRight = false;
                }
            };

            btn.addEventListener('mousedown', start);
            btn.addEventListener('mouseup', end);
            btn.addEventListener('mouseleave', end);
            btn.addEventListener('touchstart', start, { passive: false });
            btn.addEventListener('touchend', end, { passive: false });
            btn.addEventListener('touchcancel', end, { passive: false });
        };

        bindHoldButton(this.btnLeft, 'left');
        bindHoldButton(this.btnRight, 'right');

        this.btnZero.addEventListener('click', () => {
            this.appliedTau = 0.0;
        });

        this.btnReset.addEventListener('click', () => {
            this.resetSimulation();
        });

        this.btnPause.addEventListener('click', () => {
            this.isPaused = !this.isPaused;
            this.btnPause.textContent = this.isPaused ? '▶ 再開' : '⏸ 一時停止';
        });

        this.btnModeMomentary.addEventListener('click', () => {
            this.setControlMode('momentary');
        });
        this.btnModeThrottle.addEventListener('click', () => {
            this.setControlMode('throttle');
        });

        // パラメータスライダー
        const setupSlider = (slider, valDisplay, key, decimals, unit = '', onChange = null) => {
            slider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.physics[key] = val;
                valDisplay.textContent = val.toFixed(decimals) + unit;
                if (onChange) onChange(val);
            });
        };

        setupSlider(this.inputs.l, this.inputs.lVal, 'l', 2, ' m');
        setupSlider(this.inputs.m, this.inputs.mVal, 'm', 2, ' kg');
        setupSlider(this.inputs.tauMax, this.inputs.tauMaxVal, 'tauMax', 1, ' Nm');
        setupSlider(this.inputs.c, this.inputs.cVal, 'c', 2, ' Ns/m');
        setupSlider(this.inputs.g, this.inputs.gVal, 'g', 1, ' m/s²');
        setupSlider(this.inputs.targetDeg, this.inputs.targetDegVal, 'targetAngleDeg', 0, '°', () => {
            this.holdingTime = 0.0;
            this.stabilized = false;
        });

        // プリセットボタン
        document.querySelectorAll('.btn-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.preset;
                this.applyPreset(key);
            });
        });
    }

    /**
     * Canvas上のおもりを指・マウスで掴んでドラッグできる操作を実装
     */
    initDragEvents() {
        const getCanvasCoord = (e) => {
            const rect = this.simCanvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: clientX - rect.left,
                y: clientY - rect.top
            };
        };

        const onStart = (e) => {
            const pos = getCanvasCoord(e);
            const bobInfo = this.renderer.getBobPosition(this.physics);

            // おもり判定（指で触りやすいように当たり判定半径を広めに）
            const hitRadius = Math.max(30, bobInfo.radius * 1.8);
            const dist = Math.hypot(pos.x - bobInfo.x, pos.y - bobInfo.y);

            if (dist <= hitRadius) {
                this.isDragging = true;
                this.dragLastAngle = this.physics.theta;
                this.dragLastTime = performance.now();
                if (e.cancelable) e.preventDefault();
            }
        };

        const onMove = (e) => {
            if (!this.isDragging) return;
            if (e.cancelable) e.preventDefault();

            const pos = getCanvasCoord(e);
            const metrics = this.renderer.getLayoutMetrics(this.physics);

            // 支点(pivotX, pivotY)からタッチ位置へのベクトル
            const dx = pos.x - metrics.pivotX;
            const dy = pos.y - metrics.pivotY;

            // 角度計算: dx = L sin(θ), dy = L cos(θ) => θ = atan2(dx, dy)
            const targetTheta = Math.atan2(dx, dy);

            // 連続的な回転を追従
            const diff = PendulumPhysics.normalizeAngle(targetTheta - this.physics.theta);
            this.physics.theta += diff;

            // 速度の推定
            const now = performance.now();
            const dt = (now - this.dragLastTime) / 1000.0;
            if (dt > 0.005) {
                this.physics.omega = diff / dt;
                this.dragLastAngle = this.physics.theta;
                this.dragLastTime = now;
            }
        };

        const onEnd = (e) => {
            if (this.isDragging) {
                this.isDragging = false;
                // 角速度の上限リミット（異常なフリックによる吹き飛びを防止）
                this.physics.omega = Math.max(-20, Math.min(20, this.physics.omega));
                if (e.cancelable) e.preventDefault();
            }
        };

        this.simCanvas.addEventListener('mousedown', onStart);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);

        this.simCanvas.addEventListener('touchstart', onStart, { passive: false });
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd, { passive: false });
        window.addEventListener('touchcancel', onEnd, { passive: false });
    }

    /**
     * モバイル用タブナビゲーションの初期化
     */
    initMobileTabs() {
        const tabBtns = document.querySelectorAll('.mobile-tab-btn');
        if (!tabBtns.length) return;

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.dataset.tab;
                tabBtns.forEach(b => b.classList.toggle('active', b === btn));

                document.querySelectorAll('.tab-section').forEach(sec => {
                    sec.classList.toggle('tab-active', sec.id === `tab-${targetTab}`);
                });

                // 表示切り替え後の再リサイズ
                setTimeout(() => this.handleResize(), 50);
            });
        });
    }

    /**
     * スマホ共有用QRコードモーダルの初期化
     */
    initShareModal() {
        const btnShare = document.getElementById('btn-share-mobile');
        const modal = document.getElementById('qr-modal');
        const btnClose = document.getElementById('btn-close-modal');
        const qrImg = document.getElementById('qr-code-img');
        const urlInput = document.getElementById('share-url-input');
        const btnCopy = document.getElementById('btn-copy-url');

        if (!btnShare || !modal) return;

        const openModal = () => {
            // 現在のアクセスURL（もしfile://ならローカルサーバー案内）
            let currentUrl = window.location.href;
            if (currentUrl.startsWith('file://')) {
                // fileプロトコルの場合はローカルサーバーまたはヒント表示
                currentUrl = 'http://localhost:8000';
            }

            urlInput.value = currentUrl;
            // 無料QRコード生成APIを利用して即時QR生成
            qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(currentUrl)}`;

            modal.style.display = 'flex';
        };

        const closeModal = () => {
            modal.style.display = 'none';
        };

        btnShare.addEventListener('click', openModal);
        btnClose.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        btnCopy.addEventListener('click', () => {
            urlInput.select();
            navigator.clipboard.writeText(urlInput.value).then(() => {
                const originalText = btnCopy.textContent;
                btnCopy.textContent = '完了!';
                setTimeout(() => { btnCopy.textContent = originalText; }, 1500);
            });
        });
    }

    setControlMode(mode) {
        this.controlMode = mode;
        this.btnModeMomentary.classList.toggle('active', mode === 'momentary');
        this.btnModeThrottle.classList.toggle('active', mode === 'throttle');
        this.appliedTau = 0.0;
    }

    handleResize() {
        this.renderer.resize();
        this.charts.resize();
    }

    handleKeyDown(e) {
        if (e.target.tagName === 'INPUT') return;

        if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
            this.keyState.ArrowLeft = true;
            if (this.controlMode === 'throttle') {
                this.appliedTau = Math.min(this.physics.tauMax, this.appliedTau + this.physics.tauMax * 0.1);
            }
            e.preventDefault();
        } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
            this.keyState.ArrowRight = true;
            if (this.controlMode === 'throttle') {
                this.appliedTau = Math.max(-this.physics.tauMax, this.appliedTau - this.physics.tauMax * 0.1);
            }
            e.preventDefault();
        } else if (e.code === 'Space') {
            this.appliedTau = 0.0;
            e.preventDefault();
        } else if (e.code === 'KeyR') {
            this.resetSimulation();
            e.preventDefault();
        }
    }

    handleKeyUp(e) {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
            this.keyState.ArrowLeft = false;
        } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
            this.keyState.ArrowRight = false;
        }
    }

    updateAppliedTorque(dt) {
        if (this.controlMode === 'momentary') {
            const left = this.keyState.ArrowLeft;
            const right = this.keyState.ArrowRight;

            if (left && !right) {
                this.appliedTau = this.physics.tauMax;
                this.btnLeft.classList.add('left-active');
                this.btnRight.classList.remove('right-active');
            } else if (right && !left) {
                this.appliedTau = -this.physics.tauMax;
                this.btnRight.classList.add('right-active');
                this.btnLeft.classList.remove('left-active');
            } else {
                this.appliedTau = 0.0;
                this.btnLeft.classList.remove('left-active');
                this.btnRight.classList.remove('right-active');
            }
        } else {
            this.btnLeft.classList.toggle('left-active', this.appliedTau > 0.05);
            this.btnRight.classList.toggle('right-active', this.appliedTau < -0.05);
        }

        const ratio = this.appliedTau / this.physics.tauMax;
        if (ratio >= 0) {
            this.gaugeFill.className = 'gauge-fill ccw';
            this.gaugeFill.style.left = '50%';
            this.gaugeFill.style.width = `${ratio * 50}%`;
        } else {
            const width = Math.abs(ratio) * 50;
            this.gaugeFill.className = 'gauge-fill cw';
            this.gaugeFill.style.left = `${50 - width}%`;
            this.gaugeFill.style.width = `${width}%`;
        }
        this.torqueText.textContent = `${this.appliedTau.toFixed(2)} Nm (${(ratio * 100).toFixed(0)}%)`;
    }

    updateStabilization(dt) {
        if (this.isDragging) {
            this.holdingTime = 0.0;
            this.stabilized = false;
            return;
        }

        const errDeg = Math.abs(this.physics.angleErrorDeg);
        const omega = Math.abs(this.physics.omega);

        if (errDeg <= this.angleToleranceDeg && omega <= this.omegaTolerance) {
            this.holdingTime += dt;
            if (this.holdingTime >= this.requiredHoldTime) {
                this.stabilized = true;
            }
        } else {
            this.holdingTime = Math.max(0, this.holdingTime - dt * 2.0);
            if (this.holdingTime === 0) {
                this.stabilized = false;
            }
        }
    }

    resetSimulation() {
        this.physics.reset(0, 0);
        this.charts.clear();
        this.appliedTau = 0.0;
        this.holdingTime = 0.0;
        this.stabilized = false;
    }

    applyPreset(presetKey) {
        const p = this.presets[presetKey];
        if (!p) return;

        this.physics.l = p.l;
        this.physics.m = p.m;
        this.physics.tauMax = p.tauMax;
        this.physics.c = p.c;
        this.physics.g = p.g;
        this.physics.targetAngleDeg = p.targetDeg;

        this.updateParamUIFromPhysics();
        this.resetSimulation();
    }

    updateParamUIFromPhysics() {
        this.inputs.l.value = this.physics.l;
        this.inputs.lVal.textContent = this.physics.l.toFixed(2) + ' m';

        this.inputs.m.value = this.physics.m;
        this.inputs.mVal.textContent = this.physics.m.toFixed(2) + ' kg';

        this.inputs.tauMax.value = this.physics.tauMax;
        this.inputs.tauMaxVal.textContent = this.physics.tauMax.toFixed(1) + ' Nm';

        this.inputs.c.value = this.physics.c;
        this.inputs.cVal.textContent = this.physics.c.toFixed(2) + ' Ns/m';

        this.inputs.g.value = this.physics.g;
        this.inputs.gVal.textContent = this.physics.g.toFixed(1) + ' m/s²';

        this.inputs.targetDeg.value = this.physics.targetAngleDeg;
        this.inputs.targetDegVal.textContent = this.physics.targetAngleDeg.toFixed(0) + '°';
    }

    loop(timestamp) {
        const elapsed = (timestamp - this.lastTimestamp) / 1000.0;
        this.lastTimestamp = timestamp;

        const dt = Math.min(elapsed, 0.05);

        if (!this.isPaused && dt > 0) {
            this.updateAppliedTorque(dt);

            // ドラッグ中でなければ物理シミュレーションを更新
            if (!this.isDragging) {
                this.physics.update(dt, this.appliedTau);
            }

            this.updateStabilization(dt);

            this.chartSampleTimer += dt;
            if (this.chartSampleTimer >= this.chartSampleInterval) {
                this.charts.addSample(this.physics);
                this.chartSampleTimer = 0.0;
            }
        }

        const status = {
            holdingTime: this.holdingTime,
            holdingProgress: Math.min(1.0, this.holdingTime / this.requiredHoldTime),
            stabilized: this.stabilized,
            isDragging: this.isDragging
        };

        this.renderer.draw(this.physics, status);
        this.charts.render(this.physics);

        requestAnimationFrame((t) => this.loop(t));
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new PendulumApp();
});
