; ──────────────────────────────────────────────────────────────────────────────
; Python tree-sitter tags query
; Used to extract top-level symbol definitions and import statements.
; ──────────────────────────────────────────────────────────────────────────────

; ── Definitions (top-level only) ─────────────────────────────────────────────

; def foo(...): ...
(module
  (function_definition
    name: (identifier) @definition.function))

; async def foo(...): ...
(module
  (decorated_definition
    (function_definition
      name: (identifier) @definition.function)))

; class Foo: ...
(module
  (class_definition
    name: (identifier) @definition.class))

; class Foo (decorated):
(module
  (decorated_definition
    (class_definition
      name: (identifier) @definition.class)))

; x = ... or x: int = ...  (simple and annotated assignments at module level)
; In tree-sitter-python 0.23.6, both forms produce an `assignment` node.
(module
  (expression_statement
    (assignment
      left: (identifier) @definition.variable)))

; ── Import statements ─────────────────────────────────────────────────────────

; import foo
; import foo.bar
(import_statement
  name: (dotted_name) @import.module)

; import foo as bar
(import_statement
  name: (aliased_import
    name: (dotted_name) @import.module
    alias: (identifier) @import.alias))

; from foo import bar
; from foo import bar, baz
(import_from_statement
  module_name: (dotted_name) @import.from_module
  name: (dotted_name) @import.from_name)

; from foo import bar as baz
(import_from_statement
  module_name: (dotted_name) @import.from_module
  name: (aliased_import
    name: (dotted_name) @import.from_name
    alias: (identifier) @import.from_alias))

; from . import bar  (relative, level=1, no module)
(import_from_statement
  module_name: (relative_import) @import.relative_module
  name: (dotted_name) @import.from_name)

; from .foo import bar  (relative with sub-module)
(import_from_statement
  module_name: (relative_import
    (dotted_name) @import.relative_submodule) @import.relative_module
  name: (dotted_name) @import.from_name)

; from . import bar as baz
(import_from_statement
  module_name: (relative_import) @import.relative_module
  name: (aliased_import
    name: (dotted_name) @import.from_name
    alias: (identifier) @import.from_alias))

; from foo import *
; wildcard_import has no field name in tree-sitter-python 0.23.6, so no field: prefix
(import_from_statement
  module_name: (dotted_name) @import.wildcard_module
  (wildcard_import) @import.wildcard)

; from .foo import *
(import_from_statement
  module_name: (relative_import) @import.wildcard_rel_module
  (wildcard_import) @import.wildcard)
