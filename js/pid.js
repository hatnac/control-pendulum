/**
 * pid.js - 振子位置制御用 PIDコントローラ
 *
 * 制御則:
 *   u(t) = Kp * e(t) + Ki * ∫ e(t) dt - Kd * ω(t)
 * 
 * 特徴:
 * - 角度の360°周期性を考慮した最短偏差 e(t) ∈ [-π, π] の算出
 * - 微分項は角速度 ω を直接フィードバック（微分キック防止＆高S/N比）
 * - モータ最大トルク飽和時のアンチワインドアップ (Anti-windup)
 */

import { PendulumPhysics } from './physics.js';

export class PIDController {
    constructor() {
        // デフォルトゲイン設定（標準振子 1m, 1kg の倒立・位置決めに最適化）
        this.kp = 25.0; // 比例ゲイン [Nm/rad]
        this.ki = 4.0;  // 積分ゲイン [Nm/(rad*s)]
        this.kd = 6.0;  // 微分ゲイン [Nm*s/rad]

        // 内部状態
        this.integral = 0.0;
        this.maxIntegral = 8.0; // アンチワインドアップ上限
        this.lastError = 0.0;

        // 各項の現在値（デバッグ＆表示用）
        this.pTerm = 0.0;
        this.iTerm = 0.0;
        this.dTerm = 0.0;
        this.output = 0.0;
    }

    /**
     * 積分器と内部状態のリセット
     */
    reset() {
        this.integral = 0.0;
        this.lastError = 0.0;
        this.pTerm = 0.0;
        this.iTerm = 0.0;
        this.dTerm = 0.0;
        this.output = 0.0;
    }

    /**
     * トルク出力を計算
     * @param {number} targetAngleRad 目標角度 [rad]
     * @param {number} currentAngleRad 現在角度 [rad]
     * @param {number} omega 現在角速度 [rad/s]
     * @param {number} dt サンプリング時間 [s]
     * @param {number} tauMax 最大トルク [Nm]
     * @returns {number} 制御出力トルク τ [Nm]
     */
    compute(targetAngleRad, currentAngleRad, omega, dt, tauMax) {
        if (dt <= 0) return 0;

        // 1. 最短角度偏差 e ∈ [-π, π]
        // 正: 目標が反時計回り(CCW)側にある => 正トルクを出して引き上げる
        // 負: 目標が時計回り(CW)側にある => 負トルクを出して引き戻す
        const error = PendulumPhysics.normalizeAngle(targetAngleRad - currentAngleRad);

        // 2. P項 (比例)
        this.pTerm = this.kp * error;

        // 3. I項 (積分 + アンチワインドアップ)
        this.integral += error * dt;
        // 積分上限クリッピング
        this.integral = Math.max(-this.maxIntegral, Math.min(this.maxIntegral, this.integral));
        this.iTerm = this.ki * this.integral;

        // 4. D項 (角速度フィードバック: de/dt = -ω)
        // 角度が増加している時(ω>0)は反対方向のブレーキ(-Kd * ω)をかける
        this.dTerm = -this.kd * omega;

        // 5. 合計制御出力
        let u = this.pTerm + this.iTerm + this.dTerm;

        // 6. 出力サチュレーション
        this.output = Math.max(-tauMax, Math.min(tauMax, u));

        // トルクが飽和している場合は、積分項の増加を抑止（クランピング式アンチワインドアップ）
        if ((u > tauMax && error > 0) || (u < -tauMax && error < 0)) {
            this.integral -= error * dt;
        }

        this.lastError = error;
        return this.output;
    }
}
