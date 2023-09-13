#!/usr/bin/env node

const convertFile = require('./converter');
const path = require('path');
const fs = require('fs');
const { program } = require('commander');

const expectedExtensions = ['.tsx', '.ts', '.jsx', '.js'];

function* walkSync(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
        const absolutePath = path.resolve(dir, file.name);
        if (file.isDirectory()) {
            yield* walkSync(absolutePath);
        } else if (expectedExtensions.includes(path.extname(file.name))) {
            yield absolutePath;
        }
    }
}

const converter = async (target) => {
    try {
        await convertFile(target);
    } catch (e) {
        console.error(e.message);
    }
}

const main = async () => {
    program.option('-t, --target <file|directory>');
    program.parse();
    const options = program.opts();

    if (!options.target) {
        throw new Error('No file or directory specified.')
    }
    
    const stats = fs.statSync(options.target);
    const isDir = stats.isDirectory();

    if (isDir) {
        for (const file of walkSync(options.target)) {
            await converter(file);
        }
    
    } else {
        await converter(options.target);
    }
}

main();