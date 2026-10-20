# BMS braces security patch

This directory vendors the MIT-licensed `braces@3.0.3` source and changes the package version to
`3.0.4-bms.1`. The patch rejects brace/parenthesis AST nesting above 100 levels before the recursive
compile, expand or stringify walkers run. It mitigates `GHSA-vfj7-8cjw-p6xm` without downgrading the
React Native toolchain.

The source remains private to this repository and must not be published. Remove the override when an
upstream patched release is available and passes the complete mobile verification suite.
