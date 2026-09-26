/**
 * app.js - メインアプリケーション制御・イベントハンドリング・ゲームループ
 * （アナログスライダー、スワイプ操作、マウスドラッグ、キーボード加速対応）
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
        this.sliderMode = 'spring'; // 'spring' (離すと0復帰) | 'hold' (出力維持)
        this.appliedTau = 0.0;
        this.isSliderDragging = false;

        this.keyState = {
            ArrowLeft: false,
            ArrowRight: false,
            KeyA: false,
            KeyD: false
        };
        this.keyHoldDurationLeft = 0;
        this.keyHoldDurationRight = 0;

        // 振子おもりのタッチ＆マウスドラッグ状態
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
        this.initSliderEvents();
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

        // スライダー関連DOM
        this.sliderArea = document.getElementById('torque-slider-area');
        this.sliderTrack = document.getElementById('torque-slider-track');
        this.sliderThumb = document.getElementById('torque-slider-thumb');
        this.gaugeFill = document.getElementById('gauge-fill');
        this.torqueText = document.getElementById('torque-val-text');

        this.btnSpringMode = document.getElementById('mode-spring');
        this.btnHoldMode = document.getElementById('mode-hold');

        this.btnNudgeLeft = document.getElementById('btn-nudge-left');
        this.btnNudgeRight = document.getElementById('btn-nudge-right');
        this.btnZero = document.getElementById('btn-zero');

        this.btnReset = document.getElementById('btn-reset');
        this.btnPause = document.getElementById('btn-pause');
    }

    initEvents() {
        window.addEventListener('resize', () => this.handleResize());

        // キーボード操作
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));

        // ニュートラル切断ボタン
        this.btnZero.addEventListener('click', () => {
            this.appliedTau = 0.0;
        });

        // 微動ボタン
        const stepVal = 0.5;
        this.btnNudgeLeft.addEventListener('click', () => {
            this.appliedTau = Math.min(this.physics.tauMax, this.appliedTau + stepVal);
        });
        this.btnNudgeRight.addEventListener('click', () => {
            this.appliedTau = Math.max(-this.physics.tauMax, this.appliedTau - stepVal);
        });

        // スライダーモード切替（スプリング復帰 vs ホールド）
        this.btnSpringMode.addEventListener('click', () => {
            this.setSliderMode('spring');
        });
        this.btnHoldMode.addEventListener('click', () => {
            this.setSliderMode('hold');
        });

        // マウスホイールによる微調整
        const onWheel = (e) => {
            e.preventDefault();
            // ホイール上回転（負）で左トルク増加、下回転（正）で右トルク増加
            const delta = -Math.sign(e.deltaY) * (this.physics.tauMax * 0.04);
            this.appliedTau = Math.max(-this.physics.tauMax, Math.min(this.physics.tauMax, this.appliedTau + delta));
        };

        if (this.sliderArea) {
            this.sliderArea.addEventListener('wheel', onWheel, { passive: false });
        }
        if (this.simCanvas) {
            this.simCanvas.addEventListener('wheel', onWheel, { passive: false });
        }

        // シミュレーション一時停止 / 再開
        this.btnPause.addEventListener('click', () => {
            this.isPaused = !this.isPaused;
            this.btnPause.textContent = this.isPaused ? '▶ 再開' : '⏸ 一時停止';
        });

        // リセット
        this.btnReset.addEventListener('click', () => {
            this.resetSimulation();
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
     * インタラクティブ・アナログスライダー（タッチパドル）のイベント処理
     * ポインターイベントを用いてマウスとタッチをシームレスに処理
     */
    initSliderEvents() {
        if (!this.sliderArea || !this.sliderTrack) return;

        const updateFromPointer = (e) => {
            const rect = this.sliderTrack.getBoundingClientRect();
            let p = (e.clientX - rect.left) / rect.width;
            p = Math.max(0, Math.min(1, p));

            // 左端(0.0) => +1.0 (CCW 反時計回り正トルク)
            // 中央(0.5) => 0.0
            // 右端(1.0) => -1.0 (CW 時計回り負トルク)
            const ratio = (0.5 - p) * 2.0;
            this.appliedTau = ratio * this.physics.tauMax;
        };

        const onPointerDown = (e) => {
            this.isSliderDragging = true;
            this.sliderThumb.classList.add('dragging');
            try {
                this.sliderArea.setPointerCapture(e.pointerId);
            } catch (err) {}
            updateFromPointer(e);
            e.preventDefault();
        };

        const onPointerMove = (e) => {
            if (!this.isSliderDragging) return;
            updateFromPointer(e);
            e.preventDefault();
        };

        const onPointerUp = (e) => {
            if (this.isSliderDragging) {
                this.isSliderDragging = false;
                this.sliderThumb.classList.remove('dragging');
                try {
                    this.sliderArea.releasePointerCapture(e.pointerId);
                } catch (err) {}
                e.preventDefault();
            }
        };

        this.sliderArea.addEventListener('pointerdown', onPointerDown);
        this.sliderArea.addEventListener('pointermove', onPointerMove);
        this.sliderArea.addEventListener('pointerup', onPointerUp);
        this.sliderArea.addEventListener('pointercancel', onPointerUp);
    }

    setSliderMode(mode) {
        this.sliderMode = mode;
        this.btnSpringMode.classList.toggle('active', mode === 'spring');
        this.btnHoldMode.classList.toggle('active', mode === 'hold');
    }

    /**
     * Canvas上のおもりを指・マウスで掴んでドラッグできる操作
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

            const hitRadius = Math.max(32, bobInfo.radius * 2.0);
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

            const dx = pos.x - metrics.pivotX;
            const dy = pos.y - metrics.pivotY;

            const targetTheta = Math.atan2(dx, dy);
            const diff = PendulumPhysics.normalizeAngle(targetTheta - this.physics.theta);
            this.physics.theta += diff;

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

                setTimeout(() => this.handleResize(), 50);
            });
        });
    }

    initShareModal() {
        const btnShare = document.getElementById('btn-share-mobile');
        const modal = document.getElementById('qr-modal');
        const btnClose = document.getElementById('btn-close-modal');
        const qrImg = document.getElementById('qr-code-img');
        const urlInput = document.getElementById('share-url-input');
        const btnCopy = document.getElementById('btn-copy-url');

        if (!btnShare || !modal) return;

        const openModal = () => {
            let currentUrl = window.location.href;
            if (currentUrl.startsWith('file://')) {
                currentUrl = 'http://localhost:8000';
            }

            urlInput.value = currentUrl;
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

    handleResize() {
        this.renderer.resize();
        this.charts.resize();
    }

    handleKeyDown(e) {
        if (e.target.tagName === 'INPUT') return;

        if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
            this.keyState.ArrowLeft = true;
            e.preventDefault();
        } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
            this.keyState.ArrowRight = true;
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

    /**
     * トルク値の更新およびスライダー表示の同期
     */
    updateAppliedTorque(dt) {
        // 1. キーボード長押しによるスムーズなトルク加減算
        if (this.keyState.ArrowLeft && !this.keyState.ArrowRight) {
            this.keyHoldDurationLeft += dt;
            const rate = Math.min(1.0, this.keyHoldDurationLeft / 0.3);
            this.appliedTau = Math.min(this.physics.tauMax, this.appliedTau + this.physics.tauMax * dt * 2.2 * (0.3 + 0.7 * rate));
        } else {
            this.keyHoldDurationLeft = 0;
        }

        if (this.keyState.ArrowRight && !this.keyState.ArrowLeft) {
            this.keyHoldDurationRight += dt;
            const rate = Math.min(1.0, this.keyHoldDurationRight / 0.3);
            this.appliedTau = Math.max(-this.physics.tauMax, this.appliedTau - this.physics.tauMax * dt * 2.2 * (0.3 + 0.7 * rate));
        } else {
            this.keyHoldDurationRight = 0;
        }

        // 2. スプリング復帰モード時の自動センタリング（離したときスッと0に戻る）
        if (this.sliderMode === 'spring' && !this.isSliderDragging && !this.keyState.ArrowLeft && !this.keyState.ArrowRight) {
            this.appliedTau += (0 - this.appliedTau) * Math.min(1.0, dt * 10.0);
            if (Math.abs(this.appliedTau) < 0.005) {
                this.appliedTau = 0.0;
            }
        }

        // 3. スライダーUIと数値バッジの同期描画
        const tauMax = Math.max(0.1, this.physics.tauMax);
        const ratio = Math.max(-1.0, Math.min(1.0, this.appliedTau / tauMax));

        // ノブ位置: ratio=+1(CCW・左端) => 0%, ratio=0 => 50%, ratio=-1(CW・右端) => 100%
        const thumbPosPercent = (0.5 - ratio * 0.5) * 100;
        this.sliderThumb.style.left = `${thumbPosPercent}%`;

        // ゲージの塗り（中央50%から左右へ伸びる）
        if (ratio >= 0) {
            // 左回転 (CCW: 正トルク・緑)
            const width = ratio * 50;
            this.gaugeFill.className = 'gauge-fill ccw';
            this.gaugeFill.style.left = `${50 - width}%`;
            this.gaugeFill.style.width = `${width}%`;
            this.torqueText.className = ratio > 0.01 ? 'torque-val-badge ccw' : 'torque-val-badge';
        } else {
            // 右回転 (CW: 負トルク・赤)
            const width = Math.abs(ratio) * 50;
            this.gaugeFill.className = 'gauge-fill cw';
            this.gaugeFill.style.left = '50%';
            this.gaugeFill.style.width = `${width}%`;
            this.torqueText.className = 'torque-val-badge cw';
        }

        const sign = this.appliedTau > 0 ? '+' : '';
        this.torqueText.textContent = `${sign}${this.appliedTau.toFixed(2)} Nm (${sign}${(ratio * 100).toFixed(0)}%)`;
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
