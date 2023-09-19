import { resolve } from 'path';
import { convertFile } from '../parser';
import { readFile } from '../utils';

describe('conversion with variations', () => {
    const formatTestContent = async (filePath: string) =>
        ((await convertFile(resolve(__dirname, filePath), true)) || '').replace(/\n/g, '').replace(/\s{2,}/g, ' ');

    const formatExpectedContent = async (filePath: string) =>
        (await readFile(resolve(__dirname, filePath))).replace(/\n/g, '').replace(/\s{2,}/g, ' ');

    afterEach(
        async () =>
            new Promise<void>((resolve) => {
                setTimeout(resolve, 500);
            })
    );

    it('converts a basic class component', async () => {
        const content = await formatTestContent('samples/original/basic1.txt');
        const formatted = await formatExpectedContent('samples/formatted/basic1.txt');
        expect(content).toEqual(formatted);
    });

    it('converts a basic class component that contains different types of methods (public/private/protected)', async () => {
        const content = await formatTestContent('samples/original/basic2.txt');
        const formatted = await formatExpectedContent('samples/formatted/basic2.txt');
        expect(content).toEqual(formatted);
    });

    it('converts a Typescript class component with a variety of methods/variables', async () => {
        const content = await formatTestContent('samples/original/typescript.txt');
        const formatted = await formatExpectedContent('samples/formatted/typescript.txt');
        expect(content).toEqual(formatted);
    });
});
