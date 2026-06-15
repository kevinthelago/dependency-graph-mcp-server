/**
 * Tree-sitter S-expression queries for Objective-C source analysis.
 *
 * Node types sourced from tree-sitter-objc grammar
 * (https://github.com/tree-sitter/tree-sitter-objc).
 */

/** Captures all preprocessor include/import directives and @import module declarations. */
export const IMPORT_QUERY = `
(preproc_include path: (string_literal) @quoted-include)
(preproc_include path: (system_lib_string) @angled-include)
(preproc_import path: (string_literal) @quoted-import)
(preproc_import path: (system_lib_string) @angled-import)
(module_import (identifier) @framework-import)
`;

/**
 * Captures top-level ObjC declarations that produce symbol nodes.
 *
 * Captured names:
 *   @interface Foo        → "interface"   (ClassName node)
 *   @interface Foo (Bar)  → "cat-class" + "cat-name"
 *   @protocol Foo         → "protocol"    (name node)
 *   #define MACRO         → "macro"       (identifier node)
 */
export const SYMBOL_QUERY = `
(class_interface name: (type_identifier) @interface)
(category_interface
  name: (type_identifier) @cat-class
  category: (type_identifier) @cat-name)
(protocol_declaration name: (type_identifier) @protocol)
(preproc_def name: (identifier) @macro)
`;

/**
 * Captures @class forward declarations that become best-effort reference edges.
 * The @class directive may forward-declare one or more class names.
 */
export const FORWARD_DECL_QUERY = `
(class_forward_declaration (type_identifier) @forward-class)
`;

/**
 * Captures @implementation blocks solely to emit category→class association edges.
 * @implementation Foo       → no new symbol (class already declared via @interface)
 * @implementation Foo (Bar) → category association edge
 */
export const IMPL_QUERY = `
(category_implementation
  name: (type_identifier) @cat-impl-class
  category: (type_identifier) @cat-impl-name)
`;
