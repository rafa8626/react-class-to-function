import fs from 'fs/promises';
import path from 'path';
import { addStateWarning, createSetterFromVariable, readFile } from './utils';

const classComponentRegexp = /(export\s+)?class\s+(.*?)\s+extends\s+(React.|Pure)?Component\s*(<(\w+)(\s*,\s*(.*?))?>)?\s*{/;

const renderRegexp = /(public )?(function )?render\s*\(\s*\)/i;

export const writeFile = async (file: string, content: string) => {
    try {
        await fs.writeFile(file, content);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw new Error(`Error while writing file: ${message}`);
    }
}

const formatRenderContent = (renderLines: string[]) => {
    if (/^\s+}$/i.test(renderLines[renderLines.length - 1])) {
        renderLines.pop();
    }
    return renderLines.filter(line => !renderRegexp.test(line));
};



const createComponentDefinition = (line: string, hasProps = false) => line.replace(classComponentRegexp, (_, ...args) => {
    const functionName = args[1];
    const genericType = args[4] || '';
    return `${args[0] || ''}const ${functionName} = (${hasProps ? 'props' : ''})${genericType ? `: FC<${genericType}>` : ''} => {`;
});

const formatStateDefinitions = (stateDefinitions: string[]) => {
    // Remove first and last lines since they are the containers fo definitions
    stateDefinitions.pop();
    stateDefinitions.shift();
    const map: Record<string, unknown> = {};

    let count = 0;
    let objectFound = false;
    let objectName = '';
    let objectEls: string[] = [];

    for (const line of stateDefinitions.filter(e => !e.includes('//'))) {
        if (/\s+{$/m.test(line)) {
            const [variable] = line.split(':');
            objectName = variable.replace('?', '').trim();
            objectFound = true;
        }

        if (objectFound) {
            objectEls.push(line);

            if (line.includes('{')) {
                count += 1;
            }
            if (line.includes('}')) {
                count -= 1;
            }

            if (count === 0) {
                objectEls.shift();
                objectEls.pop();
                map[objectName] = `{ ${ objectEls.join("\n")} }`;
                objectName = '';
                objectEls = [];
                objectFound = false;
                count = 0;
            }
        } else {
            let [variable, value, ...rest] = line.split(':');
            if (!variable || !value) {
                continue;
            }
            variable = variable.trim();
            value = `${value.replace(';', '').trim()}${rest.length > 0 ? `: ${rest.join(':')}` : ''}`.trim();
            map[variable.replace('?', '').trim()] = value.trim();
        }
    }
    return map;
}

const createStateVariablesList = (stateLines: string[], stateDefinitionsMap: Record<string, unknown> = {}) => {
    const stateVars = stateLines
        .filter(line => line && !line.includes('constructor') && !line.includes('super(') && !line.includes('.bind(this)') && !/^\s*}$}/.test(line) && !/^\s*\/\/\s*/.test(line))
        .join("\n")
        .match(/this\.state = {(.*?)};/s);

    if (!stateVars || !stateVars[1]) {
        return [];
    }

    const newLines = stateVars[1].replace(/this\./g, '').split("\n").filter(e => e);
    const formattedStateVars: string[] = [];
    let objectEls: string[] = [];

    let count = 0;
    let objectFound = false;
    let multilineFound = false;
    let idx = 0;
    let objectSetter = '';
    let objectName = '';

    for (let i = 0, total = newLines.length; i < total; i++) {
        const line = newLines[i];
        const match = line.match(/\s+({|:)$/m);
        if (match) {
            const [variable] = line.split(':');
            objectName = variable.trim();
            objectSetter = createSetterFromVariable(objectName);
            idx = stateVars.length - 1;
            if (match[1] === '{') {
                objectFound = true;
            } else {
                multilineFound = true;
            }
            count = 0;
            continue;
        } 
        
        if (objectFound) {
            objectEls.push(line);

            if (line.includes('{')) {
                count += 1;
            }
            if (line.includes('}')) {
                count -= 1;
            }

            if (count === 0) {
                const definition = stateDefinitionsMap[objectName] ? `<${stateDefinitionsMap[objectName]}>`: '';
                formattedStateVars[idx] = `const [${objectName}, ${objectSetter}] = useState${definition}({
                    ${objectEls.join("\n")}
                });`;
                idx = 0;
                objectSetter = '';
                objectName = '';
                objectEls = [];
                objectFound = false;
                continue;
            }
        } else if (multilineFound) {
            objectEls.push(line);

            if (line.includes("\n")) {
                count += 1;
            }
            if (line.includes(';')) {
                count -= 1;
            }

            if (count === 0) {
                const definition = stateDefinitionsMap[objectName] ? `<${stateDefinitionsMap[objectName]}>`: '';
                formattedStateVars[idx] = `const [${objectName}, ${objectSetter}] = useState${definition}({
                    ${objectEls.join("\n")}
                });`;
                idx = 0;
                objectSetter = '';
                objectName = '';
                objectEls = [];
                objectFound = false;
                continue;
            }
        } else {
            let [variable, value, ...rest] = line.split(':');
            if (!variable || !value) {
                continue;
            }
            variable = variable.trim();
            value = `${value}${rest.length > 0 ? `: ${rest.join('')}` : ''}`.trim().replace(/,$/, '');
            const setter = createSetterFromVariable(variable);
            const definition = stateDefinitionsMap[variable] ? `<${stateDefinitionsMap[variable]}>`: '';
            formattedStateVars.push(`const [${variable}, ${setter}] = useState${definition}(${value});`);
        }
    }
    return formattedStateVars;
}

