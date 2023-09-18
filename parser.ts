import { LeftHandSideExpression, StructureKind, ts } from 'ts-morph';
import { ClassDeclaration, ImportDeclaration, Project, SourceFile, SyntaxKind, VariableDeclarationKind } from "ts-morph";
import { addStateWarning, createSetterFromVariable } from './utils';
import { writeFile } from './converter';

const project = new Project({
    // tsConfigFilePath: 'path/to/tsconfig.json',
    // skipAddingFilesFromTsConfig: true,
    compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX
    }
});

const acceptedExtendedClasses = ['Component', 'PureComponent'];

const parseFile = (code: SourceFile, node: ClassDeclaration) => {
    const componentName = node.getName() || '';
    const isComponentExported = !!node.getExportKeyword();
    const startFilePos = code.getStart();
    const classStartPos = node.getStart();
    const preClassContent = code.getFullText().substring(startFilePos, classStartPos);

    const classEndPos = node.getEnd();
    const endFilePos = code.getEnd();
    const postClassContent = code.getFullText().substring(classEndPos, endFilePos);

    let statesContent = '';
    let hooksContent = '';
    let mountContent = '';
    let renderContent = '';
    let updateContent = '';

    // Check if it's a React component by checking if:
    // 1) it extends PureComponent or Component
    // 2) has a `render` method and has content in it
    const extendsClause = node.getExtends();
    const renderRef = node.getMethod('render');
    const hasRender = renderRef?.hasBody();

    if (!extendsClause || !hasRender) {
        throw new Error('Cannot convert this class since it does not extends a React Component');
    }
    
    const extendsName = extendsClause.getFirstChild()?.getText() || '';
    if (!acceptedExtendedClasses.includes(extendsName)) {
        throw new Error(`This class is not a class component...`);
    }

    if (renderRef) {
        renderContent = renderRef.getBodyText() || '',
        renderRef.replaceWithText('REPLACE_RENDER');
    }

    const [componentProps, componentState] = extendsClause.getDescendantsOfKind(SyntaxKind.TypeReference).flatMap((e) => e.getText());

    const functionsToCheck = ['componentDidMount', 'componentWillUnmount', 'componentDidUpdate'];
    const functionsExist = functionsToCheck.some(e => node.getMethod(e)?.hasBody());
    
    // Add new imports and remove Component/PureComponent one from React
    const importDef = code.getImportDeclaration('react');
    if (functionsExist) {
        if (importDef) {
            importDef.addNamedImport('useEffect');
        } else {
            code.addImportDeclaration({
                namedImports: ['useEffect'],
                moduleSpecifier: 'react'
            });
        }
    }

    if (componentProps) {
        code.getImportDeclaration('react')?.addNamedImport('FC')
    }

    code.getImportDeclaration('react')?.getNamedImports()?.forEach(e => {
        if (acceptedExtendedClasses.includes(e.getText())) {
            e.remove();
        }
    });

    // Find this.state content to convert it to new state variables
    const constructorDef = node.getConstructors()[0];
    const stateContentMap: string[] = [];
    const stateDefinitions: Record<string, unknown> = {};

    const stateInterface = code.getInterface(componentState);
    if (stateInterface) {
        stateInterface.getChildrenOfKind(SyntaxKind.PropertySignature).forEach(e => {
            const filteredChildren = e.getChildren()
                .filter(f => ![SyntaxKind.QuestionToken, SyntaxKind.SemicolonToken, SyntaxKind.ColonToken].includes(f.getKind()));
        
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

    constructorDef.getBody()?.getChildrenOfKind(SyntaxKind.ExpressionStatement).forEach(e => {
        e.getChildrenOfKind(SyntaxKind.BinaryExpression).forEach(f => {
            const hasState = f.getChildrenOfKind(SyntaxKind.PropertyAccessExpression).find(j => j.getLastChild()?.getText() === 'state');
            if (hasState) {
                hasState.getParent()?.getChildrenOfKind(SyntaxKind.ObjectLiteralExpression).forEach(g => {
                    g.getChildrenOfKind(SyntaxKind.PropertyAssignment).forEach(child => {
                        const key: string = child.getFirstChild()?.getText() || '';
                        if (key) {
                            const definition = stateDefinitions[key] ? `<${stateDefinitions[key]}>` : '';
                            stateContentMap.push(`const [${key}, ${createSetterFromVariable(key)}] = useState${definition}(${child.getLastChild()?.getText()});`);
                        }
                    })
                });
            }
        });
    });

    statesContent = stateContentMap.join("\n");
    constructorDef.replaceWithText('//REPLACE_CONSTRUCTOR');

    const mountEffect = node.getMethod('componentDidMount');
    const unmountEffect = node.getMethod('componentWillUnmount');
    const updateEffect = node.getMethod('componentDidUpdate');

    if (mountEffect?.hasBody()) {
        const unmountContent = unmountEffect?.hasBody() ? `return () => {
            ${unmountEffect.getBodyText() || ''}
        }`: '';

        mountContent = `\n// @todo: Review content of this effect\nuseEffect(() => {
            ${mountEffect?.getBodyText() || ''}
            ${unmountContent}
        }, []);`,

        mountEffect.replaceWithText('REPLACE_MOUNT_EFFECT')
        unmountEffect?.remove();
    } else if (unmountEffect?.hasBody()) {
        mountContent = `\nuseEffect(() => {
            return () => {
                ${unmountEffect.getBodyText() || ''}
            } 
        }, []);`;
        unmountEffect.replaceWithText('REPLACE_MOUNT_EFFECT');
    }

    if (updateEffect?.hasBody()) {
        updateContent = `// @todo: Review content of this effect\nuseEffect(() => {
            ${updateEffect?.getBodyText() || ''}
        });`;
        updateEffect.replaceWithText('REPLACE_UPDATE_EFFECT');
    }

    const methods = node.getMethods() || [];
    const blackListVars = ['REPLACE_UPDATE_EFFECT', 'REPLACE_MOUNT_EFFECT', '//REPLACE_CONSTRUCTOR', 'REPLACE_RENDER'];
    if (methods.length > 0) {
        node.transform(traversal => {
            const f = traversal.visitChildren();

            if (ts.isMethodDeclaration(f)) {
                const value = traversal.factory.createArrowFunction(
                    undefined,
                    undefined,
                    f.parameters,
                    f.type,
                    traversal.factory.createToken(SyntaxKind.EqualsGreaterThanToken), 
                    // @ts-ignore
                    f.body
                );

                const variableDeclaration = traversal.factory.createVariableDeclaration(
                    f.name.getText(),
                    undefined,
                    undefined,
                    value,
                );

                return traversal.factory.createVariableStatement(
                    undefined,
                    [variableDeclaration],
                );
                // return f;
            }

            if (ts.isPropertyDeclaration(f)) {
                if (blackListVars.includes(f.name.getText())) {
                    return f;
                }
                const variableDeclaration = traversal.factory.createVariableDeclaration(
                    f.name.getText(),
                    undefined,
                    f.type,
                    f.initializer,
                );

                return traversal.factory.createVariableStatement(
                    undefined,
                    [variableDeclaration],
                );
            }

            return f;
        });
    }

    const reactI18NextMatch = code.getFullText().match(/withTranslation\((.*?)\)/);
    if (reactI18NextMatch) {
        hooksContent = `const { t } = useTranslation(${reactI18NextMatch});`;
        code.getImportDeclaration('react-i18next')?.addNamedImport('useTranslation');
    }

    const content = code.getClass(componentName);
    return {
        functionDef: {
            name: componentName,
            isExported: isComponentExported,
            parameters: [{
                name: 'props',
                type: componentProps,
            }],
            statements: content?.getFullText().substring(classStartPos, classEndPos),
        },
        updateContent,
        mountContent,
        renderContent,
        statesContent,
        hooksContent,
        preClassContent,
        postClassContent,
    };
}

export const convertFile = async (file: string, generateContentOnly = false) => {
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
    const source = project.createSourceFile(
        'test.tsx',
        structure.preClassContent,
        { overwrite: true}
    );

    const mainMethod = source.addFunction(structure.functionDef);
    mainMethod.setBodyText((mainMethod.getBodyText() || '')
        .replace('REPLACE_CONSTRUCTOR', () => `${structure.hooksContent}\n${structure.statesContent}`)
        .replace('REPLACE_MOUNT_EFFECT', () => structure.mountContent)
        .replace('REPLACE_UPDATE_EFFECT', () => structure.updateContent)
        .replace('REPLACE_RENDER', () => structure.renderContent)
    );

    console.log(mainMethod.getBodyText())

    const endFile = source.getEnd();
    source.insertText(endFile, structure.postClassContent);
    await source.save();
}

