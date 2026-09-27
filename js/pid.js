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
        this.kp = 25.0; // 比例ゲイン
        this.ki = 4.0;  // 積分ゲイン
        this.kd = 6.0;  // 微分ゲイン

        // 角度モード（true: [-π, π] でラップ, false: 線形偏差）
        this.angleMode = true;

        // 内部状態
        this.integral = 0.0;
        this.maxIntegral = 20.0; // アンチワインドアップ上限
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
     * 制御出力を計算
     * @param {number} target 目標値 (角度 [rad] または 位置 [m])
     * @param {number} current 現在値 (角度 [rad] または 位置 [m])
     * @param {number} velocity 現在速度 (角速度 [rad/s] または 速度 [m/s])
     * @param {number} dt サンプリング時間 [s]
     * @param {number} maxOutput 最大出力 (トルク [Nm] または 外力 [N])
     * @returns {number} 制御出力
     */
    compute(target, current, velocity, dt, maxOutput) {
        if (dt <= 0) return 0;

        // 1. 偏差 e の算出
        let error = target - current;
        if (this.angleMode) {
            error = PendulumPhysics.normalizeAngle(error);
        }

        // 2. P項 (比例)
        this.pTerm = this.kp * error;

        // 3. I項 (積分 + アンチワインドアップ)
        this.integral += error * dt;
        // 積分上限クリッピング
        this.integral = Math.max(-this.maxIntegral, Math.min(this.maxIntegral, this.integral));
        this.iTerm = this.ki * this.integral;

        // 4. D項 (速度フィードバック: de/dt = -v)
        this.dTerm = -this.kd * velocity;

        // 5. 合計制御出力
        let u = this.pTerm + this.iTerm + this.dTerm;

        // 6. 出力サチュレーション
        this.output = Math.max(-maxOutput, Math.min(maxOutput, u));

        // 出力が飽和している場合は、積分項の増加を抑止（クランピング式アンチワインドアップ）
        if ((u > maxOutput && error > 0) || (u < -maxOutput && error < 0)) {
            this.integral -= error * dt;
        }

        this.lastError = error;
        return this.output;
    }
}
