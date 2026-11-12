/**
 * bode.js - 周波数応答解析・正弦波入力生成・直交検波（振幅＆位相推定）および自動スイープ
 * 学習支援（開ループ/閉ループ比較・フェーザ位相情報・物理現象リアルタイム解説）対応
 */

export class BodeAnalyzer {
    constructor() {
        // 正弦波入力パラメータ
        this.omega = 3.5;          // 角周波数 ω [rad/s] (初期値: MSD系の固有周波数近傍)
        this.amplitude = 4.0;      // 入力振幅 Ain (開ループ: [N]/[Nm], 閉ループ: [m]/[rad])
        this.time = 0.0;           // 正弦波の経過時間 [s]

        // 制御ループ種別 ('open': 外力加振開ループ | 'closed': PID目標追従閉ループ)
        this.loopType = 'open';

        // リアルタイム直交検波（Fourier相関法による振幅・位相推定）
        this.sampleBuffer = [];    // { t, u, y } のリングバッファ
        this.fourierBuffer = [];
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
     * ループ種別の切り替え ('open' | 'closed')
     */
    setLoopType(loopType) {
        if (this.loopType !== loopType) {
            this.loopType = loopType;
            this.stopSweep();
            this.clearMeasurements();
            this.resetBuffers();
        }
    }

    /**
     * 検波バッファのリセット
     */
    resetBuffers() {
        this.sampleBuffer = [];
        this.fourierBuffer = [];
        this.sumSin = 0.0;
        this.sumCos = 0.0;
        this.sumCount = 0;
        this.stateTimer = 0.0;
        this.currentAmpOut = 0.0;
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
     * 現在の入力正弦波位相 θ(t) = (ω * t) mod 2π [rad]
     */
    getCurrentInputPhaseRad() {
        return (this.omega * this.time) % (2.0 * Math.PI);
    }

    /**
     * 周波数の設定（手動変更時）
     */
    setOmega(omega) {
        const clamped = Math.max(0.1, Math.min(40.0, omega));
        if (Math.abs(this.omega - clamped) > 1e-4) {
            this.omega = clamped;
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
        this.amplitude = Math.max(0.05, amp);
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
                this.currentGainDb = Math.max(-100, Math.min(100, 20.0 * Math.log10(Math.max(1e-4, gain))));

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
     * 単一周波数点での理論周波数伝達関数 G(jω) または T(jω) を計算
     */
    static evaluatePoint(w, systemType, physics, loopType = 'open', pid = null) {
        let invRe, invIm;
        if (systemType === 'msd') {
            invRe = physics.k - physics.m * w * w;
            invIm = physics.d * w;
        } else {
            const J = physics.m * physics.l * physics.l;
            const mgl = physics.m * physics.g * physics.l;
            invRe = mgl - J * w * w;
            invIm = physics.c * w;
        }

        if (loopType === 'closed' && pid) {
            // PIDControllerは微分キック防止のため出力速度フィードバックを採用:
            // U(s) = (Kp + Ki/s) R(s) - (Kp + Ki/s + Kd*s) Y(s)
            // よって T(s) = (Kp + Ki/s) / (1/G(s) + Kp + Ki/s + Kd*s)
            const wSafe = Math.max(1e-4, w);
            const numRe = pid.kp;
            const numIm = -pid.ki / wSafe;

            const denRe = invRe + pid.kp;
            const denIm = invIm + (pid.kd * w - pid.ki / wSafe);
            const denMagSq = Math.max(1e-10, denRe * denRe + denIm * denIm);

            const tRe = (numRe * denRe + numIm * denIm) / denMagSq;
            const tIm = (numIm * denRe - numRe * denIm) / denMagSq;
            const gain = Math.sqrt(tRe * tRe + tIm * tIm);
            const gainDb = Math.max(-100, Math.min(100, 20.0 * Math.log10(Math.max(1e-6, gain))));

            let phaseDeg = Math.atan2(tIm, tRe) * (180.0 / Math.PI);
            if (phaseDeg > 15.0) phaseDeg -= 360.0;
            return { omega: w, gain, gainDb, phaseDeg };
        } else {
            // 開ループ G(jω) = 1 / (invRe + j*invIm)
            const denomMag = Math.max(1e-6, Math.sqrt(invRe * invRe + invIm * invIm));
            const gain = 1.0 / denomMag;
            const gainDb = Math.max(-100, Math.min(100, 20.0 * Math.log10(Math.max(1e-6, gain))));
            const phaseDeg = -Math.atan2(invIm, invRe) * (180.0 / Math.PI);
            return { omega: w, gain, gainDb, phaseDeg };
        }
    }

    /**
     * 理論ボード線図の計算
     * @param {string} systemType 'msd' | 'pendulum'
     * @param {object} physics 物理インスタンス
     * @param {Array<number>} omegaRange 周波数の配列
     * @param {string} loopType 'open' | 'closed'
     * @param {object} pid PIDControllerインスタンス (closed時)
     */
    static computeTheoreticalBode(systemType, physics, omegaRange, loopType = 'open', pid = null) {
        const result = [];
        for (const w of omegaRange) {
            const pt = BodeAnalyzer.evaluatePoint(w, systemType, physics, loopType, pid);
            result.push({ omega: pt.omega, gainDb: pt.gainDb, phaseDeg: pt.phaseDeg });
        }
        return result;
    }

    /**
     * システムの基本周波数特性（固有角周波数 ωn, 減衰比 ζ, DCゲイン, 共振ピーク, 帯域幅 ωB）を算出
     */
    static computeSystemCharacteristics(systemType, physics, loopType = 'open', pid = null) {
        let wn = 1.0;
        let zeta = 0.1;
        let dcGain = 1.0;

        if (systemType === 'msd') {
            wn = Math.sqrt(physics.k / Math.max(1e-4, physics.m));
            zeta = physics.d / Math.max(1e-4, 2.0 * Math.sqrt(physics.m * physics.k));
            dcGain = loopType === 'closed'
                ? ((pid && pid.ki > 0) ? 1.0 : (pid ? pid.kp / Math.max(1e-4, physics.k + pid.kp) : 1.0))
                : 1.0 / Math.max(1e-4, physics.k);
        } else {
            const J = Math.max(1e-4, physics.m * physics.l * physics.l);
            const mgl = physics.m * physics.g * physics.l;
            wn = Math.sqrt(Math.max(0.01, physics.g / Math.max(1e-4, physics.l)));
            zeta = mgl > 1e-4 ? (physics.c / (2.0 * Math.sqrt(J * mgl))) : 0.1;
            dcGain = loopType === 'closed'
                ? ((pid && pid.ki > 0) ? 1.0 : (pid ? pid.kp / Math.max(1e-4, mgl + pid.kp) : 1.0))
                : 1.0 / Math.max(1e-4, mgl);
        }

        const dcGainDb = 20.0 * Math.log10(Math.max(1e-6, dcGain));

        // 理論カーブ走査による共振ピークおよび -3dB カットオフ（帯域幅 ωB）の検出
        let peakGainDb = -Infinity;
        let peakOmega = wn;
        let bandwidthOmega = null;

        const N = 160;
        const logMin = Math.log10(0.15);
        const logMax = Math.log10(35.0);
        const targetCutoffDb = dcGainDb - 3.0;
        let prevGainDb = null;
        let prevW = null;

        for (let i = 0; i < N; i++) {
            const w = Math.pow(10, logMin + (i / (N - 1)) * (logMax - logMin));
            const pt = BodeAnalyzer.evaluatePoint(w, systemType, physics, loopType, pid);
            if (pt.gainDb > peakGainDb) {
                peakGainDb = pt.gainDb;
                peakOmega = w;
            }
            if (prevGainDb !== null && prevGainDb >= targetCutoffDb && pt.gainDb < targetCutoffDb && bandwidthOmega === null) {
                // 線形補間で正確な -3dB 交点を取得
                const frac = (prevGainDb - targetCutoffDb) / Math.max(1e-6, prevGainDb - pt.gainDb);
                bandwidthOmega = prevW + frac * (w - prevW);
            }
            prevGainDb = pt.gainDb;
            prevW = w;
        }

        return {
            wn,
            zeta,
            dcGain,
            dcGainDb,
            peakGainDb,
            peakOmega,
            bandwidthOmega
        };
    }

    /**
     * 学習支援用: 現在の周波数状態に応じた物理的解釈・フェーザ比較・倍率情報を返す
     */
    getLearningInsight(systemType, physics, pid = null) {
        const chars = BodeAnalyzer.computeSystemCharacteristics(systemType, physics, this.loopType, pid);
        const theoryPt = BodeAnalyzer.evaluatePoint(this.omega, systemType, physics, this.loopType, pid);

        const hasMeasurement = this.currentAmpOut > 0.001;
        const gainDb = hasMeasurement ? this.currentGainDb : theoryPt.gainDb;
        const phaseDeg = hasMeasurement ? this.currentPhaseDeg : theoryPt.phaseDeg;
        const ampRatio = Math.pow(10, gainDb / 20.0);
        const staticAmp = this.amplitude * chars.dcGain;
        const staticAmpRatio = staticAmp > 1e-5 ? (ampRatio * this.amplitude) / staticAmp : 1.0;

        // 周期の分数としての遅れ表現
        const absPhase = Math.abs(phaseDeg);
        let cycleDelayLabel = '同位相';
        if (absPhase < 15) cycleDelayLabel = 'ほぼ同位相 (遅れ小)';
        else if (absPhase < 70) cycleDelayLabel = `約 ${(absPhase / 360).toFixed(2)} 周期遅れ`;
        else if (absPhase <= 110) cycleDelayLabel = '約 1/4 周期遅れ (直交)';
        else if (absPhase < 160) cycleDelayLabel = `約 ${(absPhase / 360).toFixed(2)} 周期遅れ`;
        else cycleDelayLabel = '約 1/2 周期遅れ (逆位相)';

        const refOmega = this.loopType === 'closed' && chars.bandwidthOmega ? chars.bandwidthOmega : chars.wn;
        const ratioW = this.omega / Math.max(0.05, refOmega);

        let region = 'resonance';
        let regionLabel = '';
        let title = '';
        let description = '';

        if (this.loopType === 'open') {
            if (ratioW < 0.6) {
                region = 'low';
                regionLabel = '低周波域 (追従・同位相)';
                title = `🟢 低周波域 (ω < ωn): 力と同じ向きに素直についていく状態`;
                description = `入力がゆっくりなため、ばねの復元力と外力が釣り合いながら動き、位相遅れが小さく(${phaseDeg.toFixed(0)}°)、静的変位とほぼ同じ振幅(×${staticAmpRatio.toFixed(2)}倍)で追従します。`;
            } else if (ratioW <= 1.45) {
                region = 'resonance';
                regionLabel = '共振域 (ω ≈ ωn)';
                title = `🔥 共振点付近 (ω ≈ ${chars.wn.toFixed(2)} rad/s): エネルギー注入が最大！`;
                description = chars.zeta < 0.7
                    ? `ばねの復元力と慣性力が打ち消し合い、外力と速度の向きが一致（位相 -90°付近）！ブランコをタイミング良く押すのと同じ原理で、静的変位の ${staticAmpRatio.toFixed(2)}倍 に増幅されています。`
                    : `固有角周波数付近で位相が -90° になります。減衰比 ζ=${chars.zeta.toFixed(2)} が大きいためダンパーが揺れを抑え込み、共振ピークは抑えられています。`;
            } else {
                region = 'high';
                regionLabel = '高周波域 (遮断・逆位相)';
                title = `🔴 高周波域 (ω > ωn): 慣性で追いつけず逆向き＆減衰`;
                description = `入力の切り替わりが速すぎて重りの慣性が追いつけず、入力と真逆の動き（逆位相 ${phaseDeg.toFixed(0)}°）になります。振幅は静的変位の ${staticAmpRatio.toFixed(2)}倍 に急減衰（ローパス特性: -40dB/dec）します。`;
            }
        } else {
            // 閉ループ PID 周波数応答の解説
            const bwText = chars.bandwidthOmega ? `${chars.bandwidthOmega.toFixed(2)} rad/s` : '--';
            if (ratioW < 0.75) {
                region = 'low';
                regionLabel = 'PID追従帯域内';
                title = `🤖 追従帯域内 (ω < ωB=${bwText}): 目標の波を正確にトレース中`;
                description = `PIDフィードバック制御によりゲインは約 0dB（倍率 ${ampRatio.toFixed(2)}倍 = 目標振幅にほぼ一致）、位相遅れも小さく、目標正弦波をしっかり追従できています。`;
            } else if (ratioW <= 1.35) {
                region = 'resonance';
                regionLabel = 'カットオフ付近 (帯域限界)';
                title = `⚠️ 追従限界付近 (ω ≈ ωB=${bwText}): 制御系が追いつく限界ゾーン`;
                description = `位相遅れが増大し、振幅比が -3dB (約0.707倍) に落ちる境界付近です。KpやKdを高めるとこの追従できる周波数限界（帯域幅 ωB）を広げられます。`;
            } else {
                region = 'high';
                regionLabel = '帯域外 (追従不可)';
                title = `🔴 帯域外 (ω > ωB): 目標の変化が速すぎてPIDでも追従困難`;
                description = `アクチュエータと質量の慣性限界を超えた速い指令のため、出力振幅は大きく減衰（${ampRatio.toFixed(2)}倍）し、位相も大きく遅れています。`;
            }
        }

        return {
            chars,
            theoryPt,
            hasMeasurement,
            gainDb,
            phaseDeg,
            ampRatio,
            staticAmp,
            staticAmpRatio,
            cycleDelayLabel,
            region,
            regionLabel,
            title,
            description
        };
    }
}
