// test-msd.js
import { MassSpringDamperPhysics } from './js/physics-msd.js';
import { PIDController } from './js/pid.js';

console.log('=== Running Mass-Spring-Damper System Verification Tests ===\n');

let failed = 0;
function assert(condition, message) {
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        failed++;
    } else {
        console.log(`✅ PASS: ${message}`);
    }
}

// 1. 特性値テスト
{
    const msd = new MassSpringDamperPhysics();
    msd.m = 1.0;
    msd.k = 12.0;
    msd.d = 1.2;

    const expectedWn = Math.sqrt(12.0);
    const expectedZeta = 1.2 / (2.0 * Math.sqrt(12.0));

    assert(Math.abs(msd.omegaN - expectedWn) < 1e-4, `omegaN is ${msd.omegaN.toFixed(4)} (expected ${expectedWn.toFixed(4)})`);
    assert(Math.abs(msd.zeta - expectedZeta) < 1e-4, `zeta is ${msd.zeta.toFixed(4)} (expected ${expectedZeta.toFixed(4)})`);
    assert(msd.dampingTypeLabel.includes('不足減衰'), `dampingTypeLabel for zeta=0.17: ${msd.dampingTypeLabel}`);

    msd.d = 2.0 * Math.sqrt(12.0);
    assert(Math.abs(msd.zeta - 1.0) < 1e-4, `zeta=1.0 when D=2*sqrt(mK)`);
    assert(msd.dampingTypeLabel.includes('臨界減衰'), `dampingTypeLabel for zeta=1.0: ${msd.dampingTypeLabel}`);

    msd.d = 10.0;
    assert(msd.dampingTypeLabel.includes('過減衰'), `dampingTypeLabel for zeta>1.0: ${msd.dampingTypeLabel}`);

    msd.d = 0.0;
    assert(msd.dampingTypeLabel.includes('非減衰'), `dampingTypeLabel for zeta=0: ${msd.dampingTypeLabel}`);
}

// 2. 自由減衰振動テスト (ダンパーによるエネルギー散逸)
{
    const msd = new MassSpringDamperPhysics();
    msd.m = 1.0;
    msd.k = 10.0;
    msd.d = 1.5;
    msd.reset(0.8, 0.0); // 初期変位 0.8m

    const initialEnergy = msd.totalEnergy;
    const dt = 0.01;

    // 5秒間シミュレーション
    for (let t = 0; t < 5.0; t += dt) {
        msd.update(dt, 0.0);
    }

    const finalEnergy = msd.totalEnergy;
    assert(finalEnergy < initialEnergy * 0.05, `Energy dissipated from ${initialEnergy.toFixed(3)}J to ${finalEnergy.toFixed(5)}J (< 5%)`);
    assert(Math.abs(msd.x) < 0.05, `Mass settled near 0m (current x=${msd.x.toFixed(4)}m)`);
}

// 3. P制御のみにおける定常偏差の理論値検証
{
    const msd = new MassSpringDamperPhysics();
    msd.m = 1.0;
    msd.k = 12.0;
    msd.d = 2.0;
    msd.targetX = 0.6;
    msd.reset(0, 0);

    const pid = new PIDController();
    pid.angleMode = false;
    pid.kp = 18.0;
    pid.ki = 0.0; // I項なし
    pid.kd = 5.0;

    const dt = 0.01;
    for (let t = 0; t < 10.0; t += dt) {
        const f = pid.compute(msd.targetX, msd.x, msd.v, dt, msd.fMax);
        msd.update(dt, f);
    }

    // 理論的定常変位: x_ss = Kp / (K + Kp) * targetX = 18 / (12 + 18) * 0.6 = 18 / 30 * 0.6 = 0.36m
    const expectedXss = (18.0 / (12.0 + 18.0)) * 0.6;
    assert(Math.abs(msd.x - expectedXss) < 0.01, `P-control steady-state offset matches theory: x=${msd.x.toFixed(4)}m (expected ${expectedXss.toFixed(4)}m)`);
}

// 4. PID制御（I項あり）による定常偏差ゼロ消去と目標位置整定
{
    const msd = new MassSpringDamperPhysics();
    msd.m = 1.0;
    msd.k = 12.0;
    msd.d = 1.2;
    msd.targetX = 0.5;
    msd.reset(0, 0);

    const pid = new PIDController();
    pid.angleMode = false;
    pid.kp = 30.0;
    pid.ki = 12.0; // I項あり
    pid.kd = 8.0;

    const dt = 0.01;
    for (let t = 0; t < 12.0; t += dt) {
        const f = pid.compute(msd.targetX, msd.x, msd.v, dt, msd.fMax);
        msd.update(dt, f);
    }

    const err = Math.abs(msd.targetX - msd.x);
    assert(err < 0.005, `PID achieved zero steady-state error: error=${err.toFixed(5)}m (< 0.005m)`);
    assert(Math.abs(msd.v) < 0.005, `Mass velocity is virtually zero: v=${msd.v.toFixed(5)}m/s`);
}

console.log(`\n=== Verification Finished: ${failed === 0 ? 'ALL TESTS PASSED' : failed + ' TESTS FAILED'} ===`);
if (failed > 0) process.exit(1);
