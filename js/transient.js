/**
 * transient.js - インパルス応答・ステップ応答管理＆リアルタイム過渡特性解析
 * （マス・バネ・ダンパー系 & 振子モータ制御系 両対応）
 */

export class TransientManager {
    constructor() {
        // 応答タイプ: 'impulse' (インパルス) | 'step_open' (外力ステップ・開ループ) | 'step_closed' (目標値ステップ・PID閉ループ)
        this.responseType = 'step_open';

        // パラメータ
        this.params = {
            // インパルス力積 [N·s] または [N·m·s]
            impulseMSD: 3.0,       // マスバネ系力積 [N·s]
            impulsePendulum: 3.0,  // 振子系力積トルク [N·m·s]
            
            // 開ループステップ外力 [N] または [N·m]
            stepForceMSD: 6.0,      // マスバネ系ステップ外力 [N]
            stepTorquePendulum: 5.0,// 振子系ステップトルク [N·m]

            // 閉ループステップ目標値 [m] または [deg]
            stepTargetMSD: 0.5,     // マスバネ系目標変位 [m]
            stepTargetPendulum: 90.0 // 振子系目標角度 [deg]
        };

        // 実行状態
        this.isRunning = false;
        this.elapsedTime = 0.0;
        this.y0 = 0.0;             // 開始時の出力値
        this.targetFinal = 0.0;    // 目標値または予想最終値
        this.samples = [];         // [{ t, y, v, u }]

        // インパルス印加マーカー情報 (時系列グラフ描画用)
        this.lastImpulseTime = -1.0;
        this.lastImpulseValue = 0.0;

        // 過渡特性メトリクス (リアルタイム解析)
        this.metrics = {
            peakVal: null,         // 最大ピーク値 y_max
            peakTime: null,        // ピーク到達時間 t_p [s]
            overshootPercent: null,// オーバーシュート率 M_p [%]
            riseTime: null,        // 立ち上がり時間 t_r [s] (10% -> 90%)
            settlingTime: null,    // 整定時間 t_s [s] (±2% または ±5% バンド)
            steadyStateError: null,// 定常偏差 e_ss
            isSettled: false,      // 整定完了フラグ
            toleranceBand: 0.02    // 整定判定バンド (±2%)
        };
    }

    /**
     * 応答タイプを設定
     * @param {'impulse' | 'step_open' | 'step_closed'} type 
     */
    setResponseType(type) {
        this.responseType = type;
        this.resetMetrics();
    }

    /**
     * メトリクスと履歴をリセット
     */
    resetMetrics() {
        this.samples = [];
        this.elapsedTime = 0.0;
        this.t10 = null;
        this.t90 = null;
        this.metrics = {
            peakVal: null,
            peakTime: null,
            overshootPercent: null,
            riseTime: null,
            settlingTime: null,
            steadyStateError: null,
            isSettled: false,
            toleranceBand: 0.02
        };
    }

    /**
     * 実験を開始（初期状態にリセットして応答測定をスタート）
     * @param {'pendulum' | 'msd'} systemMode 
     * @param {object} physics 
     * @param {object} pidController 
     */
    startExperiment(systemMode, physics, pidController) {
        this.resetMetrics();
        this.isRunning = true;
        this.elapsedTime = 0.0;

        const isPendulum = systemMode === 'pendulum';

        if (isPendulum) {
            // 振子系を初期状態（下向き静止）にリセット
            physics.reset(0, 0);
            this.y0 = 0.0; // 0 deg

            if (this.responseType === 'impulse') {
                // インパルス応答: t=0 で瞬間角力積を与える: Δω = I_tau / J
                const impulse = this.params.impulsePendulum;
                const J = physics.J;
                const deltaOmega = impulse / Math.max(0.01, J);
                physics.omega += deltaOmega;
                this.lastImpulseTime = 0.0;
                this.lastImpulseValue = impulse;
                this.targetFinal = 0.0; // 最終的に下向き0°に戻る
            } else if (this.responseType === 'step_open') {
                // 開ループステップ応答: 外力トルクを印加
                this.targetFinal = 0.0; // 非線形振子のため目標値は運動依存
            } else if (this.responseType === 'step_closed') {
                // 閉ループステップ応答: PIDの目標角度を設定
                const targetDeg = this.params.stepTargetPendulum;
                physics.targetAngleDeg = targetDeg;
                this.targetFinal = targetDeg;
                if (pidController) pidController.reset();
            }
        } else {
            // マス・バネ・ダンパー系を初期状態（自然長・静止）にリセット
            physics.reset(0, 0);
            this.y0 = 0.0; // 0 m

            if (this.responseType === 'impulse') {
                // インパルス応答: t=0 で瞬間力積を与える: Δv = I / m
                const impulse = this.params.impulseMSD;
                const m = physics.m;
                const deltaV = impulse / Math.max(0.01, m);
                physics.v += deltaV;
                this.lastImpulseTime = 0.0;
                this.lastImpulseValue = impulse;
                this.targetFinal = 0.0; // 最終的に自然長0mに戻る
            } else if (this.responseType === 'step_open') {
                // 開ループステップ応答: 外力 F_step を印加
                const fStep = this.params.stepForceMSD;
                // 理論最終値: x_final = F / K
                this.targetFinal = fStep / Math.max(0.1, physics.k);
            } else if (this.responseType === 'step_closed') {
                // 閉ループステップ応答: 目標位置を設定
                const targetX = this.params.stepTargetMSD;
                physics.targetX = targetX;
                this.targetFinal = targetX;
                if (pidController) pidController.reset();
            }
        }
    }

