/**
 * physics.js - 振子とモータの物理モデルおよび数値計算（RK4）
 * 
 * 運動方程式:
 *   J * d2θ/dt2 + c * dθ/dt + m * g * l * sin(θ) = τ
 * ここで、棒の質量を無視した場合の慣性モーメント J = m * l^2
 *   d2θ/dt2 = (τ - c * dθ/dt - m * g * l * sin(θ)) / (m * l^2)
 *
 * 角度規約:
 *   θ = 0 rad (0°)     : 鉛直下向き（自然な安定釣り合い点）
 *   θ = π rad (180°)   : 鉛直上向き（倒立状態、不安定釣り合い点）
 *   反時計回り (CCW)   : 正方向 (+)
 *   時計回り (CW)     : 負方向 (-)
 */

export class PendulumPhysics {
    constructor() {
        // 物理パラメータ初期値
        this.l = 1.0;            // 棒の長さ [m]
        this.m = 1.0;            // 先端質量 [kg]
        this.g = 9.80665;        // 重力加速度 [m/s^2]
        this.c = 0.15;           // 粘性減衰係数 [N*m*s/rad]
        this.tauMax = 6.0;       // モーター最大トルク [N*m]
        this.targetAngleDeg = 180; // 目標角度 [deg] (初期値: 倒立振子)

        // 状態変数
        this.theta = 0.0;        // 振子角度 [rad] (多回転対応、連続値)
        this.omega = 0.0;        // 角速度 [rad/s]
        this.alpha = 0.0;        // 角加速度 [rad/s^2]
        this.tau = 0.0;          // 現在の印加トルク [N*m]

        // シミュレーション時刻
        this.time = 0.0;
    }

    /**
     * 慣性モーメント J = m * l^2 [kg*m^2]
     */
    get J() {
        return Math.max(0.001, this.m * this.l * this.l);
    }

    /**
     * 重力による最大トルク m * g * l [N*m]
     * (トルクがこれ未満だと最下点から一発で倒立に持ち上げられず、スイングアップが必要になる)
     */
    get gravityTorqueMax() {
        return this.m * this.g * this.l;
    }

    /**
     * 現在の角加速度を計算（状態微分関数）
     * @param {number} theta 角度 [rad]
     * @param {number} omega 角速度 [rad/s]
     * @param {number} tau 印加トルク [N*m]
     * @returns {number} 角加速度 alpha [rad/s^2]
     */
    computeAlpha(theta, omega, tau) {
        // トルクのサチュレーション（モーター最大トルク制限）
        const clampedTau = Math.max(-this.tauMax, Math.min(this.tauMax, tau));
        
        // 運動方程式: d2θ/dt2 = (τ - c*ω - m*g*l*sin(θ)) / J
        const torqueGravity = -this.m * this.g * this.l * Math.sin(theta);
        const torqueDamping = -this.c * omega;
        const totalTorque = clampedTau + torqueDamping + torqueGravity;

        return totalTorque / this.J;
    }

    /**
     * 4次ルンゲ＝クッタ法（Runge-Kutta 4th Order）による数値積分
     * @param {number} dt 時間刻み [s]
     * @param {number} appliedTau 操作入力トルク [N*m]
     */
    stepRK4(dt, appliedTau) {
        // トルクを記録
        this.tau = Math.max(-this.tauMax, Math.min(this.tauMax, appliedTau));

        const th0 = this.theta;
        const om0 = this.omega;
        const tau = this.tau;

        // k1
        const k1_th = om0;
        const k1_om = this.computeAlpha(th0, om0, tau);

        // k2
        const th_k2 = th0 + 0.5 * dt * k1_th;
        const om_k2 = om0 + 0.5 * dt * k1_om;
        const k2_th = om_k2;
        const k2_om = this.computeAlpha(th_k2, om_k2, tau);

        // k3
        const th_k3 = th0 + 0.5 * dt * k2_th;
        const om_k3 = om0 + 0.5 * dt * k2_om;
        const k3_th = om_k3;
        const k3_om = this.computeAlpha(th_k3, om_k3, tau);

        // k4
        const th_k4 = th0 + dt * k3_th;
        const om_k4 = om0 + dt * k3_om;
        const k4_th = om_k4;
        const k4_om = this.computeAlpha(th_k4, om_k4, tau);

        // 状態更新
        this.theta += (dt / 6.0) * (k1_th + 2.0 * k2_th + 2.0 * k3_th + k4_th);
        this.omega += (dt / 6.0) * (k1_om + 2.0 * k2_om + 2.0 * k3_om + k4_om);
        this.alpha = this.computeAlpha(this.theta, this.omega, this.tau);
        this.time += dt;
    }

