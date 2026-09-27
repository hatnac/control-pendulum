// build-standalone.js
import fs from 'fs';

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('css/style.css', 'utf8');

const physics = fs.readFileSync('js/physics.js', 'utf8')
    .replace(/export\s+class\s+PendulumPhysics/, 'class PendulumPhysics');

const renderer = fs.readFileSync('js/renderer.js', 'utf8')
    .replace(/import\s+.*?;/g, '')
    .replace(/export\s+class\s+PendulumRenderer/, 'class PendulumRenderer');

const physicsMSD = fs.readFileSync('js/physics-msd.js', 'utf8')
    .replace(/export\s+class\s+MassSpringDamperPhysics/, 'class MassSpringDamperPhysics');

const rendererMSD = fs.readFileSync('js/renderer-msd.js', 'utf8')
    .replace(/import\s+.*?;/g, '')
    .replace(/export\s+class\s+MassSpringDamperRenderer/, 'class MassSpringDamperRenderer');

const charts = fs.readFileSync('js/charts.js', 'utf8')
    .replace(/import\s+.*?;/g, '')
    .replace(/export\s+class\s+ControlCharts/, 'class ControlCharts');

const pid = fs.readFileSync('js/pid.js', 'utf8')
    .replace(/import\s+.*?;/g, '')
    .replace(/export\s+class\s+PIDController/, 'class PIDController');

const app = fs.readFileSync('js/app.js', 'utf8')
    .replace(/import\s+.*?;/g, '');

let combined = html
    .replace('<link rel="stylesheet" href="css/style.css">', '<style>\n' + css + '\n</style>')
    .replace('<script type="module" src="js/app.js"></script>', '<script>\n' + physics + '\n' + renderer + '\n' + physicsMSD + '\n' + rendererMSD + '\n' + charts + '\n' + pid + '\n' + app + '\n</script>');

fs.writeFileSync('standalone.html', combined, 'utf8');
console.log('standalone.html created successfully!');
