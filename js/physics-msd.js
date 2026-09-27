/**
 * physics-msd.js - マス・バネ・ダンパー系の物理モデルおよび数値計算（RK4）
 *
 * 運動方程式:
 *   m * d2x/dt2 + D * dx/dt + K * x = F
 *   d2x/dt2 = (F - D * v - K * x) / m
 *
 * 物理量:
 *   x       : 変位 [m] (つり合い位置・自然長を x = 0 とする)
 *   v       : 速度 [m/s]
 *   a       : 加速度 [m/s^2]
 *   m       : 質量 [kg]
 *   K       : ばね定数 [N/m]
 *   D       : 粘性減衰係数 [N*s/m]
 *   F       : 外力 [N] (|F| <= Fmax)
 *   xtarget : 目標変位 [m]
 *
 * 制御工学的パラメータ:
 *   固有角周波数 ωn = sqrt(K / m) [rad/s]
 *   減衰比       ζ  = D / (2 * sqrt(m * K))
 */

export class MassSpringDamperPhysics {
    constructor() {
        // 物理パラメータ初期値
        this.m = 1.0;            // 質量 [kg]
        this.k = 12.0;           // ばね定数 K [N/m]
        this.d = 1.2;            // 減衰係数 D [N*s/m] (ζ ≈ 0.17: 典型的な不足減衰)
        this.fMax = 20.0;        // 最大入力外力 [N]
        this.targetX = 0.5;      // 目標位置 [m] (初期値: +0.5m)

        // 状態変数
        this.x = 0.0;            // 変位 [m] (初期: つり合い位置)
        this.v = 0.0;            // 速度 [m/s]
        this.a = 0.0;            // 加速度 [m/s^2]
        this.f = 0.0;            // 現在の入力外力 [N]

        // シミュレーション時刻
        this.time = 0.0;
    }

    /**
     * 固有角周波数 ωn = sqrt(K / m) [rad/s]
     */
    get omegaN() {
        return Math.sqrt(Math.max(0.001, this.k) / Math.max(0.001, this.m));
    }

    /**
     * 減衰比 ζ = D / (2 * sqrt(m * K))
     */
    get zeta() {
        const denom = 2.0 * Math.sqrt(Math.max(0.001, this.m) * Math.max(0.001, this.k));
        return this.d / denom;
    }

    /**
     * 減衰特性の日本語ラベル
     */
    get dampingTypeLabel() {
        const z = this.zeta;
        if (z < 0.001) return '非減衰 (ζ=0)';
        if (z < 0.95) return `不足減衰 (ζ=${z.toFixed(2)})`;
        if (z <= 1.05) return `臨界減衰 (ζ=${z.toFixed(2)})`;
        return `過減衰 (ζ=${z.toFixed(2)})`;
    }

    /**
     * 運動エネルギー T = 1/2 * m * v^2 [J]
     */
    get kineticEnergy() {
        return 0.5 * this.m * this.v * this.v;
    }

    /**
     * 弾性ポテンシャルエネルギー V = 1/2 * K * x^2 [J]
     */
    get potentialEnergy() {
        return 0.5 * this.k * this.x * this.x;
    }

    /**
     * 力学的総エネルギー E = T + V [J]
     */
    get totalEnergy() {
        return this.kineticEnergy + this.potentialEnergy;
    }

    /**
     * 目標位置との偏差 e = targetX - x [m]
     */
    get error() {
        return this.targetX - this.x;
    }

    /**
     * 現在の加速度 a を計算（状態微分関数）
     * @param {number} x 変位 [m]
     * @param {number} v 速度 [m/s]
     * @param {number} f 入力外力 [N]
     * @returns {number} 加速度 a [m/s^2]
     */
    computeAcceleration(x, v, f) {
        const clampedF = Math.max(-this.fMax, Math.min(this.fMax, f));
        const springForce = -this.k * x;
        const damperForce = -this.d * v;
        const totalForce = clampedF + damperForce + springForce;
        return totalForce / Math.max(0.01, this.m);
    }

    /**
     * 4次ルンゲ＝クッタ法（RK4）による数値積分
     * @param {number} dt 時間刻み [s]
     * @param {number} appliedForce 入力外力 [N]
     */
    stepRK4(dt, appliedForce) {
        this.f = Math.max(-this.fMax, Math.min(this.fMax, appliedForce));

        const x0 = this.x;
        const v0 = this.v;
        const f = this.f;

        // k1
        const k1_x = v0;
        const k1_v = this.computeAcceleration(x0, v0, f);

        // k2
        const x_k2 = x0 + 0.5 * dt * k1_x;
        const v_k2 = v0 + 0.5 * dt * k1_v;
        const k2_x = v_k2;
        const k2_v = this.computeAcceleration(x_k2, v_k2, f);

        // k3
        const x_k3 = x0 + 0.5 * dt * k2_x;
        const v_k3 = v0 + 0.5 * dt * k2_v;
        const k3_x = v_k3;
        const k3_v = this.computeAcceleration(x_k3, v_k3, f);

        // k4
        const x_k4 = x0 + dt * k3_x;
        const v_k4 = v0 + dt * k3_v;
        const k4_x = v_k4;
        const k4_v = this.computeAcceleration(x_k4, v_k4, f);

        // 状態更新
        this.x += (dt / 6.0) * (k1_x + 2.0 * k2_x + 2.0 * k3_x + k4_x);
        this.v += (dt / 6.0) * (k1_v + 2.0 * k2_v + 2.0 * k3_v + k4_v);
        this.a = this.computeAcceleration(this.x, this.v, this.f);
        this.time += dt;
    }

    /**
     * サブステップによる安定した時間発展
     * @param {number} totalDt 進める合計時間 [s]
     * @param {number} appliedForce 入力外力 [N]
     */
    update(totalDt, appliedForce) {
        const subDt = 0.002;
        let remaining = totalDt;
        while (remaining > 0) {
            const dt = Math.min(remaining, subDt);
            this.stepRK4(dt, appliedForce);
            remaining -= dt;
        }
    }

    /**
     * 状態のリセット
     * @param {number} initialX 初期位置 [m]
     * @param {number} initialV 初期速度 [m/s]
     */
    reset(initialX = 0.0, initialV = 0.0) {
        this.x = initialX;
        this.v = initialV;
        this.a = 0.0;
        this.f = 0.0;
        this.time = 0.0;
    }
}
