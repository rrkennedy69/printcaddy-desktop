// Puts the PrintCaddy web build (the GitHub Pages site at the commit in web-commit.txt) into ./web.
const { execSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..'); const web = path.join(root, 'web');
const commit = fs.readFileSync(path.join(root, 'web-commit.txt'), 'utf8').trim();
fs.rmSync(web, { recursive: true, force: true });
const run = (c, cwd) => execSync(c, { stdio: 'inherit', cwd });
run(`git init -q web`, root);
run(`git fetch -q --depth 1 https://github.com/rrkennedy69/rrkennedy69.github.io.git ${commit}`, web);
run(`git -c advice.detachedHead=false checkout -q FETCH_HEAD`, web);
fs.rmSync(path.join(web, '.git'), { recursive: true, force: true });
console.log('web build', fs.readFileSync(path.join(web, 'version.json'), 'utf8').trim(), 'from', commit);