const formatEffect = (effectLines: string[], parameters: string = '') => {
    effectLines[0] = "\n// @todo: Review content of this effect";
    effectLines.splice(1, 0, 'useEffect(() => {');
    effectLines[effectLines.length - 1] = `}${parameters ? `, ${parameters}` : ''});`;
}

const createMainEffect = (mountLines: string[] = [], unmountLines: string[] = []) => {
    if (mountLines.length > 0) {
        formatEffect(mountLines, '[]');
    } else {
        mountLines = ["\n// @todo: Review content of this effect", 'useEffect(() => {', '}, []);']
    }

    if (unmountLines.length > 0) {
        unmountLines[0] = "\nreturn () => {";
        mountLines.splice(-1, 0, unmountLines.join("\n"));
    }
}

const convertFile = async (file: string, generateContentOnly = false) => {
    const data = await readFile(file);

    if (!classComponentRegexp.test(data)) {
        throw new Error(`${file} is not a class component...`);
    }

    const imports: string[] = [];
    const matches = data.matchAll(/import(.*?)from\s*((?:'|")([\w@\/\-\.]+)(?:'|"));/gsi);
    for (const match of matches) {
        if (match[1].includes('Component') && match[3] === 'react') {
            match[0] = `import ${match[1].replace(/(\,\s*\{)?\s*(Pure)?Component\s*\}?\,?/, '')}from ${match[2]};`;
        }
        imports.push(match[0]);
    }
    
    // Add useEffect and useState imports if (this can be merged accordingly with ESLint rules)
    const reactImports = [];
    if (data.includes('this.setState')) {
        reactImports.push('useState');
    }
    if (/componentDidMount|componentWillUnmount|componentDidUpdate/.test(data)) {
        reactImports.push('useEffect');
    }
    if (reactImports.length > 0) {
        imports.push(`import { ${reactImports.join(', ')} } from \'react\';\n`);
    }

    // Find states definition (if any)
    let stateDefinitionRegexp;
    const classMatch = data.match(classComponentRegexp);
    if (classMatch && classMatch[7]) {
        const stateInterface = classMatch[7].replace(/\s*,\s*/, '').trim();
        stateDefinitionRegexp = new RegExp(`(export )?interface ${stateInterface}`);
    }

    // Find if component needs props (determined by `this.props`)
    const hasProps = data.includes('this.props');

    // Remove import lines from original content
    const lines = data.replace(/import(.*?)from\s*((?:'|")[\w@\/\-\.]+(?:'|"));/gsi, '').trim().split('\n');
    let hasRender = false;
    let hasConstructor = false;
    let hasMountEffect = false;
    let hasUnmountEffect = false;
    let hasRegularEffect = false;
    let hasStateDefinition = false;

    const hooks: string[] = [];

    let renderContent: string[] = [];
    let constructor: string[] = [];
    let mountEffect: string[] = [];
    let unmountEffect: string[] = [];
    let regularEffect: string[] = [];
    let otherLines: string[] = [];
    let stateDefinition: string[] = [];

    let count = 0;

    for (const line of lines) {
        // Special cases, since it's not linked to brackets content
        const translationMatch = line.match(/withTranslate\((.*?)\)/);
        if (classComponentRegexp.test(line)) {
            const formattedLine = createComponentDefinition(line, hasProps);
            if (formattedLine.includes(': FC')) {
                imports.push('import { FC } from \'react\';\n');
            }
            otherLines.push(formattedLine);
            continue;
        } else if (translationMatch) {
            hooks.push(`const { t } = useTranslation(${translationMatch[1]});\n`);
            imports.push('import { useTranslation } from \'react-i18next\';\n');
        } else if (/(public )?(function )?constructor\s*\(\s*.*?\s*\)/i.test(line)) {
            hasConstructor = true;
            otherLines.push("<!-- %%STATES%% --!>\n");
        } else if (/(public )?(function )?componentDidMount\s*\(\s*.*?\s*\)/i.test(line)) {
            hasMountEffect = true;
            otherLines.push("<!-- %%MOUNT%% --!>\n");
        } else if (/(public )?(function )?componentWillUnmount\s*\(\s*.*?\s*\)/i.test(line)) {
            hasUnmountEffect = true;
        } else if (/(public )?(function )?componentDidUpdate\s*\(\s*.*?\s*\)/i.test(line)) {
            hasRegularEffect = true;
            otherLines.push("<!-- %%EFFECT%% --!>\n");
        } else if (renderRegexp.test(line)) {
            hasRender = true;
            otherLines.push("<!-- %%RENDER%% --!>\n");
        } else if (stateDefinitionRegexp?.test(line)) {
            hasStateDefinition = true;
        }

        if (hasStateDefinition) {
            stateDefinition.push(line);

            if (line.includes('{')) {
                count += 1;
            }
            if (line.includes('}')) {
                count -= 1;
            }

            if (count === 0) {
                hasStateDefinition = false;
                continue;
            }
        }

        if (hasRender) {
            renderContent.push(line);

            if (line.includes('{')) {
                count += 1;
            }
            if (line.includes('}')) {
                count -= 1;
            }

            if (count === 0) {
                hasRender = false;
                continue;
            }
        }

        if (hasConstructor) {
            constructor.push(line);
            if (line.includes('{')) {
                count += 1;
            } 
            if (line.includes('}')) {
                count -= 1;
            }

            if (count === 0) {
                hasConstructor = false;
                continue;
            }
        }

        if (hasRegularEffect) {
            regularEffect.push(line);
            if (line.includes('{')) {
                count += 1;
            } 
            if (line.includes('}')) {
                count -= 1;
            }

            if (count === 0) {
                hasRegularEffect = false;
                continue;
            }
        }

        if (hasMountEffect) {
            mountEffect.push(line);
            if (line.includes('{')) {
                count += 1;
            } 
            if (line.includes('}')) {
                count -= 1;
            }

            if (count === 0) {
                hasMountEffect = false;
                continue;
            }
        }
        if (hasUnmountEffect) {
            unmountEffect.push(line);
            if (line.includes('{')) {
                count += 1;
            } 
            if (line.includes('}')) {
                count -= 1;
            }

            if (count === 0) {
                hasUnmountEffect = false;
                continue;
            }
        }

        if (!hasConstructor && !hasMountEffect && !hasUnmountEffect && !hasRender && !hasRegularEffect && !hasStateDefinition) {
            otherLines.push(line);
        }
    }
    
    // Assemble imports and get all content that is not part of a special token (including definition)
    createMainEffect(mountEffect, unmountEffect);
    formatEffect(regularEffect);

    const content = `${imports.join("\n")}\n${otherLines.join("\n")}`;

    // NOTE: we use a function instead of straight replacement since we can find $ and that is a special
    //       token when using `replace()`; having a function avoid that token
    const replacedContent = content
        // Add new state variables and setters
        .replace('<!-- %%STATES%% --!>', () => `${hooks.join("\n")}${createStateVariablesList(constructor, formatStateDefinitions(stateDefinition)).join("\n")}`)
        // Add effects
        .replace('<!-- %%MOUNT%% --!>', () => mountEffect.join("\n"))
        .replace('<!-- %%EFFECT%% --!>', () => regularEffect.join("\n"))
        // Add new render content
        .replace('<!-- %%RENDER%% --!>', () => formatRenderContent(renderContent).join("\n"))
        // Change public/private/protected methods to regular ones
        .replace(/(?:private|public|protected)\s*(async)?\s*(?:function)?\s*([\w]+)\s*=?\s*\((.*?)\)(.*?)(?:=>)?{/gmsi, (_, token, method, params, def) => `const ${method} = ${token || ''}(${params || ''})${def || ''} => {`)
        .replace(/(^\s*)([\w]+)\s+=\s+\((.*?)\)(.*?)\s+=>\s+\{/gmsi, (_, space, method, params, def) => `${space}const ${method} = (${params || ''})${def || ''} => {`)
        .replace(/(?:private|public|protected)\s*([\w]+)(.*?)=(.*?);\n/gmsi, (_, g1, g2, g3) => `let ${g1}${g2}=${g3};`)
        // Remove `this.` keyword everywhere and fix some replacement issues
        .replace(/(=>\s*){2,}/gi, '=> ')
        // Settle this.setState and use new methods
        .replace(/(this\.setState)/gms, (_, states) => addStateWarning(states.trim()).join("\n"))
        .replace(/this\.(state\.)?/gi, '');

    if (generateContentOnly) {
        return replacedContent;
    }

    const fileName = path.parse(file);
    const newFile = `${fileName.name}.new${fileName.ext}`;
    const absolutePath = path.resolve(fileName.dir, newFile);
    await writeFile(absolutePath, replacedContent);
    return absolutePath;
}

export default convertFile;