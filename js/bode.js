/**
 * bode.js - 周波数応答解析・正弦波入力生成・直交検波（振幅＆位相推定）および自動スイープ
 */

export class BodeAnalyzer {
    constructor() {
        // 正弦波入力パラメータ
        this.omega = 3.5;          // 角周波数 ω [rad/s] (初期値: MSD系の固有周波数近傍)
        this.amplitude = 4.0;      // 入力振幅 Ain [N] または [Nm]
        this.time = 0.0;           // 正弦波の経過時間 [s]

        // リアルタイム直交検波（Fourier相関法による振幅・位相推定）
        this.sampleBuffer = [];    // { t, u, y } のリングバッファ
        this.currentAmpOut = 0.0;
        this.currentGainDb = 0.0;
        this.currentPhaseDeg = 0.0;
        this.isSettled = false;    // 定常状態に達したか

        // 実測プロット履歴
        // 各要素: { omega, gainDb, phaseDeg, ampIn, ampOut }
        this.measurements = [];

        // 自動スイープ（Auto Sweep）ステートマシン
        this.isSweeping = false;
        this.sweepFrequencies = [
            0.5, 0.8, 1.2, 1.8, 2.5, 3.0, 3.46, 4.0, 5.0, 6.5, 8.5, 12.0, 16.0, 22.0
        ];
        this.sweepIndex = 0;
        this.sweepState = 'settling'; // 'settling' (過渡待ち) | 'measuring' (測定中)
        this.stateTimer = 0.0;
        this.settleDuration = 2.0;    // 過渡待ち時間 [s]
        this.measureDuration = 2.0;   // 測定積算時間 [s]

        // 直交積分の積算器
        this.sumSin = 0.0;
        this.sumCos = 0.0;
        this.sumCount = 0;
    }

    /**
     * 正弦波入力信号 u(t) = Ain * sin(ω * t) を計算
     * @param {number} dt 時間刻み [s]
     * @returns {number} 入力値
     */
    updateInput(dt) {
        this.time += dt;
        const u = this.amplitude * Math.sin(this.omega * this.time);
        return u;
    }

    /**
     * 周波数の設定（手動変更時）
     */
    setOmega(omega) {
        if (Math.abs(this.omega - omega) > 1e-4) {
            this.omega = Math.max(0.1, Math.min(40.0, omega));
            this.sampleBuffer = [];
            this.fourierBuffer = [];
            this.sumSin = 0.0;
            this.sumCos = 0.0;
            this.sumCount = 0;
            this.stateTimer = 0.0;
        }
    }

    /**
     * 入力振幅の設定
     */
    setAmplitude(amp) {
        this.amplitude = Math.max(0.1, amp);
    }

    /**
     * 測定点のクリア
     */
    clearMeasurements() {
        this.measurements = [];
    }

    /**
     * 現在の周波数における測定点を記録
     */
    recordCurrentPoint() {
        if (this.currentAmpOut <= 0.001) return null;
        const pt = {
            omega: this.omega,
            gainDb: this.currentGainDb,
            phaseDeg: this.currentPhaseDeg,
            ampIn: this.amplitude,
            ampOut: this.currentAmpOut
        };

        // 既存の近い周波数の測定点があれば更新、なければ追加して昇順ソート
        const existingIdx = this.measurements.findIndex(p => Math.abs(p.omega - this.omega) / this.omega < 0.05);
        if (existingIdx >= 0) {
            this.measurements[existingIdx] = pt;
        } else {
            this.measurements.push(pt);
            this.measurements.sort((a, b) => a.omega - b.omega);
        }
        return pt;
    }

    /**
     * 自動スイープの開始
     */
    startSweep(customFrequencies = null) {
        if (customFrequencies && customFrequencies.length > 0) {
            this.sweepFrequencies = [...customFrequencies];
        }
        this.isSweeping = true;
        this.sweepIndex = 0;
        this.clearMeasurements();
        this.applySweepIndex(0);
    }

    /**
     * 自動スイープの停止
     */
    stopSweep() {
        this.isSweeping = false;
    }

    applySweepIndex(index) {
        if (index >= this.sweepFrequencies.length) {
            this.isSweeping = false;
            return;
        }
        this.sweepIndex = index;
        this.setOmega(this.sweepFrequencies[index]);
        this.sweepState = 'settling';
        this.stateTimer = 0.0;

        // 周波数に応じた適切な過渡待ち時間（周期の1.5〜2.5倍、最低1.2s）
        const period = (2.0 * Math.PI) / this.omega;
        this.settleDuration = Math.max(1.2, period * 2.0);
        this.measureDuration = Math.max(1.0, period * 2.0);
        this.sumSin = 0.0;
        this.sumCos = 0.0;
        this.sumCount = 0;
    }

