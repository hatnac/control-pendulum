/**
 * app.js - メインアプリケーション制御・イベントハンドリング・ゲームループ
 * （振子モータ制御系 & マス・バネ・ダンパー系 & 正弦波周波数応答ボード線図 完全対応）
 */

import { PendulumPhysics } from './physics.js';
import { PendulumRenderer } from './renderer.js';
import { MassSpringDamperPhysics } from './physics-msd.js';
import { MassSpringDamperRenderer } from './renderer-msd.js';
import { ControlCharts } from './charts.js';
import { PIDController } from './pid.js';
import { BodeAnalyzer } from './bode.js';
import { BodeRenderer } from './bode-renderer.js';
import { TransientManager } from './transient.js';

class ControlApp {
    constructor() {
        // 現在アクティブなシステム ('pendulum' | 'msd')
        this.activeSystem = 'pendulum';

        // 振子系
        this.physics = new PendulumPhysics();
        this.pendulumPid = new PIDController(); // 角度制御用（Wrapあり）

        // マス・バネ・ダンパー系
        this.msdPhysics = new MassSpringDamperPhysics();
        this.msdPid = new PIDController();      // 位置制御用（Wrapなし）
        this.msdPid.angleMode = false;
        this.msdPid.kp = 30.0;
        this.msdPid.ki = 12.0;
        this.msdPid.kd = 8.0;

        // 周波数応答・ボード線図
        this.bodeAnalyzer = new BodeAnalyzer();
        this.activeSecondaryChart = 'phase'; // 'phase' | 'bode'

        // 過渡応答（インパルス / ステップ）
        this.transientManager = new TransientManager();

        // Canvas要素
        this.simCanvas = document.getElementById('simCanvas');
        this.timeCanvas = document.getElementById('timeCanvas');
        this.phaseCanvas = document.getElementById('phaseCanvas');
        this.bodeCanvas = document.getElementById('bodeCanvas');

        this.renderer = new PendulumRenderer(this.simCanvas);
        this.msdRenderer = new MassSpringDamperRenderer(this.simCanvas);
        this.charts = new ControlCharts(this.timeCanvas, this.phaseCanvas);
        this.bodeRenderer = new BodeRenderer(this.bodeCanvas);

        // 操作状態
        this.isPaused = false;
        this.driveMode = 'manual'; // 'manual' | 'auto' | 'bode'
        this.sliderMode = 'spring'; // 'spring' | 'hold'
        this.appliedTau = 0.0;      // 振子用モータトルク [Nm]
        this.appliedForce = 0.0;    // MSD用入力外力 [N]
        this.isSliderDragging = false;

        this.keyState = {
            ArrowLeft: false,
            ArrowRight: false,
            KeyA: false,
            KeyD: false
        };
        this.keyHoldDurationLeft = 0;
        this.keyHoldDurationRight = 0;

        // タッチ＆マウスドラッグ状態
        this.isDragging = false;
        this.dragLastCoord = { x: 0, y: 0 };
        this.dragLastTime = 0;

        // 整定判定（ゲーム要素）
        this.holdingTime = 0.0;
        this.requiredHoldTime = 2.0;
        this.stabilized = false;

        // 振子用整定閾値
        this.angleToleranceDeg = 6.0;
        this.omegaTolerance = 0.35;

        // MSD用整定閾値
        this.posToleranceM = 0.03;
        this.velToleranceM = 0.06;

        // アニメーションループ用タイムスタンプ
        this.lastTimestamp = performance.now();
        this.chartSampleTimer = 0.0;
        this.chartSampleInterval = 0.02;

        // 振子プリセット
        this.pendulumPresets = {
            default: { l: 1.0, m: 1.0, tauMax: 12.0, c: 0.15, g: 9.8, targetDeg: 180 },
            pendulum90: { l: 1.0, m: 1.0, tauMax: 15.0, c: 0.2, g: 9.8, targetDeg: 90 },
            lowTorque: { l: 1.0, m: 1.0, tauMax: 5.0, c: 0.08, g: 9.8, targetDeg: 180 },
            heavyLong: { l: 1.8, m: 2.5, tauMax: 25.0, c: 0.25, g: 9.8, targetDeg: 180 },
            fastShort: { l: 0.5, m: 0.5, tauMax: 8.0, c: 0.1, g: 9.8, targetDeg: 180 },
            zeroG: { l: 1.0, m: 1.0, tauMax: 6.0, c: 0.05, g: 0.0, targetDeg: 90 }
        };

        // マスバネダンパープリセット
        this.msdPresets = {
            underDamped: { m: 1.0, k: 12.0, d: 1.2, fMax: 20.0, targetX: 0.5 },
            criticallyDamped: { m: 1.0, k: 16.0, d: 8.0, fMax: 25.0, targetX: 0.5 },
            overDamped: { m: 1.0, k: 9.0, d: 11.0, fMax: 25.0, targetX: 0.5 },
            undamped: { m: 1.0, k: 12.0, d: 0.0, fMax: 20.0, targetX: 0.5 },
            heavyStructure: { m: 4.0, k: 36.0, d: 3.0, fMax: 35.0, targetX: 0.4 },
            stiffFast: { m: 0.5, k: 32.0, d: 2.0, fMax: 25.0, targetX: 0.3 }
        };

        this.initDOM();
        this.initEvents();
        this.initSliderEvents();
        this.initDragEvents();
        this.initMobileTabs();
        this.initShareModal();
        this.updateParamUIFromPhysics();
        this.updateMSDParamUI();
        this.updatePIDUI();
        this.updateBodeUI();
        this.updateTransientUI();

        this.handleResize();
        requestAnimationFrame((t) => this.loop(t));
    }

    get currentPID() {
        return this.activeSystem === 'pendulum' ? this.pendulumPid : this.msdPid;
    }

    get currentPhysics() {
        return this.activeSystem === 'pendulum' ? this.physics : this.msdPhysics;
    }

