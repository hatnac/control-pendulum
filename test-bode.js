// test-bode.js
import { MassSpringDamperPhysics } from './js/physics-msd.js';
import { PendulumPhysics } from './js/physics.js';
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

console.log(`\n=== Verification Finished: ${failed === 0 ? 'ALL TESTS PASSED' : failed + ' TESTS FAILED'} ===`);
if (failed > 0) process.exit(1);
