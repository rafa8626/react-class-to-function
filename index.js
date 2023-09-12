#!/usr/bin/env node

const convertFile = require('./converter');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { program } = require('commander');
const { writeFile } = require('fs/promises');

const expectedExtensions = ['.tsx', '.ts', '.jsx', '.js'];

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
        const files = fs.readdirSync(options.target, { withFileTypes: true });
        for(const file of files) {
            if (expectedExtensions.includes(path.extname(file.name))) {
                await converter(path.resolve(options.target, file.name));
            }
        }
    
    } else {
        await converter(options.target);
    }
}

main();