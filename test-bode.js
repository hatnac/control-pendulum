// test-bode.js
import { MassSpringDamperPhysics } from './js/physics-msd.js';
import { PendulumPhysics } from './js/physics.js';
import { PIDController } from './js/pid.js';
import { BodeAnalyzer } from './js/bode.js';

console.log('=== Running Frequency Response & Bode Plot Verification Tests ===\n');

let failed = 0;
function assert(condition, message) {
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        failed++;
    } else {
        console.log(`✅ PASS: ${message}`);
    }
}

// 1. マス・バネ・ダンパー系の理論ボード計算テスト
{
    const msd = new MassSpringDamperPhysics();
    msd.m = 1.0;
    msd.k = 16.0;
    msd.d = 1.6; // wn = 4.0 rad/s, zeta = 0.2

    const testFreqs = [0.01, 4.0, 100.0];
    const bode = BodeAnalyzer.computeTheoreticalBode('msd', msd, testFreqs);

    // 低周波 (w -> 0): ゲイン = 1/K = 1/16 = 0.0625 (-24.08 dB), 位相 ≈ 0 deg
    const low = bode[0];
    const expectedLowGainDb = 20 * Math.log10(1.0 / 16.0);
    assert(Math.abs(low.gainDb - expectedLowGainDb) < 0.1, `DC gain is ${low.gainDb.toFixed(2)} dB (expected ${expectedLowGainDb.toFixed(2)} dB)`);
    assert(Math.abs(low.phaseDeg) < 1.0, `DC phase is ${low.phaseDeg.toFixed(2)} deg (expected ~0 deg)`);

    // 共振周波数 (w = wn = 4.0 rad/s): 位相 = -90 deg, ゲイン = 1 / (D * wn) = 1 / (1.6 * 4) = 1/6.4 (-16.12 dB)
    const res = bode[1];
    const expectedResGainDb = 20 * Math.log10(1.0 / (1.6 * 4.0));
    assert(Math.abs(res.gainDb - expectedResGainDb) < 0.1, `Resonance gain is ${res.gainDb.toFixed(2)} dB (expected ${expectedResGainDb.toFixed(2)} dB)`);
    assert(Math.abs(res.phaseDeg - (-90.0)) < 0.1, `Resonance phase is ${res.phaseDeg.toFixed(2)} deg (expected -90 deg)`);

    // 高周波 (w = 100 rad/s): 位相 -> -180 deg
    const high = bode[2];
    assert(Math.abs(high.phaseDeg - (-180.0)) < 2.0, `High-freq phase is ${high.phaseDeg.toFixed(2)} deg (expected ~ -180 deg)`);
}

// 2. 物理シミュレーションと直交検波による共振点での実測同定テスト
{
    const msd = new MassSpringDamperPhysics();
    msd.m = 1.0;
    msd.k = 12.0;
    msd.d = 1.2;
    msd.reset(0, 0);

    const analyzer = new BodeAnalyzer();
    const wn = Math.sqrt(12.0); // ≈ 3.464 rad/s
    analyzer.setOmega(wn);
    analyzer.setAmplitude(3.0); // Ain = 3.0 N

    // 共振周波数での理論値:
    // real = K - m*wn^2 = 0
    // imag = D * wn = 1.2 * 3.464 = 4.157
    // |G| = 1 / 4.157 = 0.24056 => Aout = 3.0 * 0.24056 = 0.7217m
    // Gain [dB] = 20 log10(0.24056) = -12.375 dB
    // Phase = -90.0 deg
    const expectedAout = 3.0 / (1.2 * wn);
    const expectedGainDb = 20 * Math.log10(1.0 / (1.2 * wn));

    const dt = 0.005;
    // 12秒間加振（過渡応答が十分減衰し定常状態に達する時間）
    for (let t = 0; t <= 12.0; t += dt) {
        const u = analyzer.updateInput(dt);
        msd.update(dt, u);
        analyzer.processSample(u, msd.x, dt);
    }

    assert(Math.abs(analyzer.currentAmpOut - expectedAout) < 0.02, `Measured output amplitude is ${analyzer.currentAmpOut.toFixed(4)} m (expected ${expectedAout.toFixed(4)} m)`);
    assert(Math.abs(analyzer.currentGainDb - expectedGainDb) < 0.3, `Measured gain is ${analyzer.currentGainDb.toFixed(2)} dB (expected ${expectedGainDb.toFixed(2)} dB)`);
    assert(Math.abs(analyzer.currentPhaseDeg - (-90.0)) < 3.0, `Measured phase is ${analyzer.currentPhaseDeg.toFixed(1)} deg (expected -90.0 deg)`);

    // プロット記録テスト
    const pt = analyzer.recordCurrentPoint();
    assert(pt !== null && analyzer.measurements.length === 1, `Successfully recorded measurement point at omega=${pt.omega.toFixed(2)}`);
}

