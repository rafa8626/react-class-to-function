import fs from 'fs/promises';

export const addStateWarning = (match: string) => [
    '// @todo Refactor this method using new states and consider using',
    '// \`use-immer\` hook instead of \`produce\` if setState is using it.',
    '// Also, consider creating new effects if the state has a callback after the setter',
    match
];

export const createSetterFromVariable = (variable: string) => `set${variable.charAt(0).toUpperCase()}${variable.slice(1)}`;

export const readFile = async (file: string) => {
    try {
        return await fs.readFile(file, { encoding: 'utf8' });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw new Error(`Error while reading file: ${message}`);
    }
}