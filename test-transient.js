/**
 * test-transient.js - インパルス応答・ステップ応答・リアルタイム過渡特性解析の自動検証
 */

import { MassSpringDamperPhysics } from './js/physics-msd.js';
import { PendulumPhysics } from './js/physics.js';
import { PIDController } from './js/pid.js';
import { TransientManager } from './js/transient.js';

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        process.exit(1);
    } else {
        console.log(`✅ PASS: ${message}`);
    }
}

function assertClose(actual, expected, tol, message) {
    const diff = Math.abs(actual - expected);
    if (diff > tol) {
        console.error(`❌ FAIL: ${message} (actual=${actual}, expected=${expected}, diff=${diff}, tol=${tol})`);
        process.exit(1);
    } else {
        console.log(`✅ PASS: ${message} (${actual.toFixed(4)} vs ${expected.toFixed(4)})`);
    }
}

console.log('=== Running Transient Response (Step & Impulse) Verification Tests ===\n');

// -------------------------------------------------------------
// Test 1: マスバネ系の理論過渡特性算出
// -------------------------------------------------------------
console.log('--- Test 1: マスバネ系 理論過渡特性計算 ---');
const msd = new MassSpringDamperPhysics();
msd.m = 1.0;
msd.k = 16.0;
msd.d = 1.6;
msd.fMax = 25.0;

const tm = new TransientManager();
tm.params.stepForceMSD = 8.0;

const theory = tm.getMSDTheoreticalProperties(msd);
assertClose(theory.wn, 4.0, 1e-4, '固有角周波数 wn is 4.0 rad/s');
assertClose(theory.zeta, 0.20, 1e-4, '減衰比 zeta is 0.20');
assertClose(theory.wd, 4.0 * Math.sqrt(1 - 0.04), 1e-4, '減衰固有角周波数 wd');
assertClose(theory.xFinal, 8.0 / 16.0, 1e-4, '理論定常値 xFinal is 0.50 m');

const expectedMp = Math.exp(-Math.PI * 0.2 / Math.sqrt(1 - 0.04)) * 100.0;
assertClose(theory.theoreticalMp, expectedMp, 0.05, `理論オーバーシュート Mp is ${expectedMp.toFixed(2)}%`);

// -------------------------------------------------------------
// Test 2: 開ループ外力ステップ応答シミュレーション検証
// -------------------------------------------------------------
console.log('\n--- Test 2: 開ループ外力ステップ応答 シミュレーション ---');
tm.setResponseType('step_open');
tm.startExperiment('msd', msd, null);

const dt = 0.005;
const simTime = 6.0;
const steps = Math.round(simTime / dt);

for (let i = 0; i < steps; i++) {
    const u = tm.computeInput(dt, msd, 'msd', null);
    msd.update(dt, u);
}

// ピーク値の理論値: x_max = x_final * (1 + Mp / 100)
const expectedPeak = 0.50 * (1.0 + expectedMp / 100.0);
assertClose(tm.metrics.peakVal, expectedPeak, 0.015, '実測最大ピーク値 x_max が理論値と一致');
assertClose(tm.metrics.overshootPercent, expectedMp, 2.0, '実測オーバーシュート率 Mp [%] が理論値と一致');
assert(tm.metrics.riseTime > 0.1 && tm.metrics.riseTime < 1.0, `立上り時間 tr is measured: ${tm.metrics.riseTime.toFixed(3)}s`);
assertClose(msd.x, 0.50, 0.01, 'ステップ応答最終値が理論定常値 0.50m に整定');
assert(tm.metrics.isSettled, '整定フラグ isSettled is true');

// -------------------------------------------------------------
// Test 3: インパルス応答（力積付与）シミュレーション検証
// -------------------------------------------------------------
console.log('\n--- Test 3: インパルス応答（力積付与） シミュレーション ---');
msd.reset(0, 0);
tm.setResponseType('impulse');
tm.params.impulseMSD = 2.0; // I = 2.0 Ns => delta_v = 2.0 m/s
tm.startExperiment('msd', msd, null);

assertClose(msd.v, 2.0, 1e-4, 'インパルス直後の初速度 v(0+) is 2.0 m/s');

let peakImpulseX = 0;
let peakImpulseT = 0;
const peakTimeTheory = Math.atan(Math.sqrt(1 - 0.2*0.2) / 0.2) / theory.wd; // 約 0.35s

for (let i = 0; i < steps; i++) {
    const u = tm.computeInput(dt, msd, 'msd', null);
    msd.update(dt, u);
    if (msd.x > peakImpulseX) {
        peakImpulseX = msd.x;
        peakImpulseT = i * dt;
    }
}

assert(peakImpulseX > 0.35 && peakImpulseX < 0.55, `インパルス応答最大変位: ${peakImpulseX.toFixed(3)}m`);
assertClose(peakImpulseT, peakTimeTheory, 0.03, 'インパルス応答ピーク到達時間が理論値と一致');
assertClose(msd.x, 0.0, 0.015, 'インパルス応答後に自然長 0m に整定');
assert(tm.metrics.isSettled, 'インパルス応答整定フラグ isSettled is true');

// -------------------------------------------------------------
// Test 4: 閉ループPID目標ステップ応答検証
// -------------------------------------------------------------
console.log('\n--- Test 4: 閉ループPID目標ステップ応答 ---');
msd.reset(0, 0);
const pid = new PIDController();
pid.angleMode = false;
pid.kp = 35.0;
pid.ki = 18.0;
pid.kd = 8.0;

tm.setResponseType('step_closed');
tm.params.stepTargetMSD = 0.6; // target = 0.6m
tm.startExperiment('msd', msd, pid);

const pidSteps = Math.round(12.0 / dt);
for (let i = 0; i < pidSteps; i++) {
    const u = tm.computeInput(dt, msd, 'msd', pid);
    msd.update(dt, u);
}

assertClose(msd.x, 0.6, 0.005, 'PID制御により定常偏差ゼロで目標 0.60m に完全追従');
assert(tm.metrics.steadyStateError < 0.005, '定常偏差 ess < 0.005m');
assert(tm.metrics.riseTime > 0.05, `PID立上り時間 tr: ${tm.metrics.riseTime.toFixed(3)}s`);

// -------------------------------------------------------------
// Test 5: 振子系での撃力（インパルス）動作検証
// -------------------------------------------------------------
console.log('\n--- Test 5: 振子系 インパルス撃力 ---');
const pendulum = new PendulumPhysics();
pendulum.reset(0, 0); // 下向き静止
tm.params.impulsePendulum = 2.0;

tm.applyImpulse(pendulum, 'pendulum');
assert(Math.abs(pendulum.omega) > 1.5, `振子にインパルス撃力が注入され角速度が発生: omega=${pendulum.omega.toFixed(2)} rad/s`);

console.log('\n=== Verification Finished: ALL TRANSIENT TESTS PASSED ===');