// 3. 振子系の線形周波数応答テスト
{
    const pend = new PendulumPhysics();
    pend.l = 1.0;
    pend.m = 1.0;
    pend.c = 0.2;
    pend.g = 9.8;
    const wn = Math.sqrt(9.8 / 1.0); // ≈ 3.13 rad/s

    const bode = BodeAnalyzer.computeTheoreticalBode('pendulum', pend, [wn]);
    assert(Math.abs(bode[0].phaseDeg - (-90.0)) < 0.1, `Pendulum resonance phase is -90 deg`);
}

// 4. 閉ループPID周波数応答の理論計算・帯域幅・シミュレーション追従テスト
{
    const msd = new MassSpringDamperPhysics();
    msd.m = 1.0;
    msd.k = 12.0;
    msd.d = 1.2;
    msd.fMax = 35.0;
    msd.reset(0, 0);

    const pid = new PIDController();
    pid.angleMode = false;
    pid.kp = 30.0;
    pid.ki = 12.0;
    pid.kd = 8.0;

    // 閉ループ理論DCゲインは Ki>0 なので ω→0 で 0 dB (=1.0) に収束し、高周波でロールオフする
    const closedBode = BodeAnalyzer.computeTheoreticalBode('msd', msd, [0.05, 1.0, 30.0], 'closed', pid);
    assert(Math.abs(closedBode[0].gainDb) < 0.2, `Closed-loop very-low-freq (0.05 rad/s) gain is near 0 dB (${closedBode[0].gainDb.toFixed(2)} dB)`);
    assert(closedBode[2].gainDb < -10.0, `Closed-loop high-freq (30 rad/s) gain rolls off (${closedBode[2].gainDb.toFixed(2)} dB)`);

    // 特性と帯域幅 ωB の算出テスト
    const chars = BodeAnalyzer.computeSystemCharacteristics('msd', msd, 'closed', pid);
    assert(chars.bandwidthOmega !== null && chars.bandwidthOmega > 2.0, `Closed-loop bandwidth ωB detected: ${chars.bandwidthOmega ? chars.bandwidthOmega.toFixed(2) : null} rad/s`);

    // 正弦波 (ω=1.5 rad/s) に対する閉ループPID追従シミュレーションが理論値と一致するか検証
    const testW = 1.5;
    const expectedClosedPt = BodeAnalyzer.evaluatePoint(testW, 'msd', msd, 'closed', pid);
    const analyzer = new BodeAnalyzer();
    analyzer.setLoopType('closed');
    analyzer.setOmega(testW);
    analyzer.setAmplitude(0.4); // 目標振幅 0.40m

    const dt = 0.005;
    for (let t = 0; t <= 12.0; t += dt) {
        const targetX = analyzer.updateInput(dt);
        const force = pid.compute(targetX, msd.x, msd.v, dt, msd.fMax);
        msd.update(dt, force);
        analyzer.processSample(targetX, msd.x, dt);
    }

    assert(Math.abs(analyzer.currentGainDb - expectedClosedPt.gainDb) < 0.5, `Closed-loop measured gain (${analyzer.currentGainDb.toFixed(2)} dB) matches theory (${expectedClosedPt.gainDb.toFixed(2)} dB)`);
    assert(Math.abs(analyzer.currentPhaseDeg - expectedClosedPt.phaseDeg) < 4.0, `Closed-loop measured phase (${analyzer.currentPhaseDeg.toFixed(1)}°) matches theory (${expectedClosedPt.phaseDeg.toFixed(1)}°)`);
}