    /**
     * 現在の状態のまま瞬間的に力積（インパルス撃力）を加える
     * @param {object} physics 
     * @param {'pendulum' | 'msd'} systemMode 
     * @param {number|null} customImpulse 
     */
    applyImpulse(physics, systemMode, customImpulse = null) {
        const isPendulum = systemMode === 'pendulum';
        if (isPendulum) {
            const impulse = customImpulse !== null ? customImpulse : this.params.impulsePendulum;
            const J = physics.J;
            physics.omega += impulse / Math.max(0.01, J);
            this.lastImpulseTime = physics.time;
            this.lastImpulseValue = impulse;
        } else {
            const impulse = customImpulse !== null ? customImpulse : this.params.impulseMSD;
            const m = physics.m;
            physics.v += impulse / Math.max(0.01, m);
            this.lastImpulseTime = physics.time;
            this.lastImpulseValue = impulse;
        }
    }

    /**
     * 毎フレームの制御入力計算
     * @param {number} dt 
     * @param {object} physics 
     * @param {'pendulum' | 'msd'} systemMode 
     * @param {object} pidController 
     * @returns {number} applied input (tau or force)
     */
    computeInput(dt, physics, systemMode, pidController) {
        if (!this.isRunning) {
            return 0.0;
        }

        this.elapsedTime += dt;
        const isPendulum = systemMode === 'pendulum';
        let u = 0.0;

        if (this.responseType === 'impulse') {
            // インパルス応答時は初期撃力後の継続入力は0
            u = 0.0;
        } else if (this.responseType === 'step_open') {
            // 開ループステップ入力
            u = isPendulum ? this.params.stepTorquePendulum : this.params.stepForceMSD;
        } else if (this.responseType === 'step_closed') {
            // 閉ループPID制御
            if (pidController) {
                if (isPendulum) {
                    const targetRad = physics.targetAngleRad;
                    const currentRad = physics.theta;
                    u = pidController.compute(targetRad, currentRad, physics.omega, dt, physics.tauMax);
                } else {
                    const targetX = physics.targetX;
                    const currentX = physics.x;
                    u = pidController.compute(targetX, currentX, physics.v, dt, physics.fMax);
                }
            }
        }

        // サンプル記録
        const y = isPendulum ? physics.normalizedThetaDeg : physics.x;
        const v = isPendulum ? physics.omega : physics.v;
        this.samples.push({
            t: this.elapsedTime,
            y: y,
            v: v,
            u: u
        });

        // 過去の多すぎるサンプルは間引き（直近1000件）
        if (this.samples.length > 1000) {
            this.samples.shift();
        }

        // リアルタイム解析
        this.analyzeMetrics(y, v, isPendulum);

        return u;
    }

