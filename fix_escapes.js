const fs = require('fs');
const path = require('path');
const dirs = [
  'd:/PythonDevelop/Projects/PycharmProjects/robot_calc_beat/src/components/rca-log',
  'd:/PythonDevelop/Projects/PycharmProjects/robot_calc_beat/src/components/rca-log/charts'
];

dirs.forEach(dir => {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(file => {
    if (file.endsWith('.js') || file.endsWith('.jsx')) {
      const fullPath = path.join(dir, file);
      let content = fs.readFileSync(fullPath, 'utf8');
      // replace \` with ` and \$ with $
      let newContent = content.replace(/\\`/g, '`').replace(/\\\$/g, '$');
      if (content !== newContent) {
        fs.writeFileSync(fullPath, newContent);
        console.log('Fixed ' + file);
      }
    }
  });
});