// 5. 学習解説インサイトの領域判定テスト (低周波 / 共振点 / 高周波)
{
    const msd = new MassSpringDamperPhysics();
    msd.m = 1.0;
    msd.k = 16.0;
    msd.d = 1.6; // wn = 4.0 rad/s

    const analyzer = new BodeAnalyzer();
    analyzer.setLoopType('open');
    analyzer.setAmplitude(4.0);

    analyzer.setOmega(1.0); // 0.25 * wn -> low
    const lowInsight = analyzer.getLearningInsight('msd', msd);
    assert(lowInsight.region === 'low', `Insight region at ω=1.0 is 'low' (actual=${lowInsight.region})`);

    analyzer.setOmega(4.0); // 1.0 * wn -> resonance
    const resInsight = analyzer.getLearningInsight('msd', msd);
    assert(resInsight.region === 'resonance', `Insight region at ω=4.0 is 'resonance' (actual=${resInsight.region})`);

    analyzer.setOmega(12.0); // 3.0 * wn -> high
    const highInsight = analyzer.getLearningInsight('msd', msd);
    assert(highInsight.region === 'high', `Insight region at ω=12.0 is 'high' (actual=${highInsight.region})`);
}

// 6. ベクトル軌跡 (複素平面 Re/Im ＆ 一巡伝達関数 L(jω)) 計算テスト
{
    const msd = new MassSpringDamperPhysics();
    msd.m = 1.0;
    msd.k = 16.0;
    msd.d = 1.6; // wn = 4.0

    // ω=0.001 (DC): G(j0) ≈ 1/K = 0.0625 + j0
    const dcPt = BodeAnalyzer.evaluatePoint(0.001, 'msd', msd, 'open');
    assert(Math.abs(dcPt.re - 0.0625) < 1e-4 && Math.abs(dcPt.im) < 1e-4, `Vector locus at DC ≈ (0.0625, 0): (${dcPt.re.toFixed(4)}, ${dcPt.im.toFixed(4)})`);

    // ω=wn=4.0 (共振): Re = 0, Im = -1/(D*wn) = -1/6.4 = -0.15625
    const resPt = BodeAnalyzer.evaluatePoint(4.0, 'msd', msd, 'open');
    assert(Math.abs(resPt.re) < 1e-5 && Math.abs(resPt.im - (-1.0 / 6.4)) < 1e-4, `Vector locus at ωn=4.0 is on negative Im axis: (${resPt.re.toFixed(4)}, ${resPt.im.toFixed(4)})`);

    // 一巡伝達関数 L(jω) の計算チェック
    const pid = new PIDController();
    pid.kp = 30.0; pid.ki = 12.0; pid.kd = 8.0;
    const loopPt = BodeAnalyzer.evaluateOpenLoopL(4.0, 'msd', msd, pid);
    assert(isFinite(loopPt.re) && isFinite(loopPt.im) && loopPt.gain > 0, `Open-loop L(j4.0) computed cleanly: (${loopPt.re.toFixed(3)}, ${loopPt.im.toFixed(3)})`);
}

console.log(`\n=== Verification Finished: ${failed === 0 ? 'ALL TESTS PASSED' : failed + ' TESTS FAILED'} ===`);
if (failed > 0) process.exit(1);
