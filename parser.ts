import { parse, resolve } from 'path';
import { ClassDeclaration, Project, SourceFile, SyntaxKind, ts } from 'ts-morph';
import { addStateWarning, createSetterFromVariable } from './utils';

enum OldComponentMethods {
    Mount = 'componentDidMount',
    Unmount = 'componentWillUnmount',
    Update = 'componentDidUpdate',
    Render = 'render',
}

interface ParserReturn {
    functionDef: {
        name: string;
        isExported?: boolean;
        parameters?: {
            name: string;
            type: string;
        }[];
        statements: string | string[];
    };
    preClassContent: string;
    postClassContent: string;
}

const project = new Project({
    // tsConfigFilePath: 'path/to/tsconfig.json',
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
    },
});

const methodsToIgnore = [
    OldComponentMethods.Mount,
    OldComponentMethods.Unmount,
    OldComponentMethods.Update,
    OldComponentMethods.Render,
];

const acceptedExtendedClasses = ['Component', 'PureComponent'];

const formatBodyContent = (content?: string): string => {
    return (content || '')
        .replace(/(this\.setState)/gms, (_, states) => addStateWarning(states.trim()).join('\n'))
        .replace(/this\.(state\.)?/gi, '')
        .trim();
};

const setImports = (code: SourceFile, moduleName: string, namedImports: string[]): void => {
    const importDef = code.getImportDeclaration(moduleName);
    if (importDef) {
        importDef.addNamedImports(namedImports);
    } else {
        code.addImportDeclaration({
            namedImports: namedImports,
            moduleSpecifier: moduleName,
        });
    }
};