    /**
     * サブステップによる安定した時間発展
     * @param {number} totalDt 進める合計時間 [s]
     * @param {number} appliedTau 操作トルク [N*m]
     */
    update(totalDt, appliedTau) {
        // 刻み幅を小さく分割して積分精度を保つ（sub-stepping）
        const subDt = 0.002; // 2ms刻み
        let remaining = totalDt;
        while (remaining > 0) {
            const dt = Math.min(remaining, subDt);
            this.stepRK4(dt, appliedTau);
            remaining -= dt;
        }
    }

    /**
     * 状態のリセット
     * @param {number} initialThetaDeg 初期角度 [deg]
     * @param {number} initialOmega 初期角速度 [rad/s]
     */
    reset(initialThetaDeg = 0, initialOmega = 0) {
        this.theta = (initialThetaDeg * Math.PI) / 180.0;
        this.omega = initialOmega;
        this.alpha = 0.0;
        this.tau = 0.0;
        this.time = 0.0;
    }

    /**
     * 角度を [-π, π] または [-180°, 180°] の範囲に正規化
     * @param {number} angleRad 角度 [rad]
     * @returns {number} 正規化された角度 [-π, π]
     */
    static normalizeAngle(angleRad) {
        let a = angleRad % (2 * Math.PI);
        if (a > Math.PI) a -= 2 * Math.PI;
        if (a <= -Math.PI) a += 2 * Math.PI;
        return a;
    }

    /**
     * 目標角度 [rad]
     */
    get targetAngleRad() {
        return (this.targetAngleDeg * Math.PI) / 180.0;
    }

    /**
     * 目標角度との最短角度偏差 e = θ - θ_target [-π, π]
     */
    get angleError() {
        return PendulumPhysics.normalizeAngle(this.theta - this.targetAngleRad);
    }

    /**
     * 目標角度との最短角度偏差 [deg]
     */
    get angleErrorDeg() {
        return (this.angleError * 180.0) / Math.PI;
    }

    /**
     * 正規化された現在角度 [-180°, 180°]
     */
    get normalizedThetaDeg() {
        return (PendulumPhysics.normalizeAngle(this.theta) * 180.0) / Math.PI;
    }

    /**
     * 0°〜360°表記の現在角度
     */
    get theta360Deg() {
        let deg = (this.theta * 180.0) / Math.PI % 360.0;
        if (deg < 0) deg += 360.0;
        return deg;
    }

    /**
     * 運動エネルギー T = 1/2 * J * ω^2 [J]
     */
    get kineticEnergy() {
        return 0.5 * this.J * this.omega * this.omega;
    }

    /**
     * 位置エネルギー V = m * g * l * (1 - cos(θ)) [J] (最下点を 0 J とする)
     */
    get potentialEnergy() {
        return this.m * this.g * this.l * (1.0 - Math.cos(this.theta));
    }

    /**
     * 総力学的エネルギー E = T + V [J]
     */
    get totalEnergy() {
        return this.kineticEnergy + this.potentialEnergy;
    }

    /**
     * 目標姿勢での位置エネルギー [J]
     */
    get targetEnergy() {
        return this.m * this.g * this.l * (1.0 - Math.cos(this.targetAngleRad));
    }
}
