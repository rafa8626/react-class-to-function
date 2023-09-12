const convertFile = require('./converter');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { program } = require('commander');
const { writeFile } = require('fs/promises');

const expectedExtensions = ['.tsx', '.ts', '.jsx', '.js'];

const converter = async (target, eslintConfig = '') => {
    try {
        const filePath = await convertFile(target);
        // Run ESLint using the specific configuration for the new file
        if (eslintConfig) {
            exec(`npx eslint --fix --ext ${expectedExtensions.join(',')} -c ${eslintConfig} ${filePath}`);
        }
    } catch (e) {
        await writeFile('error.log', e.message);
    }
}

const main = async () => {
    program
        .option('-t, --target <file|directory>')
        .option('--lint-config');

    program.parse();
    const options = program.opts();

    if (!options.target) {
        throw new Error('No file or directory specified.')
    }
    
    const stats = fs.statSync(options.target);
    const isDir = stats.isDirectory();

    if (isDir) {
        const files = fs.readdirSync(options.target, { withFileTypes: true });
        for(const file of files) {
            if (expectedExtensions.includes(path.extname(file.name))) {
                await converter(path.resolve(options.target, file.name), options['lint-config']);
            }
        }
    
    } else {
        await converter(options.target, options['lint-config']);
    }
}

main();