    initDOM() {
        // システム切替ボタン
        this.btnSysPendulum = document.getElementById('btn-sys-pendulum');
        this.btnSysMSD = document.getElementById('btn-sys-msd');

        // ヘッダータイトル・各種動的ラベル
        this.headerTitle = document.getElementById('app-header-title');
        this.simTitleText = document.getElementById('sim-title-text');
        this.controlInputLabel = document.getElementById('control-input-label');
        this.scaleMinLabel = document.getElementById('scale-min-label');
        this.scaleMaxLabel = document.getElementById('scale-max-label');
        this.timeChartTitle = document.getElementById('time-chart-title');
        this.timeChartSub = document.getElementById('time-chart-sub');
        this.pidFormulaBadge = document.getElementById('pid-formula-badge');

        // カード・パネル
        this.cardPendulumParams = document.getElementById('card-pendulum-params');
        this.cardMSDParams = document.getElementById('card-msd-params');
        this.cardPendulumPresets = document.getElementById('card-pendulum-presets');
        this.cardMSDPresets = document.getElementById('card-msd-presets');
        this.pidPresetsPendulum = document.getElementById('pid-presets-pendulum');
        this.pidPresetsMSD = document.getElementById('pid-presets-msd');

        // 振子パラメータDOM
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

        // マスバネダンパーパラメータDOM
        this.msdInputs = {
            m: document.getElementById('param-msd-m'),
            mVal: document.getElementById('val-msd-m'),
            k: document.getElementById('param-msd-k'),
            kVal: document.getElementById('val-msd-k'),
            d: document.getElementById('param-msd-d'),
            dVal: document.getElementById('val-msd-d'),
            fMax: document.getElementById('param-msd-fMax'),
            fMaxVal: document.getElementById('val-msd-fMax'),
            targetX: document.getElementById('param-msd-targetX'),
            targetXVal: document.getElementById('val-msd-targetX'),
            calcWn: document.getElementById('calc-msd-wn'),
            calcZeta: document.getElementById('calc-msd-zeta'),
            calcDamping: document.getElementById('calc-msd-damping')
        };

        // PIDパラメータDOM
        this.pidInputs = {
            kp: document.getElementById('param-kp'),
            kpVal: document.getElementById('val-kp'),
            ki: document.getElementById('param-ki'),
            kiVal: document.getElementById('val-ki'),
            kd: document.getElementById('param-kd'),
            kdVal: document.getElementById('val-kd')
        };

        // ドライブモード切替DOM
        this.btnDriveManual = document.getElementById('drive-manual');
        this.btnDriveAuto = document.getElementById('drive-auto');
        this.btnDriveTransient = document.getElementById('drive-transient');
        this.btnDriveBode = document.getElementById('drive-bode');
        this.pidStatusBadge = document.getElementById('pid-status-badge');
        this.transientStatusBadge = document.getElementById('transient-status-badge');
        this.bodeStatusBadge = document.getElementById('bode-status-badge');
        this.manualModeToggles = document.getElementById('manual-mode-toggles');

        // パネル切替DOM
        this.manualControlsPanel = document.getElementById('manual-controls-panel');
        this.transientControlsPanel = document.getElementById('transient-controls-panel');
        this.bodeControlsPanel = document.getElementById('bode-controls-panel');

        // クイック加振ボタン
        this.btnQuickImpulse = document.getElementById('btn-quick-impulse');
        this.btnQuickStep = document.getElementById('btn-quick-step');

        // 過渡応答コントロールDOM
        this.btnTrStepOpen = document.getElementById('btn-tr-step-open');
        this.btnTrStepClosed = document.getElementById('btn-tr-step-closed');
        this.btnTrImpulse = document.getElementById('btn-tr-impulse');
        this.paramTransientInput = document.getElementById('param-transient-input');
        this.valTransientParam = document.getElementById('val-transient-param');
        this.transientParamLabel = document.getElementById('transient-param-label');
        this.transientTheoryText = document.getElementById('transient-theory-text');
        this.transientTheoryStatus = document.getElementById('val-transient-theory-status');
        this.transientHudMp = document.getElementById('transient-hud-mp');
        this.transientHudTr = document.getElementById('transient-hud-tr');
        this.transientHudTs = document.getElementById('transient-hud-ts');
        this.btnTransientStart = document.getElementById('btn-transient-start');
        this.btnTransientImpulseHit = document.getElementById('btn-transient-impulse-hit');
        this.btnTransientReset = document.getElementById('btn-transient-reset');

        // 正弦波コントロールDOM
        this.paramBodeOmega = document.getElementById('param-bode-omega');
        this.valBodeOmega = document.getElementById('val-bode-omega');
        this.paramBodeAmp = document.getElementById('param-bode-amp');
        this.valBodeAmp = document.getElementById('val-bode-amp');
        this.bodeAmpLabel = document.getElementById('bode-amp-label');
        this.btnBodeSweep = document.getElementById('btn-bode-sweep');
        this.btnBodeRecord = document.getElementById('btn-bode-record');
        this.btnBodeJumpWn = document.getElementById('btn-bode-jump-wn');
        this.btnBodeClear = document.getElementById('btn-bode-clear');
        this.bodeHudGain = document.getElementById('bode-hud-gain');
        this.bodeHudPhase = document.getElementById('bode-hud-phase');

        // サブタブ切替DOM
        this.btnChartPhase = document.getElementById('btn-chart-phase');
        this.btnChartBode = document.getElementById('btn-chart-bode');
        this.secondaryChartSub = document.getElementById('secondary-chart-sub');

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

        // システム切替
        if (this.btnSysPendulum) {
            this.btnSysPendulum.addEventListener('click', () => this.switchSystem('pendulum'));
        }
        if (this.btnSysMSD) {
            this.btnSysMSD.addEventListener('click', () => this.switchSystem('msd'));
        }

        // ドライブモード切替
        this.btnDriveManual.addEventListener('click', () => this.setDriveMode('manual'));
        this.btnDriveAuto.addEventListener('click', () => this.setDriveMode('auto'));
        if (this.btnDriveTransient) {
            this.btnDriveTransient.addEventListener('click', () => this.setDriveMode('transient'));
        }
        if (this.btnDriveBode) {
            this.btnDriveBode.addEventListener('click', () => this.setDriveMode('bode'));
        }

        // クイック加振ボタン
        if (this.btnQuickImpulse) {
            this.btnQuickImpulse.addEventListener('click', () => this.applyQuickImpulse());
        }
        if (this.btnQuickStep) {
            this.btnQuickStep.addEventListener('click', () => this.applyQuickStep());
        }

        // 過渡応答サブタブ
        if (this.btnTrStepOpen) {
            this.btnTrStepOpen.addEventListener('click', () => this.setTransientType('step_open'));
        }
        if (this.btnTrStepClosed) {
            this.btnTrStepClosed.addEventListener('click', () => this.setTransientType('step_closed'));
        }
        if (this.btnTrImpulse) {
            this.btnTrImpulse.addEventListener('click', () => this.setTransientType('impulse'));
        }

        // 過渡応答パラメータ入力
        if (this.paramTransientInput) {
            this.paramTransientInput.addEventListener('input', (e) => {
                this.onTransientParamChange(parseFloat(e.target.value));
            });
        }

        // 過渡応答アクションボタン
        if (this.btnTransientStart) {
            this.btnTransientStart.addEventListener('click', () => this.startTransientExperiment());
        }
        if (this.btnTransientImpulseHit) {
            this.btnTransientImpulseHit.addEventListener('click', () => this.applyQuickImpulse());
        }
        if (this.btnTransientReset) {
            this.btnTransientReset.addEventListener('click', () => this.resetSimulation());
        }

        // グラフサブタブ切替（相平面 ⇔ ボード線図）
        if (this.btnChartPhase) {
            this.btnChartPhase.addEventListener('click', () => this.setSecondaryChart('phase'));
        }
        if (this.btnChartBode) {
            this.btnChartBode.addEventListener('click', () => this.setSecondaryChart('bode'));
        }

        // 正弦波周波数スライダー
        if (this.paramBodeOmega) {
            this.paramBodeOmega.addEventListener('input', (e) => {
                const w = parseFloat(e.target.value);
                this.bodeAnalyzer.setOmega(w);
                this.updateBodeUI();
            });
        }

        // 正弦波振幅スライダー
        if (this.paramBodeAmp) {
            this.paramBodeAmp.addEventListener('input', (e) => {
                const amp = parseFloat(e.target.value);
                this.bodeAnalyzer.setAmplitude(amp);
                this.updateBodeUI();
            });
        }

        // 自動スイープボタン
        if (this.btnBodeSweep) {
            this.btnBodeSweep.addEventListener('click', () => {
                if (this.bodeAnalyzer.isSweeping) {
                    this.bodeAnalyzer.stopSweep();
                    this.btnBodeSweep.textContent = '▶ 自動周波数スイープ (Bode測定)';
                } else {
                    this.startBodeSweep();
                }
            });
        }

        // 現在値プロット記録ボタン
        if (this.btnBodeRecord) {
            this.btnBodeRecord.addEventListener('click', () => {
                this.bodeAnalyzer.recordCurrentPoint();
            });
        }

        // 共振点ジャンプボタン
        if (this.btnBodeJumpWn) {
            this.btnBodeJumpWn.addEventListener('click', () => {
                const wn = this.getResonanceOmega();
                this.bodeAnalyzer.setOmega(wn);
                if (this.paramBodeOmega) this.paramBodeOmega.value = wn.toFixed(2);
                this.updateBodeUI();
            });
        }

        // プロット消去ボタン
        if (this.btnBodeClear) {
            this.btnBodeClear.addEventListener('click', () => {
                this.bodeAnalyzer.clearMeasurements();
            });
        }

        // キーボード操作
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));

        // ニュートラルゼロ復帰ボタン
        this.btnZero.addEventListener('click', () => {
            if (this.driveMode === 'auto') this.setDriveMode('manual');
            this.appliedTau = 0.0;
            this.appliedForce = 0.0;
        });

        // 微動ボタン
        this.btnNudgeLeft.addEventListener('click', () => {
            if (this.driveMode === 'auto') this.setDriveMode('manual');
            if (this.activeSystem === 'pendulum') {
                this.appliedTau = Math.min(this.physics.tauMax, this.appliedTau + 0.5);
            } else {
                this.appliedForce = Math.max(-this.msdPhysics.fMax, this.appliedForce - 1.0);
            }
        });
        this.btnNudgeRight.addEventListener('click', () => {
            if (this.driveMode === 'auto') this.setDriveMode('manual');
            if (this.activeSystem === 'pendulum') {
                this.appliedTau = Math.max(-this.physics.tauMax, this.appliedTau - 0.5);
            } else {
                this.appliedForce = Math.min(this.msdPhysics.fMax, this.appliedForce + 1.0);
            }
        });

        // スライダー復帰モード切替
        this.btnSpringMode.addEventListener('click', () => this.setSliderMode('spring'));
        this.btnHoldMode.addEventListener('click', () => this.setSliderMode('hold'));

        // マウスホイールによる微調整
        const onWheel = (e) => {
            e.preventDefault();
            if (this.driveMode === 'bode') {
                // 正弦波モード時はホイールで周波数を微増減
                const delta = -Math.sign(e.deltaY) * 0.2;
                const newW = Math.max(0.2, Math.min(25.0, this.bodeAnalyzer.omega + delta));
                this.bodeAnalyzer.setOmega(newW);
                if (this.paramBodeOmega) this.paramBodeOmega.value = newW.toFixed(2);
                this.updateBodeUI();
                return;
            }

            if (this.driveMode === 'auto') this.setDriveMode('manual');
            if (this.activeSystem === 'pendulum') {
                const delta = -Math.sign(e.deltaY) * (this.physics.tauMax * 0.04);
                this.appliedTau = Math.max(-this.physics.tauMax, Math.min(this.physics.tauMax, this.appliedTau + delta));
            } else {
                const delta = -Math.sign(e.deltaY) * (this.msdPhysics.fMax * 0.04);
                this.appliedForce = Math.max(-this.msdPhysics.fMax, Math.min(this.msdPhysics.fMax, this.appliedForce + delta));
            }
        };

        if (this.sliderArea) this.sliderArea.addEventListener('wheel', onWheel, { passive: false });
        if (this.simCanvas) this.simCanvas.addEventListener('wheel', onWheel, { passive: false });

        // 一時停止 / 再開
        this.btnPause.addEventListener('click', () => {
            this.isPaused = !this.isPaused;
            this.btnPause.textContent = this.isPaused ? '▶ 再開' : '⏸ 一時停止';
        });

        // リセット
        this.btnReset.addEventListener('click', () => {
            this.resetSimulation();
        });

        // 振子物理パラメータスライダー
        const setupSlider = (slider, valDisplay, key, decimals, unit = '', onChange = null) => {
            if (!slider) return;
            slider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.physics[key] = val;
                valDisplay.textContent = val.toFixed(decimals) + unit;
                this.updateBodeUI();
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

        // マスバネダンパー物理パラメータスライダー
        const setupMSDSlider = (slider, valDisplay, key, decimals, unit = '', onChange = null) => {
            if (!slider) return;
            slider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.msdPhysics[key] = val;
                const sign = (key === 'targetX' && val > 0) ? '+' : '';
                valDisplay.textContent = `${sign}${val.toFixed(decimals)}${unit}`;
                this.updateMSDCalculatedProperties();
                this.updateBodeUI();
                if (onChange) onChange(val);
            });
        };

        setupMSDSlider(this.msdInputs.m, this.msdInputs.mVal, 'm', 2, ' kg');
        setupMSDSlider(this.msdInputs.k, this.msdInputs.kVal, 'k', 1, ' N/m');
        setupMSDSlider(this.msdInputs.d, this.msdInputs.dVal, 'd', 2, ' Ns/m');
        setupMSDSlider(this.msdInputs.fMax, this.msdInputs.fMaxVal, 'fMax', 1, ' N');
        setupMSDSlider(this.msdInputs.targetX, this.msdInputs.targetXVal, 'targetX', 2, ' m', () => {
            this.holdingTime = 0.0;
            this.stabilized = false;
        });

        // PIDパラメータスライダー
        if (this.pidInputs.kp) {
            this.pidInputs.kp.addEventListener('input', (e) => {
                const pid = this.currentPID;
                pid.kp = parseFloat(e.target.value);
                this.pidInputs.kpVal.textContent = pid.kp.toFixed(1);
            });
            this.pidInputs.ki.addEventListener('input', (e) => {
                const pid = this.currentPID;
                pid.ki = parseFloat(e.target.value);
                this.pidInputs.kiVal.textContent = pid.ki.toFixed(1);
            });
            this.pidInputs.kd.addEventListener('input', (e) => {
                const pid = this.currentPID;
                pid.kd = parseFloat(e.target.value);
                this.pidInputs.kdVal.textContent = pid.kd.toFixed(1);
            });
        }

        // 振子プリセットボタン
        document.querySelectorAll('[data-preset]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.applyPendulumPreset(btn.dataset.preset);
            });
        });

        // MSDプリセットボタン
        document.querySelectorAll('[data-preset-msd]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.applyMSDPreset(btn.dataset.presetMsd);
            });
        });

        // PIDプリセットボタン
        document.querySelectorAll('.btn-pid-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const kp = parseFloat(btn.dataset.kp);
                const ki = parseFloat(btn.dataset.ki);
                const kd = parseFloat(btn.dataset.kd);
                const pid = this.currentPID;
                pid.kp = kp;
                pid.ki = ki;
                pid.kd = kd;
                this.updatePIDUI();
            });
        });
    }

    getResonanceOmega() {
        if (this.activeSystem === 'msd') {
            return this.msdPhysics.omegaN;
        } else {
            return Math.sqrt(Math.max(0.1, this.physics.g) / Math.max(0.1, this.physics.l));
        }
    }

    /**
     * システム切替（振子 ⇔ マス・バネ・ダンパー）
     */
    switchSystem(sysName) {
        if (this.activeSystem === sysName) return;
        this.activeSystem = sysName;

        // ボタンのアクティブ状態更新
        if (this.btnSysPendulum) this.btnSysPendulum.classList.toggle('active', sysName === 'pendulum');
        if (this.btnSysMSD) this.btnSysMSD.classList.toggle('active', sysName === 'msd');

        // チャートモード更新
        this.charts.setSystemMode(sysName);
        this.bodeAnalyzer.clearMeasurements();

        // UI表示の切替
        const isPendulum = sysName === 'pendulum';

        if (this.headerTitle) this.headerTitle.textContent = isPendulum ? '振子モータ制御' : 'マス・バネ・ダンパー系制御';
        if (this.simTitleText) this.simTitleText.textContent = isPendulum ? '振子シミュレーション (360°回転)' : 'マス・バネ・ダンパー系シミュレーション';
        if (this.controlInputLabel) this.controlInputLabel.textContent = isPendulum ? 'モータ出力:' : '入力外力:';
        if (this.scaleMinLabel) this.scaleMinLabel.textContent = isPendulum ? '◀ CCW (-100%)' : '◀ 引張 (-100%)';
        if (this.scaleMaxLabel) this.scaleMaxLabel.textContent = isPendulum ? 'CW (+100%) ▶' : '押出 (+100%) ▶';

        if (this.timeChartTitle) this.timeChartTitle.textContent = '時系列応答 (Time History)';
        if (this.timeChartSub) this.timeChartSub.textContent = isPendulum ? 'θ・θ_ref・τ' : 'x・x_ref・F';

        if (this.pidFormulaBadge) {
            this.pidFormulaBadge.textContent = isPendulum ? 'τ = Kp·e + Ki·∫e dt - Kd·ω' : 'F = Kp·e + Ki·∫e dt - Kd·v';
        }

        // カードの表示/非表示
        if (this.cardPendulumParams) this.cardPendulumParams.style.display = isPendulum ? 'block' : 'none';
        if (this.cardMSDParams) this.cardMSDParams.style.display = isPendulum ? 'none' : 'block';
        if (this.cardPendulumPresets) this.cardPendulumPresets.style.display = isPendulum ? 'block' : 'none';
        if (this.cardMSDPresets) this.cardMSDPresets.style.display = isPendulum ? 'none' : 'block';
        if (this.pidPresetsPendulum) this.pidPresetsPendulum.style.display = isPendulum ? 'flex' : 'none';
        if (this.pidPresetsMSD) this.pidPresetsMSD.style.display = isPendulum ? 'none' : 'flex';

        // 入力値とPIDのリセット
        this.appliedTau = 0.0;
        this.appliedForce = 0.0;
        this.isDragging = false;
        this.holdingTime = 0.0;
        this.stabilized = false;

        this.updatePIDUI();
        this.updateBodeUI();
        this.updateTransientUI();
        this.handleResize();
    }

    setDriveMode(mode) {
        this.driveMode = mode;
        const isAuto = mode === 'auto';
        const isBode = mode === 'bode';
        const isTransient = mode === 'transient';
        const isManual = mode === 'manual';

        this.btnDriveManual.classList.toggle('active', isManual);
        this.btnDriveAuto.classList.toggle('active', isAuto);
        if (this.btnDriveTransient) this.btnDriveTransient.classList.toggle('active', isTransient);
        if (this.btnDriveBode) this.btnDriveBode.classList.toggle('active', isBode);

        this.pidStatusBadge.style.display = isAuto ? 'inline-flex' : 'none';
        if (this.transientStatusBadge) this.transientStatusBadge.style.display = isTransient ? 'inline-flex' : 'none';
        if (this.bodeStatusBadge) this.bodeStatusBadge.style.display = isBode ? 'inline-flex' : 'none';

        // パネルの表示切り替え
        if (this.manualControlsPanel) this.manualControlsPanel.style.display = (isManual || isAuto) ? 'block' : 'none';
        if (this.transientControlsPanel) this.transientControlsPanel.style.display = isTransient ? 'flex' : 'none';
        if (this.bodeControlsPanel) this.bodeControlsPanel.style.display = isBode ? 'flex' : 'none';

        this.charts.setBodeMode(isBode);
        this.charts.setTransientMode(isTransient);

        if (isBode) {
            // 正弦波モード選択時は自動でボード線図サブタブへ切り替え
            this.setSecondaryChart('bode');
            this.bodeAnalyzer.stopSweep();
            if (this.btnBodeSweep) this.btnBodeSweep.textContent = '▶ 自動周波数スイープ (Bode測定)';
            // 初期周波数を共振周波数近傍に設定
            const wn = this.getResonanceOmega();
            this.bodeAnalyzer.setOmega(wn);
            if (this.paramBodeOmega) this.paramBodeOmega.value = wn.toFixed(2);
            this.updateBodeUI();
        } else if (isTransient) {
            this.bodeAnalyzer.stopSweep();
            this.updateTransientUI();
            this.startTransientExperiment();
        } else if (isAuto) {
            this.pendulumPid.reset();
            this.msdPid.reset();
            this.bodeAnalyzer.stopSweep();
        } else {
            this.bodeAnalyzer.stopSweep();
            if (this.sliderMode === 'spring') {
                this.appliedTau = 0.0;
                this.appliedForce = 0.0;
            }
        }
    }

    setTransientType(type) {
        this.transientManager.setResponseType(type);
        if (this.btnTrStepOpen) this.btnTrStepOpen.classList.toggle('active', type === 'step_open');
        if (this.btnTrStepClosed) this.btnTrStepClosed.classList.toggle('active', type === 'step_closed');
        if (this.btnTrImpulse) this.btnTrImpulse.classList.toggle('active', type === 'impulse');

        this.updateTransientUI();
        this.startTransientExperiment();
    }

    onTransientParamChange(val) {
        const isPendulum = this.activeSystem === 'pendulum';
        const type = this.transientManager.responseType;

        if (type === 'impulse') {
            if (isPendulum) this.transientManager.params.impulsePendulum = val;
            else this.transientManager.params.impulseMSD = val;
        } else if (type === 'step_open') {
            if (isPendulum) this.transientManager.params.stepTorquePendulum = val;
            else this.transientManager.params.stepForceMSD = val;
        } else if (type === 'step_closed') {
            if (isPendulum) this.transientManager.params.stepTargetPendulum = val;
            else this.transientManager.params.stepTargetMSD = val;
        }

        this.updateTransientUI();
    }

    startTransientExperiment() {
        this.charts.clear();
        const isPendulum = this.activeSystem === 'pendulum';
        const physics = isPendulum ? this.physics : this.msdPhysics;
        const pid = isPendulum ? this.pendulumPid : this.msdPid;

        this.transientManager.startExperiment(this.activeSystem, physics, pid);
        this.updateTransientUI();
    }

    applyQuickImpulse() {
        const isPendulum = this.activeSystem === 'pendulum';
        const physics = isPendulum ? this.physics : this.msdPhysics;
        this.transientManager.applyImpulse(physics, this.activeSystem);
        this.updateTransientUI();
    }

    applyQuickStep() {
        const isPendulum = this.activeSystem === 'pendulum';
        if (this.driveMode === 'auto') {
            if (isPendulum) {
                this.physics.targetAngleDeg = (this.physics.targetAngleDeg === 180 ? -180 : (this.physics.targetAngleDeg === 90 ? -90 : 90));
                if (this.inputs.targetDeg) this.inputs.targetDeg.value = this.physics.targetAngleDeg;
                if (this.inputs.targetDegVal) this.inputs.targetDegVal.textContent = this.physics.targetAngleDeg + '°';
            } else {
                this.msdPhysics.targetX = -this.msdPhysics.targetX;
                if (Math.abs(this.msdPhysics.targetX) < 0.1) this.msdPhysics.targetX = 0.5;
                if (this.msdInputs.targetX) this.msdInputs.targetX.value = this.msdPhysics.targetX;
                const sign = this.msdPhysics.targetX > 0 ? '+' : '';
                if (this.msdInputs.targetXVal) this.msdInputs.targetXVal.textContent = `${sign}${this.msdPhysics.targetX.toFixed(2)} m`;
            }
        } else if (this.driveMode === 'transient') {
            this.startTransientExperiment();
        } else {
            // Manual時: 出力を反転またはステップ
            if (isPendulum) {
                this.appliedTau = (this.appliedTau === 0) ? this.physics.tauMax * 0.5 : -this.appliedTau;
            } else {
                this.appliedForce = (this.appliedForce === 0) ? this.msdPhysics.fMax * 0.5 : -this.appliedForce;
            }
        }
    }

    updateTransientUI() {
        const isPendulum = this.activeSystem === 'pendulum';
        const type = this.transientManager.responseType;
        const tm = this.transientManager;

        // スライダーのラベル・範囲・値の更新
        if (this.transientParamLabel && this.paramTransientInput && this.valTransientParam) {
            if (type === 'impulse') {
                this.transientParamLabel.textContent = isPendulum ? 'インパルス撃力トルク (I_tau)' : 'インパルス撃力力積 (I)';
                const maxVal = isPendulum ? 15.0 : 10.0;
                const currentVal = isPendulum ? tm.params.impulsePendulum : tm.params.impulseMSD;
                this.paramTransientInput.min = 0.5;
                this.paramTransientInput.max = maxVal;
                this.paramTransientInput.step = 0.5;
                this.paramTransientInput.value = currentVal;
                this.valTransientParam.textContent = `${currentVal.toFixed(1)} ${isPendulum ? 'Nm·s' : 'N·s'}`;
            } else if (type === 'step_open') {
                this.transientParamLabel.textContent = isPendulum ? '外力ステップトルク (τ_step)' : '外力ステップ外力 (F_step)';
                const maxVal = isPendulum ? this.physics.tauMax : this.msdPhysics.fMax;
                const currentVal = isPendulum ? tm.params.stepTorquePendulum : tm.params.stepForceMSD;
                this.paramTransientInput.min = 1.0;
                this.paramTransientInput.max = maxVal;
                this.paramTransientInput.step = 0.5;
                this.paramTransientInput.value = currentVal;
                this.valTransientParam.textContent = `${currentVal.toFixed(1)} ${isPendulum ? 'Nm' : 'N'}`;
            } else if (type === 'step_closed') {
                this.transientParamLabel.textContent = isPendulum ? '目標ステップ角度 (θ_ref)' : '目標ステップ位置 (x_ref)';
                if (isPendulum) {
                    this.paramTransientInput.min = 30;
                    this.paramTransientInput.max = 180;
                    this.paramTransientInput.step = 15;
                    this.paramTransientInput.value = tm.params.stepTargetPendulum;
                    this.valTransientParam.textContent = `${tm.params.stepTargetPendulum.toFixed(0)}°`;
                } else {
                    this.paramTransientInput.min = 0.1;
                    this.paramTransientInput.max = 0.8;
                    this.paramTransientInput.step = 0.05;
                    this.paramTransientInput.value = tm.params.stepTargetMSD;
                    this.valTransientParam.textContent = `${tm.params.stepTargetMSD.toFixed(2)} m`;
                }
            }
        }

        // 理論予測テキストの更新
        if (this.transientTheoryText) {
            if (!isPendulum) {
                const props = tm.getMSDTheoreticalProperties(this.msdPhysics);
                if (type === 'step_open') {
                    const mpText = props.theoreticalMp > 0 ? `+${props.theoreticalMp.toFixed(1)}%` : '0%';
                    const tsText = isFinite(props.theoreticalTs) ? `${props.theoreticalTs.toFixed(2)}s` : '∞';
                    this.transientTheoryText.textContent = `理論最終値: ${props.xFinal.toFixed(2)}m | 理論Mp: ${mpText} | 理論ts: ${tsText}`;
                } else if (type === 'impulse') {
                    const period = (2 * Math.PI / props.wd).toFixed(2);
                    this.transientTheoryText.textContent = `固有角周波数 ωn: ${props.wn.toFixed(2)} rad/s | 減衰比 ζ: ${props.zeta.toFixed(2)} | 減衰周期 Td: ${period}s`;
                } else {
                    this.transientTheoryText.textContent = `PID目標位置: ${tm.params.stepTargetMSD.toFixed(2)}m (Kp=${this.msdPid.kp}, Ki=${this.msdPid.ki}, Kd=${this.msdPid.kd})`;
                }
            } else {
                this.transientTheoryText.textContent = isPendulum ? '振子モータ非線形力学系' : '';
            }
        }

        // HUDバッジの更新
        if (this.transientHudMp) {
            const mp = tm.metrics.overshootPercent;
            this.transientHudMp.textContent = (mp !== null && mp > 0) ? `Mp: +${mp.toFixed(1)}%` : 'Mp: --%';
        }
        if (this.transientHudTr) {
            const tr = tm.metrics.riseTime;
            this.transientHudTr.textContent = tr !== null ? `tr: ${tr.toFixed(2)}s` : 'tr: --s';
        }
        if (this.transientHudTs) {
            const ts = tm.metrics.settlingTime;
            this.transientHudTs.textContent = ts !== null ? `ts: ${ts.toFixed(2)}s` : (tm.metrics.isSettled ? 'ts: 整定済' : 'ts: --s');
        }
    }

    setSecondaryChart(type) {
        this.activeSecondaryChart = type;
        if (this.btnChartPhase) this.btnChartPhase.classList.toggle('active', type === 'phase');
        if (this.btnChartBode) this.btnChartBode.classList.toggle('active', type === 'bode');

        if (this.phaseCanvas) this.phaseCanvas.style.display = type === 'phase' ? 'block' : 'none';
        if (this.bodeCanvas) this.bodeCanvas.style.display = type === 'bode' ? 'block' : 'none';

        if (this.secondaryChartSub) {
            this.secondaryChartSub.textContent = type === 'phase' ? '平衡点と状態軌跡' : '周波数応答 (ゲイン & 位相)';
        }

        this.handleResize();
    }

    updateBodeUI() {
        const omega = this.bodeAnalyzer.omega;
        const fHz = omega / (2.0 * Math.PI);
        const period = (2.0 * Math.PI) / Math.max(0.01, omega);

        if (this.valBodeOmega) {
            this.valBodeOmega.textContent = `${omega.toFixed(2)} rad/s (${fHz.toFixed(2)} Hz, T=${period.toFixed(2)}s)`;
        }

        const amp = this.bodeAnalyzer.amplitude;
        const unit = this.activeSystem === 'msd' ? 'N' : 'Nm';
        if (this.valBodeAmp) {
            this.valBodeAmp.textContent = `${amp.toFixed(1)} ${unit}`;
        }
        if (this.bodeAmpLabel) {
            this.bodeAmpLabel.textContent = this.activeSystem === 'msd' ? '入力外力振幅 (Ain)' : 'モータトルク振幅 (Ain)';
        }

        const wn = this.getResonanceOmega();
        if (this.btnBodeJumpWn) {
            this.btnBodeJumpWn.textContent = `🎯 共振点へ (ωn=${wn.toFixed(2)})`;
        }

        if (this.bodeHudGain) {
            if (this.bodeAnalyzer.currentAmpOut > 0.001) {
                this.bodeHudGain.textContent = `ゲイン: ${this.bodeAnalyzer.currentGainDb.toFixed(1)} dB`;
            } else {
                this.bodeHudGain.textContent = 'ゲイン: -- dB';
            }
        }
        if (this.bodeHudPhase) {
            if (this.bodeAnalyzer.currentAmpOut > 0.001) {
                this.bodeHudPhase.textContent = `位相: ${this.bodeAnalyzer.currentPhaseDeg.toFixed(0)}°`;
            } else {
                this.bodeHudPhase.textContent = '位相: --°';
            }
        }
    }

    startBodeSweep() {
        const wn = this.getResonanceOmega();
        // 共振周波数近傍を密にした対数スイープ配列
        const sweepFreqs = [
            0.4, 0.8, 1.2, 1.8, 2.5,
            Math.max(0.5, wn * 0.85),
            wn,
            wn * 1.15,
            Math.min(25.0, wn * 1.5),
            5.0, 7.5, 11.0, 16.0, 22.0
        ].sort((a, b) => a - b);

        // 重複を除去
        const uniqueFreqs = sweepFreqs.filter((val, idx, arr) => idx === 0 || Math.abs(val - arr[idx - 1]) > 0.15);

        this.bodeAnalyzer.startSweep(uniqueFreqs);
        if (this.btnBodeSweep) this.btnBodeSweep.textContent = '⏹ スイープ停止';
    }

    setSliderMode(mode) {
        this.sliderMode = mode;
        this.btnSpringMode.classList.toggle('active', mode === 'spring');
        this.btnHoldMode.classList.toggle('active', mode === 'hold');
    }

    initSliderEvents() {
        const area = this.sliderArea;
        if (!area) return;

        const updateFromPointer = (clientX) => {
            const rect = area.getBoundingClientRect();
            const posX = Math.max(0, Math.min(rect.width, clientX - rect.left));
            const norm = (posX / rect.width) * 2.0 - 1.0;
            const inputVal = Math.max(-1.0, Math.min(1.0, norm));

            if (this.activeSystem === 'pendulum') {
                this.appliedTau = -inputVal * this.physics.tauMax;
            } else {
                this.appliedForce = inputVal * this.msdPhysics.fMax;
            }
        };

        const onStart = (e) => {
            if (this.driveMode === 'auto' || this.driveMode === 'bode') this.setDriveMode('manual');
            this.isSliderDragging = true;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            updateFromPointer(clientX);
            if (e.cancelable) e.preventDefault();
        };

        const onMove = (e) => {
            if (!this.isSliderDragging) return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            updateFromPointer(clientX);
            if (e.cancelable) e.preventDefault();
        };

        const onEnd = (e) => {
            if (this.isSliderDragging) {
                this.isSliderDragging = false;
                if (this.sliderMode === 'spring') {
                    this.appliedTau = 0.0;
                    this.appliedForce = 0.0;
                }
                if (e.cancelable) e.preventDefault();
            }
        };

        area.addEventListener('mousedown', onStart);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);

        area.addEventListener('touchstart', onStart, { passive: false });
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd, { passive: false });
        window.addEventListener('touchcancel', onEnd, { passive: false });
    }

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

            if (this.activeSystem === 'pendulum') {
                const bobInfo = this.renderer.getBobPosition(this.physics);
                const hitRadius = Math.max(32, bobInfo.radius * 2.0);
                const dist = Math.hypot(pos.x - bobInfo.x, pos.y - bobInfo.y);

                if (dist <= hitRadius) {
                    this.isDragging = true;
                    this.dragLastCoord = pos;
                    this.dragLastTime = performance.now();
                    if (e.cancelable) e.preventDefault();
                }
            } else {
                // マスバネダンパー系
                const massInfo = this.msdRenderer.getMassPosition(this.msdPhysics);
                const insideX = pos.x >= massInfo.left - 20 && pos.x <= massInfo.right + 20;
                const insideY = pos.y >= massInfo.top - 20 && pos.y <= massInfo.bottom + 20;

                if (insideX && insideY) {
                    this.isDragging = true;
                    this.dragLastCoord = pos;
                    this.dragLastTime = performance.now();
                    if (e.cancelable) e.preventDefault();
                }
            }
        };

        const onMove = (e) => {
            if (!this.isDragging) return;
            if (e.cancelable) e.preventDefault();

            const pos = getCanvasCoord(e);
            const now = performance.now();
            const dt = Math.max(0.005, (now - this.dragLastTime) / 1000.0);

            if (this.activeSystem === 'pendulum') {
                const metrics = this.renderer.getLayoutMetrics(this.physics);
                const dx = pos.x - metrics.pivotX;
                const dy = pos.y - metrics.pivotY;
                const targetTheta = Math.atan2(dx, dy);
                const diff = PendulumPhysics.normalizeAngle(targetTheta - this.physics.theta);
                this.physics.theta += diff;
                this.physics.omega = diff / dt;
            } else {
                const massInfo = this.msdRenderer.getMassPosition(this.msdPhysics);
                const newX = (pos.x - massInfo.centerX0) / massInfo.scalePxPerMeter;
                const clampedX = Math.max(-1.0, Math.min(1.2, newX));
                const dx = clampedX - this.msdPhysics.x;
                this.msdPhysics.x = clampedX;
                this.msdPhysics.v = dx / dt;
            }

            this.dragLastCoord = pos;
            this.dragLastTime = now;
        };

        const onEnd = (e) => {
            if (this.isDragging) {
                this.isDragging = false;
                if (this.activeSystem === 'pendulum') {
                    this.physics.omega = Math.max(-20, Math.min(20, this.physics.omega));
                } else {
                    this.msdPhysics.v = Math.max(-10, Math.min(10, this.msdPhysics.v));
                }
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

                const targetElem = document.getElementById(`tab-${targetTab}`);
                if (targetElem) {
                    targetElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }

                this.handleResize();
                setTimeout(() => this.handleResize(), 100);
            });
        });

        let scrollTimeout = null;
        window.addEventListener('scroll', () => {
            if (scrollTimeout) return;
            scrollTimeout = setTimeout(() => {
                scrollTimeout = null;
                const sections = ['sim', 'charts', 'settings'].map(id => document.getElementById(`tab-${id}`));
                const scrollPos = window.scrollY + 100;
                for (let i = sections.length - 1; i >= 0; i--) {
                    const sec = sections[i];
                    if (sec && sec.offsetTop <= scrollPos) {
                        const id = sec.id.replace('tab-', '');
                        tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === id));
                        break;
                    }
                }
            }, 60);
        }, { passive: true });
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
        if (this.renderer) this.renderer.resize();
        if (this.msdRenderer) this.msdRenderer.resize();
        if (this.charts) this.charts.resize();
        if (this.bodeRenderer) this.bodeRenderer.resize();
    }

    handleKeyDown(e) {
        if (e.target.tagName === 'INPUT') return;

        if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
            if (this.driveMode === 'auto') this.setDriveMode('manual');
            this.keyState.ArrowLeft = true;
            e.preventDefault();
        } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
            if (this.driveMode === 'auto') this.setDriveMode('manual');
            this.keyState.ArrowRight = true;
            e.preventDefault();
        } else if (e.code === 'Space') {
            if (this.driveMode === 'auto' || this.driveMode === 'bode') this.setDriveMode('manual');
            this.appliedTau = 0.0;
            this.appliedForce = 0.0;
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
     * トルクまたは入力外力の更新およびスライダーUI同期
     */
    updateAppliedInput(dt) {
        if (this.driveMode === 'transient') {
            const isPendulum = this.activeSystem === 'pendulum';
            const physics = isPendulum ? this.physics : this.msdPhysics;
            const pid = isPendulum ? this.pendulumPid : this.msdPid;

            const u = this.transientManager.computeInput(dt, physics, this.activeSystem, pid);

            if (isPendulum) {
                this.appliedTau = u;
                if (!this.isDragging) {
                    this.physics.update(dt, u);
                }
            } else {
                this.appliedForce = u;
                if (!this.isDragging) {
                    this.msdPhysics.update(dt, u);
                }
            }

            this.updateTransientUI();
            return;
        }

        if (this.driveMode === 'bode') {
            // 正弦波モード: BodeAnalyzerからの加振信号 u(t) を入力
            const u = this.bodeAnalyzer.updateInput(dt);

            if (this.activeSystem === 'pendulum') {
                this.appliedTau = u;
                if (!this.isDragging) {
                    this.physics.update(dt, u);
                }
                // 出力は角度 [rad]
                const yRad = this.physics.normalizedThetaDeg * (Math.PI / 180.0);
                this.bodeAnalyzer.processSample(u, yRad, dt);
            } else {
                this.appliedForce = u;
                if (!this.isDragging) {
                    this.msdPhysics.update(dt, u);
                }
                // 出力は変位 [m]
                this.bodeAnalyzer.processSample(u, this.msdPhysics.x, dt);
            }

            // Bode用HUDおよびスライダー表示の同期
            this.updateBodeUI();
            if (this.paramBodeOmega) {
                this.paramBodeOmega.value = this.bodeAnalyzer.omega.toFixed(2);
            }
            if (!this.bodeAnalyzer.isSweeping && this.btnBodeSweep) {
                this.btnBodeSweep.textContent = '▶ 自動周波数スイープ (Bode測定)';
            }
            return;
        }

        if (this.activeSystem === 'pendulum') {
            // === 振子系 ===
            if (this.driveMode === 'auto') {
                const targetRad = this.physics.targetAngleRad;
                const currentRad = this.physics.theta;
                const omega = this.physics.omega;
                this.appliedTau = this.pendulumPid.compute(targetRad, currentRad, omega, dt, this.physics.tauMax);
            } else {
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

                if (this.sliderMode === 'spring' && !this.isSliderDragging && !this.keyState.ArrowLeft && !this.keyState.ArrowRight) {
                    this.appliedTau += (0 - this.appliedTau) * Math.min(1.0, dt * 10.0);
                    if (Math.abs(this.appliedTau) < 0.005) this.appliedTau = 0.0;
                }
            }

            if (!this.isDragging) {
                this.physics.update(dt, this.appliedTau);
            }

            // スライダー表示同期
            const maxVal = Math.max(0.1, this.physics.tauMax);
            const ratio = Math.max(-1.0, Math.min(1.0, this.appliedTau / maxVal));
            const thumbPosPercent = (0.5 - ratio * 0.5) * 100;
            this.sliderThumb.style.left = `${thumbPosPercent}%`;

            if (ratio >= 0) {
                const width = ratio * 50;
                this.gaugeFill.className = 'gauge-fill ccw';
                this.gaugeFill.style.left = `${50 - width}%`;
                this.gaugeFill.style.width = `${width}%`;
                this.torqueText.className = ratio > 0.01 ? 'torque-val-badge ccw' : 'torque-val-badge';
            } else {
                const width = Math.abs(ratio) * 50;
                this.gaugeFill.className = 'gauge-fill cw';
                this.gaugeFill.style.left = '50%';
                this.gaugeFill.style.width = `${width}%`;
                this.torqueText.className = 'torque-val-badge cw';
            }

            const sign = this.appliedTau > 0 ? '+' : '';
            this.torqueText.textContent = `${sign}${this.appliedTau.toFixed(2)} Nm (${sign}${(ratio * 100).toFixed(0)}%)`;

        } else {
            // === マス・バネ・ダンパー系 ===
            if (this.driveMode === 'auto') {
                const targetX = this.msdPhysics.targetX;
                const currentX = this.msdPhysics.x;
                const vel = this.msdPhysics.v;
                this.appliedForce = this.msdPid.compute(targetX, currentX, vel, dt, this.msdPhysics.fMax);
            } else {
                if (this.keyState.ArrowLeft && !this.keyState.ArrowRight) {
                    this.keyHoldDurationLeft += dt;
                    const rate = Math.min(1.0, this.keyHoldDurationLeft / 0.3);
                    this.appliedForce = Math.max(-this.msdPhysics.fMax, this.appliedForce - this.msdPhysics.fMax * dt * 2.2 * (0.3 + 0.7 * rate));
                } else {
                    this.keyHoldDurationLeft = 0;
                }

                if (this.keyState.ArrowRight && !this.keyState.ArrowLeft) {
                    this.keyHoldDurationRight += dt;
                    const rate = Math.min(1.0, this.keyHoldDurationRight / 0.3);
                    this.appliedForce = Math.min(this.msdPhysics.fMax, this.appliedForce + this.msdPhysics.fMax * dt * 2.2 * (0.3 + 0.7 * rate));
                } else {
                    this.keyHoldDurationRight = 0;
                }

                if (this.sliderMode === 'spring' && !this.isSliderDragging && !this.keyState.ArrowLeft && !this.keyState.ArrowRight) {
                    this.appliedForce += (0 - this.appliedForce) * Math.min(1.0, dt * 10.0);
                    if (Math.abs(this.appliedForce) < 0.005) this.appliedForce = 0.0;
                }
            }

            if (!this.isDragging) {
                this.msdPhysics.update(dt, this.appliedForce);
            }

            // スライダー表示同期 (右方向がプラス)
            const maxVal = Math.max(0.1, this.msdPhysics.fMax);
            const ratio = Math.max(-1.0, Math.min(1.0, this.appliedForce / maxVal));
            const thumbPosPercent = (0.5 + ratio * 0.5) * 100;
            this.sliderThumb.style.left = `${thumbPosPercent}%`;

            if (ratio >= 0) {
                const width = ratio * 50;
                this.gaugeFill.className = 'gauge-fill cw'; // 右向き (プラス)
                this.gaugeFill.style.left = '50%';
                this.gaugeFill.style.width = `${width}%`;
                this.torqueText.className = ratio > 0.01 ? 'torque-val-badge cw' : 'torque-val-badge';
            } else {
                const width = Math.abs(ratio) * 50;
                this.gaugeFill.className = 'gauge-fill ccw'; // 左向き (マイナス)
                this.gaugeFill.style.left = `${50 - width}%`;
                this.gaugeFill.style.width = `${width}%`;
                this.torqueText.className = 'torque-val-badge ccw';
            }

            const sign = this.appliedForce > 0 ? '+' : '';
            this.torqueText.textContent = `${sign}${this.appliedForce.toFixed(2)} N (${sign}${(ratio * 100).toFixed(0)}%)`;
        }
    }

    updateStabilization(dt) {
        if (this.isDragging || this.driveMode === 'bode') {
            this.holdingTime = 0.0;
            this.stabilized = false;
            return;
        }

        let isWithin = false;

        if (this.activeSystem === 'pendulum') {
            const errDeg = Math.abs(this.physics.angleErrorDeg);
            const omega = Math.abs(this.physics.omega);
            isWithin = errDeg <= this.angleToleranceDeg && omega <= this.omegaTolerance;
        } else {
            const errM = Math.abs(this.msdPhysics.error);
            const vel = Math.abs(this.msdPhysics.v);
            isWithin = errM <= this.posToleranceM && vel <= this.velToleranceM;
        }

        if (isWithin) {
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
        if (this.activeSystem === 'pendulum') {
            this.physics.reset(0, 0);
            this.pendulumPid.reset();
            this.appliedTau = 0.0;
        } else {
            this.msdPhysics.reset(0, 0);
            this.msdPid.reset();
            this.appliedForce = 0.0;
        }
        this.charts.clear();
        this.bodeAnalyzer.clearMeasurements();
        this.holdingTime = 0.0;
        this.stabilized = false;
    }

    applyPendulumPreset(presetKey) {
        const p = this.pendulumPresets[presetKey];
        if (!p) return;

        this.physics.l = p.l;
        this.physics.m = p.m;
        this.physics.tauMax = p.tauMax;
        this.physics.c = p.c;
        this.physics.g = p.g;
        this.physics.targetAngleDeg = p.targetDeg;

        this.updateParamUIFromPhysics();
        this.resetSimulation();
        this.updateBodeUI();
    }

    applyMSDPreset(presetKey) {
        const p = this.msdPresets[presetKey];
        if (!p) return;

        this.msdPhysics.m = p.m;
        this.msdPhysics.k = p.k;
        this.msdPhysics.d = p.d;
        this.msdPhysics.fMax = p.fMax;
        this.msdPhysics.targetX = p.targetX;

        this.updateMSDParamUI();
        this.resetSimulation();
        this.updateBodeUI();
    }

    updateParamUIFromPhysics() {
        if (!this.inputs.l) return;
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

    updateMSDParamUI() {
        if (!this.msdInputs.m) return;
        this.msdInputs.m.value = this.msdPhysics.m;
        this.msdInputs.mVal.textContent = this.msdPhysics.m.toFixed(2) + ' kg';

        this.msdInputs.k.value = this.msdPhysics.k;
        this.msdInputs.kVal.textContent = this.msdPhysics.k.toFixed(1) + ' N/m';

        this.msdInputs.d.value = this.msdPhysics.d;
        this.msdInputs.dVal.textContent = this.msdPhysics.d.toFixed(2) + ' Ns/m';

        this.msdInputs.fMax.value = this.msdPhysics.fMax;
        this.msdInputs.fMaxVal.textContent = this.msdPhysics.fMax.toFixed(1) + ' N';

        this.msdInputs.targetX.value = this.msdPhysics.targetX;
        const sign = this.msdPhysics.targetX > 0 ? '+' : '';
        this.msdInputs.targetXVal.textContent = `${sign}${this.msdPhysics.targetX.toFixed(2)} m`;

        this.updateMSDCalculatedProperties();
    }

    updateMSDCalculatedProperties() {
        if (!this.msdInputs.calcWn) return;
        this.msdInputs.calcWn.textContent = this.msdPhysics.omegaN.toFixed(2);
        this.msdInputs.calcZeta.textContent = this.msdPhysics.zeta.toFixed(2);
        this.msdInputs.calcDamping.textContent = this.msdPhysics.dampingTypeLabel;
    }

    updatePIDUI() {
        if (!this.pidInputs.kp) return;
        const pid = this.currentPID;
        this.pidInputs.kp.value = pid.kp;
        this.pidInputs.kpVal.textContent = pid.kp.toFixed(1);

        this.pidInputs.ki.value = pid.ki;
        this.pidInputs.kiVal.textContent = pid.ki.toFixed(1);

        this.pidInputs.kd.value = pid.kd;
        this.pidInputs.kdVal.textContent = pid.kd.toFixed(1);
    }

    loop(timestamp) {
        const elapsed = (timestamp - this.lastTimestamp) / 1000.0;
        this.lastTimestamp = timestamp;

        const dt = Math.min(elapsed, 0.05);

        if (!this.isPaused && dt > 0) {
            this.updateAppliedInput(dt);
            this.updateStabilization(dt);

            this.chartSampleTimer += dt;
            if (this.chartSampleTimer >= this.chartSampleInterval) {
                if (this.activeSystem === 'pendulum') {
                    this.charts.addSample(this.physics);
                } else {
                    this.charts.addSample(this.msdPhysics);
                }
                this.chartSampleTimer = 0.0;
            }
        }

        const status = {
            holdingTime: this.holdingTime,
            holdingProgress: Math.min(1.0, this.holdingTime / this.requiredHoldTime),
            stabilized: this.stabilized,
            isDragging: this.isDragging
        };

        if (this.activeSystem === 'pendulum') {
            this.renderer.draw(this.physics, status);
            this.charts.render(this.physics, this.bodeAnalyzer, this.transientManager);
        } else {
            this.msdRenderer.draw(this.msdPhysics, status);
            this.charts.render(this.msdPhysics, this.bodeAnalyzer, this.transientManager);
        }

        if (this.activeSecondaryChart === 'bode') {
            this.bodeRenderer.draw(this.bodeAnalyzer, this.activeSystem, this.currentPhysics);
        }

        requestAnimationFrame((t) => this.loop(t));
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new ControlApp();
});
