#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { program } from 'commander';
import { convertFile } from './parser';

const expectedExtensions = ['.tsx', '.ts', '.jsx', '.js'];

function* walkSync(dir: string): Generator<string> {
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

const converter = async (target: string, generateContentOnly = false) => {
    try {
        await convertFile(target, generateContentOnly);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(message);
    }
}

const main = async () => {
    program
        .option('-t, --target <file|directory>', 'The file/directory where files will be convert')
        .option('--only-content', 'Used to determine if new content should be returned, rather than saved')
        .option('-i, --ignore <files>', `File(s) to be ignored for converter when dealing with directories,
            separated by comma and NO SPACES.
            (by default, all files with tsx and jsx extensions that contain the \`extends Component\` 
            or \`extends React.Component\` will be converted)`);

    program.parse();
    const options = program.opts();

    if (!options.target) {
        throw new Error('No file or directory specified.')
    }
    
    const stats = fs.statSync(options.target);
    const isDir = stats.isDirectory();

    if (isDir) {
        const ignoredFiles = (options.ignore || '')
            .split(',')
            .map((file: string) => path.resolve(options.target, file));

        for (const file of walkSync(options.target)) {
            if (ignoredFiles.length > 0 && !ignoredFiles.includes(file)) {
                await converter(file, options['only-content']);
            }
        }
    } else {
        await converter(options.target, options['only-content']);
    }
}

main();