    /**
     * 毎ステップの物理出力 y を観測し、直交検波で振幅比と位相差をリアルタイム同定
     * @param {number} u 入力値
     * @param {number} y 出力値 (変位 x または 角度 θ)
     * @param {number} dt 時間刻み [s]
     */
    processSample(u, y, dt) {
        this.stateTimer += dt;

        // 1周期分のバッファを保持（時系列波形の表示用）
        const period = (2.0 * Math.PI) / this.omega;
        this.sampleBuffer.push({ t: this.time, u, y });
        const maxBufferDuration = Math.max(period * 3.0, 3.0);
        while (this.sampleBuffer.length > 0 && (this.time - this.sampleBuffer[0].t) > maxBufferDuration) {
            this.sampleBuffer.shift();
        }

        // 直交検波用のサンプル履歴（直近1周期分を保持）
        if (!this.fourierBuffer) this.fourierBuffer = [];
        this.fourierBuffer.push({ t: this.time, y, dt });

        // 直近1周期 T のデータのみ残す
        while (this.fourierBuffer.length > 0 && (this.time - this.fourierBuffer[0].t) > period) {
            this.fourierBuffer.shift();
        }

        // 1周期分のサンプルが集まったら正確なフーリエ直交積分を実行
        if (this.fourierBuffer.length >= 8 && (this.time - this.fourierBuffer[0].t) >= period * 0.92) {
            let sumSin = 0.0;
            let sumCos = 0.0;
            let totalDt = 0.0;

            for (let i = 0; i < this.fourierBuffer.length; i++) {
                const s = this.fourierBuffer[i];
                const sVal = Math.sin(this.omega * s.t);
                const cVal = Math.cos(this.omega * s.t);
                sumSin += s.y * sVal * s.dt;
                sumCos += s.y * cVal * s.dt;
                totalDt += s.dt;
            }

            if (totalDt > 0.001) {
                const I = (2.0 / totalDt) * sumSin;
                const Q = (2.0 / totalDt) * sumCos;

                this.currentAmpOut = Math.sqrt(I * I + Q * Q);
                const gain = this.currentAmpOut / Math.max(1e-4, this.amplitude);
                this.currentGainDb = 20.0 * Math.log10(Math.max(1e-4, gain));

                // 位相: y(t) = I*sin(ωt) + Q*cos(ωt) => atan2(Q, I)
                let phaseRad = Math.atan2(Q, I);
                let phaseDeg = phaseRad * (180.0 / Math.PI);
                if (phaseDeg > 15.0) phaseDeg -= 360.0;
                this.currentPhaseDeg = phaseDeg;
            }
        }

        // 自動スイープの進行管理
        if (this.isSweeping) {
            if (this.sweepState === 'settling') {
                if (this.stateTimer >= this.settleDuration) {
                    this.sweepState = 'measuring';
                    this.stateTimer = 0.0;
                    this.sumSin = 0.0;
                    this.sumCos = 0.0;
                    this.sumCount = 0;
                }
            } else if (this.sweepState === 'measuring') {
                if (this.stateTimer >= this.measureDuration) {
                    // 計測完了、プロットに追加
                    this.recordCurrentPoint();
                    // 次の周波数へ
                    this.applySweepIndex(this.sweepIndex + 1);
                }
            }
        }
    }

    /**
     * 理論ボード線図の計算
     * @param {string} systemType 'msd' | 'pendulum'
     * @param {object} physics 物理インスタンス
     * @param {Array<number>} omegaRange 周波数の配列
     */
    static computeTheoreticalBode(systemType, physics, omegaRange) {
        const result = [];

        if (systemType === 'msd') {
            // マス・バネ・ダンパー系: G(s) = 1 / (m*s^2 + D*s + K)
            const m = physics.m;
            const k = physics.k;
            const d = physics.d;

            for (const w of omegaRange) {
                const real = k - m * w * w;
                const imag = d * w;
                const denomMag = Math.sqrt(real * real + imag * imag);
                const gain = 1.0 / denomMag;
                const gainDb = 20.0 * Math.log10(gain);

                // 位相差: -atan2(imag, real)
                let phaseRad = -Math.atan2(imag, real);
                let phaseDeg = phaseRad * (180.0 / Math.PI);

                result.push({ omega: w, gainDb, phaseDeg });
            }
        } else {
            // 振子系 (微小角近似): G(s) = 1 / (J*s^2 + c*s + mgl)
            const J = physics.m * physics.l * physics.l;
            const c = physics.c;
            const mgl = physics.m * physics.g * physics.l;

            for (const w of omegaRange) {
                const real = mgl - J * w * w;
                const imag = c * w;
                const denomMag = Math.sqrt(real * real + imag * imag);
                const gain = 1.0 / denomMag;
                const gainDb = 20.0 * Math.log10(gain);

                let phaseRad = -Math.atan2(imag, real);
                let phaseDeg = phaseRad * (180.0 / Math.PI);

                result.push({ omega: w, gainDb, phaseDeg });
            }
        }

        return result;
    }
}