const parseFile = (code: SourceFile, node: ClassDeclaration): ParserReturn => {
    const componentName = node.getName() || '';
    const isComponentExported = !!node.getExportKeyword();
    const classMembers = [];

    // Check if it's a React component by checking if:
    // 1) it extends PureComponent or Component
    // 2) has a `render` method and has content in it
    const extendsClause = node.getExtends();
    const renderRef = node.getMethod('render');
    const hasRender = !!renderRef?.hasBody();

    if (!!!extendsClause || !hasRender) {
        throw new Error('Cannot convert this class since it does not extends a React Component.');
    }

    const extendsName = extendsClause.getFirstChild()?.getText() || '';
    if (!acceptedExtendedClasses.includes(extendsName)) {
        throw new Error(`The class ${componentName} is not a class component.`);
    }

    classMembers.push({
        pos: renderRef?.getPos() || 99999,
        content: formatBodyContent(renderRef?.getBodyText()),
    });

    const [componentProps, componentState] = extendsClause
        .getDescendantsOfKind(SyntaxKind.TypeReference)
        .flatMap((e) => e.getText());

    const functionsExist = [OldComponentMethods.Mount, OldComponentMethods.Unmount, OldComponentMethods.Update].some(
        (e) => node.getMethod(e)?.hasBody()
    );

    // Add new imports and remove Component/PureComponent one from React
    if (functionsExist) {
        setImports(code, 'react', ['useEffect']);
    }

    code
        .getImportDeclaration('react')
        ?.getNamedImports()
        ?.forEach((e) => {
            if (acceptedExtendedClasses.includes(e.getText())) {
                e.remove();
            }
        });

    // Find this.state content to convert it to new state variables
    const constructorDef = node.getConstructors()[0];
    const stateContentMap: string[] = [];
    const stateDefinitions: Record<string, unknown> = {};

    if (componentState) {
        const stateInterface = code.getInterface(componentState);
        if (stateInterface) {
            setImports(code, 'react', ['useState']);

            stateInterface.getChildrenOfKind(SyntaxKind.PropertySignature).forEach((e) => {
                const filteredChildren = e
                    .getChildren()
                    .filter(
                        (f) =>
                            ![SyntaxKind.QuestionToken, SyntaxKind.SemicolonToken, SyntaxKind.ColonToken].includes(
                                f.getKind()
                            )
                    );

                filteredChildren.forEach((el, index) => {
                    const hasElement = el?.getText();
                    if (hasElement && index % 2 === 0) {
                        stateDefinitions[el.getText()] = undefined;
                    } else if (hasElement) {
                        const prevKey = filteredChildren[index - 1];
                        stateDefinitions[prevKey.getText()] = el.getText(true);
                    }
                });
            });

            stateInterface.remove();
        }
    }

    if (constructorDef?.hasBody()) {
        constructorDef
            .getBody()
            ?.getChildrenOfKind(SyntaxKind.ExpressionStatement)
            .forEach((e) => {
                e.getChildrenOfKind(SyntaxKind.BinaryExpression).forEach((f) => {
                    const hasState = f
                        .getChildrenOfKind(SyntaxKind.PropertyAccessExpression)
                        .find((j) => j.getLastChild()?.getText() === 'state');
                    if (hasState) {
                        hasState
                            .getParent()
                            ?.getChildrenOfKind(SyntaxKind.ObjectLiteralExpression)
                            .forEach((g) => {
                                g.getChildrenOfKind(SyntaxKind.PropertyAssignment).forEach((child) => {
                                    const key: string = child.getFirstChild()?.getText() || '';
                                    if (key) {
                                        const definition = stateDefinitions[key] ? `<${stateDefinitions[key]}>` : '';
                                        stateContentMap.push(
                                            `const [${key}, ${createSetterFromVariable(
                                                key
                                            )}] = useState${definition}(${formatBodyContent(
                                                child.getLastChild()?.getText()
                                            )});`
                                        );
                                    }
                                });
                            });
                    }
                });
            });

        classMembers.push({
            pos: constructorDef.getPos(),
            content: stateContentMap.join('\n'),
        });
    }

    const mountEffect = node.getMethod(OldComponentMethods.Mount);
    const unmountEffect = node.getMethod(OldComponentMethods.Unmount);
    const updateEffect = node.getMethod(OldComponentMethods.Update);

    if (mountEffect?.hasBody()) {
        const unmountContent = unmountEffect?.hasBody()
            ? `return () => {\n${formatBodyContent(unmountEffect.getBodyText())}\n}`
            : '';

        classMembers.push({
            pos: mountEffect.getPos(),
            content: `\n// @todo: Review content of this effect\nuseEffect(() => {
                ${formatBodyContent(mountEffect?.getBodyText())}
                ${unmountContent}
            }, []);`,
        });
    } else if (unmountEffect?.hasBody()) {
        classMembers.push({
            pos: unmountEffect.getPos(),
            content: `\nuseEffect(() => {
                return () => {
                    ${formatBodyContent(unmountEffect.getBodyText())}
                } 
            }, []);`,
        });
    }

    if (updateEffect?.hasBody()) {
        classMembers.push({
            pos: updateEffect.getPos(),
            content: `// @todo: Review content of this effect\nuseEffect(() => {
                ${formatBodyContent(updateEffect?.getBodyText())}
            });`,
        });
    }

    const classDef = code.getClass(componentName);
    const preClassContent = code.getFullText().substring(code.getStart(), classDef?.getStart());
    const postClassContent = code.getFullText().substring(code.getEnd(), classDef?.getEnd());

    for (const el of classDef?.getMethods() || []) {
        const methodName = el.getName();
        if (methodsToIgnore.includes(methodName as OldComponentMethods)) {
            continue;
        }

        const asyncWord = el.getAsyncKeyword()?.getText(true) || '';
        const returnType = componentProps ? el.getReturnTypeNode()?.getText() || '' : '';
        const docs = el
            .getJsDocs()
            .map((jsDoc) => jsDoc.getText())
            .join('\n');

        const params = el
            .getParameters()
            .map((e) => e.getFullText())
            .join(', ')
            .trim();

        classMembers.push({
            pos: el.getPos(),
            content: `${docs}\nconst ${methodName} = ${asyncWord ? 'async ' : ''}(${params})${
                returnType ? `: ${returnType}` : ''
            } => {\n${formatBodyContent(el.getBodyText())}\n};`,
        });
    }

    for (const el of classDef?.getProperties() || []) {
        const propName = el.getName();
        // This is needed since methods can also be seen as properties (depending the way they are written)
        if (methodsToIgnore.includes(propName as OldComponentMethods)) {
            continue;
        }

        const returnType = componentProps ? el.getTypeNode()?.getText() : '';
        const initializer = el.getInitializer();
        const content = formatBodyContent(initializer?.getText());
        const isMethod = (initializer?.getChildrenOfKind(SyntaxKind.EqualsGreaterThanToken) || []).length > 0;
        const keywordToken = isMethod ? 'const' : 'let';
        const preComments = (el.getLeadingCommentRanges() || [])
            .map((c) => code.getFullText().substring(c.getPos(), c.getEnd()))
            .join('\n');
        const postComments = (el.getTrailingCommentRanges() || [])
            .map((c) => code.getFullText().substring(c.getPos(), c.getEnd()))
            .join('\n');

        classMembers.push({
            pos: el.getPos(),
            content: `${preComments}\n${keywordToken} ${propName}${
                returnType ? `: ${returnType}` : ''
            } = ${content};${postComments}`,
        });
    }

    const parameters = componentProps
        ? [
              {
                  name: 'props',
                  type: componentProps,
              },
          ]
        : undefined;

    return {
        functionDef: {
            name: componentName,
            isExported: isComponentExported,
            parameters,
            statements: classMembers.sort((a, b) => a.pos - b.pos).map((e) => e.content),
        },
        preClassContent,
        postClassContent,
    };
};

export const convertFile = async (file: string, generateContentOnly = false): Promise<string | void> => {
    const code = project.addSourceFileAtPath(file);
    const classes = code.getClasses();

    if (classes.length === 0) {
        throw new Error('Cannot convert this file since it is not a class Component');
    }

    if (classes.length > 1) {
        throw new Error('Cannot convert this file since it contains more than 1 class');
    }

    const node = classes[0];
    const structure = parseFile(code, node);

    const fileName = parse(file);
    const newFile = `${fileName.name}.new${fileName.ext}`;
    const absolutePath = resolve(fileName.dir, newFile);

    const source = project.createSourceFile(absolutePath, structure.preClassContent, { overwrite: true });

    source.addFunction(structure.functionDef);

    const endFile = source.getEnd();
    source.insertText(endFile, structure.postClassContent);

    if (generateContentOnly) {
        return source.getFullText() || '';
    }

    await source.save();
};
