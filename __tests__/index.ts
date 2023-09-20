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

    it('throws an exception if file does not contain any classes', async () => {
        const file = resolve(__dirname, 'samples/original/noclass.txt');
        try {
            await convertFile(file, true);
        } catch (e) {
            expect(e).toHaveProperty('message', `${file} cannot be converted since it is not a Component`);
        }
    });

    it('throws an exception if file contains more than 1 class', async () => {
        const file = resolve(__dirname, 'samples/original/multipleclasses.txt');
        try {
            await convertFile(file, true);
        } catch (e) {
            expect(e).toHaveProperty('message', `${file} cannot be converted since it contains more than 1 class`);
        }
    });

    it('throws an exception if class does not extend a React Component or contains the required `render` method', async () => {
        let file = resolve(__dirname, 'samples/original/nocomponent1.txt');
        try {
            await convertFile(file, true);
        } catch (e) {
            expect(e).toHaveProperty('message', 'The class B is not a class component.');
        }

        file = resolve(__dirname, 'samples/original/nocomponent2.txt');
        try {
            await convertFile(file, true);
        } catch (e) {
            expect(e).toHaveProperty(
                'message',
                'Cannot convert this class since it does not extends a React Component.'
            );
        }

        file = resolve(__dirname, 'samples/original/nocomponent3.txt');
        try {
            await convertFile(file, true);
        } catch (e) {
            expect(e).toHaveProperty(
                'message',
                'Cannot convert this class since it does not extends a React Component.'
            );
        }
    });

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