    /**
     * 過渡特性メトリクスの解析
     * @param {number} currentY 
     * @param {number} currentV 
     * @param {boolean} isPendulum 
     */
    analyzeMetrics(currentY, currentV, isPendulum) {
        if (this.samples.length < 5) return;

        const m = this.metrics;
        const stepMag = this.targetFinal - this.y0;
        const isStep = this.responseType === 'step_open' || this.responseType === 'step_closed';

        if (isStep && Math.abs(stepMag) > 0.001) {
            const sign = stepMag > 0 ? 1 : -1;

            // 1. 最大ピーク値 & オーバーシュート (オンライン追跡)
            const currentNormVal = (currentY - this.y0) * sign;
            if (m.peakVal === null || currentNormVal > (m.peakVal - this.y0) * sign) {
                m.peakVal = currentY;
                m.peakTime = this.elapsedTime;

                const finalNorm = Math.abs(stepMag);
                if (currentNormVal > finalNorm) {
                    m.overshootPercent = ((currentNormVal - finalNorm) / finalNorm) * 100.0;
                } else {
                    m.overshootPercent = 0.0;
                }
            }

            // 2. 立ち上がり時間 (10% -> 90%)
            const val10 = this.y0 + stepMag * 0.1;
            const val90 = this.y0 + stepMag * 0.9;

            if (this.t10 === undefined || this.t10 === null) {
                if (sign > 0 ? currentY >= val10 : currentY <= val10) {
                    this.t10 = this.elapsedTime;
                }
            }
            if (this.t90 === undefined || this.t90 === null) {
                if (sign > 0 ? currentY >= val90 : currentY <= val90) {
                    this.t90 = this.elapsedTime;
                }
            }

            if (this.t10 !== null && this.t10 !== undefined && this.t90 !== null && this.t90 !== undefined && this.t90 >= this.t10) {
                m.riseTime = this.t90 - this.t10;
            }

            // 3. 整定時間 (±2% または ±5% バンド)
            // 最後のサンプルから遡って、バンド外に出た一番遅い時刻を探す
            const bandVal = Math.max(0.005, Math.abs(stepMag) * m.toleranceBand);
            let lastOutOfBandTime = 0.0;
            let settled = true;

            for (let i = 0; i < this.samples.length; i++) {
                const s = this.samples[i];
                const err = Math.abs(s.y - this.targetFinal);
                if (err > bandVal) {
                    lastOutOfBandTime = s.t;
                }
            }

            // 経過時間が十分あり、現在バンド内かつ速度が十分小さければ整定
            const currentErr = Math.abs(currentY - this.targetFinal);
            const isNearZeroVel = Math.abs(currentV) < (isPendulum ? 0.05 : 0.02);

            if (this.elapsedTime > 0.5 && currentErr <= bandVal && isNearZeroVel) {
                m.settlingTime = lastOutOfBandTime;
                m.isSettled = true;
            } else {
                m.settlingTime = null;
                m.isSettled = false;
            }

            // 4. 定常偏差
            m.steadyStateError = Math.abs(currentY - this.targetFinal);

        } else if (this.responseType === 'impulse') {
            // インパルス応答の解析 (オンライン追跡)
            const absVal = Math.abs(currentY);
            if (m.peakVal === null || absVal > m.peakVal) {
                m.peakVal = absVal;
                m.peakTime = this.elapsedTime;
            }

            // 振幅が最大ピークの 5% 以下に収束した時間を整定時間とする
            const thresh = Math.max(0.005, (m.peakVal || 0.1) * 0.05);
            let lastOut = 0.0;
            for (const s of this.samples) {
                if (Math.abs(s.y) > thresh) {
                    lastOut = s.t;
                }
            }

            if (this.elapsedTime > 0.5 && Math.abs(currentY) <= thresh && Math.abs(currentV) < 0.02) {
                m.settlingTime = lastOut;
                m.isSettled = true;
            }
        }
    }

    /**
     * マス・バネ・ダンパー系の理論過渡特性を算出
     * @param {object} msdPhysics 
     * @returns {object}
     */
    getMSDTheoreticalProperties(msdPhysics) {
        const m = msdPhysics.m;
        const k = msdPhysics.k;
        const d = msdPhysics.d;

        const wn = Math.sqrt(k / m);
        const zeta = d / (2 * Math.sqrt(m * k));

        let theoreticalMp = 0;
        let theoreticalTp = null;
        let theoreticalTs = null; // 2%バンド
        let wd = wn;

        if (zeta < 1.0 && zeta >= 0) {
            wd = wn * Math.sqrt(1 - zeta * zeta);
            if (zeta > 0) {
                theoreticalMp = Math.exp(-Math.PI * zeta / Math.sqrt(1 - zeta * zeta)) * 100.0;
                theoreticalTp = Math.PI / wd;
                theoreticalTs = 4.0 / (zeta * wn);
            } else {
                theoreticalMp = 100.0; // 非減衰
                theoreticalTp = Math.PI / wn;
                theoreticalTs = Infinity;
            }
        }

        const stepForce = this.params.stepForceMSD;
        const xFinal = stepForce / k;

        return {
            wn,
            zeta,
            wd,
            theoreticalMp,
            theoreticalTp,
            theoreticalTs,
            xFinal
        };
    }
}
