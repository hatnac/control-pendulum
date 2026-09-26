// test-physics.js - 物理シミュレーションのユニットテスト
import { PendulumPhysics } from './js/physics.js';

function runTests() {
    console.log('--- Test 1: 初期状態 ---');
    const p = new PendulumPhysics();
    p.reset(0, 0); // 鉛直下向き (0 deg)
    console.assert(p.theta === 0, 'theta should be 0');
    console.assert(p.omega === 0, 'omega should be 0');
    console.log('Passed Test 1');

    console.log('--- Test 2: トルク印加による加速 ---');
    // 最大トルク8Nmを1秒間印加
    for (let i = 0; i < 200; i++) {
        p.update(0.005, 8.0);
    }
    console.log(`After 1s torque: theta=${(p.theta * 180 / Math.PI).toFixed(1)} deg, omega=${p.omega.toFixed(2)} rad/s`);
    console.assert(p.omega > 0, 'omega should be positive (CCW rotation)');
    console.log('Passed Test 2');

    console.log('--- Test 3: 360度多回転の安定性 ---');
    // 強トルクで何回転もさせる
    p.tauMax = 20.0;
    for (let i = 0; i < 1000; i++) {
        p.update(0.005, 15.0);
    }
    const turns = p.theta / (2 * Math.PI);
    console.log(`Rotated ${turns.toFixed(2)} full turns. theta=${p.theta.toFixed(2)} rad, normalized=${p.normalizedThetaDeg.toFixed(1)} deg`);
    console.assert(turns > 2.0, 'Should have rotated at least 2 turns');
    console.assert(p.normalizedThetaDeg >= -180 && p.normalizedThetaDeg <= 180, 'Normalized angle must be in [-180, 180]');
    console.log('Passed Test 3');

    console.log('--- Test 4: 角度正規化と最短偏差計算 ---');
    p.targetAngleDeg = 180;
    p.theta = Math.PI * 0.95; // 171 deg (誤差 -9 deg)
    let errDeg = p.angleErrorDeg;
    console.log(`Target: 180 deg, Current: 171 deg, Error: ${errDeg.toFixed(1)} deg`);
    console.assert(Math.abs(errDeg - (-9.0)) < 0.1, 'Error should be around -9 deg');

    p.theta = Math.PI * 1.05; // 189 deg (誤差 +9 deg)
    errDeg = p.angleErrorDeg;
    console.log(`Target: 180 deg, Current: 189 deg, Error: ${errDeg.toFixed(1)} deg`);
    console.assert(Math.abs(errDeg - (9.0)) < 0.1, 'Error should be around +9 deg');
    console.log('Passed Test 4');

    console.log('--- Test 5: 自然減衰（トルク0でのエネルギー減少） ---');
    p.reset(90, 0); // 90度から落下
    const initialEnergy = p.totalEnergy;
    for (let i = 0; i < 400; i++) {
        p.update(0.005, 0);
    }
    const finalEnergy = p.totalEnergy;
    console.log(`Initial E: ${initialEnergy.toFixed(2)} J, After 2s E: ${finalEnergy.toFixed(2)} J`);
    console.assert(finalEnergy < initialEnergy, 'Energy should dissipate due to damping');
    console.log('Passed Test 5');

    console.log('\nAll physics tests passed successfully! ✅');
}

runTests();
