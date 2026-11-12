import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { parse as parseSfc } from "@vue/compiler-sfc";
import { baseParse, NodeTypes } from "@vue/compiler-dom";
import postcss from "postcss";

const attributes = new Set([
  "aria-label",
  "aria-description",
  "placeholder",
  "title",
  "alt",
  "label",
  "description",
  "unavailable-reason",
]);
const sinks = new Set([
  ...attributes,
  "message",
  "error",
  "heading",
  "subtitle",
  "emptyText",
  "buttonText",
  "textContent",
  "innerText",
  "innerHTML",
]);
const domains = new Set(["user", "external", "formatted", "identity"]);
const structural = (value) =>
  /^[\s\p{P}\p{S}]*$/u.test(value) && !/[⟦⟧]/u.test(value);
const parameters = (value) =>
  [
    ...new Set(
      [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(
        (match) => match[1],
      ),
    ),
  ].sort();

export function validateCatalogs(catalogs) {
  const errors = [];
  const locales = Object.keys(catalogs);
  if (!locales.length) return ["No localization catalogs found"];
  const canonical = catalogs.en ?? catalogs[locales[0]];
  const keys = new Set(Object.keys(canonical));
  if (!keys.size)
    errors.push("Localization catalogs must contain at least one key");
  for (const [locale, catalog] of Object.entries(catalogs)) {
    for (const key of keys)
      if (!Object.hasOwn(catalog, key))
        errors.push(`${locale}: missing key ${key}`);
    for (const [key, value] of Object.entries(catalog)) {
      if (!keys.has(key)) errors.push(`${locale}: extra key ${key}`);
      if (typeof value !== "string" || !value.trim())
        errors.push(`${locale}: empty or non-string value for ${key}`);
      else if (
        typeof canonical[key] === "string" &&
        JSON.stringify(parameters(value)) !==
          JSON.stringify(parameters(canonical[key]))
      )
        errors.push(`${locale}: parameter mismatch for ${key}`);
    }
  }
  return errors;
}

export function loadCatalogs(directory) {
  const catalogs = {};
  const errors = [];
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()) {
    const locale = name.split(".")[0];
    const source = readFileSync(join(directory, name), "utf8");
    const parsed = ts.parseJsonText(name, source);
    const keys = new Set();
    const visit = (node) => {
      if (ts.isPropertyAssignment(node)) {
        const key = node.name.text;
        if (keys.has(key)) errors.push(`${name}: duplicate key ${key}`);
        keys.add(key);
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    const catalog = JSON.parse(source);
    if (!catalog || Array.isArray(catalog) || typeof catalog !== "object")
      throw new Error(`${name}: catalog must be a flat object`);
    catalogs[locale] ??= {};
    for (const [key, value] of Object.entries(catalog)) {
      if (Object.hasOwn(catalogs[locale], key))
        errors.push(`${name}: duplicate key ${key}`);
      catalogs[locale][key] = value;
    }
  }
  return { catalogs, errors: [...errors, ...validateCatalogs(catalogs)] };
}

// This is a syntax/local-value check, not whole-program dataflow analysis.
// Forwarded props and external values need the browser audit; MessageKey annotations also need vue-tsc.
export function checkSource(source, filename, catalog) {
  const errors = [];
  const reported = new Set();
  function report(line, message) {
    const diagnostic = `${filename}:${line}: ${message}`;
    if (!reported.has(diagnostic)) {
      errors.push(diagnostic);
      reported.add(diagnostic);
    }
  }
  const translations = new Set(["t", "keyLabel"]);
  const modelToolPrompts = new Set();
  const definitions = new Map();
  const functionReturns = new Map();
  const typedKeys = new Set();
  const loopSources = new Map();
  const scripts = [];
  const messageKeyType = (type) =>
    !!type &&
    ((ts.isTypeReferenceNode(type) &&
      type.typeName.getText() === "MessageKey") ||
      (ts.isUnionTypeNode(type) &&
        type.types.every(
          (part) =>
            messageKeyType(part) ||
            (ts.isLiteralTypeNode(part) &&
              ts.isStringLiteral(part.literal) &&
              part.literal.text === ""),
        )));
  function parseScript(text, offset = 0) {
    const file = ts.createSourceFile(
      filename,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const line = (node) =>
      offset + file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    for (const diagnostic of file.parseDiagnostics)
      report(
        offset +
          file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line +
          1,
        "Cannot parse TypeScript",
      );
    const define = (name, value) => {
      if (!value) return;
      const values = definitions.get(name) ?? [];
      values.push({ node: value, line });
      definitions.set(name, values);
    };
    function collect(node) {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        /(?:^|\/)tool-instructions$/.test(node.moduleSpecifier.text)
      ) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          for (const binding of bindings.elements)
            if (
              (binding.propertyName?.text ?? binding.name.text) ===
              "modelToolPrompt"
            )
              modelToolPrompts.add(binding.name.text);
      }
      if (
        ts.isImportSpecifier(node) &&
        ["t", "keyLabel"].includes(node.propertyName?.text ?? node.name.text)
      )
        translations.add(node.name.text);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        define(node.name.text, node.initializer);
        if (messageKeyType(node.type)) typedKeys.add(node.name.text);
        if (
          node.initializer &&
          ts.isCallExpression(node.initializer) &&
          ts.isIdentifier(node.initializer.expression) &&
          node.initializer.expression.text === "defineProps"
        ) {
          const props = node.initializer.typeArguments?.[0];
          if (props && ts.isTypeLiteralNode(props))
            for (const property of props.members) {
              if (
                ts.isPropertySignature(property) &&
                messageKeyType(property.type)
              ) {
                typedKeys.add(property.name.getText());
                typedKeys.add(`${node.name.text}.${property.name.getText()}`);
              }
            }
        }
      }
      if (
        ts.isParameter(node) &&
        ts.isIdentifier(node.name) &&
        messageKeyType(node.type)
      )
        typedKeys.add(node.name.text);
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        if (ts.isIdentifier(node.left)) define(node.left.text, node.right);
        else if (
          ts.isPropertyAccessExpression(node.left) &&
          node.left.name.text === "value" &&
          ts.isIdentifier(node.left.expression)
        )
          define(node.left.expression.text, node.right);
      }
      if (ts.isFunctionDeclaration(node) && node.name)
        functionReturns.set(node.name.text, { node: node.body, line });
      ts.forEachChild(node, collect);
    }
    collect(file);
    scripts.push({ file, line });
    return { file, line };
  }
  function translated(node) {
    return (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      translations.has(node.expression.text)
    );
  }
  function inspectValue(
    node,
    line,
    visited = new Set(),
    allowCatalogKeys = false,
  ) {
    const inspect = (value, valueLine, seen) =>
      inspectValue(value, valueLine, seen, allowCatalogKeys);
    if (!node || translated(node)) return;
    if (ts.isStringLiteralLike(node)) {
      if (
        !structural(node.text) &&
        !(allowCatalogKeys && Object.hasOwn(catalog, node.text))
      )
        report(line(node), "UI string must use a catalog key");
      return;
    }
    if (ts.isTemplateExpression(node)) {
      if (
        !structural(node.head.text) ||
        node.templateSpans.some((span) => !structural(span.literal.text))
      )
        report(line(node), "UI template string must use a catalog key");
      for (const span of node.templateSpans)
        inspect(span.expression, line, visited);
      return;
    }
    if (ts.isIdentifier(node)) {
      if (visited.has(node.text)) return;
      const next = new Set(visited).add(node.text);
      for (const definition of definitions.get(node.text) ?? [])
        inspect(definition.node, definition.line, next);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      inspect(node.whenTrue, line, visited);
      inspect(node.whenFalse, line, visited);
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (node.name.text === "value") inspect(node.expression, line, visited);
      if (ts.isIdentifier(node.expression)) {
        for (const definition of definitions.get(node.expression.text) ?? []) {
          if (ts.isObjectLiteralExpression(definition.node))
            for (const property of definition.node.properties) {
              if (
                ts.isPropertyAssignment(property) &&
                property.name.getText() === node.name.text
              )
                inspect(property.initializer, definition.line, visited);
            }
        }
      }
      return;
    }
    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        modelToolPrompts.has(node.expression.text)
      ) {
        const property = node.parent;
        let metadata = false;
        if (
          ts.isPropertyAssignment(property) &&
          ["description", "label"].includes(property.name.text)
        ) {
          let owner = property.parent;
          while (owner && !ts.isSourceFile(owner)) {
            if (ts.isFunctionLike(owner)) break;
            if (ts.isObjectLiteralExpression(owner)) {
              const fields = owner.properties.filter(ts.isPropertyAssignment);
              const name = fields.find((field) => field.name.text === "name");
              const parameters = fields.find(
                (field) => field.name.text === "parameters",
              );
              if (
                name &&
                ts.isStringLiteral(name.initializer) &&
                parameters &&
                ts.isCallExpression(parameters.initializer) &&
                ts.isPropertyAccessExpression(
                  parameters.initializer.expression,
                ) &&
                parameters.initializer.expression.expression.getText() ===
                  "Type" &&
                parameters.initializer.expression.name.text === "Object"
              ) {
                metadata = true;
                break;
              }
            }
            owner = owner.parent;
          }
        }
        if (!metadata)
          for (const argument of node.arguments)
            inspect(argument, line, visited);
        return;
      }
      if (ts.isIdentifier(node.expression)) {
        const fn = functionReturns.get(node.expression.text);
        if (fn && !visited.has(node.expression.text))
          inspect(fn.node, fn.line, new Set(visited).add(node.expression.text));
        if (
          ["ref", "computed", "reactive", "String"].includes(
            node.expression.text,
          )
        )
          for (const argument of node.arguments)
            inspect(argument, line, visited);
      }
      return;
    }
    if (ts.isBinaryExpression(node)) {
      if (
        [
          ts.SyntaxKind.PlusToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(node.operatorToken.kind)
      ) {
        inspect(node.left, line, visited);
        inspect(node.right, line, visited);
      }
      return;
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      inspect(node.body, line, visited);
      return;
    }
    if (ts.isBlock(node)) {
      const returns = (child) => {
        if (ts.isReturnStatement(child))
          inspect(child.expression, line, visited);
        else if (!ts.isFunctionLike(child)) ts.forEachChild(child, returns);
      };
      ts.forEachChild(node, returns);
      return;
    }
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      inspect(node.expression, line, visited);
  }
  function keyValues(node, seen = new Set()) {
    if (!node) return null;
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return keyValues(node.expression, seen);
    if (ts.isConditionalExpression(node)) {
      const left = keyValues(node.whenTrue, seen);
      const right = keyValues(node.whenFalse, seen);
      return left && right ? [...left, ...right] : null;
    }
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      const values = (definitions.get(node.text) ?? []).map((value) =>
        keyValues(value.node, new Set(seen).add(node.text)),
      );
      if (values.length && values.every(Boolean)) return values.flat();
      return typedKeys.has(node.text) ? [] : null;
    }
    if (typedKeys.has(node.getText())) return [];
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression)
    ) {
      const source =
        loopSources.get(node.expression.text) ?? node.expression.text;
      const values = [];
      for (const definition of definitions.get(source) ?? []) {
        let initializer = definition.node;
        while (
          ts.isAsExpression(initializer) ||
          ts.isSatisfiesExpression(initializer)
        )
          initializer = initializer.expression;
        const objects = ts.isArrayLiteralExpression(initializer)
          ? initializer.elements
          : [initializer];
        for (const object of objects) {
          if (!ts.isObjectLiteralExpression(object)) return null;
          const property = object.properties.find(
            (property) =>
              ts.isPropertyAssignment(property) &&
              property.name.getText() === node.name.text,
          );
          const keys = property && keyValues(property.initializer, seen);
          if (!keys) return null;
          values.push(...keys);
        }
      }
      return values.length ? values : null;
    }
    return null;
  }
  function inspectCalls(file, line) {
    const visit = (node) => {
      if (translated(node)) {
        const key = node.arguments[0];
        const keys = keyValues(key);
        if (!keys)
          report(
            line(node),
            "Translation key must be a static string or a finite catalog-key reference",
          );
        else if (keys.some((key) => !Object.hasOwn(catalog, key)))
          for (const key of keys.filter((key) => !Object.hasOwn(catalog, key)))
            report(line(node), `Unknown translation key ${key}`);
        else
          for (const resolvedKey of new Set(keys)) {
            const expected = parameters(catalog[resolvedKey]);
            const params = node.arguments[1];
            if (expected.length && !params)
              report(line(node), `Missing parameters for ${resolvedKey}`);
            if (params && ts.isObjectLiteralExpression(params)) {
              const names = params.properties.map((property) =>
                property.name &&
                (ts.isIdentifier(property.name) ||
                  ts.isStringLiteral(property.name))
                  ? property.name.text
                  : null,
              );
              if (
                names.includes(null) ||
                JSON.stringify([...names].sort()) !== JSON.stringify(expected)
              )
                report(
                  line(node),
                  `Parameter names do not match ${resolvedKey}`,
                );
            }
          }
      }
      if (ts.isPropertyAssignment(node) && sinks.has(node.name.text))
        inspectValue(
          node.initializer,
          line,
          new Set(),
          ["error", "message"].includes(node.name.text),
        );
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        sinks.has(node.left.name.text)
      )
        inspectValue(
          node.right,
          line,
          new Set(),
          ["error", "message"].includes(node.left.name.text),
        );
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "setAttribute" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        attributes.has(node.arguments[0].text)
      )
        inspectValue(node.arguments[1], line);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  function expression(text, lineNumber, ui) {
    const file = ts.createSourceFile(
      filename,
      `(${text})`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const line = () => lineNumber;
    if (file.parseDiagnostics.length) {
      report(lineNumber, "Cannot parse template expression");
      return;
    }
    if (ui) inspectValue(file.statements[0]?.expression, line);
    inspectCalls(file, line);
  }
  function css(text, offset = 0) {
    postcss
      .parse(text, { from: filename })
      .walkDecls("content", (declaration) => {
        const value = declaration.value;
        if (["none", "normal", '""', "''"].includes(value)) return;
        const strings = [...value.matchAll(/(['"])((?:\\.|(?!\1).)*)\1/gu)];
        const remainder = value
          .replace(/(['"])((?:\\.|(?!\1).)*)\1/gu, "")
          .trim();
        const decode = (input) =>
          input.replace(/\\([0-9a-f]{1,6})\s?|\\(.)/giu, (_match, hex, char) =>
            hex ? String.fromCodePoint(parseInt(hex, 16)) : char,
          );
        if (remainder || strings.some((match) => !structural(decode(match[2]))))
          report(
            offset + declaration.source.start.line,
            "CSS generated text must not contain UI copy",
          );
      });
  }
  if (extname(filename) === ".vue") {
    const { descriptor, errors: parseErrors } = parseSfc(source, { filename });
    if (parseErrors.length) report(1, "Cannot parse Vue component");
    for (const script of [descriptor.script, descriptor.scriptSetup].filter(
      Boolean,
    ))
      parseScript(script.content, script.loc.start.line - 1);
    if (descriptor.template) {
      const template = descriptor.template;
      const root = baseParse(template.content);
      const visit = (node, exempt = false, renderer = false) => {
        const line = template.loc.start.line + node.loc.start.line - 1;
        if (node.type === NodeTypes.ELEMENT) {
          const loop = node.props.find(
            (prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === "for",
          )?.forParseResult;
          const previousLoop =
            loop?.value && loopSources.get(loop.value.content);
          if (loop?.value)
            loopSources.set(loop.value.content, loop.source.content);
          const boundary = node.props.find(
            (prop) =>
              prop.type === NodeTypes.ATTRIBUTE &&
              prop.name === "data-localization-content",
          );
          const domain = boundary?.value?.content;
          const isRenderer =
            node.tag === "article" &&
            domain === "user" &&
            node.props.some(
              (prop) =>
                prop.type === NodeTypes.ATTRIBUTE &&
                prop.name === "class" &&
                prop.value?.content.split(/\s/u).includes("markdown"),
            ) &&
            node.props.some(
              (prop) =>
                prop.type === NodeTypes.DIRECTIVE && prop.name === "html",
            );
          const leaf = !node.children.some(
            (child) => child.type === NodeTypes.ELEMENT,
          );
          if (boundary && (!domains.has(domain) || (!leaf && !isRenderer)))
            report(
              line,
              "Content boundary must be a leaf or a user document renderer",
            );
          for (const prop of node.props) {
            const propLine = template.loc.start.line + prop.loc.start.line - 1;
            if (
              prop.type === NodeTypes.ATTRIBUTE &&
              attributes.has(prop.name) &&
              prop.value &&
              !structural(prop.value.content)
            )
              report(
                propLine,
                `UI attribute ${prop.name} must use a catalog key`,
              );
            if (prop.type === NodeTypes.DIRECTIVE) {
              const sink =
                (prop.name === "bind" && attributes.has(prop.arg?.content)) ||
                ["text", "html"].includes(prop.name);
              if (prop.exp && (prop.name === "bind" || sink))
                expression(
                  prop.exp.content,
                  propLine,
                  sink && !(prop.name === "html" && isRenderer),
                );
            }
          }
          for (const child of node.children)
            visit(child, domains.has(domain) && leaf, renderer || isRenderer);
          if (loop?.value) {
            if (previousLoop === undefined)
              loopSources.delete(loop.value.content);
            else loopSources.set(loop.value.content, previousLoop);
          }
        } else if (
          node.type === NodeTypes.TEXT &&
          !exempt &&
          !renderer &&
          !structural(node.content)
        )
          report(line, "UI text must use a catalog key");
        else if (node.type === NodeTypes.INTERPOLATION)
          expression(node.content.content, line, !exempt && !renderer);
        else if (node.children)
          for (const child of node.children) visit(child, exempt, renderer);
      };
      visit(root);
    }
    for (const style of descriptor.styles)
      css(style.content, style.loc.start.line - 1);
  } else if (extname(filename) === ".css") css(source);
  else parseScript(source);
  for (const { file, line } of scripts) inspectCalls(file, line);
  return errors;
}

export function checkBrowserImports(source, filename) {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let common = false;
  const errors = [];
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) !== "test")
        continue;
      if (
        statement.moduleSpecifier.text === "./test" &&
        element.name.text === "test"
      )
        common = true;
      else
        errors.push(
          `${filename}: product specs must import test from './test'`,
        );
    }
  }
  if (!common)
    errors.push(`${filename}: missing shared localization test fixture`);
  return errors;
}

function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(root, entry.name))
      : [join(root, entry.name)],
  );
}
export function checkProject(clientRoot) {
  const { catalogs, errors } = loadCatalogs(
    join(clientRoot, "packages/localization/src/catalogs"),
  );
  if (!catalogs.en || !catalogs.de)
    errors.push("English and German catalogs are required");
  for (const root of ["app/src", "packages/ui/src"])
    for (const file of files(join(clientRoot, root))) {
      if (
        ![".vue", ".ts", ".css"].includes(extname(file)) ||
        /\.(test|spec|d)\.ts$/u.test(file)
      )
        continue;
      errors.push(
        ...checkSource(
          readFileSync(file, "utf8"),
          relative(clientRoot, file),
          catalogs.en ?? {},
        ),
      );
    }
  for (const file of files(join(clientRoot, "app/tests/browser")).filter(
    (file) => file.endsWith(".spec.ts"),
  ))
    errors.push(
      ...checkBrowserImports(
        readFileSync(file, "utf8"),
        relative(clientRoot, file),
      ),
    );
  return errors;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const errors = checkProject(
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  );
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      "Localization catalogs and identifiable UI string sinks passed validation.",
    );
}
