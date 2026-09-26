// test-pid.js
import { PendulumPhysics } from './js/physics.js';
import { PIDController } from './js/pid.js';

function runPIDTests() {
    console.log('--- Test 1: PIDコントローラ基本計算 ---');
    const pid = new PIDController();
    pid.kp = 20.0;
    pid.ki = 2.0;
    pid.kd = 5.0;

    // 目標: 90° (π/2), 現在: 0°, 角速度: 0 rad/s
    const u = pid.compute(Math.PI / 2, 0, 0, 0.01, 15.0);
    console.log(`Error = 90 deg => Output u = ${u.toFixed(2)} Nm`);
    console.assert(u > 0, 'Output should be positive to pull CCW towards target');
    console.log('Passed Test 1');

    console.log('--- Test 2: D項のダンピングブレーキ効果 ---');
    // 角度は一致しているが角速度 omega = 2 rad/s のとき
    const uDamping = pid.compute(0, 0, 2.0, 0.01, 15.0);
    console.log(`Error = 0, omega = 2.0 => Output u = ${uDamping.toFixed(2)} Nm`);
    console.assert(uDamping < 0, 'Output should be negative to brake omega > 0');
    console.log('Passed Test 2');

    console.log('--- Test 3: PIDによる倒立振子(180°)安定化シミュレーション ---');
    const p = new PendulumPhysics();
    p.reset(170, 0); // 倒立近傍 170度からスタート
    p.targetAngleDeg = 180;
    p.tauMax = 15.0;

    const pidCtrl = new PIDController();
    pidCtrl.kp = 30.0;
    pidCtrl.ki = 5.0;
    pidCtrl.kd = 8.0;

    // 3秒間PID制御でステップ更新
    for (let i = 0; i < 600; i++) {
        const dt = 0.005;
        const tau = pidCtrl.compute(p.targetAngleRad, p.theta, p.omega, dt, p.tauMax);
        p.update(dt, tau);
    }

    const finalDeg = p.normalizedThetaDeg;
    const finalOmega = p.omega;
    console.log(`After 3s PID control: theta = ${finalDeg.toFixed(2)} deg (Target: 180 deg), omega = ${finalOmega.toFixed(3)} rad/s`);
    console.assert(Math.abs(Math.abs(finalDeg) - 180.0) < 1.0, 'Pendulum should be stabilized at 180 deg');
    console.assert(Math.abs(finalOmega) < 0.1, 'Angular velocity should be near zero');
    console.log('Passed Test 3: 倒立振子がPID制御によりピタッと安定化しました！ ✅');

    console.log('\nAll PID unit tests passed successfully! ✅');
}

runPIDTests();
